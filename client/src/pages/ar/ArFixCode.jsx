// Fix billing code (Access SwitchAR button "Fix billing code" = macro ArBillCodeFix, and form ArBillCode "Manual fix billing code").
// Billing lines saved without a schedule stage / work are matched to the lot's contract values and get ComboId = PackId.stageWork.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Wrench } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ArTabs, ConfirmDialog, int, money, useArLookups } from './shared'

const OTHER = 'other'

export default function ArFixCode() {
  const lk = useArLookups()
  const [division, setDivision] = useState('')
  const [pv, setPv] = useState(null)
  const [error, setError] = useState('')
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [open, setOpen] = useState(null)   // step key whose sample rows are shown

  const loadPreview = useCallback(() => {
    if (!division) return Promise.resolve()
    return api('/ar/fix-code/preview', { params: { division } }).then(setPv).catch((e) => setError(e.message))
  }, [division])
  useEffect(() => { setPv(null); setError(''); setDone(null); loadPreview() }, [loadPreview])

  async function run() {
    setBusy(true); setError('')
    try {
      const r = await api('/ar/fix-code/run', { method: 'POST', body: { division } })
      setAsk(false); setDone(r); setPv(null); await loadPreview()
    } catch (e) { setAsk(false); setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <PageHeader title="Fix billing code" subtitle="Give billing lines that lost their schedule stage and work the code of the lot's contract value" />
      <ArTabs />
      <div className="card form report-filters"><fieldset>
        <label>Division (I) *<select aria-label="Division" value={division} onChange={(e) => setDivision(e.target.value)}><option value="">Choose…</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {done && (
        <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> Fixed {done.total} billing line(s) in division {done.division}
          ({done.steps.map((s) => `${s.fixed}`).join(' + ')}). {done.manualLeft} option line(s) still need the manual fix below.</div>
      )}
      {!division ? <EmptyState title="Choose a division">The preview shows which billing lines would change. Nothing is saved until you press Fix billing code.</EmptyState>
        : !pv ? <SkeletonRows rows={5} cols={4} /> : (
          <>
            <section className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <h2>Preview</h2>
                <span className="muted">{int(pv.unfixedLines)} billing line(s) of {pv.division} have no stage/work; {int(pv.contractValues)} contract value(s) to match against</span>
              </div>
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Step</th><th>Rule</th><th className="num">Would fix</th><th className="num">Ambiguous (left for manual)</th><th /></tr></thead>
                <tbody>
                  {pv.steps.map((s, i) => (
                    <FragmentRows key={s.key} s={s} n={i + 1} open={open === s.key} toggle={() => setOpen(open === s.key ? null : s.key)} />
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{int(pv.total)}</b></td><td /><td /></tr></tfoot>
              </table></div>
              <div className="row form-actions" style={{ padding: '0 14px 14px' }}>
                <button className="btn primary" disabled={!pv.total || busy} onClick={() => setAsk(true)}><Wrench size={15} /> Fix billing code</button>
                {!pv.total && <span className="muted">Nothing to fix automatically for this division.</span>}
              </div>
            </section>
            <ManualFix division={division} onFixed={loadPreview} />
          </>
        )}
      {ask && (
        <ConfirmDialog title="Fix billing code" confirmLabel="Fix billing code" busy={busy} onCancel={() => setAsk(false)} onConfirm={run}>
          <p>Update the stage, work and code of <b>{pv?.total}</b> billing line(s) in division <b>{division}</b>?</p>
          <p className="muted">All four steps run together; if any of them fails nothing is changed.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function FragmentRows({ s, n, open, toggle }) {
  return (
    <>
      <tr>
        <td>{n}</td><td className="wrap">{s.label}<div className="muted">Access query {s.query}</div></td><td className="num"><b>{int(s.fixed)}</b></td>
        <td className="num">{s.ambiguous ? <Badge tone="amber">{s.ambiguous}</Badge> : ''}</td>
        <td>{s.candidates > 0 && <button className="btn small" onClick={toggle}>{open ? 'Hide lines' : 'Show lines'}</button>}</td>
      </tr>
      {open && (
        <tr><td colSpan={5}>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Invoice</th><th>Job</th><th>Lot</th><th>Pack</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Total</th><th>New stage / work</th></tr></thead>
            <tbody>{s.sample.map((r) => (
              <tr key={r.BillItemID}><td>{r.BillID}</td><td className="wrap">{r.JobName}</td><td>{r.LotBlock}</td><td className="wrap">{r.PackName}</td><td className="num">{int(r.Quantity)}</td><td className="num">{r.ValueEa}</td><td className="num">{r.ItemTotal}</td>
                <td>{r.n > 1 ? <Badge tone="amber">ambiguous</Badge> : `${r.NewStageId} / ${r.NewWorkId}`}</td></tr>
            ))}</tbody>
          </table></div>
          {s.candidates > s.sample.length && <p className="muted">Showing {s.sample.length} of {s.candidates} lines.</p>}
        </td></tr>
      )}
    </>
  )
}

// Manual fix (Access form ArBillCode / ArBillCodeSubDetail, Division I + Invoice J)
function ManualFix({ division, onFixed }) {
  const [invoices, setInvoices] = useState(null)
  const [invoiceId, setInvoiceId] = useState('')
  const [d, setD] = useState(null)
  const [pick, setPick] = useState({})   // BillItemID -> '' | 'stage.work' | 'other'
  const [custom, setCustom] = useState({})   // BillItemID -> { s, w }
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const loadInvoices = useCallback(() => api('/ar/fix-code/invoices', { params: { division } }).then((r) => setInvoices(r.invoices)).catch((e) => setError(e.message)), [division])
  useEffect(() => { setInvoices(null); setInvoiceId(''); setD(null); loadInvoices() }, [loadInvoices])
  useEffect(() => {
    setD(null); setPick({}); setCustom({})
    if (!invoiceId) return
    api('/ar/fix-code/manual', { params: { division, invoiceId } }).then(setD).catch((e) => setError(e.message))
  }, [division, invoiceId])

  const chosen = (it) => {
    const v = pick[it.BillItemID]
    if (!v) return null
    if (v === OTHER) { const c = custom[it.BillItemID] || {}; return Number(c.s) > 0 && c.w !== '' && c.w != null && Number(c.w) >= 0 ? { scheduleStageId: Number(c.s), workId: Number(c.w) } : null }
    const [s, w] = v.split('.')
    return { scheduleStageId: Number(s), workId: Number(w) }
  }
  const fixes = (d?.items || []).map((it) => ({ billItemId: it.BillItemID, ...chosen(it) })).filter((f) => f.scheduleStageId)

  async function save() {
    setBusy(true); setError(''); setMsg('')
    try {
      const r = await api('/ar/fix-code/manual', { method: 'POST', body: { division, invoiceId: Number(invoiceId), fixes } })
      setMsg(`Fixed ${r.fixed} line(s) of invoice ${invoiceId}.`)
      const [inv] = await Promise.all([api('/ar/fix-code/manual', { params: { division, invoiceId } }), loadInvoices(), onFixed()])
      setD(inv); setPick({}); setCustom({})
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Manual fix</h2><span className="muted">Pick the stage and work of each option line that the automatic steps could not match</span></div>
      <div className="card form"><fieldset>
        <label>Invoice (J) *<select aria-label="Invoice" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setMsg(''); setError('') }}>
          <option value="">{invoices ? (invoices.length ? 'Choose…' : 'No invoice needs a manual fix') : 'Loading…'}</option>
          {(invoices || []).map((i) => <option key={i.BillID} value={i.BillID}>#{i.BillID} {fmtDate(i.Date)} {i.CustName} · {i.JobName} · {i.LotBlock} ({i.Lines})</option>)}
        </select></label>
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ margin: '0 14px 12px' }}><CheckCircle2 size={16} /> {msg}</div>}
      {invoiceId && !d && !error && <SkeletonRows rows={4} cols={6} />}
      {d && (!d.items.length ? <EmptyState title="Every option line of this invoice has a stage and work" /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Pack</th><th>Code</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Total</th><th>Contract values of this pack (stage / work, ea)</th><th>Billing stage / work</th></tr></thead>
            <tbody>{d.items.map((it) => {
              const v = pick[it.BillItemID] || ''
              const c = custom[it.BillItemID] || { s: '', w: '' }
              return (
                <tr key={it.BillItemID}>
                  <td className="wrap"><b>{it.PackName}</b></td><td>{it.ComboId}</td><td className="num">{int(it.Quantity)}</td><td className="num">{money(it.ValueEa)}</td><td className="num">{money(it.ItemTotal)}</td>
                  <td className="wrap">{it.options.length ? it.options.map((o) => `${o.ScheduleStage || o.ScheduleStageId} / ${o.WorkType || o.WorkId}: ${money(o.Contract || 0)}`).join('  ·  ') : <span className="muted">no contract values</span>}</td>
                  <td>
                    <select aria-label={`Stage and work for ${it.PackName}`} value={v} onChange={(e) => setPick({ ...pick, [it.BillItemID]: e.target.value })}>
                      <option value="">Leave as is</option>
                      {it.options.map((o) => <option key={`${o.ScheduleStageId}.${o.WorkId}`} value={`${o.ScheduleStageId}.${o.WorkId}`}>{o.ScheduleStage || o.ScheduleStageId} / {o.WorkType || o.WorkId}</option>)}
                      <option value={OTHER}>Other (enter ids)…</option>
                    </select>
                    {v === OTHER && (
                      <span className="row" style={{ gap: 6, marginTop: 4 }}>
                        <input className="cell-input" style={{ width: 70 }} inputMode="numeric" placeholder="Stage id" aria-label="Schedule stage id" value={c.s} onChange={(e) => setCustom({ ...custom, [it.BillItemID]: { ...c, s: e.target.value } })} />
                        <input className="cell-input" style={{ width: 70 }} inputMode="numeric" placeholder="Work id" aria-label="Work id" value={c.w} onChange={(e) => setCustom({ ...custom, [it.BillItemID]: { ...c, w: e.target.value } })} />
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}</tbody>
          </table></div>
          <div className="row form-actions" style={{ padding: '0 14px 14px' }}>
            <button className="btn primary" disabled={!fixes.length || busy} onClick={save}>{busy ? 'Saving…' : `Save ${fixes.length} fix(es)`}</button>
          </div>
        </>
      ))}
    </section>
  )
}
