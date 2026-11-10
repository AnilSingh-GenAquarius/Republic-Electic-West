import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { fmtDate } from '../../format'
import ModuleTabs from '../../components/ModuleTabs'

export function DmTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/dm', label: 'Functions', end: true },
      { to: '/dm/fix', label: 'Fix data' },
      { to: '/dm/tm', label: 'Edit T&M' },
      { to: '/dm/lists', label: 'Lists' },
      { to: '/dm/logins', label: 'Login access' },
      { to: '/dm/history', label: 'Lot close history' },
    ]} />
  )
}

let cache = null
export function useDmLookups() {
  const [lk, setLk] = useState(cache || { scheduleStages: [], vendors: [], divisions: [], employees: [], tm: [] })
  useEffect(() => { if (!cache) api('/dm/pick/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

/** URL-backed switchboard filters shared by the DM pages: [values, set(patch)] */
export function useDmParams() {
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n, { replace: true }) }
  return [p, set]
}

function usePick(path, params, enabled) {
  const [list, setList] = useState([])
  const key = JSON.stringify(params)
  useEffect(() => {
    let live = true
    setList([])
    if (enabled) api(path, { params }).then((d) => live && setList(d)).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled])
  return list
}

const empName = (e) => `${e.name}${e.EmployeeNum ? ` (#${e.EmployeeNum})` : ''}${e.DateTermination ? ' – terminated' : ''}`

/**
 * The SwitchDM filter boxes. fields: any of customer, job, lot, stage, from, to, employee, division, vendor, tm.
 * labels overrides a label (e.g. { from: 'Payroll date' }).
 */
export function DmFilters({ fields, labels = {}, p, set }) {
  const lk = useDmLookups()
  const f = new Set(fields)
  const customers = usePick('/dm/pick/customers', {}, f.has('customer'))
  const jobs = usePick('/dm/pick/jobs', { customerId: p.customerId || 0 }, f.has('job'))
  const lots = usePick('/dm/pick/lots', { jobId: p.jobId }, f.has('lot') && !!p.jobId)
  const L = (k, d) => labels[k] || d
  const sel = (key, label, opts, fmt = (o) => o.name, patch = {}, disabled = false) => (
    <label>{label}
      <select aria-label={label} value={p[key] || ''} disabled={disabled} onChange={(e) => set({ [key]: e.target.value, ...patch })}>
        <option value="">{disabled ? '—' : 'Choose…'}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{fmt(o)}</option>)}
      </select>
    </label>
  )
  return (
    <div className="card form report-filters no-print"><fieldset>
      {f.has('customer') && sel('customerId', 'Customer', customers, (o) => o.name, { jobId: '', lotId: '' })}
      {f.has('job') && sel('jobId', 'Job', jobs, (o) => `${o.name} (${o.DivisionId || '—'}) – ${o.CustName}`, { lotId: '' })}
      {f.has('lot') && sel('lotId', L('lot', 'Lot'), lots, (o) => `${o.name} · ${o.Phase}${o.EndDate ? ` · closed ${fmtDate(o.EndDate)}` : ''}`, {}, !p.jobId)}
      {f.has('stage') && sel('scheduleStageId', 'Schedule stage', lk.scheduleStages)}
      {f.has('from') && <label>{L('from', 'Date from')}<input type="date" aria-label={L('from', 'Date from')} value={p.fromDate || ''} onChange={(e) => set({ fromDate: e.target.value })} /></label>}
      {f.has('to') && <label>{L('to', 'Date to')}<input type="date" aria-label={L('to', 'Date to')} value={p.toDate || ''} onChange={(e) => set({ toDate: e.target.value })} /></label>}
      {f.has('employee') && sel('employeeId', 'Employee', lk.employees, empName)}
      {f.has('division') && sel('division', 'Division', lk.divisions, (o) => `${o.id} – ${o.name}`)}
      {f.has('vendor') && sel('vendorId', 'Vendor', lk.vendors)}
      {f.has('tm') && sel('tmId', 'T&M #', lk.tm, (o) => `${o.id} · ${fmtDate(o.TmDate)}`)}
    </fieldset></div>
  )
}

export const int = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'))
export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
