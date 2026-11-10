// Small shared UI building blocks used across all modules.
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackVisit } from '../prefs'
import { moduleForPath } from '../modules'

export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          {Array.from({ length: cols }).map((__, j) => <Skeleton key={j} w={`${60 + ((i + j) % 3) * 15}%`} />)}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={20} /></div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={16} />
      <span>{message || 'Something went wrong.'}</span>
      {onRetry && <button className="btn small ghost" onClick={onRetry}><RefreshCw size={13} /> Retry</button>}
    </div>
  )
}

/** Page header with title, optional subtitle/breadcrumb, and actions. Also records the visit for "Jump back in". */
export function PageHeader({ title, subtitle, actions, crumb, track = true }) {
  const loc = useLocation()
  useEffect(() => {
    if (!track || !title || typeof title !== 'string') return
    const m = moduleForPath(loc.pathname)
    trackVisit({ path: loc.pathname + loc.search, title, module: m?.code })
  }, [title, loc.pathname, loc.search, track])
  return (
    <header className="page-head">
      <div className="page-title">
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Badge({ tone = 'neutral', children, icon: Icon }) {
  return <span className={`badge ${tone}`}>{Icon && <Icon size={12} />}{children}</span>
}

export function StatCard({ label, value, icon: Icon, tone = 'blue', foot, loading, to, onClick }) {
  const Tag = to || onClick ? 'button' : 'div'
  return (
    <Tag className={`stat-card tone-${tone}${to || onClick ? ' interactive' : ''}`} onClick={onClick} type={Tag === 'button' ? 'button' : undefined}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && <span className="stat-icon"><Icon size={16} /></span>}
      </div>
      <div className="stat-value">{loading ? <Skeleton w="60%" h={26} /> : value}</div>
      {foot && <div className="stat-foot">{loading ? <Skeleton w="80%" h={12} /> : foot}</div>}
    </Tag>
  )
}
