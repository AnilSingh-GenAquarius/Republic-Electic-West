// Customer → job → estimating bid setup (Access EsCustomer with EsCustomerSubJob and EsCustomerSubBid).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { BID_TABS, BID_FIELDS, EsTabs, FormCard, JOB_FIELDS, TabbedFields, Fields, int, toForm, useEsLookups, yes } from './shared'

export function EsCustomers() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null)
    api('/es/customers', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  async function add(e) {
    e.preventDefault(); setError('')
    try { const r = await api('/es/customers', { method: 'POST', body: { Customer: name } }); nav(`/es/customers/${r.id}`) } catch (err) { setError(err.message) }
  }
  return (
    <div className="page">
      <PageHeader title="Customer – job – bid setup" subtitle="Customers, their jobs and the estimating bids of each job" />
      <EsTabs />
      <form className="filters" onSubmit={add}>
        <div className="search-wrap"><input type="search" aria-label="Search customers" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">{[['', 'All'], ['1', 'Active'], ['2', 'Inactive']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${(p.statusId || '') === k ? ' active' : ''}`} onClick={() => set({ statusId: k })}>{l}</button>)}</div>
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}><input aria-label="New customer name" placeholder="New customer name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /><button className="btn primary" disabled={!name.trim()}><Plus size={15} /> New customer</button></span>
      </form>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={3} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Customer</th><th>Status</th><th className="num">Jobs</th><th className="num">Estimating bids</th><th>Notes</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.PmCustID} className="link-row" onClick={() => nav(`/es/customers/${r.PmCustID}`)}><td><a><b>{r.Customer}</b></a></td><td><Badge tone={r.StatusId === 1 ? 'green' : 'neutral'}>{r.Status || '—'}</Badge></td><td className="num">{r.Jobs}</td><td className="num">{r.Bids || ''}</td><td className="wrap">{r.Notes}</td></tr>)}
              {!d.rows.length && <tr><td colSpan={5}><EmptyState title="No customers match" /></td></tr>}</tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const blankJob = () => ({ ...toForm({}, JOB_FIELDS), StatusId: '1' })
const blankBid = (n) => ({ ...toForm({}, BID_FIELDS), BidNum: String(n), Date: new Date().toISOString().slice(0, 10), StatusId: '1', ContLaborValue: '0' })

