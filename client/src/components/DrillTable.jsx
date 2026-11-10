import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../api'
import { fmtDate, fmtMoney } from '../format'
import { EmptyState, ErrorState, SkeletonRows } from './ui'
import { Pager } from './Pickers'

export const fmtCell = (v, type) => {
  if (v == null || v === '') return <span className="faint">—</span>
  if (type === 'date') return fmtDate(v)
  if (type === 'money') return fmtMoney(v)
  if (type === 'num') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return v
}

/**
 * Paged, searchable read-only table backed by a drill-down endpoint.
 * columns: [{ key, label, type?: 'date'|'money'|'num', align? }]
 * rowLink(row) -> path makes rows clickable. params = extra fixed query params.
 * renderTop(data) renders summary content above the table.
 */
export default function DrillTable({ endpoint, columns, params = {}, rowLink, searchPlaceholder, renderTop, emptyTitle = 'No records', filters }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [search, setSearch] = useState(sp.get('search') || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const page = parseInt(sp.get('page') || '1', 10)
  const key = JSON.stringify(params) + sp.toString()

  const load = () => {
    setLoading(true); setError('')
    api(endpoint, { params: { ...params, ...Object.fromEntries(sp.entries()), pageSize: 25 } })
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [endpoint, key])

  useEffect(() => {
    const t = setTimeout(() => {
      if (search === (sp.get('search') || '')) return
      const next = new URLSearchParams(sp)
      search ? next.set('search', search) : next.delete('search')
      next.delete('page')
      setSp(next, { replace: true })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <>
      {renderTop && data && renderTop(data)}
      {(searchPlaceholder || filters) && (
        <div className="filters">
          {searchPlaceholder && (
            <div className="search-wrap"><Search size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label="Search" />
            </div>
          )}
          {filters}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={load} />}
      <div className="table-wrap">
        {loading && !data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className={`grid${rowLink ? ' clickable' : ''}`} aria-busy={loading}>
            <thead><tr>{columns.map((c) => <th key={c.key} className={['money', 'num'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data?.rows.map((r, i) => {
                const to = rowLink?.(r)
                return (
                  <tr key={i} onClick={to ? () => nav(to) : undefined} tabIndex={to ? 0 : undefined}
                    onKeyDown={to ? (e) => e.key === 'Enter' && nav(to) : undefined}>
                    {columns.map((c) => (
                      <td key={c.key} className={['money', 'num'].includes(c.type) ? 'num' : ''}>
                        {c.render ? c.render(r) : fmtCell(r[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {data && !data.rows.length && (
                <tr><td colSpan={columns.length}><EmptyState title={emptyTitle}>{sp.get('search') ? 'Try a different search.' : null}</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {data && data.total > data.pageSize && (
        <Pager page={page} pageSize={data.pageSize} total={data.total}
          onPage={(p) => { const next = new URLSearchParams(sp); next.set('page', p); setSp(next) }} />
      )}
    </>
  )
}
