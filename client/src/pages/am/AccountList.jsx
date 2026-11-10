import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Plus, Search } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import AmTabs from './AmTabs'

const COLS = [
  { key: 'AccountNumber', label: 'Acct #', sort: 'number' },
  { key: 'CustomerName', label: 'Customer', sort: 'name' },
  { key: 'ServiceStreet', label: 'Service address' },
  { key: 'ServiceCity', label: 'City', sort: 'city' },
  { key: 'PhoneNumber', label: 'Phone' },
  { key: 'MonitoringType', label: 'Monitoring' },
  { key: 'MonthlyContractValue', label: 'Monthly' },
  { key: 'ActivationDate', label: 'Activated', sort: 'activation', date: true },
  { key: 'RenewalDate', label: 'Renewal', sort: 'renewal', date: true },
]

export default function AccountList() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [data, setData] = useState({ rows: [], total: 0, page: 1, pageSize: 25 })
  const [lookups, setLookups] = useState({ monitoringTypes: [] })
  const [search, setSearch] = useState(sp.get('search') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const params = Object.fromEntries(sp.entries())
  const set = (patch) => setSp({ ...params, page: 1, ...patch })

  useEffect(() => { api('/am/lookups').then(setLookups).catch(() => {}) }, [])

  useEffect(() => {
    setLoading(true)
    api('/am/accounts', { params: { status: 'active', ...params } })
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])

  // Debounced search box
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (sp.get('search') || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const sort = params.sort || 'number'
  const dir = params.dir || 'asc'

  return (
    <div className="page">
      <PageHeader title="Alarm accounts" subtitle="Search, filter and open any alarm monitoring account"
        actions={<Link className="btn primary" to="/am/accounts/new"><Plus size={15} /> New account</Link>} />
      <AmTabs />

      <div className="filters">
        <input className="search" placeholder="Search name, account #, address, phone, email, panel…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={params.status || 'active'} onChange={(e) => set({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="disconnected">Disconnected</option>
          <option value="all">All</option>
        </select>
        <select value={params.monitoringTypeId || ''} onChange={(e) => set({ monitoringTypeId: e.target.value })}>
          <option value="">All monitoring types</option>
          {lookups.monitoringTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <span className="muted">{loading ? 'Loading…' : `${data.total} accounts`}</span>
      </div>
      {error && <ErrorState message={error} />}

      <div className="table-wrap">{loading && !data.rows.length && <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div>}
        <table className="grid clickable">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key}
                  className={c.sort ? 'sortable' : ''}
                  onClick={() => c.sort && set({ sort: c.sort, dir: sort === c.sort && dir === 'asc' ? 'desc' : 'asc', page: params.page || 1 })}>
                  {c.label}{sort === c.sort ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.AccountID} onClick={() => nav(`/am/accounts/${r.AccountID}`)} className={r.DisconnectionDate ? 'dim' : ''}>
                {COLS.map((c) => <td key={c.key}>{c.date ? fmtDate(r[c.key]) : r[c.key]}</td>)}
              </tr>
            ))}
            {!loading && !data.rows.length && <tr><td colSpan={COLS.length}><EmptyState icon={Search} title="No accounts match">Try a different search or filter.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn small" disabled={data.page <= 1} onClick={() => setSp({ ...params, page: data.page - 1 })}>‹ Prev</button>
        <span className="muted">{data.total} accounts</span>
        <span>Page {data.page} of {pages}</span>
        <button className="btn small" disabled={data.page >= pages} onClick={() => setSp({ ...params, page: data.page + 1 })}>Next ›</button>
      </div>
    </div>
  )
}
