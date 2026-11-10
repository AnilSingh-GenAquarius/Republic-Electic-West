import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export function ScTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/sc', label: 'Jobs', end: true },
      { to: '/sc/schedule', label: 'Schedule' },
      { to: '/sc/overdue', label: 'Overdue' },
      { to: '/sc/backlog', label: 'Lot backlog' },
      { to: '/sc/packs', label: 'Pack search' },
    ]} />
  )
}

let cache = null
export function useScLookups() {
  const [lk, setLk] = useState(cache || { workTypes: [], scheduleStages: [], statuses: [], subsTypes: [], divisions: [], stages: [] })
  useEffect(() => { if (!cache) api('/sc/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const lotName = (l) => `${l.Lot ?? ''}${l.Block ? `/${l.Block}` : ''}`

/** Days from today (UTC date) to a stored date; negative = past. */
export function daysFromToday(v) {
  if (!v) return null
  const d = new Date(v), t = new Date()
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())
  return Math.round((a - b) / 86400000)
}
