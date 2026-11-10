// Cox items (Access CxItems): the items Cox pays for, per Cox job type, with their bill price.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CxTabs, money, useCxLookups } from './shared'

const blank = { Item: '', Description: '', CxJobTypeId: '', BillPrice: '' }

export default function CxItems() {
  const lk = useCxLookups()
  const [rows, setRows] = useState(null)
  const [type, setType] = useState('')
  const [add, setAdd] = useState(blank)
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => setRows(await api('/cx/items', { params: { cxType: type } })), [type])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (r === false) return; if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const create = run(async (e) => { e.preventDefault(); await api('/cx/items', { method: 'POST', body: add }); setAdd({ ...blank, CxJobTypeId: add.CxJobTypeId }) }, 'Item added')
  const save = run(async () => { const body = { ...edit }; delete body.id; await api(`/cx/items/${edit.id}`, { method: 'PUT', body }); setEdit(null) }, 'Item saved')
  const remove = run(async (id) => { if (!confirm('Delete this item?')) return false; await api(`/cx/items/${id}`, { method: 'DELETE' }) }, 'Item deleted')
  const typeSel = (value, onCh, label, blankText = 'Job type…') => (
    <select aria-label={label} value={value} onChange={(e) => onCh(e.target.value)}><option value="">{blankText}</option>{lk.cxJobTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
  )
  return (
    <div className="page">
      <PageHeader title="Cox items" subtitle="Items billed to Cox, by Cox job type. Multi (MDU) requests read the Home runs, Lockbox prewire, Outlet prewire and Riser prewire items; single (R1) requests read Outlet prewire." />
      <CxTabs />
      <div className="filters">
        <div className="seg">{[['', 'All'], ...lk.cxJobTypes.map((t) => [String(t.id), t.name])].map(([k, l]) => <button type="button" key={k} className={`seg-btn${type === k ? ' active' : ''}`} onClick={() => setType(k)}>{l}</button>)}</div>
      </div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!rows ? <SkeletonRows rows={6} cols={4} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Item</th><th>Description</th><th>Job type</th><th className="num">Bill price</th><th className="num">Used on plans</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => edit?.id === r.CxItemID ? (
              <tr key={r.CxItemID} className="editing">
                <td><input className="cell-input wide" aria-label="Item" maxLength={255} value={edit.Item} onChange={(e) => setEdit({ ...edit, Item: e.target.value })} /></td>
                <td><input className="cell-input wide" aria-label="Description" value={edit.Description} onChange={(e) => setEdit({ ...edit, Description: e.target.value })} /></td>
                <td>{typeSel(edit.CxJobTypeId, (v) => setEdit({ ...edit, CxJobTypeId: v }), 'Item job type')}</td>
                <td className="num"><input className="cell-input" aria-label="Bill price" value={edit.BillPrice} onChange={(e) => setEdit({ ...edit, BillPrice: e.target.value })} /></td>
                <td />
                <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save item" onClick={save}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
              </tr>
            ) : (
              <tr key={r.CxItemID}>
                <td><b>{r.Item}</b></td><td className="wrap">{r.Description}</td><td>{r.CxJobType}</td><td className="num">{money(r.BillPrice)}</td><td className="num">{r.Used}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small icon" aria-label={`Edit ${r.Item}`} onClick={() => setEdit({ id: r.CxItemID, Item: r.Item || '', Description: r.Description || '', CxJobTypeId: String(r.CxJobTypeId ?? ''), BillPrice: r.BillPrice ?? '' })}><Pencil size={13} /></button>
                  <button className="btn small icon" aria-label={`Delete ${r.Item}`} onClick={() => remove(r.CxItemID)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            <tr className="new-row">
              <td><input className="cell-input wide" aria-label="New item" placeholder="Item" maxLength={255} value={add.Item} onChange={(e) => setAdd({ ...add, Item: e.target.value })} /></td>
              <td><input className="cell-input wide" aria-label="New description" placeholder="Description" value={add.Description} onChange={(e) => setAdd({ ...add, Description: e.target.value })} /></td>
              <td>{typeSel(add.CxJobTypeId, (v) => setAdd({ ...add, CxJobTypeId: v }), 'New item job type')}</td>
              <td className="num"><input className="cell-input" aria-label="New bill price" placeholder="$" value={add.BillPrice} onChange={(e) => setAdd({ ...add, BillPrice: e.target.value })} /></td>
              <td />
              <td><button className="btn small primary" disabled={!add.Item.trim() || !add.CxJobTypeId} onClick={create}><Plus size={13} /> Add</button></td>
            </tr>
          </tbody>
        </table></div>
      )}
      {rows && !rows.length && <EmptyState title="No Cox items yet – add the first one above" />}
    </div>
  )
}
