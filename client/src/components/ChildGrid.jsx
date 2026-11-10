import { useState } from 'react'

/**
 * Inline-editable list of child rows (e.g. account contacts or zones).
 * fields: [{ key, label, type?: 'text'|'select', options?: string[], width? }]
 * onAdd(row) / onSave(id, row) / onDelete(id) return promises; onChanged() reloads the parent.
 */
export default function ChildGrid({ title, rows, idKey, fields, onAdd, onSave, onDelete, onChanged }) {
  const blank = Object.fromEntries(fields.map((f) => [f.key, '']))
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(blank)
  const [newRow, setNewRow] = useState(blank)
  const [error, setError] = useState('')

  const run = async (fn) => {
    setError('')
    try { await fn(); onChanged() } catch (e) { setError(e.message) }
  }

  const input = (f, value, set) =>
    f.type === 'select' ? (
      <select value={value ?? ''} onChange={(e) => set({ [f.key]: e.target.value })}>
        <option value="" />
        {/* keep legacy values that aren't in the lookup table so editing doesn't wipe them */}
        {(value && !f.options.includes(value) ? [value, ...f.options] : f.options).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input value={value ?? ''} onChange={(e) => set({ [f.key]: e.target.value })} />
    )

  return (
    <section className="card">
      <h3>{title} <span className="muted small">({rows.length})</span></h3>
      {error && <div className="error">{error}</div>}
      <table className="grid">
        <thead>
          <tr>{fields.map((f) => <th key={f.key} style={{ width: f.width }}>{f.label}</th>)}<th style={{ width: 150 }} /></tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            editId === r[idKey] ? (
              <tr key={r[idKey]}>
                {fields.map((f) => (
                  <td key={f.key}>{input(f, draft[f.key], (p) => setDraft((d) => ({ ...d, ...p })))}</td>
                ))}
                <td className="actions">
                  <button className="btn small primary" onClick={() => run(async () => { await onSave(r[idKey], draft); setEditId(null) })}>Save</button>
                  <button className="btn small" onClick={() => setEditId(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={r[idKey]}>
                {fields.map((f) => <td key={f.key}>{r[f.key]}</td>)}
                <td className="actions">
                  <button className="btn small" onClick={() => { setEditId(r[idKey]); setDraft(Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? '']))) }}>Edit</button>
                  <button className="btn small danger" onClick={() => confirm('Delete this row?') && run(() => onDelete(r[idKey]))}>Delete</button>
                </td>
              </tr>
            )
          )}
          <tr className="new-row">
            {fields.map((f) => (
              <td key={f.key}>{input(f, newRow[f.key], (p) => setNewRow((d) => ({ ...d, ...p })))}</td>
            ))}
            <td className="actions">
              <button className="btn small primary" onClick={() => run(async () => { await onAdd(newRow); setNewRow(blank) })}>Add</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
