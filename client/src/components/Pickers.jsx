import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/** Load lookup lists once: const lk = useLookups('divisions,workTypes') -> { divisions: [...], workTypes: [...] } */
const lookupCache = {}
export function useLookups(names) {
  const [data, setData] = useState(() => {
    const out = {}
    names.split(',').forEach((n) => (out[n] = lookupCache[n] || []))
    return out
  })
  useEffect(() => {
    const missing = names.split(',').filter((n) => !lookupCache[n])
    if (!missing.length) return
    api('/common/lookups', { params: { names: missing.join(',') } }).then((r) => {
      Object.assign(lookupCache, r)
      const out = {}
      names.split(',').forEach((n) => (out[n] = lookupCache[n] || []))
      setData(out)
    }).catch(() => {})
  }, [names])
  return data
}

/** Plain <select> over a lookup list. */
export function LookupSelect({ options, value, onChange, blank = '', ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{blank}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  )
}

/**
 * Type-ahead search box backed by an API endpoint that returns [{ id, name, ... }].
 * value = selected id; label = text to show for the current value; onSelect(row|null).
 */
export function SearchSelect({ endpoint, params, value, label, onSelect, placeholder = 'Search…', disabled }) {
  const [text, setText] = useState(label || '')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [pos, setPos] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const box = useRef(null)

  useEffect(() => { setText(label || '') }, [label, value])

  useEffect(() => {
    if (!open) return
    setLoaded(false); setRows([]) // never show (or let the user click) results of an older search
    const t = setTimeout(() => {
      api(endpoint, { params: { ...params, search: text === label ? '' : text } }).then((r) => { setRows(r); setLoaded(true) }).catch(() => { setRows([]); setLoaded(true) })
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open, endpoint])

  // keep the menu glued under the input (position: fixed escapes overflow:hidden/auto tables)
  useEffect(() => {
    if (!open) return
    const place = () => { const r = box.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 300) }) }
    place()
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setText(label || '') } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [label])

  return (
    <div className="search-select" ref={box}>
      <input
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => { setOpen(true); e.target.select() }}
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
      />
      {value && !disabled && (
        <button type="button" className="clear" title="Clear" onClick={() => { onSelect(null); setText('') }}>×</button>
      )}
      {open && (
        <div className="ss-menu" style={pos ? { position: 'fixed', top: pos.top, left: pos.left, width: pos.width, right: 'auto' } : undefined}>
          {rows.map((r) => (
            <div key={r.id} className={`ss-item${String(r.id) === String(value) ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect(r); setText(r.name); setOpen(false) }}>
              {r.name}
            </div>
          ))}
          {!rows.length && <div className="ss-item muted">{loaded ? 'No matches' : 'Searching…'}</div>}
        </div>
      )}
    </div>
  )
}

/**
 * Job → Lot → Pack cascade. value = { JobId, JobName, LotId, LotName, PackId, PackName }.
 * showPack=false hides the pack select.
 */
export function JobLotPicker({ value, onChange, showPack = true, disabled }) {
  const v = value || {}
  const [lots, setLots] = useState([])
  const [packs, setPacks] = useState([])

  useEffect(() => {
    if (!v.JobId) { setLots([]); return }
    api(`/common/jobs/${v.JobId}/lots`).then(setLots).catch(() => setLots([]))
  }, [v.JobId])
  useEffect(() => {
    if (!v.LotId || !showPack) { setPacks([]); return }
    api(`/common/lots/${v.LotId}/packs`).then(setPacks).catch(() => setPacks([]))
  }, [v.LotId, showPack])

  return (
    <>
      <label>Job
        <SearchSelect endpoint="/common/jobs" value={v.JobId} label={v.JobName} disabled={disabled} placeholder="Search job or builder…"
          onSelect={(r) => onChange({ JobId: r?.id ?? null, JobName: r?.name ?? '', LotId: null, LotName: '', PackId: null, PackName: '' })} />
      </label>
      <label>Lot
        <select value={v.LotId ?? ''} disabled={disabled || !v.JobId}
          onChange={(e) => {
            const l = lots.find((x) => String(x.id) === e.target.value)
            onChange({ ...v, LotId: l?.id ?? null, LotName: l?.name ?? '', PackId: null, PackName: '' })
          }}>
          <option value="">{v.JobId ? '' : 'Pick a job first'}</option>
          {v.LotId && !lots.some((l) => l.id === v.LotId) && <option value={v.LotId}>{v.LotName || v.LotId}</option>}
          {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {showPack && (
        <label>Pack
          <select value={v.PackId ?? ''} disabled={disabled || !v.LotId}
            onChange={(e) => {
              const p = packs.find((x) => String(x.id) === e.target.value)
              onChange({ ...v, PackId: p?.id ?? null, PackName: p?.name ?? '', PmPackId: p?.PmPackId ?? null })
            }}>
            <option value="" />
            {v.PackId && !packs.some((p) => p.id === v.PackId) && <option value={v.PackId}>{v.PackName || v.PackId}</option>}
            {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
    </>
  )
}

/** Simple pager used by list pages. */
export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="pager">
      <span className="muted small">{total} rows</span>
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>Page {page} of {pages}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  )
}

/** Sub-navigation tabs inside a module. tabs = [{ to, label }] */
export { default as ModuleTabs } from './ModuleTabs'
