// Call notes (Access CsCallNotes): notes of calls per property, with an optional follow-up date.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, int, today } from './shared'

const empty = () => ({ CallDate: today(), PropertyId: null, label: '', Customer: '', CallNotes: '', FollowUp: '' })

export default function CsCallNotes() {
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [filterLabel, setFilterLabel] = useState('')
  const [q, setQ] = useState(p.search || '')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [f, setF] = useState(empty)
  const [edit, setEdit] = useState(null)
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })
  const load = useCallback(() => api('/cs/call-notes', { params: Object.fromEntries(sp.entries()) }).then(setD).catch((e) => setError(e.message)), [sp])
  useEffect(() => { setD(null); load() }, [load])
  useEffect(() => {
    if (p.propertyId && !filterLabel) api(`/cs/properties/${p.propertyId}`).then((r) => { setFilterLabel(r.property.Property); setF((s) => ({ ...s, PropertyId: r.property.PropertyID, label: r.property.Property })) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.propertyId])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const add = run(async (e) => {
    e.preventDefault()
    await api('/cs/call-notes', { method: 'POST', body: { CallDate: f.CallDate, PropertyId: f.PropertyId, Customer: f.Customer, CallNotes: f.CallNotes, FollowUp: f.FollowUp } })
    setF({ ...empty(), PropertyId: f.PropertyId, label: f.label })
  }, 'Call notes saved')
  const save = run(async () => { const { id, ...b } = edit; await api(`/cs/call-notes/${id}`, { method: 'PUT', body: b }); setEdit(null) }, 'Call notes updated')
  const del = run(async (id) => { if (confirm('Delete these call notes?')) await api(`/cs/call-notes/${id}`, { method: 'DELETE' }) })
  return (
    <div className="page">
      <PageHeader title="Call notes" subtitle="Phone calls about a property and when to follow up" />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <form className="card form" onSubmit={add}>
        <fieldset>
          <legend>New notes</legend>
          <label>Call date *<input type="date" required value={f.CallDate} onChange={(e) => setF({ ...f, CallDate: e.target.value })} /></label>
          <label className="span2">Property address *<SearchSelect endpoint="/cs/properties/search" value={f.PropertyId} label={f.label} placeholder="Search address…" onSelect={(r) => setF({ ...f, PropertyId: r?.id ?? null, label: r?.name ?? '' })} /></label>
          <label>Customer name<input maxLength={50} value={f.Customer} onChange={(e) => setF({ ...f, Customer: e.target.value })} /></label>
          <label className="span2">Call notes *<input required maxLength={255} value={f.CallNotes} onChange={(e) => setF({ ...f, CallNotes: e.target.value })} /></label>
          <label>Follow up date<input type="date" value={f.FollowUp} onChange={(e) => setF({ ...f, FollowUp: e.target.value })} /></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary" disabled={!f.PropertyId || !f.CallNotes}><Plus size={15} /> Save notes</button></div>
      </form>
      <div className="filters" style={{ marginTop: 16 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}><SearchSelect endpoint="/cs/properties/search" value={p.propertyId ? Number(p.propertyId) : null} label={filterLabel} placeholder="Filter property notes…"
          onSelect={(r) => { setFilterLabel(r?.name ?? ''); set({ propertyId: r?.id ?? '' }) }} /></div>
        <div className="search-wrap"><input type="search" aria-label="Search notes" placeholder="Search notes or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={p.followUp === '1'} onChange={(e) => set({ followUp: e.target.checked ? '1' : '' })} /> With follow-up</label>
        {d && <span className="muted">{int(d.total)} note(s)</span>}
      </div>
      {!d ? <SkeletonRows rows={6} cols={4} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Date</th><th>Property</th><th>Customer</th><th>Notes</th><th>Follow up</th><th>Entered</th><th /></tr></thead>
            <tbody>
              {d.rows.map((n) => edit?.id === n.CallNotesID ? (
                <tr key={n.CallNotesID}>
                  <td><input type="date" className="cell-input wide" aria-label="Call date" value={edit.CallDate} onChange={(e) => setEdit({ ...edit, CallDate: e.target.value })} /></td>
                  <td className="wrap">{n.Property}</td>
                  <td><input className="cell-input wide" aria-label="Customer" value={edit.Customer} onChange={(e) => setEdit({ ...edit, Customer: e.target.value })} /></td>
                  <td><input className="cell-input wide" aria-label="Notes" value={edit.CallNotes} onChange={(e) => setEdit({ ...edit, CallNotes: e.target.value })} /></td>
                  <td><input type="date" className="cell-input wide" aria-label="Follow up" value={edit.FollowUp} onChange={(e) => setEdit({ ...edit, FollowUp: e.target.value })} /></td>
                  <td />
                  <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save" onClick={save}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
                </tr>
              ) : (
                <tr key={n.CallNotesID}>
                  <td>{fmtDate(n.CallDate)}</td><td className="wrap"><Link to={`/cs/properties/${n.PropertyId}`}>{n.Property}</Link></td><td>{n.Customer}</td><td className="wrap">{n.CallNotes}</td>
                  <td>{fmtDate(n.FollowUp) || '—'}</td><td className="cs-mini">{fmtDate(n.DateEntered)} {n.UserEntered}</td>
                  <td className="row" style={{ gap: 4 }}>
                    <button className="btn small icon" aria-label="Edit notes" onClick={() => setEdit({ id: n.CallNotesID, CallDate: toInputDate(n.CallDate), Customer: n.Customer || '', CallNotes: n.CallNotes || '', FollowUp: toInputDate(n.FollowUp) })}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label="Delete notes" onClick={() => del(n.CallNotesID)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={7}><EmptyState title="No call notes" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}
