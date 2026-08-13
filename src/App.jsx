import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/* ════════════════════════════════════════════════════════════
   Constantes & thème — Design System Montpellier Dépannage
   ════════════════════════════════════════════════════════════ */
const C = {
  green: '#2C6126',
  greenDark: '#1F451B',
  yellow: '#E4E13C',
  black: '#1A190F',
  bg: '#FAFAF7',
  panel: '#FFFFFF',
  border: '#D3D1C7',
  borderSoft: '#E7E6DE',
  ink: '#1A190F',
  ink60: '#74726544',
  muted: '#6B6A5E',
  red: '#A32D2D',
  blue: '#185FA5',
  rowHover: '#F1F0EA',
}

const FONT_HEAD = "'Space Mono', monospace"
const FONT_MONO = "'JetBrains Mono', monospace"

const MONTHS_SHORT = ['JAN', 'FÉV', 'MARS', 'AVR', 'MAI', 'JUIN',
  'JUIL', 'AOÛT', 'SEP', 'OCT', 'NOV', 'DÉC']

const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

// Lettre du jour de semaine, indexée par Date.getDay() (0 = dimanche)
const WEEKDAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

const ITEM_TYPES = ['Filtre à air', 'Filtre à huile', 'Filtre à gasoil',
  'Freins AV', 'Freins AR', 'Passage aux mines', 'Vidange', 'Pneumatiques', 'Autre']

const VEHICLE_STATUTS = ['Actif', 'Stocké', 'En cession', 'Hors service']

// Genre du véhicule (carte grise, rubrique J.1) — seul le code est stocké
const VEHICLE_USAGES = [
  { code: 'VASP', label: 'VASP — véhicule automoteur spécialisé' },
  { code: 'TCP', label: 'TCP — transport en commun de personnes' },
]

/* Documents administratifs rattachés à un véhicule.
   `expiry` : le document porte une date de fin de validité à surveiller. */
const DOC_TYPES = [
  {
    code: 'carte_grise', label: 'Carte grise', short: 'CG', color: '#B7D7E8',
    hint: "Certificat d'immatriculation", expiry: false,
  },
  {
    code: 'carte_blanche', label: 'Carte blanche', short: 'CB', color: '#F2D2A9',
    hint: 'Autorisation de mise en service de la dépanneuse', expiry: true,
  },
  {
    code: 'autre', label: 'Autre document', short: 'DOC', color: '#E7E6DE',
    hint: 'Attestation, procès-verbal, courrier…', expiry: false,
  },
]
const DOC_TYPE = Object.fromEntries(DOC_TYPES.map((t) => [t.code, t]))
const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const DOC_MAX_BYTES = 20 * 1024 * 1024

const CATEGORY_PALETTE = ['#F4C7D9', '#F2EAB6', '#C9B8DC', '#F2D2A9', '#B7D7E8',
  '#C6E0B4', '#E8E4A0', '#F9E79F', '#BFE6C4', '#AEC8E8']

const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_YEAR = new Date().getFullYear()

// Présence Pérols
const DAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const DAY_KEYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']
const PRESENCE_CODES = [
  { code: 'P', meaning: 'Présent', bg: '#C6E0B4' },
  { code: 'P/AS', meaning: 'Présent + astreinte', bg: '#94CC7E' },
  { code: 'AS', meaning: 'Astreinte', bg: '#B7D7E8' },
  { code: 'AS/RJ', meaning: 'Astreinte + repos journalier', bg: '#AEC8E8' },
  { code: 'AS/CP', meaning: 'Astreinte + congé payé', bg: '#C9B8DC' },
  { code: 'RJ', meaning: 'Repos journalier', bg: '#ECEBE3' },
  { code: 'R', meaning: 'Repos', bg: '#D3D1C7' },
  { code: 'CP', meaning: 'Congé payé', bg: '#F9E79F' },
  { code: 'AM', meaning: 'Arrêt maladie', bg: '#F4C7D9' },
  { code: 'AT', meaning: 'Accident de travail', bg: '#E59A9A' },
  { code: 'Férié', meaning: 'Jour férié', bg: '#F2D2A9' },
  { code: 'WE', meaning: 'Week-end', bg: '#DCDAD0' },
]
const CODE_BG = Object.fromEntries(PRESENCE_CODES.map((c) => [c.code, c.bg]))
const MAIL_TO = 'compta@montpellierdepannage.com'

// Planning hebdomadaire — statut par dépanneur et par jour
const PLANNING_OPTIONS = [
  { code: 'P', label: 'Présent', bg: '#C6E0B4' },
  { code: 'AS', label: 'Astreinte', bg: '#B7D7E8' },
  { code: 'RJ', label: 'Repos jour', bg: '#ECEBE3' },
  { code: 'R', label: 'Repos', bg: '#D3D1C7' },
  { code: 'CP', label: 'Congés', bg: '#F9E79F' },
  { code: 'F', label: 'Férié', bg: '#F2D2A9' },
]
const PLANNING_BG = Object.fromEntries(PLANNING_OPTIONS.map((o) => [o.code, o.bg]))
const PLANNING_LABEL = Object.fromEntries(PLANNING_OPTIONS.map((o) => [o.code, o.label]))
// Ligne « Opération spéciale » (texte libre par jour) — couleur flashy
const SPECIAL_BG = '#FF3DA5'

// Week-end pré-rempli par défaut ; un week-end vide est considéré comme « WE »
const WEEKEND_DEFAULT = 'WE'
const isWeekendDate = (dt) => dt.getDay() === 0 || dt.getDay() === 6
const effectiveCode = (dt, raw) => raw || (isWeekendDate(dt) ? WEEKEND_DEFAULT : '')

// Catégories d'employés — pilote l'affichage par section et le filtre Planning
const CATEGORIES = [
  { key: 'depanneur',  label: 'Dépanneur',  plural: 'Dépanneurs' },
  { key: 'mecanicien', label: 'Mécanicien', plural: 'Mécaniciens' },
  { key: 'chauffeur',  label: 'Chauffeur',  plural: 'Chauffeurs' },
]
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key)
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.plural]))
const normCategory = (c) => (CATEGORY_KEYS.includes(c) ? c : 'depanneur')
// Regroupe une liste de drivers par catégorie en respectant l'ordre CATEGORIES
function groupByCategory(drivers) {
  return CATEGORIES.map((cat) => ({
    ...cat,
    drivers: drivers.filter((d) => normCategory(d.categorie) === cat.key),
  })).filter((g) => g.drivers.length > 0)
}

/* ════════════════════════════════════════════════════════════
   API
   ════════════════════════════════════════════════════════════ */
