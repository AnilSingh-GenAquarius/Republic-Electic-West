import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardList, PackageCheck, RefreshCw, TrendingDown } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { IcTabs, int, money0 } from './shared'

export default function IcHome() {
  const nav = useNavigate()
  const [ov, setOv] = useState(null)
  const [pending, setPending] = useState({})
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const o = await api('/ic/overview'); setOv(o)
      const out = {}
      for (const d of o.stock) out[d.DivisionId] = await api('/ic/transactions/pending', { params: { division: d.DivisionId } })
      setPending(out)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(div) {
    const p = pending[div]
    if (!confirm(`Update on-hand and on-order quantities for ${div}?\n\n${p.jobCost.lines} job-cost lines, ${p.receipts.lines} receipts and ${p.unpostedTransactions} adjustments will be posted.`)) return
    setBusy(div); setMsg(''); setError('')
    try {
      const r = await api('/ic/transactions/post', { method: 'POST', body: { division: div } })
      setMsg(`${div}: ${r.posted} transactions posted (${r.jobCost} from job cost, ${r.receipts} from receipts); on-order updated on ${r.onOrderUpdated} items.`)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const totalValue = ov?.stock.reduce((a, d) => a + Number(d.value || 0), 0)
  const negative = ov?.stock.reduce((a, d) => a + Number(d.negative || 0), 0)
  const toOrder = ov?.stock.reduce((a, d) => a + Number(d.toOrder || 0), 0)
  const matLines = ov?.material.reduce((a, d) => a + Number(d.lines || 0), 0)

  return (
    <div className="page">
      <PageHeader title="Inventory control" subtitle="Stock by division, posting, counts and pack material" />
      <IcTabs />
      {error && <ErrorState message={error} onRetry={load} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="kpis">
        <StatCard label="Inventory value" icon={Boxes} tone="green" loading={!ov} value={money0(totalValue)} foot="On hand × average cost, all divisions" onClick={() => nav('/ic/reports?tab=value')} />
        <StatCard label="Items to reorder" icon={ClipboardList} tone="amber" loading={!ov} value={int(toOrder)} foot="On hand below the reorder level" onClick={() => nav('/ic/reports?tab=reorder')} />
        <StatCard label="Negative on hand" icon={TrendingDown} tone="red" loading={!ov} value={int(negative)} foot="Item/division records below zero" onClick={() => nav('/ic/items?negative=1')} />
        <StatCard label="Pack material waiting" icon={PackageCheck} tone="blue" loading={!ov} value={int(matLines)} foot={`${ov?.material.reduce((a, d) => a + Number(d.lots || 0), 0) || 0} lots to ship and post`} onClick={() => nav('/ic/material')} />
      </div>
      {!ov ? <SkeletonRows rows={4} cols={4} /> : (
        <div className="dash-grid">
          <section className="panel span-2">
            <div className="panel-head"><h2><RefreshCw size={16} /> Update on-hand &amp; on-order quantities</h2><span className="muted small">Posts job-cost use, PO receipts and adjustments per division</span></div>
            <table className="grid">
              <thead><tr><th>Division</th><th className="num">Items stocked</th><th className="num">Value</th><th className="num">Job-cost lines</th><th className="num">Receipts</th><th className="num">Adjustments</th><th /></tr></thead>
              <tbody>
                {ov.stock.map((d) => {
                  const p = pending[d.DivisionId]
                  const waiting = p ? p.jobCost.lines + p.receipts.lines + p.unpostedTransactions : null
                  return (
                    <tr key={d.DivisionId}>
                      <td><b>{d.DivisionId}</b></td><td className="num">{int(d.items)}</td><td className="num">{money0(d.value)}</td>
                      <td className="num">{p ? p.jobCost.lines : '…'}</td><td className="num">{p ? p.receipts.lines : '…'}</td><td className="num">{p ? p.unpostedTransactions : '…'}</td>
                      <td className="actions">
                        {waiting === 0 ? <Badge tone="green">Up to date</Badge> : <button className="btn small primary" disabled={busy === d.DivisionId || waiting == null} onClick={() => post(d.DivisionId)}>{busy === d.DivisionId ? 'Posting…' : 'Update now'}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recent counts</h2><Link to="/ic/counts" className="panel-link">All counts <ArrowRight size={13} /></Link></div>
            {!ov.recentCounts.length ? <p className="muted small">No counts yet.</p> : (
              <table className="grid compact"><thead><tr><th>Date</th><th>Div</th><th>Status</th></tr></thead>
                <tbody>{ov.recentCounts.map((c) => (
                  <tr key={c.InventoryID} className="link-row" onClick={() => nav(`/ic/counts/${c.InventoryID}`)}><td><a>{fmtDate(c.InvDate)}</a></td><td>{c.DivisionId}</td><td>{c.Posted ? <Badge tone="green">Posted</Badge> : <Badge tone="amber">Open</Badge>}</td></tr>
                ))}</tbody></table>
            )}
            {ov.recentCounts.some((c) => !c.Posted) && <div className="banner" style={{ marginTop: 10 }}><AlertTriangle size={16} /> A count is open and not yet posted.</div>}
          </section>
        </div>
      )}
    </div>
  )
}
