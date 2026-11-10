import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { money, money0, int, download } from '../po/shared'

export function ArTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/ar', label: 'Overview', end: true },
      { to: '/ar/billing', label: 'Process billing' },
      { to: '/ar/prebill', label: 'Post billing' },
      { to: '/ar/invoices', label: 'Invoices' },
      { to: '/ar/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useArLookups() {
  const [lk, setLk] = useState(cache || { billTypes: [], terms: [], divisions: [], customers: [] })
  useEffect(() => { if (!cache) api('/ar/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const today = () => new Date().toISOString().slice(0, 10)
export const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)
export const LIENS = ['Progress', 'Final']
export const typeTone = (id) => (id === 3 ? 'red' : id === 2 ? 'amber' : 'blue')
