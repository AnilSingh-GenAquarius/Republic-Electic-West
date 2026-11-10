// Duplicate bid / plan / pack (Access PmDuplicate* macros) and sweeping material changes (PmPackMaterialEdit).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Copy, Search, Wand2 } from 'lucide-react'
import { api } from '../../api'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader } from '../../components/ui'
import { PmCascade, PmTabs, money4, usePmLookups, yes } from './shared'

const KINDS = [['pack', 'Duplicate pack'], ['plan', 'Duplicate plan'], ['bid', 'Duplicate bid'], ['sweep', 'Sweeping material change']]

export default function PmTools() {
  const [kind, setKind] = useState('pack')
  return (
    <div className="page">
      <PageHeader title="Copy & bulk edit" subtitle="Copies get “new” added to the name and are priced from today's item costs; trued-up is cleared" />
      <PmTabs />
      <div className="filters"><div className="seg" role="tablist">{KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={`seg-btn${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div></div>
      {kind === 'sweep' ? <Sweep /> : <Duplicate key={kind} kind={kind} />}
    </div>
  )
}

function Duplicate({ kind }) {
  const [from, setFrom] = useState({})
  const [to, setTo] = useState({})
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const fromLevels = kind === 'pack' ? 5 : kind === 'plan' ? 4 : 3
  const toLevels = kind === 'pack' ? 4 : 3
  const ready = kind === 'pack' ? from.packId && to.planId : kind === 'plan' ? from.planId && to.contractId : from.contractId && to.contractId
  async function go(extra = {}) {
    setError(''); setMsg(null); setBusy(true)
    const body = kind === 'pack' ? { fromPackId: Number(from.packId), toPlanId: Number(to.planId) } : kind === 'plan' ? { fromPlanId: Number(from.planId), toContractId: Number(to.contractId) } : { fromContractId: Number(from.contractId), toContractId: Number(to.contractId) }
    try { setMsg(await api(`/pm/duplicate/${kind}`, { method: 'POST', body: { ...body, ...extra } })) } catch (e) {
      if (e.data?.needsConfirm && confirm(`${e.message}\n\nContinue?`)) { setBusy(false); return go({ confirmOtherJob: true }) }
      setError(e.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="card form">
      <fieldset><legend>From {kind}</legend><PmCascade value={from} onChange={setFrom} levels={fromLevels} prefix="From " /></fieldset>
      <fieldset><legend>To {kind === 'pack' ? 'plan' : 'bid'}</legend><PmCascade value={to} onChange={setTo} levels={toLevels} prefix="To " /></fieldset>
      {kind === 'bid' && <p className="muted small" style={{ padding: '0 16px' }}>Every plan of the FROM bid is copied into the TO bid as “plan new”, inactive, with its contract value.</p>}
      {kind === 'plan' && <p className="muted small" style={{ padding: '0 16px' }}>The plan is copied as “plan new” with contract value 0. Refused when the TO bid is locked.</p>}
      {kind === 'pack' && <p className="muted small" style={{ padding: '0 16px' }}>The pack is copied as “pack new” with its material and values. Refused when the TO bid is locked.</p>}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ margin: '0 16px 12px' }}><CheckCircle2 size={16} /> Copied{msg.plans != null ? ` ${msg.plans} plan(s),` : msg.planNum ? ` plan ${msg.planNum},` : ''}{msg.packs != null ? ` ${msg.packs} pack(s),` : ''} {msg.material} material line(s) and {msg.values} value(s).
        {msg.planId && <Link to={`/pm/bids/${to.contractId}?plan=${msg.planId}`}> Open the plan</Link>}{msg.packId && <Link to={`/pm/packs/${msg.packId}`}> Open the pack</Link>}{kind === 'bid' && <Link to={`/pm/bids/${to.contractId}`}> Open the bid</Link>}</div>}
      <div className="row form-actions"><button className="btn primary" disabled={!ready || busy} onClick={() => go()}><Copy size={15} /> {busy ? 'Copying…' : KINDS.find(([k]) => k === kind)[1]}</button></div>
    </div>
  )
}

function Sweep() {
  const lk = usePmLookups()
  const [f, setF] = useState({ customerId: '', item: null, packTypeId: '1' })
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [ch, setCh] = useState({ item: null, Quantity: '', StageId: '', WorkId: '', UnitCost: '', EstimatingPrice: '' })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [cust, setCust] = useState({})
  async function find(e) {
    e?.preventDefault(); setError(''); setMsg(''); setRows(null)
    try { const r = await api('/pm/material-sweep', { params: { customerId: cust.customerId, itemId: f.item?.id, packTypeId: f.packTypeId } }); setRows(r); setSel(new Set(r.filter((x) => !yes(x.Lock)).map((x) => x.PmMatID))) } catch (err) { setError(err.message); setRows([]) }
  }
  async function apply(extra = {}) {
    setError(''); setMsg('')
    const body = { ids: [...sel], Quantity: ch.Quantity, StageId: ch.StageId, WorkId: ch.WorkId, UnitCost: ch.UnitCost, EstimatingPrice: ch.EstimatingPrice, ...(ch.item ? { InvItemId: ch.item.id } : {}), ...extra }
    if (!extra.confirmInactive && !confirm(`Apply this change to ${sel.size} material line(s)? Every change is logged.`)) return
    try { const r = await api('/pm/material-sweep', { method: 'POST', body }); setMsg(`${r.updated} line(s) updated.`); await find() } catch (e) {
      if (e.data?.needsConfirm && confirm(e.message)) return apply({ confirmInactive: true })
      setError(e.message)
    }
  }
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <>
      <div className="banner"><AlertTriangle size={16} /> This feature is risky: it changes the same item in many packs of a customer at once. Review the selected lines before applying.</div>
      <form className="card form" onSubmit={find}><fieldset>
        <PmCascade value={cust} onChange={setCust} levels={1} />
        <label className="span2">Inventory item<SearchSelect endpoint="/pm/pick/items" value={f.item?.id} label={f.item?.name} onSelect={(it) => setF({ ...f, item: it })} /></label>
        <label>Pack type<select aria-label="Sweep pack type" value={f.packTypeId} onChange={(e) => setF({ ...f, packTypeId: e.target.value })}>{lk.packTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </fieldset><div className="row form-actions"><button className="btn primary" disabled={!cust.customerId || !f.item}><Search size={15} /> Find lines</button></div></form>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {rows === null ? null : !rows.length ? <EmptyState title="No material lines match" /> : (
        <>
          <div className="card form"><fieldset>
            <legend>Change the {sel.size} selected line(s) – leave a field empty to keep it</legend>
            <label className="span2">Replace item with<SearchSelect endpoint="/pm/pick/items" value={ch.item?.id} label={ch.item?.name} placeholder="(keep item)" onSelect={(it) => setCh({ ...ch, item: it })} /></label>
            <label>Quantity<input inputMode="numeric" aria-label="Sweep quantity" value={ch.Quantity} onChange={(e) => setCh({ ...ch, Quantity: e.target.value })} /></label>
            <label>Stage<select value={ch.StageId} onChange={(e) => setCh({ ...ch, StageId: e.target.value })}><option value="">(keep)</option>{lk.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Work<select value={ch.WorkId} onChange={(e) => setCh({ ...ch, WorkId: e.target.value })}><option value="">(keep)</option>{lk.works.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Unit cost<input inputMode="decimal" value={ch.UnitCost} placeholder={ch.item ? 'from item' : '(keep)'} onChange={(e) => setCh({ ...ch, UnitCost: e.target.value })} /></label>
            <label>Estimating price<input inputMode="decimal" value={ch.EstimatingPrice} placeholder={ch.item ? 'from item' : '(keep)'} onChange={(e) => setCh({ ...ch, EstimatingPrice: e.target.value })} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary" disabled={!sel.size} onClick={() => apply()}><Wand2 size={15} /> Apply to {sel.size} line(s)</button></div></div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.PmMatID)) : new Set())} /></th><th>Div</th><th>Job</th><th>Bid</th><th>Plan</th><th>Pack</th><th>Item</th><th className="num">Qty</th><th>Stage</th><th>Work</th><th className="num">Cost</th><th className="num">Est.</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.PmMatID}><td><input type="checkbox" aria-label={`Select line ${r.PmMatID}`} checked={sel.has(r.PmMatID)} onChange={() => toggle(r.PmMatID)} /></td><td>{r.DivisionId}</td><td className="wrap">{r.Job}</td><td>{r.BidNum}{yes(r.Lock) ? ' 🔒' : ''}</td><td>{r.PlanNum}</td><td className="wrap">{r.PackName}{yes(r.TruedUp) ? ' (trued up)' : ''}</td><td><b>{r.InvItem}</b></td><td className="num">{r.Quantity}</td><td>{r.Stage}</td><td>{r.WorkType}</td><td className="num">{money4(r.UnitCost)}</td><td className="num">{money4(r.EstimatingPrice)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </>
  )
}
