// Schedule packs by phase — the web version of the Access SchedulePhase form.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, CheckCircle2, PackagePlus, Plus } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ScTabs, lotName, useScLookups } from './shared'

export default function ScPhase() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useScLookups()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [sel, setSel] = useState(new Set())
  const [showOpenOnly, setShowOpenOnly] = useState(true)
  const [panel, setPanel] = useState(null) // 'lots' | 'stage' | null
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => { setError(''); api(`/sc/phases/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  useEffect(load, [load])

  const ph = d?.phase
  const lots = useMemo(() => (d?.lots || []).filter((l) => !showOpenOnly || (l.StatusId && !l.EndDate)), [d, showOpenOnly])
  const allSel = lots.length > 0 && lots.every((l) => sel.has(l.LotID))
  const toggle = (lotId) => setSel((s) => { const n = new Set(s); n.has(lotId) ? n.delete(lotId) : n.add(lotId); return n })

  // --- add lots form ---
  const [lotForm, setLotForm] = useState({ from: '', to: '', Block: '', PmPlanId: '', Address: '', City: '', SubsId: '', StartDate: '' })
  async function addLots(e) {
    e.preventDefault(); setBusy(true); setError(''); setMsg('')
    try {
      const a = lotForm.from.trim(), z = (lotForm.to || lotForm.from).trim()
      const na = parseInt(a, 10), nz = parseInt(z, 10)
      let numbers = [a]
      if (z !== a) {
        if (!Number.isInteger(na) || !Number.isInteger(nz) || nz < na || nz - na > 199) throw new Error('For a range, enter whole lot numbers (up to 200 lots)')
        const width = a.length
        numbers = Array.from({ length: nz - na + 1 }, (_, i) => String(na + i).padStart(width, '0'))
      }
      const lotsBody = numbers.map((n) => ({ Lot: n, Block: lotForm.Block, PmPlanId: lotForm.PmPlanId, Address: numbers.length === 1 ? lotForm.Address : '', City: lotForm.City || ph?.JobCity || '', SubsId: lotForm.SubsId, StartDate: lotForm.StartDate || undefined }))
      const r = await api(`/sc/phases/${id}/lots`, { method: 'POST', body: { lots: lotsBody } })
      setMsg(`${r.ids.length} lot(s) added.`); setPanel(null); setLotForm({ from: '', to: '', Block: '', PmPlanId: '', Address: '', City: '', SubsId: '', StartDate: '' }); load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  // --- schedule stage on selected lots ---
  const [stageForm, setStageForm] = useState({ WorkId: '', ScheduleStageId: '', DeliveryDate: '', stepDays: '0', addDefaultPack: true })
  async function scheduleStage(e) {
    e.preventDefault(); setBusy(true); setError(''); setMsg('')
    try {
      const lotIds = lots.filter((l) => sel.has(l.LotID)).map((l) => l.LotID)
      const r = await api(`/sc/phases/${id}/stages`, { method: 'POST', body: { lotIds, WorkId: stageForm.WorkId, ScheduleStageId: stageForm.ScheduleStageId, DeliveryDate: stageForm.DeliveryDate, stepDays: stageForm.stepDays } })
      let text = `Stage scheduled on ${r.added} lot(s)${r.skipped.length ? `; ${r.skipped.length} skipped (${[...new Set(r.skipped.map((s) => s.reason))].join(', ')})` : ''}.`
      if (stageForm.addDefaultPack && lk.scheduleStages.find((s) => String(s.id) === String(stageForm.ScheduleStageId))?.ScDefaultPack) {
        const dp = await api(`/sc/phases/${id}/default-packs`, { method: 'POST', body: { lotIds, ScheduleStageId: stageForm.ScheduleStageId } })
        text += ` ${dp.added} "${dp.packName}" pack(s) added${dp.missing.length ? `; ${dp.missing.length} lot(s) have no such pack in their plan` : ''}.`
      }
      setMsg(text); setPanel(null); setSel(new Set()); load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const fl = (k) => ({ value: lotForm[k], onChange: (e) => setLotForm((s) => ({ ...s, [k]: e.target.value })) })
  const fs = (k) => ({ value: stageForm[k], onChange: (e) => setStageForm((s) => ({ ...s, [k]: e.target.value })) })

  return (
    <div className="page">
      <PageHeader crumb={<><Link to="/sc">Scheduling</Link> / {ph && <Link to={`/sc/jobs/${ph.JobId}`}>{ph.JobName}</Link>}</>}
        title={ph ? `${ph.JobName} · ${ph.Phase}` : 'Phase'} track={!!ph}
        subtitle={ph ? [ph.CustName, ph.PhaseType, [ph.Super1, ph.Super2].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to={ph ? `/sc/jobs/${ph.JobId}` : '/sc'}><ArrowLeft size={15} /> Phases</Link>
          <button className="btn" onClick={() => setPanel(panel === 'lots' ? null : 'lots')}><Plus size={15} /> Add lots</button>
          <button className="btn primary" disabled={!sel.size} onClick={() => setPanel(panel === 'stage' ? null : 'stage')}><CalendarPlus size={15} /> Schedule stage{sel.size ? ` (${sel.size})` : ''}</button>
        </>} />
      <ScTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {ph?.JobNotes && <div className="banner">Job notes: {ph.JobNotes}</div>}
      {ph?.Notes && <div className="banner">Phase notes: {ph.Notes}</div>}

      {panel === 'lots' && (
        <form className="card form" onSubmit={addLots}>
          <fieldset>
            <legend>Add lots to {ph?.Phase}</legend>
            <label>Lot number (from) *<input required value={lotForm.from} onChange={(e) => setLotForm((s) => ({ ...s, from: e.target.value }))} placeholder="e.g. 101" /></label>
            <label>To (for a range)<input value={lotForm.to} onChange={(e) => setLotForm((s) => ({ ...s, to: e.target.value }))} placeholder="e.g. 120" /></label>
            <label>Block<input maxLength={50} {...fl('Block')} /></label>
            <label>Plan *
              <select required {...fl('PmPlanId')}><option value="" />{d?.plans.map((p) => <option key={p.id} value={p.id}>{p.PlanNum}{p.SqFt ? ` · ${p.SqFt} sf` : ''}</option>)}</select>
            </label>
            <label>Address{lotForm.to && lotForm.to !== lotForm.from ? ' (single lot only)' : ''}<input maxLength={50} disabled={!!lotForm.to && lotForm.to !== lotForm.from} {...fl('Address')} /></label>
            <label>City<input maxLength={50} placeholder={ph?.JobCity || ''} {...fl('City')} /></label>
            <label>Substitution
              <select {...fl('SubsId')}><option value="" />{lk.subsTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label>Start date<input type="date" {...fl('StartDate')} /></label>
          </fieldset>
          <div className="row form-actions">
            <button className="btn primary" disabled={busy}><Plus size={15} /> {busy ? 'Adding…' : 'Add lots'}</button>
            <button type="button" className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
            <span className="muted small">Enter a range (101 to 120) to add many lots with the same plan. Zero-padding is kept.</span>
          </div>
        </form>
      )}

      {panel === 'stage' && (
        <form className="card form" onSubmit={scheduleStage}>
          <fieldset>
            <legend>Schedule a stage on {sel.size} selected lot(s)</legend>
            <label>Work type *
              <select required {...fs('WorkId')}><option value="" />{lk.workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </label>
            <label>Stage *
              <select required {...fs('ScheduleStageId')}><option value="" />{lk.scheduleStages.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </label>
            <label>Delivery date (first lot) *<input type="date" required {...fs('DeliveryDate')} /></label>
            <label>Days between lots<input type="number" min="0" max="30" {...fs('stepDays')} /></label>
            <label className="check span2"><input type="checkbox" checked={stageForm.addDefaultPack} onChange={(e) => setStageForm((s) => ({ ...s, addDefaultPack: e.target.checked }))} />
              Also add the stage's default pack{(() => { const dp = lk.scheduleStages.find((s) => String(s.id) === String(stageForm.ScheduleStageId))?.ScDefaultPack; return dp ? ` (“${dp}”)` : '' })()}
            </label>
          </fieldset>
          <div className="row form-actions">
            <button className="btn primary" disabled={busy}><CalendarPlus size={15} /> {busy ? 'Scheduling…' : 'Schedule'}</button>
            <button type="button" className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
            <span className="muted small">Lots are dated in the order shown. Lots that already have this work type and stage are skipped.</span>
          </div>
        </form>
      )}

      <div className="filters">
        <label className="check"><input type="checkbox" checked={showOpenOnly} onChange={(e) => setShowOpenOnly(e.target.checked)} /> Open lots only</label>
        <span className="muted small">{d ? `${lots.length} of ${d.lots.length} lots` : ''}</span>
      </div>
      <div className="table-wrap">
        {!d ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(lots.map((l) => l.LotID)))} aria-label="Select all lots" /></th>
              <th>Lot</th><th>Plan</th><th>Address</th><th>Status</th><th>Substitution</th><th className="num">Packs</th><th className="num">Open stages</th><th>Next delivery</th><th>End</th>
            </tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.LotID} onClick={() => nav(`/sc/lots/${l.LotID}`)} className={l.EndDate ? 'dim' : ''}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(l.LotID)} onChange={() => toggle(l.LotID)} aria-label={`Select lot ${lotName(l)}`} /></td>
                  <td><b>{lotName(l)}</b></td><td>{l.PlanNum}</td><td>{[l.Address, l.City].filter(Boolean).join(', ')}</td>
                  <td>{l.EndDate || (l.Status && l.Status !== 'Active') ? <Badge>{l.Status || 'Closed'}</Badge> : <Badge tone="green">Active</Badge>}</td>
                  <td>{l.SubsName}</td><td className="num">{l.Packs}</td>
                  <td className="num">{l.OverdueStages ? <Badge tone="red">{l.OpenStages} · {l.OverdueStages} overdue</Badge> : l.OpenStages}</td>
                  <td>{fmtDate(l.NextDelivery)}</td><td>{fmtDate(l.EndDate)}</td>
                </tr>
              ))}
              {!lots.length && <tr><td colSpan={10}><EmptyState icon={PackagePlus} title="No lots">Use “Add lots” to create the first lots in this phase.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
