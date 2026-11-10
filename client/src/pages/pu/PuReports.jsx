// Public reports (Access SwitchPU report buttons). `group` picks the tab: jobs, lots, plans or labor.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, ClipboardList, Download, FileText, HardHat, ListChecks, MapPinned, Printer, Search, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PuTabs, download, groupBy, int, money, usePick, usePuLookups } from './shared'

// needs: job, lot, phase, division, status (statusAll = "1-All status" allowed), pm (customer → plan), stage
const REPORTS = [
  { key: 'residential-jobs', group: 'jobs', label: 'Residential job list', icon: ListChecks, text: 'Every job with its superintendent, by division', needs: [] },
  { key: 'pm-jobs', group: 'jobs', label: 'PM job list by customer', icon: Users, text: 'Plan management jobs (not templates) by division and customer', needs: [] },
  { key: 'jobs-by-city', group: 'jobs', label: 'Jobs by city', icon: Building2, text: 'Jobs of a division and status, by city', needs: ['division', 'statusAll'] },
  { key: 'jobs-by-division-status', group: 'jobs', label: 'Jobs by division & status', icon: ClipboardList, text: 'Jobs of a division and status, by customer', needs: ['division', 'statusAll'] },
  { key: 'lot-info', group: 'lots', label: 'Lot info search', icon: Search, text: 'Job, phase, bid, plan and packs of one lot', needs: ['job', 'lot'] },
  { key: 'status-search', group: 'lots', label: 'Status search', icon: MapPinned, text: 'Lots of a division with one lot status', needs: ['division', 'status'] },
  { key: 'plan-standard', group: 'plans', label: 'Plan standard data', icon: FileText, text: 'Standard packs and material of one PM plan', needs: ['pm'] },
  { key: 'plan-option', group: 'plans', label: 'Plan option data', icon: FileText, text: 'Option packs and material of one PM plan', needs: ['pm'] },
  { key: 'start-pack-labor-lot', group: 'labor', label: 'Start pack labor – lot', icon: HardHat, text: 'Labor items of one lot at a schedule stage', needs: ['job', 'lot', 'stage'] },
  { key: 'start-pack-labor-phase', group: 'labor', label: 'Start pack labor – phase', icon: HardHat, text: 'Labor items of every lot of a phase at a schedule stage', needs: ['job', 'phase', 'stage'] },
]
const TITLES = { jobs: ['Job lists', 'Residential and plan management job lists'], lots: ['Lot reports', 'Look up one lot, or every lot with a status'], plans: ['Plan data', 'Material of a plan management plan'], labor: ['Start pack labor', 'Labor to start for a lot or phase at a schedule stage'] }

