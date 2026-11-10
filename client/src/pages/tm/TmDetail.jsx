// The T&M PO form (Access TmPO): header, packs with material/labor lines, live totals, process & schedule, duplicate, pay.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, Copy, FileText, ListChecks, Pencil, Plus, Printer, RefreshCw, Save, Send, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { JobLotPicker, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { TmTabs, lotLabel, money, qty, statusOf, useTmLookups } from './shared'

const pct = (v) => `${(Number(v || 0) * 100).toFixed(2).replace(/\.?0+$/, '')}%`

export default function TmDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useTmLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [dup, setDup] = useState(null) // { lot selection, process }
  const [newPack, setNewPack] = useState({ TmPackName: '', Price: '' })
  const [editPack, setEditPack] = useState(null)
  const [editLine, setEditLine] = useState(null)
  const [addItem, setAddItem] = useState({}) // packId -> { item, qty }

  const load = useCallback(async () => {
    const r = await api(`/tm/${id}`)
    setD(r)
    const t = r.tm
    setForm({
      TmName: t.TmName ?? '', TmCustomerNum: t.TmCustomerNum ?? '', TmDate: toInputDate(t.TmDate), TmTypeId: t.TmTypeId ?? '', WorkId: t.WorkId ?? '', PriceLevel: t.PriceLevel ?? 3,
      RequestedBy: t.RequestedBy ?? '', RequestorPhone: t.RequestorPhone ?? '', RequestorEmail: t.RequestorEmail ?? '', LaborRate: t.LaborRate ?? 150, LaborRateFlat: t.LaborRateFlat ?? 0,
      Discount: t.Discount ?? 0, TaxRate: t.TaxRate ?? 0, CreditCardFee: t.CreditCardFee ?? 0, Budget: !!t.Budget, PaidDate: toInputDate(t.PaidDate), TmNotes: t.TmNotes ?? '',
    })
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  const t = d?.tm
  const processed = !!t?.ApprovedDate
  const lotClosed = !!t?.LotEndDate
  const locked = lotClosed // lot closed blocks every edit (Access BeforeUpdate)

  const saveHeader = wrap(async (e) => {
    e?.preventDefault()
    const body = { ...form }
    for (const k of ['TmTypeId', 'WorkId', 'PriceLevel']) body[k] = body[k] === '' ? null : Number(body[k])
    await api(`/tm/${id}`, { method: 'PUT', body })
  }, 'T&M saved')

  const addPack = wrap(async (e) => { e.preventDefault(); await api(`/tm/${id}/packs`, { method: 'POST', body: newPack }); setNewPack({ TmPackName: '', Price: '' }) })
  const savePack = wrap(async () => { await api(`/tm/packs/${editPack.id}`, { method: 'PUT', body: { TmPackName: editPack.TmPackName, Price: editPack.Price, Notes: editPack.Notes } }); setEditPack(null) })
  const delPack = wrap(async (pid) => { if (confirm('Remove this pack and its lines?')) await api(`/tm/packs/${pid}`, { method: 'DELETE' }) })
  const addLine = wrap(async (packId) => {
    const a = addItem[packId]
    await api(`/tm/packs/${packId}/materials`, { method: 'POST', body: { InvItemId: a.item.id, Quantity: a.qty || 1 } })
    setAddItem((s) => ({ ...s, [packId]: {} }))
  })
  const saveLine = wrap(async () => {
    const body = { Quantity: editLine.Quantity, Notes: editLine.Notes }
    if (editLine.priceChanged) { body.CostEa = editLine.CostEa; if (editLine.wmuChanged) body.CostEaWMU = editLine.CostEaWMU }
    else if (editLine.wmuChanged) body.CostEaWMU = editLine.CostEaWMU
    await api(`/tm/materials/${editLine.id}`, { method: 'PUT', body }); setEditLine(null)
  })
  const delLine = wrap(async (mid) => { if (confirm('Remove this line?')) await api(`/tm/materials/${mid}`, { method: 'DELETE' }) })
  const resetLine = wrap(async (mid) => { await api(`/tm/materials/${mid}`, { method: 'PUT', body: { ManualCost: false } }) }, 'Line reset to catalogue price')
  const applySuggested = wrap(async (pid) => { const r = await api(`/tm/packs/${pid}/suggested-price`); await api(`/tm/packs/${pid}`, { method: 'PUT', body: { Price: r.price } }) }, 'Pack price set from its lines')
  const updatePrices = wrap(async () => { const r = await api(`/tm/${id}/update-prices`, { method: 'POST' }); setMsg(`Updated ${r.updated} line(s) from the catalogue; labor hours now ${r.laborHours}.`) })

  async function process() {
    if (!confirm('Process & schedule this T&M?\n\nThis creates a "PO" pack in Plan management, schedules it on the lot and approves the T&M. Prices can no longer change afterwards.')) return
    setBusy('process'); setError(''); setMsg('')
    try { const r = await api(`/tm/${id}/process`, { method: 'POST' }); setMsg(`Processed. Pack "${r.packName}" was added to the lot (${r.contractVal}).`); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  async function duplicate() {
    setBusy('dup'); setError('')
    try { const r = await api(`/tm/${id}/duplicate`, { method: 'POST', body: { lotId: dup.LotId, process: dup.process } }); setDup(null); nav(`/tm/${r.id}`) } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  async function remove() {
    if (!confirm(`Delete T&M ${id}?`)) return
    try { await api(`/tm/${id}`, { method: 'DELETE' }); nav('/tm') } catch (e) { setError(e.message) }
  }
  const markPaid = wrap(async (paid) => { await api(`/tm/${id}`, { method: 'PUT', body: { PaidDate: paid ? new Date().toISOString().slice(0, 10) : null } }) }, 'Payment updated')

  const st = t ? statusOf(t) : null
  const pricesLocked = processed

  return (
    <div className="page">
      <PageHeader crumb={<><Link to="/tm">Time & material</Link></>} track={!!t}
        title={t ? `T&M ${t.TmID} · ${t.TmName}` : 'T&M'}
        subtitle={t ? [t.TmType, t.CustName, t.JobName, `Lot ${lotLabel(t)}`, t.SuperName && `Super ${t.SuperName}`].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/tm"><ArrowLeft size={15} /> Orders</Link>
          {t && <Link className="btn" to={`/tm/${id}/print`}><Printer size={15} /> Print PO</Link>}
          {t && <Link className="btn" to={`/tm/${id}/pick`}><ListChecks size={15} /> Pick ticket</Link>}
          {t && <button className="btn" onClick={() => setDup({ process: true })}><Copy size={15} /> Duplicate</button>}
        </>} />
      <TmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          {lotClosed && <div className="banner"><AlertTriangle size={16} /> This lot is closed — open the lot in Scheduling before editing this T&M.</div>}
          {processed && !lotClosed && <div className="banner"><AlertTriangle size={16} /> Processed on {fmtDate(t.ApprovedDate)} by {t.ApprovedBy}. Changes to packs or lines stay in T&M and do <b>not</b> transfer to Plan management. Prices are locked.</div>}

          {dup && (
            <section className="card form">
              <fieldset>
                <legend>Duplicate T&M {id} to another lot</legend>
                <JobLotPicker value={dup} onChange={(v) => setDup({ ...v, process: dup.process })} showPack={false} />
                <label className="check span3"><input type="checkbox" checked={dup.process} onChange={(e) => setDup({ ...dup, process: e.target.checked })} /> Process &amp; schedule the copy immediately (as Access does)</label>
              </fieldset>
              <div className="row form-actions">
                <button className="btn primary" disabled={!dup.LotId || busy === 'dup'} onClick={duplicate}><Copy size={15} /> {busy === 'dup' ? 'Copying…' : 'Create copy'}</button>
                <button className="btn ghost" onClick={() => setDup(null)}>Cancel</button>
              </div>
            </section>
          )}

          <div className="dash-grid">
            <form className="card form span-2" onSubmit={saveHeader}>
              <fieldset>
                <legend>T&M <Badge tone={st.tone}>{st.label}</Badge></legend>
                <label className="span2">Name *<input required maxLength={60} disabled={locked} {...f('TmName')} /></label>
                <label>Customer PO #<input maxLength={50} disabled={locked} {...f('TmCustomerNum')} /></label>
                <label>Date<input type="date" disabled={locked} {...f('TmDate')} /></label>
                <label>Type<select disabled={locked} {...f('TmTypeId')}>{lk.tmTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Work type<select disabled={locked} {...f('WorkId')}><option value="" />{lk.workTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label className="check"><input type="checkbox" disabled={locked} checked={!!form.Budget} onChange={f('Budget').onChange} /> Budget / quote only</label>
                <label>Requested by<input maxLength={50} disabled={locked} {...f('RequestedBy')} /></label>
                <label>Phone<input maxLength={50} disabled={locked} {...f('RequestorPhone')} /></label>
                <label>Email<input maxLength={50} disabled={locked} {...f('RequestorEmail')} /></label>
              </fieldset>
              <fieldset>
                <legend>Pricing</legend>
                <label>Price level<select disabled={locked || pricesLocked} {...f('PriceLevel')}>{lk.priceLevels.map((x) => <option key={x.id} value={x.id}>{x.name} (×{(1 + Number(x.MarkUpValue)).toFixed(2)})</option>)}</select></label>
                <label>Labor rate / hr<input inputMode="decimal" disabled={locked || pricesLocked} {...f('LaborRate')} /></label>
                <label>Flat labor<input inputMode="decimal" disabled={locked || pricesLocked} {...f('LaborRateFlat')} title="When above 0 it replaces the hourly labor lines" /></label>
                <label>Discount (0.10 = 10%)<input inputMode="decimal" disabled={locked || pricesLocked} {...f('Discount')} /></label>
                <label>Sales tax rate<input inputMode="decimal" disabled={locked || pricesLocked} {...f('TaxRate')} /></label>
                <label>Card fee rate<input inputMode="decimal" disabled={locked} {...f('CreditCardFee')} /></label>
                <label className="span3">Notes<textarea rows={2} maxLength={255} disabled={locked} {...f('TmNotes')} /></label>
              </fieldset>
              <div className="row form-actions">
                <button className="btn primary" disabled={locked}><Save size={15} /> Save</button>
                {!processed && <button type="button" className="btn danger" onClick={remove} disabled={locked}><Trash2 size={15} /> Delete</button>}
                <span className="muted small">Entered {fmtDate(t.DateEntered)} by {t.UserEntered || '—'} · prepared by {t.PreparedBy}</span>
              </div>
            </form>

            <aside className="panel totals-panel">
              <div className="panel-head"><h2><Calculator size={16} /> Totals</h2></div>
              <dl className="totals">
                <div><dt>Subtotal</dt><dd>{money(t.Subtotal)}</dd></div>
                <div><dt>Discount {Number(t.Discount) ? `(${pct(t.Discount)})` : ''}</dt><dd>{money(t.DiscountAmt)}</dd></div>
                <div><dt>Taxable amount</dt><dd>{money(t.Taxable)}</dd></div>
                <div><dt>Sales tax ({pct(t.TaxRate)})</dt><dd>{money(t.SalesTax)}</dd></div>
                <div className="grand"><dt>Total</dt><dd>{money(t.Total)}</dd></div>
                <div><dt>Card fee ({pct(t.CreditCardFee)})</dt><dd>{money(t.CardFee)}</dd></div>
                <div><dt>Total paying by card</dt><dd>{money(t.TotalWithCard)}</dd></div>
              </dl>
              <div className="totals-sub">
                <div><span>Materials (sell)</span><b>{money(t.MatWMU)}</b></div>
                <div><span>Materials (cost)</span><b>{money(t.MatCost)}</b></div>
                <div><span>Labor (sell)</span><b>{money(t.LaborWMU)}</b></div>
                <div><span>Labor hours</span><b>{qty(t.LaborHours)}</b></div>
              </div>
              <div className="stack">
                {!processed && <button className="btn" onClick={updatePrices} disabled={locked}><RefreshCw size={15} /> Update cost &amp; labor hours</button>}
                {!processed && <button className="btn primary" onClick={process} disabled={locked || busy === 'process'}><Send size={15} /> {busy === 'process' ? 'Processing…' : 'Process & schedule'}</button>}
                {processed && !t.PaidDate && <button className="btn primary" onClick={() => markPaid(true)}><CheckCircle2 size={15} /> Mark paid today</button>}
                {t.PaidDate && <button className="btn" onClick={() => markPaid(false)}>Clear payment ({fmtDate(t.PaidDate)})</button>}
                {d.pmPack && <p className="muted small" style={{ margin: 0 }}>Plan management pack: {d.pmPack.PackName} ({d.pmPack.ContractVal})</p>}
              </div>
            </aside>
          </div>

          {/* Packs */}
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2><FileText size={16} /> Packs, materials and labor</h2><span className="muted small">{d.packs.length} pack(s)</span></div>
            {!d.packs.length && <EmptyState title="No packs yet">Add a pack (one job description with a price), then add its material and labor lines.</EmptyState>}
            {d.packs.map((p) => {
              const lineSum = p.materials.reduce((a, m) => a + Number(m.ExtPrice || 0), 0)
              const diff = Math.abs(lineSum - Number(p.Price || 0)) > 0.005
              return (
                <div key={p.TmPackID} className="tm-pack">
                  <div className="tm-pack-head">
                    {editPack?.id === p.TmPackID ? (
                      <div className="row" style={{ flex: 1 }}>
                        <input value={editPack.TmPackName} onChange={(e) => setEditPack({ ...editPack, TmPackName: e.target.value })} style={{ maxWidth: 320 }} aria-label="Pack name" />
                        <input value={editPack.Price} onChange={(e) => setEditPack({ ...editPack, Price: e.target.value })} className="pct-input" style={{ width: 110 }} inputMode="decimal" aria-label="Pack price" />
                        <input value={editPack.Notes ?? ''} onChange={(e) => setEditPack({ ...editPack, Notes: e.target.value })} placeholder="Notes" style={{ maxWidth: 260 }} aria-label="Pack notes" />
                        <button className="btn small primary" onClick={savePack} aria-label="Save pack"><Save size={13} /></button>
                        <button className="btn small ghost" onClick={() => setEditPack(null)} aria-label="Cancel"><X size={13} /></button>
                      </div>
                    ) : (
                      <>
                        <div><b>{p.TmPackName}</b>{p.Notes ? <span className="muted small"> — {p.Notes}</span> : null}</div>
                        <div className="row">
                          <span>Price <b>{money(p.Price)}</b></span>
                          {diff && !locked && <button className="btn small" onClick={() => applySuggested(p.TmPackID)} title="Set the pack price to the sum of its lines">Lines total {money(lineSum)} · use</button>}
                          <button className="btn small ghost" onClick={() => setEditPack({ id: p.TmPackID, TmPackName: p.TmPackName, Price: p.Price, Notes: p.Notes })} disabled={locked} aria-label="Edit pack"><Pencil size={13} /></button>
                          {!processed && <button className="btn small ghost danger" onClick={() => delPack(p.TmPackID)} disabled={locked} aria-label="Remove pack"><Trash2 size={13} /></button>}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="table-wrap flat">
                    <table className="grid compact">
                      <thead><tr><th>Item</th><th>Description</th><th>Code</th><th className="num">Qty</th><th className="num">Cost ea</th><th className="num">Price ea</th><th className="num">Ext price</th><th /></tr></thead>
                      <tbody>
                        {p.materials.map((m) => editLine?.id === m.TmMaterialID ? (
                          <tr key={m.TmMaterialID} className="row-selected">
                            <td>{m.InvItem}</td><td className="wrap">{m.Description}</td><td>{m.CostCode}</td>
                            <td className="num"><input className="pct-input" value={editLine.Quantity} onChange={(e) => setEditLine({ ...editLine, Quantity: e.target.value })} inputMode="decimal" aria-label="Quantity" /></td>
                            <td className="num"><input className="pct-input" value={editLine.CostEa} disabled={pricesLocked} onChange={(e) => setEditLine({ ...editLine, CostEa: e.target.value, priceChanged: true })} inputMode="decimal" aria-label="Cost each" /></td>
                            <td className="num"><input className="pct-input" value={editLine.CostEaWMU} disabled={pricesLocked} onChange={(e) => setEditLine({ ...editLine, CostEaWMU: e.target.value, wmuChanged: true })} inputMode="decimal" aria-label="Price each" /></td>
                            <td colSpan={1} /><td className="actions"><button className="btn small primary" onClick={saveLine} aria-label="Save line"><Save size={13} /></button><button className="btn small ghost" onClick={() => setEditLine(null)} aria-label="Cancel"><X size={13} /></button></td>
                          </tr>
                        ) : (
                          <tr key={m.TmMaterialID}>
                            <td><b>{m.InvItem}</b></td><td className="wrap">{m.Description}{m.Notes ? <span className="muted small"> · {m.Notes}</span> : null}</td><td>{m.CostCode}</td>
                            <td className="num">{qty(m.Quantity)}</td><td className="num">{money(m.CostEa)}</td>
                            <td className="num">{money(m.CostEaWMU)} {m.ManualCost ? <Badge tone="amber">manual</Badge> : null}</td><td className="num"><b>{money(m.ExtPrice)}</b></td>
                            <td className="actions">
                              {m.ManualCost && !pricesLocked && !locked && <button className="btn small ghost" onClick={() => resetLine(m.TmMaterialID)} title="Back to catalogue price" aria-label="Reset price"><RefreshCw size={13} /></button>}
                              <button className="btn small ghost" onClick={() => setEditLine({ id: m.TmMaterialID, Quantity: m.Quantity, CostEa: m.CostEa, CostEaWMU: m.CostEaWMU, Notes: m.Notes })} disabled={locked} aria-label="Edit line"><Pencil size={13} /></button>
                              {!processed && <button className="btn small ghost danger" onClick={() => delLine(m.TmMaterialID)} disabled={locked} aria-label="Remove line"><Trash2 size={13} /></button>}
                            </td>
                          </tr>
                        ))}
                        {!locked && (
                          <tr className="new-row">
                            <td colSpan={3}>
                              <SearchSelect endpoint="/common/items" value={addItem[p.TmPackID]?.item?.id} label={addItem[p.TmPackID]?.item?.name} placeholder="Add an item or labor code…"
                                onSelect={(r) => setAddItem((s) => ({ ...s, [p.TmPackID]: { ...s[p.TmPackID], item: r } }))} />
                            </td>
                            <td className="num"><input className="pct-input" placeholder="1" value={addItem[p.TmPackID]?.qty ?? ''} onChange={(e) => setAddItem((s) => ({ ...s, [p.TmPackID]: { ...s[p.TmPackID], qty: e.target.value } }))} inputMode="decimal" aria-label="Quantity to add" /></td>
                            <td colSpan={3} /><td className="actions"><button className="btn small primary" disabled={!addItem[p.TmPackID]?.item} onClick={() => addLine(p.TmPackID)}><Plus size={13} /> Add</button></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            {!locked && (
              <form className="row new-pack" onSubmit={addPack}>
                <input required placeholder="New pack name (e.g. Replace speaker)" value={newPack.TmPackName} onChange={(e) => setNewPack({ ...newPack, TmPackName: e.target.value })} style={{ maxWidth: 340 }} aria-label="New pack name" />
                <input placeholder="Price" value={newPack.Price} onChange={(e) => setNewPack({ ...newPack, Price: e.target.value })} className="pct-input" style={{ width: 110 }} inputMode="decimal" aria-label="New pack price" />
                <button className="btn"><Plus size={15} /> Add pack</button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  )
}
