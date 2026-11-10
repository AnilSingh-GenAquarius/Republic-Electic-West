// CS reports (SwitchCS "Reports" + "Mobile app" tabs) with the switchboard filters A–I.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BarChart3, Building2, CalendarDays, ClipboardList, Download, FileSearch, Hammer, Home as HomeIcon, ListChecks, Mail, MapPin, Package, Printer, Route, Timer, Users, Wrench } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, download, money, num, useCsLookups } from './shared'

const D = (v) => fmtDate(v) || ''
const yes = (v) => (v ? 'Yes' : '')
// [key, label, icon, needs (filter letters), description, columns, group]
const REPORTS = [
  { key: 'lot-address', label: 'Address lot search', icon: MapPin, needs: 'A', text: 'Production lot, plan and packs for a lot address', group: ['LotBlock'],
    cols: [['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Qty', 'num']], head: LotHead },
  { key: 'jobs-alpha', label: 'Jobs alphabetical', icon: Building2, needs: '', text: 'Every job by division', group: ['DivisionId'],
    cols: [['JobName', 'Job'], ['JobNum', 'Job #'], ['CustName', 'Builder'], ['Status', 'Status'], ['LastOfSuperName', 'Superintendent']] },
  { key: 'jobs-city', label: 'Jobs by city', icon: Building2, needs: '', opt: 'E', text: 'Jobs grouped by city (division E optional)', group: ['City'],
    cols: [['JobName', 'Job'], ['JobNum', 'Job #'], ['CustName', 'Builder'], ['DivisionId', 'Div'], ['Status', 'Status'], ['LastOfSuperName', 'Superintendent']] },
  { key: 'lot-info', label: 'Lot info search', icon: FileSearch, needs: 'C', text: 'Production lot, plan and packs of the lot', group: ['LotBlock'],
    cols: [['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Qty', 'num']], head: LotHead },
  { key: 'homeowner', label: 'Homeowner search', icon: Users, needs: 'F', text: 'Properties, plan and packs of a homeowner', group: ['Job', 'CsLot'],
    cols: [['Property', 'Property'], ['CustomerType', 'Type'], ['PlanNum', 'Plan'], ['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Qty', 'num'], ['StartDate', 'Start', D], ['EndDate', 'End', D]] },
  { key: 'ticket-hv', label: 'Ticket HV', icon: ClipboardList, needs: 'GE', text: 'High voltage ticket sheets for the from date', sheet: true },
  { key: 'ticket-lv', label: 'Ticket LV', icon: ClipboardList, needs: 'GE', text: 'Low voltage ticket sheets for the from date', sheet: true },
  { key: 'route-sheet', label: 'Route sheet', icon: Route, needs: 'GE', text: 'Tickets of the from date, a page per technician', group: ['Tech'], pageBreak: true,
    cols: [['TicketID', 'Ticket'], ['ApptTime', 'Time'], ['TicketType', 'Type'], ['CsJobType', 'Job type'], ['JobLot', 'Job | lot'], ['Property', 'Property'], ['Customer', 'Customer'], ['CustomerPONum', 'PO #'], ['HighCeiling', 'High ceiling', yes], ['Notes', 'Notes']] },
  { key: 'feedback-address', label: 'Feedback by address', icon: MapPin, needs: 'GHE', text: 'Ticket findings by job and lot', group: ['Job', 'CsLot'],
    cols: [['ApptDate', 'Date', D], ['TicketId', 'Ticket'], ['Street', 'Street'], ['City', 'City'], ['Error', 'Error'], ['Category', 'Category'], ['Detail', 'Detail'], ['ScheduleStage', 'Stage']] },
  { key: 'feedback-employee', label: 'Feedback by employee', icon: Users, needs: 'GHE', text: 'Findings by lot with the installers paid on the lot', group: ['Job', 'CsLot'],
    cols: [['ApptDate', 'Date', D], ['TicketId', 'Ticket'], ['Street', 'Street'], ['Error', 'Error'], ['Category', 'Category'], ['Detail', 'Detail'], ['ScheduleStage', 'Stage']] },
  { key: 'feedback-error', label: 'Feedback by error', icon: AlertTriangle, needs: 'GHE', text: 'Findings by error with hot spots (most frequent first)', group: ['Error', 'Category', 'Detail'],
    cols: [['HotSpot', 'Hot spot', (v) => `hs# ${v}`], ['ApptDate', 'Date', D], ['TicketId', 'Ticket'], ['Job', 'Job'], ['CsLot', 'Lot'], ['Street', 'Street'], ['ScheduleStage', 'Stage'], ['TechName', 'Technician']] },
  { key: 'ticket-error-type', label: 'Tickets by error type', icon: ListChecks, needs: 'GHI', text: 'Tickets due to an error type, hours on site and cost', group: ['Builder', 'Job'],
    cols: [['ApptDate', 'Date', D], ['TicketId', 'Ticket'], ['CsLot', 'Lot'], ['Street', 'Street'], ['City', 'City'], ['EstimatedHours', 'Est hrs', 'num'], ['TimeAtJob', 'Hours', 'num3'], ['HourlyCost', 'Rate', 'money'], ['Cost', 'Cost', 'money']] },
  { key: 'worker-error-type', label: 'Error type by worker', icon: Hammer, needs: 'GHI', text: 'Installers paid for the stage of the error', group: ['EmpName', 'SuperName', 'Job'],
    cols: [['CsLot', 'Lot'], ['ApptDate', 'Date', D], ['TicketId', 'Ticket'], ['Builder', 'Builder'], ['ScheduleStage', 'Stage'], ['Category', 'Category'], ['ErrorDetail', 'Detail']] },
  { key: 'ticket-error-summary', label: 'Ticket error summary', icon: BarChart3, needs: 'GH', text: 'Tickets, hours and cost by division, error and builder', group: ['DivisionId', 'Error'],
    cols: [['Builder', 'Builder'], ['TicketCount', 'Tickets', 'num'], ['TimeAtJob', 'Hours', 'num3'], ['HourlyCost', 'Rate', 'money'], ['Cost', 'Cost', 'money'], ['CostPerTicket', 'Cost / ticket', 'money']] },
  { key: 'ticket-hours-summary', label: 'Ticket hours summary', icon: Timer, needs: 'GH', text: 'Hours on site per ticket and technician', group: ['DivisionId', 'Builder'],
    cols: [['Job', 'Job'], ['Jurisdiction', 'Jurisdiction'], ['SuperName', 'Super'], ['ApptDate', 'Date', D], ['TicketID', 'Ticket'], ['Technician', 'Technician'], ['TimeAtJob', 'Hours', 'num3'], ['HourlyCost', 'Rate', 'money'], ['Cost', 'Cost', 'money']] },
  { key: 'job-worker-error-type', label: 'Error type by job/worker', icon: Wrench, needs: 'GHI', text: 'Findings by job, lot and ticket with the installers', group: ['Job', 'CsLot', 'TicketId'],
    cols: [['ApptDate', 'Date', D], ['Builder', 'Builder'], ['SuperName', 'Super'], ['ScheduleStage', 'Stage'], ['Category', 'Category'], ['ErrorDetail', 'Detail'], ['EmpName', 'Installer'], ['TicketHours', 'Ticket hrs', 'num3']] },
  { key: 'open-lots-scheduled', label: 'Open lots scheduled', icon: CalendarDays, needs: '', text: 'Tickets of the last 15 days on lots still open in production',
    cols: [['TicketID', 'Ticket'], ['ApptDate', 'Date', D], ['Address', 'Address'], ['City', 'City'], ['CustName', 'Builder'], ['JobName', 'Job'], ['LotBlock', 'Lot']] },
  { key: 'material-posted-lot', label: 'Material posted to lot', icon: Package, needs: 'C', text: 'Material (not labor) posted to the lot', group: ['WorkType', 'ScheduleStage'],
    cols: [['InvItem', 'Item'], ['CostCodeId', 'CC'], ['ExtItemQty', 'Qty', 'num'], ['Notes', 'Notes'], ['DateEntered', 'Entered', D], ['UserEntered', 'By']] },
  { key: 'lot-ticket', label: 'Lot & ticket search', icon: HomeIcon, needs: 'C', text: 'The lot and every CS ticket on it', head: LotHead, group: ['LotBlock'],
    cols: [['TicketID', 'Ticket'], ['ApptDate', 'Date', D], ['Notes', 'Notes']] },
  { key: 'export-appointments', label: 'Export appointment data', icon: Download, needs: 'GH', text: 'Six CSV files for CS Mobile (active tickets in the period)', exportFiles: true },
]
const NEED = { A: 'lotAddressId', B: 'jobId', C: 'lotId', E: 'division', F: 'customerId', G: 'from', H: 'to', I: 'errorId' }
const NEED_TEXT = { A: 'lot address (A)', B: 'job (B)', C: 'lot (C)', E: 'division (E)', F: 'homeowner (F)', G: 'from date (G)', H: 'to date (H)', I: 'error type (I)' }

