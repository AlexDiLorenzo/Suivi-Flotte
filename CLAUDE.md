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
`InterventionModal`, `StatsPage`, `PresencePage`, `PlanningPage`, `MonthlyRecap`,
`FrankPage`, `TeamModal`, `Modal`, `ConfirmDialog`, `ToastHost`. No router, no
state library. Navigation is a `view` state object with seven views: `dashboard`,
`vehicle`, `stats`, `presence`, `planning`, `recap`, `frank` (the `TopBar` nav
switches between the fleet dashboard, the indicators page, the Pérols presence
sheet, the weekly planning, the monthly recap and the Frank on-call summary).

- **PlanningPage** = the **Planning** tab: a weekly Mon→Sun grid (same
  `presence_drivers` rows) built for wall display / printing. **Independent,
  editable** data (not derived from presence). Per-driver status options
  `PLANNING_OPTIONS` — `P` Présent / `AS` Astreinte / `RJ` Repos jour / `R` Repos
  / `CP` Congés / `F` Férié. A dedicated **"Opération spéciale" row** sits as the
  **last row** of the table: a **free-text** input per day (smaller font for long
  labels), highlighted in flashy pink (`SPECIAL_BG` `#FF3DA5`) when filled — stored
  in its own `planning_special` table (1 row/week, `lun…dim`), not a per-driver code.
  The **11 French public holidays** are **pre-filled** automatically: a holiday
  day with an empty cell is shown/exported as `F` via `effectivePlanningCode`
  (a display default like the weekend `WE`, not persisted — selecting another
  code overrides it). Holidays are computed by `frenchHolidays(year)`
  (`easterSunday` Meeus/Gauss + the 8 fixed dates), cached per year; the header
  shows a "Férié" label on those columns. (There is **no** manual Férié toggle
  button anymore.) Same weekly `mondayOf`/auto-save
  (700 ms, `skipSave`) pattern as `PresencePage`; `GET/PUT
  /api/planning/week/:weekStart` carries both `entries` (driver grid) and
  `special` (the ops row). Single action: **Télécharger PDF**
  (`generatePlanningPdf`, landscape, special row last with a smaller font). It
  **always fits on one page**: the PDF sizes rows/font dynamically to the page
  height (`pageBreak:'avoid'`). (`@media print .planning-area` still compacts the
  table if printed directly from the browser.)

**Single source of truth = the weekly presence sheet.** The team chief only fills
**Présence Pérols** (week by week); MonthlyRecap and FrankPage are **read-only,
derived** from it. Weekend cells (Sat/Sun) default to the `WE` code
(`effectiveCode` / `WEEKEND_DEFAULT`): an empty weekend cell is treated as `WE`
everywhere without being persisted — pick `AS` (or any code) to override.
`PresencePage` shows that default in its `<select>`.

- **MonthlyRecap** = the monthly recap tab (`récapitulatif mensuel`). Rows = the
  `presence_drivers` team. The period runs **from the 25th of the previous month
  to the 25th of the displayed month** (`recapPeriod`), straddling two months.
  It **reconstructs each day's code from the presence weeks** via
  `GET /api/presence/range/:from/:to` (which expands stored weeks into a
  `{driverId: {'YYYY-MM-DD': code}}` map) — the day cells are **read-only** and use
  the **Présence Pérols codes** (`PRESENCE_CODES`, incl. `WE`), not a separate
  code set. The **only editable field is the per-driver `Annotation`** (+ the
  responsable), persisted in `recap_entries.annotation` (auto-save, 700 ms debounce;
  `recap_entries.days` is no longer written). monthKey (`AAAA-MM`) is the **end**
  month. Not emailed — only **Télécharger PDF** (`generateRecapPdf`, landscape).
  **Team editing lives only in Présence Pérols** (shared `TeamModal`).

