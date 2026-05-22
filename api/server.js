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

// Modification de l'identifiant et/ou du mot de passe du compte connecté
app.put("/api/auth/credentials", auth, wrap(async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [req.user.username]);
  if (!rows.length) return res.status(404).json({ error: "Compte introuvable" });
  const ok = await bcrypt.compare(currentPassword || "", rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
  const username = (newUsername || rows[0].username).trim();
  if (!username) return res.status(400).json({ error: "Identifiant requis" });
  if (newPassword && newPassword.length < 4) {
    return res.status(400).json({ error: "Nouveau mot de passe : 4 caractères minimum" });
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

// ── Toutes les routes de données nécessitent l'authentification ──
app.use("/api/categories", auth);
app.use("/api/vehicles", auth);
app.use("/api/interventions", auth);
app.use("/api/presence", auth);
app.use("/api/recap", auth);
app.use("/api/recap-config", auth);
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

app.post("/api/vehicles", wrap(async (req, res) => {
  const v = req.body;
  if (!v.category_id) return res.status(400).json({ error: "Catégorie requise" });
  const { rows: pos } = await pool.query("SELECT COALESCE(MAX(position),0)+1 AS p FROM vehicles");
  const { rows } = await pool.query(
    `INSERT INTO vehicles
       (category_id, marque, modele, immatriculation, date_mec, numero_serie,
        ct_date, assurance_date, statut, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "", v.ct_date || "",
      v.assurance_date || "", v.statut || "", v.notes || "", pos[0].p,
    ]
  );
  res.json(rows[0]);
}));

app.put("/api/vehicles/:id", wrap(async (req, res) => {
  const v = req.body;
  const { rows } = await pool.query(
    `UPDATE vehicles SET
       category_id=$1, marque=$2, modele=$3, immatriculation=$4, date_mec=$5,
       numero_serie=$6, ct_date=$7, assurance_date=$8, statut=$9, notes=$10
     WHERE id=$11 RETURNING *`,
    [
      v.category_id, v.marque || "", v.modele || "", v.immatriculation || "",
      v.date_mec || "", v.numero_serie || "", v.ct_date || "",
      v.assurance_date || "", v.statut || "", v.notes || "", req.params.id,
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
    const keep = [];
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      if (d.id) {
        await client.query(
          "UPDATE presence_drivers SET nom=$1, position=$2 WHERE id=$3",
          [d.nom || "", i + 1, d.id]
        );
        keep.push(Number(d.id));
      } else {
        const { rows } = await client.query(
          "INSERT INTO presence_drivers (nom, position) VALUES ($1,$2) RETURNING id",
          [d.nom || "", i + 1]
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

// Adresse d'envoi prédéfinie du récapitulatif (réglage global)
app.get("/api/recap-config", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT value FROM app_settings WHERE key='recap_mail_to'"
  );
  res.json({ mailTo: rows[0]?.value || "" });
}));

app.put("/api/recap-config", wrap(async (req, res) => {
  const mailTo = (req.body?.mailTo || "").trim();
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('recap_mail_to', $1)
     ON CONFLICT (key) DO UPDATE SET value=$1`,
    [mailTo]
  );
  res.json({ mailTo });
}));

// ── Envoi d'un tableau par email (Resend) ───────────────────
app.post("/api/send-mail", wrap(async (req, res) => {
  const { subject, html, to: toOverride } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  // Adresse cible : celle fournie par le client (ex. récap mensuel) si
  // valide, sinon la valeur serveur (compta) par défaut.
  const override = String(toOverride || "").trim();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(override);
  const to = validEmail ? override : (process.env.MAIL_TO || "compta@montpellierdepannage.com");
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
  console.error(err);
  res.status(500).json({ error: err.message || "Erreur serveur" });
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`API Flotte sur le port ${PORT}`)))
  .catch((err) => {
    console.error("Échec de l'initialisation de la base :", err);
    process.exit(1);
  });
