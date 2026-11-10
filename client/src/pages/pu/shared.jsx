import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function PuTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/pu', label: 'Lot finder', end: true },
      { to: '/pu/jobs', label: 'Job lists' },
      { to: '/pu/lots', label: 'Lot reports' },
      { to: '/pu/plans', label: 'Plan data' },
      { to: '/pu/labor', label: 'Start pack labor' },
    ]} />
  )
}

let cache = null
export function usePuLookups() {
  const [lk, setLk] = useState(cache || { statuses: [], divisions: [], scheduleStages: [], pmCustomers: [] })
  useEffect(() => { if (!cache) api('/pu/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

/** Load a pick list whenever `dep` changes (empty list while dep is blank). */
export function usePick(path, params, dep) {
  const [list, setList] = useState([])
  useEffect(() => {
    let live = true
    setList([])
    if (dep === undefined || (dep !== null && dep !== '')) api(path, { params }).then((d) => live && setList(d)).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, dep])
  return list
}

export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))
export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[k]) ? r[k].slice(0, 10) : r[k])).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

/** Group rows by a key, keeping first-seen order. */
export function groupBy(rows, keyFn) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return [...m.entries()]
}
