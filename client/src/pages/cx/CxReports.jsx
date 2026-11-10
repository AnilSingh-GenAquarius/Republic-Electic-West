// Cox reports (Access SwitchCX report buttons + the material request reprint). Each report shows only the filters it needs.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ClipboardList, Download, FileText, MapPin, Printer, Receipt, Search, Truck } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { InvoiceRunSummary, Invoices, MaterialRequestDocs, RequestCheck, RequestSummary } from './CxDocs'
import { CxTabs, download, groupBy, longDate } from './shared'

const REPORTS = [
  { key: 'roughed-lots', label: 'Roughed lots / ready bill', icon: ClipboardList, needs: ['from', 'to'], text: 'Roughed lots with a material request, not yet invoiced (first rough payroll in the period)' },
  { key: 'billing-date', label: 'Billing by date', icon: Receipt, needs: ['date'], text: 'Cox invoices created on a date' },
  { key: 'billing-date-summary', label: 'Billing by date summary', icon: FileText, needs: ['date'], text: 'Invoice run summary for a date' },
  { key: 'billing-invoice', label: 'Billing by invoice #', icon: Receipt, needs: ['invoice'], text: 'Reprint one Cox invoice' },
  { key: 'pending-no-rbi', label: 'Pending lots no RBI', icon: AlertTriangle, needs: [], text: 'Material requested, not invoiced, no Oracle project #' },
  { key: 'address-search', label: 'Address lot search', icon: MapPin, needs: ['lotId'], text: 'Everything about one lot, with its packs and Cox invoice' },
  { key: 'matreq-reprint', label: 'Reprint material request', icon: Printer, needs: ['date'], text: 'R1 and MDU request forms and summary of a request date' },
  { key: 'matreq-summary', label: 'Material request summary', icon: Truck, needs: ['date'], text: 'Items requested on a date and the estimated billing' },
  { key: 'matreq-check', label: 'Jobs without Cox data', icon: Search, needs: [], text: 'Active jobs whose unrequested lots have no Cox plan data' },
]
const CSV = {
  'roughed-lots': [['CustName', 'Customer'], ['JobName', 'Job'], ['AssessorName', 'Assessor'], ['JobType', 'Type'], ['LotBlock', 'Lot'], ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['PayrollDate', 'Payroll date'], ['RBI', 'RBI'], ['DateCoxMatReq', 'Mat req date'], ['OpExAccNum', 'Oracle proj #'], ['LaborReqNum', 'Req #'], ['LaborPoNum', 'PO #']],
  billing: [['Invoice', 'Invoice'], ['Date', 'Date'], ['AssessorName', 'Project'], ['JobName', 'Job'], ['OpExAccNum', 'Project #'], ['TaskNum', 'Task #'], ['LaborReqNum', 'Req #'], ['LaborPoNum', 'PO #'], ['LotBlock', 'Lot'], ['Address', 'Address'], ['Item', 'Item'], ['Quantity', 'Qty'], ['PriceEa', 'Price ea'], ['ExtPrice', 'Ext price']],
  'pending-no-rbi': [['DateCoxMatReq', 'Mat requisitioned date'], ['JobName', 'Job'], ['AssessorName', 'Project (assessor)'], ['LotBlock', 'Lot'], ['Address', 'Address']],
  'address-search': [['Code', 'Code'], ['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/Block'], ['PlanNum', 'Plan'], ['Address', 'Address'], ['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Pack qty'], ['InvoiceNum', 'Cox invoice']],
  'matreq-summary': [['Lots', 'Lots'], ['Item', 'Item'], ['Quantity', 'Quantity'], ['BillPrice', 'Amount ea'], ['ExtCost', 'Estimated billing']],
  'matreq-check': [['CustName', 'Customer'], ['JobName', 'Job'], ['SampleAddress', 'Sample address']],
}
const csvCols = (k) => (k.startsWith('billing') ? CSV.billing : CSV[k])

