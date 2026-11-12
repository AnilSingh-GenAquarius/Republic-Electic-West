// Process billing (Access ArProcessBilling): builder + division -> open lots -> bill % per pack line -> submit to the pre-bill.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Send } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ArTabs, ConfirmDialog, LIENS, SnapshotsInUse, int, money, pct, today, useArLookups } from './shared'

export function ArBilling() {
  const lk = useArLookups()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [snap, setSnap] = useState(null)
  const [okKey, setOkKey] = useState('')   // builder|division the user chose to continue with although another user holds its snapshot
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => {
    setD(null); setError('')
    if (!p.customerId || !p.division) return
    api('/ar/to-bill', { params: { customerId: p.customerId, division: p.division, jobId: p.jobId } }).then(setD).catch((e) => setError(e.message))
     
  }, [p.customerId, p.division, p.jobId])
  const totals = useMemo(() => (d?.lots || []).reduce((a, l) => ({ c: a.c + (l.Contract || 0), b: a.b + (l.Billed || 0), q: a.q + (l.Queued || 0) }), { c: 0, b: 0, q: 0 }), [d])
  const ready = p.customerId && p.division
  // Access ArBillingWarning: somebody else already holds a snapshot of this builder + division
  const holders = ready && snap ? [...new Set(snap.rows.filter((r) => String(r.CustId) === String(p.customerId) && r.DivisionId === p.division && r.UserSelect !== snap.me).map((r) => r.UserSelect))] : []
  const blocked = holders.length > 0 && okKey !== `${p.customerId}|${p.division}`
  return (
    <div className="page">
      <PageHeader title="Process billing" subtitle="Choose a builder and division, then set what to bill on each lot"
        actions={<Link className="btn" to={`/ar/prebill${ready ? `?customerId=${p.customerId}&division=${p.division}` : ''}`}><Send size={15} /> Review &amp; post</Link>} />
      <ArTabs />
      <div className="card form report-filters"><fieldset>
        <label>Builder *<select aria-label="Builder" value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value, jobId: '' })}><option value="">Choose…</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Division *<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value, jobId: '' })}><option value="">Choose…</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Job<select aria-label="Job" value={p.jobId || ''} onChange={(e) => set({ jobId: e.target.value })} disabled={!d}><option value="">All jobs</option>{(d?.jobs || []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
      </fieldset></div>
      <SnapshotsInUse customerId={p.customerId} division={p.division} onData={setSnap} />
      {error && <ErrorState message={error} />}
      {holders.length > 0 && (
        <div className="banner warn" role="alert"><AlertTriangle size={16} />
          <span style={{ flex: 1 }}><b>Warning!</b> Somebody is already working on this customer for this division ({holders.join(', ')}). Are you sure you want to do billing for the same customer/division?</span>
          {blocked && <button className="btn small" onClick={() => setOkKey(`${p.customerId}|${p.division}`)}>Yes, continue</button>}
        </div>
      )}
      {!ready ? <EmptyState title="Choose a builder and a division">Open lots (not finished, active) of that builder are listed with their contract value and what has been billed.</EmptyState>
        : blocked ? <EmptyState title="Confirm to continue">Choose "Yes, continue" above to work on this builder and division while the other user holds its snapshot.</EmptyState>
        : !d ? <SkeletonRows rows={8} cols={5} /> : (
          <>
            {!d.billTo && <div className="banner"><AlertTriangle size={16} /> This builder has no bill-to address for division {p.division}. Invoices will be posted without an address.</div>}
            {d.billTo && <p className="muted" style={{ margin: '0 0 10px' }}>Bill to: {[d.billTo.CustContact, d.billTo.BillAddress, d.billTo.BillCity, d.billTo.BillState, d.billTo.BillZip].filter(Boolean).join(', ')}</p>}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Job</th><th>Lot / block</th><th>Plan</th><th>Phase</th><th>Address</th><th className="num">Contract</th><th className="num">Billed</th><th className="num">Left</th><th className="num">Invoices</th><th className="num">Packs paid (payroll)</th><th>Submitted</th></tr></thead>
              <tbody>
                {d.lots.map((l) => (
                  <tr key={l.LotID} className="link-row" onClick={() => nav(`/ar/billing/lots/${l.LotID}?${sp.toString()}`)}>
                    <td className="wrap">{l.JobName}</td><td><a><b>{l.Lot}/{l.Block}</b></a></td><td>{l.PlanNum}</td><td>{l.Phase}</td><td className="wrap">{l.Address}</td>
                    <td className="num">{money(l.Contract || 0)}</td><td className="num">{money(l.Billed || 0)}</td><td className="num"><b>{money((l.Contract || 0) - (l.Billed || 0))}</b></td><td className="num">{int(l.Invoices)}</td><td className="num">{l.PaidPacks ? int(l.PaidPacks) : ""}</td>
                    <td>{l.Queued ? <Badge tone="violet">{money(l.Queued)}</Badge> : ''}</td>
                  </tr>
                ))}
                {!d.lots.length && <tr><td colSpan={11}><EmptyState title="No open lots for this builder and division" /></td></tr>}
              </tbody>
              {d.lots.length > 0 && <tfoot><tr><td colSpan={5}><b>{d.lots.length} lot(s)</b></td><td className="num"><b>{money(totals.c)}</b></td><td className="num"><b>{money(totals.b)}</b></td><td className="num"><b>{money(totals.c - totals.b)}</b></td><td /><td /><td><b>{totals.q ? money(totals.q) : ''}</b></td></tr></tfoot>}
            </table></div>
          </>
        )}
    </div>
  )
}

