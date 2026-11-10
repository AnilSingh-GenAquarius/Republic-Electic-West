// Foreman reports (Access SwitchFM): cascade builder -> job -> lot / phase, then open a field report. Everything prints.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, ClipboardList, FileSearch, HardHat, ListOrdered, PackageCheck, Printer, TrendingUp, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { int, money0 } from '../po/shared'

const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// needs: c = builder, j = job, l = lot, p = phase  (the A/B/C/D letters on the Access switchboard)
const REPORTS = [
  { key: 'start-packet', label: 'Start packet labor', icon: HardHat, needs: 'l', text: 'Pack labor by stage for the lot, with the optional-pack summary' },
  { key: 'wip', label: 'Work in progress', icon: TrendingUp, needs: 'j', text: 'Open lots of the job: labor and material estimate vs paid / posted' },
  { key: 'labor-paid', label: 'Labor paid to lot', icon: Users, needs: 'l', text: 'Who was paid for what on the lot (no pay rates shown)' },
  { key: 'material-posted', label: 'Material posted to lot', icon: Boxes, needs: 'l', text: 'Material charged to the lot by work, stage and class' },
  { key: 'sequence-lot', label: 'Sequence sheet – lot', icon: ListOrdered, needs: 'l', text: 'Packs of the lot in builder-code order' },
  { key: 'sequence-phase', label: 'Sequence sheet – phase', icon: ClipboardList, needs: 'p', text: 'Packs of every lot in the phase' },
  { key: 'items', label: 'Item research', icon: FileSearch, needs: 'x', text: 'Find inventory items by description, code or class' },
]
const pctOf = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)

function Pick({ label, value, options, onChange, disabled, render = (o) => o.name }) {
  return (
    <label>{label}
      <select aria-label={label} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{disabled ? '—' : 'Choose…'}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{render(o)}</option>)}
      </select>
    </label>
  )
}

