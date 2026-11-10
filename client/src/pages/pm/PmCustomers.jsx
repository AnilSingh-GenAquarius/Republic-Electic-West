// Customer → job → bid setup (Access PmCustomer with its job and contract subforms).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Lock, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PmTabs, int, usePmLookups, yes } from './shared'

export function PmCustomers() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) }) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true; setD(null)
    api('/pm/customers', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  async function add(e) {
    e.preventDefault(); setError('')
    try { const r = await api('/pm/customers', { method: 'POST', body: { Customer: name } }); nav(`/pm/customers/${r.id}`) } catch (err) { setError(err.message) }
  }
  return (
    <div className="page">
      <PageHeader title="Customers & bids" subtitle="Customer → job → bid; open a bid to manage its plans, packs and material" />
      <PmTabs />
      <form className="filters" onSubmit={add}>
        <div className="search-wrap"><input type="search" aria-label="Search customers" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">{[['', 'All'], ['1', 'Active'], ['2', 'Inactive']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${(p.statusId || '') === k ? ' active' : ''}`} onClick={() => set({ statusId: k })}>{l}</button>)}</div>
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}><input aria-label="New customer name" placeholder="New customer name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /><button className="btn primary" disabled={!name.trim()}><Plus size={15} /> Add customer</button></span>
      </form>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={3} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Customer</th><th>Status</th><th className="num">Jobs</th><th>Notes</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.PmCustID} className="link-row" onClick={() => nav(`/pm/customers/${r.PmCustID}`)}><td><a><b>{r.Customer}</b></a></td><td><Badge tone={r.StatusId === 1 ? 'green' : 'neutral'}>{r.Status || '—'}</Badge></td><td className="num">{r.Jobs}</td><td className="wrap">{r.Notes}</td></tr>)}
              {!d.rows.length && <tr><td colSpan={4}><EmptyState title="No customers match" /></td></tr>}</tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const blankJob = { Job: '', DivisionId: '', JobTypeId: '', JobNumber: '', SpecLevel: '', JurisdictionId: '', StatusId: '1', Template: false, Notes: '' }
const blankBid = { BidNum: '', BidRelease: '', BidName: '', BidDate: new Date().toISOString().slice(0, 10), StatusId: '1', Notes: '' }

