// Properties (Access CsProperty): list + search, detail with homeowners / tickets / call notes / production lot,
// and "Add production jobs/lots" (CsPropertySubSearch click-to-add + macro CsProductionLotsAdd for a division).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, Download, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, StatusBadge, int, useCsLookups, withConfirm } from './shared'

export function CsProperties() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'list'
  return (
    <div className="page">
      <PageHeader title="Properties" subtitle="Homes serviced by customer service, linked to production lots"
        actions={<Link className="btn primary" to="/cs/properties/new"><Plus size={15} /> New property</Link>} />
      <CsTabs />
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={tab === 'list'} className={`seg-btn${tab === 'list' ? ' active' : ''}`} onClick={() => setSp({})}>CS properties</button>
        <button role="tab" aria-selected={tab === 'production'} className={`seg-btn${tab === 'production' ? ' active' : ''}`} onClick={() => setSp({ tab: 'production' })}>Add production jobs / lots</button>
      </div>
      {tab === 'production' ? <ProductionLots /> : <PropertyList />}
    </div>
  )
}

function PropertyList() {
  const nav = useNavigate()
  const lk = useCsLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/cs/properties', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <>
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Search properties" placeholder="Address, community, lot, zip or homeowner…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="City" value={p.city || ''} onChange={(e) => set({ city: e.target.value })}><Options list={lk.cities} blank="All cities" /></select>
        {d && <span className="muted">{int(d.total)} propert{d.total === 1 ? 'y' : 'ies'}</span>}
      </div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={5} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Address</th><th>City</th><th>Community / lot</th><th>Builder</th><th>Escrow</th><th className="num">Homeowners</th><th className="num">Tickets</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.PropertyID} className="link-row" onClick={() => nav(`/cs/properties/${r.PropertyID}`)}>
                  <td className="wrap"><a><b>{r.Address}{r.UnitApt ? ` #${r.UnitApt}` : ''}</b></a>{r.WarrantyVoid && <div><span className="badge red">Warranty void</span></div>}</td>
                  <td>{r.City}, {r.StateId} {r.Zip}</td><td className="wrap">{[r.CsCommunity || r.CsJob, r.CsLot].filter(Boolean).join(' · ') || '—'}</td><td className="wrap">{r.Builder || '—'}</td>
                  <td>{fmtDate(r.Escrow) || '—'}</td><td className="num">{int(r.Homeowners)}</td><td className="num">{int(r.Tickets)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={7}><EmptyState title="No properties match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </>
  )
}