const API = import.meta.env.VITE_API_URL || '/api'
let handleUnauthorized = () => {}

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('flotte-token')
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...opts.headers,
    },
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Session expirée, reconnectez-vous.')
  }
  if (!res.ok) {
    let msg = 'Erreur serveur'
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

/* Erreur d'une réponse non-JSON ou d'un corps binaire */
async function apiError(res) {
  if (res.status === 401) {
    handleUnauthorized()
    return new Error('Session expirée, reconnectez-vous.')
  }
  let msg = 'Erreur serveur'
  try { msg = (await res.json()).error || msg } catch { /* ignore */ }
  return new Error(msg)
}

/* Dépôt d'un document : le fichier part en corps brut, les métadonnées
   en paramètres d'URL (l'API n'a pas besoin d'un parseur multipart). */
async function apiUpload(path, file, params = {}) {
  const token = localStorage.getItem('flotte-token')
  const qs = new URLSearchParams({ filename: file.name || 'document', ...params })
  const res = await fetch(`${API}${path}?${qs}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: file,
  })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

/* Contenu d'un document — récupéré en blob pour rester authentifié */
async function fetchDocBlob(id) {
  const token = localStorage.getItem('flotte-token')
  const res = await fetch(`${API}/documents/${id}/file`, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (!res.ok) throw await apiError(res)
  return res.blob()
}

/* ════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════ */
function formatDate(s) {
  if (!s) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}
function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' €'
}
function fmtKm(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('fr-FR') + ' km'
}
// PTAC stocké en kg — « 3 500 kg », ou « 3 500 kg (3,5 t) » en version longue
function fmtPtac(n, long = false) {
  if (n === null || n === undefined || n === '') return '—'
  const kg = Number(n)
  if (!Number.isFinite(kg) || kg <= 0) return '—'
  const base = `${kg.toLocaleString('fr-FR')} kg`
  if (!long) return base
  const t = (kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  return `${base} (${t} t)`
}
function itemTotal(it) {
  return (Number(it.quantite) || 0) * (Number(it.prix_unitaire) || 0)
}
function interventionTotal(iv) {
  return (iv.items || []).reduce((s, it) => s + itemTotal(it), 0)
}

/* Dates — semaine du lundi */
function mondayOf(d) {
  const x = new Date(d)
  const shift = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - shift)
  x.setHours(12, 0, 0, 0)
  return x
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
function ddmm(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(x.getUTCFullYear(), 0, 4))
  const ftDay = (firstThu.getUTCDay() + 6) % 7
  firstThu.setUTCDate(firstThu.getUTCDate() - ftDay + 3)
  return 1 + Math.round((x - firstThu) / (7 * 864e5))
}

/* Jours fériés français (11 par an). Pâques via l'algorithme de Meeus/Gauss ;
   les fêtes mobiles (lundi de Pâques, Ascension, lundi de Pentecôte) en
   découlent. Mémoïsé par année. */
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day, 12)
}
const _holidayCache = {}
function frenchHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year]
  const easter = easterSunday(year)
  const set = new Set([
    `${year}-01-01`,          // Jour de l'An
    `${year}-05-01`,          // Fête du Travail
    `${year}-05-08`,          // Victoire 1945
    `${year}-07-14`,          // Fête nationale
    `${year}-08-15`,          // Assomption
    `${year}-11-01`,          // Toussaint
    `${year}-11-11`,          // Armistice 1918
    `${year}-12-25`,          // Noël
    ymd(addDays(easter, 1)),  // Lundi de Pâques
    ymd(addDays(easter, 39)), // Ascension
    ymd(addDays(easter, 50)), // Lundi de Pentecôte
  ])
  _holidayCache[year] = set
  return set
}
const isFrenchHoliday = (dt) => frenchHolidays(dt.getFullYear()).has(ymd(dt))
// Code planning effectif : un jour férié vide est pré-rempli « F »
const effectivePlanningCode = (dt, raw) => raw || (isFrenchHoliday(dt) ? 'F' : '')

/* Indicateurs — calculs d'âge et d'échéance CT */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function parseFrDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim())
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null
}
function ageYears(dateMec) {
  const d = parseFrDate(dateMec)
  if (!d) return null
  return (Date.now() - d.getTime()) / (365.25 * 864e5)
}
/* Date ISO 'AAAA-MM-JJ' → objet Date (ou null si invalide) */
function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
/* Échéance du contrôle technique : date + jours restants */
function ctInfo(ctDate) {
  const d = parseIsoDate(ctDate)
  if (!d) return null
  return { date: d, days: Math.round((d - startOfToday()) / 864e5) }
}
/* Couleur et libellé d'urgence selon les jours restants */
function ctTone(days) {
  if (days < 0) return { color: C.red, label: 'Dépassé' }
  if (days <= 30) return { color: C.red, label: 'J-' + days }
  if (days <= 90) return { color: '#9A6B00', label: 'J-' + days }
  return { color: C.green, label: 'J-' + days }
}
/* Tri par échéance CT — la plus proche d'abord, sans date en dernier */
const ctSort = (a, b) =>
  (a.ct_date || '9999-99-99').localeCompare(b.ct_date || '9999-99-99')

/* ── Documents : rapprochement fichier ↔ véhicule ─────────────
   Même logique que le script d'import serveur (api/importDocuments.js). */
const normalizePlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/* Immatriculation devinée depuis le nom du fichier : le segment placé
   avant « - CARTE GRISE », sinon le premier motif SIV (AA-123-AA) ou
   FNI (123-ABC-34) rencontré. */
function plateFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '')
  const head = base.split(/\s+-\s+/)[0].trim()
  if (normalizePlate(head).length >= 6) return head
  const m = base.match(/[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}/i)
    || base.match(/\d{1,4}[\s-]?[A-Z]{2,3}[\s-]?\d{2,3}/i)
  return m ? m[0] : ''
}

/* Distance d'édition (Damerau) — sert au rapprochement approché :
   une coquille d'un caractère, ou l'inversion de deux caractères
   voisins, sur l'immatriculation. */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

function fmtFileSize(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} o`
  if (b < 1048576) return `${Math.round(b / 1024)} Ko`
  return `${(b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

/* Tri des documents d'un véhicule : carte grise, carte blanche, puis le reste */
const docSort = (a, b) => {
  const rank = (d) => DOC_TYPES.findIndex((t) => t.code === d.type)
  return rank(a) - rank(b) || (b.created_at || '').localeCompare(a.created_at || '')
}

/* Impression — règle l'orientation puis lance la boîte d'impression */
function doPrint(orientation = 'portrait') {
  const style = document.createElement('style')
  style.textContent = `@page { size: ${orientation}; margin: 10mm; }`
  document.head.appendChild(style)
  window.print()
  setTimeout(() => style.remove(), 800)
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

/* HTML email — tableau de présence */
function buildPresenceEmailHtml({ weekNum, range, responsable, drivers, grid, dayDates }) {
  const th = 'padding:6px 8px;border:1px solid #999;background:#2C6126;color:#fff;font-size:12px'
  const td = 'padding:6px 8px;border:1px solid #bbb;font-size:12px'
  const sectionTd = 'padding:5px 8px;border:1px solid #bbb;background:#EDECE4;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#666'
  const head = `<tr><th style="${th};text-align:left">NOM</th>` +
    DAYS.map((d, i) => `<th style="${th}">${d}<br><span style="font-weight:400">${ddmm(dayDates[i])}</span></th>`).join('') +
    '</tr>'
  const body = groupByCategory(drivers).map((g) => {
    const section = `<tr><td style="${sectionTd}" colspan="${1 + DAY_KEYS.length}">${esc(g.plural)}</td></tr>`
    const rows = g.drivers.map((dr) => {
      const row = grid[dr.id] || {}
      return `<tr><td style="${td};font-weight:600">${esc(dr.nom)}</td>` +
        DAY_KEYS.map((k, i) => {
          const v = effectiveCode(dayDates[i], row[k])
          const bg = CODE_BG[v] || '#fff'
          return `<td style="${td};text-align:center;background:${bg}">${esc(v)}</td>`
        }).join('') + '</tr>'
    }).join('')
    return section + rows
  }).join('')
  const legend = PRESENCE_CODES.map((c) =>
    `<span style="display:inline-block;margin:2px 8px 2px 0"><b>${c.code}</b> = ${c.meaning}</span>`).join('')
  return `<div style="font-family:Arial,sans-serif;color:#1A190F">
    <h2 style="margin:0 0 4px">Présence Pérols — Semaine ${weekNum}</h2>
    <p style="margin:0 0 2px;color:#555">${range}</p>
    <p style="margin:0 0 12px">Responsable : <b>${esc(responsable) || '—'}</b></p>
    <table style="border-collapse:collapse">${head}${body}</table>
    <p style="margin:14px 0 0;font-size:11px;color:#555">${legend}</p>
  </div>`
}

async function sendMail(subject, html, to) {
  return apiFetch('/send-mail', {
    method: 'POST',
    body: JSON.stringify({ subject, html, ...(to ? { to } : {}) }),
  })
}

/* Dates — mois calendaire */
function firstOfMonth(d) {
  const x = new Date(d)
  x.setDate(1)
  x.setHours(12, 0, 0, 0)
  return x
}
function addMonths(d, n) {
  const x = new Date(d)
  x.setDate(1)
  x.setMonth(x.getMonth() + n)
  return x
}
/* Clé de mois 'AAAA-MM' */
function ym(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}
/* Période du récapitulatif : du 25 du mois précédent au 25 du mois
   affiché (inclus). `anchor` = 1er du mois affiché. Renvoie la liste
   des dates (objets Date à 12 h) — la période chevauche deux mois,
   les cellules sont donc indexées par date ISO complète. */
function recapPeriod(anchor) {
  const y = anchor.getFullYear()
  const m = anchor.getMonth() // 0-11
  const start = new Date(y, m - 1, 25, 12, 0, 0, 0)
  const end = new Date(y, m, 25, 12, 0, 0, 0)
  const out = []
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
  return out
}

/* Agrège une liste de dates triées en plages lisibles :
   jour isolé → « le JJ/MM », jours consécutifs → « du JJ/MM au JJ/MM »,
   plusieurs entrées jointes par « ; ». */
function summarizeRuns(dates) {
  if (!dates.length) return ''
  const parts = []
  const flush = (a, b) =>
    parts.push(ymd(a) === ymd(b) ? `le ${ddmm(a)}` : `du ${ddmm(a)} au ${ddmm(b)}`)
  let runStart = dates[0]
  let prev = dates[0]
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i]
    if (Math.round((d - prev) / 864e5) === 1) { prev = d; continue }
    flush(runStart, prev)
    runStart = d
    prev = d
  }
  flush(runStart, prev)
  return parts.join(' ; ')
}

/* Code de présence → colonnes du suivi Frank.
   Mapping par token (séparés par « / ») : un jour combiné compte dans
   chaque colonne concernée. Ex. AS/CP → astreintes + congés. */
function frankColumnsForCode(code) {
  const tokens = String(code || '').split('/')
  const cols = []
  if (tokens.includes('AS')) cols.push('astreintes')
  if (tokens.includes('RJ')) cols.push('repos_journalier')
  if (tokens.includes('R')) cols.push('repos')
  if (tokens.includes('CP')) cols.push('conges')
  return cols
}

/* Construit les lignes du suivi Frank à partir des codes de présence.
   `presence` = { driverId: { 'YYYY-MM-DD': code } } ; les week-ends vides
   sont déjà « WE » via effectiveCode (et WE ne se ventile dans aucune
   colonne). `annotations` = { driverId: texte }. */
function buildFrankRows(drivers, presence, annotations, periodDays) {
  return drivers.map((dr) => {
    const dayMap = presence[dr.id] || {}
    const buckets = { astreintes: [], repos_journalier: [], repos: [], conges: [] }
    for (const dt of periodDays) {
      const code = effectiveCode(dt, dayMap[ymd(dt)])
      for (const col of frankColumnsForCode(code)) buckets[col].push(dt)
    }
    return {
      nom: dr.nom,
      categorie: normCategory(dr.categorie),
      astreintes: summarizeRuns(buckets.astreintes),
      repos_journalier: summarizeRuns(buckets.repos_journalier),
      repos: summarizeRuns(buckets.repos),
      conges: summarizeRuns(buckets.conges),
      info: annotations[dr.id] || '',
    }
  })
}

// Regroupe les lignes Frank par catégorie en respectant l'ordre CATEGORIES.
function groupFrankRows(rows) {
  return CATEGORIES.map((cat) => ({
    ...cat,
    rows: rows.filter((r) => normCategory(r.categorie) === cat.key),
  })).filter((g) => g.rows.length > 0)
}

/* Couleur hexadécimale → [r, g, b] pour jsPDF */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''))
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

/* Génération PDF (un clic) — récapitulatif mensuel, format paysage.
   Codes reconstruits depuis la présence (`presence`) + annotations. */
function generateRecapPdf({ monthLabel, responsable, drivers, presence, annotations, periodDays, fileName }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(`RÉCAPITULATIF MENSUEL — ${monthLabel.toUpperCase()}`, 8, 12)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`Montpellier Dépannage · Responsable : ${responsable || '—'}`, 8, 18)

  const head = ['NOM', ...periodDays.map((dt) => `${WEEKDAY_LETTERS[dt.getDay()]}\n${dt.getDate()}`), 'Annotation']

  const body = []
  const rowMeta = []
  for (const g of groupByCategory(drivers)) {
    body.push([g.plural.toUpperCase(), ...periodDays.map(() => ''), ''])
    rowMeta.push({ kind: 'section' })
    for (const dr of g.drivers) {
      const dayMap = presence[dr.id] || {}
      body.push([
        dr.nom,
        ...periodDays.map((dt) => effectiveCode(dt, dayMap[ymd(dt)])),
        annotations[dr.id] || '',
      ])
      rowMeta.push({ kind: 'driver' })
    }
  }

  autoTable(doc, {
    head: [head], body, startY: 22, margin: { left: 8, right: 8 },
    tableWidth: 'auto',
    styles: {
      fontSize: 6, cellPadding: 0.8, halign: 'center', valign: 'middle',
      lineColor: [180, 180, 180], lineWidth: 0.1, textColor: [26, 25, 15], overflow: 'linebreak',
    },
    headStyles: { fillColor: [44, 97, 38], textColor: [255, 255, 255], fontSize: 6, halign: 'center' },
    columnStyles: {
      0: { halign: 'left', cellWidth: 22, fontStyle: 'bold' },
      [periodDays.length + 1]: { halign: 'left', cellWidth: 30 },
    },
    didParseCell: (data) => {
      const col = data.column.index
      const isDayCol = col > 0 && col <= periodDays.length
      if (data.section === 'head' && isDayCol) {
        const w = periodDays[col - 1].getDay()
        if (w === 0 || w === 6) data.cell.styles.fillColor = [31, 69, 27]
      }
      if (data.section === 'body') {
        const meta = rowMeta[data.row.index]
        if (meta && meta.kind === 'section') {
          data.cell.styles.fillColor = [237, 236, 228]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = [90, 90, 90]
          data.cell.styles.halign = col === 0 ? 'left' : 'center'
          return
        }
        if (isDayCol) {
          const rgb = hexToRgb(CODE_BG[data.cell.raw])
          if (rgb) data.cell.styles.fillColor = rgb
        }
      }
    },
  })

  let y = doc.lastAutoTable.finalY + 6
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Légende', 8, y)
  doc.setFont('helvetica', 'normal')
  doc.text(
    PRESENCE_CODES.map((c) => `${c.code} = ${c.meaning}`).join('   ·   '),
    8, y + 5, { maxWidth: 281 }
  )
  doc.save(fileName)
}

const FRANK_COLS = [
  { key: 'astreintes', label: 'Jours astreintes' },
  { key: 'repos_journalier', label: 'Jours repos journalier' },
  { key: 'repos', label: 'Jours repos' },
  { key: 'conges', label: 'Jours congés' },
  { key: 'info', label: 'Informations supplémentaires' },
]

/* HTML email — suivi Frank (récapitulatif des astreintes) */
function buildFrankEmailHtml({ monthLabel, periodLabel, rows }) {
  const th = 'padding:7px 9px;border:1px solid #999;background:#2C6126;color:#fff;font-size:12px;text-align:left'
  const td = 'padding:7px 9px;border:1px solid #bbb;font-size:12px;vertical-align:top'
  const sectionTd = 'padding:6px 9px;border:1px solid #bbb;background:#EDECE4;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#666'
  const head = `<tr><th style="${th}">NOM</th>` +
    FRANK_COLS.map((c) => `<th style="${th}">${c.label}</th>`).join('') + '</tr>'
  const body = groupFrankRows(rows).map((g) => {
    const section = `<tr><td style="${sectionTd}" colspan="${1 + FRANK_COLS.length}">${esc(g.plural)}</td></tr>`
    const lines = g.rows.map((r) =>
      `<tr><td style="${td};font-weight:600;white-space:nowrap">${esc(r.nom)}</td>` +
      FRANK_COLS.map((c) => `<td style="${td}">${esc(r[c.key] || '')}</td>`).join('') + '</tr>'
    ).join('')
    return section + lines
  }).join('')
  return `<div style="font-family:Arial,sans-serif;color:#1A190F">
    <h2 style="margin:0 0 4px">Suivi Frank — Récapitulatif des astreintes</h2>
    <p style="margin:0 0 12px;color:#555">${esc(monthLabel)} · ${esc(periodLabel)}</p>
    <table style="border-collapse:collapse;max-width:900px">${head}${body}</table>
  </div>`
}

/* Génération PDF (un clic) — suivi Frank, format portrait */
function generateFrankPdf({ monthLabel, periodLabel, rows, fileName }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text('SUIVI FRANK — RÉCAPITULATIF DES ASTREINTES', 12, 14)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`${monthLabel} · ${periodLabel}`, 12, 20)

  const body = []
  const rowMeta = []
  for (const g of groupFrankRows(rows)) {
    body.push([g.plural.toUpperCase(), ...FRANK_COLS.map(() => '')])
    rowMeta.push({ kind: 'section' })
    for (const r of g.rows) {
      body.push([r.nom, ...FRANK_COLS.map((c) => r[c.key] || '')])
      rowMeta.push({ kind: 'driver' })
    }
  }

  autoTable(doc, {
    head: [['NOM', ...FRANK_COLS.map((c) => c.label)]],
    body,
    startY: 24, margin: { left: 10, right: 10 },
    styles: {
      fontSize: 7.5, cellPadding: 1.6, valign: 'top',
      lineColor: [180, 180, 180], lineWidth: 0.1, textColor: [26, 25, 15], overflow: 'linebreak',
    },
    headStyles: { fillColor: [44, 97, 38], textColor: [255, 255, 255], fontSize: 7.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 24 } },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const meta = rowMeta[data.row.index]
      if (meta && meta.kind === 'section') {
        data.cell.styles.fillColor = [237, 236, 228]
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [90, 90, 90]
        data.cell.styles.halign = data.column.index === 0 ? 'left' : 'center'
      }
    },
  })
  doc.save(fileName)
}

/* Génération PDF (un clic) — planning hebdomadaire, format paysage.
   Grand et lisible, pensé pour l'impression et l'affichage atelier.
   La 1re ligne « Opération spéciale » (texte libre par jour) est mise
   en évidence en couleur flashy. */
function generatePlanningPdf({ weekNum, range, drivers, grid, special, dayDates, fileName }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text(`PLANNING — SEMAINE ${weekNum}`, 10, 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  doc.text(`Montpellier Dépannage · ${range}`, 10, 22)

  const head = ['ÉQUIPE', ...DAYS.map((d, i) => `${d}\n${ddmm(dayDates[i])}`)]

  // Body : en-tête de section par catégorie puis les lignes des employés.
  // `rowMeta` aligne chaque ligne du body avec sa nature (section/driver/special)
  // pour le coloriage dans didParseCell.
  const body = []
  const rowMeta = []
  for (const g of groupByCategory(drivers)) {
    body.push([g.plural.toUpperCase(), ...DAY_KEYS.map(() => '')])
    rowMeta.push({ kind: 'section' })
    for (const dr of g.drivers) {
      const row = grid[dr.id] || {}
      body.push([dr.nom, ...DAY_KEYS.map((k, i) => PLANNING_LABEL[effectivePlanningCode(dayDates[i], row[k])] || '')])
      rowMeta.push({ kind: 'driver', driver: dr })
    }
  }
  body.push(['OPÉRATION SPÉCIALE', ...DAY_KEYS.map((k) => (special || {})[k] || '')])
  rowMeta.push({ kind: 'special' })

  const flashy = hexToRgb(SPECIAL_BG)
  const sectionFill = [237, 236, 228]

  // Dimensionnement dynamique pour TOUJOURS tenir sur une seule page :
  // on répartit la hauteur disponible entre l'en-tête et toutes les lignes
  // (sections incluses), puis on adapte la police et les marges.
  const startY = 27
  const bottomReserve = 16 // place pour la légende + marge basse
  const pageH = doc.internal.pageSize.getHeight()
  const rowCount = body.length + 1 // + en-tête de table
  const avail = pageH - startY - bottomReserve
  const rowH = Math.max(4.5, Math.min(13, avail / rowCount))
  const fontSize = Math.max(5.5, Math.min(11, rowH * 0.82))
  const cellPadding = Math.max(0.5, Math.min(2.4, rowH * 0.18))

  autoTable(doc, {
    head: [head], body, startY, margin: { left: 8, right: 8 },
    pageBreak: 'avoid', rowPageBreak: 'avoid', tableWidth: 'auto',
    styles: {
      fontSize, cellPadding, halign: 'center', valign: 'middle',
      lineColor: [140, 140, 140], lineWidth: 0.2, textColor: [26, 25, 15],
      minCellHeight: rowH, overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [44, 97, 38], textColor: [255, 255, 255],
      fontSize: Math.min(11, fontSize + 1), halign: 'center', minCellHeight: rowH,
    },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 38 } },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const meta = rowMeta[data.row.index]
      if (!meta) return
      if (meta.kind === 'section') {
        data.cell.styles.fillColor = sectionFill
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = Math.max(5, fontSize - 1)
        data.cell.styles.textColor = [90, 90, 90]
        data.cell.styles.halign = data.column.index === 0 ? 'left' : 'center'
        return
      }
      if (meta.kind === 'special') {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = Math.max(5, fontSize - 1.5)
        if (data.column.index === 0 || data.cell.raw) {
          data.cell.styles.fillColor = flashy
          data.cell.styles.textColor = [255, 255, 255]
        }
        return
      }
      // kind === 'driver'
      if (data.column.index > 0) {
        const ci = data.column.index - 1
        const code = effectivePlanningCode(dayDates[ci], (grid[meta.driver.id] || {})[DAY_KEYS[ci]])
        const rgb = hexToRgb(PLANNING_BG[code])
        if (rgb) data.cell.styles.fillColor = rgb
      }
    },
  })

  // Légende avec pastilles de couleur
  let y = doc.lastAutoTable.finalY + 9
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bold')
  doc.text('Légende :', 10, y)
  let x = 10 + doc.getTextWidth('Légende :') + 5
  doc.setFont('helvetica', 'normal')
  for (const o of PLANNING_OPTIONS) {
    const rgb = hexToRgb(o.bg) || [255, 255, 255]
    doc.setFillColor(rgb[0], rgb[1], rgb[2])
    doc.setDrawColor(140, 140, 140)
    doc.rect(x, y - 3.6, 5, 5, 'FD')
    doc.text(o.label, x + 6.5, y)
    x += 6.5 + doc.getTextWidth(o.label) + 9
  }
  doc.save(fileName)
}

/* ════════════════════════════════════════════════════════════
   Styles partagés
   ════════════════════════════════════════════════════════════ */
const S = {
  btn: {
    padding: '9px 15px', borderRadius: 9, border: `1px solid ${C.border}`,
    background: C.panel, fontSize: 14, fontWeight: 600, color: C.ink,
    display: 'inline-flex', alignItems: 'center', gap: 7, lineHeight: 1.1,
    transition: 'filter .12s',
  },
  btnPrimary: { background: C.green, color: '#fff', border: `1px solid ${C.green}` },
  btnDanger: { background: C.panel, color: C.red, border: `1px solid ${C.red}` },
  input: {
    width: '100%', padding: '10px 12px', borderRadius: 9,
    border: `1px solid ${C.border}`, fontSize: 14, background: '#fff',
    color: C.ink, outline: 'none',
  },
  label: {
    fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6,
    display: 'block', textTransform: 'uppercase', letterSpacing: 0.6,
  },
}

/* ════════════════════════════════════════════════════════════
   Contexte Toast
   ════════════════════════════════════════════════════════════ */
const ToastCtx = createContext(() => {})
const useToast = () => useContext(ToastCtx)

function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])
  const notify = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 999, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            background: t.kind === 'error' ? C.red : t.kind === 'success' ? C.green : C.black,
            color: '#fff', padding: '11px 16px', borderRadius: 10, fontSize: 14,
            fontWeight: 500, maxWidth: 340, boxShadow: '0 8px 24px rgba(0,0,0,.22)',
          }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ════════════════════════════════════════════════════════════
   Modale générique
   ════════════════════════════════════════════════════════════ */
function Modal({ title, onClose, children, width = 560 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div onMouseDown={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(26,25,15,.45)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', zIndex: 200, overflowY: 'auto',
    }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{
        background: C.panel, borderRadius: 16, width: '100%', maxWidth: width,
        boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '17px 22px', borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <h2 style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} aria-label="Fermer" style={{
            border: 'none', background: 'none', fontSize: 24, color: C.muted, lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  )
}

/* Confirmation simple */
function ConfirmDialog({ message, confirmLabel = 'Supprimer', onConfirm, onClose }) {
  return (
    <Modal title="Confirmation" onClose={onClose} width={420}>
      <p style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 22 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button style={S.btn} onClick={onClose}>Annuler</button>
        <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => { onConfirm(); onClose() }}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

/* Champ de formulaire */
function Field({ label, children, hint }) {
  return (
    <div>
      <label style={S.label}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Écran de connexion
   ════════════════════════════════════════════════════════════ */
function LoginScreen({ onAuth }) {
  const [mode, setMode] = useState(null) // 'login' | 'setup'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiFetch('/auth/check')
      .then((d) => setMode(d.hasUsers ? 'login' : 'setup'))
      .catch(() => setMode('login'))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (mode === 'setup' && password.length < 12) {
      setError('Le mot de passe doit comporter au moins 12 caractères.')
      return
    }
    setError(''); setBusy(true)
    try {
      const d = await apiFetch(`/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      localStorage.setItem('flotte-token', d.token)
      localStorage.setItem('flotte-user', d.username)
      onAuth(d.username)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: C.green, padding: 20,
    }}>
      <div style={{
        background: C.panel, borderRadius: 18, padding: '38px 34px',
        width: '100%', maxWidth: 380, boxShadow: '0 24px 60px rgba(0,0,0,.32)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Logo size={42} />
          <div>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 20, lineHeight: 1 }}>FLOTTE</div>
            <div style={{ fontSize: 12, color: C.muted }}>Montpellier Dépannage</div>
          </div>
        </div>
        <p style={{ fontSize: 14, color: C.muted, margin: '16px 0 20px' }}>
          {mode === 'setup'
            ? 'Première utilisation — créez le compte administrateur.'
            : 'Connectez-vous pour accéder au suivi de la flotte.'}
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Identifiant">
            <input style={S.input} value={username} autoFocus
              onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Mot de passe">
            <input style={S.input} type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
            {mode === 'setup' && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                12 caractères minimum.
              </div>
            )}
          </Field>
          {error && <div style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>{error}</div>}
          <button type="submit" disabled={busy || !mode}
            style={{ ...S.btn, ...S.btnPrimary, justifyContent: 'center', padding: '11px', marginTop: 4 }}>
            {busy ? '…' : mode === 'setup' ? 'Créer le compte' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Logo({ size = 38 }) {
  return (
    <img src="/logo.png" alt="Montpellier Dépannage"
      style={{ height: size, width: 'auto', flexShrink: 0, display: 'block' }} />
  )
}

/* ════════════════════════════════════════════════════════════
   Application — racine authentifiée
   ════════════════════════════════════════════════════════════ */
function FlotteApp({ user, onLogout, onUserChange }) {
  const notify = useToast()
  const [categories, setCategories] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState({ name: 'dashboard' })

  const loadData = useCallback(async () => {
    try {
      const [cats, vehs] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/vehicles'),
      ])
      setCategories(cats)
      setVehicles(vehs)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { loadData() }, [loadData])

  const goVehicle = (id) => setView({ name: 'vehicle', id })
  const goDashboard = () => setView({ name: 'dashboard' })
  const goPresence = () => setView({ name: 'presence' })
  const goStats = () => setView({ name: 'stats' })
  const goRecap = () => setView({ name: 'recap' })
  const goFrank = () => setView({ name: 'frank' })
  const goPlanning = () => setView({ name: 'planning' })
  const goDocuments = () => setView({ name: 'documents' })
  const active = ['presence', 'stats', 'recap', 'frank', 'planning', 'documents'].includes(view.name)
    ? view.name : 'dashboard'

  const onNav = (n) =>
    n === 'presence' ? goPresence()
      : n === 'stats' ? goStats()
        : n === 'recap' ? goRecap()
          : n === 'frank' ? goFrank()
            : n === 'planning' ? goPlanning()
              : n === 'documents' ? goDocuments()
                : goDashboard()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        user={user} onLogout={onLogout} onUserChange={onUserChange} active={active}
        onNav={onNav}
      />
      <div style={{ flex: 1, padding: '24px clamp(14px, 3vw, 36px) 60px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 80, fontSize: 15 }}>
            Chargement de la flotte…
          </div>
        ) : view.name === 'dashboard' ? (
          <Dashboard
            categories={categories} vehicles={vehicles}
            onOpenVehicle={goVehicle} reload={loadData}
          />
        ) : view.name === 'vehicle' ? (
          <VehicleDetail
            vehicleId={view.id} categories={categories}
            onBack={goDashboard} reloadFleet={loadData}
          />
        ) : view.name === 'documents' ? (
          <DocumentsPage
            categories={categories} vehicles={vehicles} onOpenVehicle={goVehicle}
          />
        ) : view.name === 'stats' ? (
          <StatsPage categories={categories} vehicles={vehicles} />
        ) : view.name === 'recap' ? (
          <MonthlyRecap />
        ) : view.name === 'frank' ? (
          <FrankPage />
        ) : view.name === 'planning' ? (
          <PlanningPage />
        ) : (
          <PresencePage />
        )}
      </div>
    </div>
  )
}

