// Lists used by Job setup = Access forms LsJobType, LsPhaseType, LsSuperintendent, LsJurisdiction, LsCity, LsCreditRating.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListChecks, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, changed, nextParams, resetJsLookups, useConfirm, useDebounced, useJsLookups } from './shared'

// field: [key, label, type, extra]
const LISTS = {
  'job-types': { label: 'Job types', id: 'JobTypeID', fields: [['JobType', 'Job type', 'text', 50]] },
  'phase-types': { label: 'Phase types', id: 'PhaseTypeID', fields: [['PhaseType', 'Phase type', 'text', 50], ['JobTypeId', 'Job type', 'jobType']] },
  superintendents: { label: 'Superintendents', id: 'SuperID', fields: [['SuperName', 'Superintendent', 'text', 50], ['SuperType', 'Super type', 'superType'], ['Active', 'Active', 'bool']] },
  jurisdictions: { label: 'Jurisdictions', id: 'JurisdictionID', fields: [['Jurisdiction', 'Jurisdiction', 'text', 50], ['State', 'State', 'state']] },
  cities: { label: 'Cities', id: 'CityID', fields: [['City', 'City', 'text', 50], ['State', 'State', 'state'], ['CoxService', 'Cox service', 'bool']] },
  'credit-ratings': { label: 'Credit ratings', id: 'CreditID', fields: [['Rating', 'Rating', 'text', 255]] },
}
const SUPER_TYPES = ['HV', 'LV', 'UGS']

function Field({ f, value, onChange, lk, name }) {
  const [k, label, type, max] = f
  const aria = `${name} ${label}`
  if (type === 'bool') return <input type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} aria-label={aria} />
  if (type === 'jobType') return <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={aria}><option value="" />{lk.jobTypes.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
  if (type === 'superType') return <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={aria}><option value="" />{[...new Set([...SUPER_TYPES, value].filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}</select>
  if (type === 'state') return <input value={value ?? ''} maxLength={2} placeholder="CA" style={{ width: 70 }} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={aria} />
  return <input value={value ?? ''} maxLength={max} onChange={(e) => onChange(e.target.value)} aria-label={aria} data-key={k} />
}

export default function JsLists() {
  const lk = useJsLookups()
  const [dialog, ask] = useConfirm()
  const [sp, setSp] = useSearchParams()
  const p = { list: 'job-types', ...Object.fromEntries(sp.entries()) }
  const cfg = LISTS[p.list] || LISTS['job-types']
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState(null)
  const blank = () => Object.fromEntries(cfg.fields.map(([k, , type]) => [k, type === 'bool' ? (k === 'Active') : '']))
  const [nw, setNw] = useState(blank)
  const set = (patch) => setSp(nextParams(p, patch))

  const load = () => api(`/js/lists/${p.list}`, { params: { search: p.search } }).then((d) => setData({ ...d, _l: p.list })).catch((e) => setError(e.message))
  useEffect(() => {
    setData(null); setError(''); setEdit(null); setNw(blank()); load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useDebounced(search, (v) => { if (v !== (p.search || '')) set({ search: v }) })

  const run = async (fn, ok) => {
    setError(''); setMsg('')
    try { await fn(); resetJsLookups(); setMsg(ok); await load() } catch (e) { setError(e.message) }
  }
  const add = (e) => { e.preventDefault(); run(async () => { await api(`/js/lists/${p.list}`, { method: 'POST', body: nw }); setNw(blank()) }, `${cfg.label.replace(/s$/, '')} added`) }
  const save = () => run(async () => {
    const orig = data.rows.find((r) => r[cfg.id] === edit[cfg.id])
    const body = changed(orig, edit, cfg.fields.map(([k]) => k))
    if (Object.keys(body).length) await api(`/js/lists/${p.list}/${edit[cfg.id]}`, { method: 'PUT', body })
    setEdit(null)
  }, 'Saved')
  const del = async (r) => {
    const name = r[cfg.fields[0][0]]
    if (!(await ask({ title: 'Delete?', message: `Delete "${name}" from ${cfg.label.toLowerCase()}?`, ok: 'Delete', danger: true }))) return
    run(() => api(`/js/lists/${p.list}/${r[cfg.id]}`, { method: 'DELETE' }), `"${name}" deleted`)
  }
  const show = (f, r) => {
    const [k, , type] = f
    if (type === 'bool') return r[k] ? <Badge tone="green">Yes</Badge> : <span className="faint">No</span>
    if (type === 'jobType') return lk.jobTypes.find((j) => j.id === r[k])?.name || r[k]
    return r[k]
  }
  const ready = data && data._l === p.list

  return (
    <div className="page">
      {dialog}
      <PageHeader title="Job setup lists" subtitle="Values offered in the builder, job and phase forms. Records in use cannot be deleted." />
      <JsTabs />
      <div className="filters">
        <div className="seg js-seg-scroll" role="tablist" aria-label="List">{Object.entries(LISTS).map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={p.list === k} className={`seg-btn${p.list === k ? ' active' : ''}`} onClick={() => { setSearch(''); setSp({ list: k }) }}>{v.label}</button>))}</div>
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${cfg.label.toLowerCase()}…`} aria-label={`Search ${cfg.label}`} /></div>
      </div>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="table-wrap">
        {!ready ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className="grid compact">
            <thead><tr><th className="num">ID</th>{cfg.fields.map(([k, l]) => <th key={k}>{l}</th>)}<th className="num">In use</th><th /></tr></thead>
            <tbody>
              <tr className="new-row">
                <td className="num muted">new</td>
                {cfg.fields.map((f) => <td key={f[0]}><Field f={f} name="New" lk={lk} value={nw[f[0]]} onChange={(v) => setNw((s) => ({ ...s, [f[0]]: v }))} /></td>)}
                <td />
                <td className="actions"><button type="button" className="btn small primary" onClick={add} disabled={!String(nw[cfg.fields[0][0]] || '').trim()}><Plus size={13} /> Add</button></td>
              </tr>
              {data.rows.map((r) => edit?.[cfg.id] === r[cfg.id] ? (
                <tr key={r[cfg.id]} className="row-selected">
                  <td className="num">{r[cfg.id]}</td>
                  {cfg.fields.map((f) => <td key={f[0]}><Field f={f} name="Edit" lk={lk} value={edit[f[0]]} onChange={(v) => setEdit((s) => ({ ...s, [f[0]]: v }))} /></td>)}
                  <td className="num">{r.InUse}</td>
                  <td className="actions"><button type="button" className="btn small primary" onClick={save} aria-label="Save"><Save size={13} /></button><button type="button" className="btn small ghost" onClick={() => setEdit(null)}>Cancel</button></td>
                </tr>
              ) : (
                <tr key={r[cfg.id]} className={r.Active === false ? 'dim' : ''}>
                  <td className="num muted">{r[cfg.id]}</td>
                  {cfg.fields.map((f) => <td key={f[0]}>{show(f, r)}</td>)}
                  <td className="num">{r.InUse}</td>
                  <td className="actions">
                    <button type="button" className="btn small ghost" onClick={() => setEdit({ ...r })} aria-label={`Edit ${r[cfg.fields[0][0]]}`}>Edit</button>
                    <button type="button" className="btn small ghost danger" onClick={() => del(r)} disabled={r.InUse > 0} title={r.InUse > 0 ? 'In use — cannot be deleted' : 'Delete'} aria-label={`Delete ${r[cfg.fields[0][0]]}`}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={cfg.fields.length + 3}><EmptyState icon={ListChecks} title="No entries">Add the first one in the row above.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
