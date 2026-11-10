// Plan management overview: counts, latest bids, the global "update zero item cost" action.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, FileStack, Lock, RefreshCw, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PmTabs, int } from './shared'

export default function PmHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api('/pm/overview').then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  async function zeroCost() {
    if (!confirm(`Fill the cost of every material line that has no cost (${int(d.zeroCost)} lines) from the item's labor cost / job cost price?`)) return
    setBusy(true); setError(''); setMsg('')
    try { const r = await api('/pm/update-zero-cost', { method: 'POST' }); setMsg(`Prices updated on ${int(r.updated)} material line(s).`); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Plan management" subtitle="Customers, jobs and bids; plans, packs and pack material; copies and bulk changes"
        actions={<Link className="btn primary" to="/pm/customers">Customers &amp; bids <ArrowRight size={15} /></Link>} />
      <PmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="kpis">
        <StatCard label="Customers" icon={Users} tone="blue" loading={!d} value={int(d?.customers)} foot={`${int(d?.jobs)} production jobs`} onClick={() => nav('/pm/customers')} />
        <StatCard label="Active bids" icon={FileStack} tone="violet" loading={!d} value={int(d?.bids)} foot={`${int(d?.locked)} locked`} onClick={() => nav('/pm/customers')} />
        <StatCard label="Active plans" icon={ClipboardList} tone="green" loading={!d} value={int(d?.plans)} foot={`${int(d?.packs)} packs`} onClick={() => nav('/pm/reports?report=active-plans')} />
        <StatCard label="Material lines with no cost" icon={Boxes} tone={d?.zeroCost ? 'amber' : 'green'} loading={!d} value={int(d?.zeroCost)} foot={`of ${int(d?.material)} lines`} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest bids</h2><Link className="panel-link" to="/pm/customers">All customers <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={5} cols={4} /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Customer</th><th>Job</th><th>Div</th><th>Bid</th><th>Date</th><th className="num">Plans</th><th /></tr></thead>
              <tbody>{d.recent.map((r) => (
                <tr key={r.PmContractID} className="link-row" onClick={() => nav(`/pm/bids/${r.PmContractID}`)}>
                  <td>{r.Customer}</td><td className="wrap">{r.Job}</td><td>{r.DivisionId}</td><td><a><b>{[r.BidNum, r.BidRelease].filter(Boolean).join(' ')}</b></a> {r.BidName}</td><td>{fmtDate(r.BidDate)}</td><td className="num">{r.Plans}</td>
                  <td>{r.Lock ? <Badge tone="amber" icon={Lock}>Locked</Badge> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Action</h2></div>
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={!d || busy || !d.zeroCost} onClick={zeroCost}><RefreshCw size={15} /> {busy ? 'Updating…' : 'Update zero item cost'}</button>
            <span className="muted">Material lines with no cost get the item's labor cost (labor items) or job cost price (everything else).</span>
          </div>
        </section>
      </div>
    </div>
  )
}