export default function FmHome() {
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [opts, setOpts] = useState({ customers: [], jobs: [], lots: [], phases: [] })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [burden, setBurden] = useState(p.burden ?? '25')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => { api('/fm/pick/customers').then((customers) => setOpts((o) => ({ ...o, customers }))).catch((e) => setError(e.message)) }, [])
  useEffect(() => { setOpts((o) => ({ ...o, jobs: [] })); if (p.customerId) api('/fm/pick/jobs', { params: { customerId: p.customerId } }).then((jobs) => setOpts((o) => ({ ...o, jobs }))).catch(() => {}) }, [p.customerId])
  useEffect(() => {
    setOpts((o) => ({ ...o, lots: [], phases: [] }))
    if (p.jobId) Promise.all([api('/fm/pick/lots', { params: { jobId: p.jobId } }), api('/fm/pick/phases', { params: { jobId: p.jobId } })]).then(([lots, phases]) => setOpts((o) => ({ ...o, lots, phases }))).catch(() => {})
  }, [p.jobId])

  const rep = REPORTS.find((r) => r.key === p.report)
  const have = { c: !!p.customerId, j: !!p.jobId, l: !!p.lotId, p: !!p.phaseId, x: true }
  useEffect(() => {
    setData((d) => (d && d._k === 'items' && p.report === 'items' ? d : null)); setError('')
    if (!rep || !have[rep.needs]) return
    let live = true
    const url = rep.key === 'items' ? '/fm/items' : rep.key.startsWith('sequence') ? '/fm/reports/sequence' : `/fm/reports/${rep.key}`
    const params = rep.key === 'items' ? { search: p.search, classId: p.classId } : rep.key === 'wip' ? { jobId: p.jobId, burden: p.burden } : rep.key === 'sequence-phase' ? { phaseId: p.phaseId } : { lotId: p.lotId }
    api(url, { params }).then((d) => live && setData({ ...d, _k: rep.key })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.report, p.lotId, p.jobId, p.phaseId, p.burden, p.search, p.classId])
  const ready = data && data._k === p.report

  return (
    <div className="page">
      <PageHeader title="Foreman reports" subtitle="Start packets, sequence sheets, WIP and what was paid or posted to a lot"
        actions={<>
          {ready && <button className="btn primary" onClick={() => window.print()}><Printer size={15} /> Print</button>}
        </>} />
      <div className="card form report-filters no-print"><fieldset>
        <Pick label="Builder" value={p.customerId} options={opts.customers} onChange={(v) => set({ customerId: v, jobId: '', lotId: '', phaseId: '' })} />
        <Pick label="Job" value={p.jobId} options={opts.jobs} disabled={!p.customerId} onChange={(v) => set({ jobId: v, lotId: '', phaseId: '' })} render={(o) => `${o.name} (${o.DivisionId || ''})`} />
        <Pick label="Lot" value={p.lotId} options={opts.lots} disabled={!p.jobId} onChange={(v) => set({ lotId: v })} render={(o) => `${o.name}${o.EndDate ? ' – finished' : ''}`} />
        <Pick label="Phase" value={p.phaseId} options={opts.phases} disabled={!p.jobId} onChange={(v) => set({ phaseId: v })} render={(o) => `${o.name}${o.PhaseNum ? ` (${o.PhaseNum})` : ''}`} />
      </fieldset></div>
      <div className="fm-reports no-print">
        {REPORTS.map((r) => {
          const ok = have[r.needs]
          const need = { l: 'a lot', j: 'a job', p: 'a phase' }[r.needs]
          return (
            <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} onClick={() => set({ report: r.key })} aria-pressed={p.report === r.key}>
              <r.icon size={18} /><span><b>{r.label}</b><small>{ok ? r.text : `Choose ${need} first`}</small></span>
            </button>
          )
        })}
      </div>
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState icon={PackageCheck} title="Choose a report">Pick the builder and job, then a lot or phase, and open one of the reports above.</EmptyState>
        : !have[rep.needs] ? <EmptyState title={`Choose ${{ l: 'a lot', j: 'a job', p: 'a phase' }[rep.needs]} for “${rep.label}”`} />
          : !ready ? <SkeletonRows rows={8} cols={5} /> : (
            <div className="fm-sheet">
              {rep.key === 'start-packet' && <StartPacket d={data} />}
              {rep.key === 'wip' && <Wip d={data} burden={burden} setBurden={setBurden} apply={() => set({ burden })} />}
              {rep.key === 'labor-paid' && <LaborPaid d={data} />}
              {rep.key === 'material-posted' && <MaterialPosted d={data} />}
              {rep.key.startsWith('sequence') && <Sequence d={data} />}
              {rep.key === 'items' && <Items d={data} p={p} set={set} />}
            </div>
          )}
    </div>
  )
}

function LotHead({ h, title }) {
  return (
    <div className="fm-head">
      <div><h2>{title}</h2><div className="muted">{h.CustName} · {h.JobName} · Phase {h.Phase}{h.PhaseType ? ` (${h.PhaseType})` : ''} · Code {h.Code}</div></div>
      <dl>
        <div><dt>Lot</dt><dd>{h.Block ? `${h.Lot}/${h.Block}` : h.Lot}</dd></div>
        <div><dt>Plan</dt><dd>{h.PlanNum}{h.SqFt ? ` · ${int(h.SqFt)} sq ft` : ''}</dd></div>
        <div><dt>Address</dt><dd>{[h.Address, h.City, h.State, h.Zip].filter(Boolean).join(', ') || '—'}</dd></div>
        <div><dt>Permit</dt><dd>{h.Permit || '—'}</dd></div>
        <div><dt>Lot start</dt><dd>{fmtDate(h.StartDate) || '—'}</dd></div>
        <div><dt>Superintendent</dt><dd>{[h.Super1 && `${h.Super1}${h.Super1Type ? ` (${h.Super1Type})` : ''}`, h.Super2 && `${h.Super2}${h.Super2Type ? ` (${h.Super2Type})` : ''}`].filter(Boolean).join(' / ') || '—'}</dd></div>
      </dl>
    </div>
  )
}

