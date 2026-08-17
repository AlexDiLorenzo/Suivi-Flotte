import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool, { initDB } from "./db.js";
import ZipWriter from "./zip.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

// Le secret JWT doit être fourni et solide : sans lui, n'importe qui pourrait
// forger des tokens valides. On refuse de démarrer plutôt que de retomber
// silencieusement sur une valeur par défaut connue.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET manquant ou trop court (32 caractères minimum requis).");
  process.exit(1);
}

// Derrière Traefik + nginx : indispensable pour que req.ip reflète l'IP du
// client (et non celle du proxy) — utilisé par la limitation anti-brute-force.
app.set("trust proxy", true);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

// ── Limitation anti-brute-force (en mémoire, par IP) ─────────
// Plafonne les tentatives répétées sur les routes d'authentification.
const RL_WINDOW_MS = 15 * 60 * 1000; // fenêtre glissante de 15 minutes
const RL_MAX = 15;                    // tentatives autorisées par IP et par fenêtre
const authHits = new Map();           // ip -> { count, resetAt }
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const rec = authHits.get(ip);
  if (!rec || now > rec.resetAt) {
    authHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return next();
  }
  if (++rec.count > RL_MAX) {
    res.set("Retry-After", String(Math.ceil((rec.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Trop de tentatives. Réessayez dans quelques minutes." });
  }
  next();
}
// Purge périodique des entrées expirées
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authHits) if (now > rec.resetAt) authHits.delete(ip);
}, RL_WINDOW_MS).unref();

// ── Auth middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(header.replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Petit wrapper pour router les erreurs async vers le handler global
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Auth routes ─────────────────────────────────────────────
app.get("/api/auth/check", wrap(async (_req, res) => {
  const { rowCount } = await pool.query("SELECT 1 FROM users LIMIT 1");
  res.json({ hasUsers: rowCount > 0 });
}));

app.post("/api/auth/setup", loginRateLimit, wrap(async (req, res) => {
  const { rowCount } = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (rowCount > 0) return res.status(403).json({ error: "Compte déjà configuré" });
  const { username, password } = req.body;
  if (!username || !password || password.length < 12) {
    return res.status(400).json({ error: "Identifiant et mot de passe (min. 12 caractères) requis" });
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (username, password_hash) VALUES ($1,$2)", [username, hash]);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username });
}));

app.post("/api/auth/login", loginRateLimit, wrap(async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  if (!rows.length) return res.status(401).json({ error: "Identifiants invalides" });
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Identifiants invalides" });
  const token = jwt.sign({ id: rows[0].id, username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username });
}));

// Modification de l'identifiant et/ou du mot de passe du compte connecté
app.put("/api/auth/credentials", loginRateLimit, auth, wrap(async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [req.user.username]);
  if (!rows.length) return res.status(404).json({ error: "Compte introuvable" });
  const ok = await bcrypt.compare(currentPassword || "", rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
  const username = (newUsername || rows[0].username).trim();
  if (!username) return res.status(400).json({ error: "Identifiant requis" });
  if (newPassword && newPassword.length < 12) {
    return res.status(400).json({ error: "Nouveau mot de passe : 12 caractères minimum" });
  }
  const hash = newPassword ? await bcrypt.hash(newPassword, 10) : rows[0].password_hash;
  try {
    await pool.query(
      "UPDATE users SET username=$1, password_hash=$2 WHERE id=$3",
      [username, hash, rows[0].id]
    );
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Cet identifiant est déjà pris" });
    throw err;
  }
  const token = jwt.sign({ id: rows[0].id, username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username });
}));

// ── Comptes de l'application ────────────────────────────────
// L'application n'a pas de rôles : tout compte connecté dispose des
// mêmes droits et peut donc créer ou retirer un autre compte.
app.get("/api/auth/users", auth, wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT id, username FROM users ORDER BY id");
  res.json(rows);
}));

