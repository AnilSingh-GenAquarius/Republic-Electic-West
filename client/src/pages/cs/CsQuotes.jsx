// Quotes (CsQuote -> categories -> assemblies / items) with the Access pricing rules (see server notes).
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Plus, Printer, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, money, num, today, useCsLookups } from './shared'

export function CsQuotes() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const t = setTimeout(() => api('/cs/quotes', { params: { search: q } }).then(setRows).catch((e) => setError(e.message)), 300)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="page">
      <PageHeader title="Quotes" subtitle="Price assemblies, material and labor for a homeowner"
        actions={<Link className="btn primary" to="/cs/quotes/new"><Plus size={15} /> New quote</Link>} />
      <CsTabs />
      <div className="filters"><div className="search-wrap"><input type="search" aria-label="Search quotes" placeholder="Quote #, name, homeowner or address…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {error && <ErrorState message={error} />}
      {!rows ? <SkeletonRows rows={6} cols={5} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Quote</th><th>Date</th><th>Name</th><th>Homeowner</th><th>Property</th><th>Approved</th><th>Paid</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.QuoteID} className="link-row" onClick={() => nav(`/cs/quotes/${r.QuoteID}`)}>
                <td><a><b>{r.QuoteID}</b></a></td><td>{fmtDate(r.QuoteDate)}</td><td className="wrap">{r.QuoteName}</td><td>{r.Homeowner || '—'}</td><td className="wrap">{r.Property || '—'}</td>
                <td>{fmtDate(r.ApprovedDate) || '—'}</td><td>{fmtDate(r.PaidDate) || '—'}</td><td className="num"><b>{money(r.Total)}</b></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><EmptyState title="No quotes yet"><Link to="/cs/quotes/new">Create the first quote</Link></EmptyState></td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

const toPct = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 1e6) / 1e4)) // fraction -> percent text
const fromPct = (v) => (v === '' || v == null ? null : Number(v) / 100)

