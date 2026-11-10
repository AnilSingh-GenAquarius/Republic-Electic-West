// Tickets: list (filters) and the ticket page = Access CsScheduleApptPopUp + CsTicketTrack
// (edit appointment, resolution -> status, technicians with time in/out, findings with material, delete).
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, Download, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, StatusBadge, Warnings, download, hhmm, int, money, num, resetCsLookups, useCsLookups } from './shared'

export function CsTickets() {
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
    api('/cs/appointments', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Tickets" subtitle="Appointments and ticket tracking"
        actions={<>
          <button className="btn" disabled={!d?.rows.length} onClick={() => download(d.rows, [['TicketID', 'Ticket'], ['ApptDate', 'Date'], ['ApptTime', 'Time'], ['DivisionId', 'Div'], ['Homeowner', 'Homeowner'], ['Property', 'Property'], ['TicketType', 'Ticket type'], ['CsJobType', 'Job type'], ['Status', 'Status'], ['Resolution', 'Resolution'], ['TechQty', 'Techs']], 'cs-tickets.csv')}><Download size={15} /> CSV</button>
          <Link className="btn primary" to="/cs/schedule"><CalendarPlus size={15} /> Schedule</Link>
        </>} />
      <CsTabs />
      <div className="card form report-filters"><fieldset>
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><Options list={lk.divisions} blank="All" /></select></label>
        <label>Show<select value={p.open || ''} onChange={(e) => set({ open: e.target.value })}><option value="">All tickets</option><option value="1">Open tickets</option></select></label>
        <label>Resolution<select value={p.resolutionId || ''} onChange={(e) => set({ resolutionId: e.target.value })}><Options list={lk.resolutions} blank="All" /></select></label>
        <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
      </fieldset></div>
      <div className="filters"><div className="search-wrap"><input type="search" aria-label="Search tickets" placeholder="Ticket #, address, homeowner, rep or community…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {d && <span className="muted">{int(d.total)} ticket(s)</span>}</div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={6} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Ticket</th><th>Date</th><th>Time</th><th>Div</th><th>Homeowner</th><th>Property</th><th>Type</th><th>Status</th><th>Resolution</th><th className="num">Techs</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${r.TicketID}`)}>
                  <td><a><b>{r.TicketID}</b></a></td><td>{fmtDate(r.ApptDate)}</td><td>{r.ApptTime}</td><td>{r.DivisionId}</td><td>{r.Homeowner}</td><td className="wrap">{r.Property}</td>
                  <td>{r.TicketType}</td><td><StatusBadge status={r.Status} /></td><td>{r.Resolution || '—'}</td><td className="num">{int(r.TechQty)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={10}><EmptyState title="No tickets match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const FIELDS = ['ApptDate', 'ApptTimeId', 'TicketTypeId', 'CsjobTypeId', 'DivisionId', 'RepName', 'RepPhone', 'CustomerPONum', 'EstimatedHours', 'HighCeiling', 'Notes', 'StatusId', 'ResolutionId', 'ResolutionNotes',
  'CallHoXminutesFefore', 'CallRepXminutesBefore', 'LaborCostHour', 'TaxMaterial', 'TaxLabor', 'MarkUpMaterial', 'MarkUpOther', 'PaymentDate', 'PaymentValue']

export function CsTicket() {
  const { id } = useParams()
  const nav = useNavigate()
  const loc = useLocation()
  const lk = useCsLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(loc.state?.created ? `Ticket ${id} scheduled` : '')
  const [warn, setWarn] = useState(loc.state?.created?.warnings || [])
  const [newTech, setNewTech] = useState('')
  const [finding, setFinding] = useState({ ErrorId: '', ErrorCatId: '', ErrorDetailId: '', StageId: '', LeadTechnicianId: '' })
  const [cats, setCats] = useState([])
  const [details, setDetails] = useState([])
  const [selErr, setSelErr] = useState(null)
  const [mat, setMat] = useState({ InvItemId: null, label: '', Quantity: '1', ItemCostEa: '' })
  const load = useCallback(async () => {
    const r = await api(`/cs/appointments/${id}`); setD(r)
    const a = r.appointment
    const o = {}
    for (const k of FIELDS) o[k] = a[k] == null ? '' : String(a[k])
    o.ApptDate = toInputDate(a.ApptDate); o.PaymentDate = toInputDate(a.PaymentDate); o.HighCeiling = !!a.HighCeiling
    setForm(o)
    setSelErr((s) => (s && r.errors.some((x) => x.ScheduleErrorID === s) ? s : r.errors[0]?.ScheduleErrorID ?? null))
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  useEffect(() => { setCats([]); if (finding.ErrorId) api('/cs/lookups/error-categories', { params: { errorId: finding.ErrorId } }).then(setCats).catch(() => {}) }, [finding.ErrorId])
  useEffect(() => { setDetails([]); if (finding.ErrorCatId) api('/cs/lookups/error-details', { params: { categoryId: finding.ErrorCatId } }).then(setDetails).catch(() => {}) }, [finding.ErrorCatId])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); setWarn([]); try { const r = await fn(...a); if (ok) setMsg(ok); if (r?.warnings) setWarn(r.warnings); await load() } catch (e) { setError(e.message) } }
  const save = run(async (e) => { e.preventDefault(); const r = await api(`/cs/appointments/${id}`, { method: 'PUT', body: form }); resetCsLookups(); return r }, 'Ticket saved')
  // Access: choosing a resolution sets the status of that resolution
  const onResolution = (e) => { const v = e.target.value; const r = lk.resolutions.find((x) => String(x.id) === v); setForm((s) => ({ ...s, ResolutionId: v, ...(r ? { StatusId: String(r.StatusId) } : {}) })) }
  async function repPhone() {
    if (!form.RepName) return
    const r = await api('/cs/rep-phone', { params: { name: form.RepName } }).catch(() => null)
    if (r?.phone) setForm((s) => ({ ...s, RepPhone: r.phone }))
  }
  const addTech = run(async () => { await api(`/cs/appointments/${id}/technicians`, { method: 'POST', body: { TechnicianId: newTech } }); setNewTech('') })
  const saveTech = run(async (t, patch) => api(`/cs/appointment-techs/${t.TicketTechID}`, { method: 'PUT', body: patch }))
  const delTech = run(async (t) => { if (confirm(`Remove ${t.Technician} from this ticket?`)) await api(`/cs/appointment-techs/${t.TicketTechID}`, { method: 'DELETE' }) })
  const submitFinding = run(async (e) => {
    e.preventDefault()
    const r = await api(`/cs/appointments/${id}/errors`, { method: 'POST', body: finding })
    setFinding({ ErrorId: '', ErrorCatId: '', ErrorDetailId: '', StageId: '', LeadTechnicianId: '' }); setSelErr(r.id)
  }, 'Finding submitted')
  const delFinding = run(async (x) => { if (confirm('Delete this finding and its material?')) await api(`/cs/appointment-errors/${x.ScheduleErrorID}`, { method: 'DELETE' }) })
  const setLead = run(async (x, LeadTechnicianId) => api(`/cs/appointment-errors/${x.ScheduleErrorID}`, { method: 'PUT', body: { LeadTechnicianId } }))
  const addMat = run(async (e) => { e.preventDefault(); await api(`/cs/appointment-errors/${selErr}/materials`, { method: 'POST', body: { InvItemId: mat.InvItemId, Quantity: mat.Quantity, ItemCostEa: mat.ItemCostEa } }); setMat({ InvItemId: null, label: '', Quantity: '1', ItemCostEa: '' }) })
  const saveMat = run(async (m, patch) => api(`/cs/appointment-materials/${m.ScheduleMaterialID}`, { method: 'PUT', body: patch }))
  const delMat = run(async (m) => { if (confirm('Remove this material line?')) await api(`/cs/appointment-materials/${m.ScheduleMaterialID}`, { method: 'DELETE' }) })
  const warranty = run(async (patch) => api(`/cs/properties/${d.appointment.PropertyId}`, { method: 'PUT', body: patch }), 'Warranty flag saved')
  async function remove() {
    if (!confirm(`Delete ticket ${id} and its technicians?`)) return
    try { await api(`/cs/appointments/${id}`, { method: 'DELETE' }); nav('/cs/tickets') } catch (e) { setError(e.message) }
  }
  const a = d?.appointment
  const errs = lk.errors.filter((x) => !a || x.DivisionId === a.DivisionId || !x.DivisionId)
  const mats = d?.materials.filter((m) => m.ScheduleErrorId === selErr) || []
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/tickets">Tickets</Link>} title={a ? `Ticket ${a.TicketID} · ${a.Homeowner || ''}` : 'Ticket'} track={!!a}
        subtitle={a ? [fmtDate(a.ApptDate), a.ApptTime, a.Property, a.DivisionId].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/cs/tickets"><ArrowLeft size={15} /> Tickets</Link>
          {a && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete appt</button>}
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <Warnings list={warn} />
      {a?.OpenInProduction && <div className="banner"><AlertTriangle size={16} /> This property is still open in production</div>}
      {!form ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          <section className="panel">
            <dl className="cs-dl">
              <div><dt>Homeowner</dt><dd><Link to={`/cs/customers/${a.CustomerId}`}>{a.Homeowner}</Link></dd></div>
              <div><dt>Customer type</dt><dd>{a.CustomerType || '—'}</dd></div>
              <div><dt>Phones</dt><dd>{d.phones.map((p) => <div key={p.CustPhoneID}><a href={`tel:${p.PhoneNum}`}>{p.PhoneNum}</a> <span className="cs-mini">{p.PhoneType}</span></div>)}{!d.phones.length && '—'}</dd></div>
              <div><dt>Property</dt><dd><Link to={`/cs/properties/${a.PropertyId}`}>{a.Property}</Link></dd></div>
              <div><dt>Community / lot</dt><dd>{[a.Job || a.CsCommunity, a.CsLot].filter(Boolean).join(' · ') || '—'}{d.jobLots.map((j) => <div key={j.CsPropertyLinkID} className="cs-mini">{j.Job} {j.CsLot}</div>)}</dd></div>
              <div><dt>Escrow</dt><dd>{fmtDate(a.Escrow) || '—'}</dd></div>
              <div><dt>Status changed</dt><dd>{a.StatusDateTime ? `${new Date(a.StatusDateTime).toLocaleString('en-US', { timeZone: 'UTC' })} · ${a.StatusBy}` : '—'}</dd></div>
              <div><dt>Entered</dt><dd>{fmtDate(a.DateEntered)} {a.UserEntered}</dd></div>
            </dl>
            <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!a.WarrantyVoid} onChange={(e) => warranty({ WarrantyVoid: e.target.checked })} /> Warranty void</label>
              <input aria-label="Warranty void notes" placeholder="Warranty void notes" defaultValue={a.WarrantyVoidNotes || ''} key={a.WarrantyVoidNotes || ''} style={{ flex: '1 1 200px', minWidth: 0 }}
                onBlur={(e) => e.target.value !== (a.WarrantyVoidNotes || '') && warranty({ WarrantyVoidNotes: e.target.value })} />
            </div>
          </section>
          <form className="card form" onSubmit={save} style={{ marginTop: 16 }}>
            <fieldset>
              <legend>Appointment <StatusBadge status={a.Status} /></legend>
              <label>Appointment date<input type="date" {...f('ApptDate')} /></label>
              <label>Time<select {...f('ApptTimeId')}><Options list={lk.apptTimes} /></select></label>
              <label>Division<select {...f('DivisionId')}><Options list={lk.divisions} /></select></label>
              <label>Ticket type<select {...f('TicketTypeId')}><Options list={lk.ticketTypes} /></select></label>
              <label>Job type<select {...f('CsjobTypeId')}><Options list={lk.jobTypes} /></select></label>
              <label>Estimated hours<input inputMode="decimal" {...f('EstimatedHours')} /></label>
              <label>Rep name<input maxLength={50} list="cs-reps-t" {...f('RepName')} onBlur={repPhone} /><datalist id="cs-reps-t">{lk.repNames.map((r) => <option key={r.id} value={r.name} />)}</datalist></label>
              <label>Rep phone<input inputMode="tel" {...f('RepPhone')} /></label>
              <label>Customer PO#<input maxLength={255} {...f('CustomerPONum')} /></label>
              <label>Call homeowner (min)<input inputMode="numeric" {...f('CallHoXminutesFefore')} /></label>
              <label>Call rep (min)<input inputMode="numeric" {...f('CallRepXminutesBefore')} /></label>
              <label className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.HighCeiling} onChange={(e) => setForm((s) => ({ ...s, HighCeiling: e.target.checked }))} /> High ceiling</label>
              <label className="span3">Ticket notes<input maxLength={255} {...f('Notes')} /></label>
            </fieldset>
            <fieldset>
              <legend>Resolution</legend>
              <label>Resolution<select value={form.ResolutionId} onChange={onResolution}><Options list={lk.resolutions} /></select></label>
              <label>Status<select {...f('StatusId')}><Options list={lk.statuses} blank={null} /></select></label>
              <label className="span2">Resolution notes<input maxLength={255} {...f('ResolutionNotes')} /></label>
              <label>Payment date<input type="date" {...f('PaymentDate')} /></label>
              <label>Payment value<input inputMode="decimal" {...f('PaymentValue')} /></label>
              <label>Labor cost / hour<input inputMode="decimal" {...f('LaborCostHour')} /></label>
              <label>Material tax<input inputMode="decimal" {...f('TaxMaterial')} /></label>
              <label>Labor tax<input inputMode="decimal" {...f('TaxLabor')} /></label>
              <label>Material mark up<input inputMode="decimal" {...f('MarkUpMaterial')} /></label>
              <label>Other mark up<input inputMode="decimal" {...f('MarkUpOther')} /></label>
            </fieldset>
            <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save ticket</button></div>
          </form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Technicians ({d.technicians.length})</h2></div>
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Technician</th><th>Date</th><th>Time in</th><th>Time out</th><th className="num">Hours</th><th /></tr></thead>
              <tbody>
                {d.technicians.map((t) => (
                  <tr key={t.TicketTechID}>
                    <td>{t.Technician} <span className="cs-mini">{t.TechType}</span></td><td>{fmtDate(t.ApptDate)}</td>
                    <td><input type="time" className="cell-input" aria-label="Time in" defaultValue={hhmm(t.TimeIn)} key={`i${t.TimeIn}`} onBlur={(e) => e.target.value !== hhmm(t.TimeIn) && saveTech(t, { TimeIn: e.target.value })} /></td>
                    <td><input type="time" className="cell-input" aria-label="Time out" defaultValue={hhmm(t.TimeOut)} key={`o${t.TimeOut}`} onBlur={(e) => e.target.value !== hhmm(t.TimeOut) && saveTech(t, { TimeOut: e.target.value })} /></td>
                    <td className="num">{num(t.Hours, 3)}</td>
                    <td><button className="btn small icon" aria-label="Remove technician" onClick={() => delTech(t)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
                {!d.technicians.length && <tr><td colSpan={6} className="muted">No technicians yet</td></tr>}
              </tbody>
            </table></div>
            <div className="cs-inline" style={{ marginTop: 10 }}>
              <label>Add technician<select value={newTech} onChange={(e) => setNewTech(e.target.value)}><option value="" />{lk.technicians.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.TechType}{x.Active ? '' : ' (inactive)'}</option>)}</select></label>
              <button className="btn" disabled={!newTech} onClick={addTech}><Plus size={14} /> Add</button>
            </div>
          </section>

          <div className="cs-grid2" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Ticket findings ({d.errors.length})</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <thead><tr><th>Error</th><th>Stage</th><th>Lead technician</th><th /></tr></thead>
                <tbody>
                  {d.errors.map((x) => (
                    <tr key={x.ScheduleErrorID} className={`link-row${selErr === x.ScheduleErrorID ? ' sel' : ''}`} onClick={() => setSelErr(x.ScheduleErrorID)} style={selErr === x.ScheduleErrorID ? { background: 'var(--primary-soft)' } : undefined}>
                      <td className="wrap"><b>{x.Error}</b><div className="cs-mini">{x.Category} · {x.Detail} · {fmtDate(x.ApptDate)}</div></td><td>{x.ScheduleStage || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}><select aria-label="Lead technician" value={x.LeadTechnicianId ?? ''} onChange={(e) => setLead(x, e.target.value)}><Options list={lk.technicians} /></select></td>
                      <td onClick={(e) => e.stopPropagation()}><button className="btn small icon" aria-label="Delete finding" onClick={() => delFinding(x)}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                  {!d.errors.length && <tr><td colSpan={4} className="muted">No findings entered</td></tr>}
                </tbody>
              </table></div>
              <form className="form" onSubmit={submitFinding} style={{ marginTop: 10 }}>
                <fieldset>
                  <legend>Enter ticket findings</legend>
                  <label>Error *<select value={finding.ErrorId} onChange={(e) => setFinding({ ...finding, ErrorId: e.target.value, ErrorCatId: '', ErrorDetailId: '' })}><Options list={errs} /></select></label>
                  <label>Category *<select value={finding.ErrorCatId} disabled={!finding.ErrorId} onChange={(e) => setFinding({ ...finding, ErrorCatId: e.target.value, ErrorDetailId: '' })}><Options list={cats} /></select></label>
                  <label>Detail *<select value={finding.ErrorDetailId} disabled={!finding.ErrorCatId} onChange={(e) => setFinding({ ...finding, ErrorDetailId: e.target.value })}><Options list={details} /></select></label>
                  <label>Schedule stage<select value={finding.StageId} onChange={(e) => setFinding({ ...finding, StageId: e.target.value })}><Options list={lk.stages} /></select></label>
                  <label>Lead technician<select value={finding.LeadTechnicianId} onChange={(e) => setFinding({ ...finding, LeadTechnicianId: e.target.value })}><Options list={lk.technicians} blank="First technician of the ticket" /></select></label>
                </fieldset>
                <div className="row form-actions"><button className="btn primary"><Plus size={14} /> Submit finding</button></div>
              </form>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Material{selErr ? ` · finding #${selErr}` : ''}</h2></div>
              {!selErr ? <p className="muted">First click on the finding on the left before you enter material.</p> : (
                <>
                  <div className="table-wrap flat"><table className="grid compact">
                    <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost ea</th><th className="num">Ext</th><th /></tr></thead>
                    <tbody>
                      {mats.map((m) => (
                        <tr key={m.ScheduleMaterialID}>
                          <td className="wrap">{m.InvItem}<div className="cs-mini">{m.Description}</div></td>
                          <td className="num"><input className="cell-input" aria-label="Quantity" defaultValue={Number(m.Quantity)} key={`q${m.Quantity}`} onBlur={(e) => e.target.value !== String(Number(m.Quantity)) && saveMat(m, { Quantity: e.target.value })} /></td>
                          <td className="num"><input className="cell-input" aria-label="Cost each" defaultValue={Number(m.ItemCostEa)} key={`c${m.ItemCostEa}`} onBlur={(e) => e.target.value !== String(Number(m.ItemCostEa)) && saveMat(m, { ItemCostEa: e.target.value })} /></td>
                          <td className="num">{money(m.ExtCost)}</td>
                          <td><button className="btn small icon" aria-label="Delete material" onClick={() => delMat(m)}><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                      {!mats.length && <tr><td colSpan={5} className="muted">No material on this finding</td></tr>}
                    </tbody>
                    {mats.length > 0 && <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{money(mats.reduce((s, m) => s + Number(m.ExtCost || 0), 0))}</b></td><td /></tr></tfoot>}
                  </table></div>
                  <form className="cs-inline" style={{ marginTop: 10 }} onSubmit={addMat}>
                    <label style={{ flexBasis: 220 }}>Item<SearchSelect endpoint="/cs/items/search" value={mat.InvItemId} label={mat.label} placeholder="Search item…" onSelect={(r) => setMat({ ...mat, InvItemId: r?.id ?? null, label: r?.name ?? '', ItemCostEa: r?.JobCostPrice != null ? String(Number(r.JobCostPrice)) : '' })} /></label>
                    <label style={{ flexBasis: 70 }}>Qty<input inputMode="decimal" value={mat.Quantity} onChange={(e) => setMat({ ...mat, Quantity: e.target.value })} /></label>
                    <label style={{ flexBasis: 90 }}>Cost ea<input inputMode="decimal" value={mat.ItemCostEa} onChange={(e) => setMat({ ...mat, ItemCostEa: e.target.value })} /></label>
                    <button className="btn" disabled={!mat.InvItemId}><Plus size={14} /> Add</button>
                  </form>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
