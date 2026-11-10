// Management reports (Access SwitchMG report buttons). Each report declares the filters it needs; only those are shown.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeDollarSign, Boxes, CalendarRange, CheckSquare, ClipboardList, Download, FileText, Gauge, Hammer, Layers, PackageX, Printer, UserCheck, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { MgTabs, download, int, money, money0, today, useMgLookups, yearAgo } from './shared'

const REPORTS = [
  { key: 'ready-to-close', label: 'Lots ready to close', icon: CheckSquare, needs: ['date'], text: 'Open lots started 4+ months before the date with no labor paid in the last 60 days' },
  { key: 'lot-detail', label: 'Lot info detail', icon: FileText, needs: ['lot'], text: 'Lot, job and phase details with packs, job cost and billing' },
  { key: 'lot-budget', label: 'Lot budget vs job cost', icon: Gauge, needs: ['lot', 'burden'], text: 'Budget from the packs against job cost, by cost code, stage and work' },
  { key: 'labor-paid', label: 'Labor paid to lot', icon: Users, needs: ['lot'], optional: ['from', 'to'], text: 'Every payroll line on the lot with piece and hourly pay (dates optional)' },
  { key: 'material-posted', label: 'Material posted to lot', icon: Boxes, needs: ['lot'], text: 'Material charged to the lot by work, stage and class' },
  { key: 'material-counter', label: 'Counter material posted to lot', icon: AlertTriangle, needs: ['lot'], text: 'Counter (non-pack) material with the reason' },
  { key: 'labor-vs-budget', label: 'Labor paid vs budget – open lots', icon: BadgeDollarSign, needs: ['customer', 'division'], text: 'Piece and hourly pay against the labor budget on the open lots of a builder' },
  { key: 'labor-vs-budget-employee', label: 'Labor paid vs budget – employee', icon: UserCheck, needs: ['division', 'from', 'to', 'employees'], text: 'Lots where the chosen employees were paid in the period, with the budget' },
  { key: 'job-cost-work', label: 'Job cost by type of work', icon: Hammer, needs: ['customer', 'from', 'to', 'work'], text: 'Estimate vs actual for one type of work on lots finished in the period' },
  { key: 'option-packs', label: 'Option packs scheduled by job', icon: Layers, needs: ['customer', 'division', 'from', 'to'], text: 'Option packs on lots started in the period, per job' },
  { key: 'open-lots', label: 'Open lots per period', icon: CalendarRange, needs: ['division', 'from', 'to'], text: 'Lots started in the period that are still open' },
  { key: 'packs-no-value', label: 'Job cost packs no value', icon: PackageX, needs: ['from', 'to'], text: 'Packs with no contract value on lots finished in the period' },
]
const NEED_LABEL = { customer: 'a builder', division: 'a division', lot: 'a lot', from: 'From', to: 'To', date: 'a date', burden: 'burden %', work: 'a type of work', employees: 'employees' }

