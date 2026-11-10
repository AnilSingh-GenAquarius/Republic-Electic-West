// Pack material (Access EsJobSubMaterial / EsBidSubOptPackMaterial): material lines of one estimating pack, plus
// "add assembly material" (EsSelectOptAssembly). Picking an item prices the line at the item's labor cost (labor items)
// or estimating price.
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { AssemblySelector, EsTabs, FormCard, Fields, int, money, money4, useEsLookups, yes } from './shared'

const MAT_FIELDS = [['Quantity', 'Quantity *', 'num'], ['EstimatingPrice', 'Estimating price $ (blank = from item)', 'num'], ['StageId', 'Stage *', 'select', { list: 'stages' }],
  ['WorkId', 'Work *', 'select', { list: 'works' }], ['StatusId', 'Status', 'select', { list: 'statuses' }], ['NoChange', 'No change', 'check'], ['Notes', 'Notes (quoted as)', 'text', { span: 3, max: 255 }]]

export default function EsPack() {
  const { id } = useParams()
  const lk = useEsLookups()
  const [d, setD] = useState(null)
  const [mat, setMat] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setD(await api(`/es/packs/${id}`)), [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => {
    setError(''); setMsg(''); setBusy(true)
    try { const r = await fn(...a); if (ok && r !== false) setMsg(typeof ok === 'function' ? ok(r) : ok); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const saveMat = run(async (e) => {
    e.preventDefault()
    const body = { ...mat }; delete body.id; delete body.label
    if (mat.id) { await api(`/es/material/${mat.id}`, { method: 'PUT', body }); setMat(null); return { ok: true } }
    const r = await api(`/es/packs/${id}/material`, { method: 'POST', body }); setMat(null); return r
  }, (r) => (r.inactive ? 'Line saved – note: this item is inactive' : 'Line saved'))
  const delMat = run(async (mid) => { if (!confirm('Delete this material line?')) return false; return api(`/es/material/${mid}`, { method: 'DELETE' }) }, 'Line deleted')
  const addAssemblies = run(async (items) => { const r = await api(`/es/packs/${id}/assemblies`, { method: 'POST', body: { items } }); setSelecting(false); return r }, (r) => `${int(r.material)} material line(s) added`)
  const k = d?.pack
  const edit = (m) => setMat({ id: m.EsBidItemID, label: `${m.InvItem} – ${m.Description || ''}`, InvItemId: m.InvItemId, Quantity: String(m.Quantity ?? ''), EstimatingPrice: m.EstimatingPrice ?? '', StageId: String(m.StageId ?? ''), WorkId: String(m.WorkId ?? ''), StatusId: String(m.StatusId ?? 1), NoChange: yes(m.NoChange), Notes: m.Notes || '' })
  return (
    <div className="page">
      <PageHeader crumb={k ? <><Link to="/es/customers">Customers &amp; bids</Link> / <Link to={`/es/bids/${k.EsBidId}/material?plan=${k.EsPlanId}`}>{k.Customer} · Bid {k.BidNum} · Plan {k.PlanNum}</Link></> : null}
        title={k ? `Pack ${k.PackName}` : 'Pack'} track={!!k} subtitle={k ? `${k.PackType || ''} · qty ${k.Quantity ?? 1}${k.BuilderCode ? ` · builder code ${k.BuilderCode}` : ''} · ${k.Job}` : null}
        actions={k && <>
          <Link className="btn" to={`/es/bids/${k.EsBidId}/material?plan=${k.EsPlanId}`}><ArrowLeft size={15} /> Material bid</Link>
          <Link className="btn" to={`/es/bids/${k.EsBidId}?plan=${k.EsPlanId}`}>Assembly bid</Link>
        </>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={5} /> : (
        <section className="panel">
          <div className="panel-head"><h2>Material selected for the {k.PackName} pack ({d.material.length})</h2>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn small" onClick={() => setSelecting(true)}><ListPlus size={13} /> Add assembly material</button>
              <button className="btn small primary" onClick={() => setMat({ InvItemId: '', label: '', Quantity: '1', EstimatingPrice: '', StageId: '', WorkId: '', StatusId: '1', NoChange: false, Notes: '' })}><Plus size={13} /> Add item</button>
            </span></div>
          {selecting && <AssemblySelector title={`Select assemblies for the ${k.PackName} pack`} requireQty busy={busy} onAdd={addAssemblies} onCancel={() => setSelecting(false)} />}
          {mat && (
            <FormCard legend={mat.id ? 'Edit material line' : 'New material line'} onSubmit={saveMat} onCancel={() => setMat(null)} busy={busy}>
              <label className="span3">Inventory item *<SearchSelect endpoint="/es/pick/items" value={mat.InvItemId} label={mat.label} placeholder="Search item…"
                onSelect={(r) => setMat((s) => ({ ...s, InvItemId: r?.id || '', label: r?.name || '', EstimatingPrice: '' }))} /></label>
              <Fields fields={MAT_FIELDS} value={mat} onChange={setMat} lk={lk} />
            </FormCard>
          )}
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Item</th><th>Description</th><th>Code</th><th className="num">Qty</th><th className="num">Est price</th><th className="num">Ext price</th><th>Stage</th><th>Work</th><th>No change</th><th>Status</th><th /></tr></thead>
            <tbody>{d.material.map((m) => (
              <tr key={m.EsBidItemID}>
                <td><b>{m.InvItem}</b>{m.ItemStatusId === 2 && <> <Badge tone="amber" icon={AlertTriangle}>Inactive item</Badge></>}{m.Notes && <div className="muted small">quoted as: {m.Notes}</div>}</td>
                <td className="wrap">{m.Description}</td><td>{m.CostCodeId}</td><td className="num">{m.Quantity}</td><td className="num">{money4(m.EstimatingPrice)}</td><td className="num">{money(m.ExtPrice)}</td>
                <td>{m.Stage}</td><td>{m.WorkType}</td><td>{yes(m.NoChange) ? 'Yes' : ''}</td><td>{m.Status}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small icon" aria-label={`Edit ${m.InvItem}`} onClick={() => edit(m)}><Pencil size={13} /></button>
                  <button className="btn small icon" aria-label={`Delete ${m.InvItem}`} onClick={() => delMat(m.EsBidItemID)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}{!d.material.length && <tr><td colSpan={11}><EmptyState title="No material in this pack" /></td></tr>}</tbody>
            {d.material.length > 0 && <tfoot><tr><td colSpan={5}><b>Material {money(d.totals.material)} · Labor {money(d.totals.labor)}</b></td><td className="num"><b>{money(d.totals.total)}</b></td><td colSpan={5} className="muted small">per pack (× pack qty {k.Quantity ?? 1} in the bid calculation)</td></tr></tfoot>}
          </table></div>
        </section>
      )}
    </div>
  )
}