function StartPacket({ d }) {
  return (
    <>
      <LotHead h={d.head} title="Start packet – labor" />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Pack type</th><th>Pack</th><th className="num">Pack qty</th><th>Stage</th><th>Work</th><th>Labor code</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.PackType}</td><td className="wrap"><b>{l.PackName}</b></td><td className="num">{int(l.PackQty)}</td><td>{l.Stage}</td><td>{l.WorkType}</td><td>{l.AlternateCode}</td><td className="num">{int(l.Quantity)}</td><td className="num">{money(l.Price)}</td></tr>)}
          {!d.lines.length && <tr><td colSpan={8}><EmptyState title="No pack labor on this lot" /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={7}><b>Total labor</b></td><td className="num"><b>{money(d.total)}</b></td></tr></tfoot>
      </table></div>
      {d.summary.length > 0 && (
        <>
          <h3 className="fm-sub">Optional packs – rough and trim summary</h3>
          <table className="grid compact"><thead><tr><th>Pack type</th><th>Stage</th><th>Work</th><th className="num">Value</th></tr></thead>
            <tbody>{d.summary.map((s, i) => <tr key={i}><td>{s.PackType}</td><td>{s.Stage}</td><td>{s.WorkType}</td><td className="num">{money(s.Price)}</td></tr>)}</tbody></table>
        </>
      )}
    </>
  )
}

function Wip({ d, burden, setBurden, apply }) {
  const t = d.totals
  return (
    <>
      <div className="fm-head"><div><h2>Work in progress</h2><div className="muted">{d.rows[0] ? `${d.rows[0].CustName} · ${d.rows[0].JobName} (${d.rows[0].DivisionId})` : ''} · Labor values include burden {d.burden}%</div></div>
        <form className="row no-print" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); apply() }}>
          <label className="fm-burden">Labor burden %<input inputMode="decimal" aria-label="Labor burden percent" value={burden} onChange={(e) => setBurden(e.target.value)} /></label><button className="btn small">Apply</button>
        </form>
      </div>
      <div className="kpis">
        <StatCard label="Labor estimate" tone="blue" value={money0(t.LaborEst)} foot={`${d.rows.length} open lot(s)`} />
        <StatCard label="Labor paid" tone="violet" value={money0(t.LaborPaid)} foot={t.LaborEst ? `${pctOf(t.LaborPaid / t.LaborEst)} of estimate` : ''} />
        <StatCard label="Material estimate" tone="amber" value={money0(t.MaterialEst)} foot="From the packs" />
        <StatCard label="Material posted" tone="green" value={money0(t.MaterialPosted)} foot={t.MaterialEst ? `${pctOf(t.MaterialPosted / t.MaterialEst)} of estimate` : ''} />
      </div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Phase</th><th>Lot</th><th className="num">Labor est.</th><th className="num">Labor paid</th><th className="num">Labor %</th><th className="num">Material est.</th><th className="num">Material posted</th><th className="num">Material %</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.LotID} className={r.LaborPercent > 1 || r.MaterialPercent > 1 ? 'row-warn' : ''}><td>{r.Phase}</td><td><b>{r.LotBlock}</b></td><td className="num">{money(r.LaborEst)}</td><td className="num">{money(r.LaborPaid || 0)}</td><td className="num">{pctOf(r.LaborPercent)}</td><td className="num">{money(r.MaterialEst || 0)}</td><td className="num">{money(r.MaterialPosted || 0)}</td><td className="num">{pctOf(r.MaterialPercent)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No open lots with labor on this job" /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{money(t.LaborEst)}</b></td><td className="num"><b>{money(t.LaborPaid)}</b></td><td className="num">{t.LaborEst ? pctOf(t.LaborPaid / t.LaborEst) : ''}</td><td className="num"><b>{money(t.MaterialEst)}</b></td><td className="num"><b>{money(t.MaterialPosted)}</b></td><td className="num">{t.MaterialEst ? pctOf(t.MaterialPosted / t.MaterialEst) : ''}</td></tr></tfoot>
      </table></div>
    </>
  )
}

