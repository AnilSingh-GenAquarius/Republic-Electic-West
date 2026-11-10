// Sales reports (Access SwitchSA report buttons). Each report shows only the switchboard filters it uses.
// The three "select" reports (options, global options, labor paid) first list the pack names found for the
// filters (Access forms SaOptionSelect / SaGlobalOptionSelect / SaLaborPaidDivSelect); the user ticks the packs
// to display, then the report runs.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Construction, Download, Play, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { REPORTS } from './reportList'
import { Options, SaTabs, download, int, money, pct, today, useSaLookups } from './shared'

const yearStart = () => `${today().slice(0, 4)}-01-01`

export default function SaReports() {
  const lk = useSaLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const uses = (f) => !!rep?.filters.includes(f)
  const from = p.from || yearStart(), to = p.to || today(), burden = p.burden ?? '25'
  const [jobs, setJobs] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [packs, setPacks] = useState(null) // candidate pack names for the "select" reports
  const [ticked, setTicked] = useState(() => new Set())
  const [packFilter, setPackFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => { setJobs([]); if (uses('job') && p.customerId) api('/sa/pick/jobs', { params: { customerId: p.customerId } }).then(setJobs).catch(() => {}) }, [p.customerId, rep?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const missing = !rep ? 'Choose a report' : [
    uses('job') && !p.jobId && (rep.key === 'options' ? 'Select job to run report.' : 'Select the job'),
    uses('division') && !p.division && 'Select the division',
    uses('stage') && !p.stageId && 'Select the schedule stage',
    uses('period') && (!from || !to) && 'Enter the From and To dates',
    uses('burden') && burden === '' && 'Enter the labor burden %',
  ].filter(Boolean)[0]
  const params = rep && { customerId: uses('customer') ? p.customerId : undefined, jobId: uses('job') ? p.jobId : undefined, division: uses('division') ? p.division : undefined,
    stageId: uses('stage') ? p.stageId : undefined, from, to, burden: uses('burden') ? burden : undefined }
  const key = JSON.stringify([rep?.key, params])

  // plain reports run as soon as the filters are complete; "select" reports load their pack list
  useEffect(() => {
    setData(null); setError(''); setPacks(null); setTicked(new Set()); setPackFilter('')
    if (!rep || missing) return
    let live = true
    const url = rep.pick ? `/sa/reports/${rep.key}/packs` : `/sa/reports/${rep.key}`
    api(url, { params }).then((d) => { if (!live) return; if (rep.pick) setPacks(d); else setData({ k: key, d }) }).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function display() {
    setBusy(true); setError(''); setData(null)
    try { setData({ k: key, d: await api(`/sa/reports/${rep.key}`, { method: 'POST', body: { ...params, packs: [...ticked] } }) }) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const shown = useMemo(() => (packs || []).filter((x) => !packFilter || x.name.toLowerCase().includes(packFilter.toLowerCase())), [packs, packFilter])
  const tick = (names, on) => setTicked((s) => { const n = new Set(s); names.forEach((x) => (on ? n.add(x) : n.delete(x))); return n })
  const ok = data && data.k === key
  const csv = ok && CSV[rep.key]

  return (
    <div className="page">
      <PageHeader title="Sales reports" subtitle="Pick a report; the switchboard filters it needs appear below"
        actions={ok && <>{csv && <button className="btn" onClick={() => download(csv.rows(data.d), csv.cols, `sa-${rep.key}.csv`)}><Download size={15} /> CSV</button>}<button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <SaTabs />
      <div className="fm-reports no-print">
        {REPORTS.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => set({ report: r.key })}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}
        <button className="fm-report" disabled title="Currently under development" style={{ opacity: 0.6, cursor: 'not-allowed' }}><Construction size={18} /><span><b>Sales quotes</b><small>Under construction – currently under development in Access too</small></span></button>
      </div>
      {rep && (
        <div className="card form report-filters no-print"><fieldset>
          {uses('customer') && <label>Customer<select aria-label="Customer" value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value, jobId: '' })}><Options list={lk.customers} blank={uses('job') ? 'Choose…' : 'All customers'} /></select></label>}
          {uses('job') && <label>Job<select aria-label="Job" value={p.jobId || ''} disabled={!p.customerId} onChange={(e) => set({ jobId: e.target.value })}><Options list={jobs} blank={p.customerId ? 'Choose…' : 'Choose the customer first'} /></select></label>}
          {uses('division') && <label>Division<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><Options list={lk.divisions} blank="Choose…" /></select></label>}
          {uses('stage') && <label>Schedule stage<select aria-label="Schedule stage" value={p.stageId || ''} onChange={(e) => set({ stageId: e.target.value })}><Options list={lk.scheduleStages} blank="Choose…" /></select></label>}
          {uses('period') && <>
            <label>From<input type="date" aria-label="From" value={from} onChange={(e) => set({ from: e.target.value })} /></label>
            <label>To<input type="date" aria-label="To" value={to} onChange={(e) => set({ to: e.target.value })} /></label>
          </>}
          {uses('burden') && <label>Labor burden %<input type="number" min="0" step="0.5" aria-label="Labor burden %" value={burden} onChange={(e) => set({ burden: e.target.value })} /></label>}
        </fieldset>
        <p className="muted small" style={{ margin: '4px 0 0' }}>{DATE_NOTE[rep?.key]}</p></div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState title="Choose a report" /> : missing ? <EmptyState title={missing} /> : rep.pick && !ok ? (
        !packs ? <SkeletonRows rows={6} cols={2} /> : (
          <section className="panel no-print">
            <div className="panel-head"><h2>{rep.key === 'labor-paid' ? 'Select packs to display' : rep.key === 'global-options' ? 'Select global options to display' : 'Select options to display'}</h2><span className="muted">{ticked.size} of {packs.length} ticked</span></div>
            {!packs.length ? <EmptyState title="No packs found for these filters" /> : <>
              <div className="filters" style={{ marginBottom: 8 }}>
                <div className="search-wrap"><input type="search" aria-label="Filter packs" placeholder="Filter pack names…" value={packFilter} onChange={(e) => setPackFilter(e.target.value)} /></div>
                <button className="btn small" onClick={() => tick(shown.map((x) => x.name), true)}>Tick all{packFilter ? ' shown' : ''}</button>
                <button className="btn small" onClick={() => tick(shown.map((x) => x.name), false)}>Untick all{packFilter ? ' shown' : ''}</button>
              </div>
              <div className="table-wrap flat" style={{ maxHeight: 420, overflow: 'auto' }}><table className="grid compact">
                <thead><tr><th style={{ width: 40 }} /><th>Pack name</th><th className="num">Packs</th></tr></thead>
                <tbody>{shown.map((x) => (
                  <tr key={x.name} className="link-row" onClick={() => tick([x.name], !ticked.has(x.name))}>
                    <td><input type="checkbox" aria-label={`Select ${x.name}`} checked={ticked.has(x.name)} onChange={(e) => tick([x.name], e.target.checked)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="wrap">{x.name}</td><td className="num">{int(x.n)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="row form-actions"><button className="btn primary" disabled={!ticked.size || busy} onClick={display}><Play size={15} /> {busy ? 'Running…' : 'Display report'}</button></div>
            </>}
          </section>
        )
      ) : !ok ? <SkeletonRows rows={8} cols={5} /> : (
        <>
          {rep.pick && <div className="no-print" style={{ marginBottom: 10 }}><button className="btn small" onClick={() => setData(null)}>Change pack selection</button></div>}
          <div className="fm-sheet"><Report k={rep.key} d={data.d} label={rep.label} f={{ ...params, division: p.division, lk }} /></div>
        </>
      )}
    </div>
  )
}

const DATE_NOTE = {
  'sales-by-plan': 'Lots with a start date between From and To. Pick "All customers" for every customer of the division.',
  'billing-by-lot': 'Lots displayed are those with a start date that falls between the From and To dates selected.',
  options: 'Lots of the job with a start date between From and To.',
  'global-options': 'Lots of the division with a start date between From and To.',
  'labor-paid': 'Labor paid at the schedule stage with a payroll date between From and To.',
  'lots-closed': 'Lots with an end date between From and To.',
  'lots-stage': 'Lots with the schedule stage delivered between From and To.',
}
// ---------------------------------------------------------------------------
// Report sheets
// ---------------------------------------------------------------------------
const GROUP = { background: 'var(--surface-3)' }
const lotBlock = (r) => [r.Lot, r.Block].filter((x) => x != null && x !== '').join('/')
const addr = (r) => [r.Address, r.City, [r.State, r.Zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
const groupBy = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) } return [...m.entries()] }
const sum = (rows, c) => rows.reduce((a, r) => a + Number(r[c] || 0), 0)
const period = (f) => `From ${fmtDate(f.from)} to ${fmtDate(f.to)}`

function Head({ label, sub, note }) {
  return <div className="fm-head"><div><h2>{label}</h2>{sub && <div className="muted">{sub}</div>}{note && <div className="muted small">{note}</div>}</div></div>
}

function Report({ k, d, label, f }) {
  const rows = k === 'sales-by-plan' || k === 'billing-by-lot' ? d.rows : d
  if (!rows.length) return <><Head label={label} sub={period(f)} /><EmptyState title="Nothing to show for these filters" /></>
  if (k === 'sales-by-plan') return <SalesByPlan d={d} label={label} f={f} />
  if (k === 'billing-by-lot') return <BillingByLot d={d} label={label} f={f} />
  if (k === 'options') return <OptionsReport rows={d} label={label} f={f} />
  if (k === 'global-options') return <GlobalOptions rows={d} label={label} f={f} />
  if (k === 'labor-paid') return <LaborPaid rows={d} label={label} f={f} />
  return <Lots rows={d} label={label} f={f} stage={k === 'lots-stage'} />
}

// SaSalesByPlanEst: customer -> job -> plan; Opt/Std = option billing / standard billing; Est GP = (billing - cost) / billing
const gp = (t) => { const b = Number(t.StandardBilling || 0) + Number(t.OptionBilling || 0); return b ? (b - Number(t.StandardCost || 0) - Number(t.OptionCost || 0)) / b : null }
const optStd = (t) => (Number(t.StandardBilling || 0) ? Number(t.OptionBilling || 0) / Number(t.StandardBilling) : null)
const totals = (rows) => ({ LotCount: sum(rows, 'LotCount'), StandardBilling: sum(rows, 'StandardBilling'), OptionBilling: sum(rows, 'OptionBilling'), StandardCost: sum(rows, 'StandardCost'), OptionCost: sum(rows, 'OptionCost') })
function SbpCells({ t, bold }) {
  const B = bold ? 'b' : 'span'
  return <>
    <td className="num"><B>{int(t.LotCount)}</B></td><td className="num"><B>{money(t.StandardBilling)}</B></td><td className="num"><B>{money(t.OptionBilling)}</B></td>
    <td className="num"><B>{money(t.StandardCost)}</B></td><td className="num"><B>{money(t.OptionCost)}</B></td><td className="num"><B>{pct(optStd(t))}</B></td>
    <td className={`num${gp(t) < 0 ? ' neg' : ''}`}><B>{pct(gp(t))}</B></td>
  </>
}
function SalesByPlan({ d, label, f }) {
  const all = totals(d.rows)
  return (
    <>
      <Head label={label} sub={`Division ${d.division} · ${period(f)}`} note={`Cost values include burden of ${d.burden}% and corresponding material tax. PO work is included in billing but not in cost.`} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Customer / job / plan</th><th className="num">Lot #</th><th className="num">Standard billing</th><th className="num">Option billing</th><th className="num">Standard cost</th><th className="num">Option cost</th><th className="num">Opt/Std</th><th className="num">Est GP</th></tr></thead>
        <tbody>
          {groupBy(d.rows, (r) => r.CustName).map(([cust, cr]) => [
            <tr key={`c${cust}`} style={GROUP}><td><b>{cust}</b></td><SbpCells t={totals(cr)} bold /></tr>,
            ...groupBy(cr, (r) => r.JobId).flatMap(([jid, jr]) => [
              <tr key={`j${jid}`}><td style={{ paddingLeft: 18 }}><b>{jr[0].JobName}</b></td><SbpCells t={totals(jr)} bold /></tr>,
              ...jr.map((r) => <tr key={`p${jid}-${r.PlanNum}`}><td style={{ paddingLeft: 36 }}>Plan {r.PlanNum}</td><SbpCells t={r} /></tr>),
            ]),
          ])}
        </tbody>
        <tfoot><tr><td><b>Total</b></td><SbpCells t={all} bold /></tr></tfoot>
      </table></div>
    </>
  )
}

// SaSalesBillingLot: job -> lot -> pack type, plus the pack type summary (SaSalesBillingLotSubPackType)
function Cells3({ t, bold }) { const B = bold ? 'b' : 'span'; return <><td className="num"><B>{money(t.c)}</B></td><td className="num"><B>{money(t.r)}</B></td><td className="num"><B>{money(t.b)}</B></td></> }
function BillingByLot({ d, f }) {
  const head = d.rows[0]
  const t3 = (rows) => ({ c: sum(rows, 'TotalContract'), r: sum(rows, 'TotalRevContract'), b: sum(rows, 'SumOfTotalBilling') })
  return (
    <>
      <Head label="Contract & billing values by lot-pack type" sub={`${head.CustName} · division ${head.DivisionId} · ${period(f)}`} note="Lots displayed are those with a start date that falls between the From and To dates selected." />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Lot/Block - plan</th><th>Start</th><th>Pack type</th><th className="num">Contract value</th><th className="num">Rev contract</th><th className="num">Total billing</th></tr></thead>
        <tbody>
          {groupBy(d.rows, (r) => r.JobName).map(([job, jr]) => [
            <tr key={`j${job}`} style={GROUP}><td colSpan={3}><b>{job}</b></td><Cells3 t={t3(jr)} bold /></tr>,
            ...groupBy(jr, (r) => r.LotID).flatMap(([lid, lr]) => lr.map((r, i) => (
              <tr key={`${lid}-${r.PackType}`}>
                <td>{i === 0 ? <b>{lotBlock(r)} - plan {r.PlanNum}</b> : ''}</td><td>{i === 0 ? fmtDate(r.StartDate) : ''}</td><td>{r.PackType}</td>
                <Cells3 t={{ c: r.TotalContract, r: r.TotalRevContract, b: r.SumOfTotalBilling }} />
              </tr>
            ))),
          ])}
        </tbody>
        <tfoot><tr><td colSpan={3}><b>Total</b></td><Cells3 t={t3(d.rows)} bold /></tr></tfoot>
      </table></div>
      <h3 className="fm-sub">By pack type</h3>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Pack type</th><th className="num">Total contract</th><th className="num">Total rev contract</th><th className="num">Total billing</th></tr></thead>
        <tbody>{d.packTypes.map((r) => <tr key={r.PackType}><td>{r.PackType}</td><Cells3 t={{ c: r.TotalContract, r: r.TotalRevContract, b: r.SumOfTotalBilling }} /></tr>)}</tbody>
      </table></div>
    </>
  )
}
// SaOptionSelect: pack name / builder code groups, lots sorted by start date
function OptionsReport({ rows, label, f }) {
  const head = rows[0]
  return (
    <>
      <Head label={`${label} – options search`} sub={`${head.CustName} · ${head.JobName} · ${period(f)}`} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Bid #</th><th>Phase</th><th>Bid date</th><th>Lot/Block</th><th>Plan</th><th>Start date</th><th>End date</th><th className="num">Qty</th><th className="num">Value</th><th className="num">Rev value</th><th className="num">Ext val</th></tr></thead>
        <tbody>
          {groupBy(rows, (r) => `${r.PackName}\u0000${r.BuilderCode ?? ''}`).map(([g, gr]) => [
            <tr key={`g${g}`} style={GROUP}><td colSpan={7}><b>{gr[0].PackName}</b>{gr[0].BuilderCode ? <span className="muted"> · {gr[0].BuilderCode}</span> : null}</td>
              <td className="num"><b>{int(sum(gr, 'PackQty'))}</b></td><td /><td /><td className="num"><b>{money(sum(gr, 'ExtVal'))}</b></td></tr>,
            ...gr.map((r) => (
              <tr key={r.PackID}><td>{r.BidNum}</td><td>{r.Phase}</td><td>{fmtDate(r.BidDate)}</td><td>{lotBlock(r)}</td><td>{r.PlanNum}</td><td>{fmtDate(r.StartDate)}</td><td>{fmtDate(r.EndDate)}</td>
                <td className="num">{int(r.PackQty)}</td><td className="num">{money(r.ContractEa)}</td><td className="num">{money(r.RevContractEa)}</td><td className="num">{money(r.ExtVal)}</td></tr>
            )),
          ])}
        </tbody>
        <tfoot><tr><td colSpan={7}><b>Total</b></td><td className="num"><b>{int(sum(rows, 'PackQty'))}</b></td><td /><td /><td className="num"><b>{money(sum(rows, 'ExtVal'))}</b></td></tr></tfoot>
      </table></div>
    </>
  )
}

// SaGlobalOptionSelect: grouped by pack name, sorted customer, job, lot
function GlobalOptions({ rows, label, f }) {
  return (
    <>
      <Head label={`${label} – global options search`} sub={`Division ${f.division} · ${period(f)}`} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Customer - job</th><th>Lot/Block</th><th>Address</th><th>Plan</th><th>Start date</th><th>End date</th><th className="num">Qty</th><th className="num">Ext val</th></tr></thead>
        <tbody>
          {groupBy(rows, (r) => r.PackName).map(([g, gr]) => [
            <tr key={`g${g}`} style={GROUP}><td colSpan={6}><b>{g}</b></td><td className="num"><b>{int(sum(gr, 'PackQty'))}</b></td><td className="num"><b>{money(sum(gr, 'ExtVal'))}</b></td></tr>,
            ...gr.map((r) => (
              <tr key={r.PackID}><td className="wrap">{r.CustName} - {r.JobName}</td><td>{lotBlock(r)}</td><td className="wrap">{addr(r)}</td><td>{r.PlanNum}</td><td>{fmtDate(r.StartDate)}</td><td>{fmtDate(r.EndDate)}</td>
                <td className="num">{int(r.PackQty)}</td><td className="num">{money(r.ExtVal)}</td></tr>
            )),
          ])}
        </tbody>
        <tfoot><tr><td colSpan={6}><b>Total</b></td><td className="num"><b>{int(sum(rows, 'PackQty'))}</b></td><td className="num"><b>{money(sum(rows, 'ExtVal'))}</b></td></tr></tfoot>
      </table></div>
    </>
  )
}

// SaLaborPaidDivision: customer -> job (job type) -> lot, the ticked packs scheduled on each lot
function LaborPaid({ rows, label, f }) {
  return (
    <>
      <Head label={`Labor paid by division ${rows[0].DivisionId}`} sub={`${period(f)} · Stage: ${rows[0].ScheduleStage}`} note={label} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Lot/Block | Plan</th><th>Start date</th><th>Address</th><th>Payroll date</th><th>Packs scheduled</th></tr></thead>
        <tbody>
          {groupBy(rows, (r) => r.CustName).map(([cust, cr]) => [
            <tr key={`c${cust}`} style={GROUP}><td colSpan={5}><b>{cust}</b></td></tr>,
            ...groupBy(cr, (r) => r.JobName).flatMap(([job, jr]) => [
              <tr key={`j${cust}${job}`}><td colSpan={5} style={{ paddingLeft: 18 }}><b>{job}</b> <span className="muted">{jr[0].JobType}</span></td></tr>,
              ...groupBy(jr, (r) => r.LotBlock).map(([lb, lr]) => (
                <tr key={`l${cust}${job}${lb}`}>
                  <td style={{ paddingLeft: 36 }}>{lb} | {lr[0].PlanNum}</td><td>{fmtDate(lr[0].StartDate)}</td><td className="wrap">{lr[0].LotAddress}</td><td>{fmtDate(lr[0].DatePayroll)}</td>
                  <td className="wrap">{lr.map((x) => x.PackScheduled).filter(Boolean).join(' · ')}</td>
                </tr>
              )),
            ]),
          ])}
        </tbody>
      </table></div>
    </>
  )
}

// SaLotsClosedDate / SaLotsStageDate: customer - job groups, lot/block order
function Lots({ rows, label, f, stage }) {
  const title = stage ? `Lots | ${rows[0].ScheduleStage} stage by date` : label
  return (
    <>
      <Head label={title} sub={`Division ${rows[0].DivisionId} · ${period(f)} · ${int(rows.length)} lot(s)`} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Lot/block</th><th>Phase</th><th>Plan #</th><th>Beds</th><th className="num">Sq Ft</th><th>Panel</th><th>Tv outlet</th><th>Island</th><th>Floor plug</th><th>Detached</th><th>Start date</th><th>{stage ? 'Schedule date' : 'End date'}</th></tr></thead>
        <tbody>
          {groupBy(rows, (r) => `${r.CustName} - ${r.JobName}`).map(([g, gr]) => [
            <tr key={`g${g}`} style={GROUP}><td colSpan={12}><b>{g}</b> <span className="muted">({gr.length})</span></td></tr>,
            ...gr.map((r, i) => (
              <tr key={`${r.LotID}-${i}`}><td>{lotBlock(r)}</td><td>{r.Phase}</td><td>{r.PlanNum}</td><td>{r.Bedrooms ?? ''}</td><td className="num">{int(r.SqFt)}</td><td>{r.Gear ?? ''}</td>
                <td>{r.TvOutlet ?? ''}</td><td>{r.Island ?? ''}</td><td>{r.FloorPlug ?? ''}</td><td>{r.Detached ?? ''}</td><td>{fmtDate(r.StartDate)}</td><td>{fmtDate(stage ? r.DeliveryDate : r.EndDate)}</td></tr>
            )),
          ])}
        </tbody>
      </table></div>
    </>
  )
}

// CSV columns per report
const LOT_CSV = [['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan #'], ['Bedrooms', 'Beds'], ['SqFt', 'Sq Ft'], ['Gear', 'Panel'],
  ['TvOutlet', 'Tv outlet'], ['Island', 'Island'], ['FloorPlug', 'Floor plug'], ['Detached', 'Detached'], ['StartDate', 'Start date']]
const CSV = {
  'sales-by-plan': { rows: (d) => d.rows.map((r) => ({ ...r, OptStd: optStd(r), EstGP: gp(r) })),
    cols: [['DivisionId', 'Division'], ['CustName', 'Customer'], ['JobName', 'Job'], ['PlanNum', 'Plan'], ['LotCount', 'Lot #'], ['StandardBilling', 'Standard billing'], ['OptionBilling', 'Option billing'], ['StandardCost', 'Standard cost'], ['OptionCost', 'Option cost'], ['OptStd', 'Opt/Std'], ['EstGP', 'Est GP']] },
  'billing-by-lot': { rows: (d) => d.rows,
    cols: [['DivisionId', 'Division'], ['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['StartDate', 'Start date'], ['PackType', 'Pack type'], ['TotalContract', 'Contract value'], ['TotalRevContract', 'Rev contract'], ['SumOfTotalBilling', 'Total billing']] },
  options: { rows: (d) => d,
    cols: [['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['BidNum', 'Bid #'], ['Phase', 'Phase'], ['BidDate', 'Bid date'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['StartDate', 'Start date'], ['EndDate', 'End date'], ['PackQty', 'Qty'], ['ContractEa', 'Value'], ['RevContractEa', 'Rev value'], ['ExtVal', 'Ext val']] },
  'global-options': { rows: (d) => d.map((r) => ({ ...r, Addr: addr(r) })),
    cols: [['PackName', 'Pack'], ['CustName', 'Customer'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Block', 'Block'], ['Addr', 'Address'], ['PlanNum', 'Plan'], ['StartDate', 'Start date'], ['EndDate', 'End date'], ['PackQty', 'Qty'], ['ExtVal', 'Ext val']] },
  'labor-paid': { rows: (d) => d,
    cols: [['DivisionId', 'Division'], ['CustName', 'Customer'], ['JobName', 'Job'], ['JobType', 'Job type'], ['LotBlock', 'Lot/Block'], ['PlanNum', 'Plan'], ['StartDate', 'Start date'], ['LotAddress', 'Address'], ['ScheduleStage', 'Stage'], ['DatePayroll', 'Payroll date'], ['PackScheduled', 'Pack scheduled']] },
  'lots-closed': { rows: (d) => d, cols: [...LOT_CSV, ['EndDate', 'End date']] },
  'lots-stage': { rows: (d) => d, cols: [...LOT_CSV, ['ScheduleStage', 'Stage'], ['DeliveryDate', 'Schedule date']] },
}
