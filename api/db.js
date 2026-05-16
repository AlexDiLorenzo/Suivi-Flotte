import pg from "pg";
import { categoriesSeed, vehiclesSeed, interventionsSeed } from "./seedData.js";

const pool = new pg.Pool({
  host: process.env.DB_HOST || "flotte-db",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "flotte",
  user: process.env.DB_USER || "flotte",
  password: process.env.DB_PASSWORD,
});

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#D3D1C7',
        position INT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        marque TEXT NOT NULL DEFAULT '',
        modele TEXT NOT NULL DEFAULT '',
        immatriculation TEXT NOT NULL DEFAULT '',
        date_mec TEXT NOT NULL DEFAULT '',
        numero_serie TEXT NOT NULL DEFAULT '',
        ct_month INT,
        ct_day INT,
        notes TEXT NOT NULL DEFAULT '',
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles (category_id);

      CREATE TABLE IF NOT EXISTS interventions (
        id SERIAL PRIMARY KEY,
        vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        date TEXT NOT NULL DEFAULT '',
        kms INT,
        mecaniciens TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_interventions_vehicle ON interventions (vehicle_id);

      CREATE TABLE IF NOT EXISTS intervention_items (
        id SERIAL PRIMARY KEY,
        intervention_id INT NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT '',
        designation TEXT NOT NULL DEFAULT '',
        fournisseur TEXT NOT NULL DEFAULT '',
        quantite NUMERIC NOT NULL DEFAULT 1,
        prix_unitaire NUMERIC NOT NULL DEFAULT 0,
        position INT NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_items_intervention ON intervention_items (intervention_id);

      CREATE TABLE IF NOT EXISTS presence_drivers (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL DEFAULT '',
        position INT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS presence_weeks (
        week_start TEXT PRIMARY KEY,
        responsable TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS presence_entries (
        week_start TEXT NOT NULL,
        driver_id INT NOT NULL REFERENCES presence_drivers(id) ON DELETE CASCADE,
        lun TEXT NOT NULL DEFAULT '',
        mar TEXT NOT NULL DEFAULT '',
        mer TEXT NOT NULL DEFAULT '',
        jeu TEXT NOT NULL DEFAULT '',
        ven TEXT NOT NULL DEFAULT '',
        sam TEXT NOT NULL DEFAULT '',
        dim TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (week_start, driver_id)
      );
    `);

    // ── Seed reference data on first run ──────────────────────
    const { rowCount } = await client.query("SELECT 1 FROM categories LIMIT 1");
    if (rowCount === 0) {
      await client.query("BEGIN");
      try {
        for (const c of categoriesSeed) {
          await client.query(
            "INSERT INTO categories (id, name, color, position) VALUES ($1,$2,$3,$4)",
            [c.id, c.name, c.color, c.position]
          );
        }

        const idByImmat = {};
        for (const v of vehiclesSeed) {
          const { rows } = await client.query(
            `INSERT INTO vehicles
               (category_id, marque, modele, immatriculation, date_mec, ct_month, ct_day, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [v.catId, v.marque, v.modele, v.immatriculation, v.dateMec, v.ctMonth, v.ctDay, v.position]
          );
          if (v.immatriculation) idByImmat[v.immatriculation] = rows[0].id;
        }

        // Numéro de série connu pour le véhicule de référence
        await client.query(
          "UPDATE vehicles SET numero_serie=$1 WHERE immatriculation='AM-026-AW'",
          ["VF624APD000002243"]
        );

        // Historique d'interventions complet pour AM-026-AW
        const refId = idByImmat["AM-026-AW"];
        if (refId) {
          for (const it of interventionsSeed) {
            const { rows } = await client.query(
              `INSERT INTO interventions (vehicle_id, date, kms, mecaniciens)
               VALUES ($1,$2,$3,$4) RETURNING id`,
              [refId, it.date, it.kms, it.mecaniciens]
            );
            const ivId = rows[0].id;
            let pos = 0;
            for (const item of it.items) {
              await client.query(
                `INSERT INTO intervention_items
                   (intervention_id, type, designation, fournisseur, quantite, prix_unitaire, position)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [ivId, item.type, item.designation, item.fournisseur, item.quantite, item.prixUnitaire, ++pos]
              );
            }
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    // ── Équipe Pérols par défaut (indépendant : fonctionne aussi
    //    sur une base déjà créée avant l'ajout de la page Présence) ──
    const { rowCount: driverRows } = await client.query("SELECT 1 FROM presence_drivers LIMIT 1");
    if (driverRows === 0) {
      const team = [
        "BARAILLE", "CHIVAZ", "CADET", "CAMMAL", "FLACHERAR", "DUPONT",
        "LARBI", "LAVENAIRE", "MACHURAT", "PEREZ", "RODRIGUEZ", "VIVIERS",
      ];
      for (let i = 0; i < team.length; i++) {
        await client.query(
          "INSERT INTO presence_drivers (nom, position) VALUES ($1,$2)",
          [team[i], i + 1]
        );
      }
    }

    console.log("Database initialized");
  } finally {
    client.release();
  }
}

export default pool;
