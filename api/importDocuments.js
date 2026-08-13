/**
 * Import en masse de documents véhicule (cartes grises, cartes blanches…)
 * depuis un dossier local. Chaque fichier est rattaché à un véhicule via
 * l'immatriculation contenue dans son nom (ex. « FG-985-VD - CARTE GRISE.pdf »).
 *
 * Usage :
 *   node importDocuments.js --dir=/import [options]
 *
 *   --dir=CHEMIN     dossier à parcourir (récursif)          [obligatoire]
 *   --type=TYPE      carte_grise (défaut) | carte_blanche | autre
 *   --dry-run        n'écrit rien, affiche seulement le plan d'import
 *   --fuzzy          accepte une correspondance approchée (1 caractère
 *                    d'écart) quand elle est unique — utile pour les
 *                    coquilles d'immatriculation
 *   --replace        remplace le document existant du même type au lieu
 *                    de passer le fichier (par défaut : ignoré)
 *
 * Sur le VPS :
 *   docker cp ./cartes-grises flotte-api:/import
 *   docker compose exec flotte-api node importDocuments.js --dir=/import --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import pool, { initDB } from "./db.js";

const MIMES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const TYPES = new Set(["carte_grise", "carte_blanche", "autre"]);
const MAX_BYTES = 20 * 1024 * 1024;

// ── Arguments ────────────────────────────────────────────────
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const DIR = args.get("dir");
const TYPE = TYPES.has(args.get("type")) ? args.get("type") : "carte_grise";
const DRY = args.has("dry-run");
const FUZZY = args.has("fuzzy");
const REPLACE = args.has("replace");

if (!DIR) {
  console.error("Dossier manquant. Exemple : node importDocuments.js --dir=/import");
  process.exit(1);
}

// ── Rapprochement immatriculation ↔ véhicule ────────────────
// Même logique que l'écran d'import de l'application.
const normalize = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* Immatriculation devinée depuis le nom du fichier : le segment avant
   « - CARTE… », sinon le premier motif SIV (AA-123-AA) ou FNI (123-ABC-34). */
function plateFromName(name) {
  const base = path.basename(name, path.extname(name));
  const head = base.split(/\s+-\s+/)[0].trim();
  if (normalize(head).length >= 6) return head;
  const m =
    base.match(/[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}/i) ||
    base.match(/\d{1,4}[\s-]?[A-Z]{2,3}[\s-]?\d{2,3}/i);
  return m ? m[0] : "";
}

/* Distance d'édition (Damerau) — une coquille d'un caractère, ou
   l'inversion de deux caractères voisins, sur l'immatriculation */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (MIMES[path.extname(entry.name).toLowerCase()]) out.push(full);
  }
  return out;
}

// ── Import ───────────────────────────────────────────────────
async function main() {
  // Idempotent : garantit que la table des documents existe même si
  // le script est lancé avant le redémarrage de l'API.
  await initDB();
  const { rows: vehicles } = await pool.query(
    "SELECT id, immatriculation FROM vehicles ORDER BY id"
  );
  const byPlate = new Map();
  for (const v of vehicles) {
    const key = normalize(v.immatriculation);
    if (key) byPlate.set(key, v);
  }

  const files = walk(DIR);
  console.log(`${files.length} fichier(s) trouvé(s) dans ${DIR} — type « ${TYPE} »`);

  const stats = { imported: 0, replaced: 0, skipped: 0, unmatched: 0, fuzzy: 0, tooBig: 0 };
  const unmatched = [];

  for (const file of files) {
    const name = path.basename(file);
    const plate = plateFromName(name);
    const key = normalize(plate);
    let vehicle = byPlate.get(key) || null;
    let approx = false;

    if (!vehicle && FUZZY && key.length >= 6) {
      const near = [...byPlate.keys()].filter((k) => editDistance(key, k) <= 1);
      if (near.length === 1) {
        vehicle = byPlate.get(near[0]);
        approx = true;
      }
    }

    if (!vehicle) {
      stats.unmatched++;
      unmatched.push(`${name}  (immatriculation lue : ${plate || "—"})`);
      continue;
    }

    const size = fs.statSync(file).size;
    if (size > MAX_BYTES) {
      stats.tooBig++;
      console.log(`  ⚠ ${name} — ${Math.round(size / 1048576)} Mo, au-delà de la limite (20 Mo)`);
      continue;
    }

    const { rows: existing } = await pool.query(
      "SELECT id FROM vehicle_documents WHERE vehicle_id=$1 AND type=$2",
      [vehicle.id, TYPE]
    );
    if (existing.length && !REPLACE) {
      stats.skipped++;
      continue;
    }

    // Le nom marqué « À VÉRIFIER » remonte en note sur la fiche
    const notes = /a\s*v[ée]rifier/i.test(name) ? "À vérifier (source)" : "";
    const tag = approx ? ` ~ ${vehicle.immatriculation}` : "";
    if (DRY) {
      console.log(`  ${existing.length ? "remplacerait" : "importerait"} ${name} → ${vehicle.immatriculation}${tag}`);
      if (approx) stats.fuzzy++;
      if (existing.length) stats.replaced++; else stats.imported++;
      continue;
    }

    const data = fs.readFileSync(file);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (existing.length) {
        await client.query(
          "DELETE FROM vehicle_documents WHERE vehicle_id=$1 AND type=$2",
          [vehicle.id, TYPE]
        );
      }
      await client.query(
        `INSERT INTO vehicle_documents
           (vehicle_id, type, filename, mime, size, data, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [vehicle.id, TYPE, name, MIMES[path.extname(name).toLowerCase()], data.length, data, notes]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    if (approx) stats.fuzzy++;
    if (existing.length) stats.replaced++; else stats.imported++;
    console.log(`  ✓ ${name} → ${vehicle.immatriculation}${tag}`);
  }

  if (unmatched.length) {
    console.log(`\n${unmatched.length} fichier(s) sans véhicule correspondant :`);
    for (const u of unmatched) console.log(`  · ${u}`);
    console.log(
      FUZZY
        ? "  → créez le véhicule ou corrigez son immatriculation, puis relancez."
        : "  → relancez avec --fuzzy pour tenter un rapprochement approché."
    );
  }
  console.log(
    `\n${DRY ? "[simulation] " : ""}Import : ${stats.imported} ajouté(s), ` +
    `${stats.replaced} remplacé(s), ${stats.skipped} déjà présent(s), ` +
    `${stats.unmatched} non rattaché(s)` +
    (stats.fuzzy ? `, ${stats.fuzzy} rapprochement(s) approché(s)` : "") +
    (stats.tooBig ? `, ${stats.tooBig} trop volumineux` : "")
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
