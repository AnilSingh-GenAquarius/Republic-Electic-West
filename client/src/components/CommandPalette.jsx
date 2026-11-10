import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react'
import { api, session } from '../api'
import { MODULES, moduleByCode } from '../modules'

/** Ctrl+K global search: jump to modules, plus live record search across modules. */
export default function CommandPalette({ onClose }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef(null)
  const list = useRef(null)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      api('/dashboard/search', { params: { q } })
        .then((d) => setResults(d.results)).catch(() => setResults([])).finally(() => setLoading(false))
    }, 180)
    return () => clearTimeout(t)
  }, [q])

  const modules = useMemo(() => {
    const mine = MODULES.filter((m) => m.ready && session.user?.modules?.includes(m.code))
    const s = q.toLowerCase()
    return mine.filter((m) => !s || m.name.toLowerCase().includes(s) || m.code.toLowerCase() === s)
      .map((m) => ({ module: m.code, kind: 'Module', title: m.name, subtitle: m.description, link: m.path }))
  }, [q])

  const all = [...modules, ...results]
  useEffect(() => { setActive(0) }, [q, results.length])

  const go = (r) => { onClose(); nav(r.link) }

  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(all.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && all[active]) go(all[active])
  }
  useEffect(() => { list.current?.querySelector('.cp-item.active')?.scrollIntoView({ block: 'nearest' }) }, [active])

  let lastKind = null
  return (
    <div className="cp-backdrop" onMouseDown={onClose}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cp-input">
          <Search size={17} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search modules, accounts, employees, jobs, items, vendors…" aria-label="Search" />
          <kbd>Esc</kbd>
        </div>
        <div className="cp-list" ref={list} role="listbox">
          {all.map((r, i) => {
            const m = moduleByCode[r.module]
            const Icon = m?.icon || ArrowRight
            const header = r.kind !== lastKind ? (lastKind = r.kind) : null
            return (
              <div key={`${r.link}-${i}`}>
                {header && <div className="cp-group">{header === 'Module' ? 'Modules' : header + 's'}</div>}
                <div role="option" aria-selected={i === active} className={`cp-item${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
                  <span className={`cp-icon accent-${m?.accent || 'slate'}`}><Icon size={15} /></span>
                  <span className="cp-text">
                    <span className="cp-title">{r.title}</span>
                    {r.subtitle && <span className="cp-sub">{r.subtitle}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={14} className="muted" />}
                </div>
              </div>
            )
          })}
          {q.trim().length >= 2 && !loading && !all.length && <div className="cp-empty">No results for “{q}”.</div>}
          {loading && <div className="cp-empty">Searching…</div>}
        </div>
        <div className="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>
  )
}
