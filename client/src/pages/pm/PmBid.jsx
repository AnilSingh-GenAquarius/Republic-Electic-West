// Plan data management for one bid (Access PlanManagement): bid header, plans, packs of the selected plan.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Lock, LockOpen, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PmTabs, download, int, money, usePmLookups, yes } from './shared'

const blankPlan = { PlanNum: '', PlanName: '', SqFt: '', Bedrooms: '', ACunits: false, TvOutlet: '', Island: '', FloorPlug: '', Detached: '', GrGearId: '', Universal: false, ContractVal: '', StatusId: '1', Notes: '' }
const blankPack = { PackName: '', PackTypeId: '1', BuilderCode: '', Quantity: '1', ContractVal: '', ContractValCost: '', EstBuildTime: '', Verified: false, Substitution: false, TruedUp: false, StatusId: '1', Notes: '' }

export default function PmBid() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = usePmLookups()
  const [sp, setSp] = useSearchParams()
  const planId = Number(sp.get('plan')) || null
  const [d, setD] = useState(null)
  const [packs, setPacks] = useState(null)
  const [plan, setPlan] = useState(null)
  const [pack, setPack] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => { const r = await api(`/pm/contracts/${id}`); setD(r); if (!planId && r.plans[0]) setSp({ plan: r.plans[0].PmPlanID }, { replace: true }) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPacks = useCallback(async () => { if (!planId) { setPacks(null); return } setPacks(await api(`/pm/plans/${planId}/packs`)) }, [planId])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  useEffect(() => { loadPacks().catch((e) => setError(e.message)) }, [loadPacks])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (ok) setMsg(typeof ok === 'function' ? ok(r) : ok); await load(); await loadPacks() } catch (e) { setError(e.message) } }

  const c = d?.contract
  const toggleLock = run(() => api(`/pm/contracts/${id}`, { method: 'PUT', body: { Lock: !c.Lock } }), () => (c.Lock ? 'Bid unlocked' : 'Bid locked'))
  const setStatus = run((s) => api(`/pm/contracts/${id}`, { method: 'PUT', body: { StatusId: s } }), 'Status saved')
  const updatePrices = run(async () => { if (!confirm('Set the cost of every non-labor material line of this bid to the item\'s current job cost price and estimating price?')) return null; return api(`/pm/contracts/${id}/update-prices`, { method: 'POST' }) }, (r) => (r ? `Prices updated on ${int(r.updated)} line(s)` : ''))
  async function deletePlanData() {
    setError(''); setMsg('')
    if (d.scheduledPacks) { setError('Data cannot be deleted as it has already been scheduled'); return }
    if (!confirm('This wipes clean ALL plans, packs and material of this bid. A backup file is downloaded first. Continue?')) return
    try {
      const rows = await api(`/pm/contracts/${id}/plan-data`)
      download(rows, Object.keys(rows[0] || { PlanNum: 1 }).map((k) => [k, k]), `plan-data-backup-${c.BidNum}-${new Date().toISOString().slice(0, 10)}.csv`)
      const r = await api(`/pm/contracts/${id}/delete-plan-data`, { method: 'POST', body: { confirm: true } })
      setMsg(`Deleted ${r.plans} plan(s), ${r.packs} pack(s), ${r.material} material line(s). The backup was downloaded.`); setSp({}, { replace: true }); await load()
    } catch (e) { setError(e.message) }
  }
  const pf = (k) => ({ value: plan?.[k] ?? '', onChange: (e) => setPlan((s) => ({ ...s, [k]: e.target.value })) })
  const kf = (k) => ({ value: pack?.[k] ?? '', onChange: (e) => setPack((s) => ({ ...s, [k]: e.target.value })) })
  const savePlan = run(async (e) => { e.preventDefault(); const body = { ...plan }; delete body.id; if (plan.id) await api(`/pm/plans/${plan.id}`, { method: 'PUT', body }); else { const r = await api(`/pm/contracts/${id}/plans`, { method: 'POST', body }); setSp({ plan: r.id }) } setPlan(null) }, 'Plan saved')
  const delPlan = run(async (pid) => { if (confirm('Delete this plan?')) { await api(`/pm/plans/${pid}`, { method: 'DELETE' }); setSp({}, { replace: true }) } })
  const savePack = run(async (e) => {
    e.preventDefault(); const body = { ...pack }; delete body.id
    if (pack.id) { if (pack.wasTruedUp) { await api(`/pm/packs/${pack.id}`, { method: 'PUT', body: { TruedUp: body.TruedUp } }) } else await api(`/pm/packs/${pack.id}`, { method: 'PUT', body }) } else await api(`/pm/plans/${planId}/packs`, { method: 'POST', body })
    setPack(null)
  }, 'Pack saved')
  const delPack = run(async (kid) => { if (confirm('Delete this pack with its material?')) await api(`/pm/packs/${kid}`, { method: 'DELETE' }) })
  const editPlan = (p) => setPlan({ id: p.PmPlanID, PlanNum: p.PlanNum || '', PlanName: p.PlanName || '', SqFt: p.SqFt ?? '', Bedrooms: p.Bedrooms || '', ACunits: yes(p.ACunits), TvOutlet: p.TvOutlet || '', Island: p.Island || '', FloorPlug: p.FloorPlug || '', Detached: p.Detached || '', GrGearId: p.GrGearId || '', Universal: yes(p.Universal), ContractVal: p.ContractVal ?? '', StatusId: String(p.StatusId ?? 1), Notes: p.Notes || '' })
  const editPack = (k) => setPack({ id: k.PmPackID, wasTruedUp: yes(k.TruedUp), PackName: k.PackName || '', PackTypeId: String(k.PackTypeId ?? ''), BuilderCode: k.BuilderCode || '', Quantity: String(k.Quantity ?? 1), ContractVal: k.ContractVal ?? '', ContractValCost: k.ContractValCost ?? '', EstBuildTime: k.EstBuildTime ?? '', Verified: yes(k.Verified), Substitution: yes(k.Substitution), TruedUp: yes(k.TruedUp), StatusId: String(k.StatusId ?? 1), Notes: k.Notes || '' })
  const selPlan = d?.plans.find((p) => p.PmPlanID === planId)

  return (
    <div className="page">
      <PageHeader crumb={c ? <><Link to="/pm/customers">Customers &amp; bids</Link> / <Link to={`/pm/customers/${c.PmCustId}`}>{c.Customer}</Link></> : null}
        title={c ? `Bid ${[c.BidNum, c.BidRelease].filter(Boolean).join(' ')}${c.BidName ? ` · ${c.BidName}` : ''}` : 'Bid'} track={!!c}
        subtitle={c ? `${c.Job} (${c.DivisionId}) · ${c.JobType || ''} · ${fmtDate(c.BidDate)}` : null}
        actions={c && <>
          <Link className="btn" to={`/pm/customers/${c.PmCustId}`}><ArrowLeft size={15} /> Customer</Link>
          <button className="btn" onClick={toggleLock}>{c.Lock ? <><LockOpen size={15} /> Unlock bid</> : <><Lock size={15} /> Lock bid</>}</button>
          <button className="btn" onClick={updatePrices}><RefreshCw size={15} /> Update item prices</button>
          <button className="btn danger" onClick={deletePlanData}><Trash2 size={15} /> Delete plan data</button>
        </>} />
      <PmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <div className={`banner${c.Lock ? '' : ' pm-unlocked'}`}>{c.Lock ? <Lock size={16} /> : <LockOpen size={16} />} {c.Lock ? 'Bid is locked: plans and packs cannot be copied into it.' : 'Bid is unlocked.'}
            <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>Status <select aria-label="Bid status" value={c.StatusId ?? 1} onChange={(e) => setStatus(Number(e.target.value))}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></span></div>
          {d.scheduledPacks > 0 && <p className="muted small"><AlertTriangle size={13} /> {int(d.scheduledPacks)} pack(s) of this bid are scheduled on lots.</p>}
          <section className="panel">
            <div className="panel-head"><h2>Plans ({d.plans.length})</h2><button className="btn small primary" onClick={() => setPlan({ ...blankPlan })}><Plus size={13} /> Add plan</button></div>
            {plan && (
              <form className="card form pm-inline" onSubmit={savePlan}><fieldset>
                <legend>{plan.id ? 'Edit plan' : 'New plan'}</legend>
                <label>Plan number *<input maxLength={50} aria-label="Plan number" {...pf('PlanNum')} /></label>
                <label>Name<input maxLength={50} aria-label="Plan name" {...pf('PlanName')} /></label>
                <label>Sq ft<input inputMode="numeric" {...pf('SqFt')} /></label>
                <label>Bedrooms<input {...pf('Bedrooms')} /></label>
                <label>TV outlets<input {...pf('TvOutlet')} /></label>
                <label>Island<input {...pf('Island')} /></label>
                <label>Floor plug<input {...pf('FloorPlug')} /></label>
                <label>Detached<input {...pf('Detached')} /></label>
                <label>Gear<select {...pf('GrGearId')}><option value="" />{lk.gears.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                <label>Contract value $<input inputMode="decimal" aria-label="Plan contract value" {...pf('ContractVal')} /></label>
                <label>Status<select {...pf('StatusId')}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="check"><input type="checkbox" checked={!!plan.ACunits} onChange={(e) => setPlan({ ...plan, ACunits: e.target.checked })} /> AC units</label>
                <label className="check"><input type="checkbox" checked={!!plan.Universal} onChange={(e) => setPlan({ ...plan, Universal: e.target.checked })} /> Universal</label>
                <label className="span3">Notes<input maxLength={255} {...pf('Notes')} /></label>
              </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save plan</button><button type="button" className="btn" onClick={() => setPlan(null)}><X size={15} /> Cancel</button></div></form>
            )}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Plan</th><th>Name</th><th className="num">Sq ft</th><th>Bed</th><th className="num">Contract</th><th>Status</th><th className="num">Packs</th><th className="num">Lots</th><th /></tr></thead>
              <tbody>{d.plans.map((p) => (
                <tr key={p.PmPlanID} className={`link-row${planId === p.PmPlanID ? ' selected' : ''}`} onClick={() => setSp({ plan: p.PmPlanID })}>
                  <td><b>{p.PlanNum}</b>{yes(p.Universal) && <> <Badge>Universal</Badge></>}</td><td>{p.PlanName}</td><td className="num">{int(p.SqFt)}</td><td>{p.Bedrooms}</td><td className="num">{money(p.ContractVal)}</td><td>{p.Status}</td><td className="num">{p.Packs}</td><td className="num">{p.Lots || ''}</td>
                  <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn small icon" aria-label={`Edit plan ${p.PlanNum}`} onClick={() => editPlan(p)}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label={`Delete plan ${p.PlanNum}`} onClick={() => delPlan(p.PmPlanID)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}{!d.plans.length && <tr><td colSpan={9}><EmptyState title="No plans in this bid" /></td></tr>}</tbody>
            </table></div>
          </section>

          {selPlan && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2>Packs of plan {selPlan.PlanNum} ({packs?.packs.length ?? '…'})</h2><button className="btn small primary" onClick={() => setPack({ ...blankPack })}><Plus size={13} /> Add pack</button></div>
              {pack && (
                <form className="card form pm-inline" onSubmit={savePack}><fieldset disabled={false}>
                  <legend>{pack.id ? 'Edit pack' : 'New pack'}</legend>
                  {pack.wasTruedUp && <div className="banner span3"><AlertTriangle size={16} /> This pack is trued up, you can edit material and labor only. Untick "Trued up" to change it.</div>}
                  <label className="span2">Pack name *<input maxLength={100} aria-label="Pack name" disabled={pack.wasTruedUp} {...kf('PackName')} /></label>
                  <label>Type *<select aria-label="Pack type" disabled={pack.wasTruedUp} {...kf('PackTypeId')}>{lk.packTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                  <label>Builder code<input maxLength={50} disabled={pack.wasTruedUp} {...kf('BuilderCode')} /></label>
                  <label>Quantity<input inputMode="numeric" disabled={pack.wasTruedUp} {...kf('Quantity')} /></label>
                  <label>Contract value $<input inputMode="decimal" aria-label="Pack contract value" disabled={pack.wasTruedUp} {...kf('ContractVal')} /></label>
                  <label>Contract cost $<input inputMode="decimal" disabled={pack.wasTruedUp} {...kf('ContractValCost')} /></label>
                  <label>Build time (h)<input inputMode="decimal" disabled={pack.wasTruedUp} {...kf('EstBuildTime')} /></label>
                  <label>Status<select disabled={pack.wasTruedUp} {...kf('StatusId')}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <label className="check"><input type="checkbox" disabled={pack.wasTruedUp} checked={!!pack.Verified} onChange={(e) => setPack({ ...pack, Verified: e.target.checked })} /> Verified</label>
                  <label className="check"><input type="checkbox" disabled={pack.wasTruedUp} checked={!!pack.Substitution} onChange={(e) => setPack({ ...pack, Substitution: e.target.checked })} /> Substitution</label>
                  <label className="check"><input type="checkbox" aria-label="Trued up" checked={!!pack.TruedUp} onChange={(e) => setPack({ ...pack, TruedUp: e.target.checked })} /> Trued up</label>
                  <label className="span3">Notes<input maxLength={255} disabled={pack.wasTruedUp} {...kf('Notes')} /></label>
                </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save pack</button><button type="button" className="btn" onClick={() => setPack(null)}><X size={15} /> Cancel</button></div></form>
              )}
              {!packs ? <SkeletonRows rows={6} cols={4} /> : (
                <div className="table-wrap"><table className="grid compact">
                  <thead><tr><th>Type</th><th>Pack</th><th>Code</th><th className="num">Qty</th><th className="num">Items</th><th className="num">Cost</th><th className="num">Contract</th><th>Flags</th><th className="num">On lots</th><th /></tr></thead>
                  <tbody>{packs.packs.map((k) => (
                    <tr key={k.PmPackID} className="link-row" onClick={() => nav(`/pm/packs/${k.PmPackID}`)}>
                      <td>{k.PackType}</td><td className="wrap"><a><b>{k.PackName}</b></a></td><td>{k.BuilderCode}</td><td className="num">{k.Quantity}</td><td className="num">{k.Items}</td><td className="num">{money(k.Cost)}</td><td className="num">{money(k.ContractVal)}</td>
                      <td>{yes(k.TruedUp) && <Badge tone="amber">Trued up</Badge>} {yes(k.Verified) && <Badge tone="green">Verified</Badge>} {k.StatusId !== 1 && <Badge>{k.Status}</Badge>}</td>
                      <td className="num">{k.Scheduled || ''}</td>
                      <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        <button className="btn small icon" aria-label={`Edit pack ${k.PackName}`} onClick={() => editPack(k)}><Pencil size={13} /></button>
                        <button className="btn small icon" aria-label={`Delete pack ${k.PackName}`} onClick={() => delPack(k.PmPackID)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}{!packs.packs.length && <tr><td colSpan={10}><EmptyState title="No packs in this plan" /></td></tr>}</tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
