import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, PackageOpen, Plus, Receipt, ShoppingCart } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PoTabs, int } from './shared'

export default function PoHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/po/overview').then(setD).catch((e) => setError(e.message)) }, [])
  return (
    <div className="page">
      <PageHeader title="Purchasing" subtitle="Purchase orders, receiving, billing and pack POs" actions={<Link className="btn primary" to="/po/orders/new"><Plus size={15} /> New purchase order</Link>} />
      <PoTabs />
      {error && <ErrorState message={error} />}
      <div className="kpis">
        <StatCard label="Open purchase orders" icon={ShoppingCart} tone="blue" loading={!d} value={int(d?.open.n)} foot={d?.open.empty ? `${d.open.empty} have no items yet` : 'Not closed'} onClick={() => nav('/po/orders?status=open')} />
        <StatCard label="Back-ordered lines" icon={PackageOpen} tone="amber" loading={!d} value={int(d?.backOrderedLines)} foot="Ordered but not fully received" onClick={() => nav('/po/reports?kind=backordered')} />
        <StatCard label="Received, not billed" icon={Receipt} tone="red" loading={!d} value={int(d?.notBilledLines)} foot="Lines to match with vendor invoices" onClick={() => nav('/po/reports?kind=not-billed')} />
        <StatCard label="Pack POs not converted" icon={FileText} tone="violet" loading={!d} value={int(d?.packs.unconverted)} foot={`${int(d?.packs.n)} pack POs in total`} onClick={() => nav('/po/packs?status=open')} />
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Latest purchase orders</h2><Link className="panel-link" to="/po/orders">All orders <ArrowRight size={13} /></Link></div>
        {!d ? <SkeletonRows rows={4} cols={3} /> : (
          <table className="grid compact">
            <thead><tr><th>PO #</th><th>Date</th><th>Vendor</th><th>Status</th></tr></thead>
            <tbody>{d.recent.map((r) => (
              <tr key={r.PoNum} className="link-row" onClick={() => nav(`/po/orders/${r.PoNum}`)}><td><a>{r.PoNum}</a></td><td>{fmtDate(r.PoDate)}</td><td>{r.Vendor}</td><td>{r.DateClosed ? <Badge>Closed {fmtDate(r.DateClosed)}</Badge> : <Badge tone="amber">Open</Badge>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  )
}
