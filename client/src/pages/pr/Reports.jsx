// Payroll reports: labor paid grouped by employee / job / lot / division / builder / work type / payroll date,
// with drill-down to the line detail and CSV export (replaces the Access labor-paid reports and Excel exports).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Download, List, X } from 'lucide-react'
import { api, apiBlob } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PrTabs, money, num, usePrLookups } from './shared'

const GROUPS = [
  ['employee', 'Employee'], ['job', 'Job'], ['lot', 'Lot'], ['division', 'Division'], ['builder', 'Builder'], ['work', 'Work type'], ['payroll', 'Payroll date'],
]
// Which filter a clicked summary row applies when drilling to detail
const DRILL = {
  employee: (r) => ({ employeeId: r.GroupKey, name: r.GroupLabel }),
  job: (r) => ({ jobId: r.GroupKey, jobName: r.GroupLabel }),
  lot: (r) => ({ lotId: r.GroupKey, lotName: r.GroupLabel }),
  division: (r) => ({ division: r.GroupKey }),
  builder: (r) => ({ custId: r.GroupKey, custName: r.GroupLabel }),
  work: (r) => ({ workId: r.GroupKey, workName: r.GroupLabel }),
  payroll: (r) => ({ from: String(r.GroupKey).slice(0, 10), to: String(r.GroupKey).slice(0, 10) }),
}
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function Reports() {
  const lk = usePrLookups()
  const [sp, setSp] = useSearchParams()
  const q = Object.fromEntries(sp.entries())
  const p = { from: daysAgo(90), groupBy: 'employee', view: 'summary', ...q }
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const set = (patch) => { const n = { ...p, ...patch }; delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const filterParams = { from: p.from, to: p.to, division: p.division, employeeId: p.employeeId, jobId: p.jobId, lotId: p.lotId, workId: p.workId, custId: p.custId, search: p.search }

  useEffect(() => {
    setError('')
    if (p.view === 'detail') {
      setDetail(null)
      api('/pr/reports/labor-paid/detail', { params: { ...filterParams, page: p.page } }).then(setDetail).catch((e) => setError(e.message))
    } else {
      setData(null)
      api('/pr/reports/labor-paid', { params: { ...filterParams, groupBy: p.groupBy } }).then(setData).catch((e) => setError(e.message))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])

  async function downloadCsv() {
    setDownloading(true)
    try {
      const qs = new URLSearchParams(Object.entries(filterParams).filter(([, v]) => v)).toString()
      const blob = await apiBlob(`/pr/reports/labor-paid.csv?${qs}`)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `labor-paid-${p.from || 'all'}-${p.to || 'all'}.csv`; a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  const chips = [
    p.name && ['employeeId', `Employee: ${p.name}`, ['employeeId', 'name']],
    p.jobName && ['jobId', `Job: ${p.jobName}`, ['jobId', 'jobName']],
    p.lotName && ['lotId', `Lot: ${p.lotName}`, ['lotId', 'lotName']],
    p.custName && ['custId', `Builder: ${p.custName}`, ['custId', 'custName']],
    p.workName && ['workId', `Work: ${p.workName}`, ['workId', 'workName']],
  ].filter(Boolean)

  return (
    <div className="page">
      <PageHeader title="Payroll reports" subtitle="Labor paid — summarise, drill into the lines, export to Excel (CSV)"
        actions={<button className="btn" onClick={downloadCsv} disabled={downloading}><Download size={15} /> {downloading ? 'Exporting…' : 'Export CSV'}</button>} />
      <PrTabs />

      <div className="card form report-filters">
        <fieldset>
          <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
          <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
          <label>Division
            <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Employee
            <SearchSelect endpoint="/common/employees" params={{ active: 0 }} value={p.employeeId} label={p.name} placeholder="Any employee" onSelect={(r) => set({ employeeId: r?.id, name: r?.name })} />
          </label>
          <label>Job
            <SearchSelect endpoint="/pr/jobs" params={{ all: 1 }} value={p.jobId} label={p.jobName} placeholder="Any job" onSelect={(r) => set({ jobId: r?.id, jobName: r?.name })} />
          </label>
        </fieldset>
        {chips.length > 0 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {chips.map(([k, label, keys]) => (
              <span key={k} className="chip"><b>{label}</b><button className="chip-x" onClick={() => set(Object.fromEntries(keys.map((x) => [x, ''])))} aria-label="Remove filter"><X size={12} /></button></span>
            ))}
          </div>
        )}
      </div>

      <div className="filters">
        <div className="seg">
          <button className={`seg-btn${p.view !== 'detail' ? ' active' : ''}`} onClick={() => set({ view: 'summary' })}><BarChart3 size={13} /> Summary</button>
          <button className={`seg-btn${p.view === 'detail' ? ' active' : ''}`} onClick={() => set({ view: 'detail' })}><List size={13} /> Detail</button>
        </div>
        {p.view !== 'detail' && (
          <div className="seg" role="tablist" aria-label="Group by">
            {GROUPS.map(([k, l]) => <button key={k} role="tab" aria-selected={p.groupBy === k} className={`seg-btn${p.groupBy === k ? ' active' : ''}`} onClick={() => set({ groupBy: k })}>{l}</button>)}
          </div>
        )}
      </div>
      {error && <ErrorState message={error} />}

      {p.view !== 'detail' ? (
        !data ? <SkeletonRows rows={8} cols={4} /> : (
          <>
            <div className="kpis">
              <StatCard label="Total pay" tone="green" value={money(data.totals.TotalPay)} foot={`${data.totals.Lines.toLocaleString()} labor lines`} />
              <StatCard label="Piece-rate pay" value={money(data.totals.PiecePay)} foot="Qty × price × pay %" />
              <StatCard label="Hourly" value={`${num(data.totals.Hours)} h`} foot={`${money(data.totals.HourlyPay)} hourly pay`} />
            </div>
            <div className="table-wrap">
              <table className="grid clickable">
                <thead><tr>
                  <th>{GROUPS.find(([k]) => k === p.groupBy)?.[1]}</th>
                  {p.groupBy === 'job' && <th>Builder</th>}{p.groupBy === 'lot' && <th>Plan</th>}
                  <th className="num">Lines</th><th className="num">Employees</th><th className="num">Piece pay</th><th className="num">Hours</th><th className="num">Hourly pay</th><th className="num">Total</th><th>Last paid</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={String(r.GroupKey)} onClick={() => set({ view: 'detail', ...DRILL[p.groupBy](r) })} tabIndex={0}>
                      <td><b>{r.GroupLabel}</b></td>
                      {p.groupBy === 'job' && <td>{r.Builder}</td>}{p.groupBy === 'lot' && <td>{r.PlanNum}</td>}
                      <td className="num">{r.Lines.toLocaleString()}</td><td className="num">{r.Employees}</td><td className="num">{money(r.PiecePay)}</td>
                      <td className="num">{num(r.Hours)}</td><td className="num">{money(r.HourlyPay)}</td><td className="num"><b>{money(r.TotalPay)}</b></td><td>{fmtDate(r.LastPaid)}</td>
                    </tr>
                  ))}
                  {!data.rows.length && <tr><td colSpan={9}><EmptyState title="No labor paid in this range" /></td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        !detail ? <SkeletonRows rows={8} cols={4} /> : (
          <>
            <div className="table-wrap">
              <table className="grid compact">
                <thead><tr><th>Payroll</th><th>Employee</th><th>Job</th><th>Lot</th><th>Pack</th><th>Item</th><th>Work</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Pay %</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Pay</th></tr></thead>
                <tbody>
                  {detail.rows.map((r) => (
                    <tr key={r.LaborPaidID}>
                      <td>{fmtDate(r.PayrollDate)}</td><td>{r.EmpName}</td><td>{r.JobName}</td><td>{r.Lot}{r.Block ? `/${r.Block}` : ''}</td><td className="wrap">{r.PackName}</td><td className="wrap">{r.Item}</td><td>{r.WorkType}</td>
                      <td className="num">{num(r.ExtItemQty)}</td><td className="num">{money(r.PriceEa)}</td><td className="num">{num(r.PayPercent, 1)}</td><td className="num">{num(r.PayHours)}</td>
                      <td className="num">{r.HourlyRate ? money(r.HourlyRate) : ''}</td><td className="num"><b>{money(r.ExtPay)}</b></td>
                    </tr>
                  ))}
                  {!detail.rows.length && <tr><td colSpan={13}><EmptyState title="No labor lines match" /></td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={detail.page} pageSize={detail.pageSize} total={detail.total} onPage={(pg) => setSp({ ...q, page: pg })} />
          </>
        )
      )}
    </div>
  )
}