export default function PuReports({ group }) {
  const lk = usePuLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const list = REPORTS.filter((r) => r.group === group)
  const rep = list.find((r) => r.key === p.report) || (list.length === 1 ? list[0] : null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const needs = rep?.needs || []
  const has = (k) => needs.includes(k)
  const jobs = usePick('/pu/pick/jobs', {}, has('job') ? undefined : null)
  const lots = usePick('/pu/pick/lots', { jobId: p.jobId }, has('lot') ? p.jobId || '' : null)
  const phases = usePick('/pu/pick/phases', { jobId: p.jobId }, has('phase') ? p.jobId || '' : null)
  const pmJobs = usePick('/pu/pick/pm-jobs', { customerId: p.pmCustomerId }, has('pm') ? p.pmCustomerId || '' : null)
  const pmBids = usePick('/pu/pick/pm-contracts', { jobId: p.pmJobId }, has('pm') ? p.pmJobId || '' : null)
  const pmPlans = usePick('/pu/pick/pm-plans', { contractId: p.pmContractId }, has('pm') ? p.pmContractId || '' : null)
  const ready = rep && (!has('job') || p.jobId) && (!has('lot') || p.lotId) && (!has('phase') || p.phaseId) && (!has('division') || p.division)
    && (!has('status') || (p.statusId && p.statusId !== '0')) && (!has('pm') || p.planId) && (!has('stage') || p.scheduleStageId)
  useEffect(() => {
    setData(null); setError('')
    if (!ready) return
    let live = true
    const params = { lotId: p.lotId, phaseId: p.phaseId, division: p.division, statusId: has('statusAll') ? p.statusId || '0' : p.statusId, planId: p.planId, scheduleStageId: p.scheduleStageId }
    api(`/pu/reports/${rep.key}`, { params }).then((d) => live && setData({ k: rep.key, d })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), rep?.key])
  const ok = data && data.k === rep?.key
  const sel = (key, label, opts, patch = {}, disabled = false, fmt = (o) => o.name) => (
    <label>{label}
      <select aria-label={label} value={p[key] || ''} disabled={disabled} onChange={(e) => set({ [key]: e.target.value, ...patch })}>
        <option value="">{disabled ? '—' : 'Choose…'}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{fmt(o)}</option>)}
      </select>
    </label>
  )
  const [title, subtitle] = TITLES[group]
  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle}
        actions={ok && data.d.length ? <><button className="btn" onClick={() => download(data.d, COLS[rep.key], `pu-${rep.key}.csv`)}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></> : null} />
      <PuTabs />
      <div className="fm-reports no-print">{list.map((r) => <button key={r.key} className={`fm-report${rep?.key === r.key ? ' active' : ''}`} aria-pressed={rep?.key === r.key} onClick={() => set({ report: r.key })}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}</div>
      {rep && needs.length > 0 && (
        <div className="card form report-filters no-print"><fieldset>
          {has('job') && sel('jobId', 'Job', jobs, { lotId: '', phaseId: '' }, false, (o) => `${o.name} (${o.DivisionId || '—'}) – ${o.CustName}`)}
          {has('lot') && sel('lotId', 'Lot', lots, {}, !p.jobId, (o) => `${o.name}${o.EndDate ? ` (closed ${fmtDate(o.EndDate)})` : ''}`)}
          {has('phase') && sel('phaseId', 'Phase', phases, {}, !p.jobId)}
          {has('division') && sel('division', 'Division', lk.divisions, {}, false, (o) => `${o.id} – ${o.name}`)}
          {(has('status') || has('statusAll')) && sel('statusId', 'Status', has('status') ? lk.statuses.filter((s) => s.id !== 0) : lk.statuses)}
          {has('pm') && <>
            {sel('pmCustomerId', 'PM customer', lk.pmCustomers, { pmJobId: '', pmContractId: '', planId: '' })}
            {sel('pmJobId', 'PM job', pmJobs, { pmContractId: '', planId: '' }, !p.pmCustomerId, (o) => `${o.name}${o.DivisionId ? ` (${o.DivisionId})` : ''}`)}
            {sel('pmContractId', 'PM bid', pmBids, { planId: '' }, !p.pmJobId, (o) => [o.BidNum, o.BidRelease, o.BidName].filter(Boolean).join(' – ') || `#${o.id}`)}
            {sel('planId', 'PM plan', pmPlans, {}, !p.pmContractId, (o) => [o.PlanNum, o.PlanName].filter(Boolean).join(' – ') || `#${o.id}`)}
          </>}
          {has('stage') && sel('scheduleStageId', 'Schedule stage', lk.scheduleStages)}
        </fieldset></div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState title="Choose a report" /> : !ready ? <EmptyState title="Complete the filters above" /> : !ok ? <SkeletonRows rows={8} cols={5} />
        : <div className="fm-sheet">{rep.key === 'lot-info' ? <LotSheet rows={data.d} title={rep.label} /> : <Report k={rep.key} d={data.d} label={rep.label} />}</div>}
    </div>
  )
}

