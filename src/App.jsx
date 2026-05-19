import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react'

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

const ITEM_TYPES = ['Filtre à air', 'Filtre à huile', 'Filtre à gasoil',
  'Freins AV', 'Freins AR', 'Passage aux mines', 'Vidange', 'Pneumatiques', 'Autre']

const VEHICLE_STATUTS = ['Actif', 'Stocké', 'En cession', 'Hors service']

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
]
const CODE_BG = Object.fromEntries(PRESENCE_CODES.map((c) => [c.code, c.bg]))
const MAIL_TO = 'compta@montpellierdepannage.com'

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
  const head = `<tr><th style="${th};text-align:left">NOM</th>` +
    DAYS.map((d, i) => `<th style="${th}">${d}<br><span style="font-weight:400">${ddmm(dayDates[i])}</span></th>`).join('') +
    '</tr>'
  const body = drivers.map((dr) => {
    const row = grid[dr.id] || {}
    return `<tr><td style="${td};font-weight:600">${esc(dr.nom)}</td>` +
      DAY_KEYS.map((k) => {
        const v = row[k] || ''
        const bg = CODE_BG[v] || '#fff'
        return `<td style="${td};text-align:center;background:${bg}">${esc(v)}</td>`
      }).join('') + '</tr>'
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

async function sendMail(subject, html) {
  return apiFetch('/send-mail', { method: 'POST', body: JSON.stringify({ subject, html }) })
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
  const active = ['presence', 'stats'].includes(view.name) ? view.name : 'dashboard'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        user={user} onLogout={onLogout} onUserChange={onUserChange} active={active}
        onNav={(n) => (n === 'presence' ? goPresence() : n === 'stats' ? goStats() : goDashboard())}
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
        ) : view.name === 'stats' ? (
          <StatsPage categories={categories} vehicles={vehicles} />
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
        {navBtn('stats', 'Indicateurs')}
        {navBtn('presence', 'Présence Pérols')}
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
    !q || [v.marque, v.modele, v.immatriculation].some((x) => (x || '').toLowerCase().includes(q))

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
          placeholder="Rechercher (marque, modèle, immatriculation)…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 320 }}
        />
        {q && <span style={{ fontSize: 13, color: C.muted }}>{totalShown} résultat(s)</span>}
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setCategoryModal({})}>+ Catégorie</button>
        <button style={S.btn} onClick={() => doPrint('portrait')}>🖨 Imprimer</button>
      </div>

      {/* Tableau */}
      <div className="tablewrap" style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
          <thead>
            <tr>
              {['Marque', 'Modèle', 'Immatriculation', '1ère MEC', 'Prochain CT'].map((h, i) => (
                <th key={h} style={{
                  ...thBase, textAlign: 'left', minWidth: [120, 140, 150, 100, 190][i],
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
                    <td colSpan={5} style={{
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
                    <tr><td colSpan={5} style={{ ...tdBase, color: C.muted, fontStyle: 'italic' }}>
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
                {drivers.map((dr) => (
                  <tr key={dr.id}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{dr.nom}</td>
                    {DAY_KEYS.map((k) => {
                      const v = (grid[dr.id] || {})[k] || ''
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
  const [list, setList] = useState(() => drivers.map((d) => ({ id: d.id, nom: d.nom })))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const clean = list.filter((d) => d.nom.trim()).map((d) => ({ id: d.id, nom: d.nom.trim() }))
    setBusy(true)
    try {
      const saved = await apiFetch('/presence/drivers', {
        method: 'PUT', body: JSON.stringify(clean),
      })
      onSaved(saved)
    } catch (err) {
      notify(err.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Équipe de Pérols" onClose={onClose} width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
          Ajoutez, renommez ou retirez les chauffeurs de l'équipe.
        </p>
        {list.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input style={S.input} value={d.nom} placeholder="Nom du chauffeur"
              onChange={(e) => setList((l) => l.map((x, j) =>
                j === i ? { ...x, nom: e.target.value.toUpperCase() } : x))} />
            <button style={{ ...S.btn, ...S.btnDanger, padding: '9px 13px' }}
              onClick={() => setList((l) => l.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button style={S.btn} onClick={() => setList((l) => [...l, { nom: '' }])}>
          + Ajouter un chauffeur
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

  /* ── Échéances assurance ── */
  const assuranceUpcoming = useMemo(() => {
    const out = []
    for (const v of vehicles) {
      const info = ctInfo(v.assurance_date)
      if (info && info.days <= 60) out.push({ v, ...info })
    }
    return out.sort((a, b) => a.days - b.days)
  }, [vehicles])

  const assuranceMissing = useMemo(
    () => vehicles.filter((v) => !v.assurance_date), [vehicles])

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
      { label: "Échéance d'assurance", ...rate((v) => v.assurance_date) },
      { label: 'Statut du véhicule', ...rate((v) => v.statut) },
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
        <Kpi label="Assurances sous 60 jours" value={assuranceUpcoming.length}
          tone={assuranceUpcoming.length ? 'warn' : 'ok'} />
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

      {/* Échéances d'assurance */}
      <StatPanel title="Échéances d'assurance">
        <div style={col2}>
          <div>
            <div style={statSubTitle}>Assurances à renouveler sous 60 jours</div>
            {assuranceUpcoming.length === 0 ? (
              <div style={statEmpty}>Aucune échéance d'assurance dans les 60 jours.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {assuranceUpcoming.map(({ v, date, days }) => {
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
            <div style={statSubTitle}>État du suivi</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MiniStat label="À renouveler sous 60 jours" value={assuranceUpcoming.length} />
              <MiniStat label="Sans échéance renseignée"
                value={`${assuranceMissing.length} / ${vehicles.length}`} />
            </div>
            {assuranceMissing.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: C.red }}>
                ⚠ {assuranceMissing.length} véhicule(s) sans date d'assurance renseignée
              </div>
            )}
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