app.post("/api/auth/users", loginRateLimit, auth, wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username) return res.status(400).json({ error: "Identifiant requis" });
  if (password.length < 12) {
    return res.status(400).json({ error: "Mot de passe : 12 caractères minimum" });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username",
      [username, hash]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Cet identifiant est déjà pris" });
    throw err;
  }
}));

app.delete("/api/auth/users/:id", auth, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT id, username FROM users WHERE id=$1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Compte introuvable" });
  // Deux garde-fous : on ne supprime ni son propre compte (déconnexion
  // immédiate et confuse), ni le dernier — sinon plus personne n'entre.
  if (rows[0].username === req.user.username) {
    return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
  }
  const { rows: count } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (count[0].n <= 1) {
    return res.status(400).json({ error: "Impossible de supprimer le dernier compte" });
  }
  await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ── Toutes les routes de données nécessitent l'authentification ──
app.use("/api/categories", auth);
app.use("/api/vehicles", auth);
app.use("/api/interventions", auth);
app.use("/api/documents", auth);
app.use("/api/presence", auth);
app.use("/api/planning", auth);
app.use("/api/recap", auth);
app.use("/api/recap-config", auth);
app.use("/api/frank-config", auth);
app.use("/api/send-mail", auth);
app.use("/api/stats", auth);

// ── Catégories ──────────────────────────────────────────────
app.get("/api/categories", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM categories ORDER BY position, name");
  res.json(rows);
}));

app.post("/api/categories", wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "Nom requis" });
  const id = "cat_" + Date.now();
  const { rows } = await pool.query("SELECT COALESCE(MAX(position),0)+1 AS p FROM categories");
  await pool.query(
    "INSERT INTO categories (id, name, color, position) VALUES ($1,$2,$3,$4)",
    [id, name, color || "#D3D1C7", rows[0].p]
  );
  res.json({ id });
}));

app.put("/api/categories/:id", wrap(async (req, res) => {
  const { name, color } = req.body;
  await pool.query("UPDATE categories SET name=$1, color=$2 WHERE id=$3", [name, color, req.params.id]);
  res.json({ ok: true });
}));

app.delete("/api/categories/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM categories WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ── Véhicules ───────────────────────────────────────────────
app.get("/api/vehicles", wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*,
      (SELECT COUNT(*) FROM interventions i WHERE i.vehicle_id = v.id) AS interventions_count
    FROM vehicles v
    ORDER BY v.position, v.id
  `);
  res.json(rows);
}));

app.get("/api/vehicles/:id", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM vehicles WHERE id=$1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Véhicule introuvable" });
  res.json(rows[0]);
}));

// PTAC : entier positif en kg, ou null si non renseigné
function parsePtac(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

app.post("/api/vehicles", wrap(async (req, res) => {
  const v = req.body;
  if (!v.category_id) return res.status(400).json({ error: "Catégorie requise" });
  const { rows: pos } = await pool.query("SELECT COALESCE(MAX(position),0)+1 AS p FROM vehicles");
  const { rows } = await pool.query(
    `INSERT INTO vehicles
       (category_id, marque, modele, immatriculation, date_mec, numero_serie,
        ct_date, assurance_date, statut, ptac, usage_type, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "", v.ct_date || "",
      v.assurance_date || "", v.statut || "", parsePtac(v.ptac),
      v.usage_type || "", v.notes || "", pos[0].p,
    ]
  );
  res.json(rows[0]);
}));

