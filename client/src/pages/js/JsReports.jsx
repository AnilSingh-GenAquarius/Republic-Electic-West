// Job setup reports = the report buttons of Access SwitchJS (filters A = builder, B = job, C/D = from/to dates).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, download, nextParams, useJsLookups } from './shared'

const REPORTS = [
  { id: 'jobs-alphabetical', label: 'Jobs alphabetical', needs: [] },
  { id: 'new-lots', label: 'Newly created lots', needs: ['from', 'to'] },
  { id: 'lots-by-start-date', label: 'Lots by start date', needs: ['from', 'to'] },
  { id: 'builder-lots', label: "Builder's job/lot list", needs: ['builderId'] },
  { id: 'lots-per-bid', label: 'Lots per bid', needs: ['builderId', 'jobId'] },
  { id: 'job-lots', label: "Job's lot list", needs: ['jobId'] },
]
const HELP = {
  'jobs-alphabetical': 'Every job with its builder, status and the high-voltage superintendent of its latest phase. Builders named "Test…" are left out.',
  'new-lots': 'Lots created between the two dates (both days included).',
  'lots-by-start-date': 'Lots whose phase starts between the two dates.',
  'builder-lots': 'All lots of every job of one builder.',
  'lots-per-bid': 'Lots of one job, grouped by the Plan-management bid of their phase.',
  'job-lots': 'All lots of one job with the last trim delivery date (work type 2/3, schedule stage 3).',
}
const isDateKey = (k) => /Date$|Start$|DateEntered$/.test(k)
const cell = (k, v) => (v == null ? '' : isDateKey(k) && typeof v === 'string' ? fmtDate(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

export default function JsReports() {
  const lk = useJsLookups()
  const [sp, setSp] = useSearchParams()
  const p = { r: 'jobs-alphabetical', ...Object.fromEntries(sp.entries()) }
  const rep = REPORTS.find((x) => x.id === p.r) || REPORTS[0]
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp(nextParams(p, patch))
  const missing = rep.needs.filter((k) => !p[k])

  useEffect(() => {
    setData(null); setError('')
    if (missing.length) return
    const params = { from: p.from, to: p.to, builderId: p.builderId, jobId: p.jobId, division: p.division, all: p.all }
    api(`/js/reports/${rep.id}`, { params }).then((d) => setData({ ...d, _r: rep.id })).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])

  const ready = data && data._r === rep.id
  const exportCsv = () => ready && download(data.rows, data.columns.map((c) => [c.key, c.label]), `${rep.id}.csv`)
  const needLabel = { from: 'a from date', to: 'a to date', builderId: 'a builder', jobId: 'a job' }

  return (
    <div className="page">
      <PageHeader title="Job setup reports" subtitle={HELP[rep.id]}
        actions={<><button className="btn" onClick={exportCsv} disabled={!ready || !data.rows.length}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()} disabled={!ready}><Printer size={15} /> Print</button></>} />
      <JsTabs />
      <div className="filters">
        <select value={rep.id} onChange={(e) => set({ r: e.target.value })} aria-label="Report">{REPORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        {rep.id === 'jobs-alphabetical' && <>
          <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <label className="check"><input type="checkbox" checked={p.all === '1'} onChange={(e) => set({ all: e.target.checked ? '1' : '' })} /> Include jobs without a phase / superintendent</label>
        </>}
        {rep.needs.includes('from') && <>
          <label className="inline">From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={{ width: 160 }} /></label>
          <label className="inline">To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={{ width: 160 }} /></label>
        </>}
        {rep.needs.includes('builderId') && (
          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
            <SearchSelect endpoint="/js/pick/builders" value={p.builderId || null} label={p.builderName || ''} placeholder="Choose builder…"
              onSelect={(r) => set({ builderId: r ? String(r.id) : '', builderName: r ? r.name : '', ...(rep.needs.includes('jobId') ? { jobId: '', jobName: '' } : {}) })} />
          </div>
        )}
        {rep.needs.includes('jobId') && (
          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
            <SearchSelect endpoint="/js/pick/jobs" params={rep.needs.includes('builderId') && p.builderId ? { builderId: p.builderId } : undefined}
              value={p.jobId || null} label={p.jobName || ''} placeholder="Choose job…" disabled={rep.needs.includes('builderId') && !p.builderId}
              onSelect={(r) => set({ jobId: r ? String(r.id) : '', jobName: r ? r.name : '' })} />
          </div>
        )}
      </div>
      {error && <ErrorState message={error} />}
      {missing.length ? (
        <EmptyState icon={ClipboardList} title={`Choose ${missing.map((k) => needLabel[k]).join(' and ')}`}>This report needs {missing.map((k) => needLabel[k]).join(' and ')} before it can run.</EmptyState>
      ) : !ready ? (!error && <SkeletonRows rows={8} cols={5} />) : (
        <>
          <h2 className="js-report-title">{data.title} <span className="muted small">· {data.total} row(s){data.truncated ? ' (first 20,000 shown)' : ''}</span></h2>
          <div className="table-wrap">
            <table className="grid compact">
              <thead><tr><th className="num">#</th>{data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r, i) => <tr key={i}><td className="num muted">{i + 1}</td>{data.columns.map((c) => <td key={c.key}>{cell(c.key, r[c.key])}</td>)}</tr>)}
                {!data.rows.length && <tr><td colSpan={data.columns.length + 1}><EmptyState icon={ClipboardList} title="Nothing to report">No rows match these filters.</EmptyState></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
