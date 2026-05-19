# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

**Flotte** is a French-language fleet-tracking app for Montpellier Dépannage. It
reproduces the `Planning_CT_Flotte.xlsx` dashboard (colored vehicle categories,
12-month technical-inspection planning) and, per vehicle, stores a full
maintenance-intervention history modelled on `AM-026-AW PREMIUM PORTE VOITURES.xls`.
Multi-user with JWT authentication and PostgreSQL persistence. Same stack as the
sister project DepanTime.

## Commands

```bash
# Frontend dev
npm install
npm run dev          # Vite dev server at localhost:5173 (proxies /api → :3000)
npm run build        # Production build → dist/

# API dev
cd api && npm install && node --watch server.js   # needs a reachable PostgreSQL

# Production (VPS)
cd /srv/flotte && sudo git pull && sudo docker compose up -d --build
```

No test runner or linter is configured.

## Architecture

### Frontend — single-file React app (`src/App.jsx`)

All logic and components are inline in `App.jsx`: `LoginScreen`, `FlotteApp`,
`TopBar`, `Dashboard`, `VehicleModal`, `CategoryModal`, `VehicleDetail`,
`InterventionModal`, `StatsPage`, `PresencePage`, `TeamModal`, `Modal`,
`ConfirmDialog`, `ToastHost`. No router, no state library. Navigation is a
`view` state object with four views: `dashboard`, `vehicle`, `stats`,
`presence` (the `TopBar` nav switches between the fleet dashboard, the
indicators page and the Pérols presence sheet).

- **StatsPage** = the read-only indicators tab. It fetches `GET /api/stats`
  (per-intervention cost rows + cost-by-part-type) and crosses it with the
  already-loaded `categories`/`vehicles`. Sections: a red alert banner for
  vehicles with no CT date, a KPI band, a **Qualité des données** completeness
  panel, CT & insurance due-date panels, a per-category vehicle breakdown, a
  per-category **age pyramid** (`AgeStack`, buckets `<5/5-10/10-15/+15`). The
  maintenance-cost and workshop-activity sections only render once
  `MIN_TRACKED` vehicles have an intervention history — otherwise a "Modules en
  cours de déploiement" placeholder is shown (`dataReady` flag). CSS-only
  charts (`HBar` / `MonthBars` / `AgeStack`), no chart library.

- **`apiFetch()`** wraps `fetch`, injects the JWT, auto-logs-out on 401.
- **Auth:** token in `localStorage` (`flotte-token` / `flotte-user`).
  `LoginScreen` calls `/api/auth/check` → setup form (first run) or login.
- **Styling is inline.** Fonts: DM Sans (body), Space Mono (headings),
  JetBrains Mono (plates / numbers / money). A few `:hover` rules live in
  `index.css`.
- **Dashboard** = the fleet list: category section rows use the category color;
  columns are Marque / Modèle / Immatriculation / 1ère MEC / Prochain CT. The CT
  cell (`CtCell`) shows the next inspection date + a coloured `J-xx` countdown
  pill (`ctTone`: red ≤30 j or overdue, orange ≤90 j, green beyond). Rows are
  sorted within each category by CT date (`ctSort`, soonest first).
- **PresencePage** = the Pérols weekly presence sheet. A week is identified by
  its Monday (`mondayOf` / `ymd`); the grid is `{driverId: {lun…dim}}`. It
  **auto-saves** (debounced 700 ms) — a `skipSave` ref blocks saves during the
  initial load and on week switches. The autosave payload is rebuilt from the
  current `drivers` list, so entries for deleted drivers never reach the API.

### Backend (`api/`)

- **Express + pg** REST API on port 3000, `wrap()` funnels async errors.
- **JWT auth** — 30-day tokens, bcrypt hashing.
- **`initDB()`** (`api/db.js`) creates tables (idempotent `CREATE TABLE IF NOT
  EXISTS`) and, on an empty DB, seeds the fleet from `api/seedData.js`. The
  default Pérols team is seeded by a **separate, independent block** gated on an
  empty `presence_drivers` table — so it also populates a DB created before the
  Presence page existed.
