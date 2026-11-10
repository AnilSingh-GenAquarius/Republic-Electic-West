// Phase = Access form JsPhase "Phase and Lot setup" (phase type, bid, superintendents, dates) with its lot subform JsPhaseSubLot.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarRange, Home as HomeIcon, Lock, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, Warnings, changed, useConfirm, useJsLookups } from './shared'

const FIELDS = ['Phase', 'PhaseNum', 'PhaseTypeId', 'PmContractId', 'SuperId1', 'SuperId2', 'StartDate', 'EndDate', 'Notes']
const today = () => new Date().toISOString().slice(0, 10)
const EMPTY = { Phase: '', PhaseNum: '', PhaseTypeId: '', PmContractId: '', SuperId1: '', SuperId2: '', StartDate: today(), EndDate: '', Notes: '' }
const LOT_FIELDS = ['Lot', 'Block', 'PmPlanId', 'StartDate', 'Address', 'City', 'State', 'Zip', 'Permit', 'StatusId', 'LotNotes']

export default function JsPhase() {
  const { id, jobId } = useParams()
  const isNew = !id
  const nav = useNavigate()
  const lk = useJsLookups()
  const [dialog, ask] = useConfirm()
  const [d, setD] = useState(null) // { phase, lots, bids, phaseTypes, plans, packsScheduled } or for new: { job, bids, phaseTypes }
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [warnings, setWarnings] = useState([])
  const [saving, setSaving] = useState(false)
  const [lot, setLot] = useState(null) // lot being added / edited
  const [lotError, setLotError] = useState('')

  const load = useCallback(async () => {
    if (isNew) {
      const r = await api(`/js/jobs/${jobId}/phase-options`)
      setD(r); setForm(EMPTY); return
    }
    const r = await api(`/js/phases/${id}`)
    setD(r)
    const f = {}; for (const k of FIELDS) f[k] = r.phase[k] == null ? '' : k.endsWith('Date') ? toInputDate(r.phase[k]) : String(r.phase[k])
    setForm(f)
  }, [id, jobId, isNew])
  useEffect(() => { setError(''); load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })

  async function save(e) {
    e.preventDefault(); setError(''); setMsg(''); setWarnings([])
    setSaving(true)
    try {
      if (isNew) {
        const body = { ...form }
        if (!body.PhaseNum) delete body.PhaseNum // server copies the phase name (as the sample data does)
        const r = await api(`/js/jobs/${jobId}/phases`, { method: 'POST', body })
        nav(`/js/phases/${r.id}`, { replace: true })
      } else {
        const body = changed(Object.fromEntries(FIELDS.map((k) => [k, d.phase[k]])), form, FIELDS)
        if (!Object.keys(body).length) { setMsg('Nothing changed'); return }
        const r = await api(`/js/phases/${id}`, { method: 'PUT', body })
        setWarnings(r.warnings || []); setMsg('Phase saved'); await load()
      }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete phase?', message: `Delete phase ${d.phase.Phase}? This cannot be undone.`, ok: 'Delete', danger: true }))) return
    try { await api(`/js/phases/${id}`, { method: 'DELETE' }); nav(`/js/jobs/${d.phase.JobId}`) } catch (err) { setError(err.message) }
  }

  // ---- lots
  const newLot = () => { setLotError(''); setLot({ LotID: null, Lot: '', Block: '', PmPlanId: '', StartDate: toInputDate(d.phase.StartDate), Address: '', City: '', State: '', Zip: '', Permit: '', StatusId: '1', LotNotes: '' }) }
  const editLot = (l) => {
    setLotError('')
    const x = { LotID: l.LotID, Packs: l.Packs, _orig: l }
    for (const k of LOT_FIELDS) x[k] = l[k] == null ? '' : k === 'StartDate' ? toInputDate(l[k]) : String(l[k])
    setLot(x)
  }
  const lf = (k) => ({ value: lot?.[k] ?? '', onChange: (e) => setLot((s) => ({ ...s, [k]: k === 'State' ? e.target.value.toUpperCase() : e.target.value })) })
  async function saveLot(e) {
    e.preventDefault(); setLotError(''); setMsg('')
    try {
      if (!lot.LotID) {
        const body = {}; for (const k of LOT_FIELDS) body[k] = lot[k]
        await api(`/js/phases/${id}/lots`, { method: 'POST', body })
        setMsg(`Lot ${lot.Lot}${lot.Block ? '/' + lot.Block : ''} added`)
      } else {
        const body = changed(lot._orig, lot, LOT_FIELDS)
        if (Object.keys(body).length) await api(`/js/lots/${lot.LotID}`, { method: 'PUT', body })
        setMsg(`Lot ${lot.Lot}${lot.Block ? '/' + lot.Block : ''} saved`)
      }
      setLot(null); await load()
    } catch (err) { setLotError(err.message) }
  }
  async function deleteLot(l) {
    if (!(await ask({ title: 'Delete lot?', message: `Delete lot ${l.LotBlock}${l.Address ? ' – ' + l.Address : ''}? This cannot be undone.`, ok: 'Delete', danger: true }))) return
    setError(''); setMsg('')
    try { await api(`/js/lots/${l.LotID}`, { method: 'DELETE' }); setMsg(`Lot ${l.LotBlock} deleted`); await load() } catch (err) { setError(err.message) }
  }

  const ph = d?.phase
  const job = isNew ? d?.job : ph && { JobId: ph.JobId, JobName: ph.JobName }
  const supers = lk.superintendents
  const bidLocked = !isNew && d?.packsScheduled > 0
  return (
    <div className="page">
      {dialog}
      <PageHeader track={!isNew && !!ph}
        crumb={<><Link to="/js">Job setup</Link>{ph?.CustName && <> / <Link to={`/js/builders/${ph.CustId}`}>{ph.CustName}</Link></>}{job && <> / <Link to={`/js/jobs/${job.JobId}`}>{job.JobName}</Link></>}</>}
        title={isNew ? 'New phase' : ph ? `Phase ${ph.Phase}` : 'Phase'}
        subtitle={ph ? [ph.PhaseType, ph.BidNum && `Bid ${ph.BidNum}${ph.BidRelease ? ' effective ' + ph.BidRelease : ''}`, ph.DivisionId].filter(Boolean).join(' · ') : null}
        actions={<>
          {ph && <Link className="btn" to={`/sc/phases/${id}`}><CalendarRange size={15} /> Schedule lots</Link>}
          {job && <Link className="btn" to={`/js/jobs/${job.JobId}`}><ArrowLeft size={15} /> Job</Link>}
        </>} />
      <JsTabs />
      {ph?.WarningJS && <div className="banner"><AlertTriangle size={16} /> This is a complex job, make sure you select the appropriate bid for each lot.</div>}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      <Warnings list={warnings} />
      {!d && !error ? <SkeletonRows rows={8} cols={3} /> : d && (
        <form className="card form" onSubmit={save} noValidate>
          {!d.phaseTypes.length && <div className="banner"><AlertTriangle size={16} /> The job has no job type, so no phase type can be chosen. Set the job type on the job first.</div>}
          <fieldset>
            <legend>Phase</legend>
            <label>Phase *<input required maxLength={50} {...f('Phase')} /></label>
            <label>Phase num<input maxLength={50} placeholder={isNew ? 'Same as phase' : ''} {...f('PhaseNum')} /></label>
            <label>Phase type *<select required {...f('PhaseTypeId')}><option value="" />{d.phaseTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="span2">PM bid
              <select {...f('PmContractId')} disabled={bidLocked} aria-describedby={bidLocked ? 'bid-locked' : undefined}>
                <option value="" />
                {d.bids.map((b) => <option key={b.id} value={b.id}>{b.name}{b.BidName ? ` – ${b.BidName}` : ''}{b.Status && b.Status !== 'Active' ? ` (${b.Status})` : ''}</option>)}
              </select>
              {bidLocked && <span id="bid-locked" className="muted small"><Lock size={11} /> You cannot change the bid. You already have packs scheduled for these lots.</span>}
              {!d.bids.length && <span className="muted small">The job is not linked to a Plan-management job with bids.</span>}
            </label>
            <label>Super high voltage *<select required {...f('SuperId1')}><option value="" />{supers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.Active ? '' : ' (inactive)'}</option>)}</select></label>
            <label>Super low voltage<select {...f('SuperId2')}><option value="" />{supers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.Active ? '' : ' (inactive)'}</option>)}</select></label>
            <label>Start date<input type="date" {...f('StartDate')} /></label>
            <label>End date<input type="date" {...f('EndDate')} /></label>
            <label className="span3">Notes<textarea rows={2} maxLength={255} {...f('Notes')} /></label>
          </fieldset>
          <div className="row form-actions">
            <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create phase' : 'Save changes'}</button>
            {!isNew && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
            {ph && <span className="muted small">Phase ID {ph.PhaseID} · entered {fmtDate(ph.DateEntered)} by {ph.UserEntered || '—'}</span>}
          </div>
        </form>
      )}

      {ph && (
        <section className="card">
          <div className="panel-head">
            <h2><HomeIcon size={16} /> Lots ({d.lots.length})</h2>
            {!lot && <button type="button" className="btn small primary" onClick={newLot} disabled={!ph.PmContractId} title={ph.PmContractId ? '' : 'Choose a bid first'}><Plus size={13} /> Add lot</button>}
          </div>
          {!ph.PmContractId && <p className="muted small">Choose a PM bid for the phase before adding lots — the plan list comes from the bid.</p>}
          {lot && (
            <form className="form js-lot-form" onSubmit={saveLot} noValidate aria-label={lot.LotID ? 'Edit lot' : 'New lot'}>
              {lotError && <ErrorState message={lotError} />}
              <fieldset>
                <legend>{lot.LotID ? `Edit lot ${lot._orig.LotBlock}` : 'New lot'}</legend>
                <label>Lot *<input required maxLength={50} {...lf('Lot')} /></label>
                <label>Block<input maxLength={50} {...lf('Block')} /></label>
                <label>Plan *
                  <select required {...lf('PmPlanId')} disabled={lot.Packs > 0}>
                    <option value="" />{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.SqFt ? ` · ${p.SqFt} sf` : ''}</option>)}
                  </select>
                  {lot.Packs > 0 && <span className="muted small"><Lock size={11} /> You cannot change the plan. You already have scheduled packs linked to the original entry.</span>}
                </label>
                <label>Start date<input type="date" {...lf('StartDate')} /></label>
                <label>Status<select {...lf('StatusId')}><option value="1">Active</option><option value="0">Inactive</option></select></label>
                <label className="span2">Address<input maxLength={50} {...lf('Address')} /></label>
                <label>City<input maxLength={50} list="js-lot-cities" {...lf('City')} /></label>
                <label>State<input maxLength={2} placeholder="CA" {...lf('State')} /></label>
                <label>Zip<input inputMode="numeric" maxLength={9} {...lf('Zip')} /></label>
                <label>Permit<input maxLength={255} {...lf('Permit')} /></label>
                <label className="span2">Notes<input maxLength={255} {...lf('LotNotes')} /></label>
              </fieldset>
              <datalist id="js-lot-cities">{lk.cities.map((c) => <option key={c.id} value={c.name}>{c.State}</option>)}</datalist>
              <div className="row">
                <button className="btn primary"><Save size={15} /> {lot.LotID ? 'Save lot' : 'Add lot'}</button>
                <button type="button" className="btn ghost" onClick={() => setLot(null)}><X size={15} /> Cancel</button>
              </div>
            </form>
          )}
          {!d.lots.length ? <EmptyState icon={HomeIcon} title="No lots in this phase yet" /> : (
            <div className="table-wrap flat" style={{ marginTop: lot ? 16 : 0 }}>
              <table className="grid compact">
                <thead><tr><th>Lot/Block</th><th>Plan</th><th>Address</th><th>Start</th><th>End</th><th>Status</th><th>Permit</th><th className="num">Packs</th><th /></tr></thead>
                <tbody>{d.lots.map((l) => (
                  <tr key={l.LotID} className={lot?.LotID === l.LotID ? 'row-selected' : l.EndDate ? 'dim' : ''}>
                    <td><Link to={`/js/lots/${l.LotID}`}><b>{l.LotBlock}</b></Link></td><td>{l.PlanNum}</td>
                    <td>{[l.Address, l.City, l.State].filter(Boolean).join(', ')}</td><td>{fmtDate(l.StartDate)}</td><td>{fmtDate(l.EndDate)}</td>
                    <td>{l.EndDate ? <Badge tone="neutral" icon={Lock}>Closed</Badge> : <Badge tone={l.Status === 'Active' ? 'green' : 'neutral'}>{l.Status}</Badge>}</td>
                    <td>{l.Permit}</td><td className="num">{l.Packs}</td>
                    <td className="actions">
                      {l.EndDate
                        ? <span className="muted small" title="This lot is closed. You need to open the lot before you can modify it.">closed</span>
                        : <button type="button" className="btn small ghost" onClick={() => editLot(l)} aria-label={`Edit lot ${l.LotBlock}`}>Edit</button>}
                      <Link className="btn small ghost" to={`/sc/lots/${l.LotID}`} aria-label={`Schedule lot ${l.LotBlock}`}>Schedule</Link>
                      <button type="button" className="btn small ghost danger" onClick={() => deleteLot(l)} aria-label={`Delete lot ${l.LotBlock}`}><Trash2 size={13} /></button>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
