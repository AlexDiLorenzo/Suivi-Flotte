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
`InterventionModal`, `PresencePage`, `TeamModal`, `Modal`, `ConfirmDialog`,
`ToastHost`. No router, no state library. Navigation is a `view` state object
with three views: `dashboard`, `vehicle`, `presence` (the `TopBar` nav switches
between the fleet dashboard and the Pérols presence sheet).

- **`apiFetch()`** wraps `fetch`, injects the JWT, auto-logs-out on 401.
- **Auth:** token in `localStorage` (`flotte-token` / `flotte-user`).
  `LoginScreen` calls `/api/auth/check` → setup form (first run) or login.
- **Styling is inline.** Fonts: DM Sans (body), Space Mono (headings),
  JetBrains Mono (plates / numbers / money). A few `:hover` rules live in
  `index.css`.
- **Dashboard** = the Excel table: category section rows use the category color;
  columns are Marque / Modèle / Immatriculation / 1ère MEC + 12 months. The CT
  day shows as a green pill in its month column; the current month is highlighted.

### Backend (`api/`)

- **Express + pg** REST API on port 3000, `wrap()` funnels async errors.
- **JWT auth** — 30-day tokens, bcrypt hashing.
- **`initDB()`** (`api/db.js`) creates tables and, on an empty DB, seeds
  reference data from `api/seedData.js`.
- Tables: `users`, `categories`, `vehicles`, `interventions`,
  `intervention_items`, `presence_drivers`, `presence_weeks`,
  `presence_entries`. `vehicles.ct_month`/`ct_day` store the recurring annual
  CT planning (no year — it is a rolling annual schedule). Presence weeks are
  keyed by `week_start` (the Monday, `YYYY-MM-DD`).
- Endpoints:
  - `GET /api/auth/check`, `POST /api/auth/setup`, `POST /api/auth/login`
  - `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id`
  - `GET/POST /api/vehicles`, `GET/PUT/DELETE /api/vehicles/:id`
  - `GET /api/vehicles/:id/interventions`
  - `POST /api/interventions`, `PUT/DELETE /api/interventions/:id`
    (PUT/POST replace the full `intervention_items` set transactionally)
  - `GET/PUT /api/presence/drivers` (PUT = bulk replace of the team)
  - `GET/PUT /api/presence/week/:weekStart` (week grid + responsable)
  - `POST /api/send-mail` — emails an HTML table to `MAIL_TO`
    (default `compta@montpellierdepannage.com`) via Resend

### Print & email

Both tables (fleet dashboard, presence sheet) have a print button (`doPrint()`
sets `@page` orientation, then `window.print()`; `.no-print` / `.print-area` /
`.tablewrap` rules in `index.css`) and a "send to compta" button. The email HTML
is built client-side (`buildFleetEmailHtml` / `buildPresenceEmailHtml`) and
posted to `POST /api/send-mail`, which relays it through Resend. If
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
