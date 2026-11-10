import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, Building2, Check, X,
} from 'lucide-react'
import Logo from './Logo'
import { api, session } from '../api'
import { DASHBOARD, GROUPS, MODULES, moduleByCode } from '../modules'
import { usePref } from '../prefs'
import { useLookups } from './Pickers'
import CommandPalette from './CommandPalette'

function useOutside(ref, onOut) {
  useEffect(() => {
    const fn = (e) => ref.current && !ref.current.contains(e.target) && onOut()
    const esc = (e) => e.key === 'Escape' && onOut()
    document.addEventListener('mousedown', fn)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fn); document.removeEventListener('keydown', esc) }
  }, [ref, onOut])
}

function Dropdown({ trigger, children, align = 'right', label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  return (
    <div className="dropdown" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o), label })}
      {open && <div className={`dropdown-menu ${align}`} role="menu" onClick={(e) => e.target.closest('[data-close]') && setOpen(false)}>{children}</div>}
    </div>
  )
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, closeMobile }) {
  const user = session.user
  const mine = MODULES.filter((m) => user?.modules?.includes(m.code))
  const item = (m, key) => {
    const Icon = m.icon
    const inner = (
      <>
        <Icon size={18} strokeWidth={1.8} className="nav-icon" />
        <span className="nav-label">{m.name}</span>
        {m.code && <span className="nav-code" title={m.ready === false ? 'Coming soon' : undefined}>{m.code}</span>}
      </>
    )
    return m.ready === false ? (
      <span key={key} className="nav-item disabled" data-tip={collapsed ? `${m.name} (coming soon)` : undefined} aria-disabled="true">{inner}</span>
    ) : (
      <NavLink key={key} to={m.path} end={m.path === '/'} className="nav-item" data-tip={collapsed ? m.name : undefined} onClick={closeMobile}>{inner}</NavLink>
    )
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-head">
        <Logo size={46} />
        <div className="logo-text">
          <span className="logo-name">STAFFWARE</span>
          <span className="logo-sub">Republic Electric West</span>
        </div>
        <button className="icon-btn mobile-only" onClick={closeMobile} aria-label="Close menu"><X size={18} /></button>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-group">{item({ ...DASHBOARD, ready: true }, 'dash')}</div>
        {GROUPS.map((g) => {
          const mods = mine.filter((m) => m.group === g)
          if (!mods.length) return null
          return (
            <div className="nav-group" key={g}>
              <div className="nav-group-label">{g}</div>
              {mods.map((m) => item(m, m.code))}
            </div>
          )
        })}
      </nav>
      <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span>Collapse</span></>}
      </button>
    </aside>
  )
}

function Topbar({ openSearch, openMobile }) {
  const nav = useNavigate()
  const user = session.user
  const [env, setEnv] = useState('')
  const [division, setDivision] = usePref('sw_division', '')
  const { divisions } = useLookups('divisions')
  const [alerts, setAlerts] = useState(null)
  const [seen, setSeen] = usePref('sw_alerts_seen', [])

  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((d) => setEnv(d.env)).catch(() => {}) }, [])
  useEffect(() => { api('/dashboard/attention').then((d) => setAlerts(d.items)).catch(() => setAlerts([])) }, [])

  const unread = (alerts || []).filter((a) => !seen.includes(a.id)).length
  const initials = (user?.username || '?').slice(0, 2).toUpperCase()
  const divName = divisions.find((d) => d.id === division)?.name

  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={openMobile} aria-label="Open menu"><Menu size={18} /></button>

      <button className="global-search" onClick={openSearch} aria-label="Search (Ctrl+K)">
        <Search size={15} />
        <span>Search accounts, employees, jobs, items…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="topbar-right">
        {env && <span className={`env-badge ${env === 'LIVE' ? 'live' : 'demo'}`} title={env === 'LIVE' ? 'Production data' : 'Sample / test database'}>{env}</span>}

        <Dropdown trigger={({ toggle, open }) => (
          <button className="pill-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu">
            <Building2 size={15} />
            <span className="hide-sm">{division ? divName || division : 'All divisions'}</span>
            <ChevronDown size={14} />
          </button>
        )}>
          <div className="menu-label">Division</div>
          {[{ id: '', name: 'All divisions' }, ...divisions].map((d) => (
            <button key={d.id || 'all'} className="menu-item" data-close onClick={() => setDivision(d.id)} role="menuitemradio" aria-checked={division === d.id}>
              <span>{d.name}</span>{division === d.id && <Check size={14} />}
            </button>
          ))}
        </Dropdown>

        <Dropdown trigger={({ toggle, open }) => (
          <button className="icon-btn has-badge" onClick={() => { toggle(); if (!open && alerts) setSeen(alerts.map((a) => a.id)) }} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open}>
            <Bell size={18} />
            {unread > 0 && <span className="dot-count">{unread}</span>}
          </button>
        )}>
          <div className="menu-label">Needs attention</div>
          <div className="notif-list">
            {alerts === null && <div className="menu-empty">Loading…</div>}
            {alerts?.length === 0 && <div className="menu-empty">You're all caught up.</div>}
            {alerts?.map((a) => {
              const m = moduleByCode[a.module]
              const Icon = m?.icon
              return (
                <button key={a.id} className="notif" data-close onClick={() => nav(m?.ready ? a.action.to : `/insights/attention/${a.id}`)}>
                  <span className={`prio-dot ${a.priority}`} />
                  <span className="notif-body">
                    <span className="notif-title">{a.title}</span>
                    <span className="notif-meta">{Icon && <Icon size={12} />} {m?.name}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </Dropdown>

        <Dropdown trigger={({ toggle, open }) => (
          <button className="user-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu">
            <span className="avatar">{initials}</span>
            <span className="hide-sm user-name">{user?.username}</span>
            <ChevronDown size={14} className="hide-sm" />
          </button>
        )}>
          <div className="menu-user">
            <span className="avatar lg">{initials}</span>
            <div>
              <div className="menu-user-name">{user?.username}</div>
              <div className="muted small">{user?.modules?.length} modules enabled</div>
            </div>
          </div>
          <div className="menu-sep" />
          <button className="menu-item danger" data-close onClick={async () => { await session.logout(); nav('/login') }}>
            <LogOut size={14} /><span>Sign out</span>
          </button>
        </Dropdown>
      </div>
    </header>
  )
}

export default function Layout() {
  const [collapsed, setCollapsed] = usePref('sw_sidebar_collapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const loc = useLocation()

  useEffect(() => { setMobileOpen(false) }, [loc.pathname])
  useEffect(() => {
    const fn = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <div className="main-col">
        <Topbar openSearch={() => setSearchOpen(true)} openMobile={() => setMobileOpen(true)} />
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
