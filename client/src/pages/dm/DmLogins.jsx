// Database maintenance – Login access (Access form LoginUsers): who can log in and which modules each login opens.
// Passwords are never shown; a new one can only be typed in (write-only). You cannot lock yourself out.
import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { DmTabs } from './shared'

export default function DmLogins() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [show, setShow] = useState('active')
  const [form, setForm] = useState(null) // { isNew, Username, Active, modules, newPassword }
  const load = () => api('/dm/logins').then(setD)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const isMe = (u) => d && String(u).toLowerCase() === String(d.me || '').toLowerCase()
  async function save(e) {
    e.preventDefault(); setError(''); setMsg('')
    const body = { Active: form.Active, modules: form.modules, ...(form.newPassword ? { newPassword: form.newPassword } : {}) }
    try {
      if (form.isNew) await api('/dm/logins', { method: 'POST', body: { ...body, Username: form.Username } })
      else await api(`/dm/logins/${encodeURIComponent(form.Username)}`, { method: 'PUT', body })
      setMsg(`Login ${form.Username} saved${form.newPassword ? ' with the new password' : ''}. Changes apply within 30 seconds.`); setForm(null); await load()
    } catch (err) { setError(err.message) }
  }
  async function remove(u) {
    if (!confirm(`Delete the login ${u}? They will no longer be able to log in.`)) return
    setError(''); setMsg('')
    try { await api(`/dm/logins/${encodeURIComponent(u)}`, { method: 'DELETE' }); setMsg(`Login ${u} deleted`); if (form?.Username === u) setForm(null); await load() } catch (err) { setError(err.message) }
  }
  const s = q.trim().toLowerCase()
  const rows = (d?.rows || []).filter((r) => (show === 'all' || (show === 'active' ? r.Active : !r.Active)) && (!s || r.Username.toLowerCase().includes(s)))
  const blankModules = () => Object.fromEntries((d?.modules || []).map((m) => [m.code, false]))
  return (
    <div className="page">
      <PageHeader title="Login access" subtitle="Logins, passwords and the modules each login can open (Public is open to everyone)"
        actions={<button className="btn primary" disabled={!d || !!form} onClick={() => setForm({ isNew: true, Username: '', Active: true, modules: blankModules(), newPassword: '' })}><Plus size={15} /> New login</button>} />
      <DmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {form && (
        <form className="card form" onSubmit={save} style={{ marginBottom: 16 }}>
          <fieldset>
            <legend>{form.isNew ? 'New login' : `Login ${form.Username}`}{!form.isNew && isMe(form.Username) ? ' (you)' : ''}</legend>
            {form.isNew && <label>User name<input aria-label="User name" required maxLength={50} autoComplete="off" value={form.Username} onChange={(e) => setForm((f) => ({ ...f, Username: e.target.value }))} /></label>}
            <label>{form.isNew ? 'Password' : 'New password'}<input type="password" aria-label={form.isNew ? 'Password' : 'New password'} autoComplete="new-password" required={form.isNew} minLength={4} maxLength={50}
              placeholder={form.isNew ? '' : 'Leave blank to keep the current one'} value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} /></label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" aria-label="Active" checked={form.Active} disabled={!form.isNew && isMe(form.Username)} onChange={(e) => setForm((f) => ({ ...f, Active: e.target.checked }))} /> Active (can log in)</label>
          </fieldset>
          <fieldset>
            <legend>Modules</legend>
            {d.modules.map((m) => {
              const locked = !form.isNew && isMe(form.Username) && m.code === 'DM'
              return (
                <label key={m.code} className="row" style={{ gap: 6, alignItems: 'center' }} title={locked ? 'You cannot remove Database maintenance from your own login' : ''}>
                  <input type="checkbox" aria-label={m.label} checked={!!form.modules[m.code]} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, modules: { ...f.modules, [m.code]: e.target.checked } }))} /> {m.label} <span className="faint small">{m.code}</span>
                </label>
              )
            })}
          </fieldset>
          <div className="row form-actions">
            <button className="btn primary"><Save size={15} /> Save</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}><X size={15} /> Cancel</button>
            <span className="muted small"><KeyRound size={12} /> Passwords are stored as the Access front end expects; they are never shown here.</span>
          </div>
        </form>
      )}
      <div className="filters">
        <div className="search-wrap"><input type="search" aria-label="Find a login" placeholder="Find a login…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">{[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${show === k ? ' active' : ''}`} onClick={() => setShow(k)}>{l}</button>)}</div>
      </div>
      {!d ? <SkeletonRows rows={10} cols={6} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>User name</th><th>Status</th>{d.modules.map((m) => <th key={m.code} title={m.label} style={{ textAlign: 'center' }}>{m.code}</th>)}<th>Added</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={`${r.Username}-${i}`}>
              <td><b>{r.Username}</b>{isMe(r.Username) && <span className="muted small"> (you)</span>}{r.duplicate && <> <Badge tone="amber">duplicate</Badge></>}</td>
              <td><Badge tone={r.Active ? 'green' : 'neutral'}>{r.Active ? 'Active' : 'Inactive'}</Badge>{!r.HasPassword && <> <Badge tone="amber">no password</Badge></>}</td>
              {d.modules.map((m) => <td key={m.code} style={{ textAlign: 'center' }}>{r.modules[m.code] ? '✓' : ''}</td>)}
              <td className="muted small">{fmtDate(r.DateEntered)} {r.UserEntered || ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn small ghost" aria-label={`Edit ${r.Username}`} disabled={!!form || r.duplicate} title={r.duplicate ? 'Two logins share this name; fix it in the database first' : ''}
                  onClick={() => setForm({ isNew: false, Username: r.Username, Active: r.Active, modules: { ...r.modules }, newPassword: '' })}><Pencil size={13} /></button>
                <button className="btn small ghost" aria-label={`Delete ${r.Username}`} disabled={!!form || isMe(r.Username) || r.duplicate} onClick={() => remove(r.Username)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
