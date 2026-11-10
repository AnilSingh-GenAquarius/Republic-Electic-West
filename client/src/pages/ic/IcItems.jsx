import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { IcTabs, int, money, useIcLookups } from './shared'

export function IcItems() {
  const nav = useNavigate()
  const lk = useIcLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => {
    setError('')
    api('/ic/items', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (p.search || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <div className="page">
      <PageHeader title="Inventory items" subtitle="Catalogue with prices and stock by division" actions={<Link className="btn primary" to="/ic/items/new"><Plus size={15} /> New item</Link>} />
      <IcTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, description, part #, manufacturer…" aria-label="Search items" /></div>
        <select value={p.classId || ''} onChange={(e) => set({ classId: e.target.value })} aria-label="Class"><option value="">All classes</option>{lk.invClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={p.costCode || ''} onChange={(e) => set({ costCode: e.target.value })} aria-label="Cost code"><option value="">All cost codes</option>{lk.costCodes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="seg">{[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, l]) => <button key={v} className={`seg-btn${(p.status || 'active') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>)}</div>
        <label className="check"><input type="checkbox" checked={p.lowStock === '1'} onChange={(e) => set({ lowStock: e.target.checked ? '1' : '' })} /> Below reorder</label>
        <label className="check"><input type="checkbox" checked={p.negative === '1'} onChange={(e) => set({ negative: e.target.checked ? '1' : '' })} /> Negative</label>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Item</th><th>Description</th><th>Class</th><th>Code</th><th>UOM</th><th className="num">Job cost</th><th className="num">Avg cost</th><th className="num">On hand</th><th className="num">Reorder</th><th className="num">On order</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.InvItemID} onClick={() => nav(`/ic/items/${r.InvItemID}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/ic/items/${r.InvItemID}`)} className={r.StatusId !== 1 ? 'dim' : ''}>
                  <td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td>{r.InvClass}</td><td>{r.CostCodeId}</td><td>{r.Uom}</td>
                  <td className="num">{money(r.JobCostPrice)}</td><td className="num">{money(r.AverageCost)}</td>
                  <td className="num"><span className={r.OnHand < 0 ? 'text-danger' : ''}>{int(r.OnHand ?? 0)}</span></td>
                  <td className="num">{int(r.ReOrder ?? 0)}</td><td className="num">{int(r.OnOrder ?? 0)}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={10}><EmptyState title="No items match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

const EMPTY = {
  InvItem: '', AlternateCode: '', Description: '', InvClassId: '', CostCodeId: '', Uom: '', UnitsPer: 1, VendorId: '', Manufacturer: '', PartNum: '', StatusId: 1,
  DefaultStageId: '', DefaultWorkId: '', PmItem: false, BillBySuper: false, PackageItem: false, NonTaxable: false, Notes: '',
  LaborCost: 0, LastCost: 0, AverageCost: 0, JobCostPrice: 0, JobCostPriceUpdateId: 3, LastPurchase: '',
  EstimatingPriceMkUp: 3, VipPriceMkUp: 25, ResidentialPoPriceMkUp: 60, RetailPriceMkUp: 120, EstimatingPriceUpdateId: 3,
}
const PRICES = [['EstimatingPrice', 'EstimatingPriceMkUp', 'Estimating'], ['VipPrice', 'VipPriceMkUp', 'VIP'], ['ResidentialPoPrice', 'ResidentialPoPriceMkUp', 'Residential PO'], ['RetailPrice', 'RetailPriceMkUp', 'Retail']]

export function IcItemDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useIcLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [stageEdit, setStageEdit] = useState({})
  const [vp, setVp] = useState({ vendor: null, DefaultPrice: '', PartNum: '' })

  const load = useCallback(async () => {
    if (isNew) { setForm(EMPTY); return }
    const r = await api(`/ic/items/${id}`)
    setD(r)
    const f = { ...EMPTY }
    for (const k of Object.keys(EMPTY)) { const v = r.item[k]; f[k] = typeof EMPTY[k] === 'boolean' ? !!v : (v ?? '') }
    f.LastPurchase = toInputDate(r.item.LastPurchase)
    setForm(f)
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) })
  // live price preview: job cost × (1 + mark-up %)
  const preview = useMemo(() => Object.fromEntries(PRICES.map(([p, m]) => [p, Math.round(Number(form.JobCostPrice || 0) * (1 + Number(form[m] || 0) / 100) * 10000) / 10000])), [form])
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  async function save(e, confirmDisable = false) {
    e?.preventDefault(); setSaving(true); setError(''); setMsg('')
    try {
      const body = { ...form, confirmDisable }
      for (const k of ['InvClassId', 'VendorId', 'DefaultStageId', 'DefaultWorkId', 'StatusId', 'UnitsPer']) body[k] = body[k] === '' ? null : Number(body[k])
      if (isNew) { const r = await api('/ic/items', { method: 'POST', body }); nav(`/ic/items/${r.id}`, { replace: true }) }
      else { await api(`/ic/items/${id}`, { method: 'PUT', body }); setMsg('Item saved'); await load() }
    } catch (err) {
      if (err.data?.needsConfirm && confirm(`${err.message}`)) return save(null, true)
      setError(err.message)
    } finally { setSaving(false) }
  }
  async function remove() {
    if (!confirm(`Delete item ${form.InvItem}?`)) return
    try { await api(`/ic/items/${id}`, { method: 'DELETE' }); nav('/ic/items') } catch (e) { setError(e.message) }
  }
  const saveStock = wrap(async (div) => { await api(`/ic/items/${id}/stock/${div}`, { method: 'PUT', body: { QtyReOrder: stageEdit[div] } }); setStageEdit((s) => ({ ...s, [div]: undefined })) }, 'Reorder level saved')
  const addVp = wrap(async (e) => { e.preventDefault(); await api(`/ic/items/${id}/vendors`, { method: 'POST', body: { VendorId: vp.vendor.id, DefaultPrice: vp.DefaultPrice, PartNum: vp.PartNum } }); setVp({ vendor: null, DefaultPrice: '', PartNum: '' }) })
  const delVp = wrap(async (vid) => { if (confirm('Remove this vendor price?')) await api(`/ic/vendor-items/${vid}`, { method: 'DELETE' }) })

  const totalOnHand = d?.stock.reduce((a, s) => a + Number(s.QtyOnHand), 0)
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ic/items">Inventory items</Link>} title={isNew ? 'New item' : form.InvItem || 'Item'} track={!isNew && !!d}
        subtitle={d ? [d.item.Description, d.item.InvClass].filter(Boolean).join(' · ') : null} actions={<Link className="btn" to="/ic/items"><ArrowLeft size={15} /> Items</Link>} />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}>{msg}</div>}
      {d && (
        <div className="kpis">
          <StatCard label="On hand (all divisions)" tone="blue" value={int(totalOnHand)} foot={form.Uom || ''} />
          <StatCard label="Job cost price" tone="green" value={money(d.item.JobCostPrice)} foot={`Last ${money(d.item.LastCost)} · average ${money(d.item.AverageCost)}`} />
          <StatCard label="Used in" value={d.usage.pm + d.usage.tm} foot={`${d.usage.pm} plan lines · ${d.usage.tm} T&M lines · ${d.usage.po} PO lines`} />
        </div>
      )}

      <form className="card form" onSubmit={save}>
        <fieldset>
          <legend>Item {d && form.StatusId !== 1 && <Badge>Inactive</Badge>}</legend>
          <label>Item code *<input required minLength={5} maxLength={50} {...f('InvItem')} /></label>
          <label>Alternate code<input maxLength={100} {...f('AlternateCode')} /></label>
          <label className="span2">Description<input maxLength={250} {...f('Description')} /></label>
          <label>Class *<select required {...f('InvClassId')}><option value="" />{lk.invClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Cost code *<select required {...f('CostCodeId')}><option value="" />{lk.costCodes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Unit of measure<select {...f('Uom')}><option value="" />{lk.uoms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Units per<input type="number" min="1" {...f('UnitsPer')} /></label>
          <label>Status<select {...f('StatusId')}>{lk.statuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Preferred vendor<select {...f('VendorId')}><option value="" /><VendorOptions current={form.VendorId} currentName={d?.item.Vendor} /></select></label>
          <label>Manufacturer<input maxLength={50} {...f('Manufacturer')} /></label>
          <label>Part #<input maxLength={50} {...f('PartNum')} /></label>
          <label>Default stage<select {...f('DefaultStageId')}><option value="" />{lk.stages.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Default work type<select {...f('DefaultWorkId')}><option value="" />{lk.workTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={!!form.PmItem} onChange={f('PmItem').onChange} /> Plan-only item</label>
          <label className="check"><input type="checkbox" checked={!!form.BillBySuper} onChange={f('BillBySuper').onChange} /> Bill by super</label>
          <label className="check"><input type="checkbox" checked={!!form.PackageItem} onChange={f('PackageItem').onChange} /> Package item</label>
          <label className="check"><input type="checkbox" checked={!!form.NonTaxable} onChange={f('NonTaxable').onChange} /> Non-taxable</label>
        </fieldset>
        <fieldset>
          <legend>Cost</legend>
          <label>Job cost price<input inputMode="decimal" {...f('JobCostPrice')} /></label>
          <label>Last cost<input inputMode="decimal" {...f('LastCost')} /></label>
          <label>Average cost<input inputMode="decimal" {...f('AverageCost')} /></label>
          <label>Labor cost<input inputMode="decimal" {...f('LaborCost')} /></label>
          <label>Job cost update<select {...f('JobCostPriceUpdateId')}>{lk.updateTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Last purchase<input type="date" {...f('LastPurchase')} /></label>
        </fieldset>
        <fieldset>
          <legend>Selling prices <span className="muted small">— job cost × (1 + mark-up %)</span></legend>
          {PRICES.map(([price, mk, label]) => (
            <label key={price}>{label} mark-up %
              <div className="row" style={{ flexWrap: 'nowrap' }}><input type="number" min="0" style={{ width: 90 }} {...f(mk)} /><b className="price-prev">{money(preview[price], 4)}</b></div>
            </label>
          ))}
          <label>Estimating price update<select {...f('EstimatingPriceUpdateId')}>{lk.updateTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </fieldset>
        <fieldset><label className="span3">Notes<textarea rows={2} maxLength={255} {...f('Notes')} /></label></fieldset>
        <div className="row form-actions">
          <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create item' : 'Save changes'}</button>
          {!isNew && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
          {d && <span className="muted small">Entered {fmtDate(d.item.DateEntered)} by {d.item.UserEntered || '—'}</span>}
        </div>
      </form>

      {d && (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head"><h2>Stock by division</h2></div>
            <table className="grid compact">
              <thead><tr><th>Division</th><th className="num">On hand</th><th className="num">On order</th><th className="num">Reorder at</th><th /></tr></thead>
              <tbody>{d.stock.map((s) => (
                <tr key={s.DivisionId}>
                  <td><b>{s.DivisionId}</b></td>
                  <td className="num"><span className={s.QtyOnHand < 0 ? 'text-danger' : ''}>{int(s.QtyOnHand)}</span></td><td className="num">{int(s.QtyOnOrder)}</td>
                  <td className="num"><input className="pct-input" inputMode="numeric" value={stageEdit[s.DivisionId] ?? s.QtyReOrder} onChange={(e) => setStageEdit((x) => ({ ...x, [s.DivisionId]: e.target.value }))} aria-label={`Reorder level ${s.DivisionId}`} /></td>
                  <td className="actions">{stageEdit[s.DivisionId] !== undefined && String(stageEdit[s.DivisionId]) !== String(s.QtyReOrder) && <button className="btn small primary" onClick={() => saveStock(s.DivisionId)}><Save size={13} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="muted small" style={{ margin: '8px 0 0' }}>On-hand changes only through adjustments, receiving, job cost and counts.</p>
          </section>
          <section className="panel span-2">
            <div className="panel-head"><h2>Vendor prices</h2></div>
            <table className="grid compact">
              <thead><tr><th>Vendor</th><th>Part #</th><th className="num">Default</th><th className="num">Last</th><th>Quoted</th><th /></tr></thead>
              <tbody>
                {d.vendorItems.map((v) => <tr key={v.VendItemID}><td><Link to={`/ic/vendors/${v.VendorId}`}>{v.Vendor}</Link></td><td>{v.PartNum}</td><td className="num">{money(v.DefaultPrice)}</td><td className="num">{money(v.LastPrice)}</td><td>{fmtDate(v.DateQuote)}</td>
                  <td className="actions"><button className="btn small ghost danger" onClick={() => delVp(v.VendItemID)} aria-label="Remove vendor price"><Trash2 size={13} /></button></td></tr>)}
                <tr className="new-row">
                  <td><SearchSelect endpoint="/common/vendors" value={vp.vendor?.id} label={vp.vendor?.name} placeholder="Add vendor…" onSelect={(r) => setVp((s) => ({ ...s, vendor: r }))} /></td>
                  <td><input value={vp.PartNum} onChange={(e) => setVp((s) => ({ ...s, PartNum: e.target.value }))} placeholder="Part #" aria-label="Part number" /></td>
                  <td className="num"><input className="pct-input" value={vp.DefaultPrice} onChange={(e) => setVp((s) => ({ ...s, DefaultPrice: e.target.value }))} placeholder="Price" inputMode="decimal" aria-label="Default price" /></td>
                  <td colSpan={2} /><td className="actions"><button className="btn small primary" disabled={!vp.vendor} onClick={addVp}><Plus size={13} /> Add</button></td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="panel span-2">
            <div className="panel-head"><h2>Recent transactions</h2><Link className="panel-link" to={`/ic/transactions?itemId=${id}`}>All transactions</Link></div>
            {!d.history.length ? <p className="muted small">No transactions.</p> : (
              <table className="grid compact"><thead><tr><th>Date</th><th>Div</th><th>Type</th><th className="num">Qty</th><th className="num">Value</th><th>Posted</th><th>Notes</th></tr></thead>
                <tbody>{d.history.map((h) => <tr key={h.TransactionID}><td>{fmtDate(h.TransacDate)}</td><td>{h.DivisionId}</td><td>{h.TransacType}</td><td className="num">{int(h.Quantity)}</td><td className="num">{money(h.Value)}</td><td>{h.IcTransacPosted ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>}</td><td className="wrap">{h.Notes}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      )}
      {!d && !isNew && !error && <SkeletonRows rows={6} cols={3} />}
      {d?.usage.pmRecent > 0 && form.StatusId !== 1 && <div className="banner"><AlertTriangle size={16} /> This inactive item was used in Plan management in the last 12 months.</div>}
    </div>
  )
}

// Vendor <select> options loaded lazily (only the current one until opened would hide the full list, so load them all once)
let vendorCache = null
function VendorOptions({ current, currentName }) {
  const [list, setList] = useState(vendorCache || [])
  useEffect(() => { if (!vendorCache) api('/ic/vendors', { params: { status: 'all', pageSize: 200 } }).then((d) => { vendorCache = d.rows; setList(d.rows) }).catch(() => {}) }, [])
  const has = list.some((v) => String(v.VendorID) === String(current))
  return (
    <>
      {current && !has && <option value={current}>{currentName || current}</option>}
      {list.map((v) => <option key={v.VendorID} value={v.VendorID}>{v.Vendor}</option>)}
    </>
  )
}
