// Transfer estimating data to Plan management (Access SwitchES filters + macros EsTransferBid / EsTransferPlan / EsTransferPack).
// Filters: customer → job, then PM bid → PM plan (receiving side) and EST bid → EST plan → EST pack (sending side).
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Lock } from 'lucide-react'
import { api } from '../../api'
import { ErrorState, PageHeader } from '../../components/ui'
import { EsTabs, int } from './shared'

const KEYS = ['customerId', 'jobId', 'pmContractId', 'pmPlanId', 'bidId', 'planId', 'packId']
// changing a filter clears the ones that depend on it
const CLEARS = { customerId: ['jobId', 'pmContractId', 'pmPlanId', 'bidId', 'planId', 'packId'], jobId: ['pmContractId', 'pmPlanId', 'bidId', 'planId', 'packId'], pmContractId: ['pmPlanId'], bidId: ['planId', 'packId'], planId: ['packId'] }

export function useEsCascade() {
  const [sp, setSp] = useSearchParams()
  const v = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || '']))
  const [o, setO] = useState({ customers: [], jobs: [], pmContracts: [], pmPlans: [], bids: [], plans: [], packs: [] })
  const load = (key, url, params, on) => { setO((s) => ({ ...s, [key]: [] })); if (on) api(url, { params }).then((r) => setO((s) => ({ ...s, [key]: r }))).catch(() => {}) }
  useEffect(() => { load('customers', '/es/pick/customers', {}, true) }, [])
  useEffect(() => { load('jobs', '/es/pick/jobs', { customerId: v.customerId }, v.customerId) }, [v.customerId])
  useEffect(() => { load('pmContracts', '/es/pick/pm-contracts', { jobId: v.jobId }, v.jobId) }, [v.jobId])
  useEffect(() => { load('bids', '/es/pick/bids', { jobId: v.jobId }, v.jobId) }, [v.jobId])
  useEffect(() => { load('pmPlans', '/es/pick/pm-plans', { contractId: v.pmContractId }, v.pmContractId) }, [v.pmContractId])
  useEffect(() => { load('plans', '/es/pick/plans', { bidId: v.bidId }, v.bidId) }, [v.bidId])
  useEffect(() => { load('packs', '/es/pick/packs', { planId: v.planId }, v.planId) }, [v.planId])
  const set = (k, val) => { const n = { ...v, [k]: val }; (CLEARS[k] || []).forEach((c) => (n[c] = '')); Object.keys(n).forEach((x) => !n[x] && delete n[x]); const keep = Object.fromEntries([...sp.entries()].filter(([x]) => !KEYS.includes(x))); setSp({ ...keep, ...n }) }
  const sel = (k, label, list, disabled) => (
    <label key={k}>{label}<select aria-label={label} value={v[k]} disabled={disabled} onChange={(e) => set(k, e.target.value)}>
      <option value="">{disabled ? '—' : 'Choose…'}</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.Lock ? ' (locked)' : ''}</option>)}
    </select></label>
  )
  return { v, o, set, sel }
}

export default function EsTransfer() {
  const { v, o, sel } = useEsCascade()
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const pc = o.pmContracts.find((x) => String(x.id) === v.pmContractId)
  const name = (list, id) => list.find((x) => String(x.id) === id)?.name || ''
  async function go(kind) {
    const text = {
      bid: `Transfer every plan, pack and material line of EST ${name(o.bids, v.bidId)} into PM bid ${name(o.pmContracts, v.pmContractId)}?`,
      plan: `Transfer EST plan ${name(o.plans, v.planId)} with its packs and material into PM bid ${name(o.pmContracts, v.pmContractId)}?`,
      pack: `Transfer EST pack ${name(o.packs, v.packId)} with its material into PM plan ${name(o.pmPlans, v.pmPlanId)}?`,
    }[kind]
    if (!confirm(text)) return
    setBusy(true); setError(''); setMsg('')
    try {
      const body = kind === 'bid' ? { esBidId: v.bidId, pmContractId: v.pmContractId } : kind === 'plan' ? { esPlanId: v.planId, pmContractId: v.pmContractId } : { esPackId: v.packId, pmPlanId: v.pmPlanId }
      const r = await api(`/es/transfer/${kind}`, { method: 'POST', body })
      setMsg(kind === 'bid' ? `Transferred ${int(r.plans)} plan(s), ${int(r.packs)} pack(s) and ${int(r.material)} material line(s).`
        : kind === 'plan' ? `Transferred the plan with ${int(r.packs)} pack(s) and ${int(r.material)} material line(s).` : `Transferred the pack with ${int(r.material)} material line(s).`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Transfer to Plan management" subtitle="Copy an estimating bid, plan or pack into a Plan management bid of the same job" />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg} {v.pmContractId && <Link to={`/pm/bids/${v.pmContractId}`}>Open the PM bid</Link>}</div>}
      <div className="card form report-filters"><fieldset>
        <legend>Customer and job</legend>
        {sel('customerId', 'Customer', o.customers)}
        {sel('jobId', 'Job', o.jobs, !v.customerId)}
      </fieldset></div>
      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>From: estimating</h2></div>
          <div className="form"><fieldset>
            {sel('bidId', 'EST bid', o.bids, !v.jobId)}
            {sel('planId', 'EST plan', o.plans, !v.bidId)}
            {sel('packId', 'EST pack', o.packs, !v.planId)}
          </fieldset></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>To: Plan management</h2></div>
          <div className="form"><fieldset>
            {sel('pmContractId', 'PM bid', o.pmContracts, !v.jobId)}
            {sel('pmPlanId', 'PM plan', o.pmPlans, !v.pmContractId)}
          </fieldset></div>
          {pc?.Lock && <div className="banner" style={{ marginTop: 8 }}><Lock size={15} /> This PM bid is locked; plans and packs cannot be transferred into it.</div>}
          {pc?.EsBidIDLink && <p className="muted small">This PM bid is already linked to an estimating bid (a whole-bid transfer is refused).</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Transfer</h2></div>
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <button className="btn primary" disabled={busy || !v.bidId || !v.pmContractId} onClick={() => go('bid')}><ArrowRight size={15} /> Transfer bid data to PM</button>
            <span className="muted small">Needs customer, job, PM bid and EST bid. Links the PM bid to the estimating bid.</span>
            <button className="btn" disabled={busy || !v.planId || !v.pmContractId} onClick={() => go('plan')}><ArrowRight size={15} /> Transfer plan data to PM</button>
            <span className="muted small">Needs customer, job, PM bid, EST bid and EST plan.</span>
            <button className="btn" disabled={busy || !v.packId || !v.pmPlanId} onClick={() => go('pack')}><ArrowRight size={15} /> Transfer pack data to PM</button>
            <span className="muted small">Needs every filter: PM plan and EST pack included.</span>
          </div>
        </section>
      </div>
    </div>
  )
}
