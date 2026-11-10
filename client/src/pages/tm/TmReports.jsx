// T&M reports: totals grouped by user / customer / job / work / division / super / month, plus the unpaid, quote and
// no-customer-PO lists (Access TmByUser, TmByCustomer, TmByJob, TmByWork, TmByDivision, TmPoUnpaid*, TmQuote, TmNoCustomerPO).
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { TmTabs, lotLabel, money, useTmLookups } from './shared'

const GROUPS = [['user', 'User'], ['customer', 'Customer'], ['job', 'Job'], ['work', 'Work type'], ['division', 'Division'], ['super', 'Superintendent'], ['month', 'Month']]
const LISTS = [['unpaid', 'Unpaid'], ['quotes', 'Quotes'], ['no-customer-po', 'No customer PO'], ['all', 'All T&M']]
const iso = (d) => d.toISOString().slice(0, 10)

function download(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[k]) ? r[k].slice(0, 10) : r[k])).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

export default function TmReports() {
  const nav = useNavigate()
  const lk = useTmLookups()
  const [sp, setSp] = useSearchParams()
  const y = new Date(); y.setMonth(y.getMonth() - 3)
  const p = { view: 'summary', groupBy: 'user', status: 'all', kind: 'unpaid', from: iso(y), ...Object.fromEntries(sp.entries()) }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const filt = { from: p.from, to: p.to, division: p.division, preparedBy: p.preparedBy }

  useEffect(() => {
    setData(null); setError('')
    const req = p.view === 'summary' ? api('/tm/reports/summary', { params: { ...filt, groupBy: p.groupBy, status: p.status } }) : api('/tm/reports/detail', { params: { ...filt, kind: p.kind, page: p.page } })
    req.then((d) => setData({ ...d, _v: p.view })).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])

  async function exportCsv() {
    if (p.view === 'summary') download(data.rows, [['GroupLabel', GROUPS.find(([k]) => k === p.groupBy)[1]], ['Tms', 'T&Ms'], ['Subtotal', 'Subtotal'], ['DiscountAmt', 'Discount'], ['SalesTax', 'Sales tax'], ['Total', 'Total'], ['Paid', 'Paid'], ['Unpaid', 'Unpaid']], `tm-by-${p.groupBy}.csv`)
    else { const r = await api('/tm/reports/detail', { params: { ...filt, kind: p.kind, pageSize: 200 } }); download(r.rows, [['TmID', 'T&M #'], ['TmDate', 'Date'], ['TmName', 'Name'], ['TmCustomerNum', 'Customer PO'], ['CustName', 'Builder'], ['JobName', 'Job'], ['Lot', 'Lot'], ['PreparedBy', 'Prepared by'], ['Subtotal', 'Subtotal'], ['SalesTax', 'Sales tax'], ['Total', 'Total'], ['PaidDate', 'Paid']], `tm-${p.kind}.csv`) }
  }

  return (
    <div className="page">
      <PageHeader title="T&M reports" subtitle="Totals by user, customer, job, work type or division; unpaid orders, quotes and orders without a customer PO"
        actions={<><button className="btn" onClick={exportCsv} disabled={!data}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <TmTabs />
      <div className="card form report-filters"><fieldset>
        <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Prepared by<select value={p.preparedBy || ''} onChange={(e) => set({ preparedBy: e.target.value })}><option value="">Anyone</option>{lk.users.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></label>
      </fieldset></div>
      <div className="filters">
        <div className="seg"><button className={`seg-btn${p.view === 'summary' ? ' active' : ''}`} onClick={() => set({ view: 'summary' })}>Totals</button><button className={`seg-btn${p.view === 'list' ? ' active' : ''}`} onClick={() => set({ view: 'list' })}>Lists</button></div>
        {p.view === 'summary' ? (
          <>
            <div className="seg" role="tablist" aria-label="Group by">{GROUPS.map(([k, l]) => <button key={k} role="tab" aria-selected={p.groupBy === k} className={`seg-btn${p.groupBy === k ? ' active' : ''}`} onClick={() => set({ groupBy: k })}>{l}</button>)}</div>
            <select value={p.status} onChange={(e) => set({ status: e.target.value })} aria-label="Payment"><option value="all">Paid &amp; unpaid</option><option value="unpaid">Unpaid only</option><option value="paid">Paid only</option><option value="quotes">Quotes only</option></select>
          </>
        ) : <div className="seg">{LISTS.map(([k, l]) => <button key={k} className={`seg-btn${p.kind === k ? ' active' : ''}`} onClick={() => set({ kind: k })}>{l}</button>)}</div>}
      </div>
      {error && <ErrorState message={error} />}
      {!data || data._v !== p.view ? <SkeletonRows rows={8} cols={4} /> : p.view === 'summary' ? (
        <>
          <div className="kpis">
            <StatCard label="T&M orders" value={data.totals.Tms} tone="blue" foot="In the range" />
            <StatCard label="Total value" value={money(data.totals.Total)} tone="green" foot="Including sales tax" />
            <StatCard label="Unpaid" value={money(data.totals.Unpaid)} tone="red" foot="No paid date" />
            <StatCard label="Paid" value={money(data.totals.Paid)} foot="Has a paid date" />
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>{GROUPS.find(([k]) => k === p.groupBy)[1]}</th><th className="num">T&Ms</th><th className="num">Subtotal</th><th className="num">Discount</th><th className="num">Sales tax</th><th className="num">Total</th><th className="num">Unpaid</th><th className="num">Paid</th></tr></thead>
              <tbody>
                {data.rows.map((r) => <tr key={String(r.GroupKey)}><td><b>{r.GroupLabel}</b></td><td className="num">{r.Tms}</td><td className="num">{money(r.Subtotal)}</td><td className="num">{money(r.DiscountAmt)}</td><td className="num">{money(r.SalesTax)}</td><td className="num"><b>{money(r.Total)}</b></td><td className="num">{money(r.Unpaid)}</td><td className="num">{money(r.Paid)}</td></tr>)}
                {!data.rows.length && <tr><td colSpan={8}><EmptyState title="Nothing in this range" /></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="kpis"><StatCard label={LISTS.find(([k]) => k === p.kind)[1]} value={data.total} tone="blue" foot="orders" /><StatCard label="Value" value={money(data.amount)} tone="green" foot="Including sales tax" /></div>
          <div className="table-wrap">
            <table className="grid clickable">
              <thead><tr><th>T&M #</th><th>Date</th><th>Name</th><th>PO #</th><th>Builder</th><th>Job / lot</th><th>Super</th><th>By</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.rows.map((r) => <tr key={r.TmID} onClick={() => nav(`/tm/${r.TmID}`)} tabIndex={0}><td><b>{r.TmID}</b></td><td>{fmtDate(r.TmDate)}</td><td className="wrap">{r.TmName}</td><td>{r.TmCustomerNum}</td><td>{r.CustName}</td><td className="wrap">{r.JobName} · {lotLabel(r)}</td><td>{r.SuperName}</td><td>{r.PreparedBy}</td><td className="num">{money(r.Subtotal)}</td><td className="num">{money(r.SalesTax)}</td><td className="num"><b>{money(r.Total)}</b></td></tr>)}
                {!data.rows.length && <tr><td colSpan={11}><EmptyState title="Nothing to list" /></td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}