app.put("/api/vehicles/:id", wrap(async (req, res) => {
  const v = req.body;
  const { rows } = await pool.query(
    `UPDATE vehicles SET
       category_id=$1, marque=$2, modele=$3, immatriculation=$4, date_mec=$5,
       numero_serie=$6, ct_date=$7, assurance_date=$8, statut=$9,
       ptac=$10, usage_type=$11, notes=$12
     WHERE id=$13 RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "", v.ct_date || "",
      v.assurance_date || "", v.statut || "", parsePtac(v.ptac),
      v.usage_type || "", v.notes || "", req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "Véhicule introuvable" });
  res.json(rows[0]);
}));

app.delete("/api/vehicles/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM vehicles WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ── Interventions ───────────────────────────────────────────
// Liste des interventions d'un véhicule (avec leurs lignes)
app.get("/api/vehicles/:id/interventions", wrap(async (req, res) => {
  const { rows: ivs } = await pool.query(
    "SELECT * FROM interventions WHERE vehicle_id=$1 ORDER BY date DESC, id DESC",
    [req.params.id]
  );
  const { rows: items } = await pool.query(
    `SELECT it.* FROM intervention_items it
     JOIN interventions i ON i.id = it.intervention_id
     WHERE i.vehicle_id=$1 ORDER BY it.position, it.id`,
    [req.params.id]
  );
  const byIv = {};
  for (const it of items) (byIv[it.intervention_id] ||= []).push(it);
  res.json(ivs.map((iv) => ({ ...iv, items: byIv[iv.id] || [] })));
}));

async function saveItems(client, interventionId, items) {
  await client.query("DELETE FROM intervention_items WHERE intervention_id=$1", [interventionId]);
  let pos = 0;
  for (const it of items || []) {
    await client.query(
      `INSERT INTO intervention_items
         (intervention_id, type, designation, fournisseur, quantite, prix_unitaire, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        interventionId, it.type || "", it.designation || "", it.fournisseur || "",
        Number(it.quantite) || 0, Number(it.prix_unitaire) || 0, ++pos,
      ]
    );
  }
}

app.post("/api/interventions", wrap(async (req, res) => {
  const iv = req.body;
  if (!iv.vehicle_id) return res.status(400).json({ error: "Véhicule requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO interventions (vehicle_id, date, kms, mecaniciens, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [iv.vehicle_id, iv.date || "", iv.kms || null, iv.mecaniciens || "", iv.notes || ""]
    );
    await saveItems(client, rows[0].id, iv.items);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.put("/api/interventions/:id", wrap(async (req, res) => {
  const iv = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE interventions SET date=$1, kms=$2, mecaniciens=$3, notes=$4
       WHERE id=$5 RETURNING *`,
      [iv.date || "", iv.kms || null, iv.mecaniciens || "", iv.notes || "", req.params.id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Intervention introuvable" });
    }
    await saveItems(client, req.params.id, iv.items);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.delete("/api/interventions/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM interventions WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ── Documents administratifs des véhicules ──────────────────
// Carte grise (certificat d'immatriculation), carte blanche
// (autorisation de mise en service des dépanneuses) et autres pièces.
// Le fichier est stocké en base (BYTEA) et ne transite que par la
// route `/file` — les listes ne renvoient que les métadonnées.
const DOC_TYPES = new Set(["carte_grise", "carte_blanche", "autre"]);
const DOC_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const DOC_MAX_BYTES = 20 * 1024 * 1024;
const DOC_FIELDS = `id, vehicle_id, type, filename, mime, size,
  date_delivrance, date_expiration, numero, notes, created_at`;

const docMime = (req) => String(req.headers["content-type"] || "").split(";")[0].trim();

function parseDocType(raw) {
  const t = String(raw || "").trim();
  return DOC_TYPES.has(t) ? t : "autre";
}
// Date ISO 'AAAA-MM-JJ', ou chaîne vide si absente / mal formée
function parseIsoDate(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
// Le nom de fichier finit dans un en-tête HTTP : on retire tout chemin
// et tout caractère de contrôle avant de le stocker.
function safeFilename(raw) {
  const s = String(raw || "")
    .replace(/[\\/]/g, "_")
    .split("")
    .filter((ch) => ch.charCodeAt(0) > 31 && ch !== '"')
    .join("")
    .trim()
    .slice(0, 200);
  return s || "document";
}

// Corps binaire : accepté uniquement pour les types de fichiers permis.
// Un content-type non listé laisse `req.body` vide → 415.
const rawUpload = express.raw({
  type: (req) => DOC_MIMES.has(docMime(req)),
  limit: DOC_MAX_BYTES,
});

// Tous les documents de la flotte (métadonnées) — page Documents
app.get("/api/documents", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${DOC_FIELDS} FROM vehicle_documents
     ORDER BY vehicle_id, type, created_at DESC`
  );
  res.json(rows);
}));

// Documents d'un véhicule
app.get("/api/vehicles/:id/documents", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${DOC_FIELDS} FROM vehicle_documents
     WHERE vehicle_id=$1 ORDER BY type, created_at DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

// Dépôt d'un document : corps = le fichier brut, métadonnées en query
// (?type=carte_grise&filename=…&expiration=AAAA-MM-JJ)
app.post("/api/vehicles/:id/documents", rawUpload, wrap(async (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) {
    return res.status(415).json({
      error: "Fichier absent ou format non supporté (PDF, JPEG, PNG ou WebP).",
    });
  }
  const { rowCount } = await pool.query("SELECT 1 FROM vehicles WHERE id=$1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Véhicule introuvable" });
  const q = req.query;
  const { rows } = await pool.query(
    `INSERT INTO vehicle_documents
       (vehicle_id, type, filename, mime, size, data,
        date_delivrance, date_expiration, numero, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${DOC_FIELDS}`,
    [
      req.params.id, parseDocType(q.type), safeFilename(q.filename), docMime(req),
      buf.length, buf, parseIsoDate(q.delivrance), parseIsoDate(q.expiration),
      String(q.numero || "").slice(0, 60), String(q.notes || "").slice(0, 500),
    ]
  );
  res.json(rows[0]);
}));

// Export groupé : toutes les pièces d'un type dans une archive ZIP
// (?type=carte_grise par défaut, `all` pour tout prendre).
// L'archive est écrite à la volée, document par document : on ne charge
// jamais les ~160 Mo de cartes grises en mémoire d'un seul tenant.
const EXPORT_LABELS = {
  carte_grise: "CARTE GRISE",
  carte_blanche: "CARTE BLANCHE",
  autre: "AUTRE",
};
const EXPORT_ARCHIVES = {
  carte_grise: "cartes-grises",
  carte_blanche: "cartes-blanches",
  autre: "autres-documents",
};
const EXT_BY_MIME = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
// « AA-123-BB - CARTE GRISE.pdf » — nom reconstruit depuis la plaque plutôt
// que repris du fichier source, pour une archive homogène et triable.
function exportEntryName(row) {
  // Pas de repli « document » ici : une plaque absente doit rester vide pour
  // qu'on retombe sur le nom d'origine du fichier.
  const plate = String(row.immatriculation || "").replace(/[^\w -]/g, "").trim();
  const known = EXT_BY_MIME[row.mime];
  const fromName = /\.[a-z0-9]{2,5}$/i.exec(row.filename || "");
  const ext = known || (fromName ? fromName[0].toLowerCase() : ".bin");
  const label = EXPORT_LABELS[row.type] || "DOCUMENT";
  const base = plate ? `${plate} - ${label}` : safeFilename(row.filename).replace(/\.[^.]*$/, "");
  return `${base}${ext}`;
}

app.get("/api/documents/export", wrap(async (req, res) => {
  const raw = String(req.query.type || "carte_grise").trim();
  const type = raw === "all" ? null : parseDocType(raw);
  const { rows } = await pool.query(
    `SELECT d.id, d.type, d.filename, d.mime, d.created_at, v.immatriculation
       FROM vehicle_documents d
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
      ${type ? "WHERE d.type = $1" : ""}
      ORDER BY v.immatriculation NULLS LAST, d.type, d.created_at`,
    type ? [type] : []
  );
  if (!rows.length) {
    return res.status(404).json({ error: "Aucun document à exporter." });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const archive = type ? EXPORT_ARCHIVES[type] : "documents";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="flotte-${archive}-${stamp}.zip"`
  );

  const zip = new ZipWriter(res);
  for (const row of rows) {
    if (zip.aborted) return;   // client parti : on relâche la connexion DB
    // Une requête par pièce : le BYTEA n'est chargé qu'au moment de l'écrire.
    const { rows: [file] } = await pool.query(
      "SELECT data FROM vehicle_documents WHERE id=$1", [row.id]
    );
    if (!file || !file.data) continue;
    await zip.add(exportEntryName(row), file.data, row.created_at);
  }
  await zip.finish();
  res.end();
}));

// Contenu du document (aperçu / téléchargement)
app.get("/api/documents/:id/file", wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT filename, mime, data FROM vehicle_documents WHERE id=$1",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Document introuvable" });
  const doc = rows[0];
  res.setHeader("Content-Type", doc.mime || "application/octet-stream");
  res.setHeader("Content-Length", doc.data.length);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(doc.filename || "document")}`
  );
  res.send(doc.data);
}));

// Métadonnées seules (type, échéance, numéro, notes) — le fichier ne change pas
app.put("/api/documents/:id", wrap(async (req, res) => {
  const d = req.body || {};
  const { rows } = await pool.query(
    `UPDATE vehicle_documents SET
       type=$1, date_delivrance=$2, date_expiration=$3, numero=$4, notes=$5
     WHERE id=$6 RETURNING ${DOC_FIELDS}`,
    [
      parseDocType(d.type), parseIsoDate(d.date_delivrance), parseIsoDate(d.date_expiration),
      String(d.numero || "").slice(0, 60), String(d.notes || "").slice(0, 500),
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "Document introuvable" });
  res.json(rows[0]);
}));

app.delete("/api/documents/:id", wrap(async (req, res) => {
  await pool.query("DELETE FROM vehicle_documents WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ── Indicateurs / statistiques de la flotte ─────────────────
// Renvoie les données chiffrées des interventions ; le front
// les croise avec la liste des véhicules pour bâtir les KPI.
app.get("/api/stats", wrap(async (_req, res) => {
  // Une ligne par intervention, avec son coût total HT
  const { rows: interventions } = await pool.query(`
    SELECT i.id, i.vehicle_id, i.date, i.kms,
           COALESCE(SUM(it.quantite * it.prix_unitaire), 0)::float AS total
    FROM interventions i
    LEFT JOIN intervention_items it ON it.intervention_id = i.id
    GROUP BY i.id
  `);
  // Coût cumulé par type de pièce / travail
  const { rows: byType } = await pool.query(`
    SELECT COALESCE(NULLIF(type, ''), 'Autre') AS type,
           COALESCE(SUM(quantite * prix_unitaire), 0)::float AS total,
           COUNT(*)::int AS lignes
    FROM intervention_items
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  res.json({ interventions, byType });
}));

// ── Présence Pérols ─────────────────────────────────────────
// Chauffeurs de l'équipe
app.get("/api/presence/drivers", wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM presence_drivers ORDER BY position, id");
  res.json(rows);
}));

// Enregistrement en masse de l'équipe (création / renommage / suppression)
app.put("/api/presence/drivers", wrap(async (req, res) => {
  const drivers = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ALLOWED_CAT = new Set(["depanneur", "mecanicien", "chauffeur"]);
    const keep = [];
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      const cat = ALLOWED_CAT.has(d.categorie) ? d.categorie : "depanneur";
      if (d.id) {
        await client.query(
          "UPDATE presence_drivers SET nom=$1, position=$2, categorie=$3 WHERE id=$4",
          [d.nom || "", i + 1, cat, d.id]
        );
        keep.push(Number(d.id));
      } else {
        const { rows } = await client.query(
          "INSERT INTO presence_drivers (nom, position, categorie) VALUES ($1,$2,$3) RETURNING id",
          [d.nom || "", i + 1, cat]
        );
        keep.push(rows[0].id);
      }
    }
    if (keep.length) {
      await client.query("DELETE FROM presence_drivers WHERE id <> ALL($1::int[])", [keep]);
    } else {
      await client.query("DELETE FROM presence_drivers");
    }
    await client.query("COMMIT");
    const { rows } = await client.query("SELECT * FROM presence_drivers ORDER BY position, id");
    res.json(rows);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// Lecture d'une semaine
app.get("/api/presence/week/:weekStart", wrap(async (req, res) => {
  const ws = req.params.weekStart;
  const { rows: meta } = await pool.query(
    "SELECT responsable FROM presence_weeks WHERE week_start=$1", [ws]
  );
  const { rows: entries } = await pool.query(
    "SELECT * FROM presence_entries WHERE week_start=$1", [ws]
  );
  const map = {};
  for (const e of entries) {
    map[e.driver_id] = {
      lun: e.lun, mar: e.mar, mer: e.mer, jeu: e.jeu,
      ven: e.ven, sam: e.sam, dim: e.dim,
    };
  }
  res.json({ responsable: meta[0]?.responsable || "", entries: map });
}));

// Enregistrement d'une semaine
app.put("/api/presence/week/:weekStart", wrap(async (req, res) => {
  const ws = req.params.weekStart;
  const { responsable, entries } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO presence_weeks (week_start, responsable) VALUES ($1,$2)
       ON CONFLICT (week_start) DO UPDATE SET responsable=$2`,
      [ws, responsable || ""]
    );
    await client.query("DELETE FROM presence_entries WHERE week_start=$1", [ws]);
    for (const [driverId, c] of Object.entries(entries || {})) {
      await client.query(
        `INSERT INTO presence_entries
           (week_start, driver_id, lun, mar, mer, jeu, ven, sam, dim)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ws, Number(driverId), c.lun || "", c.mar || "", c.mer || "",
          c.jeu || "", c.ven || "", c.sam || "", c.dim || "",
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// ── Planning hebdomadaire ───────────────────────────────────
// Grille lundi→dimanche par employé (codes P / AS / RJ / R / CP / OPS).
app.get("/api/planning/week/:weekStart", wrap(async (req, res) => {
  const ws = req.params.weekStart;
  const { rows } = await pool.query(
    "SELECT * FROM planning_entries WHERE week_start=$1", [ws]
  );
  const map = {};
  for (const e of rows) {
    map[e.driver_id] = {
      lun: e.lun, mar: e.mar, mer: e.mer, jeu: e.jeu,
      ven: e.ven, sam: e.sam, dim: e.dim,
    };
  }
  const { rows: sp } = await pool.query(
    "SELECT lun, mar, mer, jeu, ven, sam, dim FROM planning_special WHERE week_start=$1", [ws]
  );
  const empty = { lun: "", mar: "", mer: "", jeu: "", ven: "", sam: "", dim: "" };
  res.json({ entries: map, special: sp[0] || empty });
}));

app.put("/api/planning/week/:weekStart", wrap(async (req, res) => {
  const ws = req.params.weekStart;
  const { entries, special } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM planning_entries WHERE week_start=$1", [ws]);
    for (const [driverId, c] of Object.entries(entries || {})) {
      await client.query(
        `INSERT INTO planning_entries
           (week_start, driver_id, lun, mar, mer, jeu, ven, sam, dim)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ws, Number(driverId), c.lun || "", c.mar || "", c.mer || "",
          c.jeu || "", c.ven || "", c.sam || "", c.dim || "",
        ]
      );
    }
    const s = special || {};
    await client.query(
      `INSERT INTO planning_special (week_start, lun, mar, mer, jeu, ven, sam, dim)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (week_start) DO UPDATE SET
         lun=$2, mar=$3, mer=$4, jeu=$5, ven=$6, sam=$7, dim=$8`,
      [ws, s.lun || "", s.mar || "", s.mer || "", s.jeu || "", s.ven || "", s.sam || "", s.dim || ""]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// Codes de présence sur une plage de dates (récap mensuel & suivi Frank).
// Étend les semaines (lun→dim) en dates réelles et renvoie
// { entries: { driverId: { 'YYYY-MM-DD': code } } } pour les dates de la
// plage. Mêmes conventions de date (locales) que le front (mondayOf/ymd).
app.get("/api/presence/range/:from/:to", wrap(async (req, res) => {
  const { from, to } = req.params;
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const mondayOf = (s) => {
    const d = parse(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return fmt(d);
  };
  const dayKeys = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
  const { rows } = await pool.query(
    "SELECT * FROM presence_entries WHERE week_start >= $1 AND week_start <= $2",
    [mondayOf(from), to]
  );
  const entries = {};
  for (const r of rows) {
    const base = parse(r.week_start);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = fmt(d);
      if (iso < from || iso > to) continue;
      const code = r[dayKeys[i]];
      if (!code) continue;
      (entries[r.driver_id] ||= {})[iso] = code;
    }
  }
  res.json({ entries });
}));

// ── Récapitulatif mensuel ───────────────────────────────────
// Réutilise presence_drivers comme base d'employés. Les codes de
// chaque jour sont stockés en JSON par employé et par mois.
app.get("/api/recap/:month", wrap(async (req, res) => {
  const month = req.params.month;
  const { rows: meta } = await pool.query(
    "SELECT responsable FROM recap_months WHERE month=$1", [month]
  );
  const { rows: entries } = await pool.query(
    "SELECT * FROM recap_entries WHERE month=$1", [month]
  );
  const map = {};
  for (const e of entries) {
    map[e.driver_id] = { days: e.days || {}, annotation: e.annotation || "" };
  }
  res.json({ responsable: meta[0]?.responsable || "", entries: map });
}));

app.put("/api/recap/:month", wrap(async (req, res) => {
  const month = req.params.month;
  const { responsable, entries } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO recap_months (month, responsable) VALUES ($1,$2)
       ON CONFLICT (month) DO UPDATE SET responsable=$2`,
      [month, responsable || ""]
    );
    await client.query("DELETE FROM recap_entries WHERE month=$1", [month]);
    for (const [driverId, e] of Object.entries(entries || {})) {
      await client.query(
        `INSERT INTO recap_entries (month, driver_id, days, annotation)
         VALUES ($1,$2,$3,$4)`,
        [month, Number(driverId), JSON.stringify(e?.days || {}), e?.annotation || ""]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// Adresses d'envoi prédéfinies (réglages globaux clé/valeur)
async function getSetting(key) {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key=$1", [key]);
  return rows[0]?.value || "";
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=$2`,
    [key, value]
  );
}

// Adresse d'envoi du récapitulatif mensuel
app.get("/api/recap-config", wrap(async (_req, res) => {
  res.json({ mailTo: await getSetting("recap_mail_to") });
}));
app.put("/api/recap-config", wrap(async (req, res) => {
  const mailTo = (req.body?.mailTo || "").trim();
  await setSetting("recap_mail_to", mailTo);
  res.json({ mailTo });
}));

// Adresse d'envoi du suivi Frank
app.get("/api/frank-config", wrap(async (_req, res) => {
  res.json({ mailTo: await getSetting("frank_mail_to") });
}));
app.put("/api/frank-config", wrap(async (req, res) => {
  const mailTo = (req.body?.mailTo || "").trim();
  await setSetting("frank_mail_to", mailTo);
  res.json({ mailTo });
}));

// ── Envoi d'un tableau par email (Resend) ───────────────────
app.post("/api/send-mail", wrap(async (req, res) => {
  const { subject, html, to: toOverride } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const compta = process.env.MAIL_TO || "compta@montpellierdepannage.com";
  // Destinataire : on n'accepte JAMAIS une adresse arbitraire fournie par le
  // client (le domaine d'envoi est vérifié — cela permettrait d'usurper
  // l'entreprise). Seules sont autorisées les adresses configurées côté
  // serveur : compta (env) + les réglages persistés Frank / récap.
  const override = String(toOverride || "").trim().toLowerCase();
  const allowed = new Set(
    [compta, await getSetting("frank_mail_to"), await getSetting("recap_mail_to")]
      .map((a) => String(a || "").trim().toLowerCase())
      .filter(Boolean)
  );
  let to;
  if (!override) {
    to = compta;
  } else if (allowed.has(override)) {
    to = override;
  } else {
    return res.status(403).json({
      error: "Adresse de destination non autorisée. Enregistrez-la d'abord dans les réglages.",
    });
  }
  // Garde-fou : un email de tableau reste petit ; on plafonne le HTML.
  if (String(html || "").length > 200_000) {
    return res.status(413).json({ error: "Contenu de l'email trop volumineux." });
  }
  if (!apiKey || !from) {
    return res.status(503).json({
      error: "Envoi d'email non configuré sur le serveur (RESEND_API_KEY / RESEND_FROM manquants).",
    });
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: subject || "Document — Flotte Montpellier Dépannage",
        html: html || "",
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Resend failed", r.status, detail);
      return res.status(502).json({ error: "Échec de l'envoi de l'email." });
    }
    res.json({ ok: true, to });
  } catch (err) {
    console.error("Resend exception", err);
    res.status(502).json({ error: "Échec de l'envoi de l'email." });
  }
}));

// ── Snapshot pilotage (lecture seule, secret partagé) ───────
// Consommé par le dashboard de pilotage du site web (Montpellier
// Dépannage). Pas de JWT : auth par header Authorization: Bearer
// PILOTAGE_SECRET. Si le secret n'est pas configuré, l'endpoint est
// désactivé (503). Renvoie les compteurs de contrôle technique de la
// flotte ; le calcul du % et du statut couleur est fait côté site web.
app.get("/api/pilotage-public/snapshot", wrap(async (req, res) => {
  const secret = process.env.PILOTAGE_SECRET;
  if (!secret) return res.status(503).json({ error: "Pilotage non configuré" });
  if ((req.headers.authorization || "") !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  // Date du jour en ISO (YYYY-MM-DD) — comparaison lexicale directe
  // avec vehicles.ct_date qui est stockée au même format.
  const today = new Date().toISOString().slice(0, 10);

  // Véhicules « suivis » = en exploitation : on écarte les statuts
  // hors-parc (stocké / cédé / hors service) qui ne passent pas le CT.
  const offFleet = "statut NOT IN ('Stocké','Hors service','En cession')";
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                                    AS vehicles_total,
       COUNT(*) FILTER (WHERE ${offFleet})::int                         AS fleet_considered,
       COUNT(*) FILTER (WHERE ${offFleet} AND ct_date <> '' AND ct_date >= $1)::int AS ct_planned,
       COUNT(*) FILTER (WHERE ${offFleet} AND ct_date <> '' AND ct_date <  $1)::int AS ct_overdue,
       COUNT(*) FILTER (WHERE ${offFleet} AND ct_date =  '')::int       AS ct_missing
     FROM vehicles`,
    [today]
  );

  res.json({ ts: Date.now(), ...rows[0] });
}));

// ── Gestion d'erreurs ───────────────────────────────────────
app.use((err, _req, res, _next) => {
  // Dépôt de document au-delà de la limite acceptée (body-parser)
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Fichier trop volumineux (20 Mo maximum)." });
  }
  console.error(err);
  // Réponse déjà entamée (export ZIP en flux, par ex.) : on ne peut plus
  // écrire d'en-têtes, on coupe la connexion pour que le client voie l'échec.
  if (res.headersSent) return res.destroy();
  res.status(500).json({ error: err.message || "Erreur serveur" });
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`API Flotte sur le port ${PORT}`)))
  .catch((err) => {
    console.error("Échec de l'initialisation de la base :", err);
    process.exit(1);
  });
