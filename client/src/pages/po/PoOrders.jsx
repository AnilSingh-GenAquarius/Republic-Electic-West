import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PoTabs, int, money, money0, usePoLookups } from './shared'

export default function PoOrders() {
  const nav = useNavigate()
  const lk = usePoLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { setError(''); api('/po/orders', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp.toString()])
  useEffect(() => { const t = setTimeout(() => { if (search !== (p.search || '')) set({ search }) }, 300); return () => clearTimeout(t) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search])

  return (
    <div className="page">
      <PageHeader title="Purchase orders" subtitle="Orders to vendors, with receiving and billing progress" actions={<Link className="btn primary" to="/po/orders/new"><Plus size={15} /> New purchase order</Link>} />
      <PoTabs />
      <div className="kpis">
        <StatCard label="Orders" tone="blue" loading={!data} value={int(data?.total)} foot="Matching the filters" />
        <StatCard label="Open" tone="amber" loading={!data} value={int(data?.summary.openCount)} foot="Not closed" />
        <StatCard label="Total value" tone="green" loading={!data} value={money0(data?.summary.amount)} foot="Items + tax + shipping" />
      </div>
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO #, vendor or notes…" aria-label="Search purchase orders" /></div>
        <div className="seg">{[['', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(([v, l]) => <button key={v} className={`seg-btn${(p.status || '') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>)}</div>
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div style={{ width: 220 }}><SearchSelect endpoint="/common/vendors" value={p.vendorId} label={p.vendorName} placeholder="Any vendor" onSelect={(r) => set({ vendorId: r?.id, vendorName: r?.name })} /></div>
        <label className="inline">From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={{ width: 150 }} /></label>
        <label className="inline">To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={{ width: 150 }} /></label>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>PO #</th><th>Date</th><th>Vendor</th><th>Ship to</th><th>Terms</th><th className="num">Lines</th><th>Received</th><th className="num">Items</th><th className="num">Tax</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.PoNum} onClick={() => nav(`/po/orders/${r.PoNum}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/po/orders/${r.PoNum}`)}>
                  <td><b>{r.PoNum}</b>{r.PoPackNum ? <span className="muted small"> · pack {r.PoPackNum}</span> : null}</td><td>{fmtDate(r.PoDate)}</td><td className="wrap">{r.Vendor}</td><td>{r.DivisionId}</td><td>{r.PayTerms}</td>
                  <td className="num">{r.Lines}</td><td>{r.Lines ? <Badge tone={r.LinesReceived === r.Lines ? 'green' : r.LinesReceived ? 'amber' : 'neutral'}>{r.LinesReceived}/{r.Lines}</Badge> : <span className="faint">—</span>}</td>
                  <td className="num">{money(r.ExtCost)}</td><td className="num">{money(r.TaxAmt)}</td><td className="num"><b>{money(r.Total)}</b></td><td>{r.DateClosed ? <Badge>Closed</Badge> : <Badge tone="amber">Open</Badge>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={11}><EmptyState title="No purchase orders match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}
