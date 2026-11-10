// Revised contract values of one scheduled lot (Access CmRevContract with CmRevContractSubPack / SubValue / SubTotal).
// A closed lot (end date set) is read-only, as in Access ("You need to open it before you can modify it").
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Lock, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { Cascade, CmTabs, JS_LEVELS, JS_LOT, MoneyCell, amt, money, useCmLookups } from './shared'

const LEVELS = [...JS_LEVELS, JS_LOT]

export default function CmLots() {
  const lk = useCmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const lotId = Number(p.lotId) || null
  const [d, setD] = useState(null)
  const [head, setHead] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const load = useCallback(async () => {
    if (!lotId) { setD(null); return }
    const r = await api(`/cm/lots/${lotId}`)
    setD(r); setHead({ Contract: amt(r.lot.Contract), RevContract: amt(r.lot.RevContract), LotNotes: r.lot.LotNotes || '' })
  }, [lotId])
  useEffect(() => { setError(''); setMsg(''); load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (r === false) return; if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const saveHead = run(async (e) => { e.preventDefault(); await api(`/cm/lots/${lotId}`, { method: 'PUT', body: head }) }, 'Lot saved')
  const savePack = run((k, body) => api(`/cm/lot-packs/${k.PackID}`, { method: 'PUT', body }))
  const l = d?.lot
  const ro = !!l?.closed
  const hf = (k) => ({ value: head?.[k] ?? '', disabled: ro, onChange: (e) => setHead((s) => ({ ...s, [k]: e.target.value })) })
  return (
    <div className="page">
      <PageHeader title="Revised contract values" subtitle="Standard and revised contract values of a scheduled lot, its packs and their breakdown" />
      <CmTabs />
      <div className="card form report-filters"><fieldset>
        <Cascade levels={LEVELS} value={{ jsCustomerId: p.jsCustomerId, jsJobId: p.jsJobId, lotId: p.lotId }} onChange={(v) => set(v)} />
      </fieldset></div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!lotId ? <EmptyState title="Choose the JS customer, job and lot" /> : !d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          {ro && <div className="banner"><Lock size={16} /> This lot is closed ({fmtDate(l.EndDate)}). You need to open it before you can modify it.</div>}
          <div className="kpis">
            <StatCard label="Lot / block" tone="blue" value={l.LotBlock} foot={`${l.JobName} · phase ${l.Phase || '—'} · plan ${l.PlanNum || '—'}`} />
            <StatCard label="Bid" tone="violet" value={l.BidNum || '—'} foot={fmtDate(l.BidDate)} />
            <StatCard label="Std / rev contract" tone="green" value={money(l.Contract)} foot={`Revised ${money(l.RevContract)}`} />
            <StatCard label="Lot total" tone="amber" value={money(d.total)} foot="Σ qty × (rev each, else contract each)" />
          </div>
          <form className="card form" onSubmit={saveHead}><fieldset disabled={ro}>
            <legend>Lot · {l.Status} · start {fmtDate(l.StartDate)}{l.EndDate ? ` · end ${fmtDate(l.EndDate)}` : ''}</legend>
            <label>Estimate<input value={money(l.Estimate)} disabled /></label>
            <label>Rev estimate<input value={money(l.RevEstimate)} disabled /></label>
            <label>Std contract $<input inputMode="decimal" aria-label="Std contract" {...hf('Contract')} /></label>
            <label>Rev contract $<input inputMode="decimal" aria-label="Rev contract" {...hf('RevContract')} /></label>
            <label className="span3">Notes<input maxLength={255} aria-label="Lot notes" {...hf('LotNotes')} /></label>
          </fieldset>{!ro && <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save lot</button></div>}</form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Packs ({d.packs.length})</h2></div>
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Pack</th><th>Type</th><th className="num">Qty</th><th className="num">Contract ea</th><th className="num">Rev contract ea</th><th className="num">Ext contract</th><th className="num">Ext rev contract</th></tr></thead>
              <tbody>{d.packs.map((k) => (
                <PackRows key={k.PackID} k={k} ro={ro} lk={lk} values={d.values.filter((v) => v.PackId === k.PackID)} savePack={savePack} run={run} />
              ))}{!d.packs.length && <tr><td colSpan={7}><EmptyState title="No packs scheduled on this lot" /></td></tr>}</tbody>
              <tfoot><tr><td colSpan={6}><b>Lot total</b></td><td className="num"><b>{money(d.total)}</b></td></tr></tfoot>
            </table></div>
          </section>
        </>
      )}
    </div>
  )
}

