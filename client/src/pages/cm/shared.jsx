import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { int, download } from '../po/shared'

export function CmTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/cm', label: 'Overview', end: true },
      { to: '/cm/jobs', label: 'Contract Management' },
      { to: '/cm/values', label: 'Contract values' },
      { to: '/cm/lots', label: 'Revised contract values' },
      { to: '/cm/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useCmLookups() {
  const [lk, setLk] = useState(cache || { statuses: [], jobTypes: [], divisions: [], jurisdictions: [], contractTypes: [], works: [], scheduleStages: [], packTypes: [] })
  useEffect(() => { if (!cache) api('/cm/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const yes = (v) => (v === true || v === 1 || v === -1)
// amount → text for an <input> (no currency symbol, no grouping)
export const amt = (v) => (v == null || v === '' ? '' : String(Number(v)))

// Cascading <select>s. levels: [{ key, label, url, param }] — each list is loaded from `url` with ?<param>=<previous value>.
// value = { [key]: id }; changing one clears the ones after it.
export function Cascade({ levels, value, onChange, prefix = '' }) {
  const [opts, setOpts] = useState({})
  const v = value || {}
  const deps = levels.map((l, i) => (i === 0 ? 'root' : v[levels[i - 1].key] || '')).join('|')
  useEffect(() => {
    let live = true
    levels.forEach((l, i) => {
      const parent = i === 0 ? null : v[levels[i - 1].key]
      if (i > 0 && !parent) { setOpts((o) => ({ ...o, [l.key]: [] })); return }
      api(l.url, { params: l.param ? { [l.param]: parent } : {} }).then((list) => live && setOpts((o) => ({ ...o, [l.key]: list }))).catch(() => {})
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])
  return (
    <>
      {levels.map((l, i) => {
        const disabled = i > 0 && !v[levels[i - 1].key]
        return (
          <label key={l.key}>{l.label}
            <select aria-label={`${prefix}${l.label}`} value={v[l.key] || ''} disabled={disabled}
              onChange={(e) => { const n = { ...v, [l.key]: e.target.value }; levels.slice(i + 1).forEach((x) => { n[x.key] = '' }); onChange(n) }}>
              <option value="">{disabled ? '—' : 'Choose…'}</option>
              {(opts[l.key] || []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.Lock ? ' (locked)' : ''}{o.EndDate ? ' (closed)' : ''}</option>)}
            </select>
          </label>
        )
      })}
    </>
  )
}
export const PM_LEVELS = [
  { key: 'customerId', label: 'PM customer', url: '/cm/pick/pm-customers' },
  { key: 'jobId', label: 'PM job', url: '/cm/pick/pm-jobs', param: 'customerId' },
  { key: 'contractId', label: 'PM bid', url: '/cm/pick/pm-bids', param: 'jobId' },
]
export const JS_LEVELS = [
  { key: 'jsCustomerId', label: 'JS customer', url: '/cm/pick/js-customers' },
  { key: 'jsJobId', label: 'JS job', url: '/cm/pick/js-jobs', param: 'customerId' },
]
export const JS_LOT = { key: 'lotId', label: 'JS lot', url: '/cm/pick/js-lots', param: 'jobId' }
export const JS_PHASE = { key: 'phaseId', label: 'JS phase', url: '/cm/pick/js-phases', param: 'jobId' }

// Inline money cell editor: shows the amount; click the pencil to edit; Enter / blur saves.
export function MoneyCell({ value, onSave, label, disabled }) {
  const [x, setX] = useState(null)
  if (x == null) return <button type="button" className="link-btn" aria-label={`Edit ${label}`} disabled={disabled} onClick={() => setX(amt(value))}>{money(value)}</button>
  const save = () => { const t = x; setX(null); if (t !== amt(value)) onSave(t) }
  return <input className="cell-input" autoFocus aria-label={label} value={x} onChange={(e) => setX(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setX(null) }} />
}
