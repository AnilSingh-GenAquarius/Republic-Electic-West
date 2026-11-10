// Estimating overview (Access SwitchES): counts, latest estimating bids, the switchboard's price-update actions.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardList, FileStack, Layers, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { EsTabs, bidLabel, int } from './shared'

export default function EsHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const load = () => api('/es/overview').then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  async function run(key, text, path, done) {
    if (!confirm(text)) return
    setBusy(key); setError(''); setMsg('')
    try { const r = await api(path, { method: 'POST' }); setMsg(done(r)); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const updateItems = () => run('items', 'Update item prices? Job cost prices (automatic / feature update items) are set from the average cost (labor cost for labor items), estimating prices from the job cost price and mark-up, and every item\'s price book prices from the job cost price.',
    '/es/update-item-prices', (r) => `Job cost price updated on ${int(r.jobCost)} item(s), estimating price on ${int(r.estimating)}, price book on ${int(r.priceBook)}. Check the low estimating prices report.`)
  const updateAssemblies = () => run('asm', 'Set the estimating price of every master assembly material line to the item\'s current estimating price (labor cost for labor items)?',
    '/es/update-assembly-prices', (r) => `Assembly material prices updated on ${int(r.updated)} line(s).`)
  return (
    <div className="page">
      <PageHeader title="Estimating" subtitle="Estimating bids built from assemblies and material, transferred to Plan management"
        actions={<Link className="btn primary" to="/es/customers">Customers &amp; bids <ArrowRight size={15} /></Link>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg} {msg.includes('low estimating') && <Link to="/es/reports?report=low-prices">Open report</Link>}</div>}
      <div className="kpis">
        <StatCard label="Estimating bids" icon={FileStack} tone="blue" loading={!d} value={int(d?.bids)} foot={`${int(d?.activeBids)} active · ${int(d?.notTransferred)} not in PM`} onClick={() => nav('/es/customers')} />
        <StatCard label="Plans" icon={ClipboardList} tone="violet" loading={!d} value={int(d?.plans)} foot={`${int(d?.packs)} packs · ${int(d?.material)} material lines`} />
        <StatCard label="Unposted assemblies" icon={Layers} tone={d?.unposted ? 'amber' : 'green'} loading={!d} value={int(d?.unposted)} foot={`${int(d?.assemblies)} master assemblies`} onClick={() => nav('/es/assemblies')} />
        <StatCard label="Low estimating prices" icon={AlertTriangle} tone={d?.lowPrices ? 'amber' : 'green'} loading={!d} value={int(d?.lowPrices)} foot="Active items below cost" onClick={() => nav('/es/reports?report=low-prices')} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest estimating bids</h2><Link className="panel-link" to="/es/customers">All customers <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={5} cols={4} /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Customer</th><th>Job</th><th>Div</th><th>Bid</th><th>Date</th><th>Estimator</th><th className="num">Plans</th><th>PM bid</th><th /></tr></thead>
              <tbody>{d.recent.map((r) => (
                <tr key={r.EsBidID} className="link-row" onClick={() => nav(`/es/bids/${r.EsBidID}`)}>
                  <td>{r.Customer}</td><td className="wrap">{r.Job}</td><td>{r.DivisionId}</td><td><a><b>{bidLabel(r)}</b></a></td><td>{fmtDate(r.Date)}</td><td>{r.Estimator}</td><td className="num">{r.Plans}</td><td>{r.PmBid || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}><Link className="btn small" to={`/es/bids/${r.EsBidID}/material`}>Material</Link></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Actions</h2></div>
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <button className="btn" disabled={!!busy} onClick={updateItems}><RefreshCw size={15} /> {busy === 'items' ? 'Updating…' : 'Update item prices'}</button>
            <button className="btn" disabled={!!busy} onClick={updateAssemblies}><Boxes size={15} /> {busy === 'asm' ? 'Updating…' : 'Update assembly item prices'}</button>
            <Link className="btn" to="/es/transfer"><ArrowRight size={15} /> Transfer bid / plan / pack to PM</Link>
            <span className="muted small">Open a bid from <Link to="/es/customers">Customers &amp; bids</Link> for assembly bid management (assemblies, standard packs, options) or material bid management (bid calculation, pack material).</span>
          </div>
        </section>
      </div>
    </div>
  )
}