- Tables: `users`, `categories`, `vehicles`, `interventions`,
  `intervention_items`, `presence_drivers`, `presence_weeks`,
  `presence_entries`. `vehicles.ct_date` (`YYYY-MM-DD`) stores the next
  technical-inspection date — the CT cycle is **biennial**. `assurance_date`
  (`YYYY-MM-DD`) is the insurance-renewal due date; `statut` is the operating
  status (`Actif` / `Stocké` / `En cession` / `Hors service`, empty = unset).
  The legacy `ct_month`/`ct_day` columns are kept but unused; `initDB()` adds
  `ct_date` / `assurance_date` / `statut`
  via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and back-fills it from the old
  month/day on first run (`nextCtIso`). Presence weeks are keyed by
  `week_start` (the Monday, `YYYY-MM-DD`).
- Endpoints:
  - `GET /api/auth/check`, `POST /api/auth/setup`, `POST /api/auth/login`
  - `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id`
  - `GET/POST /api/vehicles`, `GET/PUT/DELETE /api/vehicles/:id`
  - `GET /api/vehicles/:id/interventions`
  - `POST /api/interventions`, `PUT/DELETE /api/interventions/:id`
    (PUT/POST replace the full `intervention_items` set transactionally)
  - `GET /api/stats` — fleet-wide aggregates for the indicators page
    (per-intervention cost rows + cost by part type)
  - `GET /api/pilotage-public/snapshot` — **no JWT**, auth by
    `Authorization: Bearer PILOTAGE_SECRET`. Read-only CT counters
    (`fleet_considered` / `ct_planned` / `ct_overdue` / `ct_missing`)
    consumed by the Montpellier Dépannage pilotage dashboard. Disabled
    (503) if `PILOTAGE_SECRET` is unset.
  - `GET/PUT /api/presence/drivers` (PUT = bulk replace of the team)
  - `GET/PUT /api/presence/week/:weekStart` (week grid + responsable)
  - `POST /api/send-mail` — emails an HTML table to `MAIL_TO`
    (default `compta@montpellierdepannage.com`) via Resend

### Print & email

Both tables (fleet dashboard, presence sheet) have a print button (`doPrint()`
sets `@page` orientation, then `window.print()`; `.no-print` / `.print-area` /
`.tablewrap` rules in `index.css`). Only the **presence sheet** has a "send to
compta" button — the email HTML is built client-side (`buildPresenceEmailHtml`)
and posted to `POST /api/send-mail`, which relays it through Resend. If
`RESEND_API_KEY` / `RESEND_FROM` are unset the endpoint returns 503 and printing
still works.

### `api/seedData.js`

**Auto-generated** from the two Excel reference files (≈121 vehicles in 10
categories + the complete intervention history of `AM-026-AW`). Regenerate it by
re-parsing the Excel files; do not hand-edit unless the source files change.

## Docker & Infrastructure

3 containers: `flotte-front` (nginx SPA + `/api/` proxy), `flotte-api` (Node 20),
`flotte-db` (Postgres 15, data at `/srv/flotte/postgres`). Traefik labels on
`flotte-front` expose `flotte.alex-worksmart.com` with auto TLS. Secrets via
`.env` on the VPS: `FL_DB_PASSWORD`, `FL_JWT_SECRET`, and (for email)
`FL_RESEND_API_KEY`, `FL_RESEND_FROM`, `FL_MAIL_TO`.

## Color scheme (Montpellier Dépannage Design System)

Primary forest green `#2C6126`, accent yellow `#E4E13C` (background only),
warm-stone neutrals (`#1A190F`, `#FAFAF7`, `#D3D1C7`). Status: red `#A32D2D`,
blue `#185FA5`. The 10 category colors are the exact pastel fills extracted from
`Planning_CT_Flotte.xlsx`.
