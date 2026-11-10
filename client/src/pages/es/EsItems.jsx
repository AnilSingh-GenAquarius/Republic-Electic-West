// Inventory item (Access EsInventoryItem): estimating view of an item – the estimating price, mark-ups and update types are
// editable, everything else is read-only (maintained in Inventory). Item research (ItemResearch): find items by words in
// the description, and compare cost / vendor of picked items (ItemResearchSubPo).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Save, Search, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { EsTabs, money4, useEsLookups, yes } from './shared'

export function EsItems() {
  const nav = useNavigate()
  const lk = useEsLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null)
    api('/es/items', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Inventory items" subtitle="Estimating prices and mark-ups" />
      <EsTabs />
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Search items" placeholder="Search item or description…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Class" value={p.classId || ''} onChange={(e) => set({ classId: e.target.value })}><option value="">All classes</option>{lk.invClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="seg">{[['', 'All'], ['1', 'Active'], ['2', 'Inactive']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${(p.statusId || '') === k ? ' active' : ''}`} onClick={() => set({ statusId: k })}>{l}</button>)}</div>
      </div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={6} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Class</th><th>Item</th><th>Description</th><th>Code</th><th className="num">Last cost</th><th className="num">Average cost</th><th className="num">Job cost price</th><th className="num">Estimating price</th><th className="num">Mk up %</th><th>Status</th></tr></thead>
            <tbody>{d.rows.map((r) => {
              const low = r.StatusId === 1 && (r.EstimatingPrice < r.LastCost || r.EstimatingPrice < r.AverageCost || r.EstimatingPrice < r.LaborCost)
              return (
                <tr key={r.InvItemID} className="link-row" onClick={() => nav(`/es/items/${r.InvItemID}`)}>
                  <td>{r.InvClass}</td><td><a><b>{r.InvItem}</b></a></td><td className="wrap">{r.Description}</td><td>{r.CostCodeId}</td><td className="num">{money4(r.LastCost)}</td><td className="num">{money4(r.AverageCost)}</td><td className="num">{money4(r.JobCostPrice)}</td>
                  <td className={`num${low ? ' neg' : ''}`}>{money4(r.EstimatingPrice)}</td><td className="num">{r.EstimatingPriceMkUp ?? ''}</td><td><Badge tone={r.StatusId === 1 ? 'green' : 'neutral'}>{r.Status || '—'}</Badge></td>
                </tr>
              )
            })}{!d.rows.length && <tr><td colSpan={10}><EmptyState title="No items match" /></td></tr>}</tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const EDIT = ['Description', 'Notes', 'EstimatingPrice', 'EstimatingPriceMkUp', 'VipPriceMkUp', 'ResidentialPoPriceMkUp', 'RetailPriceMkUp', 'JobCostPriceUpdateId', 'EstimatingPriceUpdateId']
const RO = ({ label, children }) => <label>{label}<input readOnly tabIndex={-1} value={children ?? ''} /></label>

export function EsItem() {
  const { id } = useParams()
  const lk = useEsLookups()
  const [it, setIt] = useState(null)
  const [f, setF] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [research, setResearch] = useState('')
  const [found, setFound] = useState(null)
  const load = useCallback(async () => { const r = await api(`/es/items/${id}`); setIt(r); setF(Object.fromEntries(EDIT.map((k) => [k, r[k] == null ? '' : String(r[k])]))) }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  async function save(e) {
    e.preventDefault(); setError(''); setMsg('')
    const body = {}; for (const k of EDIT) if (String(it[k] ?? '') !== f[k]) body[k] = f[k]
    try { await api(`/es/items/${id}`, { method: 'PUT', body }); setMsg('Item saved'); await load() } catch (err) { setError(err.message) }
  }
  const search = () => research.trim() && api('/es/research', { params: { search: research } }).then(setFound).catch((e) => setError(e.message))
  const fi = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) })
  const mk = (k, label) => <label>{label} mark-up %<input aria-label={`${label} mark-up`} inputMode="numeric" {...fi(k)} /></label>
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/es/items">Inventory items</Link>} title={it ? it.InvItem : 'Inventory item'} track={!!it} subtitle={it ? `${it.InvClass || ''} · ${it.Description || ''}` : null}
        actions={<Link className="btn" to="/es/items"><ArrowLeft size={15} /> Items</Link>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!it ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <form className="card form" onSubmit={save}>
            <fieldset>
              <legend>Item (read-only here – maintained in Inventory)</legend>
              <RO label="Item ID">{it.InvItemID}</RO><RO label="Item name">{it.InvItem}</RO><RO label="Paycheck name">{it.AlternateCode}</RO>
              <RO label="Class">{it.InvClass}</RO><RO label="Cost code">{[it.CostCodeId, it.CostCode].filter(Boolean).join(' – ')}</RO><RO label="Status">{it.Status}</RO>
              <RO label="Default vendor">{it.Vendor}</RO><RO label="Default mnftr">{it.Manufacturer}</RO><RO label="Default part #">{it.PartNum}</RO>
              <RO label="Units per">{it.UnitsPer}</RO><RO label="Uom">{it.UnitOfMeasure || it.Uom}</RO><RO label="Default stage / work">{[it.DefaultStage, it.DefaultWork].filter(Boolean).join(' / ')}</RO>
              <RO label="Labor cost">{money4(it.LaborCost)}</RO><RO label="Last cost">{money4(it.LastCost)}</RO><RO label="Average cost">{money4(it.AverageCost)}</RO>
              <RO label="Last purchase">{fmtDate(it.LastPurchase)}</RO><RO label="Plan management only item">{yes(it.PmItem) ? 'Yes' : 'No'}</RO><RO label="Billing by super report">{yes(it.BillBySuper) ? 'Yes' : 'No'}</RO>
            </fieldset>
            <fieldset>
              <legend>Prices</legend>
              <RO label="Job cost price">{money4(it.JobCostPrice)}</RO>
              <label>Job cost update<select aria-label="Job cost update" {...fi('JobCostPriceUpdateId')}><option value="" />{lk.updateTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <span />
              <label>Estimating price $<input aria-label="Estimating price" inputMode="decimal" {...fi('EstimatingPrice')} /></label>
              {mk('EstimatingPriceMkUp', 'Estimating')}
              <label>Estimating update<select aria-label="Estimating update" {...fi('EstimatingPriceUpdateId')}><option value="" />{lk.updateTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <RO label="VIP price">{money4(it.VipPrice)}</RO>{mk('VipPriceMkUp', 'VIP')}<span />
              <RO label="Resi-PO price">{money4(it.ResidentialPoPrice)}</RO>{mk('ResidentialPoPriceMkUp', 'Resi-PO')}<span />
              <RO label="Retail price">{money4(it.RetailPrice)}</RO>{mk('RetailPriceMkUp', 'Retail')}<span />
              <p className="muted small span3">Changing the estimating mark-up re-prices the estimating, VIP, resi-PO and retail prices from the job cost price (update type automatic / feature); with a manual estimating price the price book prices follow the estimating price instead. Each other mark-up re-prices its own price from the job cost price.</p>
            </fieldset>
            <fieldset>
              <legend>Description &amp; notes</legend>
              <label className="span3">Description<input aria-label="Description" maxLength={250} {...fi('Description')} /></label>
              <label className="span3">Private notes<input aria-label="Private notes" maxLength={255} {...fi('Notes')} /></label>
            </fieldset>
            <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div>
          </form>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Inventory item research</h2></div>
            <div className="row" style={{ gap: 6, marginBottom: 8 }}><input aria-label="Research words" placeholder="Words in the description…" value={research} onChange={(e) => setResearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><button className="btn small" onClick={search}><Search size={13} /> Search</button></div>
            {found && <ResearchTable rows={found} />}
          </section>
        </>
      )}
    </div>
  )
}

