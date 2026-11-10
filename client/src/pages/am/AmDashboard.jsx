import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, DollarSign, List, Plus, ShieldCheck, ShieldOff, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtMoney } from '../../format'
import { ErrorState, PageHeader, StatCard, SkeletonRows } from '../../components/ui'
import AmTabs from './AmTabs'

export default function AmDashboard() {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')

  const load = () => { setError(''); api('/am/reports/summary').then(setS).catch((e) => setError(e.message)) }
  useEffect(load, [])
  const max = Math.max(1, ...(s?.byType || []).map((t) => t.n))

  return (
    <div className="page">
      <PageHeader
        title="Alarm Monitoring"
        subtitle="REI security accounts, call lists, zones and renewals"
        actions={<>
          <Link className="btn" to="/am/renewals"><CalendarClock size={15} /> Renewals due</Link>
          <Link className="btn primary" to="/am/accounts/new"><Plus size={15} /> New account</Link>
        </>}
      />
      <AmTabs />
      {error && <ErrorState message={error} onRetry={load} />}
      <div className="kpis">
        <StatCard label="Active accounts" icon={ShieldCheck} tone="blue" loading={!s} value={s?.active} foot="No disconnection date" />
        <StatCard label="Monthly revenue" icon={DollarSign} tone="green" loading={!s} value={fmtMoney(s?.monthlyRevenue)} foot="Sum of monthly value, active accounts" />
        <StatCard label="Disconnected" icon={ShieldOff} tone="red" loading={!s} value={s?.disconnected} foot="Accounts with a disconnection date" />
        <StatCard label="Total accounts" icon={Users} tone="blue" loading={!s} value={s?.total} foot="All alarm accounts on file" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2><List size={16} /> Active accounts by monitoring type</h2>
          <Link to="/am/accounts" className="btn small ghost">View all</Link>
        </div>
        {!s ? <SkeletonRows rows={3} cols={2} /> : (
          <table className="grid">
            <thead><tr><th>Monitoring type</th><th className="num">Accounts</th><th style={{ width: '40%' }} /></tr></thead>
            <tbody>
              {s.byType.map((t) => (
                <tr key={t.MonitoringType}>
                  <td>{t.MonitoringType}</td>
                  <td className="num">{t.n}</td>
                  <td><div className="meter"><span style={{ width: `${(t.n / max) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