- **FrankPage** = the **Suivi Frank** tab (`recap_astreintes_mars_2026.csv`), a
  read-only **derived** view over the same 25→25 period. It reads the presence
  range + the recap annotations, then aggregates each driver's coded days into
  date ranges (`buildFrankRows` + `summarizeRuns`: consecutive → "du JJ/MM au
  JJ/MM", isolated → "le JJ/MM"). Code→column mapping is **token-based**
  (`frankColumnsForCode`, split on `/`): a token `AS`→astreintes, `RJ`→repos
  journalier, `R`→repos, `CP`→congés — so a combined code like `AS/CP` lands in
  **both** columns. The recap `Annotation` becomes *Informations supplémentaires*.
  **This is the table meant to be sent**: **Envoyer à Frank**
  (`buildFrankEmailHtml` → `POST /api/send-mail` with explicit `to`) + one-click
  PDF (`generateFrankPdf`, portrait). Frank's address is its own persisted setting
  (`app_settings.frank_mail_to`).

- **StatsPage** = the read-only indicators tab. It fetches `GET /api/stats`
  (per-intervention cost rows + cost-by-part-type) and crosses it with the
  already-loaded `categories`/`vehicles`. Sections: a red alert banner for
  vehicles with no CT date, a KPI band, a **Qualité des données** completeness
  panel, a CT due-date panel, a per-category vehicle breakdown, a
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
- **PresencePage** = the Pérols weekly presence sheet — the **single data-entry
  surface** the team chief fills (recap + Frank derive from it). A week is
  identified by its Monday (`mondayOf` / `ymd`); the grid is `{driverId:
  {lun…dim}}`. Codes are `PRESENCE_CODES` (`P`, `AS`, `RJ`, `R`, `CP`, …, plus
  `WE` = week-end). **Weekend cells default to `WE`** via `effectiveCode` (an
  empty Sat/Sun is shown and treated as `WE` without being persisted; override
  with `AS` etc.). It **auto-saves** (debounced 700 ms) — a `skipSave` ref blocks
  saves during the initial load and on week switches. The autosave payload is
  rebuilt from the current `drivers` list, so entries for deleted drivers never
  reach the API.

### Backend (`api/`)

- **Express + pg** REST API on port 3000, `wrap()` funnels async errors.
- **JWT auth** — 30-day tokens, bcrypt hashing. `JWT_SECRET` is **mandatory**:
  the server refuses to boot (`process.exit(1)`) if it is missing or under 32
  chars (no insecure default). Passwords are **12 chars minimum** (setup,
  login, credentials). The auth routes (`/auth/login`, `/auth/setup`,
  `/auth/credentials`) are protected by an **in-memory per-IP rate limiter**
  (`loginRateLimit`, 15 attempts / 15 min, 429 on excess); `app.set('trust
  proxy', true)` + nginx `X-Forwarded-For` give the real client IP.
- **`initDB()`** (`api/db.js`) creates tables (idempotent `CREATE TABLE IF NOT
  EXISTS`) and, on an empty DB, seeds the fleet from `api/seedData.js`. The
  default Pérols team is seeded by a **separate, independent block** gated on an
  empty `presence_drivers` table — so it also populates a DB created before the
  Presence page existed.
- Tables: `users`, `categories`, `vehicles`, `interventions`,
  `intervention_items`, `presence_drivers`, `presence_weeks`,
  `presence_entries`, `planning_entries` (weekly Mon→Sun planning, keyed by
  `week_start` + `driver_id`), `planning_special` (the planning's special-ops row,
  1 per `week_start`), `recap_months`, `recap_entries` (per-driver `days`
  JSONB + `annotation`, keyed by `month` + `driver_id`), `app_settings` (key/value).
  `vehicles.ct_date` (`YYYY-MM-DD`) stores the next
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
  - `GET/PUT /api/planning/week/:weekStart` — weekly planning grid (Mon→Sun,
    `planning_entries`, no responsable), independent of presence
  - `GET /api/presence/range/:from/:to` — expands the presence weeks overlapping
    the date range into `{ entries: { driverId: { 'YYYY-MM-DD': code } } }`
    (local-date arithmetic mirroring the front's `mondayOf`/`ymd`). Powers the
    derived MonthlyRecap and FrankPage views
  - `GET/PUT /api/recap/:month` — monthly recap (`AAAA-MM` = period end month):
    responsable + per-driver annotation. `recap_entries.days` is kept in the schema
    but no longer written (the day codes are derived from presence)
  - `GET/PUT /api/recap-config` — persisted recap destination email
    (`app_settings.recap_mail_to`). **Currently unused by the frontend** (the
    recap tab no longer emails); kept in case sending is re-added
  - `GET/PUT /api/frank-config` — persisted Frank destination email
    (`app_settings.frank_mail_to`). Both configs share `getSetting`/`setSetting`
  - `POST /api/send-mail` — emails an HTML table via Resend. The recipient is
    **never** a free-form client address (the Resend domain is verified —
    that would allow spoofing the company). The client `to` is accepted **only
    if it matches a server-side allowlist**: `MAIL_TO` (default
    `compta@montpellierdepannage.com`) + the persisted `frank_mail_to` /
    `recap_mail_to` settings; otherwise 403. Empty `to` → `MAIL_TO`. The Frank
    tab therefore **PUTs `/frank-config` right before sending** so the address
    is allowlisted. HTML is capped at 200 kB.

### Print & email

Both tables (fleet dashboard, presence sheet) have a print button (`doPrint()`
sets `@page` orientation, then `window.print()`; `.no-print` / `.print-area` /
`.tablewrap` rules in `index.css`). The **presence sheet** has a "send to
compta" button — the email HTML is built client-side (`buildPresenceEmailHtml`)
and posted to `POST /api/send-mail`, which relays it through Resend. If
`RESEND_API_KEY` / `RESEND_FROM` are unset the endpoint returns 503 and printing
still works.

The **monthly recap** and **Suivi Frank** tabs do not use `window.print()`: each
generates a real PDF client-side in one click (`generateRecapPdf` landscape /
`generateFrankPdf` portrait, `jspdf` + `jspdf-autotable`). Only **Suivi Frank** is
emailed (`buildFrankEmailHtml` → `POST /api/send-mail` with an explicit `to`, the
persisted `app_settings.frank_mail_to`); the monthly recap is download-only. The
**Planning** tab offers both `doPrint('landscape')` and a one-click PDF
(`generatePlanningPdf`, landscape, optimised for wall display); it is not emailed.

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
