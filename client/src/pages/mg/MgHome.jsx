// Management overview: open lots per start month by division (Access SwitchMgSubOpenLot), lots ready to close, shortcuts.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckSquare, Home as HomeIcon, Search } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { MgTabs, int, today, yearAgo } from './shared'

export default function MgHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [lot, setLot] = useState('')
  useEffect(() => { api('/mg/overview').then(setD).catch((e) => setError(e.message)) }, [])
  return (
    <div className="page">
      <PageHeader title="Management" subtitle="Job cost, profitability, lots to close and labor against budget"
        actions={<Link className="btn primary" to={`/mg/job-cost?from=${yearAgo()}&to=${today()}`}>Job cost report <ArrowRight size={15} /></Link>} />
      <MgTabs />
      {error && <ErrorState message={error} />}
      <div className="kpis">
        <StatCard label="Open lots" icon={HomeIcon} tone="blue" loading={!d} value={int(d?.openLots)} foot="Not finished" onClick={() => nav(`/mg/reports?report=open-lots&from=2000-01-01&to=${today()}`)} />
        <StatCard label="Ready to close" icon={CheckSquare} tone="amber" loading={!d} value={int(d?.readyToClose)} foot="Started 4+ months ago, no labor paid in 60 days" onClick={() => nav(`/mg/reports?report=ready-to-close&date=${today()}`)} />
        <StatCard label="Finished in the last year" icon={CalendarClock} tone="green" loading={!d} value={int(d?.finishedLastYear)} foot="Lots in the job cost report" onClick={() => nav(`/mg/job-cost?from=${yearAgo()}&to=${today()}`)} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Open lots by start month</h2></div>
          {!d ? <SkeletonRows rows={6} cols={4} /> : !d.openByPeriod.length ? <EmptyState title="No open lots" /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Started</th>{d.divisions.map((x) => <th key={x} className="num">{x}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>{d.openByPeriod.map((r) => (
                <tr key={r.Period}><td><b>{r.Period}</b></td>{d.divisions.map((x) => <td key={x} className="num">{r[x] ? <Link to={`/mg/reports?report=open-lots&division=${x}&from=${r.Period}-01&to=${r.Period}-31`}>{r[x]}</Link> : ''}</td>)}<td className="num"><b>{r.total}</b></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Lot info detail</h2></div>
          <form className="row" style={{ gap: 8, padding: '4px 0' }} onSubmit={(e) => { e.preventDefault(); if (lot) nav(`/mg/reports?report=lot-detail&lotId=${lot}`) }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>Open any lot's details, packs, job cost and billing from the Reports tab, or enter a lot id:</p>
            <input inputMode="numeric" aria-label="Lot id" placeholder="Lot id" value={lot} onChange={(e) => setLot(e.target.value.replace(/\D/g, ''))} style={{ width: 110 }} />
            <button className="btn"><Search size={15} /> Open</button>
          </form>
        </section>
      </div>
    </div>
  )
}
