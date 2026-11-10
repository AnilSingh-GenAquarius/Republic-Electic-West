// Material bid management (Access EsJob "Estimating – Plan with material data"): plans with the bid calculation
// (EsJobSubPlan, frmEsBidMatCalc3 over the standard packs), the plan's packs (EsJobSubPack) → pack material page.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import BidHeader from './BidHeader'
import { PackForm } from './EsBid'
import { EsTabs, FormCard, PACK_FIELDS, PLAN_FIELDS, PLAN_TABS, TabbedFields, bidLabel, blankPack, blankPlan, money, toForm, useEsLookups } from './shared'

const CALC = [['Mat', 'Material'], ['MatTax', 'Tax'], ['MatCont', 'Mat conting'], ['Labor', 'Labor'], ['LaborCont', 'Labor conting'], ['Burden', 'Burden'], ['Basic', 'Basic'], ['OH', 'Overhead'], ['Profit', 'Profit'], ['Wrap', 'Wrap'], ['Disc', 'Discount']]

export default function EsMaterial() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useEsLookups()
  const [sp, setSp] = useSearchParams()
  const planId = Number(sp.get('plan')) || null
  const [d, setD] = useState(null)
  const [pd, setPd] = useState(null)
  const [plan, setPlan] = useState(null)
  const [pack, setPack] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { const r = await api(`/es/bids/${id}`); setD(r); if (!planId && r.plans[0]) setSp({ plan: r.plans[0].EsPlanID }, { replace: true }) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPlan = useCallback(async () => { if (!planId) { setPd(null); return } setPd(await api(`/es/plans/${planId}`)) }, [planId])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  useEffect(() => { loadPlan().catch((e) => setError(e.message)) }, [loadPlan])
  const run = (fn, ok) => async (...a) => {
    setError(''); setMsg(''); setBusy(true)
    try { const r = await fn(...a); if (ok && r !== false) setMsg(ok); await load(); await loadPlan() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const b = d?.bid
  const savePlan = run(async (e) => { e.preventDefault(); const body = { ...plan }; delete body.id; if (plan.id) await api(`/es/plans/${plan.id}`, { method: 'PUT', body }); else { const r = await api(`/es/bids/${id}/plans`, { method: 'POST', body }); setSp({ plan: r.id }) } setPlan(null) }, 'Plan saved')
  const delPlan = run(async (pid) => { if (!confirm('Delete this plan?')) return false; await api(`/es/plans/${pid}`, { method: 'DELETE' }); setSp({}, { replace: true }) }, 'Plan deleted')
  const savePack = run(async (e) => { e.preventDefault(); const body = { ...pack }; delete body.id; if (pack.id) await api(`/es/packs/${pack.id}`, { method: 'PUT', body }); else await api(`/es/plans/${planId}/packs`, { method: 'POST', body }); setPack(null) }, 'Pack saved')
  const delPack = run(async (kid) => { if (!confirm('Delete this pack with its material?')) return false; return api(`/es/packs/${kid}`, { method: 'DELETE' }) }, 'Pack deleted')
  const selPlan = d?.plans.find((p) => p.EsPlanID === planId)
  const c = selPlan?.matCalc

  return (
    <div className="page">
      <PageHeader crumb={b ? <><Link to="/es/customers">Customers &amp; bids</Link> / <Link to={`/es/customers/${b.PmCustID}`}>{b.Customer}</Link></> : null}
        title={b ? `Material bid management · ${bidLabel(b)}` : 'Material bid management'} track={!!b} subtitle={b ? `${b.Customer} · ${b.Job}` : null}
        actions={b && <>
          <Link className="btn" to={`/es/customers/${b.PmCustID}`}><ArrowLeft size={15} /> Customer</Link>
          <button className="btn" onClick={run(async () => true, 'Data refreshed')}><RefreshCw size={15} /> Refresh</button>
          <Link className="btn" to={`/es/bids/${id}`}>Assembly bid management</Link>
          <Link className="btn" to={`/es/transfer?customerId=${b.PmCustID}&jobId=${b.PmJobID}&bidId=${id}`}>Transfer to PM</Link>
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
              <thead><tr><th>Plan</th><th>Name</th><th className="num">Sq ft</th><th>Status</th><th className="num">Packs</th><th className="num">Material + tax + cont</th><th className="num">Labor + cont + burden</th><th className="num">Basic</th><th className="num">O/H + profit + wrap</th><th className="num">Discount</th><th className="num">Plan adjust</th><th className="num">Total</th><th className="num">Contract val</th><th /></tr></thead>
              <tbody>{d.plans.map((p) => {
                const m = p.matCalc
                return (
                  <tr key={p.EsPlanID} className={`link-row${planId === p.EsPlanID ? ' selected' : ''}`} onClick={() => setSp({ plan: p.EsPlanID })}>
                    <td><b>{p.PlanNum}</b></td><td>{p.PlanName}</td><td className="num">{p.SqFt ?? ''}</td><td>{p.Status}</td><td className="num">{p.Packs}</td>
                    {m ? <><td className="num">{money(m.Mat + m.MatTax + m.MatCont)}</td><td className="num">{money(m.Labor + m.LaborCont + m.Burden)}</td><td className="num">{money(m.Basic)}</td><td className="num">{money(m.OH + m.Profit + m.Wrap)}</td><td className="num">{money(m.Disc)}</td></> : <td colSpan={5} className="muted">No standard pack material</td>}
                    <td className="num">{money(p.ContractValAdjNum)}</td><td className="num"><b>{money(p.PlanTotal)}</b></td><td className="num">{money(p.ContractValNum)}</td>
                    <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn small icon" aria-label={`Edit plan ${p.PlanNum}`} onClick={() => setPlan({ id: p.EsPlanID, ...toForm(p, PLAN_FIELDS) })}><Pencil size={13} /></button>
                      <button className="btn small icon" aria-label={`Delete plan ${p.PlanNum}`} onClick={() => delPlan(p.EsPlanID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )
              })}{!d.plans.length && <tr><td colSpan={14}><EmptyState title="No plans in this bid" /></td></tr>}</tbody>
            </table></div>
          </section>

          {selPlan && (
            <div className="dash-grid" style={{ marginTop: 16 }}>
              <section className="panel">
                <div className="panel-head"><h2>Calculation · plan {selPlan.PlanNum}</h2></div>
                {!c ? <EmptyState title="No standard pack material" /> : (
                  <table className="grid compact"><tbody>
                    {CALC.map(([k, l]) => <tr key={k}><td>{l}</td><td className="num">{k === 'Disc' ? `(${money(c[k])})` : money(c[k])}</td></tr>)}
                    <tr><td>Plan adjust</td><td className="num">{money(selPlan.ContractValAdjNum)}</td></tr>
                    <tr><td><b>Total</b></td><td className="num"><b>{money(selPlan.PlanTotal)}</b></td></tr>
                    <tr><td>Contract value</td><td className="num">{money(selPlan.ContractValNum)}</td></tr>
                  </tbody></table>
                )}
                <p className="muted small">Standard packs only (pack type Standard), quantities × pack quantity × estimating price.</p>
              </section>
              <section className="panel span-2">
                <div className="panel-head"><h2>Packs of plan {selPlan.PlanNum}</h2><button className="btn small primary" onClick={() => setPack(blankPack('1'))}><Plus size={13} /> New pack</button></div>
                {pack && <PackForm pack={pack} setPack={setPack} lk={lk} jobId={b.PmJobID} customerId={b.PmCustID} onSubmit={savePack} busy={busy} />}
                {!pd ? <SkeletonRows rows={5} cols={4} /> : (
                  <div className="table-wrap"><table className="grid compact">
                    <thead><tr><th>Type</th><th>Pack</th><th>Builder code</th><th className="num">Qty</th><th className="num">Items</th><th className="num">Value</th><th className="num">Contract</th><th>Status</th><th /></tr></thead>
                    <tbody>{pd.packs.map((k) => (
                      <tr key={k.EsPackID} className="link-row" onClick={() => nav(`/es/packs/${k.EsPackID}`)}>
                        <td>{k.PackType}</td><td className="wrap"><a><b>{k.PackName}</b></a></td><td>{k.BuilderCode}</td><td className="num">{k.Quantity}</td><td className="num">{k.Items}</td><td className="num">{money(k.Value)}</td><td className="num">{money(k.ContractVal)}</td><td>{k.Status}</td>
                        <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn small icon" aria-label={`Edit pack ${k.PackName}`} onClick={() => setPack({ id: k.EsPackID, PackName: k.PackName || '', ...toForm(k, PACK_FIELDS) })}><Pencil size={13} /></button>
                          <button className="btn small icon" aria-label={`Delete pack ${k.PackName}`} onClick={() => delPack(k.EsPackID)}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}{!pd.packs.length && <tr><td colSpan={9}><EmptyState title="No packs in this plan" /></td></tr>}</tbody>
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