export default function MgReports() {
  const lk = useMgLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const [jobs, setJobs] = useState([])
  const [lots, setLots] = useState([])
  const [emps, setEmps] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const shown = new Set([...(rep?.needs || []), ...(rep?.optional || [])])
  const needsLot = shown.has('lot')

  useEffect(() => { setJobs([]); if (needsLot && p.customerId) api('/mg/pick/jobs', { params: { customerId: p.customerId } }).then(setJobs).catch(() => {}) }, [needsLot, p.customerId])
  useEffect(() => { setLots([]); if (needsLot && p.jobId) api('/mg/pick/lots', { params: { jobId: p.jobId } }).then(setLots).catch(() => {}) }, [needsLot, p.jobId])
  useEffect(() => { if (shown.has('employees') && !emps.length) api('/mg/pick/employees').then(setEmps).catch(() => {}) }) // eslint-disable-line react-hooks/exhaustive-deps

  const have = { customer: !!p.customerId, division: !!p.division, lot: !!p.lotId, from: !!p.from, to: !!p.to, date: !!p.date, burden: p.burden != null && p.burden !== '', work: !!p.workId, employees: !!p.employees }
  const missing = (rep?.needs || []).filter((n) => !have[n])
  useEffect(() => {
    setData(null); setError('')
    if (!rep || missing.length) return
    let live = true
    const map = {
      'ready-to-close': ['/mg/ready-to-close', { date: p.date, bySuper: p.bySuper }],
      'lot-detail': [`/mg/lots/${p.lotId}`, {}],
      'lot-budget': ['/mg/lot-budget', { lotId: p.lotId, burden: p.burden }],
      'labor-paid': ['/mg/labor-paid', { lotId: p.lotId, from: p.from, to: p.to }],
      'material-posted': ['/mg/material-posted', { lotId: p.lotId }],
      'material-counter': ['/mg/material-posted', { lotId: p.lotId, counter: 1 }],
      'labor-vs-budget': ['/mg/labor-vs-budget', { division: p.division, customerId: p.customerId }],
      'labor-vs-budget-employee': ['/mg/labor-vs-budget-employee', { division: p.division, from: p.from, to: p.to, employees: p.employees }],
      'job-cost-work': ['/mg/job-cost-work', { customerId: p.customerId, workId: p.workId, from: p.from, to: p.to }],
      'option-packs': ['/mg/option-packs', { customerId: p.customerId, division: p.division, from: p.from, to: p.to }],
      'open-lots': ['/mg/open-lots', { division: p.division, from: p.from, to: p.to }],
      'packs-no-value': ['/mg/packs-no-value', { from: p.from, to: p.to }],
    }
    const [url, params] = map[rep.key]
    api(url, { params }).then((d) => live && setData({ d, _k: rep.key })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const ready = data && data._k === p.report
  const choose = (key) => {
    const r = REPORTS.find((x) => x.key === key)
    const patch = { report: key }
    if (r.needs.includes('from') && !p.from) patch.from = yearAgo()
    if (r.needs.includes('to') && !p.to) patch.to = today()
    if (r.needs.includes('date') && !p.date) patch.date = today()
    if (r.needs.includes('burden') && (p.burden == null || p.burden === '')) patch.burden = '25'
    set(patch)
  }

  return (
    <div className="page">
      <PageHeader title="Management reports" subtitle="Pick a report; the filters it needs appear below"
        actions={ready && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>} />
      <MgTabs />
      <div className="fm-reports no-print">
        {REPORTS.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => choose(r.key)}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}
      </div>
      {rep && (
        <div className="card form report-filters no-print"><fieldset>
          {(shown.has('customer') || needsLot) && <label>Builder<select aria-label="Builder" value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value, jobId: '', lotId: '' })}><option value="">Choose…</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {needsLot && <label>Job<select aria-label="Job" value={p.jobId || ''} disabled={!p.customerId} onChange={(e) => set({ jobId: e.target.value, lotId: '' })}><option value="">Choose…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name} ({j.DivisionId})</option>)}</select></label>}
          {needsLot && <label>Lot<select aria-label="Lot" value={p.lotId || ''} disabled={!p.jobId && !p.lotId} onChange={(e) => set({ lotId: e.target.value })}><option value="">{p.lotId && !lots.some((l) => String(l.id) === p.lotId) ? `Lot id ${p.lotId}` : 'Choose…'}</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.name}{l.EndDate ? ' – finished' : ''}</option>)}</select></label>}
          {shown.has('division') && <label>Division<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">Choose…</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          {shown.has('from') && <label>From{rep.optional?.includes('from') ? ' (optional)' : ''}<input type="date" aria-label="From" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>}
          {shown.has('to') && <label>To{rep.optional?.includes('to') ? ' (optional)' : ''}<input type="date" aria-label="To" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>}
          {shown.has('date') && <label>As of<input type="date" aria-label="Date" value={p.date || ''} onChange={(e) => set({ date: e.target.value })} /></label>}
          {shown.has('date') && <label className="check"><input type="checkbox" checked={p.bySuper === '1'} onChange={(e) => set({ bySuper: e.target.checked ? '1' : '' })} /> Group by superintendent</label>}
          {shown.has('burden') && <label>Burden %<input inputMode="decimal" aria-label="Burden" value={p.burden ?? ''} onChange={(e) => set({ burden: e.target.value })} /></label>}
          {shown.has('work') && <label>Type of work<select aria-label="Work" value={p.workId || ''} onChange={(e) => set({ workId: e.target.value })}><option value="">Choose…</option>{lk.works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
        </fieldset>
          {shown.has('employees') && <EmployeePicker emps={emps} value={p.employees} onChange={(v) => set({ employees: v })} />}
        </div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState icon={ClipboardList} title="Choose a report" />
        : missing.length ? <EmptyState title={`Choose ${missing.map((m) => NEED_LABEL[m]).join(', ')}`} />
          : !ready ? <SkeletonRows rows={8} cols={5} /> : <div className="fm-sheet"><Report k={rep.key} d={data.d} p={p} label={rep.label} /></div>}
    </div>
  )
}