export function PmCustomer() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = usePmLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [job, setJob] = useState(null) // { id|null, ...fields }
  const [bid, setBid] = useState(null) // { id|null, jobId, ...fields }
  const [selJob, setSelJob] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const r = await api(`/pm/customers/${id}`); setD(r)
    setForm({ Customer: r.customer.Customer || '', StatusId: String(r.customer.StatusId ?? 1), Notes: r.customer.Notes || '' })
    setSelJob((s) => s ?? r.jobs[0]?.PmJobID ?? null)
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const save = run(async (e) => { e.preventDefault(); await api(`/pm/customers/${id}`, { method: 'PUT', body: form }) }, 'Customer saved')
  const remove = async () => { if (!confirm('Delete this customer?')) return; try { await api(`/pm/customers/${id}`, { method: 'DELETE' }); nav('/pm/customers') } catch (e) { setError(e.message) } }
  const saveJob = run(async (e) => { e.preventDefault(); const body = { ...job }; delete body.id; if (job.id) await api(`/pm/jobs/${job.id}`, { method: 'PUT', body }); else { const r = await api(`/pm/customers/${id}/jobs`, { method: 'POST', body }); setSelJob(r.id) } setJob(null) }, 'Job saved')
  const delJob = run(async (jid) => { if (confirm('Delete this job?')) { await api(`/pm/jobs/${jid}`, { method: 'DELETE' }); setSelJob(null) } })
  const saveBid = run(async (e) => { e.preventDefault(); const body = { ...bid }; delete body.id; delete body.jobId; if (bid.id) await api(`/pm/contracts/${bid.id}`, { method: 'PUT', body }); else await api(`/pm/jobs/${bid.jobId}/contracts`, { method: 'POST', body }); setBid(null) }, 'Bid saved')
  const delBid = run(async (bidId) => { if (confirm('Delete this bid?')) await api(`/pm/contracts/${bidId}`, { method: 'DELETE' }) })
  const jf = (k) => ({ value: job?.[k] ?? '', onChange: (e) => setJob((s) => ({ ...s, [k]: e.target.value })) })
  const bf = (k) => ({ value: bid?.[k] ?? '', onChange: (e) => setBid((s) => ({ ...s, [k]: e.target.value })) })
  const c = d?.customer
  const bids = d?.bids.filter((b) => b.PmJobId === selJob) || []
  const sj = d?.jobs.find((j) => j.PmJobID === selJob)
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/pm/customers">Customers &amp; bids</Link>} title={c ? c.Customer : 'Customer'} track={!!c} subtitle={c ? `${d.jobs.length} job(s) · ${d.bids.length} bid(s)` : null}
        actions={<><Link className="btn" to="/pm/customers"><ArrowLeft size={15} /> Customers</Link>{c && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}</>} />
      <PmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          <form className="card form" onSubmit={save}><fieldset>
            <legend>Customer</legend>
            <label className="span2">Name *<input maxLength={50} {...{ value: form.Customer, onChange: (e) => setForm({ ...form, Customer: e.target.value }) }} /></label>
            <label>Status<select value={form.StatusId} onChange={(e) => setForm({ ...form, StatusId: e.target.value })}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="span3">Notes<input maxLength={255} value={form.Notes} onChange={(e) => setForm({ ...form, Notes: e.target.value })} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div></form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Jobs</h2><button className="btn small primary" onClick={() => setJob({ ...blankJob })}><Plus size={13} /> Add job</button></div>
            {job && (
              <form className="card form pm-inline" onSubmit={saveJob}><fieldset>
                <legend>{job.id ? 'Edit job' : 'New job'}</legend>
                <label className="span2">Job *<input maxLength={50} aria-label="Job name" {...jf('Job')} /></label>
                <label>Division *<select aria-label="Job division" {...jf('DivisionId')}><option value="" />{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Job type *<select aria-label="Job type" {...jf('JobTypeId')}><option value="" />{lk.jobTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Job number<input maxLength={50} {...jf('JobNumber')} /></label>
                <label>Jurisdiction<select {...jf('JurisdictionId')}><option value="" />{lk.jurisdictions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Status<select {...jf('StatusId')}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="check"><input type="checkbox" checked={yes(job.Template) || job.Template === true} onChange={(e) => setJob({ ...job, Template: e.target.checked })} /> Template</label>
                <label className="span2">Spec level<input maxLength={255} {...jf('SpecLevel')} /></label>
                <label className="span3">Notes<input maxLength={255} {...jf('Notes')} /></label>
              </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save job</button><button type="button" className="btn" onClick={() => setJob(null)}><X size={15} /> Cancel</button></div></form>
            )}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Job</th><th>Div</th><th>Type</th><th>Number</th><th>Status</th><th className="num">Bids</th><th>In Job setup</th><th /></tr></thead>
              <tbody>{d.jobs.map((j) => (
                <tr key={j.PmJobID} className={`link-row${selJob === j.PmJobID ? ' selected' : ''}`} onClick={() => setSelJob(j.PmJobID)}>
                  <td><b>{j.Job}</b>{yes(j.Template) && <> <Badge>Template</Badge></>}</td><td>{j.DivisionId}</td><td>{j.JobType}</td><td>{j.JobNumber}</td><td>{j.Status}</td><td className="num">{j.Bids}</td><td>{j.ScJobs ? 'Yes' : ''}</td>
                  <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn small icon" aria-label={`Edit job ${j.Job}`} onClick={() => setJob({ id: j.PmJobID, Job: j.Job || '', DivisionId: j.DivisionId || '', JobTypeId: String(j.JobTypeId ?? ''), JobNumber: j.JobNumber || '', SpecLevel: j.SpecLevel || '', JurisdictionId: String(j.JurisdictionId ?? ''), StatusId: String(j.StatusId ?? 1), Template: yes(j.Template), Notes: j.Notes || '' })}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label={`Delete job ${j.Job}`} onClick={() => delJob(j.PmJobID)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}{!d.jobs.length && <tr><td colSpan={8}><EmptyState title="No jobs yet" /></td></tr>}</tbody>
            </table></div>
          </section>

          {sj && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Bids of {sj.Job}</h2><button className="btn small primary" onClick={() => setBid({ ...blankBid, jobId: sj.PmJobID })}><Plus size={13} /> Add bid</button></div>
              {bid && (
                <form className="card form pm-inline" onSubmit={saveBid}><fieldset>
                  <legend>{bid.id ? 'Edit bid' : 'New bid'}</legend>
                  <label>Bid number *<input maxLength={50} aria-label="Bid number" {...bf('BidNum')} /></label>
                  <label>Release / phase<input maxLength={50} {...bf('BidRelease')} /></label>
                  <label>Name<input maxLength={50} {...bf('BidName')} /></label>
                  <label>Bid date<input type="date" {...bf('BidDate')} /></label>
                  <label>Status<select {...bf('StatusId')}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <label className="span3">Notes<input maxLength={255} {...bf('Notes')} /></label>
                </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save bid</button><button type="button" className="btn" onClick={() => setBid(null)}><X size={15} /> Cancel</button></div></form>
              )}
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Bid</th><th>Release</th><th>Name</th><th>Date</th><th>Status</th><th className="num">Plans</th><th /><th /></tr></thead>
                <tbody>{bids.map((b) => (
                  <tr key={b.PmContractID} className="link-row" onClick={() => nav(`/pm/bids/${b.PmContractID}`)}>
                    <td><a><b>{b.BidNum}</b></a></td><td>{b.BidRelease}</td><td>{b.BidName}</td><td>{fmtDate(b.BidDate)}</td><td>{b.Status}</td><td className="num">{int(b.Plans)}</td>
                    <td>{b.Lock ? <Badge tone="amber" icon={Lock}>Locked</Badge> : null}</td>
                    <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn small icon" aria-label={`Edit bid ${b.BidNum}`} onClick={() => setBid({ id: b.PmContractID, BidNum: b.BidNum || '', BidRelease: b.BidRelease || '', BidName: b.BidName || '', BidDate: toInputDate(b.BidDate), StatusId: String(b.StatusId ?? 1), Notes: b.Notes || '' })}><Pencil size={13} /></button>
                      <button className="btn small icon" aria-label={`Delete bid ${b.BidNum}`} onClick={() => delBid(b.PmContractID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}{!bids.length && <tr><td colSpan={8}><EmptyState title="No bids for this job" /></td></tr>}</tbody>
              </table></div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
