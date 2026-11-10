// Post billing (Access ArPostBilling + ArBillingSnapshot): review the submitted lots, remove lines, clear, post as invoices.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Eraser, Send, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ArTabs, money, pct, today, useArLookups } from './shared'

export default function ArPrebill() {
  const lk = useArLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [d, setD] = useState(null)
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  const load = useCallback(() => api('/ar/prebill', { params: { customerId: p.customerId, division: p.division } }).then(setD).catch((e) => setError(e.message)), [p.customerId, p.division])
  useEffect(() => { setD(null); load() }, [load])
  const run = async (fn) => { setError(''); setMsg(null); try { await fn(); await load() } catch (e) { setError(e.message) } }
  const ready = p.customerId && p.division

  const post = () => run(async () => {
    if (!confirm(`Post ${d.lots.length} lot(s) as invoices dated ${fmtDate(date)} for ${money(d.total)}?`)) return
    setBusy(true)
    try { const r = await api('/ar/post', { method: 'POST', body: { customerId: Number(p.customerId), division: p.division, invoiceDate: date } }); setMsg(r) } finally { setBusy(false) }
  })
  const clear = () => run(async () => { if (confirm('Clear everything submitted for this builder and division? Nothing is invoiced.')) { const r = await api('/ar/prebill/clear', { method: 'POST', body: { customerId: Number(p.customerId), division: p.division } }); setMsg({ cleared: r.cleared }) } })
  const delLot = (id) => run(async () => { if (confirm('Remove this lot from the billing?')) await api(`/ar/prebill/lots/${id}`, { method: 'DELETE' }) })
  const delLine = (id) => run(async () => { if (confirm('Remove this line?')) await api(`/ar/prebill/lines/${id}`, { method: 'DELETE' }) })

  return (
    <div className="page">
      <PageHeader title="Post billing" subtitle="Submitted lots become one invoice per lot with the builder's bill-to address" />
      <ArTabs />
      <div className="card form report-filters"><fieldset>
        <label>Builder *<select aria-label="Builder" value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">All submitted</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Division *<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Invoice date *<input type="date" aria-label="Invoice date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </fieldset>
        <div className="row form-actions">
          <button className="btn primary" disabled={!ready || !d?.lots.length || busy || !date} onClick={post}><Send size={15} /> {busy ? 'Posting…' : 'Post billing'}</button>
          <button className="btn" disabled={!ready || !d?.lots.length} onClick={clear}><Eraser size={15} /> Clear billing snapshot</button>
          {!ready && <span className="muted">Choose a builder and a division to post.</span>}
        </div>
      </div>
      {error && <ErrorState message={error} />}
      {msg?.invoices && (
        <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} />
          Posted {msg.invoices.length} invoice(s) for {money(msg.total)}: {msg.invoices.map((i, n) => <span key={i.billId}>{n ? ', ' : ''}<Link to={`/ar/invoices/${i.billId}`}>#{i.billId}</Link> (lot {i.lot})</span>)}.
          {msg.missingBillTo && ' No bill-to address is set up for this builder/division.'}
        </div>
      )}
      {msg?.cleared != null && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> Cleared {msg.cleared} lot(s).</div>}
      {!d ? <SkeletonRows rows={6} cols={5} /> : (
        <>
          {!ready && d.groups.length > 0 && (
            <section className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head"><h2>Waiting to post</h2></div>
              <table className="grid compact"><thead><tr><th>Builder</th><th>Division</th><th className="num">Lots</th><th>Invoice date</th></tr></thead>
                <tbody>{d.groups.map((g) => <tr key={`${g.CustId}-${g.DivisionId}`} className="link-row" onClick={() => set({ customerId: g.CustId, division: g.DivisionId })}><td><a>{g.Customer}</a></td><td>{g.DivisionId}</td><td className="num">{g.Lots}</td><td>{fmtDate(g.InvDate)}</td></tr>)}</tbody></table>
            </section>
          )}
          {!d.lots.length ? <EmptyState title="Nothing submitted">Use <Link to="/ar/billing">Process billing</Link> to choose what to bill on each lot.</EmptyState> : (
            <>
              <p><b>{d.lots.length}</b> lot(s), total <b>{money(d.total)}</b></p>
              {d.lots.map((l) => (
                <section key={l.PreBillLotID} className="panel" style={{ marginBottom: 12 }}>
                  <div className="panel-head">
                    <h2>{l.JobName} · Lot {l.LotBlock}</h2>
                    <span className="row" style={{ gap: 8 }}>
                      <Badge tone="blue">{lk.billTypes.find((t) => t.id === l.BillTypeId)?.name || 'Invoice'}</Badge><Badge>{l.Terms}</Badge><Badge>{l.Lien}</Badge>
                      <span className="muted">{fmtDate(l.InvDate)} · {l.UserSelect}</span>
                      <Link className="btn small" to={`/ar/billing/lots/${l.LotId}?customerId=${l.CustId}&division=${l.DivisionId}`}>Edit</Link>
                      <button className="btn small" aria-label={`Remove lot ${l.LotBlock}`} onClick={() => delLot(l.PreBillLotID)}><Trash2 size={13} /></button>
                    </span>
                  </div>
                  <div className="table-wrap"><table className="grid compact">
                    <thead><tr><th>Pack</th><th>Stage</th><th>Work</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Bill %</th><th className="num">Amount set</th><th>Notes</th><th className="num">To bill</th><th /></tr></thead>
                    <tbody>{d.lines.filter((x) => x.PreBillLotId === l.PreBillLotID).map((x) => (
                      <tr key={x.PreBillPackID}><td className="wrap">{x.PackName}</td><td>{x.ScheduleStage}</td><td>{x.WorkType}</td><td className="num">{Number(x.Quantity)}</td><td className="num">{money(x.ValueEa)}</td>
                        <td className="num">{Number(x.BillPercent) ? pct(x.BillPercent) : ''}</td><td className="num">{Number(x.BillValue) ? money(x.BillValue) : ''}</td><td className="wrap">{x.Notes}</td><td className="num"><b>{money(x.Amount)}</b></td>
                        <td><button className="btn small icon" aria-label="Remove line" onClick={() => delLine(x.PreBillPackID)}><Trash2 size={13} /></button></td></tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={8}><b>Invoice total</b></td><td className="num"><b>{money(l.Amount)}</b></td><td /></tr></tfoot>
                  </table></div>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
