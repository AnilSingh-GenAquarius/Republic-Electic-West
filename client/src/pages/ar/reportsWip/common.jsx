import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../api'
import { fmtDate } from '../../../format'
import { EmptyState, ErrorState, SkeletonRows } from '../../../components/ui'
import { download, money } from '../shared'
import './reports.css'

export const pctText = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${(Number(v) * 100).toFixed(1)}%`)
export const num = (v) => (v == null || v === '' ? null : Number(v))

// Loads GET /ar/reports/<key> whenever the params change.
export function useReport(key, params) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const sig = JSON.stringify(params || {})
  useEffect(() => {
    let live = true
    setState({ data: null, error: '', loading: true })
    const clean = Object.fromEntries(Object.entries(JSON.parse(sig)).filter(([, v]) => v !== '' && v != null))
    api(`/ar/reports/${key}`, { params: clean })
      .then((data) => live && setState({ data, error: '', loading: false }))
      .catch((e) => live && setState({ data: null, error: e.message || 'Could not load the report', loading: false }))
    return () => { live = false }
  }, [key, sig])
  return state
}

// Title block (report name, filter summary, printed time), CSV button, loading / error / empty states.
export function Frame({ state, title, lines = [], csv, empty = 'Nothing to show for these filters', isEmpty, children }) {
  const { data, error, loading } = state
  if (error) return <ErrorState message={error} />
  if (loading || !data) return <SkeletonRows rows={6} cols={6} />
  const blank = isEmpty ? isEmpty(data) : !data.rows?.length
  return (
    <div className="am-report print-doc arw">
      <div className="am-report-head arw-head">
        <div>
          <h2>{title || data.header?.title}</h2>
          {lines.filter(Boolean).map((l, i) => <p key={i} className="ar-sub">{l}</p>)}
          <p className="ar-sub">Printed {new Date().toLocaleString('en-US')}</p>
        </div>
        {csv && data.rows?.length > 0 && <button className="btn no-print" onClick={() => download(data.rows, csv.cols, csv.name)}><Download size={15} /> CSV</button>}
      </div>
      {blank ? <EmptyState title={empty} /> : children(data)}
    </div>
  )
}

export const burdenNote = (b) => `Profit data is gross and includes sales tax on material; labor values include burden ${Number(b || 0)}%`

// ---- WIP table: lots grouped by customer / job with sub totals, percentages recomputed from the sums (Access group footers) ----
const RATIOS = { LaborPercent: ['LaborPaid', 'LaborEst'], MaterialPercent: ['MaterialPosted', 'MaterialEst'], BillingPercent: ['Invoiced', 'ExtContractVal'], GEpct: ['ProfitEst', 'ExtContractVal'], GApct: ['ProfitActual', 'Invoiced'], GSpct: ['ProfitStd', 'StdContractVal'] }
function aggregate(rows, cols) {
  const t = {}
  for (const [k, , type] of cols) {
    if (type !== 'money') continue
    let s = 0; let any = false
    for (const r of rows) if (r[k] != null) { s += Number(r[k]); any = true }
    t[k] = any ? s : null
  }
  for (const [k, [a, b]] of Object.entries(RATIOS)) t[k] = t[a] == null || !t[b] ? null : t[a] / t[b]
  return t
}
const show = (v, type) => (type === 'money' ? (v == null ? '' : money(v)) : type === 'pct' ? pctText(v) : type === 'date' ? fmtDate(v) : v ?? '')

export function WipTable({ rows, cols, level = 2 }) {
  const nCol = cols.length
  const cells = (r, cls) => cols.map(([k, , type], i) => <td key={k} className={type === 'money' || type === 'pct' ? 'num' : ''}>{i === 0 && cls ? cls : show(r[k], type)}</td>)
  const out = []
  const custs = []
  for (const r of rows) {
    let c = custs.find((x) => x.name === r.CustName)
    if (!c) { c = { name: r.CustName, jobs: [] }; custs.push(c) }
    let j = c.jobs.find((x) => x.name === r.JobName)
    if (!j) { j = { name: r.JobName, rows: [] }; c.jobs.push(j) }
    j.rows.push(r)
  }
  const totalRow = (label, list, key, grand) => {
    const t = aggregate(list, cols)
    return (
      <tr key={key} className={grand ? 'subtotal arw-grand' : 'subtotal'}>
        {cols.map(([k, , type], i) => <td key={k} className={type === 'money' || type === 'pct' ? 'num' : ''}>{i === 0 ? <b>{label}</b> : <b>{show(t[k], type)}</b>}</td>)}
      </tr>
    )
  }
  for (const c of custs) {
    out.push(<tr key={`c${c.name}`} className="group-row"><td colSpan={nCol}><b>Work in progress for {c.name}</b></td></tr>)
    for (const j of c.jobs) {
      out.push(<tr key={`j${c.name}${j.name}`} className="group-row"><td colSpan={nCol}><b>{j.name}</b></td></tr>)
      j.rows.forEach((r) => out.push(<tr key={r.LotID}>{cells(r)}</tr>))
      if (level >= 2) out.push(totalRow(`Total for ${j.name}`, j.rows, `jt${c.name}${j.name}`))
    }
    out.push(totalRow(`Total for ${c.name}`, c.jobs.flatMap((j) => j.rows), `ct${c.name}`))
  }
  return (
    <div className="table-wrap arw-wide"><table className="grid compact">
      <thead><tr>{cols.map(([k, l, type]) => <th key={k} className={type === 'money' || type === 'pct' ? 'num' : ''}>{l}</th>)}</tr></thead>
      <tbody>{out}{totalRow('Total billing', rows, 'grand', true)}</tbody>
    </table></div>
  )
}

export function Plain({ rows, cols, total }) {
  return (
    <div className="table-wrap"><table className="grid compact">
      <thead><tr>{cols.map(([k, l, type]) => <th key={k} className={type === 'money' || type === 'num' ? 'num' : ''}>{l}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}>{cols.map(([k, , type]) => <td key={k} className={type === 'money' || type === 'num' ? 'num' : ''}>{type === 'money' ? (r[k] == null ? '' : money(r[k])) : type === 'date' ? fmtDate(r[k]) : r[k] ?? ''}</td>)}</tr>)}
        {total && <tr className="subtotal">{cols.map(([k, , type], i) => <td key={k} className={type === 'money' || type === 'num' ? 'num' : ''}>{i === 0 ? <b>{total.label}</b> : total.values[k] !== undefined ? <b>{money(total.values[k])}</b> : ''}</td>)}</tr>}
      </tbody>
    </table></div>
  )
}

export const Sec = ({ title, children }) => <section className="arw-sec"><h3>{title}</h3>{children}</section>
