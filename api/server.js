import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool, { initDB } from "./db.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

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

app.post("/api/auth/setup", wrap(async (req, res) => {
  const { rowCount } = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (rowCount > 0) return res.status(403).json({ error: "Compte déjà configuré" });
  const { username, password } = req.body;
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: "Identifiant et mot de passe (min. 4 caractères) requis" });
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (username, password_hash) VALUES ($1,$2)", [username, hash]);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  if (!rows.length) return res.status(401).json({ error: "Identifiants invalides" });
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Identifiants invalides" });
  const token = jwt.sign({ id: rows[0].id, username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username });
}));

// ── Toutes les routes de données nécessitent l'authentification ──
app.use("/api/categories", auth);
app.use("/api/vehicles", auth);
app.use("/api/interventions", auth);

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

app.post("/api/vehicles", wrap(async (req, res) => {
  const v = req.body;
  if (!v.category_id) return res.status(400).json({ error: "Catégorie requise" });
  const { rows: pos } = await pool.query("SELECT COALESCE(MAX(position),0)+1 AS p FROM vehicles");
  const { rows } = await pool.query(
    `INSERT INTO vehicles
       (category_id, marque, modele, immatriculation, date_mec, numero_serie, ct_month, ct_day, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "",
      v.ct_month || null, v.ct_day || null, v.notes || "", pos[0].p,
    ]
  );
  res.json(rows[0]);
}));

app.put("/api/vehicles/:id", wrap(async (req, res) => {
  const v = req.body;
  const { rows } = await pool.query(
    `UPDATE vehicles SET
       category_id=$1, marque=$2, modele=$3, immatriculation=$4, date_mec=$5,
       numero_serie=$6, ct_month=$7, ct_day=$8, notes=$9
     WHERE id=$10 RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "",
      v.ct_month || null, v.ct_day || null, v.notes || "", req.params.id,
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

// ── Gestion d'erreurs ───────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Erreur serveur" });
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`API Flotte sur le port ${PORT}`)))
  .catch((err) => {
    console.error("Échec de l'initialisation de la base :", err);
    process.exit(1);
  });
