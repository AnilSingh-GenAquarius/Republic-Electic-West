// Job history log (Access EsjobLog + EsJobLogSubNotes): read-only job info and the job's dated notes (CmContract).
// You can only change your own notes.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { api, session } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { EsTabs, FormCard, Fields, toForm, useEsLookups, yes } from './shared'

const LOG_FIELDS = [['TypeId', 'Type', 'select', { list: 'contractTypes' }], ['Description', 'Title', 'text', { span: 2, max: 255 }], ['EffectivePhase', 'Effective phase', 'text', { max: 255 }],
  ['EffectiveDate', 'Effective date', 'date'], ['Notes', 'Notes', 'area', { rows: 3 }]]

export default function EsJobLog() {
  const lk = useEsLookups()
  const [sp, setSp] = useSearchParams()
  const jobId = sp.get('job') || ''
  const [q, setQ] = useState('')
  const [jobs, setJobs] = useState(null)
  const [d, setD] = useState(null)
  const [entry, setEntry] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const me = session.user?.username
  useEffect(() => { const t = setTimeout(() => api('/es/joblog/jobs', { params: { search: q } }).then(setJobs).catch((e) => setError(e.message)), 300); return () => clearTimeout(t) }, [q])
  const load = useCallback(async () => { if (!jobId) { setD(null); return } setD(await api(`/es/jobs/${jobId}/log`)) }, [jobId])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = async (fn, ok) => { setError(''); setMsg(''); try { if ((await fn()) === false) return; setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const save = (e) => { e.preventDefault(); run(async () => { const body = { ...entry }; delete body.id; if (entry.id) await api(`/es/log/${entry.id}`, { method: 'PUT', body }); else await api(`/es/jobs/${jobId}/log`, { method: 'POST', body }); setEntry(null) }, 'Entry saved') }
  const j = d?.job
  const mine = (n) => !n.UserEntered || !me || n.UserEntered === me
  return (
    <div className="page">
      <PageHeader title="Job history log" subtitle="Dated notes per job (contracts, changes, conversations)"
        actions={jobId && <Link className="btn" to={`/es/reports?report=job-history&jobId=${jobId}`}><Printer size={15} /> Report</Link>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>Go to job</h2></div>
          <input type="search" aria-label="Search jobs" placeholder="Search job, customer or number…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {!jobs ? <SkeletonRows rows={8} cols={1} /> : (
            <div className="table-wrap" style={{ maxHeight: 560, overflow: 'auto' }}><table className="grid compact"><tbody>
              {jobs.map((r) => <tr key={r.PmJobID} className={`link-row${jobId === String(r.PmJobID) ? ' selected' : ''}`} onClick={() => setSp({ job: r.PmJobID })}><td className="wrap"><b>{r.Job}</b><div className="muted small">{r.Customer} · {r.DivisionId}</div></td><td className="num muted">{r.Entries || ''}</td></tr>)}
              {!jobs.length && <tr><td className="muted">No jobs match</td></tr>}
            </tbody></table></div>
          )}
        </section>
        <section className="panel span-2">
          {!jobId ? <EmptyState title="Choose a job" /> : !d ? <SkeletonRows rows={8} cols={3} /> : (
            <>
              <div className="panel-head"><h2>{j.Job}</h2><button className="btn small primary" onClick={() => setEntry({ ...toForm({}, LOG_FIELDS) })}><Plus size={13} /> New entry</button></div>
              <div className="form"><fieldset>
                {[['Customer', j.Customer], ['Job number', j.JobNumber], ['Job type', j.JobType], ['Division', j.DivisionId], ['Jurisdiction', j.Juris], ['Spec level', j.SpecLevel], ['Est start date', fmtDate(j.EstStartDate)], ['Est end date', fmtDate(j.EstEndDate)], ['Unit quantity', j.UnitQty], ['Status', j.Status], ['Template', yes(j.Template) ? 'Yes' : 'No']]
                  .map(([l, v]) => <label key={l}>{l}<input readOnly tabIndex={-1} value={v ?? ''} /></label>)}
                <label className="span3">Notes<input readOnly tabIndex={-1} value={j.Notes || ''} /></label>
              </fieldset></div>
              {entry && <FormCard legend={entry.id ? 'Edit entry' : 'New entry'} onSubmit={save} onCancel={() => setEntry(null)}><Fields fields={LOG_FIELDS} value={entry} onChange={setEntry} lk={lk} /></FormCard>}
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Date</th><th>User</th><th>Type</th><th>Title</th><th>Effective phase</th><th>Effective date</th><th>Notes</th><th /></tr></thead>
                <tbody>{d.entries.map((n) => (
                  <tr key={n.CmContractID}><td>{fmtDate(n.DateEntered)}</td><td>{n.UserEntered}</td><td>{n.Type}</td><td className="wrap"><b>{n.Description}</b></td><td>{n.EffectivePhase}</td><td>{fmtDate(n.EffectiveDate)}</td><td className="wrap">{n.Notes}</td>
                    <td className="row" style={{ gap: 4 }}>{mine(n) && <>
                      <button className="btn small icon" aria-label={`Edit entry ${n.Description || n.CmContractID}`} onClick={() => setEntry({ id: n.CmContractID, ...toForm(n, LOG_FIELDS) })}><Pencil size={12} /></button>
                      <button className="btn small icon" aria-label={`Delete entry ${n.Description || n.CmContractID}`} onClick={() => run(async () => { if (!confirm('Delete this entry?')) return false; await api(`/es/log/${n.CmContractID}`, { method: 'DELETE' }) }, 'Entry deleted')}><Trash2 size={12} /></button>
                    </>}</td></tr>
                ))}{!d.entries.length && <tr><td colSpan={8}><EmptyState title="No log entries for this job" /></td></tr>}</tbody>
              </table></div>
              <p className="muted small">You cannot edit somebody else's notes. Please create your own.</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
