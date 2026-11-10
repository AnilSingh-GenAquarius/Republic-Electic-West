import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Plus, Save, Send, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { JobLotPicker, Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PoTabs, int, money, usePoLookups } from './shared'

export function PoPacks() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { api('/po/packs', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Pack POs" subtitle="Order the package items of scheduled packs from a vendor, then convert to a purchase order" actions={<Link className="btn primary" to="/po/packs/new"><Plus size={15} /> New pack PO</Link>} />
      <PoTabs />
      <div className="filters">
        <input placeholder="Search vendor, job or number…" defaultValue={p.search || ''} onKeyDown={(e) => e.key === 'Enter' && set({ search: e.target.value })} onBlur={(e) => e.target.value !== (p.search || '') && set({ search: e.target.value })} style={{ maxWidth: 320 }} aria-label="Search pack POs" />
        <div className="seg">{[['', 'All'], ['open', 'Not converted'], ['converted', 'Converted']].map(([v, l]) => <button key={v} className={`seg-btn${(p.status || '') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>)}</div>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={6} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Pack PO</th><th>Date</th><th>Vendor</th><th>Builder</th><th>Job</th><th className="num">Lines</th><th className="num">Value</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.PoPackNum} onClick={() => nav(`/po/packs/${r.PoPackNum}`)} tabIndex={0}>
                  <td><b>{r.PoPackNum}</b></td><td>{fmtDate(r.PoDate)}</td><td>{r.Vendor}</td><td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td className="num">{r.Lines}</td><td className="num">{money(r.ExtCost)}</td>
                  <td>{r.PoConversionDate ? <Badge tone="green">PO {r.PoNumLink}</Badge> : <Badge tone="amber">Not converted</Badge>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={8}><EmptyState title="No pack POs" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

export function PoPack() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = usePoLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState({ PoDate: new Date().toISOString().slice(0, 10), ShipToId: '2', BillToId: '2', PayTerms: '', PoShipping: '0', Notes: '' })
  const [vendor, setVendor] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState({})
  const [qty, setQty] = useState({ Quantity: '1', Cost: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (isNew) return
    const r = await api(`/po/packs/${id}`)
    setD(r)
    const k = r.pack
    setForm({ PoDate: toInputDate(k.PoDate), ShipToId: k.ShipToId ?? '', BillToId: k.BillToId ?? '', PayTerms: k.PayTerms ?? '', PoShipping: String(Number(String(k.PoShipping || '0').replace(/[$,]/g, '')) || 0), Notes: k.Notes ?? '' })
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const converted = !!d?.pack.PoConversionDate

  async function create(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api('/po/packs', { method: 'POST', body: { ...form, VendorId: vendor.id } }); nav(`/po/packs/${r.id}`, { replace: true }) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const save = wrap(async (e) => { e?.preventDefault(); await api(`/po/packs/${id}`, { method: 'PUT', body: form }) }, 'Pack PO saved')
  const addItem = wrap(async (e) => { e.preventDefault(); await api(`/po/packs/${id}/items`, { method: 'POST', body: { LotId: pick.LotId, PackId: pick.PackId, Quantity: qty.Quantity, Cost: qty.Cost } }); setPick({}) })
  const saveItem = wrap(async (iid, body) => { await api(`/po/pack-items/${iid}`, { method: 'PUT', body }) })
  const delItem = wrap(async (iid) => { if (confirm('Remove this line?')) await api(`/po/pack-items/${iid}`, { method: 'DELETE' }) })
  async function post() {
    if (!confirm('Convert this pack PO to a purchase order?\n\nThe package items of every pack on it are ordered from the vendor. This can only be done once.')) return
    setBusy(true); setError(''); setMsg('')
    try { const r = await api(`/po/packs/${id}/post`, { method: 'POST' }); setMsg(`Converted to purchase order ${r.poNum} with ${r.lines} item line(s).`); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function remove() { if (!confirm('Delete this pack PO?')) return; try { await api(`/po/packs/${id}`, { method: 'DELETE' }); nav('/po/packs') } catch (e) { setError(e.message) } }

  if (isNew) {
    return (
      <div className="page">
        <PageHeader crumb={<Link to="/po/packs">Pack POs</Link>} title="New pack PO" />
        <PoTabs />
        <form className="card form" onSubmit={create}>
          <fieldset>
            <label className="span2">Vendor *<SearchSelect endpoint="/common/vendors" value={vendor?.id} label={vendor?.name} placeholder="Search vendor…" onSelect={setVendor} /></label>
            <label>Date<input type="date" {...f('PoDate')} /></label>
            <label>Ship to<select {...f('ShipToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Bill to<select {...f('BillToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Terms<select {...f('PayTerms')}><option value="">Vendor default</option>{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          </fieldset>
          {error && <ErrorState message={error} />}
          <div className="row form-actions"><button className="btn primary" disabled={!vendor || busy}><Plus size={15} /> Create pack PO</button></div>
        </form>
      </div>
    )
  }
  const k = d?.pack
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/po/packs">Pack POs</Link>} title={k ? `Pack PO ${k.PoPackNum} · ${k.Vendor}` : 'Pack PO'} track={!!k}
        actions={<><Link className="btn" to="/po/packs"><ArrowLeft size={15} /> Pack POs</Link>{k && !converted && <button className="btn primary" onClick={post} disabled={busy || !d.items.length}><Send size={15} /> Post pack PO</button>}</>} />
      <PoTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={6} cols={3} /> : (
        <>
          {converted && <div className="banner"><CheckCircle2 size={16} /> Converted on {fmtDate(k.PoConversionDate)} to <Link to={`/po/orders/${k.PoNumLink}`}>purchase order {k.PoNumLink}</Link>{d.linkedPo ? ` (${money(d.linkedPo.Total)})` : ''}. It can no longer change.</div>}
          <form className="card form" onSubmit={save}>
            <fieldset>
              <label>Date<input type="date" disabled={converted} {...f('PoDate')} /></label>
              <label>Ship to<select disabled={converted} {...f('ShipToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Bill to<select disabled={converted} {...f('BillToId')}>{lk.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Terms<select disabled={converted} {...f('PayTerms')}><option value="" />{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Shipping $<input inputMode="decimal" disabled={converted} {...f('PoShipping')} /></label>
              <label className="span2">Notes<input maxLength={255} disabled={converted} {...f('Notes')} /></label>
            </fieldset>
            {!converted && <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button><button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button></div>}
          </form>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Packs to order ({d.items.length})</h2></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Job</th><th>Lot</th><th>Pack</th><th className="num">Package items</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Ext</th><th /></tr></thead>
                <tbody>
                  {d.items.map((x) => (
                    <tr key={x.PoPackItemID}>
                      <td className="wrap">{x.JobName}</td><td>{x.Lot}{x.Block ? `/${x.Block}` : ''}</td><td className="wrap">{x.PackName}{x.BuilderCode ? <span className="muted small"> [{x.BuilderCode}]</span> : null}</td>
                      <td className="num">{x.PackageItems ? int(x.PackageItems) : <Badge tone="amber">none</Badge>}</td>
                      <td className="num">{converted ? int(x.Quantity) : <input className="pct-input" defaultValue={x.Quantity} inputMode="numeric" onBlur={(e) => e.target.value !== String(x.Quantity) && saveItem(x.PoPackItemID, { Quantity: e.target.value })} aria-label="Quantity" />}</td>
                      <td className="num">{converted ? money(x.Cost) : <input className="pct-input" defaultValue={x.Cost} inputMode="decimal" onBlur={(e) => e.target.value !== String(x.Cost) && saveItem(x.PoPackItemID, { Cost: e.target.value })} aria-label="Cost" />}</td>
                      <td className="num">{money(x.ExtCost)}</td>
                      <td className="actions">{!converted && <button className="btn small ghost danger" onClick={() => delItem(x.PoPackItemID)} aria-label="Remove line"><Trash2 size={13} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!converted && (
              <form className="card form" style={{ margin: '12px 0 0' }} onSubmit={addItem}>
                <fieldset>
                  <legend>Add a scheduled pack</legend>
                  <JobLotPicker value={pick} onChange={setPick} />
                  <label>Quantity<input inputMode="numeric" value={qty.Quantity} onChange={(e) => setQty({ ...qty, Quantity: e.target.value })} /></label>
                  <label>Cost<input inputMode="decimal" value={qty.Cost} onChange={(e) => setQty({ ...qty, Cost: e.target.value })} placeholder="0 = last cost" /></label>
                </fieldset>
                <div className="row form-actions"><button className="btn primary" disabled={!pick.PackId}><Plus size={15} /> Add pack</button><span className="muted small">Only packs that contain package items produce order lines.</span></div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  )
}