export default function CxReports() {
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [invoices, setInvoices] = useState([])
  const [lotLabel, setLotLabel] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const ready = rep && rep.needs.every((k) => p[k])
  useEffect(() => { if (p.report === 'billing-invoice') api('/cx/overview').then((o) => setInvoices(o.invoices)).catch(() => {}) }, [p.report])
  useEffect(() => {
    setData(null); setError('')
    if (!ready) return
    let live = true
    const url = rep.key === 'matreq-reprint' ? '/cx/matreq/reprint' : `/cx/reports/${rep.key}`
    api(url, { params: { from: p.from, to: p.to, date: p.date, invoice: p.invoice, lotId: p.lotId } }).then((d) => live && setData({ d, k: rep.key })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const ok = data && data.k === p.report
  const cols = rep && csvCols(rep.key)
  return (
    <div className="page">
      <PageHeader title="Cox reports" subtitle="Pick a report; the filters it needs appear below"
        actions={ok && <>{cols && Array.isArray(data.d) && <button className="btn" onClick={() => download(data.d, cols, `cx-${rep.key}.csv`)}><Download size={15} /> CSV</button>}<button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <CxTabs />
      <div className="fm-reports no-print">{REPORTS.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => set({ report: r.key })}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}</div>
      {rep && rep.needs.length > 0 && (
        <div className="card form report-filters no-print"><fieldset>
          {rep.needs.includes('from') && <label>From<input type="date" aria-label="From" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>}
          {rep.needs.includes('to') && <label>To<input type="date" aria-label="To" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>}
          {rep.needs.includes('date') && <label>Date<input type="date" aria-label="Date" value={p.date || ''} onChange={(e) => set({ date: e.target.value })} /></label>}
          {rep.needs.includes('invoice') && <label>Cox invoice<select aria-label="Cox invoice" value={p.invoice || ''} onChange={(e) => set({ invoice: e.target.value })}><option value="">Choose…</option>
            {invoices.map((x) => <option key={x.InvoiceNum} value={x.InvoiceNum}>Cox{x.InvoiceNum} · {x.AssessorJob} · {fmtDate(x.Date)}</option>)}</select></label>}
          {rep.needs.includes('lotId') && <label className="span2">Lot address<SearchSelect endpoint="/cx/pick/lots" value={p.lotId} label={lotLabel || (p.lotId ? `Lot ${p.lotId}` : '')} placeholder="Search address…" onSelect={(l) => { setLotLabel(l?.name || ''); set({ lotId: l?.id }) }} /></label>}
        </fieldset></div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState title="Choose a report" /> : !ready ? <EmptyState title="Complete the filters above" /> : !ok ? <SkeletonRows rows={8} cols={5} /> : <div className="fm-sheet"><Report k={rep.key} d={data.d} p={p} label={rep.label} /></div>}
    </div>
  )
}

function Table({ rows, cols, money: mcols = [], dates = [] }) {
  return (
    <div className="table-wrap"><table className="grid compact">
      <thead><tr>{cols.map(([c, l]) => <th key={c} className={mcols.includes(c) ? 'num' : ''}>{l}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([c]) => <td key={c} className={mcols.includes(c) ? 'num' : c === 'Address' || c === 'JobName' ? 'wrap' : ''}>{dates.includes(c) ? fmtDate(r[c]) : r[c]}</td>)}</tr>)}</tbody>
    </table></div>
  )
}

function Report({ k, d, p, label }) {
  if (k === 'matreq-reprint') return <MaterialRequestDocs single={d.single} multi={d.multi} summary={d.summary} date={d.date} />
  if (k === 'matreq-summary') return <RequestSummary rows={d} date={p.date} />
  if (k === 'matreq-check') return d.length ? <RequestCheck rows={d} /> : <><h2>{label}</h2><EmptyState title="Every active job with unrequested lots has Cox plan data" /></>
  if (k === 'billing-date' || k === 'billing-invoice') return <Invoices rows={d} />
  if (k === 'billing-date-summary') return <InvoiceRunSummary rows={d} date={p.date} />
  if (!d.length) return <><h2>{label}</h2><EmptyState title="Nothing to show" /></>
  if (k === 'roughed-lots') {
    return (
      <>
        <div className="fm-head"><div><h2>Roughed lots ready for Cox billing</h2><div className="muted">From {fmtDate(p.from)} to {fmtDate(p.to)} · {d.length} lot(s) · {d.filter((r) => r.RBI === 'Yes').length} with RBI</div></div></div>
        {groupBy(d, (r) => r.JobName).map(([job, g]) => (
          <div key={job} className="fm-lot">
            <h3>{job} <span className="muted">· {g[0].CustName} · {g[0].JobType} · {g[0].AssessorName}</span></h3>
            <Table rows={g} cols={[['LotBlock', 'Lot'], ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['PayrollDate', 'Payroll date'], ['RBI', 'RBI'], ['DateCoxMatReq', 'Mat req date'], ['OpExAccNum', 'Oracle proj #'], ['LaborReqNum', 'Req #'], ['LaborPoNum', 'PO #']]} dates={['PayrollDate', 'DateCoxMatReq']} />
          </div>
        ))}
      </>
    )
  }
  if (k === 'pending-no-rbi') {
    return (
      <>
        <div className="fm-head"><div><h2>Pending lots with no Cox RBI (required billing info)</h2><div className="muted">{d.length} lot(s)</div></div></div>
        {groupBy(d, (r) => String(r.DateCoxMatReq)).map(([dt, g]) => (
          <div key={dt} className="fm-lot">
            <h3>Material requisitioned {longDate(g[0].DateCoxMatReq)} <span className="muted">· {g.length} lot(s)</span></h3>
            <Table rows={g.map((r, i) => ({ ...r, n: i + 1 }))} cols={[['n', '#'], ['JobName', 'Job name'], ['AssessorName', 'Project name (assessor)'], ['LotBlock', 'Lot'], ['Address', 'Address']]} />
          </div>
        ))}
      </>
    )
  }
  if (k === 'address-search') {
    const r = d[0]
    const f = (l, v) => <div><dt>{l}</dt><dd>{v || '—'}</dd></div>
    return (
      <>
        <div className="fm-head"><div><h2>Address search</h2><div className="muted">{r.Address}{r.City ? `, ${r.City}` : ''} {r.State || ''} {r.Zip || ''}</div></div>
          <dl>{f('Code', r.Code)}{f('Customer', r.CustName)}{f('Job', r.JobName)}{f('Phase', r.Phase)}{f('Super', r.SuperName)}{f('Phase start', fmtDate(r.PhaseStartDate))}
            {f('Bid num', r.BidNum)}{f('Eff release', r.BidRelease)}{f('Name', r.BidName)}{f('Eff date', fmtDate(r.BidDate))}{f('Lot/Block', r.LotBlock)}{f('Plan', [r.PlanNum, r.PlanName].filter(Boolean).join(' – '))}
            {f('Permit', r.Permit)}{f('Lot start date', fmtDate(r.StartDate))}{f('Lot end date', fmtDate(r.EndDate))}{f('Warranty date', fmtDate(r.WarrantyDate))}{f('Date entered', fmtDate(r.DateEntered))}{f('User entered', r.UserEntered)}
            {f('Cox invoice', r.InvoiceNum ? `Cox${r.InvoiceNum}` : '')}{f('Notes', r.LotNotes)}</dl></div>
        <Table rows={d.filter((x) => x.PackName)} cols={[['BuilderCode', 'Builder option code'], ['PackName', 'Pack/option name'], ['PackQty', 'Pack qty']]} money={['PackQty']} />
      </>
    )
  }
  return null
}