function LaborPaid({ d }) {
  return (
    <>
      <LotHead h={d.head} title="Labor paid to lot" />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Payroll date</th><th>Employee</th><th>Pack</th><th className="num">Pack qty</th><th>Item</th><th className="num">Qty</th><th>Stage</th><th>Work</th><th className="num">Pay %</th><th className="num">Hours</th><th>Notes</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{fmtDate(r.PayrollDate)}</td><td>{r.EmpName}</td><td className="wrap">{r.PackName}</td><td className="num">{int(r.PackQty)}</td><td>{r.Item}</td><td className="num">{int(r.ExtItemQty)}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td><td className="num">{r.PayPercent == null ? '' : `${Number(r.PayPercent)}%`}</td><td className="num">{r.PayHours == null ? '' : Number(r.PayHours)}</td><td className="wrap">{r.Notes}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={11}><EmptyState title="No labor paid to this lot yet" /></td></tr>}</tbody>
      </table></div>
    </>
  )
}

function MaterialPosted({ d }) {
  return (
    <>
      <LotHead h={d.head} title="Material posted to lot" />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Work</th><th>Stage</th><th>Class</th><th>Item</th><th>Description</th><th>Delivery</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{r.WorkType}</td><td>{r.ScheduleStage}</td><td>{r.InvClass}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td>{r.Delivery}</td><td className="num">{int(r.Qty)}</td><td className="num">{money(r.ExtVal)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No material posted to this lot" /></td></tr>}</tbody>
        <tfoot><tr><td colSpan={7}><b>Total</b></td><td className="num"><b>{money(d.total)}</b></td></tr></tfoot>
      </table></div>
    </>
  )
}

function Sequence({ d }) {
  if (!d.head) return <EmptyState title="No packs on the selected lot(s)" />
  const h = d.head
  return (
    <>
      <div className="fm-head">
        <div><h2>Sequence sheet</h2><div className="muted">{h.CustName} · {h.JobName} · Phase {h.Phase} · Code {h.Code}</div></div>
        <dl>
          <div><dt>Bid</dt><dd>{[h.BidNum, h.BidRelease, h.BidName].filter(Boolean).join(' · ') || '—'}{h.BidDate ? ` (${fmtDate(h.BidDate)})` : ''}</dd></div>
          <div><dt>Phase start</dt><dd>{fmtDate(h.PhaseStart) || '—'}</dd></div>
          <div><dt>Superintendents</dt><dd>{[h.Super1 && `${h.Super1} - ${h.Super1Type || ''}`, h.Super2 && `${h.Super2} - ${h.Super2Type || ''}`].filter(Boolean).join(' / ') || '—'}</dd></div>
        </dl>
      </div>
      {d.lots.map((l) => (
        <section key={l.LotID} className="fm-lot">
          <h3>Lot {l.LotBlock} <span className="muted">· Plan {l.PlanNum}{l.PlanName ? ` ${l.PlanName}` : ''} · {[l.Address, l.City].filter(Boolean).join(', ')}</span></h3>
          <table className="grid compact"><thead><tr><th>Builder code</th><th>Pack</th><th className="num">Qty</th><th>Date</th><th>Verified</th></tr></thead>
            <tbody>{l.packs.map((k) => <tr key={k.PackID}><td>{k.BuilderCode}</td><td className="wrap"><b>{k.PackName}</b></td><td className="num">{int(k.PackQty)}</td><td>{fmtDate(k.PackDate)}</td><td>{k.Verified}</td></tr>)}</tbody></table>
        </section>
      ))}
    </>
  )
}

function Items({ d, p, set }) {
  const [q, setQ] = useState(p.search || '')
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })  
  return (
    <>
      <div className="fm-head"><div><h2>Item research</h2><div className="muted">Active inventory items{d.rows.length === 500 ? ' (first 500 – narrow the search)' : ` · ${d.rows.length} found`}</div></div></div>
      <div className="filters no-print">
        <div className="search-wrap"><input type="search" aria-label="Search items" placeholder="Words in the description, item or code…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Class" value={p.classId || ''} onChange={(e) => set({ classId: e.target.value })}><option value="">All classes</option>{d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Class</th><th>Item</th><th>Description</th><th>Alternate code</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.InvItemID}><td>{r.InvClass}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td>{r.AlternateCode}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={4}><EmptyState title="No items match" /></td></tr>}</tbody>
      </table></div>
    </>
  )
}
