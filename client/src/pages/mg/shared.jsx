import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { int, download } from '../po/shared'

export function MgTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/mg', label: 'Overview', end: true },
      { to: '/mg/job-cost', label: 'Job cost' },
      { to: '/mg/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useMgLookups() {
  const [lk, setLk] = useState(cache || { customers: [], divisions: [], stages: [], works: [] })
  useEffect(() => { if (!cache) api('/mg/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
export const pct1 = (v) => (v == null || !isFinite(v) ? '—' : `${Number(v).toFixed(1)}%`)
export const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10) }
export const today = () => new Date().toISOString().slice(0, 10)
