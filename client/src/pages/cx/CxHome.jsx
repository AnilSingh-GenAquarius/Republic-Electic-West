// Cox cable switchboard (Access SwitchCX): run date / from-to filters, the material request and process billing
// actions, the report buttons, and the material / invoice / payroll date lists.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, FileText, Printer, Receipt, Search, Send, Truck } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { MaterialRequestDocs, RequestCheck } from './CxDocs'
import { CxTabs, int, isoDay, today } from './shared'

const firstOfMonth = () => `${today().slice(0, 8)}01`

export default function CxHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [f, setF] = useState({ date: today(), from: firstOfMonth(), to: today(), invoice: '', lot: null })
  const [result, setResult] = useState(null) // material request run output
  const load = () => api('/cx/overview').then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const report = (key, params = {}) => nav(`/cx/reports?${new URLSearchParams({ report: key, ...params })}`)

  async function requestMaterial() {
    if (!f.date) return setError('Enter the date (S) first')
    if (!confirm(`Request Cox material for every eligible lot not yet requested, dated ${fmtDate(f.date)}?\n\nLots get their job's Cox job type and assessor first; the run stops if an active job has lots on plans without Cox plan data.`)) return
    setBusy('req'); setError(''); setMsg(''); setResult(null)
    try {
      const r = await api('/cx/matreq/run', { method: 'POST', body: { date: f.date } })
      setResult(r)
      if (!r.stopped) setMsg(r.message || `Material requested for ${r.single.length} single (R1) and ${r.multi.length} multi (MDU) lot(s).`)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  async function processBilling() {
    if (!f.date) return setError('Enter the date (S) first')
    setBusy('bill'); setError(''); setMsg('')
    try {
      const pre = await api('/cx/billing/preview', { params: { date: f.date } })
      if (!pre.length) { setMsg('Nothing to invoice, no invoices were created'); return }
      if (!confirm(`Create Cox invoices dated ${fmtDate(f.date)} for ${pre.length} job / assessor combination(s)?\n\n${pre.slice(0, 15).map((r) => `• ${r.JobName} – ${r.AssessorName}`).join('\n')}`)) return
      const r = await api('/cx/billing/process', { method: 'POST', body: { date: f.date } })
      if (!r.created) { setMsg(r.message); return }
      setMsg(`Created ${r.created} invoice(s) (Cox${r.firstInvoice}–Cox${r.lastInvoice}) covering ${r.lots} lot(s) and ${r.items} item line(s).`)
      await load()
      report('billing-date', { date: f.date })
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <div className="page">
      <PageHeader title="Cox cable" subtitle="Cox job, plan and material setup; material requests; required billing info and Cox invoicing"
        actions={<Link className="btn primary" to="/cx/jobs">Setup job and plan data <ArrowRight size={15} /></Link>} />
      <CxTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state no-print" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="kpis no-print">
        <StatCard label="Cox jobs" icon={ClipboardList} tone="blue" loading={!d} value={int(d?.coxJobs)} foot={`${int(d?.plans)} Cox plans · ${int(d?.items)} items`} onClick={() => nav('/cx/jobs')} />
        <StatCard label="Lots with material requested" icon={Truck} tone="violet" loading={!d} value={int(d?.requested)} foot={`${int(d?.matReqDates?.length)} request date(s)`} />
        <StatCard label="Pending lots with no RBI" icon={AlertTriangle} tone={d?.pendingNoRbi ? 'amber' : 'green'} loading={!d} value={int(d?.pendingNoRbi)} foot="Requested, no Oracle project #" onClick={() => report('pending-no-rbi')} />
        <StatCard label="Lots invoiced" icon={Receipt} tone="green" loading={!d} value={int(d?.invoiced)} foot={`${int(d?.invoiceCount)} Cox invoice(s)`} />
      </div>

      <div className="dash-grid no-print">
        <section className="panel span-2">
          <div className="panel-head"><h2>Filters</h2></div>
          <div className="card form" style={{ boxShadow: 'none', border: 0, padding: 0 }}><fieldset>
            <label>Date (S)<input type="date" aria-label="Run date" value={f.date} onChange={set('date')} /></label>
            <label>From (T)<input type="date" aria-label="From date" value={f.from} onChange={set('from')} /></label>
            <label>To (T)<input type="date" aria-label="To date" value={f.to} onChange={set('to')} /></label>
            <label>Cox invoice<select aria-label="Cox invoice" value={f.invoice} onChange={set('invoice')}><option value="">Choose…</option>
              {(d?.invoices || []).map((x) => <option key={x.InvoiceNum} value={x.InvoiceNum}>Cox{x.InvoiceNum} · {x.AssessorJob} · {fmtDate(x.Date)}</option>)}</select></label>
            <label className="span2">Lot address (Y)<SearchSelect endpoint="/cx/pick/lots" value={f.lot?.id} label={f.lot?.name} placeholder="Search address…" onSelect={(lot) => setF({ ...f, lot })} /></label>
          </fieldset></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Actions</h2></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={!!busy} onClick={requestMaterial}><Send size={15} /> {busy === 'req' ? 'Requesting…' : 'Request material'}</button>
            <button className="btn" disabled={!f.date} onClick={() => report('matreq-reprint', { date: f.date })}><Printer size={15} /> Reprint material request</button>
            <button className="btn primary" disabled={!!busy} onClick={processBilling}><Receipt size={15} /> {busy === 'bill' ? 'Processing…' : 'Process billing'}</button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>Both actions use the date (S). Process billing invoices lots that have RBI (Oracle project #), a material request date and a "Standard rough" rough-in payroll on or before that date.</p>
          <div className="panel-head" style={{ marginTop: 12 }}><h2>Data entry</h2></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn" to="/cx/jobs"><ClipboardList size={15} /> Setup job and plan data</Link>
            <Link className="btn" to="/cx/billing-info"><FileText size={15} /> Enter billing info</Link>
            <Link className="btn" to="/cx/items">Cox items</Link>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Reports</h2></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!f.from || !f.to} onClick={() => report('roughed-lots', { from: f.from, to: f.to })}>Roughed lots / ready bill (T)</button>
            <button className="btn" disabled={!f.date} onClick={() => report('billing-date', { date: f.date })}>Billing by date (S)</button>
            <button className="btn" disabled={!f.date} onClick={() => report('billing-date-summary', { date: f.date })}>Billing by date summary (S)</button>
            <button className="btn" disabled={!f.invoice} onClick={() => report('billing-invoice', { invoice: f.invoice })}>Billing by inv #</button>
            <button className="btn" onClick={() => report('pending-no-rbi')}>Pending lots no RBI</button>
            <button className="btn" disabled={!f.lot} onClick={() => report('address-search', { lotId: f.lot.id })}><Search size={14} /> Address lot search (Y)</button>
          </div>
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2><CalendarDays size={16} /> Dates</h2><span className="muted small">click a date to use it as the date (S)</span></div>
          {!d ? <SkeletonRows rows={4} cols={3} /> : (
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <DateList title="Material date" rows={d.matReqDates} onPick={(x) => setF({ ...f, date: x })} />
              <DateList title="Invoice date" rows={d.invoiceDates} onPick={(x) => setF({ ...f, date: x })} />
              <DateList title="Payroll date" rows={d.payrollDates} onPick={(x) => setF({ ...f, date: x })} />
            </div>
          )}
        </section>
      </div>

      {result && (
        <section className="fm-sheet" style={{ marginTop: 16 }}>
          <div className="row no-print" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="muted small">Lots updated first: {result.updated.jobInfo} got the job's Cox type, {result.updated.notEligible} marked not Cox, {result.updated.assessor} got the job's assessor.</span>
            {!result.stopped && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>}
          </div>
          {result.stopped ? <RequestCheck rows={result.check} /> : <MaterialRequestDocs single={result.single} multi={result.multi} summary={result.summary} date={result.date} />}
        </section>
      )}
    </div>
  )
}

function DateList({ title, rows, onPick }) {
  return (
    <div style={{ minWidth: 150 }}>
      <b className="small">{title}</b>
      <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
        {!rows.length ? <div className="muted small">—</div> : rows.map((r) => (
          <button key={r.d} type="button" className="btn small ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => onPick(isoDay(r.d))}>
            {fmtDate(r.d)}{r.n != null ? <span className="muted"> · {r.n}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
