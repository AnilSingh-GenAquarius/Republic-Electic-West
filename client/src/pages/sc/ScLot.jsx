// One lot: details, scheduled stages, scheduled packs, and posting a stage (pack ticket).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, CheckCircle2, FileText, History, Pencil, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ScTabs, lotName, useScLookups } from './shared'

export default function ScLot() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useScLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [newStage, setNewStage] = useState({ WorkId: '', ScheduleStageId: '', DeliveryDate: '', Notes: '' })
  const [editStage, setEditStage] = useState(null)
  const [newPack, setNewPack] = useState({ PmPackId: '', PackQty: '1' })
  const [editPack, setEditPack] = useState(null)

  const load = useCallback(async () => {
    const r = await api(`/sc/lots/${id}`)
    setD(r)
    const l = r.lot
    setForm({
      Lot: l.Lot ?? '', Block: l.Block ?? '', Address: l.Address ?? '', City: l.City ?? '', State: l.State ?? '', Zip: l.Zip ?? '', Permit: l.Permit ?? '',
      PmPlanId: l.PmPlanId ?? '', StatusId: l.StatusId ? 1 : 0, SubsId: l.SubsId ?? '', StartDate: toInputDate(l.StartDate), EndDate: toInputDate(l.EndDate), LotNotes: l.LotNotes ?? '',
    })
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  async function saveLot(e) {
    e.preventDefault(); setSaving(true); setError(''); setMsg('')
    try { await api(`/sc/lots/${id}`, { method: 'PUT', body: { ...form, StatusId: Number(form.StatusId) } }); setMsg('Lot saved'); await load() }
    catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const addStage = wrap(async (e) => { e.preventDefault(); await api(`/sc/lots/${id}/stages`, { method: 'POST', body: newStage }); setNewStage({ WorkId: '', ScheduleStageId: '', DeliveryDate: '', Notes: '' }) }, 'Stage scheduled')
  const saveStage = wrap(async () => { await api(`/sc/stages/${editStage.id}`, { method: 'PUT', body: { DeliveryDate: editStage.DeliveryDate, Notes: editStage.Notes } }); setEditStage(null) })
  const delStage = wrap(async (sid) => { if (confirm('Remove this scheduled stage?')) await api(`/sc/stages/${sid}`, { method: 'DELETE' }) })
  const addPack = wrap(async (e) => { e.preventDefault(); await api(`/sc/lots/${id}/packs`, { method: 'POST', body: newPack }); setNewPack({ PmPackId: '', PackQty: '1' }) }, 'Pack scheduled')
  const savePack = wrap(async () => { await api(`/sc/packs/${editPack.id}`, { method: 'PUT', body: { PackQty: editPack.PackQty } }); setEditPack(null) })
  const delPack = wrap(async (pid) => { if (confirm('Remove this pack from the lot?')) await api(`/sc/packs/${pid}`, { method: 'DELETE' }) })

  async function removeLot() {
    if (!confirm('Delete this lot, its scheduled stages and packs? This cannot be undone.')) return
    try { await api(`/sc/lots/${id}`, { method: 'DELETE' }); nav(`/sc/phases/${d.lot.PhaseId}`) } catch (e) { setError(e.message) }
  }

  const l = d?.lot
  const postedStageIds = new Set((d?.stages || []).filter((s) => s.DatePosted).map((s) => s.ScheduleStageId))
  const openStageIds = [...new Set((d?.stages || []).filter((s) => !s.DatePosted).map((s) => s.ScheduleStageId))]
  const latePacks = (d?.packs || []).filter((p) => p.PackQty > 0 && p.PostedQty === 0)
  const stageName = (sid) => lk.scheduleStages.find((s) => s.id === sid)?.name || `Stage ${sid}`

  return (
    <div className="page">
      <PageHeader crumb={l && <><Link to="/sc">Scheduling</Link> / <Link to={`/sc/jobs/${l.JobId}`}>{l.JobName}</Link> / <Link to={`/sc/phases/${l.PhaseId}`}>{l.Phase}</Link></>}
        title={l ? `Lot ${lotName(l)}` : 'Lot'} track={!!l}
        subtitle={l ? [l.JobName, l.CustName, l.PlanNum && `Plan ${l.PlanNum}`, l.Address].filter(Boolean).join(' · ') : null}
        actions={<Link className="btn" to={l ? `/sc/phases/${l.PhaseId}` : '/sc'}><ArrowLeft size={15} /> Phase</Link>} />
      <ScTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          {/* Post stage */}
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head"><h2><Send size={16} /> Post pack ticket</h2><span className="muted small">Sends a stage to the warehouse and to payroll</span></div>
            {!openStageIds.length && !latePacks.length ? (
              <p className="muted small" style={{ margin: 0 }}>Nothing waiting. Schedule a stage below{postedStageIds.size ? ' — posted stages are shown with a green badge' : ''}.</p>
            ) : (
              <div className="chips">
                {openStageIds.map((sid) => (
                  <Link key={sid} to={`/sc/lots/${id}/ticket?stage=${sid}`} className="btn small primary"><FileText size={13} /> Pack ticket · {stageName(sid)}</Link>
                ))}
                {latePacks.length > 0 && [...postedStageIds].map((sid) => (
                  <Link key={`l${sid}`} to={`/sc/lots/${id}/ticket?stage=${sid}&late=1`} className="btn small"><FileText size={13} /> Late packs · {stageName(sid)} ({latePacks.length})</Link>
                ))}
              </div>
            )}
          </section>

          <div className="dash-grid">
            <form className="card form span-2" onSubmit={saveLot}>
              <fieldset>
                <legend>Lot</legend>
                <label>Lot *<input required maxLength={50} {...f('Lot')} /></label>
                <label>Block<input maxLength={50} {...f('Block')} /></label>
                <label>Plan
                  <select {...f('PmPlanId')} disabled={d.stages.some((s) => s.DatePosted)} title={d.stages.some((s) => s.DatePosted) ? 'The plan is locked once a stage is posted' : undefined}>
                    <option value="" />{d.plans.map((p) => <option key={p.id} value={p.id}>{p.PlanNum}</option>)}
                  </select>
                </label>
                <label>Status
                  <select {...f('StatusId')}><option value={1}>Active</option><option value={0}>Inactive / closed</option></select>
                </label>
                <label className="span2">Address<input maxLength={50} {...f('Address')} /></label>
                <label>City<input maxLength={50} {...f('City')} /></label>
                <label>State<input maxLength={50} {...f('State')} /></label>
                <label>Zip<input inputMode="numeric" {...f('Zip')} /></label>
                <label>Permit<input maxLength={255} {...f('Permit')} /></label>
                <label>Substitution
                  <select {...f('SubsId')}><option value="" />{lk.subsTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                </label>
                <label>Start date<input type="date" {...f('StartDate')} /></label>
                <label>End date (closes lot)<input type="date" {...f('EndDate')} /></label>
                <label className="span3">Lot notes<textarea rows={2} maxLength={255} {...f('LotNotes')} /></label>
              </fieldset>
              <div className="row form-actions">
                <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save lot'}</button>
                <button type="button" className="btn danger" onClick={removeLot}><Trash2 size={15} /> Delete lot</button>
                <span className="muted small">Contract {l.Contract || '—'} · {d.laborPaidLines} labor lines paid · {d.invoices} invoices</span>
              </div>
            </form>

            <section className="panel">
              <div className="panel-head"><h2><History size={16} /> Open / close history</h2></div>
              {!d.endDateHistory.length ? <p className="muted small">The lot has never been closed or reopened.</p> : (
                <table className="grid compact"><thead><tr><th>When</th><th>Action</th><th>End date</th><th>By</th></tr></thead>
                  <tbody>{d.endDateHistory.map((h) => <tr key={h.LotCloseChangeID}><td>{fmtDate(h.ChangeDate)}</td><td>{h.Action}</td><td>{fmtDate(h.EndDateNew) || '—'}</td><td className="muted small">{h.ChangeUser}</td></tr>)}</tbody></table>
              )}
            </section>
          </div>

          {/* Stages */}
          <section className="panel" style={{ margin: '16px 0' }}>
            <div className="panel-head"><h2><CalendarPlus size={16} /> Scheduled stages ({d.stages.length})</h2></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Stage</th><th>Work type</th><th>Delivery date</th><th>Notes</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {d.stages.map((s) => editStage?.id === s.StageAutoID ? (
                    <tr key={s.StageAutoID} className="row-selected">
                      <td>{s.ScheduleStage}</td><td>{s.WorkType}</td>
                      <td><input type="date" value={editStage.DeliveryDate} onChange={(e) => setEditStage({ ...editStage, DeliveryDate: e.target.value })} /></td>
                      <td><input value={editStage.Notes ?? ''} onChange={(e) => setEditStage({ ...editStage, Notes: e.target.value })} maxLength={255} /></td><td />
                      <td className="actions"><button className="btn small primary" onClick={saveStage} aria-label="Save"><Save size={13} /></button><button className="btn small ghost" onClick={() => setEditStage(null)} aria-label="Cancel"><X size={13} /></button></td>
                    </tr>
                  ) : (
                    <tr key={s.StageAutoID}>
                      <td>{s.ScheduleStage}</td><td>{s.WorkType}</td><td>{fmtDate(s.DeliveryDate)}</td><td>{s.Notes}</td>
                      <td>{s.DatePosted ? <Badge tone="green">Posted {fmtDate(s.DatePosted)}{s.UserPosted ? ` · ${s.UserPosted}` : ''}</Badge>
                        : new Date(s.DeliveryDate) < new Date(new Date().toDateString()) ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Scheduled</Badge>}</td>
                      <td className="actions">
                        <button className="btn small ghost" onClick={() => setEditStage({ id: s.StageAutoID, DeliveryDate: toInputDate(s.DeliveryDate), Notes: s.Notes })} aria-label="Edit stage"><Pencil size={13} /></button>
                        {!s.DatePosted && <button className="btn small ghost danger" onClick={() => delStage(s.StageAutoID)} aria-label="Remove stage"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                  <tr className="new-row">
                    <td><select value={newStage.ScheduleStageId} onChange={(e) => setNewStage({ ...newStage, ScheduleStageId: e.target.value })} aria-label="Stage"><option value="">Stage…</option>{lk.scheduleStages.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                    <td><select value={newStage.WorkId} onChange={(e) => setNewStage({ ...newStage, WorkId: e.target.value })} aria-label="Work type"><option value="">Work type…</option>{lk.workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                    <td><input type="date" value={newStage.DeliveryDate} onChange={(e) => setNewStage({ ...newStage, DeliveryDate: e.target.value })} aria-label="Delivery date" /></td>
                    <td><input value={newStage.Notes} onChange={(e) => setNewStage({ ...newStage, Notes: e.target.value })} placeholder="Notes" maxLength={255} /></td><td />
                    <td className="actions"><button className="btn small primary" onClick={addStage}><Plus size={13} /> Add</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Packs */}
          <section className="panel">
            <div className="panel-head"><h2>Scheduled packs ({d.packs.length})</h2><span className="muted small">{d.availablePacks.length} packs available from the plan and universal plan</span></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Pack</th><th>Code</th><th>Type</th><th className="num">Qty</th><th className="num">Posted</th><th className="num">Contract ea</th><th /></tr></thead>
                <tbody>
                  {d.packs.map((p) => editPack?.id === p.PackID ? (
                    <tr key={p.PackID} className="row-selected">
                      <td>{p.PackName}</td><td>{p.BuilderCode}</td><td>{p.PackType}</td>
                      <td className="num"><input className="pct-input" value={editPack.PackQty} onChange={(e) => setEditPack({ ...editPack, PackQty: e.target.value })} inputMode="numeric" /></td>
                      <td /><td /><td className="actions"><button className="btn small primary" onClick={savePack} aria-label="Save"><Save size={13} /></button><button className="btn small ghost" onClick={() => setEditPack(null)} aria-label="Cancel"><X size={13} /></button></td>
                    </tr>
                  ) : (
                    <tr key={p.PackID}>
                      <td className="wrap">{p.PackName} {!p.PackActive ? <Badge tone="red">inactive pack</Badge> : null}</td><td>{p.BuilderCode}</td><td>{p.PackType}</td>
                      <td className="num">{p.PackQty}</td>
                      <td className="num">{p.PostedQty >= p.PackQty && p.PackQty > 0 ? <Badge tone="green">{p.PostedQty}</Badge> : p.PostedQty ? <Badge tone="amber">{p.PostedQty} / {p.PackQty}</Badge> : <span className="faint">0</span>}</td>
                      <td className="num">{p.ContractEa}</td>
                      <td className="actions">
                        <button className="btn small ghost" onClick={() => setEditPack({ id: p.PackID, PackQty: p.PackQty })} aria-label="Change quantity"><Pencil size={13} /></button>
                        {p.PostedQty === 0 && p.PostedLaborQty === 0 && <button className="btn small ghost danger" onClick={() => delPack(p.PackID)} aria-label="Remove pack"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                  <tr className="new-row">
                    <td colSpan={3}>
                      <select value={newPack.PmPackId} onChange={(e) => setNewPack({ ...newPack, PmPackId: e.target.value })} aria-label="Pack to add">
                        <option value="">Add a pack…</option>
                        {['Standard', 'Optional'].map((g, gi) => (
                          <optgroup key={g} label={g}>
                            {d.availablePacks.filter((a) => !d.packs.some((p) => p.PmPackId === a.id) && (gi === 0 ? /std|standard/i.test(a.PackType || '') : !/std|standard/i.test(a.PackType || '')))
                              .map((a) => <option key={a.id} value={a.id}>{a.PackName}{a.BuilderCode ? ` [${a.BuilderCode}]` : ''}{a.Universal ? ' · universal' : ''}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="num"><input className="pct-input" value={newPack.PackQty} onChange={(e) => setNewPack({ ...newPack, PackQty: e.target.value })} inputMode="numeric" aria-label="Quantity" /></td>
                    <td colSpan={2} /><td className="actions"><button className="btn small primary" disabled={!newPack.PmPackId} onClick={addPack}><Plus size={13} /> Add</button></td>
                  </tr>
                </tbody>
              </table>
              {!d.packs.length && <EmptyState title="No packs scheduled">Add the standard packs for this lot's plan, then any options.</EmptyState>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
