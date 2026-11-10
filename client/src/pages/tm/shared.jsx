import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function TmTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/tm', label: 'T&M orders', end: true },
      { to: '/tm/new', label: 'New T&M' },
      { to: '/tm/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useTmLookups() {
  const [lk, setLk] = useState(cache || { priceLevels: [], tmTypes: [], workTypes: [], divisions: [], users: [] })
  useEffect(() => { if (!cache) api('/tm/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const qty = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }))
export const lotLabel = (r) => `${r.Lot ?? ''}${r.Block ? `/${r.Block}` : ''}`

export function statusOf(r) {
  if (r.PaidDate) return { tone: 'green', label: 'Paid' }
  if (r.ApprovedDate) return { tone: 'blue', label: 'Processed' }
  return { tone: 'amber', label: 'Open' }
}