function ProductionLots() {
  const nav = useNavigate()
  const lk = useCsLookups()
  const [f, setF] = useState({ address: '', city: '', division: '', page: 1 })
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    setD(null); setError('')
    return api('/cs/production-lots', { params: { ...f, pageSize: 25 } }).then(setD).catch((e) => setError(e.message))
  }, [f])
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])
  async function addLot(l) {
    setError('')
    try { const r = await api(`/cs/production-lots/${l.LotID}/add`, { method: 'POST' }); nav(`/cs/properties/${r.propertyId}`) } catch (e) { setError(e.message) }
  }
  async function importAll() {
    if (!f.division) { setError('Select division'); return }
    if (!confirm(`Add every production builder, job and lot of division ${f.division} that is not in customer service yet?`)) return
    setBusy(true); setError(''); setRes(null)
    try { setRes(await api('/cs/production-lots/import', { method: 'POST', body: { division: f.division } })); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <>
      <p className="muted">Below are production lots not currently in CS. Click a lot to add it to the CS property list, or add all new jobs and lots of a division at once.</p>
      <div className="card form report-filters"><fieldset>
        <label>Filter address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value, page: 1 })} /></label>
        <label>Filter city<input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, page: 1 })} /></label>
        <label>Division<select value={f.division} onChange={(e) => setF({ ...f, division: e.target.value, page: 1 })}><Options list={lk.divisions} blank="All" /></select></label>
        <div className="row" style={{ alignItems: 'flex-end' }}><button type="button" className="btn primary" disabled={busy || !f.division} onClick={importAll}><Download size={15} /> {busy ? 'Adding…' : 'Add all jobs / lots of the division'}</button></div>
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {res && (
        <div className={res.duplicates.length ? 'banner' : 'success-state'} style={{ marginBottom: 12 }}>
          {res.duplicates.length ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {` Production information imported: ${res.builders} builder(s), ${res.jobs} job(s), ${res.properties} propert${res.properties === 1 ? 'y' : 'ies'}, ${res.links} lot link(s).`}
          {res.duplicates.length > 0 && ` ${res.duplicates.length} lot(s) are linked twice to the same property — see the list below.`}
        </div>
      )}
      {res?.duplicates.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 14 }}><table className="grid compact">
          <thead><tr><th>Builder</th><th>Job</th><th>Address</th><th>City</th><th>Lot</th></tr></thead>
          <tbody>{res.duplicates.map((x, i) => <tr key={i}><td>{x.Builder}</td><td>{x.Job}</td><td>{x.Address}</td><td>{x.City}</td><td>{x.CsLot}</td></tr>)}</tbody>
        </table></div>
      )}
      {!d ? <SkeletonRows rows={8} cols={5} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Address</th><th>City</th><th>Div</th><th>Job</th><th>Lot</th><th>Start</th><th>End</th><th /></tr></thead>
            <tbody>
              {d.rows.map((l) => (
                <tr key={l.LotID}>
                  <td className="wrap"><b>{l.Address}</b></td><td>{l.City}, {l.State} {l.Zip}</td><td>{l.DivisionId}</td><td className="wrap">{l.JobName}</td><td>{l.LotBlock}</td>
                  <td>{fmtDate(l.StartDate)}</td><td>{fmtDate(l.EndDate) || '—'}</td>
                  <td><button className="btn small" onClick={() => addLot(l)}><Plus size={13} /> Add</button></td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={8}><EmptyState title="Every production lot is already in CS" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => setF({ ...f, page: pg })} />
        </>
      )}
    </>
  )
}

const blank = { Address: '', UnitApt: '', City: '', StateId: 'CA', Zip: '', Escrow: '', CsJobId: null, CsJobLabel: '', CsLot: '', Notes: '', WarrantyVoid: false, WarrantyVoidNotes: '' }

