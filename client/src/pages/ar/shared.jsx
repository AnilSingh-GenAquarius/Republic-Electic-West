import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { money, money0, int, download } from '../po/shared'

export function ArTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/ar', label: 'Overview', end: true },
      { to: '/ar/billing', label: 'Process billing' },
      { to: '/ar/prebill', label: 'Post billing' },
      { to: '/ar/invoices', label: 'Invoices' },
      { to: '/ar/fix-billing-code', label: 'Fix billing code' },
      { to: '/ar/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function useArLookups() {
  const [lk, setLk] = useState(cache || { billTypes: [], terms: [], divisions: [], customers: [] })
  useEffect(() => { if (!cache) api('/ar/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const today = () => new Date().toISOString().slice(0, 10)
export const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)
export const LIENS = ['Progress', 'Final']
export const typeTone = (id) => (id === 3 ? 'red' : id === 2 ? 'amber' : 'blue')

// In-page confirmation (replaces window.confirm). Render it when there is something to confirm; onCancel / onConfirm close it.
export function ConfirmDialog({ title, children, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <div className="dialog-scrim" onClick={() => !busy && onCancel()} onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ar-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="ar-dialog-title"><AlertTriangle size={18} /> {title}</h2>
        {children}
        <div className="row dialog-actions">
          <button type="button" className="btn" autoFocus onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// "Customer snapshot in use" (Access SwitchARsubBillProcess): DIV | Customer | user. Highlights the chosen builder + division.
// reloadKey: change it to refetch after a clear/post. onData receives { rows, me }.
export function SnapshotsInUse({ customerId, division, reloadKey, onData }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    api('/ar/snapshots').then((r) => { if (live) { setD(r); setErr(''); onData?.(r) } }).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [reloadKey, onData])
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h2>Customer snapshot in use</h2></div>
      {err ? <p className="muted" style={{ padding: '0 14px 12px' }}>{err}</p> : !d ? <p className="muted" style={{ padding: '0 14px 12px' }}>Loading…</p> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>DIV</th><th>Customer</th><th>User</th><th className="num">Lots</th></tr></thead>
          <tbody>
            {d.rows.map((r) => {
              const mine = String(r.CustId) === String(customerId) && r.DivisionId === division
              return <tr key={`${r.DivisionId}-${r.CustId}-${r.UserSelect}-${r.Source}`} className={mine ? 'row-warn' : ''}><td>{r.DivisionId}</td><td className="wrap">{mine ? <b>{r.CustName}</b> : r.CustName}</td><td>{r.UserSelect}{r.UserSelect === d.me ? ' (you)' : ''}</td><td className="num">{r.Lots}</td></tr>
            })}
            {!d.rows.length && <tr><td colSpan={4} className="muted">No customer has a billing snapshot right now.</td></tr>}
          </tbody>
        </table></div>
      )}
    </section>
  )
}
