// Schedule an appointment (Access CsSchedule + macros CsScheduleSetHomeOwner / CsScheduleSetProperty / CsScheduleSetAppt).
// Pick an existing homeowner or property (fills the other side when there is only one), or type new ones:
// on "Schedule" the server creates the homeowner / property / link when needed, saves the phones and technicians.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { api } from '../../api'
import { SearchSelect } from '../../components/Pickers'
import { ErrorState, PageHeader } from '../../components/ui'
import { CsTabs, Options, addDays, today, useCsLookups } from './shared'

const tomorrow = () => addDays(today(), 1) // Access default: Date()+1
const blank = () => ({
  DivisionId: '', ApptDate: tomorrow(), ApptTimeId: '', TicketTypeId: '1', CsjobTypeId: '1', StatusId: '1',
  CustomerId: null, CustomerLabel: '', FirstName: '', MiddleName: '', LastName: '', CustEmail: '', CustomerTypeId: '',
  PropertyId: null, PropertyLabel: '', Address: '', UnitApt: '', City: '', StateId: 'CA', Zip: '', Escrow: '', CsJobId: null, CsJobLabel: '', CsLot: '',
  RepName: '', RepPhone: '', CustomerPONum: '', EstimatedHours: '1', HighCeiling: false, CallHoXminutesBefore: '', CallRepXminutesBefore: '', Notes: '',
})

