// Printable T&M PO (Access report TmPO) and pick ticket (TmPickTicket).
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { lotLabel, money, qty } from './shared'

export function TmPrint() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/tm/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const t = d?.tm
  return (
    <div className="page print-doc">
      <PageHeader title={t ? `T&M PO ${t.TmID}` : 'T&M PO'} track={false}
        actions={<><Link className="btn" to={`/tm/${id}`}><ArrowLeft size={15} /> Back</Link><button className="btn primary" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <article className="po-sheet">
          <header className="po-head">
            <div><h2>{t.Company || 'Republic Electric West'}</h2><div className="muted small">{[t.BillAddress, t.BillCity, t.BillState, t.BillZip].filter(Boolean).join(', ')}{t.BillPhone ? ` · ${t.BillPhone}` : ''}</div></div>
            <div className="po-title"><b>{t.TmType || 'Time & material'}</b><span>No. {t.TmID}</span><span>{fmtDate(t.TmDate)}</span></div>
          </header>
          <div className="th-grid po-meta">
            <div><span className="muted small">Builder</span><b>{t.CustName}</b></div>
            <div><span className="muted small">Job</span><b>{t.JobName}</b></div>
            <div><span className="muted small">Lot</span><b>{lotLabel(t)} {t.Address ? `· ${t.Address}` : ''}</b></div>
            <div><span className="muted small">Customer PO #</span><b>{t.TmCustomerNum || '—'}</b></div>
            <div><span className="muted small">Description</span><b>{t.TmName}</b></div>
            <div><span className="muted small">Prepared by</span><b>{t.PreparedBy}</b></div>
            <div><span className="muted small">Requested by</span><b>{t.RequestedBy || '—'} {t.RequestorPhone || ''}</b></div>
            <div><span className="muted small">Approved</span><b>{t.ApprovedDate ? `${fmtDate(t.ApprovedDate)} ${t.ApprovedBy || ''}` : 'not yet'}</b></div>
          </div>
          {t.TmNotes && <p><b>Notes:</b> {t.TmNotes}</p>}
          {d.packs.map((p) => (
            <section key={p.TmPackID} className="po-pack">
              <div className="po-pack-head"><b>{p.TmPackName}</b><b>{money(p.Price)}</b></div>
              {p.Notes && <div className="muted small">{p.Notes}</div>}
              <table className="grid compact">
                <thead><tr><th>Item</th><th>Description</th><th className="num">Qty</th></tr></thead>
                <tbody>{p.materials.map((m) => {
                  const labor = m.CostCode === 'L'
                  return <tr key={m.TmMaterialID}><td>{labor ? (Number(t.LaborRateFlat) > 0 ? 'Flat labor rate' : 'Labor') : (m.AlternateCode || m.InvItem)}</td><td className="wrap">{labor ? '' : m.Description}{m.Notes ? ` ${m.Notes}` : ''}</td><td className="num">{labor && Number(t.LaborRateFlat) > 0 ? 1 : qty(m.Quantity)}</td></tr>
                })}</tbody>
              </table>
            </section>
          ))}
          <dl className="totals po-totals">
            <div><dt>Subtotal</dt><dd>{money(t.Subtotal)}</dd></div>
            {Number(t.Discount) > 0 && <div><dt>Discount</dt><dd>{money(t.DiscountAmt)}</dd></div>}
            <div><dt>Sales tax</dt><dd>{money(t.SalesTax)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(t.Total)}</dd></div>
            <div><dt>Total paying by credit card</dt><dd>{money(t.TotalWithCard)}</dd></div>
          </dl>
        </article>
      )}
    </div>
  )
}

export function TmPick() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/tm/${id}/pick-ticket`).then(setD).catch((e) => setError(e.message)) }, [id])
  const h = d?.head
  return (
    <div className="page print-doc">
      <PageHeader title={`Pick ticket · T&M ${id}`} track={false}
        subtitle={h ? `${h.TmName} · ${h.CustName} · ${h.JobName} · lot ${lotLabel(h)}` : null}
        actions={<><Link className="btn" to={`/tm/${id}`}><ArrowLeft size={15} /> Back</Link><button className="btn primary" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={6} cols={3} /> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Pack</th><th>Item</th><th>Description</th><th>Notes</th><th className="num">Qty</th><th style={{ width: 70 }}>Picked</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => <tr key={i}><td className="wrap">{r.TmPackName}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td className="wrap">{r.LineNotes}</td><td className="num"><b>{qty(r.Qty)}</b></td><td><span className="tick-box" /></td></tr>)}
              {!d.rows.length && <tr><td colSpan={6} className="muted">No material lines — labor only.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