const COLS = {
  'residential-jobs': [['DivisionId', 'Division'], ['JobName', 'Job'], ['JobNum', 'Job #'], ['CustName', 'Customer'], ['Status', 'Status'], ['SuperName', 'Superintendent']],
  'pm-jobs': [['DivisionId', 'Division'], ['Customer', 'Customer'], ['CustomerStatus', 'Customer status'], ['Job', 'Job'], ['JobNumber', 'Job #'], ['JobType', 'Job type'], ['SpecLevel', 'Spec level'], ['JobStatus', 'Job status']],
  'jobs-by-city': [['City', 'City'], ['JobName', 'Job'], ['JobNum', 'Job #'], ['CustName', 'Customer'], ['DivisionId', 'Division'], ['Status', 'Status'], ['SuperName', 'Superintendent']],
  'jobs-by-division-status': [['CustName', 'Customer'], ['JobName', 'Job'], ['JobNum', 'Job #'], ['City', 'City'], ['DivisionId', 'Division'], ['Status', 'Status'], ['SuperName', 'Superintendent']],
  'status-search': [['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['PlanNum', 'Plan'], ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['Zip', 'Zip'], ['StartDate', 'Start'], ['EndDate', 'Closed'], ['Status', 'Status']],
  'plan-standard': [['PlanNum', 'Plan'], ['PackName', 'Pack'], ['PackType', 'Type'], ['Stage', 'Stage'], ['CostCodeId', 'Code'], ['InvItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Qty'], ['WorkType', 'Work']],
  'start-pack-labor-lot': [['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['Address', 'Address'], ['PlanNum', 'Plan'], ['ScheduleStage', 'Schedule stage'], ['Stage', 'Stage'], ['PackType', 'Pack type'], ['PackName', 'Pack'], ['SumOfPackQty', 'Pack qty'],
    ['WorkType', 'Work'], ['AlternateCode', 'Labor item'], ['ItemQuantity', 'Item qty'], ['Price', 'Price'], ['DeliveryDate', 'Delivery'], ['Superintendent1', 'Superintendent 1'], ['Superintendent2', 'Superintendent 2']],
  'lot-info': [['Code', 'Code'], ['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['Status', 'Status'], ['Address', 'Address'], ['City', 'City'], ['PlanNum', 'Plan'],
    ['BidNum', 'Bid'], ['BidRelease', 'Release'], ['SuperName', 'Superintendent'], ['StartDate', 'Lot start'], ['EndDate', 'Lot closed'], ['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Pack qty']],
}
COLS['plan-option'] = COLS['plan-standard']
COLS['start-pack-labor-phase'] = COLS['start-pack-labor-lot']

// [group heading, table columns]
const LAYOUT = {
  'residential-jobs': [(r) => `Division ${r.DivisionId || '—'}`, ['JobName', 'JobNum', 'CustName', 'Status', 'SuperName']],
  'pm-jobs': [(r) => `${r.DivisionId || '—'} · ${r.Customer} (${r.CustomerStatus})`, ['Job', 'JobNumber', 'JobType', 'SpecLevel', 'JobStatus']],
  'jobs-by-city': [(r) => r.City || 'No city', ['JobName', 'JobNum', 'CustName', 'Status', 'SuperName']],
  'jobs-by-division-status': [(r) => r.CustName, ['JobName', 'JobNum', 'City', 'Status', 'SuperName']],
  'status-search': [(r) => `${r.CustName} · ${r.JobName} · ${r.Phase}`, ['LotBlock', 'PlanNum', 'Address', 'City', 'State', 'Zip', 'StartDate', 'EndDate']],
  'plan-standard': [(r) => `${r.PackName} (${r.PackType})`, ['Stage', 'CostCodeId', 'InvItem', 'Description', 'Quantity', 'WorkType']],
  'start-pack-labor-lot': [(r) => `${r.JobName} · ${r.Phase} · Lot ${r.LotBlock} · ${r.ScheduleStage}`, ['PackType', 'PackName', 'SumOfPackQty', 'Stage', 'WorkType', 'AlternateCode', 'ItemQuantity', 'Price']],
}
LAYOUT['plan-option'] = LAYOUT['plan-standard']
LAYOUT['start-pack-labor-phase'] = LAYOUT['start-pack-labor-lot']
const LABEL = Object.fromEntries(Object.values(COLS).flat())
const NUM = new Set(['Quantity', 'SumOfPackQty', 'ItemQuantity', 'Price', 'PackQty', 'JobNum'])
const DATE = new Set(['StartDate', 'EndDate', 'DeliveryDate', 'BidDate', 'PhaseStartDate', 'LotStartDate', 'DateEntered'])
const cell = (c, v) => (v == null || v === '' ? '' : c === 'Price' ? money(v) : DATE.has(c) ? fmtDate(v) : NUM.has(c) ? int(v) : typeof v === 'boolean' ? (v ? 'Yes' : '') : v)

function Report({ k, d, label }) {
  if (!d.length) return <><h2>{label}</h2><EmptyState title="Nothing to show" /></>
  const [key, cols] = LAYOUT[k]
  const groups = groupBy(d, key)
  const head = d[0]
  const labor = k.startsWith('start-pack')
  const supers = [head.Superintendent1 && `${head.Superintendent1} (${head.Stype1 || '—'})`, head.Superintendent2 && `${head.Superintendent2} (${head.Stype2 || '—'})`].filter(Boolean).join(', ')
  const sub = k.startsWith('plan-') ? `${head.Customer} · ${head.Job} · Bid ${[head.BidNum, head.BidRelease].filter(Boolean).join(' ')} · Plan ${head.PlanNum}${head.PlanName ? ` ${head.PlanName}` : ''}${head.SqFt ? ` · ${int(head.SqFt)} sq ft` : ''}${head.Bedrooms ? ` · ${head.Bedrooms} bedrooms` : ''}`
    : labor ? `${head.CustName} · ${head.Code} · ${head.PhaseType} · Phase start ${fmtDate(head.PhaseStartDate) || '—'} · ${supers}`
      : `${d.length} row(s) · printed ${new Date().toLocaleDateString('en-US')}`
  const lotTotal = (rows) => rows.reduce((a, r) => a + Number(r.Price || 0), 0)
  return (
    <>
      <div className="fm-head"><div><h2>{label}</h2><div className="muted">{sub}</div></div></div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr>{cols.map((c) => <th key={c} className={NUM.has(c) ? 'num' : ''}>{LABEL[c]}</th>)}</tr></thead>
        {groups.map(([g, rows]) => {
          const r0 = rows[0]
          return (
            <tbody key={g}>
              <tr><td colSpan={cols.length} style={{ background: 'var(--surface-2, rgba(127,127,127,.08))' }}><b>{g}</b>
                {labor
                  ? <span className="muted small"> · {[r0.Address, r0.City].filter(Boolean).join(', ')} · Plan {r0.PlanNum}{r0.Permit ? ` · Permit ${r0.Permit}` : ''} · Lot start {fmtDate(r0.LotStartDate) || '—'} · Delivery {fmtDate(r0.DeliveryDate) || '—'}</span>
                  : <span className="muted small"> · {rows.length}</span>}</td></tr>
              {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={NUM.has(c) ? 'num' : c === 'Description' || c === 'JobName' || c === 'Job' ? 'wrap' : ''}>{cell(c, r[c])}</td>)}</tr>)}
              {labor && <tr><td colSpan={cols.length - 1}><b>Subtotal</b></td><td className="num"><b>{money(lotTotal(rows))}</b></td></tr>}
            </tbody>
          )
        })}
        {labor && <tfoot><tr><td colSpan={cols.length - 1}><b>Total</b></td><td className="num"><b>{money(lotTotal(d))}</b></td></tr></tfoot>}
      </table></div>
    </>
  )
}

/** Lot look-up sheet (PuAddressSearchSimple / PuAddressSearchLot): lot details once, then its packs. */
export function LotSheet({ rows, title }) {
  if (!rows.length) return <><h2>{title}</h2><EmptyState title="Nothing to show">The address search needs a phase with a superintendent and a bid; try Lot info search in Lot reports.</EmptyState></>
  const r = rows[0]
  const dl = [['Customer', r.CustName], ['Job', r.JobName], ['Phase', r.Phase], ['Code', r.Code], ['Lot/block', r.LotBlock], ['Status', r.Status],
    ['Address', [r.Address, r.City, r.State, r.Zip].filter(Boolean).join(', ')], ['Plan', [r.PlanNum, r.PlanName].filter(Boolean).join(' – ')], ['Permit', r.Permit],
    ['Bid', [r.BidNum, r.BidRelease, r.BidName].filter(Boolean).join(' – ')], ['Bid date', fmtDate(r.BidDate)], ['Superintendent', r.SuperName],
    ['Phase start', fmtDate(r.PhaseStartDate)], ['Lot start', fmtDate(r.StartDate)], ['Lot closed', fmtDate(r.EndDate)], ['Warranty', r.WarrantyDate],
    ['Invoice #', r.InvoiceNum], ['Entered', `${fmtDate(r.DateEntered)} ${r.UserEntered || ''}`.trim()], ['Notes', r.LotNotes]]
  const packs = rows.filter((x) => x.PackName)
  return (
    <>
      <div className="fm-head"><div><h2>{title}</h2><div className="muted">Lot {r.LotBlock} · {r.JobName}</div></div></div>
      <dl className="mg-dl">{dl.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
      <h3 className="section-title">Packs</h3>
      {!packs.length ? <EmptyState title="No packs on this lot" /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Pack</th><th>Builder code</th><th className="num">Qty</th></tr></thead>
          <tbody>{packs.map((x, i) => <tr key={i}><td>{x.PackName}</td><td>{x.BuilderCode}</td><td className="num">{int(x.PackQty)}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  )
}
