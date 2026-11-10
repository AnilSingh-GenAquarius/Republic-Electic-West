// Pack ticket for one lot and stage (report ScPackLotTicket) with the Post action (macro ScPackLotPost / PackLateLot).
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, Send } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { ScTabs, lotName } from './shared'

const num = (v) => (v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))

export default function ScTicket() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const stage = sp.get('stage')
  const late = sp.get('late') === '1'
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const load = () => api(`/sc/lots/${id}/ticket`, { params: { scheduleStageId: stage, late: late ? 1 : undefined } }).then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, stage, late])

  async function post() {
    if (!confirm(`${late ? 'Post the late packs' : 'Post this stage'} for lot ${lotName(d.head)}?\n\nThis creates the material list and labor lines, marks the stage posted and sets contract values.`)) return
    setBusy(true); setError('')
    try {
      const r = await api(`/sc/lots/${id}/post`, { method: 'POST', body: { scheduleStageId: Number(stage), late } })
      setDone(r)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const h = d?.head
  const byStage = {}
  for (const m of d?.materials || []) (byStage[m.Stage] ||= []).push(m)
  const canPost = d && (late ? d.state.canPostLate : d.state.canPost)

  return (
    <div className="page ticket">
      <PageHeader crumb={h && <><Link to="/sc">Scheduling</Link> / <Link to={`/sc/lots/${id}`}>Lot {lotName(h)}</Link></>}
        title={`${late ? 'Late packs' : 'Pack ticket'}${h ? ` · ${h.ScheduleStage}` : ''}`} track={false}
        subtitle={h ? `${h.JobName} · lot ${lotName(h)}` : null}
        actions={<>
          <Link className="btn" to={`/sc/lots/${id}`}><ArrowLeft size={15} /> Lot</Link>
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
          {!done && <button className="btn primary" disabled={!canPost || busy} onClick={post}><Send size={15} /> {busy ? 'Posting…' : late ? 'Post late packs' : 'Post stage'}</button>}
        </>} />
      <div className="no-print"><ScTabs /></div>
      {error && <ErrorState message={error} />}
      {done && (
        <div className="success-state" style={{ marginBottom: 14 }}>
          <CheckCircle2 size={16} />
          <span>Posted: {done.materialLines} material lines sent to the warehouse list and {done.laborLines} labor lines ready for payroll.
            {' '}<Link to={`/sc/lots/${id}`}>Back to lot</Link> · <button className="link-btn" onClick={() => nav('/sc')}>Scheduling home</button></span>
        </div>
      )}
      {!d && !error && <SkeletonRows rows={8} cols={3} />}
      {d && (
        <>
          {!canPost && !done && <div className="banner"><AlertTriangle size={16} /> {d.state.reason || (late ? 'There are no packs waiting to be posted late for this stage.' : 'Nothing to post.')}</div>}
          <section className="card ticket-head">
            <div className="th-grid">
              <div><span className="muted small">Builder</span><b>{h.CustName}</b></div>
              <div><span className="muted small">Job</span><b>{h.JobName}{h.JobNum ? ` #${h.JobNum}` : ''}</b></div>
              <div><span className="muted small">Phase / lot</span><b>{h.Phase} · {lotName(h)}</b></div>
              <div><span className="muted small">Plan</span><b>{h.PlanNum || '—'}</b></div>
              <div><span className="muted small">Address</span><b>{[h.Address, h.City].filter(Boolean).join(', ')}</b></div>
              <div><span className="muted small">Delivery date</span><b>{fmtDate(h.DeliveryDate) || '—'}</b></div>
              <div><span className="muted small">Superintendents</span><b>{[h.Super1, h.Super2].filter(Boolean).join(', ') || '—'}</b></div>
              <div><span className="muted small">Substitution</span><b>{h.SubsName || 'none'}</b></div>
            </div>
          </section>

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head"><h2>Materials ({d.materials.length} items)</h2>{late && <Badge tone="amber">packs added after the stage was posted</Badge>}</div>
            {!d.materials.length ? <p className="muted small">No material items for this stage.</p> : Object.entries(byStage).map(([name, rows]) => (
              <div key={name} style={{ marginBottom: 10 }}>
                <div className="menu-label" style={{ padding: '4px 0' }}>{name}</div>
                <table className="grid compact">
                  <thead><tr><th>Item</th><th>Description</th><th>Notes</th><th className="num">Qty</th></tr></thead>
                  <tbody>{rows.map((m, i) => <tr key={i}><td><b>{m.InvItem}</b></td><td className="wrap">{m.Description}</td><td className="wrap">{m.Notes}</td><td className="num"><b>{num(m.Qty)}</b></td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Labor lines for payroll ({d.labor.length})</h2></div>
            {!d.labor.length ? <p className="muted small">No labor items for this stage.</p> : (
              <table className="grid compact">
                <thead><tr><th>Pack</th><th>Labor item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Labor $</th></tr></thead>
                <tbody>{d.labor.map((m, i) => <tr key={i}><td className="wrap">{m.PackName}</td><td className="wrap">{m.InvItem}{m.Description ? ` — ${m.Description}` : ''}</td><td className="num">{num(m.Qty)}</td><td className="num">{num(m.Price)}</td><td className="num">{num(Number(m.Qty) * Number(m.Price))}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={4}>Total labor</td><td className="num">{num(d.labor.reduce((a, m) => a + Number(m.Qty) * Number(m.Price), 0))}</td></tr></tfoot>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
