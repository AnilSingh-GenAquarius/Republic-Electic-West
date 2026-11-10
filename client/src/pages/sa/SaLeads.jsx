// Sales leads (Access SaProperty): list + "Go to address", lead detail with the Property info tab (CsProperty fields +
// the production lot's packs, SaPropertySubPack) and the Homeowner info tab (SaPropertySubCustomer + phones).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { Options, SaTabs, int, useSaLookups, withConfirm } from './shared'

const SORTS = [['address', 'Address'], ['city', 'City'], ['priority', 'Sale priority'], ['entered', 'Newest first'], ['escrow', 'Escrow date']]
const prioTone = (s) => (!s ? 'neutral' : s.startsWith('1') ? 'amber' : s.startsWith('4') ? 'red' : s.startsWith('2') ? 'blue' : 'neutral')

export function SaLeads() {
  const nav = useNavigate()
  const lk = useSaLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/sa/properties', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Sales leads" subtitle="Properties with their homeowners, sale priority and the packs on the production lot"
        actions={<Link className="btn primary" to="/sa/leads/new"><Plus size={15} /> New lead</Link>} />
      <SaTabs />
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Search leads" placeholder="Address, city, zip, job, builder, lot or homeowner…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Sale priority" value={p.priorityId || ''} onChange={(e) => set({ priorityId: e.target.value })}>
          <option value="">All priorities</option>{lk.priorities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}<option value="none">No priority</option>
        </select>
        <select aria-label="Sort" value={p.sort || 'address'} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}</select>
        {d && <span className="muted">{int(d.total)} lead{d.total === 1 ? '' : 's'}</span>}
      </div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={6} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Address</th><th>City</th><th>Job / lot</th><th>Builder</th><th>Priority</th><th>Homeowner</th><th>Escrow</th><th className="num">Packs</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.PropertyID} className="link-row" onClick={() => nav(`/sa/leads/${r.PropertyID}`)}>
                  <td className="wrap"><a><b>{r.Address}{r.UnitApt ? ` #${r.UnitApt}` : ''}</b></a></td>
                  <td>{[r.City, r.StateId].filter(Boolean).join(', ')} {r.Zip || ''}</td>
                  <td className="wrap">{[r.CsJob, r.CsLot].filter(Boolean).join(' · ') || '—'}</td><td className="wrap">{r.Builder || '—'}</td>
                  <td>{r.SalePriority ? <Badge tone={prioTone(r.SalePriority)}>{r.SalePriority}</Badge> : '—'}</td>
                  <td className="wrap">{r.Homeowner || '—'}{r.Homeowners > 1 ? <span className="muted"> +{r.Homeowners - 1}</span> : null}</td>
                  <td>{fmtDate(r.Escrow) || '—'}</td><td className="num">{int(r.Packs)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No leads match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const blank = { Address: '', UnitApt: '', City: '', StateId: 'CA', Zip: '', Escrow: '', CsJobId: null, CsJobLabel: '', CsLot: '', Notes: '', SaPriorityId: '' }

export function SaLead() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useSaLookups()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'homeowners' ? 'homeowners' : 'property'
  const [d, setD] = useState(null)
  const [form, setForm] = useState(isNew ? blank : null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    if (isNew) { setD(null); setForm(blank); return }
    const r = await api(`/sa/properties/${id}`); setD(r)
    const v = r.property
    setForm({ Address: v.Address || '', UnitApt: v.UnitApt || '', City: v.City || '', StateId: v.StateId || '', Zip: v.Zip ?? '', Escrow: toInputDate(v.Escrow),
      CsJobId: v.CsJobId, CsJobLabel: v.CsJob ? `${v.CsJob}${v.Builder ? ` – ${v.Builder}` : ''}` : '', CsLot: v.CsLot || '', Notes: v.Notes || '', SaPriorityId: v.SaPriorityId ?? '' })
  }, [id, isNew])
  useEffect(() => { setError(''); setMsg(''); load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const body = () => { const { CsJobLabel, ...b } = form; void CsJobLabel; return b }
  async function submit(e) {
    e.preventDefault(); setError(''); setMsg('')
    try {
      if (isNew) {
        const r = await withConfirm((force) => api('/sa/properties', { method: 'POST', body: { ...body(), force } }))
        nav(`/sa/leads/${r.id}`, { replace: true })
      } else {
        await withConfirm((force) => api(`/sa/properties/${id}`, { method: 'PUT', body: { ...body(), force } }))
        setMsg('Lead saved'); await load()
      }
    } catch (err) { setError(err.message) }
  }
  async function remove() {
    if (!confirm('Delete this lead? Its homeowner links are removed too (the homeowners themselves are kept).')) return
    try { await api(`/sa/properties/${id}`, { method: 'DELETE' }); nav('/sa/leads') } catch (e) { setError(e.message) }
  }
  const v = d?.property
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/sa/leads">Sales leads</Link>} title={isNew ? 'New lead' : v ? v.Property : 'Lead'} track={isNew || !!v}
        subtitle={v ? [`Property #${v.PropertyID}`, v.SalePriority, v.JobName && `${v.JobName} lot ${v.LotBlock}`, v.DateEntered && `entered ${fmtDate(v.DateEntered)}${v.UserEntered ? ` by ${v.UserEntered}` : ''}`].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/sa/leads"><ArrowLeft size={15} /> Leads</Link>
          {!isNew && <Link className="btn" to="/sa/leads/new"><Plus size={15} /> New lead</Link>}
          {v && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <SaTabs />
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center', minWidth: 320, flex: '0 1 460px' }}><span className="muted">Go to address</span>
          <div style={{ flex: 1 }}><SearchSelect endpoint="/sa/properties/search" value={null} label="" placeholder="Search address, city or job…" onSelect={(r) => r && nav(`/sa/leads/${r.id}`)} /></div>
        </label>
        {!isNew && (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'property'} className={`seg-btn${tab === 'property' ? ' active' : ''}`} onClick={() => setSp({})}>Property info</button>
            <button role="tab" aria-selected={tab === 'homeowners'} className={`seg-btn${tab === 'homeowners' ? ' active' : ''}`} onClick={() => setSp({ tab: 'homeowners' })}>Homeowner info{d ? ` (${d.homeowners.length})` : ''}</button>
          </div>
        )}
      </div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!form ? <SkeletonRows rows={6} cols={3} /> : (tab === 'property' || isNew) ? (
        <>
          <form className="card form" onSubmit={submit}>
            <fieldset>
              <label className="span2">Address *<input required maxLength={50} {...f('Address')} /></label>
              <label>Unit<input maxLength={255} {...f('UnitApt')} /></label>
              <label>City<input maxLength={50} {...f('City')} /></label>
              <label>State<input maxLength={2} {...f('StateId')} onChange={(e) => setForm((s) => ({ ...s, StateId: e.target.value.toUpperCase() }))} /></label>
              <label>Zip<input inputMode="numeric" maxLength={5} {...f('Zip')} /></label>
              <label>Escrow<input type="date" {...f('Escrow')} /></label>
              <label>Sale priority<select {...f('SaPriorityId')}><Options list={lk.priorities} blank="—" /></select></label>
              <label>Job name<SearchSelect endpoint="/sa/cs-jobs" value={form.CsJobId} label={form.CsJobLabel} placeholder="Search job or builder…" onSelect={(r) => setForm((s) => ({ ...s, CsJobId: r?.id ?? null, CsJobLabel: r?.name ?? '' }))} /></label>
              <label>Lot / block<input maxLength={50} {...f('CsLot')} /></label>
              <label className="span3">Notes<input maxLength={255} {...f('Notes')} /></label>
            </fieldset>
            <div className="row form-actions"><button className="btn primary"><Save size={15} /> {isNew ? 'Create lead' : 'Save'}</button></div>
          </form>
          {d && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Packs on the production lot</h2>{v.LotId ? <span className="muted">{v.JobName} · lot {v.LotBlock} · {v.DivisionId} · start {fmtDate(v.LotStartDate) || '—'} · end {fmtDate(v.LotEndDate) || 'open'}</span> : null}</div>
              {!v.LotId ? <p className="muted">This lead is not linked to a production lot.</p> : (
                <div className="table-wrap flat"><table className="grid compact">
                  <thead><tr><th>Pack type</th><th>Pack name</th><th className="num">Pack qty</th><th className="num">Posted qty</th><th>Date entered</th></tr></thead>
                  <tbody>
                    {d.packs.map((k) => <tr key={k.PackID}><td>{k.PackType}</td><td className="wrap">{k.PackName}</td><td className="num">{int(k.PackQty)}</td><td className="num">{int(k.PostedQty)}</td><td>{fmtDate(k.DateEntered)}</td></tr>)}
                    {!d.packs.length && <tr><td colSpan={5} className="muted">No packs scheduled on the lot</td></tr>}
                  </tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      ) : d && <Homeowners propertyId={id} list={d.homeowners} lk={lk} reload={load} setError={setError} setMsg={setMsg} />}
    </div>
  )
}
const blankHo = { FirstName: '', MiddleName: '', LastName: '', Email: '', Notes: '', CustomerTypeId: '', PhoneNum: '', PhoneTypeId: '1' }

function Homeowners({ propertyId, list, lk, reload, setError, setMsg }) {
  const [add, setAdd] = useState(blankHo)
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await reload() } catch (e) { setError(e.message) } }
  const create = run(async (e) => {
    e.preventDefault()
    await withConfirm((force) => api(`/sa/properties/${propertyId}/homeowners`, { method: 'POST', body: { ...add, force } }))
    setAdd(blankHo)
  }, 'Homeowner added')
  const a = (k) => ({ value: add[k], onChange: (e) => setAdd((s) => ({ ...s, [k]: e.target.value })) })
  return (
    <>
      {list.map((ho) => <Homeowner key={ho.CustomerID} propertyId={propertyId} ho={ho} lk={lk} run={run} />)}
      {!list.length && <EmptyState title="No homeowner on this lead yet">Add the homeowner below.</EmptyState>}
      <form className="card form" style={{ marginTop: 16 }} onSubmit={create}>
        <h3 style={{ margin: '0 0 10px' }}>Add homeowner</h3>
        <fieldset>
          <label>First name *<input required maxLength={50} {...a('FirstName')} /></label>
          <label>Middle name<input maxLength={255} {...a('MiddleName')} /></label>
          <label>Last name *<input required maxLength={50} {...a('LastName')} /></label>
          <label>Customer type *<select required {...a('CustomerTypeId')}><Options list={lk.customerTypes} blank="Choose…" /></select></label>
          <label>Email<input type="email" maxLength={255} {...a('Email')} /></label>
          <label>Phone number<input inputMode="tel" placeholder="(916) 555-0000" {...a('PhoneNum')} /></label>
          <label>Phone type<select {...a('PhoneTypeId')}><Options list={lk.phoneTypes} blank={null} /></select></label>
          <label className="span2">Notes<input maxLength={255} {...a('Notes')} /></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary"><Plus size={15} /> Add homeowner</button></div>
      </form>
    </>
  )
}

function Homeowner({ propertyId, ho, lk, run }) {
  const init = () => ({ FirstName: ho.FirstName || '', MiddleName: ho.MiddleName || '', LastName: ho.LastName || '', Email: ho.Email || '', Notes: ho.Notes || '', CustomerTypeId: ho.CustomerTypeId ?? '' })
  const [f, setF] = useState(init)
  const [ph, setPh] = useState({ PhoneNum: '', PhoneTypeId: '1' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(init()), [ho])
  const b = (k) => ({ value: f[k], onChange: (e) => setF((s) => ({ ...s, [k]: e.target.value })) })
  const save = run(async (e) => { e.preventDefault(); await api(`/sa/properties/${propertyId}/homeowners/${ho.CustomerID}`, { method: 'PUT', body: f }) }, 'Homeowner saved')
  const unlink = run(async () => { if (confirm(`Remove ${ho.Homeowner} from this lead? The homeowner record is kept.`)) await api(`/sa/properties/${propertyId}/homeowners/${ho.CustomerID}`, { method: 'DELETE' }) })
  const addPhone = run(async (e) => { e.preventDefault(); await api(`/sa/homeowners/${ho.CustomerID}/phones`, { method: 'POST', body: ph }); setPh({ PhoneNum: '', PhoneTypeId: '1' }) }, 'Phone added')
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h2>{ho.Homeowner}</h2>
        <span className="muted">Customer #{ho.CustomerID} · entered {fmtDate(ho.DateEntered) || '—'}{ho.UserEntered ? ` by ${ho.UserEntered}` : ''}</span>
      </div>
      <form className="form" onSubmit={save}>
        <fieldset>
          <label>First name *<input required maxLength={50} {...b('FirstName')} /></label>
          <label>Middle name<input maxLength={255} {...b('MiddleName')} /></label>
          <label>Last name *<input required maxLength={50} {...b('LastName')} /></label>
          <label>Customer type *<select required {...b('CustomerTypeId')}><Options list={lk.customerTypes} blank="Choose…" /></select></label>
          <label className="span2">Email<input type="email" maxLength={255} {...b('Email')} /></label>
          <label className="span3">Notes<input maxLength={255} {...b('Notes')} /></label>
        </fieldset>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn primary small"><Save size={14} /> Save homeowner</button>
          <button type="button" className="btn small danger" onClick={unlink}><X size={14} /> Remove from lead</button>
        </div>
      </form>
      <div className="table-wrap flat" style={{ marginTop: 12 }}><table className="grid compact">
        <thead><tr><th>Phone number</th><th>Type</th><th /></tr></thead>
        <tbody>
          {ho.phones.map((p) => <PhoneRow key={p.CustPhoneID} p={p} lk={lk} run={run} />)}
          <tr>
            <td><input aria-label="New phone number" inputMode="tel" placeholder="(916) 555-0000" value={ph.PhoneNum} onChange={(e) => setPh({ ...ph, PhoneNum: e.target.value })} /></td>
            <td><select aria-label="New phone type" value={ph.PhoneTypeId} onChange={(e) => setPh({ ...ph, PhoneTypeId: e.target.value })}><Options list={lk.phoneTypes} blank={null} /></select></td>
            <td><button className="btn small" disabled={!ph.PhoneNum.trim()} onClick={addPhone}><Plus size={13} /> Add</button></td>
          </tr>
        </tbody>
      </table></div>
    </section>
  )
}

function PhoneRow({ p, lk, run }) {
  const [v, setV] = useState({ PhoneNum: p.PhoneNum || '', PhoneTypeId: p.PhoneTypeId ?? '' })
  const dirty = v.PhoneNum !== (p.PhoneNum || '') || String(v.PhoneTypeId) !== String(p.PhoneTypeId ?? '')
  const save = run(async () => { await api(`/sa/phones/${p.CustPhoneID}`, { method: 'PUT', body: v }) }, 'Phone saved')
  const del = run(async () => { if (confirm(`Delete phone ${p.PhoneNum}?`)) await api(`/sa/phones/${p.CustPhoneID}`, { method: 'DELETE' }) })
  return (
    <tr>
      <td><input aria-label="Phone number" value={v.PhoneNum} onChange={(e) => setV({ ...v, PhoneNum: e.target.value })} /></td>
      <td><select aria-label="Phone type" value={v.PhoneTypeId} onChange={(e) => setV({ ...v, PhoneTypeId: e.target.value })}><Options list={lk.phoneTypes} blank={null} /></select></td>
      <td className="row" style={{ gap: 6 }}>
        <button className="btn small" disabled={!dirty} onClick={save}><Save size={13} /></button>
        <button className="btn small icon" aria-label="Delete phone" onClick={del}><Trash2 size={13} /></button>
      </td>
    </tr>
  )
}
