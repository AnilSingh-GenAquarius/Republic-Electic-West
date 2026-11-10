// Assembly bid management (Access EsBid): plans (EsBidSubPlan) → assemblies (EsBidSubAssembly, EsSelectAssembly),
// assembly cost by cost code (EsBidSubPlanCalc), "Create standard packs" (EstimatingCreatePack), and the plan's packs /
// options (EsBidSubOptPack) filled from assemblies (EsSelectOptAssembly).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Layers, ListPlus, PackagePlus, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { api } from '../../api'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import BidHeader from './BidHeader'
import { AssemblySelector, EsTabs, FormCard, Fields, PACK_FIELDS, PLAN_FIELDS, PLAN_TABS, PackNameInput, TabbedFields, bidLabel, blankPack, blankPlan, int, money, toForm, useEsLookups, yes } from './shared'

export function PackForm({ pack, setPack, lk, jobId, customerId, onSubmit, busy }) {
  async function suggest() {
    if (!pack.PackName) return
    const r = await api('/es/pick/builder-code', { params: { packName: pack.PackName, customerId } }).catch(() => null)
    if (r?.BuilderCode) setPack((s) => ({ ...s, BuilderCode: r.BuilderCode }))
  }
  return (
    <FormCard legend={pack.id ? 'Edit pack' : 'New pack'} onSubmit={onSubmit} onCancel={() => setPack(null)} saveLabel="Save pack" busy={busy}>
      <PackNameInput value={pack.PackName} jobId={jobId} onChange={(v) => setPack((s) => ({ ...s, PackName: v }))} />
      <Fields fields={PACK_FIELDS} value={pack} onChange={setPack} lk={lk} />
      <div className="span3"><button type="button" className="btn small" disabled={!pack.PackName} onClick={suggest}><Wand2 size={13} /> Builder code used for this pack before</button></div>
    </FormCard>
  )
}

