// "Go to job" list of Access CmContract: production PM jobs with their contract counts.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CmTabs, useCmLookups } from './shared'

export default function CmJobs() {
  const nav = useNavigate()
  const lk = useCmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/cm/jobs', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Contracts" subtitle="Pick a job to see and enter its contracts, addenda, diary and links to estimating bids" />
      <CmTabs />
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Search jobs" placeholder="Search job, customer or job number…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value })}>
          <option value="">All divisions</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={4} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Job</th><th>Div</th><th>Customer</th><th>Job #</th><th>Status</th><th className="num">Contracts</th><th className="num">Not executed</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.PmJobID} className="link-row" onClick={() => nav(`/cm/jobs/${r.PmJobID}`)}>
                <td className="wrap"><a><b>{r.Job}</b></a></td><td>{r.DivisionId}</td><td>{r.Customer}</td><td>{r.JobNumber}</td>
                <td><Badge tone={r.Status === 'Active' ? 'green' : 'neutral'}>{r.Status || '—'}</Badge></td>
                <td className="num">{r.Contracts || ''}</td><td className="num">{r.NotExecuted ? <Badge tone="amber">{r.NotExecuted}</Badge> : ''}</td>
              </tr>
            ))}{!d.rows.length && <tr><td colSpan={7}><EmptyState title="No jobs match" /></td></tr>}</tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}
