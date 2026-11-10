// Homeowners (Access CsCustomer + phones + properties + ticket history).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, CheckCircle2, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, StatusBadge, int, useCsLookups, withConfirm } from './shared'

export function CsCustomers() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/cs/customers', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Homeowners" subtitle="Customers, their phone numbers and properties"
        actions={<Link className="btn primary" to="/cs/customers/new"><Plus size={15} /> New homeowner</Link>} />
      <CsTabs />
      <div className="filters"><div className="search-wrap"><input type="search" aria-label="Search homeowners" placeholder="Name, email, phone or address…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {d && <span className="muted">{int(d.total)} homeowner(s)</span>}</div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={5} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Homeowner</th><th>Phone</th><th>Email</th><th className="num">Properties</th><th className="num">Tickets</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.CustomerID} className="link-row" onClick={() => nav(`/cs/customers/${r.CustomerID}`)}>
                  <td><a><b>{r.LastName}, {r.FirstName}{r.MiddleName ? ` ${r.MiddleName}` : ''}</b></a></td><td>{r.Phone || '—'}</td><td>{r.Email || '—'}</td><td className="num">{int(r.Properties)}</td><td className="num">{int(r.Tickets)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={5}><EmptyState title="No homeowners match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const blank = { FirstName: '', MiddleName: '', LastName: '', Email: '', Notes: '' }

export function CsCustomerDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useCsLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(isNew ? blank : null)
  const [phones, setPhones] = useState([{ PhoneNum: '', PhoneTypeId: '' }])
  const [newPhone, setNewPhone] = useState({ PhoneNum: '', PhoneTypeId: '' })
  const [link, setLink] = useState({ PropertyId: null, label: '', CustomerTypeId: '' })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    if (isNew) return
    const r = await api(`/cs/customers/${id}`); setD(r)
    const c = r.customer
    setForm({ FirstName: c.FirstName || '', MiddleName: c.MiddleName || '', LastName: c.LastName || '', Email: c.Email || '', Notes: c.Notes || '' })
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  async function create(e) {
    e.preventDefault(); setError('')
    try {
      const r = await withConfirm((force) => api('/cs/customers', { method: 'POST', body: { ...form, force, phones: phones.filter((x) => x.PhoneNum) } }))
      nav(`/cs/customers/${r.id}`, { replace: true })
    } catch (err) { setError(err.message) }
  }
  const save = run(async (e) => { e.preventDefault(); await api(`/cs/customers/${id}`, { method: 'PUT', body: form }) }, 'Homeowner saved')
  const addPhone = run(async (e) => { e.preventDefault(); await api(`/cs/customers/${id}/phones`, { method: 'POST', body: newPhone }); setNewPhone({ PhoneNum: '', PhoneTypeId: '' }) }, 'Phone added')
  const setPhoneType = run(async (pid, PhoneTypeId) => api(`/cs/phones/${pid}`, { method: 'PUT', body: { PhoneTypeId } }))
  const delPhone = run(async (pid) => { if (confirm('Remove this phone number?')) await api(`/cs/phones/${pid}`, { method: 'DELETE' }) })
  const addLink = run(async (e) => { e.preventDefault(); await api(`/cs/customers/${id}/properties`, { method: 'POST', body: { PropertyId: link.PropertyId, CustomerTypeId: link.CustomerTypeId } }); setLink({ PropertyId: null, label: '', CustomerTypeId: '' }) }, 'Property linked')
  const setLinkType = run(async (pid, CustomerTypeId) => api(`/cs/customers/${id}/properties/${pid}`, { method: 'PUT', body: { CustomerTypeId } }))
  const delLink = run(async (pid) => { if (confirm('Unlink this property from the homeowner? The property itself is kept.')) await api(`/cs/customers/${id}/properties/${pid}`, { method: 'DELETE' }) })
  async function remove() {
    if (!confirm('Delete this homeowner with their phone numbers and property links?')) return
    try { await api(`/cs/customers/${id}`, { method: 'DELETE' }); nav('/cs/customers') } catch (e) { setError(e.message) }
  }
  const c = d?.customer
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/customers">Homeowners</Link>} title={isNew ? 'New homeowner' : c ? c.Homeowner : 'Homeowner'} track={isNew || !!c}
        subtitle={c ? `Homeowner #${c.CustomerID}${c.UserEntered ? ` · entered ${fmtDate(c.DateEntered)} by ${c.UserEntered}` : ''}` : null}
        actions={<>
          <Link className="btn" to="/cs/customers"><ArrowLeft size={15} /> Homeowners</Link>
          {c && <Link className="btn primary" to={`/cs/schedule?customerId=${c.CustomerID}`}><CalendarPlus size={15} /> Schedule</Link>}
          {c && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!form ? <SkeletonRows rows={6} cols={3} /> : (
        <form className="card form" onSubmit={isNew ? create : save}>
          <fieldset>
            <label>First name *<input required maxLength={50} {...f('FirstName')} /></label>
            <label>Middle name<input maxLength={255} {...f('MiddleName')} /></label>
            <label>Last name *<input required maxLength={50} {...f('LastName')} /></label>
            <label>Email<input type="email" maxLength={255} {...f('Email')} /></label>
            <label className="span2">Notes<input maxLength={255} {...f('Notes')} /></label>
          </fieldset>
          {isNew && (
            <fieldset>
              <legend>Phone numbers</legend>
              <div className="span3">
                {phones.map((ph, i) => (
                  <div className="cs-phone-row" key={i}>
                    <input aria-label={`Phone ${i + 1}`} inputMode="tel" placeholder="(916) 555-0100" value={ph.PhoneNum} onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, PhoneNum: e.target.value } : x)))} />
                    <select aria-label={`Phone ${i + 1} type`} value={ph.PhoneTypeId} onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, PhoneTypeId: e.target.value } : x)))}><Options list={lk.phoneTypes} blank="Type…" /></select>
                    <button type="button" className="btn small icon" aria-label="Remove phone" onClick={() => setPhones(phones.length > 1 ? phones.filter((_, j) => j !== i) : [{ PhoneNum: '', PhoneTypeId: '' }])}><X size={13} /></button>
                  </div>
                ))}
                <button type="button" className="btn small" onClick={() => setPhones([...phones, { PhoneNum: '', PhoneTypeId: '' }])}><Plus size={13} /> Another phone</button>
              </div>
            </fieldset>
          )}
          <div className="row form-actions"><button className="btn primary"><Save size={15} /> {isNew ? 'Create homeowner' : 'Save'}</button></div>
        </form>
      )}
      {d && (
        <>
          <div className="cs-grid2" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Phone numbers ({d.phones.length})</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <tbody>
                  {d.phones.map((ph) => (
                    <tr key={ph.CustPhoneID}>
                      <td><a href={`tel:${ph.PhoneNum}`}>{ph.PhoneNum}</a></td>
                      <td><select aria-label="Phone type" value={ph.PhoneTypeId ?? ''} onChange={(e) => setPhoneType(ph.CustPhoneID, e.target.value)}><Options list={lk.phoneTypes} /></select></td>
                      <td><button className="btn small icon" aria-label="Delete phone" onClick={() => delPhone(ph.CustPhoneID)}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                  {!d.phones.length && <tr><td className="muted">No phone numbers</td></tr>}
                </tbody>
              </table></div>
              <form className="cs-inline" style={{ marginTop: 10 }} onSubmit={addPhone}>
                <label>Phone<input inputMode="tel" placeholder="(916) 555-0100" value={newPhone.PhoneNum} onChange={(e) => setNewPhone({ ...newPhone, PhoneNum: e.target.value })} /></label>
                <label>Type<select value={newPhone.PhoneTypeId} onChange={(e) => setNewPhone({ ...newPhone, PhoneTypeId: e.target.value })}><Options list={lk.phoneTypes} /></select></label>
                <button className="btn" disabled={!newPhone.PhoneNum || !newPhone.PhoneTypeId}><Plus size={14} /> Add phone</button>
              </form>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Properties ({d.properties.length})</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <tbody>
                  {d.properties.map((pr) => (
                    <tr key={pr.PropertyId}>
                      <td className="wrap"><Link to={`/cs/properties/${pr.PropertyId}`}>{pr.Property}</Link><div className="cs-mini">{[pr.JobName || pr.CsJob, pr.LotBlock || pr.CsLot, pr.Builder].filter(Boolean).join(' · ')}</div></td>
                      <td><select aria-label="Customer type" value={pr.CustomerTypeId ?? ''} onChange={(e) => setLinkType(pr.PropertyId, e.target.value)}><Options list={lk.customerTypes} /></select></td>
                      <td><button className="btn small icon" aria-label="Unlink property" onClick={() => delLink(pr.PropertyId)}><X size={13} /></button></td>
                    </tr>
                  ))}
                  {!d.properties.length && <tr><td className="muted">No properties linked</td></tr>}
                </tbody>
              </table></div>
              <form className="cs-inline" style={{ marginTop: 10 }} onSubmit={addLink}>
                <label>Property<SearchSelect endpoint="/cs/properties/search" value={link.PropertyId} label={link.label} placeholder="Search address…" onSelect={(r) => setLink({ ...link, PropertyId: r?.id ?? null, label: r?.name ?? '' })} /></label>
                <label>Customer type<select value={link.CustomerTypeId} onChange={(e) => setLink({ ...link, CustomerTypeId: e.target.value })}><Options list={lk.customerTypes} /></select></label>
                <button className="btn" disabled={!link.PropertyId || !link.CustomerTypeId}><Plus size={14} /> Link</button>
              </form>
            </section>
          </div>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Ticket history ({d.history.length})</h2></div>
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Ticket</th><th>Date</th><th>Time</th><th>Property</th><th>Type</th><th>Job type</th><th>Status</th><th>Resolution</th></tr></thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${h.TicketID}`)}>
                    <td><a>{h.TicketID}</a></td><td>{fmtDate(h.ApptDate)}</td><td>{h.ApptTime}</td><td className="wrap">{h.Property}</td><td>{h.TicketType}</td><td>{h.CsJobType}</td><td><StatusBadge status={h.Status} /></td><td>{h.Resolution || '—'}</td>
                  </tr>
                ))}
                {!d.history.length && <tr><td colSpan={8} className="muted">No tickets yet</td></tr>}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </div>
  )
}
