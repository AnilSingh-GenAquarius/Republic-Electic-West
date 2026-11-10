// One pack: material lines (Access PlanSubMaterial), stage/work values (PmValue) and the material change log.
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PmTabs, money, money4, money0, usePmLookups, yes } from './shared'

const blankLine = { item: null, Quantity: '1', StageId: '', WorkId: '', Notes: '' }

export default function PmPack() {
  const { id } = useParams()
  const lk = usePmLookups()
  const [d, setD] = useState(null)
  const [add, setAdd] = useState(blankLine)
  const [edit, setEdit] = useState(null)
  const [val, setVal] = useState({ ScheduleStageId: '', WorkId: '', Value: '' })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => setD(await api(`/pm/packs/${id}`)), [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  // send; if the server says the item is inactive, ask like Access did and resend with the confirmation
  const send = async (url, method, body) => {
    try { return await api(url, { method, body }) } catch (e) {
      if (e.data?.needsConfirm && confirm(e.message)) return api(url, { method, body: { ...body, confirmInactive: true } })
      throw e
    }
  }
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (r !== false && ok) setMsg(typeof ok === 'function' ? ok(r) : ok); await load() } catch (e) { setError(e.message) } }
  const addLine = run(async (e) => {
    e.preventDefault()
    const r = await send(`/pm/packs/${id}/material`, 'POST', { InvItemId: add.item?.id, Quantity: add.Quantity, StageId: add.StageId, WorkId: add.WorkId, Notes: add.Notes })
    setAdd((s) => ({ ...blankLine, StageId: s.StageId, WorkId: s.WorkId })); return r
  }, (r) => `Line added – cost ${money4(r.UnitCost)}, estimating ${money4(r.EstimatingPrice)} (from the item)`)
  const saveLine = run(async () => { const body = { Quantity: edit.Quantity, StageId: edit.StageId, WorkId: edit.WorkId, UnitCost: edit.UnitCost, EstimatingPrice: edit.EstimatingPrice, NoChange: edit.NoChange, StatusId: edit.StatusId, Notes: edit.Notes }; if (edit.item && edit.item.id !== edit.InvItemId) { body.InvItemId = edit.item.id; delete body.UnitCost; delete body.EstimatingPrice } await send(`/pm/material/${edit.id}`, 'PUT', body); setEdit(null) }, 'Line saved')
  const delLine = run(async (mid) => { if (!confirm('Delete this material line?')) return false; await api(`/pm/material/${mid}`, { method: 'DELETE' }) }, 'Line deleted')
  const addVal = run(async (e) => { e.preventDefault(); await api(`/pm/packs/${id}/values`, { method: 'POST', body: val }); setVal({ ScheduleStageId: '', WorkId: '', Value: '' }) }, 'Value added')
  const saveVal = run(async (v, value) => { await api(`/pm/values/${v.PmValueID}`, { method: 'PUT', body: { Value: value } }) }, 'Value saved')
  const delVal = run(async (vid) => { if (!confirm('Delete this value?')) return false; await api(`/pm/values/${vid}`, { method: 'DELETE' }) })

  const k = d?.pack
  return (
    <div className="page">
      <PageHeader crumb={k ? <><Link to={`/pm/bids/${k.PmContractId}?plan=${k.PmPlanId}`}>Plan {k.PlanNum}</Link></> : null} title={k ? k.PackName : 'Pack'} track={!!k}
        subtitle={k ? [k.PackType, k.BuilderCode && `code ${k.BuilderCode}`, `qty ${k.Quantity}`].filter(Boolean).join(' · ') : null}
        actions={k && <Link className="btn" to={`/pm/bids/${k.PmContractId}?plan=${k.PmPlanId}`}><ArrowLeft size={15} /> Plan</Link>} />
      <PmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          {yes(k.TruedUp) && <div className="banner">This pack is trued up: the pack itself is locked, material and labor can still be edited.</div>}
          <div className="kpis">
            <StatCard label="Labor" tone="blue" value={money(d.totals.labor)} foot="Cost code L" />
            <StatCard label="Material" tone="amber" value={money(d.totals.material)} foot="Other cost codes" />
            <StatCard label="Cost per pack" tone="violet" value={money(d.totals.cost)} foot={`× pack qty ${k.Quantity}`} />
            <StatCard label="Contract value" tone="green" value={money(k.ContractValNum)} foot={`Stage values ${money0(d.totals.values)}`} />
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Material ({d.material.length})</h2></div>
            <div className="table-wrap"><table className="grid compact pm-mat">
              <thead><tr><th>Item</th><th>Description</th><th>Code</th><th className="num">Qty</th><th>Stage</th><th>Work</th><th className="num">Unit cost</th><th className="num">Est. price</th><th className="num">Ext cost</th><th>Flags</th><th /></tr></thead>
              <tbody>
                {d.material.map((m) => edit?.id === m.PmMatID ? (
                  <tr key={m.PmMatID} className="editing">
                    <td colSpan={2}><SearchSelect endpoint="/pm/pick/items" value={edit.item?.id ?? m.InvItemId} label={edit.item?.name ?? `${m.InvItem} – ${m.Description || ''}`} onSelect={(it) => setEdit({ ...edit, item: it })} /></td>
                    <td>{m.CostCodeId}</td>
                    <td className="num"><input className="cell-input" aria-label="Line quantity" value={edit.Quantity} onChange={(e) => setEdit({ ...edit, Quantity: e.target.value })} /></td>
                    <td><select aria-label="Line stage" value={edit.StageId} onChange={(e) => setEdit({ ...edit, StageId: e.target.value })}>{lk.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td><select aria-label="Line work" value={edit.WorkId} onChange={(e) => setEdit({ ...edit, WorkId: e.target.value })}>{lk.works.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="num"><input className="cell-input" aria-label="Unit cost" value={edit.UnitCost} disabled={!!edit.item} onChange={(e) => setEdit({ ...edit, UnitCost: e.target.value })} /></td>
                    <td className="num"><input className="cell-input" aria-label="Estimating price" value={edit.EstimatingPrice} disabled={!!edit.item} onChange={(e) => setEdit({ ...edit, EstimatingPrice: e.target.value })} /></td>
                    <td />
                    <td><label className="check"><input type="checkbox" checked={!!edit.NoChange} onChange={(e) => setEdit({ ...edit, NoChange: e.target.checked })} /> No change</label>
                      <select aria-label="Line status" value={edit.StatusId} onChange={(e) => setEdit({ ...edit, StatusId: e.target.value })}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save line" onClick={saveLine}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
                  </tr>
                ) : (
                  <tr key={m.PmMatID} className={m.StatusId !== 1 ? 'muted-row' : ''}>
                    <td><b>{m.InvItem}</b></td><td className="wrap">{m.Description}{m.Notes ? <div className="muted">{m.Notes}</div> : null}</td><td>{m.CostCodeId}</td><td className="num">{m.Quantity}</td><td>{m.Stage}</td><td>{m.WorkType}</td>
                    <td className="num">{money4(m.UnitCost)}</td><td className="num">{money4(m.EstimatingPrice)}</td><td className="num">{money(m.ExtCost)}</td>
                    <td>{yes(m.NoChange) && <Badge>No change</Badge>} {m.StatusId !== 1 && <Badge>{m.Status}</Badge>} {m.ItemStatusId === 2 && <Badge tone="amber">Item inactive</Badge>}</td>
                    <td className="row" style={{ gap: 4 }}>
                      <button className="btn small icon" aria-label={`Edit line ${m.InvItem}`} onClick={() => setEdit({ id: m.PmMatID, InvItemId: m.InvItemId, item: null, Quantity: String(m.Quantity ?? ''), StageId: String(m.StageId ?? ''), WorkId: String(m.WorkId ?? ''), UnitCost: String(m.UnitCost ?? ''), EstimatingPrice: String(m.EstimatingPrice ?? ''), NoChange: yes(m.NoChange), StatusId: String(m.StatusId ?? 1), Notes: m.Notes || '' })}><Pencil size={13} /></button>
                      <button className="btn small icon" aria-label={`Delete line ${m.InvItem}`} onClick={() => delLine(m.PmMatID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
                <tr className="new-row">
                  <td colSpan={2}><SearchSelect endpoint="/pm/pick/items" value={add.item?.id} label={add.item?.name} placeholder="Search item to add…" onSelect={(it) => setAdd({ ...add, item: it })} /></td>
                  <td />
                  <td className="num"><input className="cell-input" aria-label="New line quantity" value={add.Quantity} onChange={(e) => setAdd({ ...add, Quantity: e.target.value })} /></td>
                  <td><select aria-label="New line stage" value={add.StageId} onChange={(e) => setAdd({ ...add, StageId: e.target.value })}><option value="">Stage…</option>{lk.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                  <td><select aria-label="New line work" value={add.WorkId} onChange={(e) => setAdd({ ...add, WorkId: e.target.value })}><option value="">Work…</option>{lk.works.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                  <td colSpan={3} className="muted small">Cost and estimating price come from the item</td>
                  <td><input className="cell-input wide" aria-label="New line notes" placeholder="Notes" value={add.Notes} onChange={(e) => setAdd({ ...add, Notes: e.target.value })} /></td>
                  <td><button className="btn small primary" disabled={!add.item || !add.StageId || !add.WorkId} onClick={addLine}><Plus size={13} /> Add</button></td>
                </tr>
              </tbody>
              <tfoot><tr><td colSpan={8}><b>Active lines</b></td><td className="num"><b>{money(d.totals.cost)}</b></td><td colSpan={2} /></tr></tfoot>
            </table></div>
            {!d.material.length && <EmptyState title="No material yet – add the first line above" />}
          </section>

          <div className="dash-grid" style={{ marginTop: 16 }}>
            <section className="panel span-2">
              <div className="panel-head"><h2>Contract value by stage and work</h2></div>
              <table className="grid compact">
                <thead><tr><th>Stage</th><th>Work</th><th className="num">Value</th><th /></tr></thead>
                <tbody>
                  {d.values.map((v) => <ValueRow key={v.PmValueID} v={v} onSave={saveVal} onDelete={delVal} />)}
                  <tr className="new-row">
                    <td><select aria-label="Value stage" value={val.ScheduleStageId} onChange={(e) => setVal({ ...val, ScheduleStageId: e.target.value })}><option value="">Stage…</option>{lk.scheduleStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td><select aria-label="Value work" value={val.WorkId} onChange={(e) => setVal({ ...val, WorkId: e.target.value })}><option value="">Work…</option>{lk.works.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="num"><input className="cell-input" aria-label="Value amount" placeholder="$" value={val.Value} onChange={(e) => setVal({ ...val, Value: e.target.value })} /></td>
                    <td><button className="btn small" disabled={!val.ScheduleStageId || !val.WorkId || val.Value === ''} onClick={addVal}><Plus size={13} /> Add</button></td>
                  </tr>
                </tbody>
                <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{money(d.totals.values)}</b></td><td /></tr></tfoot>
              </table>
            </section>
            <section className="panel span-2">
              <div className="panel-head"><h2>Material change log</h2></div>
              {!d.log.length ? <p className="muted">No changes logged.</p> : (
                <table className="grid compact"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Item (before)</th><th className="num">Qty</th><th className="num">Cost</th></tr></thead>
                  <tbody>{d.log.map((r) => <tr key={r.PmMatChangeID}><td>{fmtDate(r.DateEdited)}</td><td>{r.UserEdited}</td><td><Badge tone={r.Action === 'Delete' ? 'red' : 'blue'}>{r.Action}</Badge></td><td>{r.InvItem}</td><td className="num">{r.Quantity}</td><td className="num">{money4(r.UnitCost)}</td></tr>)}</tbody></table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function ValueRow({ v, onSave, onDelete }) {
  const [x, setX] = useState(null)
  return (
    <tr>
      <td>{v.ScheduleStage}</td><td>{v.WorkType}</td>
      <td className="num">{x == null ? money(v.Value) : <input className="cell-input" aria-label="Edit value" value={x} onChange={(e) => setX(e.target.value)} />}</td>
      <td className="row" style={{ gap: 4 }}>
        {x == null ? <button className="btn small icon" aria-label="Edit value" onClick={() => setX(String(v.Value ?? ''))}><Pencil size={13} /></button>
          : <><button className="btn small icon" aria-label="Save value" onClick={() => { onSave(v, x); setX(null) }}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setX(null)}><X size={13} /></button></>}
        <button className="btn small icon" aria-label="Delete value" onClick={() => onDelete(v.PmValueID)}><Trash2 size={13} /></button>
      </td>
    </tr>
  )
}