function EmployeePicker({ emps, value, onChange }) {
  const sel = useMemo(() => new Set(String(value || '').split(',').filter(Boolean)), [value])
  const [q, setQ] = useState('')
  const list = emps.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id) => { const s = new Set(sel); s.has(String(id)) ? s.delete(String(id)) : s.add(String(id)); onChange([...s].join(',')) }
  return (
    <div className="mg-emps">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}><b>Employees</b><span className="muted">{sel.size} selected</span>
        <input type="search" aria-label="Find employee" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />
        {sel.size > 0 && <button type="button" className="btn small" onClick={() => onChange('')}>Clear</button>}</div>
      <div className="mg-emp-list">{list.map((e) => <label key={e.id} className="check"><input type="checkbox" checked={sel.has(String(e.id))} onChange={() => toggle(e.id)} /> {e.name}</label>)}</div>
    </div>
  )
}

const lotName = (r) => (r.Block ? `${r.Lot}/${r.Block}` : r.Lot)
function Csv({ rows, cols, name }) { return <button className="btn small no-print" onClick={() => download(rows, cols, name)} disabled={!rows.length}><Download size={13} /> CSV</button> }
function Head({ title, sub, children }) { return <div className="fm-head"><div><h2>{title}</h2>{sub && <div className="muted">{sub}</div>}</div>{children}</div> }

