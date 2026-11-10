// Master assemblies (Access AsGroup → AsGroupSubType → AsGroupSubAssembly → AsGroupSubMaterial) and its
// "Set default values" button (qryAssemblyMaterialSetDefault + qryAssemblyMaterialSetPrice).
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { api } from '../../api'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { EsTabs, FormCard, Fields, int, money, money4, useEsLookups, yes } from './shared'

const MAT_FIELDS = [['Quantity', 'Quantity *', 'num'], ['EstimatingPrice', 'Estimating price $ (blank = from item)', 'num'], ['StageId', 'Stage (blank = item default)', 'select', { list: 'stages' }],
  ['WorkId', 'Work (blank = item default)', 'select', { list: 'works' }], ['StatusId', 'Status', 'select', { list: 'statuses' }], ['ToggleNoChange', 'No change', 'check'], ['Notes', 'Notes', 'text', { span: 3, max: 255 }]]

function NameList({ title, rows, idKey, nameKey, sel, onSel, count, onAdd, onRename, onDelete, extra }) {
  const [name, setName] = useState('')
  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2></div>
      {onAdd && <form className="row" style={{ gap: 6, marginBottom: 8 }} onSubmit={(e) => { e.preventDefault(); onAdd(name).then((ok) => ok && setName('')) }}>
        <input aria-label={`New ${title}`} placeholder="New…" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} /><button className="btn small primary" disabled={!name.trim()}><Plus size={13} /></button></form>}
      {!rows ? <SkeletonRows rows={6} cols={1} /> : (
        <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}><table className="grid compact"><tbody>
          {rows.map((r) => (
            <tr key={r[idKey]} className={`link-row${String(sel) === String(r[idKey]) ? ' selected' : ''}`} onClick={() => onSel(r[idKey])}>
              <td className="wrap">{r[nameKey]}{extra && extra(r)}</td><td className="num muted">{count(r)}</td>
              <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn small icon" aria-label={`Rename ${r[nameKey]}`} onClick={() => onRename(r)}><Pencil size={12} /></button>
                <button className="btn small icon" aria-label={`Delete ${r[nameKey]}`} onClick={() => onDelete(r)}><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}{!rows.length && <tr><td className="muted">None</td></tr>}
        </tbody></table></div>
      )}
    </section>
  )
}

