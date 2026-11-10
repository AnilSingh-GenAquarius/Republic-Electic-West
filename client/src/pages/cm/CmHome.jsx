// Contract management overview: counts, latest contracts, diary due, and the global "Set contract values" action.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, FileSignature, FileWarning, Printer, Calculator, Briefcase } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { CmTabs, int, yes } from './shared'

export default function CmHome() {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api('/cm/overview').then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  async function setValues() {
    setBusy(true); setError(''); setMsg('')
    try {
      const pre = await api('/cm/set-contract-values', { method: 'POST', body: { dryRun: true } })
      if (!pre.packs && !pre.plans) { setMsg('Nothing to set: every pack and plan with a breakdown already has a contract value.'); return }
      if (!confirm(`Set contract values on ${int(pre.packs)} pack(s) (sum of their stage/work breakdown) and then ${int(pre.plans)} plan(s) (sum of their standard packs)? Only packs and plans with no value are changed, across all bids.`)) return
      const r = await api('/cm/set-contract-values', { method: 'POST', body: {} })
      setMsg(`Contract values set on ${int(r.packs)} pack(s) and ${int(r.plans)} plan(s).`); await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Contract management" subtitle="Contracts and addenda per job, bid contract values, revised lot values and contract reports"
        actions={<Link className="btn primary" to="/cm/jobs">Contracts <ArrowRight size={15} /></Link>} />
      <CmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="kpis">
        <StatCard label="Contracts & addenda" icon={FileSignature} tone="blue" loading={!d} value={int(d?.contracts)} foot={`${int(d?.notExecuted)} not executed`} onClick={() => nav('/cm/reports?report=not-executed')} />
        <StatCard label="Jobs with no contract" icon={Briefcase} tone={d?.jobsNoContract ? 'amber' : 'green'} loading={!d} value={int(d?.jobsNoContract)} foot="Production jobs" onClick={() => nav('/cm/jobs')} />
        <StatCard label="Plans with no contract value" icon={FileWarning} tone={d?.plansNoValue ? 'amber' : 'green'} loading={!d} value={int(d?.plansNoValue)} foot="Active plans of active jobs" onClick={() => nav('/cm/reports?report=no-contract-val')} />
        <StatCard label="Diary due this week" icon={CalendarClock} tone="violet" loading={!d} value={int(d?.dueThisWeek)} foot={`${int(d?.latest)} flagged for latest print`} onClick={() => nav('/cm/reports?report=to-do-diary')} />
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head"><h2>Latest contracts</h2><Link className="panel-link" to="/cm/jobs">All jobs <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={5} cols={4} /> : !d.recent.length ? <EmptyState title="No contracts entered yet" /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Customer</th><th>Job</th><th>Div</th><th>Type</th><th>Contract</th><th>Addendum</th><th>Effective</th><th /></tr></thead>
              <tbody>{d.recent.map((r) => (
                <tr key={r.CmContractID} className="link-row" onClick={() => nav(`/cm/jobs/${r.PmJobId}?contract=${r.CmContractID}`)}>
                  <td>{r.Customer}</td><td className="wrap">{r.Job}</td><td>{r.DivisionId}</td><td>{r.Type}</td><td><a><b>{r.ContractNumber || '—'}</b></a></td><td>{r.AddendumNumber}</td><td>{fmtDate(r.EffectiveDate)}</td>
                  <td>{yes(r.Executed) ? <Badge tone="green">Executed</Badge> : <Badge tone="amber">Not executed</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Diary – to do</h2><Link className="panel-link" to="/cm/reports?report=to-do-diary">To-do report <ArrowRight size={13} /></Link></div>
          {!d ? <SkeletonRows rows={4} cols={4} /> : !d.due.length ? <EmptyState title="Nothing due" /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Due</th><th>Job</th><th>Contract</th><th>Contact</th><th>Notes</th></tr></thead>
              <tbody>{d.due.map((r) => (
                <tr key={r.CmDiaryID} className="link-row" onClick={() => nav(`/cm/jobs/${r.PmJobId}?contract=${r.CmContractID}`)}>
                  <td>{fmtDate(r.DueDate)}</td><td className="wrap">{r.Job}</td><td>{[r.ContractNumber, r.AddendumNumber].filter(Boolean).join(' / ')}</td><td>{r.Contact}</td><td className="wrap">{r.Notes}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Actions</h2></div>
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={setValues}><Calculator size={15} /> {busy ? 'Working…' : 'Set contract values'}</button>
            <span className="muted">Packs with no contract value get the sum of their stage/work breakdown; then plans with no value get the sum of their standard packs.</span>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <Link className="btn" to="/cm/reports?report=latest-changes"><Printer size={15} /> Contract latest changes</Link>
            <span className="muted">Prints the contracts flagged “latest print” in a division, then clears the flags.</span>
          </div>
        </section>
      </div>
    </div>
  )
}