export default function EsBid() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useEsLookups()
  const [sp, setSp] = useSearchParams()
  const planId = Number(sp.get('plan')) || null
  const [d, setD] = useState(null)
  const [pd, setPd] = useState(null)
  const [plan, setPlan] = useState(null)
  const [pack, setPack] = useState(null)
  const [selecting, setSelecting] = useState(null) // 'plan' | packId
  const [qty, setQty] = useState({})
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { const r = await api(`/es/bids/${id}`); setD(r); if (!planId && r.plans[0]) setSp({ plan: r.plans[0].EsPlanID }, { replace: true }) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPlan = useCallback(async () => { if (!planId) { setPd(null); return } const r = await api(`/es/plans/${planId}`); setPd(r); setQty({}) }, [planId])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  useEffect(() => { loadPlan().catch((e) => setError(e.message)) }, [loadPlan])
  const run = (fn, ok) => async (...a) => {
    setError(''); setMsg(''); setBusy(true)
    try { const r = await fn(...a); if (ok && r !== false) setMsg(typeof ok === 'function' ? ok(r) : ok); await load(); await loadPlan() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const b = d?.bid
  const createPacks = run(async () => {
    if (!confirm('Create the standard packs of this bid from its unposted assemblies? Plans without packs get packs named after each stage\'s default pack; the assembly material is added to the standard packs and the assemblies are marked posted.')) return false
    return api(`/es/bids/${id}/create-packs`, { method: 'POST' })
  }, (r) => `Created ${int(r.packs)} pack(s) and ${int(r.material)} material line(s); ${int(r.posted)} assembly line(s) posted. Continue in material bid management.`)
  const savePlan = run(async (e) => { e.preventDefault(); const body = { ...plan }; delete body.id; if (plan.id) await api(`/es/plans/${plan.id}`, { method: 'PUT', body }); else { const r = await api(`/es/bids/${id}/plans`, { method: 'POST', body }); setSp({ plan: r.id }) } setPlan(null) }, 'Plan saved')
  const delPlan = run(async (pid) => { if (!confirm('Delete this plan with its assemblies?')) return false; await api(`/es/plans/${pid}`, { method: 'DELETE' }); setSp({}, { replace: true }) }, 'Plan deleted')
  const addAssemblies = run(async (items) => { const r = await api(`/es/plans/${planId}/assemblies`, { method: 'POST', body: { items } }); setSelecting(null); return r }, (r) => `${r.added} assembly line(s) added`)
  const saveQty = run(async (a) => api(`/es/assemblies/${a.EsAssemblyID}`, { method: 'PUT', body: { Qty: qty[a.EsAssemblyID] } }), 'Quantity saved')
  const delAssembly = run(async (aid) => { if (!confirm('Remove this assembly from the plan?')) return false; return api(`/es/assemblies/${aid}`, { method: 'DELETE' }) })
  const savePack = run(async (e) => { e.preventDefault(); const body = { ...pack }; delete body.id; if (pack.id) await api(`/es/packs/${pack.id}`, { method: 'PUT', body }); else await api(`/es/plans/${planId}/packs`, { method: 'POST', body }); setPack(null) }, 'Pack saved')
  const delPack = run(async (kid) => { if (!confirm('Delete this pack with its material?')) return false; return api(`/es/packs/${kid}`, { method: 'DELETE' }) }, 'Pack deleted')
  const addOptAssemblies = run(async (items) => { const r = await api(`/es/packs/${selecting}/assemblies`, { method: 'POST', body: { items } }); setSelecting(null); return r }, (r) => `${int(r.material)} material line(s) added to the pack`)
  const selPlan = d?.plans.find((p) => p.EsPlanID === planId)
  const selPackName = pd?.packs.find((k) => k.EsPackID === selecting)?.PackName
  const asmTotal = (pd?.assemblies || []).reduce((a, x) => a + Number(x.Qty || 0) * Number(x.UnitValue || 0), 0)

  return (
    <div className="page">
      <PageHeader crumb={b ? <><Link to="/es/customers">Customers &amp; bids</Link> / <Link to={`/es/customers/${b.PmCustID}`}>{b.Customer}</Link></> : null}
        title={b ? `Assembly bid management · ${bidLabel(b)}` : 'Assembly bid management'} track={!!b} subtitle={b ? `${b.Customer} · ${b.Job}` : null}
        actions={b && <>
          <Link className="btn" to={`/es/customers/${b.PmCustID}`}><ArrowLeft size={15} /> Customer</Link>
          <button className="btn primary" disabled={busy} onClick={createPacks}><PackagePlus size={15} /> Create standard packs</button>
          <Link className="btn" to={`/es/bids/${id}/material`}>Material bid management</Link>
          <Link className="btn" to={`/es/reports?report=bid-detail&customerId=${b.PmCustID}&jobId=${b.PmJobID}&bidId=${id}`}>Bid full detail</Link>
        </>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <BidHeader bid={b} lk={lk} onError={setError} onSaved={async (m) => { setMsg(m); await load() }} />
          <section className="panel">
            <div className="panel-head"><h2>Plans ({d.plans.length})</h2><button className="btn small primary" onClick={() => setPlan(blankPlan())}><Plus size={13} /> New plan</button></div>
            {plan && <FormCard legend={plan.id ? 'Edit plan' : 'New plan'} onSubmit={savePlan} onCancel={() => setPlan(null)} saveLabel="Save plan" busy={busy}><TabbedFields tabs={PLAN_TABS} value={plan} onChange={setPlan} lk={lk} /></FormCard>}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Plan</th><th>Name</th><th className="num">Sq ft</th><th>Bed</th><th className="num">Assemblies</th><th>Unposted</th><th className="num">Packs</th><th className="num">Assembly material</th><th className="num">Assembly labor</th><th className="num">Assembly total</th><th className="num">Contract</th><th /></tr></thead>
              <tbody>{d.plans.map((p) => (
                <tr key={p.EsPlanID} className={`link-row${planId === p.EsPlanID ? ' selected' : ''}`} onClick={() => setSp({ plan: p.EsPlanID })}>
                  <td><b>{p.PlanNum}</b>{yes(p.Universal) && <> <Badge>Universal</Badge></>}</td><td>{p.PlanName}</td><td className="num">{p.SqFt ?? ''}</td><td>{p.Bedrooms}</td><td className="num">{p.Assemblies}</td>
                  <td>{p.Unposted ? <Badge tone="amber">{p.Unposted}</Badge> : p.Assemblies ? <Badge tone="green">Posted</Badge> : <Badge tone="red">None</Badge>}</td><td className="num">{p.Packs}</td>
                  <td className="num">{money(p.asmCalc && p.asmCalc.Mat + p.asmCalc.MatTax + p.asmCalc.MatCont)}</td><td className="num">{money(p.asmCalc && p.asmCalc.Labor + p.asmCalc.LaborCont)}</td><td className="num"><b>{money(p.asmCalc?.Total)}</b></td><td className="num">{money(p.ContractValNum)}</td>
                  <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn small icon" aria-label={`Edit plan ${p.PlanNum}`} onClick={() => setPlan({ id: p.EsPlanID, ...toForm(p, PLAN_FIELDS) })}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label={`Delete plan ${p.PlanNum}`} onClick={() => delPlan(p.EsPlanID)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}{!d.plans.length && <tr><td colSpan={12}><EmptyState title="No plans in this bid" /></td></tr>}</tbody>
            </table></div>
            <p className="muted small">Assembly total = material + tax + material contingency + labor + labor contingency, plus overhead, profit and wrap, less discount (frmEsBidAssCalc).</p>
          </section>

          {selPlan && (
            <div className="dash-grid" style={{ marginTop: 16 }}>
              <section className="panel span-2">
                <div className="panel-head"><h2>Assemblies of plan {selPlan.PlanNum}</h2><button className="btn small primary" onClick={() => setSelecting('plan')}><ListPlus size={13} /> Select assemblies for std packs</button></div>
                {selecting === 'plan' && <AssemblySelector title={`Select assemblies for plan ${selPlan.PlanNum}`} busy={busy} onAdd={addAssemblies} onCancel={() => setSelecting(null)} />}
                {!pd ? <SkeletonRows rows={6} cols={4} /> : (
                  <div className="table-wrap"><table className="grid compact">
                    <thead><tr><th>Assembly</th><th>Group / type</th><th className="num">Qty</th><th className="num">Unit value</th><th className="num">Value</th><th>Posted</th><th /></tr></thead>
                    <tbody>{pd.assemblies.map((a) => (
                      <tr key={a.EsAssemblyID}>
                        <td className="wrap"><b>{a.Assembly}</b>{a.Description && <div className="muted small">{a.Description}</div>}</td><td className="wrap">{a.GroupName} / {a.Type}</td>
                        <td className="num"><input aria-label={`Quantity ${a.Assembly}`} inputMode="numeric" style={{ width: 80 }} value={qty[a.EsAssemblyID] ?? a.Qty ?? ''} onChange={(e) => setQty((s) => ({ ...s, [a.EsAssemblyID]: e.target.value }))} /></td>
                        <td className="num">{money(a.UnitValue)}</td><td className="num">{money(Number(a.Qty || 0) * Number(a.UnitValue || 0))}</td><td>{yes(a.Posted) ? <Badge tone="green">Posted</Badge> : <Badge tone="amber">No</Badge>}</td>
                        <td className="row" style={{ gap: 4 }}>
                          {qty[a.EsAssemblyID] !== undefined && String(qty[a.EsAssemblyID]) !== String(a.Qty) && <button className="btn small primary" onClick={() => saveQty(a)}>Save</button>}
                          <button className="btn small icon" aria-label={`Remove ${a.Assembly}`} onClick={() => delAssembly(a.EsAssemblyID)}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}{!pd.assemblies.length && <tr><td colSpan={7}><EmptyState title="No assemblies on this plan" /></td></tr>}</tbody>
                    {pd.assemblies.length > 0 && <tfoot><tr><td colSpan={4}><b>Total (estimating price, before tax / markups)</b></td><td className="num"><b>{money(asmTotal)}</b></td><td colSpan={2} /></tr></tfoot>}
                  </table></div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head"><h2><Layers size={15} /> Cost by cost code</h2></div>
                {!pd ? <SkeletonRows rows={3} cols={2} /> : (
                  <table className="grid compact"><thead><tr><th>Code</th><th className="num">Material</th><th className="num">Tax</th><th className="num">Labor</th></tr></thead>
                    <tbody>{pd.byCode.map((r) => <tr key={r.CostCodeId || '-'}><td>{r.CostCodeId} {r.CostCode}</td><td className="num">{money(r.MaterialCost)}</td><td className="num">{money(r.MaterialTax)}</td><td className="num">{money(r.LaborCost)}</td></tr>)}
                      {!pd.byCode.length && <tr><td colSpan={4} className="muted">No assembly material</td></tr>}</tbody></table>
                )}
              </section>

              <section className="panel span-3" style={{ gridColumn: '1 / -1' }}>
                <div className="panel-head"><h2>Packs &amp; options of plan {selPlan.PlanNum}</h2><button className="btn small primary" onClick={() => setPack(blankPack())}><Plus size={13} /> New pack</button></div>
                {pack && <PackForm pack={pack} setPack={setPack} lk={lk} jobId={b.PmJobID} customerId={b.PmCustID} onSubmit={savePack} busy={busy} />}
                {typeof selecting === 'number' && <AssemblySelector title={`Select assemblies for ${selPackName || 'the'} pack`} requireQty busy={busy} onAdd={addOptAssemblies} onCancel={() => setSelecting(null)} />}
                {pd && (
                  <div className="table-wrap"><table className="grid compact">
                    <thead><tr><th>Type</th><th>Pack</th><th>Builder code</th><th className="num">Qty</th><th className="num">Items</th><th className="num">Value</th><th className="num">Contract</th><th>Status</th><th /></tr></thead>
                    <tbody>{pd.packs.map((k) => (
                      <tr key={k.EsPackID} className="link-row" onClick={() => nav(`/es/packs/${k.EsPackID}`)}>
                        <td>{k.PackType}</td><td className="wrap"><a><b>{k.PackName}</b></a>{k.Notes && <div className="muted small">{k.Notes}</div>}</td><td>{k.BuilderCode}</td><td className="num">{k.Quantity}</td><td className="num">{k.Items}</td><td className="num">{money(k.Value)}</td><td className="num">{money(k.ContractVal)}</td><td>{k.Status}</td>
                        <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn small" onClick={() => setSelecting(k.EsPackID)}><ListPlus size={13} /> Assemblies</button>
                          <button className="btn small icon" aria-label={`Edit pack ${k.PackName}`} onClick={() => setPack({ id: k.EsPackID, PackName: k.PackName || '', ...toForm(k, PACK_FIELDS) })}><Pencil size={13} /></button>
                          <button className="btn small icon" aria-label={`Delete pack ${k.PackName}`} onClick={() => delPack(k.EsPackID)}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}{!pd.packs.length && <tr><td colSpan={9}><EmptyState title="No packs yet – create standard packs or add an option pack" /></td></tr>}</tbody>
                  </table></div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
