// Pack material: ship lines (IcMaterialPost: Ship ALL / NONE / ZERO) then post shipped material to job cost.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, PackageCheck, Send } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { IcTabs, int, useIcLookups } from './shared'

export function IcMaterial() {
  const nav = useNavigate()
  const lk = useIcLookups()
  const [division, setDivision] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => { setRows(null); api('/ic/material/lots', { params: { division } }).then((d) => setRows(d.rows)).catch((e) => setError(e.message)) }, [division])
  useEffect(load, [load])

  async function post(div) {
    const shipped = rows.filter((r) => r.DivisionId === div).reduce((a, r) => a + Number(r.Shipped), 0)
    if (!confirm(`Post shipped pack material for ${div} to job cost?\n\n${shipped} shipped line(s) become job cost; shipped lines (including zero) are cleared from the list.`)) return
    setError(''); setMsg('')
    try { const r = await api('/ic/material/post', { method: 'POST', body: { division: div } }); setMsg(`${div}: ${r.jobCostLines} lines posted to job cost; ${r.cleared} lines cleared.`); load() } catch (e) { setError(e.message) }
  }
  const divisions = [...new Set((rows || []).map((r) => r.DivisionId))]

  return (
    <div className="page">
      <PageHeader title="Pack material" subtitle="Material lists created when stages are posted in Scheduling — ship them, then post to job cost" />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="filters">
        <select value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        {divisions.map((d) => <button key={d} className="btn small primary" onClick={() => post(d)}><Send size={13} /> Post {d} to job cost</button>)}
      </div>
      <div className="table-wrap">
        {!rows ? <div style={{ padding: 16 }}><SkeletonRows rows={6} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Div</th><th>Job</th><th>Phase</th><th>Lot</th><th>Address</th><th className="num">Lines</th><th className="num">Shipped</th><th>Waiting since</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.LotId} onClick={() => nav(`/ic/material/${r.LotId}`)} tabIndex={0}>
                  <td>{r.DivisionId}</td><td><b>{r.JobName}</b></td><td>{r.Phase}</td><td>{r.Lot}{r.Block ? `/${r.Block}` : ''}</td><td>{r.Address}</td>
                  <td className="num">{r.Lines}</td><td className="num">{r.Shipped ? <Badge tone="green">{r.Shipped}</Badge> : <span className="faint">0</span>}</td><td>{fmtDate(r.Since)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><EmptyState icon={PackageCheck} title="No pack material waiting">Material lists appear here when a stage is posted in Scheduling.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function IcMaterialLot() {
  const { lotId } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [edits, setEdits] = useState({})
  const [stage, setStage] = useState('')
  const load = useCallback(() => api(`/ic/material/lots/${lotId}`).then(setD).catch((e) => setError(e.message)), [lotId])
  useEffect(() => { load() }, [load])

  async function ship(mode) {
    setError(''); setMsg('')
    try { const r = await api(`/ic/material/lots/${lotId}/ship`, { method: 'POST', body: { mode, scheduleStageId: stage || undefined } }); setMsg(`${r.updated} lines set to ship ${mode === 'all' ? 'ALL' : mode === 'zero' ? 'ZERO' : 'NONE'}.`); await load() } catch (e) { setError(e.message) }
  }
  async function commit(l) {
    const v = edits[l.PackMatTempID]; if (v === undefined) return
    try { await api(`/ic/material/lines/${l.PackMatTempID}`, { method: 'PUT', body: { shipped: v } }); setEdits((e) => { const n = { ...e }; delete n[l.PackMatTempID]; return n }); await load() } catch (e) { setError(e.message) }
  }
  const lot = d?.lot
  const stages = d ? [...new Map(d.lines.map((l) => [l.ScheduleStageId, l.ScheduleStage])).entries()] : []
  const lines = d ? d.lines.filter((l) => !stage || String(l.ScheduleStageId) === stage) : []
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ic/material">Pack material</Link>} title={lot ? `${lot.JobName} · lot ${lot.Lot}${lot.Block ? `/${lot.Block}` : ''}` : 'Lot'} track={false}
        subtitle={lot ? [lot.DivisionId, lot.Phase, lot.Address].filter(Boolean).join(' · ') : null} actions={<Link className="btn" to="/ic/material"><ArrowLeft size={15} /> Lots</Link>} />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {lot?.EndDate && <div className="banner">This lot is closed — open it before shipping material to it.</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <div className="filters">
            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage"><option value="">All stages</option>{stages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <button className="btn small primary" onClick={() => ship('all')} disabled={!!lot.EndDate}>Ship ALL</button>
            <button className="btn small" onClick={() => ship('zero')} disabled={!!lot.EndDate}>Ship ZERO</button>
            <button className="btn small ghost" onClick={() => ship('none')} disabled={!!lot.EndDate}>Ship NONE (clear)</button>
            <span className="muted small">Ship ALL = scheduled quantity · ZERO = nothing shipped but cleared · NONE = decide later</span>
          </div>
          <div className="table-wrap">
            <table className="grid compact">
              <thead><tr><th>Stage</th><th>Work</th><th>Pack</th><th>Item</th><th>Description</th><th className="num">Scheduled</th><th className="num">Ship</th><th className="num">Short</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const val = edits[l.PackMatTempID] ?? (l.ShippedQty ?? '')
                  const short = l.Shipped == null ? null : Number(l.ScheduleQty) - l.Shipped
                  return (
                    <tr key={l.PackMatTempID} className={l.Shipped != null ? 'row-selected' : ''}>
                      <td>{l.ScheduleStage}</td><td>{l.WorkType}</td><td className="wrap">{l.PackName}</td><td><b>{l.Item}</b></td><td className="wrap">{l.Description}</td>
                      <td className="num">{int(l.ScheduleQty)}</td>
                      <td className="num"><input className="pct-input" inputMode="numeric" value={val} placeholder="—" disabled={!!lot.EndDate} onChange={(e) => setEdits((x) => ({ ...x, [l.PackMatTempID]: e.target.value }))} onBlur={() => commit(l)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Shipped quantity for ${l.Item}`} /></td>
                      <td className="num">{short ? <span className="text-danger">{int(short)}</span> : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!!d.stages.length && <p className="muted small" style={{ marginTop: 10 }}>Stages on this lot: {d.stages.map((s) => `${s.ScheduleStage} / ${s.WorkType} (${fmtDate(s.DeliveryDate)}${s.DatePosted ? ', posted' : ''})`).join(' · ')}</p>}
        </>
      )}
    </div>
  )
}
