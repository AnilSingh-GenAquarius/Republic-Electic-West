import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, ArrowUpRight, Boxes, CalendarDays, CheckCircle2, Clock, History, HardHat,
  Home as HomeIcon, LayoutGrid, Table2, BarChart3, Wallet, Activity, Building2,
} from 'lucide-react'
import { api, session } from '../api'
import { GROUPS, MODULES, moduleByCode } from '../modules'
import { recentVisits, usePref } from '../prefs'
import { useLookups } from '../components/Pickers'
import { Badge, EmptyState, ErrorState, Skeleton, SkeletonRows, StatCard } from '../components/ui'
import BarChart from '../components/BarChart'
import { fmtDate, fmtMoney } from '../format'

const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

function timeAgo(ts) {
  if (!ts) return ''
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : fmtDate(ts)
}
function ageLabel(since) {
  if (!since) return null
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000)
  if (days <= 0) return 'Due today'
  if (days < 60) return `Oldest ${days} day${days > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `Oldest ${months} months ago` : `Oldest since ${new Date(since).getUTCFullYear()}`
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

function Section({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{Icon && <Icon size={16} />}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  const nav = useNavigate()
  const user = session.user
  const can = (c) => user?.modules?.includes(c)
  const [division] = usePref('sw_division', '')
  const { divisions } = useLookups('divisions')
  const divName = divisions.find((d) => d.id === division)?.name

  const summary = useLoad(() => api('/dashboard/summary', { params: { division } }), [division])
  const attention = useLoad(() => api('/dashboard/attention'), [])
  const charts = useLoad(() => api('/dashboard/charts'), [])
  const activity = useLoad(() => api('/dashboard/activity'), [])
  const [recent] = useState(() => recentVisits().slice(0, 6))
  const [billTable, setBillTable] = useState(false)
  const [payTable, setPayTable] = useState(false)

  const s = summary.data
  const att = attention.data?.items || []
  const [showAllTasks, setShowAllTasks] = useState(false)
  const highCount = att.filter((a) => a.priority === 'high').length

  const billing = (charts.data?.billing || []).map((r) => {
    const d = new Date(r.month + '-01T00:00:00Z')
    return {
      key: r.month, value: r.total || 0,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      short: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      tip: [['Invoices', num(r.bills)]],
    }
  })
  const payroll = (charts.data?.payroll || []).map((r) => ({
    key: r.PayrollDate, value: r.piece || 0,
    label: `Payroll ${fmtDate(r.PayrollDate)}`, short: fmtDate(r.PayrollDate).replace(/\/\d{4}$/, ''),
    tip: [['Hourly hours', num(r.hours)], ['Employees', num(r.employees)], ['Labor lines', num(r.lines)]],
  }))

  const ph = s?.payrollPending
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="page dashboard">
      {/* Welcome */}
      <section className="welcome">
        <div className="welcome-main">
          <div className="welcome-date"><CalendarDays size={14} /> {today}</div>
          <h1>{greeting()}, {user?.username}</h1>
          <p className="welcome-sub">
            <Building2 size={14} /> Republic Electric West · {division ? divName || division : 'All divisions'}
          </p>
        </div>
        <div className="welcome-overview">
          {attention.loading ? <Skeleton w={220} h={16} /> : att.length ? (
            <Link to="#attention" onClick={(e) => { e.preventDefault(); document.getElementById('attention')?.scrollIntoView({ behavior: 'smooth' }) }} className="overview-chip warn">
              <AlertCircle size={15} /> {att.length} item{att.length > 1 ? 's' : ''} need attention{highCount ? ` · ${highCount} high priority` : ''}
            </Link>
          ) : (
            <span className="overview-chip ok"><CheckCircle2 size={15} /> Everything is up to date</span>
          )}
        </div>
      </section>

      {/* KPIs */}
      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : (
        <div className="kpis">
          <StatCard label="Open lots – REW" icon={HardHat} tone="blue" loading={summary.loading}
            onClick={() => nav('/insights/open-lots?division=REW')}
            value={num(s?.openLots?.REW ?? 0)} foot="Open-lot register · REW jobs" />
          <StatCard label="Open lots – REI" icon={HomeIcon} tone="blue" loading={summary.loading}
            onClick={() => nav('/insights/open-lots?division=REI')}
            value={num(s?.openLots?.REI ?? 0)} foot="Open-lot register · REI (Elite) jobs" />
          {can('IC') && (
            <StatCard label="Inventory value" icon={Boxes} tone="green" loading={summary.loading}
              onClick={() => nav(`/insights/inventory${division ? `?division=${division}` : ''}`)}
              value={money0(s?.inventory?.value)}
              foot={<>{num(s?.inventory?.items)} items on hand × average cost{s?.inventory?.negative ? <> · <span className="text-danger">{s.inventory.negative} negative</span></> : null}</>} />
          )}
          {can('PR') && (
            <StatCard label="Payroll pending" icon={Wallet} tone="amber" loading={summary.loading}
              onClick={() => nav('/insights/payroll-pending')}
              value={`${num(ph?.hourly?.hours ?? 0)} hrs`}
              foot={<>{num(ph?.hourly?.entries)} hourly entries{ph?.hourly?.payrollDate ? ` for ${fmtDate(ph.hourly.payrollDate)}` : ''} · {num(ph?.piece?.entries)} timecard lines not posted{ph?.piece?.entries ? ` (${money0(ph?.piece?.value)})` : ''}</>} />
          )}
        </div>
      )}

      <div className="dash-top">
        {/* Needs attention */}
        <Section title="Needs attention" icon={AlertCircle} action={att.length > 0 && <Badge tone="amber">{att.length} open</Badge>}>
          <div id="attention" />
          {attention.loading && <SkeletonRows rows={3} cols={3} />}
          {attention.error && <ErrorState message={attention.error} onRetry={attention.reload} />}
          {!attention.loading && !attention.error && !att.length && (
            <EmptyState icon={CheckCircle2} title="All caught up">No pending payroll, overdue stages or unposted counts.</EmptyState>
          )}
          <ul className="tasks">
            {(showAllTasks ? att : att.slice(0, 5)).map((a) => {
              const m = moduleByCode[a.module]
              const Icon = m?.icon
              const ready = m?.ready
              const records = `/insights/attention/${a.id}`
              const primary = ready ? a.action.to : records
              return (
                <li key={a.id} className={`task prio-${a.priority} clickable`} onClick={(e) => !e.target.closest('button') && nav(primary)}>
                  <span className={`prio-bar ${a.priority}`} aria-hidden="true" />
                  <div className="task-main">
                    <div className="task-top">
                      <Badge tone={a.priority === 'high' ? 'red' : a.priority === 'medium' ? 'amber' : 'neutral'}>{a.priority}</Badge>
                      <span className="task-title">{a.title}</span>
                    </div>
                    <div className="task-detail">{a.detail}</div>
                    <div className="task-meta">
                      {Icon && <span><Icon size={12} /> {m.name}</span>}
                      {a.since && <span><Clock size={12} /> {ageLabel(a.since)}</span>}
                    </div>
                  </div>
                  <div className="task-actions">
                    {ready
                      ? <button className="btn small ghost" onClick={() => nav(records)}>View records</button>
                      : a.review && <span className="muted small" title={`${m?.name} screens are being built`}>{m?.name} module coming soon</span>}
                    <button className="btn small primary" onClick={() => nav(primary)}>
                      {ready ? a.action.label : 'View records'} <ArrowRight size={13} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {att.length > 5 && (
            <button className="btn small ghost show-more" onClick={() => setShowAllTasks((s) => !s)}>
              {showAllTasks ? 'Show fewer' : `Show all ${att.length} items`}
            </button>
          )}
        </Section>

        {/* Modules */}
        <section className="panel mod-panel" aria-labelledby="mod-h">
          <div className="panel-head">
            <h2 id="mod-h"><LayoutGrid size={16} />All modules</h2>
            <span className="muted small">{MODULES.filter((m) => can(m.code) && m.ready).length} of {MODULES.filter((m) => can(m.code)).length} available on the web</span>
          </div>
          <div className="mod-groups">
            {GROUPS.map((g) => {
              const mods = MODULES.filter((m) => can(m.code) && m.group === g)
              if (!mods.length) return null
              return (
                <div className="mod-group" key={g}>
                  <h3 className="mod-group-title">{g}</h3>
                  {mods.map((m) => {
                    const Icon = m.icon
                    const stats = m.screens ? `${m.screens.forms} forms · ${m.screens.reports} reports · ${m.screens.actions} actions` : 'In development'
                    const body = (
                      <>
                        <span className={`mod-icon accent-${m.accent}`}><Icon size={15} /></span>
                        <span className="mod-item-text">
                          <span className="mod-item-name">{m.name}{!m.ready && <Badge>Coming soon</Badge>}</span>
                          <span className="mod-item-desc">{m.description}</span>
                          <span className="mod-item-stats">{stats}</span>
                        </span>
                      </>
                    )
                    return m.ready
                      ? <Link key={m.code} to={m.path} className="mod-item" title={`${m.description} (${stats})`}>{body}</Link>
                      : <div key={m.code} className="mod-item disabled" aria-disabled="true">{body}</div>
                  })}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="dash-grid">
        {/* Charts */}
        {can('AR') && (
          <Section title="Billing by month" icon={BarChart3} className="span-2"
            action={<div className="row">
              <Link to="/insights/billing" className="panel-link">All invoices <ArrowRight size={13} /></Link>
              <button className="btn small ghost" onClick={() => setBillTable((t) => !t)} aria-pressed={billTable}><Table2 size={13} /> {billTable ? 'Chart' : 'Table'}</button>
            </div>}>
            <p className="panel-sub">Total invoiced (A/R billing), last 12 months with billing activity</p>
            {charts.loading ? <Skeleton h={180} /> : charts.error ? <ErrorState message={charts.error} onRetry={charts.reload} /> :
              billing.length ? <BarChart data={billing} format={money0} ariaLabel="Billing by month" showTable={billTable} onBarClick={(d) => nav(`/insights/billing?month=${d.key}`)} /> : <EmptyState title="No billing history" />}
          </Section>
        )}

        {/* Jump back in */}
        <Section title="Jump back in" icon={History}>
          {!recent.length ? (
            <EmptyState icon={History} title="No recent screens">Screens you open will appear here.</EmptyState>
          ) : (
            <ul className="recent">
              {recent.map((r) => {
                const m = moduleByCode[r.module]
                const Icon = m?.icon || HomeIcon
                return (
                  <li key={r.path}>
                    <Link to={r.path} className="recent-item">
                      <span className={`mod-icon accent-${m?.accent || 'slate'}`}><Icon size={15} /></span>
                      <span className="recent-text">
                        <span className="recent-title">{r.title}</span>
                        <span className="recent-sub">{m?.name || 'Dashboard'} · {timeAgo(r.at)}</span>
                      </span>
                      <ArrowUpRight size={14} className="recent-arrow" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {can('PR') && (
          <Section title="Piece-rate payroll by pay date" icon={Wallet} className="span-2"
            action={<div className="row">
              <Link to="/insights/payroll-pending" className="panel-link">Pending payroll <ArrowRight size={13} /></Link>
              <button className="btn small ghost" onClick={() => setPayTable((t) => !t)} aria-pressed={payTable}><Table2 size={13} /> {payTable ? 'Chart' : 'Table'}</button>
            </div>}>
            <p className="panel-sub">Piece-rate pay posted to labor paid (qty × price × pay %), last 12 payroll dates. Hourly hours shown in the tooltip.</p>
            {charts.loading ? <Skeleton h={180} /> : charts.error ? <ErrorState message={charts.error} onRetry={charts.reload} /> :
              payroll.length ? <BarChart data={payroll} format={(v) => fmtMoney(v)} ariaLabel="Piece-rate payroll by pay date" showTable={payTable} onBarClick={(d) => nav(`/insights/payroll-date?date=${String(d.key).slice(0, 10)}`)} /> : <EmptyState title="No payroll history" />}
          </Section>
        )}
        {/* Activity */}
        <Section title="Recent activity" icon={Activity}>
          {activity.loading && <SkeletonRows rows={5} cols={2} />}
          {activity.error && <ErrorState message={activity.error} onRetry={activity.reload} />}
          {activity.data && !activity.data.rows.length && <EmptyState title="No recent activity" />}
          <ul className="feed">
            {activity.data?.rows.map((r, i) => {
              const m = moduleByCode[r.module]
              const Icon = m?.icon
              const inner = (
                <>
                  <span className={`feed-icon accent-${m?.accent || 'slate'}`}>{Icon && <Icon size={13} />}</span>
                  <span className="feed-text">
                    <span className="feed-title">{r.title}</span>
                    <span className="feed-sub">{r.kind}{r.UserEntered ? ` · ${r.UserEntered}` : ''} · {timeAgo(r.DateEntered)}</span>
                  </span>
                </>
              )
              return <li key={i}>{m?.ready ? <Link to={r.link} className="feed-item">{inner}</Link> : <div className="feed-item">{inner}</div>}</li>
            })}
          </ul>
        </Section>
      </div>
    </div>
  )
}
