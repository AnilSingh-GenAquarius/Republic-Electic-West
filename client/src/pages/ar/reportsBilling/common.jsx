/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../api'
import { EmptyState, ErrorState, SkeletonRows } from '../../../components/ui'
import { download } from '../shared'
import './reports.css'

export const fd = (v) => (v ? String(v).slice(0, 10) : '')
export const pctText = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${(Number(v) * 100).toFixed(1)}%`)

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
export function Frame({ state, title, filters = [], csv, empty = 'Nothing to show for these filters', children }) {
  const { data, error, loading } = state
  const printed = new Date().toLocaleString('en-US')
  if (error) return <ErrorState message={error} />
  if (loading || !data) return <SkeletonRows rows={6} cols={5} />
  const shown = filters.filter(([, v]) => v !== '' && v != null)
  return (
    <div className="am-report print-doc ar-rpt">
      <div className="am-report-head">
        <h2>{title || data.header?.title}</h2>
        {shown.length > 0 && <p className="ar-sub">{shown.map(([k, v]) => `${k}: ${v}`).join('  |  ')}</p>}
        <p className="ar-sub">Printed {printed}</p>
        {csv && data.rows?.length > 0 && (
          <button className="btn no-print" onClick={() => download(data.rows, csv.cols, csv.name)}><Download size={15} /> CSV</button>
        )}
      </div>
      {data.rows?.length ? children : <EmptyState title={empty} />}
    </div>
  )
}