function fmt(v, f) {
  if (typeof f === 'function') return f(v)
  if (f === 'num') return num(v)
  if (f === 'num3') return num(v, 3)
  if (f === 'money') return money(v)
  return v == null ? '' : String(v)
}
function LotHead({ row }) {
  return (
    <dl className="cs-dl" style={{ marginBottom: 8 }}>
      {[['Code', row.Code], ['Builder', row.CustName], ['Job', row.JobName], ['Phase', row.Phase], ['Bid', [row.BidNum, row.BidRelease, row.BidName].filter(Boolean).join(' ')], ['Superintendent', row.SuperName], ['Status', row.Status],
        ['Plan', [row.PlanNum, row.PlanName].filter(Boolean).join(' ')], ['Address', [row.Address, row.City, row.State, row.Zip].filter(Boolean).join(', ')], ['Permit', row.Permit], ['Start', D(row.StartDate)], ['End', D(row.EndDate)],
        ['Warranty', row.WarrantyDate], ['Invoice #', row.InvoiceNum], ['Lot notes', row.LotNotes]].filter(([, v]) => v).map(([l, v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

function Grouped({ rep, rows, extra }) {
  const g = rep.group || []
  if (!g.length) return <Table cols={rep.cols} rows={rows} />
  const groups = []
  for (const r of rows) {
    const k = g.map((x) => r[x] ?? '').join(' | ')
    let grp = groups.find((x) => x.k === k)
    if (!grp) { grp = { k, rows: [] }; groups.push(grp) }
    grp.rows.push(r)
  }
  return groups.map((grp) => (
    <div key={grp.k} className={`cs-sheet${rep.pageBreak ? ' cs-route-page' : ''}`}>
      <div className="cs-sheet-head"><h3>{rep.key === 'route-sheet' ? `Ticket route sheet for ${grp.rows[0].Tech}` : grp.k || '(none)'}</h3><span className="muted">{grp.rows.length} line(s)</span></div>
      {rep.head && <rep.head row={grp.rows[0]} />}
      <Table cols={rep.cols} rows={grp.rows} />
      {extra && extra(grp.rows)}
    </div>
  ))
}
function Table({ cols, rows }) {
  return (
    <div className="table-wrap flat"><table className="grid compact">
      <thead><tr>{cols.map(([k, l, f]) => <th key={k} className={['num', 'num3', 'money'].includes(f) ? 'num' : undefined}>{l}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([k, , f]) => <td key={k} className={['num', 'num3', 'money'].includes(f) ? 'num' : 'wrap'}>{fmt(r[k], f)}</td>)}</tr>)}</tbody>
    </table></div>
  )
}
function TicketSheets({ rows, hv }) {
  return rows.map((r) => (
    <div key={r.TicketID} className="cs-sheet cs-route-page">
      <div className="cs-sheet-head"><h3>Ticket {r.TicketID} · {D(r.ApptDate)} · {r.ApptTime}</h3><span>{r.TicketType} · {r.CsJobType} · {r.DivisionId}</span></div>
      <dl className="cs-dl">
        <div><dt>{hv ? 'Builder | job | lot' : 'Job | lot'}</dt><dd>{r.JobLot}</dd></div>
        <div><dt>Property</dt><dd>{r.Property}</dd></div>
        <div><dt>Escrow</dt><dd>{D(r.Escrow) || '—'}</dd></div>
        <div><dt>Customer</dt><dd>{r.Customer}</dd></div>
        <div><dt>Phones</dt><dd>{r.Phones.map((p, i) => <div key={i}>{p.PhoneType}: {p.PhoneNum}</div>)}{!r.Phones.length && '—'}</dd></div>
        <div><dt>Builder rep</dt><dd>{[r.RepName, r.RepPhone].filter(Boolean).join(' · ') || '—'}</dd></div>
        {r.CustomerPONum && <div><dt>PO #</dt><dd>{r.CustomerPONum}</dd></div>}
        {r.HighCeiling && <div><dt>High ceiling</dt><dd>Yes</dd></div>}
        <div><dt>Status</dt><dd>{r.Status}</dd></div>
        <div><dt>Technicians</dt><dd>{r.Technicians.join(', ') || '—'}</dd></div>
      </dl>
      {r.Notes && <p style={{ marginTop: 8 }}><b>Notes:</b> {r.Notes}</p>}
    </div>
  ))
}

export default function CsReports() {
  const lk = useCsLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const [labels, setLabels] = useState({})
  const [lots, setLots] = useState([])
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  const missing = rep ? [...rep.needs].filter((c) => !p[NEED[c]]) : []
  useEffect(() => { setLots([]); if (p.jobId) api('/cs/filters/lots', { params: { jobId: p.jobId } }).then(setLots).catch(() => {}) }, [p.jobId])
  useEffect(() => {
    setD(null); setError('')
    if (!rep || missing.length) return
    let live = true
    setLoading(true)
    const params = Object.fromEntries(Object.values(NEED).map((k) => [k, p[k]]))
    api(`/cs/reports/${rep.key}`, { params }).then((r) => live && setD(r)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const filterLine = rep ? [...(rep.needs + (rep.opt || ''))].map((c) => {
    const v = p[NEED[c]]
    if (!v) return null
    const lab = c === 'E' ? v : c === 'I' ? lk.errors.find((x) => String(x.id) === v)?.name : c === 'C' ? lots.find((x) => String(x.id) === v)?.name || v : labels[c] || v
    return `${NEED_TEXT[c].replace(/ \(.\)/, '')}: ${c === 'G' || c === 'H' ? D(v) : lab}`
  }).filter(Boolean).join(' · ') : ''
  const mailBody = encodeURIComponent(`Hello, attached are the excel files to import into CS Mobile (appointments ${p.from || ''} to ${p.to || ''}).`)
  return (
    <div className="page">
      <PageHeader title="CS reports" subtitle="Choose the filters the report needs (letters as on the Access switchboard), then a report"
        actions={d && rep && !rep.exportFiles ? <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button> : null} />
      <CsTabs />
      <div className="card form report-filters no-print"><fieldset>
        <label>A · Lot address<SearchSelect endpoint="/cs/filters/lot-addresses" value={p.lotAddressId ? Number(p.lotAddressId) : null} label={labels.A || (p.lotAddressId ? `Lot #${p.lotAddressId}` : '')} placeholder="Search address…" onSelect={(r) => { setLabels({ ...labels, A: r?.name }); set({ lotAddressId: r?.id ?? '' }) }} /></label>
        <label>B · Job<SearchSelect endpoint="/cs/filters/jobs" value={p.jobId ? Number(p.jobId) : null} label={labels.B || (p.jobId ? `Job #${p.jobId}` : '')} placeholder="Search job…" onSelect={(r) => { setLabels({ ...labels, B: r?.name }); set({ jobId: r?.id ?? '', lotId: '' }) }} /></label>
        <label>C · Lot<select value={p.lotId || ''} disabled={!p.jobId} onChange={(e) => set({ lotId: e.target.value })}><Options list={lots} blank={p.jobId ? '' : 'Pick a job first'} /></select></label>
        <label>D · Resolution<select value={p.resolutionId || ''} onChange={(e) => set({ resolutionId: e.target.value })}><Options list={lk.resolutions} /></select></label>
        <label>E · Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><Options list={lk.divisions} /></select></label>
        <label>F · Homeowner<SearchSelect endpoint="/cs/customers/search" value={p.customerId ? Number(p.customerId) : null} label={labels.F || (p.customerId ? `Homeowner #${p.customerId}` : '')} placeholder="Search name…" onSelect={(r) => { setLabels({ ...labels, F: r?.name }); set({ customerId: r?.id ?? '' }) }} /></label>
        <label>G · Date from<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>H · Date to<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
        <label>I · Error type<select value={p.errorId || ''} onChange={(e) => set({ errorId: e.target.value })}><Options list={lk.errors} /></select></label>
      </fieldset>
      {p.resolutionId && <p className="cs-mini" style={{ margin: '4px 0 0' }}>D filters the ticket list: <Link to={`/cs/tickets?resolutionId=${p.resolutionId}${p.division ? `&division=${p.division}` : ''}`}>open tickets with this resolution</Link></p>}
      </div>
      <div className="fm-reports no-print" style={{ marginTop: 14 }}>
        {REPORTS.map((r) => {
          const miss = [...r.needs].filter((c) => !p[NEED[c]])
          return (
            <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => set({ report: r.key })}>
              <r.icon size={18} /><span><b>{r.label}</b><small>{miss.length ? `Needs ${miss.map((c) => NEED_TEXT[c]).join(', ')}` : r.text}</small></span>
            </button>
          )
        })}
      </div>
      {rep && (
        <section className="cs-report">
          <h2 style={{ margin: '4px 0 2px' }}>{rep.label}</h2>
          <p className="muted" style={{ margin: '0 0 10px' }}>{filterLine || rep.text}{rep.key === 'open-lots-scheduled' && d ? ` · tickets from ${D(d.since)}` : ''} · printed {new Date().toLocaleString('en-US')}</p>
          {missing.length > 0 && <div className="banner"><AlertTriangle size={16} /> Enter the {missing.map((c) => NEED_TEXT[c]).join(', ')} filter{missing.length > 1 ? 's' : ''} first.</div>}
          {error && <ErrorState message={error} />}
          {loading && <SkeletonRows rows={6} cols={4} />}
          {d && !loading && <ReportBody rep={rep} d={d} mailBody={mailBody} p={p} />}
        </section>
      )}
    </div>
  )
}

function ReportBody({ rep, d, mailBody, p }) {
  if (rep.exportFiles) {
    return (
      <div className="cs-sheet">
        <div className="table-wrap flat"><table className="grid compact">
          <thead><tr><th>File</th><th className="num">Rows</th><th /></tr></thead>
          <tbody>{d.files.map((f) => <tr key={f.name}><td>{f.name}.csv</td><td className="num">{f.rows.length}</td><td><button className="btn small" disabled={!f.rows.length} onClick={() => download(f.rows, null, `${f.name}.csv`)}><Download size={13} /> CSV</button></td></tr>)}</tbody>
        </table></div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => d.files.forEach((f, i) => setTimeout(() => download(f.rows, null, `${f.name}.csv`), i * 300))}><Download size={15} /> Download all six</button>
          <a className="btn" href={`mailto:?subject=${encodeURIComponent(`Appointment data ${p.from} to ${p.to}`)}&body=${mailBody}`}><Mail size={15} /> Email…</a>
        </div>
        <p className="cs-mini" style={{ marginTop: 8 }}>Email: download the files first, then attach them to the message (browsers cannot attach files automatically).</p>
      </div>
    )
  }
  if (!d.rows?.length) return <EmptyState title="Nothing to report for these filters" />
  if (rep.sheet) return <TicketSheets rows={d.rows} hv={rep.key === 'ticket-hv'} />
  const extra = rep.key === 'feedback-employee' ? (rows) => {
    const lots = [...new Set(rows.map((r) => r.LotId))]
    const lab = d.labor.filter((x) => lots.includes(x.LotId))
    return lab.length ? (
      <>
        <h4>Labor paid on the lot</h4>
        <Table cols={[['Employee', 'Employee'], ['PackName', 'Pack'], ['Item', 'Item'], ['ExtItemQty', 'Qty', 'num'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ['PriceEa', 'Price ea', 'money'], ['PayPercent', 'Pay %', 'num'], ['PayHours', 'Hours', 'num']]} rows={lab} />
      </>
    ) : <p className="cs-mini">No labor paid on this lot</p>
  } : null
  return (
    <>
      {d.totals && (
        <div className="cs-totals">
          {'TicketCount' in d.totals && <span>Tickets <b>{num(d.totals.TicketCount, 0)}</b></span>}
          {'Tickets' in d.totals && <span>Lines <b>{num(d.totals.Tickets, 0)}</b></span>}
          {'Lines' in d.totals && <span>Lines <b>{num(d.totals.Lines, 0)}</b></span>}
          <span>Hours <b>{num(d.totals.TimeAtJob, 3)}</b></span>
          <span>Cost <b>{money(d.totals.Cost)}</b></span>
          {d.totals.CostPerTicket != null && <span>Cost / ticket <b>{money(d.totals.CostPerTicket)}</b></span>}
        </div>
      )}
      <Grouped rep={rep} rows={d.rows} extra={extra} />
      {rep.key === 'feedback-error' && d.summary?.length > 0 && (
        <div className="cs-sheet">
          <div className="cs-sheet-head"><h3>Summary by error and category</h3></div>
          <Table cols={[['Error', 'Error'], ['Category', 'Category'], ['Tickets', 'Tickets', 'num']]} rows={d.summary} />
        </div>
      )}
      <div className="no-print" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => download(d.rows.map((r) => ({ ...r, Technicians: undefined, Phones: undefined })), rep.cols ? [...(rep.group || []).map((g) => [g, g]), ...rep.cols.map(([k, l]) => [k, l])] : null, `${rep.key}.csv`)}><Download size={13} /> CSV</button>
      </div>
    </>
  )
}