export function CsQuote() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useCsLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(isNew ? { QuoteName: '', QuoteDate: today(), CsTicketTypeId: '', CustomerId: null, CustomerLabel: '', PropertyId: null, PropertyLabel: '', CustomerReferenceNum: '', LaborHourlyRate: '', LaborRateFlat: '',
    PriceMarkUpPercent: '', DiscountPercent: '', TaxRate: '7.75', CreditCardFee: '', ApprovedDate: '', ApprovedBy: '', PaidDate: '', LeadStatusId: '', Scheduled_TicketId: '', QuoteNotes: '' } : null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [addA, setAddA] = useState({})
  const [addI, setAddI] = useState({})
  const [newCat, setNewCat] = useState('')
  const load = useCallback(async () => {
    if (isNew) return
    const r = await api(`/cs/quotes/${id}`); setD(r)
    const v = r.quote
    setForm({ QuoteName: v.QuoteName || '', QuoteDate: toInputDate(v.QuoteDate), CsTicketTypeId: v.CsTicketTypeId ?? '', CustomerId: v.CustomerId, CustomerLabel: v.Homeowner || '', PropertyId: v.PropertyId, PropertyLabel: v.Property || '',
      CustomerReferenceNum: v.CustomerReferenceNum || '', LaborHourlyRate: v.LaborHourlyRate ?? '', LaborRateFlat: v.LaborRateFlat ?? '', PriceMarkUpPercent: toPct(v.PriceMarkUpPercent), DiscountPercent: toPct(v.DiscountPercent),
      TaxRate: toPct(v.TaxRate), CreditCardFee: v.CreditCardFee ?? '', ApprovedDate: toInputDate(v.ApprovedDate), ApprovedBy: v.ApprovedBy || '', PaidDate: toInputDate(v.PaidDate), LeadStatusId: v.LeadStatusId ?? '',
      Scheduled_TicketId: v.Scheduled_TicketId ?? '', QuoteNotes: v.QuoteNotes || '' })
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const body = () => {
    const { CustomerLabel, PropertyLabel, ...b } = form; void CustomerLabel; void PropertyLabel
    return { ...b, PriceMarkUpPercent: fromPct(b.PriceMarkUpPercent), DiscountPercent: fromPct(b.DiscountPercent), TaxRate: fromPct(b.TaxRate) }
  }
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  async function submit(e) {
    e.preventDefault(); setError(''); setMsg('')
    try {
      if (isNew) { const r = await api('/cs/quotes', { method: 'POST', body: body() }); nav(`/cs/quotes/${r.id}`, { replace: true }) } else { await api(`/cs/quotes/${id}`, { method: 'PUT', body: body() }); setMsg('Quote saved'); await load() }
    } catch (err) { setError(err.message) }
  }
  const addCategory = run(async (e) => { e.preventDefault(); await api(`/cs/quotes/${id}/categories`, { method: 'POST', body: { CategoryName: newCat } }); setNewCat('') })
  const delCategory = run(async (c) => { if (confirm(`Delete category ${c.CategoryName}?`)) await api(`/cs/quote-categories/${c.QuoteCategoryID}`, { method: 'DELETE' }) })
  const addAssembly = run(async (cid) => { const a = addA[cid] || {}; await api(`/cs/quote-categories/${cid}/assemblies`, { method: 'POST', body: { CsAssemblyId: a.CsAssemblyId, Quantity: a.Quantity || 1 } }); setAddA({ ...addA, [cid]: {} }) })
  const setAsm = run(async (qa, patch) => api(`/cs/quote-assemblies/${qa.QuoteAssemblyID}`, { method: 'PUT', body: patch }))
  const delAsm = run(async (qa) => { if (confirm(`Remove ${qa.AssemblyName} and its material?`)) await api(`/cs/quote-assemblies/${qa.QuoteAssemblyID}`, { method: 'DELETE' }) })
  const addItem = run(async (cid) => { const a = addI[cid] || {}; await api(`/cs/quote-categories/${cid}/items`, { method: 'POST', body: { InvItemId: a.InvItemId, Quantity: a.Quantity || 1 } }); setAddI({ ...addI, [cid]: {} }) })
  const setItem = run(async (it, patch) => api(`/cs/quote-items/${it.QuoteItemID}`, { method: 'PUT', body: patch }))
  const delItem = run(async (it) => { if (confirm('Remove this line?')) await api(`/cs/quote-items/${it.QuoteItemID}`, { method: 'DELETE' }) })
  async function remove() { if (!confirm(`Delete quote ${id} with all its lines?`)) return; try { await api(`/cs/quotes/${id}`, { method: 'DELETE' }); nav('/cs/quotes') } catch (e) { setError(e.message) } }
  const [asms, setAsms] = useState([])
  useEffect(() => { if (!isNew) api('/cs/assemblies').then(setAsms).catch(() => {}) }, [isNew])
  const t = d?.totals
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/quotes">Quotes</Link>} title={isNew ? 'New quote' : d ? `Quote ${d.quote.QuoteID} · ${d.quote.QuoteName}` : 'Quote'} track={isNew || !!d}
        subtitle={d ? [fmtDate(d.quote.QuoteDate), d.quote.Homeowner, d.quote.Property].filter(Boolean).join(' · ') : 'Percentages are entered as percent (7.75 = 7.75 %)'}
        actions={<>
          <Link className="btn" to="/cs/quotes"><ArrowLeft size={15} /> Quotes</Link>
          {d && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>}
          {d && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!form ? <SkeletonRows rows={6} cols={3} /> : (
        <form className="card form no-print" onSubmit={submit}>
          <fieldset>
            <label className="span2">Quote name *<input required maxLength={255} {...f('QuoteName')} /></label>
            <label>Quote date *<input type="date" required {...f('QuoteDate')} /></label>
            <label>Homeowner<SearchSelect endpoint="/cs/customers/search" value={form.CustomerId} label={form.CustomerLabel} placeholder="Search…" onSelect={(r) => setForm((s) => ({ ...s, CustomerId: r?.id ?? null, CustomerLabel: r?.name ?? '' }))} /></label>
            <label className="span2">Property<SearchSelect endpoint="/cs/properties/search" value={form.PropertyId} label={form.PropertyLabel} placeholder="Search address…" onSelect={(r) => setForm((s) => ({ ...s, PropertyId: r?.id ?? null, PropertyLabel: r?.name ?? '' }))} /></label>
            <label>Ticket type<select {...f('CsTicketTypeId')}><Options list={lk.ticketTypes} /></select></label>
            <label>Customer ref #<input maxLength={255} {...f('CustomerReferenceNum')} /></label>
            <label>Lead status<select {...f('LeadStatusId')}><Options list={lk.leadStatuses} /></select></label>
          </fieldset>
          <fieldset>
            <legend>Pricing</legend>
            <label>Price level<select value="" onChange={(e) => { const p = lk.priceLevels.find((x) => String(x.id) === e.target.value); if (p) setForm((s) => ({ ...s, PriceMarkUpPercent: toPct(p.MarkUpValue) })) }}><option value="">Set mark up from level…</option>{lk.priceLevels.map((p) => <option key={p.id} value={p.id}>{p.name} ({toPct(p.MarkUpValue)}%)</option>)}</select></label>
            <label>Mark up %<input inputMode="decimal" {...f('PriceMarkUpPercent')} /></label>
            <label>Labor hourly rate<input inputMode="decimal" {...f('LaborHourlyRate')} /></label>
            <label>Flat labor<input inputMode="decimal" {...f('LaborRateFlat')} /></label>
            <label>Discount %<input inputMode="decimal" {...f('DiscountPercent')} /></label>
            <label>Sales tax %<input inputMode="decimal" {...f('TaxRate')} /></label>
            <label>Credit card fee<input inputMode="decimal" {...f('CreditCardFee')} /></label>
          </fieldset>
          <fieldset>
            <legend>Follow up</legend>
            <label>Approved date<input type="date" {...f('ApprovedDate')} /></label>
            <label>Approved by<input maxLength={50} {...f('ApprovedBy')} /></label>
            <label>Paid date<input type="date" {...f('PaidDate')} /></label>
            <label>Scheduled ticket #<input inputMode="numeric" {...f('Scheduled_TicketId')} /></label>
            <label className="span3">Notes<textarea rows={2} {...f('QuoteNotes')} /></label>
          </fieldset>
          <div className="row form-actions"><button className="btn primary"><Save size={15} /> {isNew ? 'Create quote' : 'Save'}</button></div>
        </form>
      )}
      {d && (
        <>
          <h2 className="cs-print-title">Quote {d.quote.QuoteID} · {d.quote.QuoteName} · {fmtDate(d.quote.QuoteDate)}</h2>
          {d.categories.map((c) => {
            const qa = d.assemblies.filter((x) => x.QuoteCategoryId === c.QuoteCategoryID)
            const it = d.items.filter((x) => x.QuoteCategoryId === c.QuoteCategoryID)
            return (
              <section key={c.QuoteCategoryID} className="panel" style={{ marginTop: 16 }}>
                <div className="panel-head"><h2>{c.CategoryName}</h2>{d.categories.length > 1 && <button className="btn small icon no-print" aria-label="Delete category" onClick={() => delCategory(c)}><Trash2 size={13} /></button>}</div>
                <div className="table-wrap flat"><table className="grid compact">
                  <thead><tr><th>Assembly / item</th><th>CC</th><th className="num">Qty</th><th className="num">Cost ea</th><th className="num">Price ea</th><th className="num">Ext price</th><th className="no-print" /></tr></thead>
                  <tbody>
                    {qa.map((a) => (
                      <Fragment key={a.QuoteAssemblyID}>
                        <tr>
                          <td className="wrap"><b>{a.AssemblyName}</b>{a.MUManualEntry && <span className="cs-mini"> · manual price</span>}</td><td />
                          <td className="num"><input className="cell-input" aria-label="Assembly quantity" defaultValue={Number(a.Quantity)} key={`q${a.Quantity}`} onBlur={(e) => e.target.value !== String(Number(a.Quantity)) && setAsm(a, { Quantity: e.target.value })} /></td>
                          <td className="num cs-mini">{money(a.AssemblySalePrice)}</td>
                          <td className="num"><input className="cell-input" aria-label="Assembly price each" defaultValue={Number(a.MarkUpPrice)} key={`p${a.MarkUpPrice}`} onBlur={(e) => e.target.value !== String(Number(a.MarkUpPrice)) && setAsm(a, { MarkUpPrice: e.target.value })} /></td>
                          <td className="num"><b>{money(a.ExtPrice)}</b></td>
                          <td className="no-print"><button className="btn small icon" aria-label="Remove assembly" onClick={() => delAsm(a)}><Trash2 size={13} /></button></td>
                        </tr>
                        {it.filter((x) => x.QuoteAssemblyId === a.QuoteAssemblyID).map((x) => (
                          <tr key={x.QuoteItemID} className="cs-mini"><td className="wrap" style={{ paddingLeft: 24 }}>{x.InvItem}</td><td>{x.CostCodeId}</td><td className="num">{num(x.Quantity, 4)}</td><td className="num">{money(x.CostEa)}</td><td /><td /><td className="no-print" /></tr>
                        ))}
                      </Fragment>
                    ))}
                    {it.filter((x) => !x.QuoteAssemblyId).map((x) => (
                      <tr key={x.QuoteItemID}>
                        <td className="wrap">{x.InvItem}<div className="cs-mini">{x.Description}</div></td><td>{x.CostCodeId}</td>
                        <td className="num"><input className="cell-input" aria-label="Quantity" defaultValue={Number(x.Quantity)} key={`q${x.Quantity}`} onBlur={(e) => e.target.value !== String(Number(x.Quantity)) && setItem(x, { Quantity: e.target.value })} /></td>
                        <td className="num">{money(x.CostEa)}</td>
                        <td className="num"><input className="cell-input" aria-label="Price each" defaultValue={Number(x.MarkUpPrice)} key={`p${x.MarkUpPrice}`} onBlur={(e) => e.target.value !== String(Number(x.MarkUpPrice)) && setItem(x, { MarkUpPrice: e.target.value })} /></td>
                        <td className="num"><b>{money(x.ExtPrice)}</b></td>
                        <td className="no-print"><button className="btn small icon" aria-label="Remove line" onClick={() => delItem(x)}><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                    {!qa.length && !it.length && <tr><td colSpan={7} className="muted">No lines yet</td></tr>}
                  </tbody>
                </table></div>
                <div className="cs-inline no-print" style={{ marginTop: 10 }}>
                  <label>Add assembly<select value={addA[c.QuoteCategoryID]?.CsAssemblyId || ''} onChange={(e) => setAddA({ ...addA, [c.QuoteCategoryID]: { ...addA[c.QuoteCategoryID], CsAssemblyId: e.target.value } })}><option value="" />{asms.map((a) => <option key={a.CsAssemblyID} value={a.CsAssemblyID}>{a.AssemblyName} ({money(a.SalePrice)})</option>)}</select></label>
                  <label style={{ flexBasis: 70 }}>Qty<input inputMode="decimal" value={addA[c.QuoteCategoryID]?.Quantity ?? '1'} onChange={(e) => setAddA({ ...addA, [c.QuoteCategoryID]: { ...addA[c.QuoteCategoryID], Quantity: e.target.value } })} /></label>
                  <button className="btn" disabled={!addA[c.QuoteCategoryID]?.CsAssemblyId} onClick={() => addAssembly(c.QuoteCategoryID)}><Plus size={14} /> Assembly</button>
                </div>
                <div className="cs-inline no-print" style={{ marginTop: 8 }}>
                  <label>Add item / labor<SearchSelect endpoint="/cs/items/search" value={addI[c.QuoteCategoryID]?.InvItemId} label={addI[c.QuoteCategoryID]?.label} placeholder="Search item…" onSelect={(r) => setAddI({ ...addI, [c.QuoteCategoryID]: { ...addI[c.QuoteCategoryID], InvItemId: r?.id ?? null, label: r?.name ?? '' } })} /></label>
                  <label style={{ flexBasis: 70 }}>Qty<input inputMode="decimal" value={addI[c.QuoteCategoryID]?.Quantity ?? '1'} onChange={(e) => setAddI({ ...addI, [c.QuoteCategoryID]: { ...addI[c.QuoteCategoryID], Quantity: e.target.value } })} /></label>
                  <button className="btn" disabled={!addI[c.QuoteCategoryID]?.InvItemId} onClick={() => addItem(c.QuoteCategoryID)}><Plus size={14} /> Item</button>
                </div>
              </section>
            )
          })}
          <form className="cs-inline no-print" style={{ marginTop: 12 }} onSubmit={addCategory}>
            <label>New category<input maxLength={255} value={newCat} onChange={(e) => setNewCat(e.target.value)} /></label>
            <button className="btn" disabled={!newCat.trim()}><Plus size={14} /> Category</button>
          </form>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Totals</h2></div>
            <div className="table-wrap flat"><table className="grid compact">
              <tbody>
                <tr><td>Assemblies</td><td className="num">{money(t.assemblies)}</td></tr>
                <tr><td>Items and labor</td><td className="num">{money(t.items)}</td></tr>
                {t.flatLabor > 0 && <tr><td>Flat labor</td><td className="num">{money(t.flatLabor)}</td></tr>}
                <tr><td><b>Subtotal</b></td><td className="num"><b>{money(t.subtotal)}</b></td></tr>
                <tr><td>Discount</td><td className="num">−{money(t.discount)}</td></tr>
                <tr><td>Sales tax (on material cost {money(t.materialCost)})</td><td className="num">{money(t.tax)}</td></tr>
                {t.creditCardFee > 0 && <tr><td>Credit card fee</td><td className="num">{money(t.creditCardFee)}</td></tr>}
                <tr><td><b>Total</b></td><td className="num"><b>{money(t.total)}</b></td></tr>
                <tr className="no-print cs-mini"><td>Cost (labor at hourly rate) · real cost at job cost price · profit</td><td className="num">{money(t.cost)} · {money(t.realCost)} · {money(t.profit)}</td></tr>
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </div>
  )
}
