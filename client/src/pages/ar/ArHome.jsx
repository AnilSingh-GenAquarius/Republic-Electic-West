// Accounts receivable overview: work to bill, pre-bills waiting to post, recent invoices, billing by month.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileStack, Home as HomeIcon, Receipt, Send } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import BarChart from '../../components/BarChart'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { ArTabs, int, money, money0 } from './shared'

export default function ArHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [tb, setTb] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/ar/overview').then(setD).catch((e) => setError(e.message))
    api('/ar/reports/to-bill', { params: { pageSize: 1 } }).then(setTb).catch(() => {})
  }, [])
  const months = (d?.months || []).map((m) => ({ key: m.month, label: m.month.slice(5) + '/' + m.month.slice(2, 4), value: Number(m.total || 0), tip: [['Invoices', int(m.invoices)], ['Billed', money0(m.total)]] }))
  return (
    <div className="page">
      <PageHeader title="Accounts receivable" subtitle="Bill builders by lot, post invoices and track what is left to bill"
        actions={<Link className="btn primary" to="/ar/billing"><Receipt size={15} /> Process billing</Link>} />
      <ArTabs />
      {error && <ErrorState message={error} />}
      <div className="kpis">
        <StatCard label="Open lots" icon={HomeIcon} tone="blue" loading={!d} value={int(d?.openLots)} foot="Lots that can be billed" onClick={() => nav('/ar/billing')} />
        <StatCard label="Left to bill" icon={FileStack} tone="amber" loading={!tb} value={money0(tb?.summary?.remaining)} foot={tb ? `${int(tb.total)} open lots not fully billed` : ''} onClick={() => nav('/ar/reports?kind=to-bill')} />
        <StatCard label="Waiting to post" icon={Send} tone="violet" loading={!d} value={money(d?.prebill.amount || 0)} foot={`${int(d?.prebill.lots)} lot(s) submitted`} onClick={() => nav('/ar/prebill')} />
        <StatCard label="Invoices this month" icon={Receipt} tone="green" loading={!d} value={money0(d?.months.find((m) => m.month === new Date().toISOString().slice(0, 7))?.total || 0)}
          foot={`${int(d?.months.find((m) => m.month === new Date().toISOString().slice(0, 7))?.invoices || 0)} invoice(s)`} onClick={() => nav(`/ar/invoices?from=${new Date().toISOString().slice(0, 8)}01`)} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Billing by month</h2><Link className="panel-link" to="/ar/reports?kind=invoices&groupBy=month">Report <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={4} cols={1} /> : months.length ? <BarChart data={months} format={money0} ariaLabel="Billing by month" onBarClick={(m) => nav(`/ar/invoices?from=${m.key}-01&to=${m.key}-31`)} /> : <EmptyState title="No invoices in the last six months" />}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest invoices</h2><Link className="panel-link" to="/ar/invoices">All invoices <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={4} cols={3} /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Invoice</th><th>Date</th><th>Builder</th><th>Job</th><th>Lot</th><th className="num">Total</th></tr></thead>
              <tbody>{d.recent.map((r) => (
                <tr key={r.BillID} className="link-row" onClick={() => nav(`/ar/invoices/${r.BillID}`)}><td><a>{r.BillID}</a></td><td>{fmtDate(r.Date)}</td><td>{r.CustName}</td><td className="wrap">{r.JobName}</td><td>{r.LotBlock}</td><td className="num">{r.Total < 0 ? <Badge tone="red">{money(r.Total)}</Badge> : money(r.Total)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </div>
  )
}
