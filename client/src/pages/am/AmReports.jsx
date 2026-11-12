// Alarm monitoring reports — the report buttons on the Access SwitchAM switchboard:
// AmAccountInfo, AmAccountInfoTech (one account: pick it, then open the printable sheet), AmAccountsCreated, AmAccountsCreatedYear, AmAccountsCancelled, AmAccountsExpiring, AmAccountsExpiringMonthly.
import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, CalendarClock, CalendarX2, Download, FileText, Printer, Repeat, Search, UserPlus, Wrench } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { download } from '../po/shared'
import AmTabs from './AmTabs'

const REPORTS = [
  { key: 'info', label: 'Account information', icon: FileText, account: true, text: 'Full account sheet with zones and call list (Access report Account information)' },
  { key: 'tech', label: 'Account info tech', icon: Wrench, account: true, text: 'Technician sheet: service address, panel type, premises phone (Access report Account info tech)' },
  { key: 'created', label: 'Accounts created', icon: UserPlus, dates: true, type: true, text: 'New accounts by monitoring type and month' },
  { key: 'created-year', label: 'Accounts created per year', icon: BarChart3, dates: true, type: true, text: 'New accounts per year' },
  { key: 'cancelled', label: 'Accounts cancelled', icon: CalendarX2, dates: true, type: true, text: 'Cancelled accounts by type, month and reason' },
  { key: 'expiring', label: 'Accounts expiring', icon: CalendarClock, dates: true, type: false, text: 'Contracts (longer than a month) whose term ends in the period' },
  { key: 'expiring-monthly', label: 'Accounts monthly / N/A', icon: Repeat, dates: false, type: false, text: 'Active monthly and N/A contracts' },
]

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)
const pct = (n, t) => (t ? `${((n / t) * 100).toFixed(1)}%` : '—')

