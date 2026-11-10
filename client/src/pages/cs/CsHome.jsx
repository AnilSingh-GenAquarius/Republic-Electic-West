// Customer service overview: clickable KPIs, upcoming appointments, latest tickets, tickets by resolution.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CalendarDays, CalendarPlus, ClipboardList, Home as HomeIcon, Users, Wrench } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { CsTabs, Options, StatusBadge, int, today, useCsLookups } from './shared'

export default function CsHome() {
  const nav = useNavigate()
  const lk = useCsLookups()
  const [div, setDiv] = useState('')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/cs/overview', { params: { division: div } }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [div])
  const k = d?.kpis
  const dq = div ? `&division=${div}` : ''
  return (
    <div className="page">
      <PageHeader title="Customer service" subtitle="Homeowner service calls: schedule appointments, track tickets and report on findings"
        actions={<>
          <select aria-label="Division" value={div} onChange={(e) => setDiv(e.target.value)} style={{ width: 'auto' }}><Options list={lk.divisions} blank="All divisions" /></select>
          <Link className="btn primary" to="/cs/schedule"><CalendarPlus size={15} /> Schedule appointment</Link>
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      <div className="kpis">
        <StatCard label="Open tickets" icon={ClipboardList} tone="amber" loading={!d} value={int(k?.OpenTickets)} foot={`${int(k?.Tickets)} tickets in total`} onClick={() => nav(`/cs/tickets?open=1${dq}`)} />
        <StatCard label="Today" icon={CalendarCheck} tone="blue" loading={!d} value={int(k?.Today)} foot="Appointments today" onClick={() => nav(`/cs/calendar?from=${today()}${dq}`)} />
        <StatCard label="Upcoming" icon={CalendarDays} tone="blue" loading={!d} value={int(k?.Upcoming)} foot="From today on" onClick={() => nav(`/cs/tickets?from=${today()}&sort=asc${dq}`)} />
        <StatCard label="Homeowners" icon={Users} tone="green" loading={!d} value={int(k?.Homeowners)} foot={`${int(k?.Properties)} properties`} onClick={() => nav('/cs/customers')} />
        <StatCard label="Active technicians" icon={Wrench} tone="green" loading={!d} value={int(k?.ActiveTechnicians)} foot="CS technicians" onClick={() => nav('/cs/setup?tab=technicians')} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Upcoming appointments</h2><Link className="panel-link" to={`/cs/calendar${div ? `?division=${div}` : ''}`}>Calendar <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={4} cols={4} /> : d.upcoming.length ? (
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Ticket</th><th>Date</th><th>Time</th><th>Homeowner</th><th>Property</th><th>Type</th></tr></thead>
              <tbody>{d.upcoming.map((r) => (
                <tr key={r.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${r.TicketID}`)}>
                  <td><a>{r.TicketID}</a></td><td>{fmtDate(r.ApptDate)}</td><td>{r.ApptTime}</td><td>{r.Homeowner}</td><td className="wrap">{r.Property}</td><td>{r.TicketType}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <EmptyState icon={CalendarDays} title="No upcoming appointments"><Link to="/cs/schedule">Schedule one</Link></EmptyState>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Tickets by resolution</h2></div>
          {!d ? <SkeletonRows rows={4} cols={2} /> : (
            <div className="table-wrap flat"><table className="grid compact">
              <tbody>{d.byResolution.map((r) => {
                const res = lk.resolutions.find((x) => x.name === r.Resolution)
                return (
                  <tr key={r.Resolution} className="link-row" onClick={() => nav(res ? `/cs/tickets?resolutionId=${res.id}${dq}` : `/cs/tickets${div ? `?division=${div}` : ''}`)}>
                    <td>{r.Resolution}</td><td className="num"><b>{int(r.Tickets)}</b></td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest tickets</h2><Link className="panel-link" to="/cs/tickets">All tickets <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={4} cols={4} /> : (
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Ticket</th><th>Date</th><th>Homeowner</th><th>Property</th><th>Status</th><th>Resolution</th></tr></thead>
              <tbody>{d.recent.map((r) => (
                <tr key={r.TicketID} className="link-row" onClick={() => nav(`/cs/tickets/${r.TicketID}`)}>
                  <td><a>{r.TicketID}</a></td><td>{fmtDate(r.ApptDate)}</td><td>{r.Homeowner}</td><td className="wrap">{r.Property}</td><td><StatusBadge status={r.Status} /></td><td>{r.Resolution || '—'}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Quick links</h2></div>
          <div className="cs-stack" style={{ gap: 8 }}>
            <Link className="btn" to="/cs/properties?tab=production"><HomeIcon size={15} /> Add production jobs / lots</Link>
            <Link className="btn" to="/cs/call-notes"><ClipboardList size={15} /> Call notes</Link>
            <Link className="btn" to="/cs/reports"><ArrowRight size={15} /> Reports</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
