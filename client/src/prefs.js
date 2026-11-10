// Per-browser conveniences (sidebar state, selected division, recently visited screens).
// Wrapped in try/catch so the app still works when storage is blocked.
import { useEffect, useState } from 'react'

const read = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
}
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

const listeners = {}
/** useState that persists to localStorage and stays in sync across components. */
export function usePref(key, initial) {
  const [v, setV] = useState(() => read(key, initial))
  useEffect(() => {
    const fn = (nv) => setV(nv)
    ;(listeners[key] ||= new Set()).add(fn)
    return () => listeners[key].delete(fn)
  }, [key])
  const set = (nv) => {
    const val = typeof nv === 'function' ? nv(read(key, initial)) : nv
    write(key, val)
    listeners[key]?.forEach((fn) => fn(val))
  }
  return [v, set]
}

const RECENT_KEY = 'sw_recent'
/** Remember a visited screen: { path, title, module } */
export function trackVisit(entry) {
  if (!entry?.title) return
  const list = read(RECENT_KEY, []).filter((r) => r.path !== entry.path)
  list.unshift({ ...entry, at: Date.now() })
  write(RECENT_KEY, list.slice(0, 12))
}
export const recentVisits = () => read(RECENT_KEY, [])