export function CsPropertyDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useCsLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(isNew ? blank : null)
  const [link, setLink] = useState({ CustomerId: null, label: '', CustomerTypeId: '' })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    if (isNew) return
    const r = await api(`/cs/properties/${id}`); setD(r)
    const v = r.property
    setForm({ Address: v.Address || '', UnitApt: v.UnitApt || '', City: v.City || '', StateId: v.StateId || '', Zip: v.Zip ?? '', Escrow: toInputDate(v.Escrow), CsJobId: v.CsJobId, CsJobLabel: v.CsJob || v.CsCommunity || '',
      CsLot: v.CsLot || '', Notes: v.Notes || '', WarrantyVoid: !!v.WarrantyVoid, WarrantyVoidNotes: v.WarrantyVoidNotes || '' })
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const body = () => { const { CsJobLabel, ...b } = form; void CsJobLabel; return b }
  async function submit(e) {
    e.preventDefault(); setError(''); setMsg('')
    try {
      if (isNew) {
        const r = await withConfirm((force) => api('/cs/properties', { method: 'POST', body: { ...body(), force } }))
        nav(`/cs/properties/${r.id}`, { replace: true })
      } else {
        await withConfirm((force) => api(`/cs/properties/${id}`, { method: 'PUT', body: { ...body(), force } }))
        setMsg('Property saved'); await load()
      }
    } catch (err) { setError(err.message) }
  }
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const addLink = run(async (e) => { e.preventDefault(); await api(`/cs/customers/${link.CustomerId}/properties`, { method: 'POST', body: { PropertyId: Number(id), CustomerTypeId: link.CustomerTypeId } }); setLink({ CustomerId: null, label: '', CustomerTypeId: '' }) }, 'Homeowner linked')
  const delLink = run(async (cid) => { if (confirm('Unlink this homeowner from the property?')) await api(`/cs/customers/${cid}/properties/${id}`, { method: 'DELETE' }) })
  async function remove() {
    if (!confirm('Delete this property? Its homeowner and production links are removed too.')) return
    try { await api(`/cs/properties/${id}`, { method: 'DELETE' }); nav('/cs/properties') } catch (e) { setError(e.message) }
  }
  const v = d?.property
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/properties">Properties</Link>} title={isNew ? 'New property' : v ? v.Property : 'Property'} track={isNew || !!v}
        subtitle={v ? [`Property #${v.PropertyID}`, v.JobName && `${v.JobName} lot ${v.LotBlock}`, v.Builder].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/cs/properties"><ArrowLeft size={15} /> Properties</Link>
          {v && <Link className="btn primary" to={`/cs/schedule?propertyId=${v.PropertyID}`}><CalendarPlus size={15} /> Schedule</Link>}
          {v && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {v?.OpenInProduction && <div className="banner"><AlertTriangle size={16} /> This property is still open in production</div>}
      {v?.WarrantyVoid && <div className="banner warn"><AlertTriangle size={16} /> Warranty void{v.WarrantyVoidNotes ? `: ${v.WarrantyVoidNotes}` : ''}</div>}
      {!form ? <SkeletonRows rows={6} cols={3} /> : (
        <form className="card form" onSubmit={submit}>
          <fieldset>
            <label className="span2">Street address *<input required maxLength={50} {...f('Address')} /></label>
            <label>Unit / apt<input maxLength={255} {...f('UnitApt')} /></label>
            <label>City *<input required maxLength={50} list="cs-cities" {...f('City')} /><datalist id="cs-cities">{lk.cities.map((c) => <option key={c.id} value={c.name} />)}</datalist></label>
            <label>State *<input required maxLength={2} {...f('StateId')} onChange={(e) => setForm((s) => ({ ...s, StateId: e.target.value.toUpperCase() }))} /></label>
            <label>Zip<input inputMode="numeric" maxLength={5} {...f('Zip')} /></label>
            <label>Escrow date<input type="date" {...f('Escrow')} /></label>
            <label>CS job / community<SearchSelect endpoint="/cs/cs-jobs" value={form.CsJobId} label={form.CsJobLabel} placeholder="Search community…" onSelect={(r) => setForm((s) => ({ ...s, CsJobId: r?.id ?? null, CsJobLabel: r?.Job ?? '' }))} /></label>
            <label>CS lot / block<input maxLength={50} {...f('CsLot')} /></label>
            <label className="span3">Notes<input maxLength={255} {...f('Notes')} /></label>
            <label className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!form.WarrantyVoid} onChange={(e) => setForm((s) => ({ ...s, WarrantyVoid: e.target.checked }))} /> Warranty void</label>
            <label className="span2">Warranty void notes<input maxLength={255} {...f('WarrantyVoidNotes')} /></label>
          </fieldset>
          <div className="row form-actions"><button className="btn primary"><Save size={15} /> {isNew ? 'Create property' : 'Save'}</button></div>
        </form>
      )}
      {d && (
        <>
          <div className="cs-grid2" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Homeowners ({d.customers.length})</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <tbody>
                  {d.customers.map((c) => (
                    <tr key={c.CustomerId}>
                      <td className="wrap"><Link to={`/cs/customers/${c.CustomerId}`}>{c.Homeowner}</Link><div className="cs-mini">{[c.CustomerType, c.Phone, c.Email].filter(Boolean).join(' · ')}</div></td>
                      <td><button className="btn small icon" aria-label="Unlink homeowner" onClick={() => delLink(c.CustomerId)}><X size={13} /></button></td>
                    </tr>
                  ))}
                  {!d.customers.length && <tr><td className="muted">No homeowners linked</td></tr>}
                </tbody>
              </table></div>
              <form className="cs-inline" style={{ marginTop: 10 }} onSubmit={addLink}>
                <label>Homeowner<SearchSelect endpoint="/cs/customers/search" value={link.CustomerId} label={link.label} placeholder="Search name…" onSelect={(r) => setLink({ ...link, CustomerId: r?.id ?? null, label: r?.name ?? '' })} /></label>
                <label>Type<select value={link.CustomerTypeId} onChange={(e) => setLink({ ...link, CustomerTypeId: e.target.value })}><Options list={lk.customerTypes} /></select></label>
                <button className="btn" disabled={!link.CustomerId || !link.CustomerTypeId}><Plus size={14} /> Link</button>
              </form>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Production job &amp; lot</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <thead><tr><th>Job</th><th>Lot</th><th>Start</th><th>End</th></tr></thead>
                <tbody>
                  {d.links.map((k) => <tr key={k.CsPropertyLinkID}><td className="wrap">{k.JobName || k.CsJob} <span className="cs-mini">{k.DivisionId}</span></td><td>{k.LotBlock || k.CsLot}</td><td>{fmtDate(k.StartDate)}</td><td>{fmtDate(k.EndDate) || 'Open'}</td></tr>)}
                  {!d.links.length && v.LotId && <tr><td className="wrap">{v.JobName}</td><td>{v.LotBlock}</td><td /><td>{fmtDate(v.LotEndDate) || 'Open'}</td></tr>}
                  {!d.links.length && !v.LotId && <tr><td colSpan={4} className="muted">Not linked to a production lot</td></tr>}
                </tbody>
              </table></div>
              {d.packs.length > 0 && (
                <div className="table-wrap flat" style={{ marginTop: 10 }}><table className="grid compact">
                  <thead><tr><th>Pack</th><th>Type</th><th className="num">Qty</th><th className="num">Posted</th></tr></thead>
                  <tbody>{d.packs.map((pk, i) => <tr key={i}><td className="wrap">{pk.PackName}</td><td>{pk.PackType}</td><td className="num">{int(pk.PackQty)}</td><td className="num">{int(pk.PostedQty)}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          </div>
          <div className="cs-grid2" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Tickets ({d.tickets.length})</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <thead><tr><th>Ticket</th><th>Date</th><th>Homeowner</th><th>Status</th><th>Resolution</th></tr></thead>
                <tbody>
                  {d.tickets.map((tk) => <tr key={tk.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${tk.TicketID}`)}><td><a>{tk.TicketID}</a></td><td>{fmtDate(tk.ApptDate)}</td><td>{tk.Homeowner}</td><td><StatusBadge status={tk.Status} /></td><td>{tk.Resolution || '—'}</td></tr>)}
                  {!d.tickets.length && <tr><td colSpan={5} className="muted">No tickets</td></tr>}
                </tbody>
              </table></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Call notes ({d.callNotes.length})</h2><Link className="panel-link" to={`/cs/call-notes?propertyId=${id}`}>Open</Link></div>
              <div className="table-wrap flat"><table className="grid compact">
                <tbody>
                  {d.callNotes.map((n) => <tr key={n.CallNotesID}><td>{fmtDate(n.CallDate)}</td><td className="wrap">{n.CallNotes}<div className="cs-mini">{[n.Customer, n.FollowUp && `follow up ${fmtDate(n.FollowUp)}`].filter(Boolean).join(' · ')}</div></td></tr>)}
                  {!d.callNotes.length && <tr><td className="muted">No call notes</td></tr>}
                </tbody>
              </table></div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
