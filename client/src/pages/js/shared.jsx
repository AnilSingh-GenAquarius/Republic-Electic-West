import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'
import './js.css'

export const jsTabs = [
  { to: '/js', label: 'Overview', end: true },
  { to: '/js/builders', label: 'Builders' },
  { to: '/js/jobs', label: 'Jobs' },
  { to: '/js/lots', label: 'Lots' },
  { to: '/js/reports', label: 'Reports' },
  { to: '/js/lists', label: 'Lists' },
]

export function JsTabs() {
  return <ModuleTabs tabs={jsTabs} />
}

const EMPTY_LK = { statuses: [], creditRatings: [], divisions: [], jobTypes: [], phaseTypes: [], jurisdictions: [], cities: [], superintendents: [] }
let cache = null
export function useJsLookups() {
  const [lk, setLk] = useState(cache || EMPTY_LK)
  useEffect(() => { if (!cache) api('/js/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}
/** Lists were edited: next useJsLookups() call reloads them. */
export function resetJsLookups() { cache = null }

export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))

/** Status badge tone for LsStatus names. */
export const statusTone = (s) => (s === 'Active' ? 'green' : s === 'Lawsuit' ? 'red' : s ? 'neutral' : 'neutral')

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const val = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(val(r[k]))).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

/** Debounced search text bound to a URL param. */
export function useDebounced(value, onSettle, delay = 300) {
  useEffect(() => {
    const t = setTimeout(() => onSettle(value), delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
}

/** Remove empty params and reset the page when filters change. */
export function nextParams(p, patch) {
  const n = { ...p, ...patch }
  if (!('page' in patch)) delete n.page
  Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k])
  return n
}

/** Server warnings returned by a save (e.g. phases linked to an old bid). */
export function Warnings({ list }) {
  if (!list?.length) return null
  return <div className="banner js-warn" role="status">{list.map((w) => <div key={w}>{w}</div>)}</div>
}

/**
 * Accessible confirm dialog. const [dialog, ask] = useConfirm(); ... if (await ask({ title, message, ok, danger })) ...
 * Render {dialog} once in the page.
 */
export function useConfirm() {
  const ref = useRef(null)
  const [state, setState] = useState(null)
  useEffect(() => { if (state && ref.current && !ref.current.open) ref.current.showModal() }, [state])
  const close = (v) => { ref.current?.close(); state?.resolve(v); setState(null) }
  const ask = (opts) => new Promise((resolve) => setState({ ...opts, resolve }))
  const dialog = state ? (
    <dialog ref={ref} className="js-dialog" aria-labelledby="js-dialog-title" onCancel={(e) => { e.preventDefault(); close(false) }}>
      <div className="js-dialog-body">
        <h2 id="js-dialog-title">{state.title}</h2>
        <p>{state.message}</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => close(false)}>{state.cancel || 'Cancel'}</button>
          <button type="button" className={`btn ${state.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{state.ok || 'OK'}</button>
        </div>
      </div>
    </dialog>
  ) : null
  return [dialog, ask]
}

/** Collect only the changed keys between the loaded record and the form (partial updates). */
export function changed(orig, form, keys) {
  const out = {}
  for (const k of keys) {
    const a = orig?.[k] == null ? '' : typeof orig[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(orig[k]) ? orig[k].slice(0, 10) : String(orig[k])
    const b = form[k] == null ? '' : String(form[k])
    if (a !== b) out[k] = form[k]
  }
  return out
}
