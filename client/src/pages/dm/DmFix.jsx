// Database maintenance – the dbo* "fix" datasheets (Access OpenQuery on a lot / employee) and Edit posted packs
// (form dboEditPackPostedQty). Rows are edited one at a time; only the allow-listed columns can change.
import { useEffect, useState } from 'react'
import { CheckCircle2, Database, Pencil, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { DmFilters, DmTabs, int, useDmParams } from './shared'

const FIELDS = { lot: ['customer', 'job', 'lot'], 'emp-date': ['employee', 'from'], 'emp-range': ['employee', 'from', 'to'] }
const LABELS = { 'emp-date': { from: 'Payroll date' }, 'emp-range': { from: 'Date entered from', to: 'Date entered to' } }
const DATE_T = new Set(['datetime', 'date', 'datetime2', 'smalldatetime'])

export default function DmFix() {
  const [p, set] = useDmParams()
  const [sets, setSets] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState(null) // { id, values }
  useEffect(() => { api('/dm/fix').then(setSets).catch((e) => setError(e.message)) }, [])
  const key = p.set || 'posted-packs'
  const def = key === 'posted-packs' ? { by: 'lot' } : sets.find((s) => s.key === key)
  const ready = def && (def.by === 'lot' ? p.lotId : p.employeeId && p.fromDate && (def.by !== 'emp-range' || p.toDate))
  const load = () => {
    setData(null); setError(''); setEdit(null)
    if (!ready) return Promise.resolve()
    return key === 'posted-packs'
      ? api('/dm/posted-packs', { params: { lotId: p.lotId } }).then((rows) => setData({ k: key, posted: true, rows }))
      : api(`/dm/fix/${key}`, { params: { lotId: p.lotId, employeeId: p.employeeId, fromDate: p.fromDate, toDate: p.toDate } }).then((d) => setData({ k: key, ...d }))
  }
  useEffect(() => { setMsg(''); load()?.catch((e) => setError(e.message)) }, [key, p.lotId, p.employeeId, p.fromDate, p.toDate, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(''); setMsg('')
    try {
      if (data.posted) await api(`/dm/posted-packs/${edit.id}`, { method: 'PUT', body: edit.values })
      else await api(`/dm/fix/${key}/${edit.id}`, { method: 'PUT', body: edit.values })
      setMsg('Row saved'); await load()
    } catch (e) { setError(e.message) }
  }
  async function remove(id) {
    if (!confirm(`Delete row ${id} from ${data.id ? data.label : 'this table'}? This cannot be undone.`)) return
    setError(''); setMsg('')
    try { await api(`/dm/fix/${key}/${id}`, { method: 'DELETE' }); setMsg('Row deleted'); await load() } catch (e) { setError(e.message) }
  }
  const ok = data && data.k === key
  return (
    <div className="page">
      <PageHeader title="Fix data" subtitle="Look at and correct the raw rows behind a lot or an employee card. Changes are saved straight to the table." />
      <DmTabs />
      <div className="fm-reports no-print">
        {[{ key: 'posted-packs', label: 'Edit posted packs', by: 'lot', query: 'dboEditPackPostedQty' }, ...sets].map((s) => (
          <button key={s.key} className={`fm-report${key === s.key ? ' active' : ''}`} aria-pressed={key === s.key} onClick={() => set({ set: s.key })}>
            <Database size={18} /><span><b>{s.label}</b><small>{s.by === 'lot' ? 'One lot' : s.by === 'emp-date' ? 'Employee + payroll date' : 'Employee + date range'} · {s.query}</small></span>
          </button>
        ))}
      </div>
      {def && <DmFilters p={p} set={set} fields={FIELDS[def.by]} labels={LABELS[def.by]} />}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!ready ? <EmptyState title="Complete the filters above" /> : !ok ? <SkeletonRows rows={6} cols={6} />
        : data.posted ? <PostedPacks rows={data.rows} edit={edit} setEdit={setEdit} save={save} />
          : <Sheet d={data} edit={edit} setEdit={setEdit} save={save} remove={remove} />}
    </div>
  )
}

function Sheet({ d, edit, setEdit, save, remove }) {
  if (!d.rows.length) return <EmptyState title="No rows" />
  const show = (c, v) => (v == null ? <span className="faint">—</span> : DATE_T.has(c.type) ? fmtDate(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))
  const input = (c) => {
    const v = edit.values[c.name] ?? ''
    const on = (e) => setEdit((s) => ({ ...s, values: { ...s.values, [c.name]: e.target.value } }))
    return DATE_T.has(c.type) ? <input className="cell-input" type="date" aria-label={c.name} value={toInputDate(v)} onChange={on} />
      : <input className="cell-input" aria-label={c.name} value={v} onChange={on} style={{ minWidth: 70 }} />
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>{d.label}</h2><span className="muted small">{d.rows.length === 2000 ? 'First 2,000 rows' : `${d.rows.length} row(s)`} · {d.query}{d.note ? ` · ${d.note}` : ''}</span></div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>{d.id}</th>{d.columns.map((c) => <th key={c.name} className={c.edit ? '' : 'faint'}>{c.name}</th>)}<th /></tr></thead>
        <tbody>{d.rows.map((r) => {
          const on = edit?.id === r._id
          return (
            <tr key={r._id}>
              <td><b>{r._id}</b></td>
              {d.columns.map((c) => <td key={c.name}>{on && c.edit ? input(c) : show(c, r[c.name])}</td>)}
              <td style={{ whiteSpace: 'nowrap' }}>{on
                ? <><button className="btn small primary" onClick={save}><Save size={13} /> Save</button> <button className="btn small ghost" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></>
                : <><button className="btn small ghost" aria-label={`Edit row ${r._id}`} onClick={() => setEdit({ id: r._id, values: Object.fromEntries(d.columns.filter((c) => c.edit).map((c) => [c.name, r[c.name] ?? ''])) })}><Pencil size={13} /></button>
                  <button className="btn small ghost" aria-label={`Delete row ${r._id}`} onClick={() => remove(r._id)}><Trash2 size={13} /></button></>}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
    </section>
  )
}

function PostedPacks({ rows, edit, setEdit, save }) {
  if (!rows.length) return <EmptyState title="This lot has no packs" />
  const r0 = rows[0]
  const field = (k) => <input className="cell-input" type="number" step="1" aria-label={k} value={edit.values[k] ?? ''} onChange={(e) => setEdit((s) => ({ ...s, values: { ...s.values, [k]: e.target.value } }))} style={{ width: 80 }} />
  return (
    <section className="panel">
      <div className="panel-head"><h2>Edit posted packs</h2><span className="muted small">{r0.JobName} · {r0.Phase} · Lot {r0.Lot}/{r0.Block} · Plan {r0.LotPlan}</span></div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Pack</th><th>Builder code</th><th>Type</th><th className="num">Pack qty</th><th className="num">Material posted</th><th className="num">Labor posted</th><th>Contract ea</th><th>Rev. contract ea</th><th /></tr></thead>
        <tbody>{rows.map((r) => {
          const on = edit?.id === r.PackID
          return (
            <tr key={r.PackID}>
              <td className="wrap"><b>{r.PackName || '—'}</b></td><td>{r.BuilderCode}</td><td>{r.PackType}</td><td className="num">{int(r.PackQty)}</td>
              <td className="num">{on ? field('MaterialPostedQty') : int(r.MaterialPostedQty)}</td><td className="num">{on ? field('LaborPostedQty') : int(r.LaborPostedQty)}</td>
              <td>{r.ContractEa}</td><td>{r.RevContractEa}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{on
                ? <><button className="btn small primary" onClick={save}><Save size={13} /> Save</button> <button className="btn small ghost" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></>
                : <button className="btn small ghost" aria-label={`Edit ${r.PackName}`} onClick={() => setEdit({ id: r.PackID, values: { MaterialPostedQty: r.MaterialPostedQty ?? '', LaborPostedQty: r.LaborPostedQty ?? '' } })}><Pencil size={13} /></button>}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
      <p className="muted small">Only the posted material and labor quantities can change here (as in Access).</p>
    </section>
  )
}