export function EsCustomer() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useEsLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [job, setJob] = useState(null) // { id|null, ...fields }
  const [bid, setBid] = useState(null) // { id|null, jobId, ...fields }
  const [selJob, setSelJob] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const r = await api(`/es/customers/${id}`); setD(r)
    setForm({ Customer: r.customer.Customer || '', StatusId: String(r.customer.StatusId ?? 1), Notes: r.customer.Notes || '' })
    setSelJob((s) => s ?? r.jobs[0]?.PmJobID ?? null)
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const save = run(async (e) => { e.preventDefault(); await api(`/es/customers/${id}`, { method: 'PUT', body: form }) }, 'Customer saved')
  const remove = async () => { if (!confirm('Delete this customer?')) return; try { await api(`/es/customers/${id}`, { method: 'DELETE' }); nav('/es/customers') } catch (e) { setError(e.message) } }
  const saveJob = run(async (e) => { e.preventDefault(); const body = { ...job }; delete body.id; if (job.id) await api(`/es/jobs/${job.id}`, { method: 'PUT', body }); else { const r = await api(`/es/customers/${id}/jobs`, { method: 'POST', body }); setSelJob(r.id) } setJob(null) }, 'Job saved')
  const delJob = run(async (jid) => { if (confirm('Delete this job?')) { await api(`/es/jobs/${jid}`, { method: 'DELETE' }); setSelJob(null) } })
  const saveBid = run(async (e) => { e.preventDefault(); const body = { ...bid }; delete body.id; delete body.jobId; if (bid.id) await api(`/es/bids/${bid.id}`, { method: 'PUT', body }); else await api(`/es/jobs/${bid.jobId}/bids`, { method: 'POST', body }); setBid(null) }, 'Bid saved')
  const delBid = run(async (bidId) => { if (confirm('Delete this estimating bid?')) await api(`/es/bids/${bidId}`, { method: 'DELETE' }) })
  const c = d?.customer
  const bids = d?.bids.filter((b) => b.PmJobId === selJob) || []
  const sj = d?.jobs.find((j) => j.PmJobID === selJob)
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/es/customers">Customers &amp; bids</Link>} title={c ? c.Customer : 'Customer'} track={!!c} subtitle={c ? `${d.jobs.length} job(s) · ${d.bids.length} estimating bid(s)` : null}
        actions={<><Link className="btn" to="/es/customers"><ArrowLeft size={15} /> Customers</Link>{c && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}</>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          <form className="card form" onSubmit={save}><fieldset>
            <legend>Customer</legend>
            <label className="span2">Customer *<input maxLength={50} aria-label="Customer name" value={form.Customer} onChange={(e) => setForm({ ...form, Customer: e.target.value })} /></label>
            <label>Status<select aria-label="Customer status" value={form.StatusId} onChange={(e) => setForm({ ...form, StatusId: e.target.value })}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="span3">Notes<input maxLength={255} aria-label="Customer notes" value={form.Notes} onChange={(e) => setForm({ ...form, Notes: e.target.value })} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div></form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Jobs</h2><button className="btn small primary" onClick={() => setJob(blankJob())}><Plus size={13} /> New job</button></div>
            {job && <FormCard legend={job.id ? 'Edit job' : 'New job'} onSubmit={saveJob} onCancel={() => setJob(null)} saveLabel="Save job"><Fields fields={JOB_FIELDS} value={job} onChange={setJob} lk={lk} /></FormCard>}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Job</th><th>Div</th><th>Type</th><th>Number</th><th>City</th><th>Est start</th><th className="num">Units</th><th>Status</th><th className="num">Bids</th><th /></tr></thead>
              <tbody>{d.jobs.map((j) => (
                <tr key={j.PmJobID} className={`link-row${selJob === j.PmJobID ? ' selected' : ''}`} onClick={() => setSelJob(j.PmJobID)}>
                  <td><b>{j.Job}</b>{yes(j.Template) && <> <Badge>Template</Badge></>}</td><td>{j.DivisionId}</td><td>{j.JobType}</td><td>{j.JobNumber}</td><td>{[j.City, j.State].filter(Boolean).join(', ')}</td><td>{fmtDate(j.EstStartDate)}</td><td className="num">{j.UnitQty ?? ''}</td><td>{j.Status}</td><td className="num">{j.Bids}</td>
                  <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn small icon" aria-label={`Edit job ${j.Job}`} onClick={() => setJob({ id: j.PmJobID, ...toForm(j, JOB_FIELDS) })}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label={`Delete job ${j.Job}`} onClick={() => delJob(j.PmJobID)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}{!d.jobs.length && <tr><td colSpan={10}><EmptyState title="No jobs yet" /></td></tr>}</tbody>
            </table></div>
          </section>

          {sj && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Estimating bids of {sj.Job}</h2><button className="btn small primary" onClick={() => setBid({ ...blankBid(bids.reduce((m, b) => Math.max(m, b.BidNum || 0), 0) + 1), jobId: sj.PmJobID })}><Plus size={13} /> New bid</button></div>
              {bid && <FormCard legend={bid.id ? 'Edit bid' : 'New bid'} onSubmit={saveBid} onCancel={() => setBid(null)} saveLabel="Save bid"><TabbedFields tabs={BID_TABS} value={bid} onChange={setBid} lk={lk} /></FormCard>}
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Bid</th><th>Date</th><th>Effective release</th><th>Recipient</th><th>Estimator</th><th className="num">Tax %</th><th className="num">O/H %</th><th className="num">Profit %</th><th className="num">Plans</th><th>PM bid</th><th>Status</th><th /></tr></thead>
                <tbody>{bids.map((b) => (
                  <tr key={b.EsBidID} className="link-row" onClick={() => nav(`/es/bids/${b.EsBidID}`)}>
                    <td><a><b>{b.BidNum}</b></a></td><td>{fmtDate(b.Date)}</td><td>{b.EffectiveRelease}</td><td>{b.Recipient}</td><td>{b.Estimator}</td><td className="num">{b.TaxPercent ?? ''}</td><td className="num">{b.OverheadPercent ?? ''}</td><td className="num">{b.ProfitPercent ?? ''}</td><td className="num">{int(b.Plans)}</td><td>{b.PmBid || '—'}</td><td>{b.Status}</td>
                    <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <Link className="btn small" to={`/es/bids/${b.EsBidID}`}>Assemblies</Link><Link className="btn small" to={`/es/bids/${b.EsBidID}/material`}>Material</Link>
                      <button className="btn small icon" aria-label={`Edit bid ${b.BidNum}`} onClick={() => setBid({ id: b.EsBidID, ...toForm(b, BID_FIELDS) })}><Pencil size={13} /></button>
                      <button className="btn small icon" aria-label={`Delete bid ${b.BidNum}`} onClick={() => delBid(b.EsBidID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}{!bids.length && <tr><td colSpan={12}><EmptyState title="No estimating bids for this job" /></td></tr>}</tbody>
              </table></div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
