// Setup job and plan data (Access CxJob): pick a job, set its Cox job type, assessor job names, Cox plans and the
// Cox material of each plan.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CxTabs, money, qty, useCxLookups, yes } from './shared'

export function CxJobs() {
  const nav = useNavigate()
  const lk = useCxLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  useEffect(() => {
    let live = true; setD(null)
    api('/cx/jobs', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Setup job and plan data" subtitle="Go to a job to set its Cox job type, assessor job names and Cox plan material" />
      <CxTabs />
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Search jobs" placeholder="Search job or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">{[['', 'All'], ...lk.cxJobTypes.map((t) => [String(t.id), t.name]), ['none', 'Not set']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${(p.cxType || '') === k ? ' active' : ''}`} onClick={() => set({ cxType: k })}>{l}</button>)}</div>
      </div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={5} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Job</th><th>Customer</th><th>Div</th><th>Status</th><th>Cox job type</th><th className="num">Assessors</th><th className="num">Cox plans</th><th className="num">Lots</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.JobId} className="link-row" onClick={() => nav(`/cx/jobs/${r.JobId}`)}>
                <td><a><b>{r.JobName}</b></a></td><td>{r.CustName}</td><td>{r.DivisionId}</td><td>{r.Status}</td>
                <td>{r.CxJobType ? <Badge tone={r.CxJobTypeId === 3 ? 'neutral' : 'blue'}>{r.CxJobType}</Badge> : <span className="muted">—</span>}</td>
                <td className="num">{r.Assessors}</td><td className="num">{r.Plans}</td><td className="num">{r.Lots}</td>
              </tr>
            ))}
              {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No jobs match" /></td></tr>}</tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

const blankPlan = { PlanNum: '', SqFt: '', Bedrooms: '', CoxElegible: true }

export function CxJob() {
  const { id } = useParams()
  const lk = useCxLookups()
  const [d, setD] = useState(null)
  const [head, setHead] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [newAssessor, setNewAssessor] = useState('')
  const [editAssessor, setEditAssessor] = useState(null)
  const [plan, setPlan] = useState(null) // add / edit form
  const [sel, setSel] = useState(null) // selected CxPlanID
  const load = useCallback(async () => {
    const r = await api(`/cx/jobs/${id}`); setD(r)
    setHead({ CxJobTypeId: String(r.job.CxJobTypeId ?? ''), Notes: r.job.Notes || '' })
    setSel((s) => (r.plans.some((p) => p.CxPlanID === s) ? s : r.plans[0]?.CxPlanID ?? null))
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (r !== false && ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const saveHead = run(async (e) => { e.preventDefault(); await api(`/cx/jobs/${id}`, { method: 'PUT', body: head }) }, 'Job saved')
  const addAssessor = run(async (e) => { e.preventDefault(); await api(`/cx/jobs/${id}/assessors`, { method: 'POST', body: { AssessorName: newAssessor } }); setNewAssessor('') }, 'Assessor job name added')
  const saveAssessor = run(async () => { await api(`/cx/assessors/${editAssessor.id}`, { method: 'PUT', body: { AssessorName: editAssessor.name } }); setEditAssessor(null) }, 'Assessor job name saved')
  const delAssessor = run(async (aid) => { if (!confirm('Delete this assessor job name?')) return false; await api(`/cx/assessors/${aid}`, { method: 'DELETE' }) }, 'Assessor job name deleted')
  const savePlan = run(async (e) => {
    e.preventDefault()
    const body = { PlanNum: plan.PlanNum, SqFt: plan.SqFt, Bedrooms: plan.Bedrooms, CoxElegible: plan.CoxElegible }
    if (plan.id) await api(`/cx/plans/${plan.id}`, { method: 'PUT', body })
    else { const r = await api(`/cx/jobs/${id}/plans`, { method: 'POST', body }); setSel(r.id) }
    setPlan(null)
  }, 'Plan saved')
  const delPlan = run(async (pid) => { if (!confirm('Delete this Cox plan?')) return false; await api(`/cx/plans/${pid}`, { method: 'DELETE' }) }, 'Plan deleted')
  // picking a PM plan fills sq ft and bedrooms like the Access combo columns
  const pickPlanNum = (v) => {
    const o = d.planOptions.find((x) => x.PlanNum === v)
    setPlan((s) => ({ ...s, PlanNum: v, SqFt: s.SqFt || (o?.SqFt != null ? String(o.SqFt) : ''), Bedrooms: s.Bedrooms || (o?.Bedrooms ?? '') }))
  }

  const j = d?.job
  const selPlan = d?.plans.find((p) => p.CxPlanID === sel)
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cx/jobs">Setup job and plan data</Link>} title={j ? j.JobName : 'Job'} track={!!j}
        subtitle={j ? [j.CustName, j.DivisionId, j.JobType, j.Status].filter(Boolean).join(' · ') : null}
        actions={<Link className="btn" to="/cx/jobs"><ArrowLeft size={15} /> Jobs</Link>} />
      <CxTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <form className="card form" onSubmit={saveHead}><fieldset>
            <legend>Cox job</legend>
            <label>Job ID<input value={j.JobId} disabled /></label>
            <label>Customer<input value={j.CustName || ''} disabled /></label>
            <label>City / state<input value={[j.City, j.State].filter(Boolean).join(', ')} disabled /></label>
            <label>Start – end<input value={[fmtDate(j.StartDate), fmtDate(j.EndDate)].filter(Boolean).join(' – ')} disabled /></label>
            <label>Cox job type<select aria-label="Cox job type" value={head.CxJobTypeId} onChange={(e) => setHead({ ...head, CxJobTypeId: e.target.value })}>
              <option value="">Not set</option>{lk.cxJobTypes.map((t) => <option key={t.id} value={t.id}>{t.name} – {t.Description}</option>)}</select></label>
            <label className="span3">Notes<input maxLength={255} value={head.Notes} onChange={(e) => setHead({ ...head, Notes: e.target.value })} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button>
            <span className="muted small">Customer, dates, status and job type are maintained in Job setup. The Cox job type drives which Cox items a plan can use and whether lots get R1 or MDU requests.</span></div></form>

          <div className="dash-grid" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Assessor job names</h2></div>
              <table className="grid compact"><tbody>
                {d.assessors.map((a) => (
                  <tr key={a.AssessorID}>
                    <td>{editAssessor?.id === a.AssessorID ? <input className="cell-input wide" aria-label="Assessor job name" maxLength={255} value={editAssessor.name} onChange={(e) => setEditAssessor({ ...editAssessor, name: e.target.value })} /> : <b>{a.AssessorName}</b>}</td>
                    <td className="num muted small">{a.Lots} lot(s)</td>
                    <td className="row" style={{ gap: 4 }}>
                      {editAssessor?.id === a.AssessorID
                        ? <><button className="btn small icon" aria-label="Save assessor" onClick={saveAssessor}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEditAssessor(null)}><X size={13} /></button></>
                        : <button className="btn small icon" aria-label={`Edit ${a.AssessorName}`} onClick={() => setEditAssessor({ id: a.AssessorID, name: a.AssessorName || '' })}><Pencil size={13} /></button>}
                      <button className="btn small icon" aria-label={`Delete ${a.AssessorName}`} onClick={() => delAssessor(a.AssessorID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
                <tr className="new-row"><td colSpan={2}><input className="cell-input wide" aria-label="New assessor job name" placeholder="Assessor job name (project name on the assessor's page)" maxLength={255} value={newAssessor} onChange={(e) => setNewAssessor(e.target.value)} /></td>
                  <td><button className="btn small primary" disabled={!newAssessor.trim()} onClick={addAssessor}><Plus size={13} /> Add</button></td></tr>
              </tbody></table>
            </section>

            <section className="panel span-2">
              <div className="panel-head"><h2>Cox plans ({d.plans.length})</h2><button className="btn small primary" onClick={() => setPlan({ ...blankPlan })}><Plus size={13} /> Add plan</button></div>
              {plan && (
                <form className="card form" onSubmit={savePlan} style={{ marginBottom: 12 }}><fieldset>
                  <legend>{plan.id ? 'Edit plan' : 'New Cox plan'}</legend>
                  <label>Plan # *<input list="cx-plan-options" aria-label="Plan number" maxLength={50} value={plan.PlanNum} onChange={(e) => pickPlanNum(e.target.value)} />
                    <datalist id="cx-plan-options">{d.planOptions.map((o) => <option key={o.PlanNum} value={o.PlanNum}>{[o.PlanName, o.SqFt && `${o.SqFt} sq ft`].filter(Boolean).join(' · ')}</option>)}</datalist></label>
                  <label>Sq ft<input aria-label="Sq ft" maxLength={255} value={plan.SqFt} onChange={(e) => setPlan({ ...plan, SqFt: e.target.value })} /></label>
                  <label>Bedrooms<input aria-label="Bedrooms" maxLength={255} value={plan.Bedrooms} onChange={(e) => setPlan({ ...plan, Bedrooms: e.target.value })} /></label>
                  <label className="check"><input type="checkbox" checked={!!plan.CoxElegible} onChange={(e) => setPlan({ ...plan, CoxElegible: e.target.checked })} /> Cox eligible</label>
                </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save plan</button><button type="button" className="btn" onClick={() => setPlan(null)}><X size={15} /> Cancel</button></div></form>
              )}
              <div className="table-wrap"><table className="grid compact">
                <thead><tr><th>Plan #</th><th>Sq ft</th><th>Bedrooms</th><th>Cox eligible</th><th className="num">Items</th><th className="num">Bill value</th><th /></tr></thead>
                <tbody>
                  {d.plans.map((p) => (
                    <tr key={p.CxPlanID} className={`link-row${p.CxPlanID === sel ? ' selected' : ''}`} onClick={() => setSel(p.CxPlanID)} style={p.CxPlanID === sel ? { background: 'var(--primary-soft, #eef4ff)' } : undefined}>
                      <td><b>{p.PlanNum}</b></td><td>{p.SqFt}</td><td>{p.Bedrooms}</td><td>{yes(p.CoxElegible) ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
                      <td className="num">{p.Items}</td><td className="num">{money(p.BillValue)}</td>
                      <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        <button className="btn small icon" aria-label={`Edit plan ${p.PlanNum}`} onClick={() => setPlan({ id: p.CxPlanID, PlanNum: p.PlanNum || '', SqFt: p.SqFt || '', Bedrooms: p.Bedrooms || '', CoxElegible: yes(p.CoxElegible) })}><Pencil size={13} /></button>
                        <button className="btn small icon" aria-label={`Delete plan ${p.PlanNum}`} onClick={() => delPlan(p.CxPlanID)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!d.plans.length && <tr><td colSpan={7}><EmptyState title="No Cox plans yet" /></td></tr>}
                </tbody>
              </table></div>
            </section>
          </div>
          {selPlan && <PlanMaterial key={selPlan.CxPlanID} plan={selPlan} items={d.items} cxType={j.CxJobType} onChange={load} />}
        </>
      )}
    </div>
  )
}

// CxJobSubMaterial: material of one Cox plan
function PlanMaterial({ plan, items, cxType, onChange }) {
  const [d, setD] = useState(null)
  const [add, setAdd] = useState({ CxItemId: '', QuantityCox: '', QuantityTrue: '' })
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => setD(await api(`/cx/plans/${plan.CxPlanID}/material`)), [plan.CxPlanID])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn) => async (...a) => { setError(''); try { const r = await fn(...a); if (r === false) return; await load(); onChange() } catch (e) { setError(e.message) } }
  const addLine = run(async () => { await api(`/cx/plans/${plan.CxPlanID}/material`, { method: 'POST', body: add }); setAdd({ CxItemId: '', QuantityCox: '', QuantityTrue: '' }) })
  const saveLine = run(async () => { await api(`/cx/material/${edit.id}`, { method: 'PUT', body: { CxItemId: edit.CxItemId, QuantityCox: edit.QuantityCox, QuantityTrue: edit.QuantityTrue } }); setEdit(null) })
  const delLine = run(async (mid) => { if (!confirm('Delete this material line?')) return false; await api(`/cx/material/${mid}`, { method: 'DELETE' }) })
  const itemSel = (value, onCh, label, cur) => (
    <select aria-label={label} value={value} onChange={(e) => onCh(e.target.value)}>
      <option value="">Item…</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.Description ? ` – ${i.Description}` : ''}</option>)}
      {cur && !items.some((i) => String(i.id) === String(cur.CxItemId)) && <option value={cur.CxItemId}>{cur.Item} (other job type)</option>}
    </select>
  )
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Material – plan {plan.PlanNum}{plan.Bedrooms ? ` · ${plan.Bedrooms} bedrooms` : ''}</h2>
        <span className="muted small">{cxType ? `Items of Cox job type ${cxType}` : 'Set the Cox job type of the job to list its items'}</span></div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={3} cols={4} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Item</th><th className="num">Cox pay qty</th><th className="num">True qty</th><th className="num">Bill price</th><th className="num">Ext bill</th><th /></tr></thead>
          <tbody>
            {d.rows.map((m) => edit?.id === m.CxMaterialID ? (
              <tr key={m.CxMaterialID} className="editing">
                <td>{itemSel(edit.CxItemId, (v) => setEdit({ ...edit, CxItemId: v }), 'Line item', m)}</td>
                <td className="num"><input className="cell-input" aria-label="Cox pay quantity" value={edit.QuantityCox} onChange={(e) => setEdit({ ...edit, QuantityCox: e.target.value })} /></td>
                <td className="num"><input className="cell-input" aria-label="True quantity" value={edit.QuantityTrue} onChange={(e) => setEdit({ ...edit, QuantityTrue: e.target.value })} /></td>
                <td colSpan={2} />
                <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save line" onClick={saveLine}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
              </tr>
            ) : (
              <tr key={m.CxMaterialID}>
                <td><b>{m.Item}</b>{m.Description ? <span className="muted"> – {m.Description}</span> : null}</td>
                <td className="num">{qty(m.QuantityCox)}</td><td className="num">{qty(m.QuantityTrue)}</td><td className="num">{money(m.BillPrice)}</td><td className="num">{money(m.ExtBill)}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small icon" aria-label={`Edit ${m.Item}`} onClick={() => setEdit({ id: m.CxMaterialID, CxItemId: String(m.CxItemId ?? ''), QuantityCox: m.QuantityCox ?? '', QuantityTrue: m.QuantityTrue ?? '' })}><Pencil size={13} /></button>
                  <button className="btn small icon" aria-label={`Delete ${m.Item}`} onClick={() => delLine(m.CxMaterialID)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            <tr className="new-row">
              <td>{itemSel(add.CxItemId, (v) => setAdd({ ...add, CxItemId: v }), 'New line item')}</td>
              <td className="num"><input className="cell-input" aria-label="New Cox pay quantity" value={add.QuantityCox} onChange={(e) => setAdd({ ...add, QuantityCox: e.target.value })} /></td>
              <td className="num"><input className="cell-input" aria-label="New true quantity" value={add.QuantityTrue} onChange={(e) => setAdd({ ...add, QuantityTrue: e.target.value })} /></td>
              <td colSpan={2} />
              <td><button className="btn small primary" disabled={!add.CxItemId} onClick={addLine}><Plus size={13} /> Add</button></td>
            </tr>
          </tbody>
          <tfoot><tr><td colSpan={4}><b>Total</b></td><td className="num"><b>{money(d.rows.reduce((a, r) => a + Number(r.ExtBill || 0), 0))}</b></td><td /></tr></tfoot>
        </table></div>
      )}
    </section>
  )
}
