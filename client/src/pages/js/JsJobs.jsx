// Jobs = Access subform JsJobSub (inside JsCustomer) + the phase list of the job (SwitchJSsubPhase).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarRange, HardHat, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, Warnings, changed, nextParams, statusTone, useConfirm, useDebounced, useJsLookups } from './shared'

export function JsJobs() {
  const nav = useNavigate()
  const lk = useJsLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp(nextParams(p, patch))
  useEffect(() => {
    setError('')
    api('/js/jobs', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useDebounced(search, (v) => { if (v !== (p.search || '')) set({ search: v }) })
  const open = (id) => nav(`/js/jobs/${id}`)
  return (
    <div className="page">
      <PageHeader title="Jobs" subtitle="Jobs per builder, linked to a Plan-management job"
        actions={<Link className="btn primary" to="/js/jobs/new"><Plus size={15} /> New job</Link>} />
      <JsTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job, builder, job # or city…" aria-label="Search jobs" /></div>
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={p.jobTypeId || ''} onChange={(e) => set({ jobTypeId: e.target.value })} aria-label="Job type"><option value="">All job types</option>{lk.jobTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div className="seg" role="group" aria-label="Status">{[['all', 'All'], ['active', 'Active'], ['inactive', 'Not active']].map(([v, l]) => (
          <button key={v} type="button" aria-pressed={(p.status || 'all') === v} className={`seg-btn${(p.status || 'all') === v ? ' active' : ''}`} onClick={() => set({ status: v === 'all' ? '' : v })}>{l}</button>))}</div>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Job</th><th>Builder</th><th>Div</th><th>Type</th><th>City</th><th>Status</th><th>Start</th><th className="num">Phases</th><th className="num">Lots</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.JobId} tabIndex={0} onClick={() => open(r.JobId)} onKeyDown={(e) => e.key === 'Enter' && open(r.JobId)} className={r.StatusId !== 1 ? 'dim' : ''}>
                  <td><b>{r.JobName}</b>{r.JobNum ? <span className="muted small"> #{r.JobNum}</span> : null}{r.WarningJS ? <span className="js-tag" title="Complex job warning">complex</span> : null}</td>
                  <td>{r.CustName}</td><td>{r.DivisionId}</td><td>{r.JobType}</td><td>{r.City}</td>
                  <td>{r.Status && <Badge tone={statusTone(r.Status)}>{r.Status}</Badge>}</td><td>{fmtDate(r.StartDate)}</td>
                  <td className="num">{r.Phases}</td><td className="num">{r.Lots}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={9}><EmptyState icon={HardHat} title="No jobs match">Try a different search or filter.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

const FIELDS = ['JobName', 'JobNum', 'DivisionId', 'JobTypeId', 'StatusId', 'PmJobId', 'JurisdictionId', 'LotQty', 'StartDate', 'EndDate', 'Address', 'City', 'State', 'Zip', 'WarningJS', 'Notes']
const EMPTY = { JobName: '', JobNum: '', DivisionId: '', JobTypeId: '', StatusId: '1', PmJobId: '', JurisdictionId: '', LotQty: '', StartDate: '', EndDate: '', Address: '', City: '', State: '', Zip: '', WarningJS: 'false', Notes: '' }

export function JsJobDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const lk = useJsLookups()
  const [dialog, ask] = useConfirm()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [builder, setBuilder] = useState(null) // { id, name } for a new job
  const [pm, setPm] = useState({ label: '', template: false })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [warnings, setWarnings] = useState([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (isNew) {
      setForm(EMPTY); setD(null)
      const b = sp.get('builder')
      if (b) { const r = await api(`/js/builders/${b}`); setBuilder({ id: r.builder.CustID, name: r.builder.CustName }) }
      return
    }
    const r = await api(`/js/jobs/${id}`)
    setD(r)
    const f = {}
    for (const k of FIELDS) f[k] = r.job[k] == null ? '' : k.endsWith('Date') ? toInputDate(r.job[k]) : String(r.job[k])
    setForm(f)
    setPm({ label: r.job.PmJob ? `${r.job.PmJob}${r.job.PmCustomer ? ' – ' + r.job.PmCustomer : ''}` : '', template: !!r.job.PmJobInactive })
  }, [id, isNew, sp])
  useEffect(() => { setError(''); load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })

  async function save(e) {
    e.preventDefault(); setError(''); setMsg(''); setWarnings([])
    const orig = d ? Object.fromEntries(FIELDS.map((k) => [k, d.job[k]])) : null
    const body = isNew ? { ...form } : changed(orig, form, FIELDS)
    if (isNew && !builder) { setError('Choose the builder this job belongs to'); return }
    if (!isNew && !Object.keys(body).length) { setMsg('Nothing changed'); return }
    // Access JsJobSub.PmJobId BeforeUpdate: two confirmations
    if ('PmJobId' in body && body.PmJobId !== '') {
      if (!isNew && d.job.PmJobId != null) {
        if (!(await ask({ title: 'Potential data integrity error', message: 'You are about to change the link between SC and PM for this job. Are you sure?', ok: 'Change link' }))) return
        body.confirmPmLink = true
      }
      if (pm.template) {
        if (!(await ask({ title: 'Inactive PM job', message: 'This job is INACTIVE. Are you sure you want to select it?', ok: 'Select it' }))) return
        body.confirmInactivePm = true
      }
    }
    setSaving(true)
    try {
      if (isNew) {
        const r = await api('/js/jobs', { method: 'POST', body: { ...body, CustId: builder.id } })
        nav(`/js/jobs/${r.id}`, { replace: true })
      } else {
        const r = await api(`/js/jobs/${id}`, { method: 'PUT', body })
        setWarnings(r.warnings || []); setMsg('Job saved'); await load()
      }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete job?', message: `Delete ${d.job.JobName}? This cannot be undone.`, ok: 'Delete', danger: true }))) return
    try { await api(`/js/jobs/${id}`, { method: 'DELETE' }); nav(`/js/builders/${d.job.CustId}`) } catch (err) { setError(err.message) }
  }

  const j = d?.job
  return (
    <div className="page">
      {dialog}
      <PageHeader track={!isNew && !!j}
        crumb={<><Link to="/js">Job setup</Link> / {j ? <Link to={`/js/builders/${j.CustId}`}>{j.CustName}</Link> : builder ? <Link to={`/js/builders/${builder.id}`}>{builder.name}</Link> : <Link to="/js/jobs">Jobs</Link>}</>}
        title={isNew ? 'New job' : j?.JobName || 'Job'}
        subtitle={j ? [j.DivisionName && `${j.DivisionId} – ${j.DivisionName}`, j.JobType, j.City].filter(Boolean).join(' · ') : null}
        actions={<>
          {j && <Link className="btn" to={`/sc/jobs/${id}`}><CalendarRange size={15} /> Open in Scheduling</Link>}
          <Link className="btn" to="/js/jobs"><ArrowLeft size={15} /> Jobs</Link>
        </>} />
      <JsTabs />
      {j?.WarningJS && <div className="banner"><AlertTriangle size={16} /> This is a complex job, make sure you select the appropriate bid for each lot.</div>}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      <Warnings list={warnings} />
      {!isNew && !d && !error ? <SkeletonRows rows={8} cols={3} /> : (isNew || d) && (
        <form className="card form" onSubmit={save} noValidate>
          <fieldset>
            <legend>Job</legend>
            <label className="span2">Builder *
              {isNew
                ? <SearchSelect endpoint="/js/pick/builders" value={builder?.id} label={builder?.name} placeholder="Search builder…" onSelect={(r) => setBuilder(r ? { id: r.id, name: r.name } : null)} />
                : <input value={j.CustName || ''} readOnly aria-readonly="true" />}
            </label>
            <label className="span2">Job name *<input required maxLength={50} {...f('JobName')} /></label>
            <label>Job num<input inputMode="numeric" {...f('JobNum')} /></label>
            <label>Division *<select required {...f('DivisionId')}><option value="" />{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Job type<select {...f('JobTypeId')}><option value="" />{lk.jobTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Status<select {...f('StatusId')}>{lk.statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="span2">PM job
              <SearchSelect endpoint="/js/pick/pm-jobs" value={form.PmJobId || null} label={pm.label} placeholder="Search Plan-management job…"
                onSelect={(r) => { setForm((s) => ({ ...s, PmJobId: r ? String(r.id) : '' })); setPm({ label: r?.name || '', template: !!r?.Template }) }} />
            </label>
            <label>Jurisdiction<select {...f('JurisdictionId')}><option value="" />{lk.jurisdictions.map((x) => <option key={x.id} value={x.id}>{x.name}{x.State ? ` (${x.State})` : ''}</option>)}</select></label>
            <label>Lot qty<input type="number" min="0" step="1" {...f('LotQty')} /></label>
            <label>Start date<input type="date" {...f('StartDate')} /></label>
            <label>End date<input type="date" {...f('EndDate')} /></label>
            <label className="check"><input type="checkbox" checked={form.WarningJS === 'true'} onChange={(e) => setForm((s) => ({ ...s, WarningJS: e.target.checked ? 'true' : 'false' }))} /> Warning popup (complex job)</label>
          </fieldset>
          <fieldset>
            <legend>Address</legend>
            <label className="span2">Address<input maxLength={255} {...f('Address')} /></label>
            <label>City<input maxLength={50} list="js-job-cities" {...f('City')} /></label>
            <label>State<input maxLength={2} placeholder="CA" {...f('State')} onChange={(e) => setForm((s) => ({ ...s, State: e.target.value.toUpperCase() }))} /></label>
            <label>Zip<input maxLength={20} {...f('Zip')} /></label>
            <label className="span3">Notes<textarea rows={2} maxLength={255} {...f('Notes')} /></label>
          </fieldset>
          <datalist id="js-job-cities">{lk.cities.map((c) => <option key={c.id} value={c.name}>{c.State}</option>)}</datalist>
          <div className="row form-actions">
            <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create job' : 'Save changes'}</button>
            {!isNew && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
            {j && <span className="muted small">Job ID {j.JobId} · entered {fmtDate(j.DateEntered)} by {j.UserEntered || '—'}</span>}
          </div>
        </form>
      )}
      {d && (
        <section className="card">
          <div className="panel-head"><h2>Phases ({d.phases.length})</h2><Link className="btn small primary" to={`/js/jobs/${id}/phases/new`}><Plus size={13} /> Add new phase</Link></div>
          {!d.phases.length ? <EmptyState title="No phases yet">Add a phase to choose the bid, superintendents and lots.</EmptyState> : (
            <div className="table-wrap flat">
              <table className="grid compact clickable">
                <thead><tr><th>Phase</th><th>Type</th><th>Bid</th><th>Superintendents</th><th>Start</th><th>End</th><th className="num">Lots</th><th className="num">Open lots</th></tr></thead>
                <tbody>{d.phases.map((p) => (
                  <tr key={p.PhaseID} tabIndex={0} onClick={() => nav(`/js/phases/${p.PhaseID}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/js/phases/${p.PhaseID}`)}>
                    <td><b>{p.Phase}</b>{p.PhaseNum && p.PhaseNum !== p.Phase ? <span className="muted small"> #{p.PhaseNum}</span> : null}</td><td>{p.PhaseType}</td>
                    <td>{p.BidNum ? `${p.BidNum}${p.BidRelease ? ' effective ' + p.BidRelease : ''}` : <Badge tone="amber">No bid</Badge>}</td>
                    <td>{[p.Super1, p.Super2].filter(Boolean).join(', ')}</td><td>{fmtDate(p.StartDate)}</td><td>{fmtDate(p.EndDate)}</td>
                    <td className="num">{p.Lots}</td><td className="num">{p.OpenLots}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
