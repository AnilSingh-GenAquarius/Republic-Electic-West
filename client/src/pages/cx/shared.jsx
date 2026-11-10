import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { int, download } from '../po/shared'

export function CxTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/cx', label: 'Switchboard', end: true },
      { to: '/cx/jobs', label: 'Jobs & plans' },
      { to: '/cx/billing-info', label: 'Billing info' },
      { to: '/cx/items', label: 'Cox items' },
      { to: '/cx/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useCxLookups() {
  const [lk, setLk] = useState(cache || { cxJobTypes: [], adminSpecs: [], planners: [], statuses: [], jobTypes: [] })
  useEffect(() => { if (!cache) api('/cx/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const qty = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }))
export const yes = (v) => (v === true || v === 1 || v === -1)
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const isoDay = (v) => (v ? String(v).slice(0, 10) : '')
export const longDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '')

/** Group rows by a key function, keeping first-seen order. */
export function groupBy(rows, keyFn) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return [...m.entries()]
}
