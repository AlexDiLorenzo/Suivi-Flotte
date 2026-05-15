import React, { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react'

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

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const MONTHS_SHORT = ['JAN', 'FÉV', 'MARS', 'AVR', 'MAI', 'JUIN',
  'JUIL', 'AOÛT', 'SEP', 'OCT', 'NOV', 'DÉC']

const ITEM_TYPES = ['Filtre à air', 'Filtre à huile', 'Filtre à gasoil',
  'Freins AV', 'Freins AR', 'Passage aux mines', 'Vidange', 'Pneumatiques', 'Autre']

const CATEGORY_PALETTE = ['#F4C7D9', '#F2EAB6', '#C9B8DC', '#F2D2A9', '#B7D7E8',
  '#C6E0B4', '#E8E4A0', '#F9E79F', '#BFE6C4', '#AEC8E8']

const CURRENT_MONTH = new Date().getMonth() + 1

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
    <div style={{
      width: size, height: size, borderRadius: size * 0.26, background: C.green,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, color: C.yellow, fontSize: size * 0.4 }}>MD</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Application — racine authentifiée
   ════════════════════════════════════════════════════════════ */
function FlotteApp({ user, onLogout }) {
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar user={user} onLogout={onLogout} onHome={goDashboard} />
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
        ) : (
          <VehicleDetail
            vehicleId={view.id} categories={categories}
            onBack={goDashboard} reloadFleet={loadData}
          />
        )}
      </div>
    </div>
  )
}

function TopBar({ user, onLogout, onHome }) {
  return (
    <header style={{
      background: C.panel, borderBottom: `1px solid ${C.border}`,
      padding: '12px clamp(14px, 3vw, 36px)', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 50,
    }}>
      <button onClick={onHome} style={{
        border: 'none', background: 'none', display: 'flex',
        alignItems: 'center', gap: 11, padding: 0,
      }}>
        <Logo />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 17, lineHeight: 1 }}>FLOTTE</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>Montpellier Dépannage</div>
        </div>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 13.5, color: C.muted }}>
          Connecté : <strong style={{ color: C.ink }}>{user}</strong>
        </span>
        <button style={S.btn} onClick={onLogout}>Déconnexion</button>
      </div>
    </header>
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
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          placeholder="Rechercher (marque, modèle, immatriculation)…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 360 }}
        />
        {q && <span style={{ fontSize: 13, color: C.muted }}>{totalShown} résultat(s)</span>}
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setCategoryModal({})}>+ Catégorie</button>
      </div>

      {/* Tableau */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1080, fontSize: 13 }}>
          <thead>
            <tr>
              {['Marque', 'Modèle', 'Immatriculation', '1ère MEC'].map((h, i) => (
                <th key={h} style={{
                  ...thBase, textAlign: 'left', minWidth: [120, 140, 150, 100][i],
                  position: 'sticky', top: 0, zIndex: 2,
                }}>{h}</th>
              ))}
              {MONTHS_SHORT.map((m, i) => (
                <th key={m} style={{
                  ...thBase, width: 46, minWidth: 46,
                  background: i + 1 === CURRENT_MONTH ? C.yellow : '#EDECE4',
                  position: 'sticky', top: 0, zIndex: 2,
                }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const list = (byCategory[cat.id] || []).filter(matches)
              if (q && list.length === 0) return null
              return (
                <React.Fragment key={cat.id}>
                  <tr>
                    <td colSpan={16} style={{
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
                        <button onClick={() => setCategoryModal({ category: cat })}
                          style={miniBtn} title="Modifier la catégorie">✎</button>
                        <button onClick={() => setVehicleModal({ categoryId: cat.id })}
                          style={{ ...miniBtn, fontWeight: 700 }}>+ Véhicule</button>
                      </div>
                    </td>
                  </tr>
                  {list.length === 0 ? (
                    <tr><td colSpan={16} style={{ ...tdBase, color: C.muted, fontStyle: 'italic' }}>
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
                      {MONTHS_SHORT.map((_, i) => {
                        const isCt = v.ct_month === i + 1
                        return (
                          <td key={i} style={{
                            ...tdBase, textAlign: 'center', padding: 3,
                            background: i + 1 === CURRENT_MONTH ? '#FCFBE4' : undefined,
                          }}>
                            {isCt && (
                              <span style={{
                                display: 'inline-block', minWidth: 24, padding: '3px 5px',
                                background: C.green, color: '#fff', borderRadius: 6,
                                fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12,
                              }}>{v.ct_day || '•'}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
            {categories.length === 0 && (
              <tr><td colSpan={16} style={{ ...tdBase, textAlign: 'center', color: C.muted, padding: 40 }}>
                Aucune catégorie. Créez-en une pour commencer.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Légende */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: C.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 22, height: 16, background: C.green, borderRadius: 4, display: 'inline-block' }} />
          Jour du contrôle technique
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 22, height: 16, background: C.yellow, borderRadius: 4, display: 'inline-block' }} />
          Mois en cours
        </span>
        <span>🔧 = interventions enregistrées · cliquez sur un véhicule pour ouvrir sa fiche</span>
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
    ct_month: vehicle?.ct_month || '',
    ct_day: vehicle?.ct_day || '',
    notes: vehicle?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.category_id) return notify('Choisissez une catégorie', 'error')
    setBusy(true)
    try {
      const payload = {
        ...form,
        ct_month: form.ct_month ? Number(form.ct_month) : null,
        ct_day: form.ct_day ? Number(form.ct_day) : null,
      }
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
          <Field label="Mois du contrôle technique">
            <select style={S.input} value={form.ct_month}
              onChange={(e) => set('ct_month', e.target.value)}>
              <option value="">— Aucun —</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Jour du CT">
            <input style={S.input} type="number" min={1} max={31} value={form.ct_day}
              onChange={(e) => set('ct_day', e.target.value)}
              disabled={!form.ct_month} placeholder="15" />
          </Field>
        </div>
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
            <InfoCell label="Contrôle technique"
              value={vehicle.ct_month ? `${MONTHS[vehicle.ct_month - 1]}${vehicle.ct_day ? ' ' + vehicle.ct_day : ''}` : '—'} />
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
        <FlotteApp user={user} onLogout={logout} />
      ) : (
        <LoginScreen onAuth={(u) => { setUser(u); setHasToken(true) }} />
      )}
    </ToastHost>
  )
}
