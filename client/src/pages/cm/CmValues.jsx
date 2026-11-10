// Contract values of a bid (Access CmContractVal): bid header, plans → packs → stage/work breakdown, with the
// "check your math" warnings (CmContractValCheckPlan / CmContractValCheckPack) and the two contract-value actions.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Calculator, CheckCircle2, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { Cascade, CmTabs, MoneyCell, PM_LEVELS, int, money, useCmLookups, yes } from './shared'

export default function CmValues() {
  const lk = useCmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const bidId = Number(p.contractId) || null
  const planId = Number(p.plan) || null
  const packId = Number(p.pack) || null
  const [d, setD] = useState(null)
  const [head, setHead] = useState(null)
  const [checks, setChecks] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const load = useCallback(async () => {
    if (!bidId) { setD(null); return }
    const r = await api(`/cm/bids/${bidId}/values`)
    setD(r)
    setHead({ Notes: r.bid.Notes || '', StatusId: String(r.bid.StatusId ?? ''), Lock: yes(r.bid.Lock), TrueUpDate: toInputDate(r.bid.TrueUpDate), JobNumber: r.bid.JobNumber || '' })
  }, [bidId])
  useEffect(() => { setError(''); setChecks(null); load().catch((e) => setError(e.message)) }, [load])
  // every edit returns the bid's checks; show them like the Access pop-ups did
  const run = (fn, ok) => async (...a) => {
    setError(''); setMsg('')
    try { const r = await fn(...a); if (r === false) return; if (r?.checks) setChecks(r.checks); if (ok) setMsg(typeof ok === 'function' ? ok(r) : ok); await load() } catch (e) { setError(e.message) }
  }
  const saveHead = run(async (e) => { e.preventDefault(); await api(`/cm/bids/${bidId}`, { method: 'PUT', body: head }) }, 'Bid saved')
  const savePlan = run((pl, v) => api(`/cm/plans/${pl.PmPlanID}`, { method: 'PUT', body: { ContractVal: v } }))
  const savePack = run((k, body) => api(`/cm/packs/${k.PmPackID}`, { method: 'PUT', body }))
  async function updateLots() {
    setBusy(true); setError(''); setMsg('')
    try {
      const pre = await api(`/cm/bids/${bidId}/update-lots`, { method: 'POST', body: { dryRun: true } })
      if (!confirm(`Update lot contract values of bid ${d.bid.BidNum}?\n\nOpen lots: ${int(pre.lots)} lot value(s), ${int(pre.packs)} pack value(s), ${int(pre.detailUpdated)} breakdown value(s) updated, ${int(pre.detailAdded)} breakdown row(s) added.\nBreakdown rows no longer in the bid: ${int(pre.detailRemoved)} removed.`)) return
      const r = await api(`/cm/bids/${bidId}/update-lots`, { method: 'POST', body: {} })
      setMsg(`Lots updated: ${int(r.lots)} lot(s), ${int(r.packs)} pack(s), ${int(r.detailUpdated)} breakdown value(s) updated, ${int(r.detailAdded)} added, ${int(r.detailRemoved)} removed.`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function setValues() {
    setBusy(true); setError(''); setMsg('')
    try {
      const pre = await api('/cm/set-contract-values', { method: 'POST', body: { dryRun: true } })
      if (!pre.packs && !pre.plans) { setMsg('Nothing to set: every pack and plan with a breakdown already has a contract value.'); return }
      if (!confirm(`Set contract values on ${int(pre.packs)} pack(s) and ${int(pre.plans)} plan(s) that have none (all bids)?`)) return
      const r = await api('/cm/set-contract-values', { method: 'POST', body: {} })
      setMsg(`Contract values set on ${int(r.packs)} pack(s) and ${int(r.plans)} plan(s).`); await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const b = d?.bid
  const plans = d?.plans || []
  const packs = (d?.packs || []).filter((k) => k.PmPlanId === planId)
  const pack = d?.packs.find((k) => k.PmPackID === packId && k.PmPlanId === planId)
  const badPlan = new Set((d?.checks.plans || []).map((x) => x.PmPlanID))
  const badPack = new Set((d?.checks.packs || []).map((x) => x.PmPackID))
  const hf = (k) => ({ value: head?.[k] ?? '', onChange: (e) => setHead((s) => ({ ...s, [k]: e.target.value })) })

  return (
    <div className="page">
      <PageHeader title="Contract values" subtitle="Plan, pack and stage/work contract values of a bid"
        actions={<>
          {bidId && <button className="btn" onClick={() => load().catch((e) => setError(e.message))}><RefreshCw size={15} /> Refresh</button>}
          <button className="btn" disabled={busy} onClick={setValues}><Calculator size={15} /> Set contract values</button>
          {bidId && <button className="btn" disabled={busy || !d} onClick={updateLots}><Upload size={15} /> Update lot contract values</button>}
        </>} />
      <CmTabs />
      <div className="card form report-filters"><fieldset>
        <Cascade levels={PM_LEVELS} value={{ customerId: p.customerId, jobId: p.jobId, contractId: p.contractId }} onChange={(v) => set({ ...v, plan: '', pack: '' })} />
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {checks && (checks.plans.length > 0 || checks.packs.length > 0) && (
        <div className="banner warn" role="alert"><AlertTriangle size={16} />
          <div><b>The values you entered don't match, please check your math!</b>
            {checks.plans.map((x) => <div key={`p${x.PmPlanID}`}>Plan {x.PlanNum}: plan contract value {money(x.ContractVal)} · sum of standard packs {money(x.SumOfContractVal)}</div>)}
            {checks.packs.map((x) => <div key={`k${x.PmPackID}`}>Pack {x.PackName}: pack contract value {money(x.ContractVal)} · sum of breakdown values {money(x.SumOfValue)}</div>)}
          </div></div>
      )}
      {!bidId ? <EmptyState title="Choose the PM customer, job and bid" /> : !d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <form className="card form" onSubmit={saveHead}><fieldset>
            <legend>{b.Customer} · {b.Job} ({b.DivisionId}) · Bid {[b.BidNum, b.BidRelease].filter(Boolean).join(' ')}{b.BidName ? ` – ${b.BidName}` : ''} · {fmtDate(b.BidDate)}</legend>
            <label>Job type<input value={b.JobType || ''} disabled /></label>
            <label>Job status<input value={b.JobStatus || ''} disabled /></label>
            <label>Job number<input maxLength={50} aria-label="Job number" {...hf('JobNumber')} /></label>
            <label>Bid status<select aria-label="Bid status" {...hf('StatusId')}>{lk.statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>True up date<input type="date" aria-label="True up date" {...hf('TrueUpDate')} /></label>
            <label className="check"><input type="checkbox" checked={!!head?.Lock} onChange={(e) => setHead({ ...head, Lock: e.target.checked })} /> Bid lock</label>
            <label className="span3">Bid notes<input maxLength={255} aria-label="Bid notes" {...hf('Notes')} /></label>
            {b.JobNotes && <p className="muted small span3">Job notes: {b.JobNotes}</p>}
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save bid</button></div></form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Plans ({plans.length})</h2></div>
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Plan</th><th>Name</th><th className="num">Sq ft</th><th>Universal</th><th className="num">Contract value</th><th className="num">Lots</th><th /></tr></thead>
              <tbody>{plans.map((pl) => (
                <tr key={pl.PmPlanID} className={`link-row${planId === pl.PmPlanID ? ' row-selected' : ''}`} onClick={() => set({ plan: pl.PmPlanID, pack: '' })}>
                  <td><a><b>{pl.PlanNum}</b></a></td><td>{pl.PlanName}</td><td className="num">{int(pl.SqFt)}</td><td>{yes(pl.Universal) ? 'Yes' : ''}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}><MoneyCell value={pl.ContractVal} label={`plan ${pl.PlanNum} contract value`} onSave={(v) => savePlan(pl, v)} /></td>
                  <td className="num">{pl.Lots || ''}</td>
                  <td>{badPlan.has(pl.PmPlanID) && <Badge tone="amber" icon={AlertTriangle}>Packs don't add up</Badge>}</td>
                </tr>
              ))}{!plans.length && <tr><td colSpan={7}><EmptyState title="No plans in this bid" /></td></tr>}</tbody>
            </table></div>
          </section>

          {planId && plans.some((x) => x.PmPlanID === planId) && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Packs of plan {plans.find((x) => x.PmPlanID === planId).PlanNum} ({packs.length})</h2></div>
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>ID</th><th>Pack</th><th>Builder code</th><th className="num">Qty</th><th className="num">Contract value</th><th className="num">Contract cost</th><th>Status</th><th>Type</th><th>T-up</th><th /></tr></thead>
                <tbody>{packs.map((k) => (
                  <tr key={k.PmPackID} className={`link-row${packId === k.PmPackID ? ' row-selected' : ''}`} onClick={() => set({ pack: k.PmPackID })}>
                    <td className="faint">{k.PmPackID}</td><td className="wrap"><a><b>{k.PackName}</b></a></td>
                    <td onClick={(e) => e.stopPropagation()}><TextCell value={k.BuilderCode} label={`builder code of ${k.PackName}`} onSave={(v) => savePack(k, { BuilderCode: v })} /></td>
                    <td className="num">{k.Quantity}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}><MoneyCell value={k.ContractVal} label={`contract value of ${k.PackName}`} onSave={(v) => savePack(k, { ContractVal: v })} /></td>
                    <td className="num" onClick={(e) => e.stopPropagation()}><MoneyCell value={k.ContractValCost} label={`contract cost of ${k.PackName}`} onSave={(v) => savePack(k, { ContractValCost: v })} /></td>
                    <td>{k.Status}</td><td>{k.PackType}</td>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Trued up ${k.PackName}`} checked={yes(k.TruedUp)} onChange={(e) => savePack(k, { TruedUp: e.target.checked })} /></td>
                    <td>{badPack.has(k.PmPackID) && <Badge tone="amber" icon={AlertTriangle}>Breakdown doesn't add up</Badge>}</td>
                  </tr>
                ))}{!packs.length && <tr><td colSpan={10}><EmptyState title="No packs in this plan" /></td></tr>}</tbody>
              </table></div>
            </section>
          )}
          {pack && <Breakdown key={pack.PmPackID} pack={pack} values={d.values.filter((v) => v.PmPackId === pack.PmPackID)} lk={lk} run={run} />}
        </>
      )}
    </div>
  )
}

function TextCell({ value, onSave, label }) {
  const [x, setX] = useState(null)
  if (x == null) return <button type="button" className="link-btn" aria-label={`Edit ${label}`} onClick={() => setX(value || '')}>{value || '—'}</button>
  const save = () => { const t = x; setX(null); if (t !== (value || '')) onSave(t) }
  return <input className="cell-input" autoFocus maxLength={50} aria-label={label} value={x} onChange={(e) => setX(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setX(null) }} />
}

// Stage / work breakdown of one pack (CmContractValSubValue)
function Breakdown({ pack, values, lk, run }) {
  const blank = { WorkId: '', ScheduleStageId: '', Value: '' }
  const [nv, setNv] = useState(blank)
  const add = run(async () => { const r = await api(`/cm/packs/${pack.PmPackID}/values`, { method: 'POST', body: nv }); setNv(blank); return r })
  const save = run((v, patch) => api(`/cm/pm-values/${v.PmValueID}`, { method: 'PUT', body: { WorkId: v.WorkId, ScheduleStageId: v.ScheduleStageId, Value: v.Value, ...patch } }))
  const del = run(async (v) => { if (!confirm('Delete this breakdown value?')) return false; return api(`/cm/pm-values/${v.PmValueID}`, { method: 'DELETE' }) })
  const total = values.reduce((a, v) => a + Number(v.Value || 0), 0)
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Breakdown of {pack.PackName}</h2><span className="muted">Pack value {money(pack.ContractVal)}</span></div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Work</th><th>Schedule stage</th><th className="num">Value</th><th /></tr></thead>
        <tbody>{values.map((v) => (
          <tr key={v.PmValueID}>
            <td><select aria-label={`Work of value ${v.PmValueID}`} value={v.WorkId ?? ''} onChange={(e) => save(v, { WorkId: e.target.value })}>{lk.works.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td><select aria-label={`Stage of value ${v.PmValueID}`} value={v.ScheduleStageId ?? ''} onChange={(e) => save(v, { ScheduleStageId: e.target.value })}>{lk.scheduleStages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td className="num"><MoneyCell value={v.Value} label={`value ${v.PmValueID}`} onSave={(x) => save(v, { Value: x })} /></td>
            <td><button className="btn small icon" aria-label={`Delete value ${v.PmValueID}`} onClick={() => del(v)}><Trash2 size={13} /></button></td>
          </tr>
        ))}
          <tr>
            <td><select aria-label="New value work" value={nv.WorkId} onChange={(e) => setNv({ ...nv, WorkId: e.target.value })}><option value="">Work…</option>{lk.works.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td><select aria-label="New value stage" value={nv.ScheduleStageId} onChange={(e) => setNv({ ...nv, ScheduleStageId: e.target.value })}><option value="">Stage…</option>{lk.scheduleStages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td className="num"><input className="cell-input" aria-label="New value amount" placeholder="$" value={nv.Value} onChange={(e) => setNv({ ...nv, Value: e.target.value })} /></td>
            <td><button className="btn small" disabled={!nv.WorkId || !nv.ScheduleStageId || nv.Value === ''} onClick={add}><Plus size={13} /> Add</button></td>
          </tr>
        </tbody>
        <tfoot><tr><td colSpan={2}><b>Sum of breakdown values</b></td><td className={`num${values.length && Math.round(total * 100) !== Math.round(Number(pack.ContractVal || 0) * 100) ? ' neg' : ''}`}><b>{money(total)}</b></td><td /></tr></tfoot>
      </table></div>
    </section>
  )
}
