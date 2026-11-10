// AR reports: invoices by division / builder / job / month / day, lots left to bill, WIP by job.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { ArTabs, download, int, money, money0, useArLookups } from './shared'

const KINDS = [['invoices', 'Invoice totals'], ['to-bill', 'Lots left to bill'], ['wip', 'Work in progress']]
const GROUPS = [['division', 'Division'], ['customer', 'Builder'], ['job', 'Job'], ['month', 'Month'], ['day', 'Day']]

export default function ArReports() {
  const lk = useArLookups()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = { kind: 'invoices', groupBy: 'division', ...Object.fromEntries(sp.entries()) }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => {
    let live = true; setData(null); setError('')
    const params = { division: p.division, customerId: p.customerId, from: p.from, to: p.to, groupBy: p.groupBy, page: p.page, ready: p.ready, includeClosed: p.includeClosed }
    api(`/ar/reports/${p.kind}`, { params }).then((d) => live && setData({ ...d, _k: p.kind })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const ready = data && data._k === p.kind
  const drill = (r) => {
    const q = new URLSearchParams({ ...(p.from && { from: p.from }), ...(p.to && { to: p.to }), ...(p.division && { division: p.division }), ...(p.customerId && { customerId: p.customerId }) })
    if (p.groupBy === 'division') q.set('division', r.GroupKey)
    if (p.groupBy === 'customer') q.set('customerId', r.GroupKey)
    if (p.groupBy === 'job') q.set('jobId', r.GroupKey)
    if (p.groupBy === 'month') { q.set('from', `${r.GroupKey}-01`); q.set('to', `${r.GroupKey}-31`) }
    if (p.groupBy === 'day') { q.set('from', r.GroupLabel); q.set('to', r.GroupLabel) }
    nav(`/ar/invoices?${q}`)
  }
  function exportCsv() {
    if (!ready) return
    if (p.kind === 'invoices') download(data.rows, [['GroupLabel', 'Group'], ['Invoices', 'Invoices'], ['Total', 'Total'], ['First', 'First'], ['Last', 'Last']], `ar-invoices-by-${p.groupBy}.csv`)
    else if (p.kind === 'to-bill') download(data.rows, [['DivisionId', 'Div'], ['CustName', 'Builder'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['Contract', 'Contract'], ['Billed', 'Billed'], ['Remaining', 'Left to bill']], 'ar-lots-to-bill.csv')
    else download(data.rows, [['JobName', 'Job'], ['DivisionId', 'Div'], ['CustName', 'Builder'], ['Lots', 'Lots'], ['Contract', 'Contract'], ['Billed', 'Billed'], ['LaborPaid', 'Labor paid'], ['MaterialPosted', 'Material']], 'ar-wip.csv')
  }
  return (
    <div className="page">
      <PageHeader title="Receivables reports" subtitle="Invoice totals, lots left to bill and work in progress"
        actions={<><button className="btn" onClick={exportCsv} disabled={!ready}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <ArTabs />
      <div className="card form report-filters"><fieldset>
        {p.kind === 'invoices' && <><label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label><label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label></>}
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Builder<select value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">All</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {p.kind === 'to-bill' && <label className="check"><input type="checkbox" checked={p.ready === '1'} onChange={(e) => set({ ready: e.target.checked ? '1' : '' })} /> Only lots with a posted stage</label>}
        {p.kind === 'wip' && <label className="check"><input type="checkbox" checked={p.includeClosed === '1'} onChange={(e) => set({ includeClosed: e.target.checked ? '1' : '' })} /> Include finished lots</label>}
      </fieldset></div>
      <div className="filters">
        <div className="seg" role="tablist">{KINDS.map(([x, l]) => <button key={x} role="tab" aria-selected={p.kind === x} className={`seg-btn${p.kind === x ? ' active' : ''}`} onClick={() => set({ kind: x })}>{l}</button>)}</div>
        {p.kind === 'invoices' && <div className="seg">{GROUPS.map(([x, l]) => <button key={x} className={`seg-btn${p.groupBy === x ? ' active' : ''}`} onClick={() => set({ groupBy: x })}>By {l.toLowerCase()}</button>)}</div>}
      </div>
      {error && <ErrorState message={error} />}
      {!ready ? <SkeletonRows rows={8} cols={4} /> : p.kind === 'invoices' ? (
        <>
          <div className="kpis"><StatCard label="Invoices" tone="blue" value={int(data.totals.Invoices)} foot="In the range" /><StatCard label="Billed" tone="green" value={money0(data.totals.Total)} foot="Credits subtract" /></div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>{GROUPS.find(([x]) => x === p.groupBy)[1]}</th><th className="num">Invoices</th><th className="num">Total</th><th>First</th><th>Last</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.GroupKey ?? r.GroupLabel} className="link-row" onClick={() => drill(r)}><td><a><b>{r.GroupLabel}</b></a></td><td className="num">{int(r.Invoices)}</td><td className="num">{money(r.Total)}</td><td>{fmtDate(r.First)}</td><td>{fmtDate(r.Last)}</td></tr>)}
              {!data.rows.length && <tr><td colSpan={5}><EmptyState title="No invoices in this range" /></td></tr>}</tbody>
          </table></div>
        </>
      ) : p.kind === 'to-bill' ? (
        <>
          <div className="kpis">
            <StatCard label="Lots" tone="blue" value={int(data.total)} foot="Open, not fully billed" />
            <StatCard label="Contract" tone="violet" value={money0(data.summary.contract)} foot="Of these lots" />
            <StatCard label="Billed" tone="green" value={money0(data.summary.billed)} foot="So far" />
            <StatCard label="Left to bill" tone="amber" value={money0(data.summary.remaining)} foot="Contract − billed" />
          </div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Div</th><th>Builder</th><th>Job</th><th>Lot</th><th>Plan</th><th className="num">Contract</th><th className="num">Billed</th><th className="num">Billed %</th><th className="num">Left</th><th className="num">Posted stages</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.LotID}><td>{r.DivisionId}</td><td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td><Link to={`/ar/billing/lots/${r.LotID}`}><b>{r.Lot}/{r.Block}</b></Link></td><td>{r.PlanNum}</td>
                <td className="num">{money(r.Contract)}</td><td className="num">{money(r.Billed)}</td><td className="num">{r.BilledPct == null ? '' : `${Number(r.BilledPct).toFixed(0)}%`}</td><td className="num"><b>{money(r.Remaining)}</b></td><td className="num">{int(r.PostedStages)}</td></tr>
            ))}{!data.rows.length && <tr><td colSpan={10}><EmptyState title="Every open lot is fully billed" /></td></tr>}</tbody>
          </table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => set({ page: pg })} />
        </>
      ) : (
        <>
          <div className="kpis">
            <StatCard label="Contract" tone="violet" value={money0(data.totals.Contract)} foot="Open lots" />
            <StatCard label="Billed" tone="green" value={money0(data.totals.Billed)} foot={data.totals.Contract ? `${Math.round(data.totals.Billed / data.totals.Contract * 100)}% of contract` : ''} />
            <StatCard label="Labor paid" tone="blue" value={money0(data.totals.Labor)} foot="Piece and hourly" />
            <StatCard label="Material posted" tone="amber" value={money0(data.totals.Material)} foot="Job cost" />
          </div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Job</th><th>Div</th><th>Builder</th><th className="num">Lots</th><th className="num">Contract</th><th className="num">Billed</th><th className="num">Left</th><th className="num">Labor paid</th><th className="num">Material</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.JobId} className="link-row" onClick={() => nav(`/ar/invoices?jobId=${r.JobId}`)}><td className="wrap"><a><b>{r.JobName}</b></a></td><td>{r.DivisionId}</td><td>{r.CustName}</td><td className="num">{int(r.Lots)}</td>
                <td className="num">{money(r.Contract)}</td><td className="num">{money(r.Billed)}</td><td className="num"><b>{money((r.Contract || 0) - (r.Billed || 0))}</b></td><td className="num">{money(r.LaborPaid)}</td><td className="num">{money(r.MaterialPosted)}</td></tr>
            ))}{!data.rows.length && <tr><td colSpan={9}><EmptyState title="No jobs" /></td></tr>}</tbody>
          </table></div>
        </>
      )}
    </div>
  )
}
