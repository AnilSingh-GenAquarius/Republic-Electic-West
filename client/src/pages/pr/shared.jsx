import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'
import { usePref } from '../../prefs'

export function PrTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/pr', label: 'Overview', end: true },
      { to: '/pr/piece', label: 'Piece timecard' },
      { to: '/pr/hourly', label: 'Hourly timecard' },
      { to: '/pr/timecard', label: 'Timecards' },
      { to: '/pr/employees', label: 'Employees' },
      { to: '/pr/periods', label: 'Pay periods' },
      { to: '/pr/reports', label: 'Reports' },
    ]} />
  )
}

/** The payroll date being worked on (like tbxDate on the Access SwitchPR form). URL ?date= wins, else last used. */
export function usePayrollDate() {
  const [sp, setSp] = useSearchParams()
  const [saved, setSaved] = usePref('sw_pr_date', '')
  const date = sp.get('date') || saved || new Date().toISOString().slice(0, 10)
  useEffect(() => { if (sp.get('date') && sp.get('date') !== saved) setSaved(sp.get('date')) }, [sp, saved, setSaved])
  const setDate = (d) => {
    setSaved(d)
    const n = new URLSearchParams(sp)
    d ? n.set('date', d) : n.delete('date')
    setSp(n, { replace: true })
  }
  return [date, setDate]
}

export function PayrollDatePicker({ date, setDate }) {
  return (
    <label className="inline date-pick">
      <CalendarDays size={15} />
      <span>Payroll date</span>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
    </label>
  )
}

let cache = null
export function usePrLookups() {
  const [lk, setLk] = useState(cache || { titles: [], payTypes: [], hourTypes: [], workTypes: [], scheduleStages: [], divisions: [] })
  useEffect(() => { if (!cache) api('/pr/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const num = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }))
