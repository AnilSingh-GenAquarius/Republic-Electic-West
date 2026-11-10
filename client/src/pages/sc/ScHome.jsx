import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Layers, Search } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ScTabs, daysFromToday, useScLookups } from './shared'

export default function ScHome() {
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const lk = useScLookups()
  const params = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(params.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp({ ...params, page: 1, ...patch })

  useEffect(() => {
    setError('')
    api('/sc/jobs', { params: { ...params, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (params.search || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Old dashboard link
  if (params.view === 'overdue') return <Navigate to="/sc/overdue" replace />

  const overdue = data?.rows.reduce((a, r) => a + r.OverdueStages, 0) || 0
  return (
    <div className="page">
      <PageHeader title="Scheduling" subtitle="Pick a job, then schedule packs and stage dates on its lots" />
      <ScTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job, builder or job #…" aria-label="Search jobs" />
        </div>
        <select value={params.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division">
          <option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={params.openOnly !== '0'} onChange={(e) => set({ openOnly: e.target.checked ? '' : '0' })} /> Jobs with open lots only</label>
      </div>
      {error && <ErrorState message={error} />}
      {overdue > 0 && (
        <div className="banner"><AlertTriangle size={16} /> {overdue} scheduled stage(s) on this page are past their delivery date and not yet posted.
          <button className="btn small" onClick={() => nav('/sc/overdue')}>Review overdue</button></div>
      )}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Job</th><th>Builder</th><th>Div</th><th>City</th><th className="num">Phases</th><th className="num">Open lots</th><th className="num">Open stages</th><th>Next delivery</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const d = daysFromToday(r.NextDelivery)
                return (
                  <tr key={r.JobId} onClick={() => nav(`/sc/jobs/${r.JobId}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/sc/jobs/${r.JobId}`)}>
                    <td><b>{r.JobName}</b>{r.JobNum ? <span className="muted small"> #{r.JobNum}</span> : null}</td>
                    <td>{r.CustName}</td><td>{r.DivisionId}</td><td>{r.City}</td>
                    <td className="num">{r.Phases}</td><td className="num">{r.OpenLots}<span className="muted small"> / {r.Lots}</span></td><td className="num">{r.OpenStages}</td>
                    <td>{r.NextDelivery ? <>{fmtDate(r.NextDelivery)} <span className="muted small">{d === 0 ? 'today' : `in ${d} d`}</span></> : <span className="faint">—</span>}</td>
                    <td>{r.OverdueStages ? <Badge tone="red">{r.OverdueStages} overdue</Badge> : null}</td>
                  </tr>
                )
              })}
              {!data.rows.length && <tr><td colSpan={9}><EmptyState icon={Layers} title="No jobs match">Try a different search or include jobs without open lots.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setSp({ ...params, page: p })} />}
      <p className="muted small" style={{ marginTop: 12 }}><CalendarClock size={12} /> Jobs, phases and contracts are set up in Job setup; Scheduling works on the lots inside them.</p>
    </div>
  )
}
