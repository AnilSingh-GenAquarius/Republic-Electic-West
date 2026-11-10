// Scheduling reports: stages by date / overdue (JsScheduleStdPack2, JsUpComingSchedules), lot backlog (ScLotBacklog), pack search (ScPackSearchWord).
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, PackageSearch, Printer, Search } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { ScTabs, lotName, useScLookups } from './shared'

const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }

function csv(rows, cols, name) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(r[k] instanceof Date ? iso(r[k]) : typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[k]) ? r[k].slice(0, 10) : r[k])).join(','))].join('\r\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

export function ScSchedule({ overdue = false }) {
  const nav = useNavigate()
  const lk = useScLookups()
  const [sp, setSp] = useSearchParams()
  const defaults = overdue ? { status: 'overdue' } : { status: 'open', from: iso(new Date()), to: addDays(14) }
  const p = { ...defaults, ...Object.fromEntries(sp.entries()) }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => {
    setError(''); setData(null)
    api('/sc/schedule', { params: { ...p, pageSize: 50 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), overdue])

  async function exportCsv() {
    const r = await api('/sc/schedule', { params: { ...p, pageSize: 200, page: 1 } })
    csv(r.rows, [['DeliveryDate', 'Delivery'], ['DivisionId', 'Division'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Block', 'Block'], ['PlanNum', 'Plan'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work type'], ['CustName', 'Builder']], `schedule-${p.from || 'all'}.csv`)
  }

  return (
    <div className="page">
      <PageHeader title={overdue ? 'Overdue stages' : 'Schedule by date'}
        subtitle={overdue ? 'Stages past their delivery date that have not been posted' : 'Stages by delivery date — the schedule by stage / date and upcoming schedule reports'}
        actions={<><button className="btn" onClick={exportCsv}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <ScTabs />
      <div className="card form report-filters"><fieldset>
        {!overdue && <>
          <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
          <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
          <label>Show
            <select value={p.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="open">Not yet posted</option><option value="overdue">Overdue only</option><option value="posted">Posted</option><option value="all">Everything</option>
            </select>
          </label>
        </>}
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Stage<select value={p.scheduleStageId || ''} onChange={(e) => set({ scheduleStageId: e.target.value })}><option value="">All</option>{lk.scheduleStages.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Work type<select value={p.workId || ''} onChange={(e) => set({ workId: e.target.value })}><option value="">All</option>{lk.workTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Search<div className="search-wrap" style={{ minWidth: 0 }}><Search size={15} /><input defaultValue={p.search || ''} onKeyDown={(e) => e.key === 'Enter' && set({ search: e.target.value })} onBlur={(e) => e.target.value !== (p.search || '') && set({ search: e.target.value })} placeholder="Job, builder, address, lot" /></div></label>
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {!data ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <div className="kpis">
            <StatCard label="Stages" tone={overdue || p.status === 'overdue' ? 'red' : 'blue'} value={data.total} foot={p.from ? `${fmtDate(p.from)} – ${fmtDate(p.to) || 'open ended'}` : 'All dates'} />
            {data.summary.slice(0, 3).map((s) => <StatCard key={s.ScheduleStage + s.WorkType} label={`${s.ScheduleStage} · ${s.WorkType}`} value={s.n} foot="stages in range" />)}
          </div>
          <div className="table-wrap">
            <table className="grid clickable">
              <thead><tr><th>Delivery</th><th>Job</th><th>Lot</th><th>Plan</th><th>Stage</th><th>Work type</th><th>Builder</th><th>Div</th><th>Status</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.StageAutoID} onClick={() => nav(`/sc/lots/${r.LotID}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/sc/lots/${r.LotID}`)}>
                    <td>{fmtDate(r.DeliveryDate)}</td><td>{r.JobName}</td><td><b>{lotName(r)}</b></td><td>{r.PlanNum}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td><td>{r.CustName}</td><td>{r.DivisionId}</td>
                    <td>{r.DatePosted ? <Badge tone="green">Posted</Badge> : r.DaysOverdue > 0 ? <Badge tone="red">{r.DaysOverdue} d overdue</Badge> : <Badge tone="amber">Scheduled</Badge>}</td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={9}><EmptyState title={overdue ? 'Nothing overdue' : 'No stages in this range'} /></td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...Object.fromEntries(sp.entries()), page: pg })} />
        </>
      )}
    </div>
  )
}

export function ScBacklog() {
  const nav = useNavigate()
  const lk = useScLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => {
    setData(null); setError('')
    if (p.jobId && p.scheduleStageId) api('/sc/backlog', { params: p }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Lot scheduling backlog" subtitle="Which lots of a job still have no date for a stage" />
      <ScTabs />
      <div className="card form"><fieldset>
        <label className="span2">Job *<SearchSelect endpoint="/common/jobs" value={p.jobId} label={p.jobName} placeholder="Search job…" onSelect={(r) => set({ jobId: r?.id, jobName: r?.name })} /></label>
        <label>Stage *<select value={p.scheduleStageId || ''} onChange={(e) => set({ scheduleStageId: e.target.value })}><option value="" />{lk.scheduleStages.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={p.includeClosed === '1'} onChange={(e) => set({ includeClosed: e.target.checked ? '1' : '' })} /> Include closed lots</label>
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {!p.jobId || !p.scheduleStageId ? <EmptyState title="Choose a job and a stage">The report lists every lot of the job with its date for that stage.</EmptyState> : !data ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <div className="kpis">
            <StatCard label="Lots" value={data.summary.lots} foot="Active lots in the job" />
            <StatCard label="Not scheduled" tone={data.summary.notScheduled ? 'amber' : 'green'} value={data.summary.notScheduled} foot="No date for this stage yet" />
          </div>
          <div className="table-wrap">
            <table className="grid clickable">
              <thead><tr><th>Phase</th><th>Lot</th><th>Plan</th><th>Address</th><th>Work type</th><th>Delivery</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map((r, i) => (
                <tr key={`${r.LotID}-${i}`} onClick={() => nav(`/sc/lots/${r.LotID}`)} tabIndex={0}>
                  <td>{r.Phase}</td><td><b>{lotName(r)}</b></td><td>{r.PlanNum}</td><td>{[r.Address, r.City].filter(Boolean).join(', ')}</td><td>{r.WorkType}</td><td>{fmtDate(r.DeliveryDate)}</td>
                  <td>{r.Status === 'Not scheduled' ? <Badge tone="amber">Not scheduled</Badge> : r.Status === 'Posted' ? <Badge tone="green">Posted</Badge> : <Badge tone="blue">Scheduled</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function ScPackSearch() {
  const lk = useScLookups()
  const [q, setQ] = useState('')
  const [division, setDivision] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); return }
    const t = setTimeout(() => api('/sc/pack-search', { params: { q, division } }).then((d) => setRows(d.rows)).catch((e) => setError(e.message)), 300)
    return () => clearTimeout(t)
  }, [q, division])
  return (
    <div className="page">
      <PageHeader title="Pack search" subtitle="Find packs by words in their name and see how many open lots have them scheduled" />
      <ScTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Key words, e.g. “ceiling fan”" aria-label="Pack key words" /></div>
        <select value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Pack</th><th>Type</th><th className="num">Open lots</th><th className="num">Total qty</th><th className="num">Not yet posted</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => <tr key={r.PackName}><td className="wrap">{r.PackName}</td><td>{r.PackType}</td><td className="num">{r.Lots}</td><td className="num">{r.Qty}</td><td className="num">{r.Unposted || <span className="faint">0</span>}</td></tr>)}
            {rows && !rows.length && <tr><td colSpan={5}><EmptyState icon={PackageSearch} title="No packs scheduled with those words" /></td></tr>}
            {!rows && <tr><td colSpan={5}><EmptyState icon={PackageSearch} title="Type at least two letters">All words must appear in the pack name.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>Open the lot from <Link to="/sc">Scheduling</Link> to change quantities.</p>
    </div>
  )
}
