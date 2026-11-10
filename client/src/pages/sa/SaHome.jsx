// Sales overview (Access SwitchSA): lead counts by sale priority, latest leads, shortcuts to the SA reports.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Flame, Home, MapPin, Plus, UserX } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { REPORTS } from './reportList'
import { SaTabs, int } from './shared'

export default function SaHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/sa/overview').then(setD).catch((e) => setError(e.message)) }, [])
  const hot = d?.priorities.find((p) => p.id === 1)
  return (
    <div className="page">
      <PageHeader title="Sales" subtitle="Sales leads on built homes and the sales reports: estimated sales, billing, options sold, lots closed"
        actions={<Link className="btn primary" to="/sa/leads/new"><Plus size={15} /> New lead</Link>} />
      <SaTabs />
      {error && <ErrorState message={error} />}
      <div className="kpis">
        <StatCard label="Sales leads" icon={Home} tone="blue" loading={!d} value={int(d?.leads)} foot={`${int(d?.onLot)} on a production lot`} onClick={() => nav('/sa/leads')} />
        <StatCard label="Hot leads" icon={Flame} tone="amber" loading={!d} value={int(hot?.n ?? 0)} foot={`${int(d?.noPriority)} without a sale priority`} onClick={() => nav(hot ? `/sa/leads?priorityId=${hot.id}` : '/sa/leads')} />
        <StatCard label="Leads without a homeowner" icon={UserX} tone="violet" loading={!d} value={int(d?.noHomeowner)} foot="Add the homeowner on the lead" />
        <StatCard label="Lots started (30 days)" icon={MapPin} tone="green" loading={!d} value={int(d?.lotsStarted30)} foot="Production lots with a start date in the last 30 days" />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest leads</h2><Link className="panel-link" to="/sa/leads?sort=entered">All leads <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={5} cols={4} /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Address</th><th>Job</th><th>Priority</th><th className="num">Homeowners</th><th>Entered</th></tr></thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.PropertyID} className="link-row" onClick={() => nav(`/sa/leads/${r.PropertyID}`)}>
                    <td className="wrap"><a><b>{r.Address}{r.UnitApt ? ` #${r.UnitApt}` : ''}</b></a> <span className="muted">{r.City}</span></td>
                    <td className="wrap">{r.CsJob || '—'}</td><td>{r.SalePriority ? <Badge tone={r.SalePriority.startsWith('1') ? 'amber' : 'neutral'}>{r.SalePriority}</Badge> : '—'}</td>
                    <td className="num">{int(r.Homeowners)}</td><td>{fmtDate(r.DateEntered)}</td>
                  </tr>
                ))}
                {!d.recent.length && <tr><td colSpan={5} className="muted">No leads yet</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Leads by sale priority</h2></div>
          {!d ? <SkeletonRows rows={4} cols={2} /> : (
            <div className="table-wrap flat"><table className="grid compact">
              <tbody>
                {d.priorities.map((p) => <tr key={p.id} className="link-row" onClick={() => nav(`/sa/leads?priorityId=${p.id}`)}><td><a>{p.name}</a></td><td className="num">{int(p.n)}</td></tr>)}
                <tr className="link-row" onClick={() => nav('/sa/leads?priorityId=none')}><td><a>No priority</a></td><td className="num">{int(d.noPriority)}</td></tr>
              </tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-3" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head"><h2>Reports</h2><Link className="panel-link" to="/sa/reports">Open reports <ArrowRight size={13} /></Link></div>
          <div className="fm-reports" style={{ marginBottom: 0 }}>
            {REPORTS.map((r) => <button key={r.key} className="fm-report" onClick={() => nav(`/sa/reports?report=${r.key}`)}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}
          </div>
        </section>
      </div>
    </div>
  )
}