export default function AmReports() {
  const [sp, setSp] = useSearchParams()
  const key = sp.get('report') || 'created'
  const rep = REPORTS.find((r) => r.key === key) || REPORTS[0]
  const f = { from: sp.get('from') || yearStart(), to: sp.get('to') || today(), monitoringTypeId: sp.get('type') || '0' }
  const [types, setTypes] = useState([])
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { api('/am/lookups').then((l) => setTypes(l.monitoringTypes)).catch(() => {}) }, [])
  useEffect(() => {
    setError(''); setD(null)
    if (rep.account) { setLoading(false); return }
    setLoading(true)
    const params = { ...(rep.dates ? { from: f.from, to: f.to } : {}), ...(rep.type ? { monitoringTypeId: f.monitoringTypeId } : {}) }
    api(`/am/reports/${rep.key}`, { params }).then(setD).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [rep.key, f.from, f.to, f.monitoringTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }) }
  const typeName = f.monitoringTypeId !== '0' ? types.find((t) => String(t.id) === f.monitoringTypeId)?.name : 'All monitoring types'

  function csv() {
    const cols = {
      created: [['MonitoringType', 'Monitoring type'], ['PeriodActive', 'Period'], ['NewAccounts', 'New accounts']],
      'created-year': [['PeriodActive', 'Year'], ['MonitorType', 'Monitoring type'], ['NewAccounts', 'New accounts']],
      cancelled: [['MonitoringType', 'Monitoring type'], ['PeriodCancelled', 'Period'], ['CancellationReason', 'Reason'], ['CancelledAccounts', 'Cancelled']],
      expiring: [['FutureExpirationDate', 'Expires'], ['AccountNumber', 'Account #'], ['CustomerName', 'Customer'], ['PhoneNumber', 'Phone'], ['Email', 'Email'], ['ServiceStreet', 'Street'], ['ServiceCity', 'City'], ['ServiceState', 'State'], ['ContractTerms', 'Terms'], ['MonthlyContractValue', 'Monthly'], ['ActivationDate', 'Activated'], ['RenewalDate', 'Renewal']],
    }
    cols['expiring-monthly'] = cols.expiring.slice(1)
    download(d.rows, cols[rep.key], `am-${rep.key}.csv`)
  }

  return (
    <div className="page">
      <PageHeader title="Alarm monitoring reports" subtitle="The report buttons from the Access Alarm Monitoring switchboard"
        actions={<>
          {!rep.account && <button className="btn" disabled={!d?.rows?.length} onClick={csv}><Download size={15} /> CSV</button>}
          {!rep.account && <button className="btn primary" disabled={!d} onClick={() => window.print()}><Printer size={15} /> Print</button>}
        </>} />
      <AmTabs />

      <div className="report-picker no-print">
        {REPORTS.map((r) => (
          <button key={r.key} className={`btn ${r.key === rep.key ? 'primary' : ''}`} onClick={() => set({ report: r.key })} title={r.text}>
            <r.icon size={15} /> {r.label}
          </button>
        ))}
      </div>

      {rep.account && <AccountChooser kind={rep.key} label={rep.label} text={rep.text} />}

      {(rep.dates || rep.type) && (
        <div className="filters no-print">
          {rep.dates && <label className="inline">From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>}
          {rep.dates && <label className="inline">To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>}
          {rep.type && (
            <label className="inline">Monitoring type
              <select value={f.monitoringTypeId} onChange={(e) => set({ type: e.target.value === '0' ? '' : e.target.value })}>
                <option value="0">All accounts</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {!rep.account && <article className="card am-report">
        <header className="am-report-head">
          <h2>{rep.label}</h2>
          <div className="muted small">
            {rep.dates && <>From {fmtDate(f.from)} to {fmtDate(f.to)}</>}
            {rep.type && <> · {typeName}</>}
            {' · '}Printed {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </header>
        {error && <ErrorState message={error} />}
        {loading && <SkeletonRows rows={6} cols={4} />}
        {d && !d.rows.length && <EmptyState icon={rep.icon} title="Nothing to report">No accounts match these filters.</EmptyState>}
        {d && d.rows.length > 0 && <ReportBody rep={rep.key} d={d} />}
      </article>}
    </div>
  )
}

// Account information / Account info tech are single-account sheets: find the account, then open its printable sheet.
function AccountChooser({ kind, label, text }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      api('/am/accounts', { params: { search: q, status: 'all', pageSize: 12 } })
        .then((r) => { setRows(r.rows); setError('') })
        .catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const to = (id) => `/am/accounts/${id}/${kind === 'tech' ? 'print-tech' : 'print'}`
  return (
    <article className="card">
      <h2>{label}</h2>
      <p className="muted">{text}. Choose an account to open its sheet, then use Print (or Email) there.</p>
      <label className="search-wrap" style={{ maxWidth: 420, display: 'block', marginBottom: 12 }}>
        <Search size={15} />
        <input type="search" autoFocus placeholder="Search account #, name, street, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error && <ErrorState message={error} />}
      {rows && !rows.length && <EmptyState icon={FileText} title="No accounts found">Try a different search.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table className="grid clickable">
          <thead><tr><th>Acct #</th><th>Customer</th><th>Service address</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.AccountID}>
                <td>{r.AccountNumber}</td><td>{r.CustomerName}</td>
                <td>{[r.ServiceStreet, r.ServiceCity, r.ServiceState].filter(Boolean).join(', ')}</td>
                <td>{r.DisconnectionDate ? <span className="muted">Disconnected {fmtDate(r.DisconnectionDate)}</span> : 'Active'}</td>
                <td className="num"><Link className="btn small primary" to={to(r.AccountID)}><Printer size={13} /> Open sheet</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {rows && <p className="muted small" style={{ marginTop: 8 }}>Showing up to 12 matches — type to narrow the list.</p>}
    </article>
  )
}

function ReportBody({ rep, d }) {
  if (rep === 'created' || rep === 'cancelled') {
    const countKey = rep === 'created' ? 'NewAccounts' : 'CancelledAccounts'
    const groups = []
    for (const r of d.rows) {
      let g = groups[groups.length - 1]
      if (!g || g.type !== r.MonitoringType) { g = { type: r.MonitoringType, rows: [], sum: 0 }; groups.push(g) }
      g.rows.push(r); g.sum += r[countKey]
    }
    return (
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>{rep === 'created' ? 'Period active' : 'Period cancelled'}</th>{rep === 'cancelled' && <th>Cancellation reason</th>}<th className="num">{rep === 'created' ? 'New accounts' : 'Cancelled accounts'}</th>{rep === 'created' && <th className="num">% of total</th>}</tr></thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.type}>
              <tr className="group-row"><td colSpan={3}><b>{g.type}</b></td></tr>
              {g.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.PeriodActive || r.PeriodCancelled}</td>
                  {rep === 'cancelled' && <td>{r.CancellationReason || '—'}</td>}
                  <td className="num">{r[countKey]}</td>
                  {rep === 'created' && <td className="num muted">{pct(r[countKey], d.total)}</td>}
                </tr>
              ))}
              <tr className="subtotal"><td colSpan={rep === 'cancelled' ? 2 : 1}>Subtotal {g.type}</td><td className="num"><b>{g.sum}</b></td>{rep === 'created' && <td className="num"><b>{pct(g.sum, d.total)}</b></td>}</tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={rep === 'cancelled' ? 2 : 1}><b>Total</b></td><td className="num"><b>{d.total}</b></td>{rep === 'created' && <td className="num"><b>100%</b></td>}</tr></tfoot>
      </table></div>
    )
  }
  if (rep === 'created-year') {
    return (
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>Year</th><th>Monitoring type</th><th className="num">New accounts</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.PeriodActive}><td>{r.PeriodActive}</td><td>{r.MonitorType}</td><td className="num">{r.NewAccounts}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{d.total}</b></td></tr></tfoot>
      </table></div>
    )
  }
  const expiring = rep === 'expiring'
  return (
    <div className="table-wrap"><table className="grid">
      <thead><tr>{expiring && <th>Expires</th>}<th>Acct #</th><th>Customer</th><th>Phone</th><th>Email</th><th>Service address</th><th>Terms</th><th className="num">Monthly</th><th>Activated</th><th>Renewal</th></tr></thead>
      <tbody>
        {d.rows.map((r) => (
          <tr key={r.AccountID}>
            {expiring && <td><b>{fmtDate(r.FutureExpirationDate)}</b></td>}
            <td><Link to={`/am/accounts/${r.AccountID}`}>{r.AccountNumber}</Link></td>
            <td>{r.CustomerName}</td><td>{r.PhoneNumber}</td><td>{r.Email}</td>
            <td className="wrap">{[r.ServiceStreet, r.ServiceCity, r.ServiceState].filter(Boolean).join(', ')}</td>
            <td>{r.ContractTerms}</td><td className="num">{r.MonthlyContractValue}</td>
            <td>{fmtDate(r.ActivationDate)}</td><td>{fmtDate(r.RenewalDate)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={expiring ? 10 : 9} className="muted">{d.rows.length} account(s)</td></tr></tfoot>
    </table></div>
  )
}
