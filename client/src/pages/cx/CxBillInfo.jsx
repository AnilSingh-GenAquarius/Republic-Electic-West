// Enter billing info (Access CxReqBillInfo + CxReqBillInfoDetail): Cox required billing information per lot —
// requisition #, PO #, Oracle project #, assessor job, admin specialist, project planner, material date, invoice.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Pencil, Save, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CxTabs, isoDay, useCxLookups } from './shared'

export default function CxBillInfo() {
  const lk = useCxLookups()
  const [sp, setSp] = useSearchParams()
  const jobId = sp.get('job') || ''
  const [jobs, setJobs] = useState(null)
  const [d, setD] = useState(null)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { api('/cx/billinfo/jobs').then(setJobs).catch((e) => setError(e.message)) }, [])
  useEffect(() => { const t = setTimeout(() => setSearch(q), 300); return () => clearTimeout(t) }, [q])
  const load = useCallback(async () => { if (!jobId) { setD(null); return } setD(await api(`/cx/billinfo/jobs/${jobId}`, { params: { search } })) }, [jobId, search])
  useEffect(() => { setD(null); load().catch((e) => setError(e.message)) }, [load])
  const start = (l) => setEdit({ id: l.LotID, LaborReqNum: l.LaborReqNum ?? '', LaborPoNum: l.LaborPoNum ?? '', OpExAccNum: l.OpExAccNum ?? '', InvoiceNum: l.InvoiceNum ?? '',
    AdminSpecialist: String(l.AdminSpecialist ?? ''), ProjPlanner: String(l.ProjPlanner ?? ''), AssessorId: String(l.AssessorId ?? ''), DateCoxMatReq: isoDay(l.DateCoxMatReq), CoxJobTypeId: String(l.CoxJobTypeId ?? '') })
  async function save() {
    setError(''); setMsg('')
    try { const body = { ...edit }; delete body.id; await api(`/cx/lots/${edit.id}`, { method: 'PUT', body }); setEdit(null); setMsg('Lot saved'); await load() } catch (e) { setError(e.message) }
  }
  const e = (k) => ({ value: edit[k], onChange: (ev) => setEdit({ ...edit, [k]: ev.target.value }) })
  const opt = (list) => [<option key="" value="">—</option>, ...list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]
  const j = d?.job
  return (
    <div className="page">
      <PageHeader title="Cox required billing information" subtitle="Go to a job (jobs with an assessor job name) and enter the RBI of its lots" />
      <CxTabs />
      <div className="filters">
        <label className="row" style={{ gap: 8 }}>Go to job
          <select aria-label="Go to job" value={jobId} onChange={(ev) => { setEdit(null); setMsg(''); setSp(ev.target.value ? { job: ev.target.value } : {}) }} style={{ minWidth: 320 }}>
            <option value="">Choose…</option>
            {(jobs || []).map((x) => <option key={x.JobId} value={x.JobId}>{x.Job} · {x.AssessorJob}{x.NoRbi ? ` · ${x.NoRbi} without RBI` : ''}</option>)}
          </select></label>
        {jobId && <div className="search-wrap"><input type="search" aria-label="Search address" placeholder="Filter by address or lot…" value={q} onChange={(ev) => setQ(ev.target.value)} /></div>}
      </div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {jobs && !jobs.length && <EmptyState title="No job has an assessor job name yet">Add assessor job names under Jobs &amp; plans first.</EmptyState>}
      {!jobId ? null : !d ? <SkeletonRows rows={8} cols={6} /> : (
        <section className="panel">
          <div className="panel-head"><h2>{j.JobName}</h2><span className="muted">Job assessor: <b>{j.FirstOfAssessorName}</b> · {d.lots.length} lot(s)</span></div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Lot</th><th>Address</th><th>Cox job</th><th>Job assessor</th><th>Date material</th><th>Requisition #</th><th>PO #</th><th>Oracle proj #</th><th>Admin</th><th>Planner</th><th>Invoice</th><th /></tr></thead>
            <tbody>
              {d.lots.map((l) => edit?.id === l.LotID ? (
                <tr key={l.LotID} className="editing">
                  <td>{[l.Lot, l.Block].filter(Boolean).join('/')}</td><td>{l.Address}</td>
                  <td><select aria-label="Cox job" {...e('CoxJobTypeId')}>{opt(lk.cxJobTypes)}</select></td>
                  <td><select aria-label="Job assessor" {...e('AssessorId')}>{opt(d.assessors)}</select></td>
                  <td><input type="date" className="cell-input" aria-label="Date material" {...e('DateCoxMatReq')} /></td>
                  <td><input className="cell-input" aria-label="Requisition number" {...e('LaborReqNum')} /></td>
                  <td><input className="cell-input" aria-label="PO number" maxLength={255} {...e('LaborPoNum')} /></td>
                  <td><input className="cell-input" aria-label="Oracle project number" maxLength={255} {...e('OpExAccNum')} /></td>
                  <td><select aria-label="Admin specialist" {...e('AdminSpecialist')}>{opt(lk.adminSpecs)}</select></td>
                  <td><select aria-label="Project planner" {...e('ProjPlanner')}>{opt(lk.planners)}</select></td>
                  <td><input className="cell-input" aria-label="Invoice" {...e('InvoiceNum')} /></td>
                  <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save lot" onClick={save}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
                </tr>
              ) : (
                <tr key={l.LotID}>
                  <td><b>{[l.Lot, l.Block].filter(Boolean).join('/')}</b></td><td>{l.Address}</td>
                  <td>{l.CoxJobType ? <Badge tone={l.CoxJobTypeId === 3 ? 'neutral' : 'blue'}>{l.CoxJobType}</Badge> : ''}</td>
                  <td>{l.AssessorName}</td><td>{fmtDate(l.DateCoxMatReq)}</td><td>{l.LaborReqNum}</td><td>{l.LaborPoNum}</td>
                  <td>{l.OpExAccNum || (l.DateCoxMatReq && !l.InvoiceNum ? <Badge tone="amber">No RBI</Badge> : '')}</td>
                  <td>{l.AdminSpec}</td><td>{l.ProjPlanName}</td><td>{l.InvoiceNum ? `Cox${l.InvoiceNum}` : ''}</td>
                  <td><button className="btn small icon" aria-label={`Edit lot ${l.Lot || l.LotID}`} onClick={() => start(l)}><Pencil size={13} /></button></td>
                </tr>
              ))}
              {!d.lots.length && <tr><td colSpan={12}><EmptyState title="No lots match" /></td></tr>}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  )
}
