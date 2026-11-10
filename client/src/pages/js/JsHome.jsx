// Job setup overview — replaces the Access "SwitchJS" switchboard: counts, quick find (builder / job / lot address) and shortcuts.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, ClipboardList, FileWarning, HardHat, Home as HomeIcon, Layers, MapPin, Plus } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { JsTabs, int } from './shared'

export default function JsHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = () => { setError(''); api('/js/overview').then(setD).catch((e) => setError(e.message)) }
  useEffect(load, [])
  return (
    <div className="page">
      <PageHeader title="Job setup" subtitle="Builders, their jobs, phases and lots — the data every other module works on"
        actions={<><Link className="btn" to="/js/builders/new"><Plus size={15} /> New builder</Link><Link className="btn primary" to="/js/jobs/new"><Plus size={15} /> New job</Link></>} />
      <JsTabs />
      {error && <ErrorState message={error} onRetry={load} />}
      <div className="kpis">
        <StatCard label="Builders" icon={Building2} loading={!d} value={int(d?.Builders)} foot={d && `${int(d.ActiveBuilders)} active`} onClick={() => nav('/js/builders')} />
        <StatCard label="Jobs" icon={HardHat} tone="green" loading={!d} value={int(d?.Jobs)} foot={d && `${int(d.ActiveJobs)} active · ${int(d.Phases)} phases`} onClick={() => nav('/js/jobs')} />
        <StatCard label="Open lots" icon={HomeIcon} tone="blue" loading={!d} value={int(d?.OpenLots)} foot={d && `${int(d.NewLots30)} created in the last 30 days`} onClick={() => nav('/js/lots?state=open')} />
        <StatCard label="Setup gaps" icon={FileWarning} tone="amber" loading={!d} value={int(d ? d.JobsWithoutPhase + d.PhasesWithoutBid + d.JobsWithoutPmJob : null)}
          foot={d && `${d.JobsWithoutPhase} job(s) without phase · ${d.PhasesWithoutBid} phase(s) without bid · ${d.JobsWithoutPmJob} job(s) without PM job`} />
      </div>

      <section className="card">
        <div className="panel-head"><h2>Quick find</h2></div>
        <div className="js-quick">
          <label>Builder
            <SearchSelect endpoint="/js/pick/builders" placeholder="Search builder…" onSelect={(r) => r && nav(`/js/builders/${r.id}`)} />
          </label>
          <label>Job
            <SearchSelect endpoint="/js/pick/jobs" placeholder="Search job name or #…" onSelect={(r) => r && nav(`/js/jobs/${r.id}`)} />
          </label>
          <label>Lot address
            <SearchSelect endpoint="/js/pick/lots" placeholder="Search address, city or permit…" onSelect={(r) => r && nav(`/js/lots/${r.id}`)} />
          </label>
        </div>
      </section>

      <div className="js-grid2">
        <section className="panel">
          <div className="panel-head"><h2><Layers size={16} /> Latest jobs</h2><Link className="panel-link" to="/js/jobs">All jobs</Link></div>
          {!d ? <SkeletonRows rows={5} cols={3} /> : !d.recentJobs.length ? <EmptyState title="No jobs yet" /> : (
            <div className="table-wrap flat">
              <table className="grid compact clickable">
                <thead><tr><th>Job</th><th>Builder</th><th>Entered</th></tr></thead>
                <tbody>{d.recentJobs.map((j) => (
                  <tr key={j.JobId} tabIndex={0} onClick={() => nav(`/js/jobs/${j.JobId}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/js/jobs/${j.JobId}`)}>
                    <td><b>{j.JobName}</b><span className="js-tag">{j.DivisionId}</span></td><td>{j.CustName}</td><td>{fmtDate(j.DateEntered)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2><HomeIcon size={16} /> Latest lots</h2><Link className="panel-link" to="/js/lots">All lots</Link></div>
          {!d ? <SkeletonRows rows={5} cols={3} /> : !d.recentLots.length ? <EmptyState title="No lots yet" /> : (
            <div className="table-wrap flat">
              <table className="grid compact clickable">
                <thead><tr><th>Lot</th><th>Address</th><th>Job</th><th>Entered</th></tr></thead>
                <tbody>{d.recentLots.map((l) => (
                  <tr key={l.LotID} tabIndex={0} onClick={() => nav(`/js/lots/${l.LotID}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/js/lots/${l.LotID}`)}>
                    <td><b>{l.LotBlock}</b></td><td>{[l.Address, l.City].filter(Boolean).join(', ')}</td><td>{l.JobName}</td><td>{fmtDate(l.DateEntered)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="panel-head"><h2><ClipboardList size={16} /> Reports</h2></div>
        <div className="js-actions">
          <Link className="btn" to="/js/reports?r=jobs-alphabetical">Jobs alphabetical</Link>
          <Link className="btn" to="/js/reports?r=new-lots">Newly created lots</Link>
          <Link className="btn" to="/js/reports?r=lots-by-start-date">Lots by start date</Link>
          <Link className="btn" to="/js/reports?r=builder-lots">Builder&apos;s job/lot list</Link>
          <Link className="btn" to="/js/reports?r=lots-per-bid">Lots per bid</Link>
          <Link className="btn" to="/js/reports?r=job-lots">Job&apos;s lot list</Link>
          <Link className="btn" to="/js/lots"><MapPin size={14} /> Address lot search</Link>
        </div>
      </section>
    </div>
  )
}
