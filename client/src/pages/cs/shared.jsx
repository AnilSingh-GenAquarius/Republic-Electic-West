// Customer service (CS) shared helpers: tabs, lookups cache, formatting, small UI pieces.
import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'
import { Badge } from '../../components/ui'
import './cs.css'

export const csTabs = [
  { to: '/cs', label: 'Overview', end: true },
  { to: '/cs/calendar', label: 'Calendar' },
  { to: '/cs/tickets', label: 'Tickets' },
  { to: '/cs/customers', label: 'Homeowners' },
  { to: '/cs/properties', label: 'Properties' },
  { to: '/cs/call-notes', label: 'Call notes' },
  { to: '/cs/reports', label: 'Reports' },
  { to: '/cs/setup', label: 'Setup' },
]

export function CsTabs() {
  return <ModuleTabs tabs={csTabs} />
}

const EMPTY = { divisions: [], statuses: [], apptTimes: [], ticketTypes: [], jobTypes: [], customerTypes: [], resolutions: [], techTypes: [], phoneTypes: [], errors: [], stages: [], states: [], csJobs: [], technicians: [], repNames: [], priceLevels: [], leadStatuses: [], cities: [] }
let cache = null
export function useCsLookups() {
  const [lk, setLk] = useState(cache || EMPTY)
  useEffect(() => { if (!cache) api('/cs/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}
/** Lists or technicians were edited: the next useCsLookups() call reloads them. */
export function resetCsLookups() { cache = null }

export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const num = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }))
export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))
export const pct = (v) => (v == null || v === '' ? '—' : `${(Number(v) * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)
export const hhmm = (v) => (v ? String(v).slice(0, 5) : '')
export const weekday = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

/** Option list for a <select> from [{id,name}] */
export function Options({ list, blank = '' }) {
  return (
    <>
      {blank !== null && <option value="">{blank}</option>}
      {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </>
  )
}

export function StatusBadge({ status, active }) {
  if (!status) return null
  const tone = active === true || status === 'Active' ? 'blue' : status === 'Closed' ? 'green' : 'neutral'
  return <Badge tone={tone}>{status === 'Active' ? 'Open' : status}</Badge>
}

/** Warnings returned by the API (shown, not blocking — like the Access message boxes). */
export function Warnings({ list }) {
  if (!list?.length) return null
  return <div className="banner" role="status">{list.join(' · ')}</div>
}

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const val = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)
  const keys = cols || (rows[0] ? Object.keys(rows[0]).map((k) => [k, k]) : [])
  const text = [keys.map((c) => esc(c[1])).join(','), ...rows.map((r) => keys.map(([k]) => esc(val(r[k]))).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

/** Run an API call that may answer 409 needsConfirm: asks the user, then repeats with force. */
export async function withConfirm(fn) {
  try { return await fn(false) } catch (e) {
    if (e.status === 409 && e.data?.needsConfirm && window.confirm(e.message)) return fn(true)
    throw e
  }
}
