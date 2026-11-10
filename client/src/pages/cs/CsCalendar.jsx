// Appointment calendar (Access CsSchedule "Calendar" tab: day list by division, calendar notes,
// upcoming appointments by city/time and by technician).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarPlus, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, addDays, int, today, useCsLookups, weekday } from './shared'

function NoteBox({ date, division, note, onSaved }) {
  const [text, setText] = useState(note?.CalendarNotes || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(note?.CalendarNotes || '') }, [note])
  if (!division) return note ? <div className="cs-note">{note.CalendarNotes}</div> : null
  const dirty = text !== (note?.CalendarNotes || '')
  async function save() {
    setBusy(true)
    try { await api('/cs/calendar-notes', { method: 'PUT', body: { date, division, notes: text } }); onSaved() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="cs-note-edit">
      <input aria-label={`Calendar notes ${date}`} placeholder="Calendar notes…" maxLength={255} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && dirty && save()} />
      {dirty && <button className="btn small icon" aria-label="Save note" disabled={busy} onClick={save}><Save size={13} /></button>}
    </div>
  )
}

export default function CsCalendar() {
  const nav = useNavigate()
  const lk = useCsLookups()
  const [sp, setSp] = useSearchParams()
  const from = sp.get('from') || today()
  const division = sp.get('division') || ''
  const days = Number(sp.get('days') || 7)
  const to = addDays(from, days - 1)
  const [d, setD] = useState(null)
  const [up, setUp] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { from, division, days: String(days), ...patch }; Object.keys(n).forEach((k) => !n[k] && delete n[k]); if (n.days === '7') delete n.days; setSp(n) }
  const load = useCallback(() => {
    setError('')
    return api('/cs/calendar', { params: { from, to, division } }).then(setD).catch((e) => setError(e.message))
  }, [from, to, division])
  useEffect(() => { setD(null); load() }, [load])
  useEffect(() => { api('/cs/calendar/upcoming', { params: { division } }).then(setUp).catch(() => setUp(null)) }, [division])
  const list = Array.from({ length: days }, (_, i) => addDays(from, i))
  const t0 = today()
  return (
    <div className="page">
      <PageHeader title="Appointment calendar" subtitle="Scheduled appointments by day, with the day's calendar notes"
        actions={<Link className="btn primary" to="/cs/schedule"><CalendarPlus size={15} /> Schedule appointment</Link>} />
      <CsTabs />
      <div className="cs-cal-bar">
        <button className="btn small icon" aria-label="Previous" onClick={() => set({ from: addDays(from, -days) })}><ChevronLeft size={15} /></button>
        <input type="date" aria-label="From date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        <button className="btn small icon" aria-label="Next" onClick={() => set({ from: addDays(from, days) })}><ChevronRight size={15} /></button>
        <button className="btn small" onClick={() => set({ from: t0 })}>Today</button>
        <div className="seg">
          <button className={`seg-btn${days === 1 ? ' active' : ''}`} onClick={() => set({ days: '1' })}>Day</button>
          <button className={`seg-btn${days === 7 ? ' active' : ''}`} onClick={() => set({ days: '7' })}>Week</button>
        </div>
        <select aria-label="Division" value={division} onChange={(e) => set({ division: e.target.value })}><Options list={lk.divisions} blank="All divisions" /></select>
        {d && <span className="muted">{int(d.appointments.length)} appointment(s)</span>}
      </div>
      {!division && <p className="muted small">Choose a division to add calendar notes.</p>}
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={6} cols={4} /> : days === 1 ? (
        <section className="panel">
          <div className="panel-head"><h2>{weekday(from)} {fmtDate(from)}</h2></div>
          {d.notes.filter((n) => n.CalendarDate.slice(0, 10) === from && (!division || n.DivisionId === division)).map((n) => !division && <div key={n.DivisionId} className="cs-note" style={{ marginBottom: 6 }}>{n.DivisionId}: {n.CalendarNotes}</div>)}
          <NoteBox date={from} division={division} note={d.notes.find((n) => n.CalendarDate.slice(0, 10) === from && n.DivisionId === division)} onSaved={load} />
          <div className="table-wrap flat" style={{ marginTop: 8 }}><table className="grid compact">
            <thead><tr><th>Ticket</th><th>Time</th><th>Type</th><th>Job type</th><th>Property</th><th>Customer</th><th>Rep</th><th className="num">Est hrs</th><th>Status</th><th>Community</th><th>Resolution</th><th className="num">Techs</th></tr></thead>
            <tbody>
              {d.appointments.map((a) => (
                <tr key={a.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${a.TicketID}`)}>
                  <td><a>{a.TicketID}</a></td><td>{a.ApptTime}</td><td>{a.TicketType}</td><td>{a.CsJobType}</td><td className="wrap">{a.Property}</td><td>{a.Homeowner}</td>
                  <td className="wrap">{a.RepName}{a.RepPhone ? <div className="cs-mini">{a.RepPhone}</div> : null}</td><td className="num">{a.EstimatedHours ?? ''}</td><td>{a.Status}</td><td className="wrap">{a.Job}</td><td>{a.Resolution || ''}</td><td className="num">{a.TechQty}</td>
                </tr>
              ))}
              {!d.appointments.length && <tr><td colSpan={12} className="muted">No appointments</td></tr>}
            </tbody>
          </table></div>
        </section>
      ) : (
        <div className="cs-week">
          {list.map((day) => {
            const appts = d.appointments.filter((a) => a.ApptDate.slice(0, 10) === day)
            const notes = d.notes.filter((n) => n.CalendarDate.slice(0, 10) === day)
            return (
              <div key={day} className={`cs-day${day === t0 ? ' today' : ''}`}>
                <div className="cs-day-head"><button className="link-btn" onClick={() => set({ from: day, days: '1' })}><b>{weekday(day)} {fmtDate(day)}</b></button><span className="muted">{appts.length || ''}</span></div>
                {!division && notes.map((n) => <div key={n.DivisionId} className="cs-note">{n.DivisionId}: {n.CalendarNotes}</div>)}
                <NoteBox date={day} division={division} note={notes.find((n) => n.DivisionId === division)} onSaved={load} />
                {appts.map((a) => (
                  <button key={a.TicketID} className={`cs-appt${a.StatusActive ? '' : ' closed'}`} onClick={() => nav(`/cs/tickets/${a.TicketID}`)} title={`${a.Property} · ${a.Technicians || 'no technician'}`}>
                    <span className="t">{a.ApptTime} · #{a.TicketID}</span>
                    <span className="s">{a.Homeowner}</span>
                    <span className="s">{a.Property}</span>
                    <span className="s">{a.Technicians || 'No technician'}{!division ? ` · ${a.DivisionId}` : ''}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div className="cs-grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="panel-head"><h2>Upcoming by city and time</h2></div>
          {!up ? <SkeletonRows rows={3} cols={3} /> : (
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Date</th><th>City</th><th>Time</th><th>Ticket type</th><th>Job type</th><th className="num">Qty</th></tr></thead>
              <tbody>
                {up.byCity.map((r, i) => <tr key={i} className="link-row" onClick={() => set({ from: r.ApptDate.slice(0, 10), days: '1' })}><td>{fmtDate(r.ApptDate)}</td><td>{r.City}</td><td>{r.ApptTime}</td><td>{r.TicketType}</td><td>{r.CsJobType}</td><td className="num">{r.Appointments}</td></tr>)}
                {!up.byCity.length && <tr><td colSpan={6} className="muted">Nothing scheduled from today on</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Upcoming by technician</h2></div>
          {!up ? <SkeletonRows rows={3} cols={3} /> : (
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Date</th><th>Technician</th><th>Time</th><th>City</th><th className="num">Qty</th></tr></thead>
              <tbody>
                {up.byTech.map((r, i) => <tr key={i}><td>{fmtDate(r.ApptDate)}</td><td>{r.TechName}</td><td>{r.ApptTime}</td><td>{r.City}</td><td className="num">{r.Appointments}</td></tr>)}
                {!up.byTech.length && <tr><td colSpan={5} className="muted">No technicians booked from today on</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      </div>
    </div>
  )
}