export default function CsSchedule() {
  const nav = useNavigate()
  const lk = useCsLookups()
  const [sp] = useSearchParams()
  const [f, setF] = useState(blank)
  const [phones, setPhones] = useState([{ PhoneNum: '', PhoneTypeId: '' }])
  const [techs, setTechs] = useState([])
  const [info, setInfo] = useState({ notes: '', openLot: false, warranty: '', choices: null })
  const [day, setDay] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch) => setF((s) => ({ ...s, ...patch }))
  const fld = (k) => ({ value: f[k] ?? '', onChange: (e) => set({ [k]: e.target.value }) })

  // homeowner chosen -> email, phones, notes; one property -> fill it (CsScheduleSetHomeOwner)
  async function pickCustomer(id, keepProperty) {
    if (!id) { set({ CustomerId: null, CustomerLabel: '' }); return }
    const r = await api(`/cs/customers/${id}`)
    const c = r.customer
    set({ CustomerId: c.CustomerID, CustomerLabel: `${c.LastName}, ${c.FirstName}`, FirstName: c.FirstName || '', MiddleName: c.MiddleName || '', LastName: c.LastName || '', CustEmail: c.Email || '' })
    setPhones(r.phones.length ? r.phones.map((x) => ({ PhoneNum: x.PhoneNum, PhoneTypeId: String(x.PhoneTypeId ?? '') })) : [{ PhoneNum: '', PhoneTypeId: '' }])
    setInfo((s) => ({ ...s, notes: c.Notes || '' }))
    if (keepProperty) {
      const link = r.properties.find((x) => x.PropertyId === keepProperty)
      if (link) set({ CustomerTypeId: String(link.CustomerTypeId ?? '') })
      return
    }
    if (r.properties.length === 1) await pickProperty(r.properties[0].PropertyId, c.CustomerID, r.properties[0].CustomerTypeId)
    else setInfo((s) => ({ ...s, choices: r.properties.length > 1 ? { kind: 'property', rows: r.properties.map((x) => ({ id: x.PropertyId, name: x.Property, typeId: x.CustomerTypeId })) } : null }))
  }
  // property chosen -> address fields; one homeowner -> fill it (CsScheduleSetProperty)
  async function pickProperty(id, customerId, typeId) {
    if (!id) { set({ PropertyId: null, PropertyLabel: '' }); return }
    const r = await api(`/cs/properties/${id}`)
    const v = r.property
    set({ PropertyId: v.PropertyID, PropertyLabel: v.Property, Address: v.Address || '', UnitApt: v.UnitApt || '', City: v.City || '', StateId: v.StateId || '', Zip: v.Zip ?? '',
      Escrow: v.Escrow ? String(v.Escrow).slice(0, 10) : '', CsJobId: v.CsJobId, CsJobLabel: v.CsJob || v.CsCommunity || '', CsLot: v.CsLot || '', ...(typeId != null ? { CustomerTypeId: String(typeId) } : {}) })
    setInfo((s) => ({ ...s, openLot: v.OpenInProduction, warranty: v.WarrantyVoid ? (v.WarrantyVoidNotes || 'Warranty void') : '', choices: null }))
    if (customerId) return
    if (r.customers.length === 1) await pickCustomer(r.customers[0].CustomerId, v.PropertyID)
    else if (r.customers.length > 1) setInfo((s) => ({ ...s, choices: { kind: 'customer', rows: r.customers.map((x) => ({ id: x.CustomerId, name: `${x.Homeowner}${x.CustomerType ? ` (${x.CustomerType})` : ''}`, typeId: x.CustomerTypeId })) } }))
  }
  useEffect(() => {
    const c = sp.get('customerId'), p = sp.get('propertyId')
    if (c) pickCustomer(Number(c)).catch((e) => setError(e.message))
    else if (p) pickProperty(Number(p)).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // appointments already on that day (Access calendar tab next to the form)
  useEffect(() => {
    if (!f.ApptDate) { setDay(null); return }
    let live = true
    api('/cs/calendar', { params: { from: f.ApptDate, to: f.ApptDate, division: f.DivisionId } }).then((r) => live && setDay(r)).catch(() => live && setDay(null))
    return () => { live = false }
  }, [f.ApptDate, f.DivisionId])

  async function repPhone() {
    if (!f.RepName || f.RepPhone) return
    const r = await api('/cs/rep-phone', { params: { name: f.RepName } }).catch(() => null)
    if (r?.phone) set({ RepPhone: r.phone })
  }
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const { CustomerLabel, PropertyLabel, CsJobLabel, ...b } = f
      void CustomerLabel; void PropertyLabel; void CsJobLabel
      const r = await api('/cs/appointments', { method: 'POST', body: { ...b, phones: phones.filter((x) => x.PhoneNum), technicians: techs } })
      nav(`/cs/tickets/${r.ticketId}`, { state: { created: r } })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const past = f.ApptDate && f.ApptDate < addDays(today(), -10)
  const techOpts = lk.technicians.filter((x) => !techs.includes(x.id))
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/calendar">Calendar</Link>} title="Schedule appointment" subtitle="Homeowner, property, time and technicians — new homeowners and properties are created when you schedule" />
      <CsTabs />
      <form className="card form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Appointment</legend>
          <label>Division *<select {...fld('DivisionId')}><Options list={lk.divisions} /></select></label>
          <label>Appointment date *
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn small icon" aria-label="Previous day" onClick={() => set({ ApptDate: addDays(f.ApptDate || today(), -1) })}><ChevronLeft size={14} /></button>
              <input type="date" style={{ minWidth: 0 }} {...fld('ApptDate')} />
              <button type="button" className="btn small icon" aria-label="Next day" onClick={() => set({ ApptDate: addDays(f.ApptDate || today(), 1) })}><ChevronRight size={14} /></button>
            </div>
          </label>
          <label>Appointment time *<select {...fld('ApptTimeId')}><Options list={lk.apptTimes} /></select></label>
          <label>Ticket type *<select {...fld('TicketTypeId')}><Options list={lk.ticketTypes} /></select></label>
          <label>Job type *<select {...fld('CsjobTypeId')}><Options list={lk.jobTypes} /></select></label>
          <label>Status<select {...fld('StatusId')}><Options list={lk.statuses} blank={null} /></select></label>
        </fieldset>
        {past && <div className="banner"><AlertTriangle size={16} /> Your appointment date is set at least 10 days in the past</div>}
        <fieldset>
          <legend>Homeowner</legend>
          <label className="span2">Find homeowner<SearchSelect endpoint="/cs/customers/search" value={f.CustomerId} label={f.CustomerLabel} placeholder="Search existing homeowner…"
            onSelect={(r) => (r ? pickCustomer(r.id).catch((e) => setError(e.message)) : set({ CustomerId: null, CustomerLabel: '' }))} /></label>
          <label>Customer type *<select {...fld('CustomerTypeId')}><Options list={lk.customerTypes} /></select></label>
          <label>Last name *<input maxLength={50} disabled={!!f.CustomerId} {...fld('LastName')} /></label>
          <label>First name *<input maxLength={50} disabled={!!f.CustomerId} {...fld('FirstName')} /></label>
          <label>Middle name<input maxLength={255} disabled={!!f.CustomerId} {...fld('MiddleName')} /></label>
          <label className="span2">Email<input type="email" maxLength={255} {...fld('CustEmail')} /></label>
          <div className="span3">
            <div className="cs-mini" style={{ marginBottom: 6 }}>Phone numbers {f.CustomerId ? '(this list replaces the homeowner’s phones when you schedule)' : ''}</div>
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
        {info.notes && <div className="banner">Homeowner notes: {info.notes}</div>}
        {info.choices && (
          <div className="banner" style={{ flexWrap: 'wrap' }}>
            <span>Pick the {info.choices.kind === 'property' ? 'property' : 'homeowner'}:</span>
            {info.choices.rows.map((r) => (
              <button type="button" key={r.id} className="btn small" onClick={() => (info.choices.kind === 'property' ? pickProperty(r.id, f.CustomerId, r.typeId) : pickCustomer(r.id, f.PropertyId).then(() => r.typeId != null && set({ CustomerTypeId: String(r.typeId) }))).then(() => setInfo((s) => ({ ...s, choices: null }))).catch((e) => setError(e.message))}>{r.name}</button>
            ))}
          </div>
        )}
        <fieldset>
          <legend>Property</legend>
          <label className="span2">Find property<SearchSelect endpoint="/cs/properties/search" value={f.PropertyId} label={f.PropertyLabel} placeholder="Search existing address…"
            onSelect={(r) => (r ? pickProperty(r.id, f.CustomerId).catch((e) => setError(e.message)) : set({ PropertyId: null, PropertyLabel: '' }))} /></label>
          <label>Community<SearchSelect endpoint="/cs/cs-jobs" params={{ division: f.DivisionId }} value={f.CsJobId} label={f.CsJobLabel} disabled={!!f.PropertyId} placeholder="Search community…" onSelect={(r) => set({ CsJobId: r?.id ?? null, CsJobLabel: r?.Job ?? '' })} /></label>
          <label className="span2">Street address *<input maxLength={50} disabled={!!f.PropertyId} {...fld('Address')} /></label>
          <label>Unit / apt<input maxLength={255} disabled={!!f.PropertyId} {...fld('UnitApt')} /></label>
          <label>City *<input maxLength={50} list="cs-sched-cities" disabled={!!f.PropertyId} {...fld('City')} /><datalist id="cs-sched-cities">{lk.cities.map((c) => <option key={c.id} value={c.name} />)}</datalist></label>
          <label>State *<input maxLength={2} disabled={!!f.PropertyId} value={f.StateId} onChange={(e) => set({ StateId: e.target.value.toUpperCase() })} /></label>
          <label>Zip *<input inputMode="numeric" maxLength={5} {...fld('Zip')} /></label>
          <label>Escrow date<input type="date" {...fld('Escrow')} /></label>
          <label>CS lot / block<input maxLength={50} disabled={!!f.PropertyId} {...fld('CsLot')} /></label>
        </fieldset>
        {info.openLot && <div className="banner"><AlertTriangle size={16} /> This property is still open in production</div>}
        {info.warranty && <div className="banner warn"><AlertTriangle size={16} /> Warranty void: {info.warranty}</div>}
        <fieldset>
          <legend>Details</legend>
          <label>Builder representative<input maxLength={50} list="cs-reps" {...fld('RepName')} onBlur={repPhone} /><datalist id="cs-reps">{lk.repNames.map((r) => <option key={r.id} value={r.name} />)}</datalist></label>
          <label>Representative phone<input inputMode="tel" {...fld('RepPhone')} /></label>
          <label>Customer PO#<input maxLength={255} {...fld('CustomerPONum')} /></label>
          <label>Estimated hours<input inputMode="decimal" {...fld('EstimatedHours')} /></label>
          <label>Call homeowner (min before)<input inputMode="numeric" {...fld('CallHoXminutesBefore')} /></label>
          <label>Call rep (min before)<input inputMode="numeric" {...fld('CallRepXminutesBefore')} /></label>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.HighCeiling} onChange={(e) => set({ HighCeiling: e.target.checked })} /> High ceiling</label>
          <label className="span2">Ticket notes<input maxLength={255} {...fld('Notes')} /></label>
          <div className="span3">
            <div className="cs-mini" style={{ marginBottom: 6 }}>Technicians</div>
            <div className="cs-chips" style={{ marginBottom: 6 }}>
              {techs.map((tid) => { const x = lk.technicians.find((y) => y.id === tid); return <span className="cs-chip" key={tid}>{x?.name || tid}<button type="button" aria-label={`Remove ${x?.name}`} onClick={() => setTechs(techs.filter((y) => y !== tid))}>×</button></span> })}
              {!techs.length && <span className="muted small">None yet</span>}
            </div>
            <select aria-label="Add technician" value="" onChange={(e) => e.target.value && setTechs([...techs, Number(e.target.value)])} style={{ maxWidth: 360 }}>
              <option value="">Add technician…</option>
              {techOpts.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.TechType}{x.Active ? '' : ' (inactive)'}</option>)}
            </select>
          </div>
        </fieldset>
        {error && <ErrorState message={error} />}
        <div className="row form-actions" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy}><CalendarPlus size={15} /> {busy ? 'Scheduling…' : 'Schedule'}</button>
          <button type="button" className="btn" onClick={() => { setF(blank()); setPhones([{ PhoneNum: '', PhoneTypeId: '' }]); setTechs([]); setInfo({ notes: '', openLot: false, warranty: '', choices: null }); setError('') }}>Clear data</button>
        </div>
      </form>
      {day && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2>Already on {f.ApptDate}{f.DivisionId ? ` · ${f.DivisionId}` : ''} ({day.appointments.length})</h2><Link className="panel-link" to={`/cs/calendar?from=${f.ApptDate}${f.DivisionId ? `&division=${f.DivisionId}` : ''}`}>Calendar</Link></div>
          {day.notes.map((n) => <div key={n.DivisionId} className="cs-note" style={{ marginBottom: 6 }}>{n.DivisionId}: {n.CalendarNotes}</div>)}
          <div className="table-wrap flat"><table className="grid compact">
            <thead><tr><th>Ticket</th><th>Time</th><th>Homeowner</th><th>Property</th><th>Techs</th></tr></thead>
            <tbody>
              {day.appointments.map((a) => <tr key={a.TicketID}><td><Link to={`/cs/tickets/${a.TicketID}`}>{a.TicketID}</Link></td><td>{a.ApptTime}</td><td>{a.Homeowner}</td><td className="wrap">{a.Property}</td><td className="wrap">{a.Technicians || '—'}</td></tr>)}
              {!day.appointments.length && <tr><td colSpan={5} className="muted">Nothing scheduled yet</td></tr>}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  )
}