function TopBar({ user, onLogout, onUserChange, active, onNav }) {
  const [accountOpen, setAccountOpen] = useState(false)
  const navBtn = (id, label) => (
    <button onClick={() => onNav(id)} style={{
      border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13.5, fontWeight: 600,
      background: active === id ? C.green : 'transparent',
      color: active === id ? '#fff' : C.muted,
    }}>{label}</button>
  )
  return (
    <>
    <header className="no-print" style={{
      background: C.panel, borderBottom: `1px solid ${C.border}`,
      padding: '12px clamp(14px, 3vw, 36px)', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between', gap: 16,
      position: 'sticky', top: 0, zIndex: 50, flexWrap: 'wrap',
    }}>
      <button onClick={() => onNav('dashboard')} style={{
        border: 'none', background: 'none', display: 'flex',
        alignItems: 'center', gap: 11, padding: 0,
      }}>
        <Logo />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 17, lineHeight: 1 }}>FLOTTE</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>Montpellier Dépannage</div>
        </div>
      </button>
      <nav style={{ display: 'flex', gap: 4, background: C.bg, padding: 4, borderRadius: 11 }}>
        {navBtn('dashboard', 'Tableau de bord')}
        {navBtn('documents', 'Documents')}
        {navBtn('stats', 'Indicateurs')}
        {navBtn('planning', 'Planning')}
        {navBtn('presence', 'Présence Pérols')}
        {navBtn('recap', 'Récapitulatif mensuel')}
        {navBtn('frank', 'Suivi Frank')}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 13.5, color: C.muted }}>
          Connecté : <strong style={{ color: C.ink }}>{user}</strong>
        </span>
        <button style={S.btn} onClick={() => setAccountOpen(true)}>Mon compte</button>
        <button style={S.btn} onClick={onLogout}>Déconnexion</button>
      </div>
    </header>
    {accountOpen && (
      <AccountModal user={user} onClose={() => setAccountOpen(false)}
        onSaved={onUserChange} />
    )}
    </>
  )
}

/* ════════════════════════════════════════════════════════════
   Mon compte — modification de l'identifiant et du mot de passe
   ════════════════════════════════════════════════════════════ */
function AccountModal({ user, onClose, onSaved }) {
  const notify = useToast()
  const [newUsername, setNewUsername] = useState(user || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    if (!currentPassword) { notify('Saisissez votre mot de passe actuel', 'error'); return }
    if (newPassword && newPassword.length < 12) {
      notify('Le nouveau mot de passe doit comporter au moins 12 caractères', 'error'); return
    }
    if (newPassword && newPassword !== confirmPassword) {
      notify('Les deux mots de passe ne correspondent pas', 'error'); return
    }
    setBusy(true)
    try {
      const d = await apiFetch('/auth/credentials', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword,
          newUsername: newUsername.trim(),
          newPassword: newPassword || undefined,
        }),
      })
      localStorage.setItem('flotte-token', d.token)
      localStorage.setItem('flotte-user', d.username)
      onSaved(d.username)
      notify('Identifiants mis à jour', 'success')
      onClose()
    } catch (err) {
      notify(err.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Mon compte" onClose={onClose} width={420}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          Modifiez l'identifiant et le mot de passe de connexion. Le mot de passe
          actuel est requis pour confirmer.
        </p>
        <div>
          <label style={S.label}>Identifiant</label>
          <input style={S.input} value={newUsername} autoComplete="username"
            onChange={(e) => setNewUsername(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Mot de passe actuel</label>
          <input style={S.input} type="password" value={currentPassword}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Nouveau mot de passe</label>
          <input style={S.input} type="password" value={newPassword}
            autoComplete="new-password" placeholder="Laisser vide pour ne pas changer"
            onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Confirmer le nouveau mot de passe</label>
          <input style={S.input} type="password" value={confirmPassword}
            autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" style={S.btn} onClick={onClose}>Annuler</button>
          <button type="submit" style={{ ...S.btn, ...S.btnPrimary }} disabled={busy}>
            {busy ? '…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* Cellule d'échéance CT — date + pastille J-xx colorée */
function CtCell({ ctDate }) {
  const info = ctInfo(ctDate)
  if (!info) return <span style={{ color: C.muted }}>—</span>
  const tone = ctTone(info.days)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: FONT_MONO }}>{formatDate(ctDate)}</span>
      <span style={{
        fontFamily: FONT_MONO, fontWeight: 700, fontSize: 11, color: '#fff',
        background: tone.color, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap',
      }}>{tone.label}</span>
    </span>
  )
}

/* ════════════════════════════════════════════════════════════
   Tableau de bord — le grand planning de la flotte
   ════════════════════════════════════════════════════════════ */
function Dashboard({ categories, vehicles, onOpenVehicle, reload }) {
  const notify = useToast()
  const [search, setSearch] = useState('')
  const [vehicleModal, setVehicleModal] = useState(null) // { categoryId } | { vehicle }
  const [categoryModal, setCategoryModal] = useState(null) // { } new | { category }

  const q = search.trim().toLowerCase()
  const matches = (v) =>
    !q || [v.marque, v.modele, v.immatriculation, v.usage_type]
      .some((x) => (x || '').toLowerCase().includes(q))

  const byCategory = useMemo(() => {
    const map = {}
    for (const c of categories) map[c.id] = []
    for (const v of vehicles) (map[v.category_id] ||= []).push(v)
    return map
  }, [categories, vehicles])

  const totalShown = vehicles.filter(matches).length

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* En-tête */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 24, fontWeight: 700 }}>
          Tableau de bord
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>
          Suivi de la flotte — Planning des contrôles techniques · {vehicles.length} véhicules
        </p>
      </div>

      {/* Barre d'outils */}
      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          placeholder="Rechercher (marque, modèle, immatriculation, usage)…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 320 }}
        />
        {q && <span style={{ fontSize: 13, color: C.muted }}>{totalShown} résultat(s)</span>}
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setCategoryModal({})}>+ Catégorie</button>
        <button style={S.btn} onClick={() => doPrint('portrait')}>🖨 Imprimer</button>
      </div>

      {/* Tableau */}
      <div className="tablewrap fleet-table" style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820, fontSize: 13 }}>
          <thead>
            <tr>
              {['Marque', 'Modèle', 'Immatriculation', 'PTAC', 'Usage', '1ère MEC', 'Prochain CT'].map((h, i) => (
                <th key={h} style={{
                  ...thBase, textAlign: 'left', minWidth: [120, 140, 150, 95, 80, 100, 190][i],
                  position: 'sticky', top: 0, zIndex: 2,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const list = (byCategory[cat.id] || []).filter(matches).sort(ctSort)
              if (q && list.length === 0) return null
              return (
                <React.Fragment key={cat.id}>
                  <tr>
                    <td colSpan={7} style={{
                      background: cat.color, padding: '8px 12px',
                      borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 13.5,
                          letterSpacing: 0.5, color: C.black,
                        }}>{cat.name}</span>
                        <span style={{ fontSize: 12, color: '#00000099' }}>
                          {(byCategory[cat.id] || []).length} véhicule(s)
                        </span>
                        <div style={{ flex: 1 }} />
                        <button className="no-print" onClick={() => setCategoryModal({ category: cat })}
                          style={miniBtn} title="Modifier la catégorie">✎</button>
                        <button className="no-print" onClick={() => setVehicleModal({ categoryId: cat.id })}
                          style={{ ...miniBtn, fontWeight: 700 }}>+ Véhicule</button>
                      </div>
                    </td>
                  </tr>
                  {list.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...tdBase, color: C.muted, fontStyle: 'italic' }}>
                      Aucun véhicule — cliquez sur « + Véhicule » pour en ajouter.
                    </td></tr>
                  ) : list.map((v) => (
                    <tr key={v.id} className="veh-row"
                      onClick={() => onOpenVehicle(v.id)}
                      style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdBase, fontWeight: 600 }}>{v.marque || '—'}</td>
                      <td style={tdBase}>{v.modele || '—'}</td>
                      <td style={tdBase}>
                        <span style={{ fontFamily: FONT_MONO, fontWeight: 500 }}>
                          {v.immatriculation || '—'}
                        </span>
                        {Number(v.interventions_count) > 0 && (
                          <span style={interventionBadge} title="Interventions enregistrées">
                            🔧 {v.interventions_count}
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdBase, fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>
                        {fmtPtac(v.ptac)}
                      </td>
                      <td style={tdBase}>
                        {v.usage_type
                          ? <span style={usageBadge}>{v.usage_type}</span>
                          : <span style={{ color: C.muted }}>—</span>}
                      </td>
                      <td style={{ ...tdBase, fontFamily: FONT_MONO, color: C.muted }}>
                        {v.date_mec || '—'}
                      </td>
                      <td style={tdBase}><CtCell ctDate={v.ct_date} /></td>
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
            {categories.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdBase, textAlign: 'center', color: C.muted, padding: 40 }}>
                Aucune catégorie. Créez-en une pour commencer.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Légende */}
      <div className="no-print" style={{
        display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12,
        fontSize: 12.5, color: C.muted, alignItems: 'center',
      }}>
        <span>Échéance du prochain CT :</span>
        {[
          [C.red, '≤ 30 jours ou dépassé'],
          ['#9A6B00', '≤ 90 jours'],
          [C.green, 'plus de 90 jours'],
        ].map(([col, txt]) => (
          <span key={txt} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, background: col, borderRadius: 20, display: 'inline-block' }} />
            {txt}
          </span>
        ))}
        <span>· 🔧 = interventions · cliquez sur un véhicule pour ouvrir sa fiche</span>
      </div>

      {vehicleModal && (
        <VehicleModal
          categories={categories}
          initialCategoryId={vehicleModal.categoryId}
          vehicle={vehicleModal.vehicle}
          onClose={() => setVehicleModal(null)}
          onSaved={() => { setVehicleModal(null); reload(); notify('Véhicule enregistré', 'success') }}
        />
      )}
      {categoryModal && (
        <CategoryModal
          category={categoryModal.category}
          onClose={() => setCategoryModal(null)}
          onSaved={() => { setCategoryModal(null); reload() }}
        />
      )}
    </div>
  )
}

const thBase = {
  padding: '9px 10px', background: '#EDECE4', fontSize: 11.5, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5, color: C.ink,
  borderBottom: `1px solid ${C.border}`, textAlign: 'center', whiteSpace: 'nowrap',
}
const tdBase = {
  padding: '8px 10px', borderBottom: `1px solid ${C.borderSoft}`, color: C.ink,
}
const miniBtn = {
  border: '1px solid #00000033', background: '#ffffffcc', borderRadius: 7,
  padding: '4px 10px', fontSize: 12.5, color: C.black,
}
const usageBadge = {
  display: 'inline-block', fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
  letterSpacing: 0.5, background: C.borderSoft, color: C.ink,
  padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap',
}
const interventionBadge = {
  marginLeft: 8, fontSize: 11, background: C.borderSoft, color: C.muted,
  padding: '2px 6px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap',
}

/* ════════════════════════════════════════════════════════════
   Modale véhicule (ajout / modification)
   ════════════════════════════════════════════════════════════ */
