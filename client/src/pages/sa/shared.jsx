import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function SaTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/sa', label: 'Overview', end: true },
      { to: '/sa/leads', label: 'Sales leads' },
      { to: '/sa/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useSaLookups() {
  const [lk, setLk] = useState(cache || { divisions: [], scheduleStages: [], customers: [], priorities: [], customerTypes: [], phoneTypes: [] })
  useEffect(() => { if (!cache) api('/sa/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))
export const pct = (v) => (v == null || !isFinite(v) ? '—' : `${(Number(v) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`)

/** Option list for a <select> from [{id,name}] */
export function Options({ list, blank = '' }) {
  return (
    <>
      {blank !== null && <option value="">{blank}</option>}
      {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </>
  )
}

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const val = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)
  const text = [cols.map((c) => esc(c[1])).join(','), ...rows.map((r) => cols.map(([k]) => esc(val(r[k]))).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

/** Run an API call that may answer 409 needsConfirm: asks the user, then repeats with force. */
export async function withConfirm(fn) {
  try { return await fn(false) } catch (e) {
    if (e.status === 409 && e.data?.needsConfirm && window.confirm(e.message)) return fn(true)
    throw e
  }
}

export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