function PackRows({ k, ro, lk, values, savePack, run }) {
  const blank = { WorkId: '', ScheduleStageId: '', Contract: '', RevContract: '' }
  const [nv, setNv] = useState(blank)
  const add = run(async () => { await api(`/cm/lot-packs/${k.PackID}/values`, { method: 'POST', body: nv }); setNv(blank) })
  const save = run((v, patch) => api(`/cm/js-values/${v.JsValueID}`, { method: 'PUT', body: patch }))
  const del = run(async (v) => { if (!confirm('Delete this breakdown row?')) return false; await api(`/cm/js-values/${v.JsValueID}`, { method: 'DELETE' }) })
  return (
    <>
      <tr className="row-selected">
        <td className="wrap"><b>{k.PackName || `Pack ${k.PmPackId}`}</b>{k.BuilderCode && k.BuilderCode !== k.PackName ? <span className="muted"> · {k.BuilderCode}</span> : null}</td><td>{k.PackType}</td><td className="num">{k.PackQty}</td>
        <td className="num"><MoneyCell value={k.ContractEa} disabled={ro} label={`contract each of ${k.PackName}`} onSave={(v) => savePack(k, { ContractEa: v })} /></td>
        <td className="num"><MoneyCell value={k.RevContractEa} disabled={ro} label={`revised contract each of ${k.PackName}`} onSave={(v) => savePack(k, { RevContractEa: v })} /></td>
        <td className="num">{money(Number(k.PackQty || 0) * Number(k.ContractEa || 0))}</td>
        <td className="num">{k.RevContractEa == null ? '—' : money(Number(k.PackQty || 0) * Number(k.RevContractEa || 0))}</td>
      </tr>
      {values.map((v) => (
        <tr key={v.JsValueID}>
          <td style={{ paddingLeft: 28 }}><select aria-label={`Work of row ${v.JsValueID}`} disabled={ro} value={v.WorkId ?? ''} onChange={(e) => save(v, { WorkId: e.target.value })}>{lk.works.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td colSpan={2}><select aria-label={`Stage of row ${v.JsValueID}`} disabled={ro} value={v.ScheduleStageId ?? ''} onChange={(e) => save(v, { ScheduleStageId: e.target.value })}>{lk.scheduleStages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td className="num"><MoneyCell value={v.Contract} disabled={ro} label={`contract of row ${v.JsValueID}`} onSave={(x) => save(v, { Contract: x })} /></td>
          <td className="num"><MoneyCell value={v.RevContract} disabled={ro} label={`revised contract of row ${v.JsValueID}`} onSave={(x) => save(v, { RevContract: x })} /></td>
          <td colSpan={2}>{!ro && <button className="btn small icon" aria-label={`Delete row ${v.JsValueID}`} onClick={() => del(v)}><Trash2 size={13} /></button>}</td>
        </tr>
      ))}
      {!ro && (
        <tr>
          <td style={{ paddingLeft: 28 }}><select aria-label={`New row work for ${k.PackName}`} value={nv.WorkId} onChange={(e) => setNv({ ...nv, WorkId: e.target.value })}><option value="">Work…</option>{lk.works.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td colSpan={2}><select aria-label={`New row stage for ${k.PackName}`} value={nv.ScheduleStageId} onChange={(e) => setNv({ ...nv, ScheduleStageId: e.target.value })}><option value="">Stage…</option>{lk.scheduleStages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td className="num"><input className="cell-input" aria-label={`New row contract for ${k.PackName}`} placeholder="$" value={nv.Contract} onChange={(e) => setNv({ ...nv, Contract: e.target.value })} /></td>
          <td className="num"><input className="cell-input" aria-label={`New row revised for ${k.PackName}`} placeholder="$" value={nv.RevContract} onChange={(e) => setNv({ ...nv, RevContract: e.target.value })} /></td>
          <td colSpan={2}><button className="btn small" disabled={!nv.WorkId || !nv.ScheduleStageId} onClick={add}><Plus size={13} /> Add breakdown</button></td>
        </tr>
      )}
    </>
  )
}
