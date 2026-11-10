import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function PoTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/po', label: 'Overview', end: true },
      { to: '/po/orders', label: 'Purchase orders' },
      { to: '/po/packs', label: 'Pack POs' },
      { to: '/po/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function usePoLookups() {
  const [lk, setLk] = useState(cache || { companies: [], terms: [], divisions: [] })
  useEffect(() => { if (!cache) api('/po/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) }))
export const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[k]) ? r[k].slice(0, 10) : r[k])).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