function ResearchTable({ rows }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="grid compact">
      <thead><tr><th>Class</th><th>Item</th><th>Description</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.InvItemID}><td>{r.InvClass}</td><td><Link to={`/es/items/${r.InvItemID}`}>{r.InvItem}</Link></td><td className="wrap">{r.Description}</td></tr>)}
        {!rows.length && <tr><td colSpan={3}><EmptyState title="No item description contains these words" /></td></tr>}</tbody>
    </table></div>
  )
}

export function EsResearch() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('search') || '')
  const [found, setFound] = useState(null)
  const [picked, setPicked] = useState([]) // item ids for the PO research list
  const [po, setPo] = useState([])
  const [error, setError] = useState('')
  const s = sp.get('search') || ''
  useEffect(() => { setFound(null); if (s) api('/es/research', { params: { search: s } }).then(setFound).catch((e) => setError(e.message)) }, [s])
  useEffect(() => { if (!picked.length) { setPo([]); return } api('/es/research/po', { params: { ids: picked.join(',') } }).then(setPo).catch((e) => setError(e.message)) }, [picked])
  return (
    <div className="page">
      <PageHeader title="Inventory item research" subtitle="Find items by words in the description; compare cost and vendor of items you pick" />
      <EsTabs />
      {error && <ErrorState message={error} />}
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Research results</h2></div>
          <form className="row" style={{ gap: 6, marginBottom: 8 }} onSubmit={(e) => { e.preventDefault(); setSp(q.trim() ? { search: q.trim() } : {}) }}>
            <input aria-label="Search for" placeholder="Search for…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} /><button className="btn small primary"><Search size={13} /> Search</button></form>
          {!s ? <EmptyState title="Enter words to search the item descriptions" /> : !found ? <SkeletonRows rows={6} cols={3} /> : <ResearchTable rows={found} />}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Item PO research</h2></div>
          <SearchSelect endpoint="/es/pick/items" value="" label="" placeholder="Add an item…" onSelect={(r) => r && setPicked((p) => (p.includes(r.id) ? p : [...p, r.id]))} />
          <div className="table-wrap" style={{ marginTop: 8 }}><table className="grid compact">
            <thead><tr><th>Item</th><th className="num">Avg cost</th><th className="num">Last cost</th><th>Vendor</th><th>Part #</th><th /></tr></thead>
            <tbody>{po.map((r) => <tr key={r.InvItemID}><td><Link to={`/es/items/${r.InvItemID}`}>{r.InvItem}</Link></td><td className="num">{money4(r.AverageCost)}</td><td className="num">{money4(r.LastCost)}</td><td>{r.Vendor}</td><td>{r.PartNum}</td>
              <td><button className="btn small icon" aria-label={`Remove ${r.InvItem}`} onClick={() => setPicked((p) => p.filter((x) => x !== r.InvItemID))}><Trash2 size={12} /></button></td></tr>)}
              {!po.length && <tr><td colSpan={6} className="muted">Pick items to compare</td></tr>}</tbody>
          </table></div>
        </section>
      </div>
    </div>
  )
}
