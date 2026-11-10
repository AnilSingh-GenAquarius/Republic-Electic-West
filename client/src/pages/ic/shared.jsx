import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function IcTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/ic', label: 'Overview', end: true },
      { to: '/ic/items', label: 'Items' },
      { to: '/ic/vendors', label: 'Vendors' },
      { to: '/ic/transactions', label: 'Transactions' },
      { to: '/ic/counts', label: 'Counts' },
      { to: '/ic/material', label: 'Pack material' },
      { to: '/ic/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useIcLookups() {
  const [lk, setLk] = useState(cache || { invClasses: [], uoms: [], costCodes: [], statuses: [], transacTypes: [], divisions: [], stages: [], workTypes: [], updateTypes: [], vendorCategories: [], priceLevels: [] })
  useEffect(() => { if (!cache) api('/ic/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) > 4 ? 4 : Math.max(d, 2) }))
export const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))

export function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[k]) ? r[k].slice(0, 10) : r[k])).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
