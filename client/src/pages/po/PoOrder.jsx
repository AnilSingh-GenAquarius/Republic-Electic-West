// The purchase order form (Access PurchaseOrder + PoReceive + PoBilling): header, lines, totals, post, receive, bill, close, print.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, Lock, LockOpen, PackageCheck, Pencil, Plus, Printer, Receipt, Save, Send, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PoTabs, int, money, usePoLookups } from './shared'

const today = () => new Date().toISOString().slice(0, 10)

export function PoOrderNew() {
  const nav = useNavigate()
  const lk = usePoLookups()
  const [vendor, setVendor] = useState(null)
  const [f, setF] = useState({ ShipToId: '2', BillToId: '2', PoDate: today(), PayTerms: '', Notes: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function create(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api('/po/orders', { method: 'POST', body: { ...f, VendorId: vendor.id } }); nav(`/po/orders/${r.id}`) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/po/orders">Purchase orders</Link>} title="New purchase order" subtitle="Choose the vendor, then add items on the next screen" />
      <PoTabs />
      <form className="card form" onSubmit={create}>
        <fieldset>
          <label className="span2">Vendor *<SearchSelect endpoint="/common/vendors" value={vendor?.id} label={vendor?.name} placeholder="Search vendor…" onSelect={setVendor} /></label>
          <label>PO date<input type="date" value={f.PoDate} onChange={(e) => setF({ ...f, PoDate: e.target.value })} /></label>
          <label>Ship to<select value={f.ShipToId} onChange={(e) => setF({ ...f, ShipToId: e.target.value })}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Bill to<select value={f.BillToId} onChange={(e) => setF({ ...f, BillToId: e.target.value })}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Payment terms<select value={f.PayTerms} onChange={(e) => setF({ ...f, PayTerms: e.target.value })}><option value="">Vendor default</option>{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="span3">Notes<textarea rows={2} maxLength={255} value={f.Notes} onChange={(e) => setF({ ...f, Notes: e.target.value })} /></label>
        </fieldset>
        {error && <ErrorState message={error} />}
        <div className="row form-actions"><button className="btn primary" disabled={!vendor || busy}><Plus size={15} /> {busy ? 'Creating…' : 'Create purchase order'}</button></div>
      </form>
    </div>
  )
}

export function PoOrder() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = usePoLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [add, setAdd] = useState({ item: null, Quantity: '', Cost: '' })
  const [edit, setEdit] = useState(null)
  const [recv, setRecv] = useState({})   // lineId -> qty to receive
  const [bill, setBill] = useState({})

  const load = useCallback(async () => {
    const r = await api(`/po/orders/${id}`)
    setD(r)
    const p = r.po
    setForm({ PayTerms: p.PayTerms ?? '', PoDate: toInputDate(p.PoDate), ShipToId: p.ShipToId ?? '', BillToId: p.BillToId ?? '', PoTaxRate: p.PoTaxRate ?? 0, PoShipping: String(p.Shipping ?? 0), Notes: p.Notes ?? '' })
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const po = d?.po
  const closed = !!po?.DateClosed

  const saveHeader = wrap(async (e) => { e?.preventDefault(); await api(`/po/orders/${id}`, { method: 'PUT', body: form }) }, 'Purchase order saved')
  const addLine = wrap(async (e) => { e.preventDefault(); await api(`/po/orders/${id}/lines`, { method: 'POST', body: { InvItemId: add.item.id, Quantity: add.Quantity, Cost: add.Cost } }); setAdd({ item: null, Quantity: '', Cost: '' }) })
  const saveLine = wrap(async () => { await api(`/po/lines/${edit.id}`, { method: 'PUT', body: { Quantity: edit.Quantity, Cost: edit.Cost, Notes: edit.Notes } }); setEdit(null) })
  const delLine = wrap(async (lid) => { if (confirm('Remove this line?')) await api(`/po/lines/${lid}`, { method: 'DELETE' }) })
  const receive = wrap(async (l) => {
    const r = await api(`/po/lines/${l.PoItemID}/receive`, { method: 'POST', body: { ReceivedQty: recv[l.PoItemID], ReceivedDate: today() } })
    setRecv((s) => ({ ...s, [l.PoItemID]: '' })); if (r.overage) setMsg(`${l.InvItem}: ${r.overage} more than ordered was received (overage).`)
  })
  const receiveAll = wrap(async () => { if (!confirm('Receive the balance of every line today?')) return; const r = await api(`/po/orders/${id}/receive-all`, { method: 'POST', body: {} }); setMsg(`${r.received} line(s) received.`) })
  const billLine = wrap(async (l) => { await api(`/po/lines/${l.PoItemID}/bill`, { method: 'POST', body: { BilledQty: bill[l.PoItemID], BilledDate: today() } }); setBill((s) => ({ ...s, [l.PoItemID]: '' })) })
  const billAll = wrap(async () => { if (!confirm('Mark everything received as billed today?')) return; const r = await api(`/po/orders/${id}/bill-received`, { method: 'POST', body: {} }); setMsg(`${r.billed} line(s) billed.`) })
  const delRec = wrap(async (rid) => { if (confirm('Delete this receipt?')) await api(`/po/receipts/${rid}`, { method: 'DELETE' }) })
  const delBill = wrap(async (bid) => { if (confirm('Delete this billing entry?')) await api(`/po/bills/${bid}`, { method: 'DELETE' }) })
  const setClosed = wrap(async (close) => { await api(`/po/orders/${id}/${close ? 'close' : 'reopen'}`, { method: 'POST' }) }, undefined)
  async function post() {
    if (!confirm('Post this purchase order?\n\nZero costs are filled from last/average cost, item last cost and average cost are updated, tax is calculated and selling prices are recalculated.')) return
    setBusy('post'); setError(''); setMsg('')
    try { const r = await api(`/po/orders/${id}/post`, { method: 'POST' }); setMsg(`Posted. Costs and prices updated on ${r.itemsRepriced} item(s); tax ${r.po.PoTax}.`); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  async function remove() { if (!confirm(`Delete purchase order ${id}?`)) return; try { await api(`/po/orders/${id}`, { method: 'DELETE' }); nav('/po/orders') } catch (e) { setError(e.message) } }

  const allReceived = d && d.lines.length > 0 && d.lines.every((l) => l.Received >= l.Quantity)
  const allBilled = d && d.lines.length > 0 && d.lines.every((l) => l.Billed >= l.Received && l.Received > 0)

  return (
    <div className="page">
      <PageHeader crumb={<Link to="/po/orders">Purchase orders</Link>} title={po ? `PO ${po.PoNum} · ${po.Vendor}` : 'Purchase order'} track={!!po}
        subtitle={po ? [fmtDate(po.PoDate), po.ShipTo && `Ship to ${po.ShipTo}`, po.PoPackNum && `from pack PO ${po.PoPackNum}`].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/po/orders"><ArrowLeft size={15} /> Orders</Link>
          {po && <Link className="btn" to={`/po/orders/${id}/print`}><Printer size={15} /> Print</Link>}
          {po && (closed ? <button className="btn" onClick={() => setClosed(false)}><LockOpen size={15} /> Reopen</button> : <button className="btn" onClick={() => setClosed(true)}><Lock size={15} /> Close PO</button>)}
        </>} />
      <PoTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          {closed && <div className="banner"><Lock size={16} /> Closed on {fmtDate(po.DateClosed)}. Reopen the PO to change lines or the header.</div>}
          {!closed && allReceived && allBilled && <div className="banner"><CheckCircle2 size={16} /> Everything is received and billed. <button className="btn small" onClick={() => setClosed(true)}>Close PO</button></div>}
          <div className="dash-grid">
            <form className="card form span-2" onSubmit={saveHeader}>
              <fieldset>
                <legend>Order <Badge tone={closed ? 'neutral' : 'amber'}>{closed ? 'Closed' : 'Open'}</Badge></legend>
                <label>PO date<input type="date" disabled={closed} {...f('PoDate')} /></label>
                <label>Ship to<select disabled={closed} {...f('ShipToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>Bill to<select disabled={closed} {...f('BillToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>Payment terms<select disabled={closed} {...f('PayTerms')}><option value="" />{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <label>Tax rate % (0 = ship-to rate {po.TaxRate}%)<input inputMode="decimal" disabled={closed} {...f('PoTaxRate')} /></label>
                <label>Shipping $<input inputMode="decimal" disabled={closed} {...f('PoShipping')} /></label>
                <label className="span3">Notes<textarea rows={2} maxLength={255} disabled={closed} {...f('Notes')} /></label>
              </fieldset>
              <div className="row form-actions">
                <button className="btn primary" disabled={closed}><Save size={15} /> Save</button>
                {!closed && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
                <span className="muted small">Vendor {po.Vendor}{po.VendorPhone ? ` · ${po.VendorPhone}` : ''}{Number(po.FreeShipping) ? ` · free shipping over $${po.FreeShipping}` : ''} · entered {fmtDate(po.DateEntered)} by {po.UserEntered || '—'}</span>
              </div>
            </form>
            <aside className="panel totals-panel">
              <div className="panel-head"><h2><Calculator size={16} /> Totals</h2></div>
              <dl className="totals">
                <div><dt>Items</dt><dd>{money(po.ExtCost)}</dd></div>
                <div><dt>Taxable items</dt><dd>{money(po.Taxable)}</dd></div>
                <div><dt>Sales tax ({po.TaxRate}%)</dt><dd>{money(po.TaxAmt)}</dd></div>
                <div><dt>Shipping</dt><dd>{money(po.Shipping)}</dd></div>
                <div className="grand"><dt>Total</dt><dd>{money(po.Total)}</dd></div>
              </dl>
              <div className="stack" style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={post} disabled={closed || busy === 'post' || !d.lines.length}><Send size={15} /> {busy === 'post' ? 'Posting…' : 'Post purchase order'}</button>
                <button className="btn" onClick={receiveAll} disabled={closed || !d.lines.length}><PackageCheck size={15} /> Receive all balances</button>
                <button className="btn" onClick={billAll} disabled={!d.lines.length}><Receipt size={15} /> Bill everything received</button>
                <p className="muted small" style={{ margin: 0 }}>Posting updates item cost and prices; received quantities reach stock when Inventory runs “Update on-hand &amp; on-order”.</p>
              </div>
            </aside>
          </div>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Lines ({d.lines.length})</h2></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Item</th><th>Description</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Vendor price</th><th className="num">Ext cost</th><th className="num">Received</th><th>Receive</th><th className="num">Billed</th><th>Bill</th><th /></tr></thead>
                <tbody>
                  {d.lines.map((l) => edit?.id === l.PoItemID ? (
                    <tr key={l.PoItemID} className="row-selected">
                      <td><b>{l.InvItem}</b></td><td className="wrap">{l.Description}</td>
                      <td className="num"><input className="pct-input" value={edit.Quantity} onChange={(e) => setEdit({ ...edit, Quantity: e.target.value })} inputMode="numeric" aria-label="Quantity" /></td>
                      <td className="num"><input className="pct-input" value={edit.Cost} onChange={(e) => setEdit({ ...edit, Cost: e.target.value })} inputMode="decimal" aria-label="Cost" /></td>
                      <td colSpan={6} /><td className="actions"><button className="btn small primary" onClick={saveLine} aria-label="Save line"><Save size={13} /></button><button className="btn small ghost" onClick={() => setEdit(null)} aria-label="Cancel"><X size={13} /></button></td>
                    </tr>
                  ) : (
                    <tr key={l.PoItemID}>
                      <td><Link to={`/ic/items/${l.InvItemId}`}><b>{l.InvItem}</b></Link>{l.CostCodeId === 'NT' ? <Badge>no tax</Badge> : null}</td><td className="wrap">{l.Description}{l.Notes ? <span className="muted small"> · {l.Notes}</span> : null}</td>
                      <td className="num">{int(l.Quantity)}</td>
                      <td className="num">{Number(l.Cost) ? money(l.Cost, 4) : <span className="muted" title="Zero cost uses the average cost until posted">avg {money(l.AverageCost, 4)}</span>}</td>
                      <td className="num">{l.VendorPrice ? <span className={Number(l.VendorPrice) < Number(l.Cost) ? 'text-danger' : ''}>{money(l.VendorPrice, 4)}</span> : <span className="faint">—</span>}</td>
                      <td className="num"><b>{money(l.ExtCost)}</b></td>
                      <td className="num">{l.Received >= l.Quantity ? <Badge tone={l.Received > l.Quantity ? 'red' : 'green'}>{int(l.Received)}</Badge> : l.Received ? <Badge tone="amber">{int(l.Received)}</Badge> : <span className="faint">0</span>}</td>
                      <td><span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><input className="pct-input" style={{ width: 64 }} placeholder={String(Math.max(0, l.Quantity - l.Received))} value={recv[l.PoItemID] ?? ''} onChange={(e) => setRecv((s) => ({ ...s, [l.PoItemID]: e.target.value }))} inputMode="numeric" aria-label={`Receive ${l.InvItem}`} /><button className="btn small" disabled={!recv[l.PoItemID]} onClick={() => receive(l)} aria-label={`Receive ${l.InvItem}`}>Rec</button></span></td>
                      <td className="num">{l.Billed >= l.Received && l.Received > 0 ? <Badge tone="green">{int(l.Billed)}</Badge> : l.Billed ? <Badge tone="amber">{int(l.Billed)}</Badge> : <span className="faint">0</span>}</td>
                      <td><span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><input className="pct-input" style={{ width: 64 }} placeholder={String(Math.max(0, l.Received - l.Billed))} value={bill[l.PoItemID] ?? ''} onChange={(e) => setBill((s) => ({ ...s, [l.PoItemID]: e.target.value }))} inputMode="numeric" aria-label={`Bill ${l.InvItem}`} /><button className="btn small" disabled={!bill[l.PoItemID]} onClick={() => billLine(l)} aria-label={`Bill ${l.InvItem}`}>Bill</button></span></td>
                      <td className="actions">
                        <button className="btn small ghost" onClick={() => setEdit({ id: l.PoItemID, Quantity: l.Quantity, Cost: l.Cost, Notes: l.Notes })} disabled={closed} aria-label="Edit line"><Pencil size={13} /></button>
                        {!l.Received && !l.Billed && <button className="btn small ghost danger" onClick={() => delLine(l.PoItemID)} disabled={closed} aria-label="Remove line"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                  {!closed && (
                    <tr className="new-row">
                      <td colSpan={2}><SearchSelect endpoint="/common/items" value={add.item?.id} label={add.item?.name} placeholder="Add an item…" onSelect={(r) => setAdd((s) => ({ ...s, item: r, Cost: r?.LastCost ?? '' }))} /></td>
                      <td className="num"><input className="pct-input" placeholder="Qty" value={add.Quantity} onChange={(e) => setAdd((s) => ({ ...s, Quantity: e.target.value }))} inputMode="numeric" aria-label="Quantity to add" /></td>
                      <td className="num"><input className="pct-input" placeholder="auto" value={add.Cost} onChange={(e) => setAdd((s) => ({ ...s, Cost: e.target.value }))} inputMode="decimal" aria-label="Cost to add" /></td>
                      <td colSpan={6} /><td className="actions"><button className="btn small primary" disabled={!add.item || !add.Quantity} onClick={addLine}><Plus size={13} /> Add</button></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!d.lines.length && <EmptyState icon={AlertTriangle} title="No items yet">Search for an item above. Cost defaults to the vendor's price, then last cost.</EmptyState>}
          </section>

          {(d.receipts.length > 0 || d.bills.length > 0) && (
            <div className="dash-grid" style={{ marginTop: 16 }}>
              <section className="panel span-2" style={{ gridColumn: 'span 1' }}>
                <div className="panel-head"><h2>Receipts ({d.receipts.length})</h2></div>
                <table className="grid compact"><thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th>Inventory</th><th /></tr></thead>
                  <tbody>{d.receipts.map((r) => <tr key={r.PoItemRecID}><td>{fmtDate(r.ReceivedDate)}</td><td>{r.InvItem}</td><td className="num">{int(r.ReceivedQty)}</td><td>{r.IcTransacPostedDate ? <Badge tone="green">Posted</Badge> : <Badge tone="amber">Waiting</Badge>}</td>
                    <td className="actions">{!r.IcTransacPostedDate && <button className="btn small ghost danger" onClick={() => delRec(r.PoItemRecID)} aria-label="Delete receipt"><Trash2 size={13} /></button>}</td></tr>)}</tbody></table>
              </section>
              <section className="panel span-2" style={{ gridColumn: 'span 1' }}>
                <div className="panel-head"><h2>Billing ({d.bills.length})</h2></div>
                <table className="grid compact"><thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th /></tr></thead>
                  <tbody>{d.bills.map((b) => <tr key={b.PoItemBillID}><td>{fmtDate(b.BilledDate)}</td><td>{b.InvItem}</td><td className="num">{int(b.BilledQty)}</td><td className="actions"><button className="btn small ghost danger" onClick={() => delBill(b.PoItemBillID)} aria-label="Delete billing"><Trash2 size={13} /></button></td></tr>)}</tbody></table>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function PoPrint() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/po/orders/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const p = d?.po
  return (
    <div className="page print-doc">
      <PageHeader title={p ? `Purchase order ${p.PoNum}` : 'Purchase order'} track={false} actions={<><Link className="btn" to={`/po/orders/${id}`}><ArrowLeft size={15} /> Back</Link><button className="btn primary" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <article className="po-sheet">
          <header className="po-head">
            <div><h2>{p.BillTo || 'Republic Electric West'}</h2><div className="muted small">{[p.BillAddress, p.BillCity, p.BillState, p.BillZip].filter(Boolean).join(', ')}{p.BillPhone ? ` · ${p.BillPhone}` : ''}</div></div>
            <div className="po-title"><b>Purchase order</b><span>No. {p.PoNum}</span><span>{fmtDate(p.PoDate)}</span></div>
          </header>
          <div className="th-grid po-meta">
            <div><span className="muted small">Vendor</span><b>{p.Vendor}</b></div>
            <div><span className="muted small">Ship to</span><b>{p.ShipTo}</b><span className="small">{[p.ShipAddress, p.ShipCity, p.ShipState, p.ShipZip].filter(Boolean).join(', ')}</span></div>
            <div><span className="muted small">Terms</span><b>{p.PayTerms || '—'}</b></div>
            <div><span className="muted small">Entered by</span><b>{p.UserEntered || '—'}</b></div>
          </div>
          {p.Notes && <p><b>Notes:</b> {p.Notes}</p>}
          <table className="grid compact">
            <thead><tr><th>Item</th><th>Description</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.lines.map((l) => <tr key={l.PoItemID}><td>{l.AlternateCode || l.InvItem}</td><td className="wrap">{l.Description}{l.Notes ? ` — ${l.Notes}` : ''}</td><td className="num">{int(l.Quantity)}</td><td className="num">{money(l.EffCost, 4)}</td><td className="num">{money(l.ExtCost)}</td></tr>)}</tbody>
          </table>
          <dl className="totals po-totals">
            <div><dt>Items</dt><dd>{money(p.ExtCost)}</dd></div>
            <div><dt>Sales tax ({p.TaxRate}%)</dt><dd>{money(p.TaxAmt)}</dd></div>
            <div><dt>Shipping</dt><dd>{money(p.Shipping)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(p.Total)}</dd></div>
          </dl>
        </article>
      )}
    </div>
  )
}
