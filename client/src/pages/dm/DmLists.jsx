// Database maintenance – Lists tab of Access SwitchDM: one editor for every lookup table on the allow-list.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ListTree, Pencil, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { DmTabs } from './shared'

export function DmLists() {
  const nav = useNavigate()
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { api('/dm/lists').then(setLists).catch((e) => setError(e.message)) }, [])
  const s = q.trim().toLowerCase()
  const shown = (lists || []).filter((l) => !s || `${l.label} ${l.group}`.toLowerCase().includes(s))
  const groups = [...new Set(shown.map((l) => l.group))].sort()
  return (
    <div className="page">
      <PageHeader title="Lists" subtitle="Lookup tables used by the drop-downs everywhere in Staffware" />
      <DmTabs />
      <div className="filters"><div className="search-wrap"><input type="search" aria-label="Find a list" placeholder="Find a list…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {error && <ErrorState message={error} />}
      {!lists ? <SkeletonRows rows={8} cols={3} /> : groups.map((g) => (
        <section key={g} className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head"><h2>{g}</h2></div>
          <div className="table-wrap"><table className="grid compact">
            <tbody>{shown.filter((l) => l.group === g).map((l) => (
              <tr key={l.key} className="link-row" onClick={() => nav(l.key === 'logins' ? '/dm/logins' : `/dm/lists/${l.key}`)}>
                <td>{l.key === 'logins' ? <ShieldCheck size={14} /> : <ListTree size={14} />} <a><b>{l.label}</b></a></td>
                <td className="num muted">{l.count == null ? '' : `${l.count} row(s)`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
    </div>
  )
}

export function DmList() {
  const { key } = useParams()
  const [sp, setSp] = useSearchParams()
  const parent = sp.get('parent') || ''
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState(null) // { id: null for a new row, values }
  const [q, setQ] = useState('')
  const load = useCallback(() => api(`/dm/lists/${key}`, { params: { parent } }).then(setD), [key, parent])
  useEffect(() => { setD(null); setEdit(null); load().catch((e) => setError(e.message)) }, [load])
  const m = d?.meta
  const blank = () => Object.fromEntries(m.cols.map((c) => [c.name, c.type === 'bit' ? false : m.parent && c.name === m.parent ? parent : '']))
  async function save() {
    setError(''); setMsg('')
    try {
      if (edit.id == null) await api(`/dm/lists/${key}`, { method: 'POST', body: edit.values })
      else await api(`/dm/lists/${key}/${encodeURIComponent(edit.id)}`, { method: 'PUT', body: edit.values })
      setMsg(edit.id == null ? 'Added' : 'Saved'); setEdit(null); await load()
    } catch (e) { setError(e.message) }
  }
  async function remove(id, name) {
    if (!confirm(`Delete “${name}” from ${m.label}?`)) return
    setError(''); setMsg('')
    try { await api(`/dm/lists/${key}/${encodeURIComponent(id)}`, { method: 'DELETE' }); setMsg('Deleted'); await load() } catch (e) { setError(e.message) }
  }
  const optName = (c, v) => { const o = (d.options[c.ref] || []).find((x) => String(x.id) === String(v)); return o ? o.name : v }
  const show = (c, v) => (v == null || v === '' ? <span className="faint">—</span> : c.type === 'bit' ? (v ? 'Yes' : 'No') : c.ref ? optName(c, v) : String(v))
  const input = (c) => {
    const v = edit.values[c.name]
    const on = (val) => setEdit((s) => ({ ...s, values: { ...s.values, [c.name]: val } }))
    if (c.type === 'bit') return <input type="checkbox" aria-label={c.label} checked={!!v} onChange={(e) => on(e.target.checked)} />
    if (c.ref) return <select className="cell-input" aria-label={c.label} value={v ?? ''} onChange={(e) => on(e.target.value)}><option value="">—</option>{(d.options[c.ref] || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    const disabled = edit.id != null && m.text && c.name === m.id
    return <input className="cell-input" aria-label={c.label} value={v ?? ''} maxLength={c.max || undefined} disabled={disabled} onChange={(e) => on(e.target.value)} style={{ minWidth: c.max && c.max <= 10 ? 60 : 120 }} />
  }
  const s = q.trim().toLowerCase()
  const rows = (d?.rows || []).filter((r) => !s || m.cols.some((c) => String(c.ref ? optName(c, r[c.name]) ?? '' : r[c.name] ?? '').toLowerCase().includes(s)))
  const parentCol = m?.parent ? m.cols.find((c) => c.name === m.parent) : null
  const editRow = (id) => (
    <>
      {m.cols.map((c) => <td key={c.name}>{input(c)}</td>)}
      <td style={{ whiteSpace: 'nowrap' }}><button className="btn small primary" onClick={save}><Save size={13} /> {id == null ? 'Add' : 'Save'}</button> <button className="btn small ghost" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
    </>
  )
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/dm/lists">Lists</Link>} title={m?.label || 'List'} track={!!m} subtitle={m ? `${d.rows.length} row(s)${m.text ? ` · the ${m.cols[0].label.toLowerCase()} cannot be renamed once added` : ''}` : null}
        actions={<Link className="btn" to="/dm/lists"><ArrowLeft size={15} /> Lists</Link>} />
      <DmTabs />
      {m && (
        <div className="filters">
          <div className="search-wrap"><input type="search" aria-label="Filter rows" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {parentCol && <label className="row" style={{ gap: 6 }}>{parentCol.label}
            <select aria-label={`Filter by ${parentCol.label}`} value={parent} onChange={(e) => setSp(e.target.value ? { parent: e.target.value } : {})}><option value="">All</option>{(d.options[parentCol.ref] || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={!!edit} onClick={() => setEdit({ id: null, values: blank() })}><Plus size={15} /> Add</button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr>{m.cols.map((c) => <th key={c.name}>{c.label}{c.req ? ' *' : ''}</th>)}<th /></tr></thead>
          <tbody>
            {edit?.id === null && <tr className="new-row">{editRow(null)}</tr>}
            {rows.map((r) => {
              const id = r[m.id]
              return (
                <tr key={String(id)}>{edit && edit.id === id ? editRow(id) : <>
                  {m.cols.map((c) => <td key={c.name} className={c.name === m.name ? '' : 'wrap'}>{c.name === m.name ? <b>{show(c, r[c.name])}</b> : show(c, r[c.name])}</td>)}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small ghost" aria-label={`Edit ${r[m.name]}`} disabled={!!edit} onClick={() => setEdit({ id, values: Object.fromEntries(m.cols.map((c) => [c.name, c.type === 'bit' ? !!r[c.name] : r[c.name] ?? ''])) })}><Pencil size={13} /></button>
                    <button className="btn small ghost" aria-label={`Delete ${r[m.name]}`} disabled={!!edit} onClick={() => remove(id, r[m.name])}><Trash2 size={13} /></button>
                  </td>
                </>}</tr>
              )
            })}
            {!rows.length && edit?.id !== null && <tr><td colSpan={m.cols.length + 1}><EmptyState title="No rows" /></td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
