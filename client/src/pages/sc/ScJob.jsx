import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Layers } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ScTabs } from './shared'

export default function ScJob() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/sc/jobs/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const job = d?.job
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/sc">Scheduling</Link>} title={job?.JobName || 'Job'} track={!!job}
        subtitle={job ? [job.CustName, job.DivisionId, job.City].filter(Boolean).join(' · ') : null}
        actions={<Link className="btn" to="/sc"><ArrowLeft size={15} /> Jobs</Link>} />
      <ScTabs />
      {error && <ErrorState message={error} />}
      {job?.Notes && <div className="banner">Job notes: {job.Notes}</div>}
      <div className="table-wrap">
        {!d ? <div style={{ padding: 16 }}><SkeletonRows rows={6} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Phase</th><th>Type</th><th>Superintendents</th><th>Start</th><th>End</th><th className="num">Lots</th><th className="num">Open lots</th><th className="num">Open stages</th></tr></thead>
            <tbody>
              {d.phases.map((p) => (
                <tr key={p.PhaseID} onClick={() => nav(`/sc/phases/${p.PhaseID}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/sc/phases/${p.PhaseID}`)}>
                  <td><b>{p.Phase}</b>{p.PhaseNum ? <span className="muted small"> #{p.PhaseNum}</span> : null}</td><td>{p.PhaseType}</td>
                  <td>{[p.Super1, p.Super2].filter(Boolean).join(', ')}</td><td>{fmtDate(p.StartDate)}</td><td>{fmtDate(p.EndDate)}</td>
                  <td className="num">{p.Lots}</td><td className="num">{p.OpenLots}</td><td className="num">{p.OpenStages}</td>
                </tr>
              ))}
              {!d.phases.length && <tr><td colSpan={8}><EmptyState icon={Layers} title="No phases on this job">Add phases in Job setup first.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
