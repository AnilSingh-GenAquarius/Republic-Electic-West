import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleDollarSign, ClipboardCheck, Clock3, Plus, Search } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { TmTabs, lotLabel, money, statusOf, useTmLookups } from './shared'

export default function TmHome() {
  const nav = useNavigate()
  const lk = useTmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => {
    setError('')
    api('/tm', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (p.search || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const s = data?.summary
  return (
    <div className="page">
      <PageHeader title="Time & material" subtitle="T&M orders and quotes — price, process into Plan management, track payment"
        actions={<Link className="btn primary" to="/tm/new"><Plus size={15} /> New T&M</Link>} />
      <TmTabs />
      <div className="kpis">
        <StatCard label="Orders" icon={ClipboardCheck} tone="blue" loading={!data} value={data?.total} foot="Matching the filters below" />
        <StatCard label="Waiting to be processed" icon={Clock3} tone="amber" loading={!data} value={s?.unapproved ?? 0} foot="No approval yet" onClick={() => set({ status: 'unapproved' })} />
        <StatCard label="Processed, not paid" icon={CircleDollarSign} tone="red" loading={!data} value={s?.unpaid ?? 0} foot={`${money(s?.unpaidAmount)} outstanding`} onClick={() => set({ status: 'unpaid' })} />
        <StatCard label="Total value" icon={CircleDollarSign} tone="green" loading={!data} value={money(s?.amount)} foot="Including sales tax" />
      </div>
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, customer PO #, job, builder, address, T&M #…" aria-label="Search T&M" /></div>
        <div className="seg" role="tablist" aria-label="Status">
          {[['', 'All'], ['unapproved', 'Open'], ['approved', 'Processed'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={(p.status || '') === v} className={`seg-btn${(p.status || '') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>
          ))}
        </div>
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={p.typeId || ''} onChange={(e) => set({ typeId: e.target.value })} aria-label="Type"><option value="">All types</option>{lk.tmTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={p.preparedBy || ''} onChange={(e) => set({ preparedBy: e.target.value })} aria-label="Prepared by"><option value="">Anyone</option>{lk.users.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select>
        <label className="inline">From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={{ width: 150 }} /></label>
        <label className="inline">To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={{ width: 150 }} /></label>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>T&M #</th><th>Date</th><th>Name</th><th>Type</th><th>Builder</th><th>Job / lot</th><th>By</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const st = statusOf(r)
                return (
                  <tr key={r.TmID} onClick={() => nav(`/tm/${r.TmID}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/tm/${r.TmID}`)}>
                    <td><b>{r.TmID}</b></td><td>{fmtDate(r.TmDate)}</td><td className="wrap">{r.TmName}{r.TmCustomerNum ? <span className="muted small"> · PO {r.TmCustomerNum}</span> : null}</td>
                    <td>{r.TmType}</td><td>{r.CustName}</td><td className="wrap">{r.JobName} · {lotLabel(r)}</td><td>{r.PreparedBy}</td>
                    <td className="num">{money(r.Subtotal)}</td><td className="num">{money(r.SalesTax)}</td><td className="num"><b>{money(r.Total)}</b></td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  </tr>
                )
              })}
              {!data.rows.length && <tr><td colSpan={11}><EmptyState title="No T&M orders match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}