export default function EsAssemblies() {
  const lk = useEsLookups()
  const [sp, setSp] = useSearchParams()
  const g = sp.get('g') || '', t = sp.get('t') || '', a = sp.get('a') || ''
  const [groups, setGroups] = useState(null)
  const [types, setTypes] = useState(null)
  const [asms, setAsms] = useState(null)
  const [mats, setMats] = useState(null)
  const [asm, setAsm] = useState(null)
  const [mat, setMat] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const loadGroups = useCallback(() => api('/es/as/groups').then(setGroups), [])
  const loadTypes = useCallback(() => (g ? api(`/es/as/groups/${g}/types`).then(setTypes) : Promise.resolve(setTypes(null))), [g])
  const loadAsms = useCallback(() => (t ? api(`/es/as/types/${t}/assemblies`).then(setAsms) : Promise.resolve(setAsms(null))), [t])
  const loadMats = useCallback(() => (a ? api(`/es/as/assemblies/${a}/material`).then(setMats) : Promise.resolve(setMats(null))), [a])
  useEffect(() => { loadGroups().catch((e) => setError(e.message)) }, [loadGroups])
  useEffect(() => { loadTypes().catch((e) => setError(e.message)) }, [loadTypes])
  useEffect(() => { loadAsms().catch((e) => setError(e.message)) }, [loadAsms])
  useEffect(() => { loadMats().catch((e) => setError(e.message)) }, [loadMats])
  const reloadAll = () => Promise.all([loadGroups(), loadTypes(), loadAsms(), loadMats()])
  const act = async (fn, ok) => { setError(''); setMsg(''); setBusy(true); try { const r = await fn(); if (r === false) return false; if (ok) setMsg(typeof ok === 'function' ? ok(r) : ok); await reloadAll(); return true } catch (e) { setError(e.message); return false } finally { setBusy(false) } }
  const go = (patch) => { const n = { g, t, a, ...patch }; Object.keys(n).forEach((k) => !n[k] && delete n[k]); setSp(n) }
  const ask = (label, cur) => { const v = prompt(label, cur || ''); return v == null ? null : v }
  const setDefaults = () => act(async () => { if (!confirm('Fill stage, work, status and estimating price on master assembly material lines where they are all blank (from the item defaults), then the estimating price where it is blank?')) return false; return api('/es/as/set-defaults', { method: 'POST' }) },
    (r) => `Defaults set on ${int(r.defaults)} line(s); price set on ${int(r.prices)} more.`)
  const saveAsm = (e) => { e.preventDefault(); act(async () => { const body = { Name: asm.Name, Description: asm.Description, Notes: asm.Notes }; if (asm.id) await api(`/es/as/assemblies/${asm.id}`, { method: 'PUT', body }); else { const r = await api(`/es/as/types/${t}/assemblies`, { method: 'POST', body }); go({ a: String(r.id) }) } setAsm(null) }, 'Assembly saved') }
  const saveMat = (e) => { e.preventDefault(); act(async () => { const body = { ...mat }; delete body.id; delete body.label; if (mat.id) await api(`/es/as/material/${mat.id}`, { method: 'PUT', body }); else await api(`/es/as/assemblies/${a}/material`, { method: 'POST', body }); setMat(null) }, 'Material line saved') }
  const selAsm = asms?.find((x) => String(x.AsAssemblyID) === a)
  return (
    <div className="page">
      <PageHeader title="Master assemblies" subtitle="Assembly groups → types → assemblies → material (used to build estimating plans and option packs)"
        actions={<button className="btn" disabled={busy} onClick={setDefaults}><Wand2 size={15} /> Set default values</button>} />
      <EsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="dash-grid">
        <NameList title="Groups" rows={groups} idKey="AsGroupID" nameKey="GroupName" sel={g} onSel={(id) => go({ g: String(id), t: '', a: '' })} count={(r) => r.Types}
          onAdd={(n) => act(async () => { const r = await api('/es/as/groups', { method: 'POST', body: { GroupName: n } }); go({ g: String(r.id), t: '', a: '' }) }, 'Group added')}
          onRename={(r) => { const n = ask('Group name', r.GroupName); if (n != null) act(() => api(`/es/as/groups/${r.AsGroupID}`, { method: 'PUT', body: { GroupName: n } }), 'Group renamed') }}
          onDelete={(r) => confirm(`Delete group ${r.GroupName}?`) && act(async () => { await api(`/es/as/groups/${r.AsGroupID}`, { method: 'DELETE' }); go({ g: '', t: '', a: '' }) }, 'Group deleted')} />
        {g ? <NameList title="Assembly types" rows={types} idKey="AsTypeID" nameKey="Type" sel={t} onSel={(id) => go({ t: String(id), a: '' })} count={(r) => r.Assemblies}
          onAdd={(n) => act(async () => { const r = await api(`/es/as/groups/${g}/types`, { method: 'POST', body: { Type: n } }); go({ t: String(r.id), a: '' }) }, 'Type added')}
          onRename={(r) => { const n = ask('Assembly type', r.Type); if (n != null) act(() => api(`/es/as/types/${r.AsTypeID}`, { method: 'PUT', body: { Type: n } }), 'Type renamed') }}
          onDelete={(r) => confirm(`Delete type ${r.Type}?`) && act(async () => { await api(`/es/as/types/${r.AsTypeID}`, { method: 'DELETE' }); go({ t: '', a: '' }) }, 'Type deleted')} />
          : <section className="panel"><EmptyState title="Choose a group" /></section>}
        {t ? (
          <section className="panel">
            <div className="panel-head"><h2>Assemblies</h2><button className="btn small primary" onClick={() => setAsm({ Name: '', Description: '', Notes: '' })}><Plus size={13} /> New</button></div>
            {asm && <FormCard legend={asm.id ? 'Edit assembly' : 'New assembly'} onSubmit={saveAsm} onCancel={() => setAsm(null)} busy={busy}>
              <label className="span3">Name *<input aria-label="Assembly name" maxLength={150} value={asm.Name} onChange={(e) => setAsm({ ...asm, Name: e.target.value })} /></label>
              <label className="span3">Description<input aria-label="Assembly description" maxLength={150} value={asm.Description} onChange={(e) => setAsm({ ...asm, Description: e.target.value })} /></label>
              <label className="span3">Notes<input aria-label="Assembly notes" maxLength={255} value={asm.Notes} onChange={(e) => setAsm({ ...asm, Notes: e.target.value })} /></label>
            </FormCard>}
            {!asms ? <SkeletonRows rows={6} cols={1} /> : (
              <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}><table className="grid compact"><tbody>
                {asms.map((r) => (
                  <tr key={r.AsAssemblyID} className={`link-row${a === String(r.AsAssemblyID) ? ' selected' : ''}`} onClick={() => go({ a: String(r.AsAssemblyID) })}>
                    <td className="wrap">{r.Name}{r.Description && <div className="muted small">{r.Description}</div>}</td><td className="num">{money(r.Value)}</td>
                    <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn small icon" aria-label={`Edit ${r.Name}`} onClick={() => setAsm({ id: r.AsAssemblyID, Name: r.Name || '', Description: r.Description || '', Notes: r.Notes || '' })}><Pencil size={12} /></button>
                      <button className="btn small icon" aria-label={`Delete ${r.Name}`} onClick={() => confirm(`Delete assembly ${r.Name} with its material?`) && act(async () => { await api(`/es/as/assemblies/${r.AsAssemblyID}`, { method: 'DELETE' }); go({ a: '' }) }, 'Assembly deleted')}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}{!asms.length && <tr><td className="muted">None</td></tr>}
              </tbody></table></div>
            )}
          </section>
        ) : <section className="panel"><EmptyState title="Choose an assembly type" /></section>}
      </div>
      {selAsm && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2>Material of {selAsm.Name}{selAsm.Used ? ` · used on ${selAsm.Used} estimating plan line(s)` : ''}</h2>
            <button className="btn small primary" onClick={() => setMat({ InvItemId: '', label: '', Quantity: '1', EstimatingPrice: '', StageId: '', WorkId: '', StatusId: '1', ToggleNoChange: false, Notes: '' })}><Plus size={13} /> Add item</button></div>
          {mat && <FormCard legend={mat.id ? 'Edit material line' : 'New material line'} onSubmit={saveMat} onCancel={() => setMat(null)} busy={busy}>
            <label className="span3">Inventory item *<SearchSelect endpoint="/es/pick/items" value={mat.InvItemId} label={mat.label} placeholder="Search item…" onSelect={(r) => setMat((s) => ({ ...s, InvItemId: r?.id || '', label: r?.name || '', EstimatingPrice: '' }))} /></label>
            <Fields fields={MAT_FIELDS} value={mat} onChange={setMat} lk={lk} />
          </FormCard>}
          {!mats ? <SkeletonRows rows={5} cols={6} /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Item</th><th>Description</th><th>Code</th><th className="num">Qty</th><th className="num">Est price</th><th className="num">Ext</th><th>Stage</th><th>Work</th><th>No change</th><th>Status</th><th /></tr></thead>
              <tbody>{mats.map((m) => (
                <tr key={m.AsMaterialID}><td><b>{m.InvItem}</b></td><td className="wrap">{m.Description}</td><td>{m.CostCodeId}</td><td className="num">{m.Quantity}</td><td className="num">{money4(m.EstimatingPrice)}</td><td className="num">{money(m.ExtPrice)}</td><td>{m.Stage}</td><td>{m.WorkType}</td><td>{yes(m.ToggleNoChange) ? 'Yes' : ''}</td><td>{m.Status}</td>
                  <td className="row" style={{ gap: 4 }}>
                    <button className="btn small icon" aria-label={`Edit ${m.InvItem}`} onClick={() => setMat({ id: m.AsMaterialID, InvItemId: m.InvItemId, label: `${m.InvItem} – ${m.Description || ''}`, Quantity: String(m.Quantity ?? ''), EstimatingPrice: m.EstimatingPrice ?? '', StageId: String(m.StageId ?? ''), WorkId: String(m.WorkId ?? ''), StatusId: String(m.StatusId ?? ''), ToggleNoChange: yes(m.ToggleNoChange), Notes: m.Notes || '' })}><Pencil size={12} /></button>
                    <button className="btn small icon" aria-label={`Delete ${m.InvItem}`} onClick={() => confirm('Delete this material line?') && act(() => api(`/es/as/material/${m.AsMaterialID}`, { method: 'DELETE' }), 'Line deleted')}><Trash2 size={12} /></button>
                  </td></tr>
              ))}{!mats.length && <tr><td colSpan={11}><EmptyState title="No material in this assembly" /></td></tr>}</tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  )
}