function Report({ k, d, p, label }) {
  if (k === 'ready-to-close') return (
    <>
      <Head title={label} sub={`As of ${fmtDate(d.date)} · ${d.rows.length} lot(s)`}><Csv rows={d.rows} cols={[['DivisionId', 'Div'], ['SuperName', 'Super'], ['CustName', 'Builder'], ['JobName', 'Job'], ['Phase', 'Phase'], ['BidNum', 'Bid'], ['LotBlock', 'Lot'], ['StartDate', 'Start'], ['LastPaid', 'Last labor paid']]} name="lots-ready-to-close.csv" /></Head>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Div</th><th>Superintendent</th><th>Builder</th><th>Job</th><th>Phase</th><th>Bid</th><th>Lot</th><th>Started</th><th>Last labor paid</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.LotID}><td>{r.DivisionId}</td><td>{r.SuperName}</td><td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td>{r.Phase}</td><td>{r.BidNum}</td><td><Link to={`/mg/reports?report=lot-detail&lotId=${r.LotID}`}><b>{r.LotBlock}</b></Link></td><td>{fmtDate(r.StartDate)}</td><td>{fmtDate(r.LastPaid) || 'Never'}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={9}><EmptyState title="No lots ready to close" /></td></tr>}</tbody></table></div>
    </>
  )
  if (k === 'lot-detail') {
    const l = d.lot
    const F = ({ t, v }) => <div><dt>{t}</dt><dd>{v || '—'}</dd></div>
    return (
      <>
        <Head title={`Lot ${lotName(l)} · ${l.JobName}`} sub={`${l.CustName} · ${l.DivisionId} · Phase ${l.Phase || '—'} · Combo id ${l.ComboId}`}><Badge tone={l.EndDate ? 'neutral' : 'green'}>{l.EndDate ? `Finished ${fmtDate(l.EndDate)}` : 'Open'}</Badge></Head>
        <dl className="mg-dl">
          <F t="Lot #" v={l.LotNum} /><F t="Start" v={fmtDate(l.StartDate)} /><F t="End" v={fmtDate(l.EndDate)} /><F t="Warranty" v={l.WarrantyDate} />
          <F t="Address" v={[l.Address, l.City, l.State, l.Zip].filter(Boolean).join(', ')} /><F t="Permit" v={l.Permit} /><F t="Plan" v={[l.PlanNum, l.PlanName].filter(Boolean).join(' · ')} /><F t="Status" v={l.Status} />
          <F t="Job #" v={l.JobNum} /><F t="Job type" v={l.JobType} /><F t="Phase #" v={l.PhaseNum} /><F t="Phase type" v={l.PhaseType} />
          <F t="Estimate" v={l.Estimate} /><F t="Rev. estimate" v={l.RevEstimate} /><F t="Contract" v={l.Contract} /><F t="Rev. contract" v={l.RevContract} />
          <F t="Substitution" v={l.SubsName} /><F t="Entered" v={`${fmtDate(l.DateEntered) || ''} ${l.UserEntered || ''}`.trim()} />
        </dl>
        {l.LotNotes && <p><b>Notes:</b> {l.LotNotes}</p>}
        <div className="dash-grid" style={{ marginTop: 12 }}>
          <section className="panel span-2"><div className="panel-head"><h2>Packs</h2></div>
            <table className="grid compact"><thead><tr><th>Pack</th><th className="num">Qty</th><th className="num">Contract ea</th><th className="num">Revised ea</th><th className="num">Total</th></tr></thead>
              <tbody>{d.packs.map((x, i) => <tr key={i}><td className="wrap">{x.PackName}</td><td className="num">{int(x.PackQty)}</td><td className="num">{money(x.ContractEa)}</td><td className="num">{x.RevContractEa == null ? '' : money(x.RevContractEa)}</td><td className="num">{money(x.Total)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={4}><b>Total</b></td><td className="num"><b>{money(d.packs.reduce((a, x) => a + Number(x.Total || 0), 0))}</b></td></tr></tfoot></table></section>
          <section className="panel"><div className="panel-head"><h2>Job cost</h2></div>
            <table className="grid compact"><thead><tr><th>Stage</th><th>Work</th><th>Code</th><th className="num">Total</th></tr></thead>
              <tbody>{d.jobCost.map((x, i) => <tr key={i}><td>{x.ScheduleStage}</td><td>{x.WorkType}</td><td>{x.CostCodeId}</td><td className="num">{money(x.Total)}</td></tr>)}{!d.jobCost.length && <tr><td colSpan={4} className="muted">Nothing posted</td></tr>}</tbody>
              <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{money(d.jobCost.reduce((a, x) => a + Number(x.Total || 0), 0))}</b></td></tr></tfoot></table></section>
          <section className="panel"><div className="panel-head"><h2>Billing</h2></div>
            <table className="grid compact"><thead><tr><th>Pack type</th><th className="num">Billed</th></tr></thead>
              <tbody>{d.billing.map((x, i) => <tr key={i}><td>{x.PackType}</td><td className="num">{money(x.Subtotal)}</td></tr>)}{!d.billing.length && <tr><td colSpan={2} className="muted">Nothing billed</td></tr>}</tbody>
              <tfoot><tr><td><b>Total</b></td><td className="num"><b>{money(d.billing.reduce((a, x) => a + Number(x.Subtotal || 0), 0))}</b></td></tr></tfoot></table></section>
        </div>
      </>
    )
  }
  if (k === 'lot-budget') return (
    <>
      <Head title={label} sub={`${d.head?.CustName} · ${d.head?.JobName} · Lot ${d.head?.LotBlock} · Plan ${d.head?.PlanNum || '—'} · labor includes ${p.burden}% burden`} />
      <div className="kpis"><StatCard label="Budget" tone="blue" value={money0(d.totals.BudgetValue)} foot="From the packs" /><StatCard label="Job cost" tone="amber" value={money0(d.totals.JobCostValue)} foot="Posted" /><StatCard label="Remaining" tone={d.totals.BudgetValue - d.totals.JobCostValue < 0 ? 'red' : 'green'} value={money0(d.totals.BudgetValue - d.totals.JobCostValue)} foot="Budget − job cost" /></div>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Cost code</th><th>Stage</th><th>Work</th><th className="num">Budget</th><th className="num">Job cost</th><th className="num">Difference</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{r.CostCodeId}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td><td className="num">{money(r.BudgetValue)}</td><td className="num">{money(r.JobCostValue)}</td><td className={`num${r.BudgetValue - r.JobCostValue < 0 ? ' neg' : ''}`}>{money(r.BudgetValue - r.JobCostValue)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={6}><EmptyState title="No budget or job cost on this lot" /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{money(d.totals.BudgetValue)}</b></td><td className="num"><b>{money(d.totals.JobCostValue)}</b></td><td className="num"><b>{money(d.totals.BudgetValue - d.totals.JobCostValue)}</b></td></tr></tfoot></table></div>
    </>
  )
  if (k === 'labor-paid') return (
    <>
      <Head title={label} sub={p.from || p.to ? `Payroll ${p.from || '…'} to ${p.to || '…'}` : 'All payroll dates'}><Csv rows={d.rows} cols={[['PayrollDate', 'Payroll date'], ['EmpName', 'Employee'], ['PackName', 'Pack'], ['Item', 'Item'], ['ExtItemQty', 'Qty'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ['PriceEa', 'Price ea'], ['PayPercent', 'Pay %'], ['PayHours', 'Hours'], ['HourlyRate', 'Rate'], ['Piece', 'Piece'], ['Hourly', 'Hourly'], ['Subtotal', 'Subtotal']]} name="labor-paid-lot.csv" /></Head>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Payroll</th><th>Employee</th><th>Pack</th><th>Item</th><th className="num">Qty</th><th>Stage</th><th>Work</th><th className="num">Price ea</th><th className="num">Pay %</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Piece</th><th className="num">Hourly</th><th className="num">Subtotal</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{fmtDate(r.PayrollDate)}</td><td>{r.EmpName}</td><td className="wrap">{r.PackName}</td><td>{r.Item}</td><td className="num">{int(r.ExtItemQty)}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td><td className="num">{money(r.PriceEa)}</td><td className="num">{r.PayPercent == null ? '' : `${Number(r.PayPercent)}%`}</td><td className="num">{r.PayHours == null ? '' : Number(r.PayHours)}</td><td className="num">{money(r.HourlyRate)}</td><td className="num">{money(r.Piece)}</td><td className="num">{money(r.Hourly)}</td><td className="num"><b>{money(r.Subtotal)}</b></td></tr>)}
          {!d.rows.length && <tr><td colSpan={14}><EmptyState title="No labor paid" /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={13}><b>Total</b></td><td className="num"><b>{money(d.total)}</b></td></tr></tfoot></table></div>
    </>
  )
  if (k === 'material-posted' || k === 'material-counter') return (
    <>
      <Head title={label} />
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Work</th><th>Stage</th><th>Class</th><th>Item</th><th>Description</th><th>{k === 'material-counter' ? 'Reason' : 'Notes'}</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{r.WorkType}</td><td>{r.ScheduleStage}</td><td>{r.InvClass}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td className="wrap">{r.Extra}</td><td className="num">{int(r.Qty)}</td><td className="num">{money(r.ExtVal)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={8}><EmptyState title={k === 'material-counter' ? 'No counter material on this lot' : 'No material posted'} /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={7}><b>Total</b></td><td className="num"><b>{money(d.total)}</b></td></tr></tfoot></table></div>
    </>
  )
  if (k === 'labor-vs-budget' || k === 'labor-vs-budget-employee') {
    const emp = k === 'labor-vs-budget-employee'
    const t = d.totals
    return (
      <>
        <Head title={label} sub={`${d.rows.length} line(s)`}><Csv rows={d.rows} cols={[...(emp ? [] : [['JobType', 'Job type']]), ['CustName', 'Builder'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ...(emp ? [['Employee', 'Employee']] : []), ['PayPiece', 'Piece paid'], ['PayHourly', 'Hourly paid'], ['PayContract', 'Budget']]} name={`${k}.csv`} /></Head>
        <div className="kpis"><StatCard label="Budget" tone="blue" value={money0(t.PayContract)} foot="Labor in the packs" /><StatCard label="Paid" tone="amber" value={money0(t.PayPiece + t.PayHourly)} foot={`Piece ${money0(t.PayPiece)} · hourly ${money0(t.PayHourly)}`} /><StatCard label="Difference" tone={t.PayContract - t.PayPiece - t.PayHourly < 0 ? 'red' : 'green'} value={money0(t.PayContract - t.PayPiece - t.PayHourly)} foot="Budget − paid" /></div>
        <div className="table-wrap"><table className="grid compact"><thead><tr>{!emp && <th>Job type</th>}<th>Builder</th><th>Job</th><th>Lot</th><th>Plan</th><th>Stage</th><th>Work</th>{emp && <th>Employee</th>}<th className="num">Piece</th><th className="num">Hourly</th><th className="num">Budget</th></tr></thead>
          <tbody>{d.rows.map((r, i) => <tr key={i} className={r.Employee === 'Budget' ? 'mg-budget' : ''}>{!emp && <td>{r.JobType}</td>}<td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td><b>{lotName(r)}</b></td><td>{r.PlanNum}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td>{emp && <td>{r.Employee}</td>}<td className="num">{money(r.PayPiece)}</td><td className="num">{money(r.PayHourly)}</td><td className="num">{money(r.PayContract)}</td></tr>)}
            {!d.rows.length && <tr><td colSpan={11}><EmptyState title="Nothing to show" /></td></tr>}</tbody></table></div>
      </>
    )
  }
  if (k === 'job-cost-work') return (
    <>
      <Head title={label} sub={`Lots finished ${p.from} to ${p.to}`}><Csv rows={d.rows} cols={[['CustName', 'Builder'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['ScheduleStage', 'Stage'], ['CostCodeId', 'Cost code'], ['Estimate', 'Estimate'], ['Actual', 'Actual']]} name="job-cost-by-work.csv" /></Head>
      <div className="kpis"><StatCard label="Estimate" tone="blue" value={money0(d.totals.Estimate)} foot="From the packs" /><StatCard label="Actual" tone="amber" value={money0(d.totals.Actual)} foot="Job cost" /><StatCard label="Difference" tone={d.totals.Estimate - d.totals.Actual < 0 ? 'red' : 'green'} value={money0(d.totals.Estimate - d.totals.Actual)} foot="Estimate − actual" /></div>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Job</th><th>Lot</th><th>Plan</th><th>Stage</th><th>Code</th><th className="num">Estimate</th><th className="num">Actual</th><th className="num">Difference</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td className="wrap">{r.JobName}</td><td><b>{lotName(r)}</b></td><td>{r.PlanNum}</td><td>{r.ScheduleStage}</td><td>{r.CostCodeId}</td><td className="num">{money(r.Estimate)}</td><td className="num">{money(r.Actual)}</td><td className={`num${r.Estimate - r.Actual < 0 ? ' neg' : ''}`}>{money(r.Estimate - r.Actual)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No finished lots with this type of work" /></td></tr>}</tbody></table></div>
    </>
  )
  if (k === 'option-packs') return (
    <>
      <Head title={label} sub={`Lots started ${p.from} to ${p.to}`}><Csv rows={d.rows} cols={[['JobName', 'Job'], ['PackName', 'Pack'], ['PackQty', 'Qty'], ['Packs', 'Buyers'], ['LotsInJob', 'Lots'], ['ContractValue', 'Value ea'], ['AvePerLot', 'Ave per lot'], ['AvePerBuyer', 'Ave per buyer']]} name="option-packs-by-job.csv" /></Head>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Job</th><th>Option pack</th><th className="num">Qty</th><th className="num">Buyers</th><th className="num">Lots in job</th><th className="num">Value ea</th><th className="num">Ave / lot</th><th className="num">Ave / buyer</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td className="wrap">{r.JobName}</td><td className="wrap"><b>{r.PackName}</b></td><td className="num">{int(r.PackQty)}</td><td className="num">{int(r.Packs)}</td><td className="num">{int(r.LotsInJob)}</td><td className="num">{money(r.ContractValue)}</td><td className="num">{r.AvePerLot == null ? '—' : Number(r.AvePerLot).toFixed(2)}</td><td className="num">{r.AvePerBuyer == null ? '—' : Number(r.AvePerBuyer).toFixed(2)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No option packs in this period" /></td></tr>}</tbody></table></div>
    </>
  )
  if (k === 'open-lots') return (
    <>
      <Head title={label} sub={`Started ${p.from} to ${p.to} · ${d.length} lot(s)`}><Csv rows={d} cols={[['Period', 'Period'], ['CustName', 'Builder'], ['JobName', 'Job'], ['Phase', 'Phase'], ['BidNum', 'Bid'], ['LotBlock', 'Lot'], ['StartDate', 'Start'], ['DateEntered', 'Entered'], ['UserEntered', 'User']]} name="open-lots-per-period.csv" /></Head>
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Period</th><th>Builder</th><th>Job</th><th>Phase</th><th>Bid</th><th>Lot</th><th>Started</th><th>Entered</th><th>By</th></tr></thead>
        <tbody>{d.map((r) => <tr key={r.LotID}><td>{r.Period}</td><td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td>{r.Phase}</td><td>{r.BidNum}</td><td><Link to={`/mg/reports?report=lot-detail&lotId=${r.LotID}`}><b>{r.LotBlock}</b></Link></td><td>{fmtDate(r.StartDate)}</td><td>{fmtDate(r.DateEntered)}</td><td>{r.UserEntered}</td></tr>)}
          {!d.length && <tr><td colSpan={9}><EmptyState title="No open lots started in this period" /></td></tr>}</tbody></table></div>
    </>
  )
  if (k === 'packs-no-value') return (
    <>
      <Head title={label} sub={`Lots finished ${p.from} to ${p.to}`} />
      <div className="table-wrap"><table className="grid compact"><thead><tr><th>Div</th><th>Customer</th><th>Job</th><th>Bid</th><th>Release</th><th>Plan</th><th>Builder code</th><th>Pack</th><th className="num">Value ea</th><th>Status</th><th>Trued up</th><th className="num">Lots</th></tr></thead>
        <tbody>{d.map((r, i) => <tr key={i}><td>{r.DivisionId}</td><td>{r.Customer}</td><td className="wrap">{r.Job}</td><td>{r.BidNum}</td><td>{r.BidRelease}</td><td>{r.PlanNum}</td><td>{r.BuilderCode}</td><td className="wrap"><b>{r.PackName}</b></td><td className="num">{money(r.ContractEa)}</td><td>{r.Status}</td><td>{r.TruedUp}</td><td className="num">{int(r.Lots)}</td></tr>)}
          {!d.length && <tr><td colSpan={12}><EmptyState title="Every pack on these lots has a value" /></td></tr>}</tbody></table></div>
    </>
  )
  return null
}