function VehicleModal({ categories, initialCategoryId, vehicle, onClose, onSaved }) {
  const notify = useToast()
  const editing = !!vehicle
  const [form, setForm] = useState({
    category_id: vehicle?.category_id || initialCategoryId || categories[0]?.id || '',
    marque: vehicle?.marque || '',
    modele: vehicle?.modele || '',
    immatriculation: vehicle?.immatriculation || '',
    date_mec: vehicle?.date_mec || '',
    numero_serie: vehicle?.numero_serie || '',
    ct_date: vehicle?.ct_date || '',
    assurance_date: vehicle?.assurance_date || '',
    statut: vehicle?.statut || '',
    ptac: vehicle?.ptac ?? '',
    usage_type: vehicle?.usage_type || '',
    notes: vehicle?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.category_id) return notify('Choisissez une catégorie', 'error')
    setBusy(true)
    try {
      const payload = { ...form }
      await apiFetch(editing ? `/vehicles/${vehicle.id}` : '/vehicles', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      onSaved()
    } catch (err) {
      notify(err.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Modifier le véhicule' : 'Nouveau véhicule'} onClose={onClose} width={580}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Catégorie">
          <select style={S.input} value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Marque">
            <input style={S.input} value={form.marque}
              onChange={(e) => set('marque', e.target.value)} placeholder="RENAULT" />
          </Field>
          <Field label="Modèle">
            <input style={S.input} value={form.modele}
              onChange={(e) => set('modele', e.target.value)} placeholder="MASTER" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Immatriculation">
            <input style={{ ...S.input, fontFamily: FONT_MONO }} value={form.immatriculation}
              onChange={(e) => set('immatriculation', e.target.value.toUpperCase())}
              placeholder="AB-123-CD" />
          </Field>
          <Field label="Date 1ère MEC" hint="JJ/MM/AAAA">
            <input style={{ ...S.input, fontFamily: FONT_MONO }} value={form.date_mec}
              onChange={(e) => set('date_mec', e.target.value)} placeholder="19/02/2010" />
          </Field>
        </div>
        <Field label="Numéro de série">
          <input style={{ ...S.input, fontFamily: FONT_MONO }} value={form.numero_serie}
            onChange={(e) => set('numero_serie', e.target.value)} placeholder="VF6…" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Prochain contrôle technique" hint="CT renouvelé tous les 2 ans">
            <input style={S.input} type="date" value={form.ct_date}
              onChange={(e) => set('ct_date', e.target.value)} />
          </Field>
          <Field label="Échéance d'assurance">
            <input style={S.input} type="date" value={form.assurance_date}
              onChange={(e) => set('assurance_date', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="PTAC" hint="poids total autorisé en charge, en kg">
            <input style={{ ...S.input, fontFamily: FONT_MONO }} type="number" min="0" step="10"
              value={form.ptac} onChange={(e) => set('ptac', e.target.value)}
              placeholder="3500" />
          </Field>
          <Field label="Usage" hint="genre carte grise (J.1)">
            <select style={S.input} value={form.usage_type}
              onChange={(e) => set('usage_type', e.target.value)}>
              <option value="">— Non renseigné —</option>
              {VEHICLE_USAGES.map((u) => (
                <option key={u.code} value={u.code}>{u.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Statut du véhicule">
          <select style={S.input} value={form.statut}
            onChange={(e) => set('statut', e.target.value)}>
            <option value="">— Non renseigné —</option>
            {VEHICLE_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <textarea style={{ ...S.input, minHeight: 64, resize: 'vertical' }} value={form.notes}
            onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button style={S.btn} onClick={onClose}>Annuler</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy} onClick={save}>
            {busy ? '…' : editing ? 'Enregistrer' : 'Ajouter le véhicule'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ════════════════════════════════════════════════════════════
   Modale catégorie
   ════════════════════════════════════════════════════════════ */
function CategoryModal({ category, onClose, onSaved }) {
  const notify = useToast()
  const editing = !!category
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || CATEGORY_PALETTE[0])
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const save = async () => {
    if (!name.trim()) return notify('Nom requis', 'error')
    setBusy(true)
    try {
      await apiFetch(editing ? `/categories/${category.id}` : '/categories', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ name: name.trim(), color }),
      })
      onSaved()
    } catch (err) { notify(err.message, 'error'); setBusy(false) }
  }
  const remove = async () => {
    try {
      await apiFetch(`/categories/${category.id}`, { method: 'DELETE' })
      notify('Catégorie supprimée', 'success')
      onSaved()
    } catch (err) { notify(err.message, 'error') }
  }

  return (
    <Modal title={editing ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nom">
          <input style={S.input} value={name} autoFocus
            onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="FOURGONS" />
        </Field>
        <Field label="Couleur">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {CATEGORY_PALETTE.map((c) => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 30, height: 30, borderRadius: 8, background: c,
                border: color === c ? `3px solid ${C.black}` : `1px solid ${C.border}`,
              }} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              style={{ width: 38, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 8 }} />
          </div>
        </Field>
        <div style={{
          background: color, padding: '8px 12px', borderRadius: 8,
          fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 13.5,
        }}>{name || 'Aperçu'}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
          {editing
            ? <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => setConfirmDel(true)}>Supprimer</button>
            : <span />}
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={S.btn} onClick={onClose}>Annuler</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy} onClick={save}>
              {busy ? '…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
      {confirmDel && (
        <ConfirmDialog
          message={`Supprimer la catégorie « ${category.name} » et tous ses véhicules ? Cette action est irréversible.`}
          onConfirm={remove} onClose={() => setConfirmDel(false)}
        />
      )}
    </Modal>
  )
}

/* ════════════════════════════════════════════════════════════
   Fiche véhicule + historique des interventions
   ════════════════════════════════════════════════════════════ */
function VehicleDetail({ vehicleId, categories, onBack, reloadFleet }) {
  const notify = useToast()
  const [vehicle, setVehicle] = useState(null)
  const [interventions, setInterventions] = useState([])
  const [loading, setLoading] = useState(true)
  const [editVehicle, setEditVehicle] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [intervModal, setIntervModal] = useState(null) // {} new | { intervention }
  const [expanded, setExpanded] = useState({})

  const load = useCallback(async () => {
    try {
      const [v, ivs] = await Promise.all([
        apiFetch(`/vehicles/${vehicleId}`),
        apiFetch(`/vehicles/${vehicleId}/interventions`),
      ])
      setVehicle(v)
      setInterventions(ivs)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [vehicleId, notify])

  useEffect(() => { load() }, [load])

  const category = categories.find((c) => c.id === vehicle?.category_id)
  const grandTotal = interventions.reduce((s, iv) => s + interventionTotal(iv), 0)

  const removeVehicle = async () => {
    try {
      await apiFetch(`/vehicles/${vehicleId}`, { method: 'DELETE' })
      notify('Véhicule supprimé', 'success')
      reloadFleet()
      onBack()
    } catch (err) { notify(err.message, 'error') }
  }
  const removeIntervention = async (id) => {
    try {
      await apiFetch(`/interventions/${id}`, { method: 'DELETE' })
      notify('Intervention supprimée', 'success')
      load(); reloadFleet()
    } catch (err) { notify(err.message, 'error') }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', color: C.muted, padding: 80 }}>Chargement…</div>
  }
  if (!vehicle) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p>Véhicule introuvable.</p>
        <button style={{ ...S.btn, marginTop: 14 }} onClick={onBack}>← Retour</button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <button style={{ ...S.btn, marginBottom: 16 }} onClick={onBack}>← Tableau de bord</button>

      {/* Carte d'identité du véhicule */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14,
        overflow: 'hidden', marginBottom: 22,
      }}>
        <div style={{ height: 8, background: category?.color || C.border }} />
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              {category && (
                <span style={{
                  display: 'inline-block', background: category.color, color: C.black,
                  fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.5,
                  padding: '3px 9px', borderRadius: 6, marginBottom: 8,
                }}>{category.name}</span>
              )}
              <h1 style={{ fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
                {vehicle.immatriculation || '—'}
              </h1>
              <p style={{ fontSize: 15, color: C.muted, marginTop: 2 }}>
                {[vehicle.marque, vehicle.modele].filter(Boolean).join(' ') || 'Véhicule'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <button style={S.btn} onClick={() => setEditVehicle(true)}>✎ Modifier</button>
              <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => setConfirmDel(true)}>Supprimer</button>
            </div>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 14, marginTop: 18,
          }}>
            <InfoCell label="Date 1ère MEC" value={vehicle.date_mec || '—'} mono />
            <InfoCell label="N° de série" value={vehicle.numero_serie || '—'} mono />
            <InfoCell label="Prochain contrôle technique"
              value={vehicle.ct_date ? formatDate(vehicle.ct_date) : '—'} mono />
            <InfoCell label="Échéance assurance"
              value={vehicle.assurance_date ? formatDate(vehicle.assurance_date) : '—'} mono />
            <InfoCell label="PTAC" value={fmtPtac(vehicle.ptac, true)} mono />
            <InfoCell label="Usage" value={vehicle.usage_type || '—'} />
            <InfoCell label="Statut" value={vehicle.statut || '—'} />
            <InfoCell label="Interventions" value={String(interventions.length)} />
            <InfoCell label="Coût total HT" value={fmtMoney(grandTotal)} mono accent />
          </div>
          {vehicle.notes && (
            <div style={{
              marginTop: 16, padding: '10px 13px', background: C.bg,
              borderRadius: 9, fontSize: 13.5, color: C.muted,
            }}>
              <strong style={{ color: C.ink }}>Notes :</strong> {vehicle.notes}
            </div>
          )}
        </div>
      </div>

      {/* Documents administratifs (carte grise, carte blanche…) */}
      <VehicleDocuments vehicleId={vehicleId} immatriculation={vehicle.immatriculation} />

      {/* Historique des interventions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 700 }}>
          Historique des interventions
        </h2>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setIntervModal({})}>
          + Nouvelle intervention
        </button>
      </div>

      {interventions.length === 0 ? (
        <div style={{
          background: C.panel, border: `1px dashed ${C.border}`, borderRadius: 12,
          padding: 44, textAlign: 'center', color: C.muted,
        }}>
          Aucune intervention enregistrée.<br />
          Cliquez sur « + Nouvelle intervention » pour commencer l'historique.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {interventions.map((iv) => {
            const open = expanded[iv.id]
            return (
              <div key={iv.id} style={{
                background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
                overflow: 'hidden',
              }}>
                <div onClick={() => setExpanded((e) => ({ ...e, [iv.id]: !e[iv.id] }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
                    cursor: 'pointer', flexWrap: 'wrap',
                  }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                  <div style={{ minWidth: 96 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14 }}>
                      {formatDate(iv.date)}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted }}>{fmtKm(iv.kms)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 13.5 }}>
                      {iv.mecaniciens
                        ? <>Mécanicien : <strong>{iv.mecaniciens}</strong></>
                        : <span style={{ color: C.muted }}>Mécanicien non renseigné</span>}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {iv.items.length} ligne(s)
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 15, color: C.green }}>
                    {fmtMoney(interventionTotal(iv))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button style={miniBtn2} onClick={() => setIntervModal({ intervention: iv })}>✎</button>
                    <button style={{ ...miniBtn2, color: C.red }}
                      onClick={() => setConfirmDel({ intervention: iv.id })}>🗑</button>
                  </div>
                </div>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.borderSoft}`, padding: '4px 16px 12px' }}>
                    {iv.items.length === 0 ? (
                      <p style={{ color: C.muted, fontSize: 13, padding: '10px 0' }}>Aucune ligne.</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr>
                            {['Type', 'Désignation', 'Fournisseur', 'Qté', 'P.U. HT', 'Total HT'].map((h, i) => (
                              <th key={h} style={{
                                textAlign: i > 2 ? 'right' : 'left', padding: '8px 8px 6px',
                                fontSize: 11, color: C.muted, textTransform: 'uppercase',
                                letterSpacing: 0.4, borderBottom: `1px solid ${C.borderSoft}`,
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {iv.items.map((it) => (
                            <tr key={it.id}>
                              <td style={cellSm}>{it.type || '—'}</td>
                              <td style={cellSm}>{it.designation || '—'}</td>
                              <td style={cellSm}>{it.fournisseur || '—'}</td>
                              <td style={{ ...cellSm, textAlign: 'right', fontFamily: FONT_MONO }}>
                                {Number(it.quantite)}
                              </td>
                              <td style={{ ...cellSm, textAlign: 'right', fontFamily: FONT_MONO }}>
                                {fmtMoney(it.prix_unitaire)}
                              </td>
                              <td style={{ ...cellSm, textAlign: 'right', fontFamily: FONT_MONO, fontWeight: 700 }}>
                                {fmtMoney(itemTotal(it))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {iv.notes && (
                      <div style={{ fontSize: 13, color: C.muted, marginTop: 10 }}>
                        <strong style={{ color: C.ink }}>Notes :</strong> {iv.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editVehicle && (
        <VehicleModal
          categories={categories} vehicle={vehicle}
          onClose={() => setEditVehicle(false)}
          onSaved={() => { setEditVehicle(false); load(); reloadFleet(); notify('Véhicule mis à jour', 'success') }}
        />
      )}
      {intervModal && (
        <InterventionModal
          vehicleId={vehicleId}
          intervention={intervModal.intervention}
          onClose={() => setIntervModal(null)}
          onSaved={() => { setIntervModal(null); load(); reloadFleet() }}
        />
      )}
      {confirmDel === true && (
        <ConfirmDialog
          message={`Supprimer le véhicule ${vehicle.immatriculation} et tout son historique ?`}
          onConfirm={removeVehicle} onClose={() => setConfirmDel(false)}
        />
      )}
      {confirmDel && confirmDel.intervention && (
        <ConfirmDialog
          message="Supprimer cette intervention et toutes ses lignes ?"
          onConfirm={() => removeIntervention(confirmDel.intervention)}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </div>
  )
}

function InfoCell({ label, value, mono, accent }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={{
        fontSize: 15, fontWeight: 600, fontFamily: mono ? FONT_MONO : 'inherit',
        color: accent ? C.green : C.ink,
      }}>{value}</div>
    </div>
  )
}

const cellSm = { padding: '7px 8px', borderBottom: `1px solid ${C.borderSoft}` }
const miniBtn2 = {
  border: `1px solid ${C.border}`, background: C.panel, borderRadius: 7,
  padding: '5px 9px', fontSize: 13, color: C.ink,
}

/* ════════════════════════════════════════════════════════════
   Modale intervention (formulaire + lignes de pièces)
   ════════════════════════════════════════════════════════════ */
function InterventionModal({ vehicleId, intervention, onClose, onSaved }) {
  const notify = useToast()
  const editing = !!intervention
  const [date, setDate] = useState(intervention?.date || new Date().toISOString().slice(0, 10))
  const [kms, setKms] = useState(intervention?.kms ?? '')
  const [mecaniciens, setMecaniciens] = useState(intervention?.mecaniciens || '')
  const [notes, setNotes] = useState(intervention?.notes || '')
  const [items, setItems] = useState(
    intervention?.items?.length
      ? intervention.items.map((it) => ({
          type: it.type || '', designation: it.designation || '',
          fournisseur: it.fournisseur || '',
          quantite: it.quantite ?? 1, prix_unitaire: it.prix_unitaire ?? 0,
        }))
      : [emptyItem()]
  )
  const [busy, setBusy] = useState(false)

  function emptyItem() {
    return { type: '', designation: '', fournisseur: '', quantite: 1, prix_unitaire: 0 }
  }
  const setItem = (i, k, v) =>
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)))
  const total = items.reduce((s, it) => s + itemTotal(it), 0)

  const save = async () => {
    if (!date) return notify('La date est obligatoire', 'error')
    setBusy(true)
    try {
      const cleanItems = items
        .filter((it) => it.designation.trim() || it.type || Number(it.prix_unitaire))
        .map((it) => ({
          type: it.type, designation: it.designation.trim(),
          fournisseur: it.fournisseur.trim(),
          quantite: Number(it.quantite) || 0,
          prix_unitaire: Number(it.prix_unitaire) || 0,
        }))
      const payload = {
        vehicle_id: vehicleId, date, kms: kms === '' ? null : Number(kms),
        mecaniciens: mecaniciens.trim(), notes: notes.trim(), items: cleanItems,
      }
      await apiFetch(editing ? `/interventions/${intervention.id}` : '/interventions', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      notify('Intervention enregistrée', 'success')
      onSaved()
    } catch (err) {
      notify(err.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Modifier l\'intervention' : 'Nouvelle intervention'} onClose={onClose} width={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 14 }}>
          <Field label="Date">
            <input style={S.input} type="date" value={date}
              onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Kilométrage">
            <input style={S.input} type="number" value={kms}
              onChange={(e) => setKms(e.target.value)} placeholder="km" />
          </Field>
          <Field label="Mécanicien(s)">
            <input style={S.input} value={mecaniciens}
              onChange={(e) => setMecaniciens(e.target.value)} placeholder="Nom du / des intervenant(s)" />
          </Field>
        </div>

        {/* Lignes de pièces */}
        <div>
          <label style={S.label}>Pièces & travaux</label>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {['Type', 'Désignation', 'Fournisseur', 'Qté', 'P.U. HT', 'Total', ''].map((h) => (
                    <th key={h} style={{
                      padding: '7px 8px', fontSize: 10.5, color: C.muted, textAlign: 'left',
                      textTransform: 'uppercase', letterSpacing: 0.4,
                      borderBottom: `1px solid ${C.borderSoft}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={cellEdit}>
                      <select style={inSm} value={it.type}
                        onChange={(e) => setItem(i, 'type', e.target.value)}>
                        <option value="">—</option>
                        {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={cellEdit}>
                      <input style={inSm} value={it.designation}
                        onChange={(e) => setItem(i, 'designation', e.target.value)}
                        placeholder="Description de la pièce / du travail" />
                    </td>
                    <td style={cellEdit}>
                      <input style={inSm} value={it.fournisseur}
                        onChange={(e) => setItem(i, 'fournisseur', e.target.value)}
                        placeholder="Fournisseur" />
                    </td>
                    <td style={{ ...cellEdit, width: 64 }}>
                      <input style={{ ...inSm, textAlign: 'right' }} type="number" value={it.quantite}
                        onChange={(e) => setItem(i, 'quantite', e.target.value)} />
                    </td>
                    <td style={{ ...cellEdit, width: 96 }}>
                      <input style={{ ...inSm, textAlign: 'right' }} type="number" step="0.01"
                        value={it.prix_unitaire}
                        onChange={(e) => setItem(i, 'prix_unitaire', e.target.value)} />
                    </td>
                    <td style={{ ...cellEdit, width: 96, textAlign: 'right', fontFamily: FONT_MONO, fontWeight: 700 }}>
                      {fmtMoney(itemTotal(it))}
                    </td>
                    <td style={{ ...cellEdit, width: 34, textAlign: 'center' }}>
                      <button onClick={() => setItems((a) => a.filter((_, j) => j !== i))}
                        disabled={items.length === 1}
                        style={{
                          border: 'none', background: 'none', color: C.red,
                          fontSize: 16, opacity: items.length === 1 ? 0.3 : 1,
                        }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }}>
            <button style={S.btn} onClick={() => setItems((a) => [...a, emptyItem()])}>
              + Ajouter une ligne
            </button>
            <div style={{ fontSize: 15 }}>
              Total HT :{' '}
              <strong style={{ fontFamily: FONT_MONO, fontSize: 18, color: C.green }}>
                {fmtMoney(total)}
              </strong>
            </div>
          </div>
        </div>

        <Field label="Notes (facultatif)">
          <textarea style={{ ...S.input, minHeight: 56, resize: 'vertical' }} value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={S.btn} onClick={onClose}>Annuler</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy} onClick={save}>
            {busy ? '…' : 'Enregistrer l\'intervention'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const cellEdit = { padding: 4, borderBottom: `1px solid ${C.borderSoft}` }
const inSm = {
  width: '100%', padding: '7px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
  fontSize: 13, background: '#fff', color: C.ink, outline: 'none',
}

/* ════════════════════════════════════════════════════════════
   Documents administratifs — cartes grises & cartes blanches
   ════════════════════════════════════════════════════════════ */
const pillStyle = {
  fontFamily: FONT_MONO, fontWeight: 700, fontSize: 11, color: '#fff',
  padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap',
}

/* Pastille de type de document */
function DocBadge({ type }) {
  const t = DOC_TYPE[type] || DOC_TYPE.autre
  return (
    <span style={{
      display: 'inline-block', background: t.color, color: C.black,
      fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 10.5, letterSpacing: 0.4,
      padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
    }}>{t.label}</span>
  )
}

/* Échéance de validité — même code couleur que le contrôle technique */
function ExpiryPill({ date, empty = '—' }) {
  const info = ctInfo(date)
  if (!info) return <span style={{ color: C.muted }}>{empty}</span>
  const tone = ctTone(info.days)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: FONT_MONO, fontSize: 13 }}>{formatDate(date)}</span>
      <span style={{ ...pillStyle, background: tone.color }}>{tone.label}</span>
    </span>
  )
}

/* Aperçu d'un document — le fichier est chargé en blob (l'API exige le
   jeton) puis affiché dans la modale ; les liens « ouvrir » et
   « télécharger » pointent ensuite sur cette URL locale. */
function DocPreviewModal({ doc, onClose }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    fetchDocBlob(doc.id)
      .then((blob) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [doc.id])

  const isImage = String(doc.mime || '').startsWith('image/')
  return (
    <Modal title={doc.filename || 'Document'} onClose={onClose} width={920}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <DocBadge type={doc.type} />
        <span style={{ fontSize: 13, color: C.muted }}>{fmtFileSize(doc.size)}</span>
        {doc.date_expiration && (
          <span style={{ fontSize: 13 }}>Valide jusqu'au <ExpiryPill date={doc.date_expiration} /></span>
        )}
        <div style={{ flex: 1 }} />
        {url && (
          <>
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ ...S.btn, textDecoration: 'none' }}>↗ Ouvrir</a>
            <a href={url} download={doc.filename || 'document'}
              style={{ ...S.btn, ...S.btnPrimary, textDecoration: 'none' }}>⇓ Télécharger</a>
          </>
        )}
      </div>
      {error ? (
        <p style={{ color: C.red, fontSize: 14 }}>{error}</p>
      ) : !url ? (
        <p style={{ color: C.muted, fontSize: 14, padding: 30, textAlign: 'center' }}>Chargement du document…</p>
      ) : isImage ? (
        <img src={url} alt={doc.filename}
          style={{ width: '100%', borderRadius: 10, border: `1px solid ${C.border}` }} />
      ) : (
        <iframe src={url} title={doc.filename}
          style={{ width: '100%', height: '68vh', border: `1px solid ${C.border}`, borderRadius: 10 }} />
      )}
    </Modal>
  )
}

/* Ajout d'un document (fichier + métadonnées) ou modification des
   métadonnées d'un document existant. */
function DocumentModal({ vehicleId, doc, defaultType = 'carte_grise', onClose, onSaved }) {
  const notify = useToast()
  const editing = !!doc
  const [type, setType] = useState(doc?.type || defaultType)
  const [file, setFile] = useState(null)
  const [delivrance, setDelivrance] = useState(doc?.date_delivrance || '')
  const [expiration, setExpiration] = useState(doc?.date_expiration || '')
  const [numero, setNumero] = useState(doc?.numero || '')
  const [notes, setNotes] = useState(doc?.notes || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!editing && !file) return notify('Sélectionnez un fichier', 'error')
    if (file && file.size > DOC_MAX_BYTES) {
      return notify('Fichier trop volumineux (20 Mo maximum)', 'error')
    }
    setBusy(true)
    try {
      if (editing) {
        await apiFetch(`/documents/${doc.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            type, date_delivrance: delivrance, date_expiration: expiration, numero, notes,
          }),
        })
      } else {
        await apiUpload(`/vehicles/${vehicleId}/documents`, file, {
          type, delivrance, expiration, numero, notes,
        })
      }
      notify(editing ? 'Document mis à jour' : 'Document ajouté', 'success')
      onSaved()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Modifier le document' : 'Ajouter un document'} onClose={onClose} width={520}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Type de document" hint={DOC_TYPE[type]?.hint}>
          <select value={type} onChange={(e) => setType(e.target.value)} style={S.input}>
            {DOC_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </Field>

        {editing ? (
          <Field label="Fichier">
            <div style={{
              padding: '10px 12px', background: C.bg, borderRadius: 9,
              fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <span style={{ flex: 1 }}>{doc.filename}</span>
              <span style={{ color: C.muted }}>{fmtFileSize(doc.size)}</span>
            </div>
          </Field>
        ) : (
          <Field label="Fichier" hint="PDF ou image (JPEG, PNG, WebP) — 20 Mo maximum">
            <input type="file" accept={DOC_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ ...S.input, padding: '8px 10px' }} />
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date de délivrance">
            <input type="date" value={delivrance} onChange={(e) => setDelivrance(e.target.value)}
              style={S.input} />
          </Field>
          <Field label="Fin de validité"
            hint={DOC_TYPE[type]?.expiry ? 'Suivie dans les échéances' : 'Facultatif'}>
            <input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)}
              style={S.input} />
          </Field>
        </div>

        <Field label="Numéro du document">
          <input value={numero} onChange={(e) => setNumero(e.target.value)}
            placeholder="Facultatif" style={{ ...S.input, fontFamily: FONT_MONO }} />
        </Field>

        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Facultatif" style={S.input} />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button style={S.btn} onClick={onClose}>Annuler</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy} onClick={save}>
            {busy ? 'Envoi…' : editing ? 'Enregistrer' : 'Ajouter le document'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* Section « Documents » de la fiche véhicule */
function VehicleDocuments({ vehicleId, immatriculation }) {
  const notify = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // { doc } édition | { defaultType } ajout
  const [preview, setPreview] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    try {
      setDocs(await apiFetch(`/vehicles/${vehicleId}/documents`))
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [vehicleId, notify])

  useEffect(() => { load() }, [load])

  const remove = async (id) => {
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' })
      notify('Document supprimé', 'success')
      load()
    } catch (err) { notify(err.message, 'error') }
  }

  const sorted = [...docs].sort(docSort)
  // Emplacements attendus pour tout véhicule : carte grise + carte blanche
  const missing = DOC_TYPES.filter((t) => t.code !== 'autre' && !docs.some((d) => d.type === t.code))

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 700 }}>
          Documents administratifs
        </h2>
        <button style={S.btn} onClick={() => setModal({ defaultType: missing[0]?.code || 'autre' })}>
          + Ajouter un document
        </button>
      </div>

      {loading ? (
        <div style={{ color: C.muted, fontSize: 14 }}>Chargement des documents…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((d) => (
            <div key={d.id} style={{
              background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '12px 16px', display: 'flex', alignItems: 'center',
              gap: 14, flexWrap: 'wrap',
            }}>
              <DocBadge type={d.type} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.filename}</div>
                <div style={{ fontSize: 11.5, color: C.muted }}>
                  {fmtFileSize(d.size)}
                  {d.numero ? ` · n° ${d.numero}` : ''}
                  {d.date_delivrance ? ` · délivré le ${formatDate(d.date_delivrance)}` : ''}
                  {d.notes ? ` · ${d.notes}` : ''}
                </div>
              </div>
              <div style={{ minWidth: 150 }}>
                <div style={S.label}>Fin de validité</div>
                <ExpiryPill date={d.date_expiration} empty="Sans échéance" />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={miniBtn2} onClick={() => setPreview(d)} title="Consulter">👁</button>
                <button style={miniBtn2} onClick={() => setModal({ doc: d })} title="Modifier">✎</button>
                <button style={{ ...miniBtn2, color: C.red }} title="Supprimer"
                  onClick={() => setConfirmDel(d)}>🗑</button>
              </div>
            </div>
          ))}

          {missing.map((t) => (
            <div key={t.code} style={{
              border: `1px dashed ${C.border}`, borderRadius: 12, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <DocBadge type={t.code} />
              <span style={{ flex: 1, minWidth: 180, fontSize: 13.5, color: C.muted }}>
                Aucun document — {t.hint.toLowerCase()}
              </span>
              <button style={miniBtn2} onClick={() => setModal({ defaultType: t.code })}>
                + Déposer
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <DocumentModal
          vehicleId={vehicleId} doc={modal.doc} defaultType={modal.defaultType}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {confirmDel && (
        <ConfirmDialog
          message={`Supprimer « ${confirmDel.filename} » du véhicule ${immatriculation || ''} ? Le fichier sera définitivement effacé.`}
          onConfirm={() => remove(confirmDel.id)} onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Import en masse — un lot de fichiers rattaché par immatriculation
   ════════════════════════════════════════════════════════════ */
function ImportDocsModal({ vehicles, docs, onClose, onDone }) {
  const notify = useToast()
  const [type, setType] = useState('carte_grise')
  const [rows, setRows] = useState([])          // { key, file, plate, vehicleId, approx, error }
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState(null)

  // Index immatriculation normalisée → véhicule
  const plateIndex = useMemo(() => {
    const map = new Map()
    for (const v of vehicles) {
      const key = normalizePlate(v.immatriculation)
      if (key) map.set(key, v)
    }
    return map
  }, [vehicles])

  const vehicleById = useMemo(
    () => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]
  )
  // Documents déjà présents, par véhicule et par type
  const existing = useMemo(() => {
    const map = {}
    for (const d of docs) (map[`${d.vehicle_id}|${d.type}`] ||= []).push(d)
    return map
  }, [docs])

  const addFiles = (fileList) => {
    setReport(null)
    setRows((prev) => {
      const next = [...prev]
      for (const file of fileList) {
        const key = `${file.name}|${file.size}`
        if (next.some((r) => r.key === key)) continue
        const plate = plateFromFilename(file.name)
        const norm = normalizePlate(plate)
        let vehicle = plateIndex.get(norm) || null
        let approx = false
        // Rapprochement approché : accepté seulement s'il est unique
        if (!vehicle && norm.length >= 6) {
          const near = [...plateIndex.keys()].filter((k) => editDistance(norm, k) <= 1)
          if (near.length === 1) { vehicle = plateIndex.get(near[0]); approx = true }
        }
        next.push({
          key, file, plate, approx,
          vehicleId: vehicle?.id || null,
          error: file.size > DOC_MAX_BYTES ? 'Fichier > 20 Mo' : '',
        })
      }
      return next
    })
  }

  const setVehicle = (key, vehicleId) => {
    setRows((prev) => prev.map((r) =>
      r.key === key ? { ...r, vehicleId: vehicleId ? Number(vehicleId) : null, approx: false } : r
    ))
  }
  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key))

  // État d'une ligne : ce qui sera fait au moment de l'import
  const rowState = (r) => {
    if (r.error) return { code: 'error', label: r.error, color: C.red }
    if (!r.vehicleId) return { code: 'unmatched', label: 'À rattacher', color: C.red }
    const dup = existing[`${r.vehicleId}|${type}`]
    if (dup?.length && !replace) return { code: 'skip', label: 'Déjà présent', color: C.muted }
    if (dup?.length) return { code: 'replace', label: 'Remplacera', color: '#9A6B00' }
    if (r.approx) return { code: 'approx', label: 'Rapprochement approché', color: '#9A6B00' }
    return { code: 'ready', label: 'Prêt', color: C.green }
  }

  const queue = rows.filter((r) => ['ready', 'replace', 'approx'].includes(rowState(r).code))

  const runImport = async () => {
    setBusy(true)
    setProgress(0)
    const done = []
    const failed = []
    for (const r of queue) {
      try {
        await apiUpload(`/vehicles/${r.vehicleId}/documents`, r.file, {
          type,
          // Le marquage « à vérifier » des fichiers source est conservé
          notes: /a\s*v[ée]rifier/i.test(r.file.name) ? 'À vérifier (source)' : '',
        })
        // Remplacement : l'ancien document n'est retiré qu'après succès
        if (replace) {
          for (const old of existing[`${r.vehicleId}|${type}`] || []) {
            await apiFetch(`/documents/${old.id}`, { method: 'DELETE' })
          }
        }
        done.push(r.key)
      } catch (err) {
        failed.push({ name: r.file.name, message: err.message })
      }
      setProgress((p) => p + 1)
    }
    setRows((prev) => prev.filter((r) => !done.includes(r.key)))
    setReport({ ok: done.length, failed })
    setBusy(false)
    if (done.length) notify(`${done.length} document(s) importé(s)`, 'success')
    onDone()
  }

  const counts = rows.reduce((acc, r) => {
    const s = rowState(r).code
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <Modal title="Import en masse de documents" onClose={onClose} width={860}>
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
          Sélectionnez les fichiers : chaque document est rattaché au véhicule
          dont l'immatriculation apparaît dans le nom du fichier
          (ex. <strong>FG-985-VD - CARTE GRISE.pdf</strong>). Les fichiers non
          reconnus restent à rattacher manuellement.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="Type appliqué à tous les fichiers">
              <select value={type} onChange={(e) => setType(e.target.value)} style={S.input}>
                {DOC_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Field label="Fichiers">
              <input type="file" multiple accept={DOC_ACCEPT}
                onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }}
                style={{ ...S.input, padding: '8px 10px' }} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, paddingBottom: 10 }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Remplacer les documents existants
          </label>
        </div>

        {rows.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: C.muted, flexWrap: 'wrap' }}>
              <span><strong style={{ color: C.ink }}>{rows.length}</strong> fichier(s)</span>
              <span><strong style={{ color: C.green }}>{queue.length}</strong> à importer</span>
              {counts.unmatched > 0 && <span style={{ color: C.red }}>{counts.unmatched} à rattacher</span>}
              {counts.skip > 0 && <span>{counts.skip} déjà présent(s)</span>}
              {counts.approx > 0 && <span style={{ color: '#9A6B00' }}>{counts.approx} rapprochement(s) approché(s) — à vérifier</span>}
            </div>

            {counts.approx > 0 && (
              <div style={{
                background: '#FDF3DC', border: '1px solid #E0C67A', borderRadius: 10,
                padding: '10px 13px', fontSize: 13, lineHeight: 1.45,
              }}>
                <strong>{counts.approx} fichier(s) rapproché(s) de façon approchée</strong> —
                l'immatriculation lue diffère d'un caractère de celle du véhicule proposé.
                Vérifiez la colonne « Véhicule » avant d'importer.
              </div>
            )}

            <div style={{
              maxHeight: 340, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 10,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {['Fichier', 'Immatriculation lue', 'Véhicule', 'Statut', ''].map((h) => (
                      <th key={h} style={{
                        ...thBase, textAlign: 'left', position: 'sticky', top: 0, zIndex: 1,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = rowState(r)
                    const v = r.vehicleId ? vehicleById[r.vehicleId] : null
                    const manual = !v || r.approx
                    return (
                      <tr key={r.key}>
                        <td style={{ ...cellSm, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.file.name}
                          <div style={{ color: C.muted, fontSize: 11 }}>{fmtFileSize(r.file.size)}</div>
                        </td>
                        <td style={{ ...cellSm, fontFamily: FONT_MONO }}>{r.plate || '—'}</td>
                        <td style={cellSm}>
                          {manual ? (
                            <select value={r.vehicleId || ''} onChange={(e) => setVehicle(r.key, e.target.value)}
                              style={{ ...inSm, minWidth: 190 }}>
                              <option value="">— choisir un véhicule —</option>
                              {vehicles.map((veh) => (
                                <option key={veh.id} value={veh.id}>
                                  {veh.immatriculation || `#${veh.id}`} — {[veh.marque, veh.modele].filter(Boolean).join(' ')}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontFamily: FONT_MONO }}>{v.immatriculation}</span>
                          )}
                        </td>
                        <td style={{ ...cellSm, color: st.color, fontWeight: 600 }}>{st.label}</td>
                        <td style={{ ...cellSm, textAlign: 'right' }}>
                          <button style={{ ...miniBtn2, padding: '3px 7px' }}
                            onClick={() => removeRow(r.key)} title="Retirer de la liste">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {report && (
          <div style={{
            background: C.bg, borderRadius: 10, padding: '12px 14px', fontSize: 13,
          }}>
            <strong>{report.ok} document(s) importé(s).</strong>
            {report.failed.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 18, color: C.red }}>
                {report.failed.map((f) => <li key={f.name}>{f.name} — {f.message}</li>)}
              </ul>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          {busy && (
            <span style={{ fontSize: 13, color: C.muted, marginRight: 'auto' }}>
              Import en cours… {progress}/{queue.length}
            </span>
          )}
          <button style={S.btn} onClick={onClose}>{report ? 'Fermer' : 'Annuler'}</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy || queue.length === 0}
            onClick={runImport}>
            {busy ? 'Import…' : `Importer ${queue.length} document(s)`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ════════════════════════════════════════════════════════════
   Page Documents — état documentaire de toute la flotte
   ════════════════════════════════════════════════════════════ */
const DOC_FILTERS = [
  { code: 'all', label: 'Tous les véhicules' },
  { code: 'missing_cg', label: 'Sans carte grise' },
  { code: 'missing_cb', label: 'Sans carte blanche' },
  { code: 'expiring', label: 'Échéance sous 90 jours' },
  { code: 'expired', label: 'Validité dépassée' },
]

/* Cellule d'un type de document dans le tableau : le fichier présent
   (consulter / modifier l'échéance) ou un dépôt rapide. */
function DocTypeCell({ doc, onConsult, onEdit, onAdd }) {
  if (!doc) {
    return (
      <button style={{ ...miniBtn2, color: C.muted, fontSize: 12 }} onClick={onAdd}>
        + Déposer
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button style={{ ...miniBtn2, fontSize: 12 }} onClick={() => onConsult(doc)}
        title={doc.filename}>📄 Consulter</button>
      <button style={{ ...miniBtn2, fontSize: 12, padding: '5px 7px' }}
        onClick={() => onEdit(doc)} title="Modifier l'échéance">✎</button>
    </div>
  )
}

function DocumentsPage({ categories, vehicles, onOpenVehicle }) {
  const notify = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [importOpen, setImportOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [editDoc, setEditDoc] = useState(null)
  const [addFor, setAddFor] = useState(null)   // { vehicleId, type }

  const load = useCallback(async () => {
    try {
      setDocs(await apiFetch('/documents'))
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { load() }, [load])

  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]
  )
  const byVehicle = useMemo(() => {
    const map = {}
    for (const d of docs) (map[d.vehicle_id] ||= []).push(d)
    return map
  }, [docs])

  const docOf = (vehicleId, type) => (byVehicle[vehicleId] || []).find((d) => d.type === type)

  // Compteurs d'en-tête
  const stats = useMemo(() => {
    const s = { cg: 0, cb: 0, expiring: 0, expired: 0 }
    for (const v of vehicles) {
      if (docOf(v.id, 'carte_grise')) s.cg++
      if (docOf(v.id, 'carte_blanche')) s.cb++
    }
    for (const d of docs) {
      const info = ctInfo(d.date_expiration)
      if (!info) continue
      if (info.days < 0) s.expired++
      else if (info.days <= 90) s.expiring++
    }
    return s
  }, [vehicles, docs, byVehicle])

  const q = search.trim().toLowerCase()
  const rows = vehicles.filter((v) => {
    if (q && ![v.marque, v.modele, v.immatriculation].some((x) => (x || '').toLowerCase().includes(q))) {
      return false
    }
    const list = byVehicle[v.id] || []
    if (filter === 'missing_cg') return !docOf(v.id, 'carte_grise')
    if (filter === 'missing_cb') return !docOf(v.id, 'carte_blanche')
    if (filter === 'expiring') {
      return list.some((d) => { const i = ctInfo(d.date_expiration); return i && i.days >= 0 && i.days <= 90 })
    }
    if (filter === 'expired') {
      return list.some((d) => { const i = ctInfo(d.date_expiration); return i && i.days < 0 })
    }
    return true
  })

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 24, fontWeight: 700 }}>Documents</h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>
          Cartes grises, cartes blanches et suivi des dates de validité — {vehicles.length} véhicules
        </p>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 12, marginBottom: 18,
      }}>
        <Kpi label="Cartes grises" value={`${stats.cg} / ${vehicles.length}`}
          sub={`${vehicles.length - stats.cg} manquante(s)`} mono
          tone={stats.cg === vehicles.length ? 'ok' : 'warn'} />
        <Kpi label="Cartes blanches" value={`${stats.cb} / ${vehicles.length}`}
          sub={`${vehicles.length - stats.cb} manquante(s)`} mono
          tone={stats.cb === vehicles.length ? 'ok' : 'warn'} />
        <Kpi label="Échéances sous 90 j" value={String(stats.expiring)}
          sub="documents à renouveler" mono tone={stats.expiring ? 'warn' : 'ok'} />
        <Kpi label="Validité dépassée" value={String(stats.expired)}
          sub="documents expirés" mono tone={stats.expired ? 'danger' : 'ok'} />
      </div>

      <div className="no-print" style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14,
      }}>
        <input placeholder="Rechercher (marque, modèle, immatriculation)…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 320 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ ...S.input, maxWidth: 230 }}>
          {DOC_FILTERS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
        </select>
        <span style={{ fontSize: 13, color: C.muted }}>{rows.length} véhicule(s)</span>
        <div style={{ flex: 1 }} />
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setImportOpen(true)}>
          ⇪ Import en masse
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: C.muted, padding: 60 }}>Chargement des documents…</div>
      ) : (
        <div className="tablewrap" style={{
          background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
          overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
        }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900, fontSize: 13 }}>
            <thead>
              <tr>
                {['Véhicule', 'Catégorie', 'Carte grise', 'Carte blanche', 'Fin de validité', 'Autres', ''].map((h, i) => (
                  <th key={h} style={{
                    ...thBase, textAlign: 'left', minWidth: [190, 130, 150, 150, 175, 80, 70][i],
                    position: 'sticky', top: 0, zIndex: 2,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} style={{ ...tdBase, color: C.muted, fontStyle: 'italic' }}>
                  Aucun véhicule ne correspond à ce filtre.
                </td></tr>
              ) : rows.map((v) => {
                const cat = categoryById[v.category_id]
                const list = byVehicle[v.id] || []
                const cb = docOf(v.id, 'carte_blanche')
                const others = list.filter((d) => d.type === 'autre')
                // Échéance affichée : la plus proche, tous documents confondus
                const nextExpiry = list.map((d) => d.date_expiration).filter(Boolean).sort()[0]
                return (
                  <tr key={v.id}>
                    <td style={tdBase}>
                      <div style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>
                        {v.immatriculation || '—'}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted }}>
                        {[v.marque, v.modele].filter(Boolean).join(' ') || '—'}
                      </div>
                    </td>
                    <td style={tdBase}>
                      {cat && (
                        <span style={{
                          background: cat.color, color: C.black, fontSize: 11,
                          fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                        }}>{cat.name}</span>
                      )}
                    </td>
                    <td style={tdBase}>
                      <DocTypeCell doc={docOf(v.id, 'carte_grise')}
                        onConsult={setPreview} onEdit={setEditDoc}
                        onAdd={() => setAddFor({ vehicleId: v.id, type: 'carte_grise' })} />
                    </td>
                    <td style={tdBase}>
                      <DocTypeCell doc={cb}
                        onConsult={setPreview} onEdit={setEditDoc}
                        onAdd={() => setAddFor({ vehicleId: v.id, type: 'carte_blanche' })} />
                    </td>
                    <td style={tdBase}>
                      <ExpiryPill date={nextExpiry} empty={cb ? 'Non renseignée' : '—'} />
                    </td>
                    <td style={{ ...tdBase, color: others.length ? C.ink : C.muted }}>
                      {others.length || '—'}
                    </td>
                    <td style={tdBase}>
                      <button style={{ ...miniBtn2, fontSize: 12 }}
                        onClick={() => onOpenVehicle(v.id)}>Fiche →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && (
        <ImportDocsModal
          vehicles={vehicles} docs={docs}
          onClose={() => setImportOpen(false)} onDone={load}
        />
      )}
      {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {editDoc && (
        <DocumentModal
          vehicleId={editDoc.vehicle_id} doc={editDoc}
          onClose={() => setEditDoc(null)}
          onSaved={() => { setEditDoc(null); load() }}
        />
      )}
      {addFor && (
        <DocumentModal
          vehicleId={addFor.vehicleId} defaultType={addFor.type}
          onClose={() => setAddFor(null)}
          onSaved={() => { setAddFor(null); load() }}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Présence Pérols — feuille de présence hebdomadaire
   ════════════════════════════════════════════════════════════ */
function PresencePage() {
  const notify = useToast()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const weekStart = ymd(monday)
  const weekNum = isoWeek(monday)
  const dayDates = DAY_KEYS.map((_, i) => addDays(monday, i))
  const range = `du ${ddmm(dayDates[0])} au ${ddmm(dayDates[6])} ${dayDates[6].getFullYear()}`

  const [drivers, setDrivers] = useState([])
  const [responsable, setResponsable] = useState('')
  const [grid, setGrid] = useState({})
  const [loading, setLoading] = useState(true)
  const [teamModal, setTeamModal] = useState(false)
  const [saveState, setSaveState] = useState('saved') // 'saving' | 'saved'
  const [sendConfirm, setSendConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const skipSave = useRef(true)

  // Chargement de la semaine
  useEffect(() => {
    let alive = true
    setLoading(true)
    skipSave.current = true
    Promise.all([apiFetch('/presence/drivers'), apiFetch('/presence/week/' + weekStart)])
      .then(([drv, wk]) => {
        if (!alive) return
        setDrivers(drv)
        setResponsable(wk.responsable || '')
        setGrid(wk.entries || {})
      })
      .catch((err) => { if (alive) notify(err.message, 'error') })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        setSaveState('saved')
        setTimeout(() => { skipSave.current = false }, 0)
      })
    return () => { alive = false }
  }, [weekStart, notify])

  // Enregistrement automatique (anti-rebond 700 ms)
  useEffect(() => {
    if (skipSave.current || loading) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      try {
        const entries = {}
        for (const d of drivers) entries[d.id] = grid[d.id] || {}
        await apiFetch('/presence/week/' + weekStart, {
          method: 'PUT',
          body: JSON.stringify({ responsable, entries }),
        })
        setSaveState('saved')
      } catch (err) {
        notify(err.message, 'error')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [responsable, grid, drivers, weekStart, loading, notify])

  const setCell = (driverId, dayKey, value) =>
    setGrid((g) => ({ ...g, [driverId]: { ...(g[driverId] || {}), [dayKey]: value } }))

  const send = async () => {
    setSending(true)
    try {
      await sendMail(
        `Présence Pérols — Semaine ${weekNum}`,
        buildPresenceEmailHtml({ weekNum, range, responsable, drivers, grid, dayDates })
      )
      notify(`Tableau envoyé à ${MAIL_TO}`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Barre d'outils */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btn} onClick={() => setMonday((m) => mondayOf(addDays(m, -7)))}>◀</button>
          <button style={S.btn} onClick={() => setMonday(mondayOf(new Date()))}>Cette semaine</button>
          <button style={S.btn} onClick={() => setMonday((m) => mondayOf(addDays(m, 7)))}>▶</button>
        </div>
        <span style={{ fontSize: 13, color: C.muted }}>
          {saveState === 'saving' ? 'Enregistrement…' : 'Enregistré ✓'}
        </span>
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setTeamModal(true)}>👥 Gérer l'équipe</button>
        <button style={S.btn} onClick={() => doPrint('portrait')}>🖨 Imprimer</button>
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={sending || loading}
          onClick={() => setSendConfirm(true)}>
          {sending ? 'Envoi…' : '✉ Envoyer à la direction'}
        </button>
      </div>

      {/* Zone imprimable */}
      <div className="print-area" style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 24px',
      }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 700 }}>
          PRÉSENCE PÉROLS — SEMAINE {weekNum}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{range}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 14px', flexWrap: 'wrap' }}>
          <label style={{ ...S.label, marginBottom: 0 }}>Nom du responsable</label>
          <input value={responsable} onChange={(e) => setResponsable(e.target.value)}
            placeholder="Responsable d'équipe" style={{ ...S.input, maxWidth: 260 }} />
          <span style={{ fontSize: 13, color: C.muted }}>Signature : ______________________</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Chargement…</div>
        ) : drivers.length === 0 ? (
          <div style={{
            padding: 36, textAlign: 'center', color: C.muted,
            border: `1px dashed ${C.border}`, borderRadius: 10,
          }}>
            Aucun chauffeur. Cliquez sur « Gérer l'équipe » pour renseigner votre équipe.
          </div>
        ) : (
          <div className="tablewrap" style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left', minWidth: 150 }}>NOM</th>
                  {DAYS.map((d, i) => (
                    <th key={d} style={{ ...thBase, minWidth: 80 }}>
                      {d}<br />
                      <span style={{ fontWeight: 400, fontSize: 10.5 }}>{ddmm(dayDates[i])}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupByCategory(drivers).map((g) => (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td colSpan={1 + DAY_KEYS.length} style={{
                        ...tdBase, background: '#EDECE4', fontWeight: 800, fontSize: 11.5,
                        letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted,
                        padding: '6px 8px',
                      }}>{g.plural}</td>
                    </tr>
                    {g.drivers.map((dr) => (
                      <tr key={dr.id}>
                        <td style={{ ...tdBase, fontWeight: 600 }}>{dr.nom}</td>
                        {DAY_KEYS.map((k, i) => {
                          const v = effectiveCode(dayDates[i], (grid[dr.id] || {})[k])
                          return (
                            <td key={k} style={{ ...tdBase, padding: 3, textAlign: 'center' }}>
                              <select value={v} onChange={(e) => setCell(dr.id, k, e.target.value)}
                                style={{
                                  width: '100%', padding: '6px 2px', borderRadius: 6, fontSize: 13,
                                  fontWeight: 600, border: `1px solid ${C.border}`,
                                  textAlign: 'center', textAlignLast: 'center',
                                  background: CODE_BG[v] || '#fff', color: C.ink,
                                }}>
                                <option value="">—</option>
                                {PRESENCE_CODES.map((c) => (
                                  <option key={c.code} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Légende */}
        <div style={{ marginTop: 16 }}>
          <div style={S.label}>Légende</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PRESENCE_CODES.map((c) => (
              <span key={c.code} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                background: c.bg, padding: '3px 9px', borderRadius: 20,
              }}>
                <strong>{c.code}</strong> {c.meaning}
              </span>
            ))}
          </div>
        </div>
      </div>

      {teamModal && (
        <TeamModal drivers={drivers} onClose={() => setTeamModal(false)}
          onSaved={(newList) => {
            setTeamModal(false)
            setDrivers(newList)
            setGrid((g) => {
              const ids = new Set(newList.map((d) => String(d.id)))
              const next = {}
              for (const k of Object.keys(g)) if (ids.has(String(k))) next[k] = g[k]
              return next
            })
            notify('Équipe mise à jour', 'success')
          }} />
      )}
      {sendConfirm && (
        <ConfirmDialog
          message={`Envoyer le tableau de présence de la semaine ${weekNum} à ${MAIL_TO} ?`}
          confirmLabel="Envoyer" onConfirm={send} onClose={() => setSendConfirm(false)}
        />
      )}
    </div>
  )
}

function TeamModal({ drivers, onClose, onSaved }) {
  const notify = useToast()
  const [list, setList] = useState(() => drivers.map((d) => ({
    id: d.id, nom: d.nom, categorie: normCategory(d.categorie),
  })))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    // Tri par catégorie (Dépanneur → Mécanicien → Chauffeur) tout en
    // conservant l'ordre relatif au sein de chaque groupe : la position
    // sauvegardée correspond à l'index dans le payload envoyé.
    const grouped = []
    for (const cat of CATEGORIES) {
      for (const d of list) {
        if (d.nom.trim() && normCategory(d.categorie) === cat.key) {
          grouped.push({ id: d.id, nom: d.nom.trim(), categorie: cat.key })
        }
      }
    }
    setBusy(true)
    try {
      const saved = await apiFetch('/presence/drivers', {
        method: 'PUT', body: JSON.stringify(grouped),
      })
      onSaved(saved)
    } catch (err) {
      notify(err.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Équipe de Pérols" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
          Ajoutez, renommez ou retirez les membres de l'équipe. La catégorie
          détermine l'affichage par section ; les <b>Chauffeurs</b> n'apparaissent
          pas sur le Planning.
        </p>
        {list.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...S.input, flex: 1 }} value={d.nom} placeholder="Nom"
              onChange={(e) => setList((l) => l.map((x, j) =>
                j === i ? { ...x, nom: e.target.value.toUpperCase() } : x))} />
            <select value={d.categorie} style={{ ...S.input, width: 140 }}
              onChange={(e) => setList((l) => l.map((x, j) =>
                j === i ? { ...x, categorie: e.target.value } : x))}>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <button style={{ ...S.btn, ...S.btnDanger, padding: '9px 13px' }}
              onClick={() => setList((l) => l.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button style={S.btn}
          onClick={() => setList((l) => [...l, { nom: '', categorie: 'depanneur' }])}>
          + Ajouter un membre
        </button>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={S.btn} onClick={onClose}>Annuler</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} disabled={busy} onClick={save}>
            {busy ? '…' : 'Enregistrer l\'équipe'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ════════════════════════════════════════════════════════════
   Récapitulatif mensuel — reconstitué depuis Présence Pérols
   (lecture seule des codes ; seule l'annotation est éditable)
   ════════════════════════════════════════════════════════════ */
function MonthlyRecap() {
  const notify = useToast()
  const [anchor, setAnchor] = useState(() => firstOfMonth(new Date()))
  const monthKey = ym(anchor)
  const month = anchor.getMonth() + 1
  const monthLabel = `${MONTHS_FULL[month - 1]} ${anchor.getFullYear()}`
  const periodDays = useMemo(() => recapPeriod(anchor), [anchor])
  const from = periodDays.length ? ymd(periodDays[0]) : ''
  const to = periodDays.length ? ymd(periodDays[periodDays.length - 1]) : ''
  const periodLabel = periodDays.length
    ? `du ${ddmm(periodDays[0])} au ${ddmm(periodDays[periodDays.length - 1])} ${periodDays[periodDays.length - 1].getFullYear()}`
    : ''

  const [drivers, setDrivers] = useState([])
  const [responsable, setResponsable] = useState('')
  const [presence, setPresence] = useState({}) // { driverId: { isoDate: code } } — depuis la présence
  const [annotations, setAnnotations] = useState({}) // { driverId: texte }
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState('saved') // 'saving' | 'saved'
  const skipSave = useRef(true)

  // Chargement : équipe + présence de la période + annotations/responsable du récap
  useEffect(() => {
    let alive = true
    setLoading(true)
    skipSave.current = true
    Promise.all([
      apiFetch('/presence/drivers'),
      apiFetch(`/presence/range/${from}/${to}`),
      apiFetch('/recap/' + monthKey),
    ])
      .then(([drv, range, rec]) => {
        if (!alive) return
        setDrivers(drv)
        setPresence(range.entries || {})
        setResponsable(rec.responsable || '')
        const anns = {}
        for (const [id, e] of Object.entries(rec.entries || {})) anns[id] = e.annotation || ''
        setAnnotations(anns)
      })
      .catch((err) => { if (alive) notify(err.message, 'error') })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        setSaveState('saved')
        setTimeout(() => { skipSave.current = false }, 0)
      })
    return () => { alive = false }
  }, [monthKey, from, to, notify])

  // Enregistrement automatique du responsable + annotations (anti-rebond 700 ms)
  useEffect(() => {
    if (skipSave.current || loading) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      try {
        const entries = {}
        for (const d of drivers) entries[d.id] = { days: {}, annotation: annotations[d.id] || '' }
        await apiFetch('/recap/' + monthKey, {
          method: 'PUT',
          body: JSON.stringify({ responsable, entries }),
        })
        setSaveState('saved')
      } catch (err) {
        notify(err.message, 'error')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [responsable, annotations, drivers, monthKey, loading, notify])

  const setAnnotation = (driverId, value) =>
    setAnnotations((a) => ({ ...a, [driverId]: value }))

  const downloadPdf = () =>
    generateRecapPdf({
      monthLabel, responsable, drivers, presence, annotations, periodDays,
      fileName: `recap_${monthKey}.pdf`,
    })

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* Barre d'outils */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btn} onClick={() => setAnchor((a) => addMonths(a, -1))}>◀</button>
          <button style={S.btn} onClick={() => setAnchor(firstOfMonth(new Date()))}>Ce mois</button>
          <button style={S.btn} onClick={() => setAnchor((a) => addMonths(a, 1))}>▶</button>
        </div>
        <span style={{ fontSize: 13, color: C.muted }}>
          {saveState === 'saving' ? 'Enregistrement…' : 'Enregistré ✓'}
        </span>
        <div style={{ flex: 1 }} />
        <button style={S.btn} disabled={loading} onClick={downloadPdf}>⬇ Télécharger PDF</button>
      </div>

      {/* Zone du tableau */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 24px',
      }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 700, textTransform: 'uppercase' }}>
          Récapitulatif mensuel — {monthLabel}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>Période {periodLabel}</p>
        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
          Reconstitué automatiquement depuis <strong>Présence Pérols</strong> ·
          seule la colonne <strong>Annotation</strong> est éditable ici.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 14px', flexWrap: 'wrap' }}>
          <label style={{ ...S.label, marginBottom: 0 }}>Nom du responsable</label>
          <input value={responsable} onChange={(e) => setResponsable(e.target.value)}
            placeholder="Responsable d'équipe" style={{ ...S.input, maxWidth: 260 }} />
          <span style={{ fontSize: 13, color: C.muted }}>Signature : ______________________</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Chargement…</div>
        ) : drivers.length === 0 ? (
          <div style={{
            padding: 36, textAlign: 'center', color: C.muted,
            border: `1px dashed ${C.border}`, borderRadius: 10,
          }}>
            Aucun employé. L'équipe se gère depuis l'onglet « Présence Pérols » (elle est partagée avec cet onglet et le Suivi Frank).
          </div>
        ) : (
          <div className="tablewrap" style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{
                    ...thBase, textAlign: 'left', minWidth: 130, position: 'sticky', left: 0, zIndex: 3,
                  }}>NOM</th>
                  {periodDays.map((dt) => (
                    <th key={ymd(dt)} style={{
                      ...thBase, minWidth: 30, padding: '6px 2px',
                      background: isWeekendDate(dt) ? '#DCDAD0' : '#EDECE4',
                    }}>
                      <div style={{ fontSize: 9.5, color: C.muted }}>{WEEKDAY_LETTERS[dt.getDay()]}</div>
                      {dt.getDate()}
                    </th>
                  ))}
                  <th style={{ ...thBase, textAlign: 'left', minWidth: 130 }}>Annotation</th>
                </tr>
              </thead>
              <tbody>
                {groupByCategory(drivers).map((g) => (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td colSpan={2 + periodDays.length} style={{
                        ...tdBase, background: '#EDECE4', fontWeight: 800, fontSize: 11.5,
                        letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted,
                        padding: '6px 8px', position: 'sticky', left: 0, zIndex: 2,
                      }}>{g.plural}</td>
                    </tr>
                    {g.drivers.map((dr) => {
                      const dayMap = presence[dr.id] || {}
                      return (
                        <tr key={dr.id}>
                          <td style={{
                            ...tdBase, fontWeight: 600, position: 'sticky', left: 0, zIndex: 1,
                            background: C.panel,
                          }}>{dr.nom}</td>
                          {periodDays.map((dt) => {
                            const code = effectiveCode(dt, dayMap[ymd(dt)])
                            return (
                              <td key={ymd(dt)} style={{
                                ...tdBase, padding: '5px 2px', textAlign: 'center',
                                fontWeight: 600, fontSize: 11.5,
                                background: CODE_BG[code] || '#fff',
                              }}>
                                {code || ''}
                              </td>
                            )
                          })}
                          <td style={{ ...tdBase, padding: 3 }}>
                            <input value={annotations[dr.id] || ''}
                              onChange={(ev) => setAnnotation(dr.id, ev.target.value)}
                              placeholder="Informations supplémentaires…"
                              style={{ ...inSm, fontSize: 12 }} />
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Légende */}
        <div style={{ marginTop: 16 }}>
          <div style={S.label}>Légende</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PRESENCE_CODES.map((c) => (
              <span key={c.code} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                background: c.bg, padding: '3px 9px', borderRadius: 20,
              }}>
                <strong>{c.code}</strong> {c.meaning}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Suivi Frank — récapitulatif des astreintes (auto-rempli)
   ════════════════════════════════════════════════════════════ */
function FrankPage() {
  const notify = useToast()
  const [anchor, setAnchor] = useState(() => firstOfMonth(new Date()))
  const monthKey = ym(anchor)
  const month = anchor.getMonth() + 1
  const monthLabel = `${MONTHS_FULL[month - 1]} ${anchor.getFullYear()}`
  const periodDays = useMemo(() => recapPeriod(anchor), [anchor])
  const from = periodDays.length ? ymd(periodDays[0]) : ''
  const to = periodDays.length ? ymd(periodDays[periodDays.length - 1]) : ''
  const periodLabel = periodDays.length
    ? `du ${ddmm(periodDays[0])} au ${ddmm(periodDays[periodDays.length - 1])} ${periodDays[periodDays.length - 1].getFullYear()}`
    : ''

  const [drivers, setDrivers] = useState([])
  const [presence, setPresence] = useState({}) // { driverId: { isoDate: code } }
  const [annotations, setAnnotations] = useState({}) // { driverId: texte }
  const [mailTo, setMailTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [sendConfirm, setSendConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  // Lecture seule : présence de la période + annotations du récap + adresse Frank
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      apiFetch('/presence/drivers'),
      apiFetch(`/presence/range/${from}/${to}`),
      apiFetch('/recap/' + monthKey),
      apiFetch('/frank-config'),
    ])
      .then(([drv, range, rec, cfg]) => {
        if (!alive) return
        setDrivers(drv)
        setPresence(range.entries || {})
        const anns = {}
        for (const [id, e] of Object.entries(rec.entries || {})) anns[id] = e.annotation || ''
        setAnnotations(anns)
        setMailTo(cfg.mailTo || '')
      })
      .catch((err) => { if (alive) notify(err.message, 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [monthKey, from, to, notify])

  const rows = useMemo(
    () => buildFrankRows(drivers, presence, annotations, periodDays),
    [drivers, presence, annotations, periodDays]
  )

  const saveMailTo = async () => {
    try {
      const d = await apiFetch('/frank-config', {
        method: 'PUT', body: JSON.stringify({ mailTo: mailTo.trim() }),
      })
      setMailTo(d.mailTo)
    } catch (err) { notify(err.message, 'error') }
  }

  const downloadPdf = () =>
    generateFrankPdf({ monthLabel, periodLabel, rows, fileName: `suivi_frank_${monthKey}.pdf` })

  const send = async () => {
    const dest = mailTo.trim()
    if (!dest) { notify('Renseignez d\'abord l\'adresse de Frank', 'error'); return }
    setSending(true)
    try {
      // On enregistre l'adresse avant l'envoi : le serveur n'autorise que
      // les destinataires persistés dans les réglages.
      await apiFetch('/frank-config', {
        method: 'PUT', body: JSON.stringify({ mailTo: dest }),
      })
      await sendMail(
        `Suivi Frank — ${monthLabel}`,
        buildFrankEmailHtml({ monthLabel, periodLabel, rows }),
        dest
      )
      notify(`Suivi envoyé à ${dest}`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Barre d'outils */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btn} onClick={() => setAnchor((a) => addMonths(a, -1))}>◀</button>
          <button style={S.btn} onClick={() => setAnchor(firstOfMonth(new Date()))}>Ce mois</button>
          <button style={S.btn} onClick={() => setAnchor((a) => addMonths(a, 1))}>▶</button>
        </div>
        <div style={{ flex: 1 }} />
        <button style={S.btn} disabled={loading} onClick={downloadPdf}>⬇ Télécharger PDF</button>
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={sending || loading}
          onClick={() => setSendConfirm(true)}>
          {sending ? 'Envoi…' : '✉ Envoyer à Frank'}
        </button>
      </div>

      {/* Adresse de Frank */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px',
      }}>
        <label style={{ ...S.label, marginBottom: 0 }}>Adresse e-mail de Frank</label>
        <input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)}
          onBlur={saveMailTo} placeholder="frank@exemple.com"
          style={{ ...S.input, maxWidth: 320, fontFamily: FONT_MONO }} />
        <span style={{ fontSize: 12, color: C.muted }}>
          Mémorisée · le bouton « Envoyer à Frank » l'utilise comme destinataire.
        </span>
      </div>

      {/* Tableau */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 24px',
      }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 700, textTransform: 'uppercase' }}>
          Suivi Frank — {monthLabel}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
          Récapitulatif des astreintes · période {periodLabel}
        </p>
        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
          Rempli automatiquement à partir du <strong>Récapitulatif mensuel</strong>
          {' '}(codes A · rj · r · C) et de sa colonne Annotation.
        </p>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Chargement…</div>
        ) : drivers.length === 0 ? (
          <div style={{
            padding: 36, textAlign: 'center', color: C.muted,
            border: `1px dashed ${C.border}`, borderRadius: 10, marginTop: 14,
          }}>
            Aucun employé. Renseignez l'équipe depuis l'onglet Récapitulatif mensuel.
          </div>
        ) : (
          <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left', minWidth: 110 }}>NOM</th>
                  {FRANK_COLS.map((c) => (
                    <th key={c.key} style={{ ...thBase, textAlign: 'left', minWidth: c.key === 'info' ? 220 : 150 }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupFrankRows(rows).map((g) => (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td colSpan={1 + FRANK_COLS.length} style={{
                        ...tdBase, background: '#EDECE4', fontWeight: 800, fontSize: 11.5,
                        letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted,
                        padding: '6px 8px',
                      }}>{g.plural}</td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.nom} className="veh-row">
                        <td style={{ ...tdBase, fontWeight: 600, verticalAlign: 'top' }}>{r.nom}</td>
                        {FRANK_COLS.map((c) => (
                          <td key={c.key} style={{
                            ...tdBase, verticalAlign: 'top',
                            fontFamily: c.key === 'info' ? 'inherit' : FONT_MONO,
                            fontSize: c.key === 'info' ? 13 : 12.5,
                            color: r[c.key] ? C.ink : C.muted,
                          }}>
                            {r[c.key] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sendConfirm && (
        <ConfirmDialog
          message={`Envoyer le suivi des astreintes de ${monthLabel} à ${mailTo.trim() || '(aucune adresse renseignée)'} ?`}
          confirmLabel="Envoyer" onConfirm={send} onClose={() => setSendConfirm(false)}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Planning hebdomadaire — grille lun→dim, affichage atelier
   ════════════════════════════════════════════════════════════ */
function PlanningPage() {
  const notify = useToast()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const weekStart = ymd(monday)
  const weekNum = isoWeek(monday)
  const dayDates = DAY_KEYS.map((_, i) => addDays(monday, i))
  const range = `du ${ddmm(dayDates[0])} au ${ddmm(dayDates[6])} ${dayDates[6].getFullYear()}`

  const [drivers, setDrivers] = useState([])
  const [grid, setGrid] = useState({})
  const [special, setSpecial] = useState({}) // { lun..dim: texte } — opération spéciale
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState('saved') // 'saving' | 'saved'
  const skipSave = useRef(true)

  // Le planning n'inclut pas les chauffeurs (visibles uniquement sur la
  // page Présence). On dérive la liste filtrée pour l'affichage et la
  // sauvegarde — aucune entrée planning n'est jamais créée pour eux.
  const planningDrivers = useMemo(
    () => drivers.filter((d) => normCategory(d.categorie) !== 'chauffeur'),
    [drivers]
  )

  // Chargement de la semaine
  useEffect(() => {
    let alive = true
    setLoading(true)
    skipSave.current = true
    Promise.all([apiFetch('/presence/drivers'), apiFetch('/planning/week/' + weekStart)])
      .then(([drv, wk]) => {
        if (!alive) return
        setDrivers(drv)
        setGrid(wk.entries || {})
        setSpecial(wk.special || {})
      })
      .catch((err) => { if (alive) notify(err.message, 'error') })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        setSaveState('saved')
        setTimeout(() => { skipSave.current = false }, 0)
      })
    return () => { alive = false }
  }, [weekStart, notify])

  // Enregistrement automatique (anti-rebond 700 ms)
  useEffect(() => {
    if (skipSave.current || loading) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      try {
        const entries = {}
        for (const d of planningDrivers) entries[d.id] = grid[d.id] || {}
        await apiFetch('/planning/week/' + weekStart, {
          method: 'PUT',
          body: JSON.stringify({ entries, special }),
        })
        setSaveState('saved')
      } catch (err) {
        notify(err.message, 'error')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [grid, special, planningDrivers, weekStart, loading, notify])

  const setCell = (driverId, dayKey, value) =>
    setGrid((g) => ({ ...g, [driverId]: { ...(g[driverId] || {}), [dayKey]: value } }))
  const setSpecialCell = (dayKey, value) =>
    setSpecial((s) => ({ ...s, [dayKey]: value }))

  const downloadPdf = () =>
    generatePlanningPdf({ weekNum, range, drivers: planningDrivers, grid, special, dayDates, fileName: `planning_S${weekNum}_${weekStart}.pdf` })

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* Barre d'outils */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btn} onClick={() => setMonday((m) => mondayOf(addDays(m, -7)))}>◀</button>
          <button style={S.btn} onClick={() => setMonday(mondayOf(new Date()))}>Cette semaine</button>
          <button style={S.btn} onClick={() => setMonday((m) => mondayOf(addDays(m, 7)))}>▶</button>
        </div>
        <span style={{ fontSize: 13, color: C.muted }}>
          {saveState === 'saving' ? 'Enregistrement…' : 'Enregistré ✓'}
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={loading} onClick={downloadPdf}>
          ⬇ Télécharger PDF
        </button>
      </div>

      {/* Zone imprimable */}
      <div className="print-area planning-area" style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 24px',
      }}>
        <h1 style={{ fontFamily: FONT_HEAD, fontSize: 24, fontWeight: 700, textTransform: 'uppercase' }}>
          Planning — Semaine {weekNum}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{range}</p>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Chargement…</div>
        ) : planningDrivers.length === 0 ? (
          <div style={{
            padding: 36, textAlign: 'center', color: C.muted,
            border: `1px dashed ${C.border}`, borderRadius: 10, marginTop: 14,
          }}>
            Aucun dépanneur ni mécanicien. L'équipe se gère depuis l'onglet « Présence Pérols ».
          </div>
        ) : (
          <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left', minWidth: 150, fontSize: 13 }}>ÉQUIPE</th>
                  {DAYS.map((d, i) => {
                    const wknd = i >= 5
                    const ferie = isFrenchHoliday(dayDates[i])
                    return (
                      <th key={d} style={{
                        ...thBase, minWidth: 110, fontSize: 13,
                        background: ferie ? '#F2D2A9' : wknd ? '#DCDAD0' : '#EDECE4',
                      }}>
                        {d}<br />
                        <span style={{ fontWeight: 400, fontSize: 11 }}>{ddmm(dayDates[i])}</span>
                        {ferie && (
                          <div style={{ fontWeight: 700, fontSize: 10, color: '#5A3E00' }}>Férié</div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {groupByCategory(planningDrivers).map((g) => (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td colSpan={1 + DAY_KEYS.length} style={{
                        ...tdBase, background: '#EDECE4', fontWeight: 800, fontSize: 11.5,
                        letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted,
                        padding: '6px 8px',
                      }}>{g.plural}</td>
                    </tr>
                    {g.drivers.map((dr) => (
                      <tr key={dr.id}>
                        <td style={{ ...tdBase, fontWeight: 700, fontSize: 14 }}>{dr.nom}</td>
                        {DAY_KEYS.map((k, i) => {
                          const v = effectivePlanningCode(dayDates[i], (grid[dr.id] || {})[k])
                          return (
                            <td key={k} style={{ ...tdBase, padding: 4, textAlign: 'center' }}>
                              <select value={v} onChange={(e) => setCell(dr.id, k, e.target.value)}
                                style={{
                                  width: '100%', padding: '10px 4px', borderRadius: 7, fontSize: 13.5,
                                  fontWeight: 700, border: `1px solid ${C.border}`,
                                  textAlign: 'center', textAlignLast: 'center',
                                  background: PLANNING_BG[v] || '#fff', color: C.ink,
                                }}>
                                <option value="">—</option>
                                {PLANNING_OPTIONS.map((o) => (
                                  <option key={o.code} value={o.code}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {/* Dernière ligne — Opération spéciale : texte libre par jour,
                    flashy si rempli, police réduite pour les libellés longs */}
                <tr>
                  <td style={{
                    ...tdBase, fontWeight: 800, fontSize: 11, textTransform: 'uppercase',
                    letterSpacing: 0.3, color: '#fff', background: SPECIAL_BG,
                  }}>Opération spéciale</td>
                  {DAY_KEYS.map((k) => {
                    const v = special[k] || ''
                    return (
                      <td key={k} style={{
                        ...tdBase, padding: 4, textAlign: 'center',
                        background: v ? SPECIAL_BG : undefined,
                      }}>
                        <input value={v} onChange={(e) => setSpecialCell(k, e.target.value)}
                          placeholder="—" title={v}
                          style={{
                            width: '100%', padding: '7px 4px', borderRadius: 7, fontSize: 10.5,
                            fontWeight: 600, border: `1px solid ${v ? SPECIAL_BG : C.border}`,
                            textAlign: 'center',
                            background: v ? SPECIAL_BG : '#fff',
                            color: v ? '#fff' : C.ink,
                          }} />
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Légende */}
        <div style={{ marginTop: 18 }}>
          <div style={S.label}>Légende</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {PLANNING_OPTIONS.map((o) => (
              <span key={o.code} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13,
                background: o.bg, color: C.ink,
                padding: '5px 12px', borderRadius: 20, fontWeight: 600,
              }}>
                {o.label}
              </span>
            ))}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13,
              background: SPECIAL_BG, color: '#fff',
              padding: '5px 12px', borderRadius: 20, fontWeight: 600,
            }}>
              Opération spéciale (dernière ligne)
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Indicateurs — tableau de pilotage de la flotte
   ════════════════════════════════════════════════════════════ */
/* Carte de chiffre-clé */
function Kpi({ label, value, sub, tone, mono }) {
  const color = tone === 'danger' ? C.red
    : tone === 'warn' ? '#9A6B00'
    : tone === 'ok' ? C.green : C.ink
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ ...S.label, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{
          fontFamily: mono ? FONT_MONO : FONT_HEAD,
          fontSize: 23, fontWeight: 700, color,
        }}>{value}</span>
        {sub && <span style={{ fontSize: 13, color: C.muted }}>{sub}</span>}
      </div>
    </div>
  )
}

/* Bloc de section */
function StatPanel({ title, children }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '18px 20px', marginBottom: 18,
    }}>
      <h2 style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

/* Petit chiffre sur fond doux */
function MiniStat({ label, value }) {
  return (
    <div style={{ background: C.bg, borderRadius: 9, padding: '11px 13px' }}>
      <div style={{ ...S.label, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 700, color: C.green }}>
        {value}
      </div>
    </div>
  )
}

/* Barre horizontale */
function HBar({ label, value, max, color = C.green, display }) {
  const pct = max > 0 && value > 0 ? Math.max(3, (value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
      <div style={{
        width: 160, fontSize: 12.5, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={label}>{label}</div>
      <div style={{ flex: 1, background: C.bg, borderRadius: 5, height: 20, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 5 }} />
      </div>
      <div style={{
        width: 100, textAlign: 'right', fontFamily: FONT_MONO,
        fontWeight: 700, fontSize: 12.5,
      }}>{display}</div>
    </div>
  )
}

/* Histogramme 12 mois */
function MonthBars({ data }) {
  const max = Math.max(1, ...data)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 124 }}>
      {data.map((n, i) => (
        <div key={i} style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 4,
        }}>
          <span style={{
            fontSize: 11, fontFamily: FONT_MONO, fontWeight: 700,
            color: n ? C.ink : 'transparent',
          }}>{n || '0'}</span>
          <div style={{
            width: '100%', height: Math.max(3, (n / max) * 80),
            background: i + 1 === CURRENT_MONTH ? C.green : '#C6D9C2',
            borderRadius: '4px 4px 0 0',
          }} />
          <span style={{ fontSize: 9.5, color: C.muted }}>{MONTHS_SHORT[i]}</span>
        </div>
      ))}
    </div>
  )
}

const statSubTitle = { ...S.label, marginBottom: 11 }
const statEmpty = { fontSize: 13, color: C.muted, fontStyle: 'italic', padding: '6px 0' }

/* Tranches d'âge — base du plan de renouvellement */
const AGE_BUCKETS = [
  { label: '< 5 ans', color: '#C6E0B4' },
  { label: '5-10 ans', color: '#E8E4A0' },
  { label: '10-15 ans', color: '#F2D2A9' },
  { label: '+ 15 ans', color: '#E59A9A' },
]
function ageBucket(years) {
  if (years < 5) return 0
  if (years < 10) return 1
  if (years < 15) return 2
  return 3
}
/* Nb minimum de véhicules suivis avant d'activer les modules de coûts */
const MIN_TRACKED = 5

/* Barre empilée — pyramide des âges d'une catégorie */
function AgeStack({ buckets }) {
  const total = buckets.reduce((s, n) => s + n, 0)
  return (
    <div style={{
      display: 'flex', flex: 1, height: 20, borderRadius: 5,
      overflow: 'hidden', background: C.bg,
    }}>
      {total > 0 && buckets.map((n, i) => (
        n > 0 ? (
          <div key={i} title={`${AGE_BUCKETS[i].label} : ${n}`}
            style={{ width: (n / total * 100) + '%', background: AGE_BUCKETS[i].color }} />
        ) : null
      ))}
    </div>
  )
}

function StatsPage({ categories, vehicles }) {
  const notify = useToast()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/stats')
      .then(setStats)
      .catch((err) => notify(err.message, 'error'))
      .finally(() => setLoading(false))
  }, [notify])

  const interventions = stats?.interventions || []
  const byType = stats?.byType || []

  /* Agrégat coût / nombre / dernière interv. par véhicule */
  const perVehicle = useMemo(() => {
    const m = {}
    for (const iv of interventions) {
      const e = (m[iv.vehicle_id] ||= { cost: 0, count: 0, lastDate: '', lastKm: null })
      e.cost += Number(iv.total) || 0
      e.count += 1
      if ((iv.date || '') > e.lastDate) { e.lastDate = iv.date || ''; e.lastKm = iv.kms }
    }
    return m
  }, [interventions])

  /* ── Échéances CT ── */
  const ctUpcoming = useMemo(() => {
    const out = []
    for (const v of vehicles) {
      const info = ctInfo(v.ct_date)
      if (info && info.days <= 60) out.push({ v, ...info })
    }
    return out.sort((a, b) => a.days - b.days)
  }, [vehicles])

  const ctMissing = useMemo(() => vehicles.filter((v) => !v.ct_date), [vehicles])

  const ctByMonth = useMemo(() => {
    const arr = Array(12).fill(0)
    for (const v of vehicles) {
      const d = parseIsoDate(v.ct_date)
      if (d) arr[d.getMonth()]++
    }
    return arr
  }, [vehicles])

  /* ── Statut du parc ── */
  const { activeCount, statutKnown } = useMemo(() => {
    let active = 0, known = 0
    for (const v of vehicles) {
      if (v.statut) known++
      if (v.statut === 'Actif') active++
    }
    return { activeCount: active, statutKnown: known }
  }, [vehicles])

  /* ── Composition ── */
  const byCategory = useMemo(() => categories.map((c) => ({
    cat: c, count: vehicles.filter((v) => v.category_id === c.id).length,
  })), [categories, vehicles])

  /* ── Âge par catégorie + pyramide des âges ── */
  const ageByCategory = useMemo(() => categories.map((c) => {
    const list = vehicles.filter((v) => v.category_id === c.id)
    const buckets = [0, 0, 0, 0]
    let sum = 0, n = 0
    for (const v of list) {
      const a = ageYears(v.date_mec)
      if (a == null) continue
      sum += a; n++; buckets[ageBucket(a)]++
    }
    return { cat: c, avg: n ? sum / n : null, aged: n, buckets }
  }), [categories, vehicles])

  const ageUnknown = useMemo(
    () => vehicles.filter((v) => ageYears(v.date_mec) == null).length, [vehicles])

  /* ── Qualité des données ── */
  const dataQuality = useMemo(() => {
    const total = vehicles.length || 1
    const rate = (pred) => {
      const count = vehicles.filter(pred).length
      return { count, pct: Math.round((count / total) * 100) }
    }
    return [
      { label: 'Immatriculation', ...rate((v) => (v.immatriculation || '').trim()) },
      { label: '1ère mise en circulation', ...rate((v) => ageYears(v.date_mec) != null) },
      { label: 'Date de contrôle technique', ...rate((v) => v.ct_date) },
      { label: 'Statut du véhicule', ...rate((v) => v.statut) },
      { label: 'PTAC', ...rate((v) => Number(v.ptac) > 0) },
      { label: 'Usage (VASP / TCP)', ...rate((v) => v.usage_type) },
      { label: 'Numéro de série', ...rate((v) => (v.numero_serie || '').trim()) },
    ]
  }, [vehicles])

  /* ── Coûts ── */
  const totalCost = useMemo(
    () => interventions.reduce((s, iv) => s + (Number(iv.total) || 0), 0), [interventions])
  const yearItems = useMemo(
    () => interventions.filter((iv) => (iv.date || '').startsWith(String(CURRENT_YEAR))),
    [interventions])
  const yearCost = yearItems.reduce((s, iv) => s + (Number(iv.total) || 0), 0)
  const avgCost = interventions.length ? totalCost / interventions.length : 0

  const topVehicles = useMemo(() => vehicles
    .map((v) => ({ v, ...(perVehicle[v.id] || { cost: 0, count: 0 }) }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5), [vehicles, perVehicle])

  /* ── Activité atelier ── */
  const trackedVehicles = useMemo(
    () => vehicles.filter((v) => perVehicle[v.id]), [vehicles, perVehicle])
  const oldestService = useMemo(() => trackedVehicles
    .map((v) => ({ v, ...perVehicle[v.id] }))
    .filter((x) => x.lastDate)
    .sort((a, b) => a.lastDate.localeCompare(b.lastDate))
    .slice(0, 6), [trackedVehicles, perVehicle])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', color: C.muted, padding: 80, fontSize: 15 }}>
        Chargement des indicateurs…
      </div>
    )
  }

  const dataReady = trackedVehicles.length >= MIN_TRACKED
  const ctMissingPct = vehicles.length
    ? Math.round((ctMissing.length / vehicles.length) * 100) : 0
  const maxCat = Math.max(1, ...byCategory.map((x) => x.count))
  const maxTop = Math.max(1, ...topVehicles.map((x) => x.cost))
  const typeRows = byType.filter((t) => Number(t.total) > 0)
  const maxType = Math.max(1, ...typeRows.map((t) => Number(t.total)))
  const col2 = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 26,
  }
  const gridStats = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12, marginBottom: 18,
  }

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* En-tête */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        flexWrap: 'wrap', gap: 12, marginBottom: 18,
      }}>
        <div>
          <h1 style={{ fontFamily: FONT_HEAD, fontSize: 24, fontWeight: 700 }}>Indicateurs</h1>
          <p style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>
            Pilotage de la flotte — {vehicles.length} véhicules · au {formatDate(ymd(new Date()))}
          </p>
        </div>
        <button className="no-print" style={S.btn} onClick={() => doPrint('portrait')}>
          🖨 Imprimer
        </button>
      </div>

      {/* Alerte critique — véhicules sans CT planifié */}
      {ctMissing.length > 0 && (
        <div style={{
          background: '#FBEAEA', border: `1px solid ${C.red}`,
          borderLeft: `5px solid ${C.red}`, borderRadius: 10,
          padding: '14px 18px', marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 26, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 16, color: C.red }}>
              {ctMissing.length} véhicules sans date de CT planifiée
            </div>
            <div style={{ fontSize: 13, color: C.ink, marginTop: 3 }}>
              Soit {ctMissingPct} % de la flotte. Aucune échéance ne peut être anticipée
              tant que la date n'est pas renseignée — à traiter en priorité.
            </div>
          </div>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 32, color: C.red }}>
            {ctMissingPct} %
          </span>
        </div>
      )}

      {/* Bandeau de chiffres-clés */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        <Kpi label="Véhicules" value={vehicles.length} />
        <Kpi label="Véhicules actifs"
          value={statutKnown ? activeCount : '—'}
          sub={statutKnown ? `sur ${vehicles.length}` : 'statut à renseigner'}
          tone={statutKnown ? undefined : 'warn'} />
        <Kpi label="CT sous 60 jours" value={ctUpcoming.length}
          tone={ctUpcoming.length ? 'warn' : 'ok'} />
        {dataReady && (
          <Kpi label={'Coût maintenance ' + CURRENT_YEAR} value={fmtMoney(yearCost)} mono />
        )}
        {dataReady && (
          <Kpi label={'Interventions ' + CURRENT_YEAR} value={yearItems.length} />
        )}
      </div>

      {/* Qualité des données */}
      <StatPanel title="Qualité des données">
        <p style={{ fontSize: 13, color: C.muted, margin: '-6px 0 14px' }}>
          Taux de complétude des champs clés. Les indicateurs ci-dessous ne sont
          fiables que sur les données effectivement renseignées.
        </p>
        {dataQuality.map((d) => (
          <HBar key={d.label} label={d.label} value={d.pct} max={100}
            color={d.pct >= 80 ? C.green : d.pct >= 40 ? '#9A6B00' : C.red}
            display={`${d.count}/${vehicles.length} · ${d.pct}%`} />
        ))}
      </StatPanel>

      {/* Échéances de contrôle technique */}
      <StatPanel title="Échéances de contrôle technique">
        <div style={col2}>
          <div>
            <div style={statSubTitle}>Contrôles dans les 60 prochains jours</div>
            {ctUpcoming.length === 0 ? (
              <div style={statEmpty}>Aucun CT à échéance dans les 60 jours.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ctUpcoming.map(({ v, date, days }) => {
                  const tone = ctTone(days)
                  return (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', background: C.bg, borderRadius: 8,
                    }}>
                      <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13 }}>
                        {v.immatriculation || '—'}
                      </span>
                      <span style={{
                        flex: 1, fontSize: 12, color: C.muted, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {[v.marque, v.modele].filter(Boolean).join(' ')}
                      </span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12.5 }}>{ddmm(date)}</span>
                      <span style={{
                        fontFamily: FONT_MONO, fontWeight: 700, fontSize: 11, color: '#fff',
                        padding: '2px 7px', borderRadius: 20, background: tone.color,
                      }}>{tone.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div>
            <div style={statSubTitle}>Répartition des CT sur l'année</div>
            <MonthBars data={ctByMonth} />
            <div style={{
              marginTop: 12, fontSize: 12.5,
              color: ctMissing.length ? C.red : C.muted,
            }}>
              {ctMissing.length
                ? `⚠ ${ctMissing.length} véhicule(s) sans mois de CT renseigné`
                : 'Tous les véhicules ont un mois de CT renseigné.'}
            </div>
          </div>
        </div>
      </StatPanel>

      {/* Composition de la flotte */}
      <StatPanel title="Composition de la flotte">
        <div style={statSubTitle}>Véhicules par catégorie</div>
        {byCategory.length === 0 ? (
          <div style={statEmpty}>Aucune catégorie.</div>
        ) : byCategory.map(({ cat, count }) => (
          <HBar key={cat.id} label={cat.name} value={count} max={maxCat}
            color={cat.color} display={count + ' véh.'} />
        ))}
      </StatPanel>

      {/* Âge de la flotte */}
      <StatPanel title="Âge de la flotte">
        <p style={{ fontSize: 13, color: C.muted, margin: '-6px 0 14px' }}>
          Âge moyen et répartition par tranche d'âge, catégorie par catégorie —
          base du plan de renouvellement.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          {AGE_BUCKETS.map((b) => (
            <span key={b.label} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: C.muted,
            }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
        {ageByCategory.map(({ cat, avg, aged, buckets }) => (
          <div key={cat.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9,
          }}>
            <div style={{
              width: 160, fontSize: 12.5, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }} title={cat.name}>{cat.name}</div>
            {aged === 0 ? (
              <div style={{ flex: 1, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
                aucune date connue
              </div>
            ) : (
              <AgeStack buckets={buckets} />
            )}
            <div style={{
              width: 100, textAlign: 'right', fontFamily: FONT_MONO,
              fontWeight: 700, fontSize: 12.5,
            }}>{avg != null ? avg.toFixed(1) + ' ans' : '—'}</div>
          </div>
        ))}
        {ageUnknown > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
            {ageUnknown} véhicule(s) sans date de 1ère MEC — non comptabilisés ci-dessus.
          </div>
        )}
      </StatPanel>

      {dataReady ? (
        <>
          {/* Coûts de maintenance */}
          <StatPanel title="Coûts de maintenance">
            <div style={gridStats}>
              <MiniStat label="Coût total (historique)" value={fmtMoney(totalCost)} />
              <MiniStat label={'Coût ' + CURRENT_YEAR} value={fmtMoney(yearCost)} />
              <MiniStat label="Coût moyen / intervention" value={fmtMoney(avgCost)} />
              <MiniStat label="Interventions chiffrées" value={interventions.length} />
            </div>
            <div style={col2}>
              <div>
                <div style={statSubTitle}>Top 5 véhicules les plus coûteux</div>
                {topVehicles.length === 0 ? (
                  <div style={statEmpty}>Aucune intervention chiffrée pour le moment.</div>
                ) : topVehicles.map(({ v, cost, count }) => (
                  <HBar key={v.id}
                    label={`${v.immatriculation || '—'} · ${count} interv.`}
                    value={cost} max={maxTop} display={fmtMoney(cost)} />
                ))}
              </div>
              <div>
                <div style={statSubTitle}>Coûts par type de pièce</div>
                {typeRows.length === 0 ? (
                  <div style={statEmpty}>Aucune donnée de coût.</div>
                ) : typeRows.map((t) => (
                  <HBar key={t.type} label={t.type} value={Number(t.total)}
                    max={maxType} color={C.blue} display={fmtMoney(t.total)} />
                ))}
              </div>
            </div>
          </StatPanel>

          {/* Activité atelier */}
          <StatPanel title="Activité atelier">
            <div style={gridStats}>
              <MiniStat label="Véhicules avec historique"
                value={`${trackedVehicles.length} / ${vehicles.length}`} />
              <MiniStat label="Interventions totales" value={interventions.length} />
              <MiniStat label={'Interventions ' + CURRENT_YEAR} value={yearItems.length} />
              <MiniStat label="Sans intervention enregistrée"
                value={vehicles.length - trackedVehicles.length} />
            </div>
            <div style={statSubTitle}>Entretiens les plus anciens (véhicules suivis)</div>
            {oldestService.length === 0 ? (
              <div style={statEmpty}>Aucun historique d'intervention enregistré.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560,
                }}>
                  <thead>
                    <tr>
                      {['Immatriculation', 'Véhicule', 'Dernière intervention', 'Dernier km', 'Interv.']
                        .map((h, i) => (
                          <th key={h} style={{ ...thBase, textAlign: i > 2 ? 'right' : 'left' }}>{h}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {oldestService.map(({ v, lastDate, lastKm, count }) => (
                      <tr key={v.id}>
                        <td style={{ ...tdBase, fontFamily: FONT_MONO, fontWeight: 700 }}>
                          {v.immatriculation || '—'}
                        </td>
                        <td style={tdBase}>
                          {[v.marque, v.modele].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td style={{ ...tdBase, fontFamily: FONT_MONO }}>{formatDate(lastDate)}</td>
                        <td style={{ ...tdBase, fontFamily: FONT_MONO, textAlign: 'right' }}>
                          {fmtKm(lastKm)}
                        </td>
                        <td style={{ ...tdBase, textAlign: 'right' }}>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </StatPanel>
        </>
      ) : (
        <StatPanel title="Modules en cours de déploiement">
          <p style={{ fontSize: 13.5, color: C.muted, margin: '-6px 0 14px' }}>
            Ces indicateurs s'activeront automatiquement dès qu'assez de données
            d'intervention auront été saisies. Actuellement {trackedVehicles.length}{' '}
            véhicule(s) sur {vehicles.length} disposent d'un historique d'intervention.
          </p>
          {[
            ['Coûts de maintenance', 'Dépenses par véhicule, par type de pièce et par fournisseur.'],
            ['Top des véhicules les plus coûteux', "Classement des véhicules par coût d'entretien cumulé."],
            ['Coûts par type de pièce', 'Répartition des dépenses : freins, pneus, vidange, filtres…'],
            ['Activité atelier', 'Interventions, kilométrage et véhicules à entretenir en priorité.'],
          ].map(([t, d]) => (
            <div key={t} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '11px 13px', background: C.bg, borderRadius: 9, marginBottom: 8,
            }}>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: C.muted,
                background: C.borderSoft, padding: '3px 8px', borderRadius: 20,
                whiteSpace: 'nowrap', marginTop: 1,
              }}>🔒 Bientôt</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t}</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{d}</div>
              </div>
            </div>
          ))}
        </StatPanel>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   App — gestion de l'authentification
   ════════════════════════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(() => localStorage.getItem('flotte-user'))
  const [hasToken, setHasToken] = useState(() => !!localStorage.getItem('flotte-token'))

  const logout = useCallback(() => {
    localStorage.removeItem('flotte-token')
    localStorage.removeItem('flotte-user')
    setHasToken(false)
    setUser(null)
  }, [])

  useEffect(() => { handleUnauthorized = logout }, [logout])

  return (
    <ToastHost>
      {hasToken && user ? (
        <FlotteApp user={user} onLogout={logout} onUserChange={setUser} />
      ) : (
        <LoginScreen onAuth={(u) => { setUser(u); setHasToken(true) }} />
      )}
    </ToastHost>
  )
}