const k = (l) => `${l.PackID}.${l.ScheduleStageId}.${l.WorkId}`

export function ArBillLot() {
  const { lotId } = useParams()
  const [sp] = useSearchParams()
  const lk = useArLookups()
  const [d, setD] = useState(null)
  const [rows, setRows] = useState({})   // key -> { billPercent, billValue, notes }
  const [head, setHead] = useState({ invoiceDate: today(), billTypeId: '1', terms: 'Net 30', lien: 'Progress' })
  const [error, setError] = useState('')
  const [confirmMsg, setConfirmMsg] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [setX, setSetX] = useState('')
  const [askRemove, setAskRemove] = useState(false)

  const load = useCallback(async () => {
    const r = await api(`/ar/lots/${lotId}/lines`)
    setD(r)
    const init = {}
    for (const q of r.queued) init[`${q.PackId}.${q.ScheduleStageId ?? 0}.${q.WorkId ?? 0}`] = { billPercent: q.BillPercent ? String(Number(q.BillPercent)) : '', billValue: q.BillValue ? String(Number(q.BillValue)) : '', notes: q.Notes || '' }
    setRows(init)
    if (r.queued[0]) { const q = r.queued[0]; setHead({ invoiceDate: String(q.InvDate || today()).slice(0, 10), billTypeId: String(q.BillTypeId || 1), terms: q.Terms || 'Net 30', lien: q.Lien || 'Progress' }) }
  }, [lotId])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const upd = (key, patch) => setRows((s) => ({ ...s, [key]: { billPercent: '', billValue: '', notes: '', ...s[key], ...patch } }))
  const setAll = (v) => setRows(Object.fromEntries((d?.lines || []).map((l) => [k(l), { ...rows[k(l)], billPercent: v === '' ? '' : String(v), billValue: '' }])))
  const setRemaining = () => setRows(Object.fromEntries((d?.lines || []).map((l) => [k(l), { ...rows[k(l)], billPercent: l.BilledPercent < 100 ? String(+(100 - l.BilledPercent).toFixed(4)) : '', billValue: '' }])))
  const amount = (l) => { const r = rows[k(l)]; if (!r) return 0; if (Number(r.billValue)) return Number(r.billValue); return (l.Quantity || 0) * (l.ValueEa || 0) * (Number(r.billPercent) || 0) / 100 }
  const total = (d?.lines || []).reduce((a, l) => a + amount(l), 0)
  const entered = (d?.lines || []).filter((l) => Number(rows[k(l)]?.billPercent) || Number(rows[k(l)]?.billValue)).length

  async function submit(force) {
    setError(''); setMsg(''); setConfirmMsg(''); setBusy(true)
    try {
      const lines = d.lines.filter((l) => Number(rows[k(l)]?.billPercent) || Number(rows[k(l)]?.billValue))
        .map((l) => ({ packId: l.PackID, scheduleStageId: l.ScheduleStageId, workId: l.WorkId, billPercent: rows[k(l)].billPercent, billValue: rows[k(l)].billValue, notes: rows[k(l)].notes }))
      const r = await api('/ar/prebill', { method: 'POST', body: { lotId: Number(lotId), ...head, lines, force: !!force } })
      setMsg(`Submitted ${r.lines} line(s) for ${money(total)}. Post the billing when all lots of this builder are ready.`)
      await load()
    } catch (e) { if (e.data?.needsConfirm) setConfirmMsg(e.message); else setError(e.message) } finally { setBusy(false) }
  }
  async function removeQueued() {
    setAskRemove(false)
    if (!d.queued[0]) return
    try { await api(`/ar/prebill/lots/${d.queued[0].PreBillLotID}`, { method: 'DELETE' }); setMsg('Removed from the pre-bill.'); await load() } catch (e) { setError(e.message) }
  }

  const lot = d?.lot
  const back = `/ar/billing?${sp.toString()}`
  return (
    <div className="page">
      <PageHeader crumb={<Link to={back}>Process billing</Link>} title={lot ? `Lot ${lot.Lot}/${lot.Block} · ${lot.JobName}` : 'Lot billing'} track={!!lot}
        subtitle={lot ? [lot.CustName, lot.DivisionId, lot.PlanNum && `Plan ${lot.PlanNum}`, lot.Address].filter(Boolean).join(' · ') : null}
        actions={<Link className="btn" to={back}><ArrowLeft size={15} /> Lots</Link>} />
      <ArTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg} <Link to={`/ar/prebill?customerId=${lot?.CustId}&division=${lot?.DivisionId}`}>Review &amp; post</Link></div>}
      {confirmMsg && (
        <div className="banner warn" role="alert"><AlertTriangle size={16} />
          <span style={{ whiteSpace: 'pre-line', flex: 1 }}>{confirmMsg}</span>
          <button className="btn small" onClick={() => submit(true)}>Bill anyway</button><button className="btn small" onClick={() => setConfirmMsg('')}>Cancel</button>
        </div>
      )}
      {!d ? <SkeletonRows rows={8} cols={5} /> : (
        <>
          {lot.EndDate && <div className="banner"><AlertTriangle size={16} /> This lot was finished on {fmtDate(lot.EndDate)}.</div>}
          {d.queued.length > 0 && <div className="banner"><Send size={16} /> This lot is already submitted ({d.queued.length} line(s)) and waiting to post. Submitting again replaces it. <button className="btn small" onClick={() => setAskRemove(true)}>Remove</button></div>}
          <div className="card form">
            <fieldset>
              <legend>Invoice</legend>
              <label>Invoice date *<input type="date" value={head.invoiceDate} onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} /></label>
              <label>Type<select value={head.billTypeId} onChange={(e) => setHead({ ...head, billTypeId: e.target.value })}>{lk.billTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Terms<select value={head.terms} onChange={(e) => setHead({ ...head, terms: e.target.value })}>{!lk.terms.some((t) => t.id === head.terms) && <option>{head.terms}</option>}{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Lien release<select value={head.lien} onChange={(e) => setHead({ ...head, lien: e.target.value })}>{LIENS.map((x) => <option key={x}>{x}</option>)}</select></label>
            </fieldset>
          </div>
          <div className="filters">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => setAll('')}>Set 0</button>
              <button className="btn small" onClick={() => setAll(100)}>Set 100%</button>
              <button className="btn small" onClick={setRemaining}>Bill the rest</button>
              <input style={{ width: 80 }} inputMode="decimal" placeholder="X %" aria-label="Percent for every line" value={setX} onChange={(e) => setSetX(e.target.value)} />
              <button className="btn small" disabled={!setX} onClick={() => setAll(setX)}>Set X%</button>
            </div>
          </div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Pack</th><th>Stage</th><th>Work</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Ext value</th><th className="num">Billed</th><th>Status</th><th className="num">Bill %</th><th className="num">or amount $</th><th>Notes</th><th className="num">To bill</th></tr></thead>
            <tbody>
              {d.lines.map((l) => {
                const r = rows[k(l)] || {}
                const over = (Number(r.billPercent) || 0) + l.BilledPercent > 100.0001
                return (
                  <tr key={k(l)} className={over ? 'row-warn' : ''}>
                    <td className="wrap"><b>{l.PackName}</b></td><td>{l.ScheduleStage}</td><td>{l.WorkType}</td><td className="num">{int(l.Quantity)}</td>
                    <td className="num">{money(l.ValueEa)}</td><td className="num">{money(l.ExtValue)}</td>
                    <td className="num">{l.BilledPercent ? <span title={money(l.BilledAmount)}>{pct(l.BilledPercent)}</span> : ''}</td>
                    <td>{l.StagePosted ? <Badge tone="green">Posted</Badge> : null} {l.PayrollPaid ? <Badge tone="blue">Paid</Badge> : null}</td>
                    <td className="num"><input className="cell-input" inputMode="decimal" aria-label={`Bill % ${l.PackName} ${l.ScheduleStage}`} value={r.billPercent ?? ''} onChange={(e) => upd(k(l), { billPercent: e.target.value })} /></td>
                    <td className="num"><input className="cell-input" inputMode="decimal" aria-label={`Amount ${l.PackName} ${l.ScheduleStage}`} value={r.billValue ?? ''} onChange={(e) => upd(k(l), { billValue: e.target.value })} /></td>
                    <td><input className="cell-input wide" maxLength={255} aria-label={`Notes ${l.PackName}`} value={r.notes ?? ''} onChange={(e) => upd(k(l), { notes: e.target.value })} /></td>
                    <td className="num"><b>{amount(l) ? money(amount(l)) : ''}</b></td>
                  </tr>
                )
              })}
              {!d.lines.length && <tr><td colSpan={12}><EmptyState title="This lot has no packs to bill" /></td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={11}><b>{entered} line(s) to bill</b></td><td className="num"><b>{money(total)}</b></td></tr></tfoot>
          </table></div>
          <div className="row form-actions"><button className="btn primary" disabled={busy || !entered} onClick={() => submit(false)}><Send size={15} /> {busy ? 'Submitting…' : 'Submit invoice'}</button></div>
          {d.history.length > 0 && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Billed on this lot</h2></div>
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Invoice</th><th>Date</th><th>Pack</th><th>Stage</th><th>Work</th><th className="num">%</th><th className="num">Amount</th><th>Notes</th></tr></thead>
                <tbody>{d.history.map((h, i) => <tr key={i}><td><Link to={`/ar/invoices/${h.BillID}`}>{h.BillID}</Link></td><td>{fmtDate(h.Date)}</td><td className="wrap">{h.PackName}</td><td>{h.ScheduleStage}</td><td>{h.WorkType}</td><td className="num">{pct(h.BillPercent)}</td><td className="num">{h.ItemTotal}</td><td className="wrap">{h.Notes}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}
        </>
      )}
      {askRemove && <ConfirmDialog title="Remove lot" confirmLabel="Remove lot" danger onCancel={() => setAskRemove(false)} onConfirm={removeQueued}><p>Remove this lot from the billing that is waiting to post?</p></ConfirmDialog>}
    </div>
  )
}
