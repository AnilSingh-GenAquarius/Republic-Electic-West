import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Search, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PrTabs, money, usePrLookups } from './shared'

export function Employees() {
  const nav = useNavigate()
  const lk = usePrLookups()
  const [sp, setSp] = useSearchParams()
  const params = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(params.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp({ ...params, page: 1, ...patch })

  useEffect(() => {
    api('/pr/employees', { params: { status: 'active', ...params, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (params.search || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <div className="page">
      <PageHeader title="Employees" subtitle="Employee list with title, pay type and last payroll"
        actions={<Link className="btn primary" to="/pr/employees/new"><Plus size={15} /> Add employee</Link>} />
      <PrTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or employee #…" aria-label="Search employees" /></div>
        <div className="seg">
          {[['active', 'Active'], ['terminated', 'Terminated'], ['all', 'All']].map(([v, l]) => (
            <button key={v} className={`seg-btn${(params.status || 'active') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>
          ))}
        </div>
        <select value={params.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division">
          <option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={params.titleId || ''} onChange={(e) => set({ titleId: e.target.value })} aria-label="Title">
          <option value="">All titles</option>{lk.titles.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={params.sort || 'name'} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
          <option value="name">Sort: name</option><option value="num">Employee #</option><option value="hire">Newest hire</option><option value="last">Last paid</option>
        </select>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Emp #</th><th>Name</th><th>Division</th><th>Title</th><th>Pay type</th><th>Hired</th><th>Last paid</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.EmployeeID} onClick={() => nav(`/pr/employees/${r.EmployeeID}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/pr/employees/${r.EmployeeID}`)}>
                  <td>{r.EmployeeNum}</td><td><b>{r.LName}, {r.FName}{r.MInitial ? ` ${r.MInitial}` : ''}</b></td><td>{r.DivisionId}</td><td>{r.Title}</td><td>{r.PayType}</td>
                  <td>{fmtDate(r.DateHire)}</td><td>{fmtDate(r.LastPaid)}</td>
                  <td>{r.DateTermination ? <Badge>Terminated {fmtDate(r.DateTermination)}</Badge> : <Badge tone="green">Active</Badge>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={8}><EmptyState icon={Users} title="No employees match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setSp({ ...params, page: p })} />}
    </div>
  )
}

const EMPTY = { EmployeeNum: '', FName: '', MInitial: '', LName: '', DivisionId: '', DateHire: '', DateTermination: '', TitleId: '', PayTypeId: '', HourlyRate: '', WagesRate: '', Salary: '', DefaultScheduleStageId: '', Notes: '' }

export function EmployeeDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = usePrLookups()
  const [form, setForm] = useState(EMPTY)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (isNew) {
      const { employeeNum } = await api('/pr/employees-next-number')
      setForm({ ...EMPTY, EmployeeNum: employeeNum, DateHire: new Date().toISOString().slice(0, 10) })
      return
    }
    const d = await api(`/pr/employees/${id}`)
    const e = { ...EMPTY }
    for (const k of Object.keys(EMPTY)) e[k] = d.employee[k] ?? ''
    e.DateHire = toInputDate(d.employee.DateHire); e.DateTermination = toInputDate(d.employee.DateTermination)
    setForm(e); setInfo(d)
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })

  async function save(e) {
    e.preventDefault(); setSaving(true); setError(''); setMsg('')
    try {
      const body = { ...form }
      for (const k of ['TitleId', 'PayTypeId', 'DefaultScheduleStageId']) body[k] = body[k] ? parseInt(body[k], 10) : null
      if (isNew) {
        const r = await api('/pr/employees', { method: 'POST', body })
        nav(`/pr/employees/${r.id}`, { replace: true })
      } else {
        await api(`/pr/employees/${id}`, { method: 'PUT', body }); setMsg('Saved'); await load()
      }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const name = info ? `${info.employee.FName} ${info.employee.LName}` : ''
  return (
    <div className="page">
      <PageHeader crumb={<><Link to="/pr">Payroll</Link> / <Link to="/pr/employees">Employees</Link></>}
        title={isNew ? 'Add employee' : name || 'Employee'} track={!isNew && !!info}
        subtitle={info ? `Emp # ${info.employee.EmployeeNum || '—'} · ${info.employee.DivisionId || 'no division'}` : null}
        actions={<Link className="btn" to="/pr/employees"><ArrowLeft size={15} /> Employees</Link>} />

      {info && (
        <div className="kpis">
          <StatCard label="Total paid (all time)" tone="green" value={money(info.totals.pay)} foot={`${info.totals.lines} labor lines`} />
          <StatCard label="First paid" value={fmtDate(info.totals.firstPaid) || '—'} foot="Earliest payroll date" />
          <StatCard label="Last paid" value={fmtDate(info.totals.lastPaid) || '—'} foot={form.DateTermination ? `Terminated ${fmtDate(form.DateTermination)}` : 'Active employee'} />
        </div>
      )}

      <form className="card form" onSubmit={save}>
        <fieldset>
          <legend>Employee</legend>
          <label>Employee #<input maxLength={50} {...f('EmployeeNum')} /></label>
          <label>First name *<input required maxLength={50} {...f('FName')} /></label>
          <label>Middle initial<input maxLength={50} {...f('MInitial')} /></label>
          <label>Last name *<input required maxLength={50} {...f('LName')} /></label>
          <label>Division
            <select {...f('DivisionId')}><option value="" />{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Title
            <select {...f('TitleId')}><option value="" />{lk.titles.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Hire date<input type="date" {...f('DateHire')} /></label>
          <label>Termination date<input type="date" {...f('DateTermination')} /></label>
        </fieldset>
        <fieldset>
          <legend>Pay</legend>
          <label>Pay type
            <select {...f('PayTypeId')}><option value="" />{lk.payTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Amount per hour<input inputMode="decimal" maxLength={50} {...f('HourlyRate')} /></label>
          <label>Wages rate<input maxLength={50} {...f('WagesRate')} /></label>
          <label>Salary<input maxLength={50} {...f('Salary')} /></label>
          <label>Default stage
            <select {...f('DefaultScheduleStageId')}><option value="" />{lk.scheduleStages.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label className="span3">Notes<textarea rows={2} maxLength={255} {...f('Notes')} /></label>
        </fieldset>
        {error && <ErrorState message={error} />}
        {msg && <div className="ok">{msg}</div>}
        <div className="row form-actions">
          <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Add employee' : 'Save changes'}</button>
          {info && <span className="muted small">Entered {fmtDate(info.employee.DateEntered)} by {info.employee.UserEntered || '—'}</span>}
        </div>
      </form>

      {info && (
        <section className="panel">
          <div className="panel-head"><h2>Recent payrolls</h2><Link className="panel-link" to={`/pr/reports?employeeId=${id}&groupBy=payroll&name=${encodeURIComponent(name)}`}>All labor paid</Link></div>
          {!info.recentPayrolls.length ? <p className="muted small">Never paid.</p> : (
            <table className="grid compact"><thead><tr><th>Payroll date</th><th className="num">Lines</th><th className="num">Hours</th><th className="num">Pay</th></tr></thead>
              <tbody>{info.recentPayrolls.map((r) => {
                const ds = String(r.PayrollDate).slice(0, 10)
                return <tr key={ds} className="link-row" onClick={() => nav(`/pr/reports?employeeId=${id}&from=${ds}&to=${ds}&view=detail&name=${encodeURIComponent(name)}`)}>
                  <td><a>{fmtDate(r.PayrollDate)}</a></td><td className="num">{r.lines}</td><td className="num">{Number(r.hours || 0).toLocaleString()}</td><td className="num">{money(r.pay)}</td></tr>
              })}</tbody></table>
          )}
        </section>
      )}
    </div>
  )
}
