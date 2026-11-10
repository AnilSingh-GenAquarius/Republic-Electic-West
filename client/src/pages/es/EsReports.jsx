// Estimating reports (Access SwitchES report buttons): Bid full detail (EsBidItem), Job history log (EsJobHistoryLog),
// Low estimating prices (EsLowEstimatingPrice).
import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Download, FileText, History, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { useEsCascade } from './EsTransfer'
import { EsTabs, download, money, money4, yes } from './shared'

const REPORTS = [
  { key: 'bid-detail', label: 'Bid full detail', icon: FileText, needs: 'bid', text: 'Every plan, pack and item of an estimating bid with its total value' },
  { key: 'job-history', label: 'Job history log', icon: History, needs: 'job', text: 'Job information and its history log entries' },
  { key: 'low-prices', label: 'Low estimating prices', icon: AlertTriangle, needs: null, text: 'Active items whose estimating price is below last, average or labor cost' },
]

export default function EsReports() {
  const [sp, setSp] = useSearchParams()
  const report = sp.get('report') || ''
  const rep = REPORTS.find((r) => r.key === report)
  const { v, o, sel } = useEsCascade()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const ready = rep && (rep.needs === null || (rep.needs === 'bid' && v.bidId) || (rep.needs === 'job' && v.jobId))
  useEffect(() => {
    setData(null); setError('')
    if (!ready) return
    let live = true
    const [url, params] = { 'bid-detail': ['/es/reports/bid-detail', { bidId: v.bidId }], 'job-history': ['/es/reports/job-history', { jobId: v.jobId }], 'low-prices': ['/es/reports/low-prices', {}] }[rep.key]
    api(url, { params }).then((d) => live && setData({ d, k: rep.key })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, v.bidId, v.jobId])
  const ok = data && data.k === report
  const pick = (k) => { const n = Object.fromEntries(sp.entries()); n.report = k; setSp(n) }
  return (
    <div className="page">
      <PageHeader title="Estimating reports" subtitle="Pick a report; the filters it needs appear below"
        actions={ok && <><button className="btn" onClick={() => exportCsv(report, data.d)}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <EsTabs />
      <div className="fm-reports no-print">{REPORTS.map((r) => <button key={r.key} className={`fm-report${report === r.key ? ' active' : ''}`} aria-pressed={report === r.key} onClick={() => pick(r.key)}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}</div>
      {rep?.needs && (
        <div className="card form report-filters no-print"><fieldset>
          {sel('customerId', 'Customer', o.customers)}
          {sel('jobId', 'Job', o.jobs, !v.customerId && !v.jobId)}
          {rep.needs === 'bid' && sel('bidId', 'EST bid', o.bids, !v.jobId)}
        </fieldset></div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState title="Choose a report" /> : !ready ? <EmptyState title="Complete the filters above" /> : !ok ? <SkeletonRows rows={8} cols={5} /> : (
        <div className="fm-sheet">{report === 'bid-detail' ? <BidDetail d={data.d} /> : report === 'job-history' ? <JobHistory d={data.d} /> : <LowPrices d={data.d} />}</div>
      )}
    </div>
  )
}

function exportCsv(k, d) {
  if (k === 'bid-detail') download(d.rows, [['PlanNum', 'Plan'], ['PlanName', 'Plan name'], ['PackName', 'Pack'], ['QuotedItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Quantity'], ['ItemTotalValue', 'Total value']], `es-bid-detail-${d.head.EsBidID}.csv`)
  else if (k === 'job-history') download(d.entries, [['DateEntered', 'Date entered'], ['UserEntered', 'User'], ['Description', 'Title'], ['EffectivePhase', 'Effective phase'], ['EffectiveDate', 'Effective date'], ['Type', 'Type'], ['ContractNumber', 'Contract number'], ['WorkAgreeNum', 'Work agree num'], ['AddendumNumber', 'Addendum number'], ['Executed', 'Executed'], ['Notes', 'Notes']], `es-job-history-${d.job.PmJobID}.csv`)
  else download(d, [['InvClass', 'Class'], ['InvItem', 'Item'], ['LastCost', 'Last cost'], ['AverageCost', 'Average cost'], ['EstimatingPrice', 'Estimating price'], ['Disc', 'Disc'], ['LastPurchase', 'Last purchase'], ['Notes', 'Notes']], 'es-low-estimating-prices.csv')
}

function BidDetail({ d }) {
  const h = d.head
  const plans = []
  for (const r of d.rows) {
    let p = plans[plans.length - 1]
    if (!p || p.id !== r.EsPlanID) { p = { id: r.EsPlanID, name: `${r.PlanNum ?? ''} ${r.PlanName ?? ''}`.trim(), packs: [], total: 0 }; plans.push(p) }
    let k = p.packs[p.packs.length - 1]
    if (!k || k.id !== r.EsPackID) { k = { id: r.EsPackID, name: r.PackName, notes: r.PackNotes, rows: [] }; p.packs.push(k) }
    k.rows.push(r); p.total += r.ItemTotalValue
  }
  return (
    <>
      <div className="fm-head"><div><h2>Estimating bid</h2><div className="muted">{h.Customer} · Project {h.Job} · Bid {h.BidNum} · {fmtDate(h.BidDate)} · Recipient {h.Recipient || '—'} · Estimator {h.Estimator || '—'}</div></div></div>
      {!plans.length ? <EmptyState title="This bid has no pack material" /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Item / description</th><th className="num">Quantity</th><th className="num">Total value</th></tr></thead>
          <tbody>{plans.map((p) => (
            <Fragment key={p.id}>
              <tr><td colSpan={3}><b>Plan / area: {p.name}</b></td></tr>
              {p.packs.map((k) => (
                <Fragment key={k.id}>
                  <tr><td colSpan={3} style={{ paddingLeft: 18 }}><b>Pack / location: {k.name}</b>{k.notes ? <span className="muted"> · {k.notes}</span> : null}</td></tr>
                  {k.rows.map((r, i) => <tr key={i}><td className="wrap" style={{ paddingLeft: 32 }}>{r.QuotedItem}{r.Description && <span className="muted"> – {r.Description}</span>}</td><td className="num">{r.Quantity}</td><td className="num">{money(r.ItemTotalValue)}</td></tr>)}
                </Fragment>
              ))}
              <tr><td colSpan={2} style={{ textAlign: 'right' }}><b>Plan / area total</b></td><td className="num"><b>{money(p.total)}</b></td></tr>
            </Fragment>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={2} style={{ textAlign: 'right' }}>Contingency labor</td><td className="num">{money(h.ContingencyLaborTotalValue)}</td></tr>
            <tr><td colSpan={2} style={{ textAlign: 'right' }}><b>Bid total</b></td><td className="num"><b>{money(h.BidTotal)}</b></td></tr>
          </tfoot>
        </table></div>
      )}
    </>
  )
}

function JobHistory({ d }) {
  const j = d.job
  return (
    <>
      <div className="fm-head"><div><h2>Job history log</h2><div className="muted">{j.Customer}{j.CustomerNotes ? ` (${j.CustomerNotes})` : ''} · {j.Job} · {j.JobType || '—'} · Job # {j.JobNumber || '—'}</div>
        <div className="muted small">Spec level {j.SpecLevel || '—'} · Jurisdiction {j.Juris || '—'} · Division {j.DivisionId} · Est {fmtDate(j.EstStartDate) || '—'} – {fmtDate(j.EstEndDate) || '—'} · Units {j.UnitQty ?? '—'} · {j.Status}{j.Notes ? ` · ${j.Notes}` : ''}</div></div>
        <Link className="btn small no-print" to={`/es/job-log?job=${j.PmJobID}`}>Open log</Link></div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Date entered</th><th>User</th><th>Title</th><th>Effective phase</th><th>Effective date</th><th>Type</th><th>Contract #</th><th>Work agree #</th><th>Addendum #</th><th>Executed</th><th>Notes</th></tr></thead>
        <tbody>{d.entries.map((n) => <tr key={n.CmContractID}><td>{fmtDate(n.DateEntered)}</td><td>{n.UserEntered}</td><td className="wrap">{n.Description}</td><td>{n.EffectivePhase}</td><td>{fmtDate(n.EffectiveDate)}</td><td>{n.Type}</td><td>{n.ContractNumber}</td><td>{n.WorkAgreeNum}</td><td>{n.AddendumNumber}</td><td>{yes(n.Executed) ? 'Yes' : ''}</td><td className="wrap">{n.Notes}</td></tr>)}
          {!d.entries.length && <tr><td colSpan={11}><EmptyState title="No log entries" /></td></tr>}</tbody>
      </table></div>
    </>
  )
}

function LowPrices({ d }) {
  return (
    <>
      <div className="fm-head"><div><h2>Low estimating prices – check</h2><div className="muted">Active items only · {d.length} item(s) · Disc: (higher of last cost and average cost) minus estimating price</div></div></div>
      {!d.length ? <EmptyState title="No low estimating prices" /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Class</th><th>Inventory item</th><th className="num">Last cost</th><th className="num">Average cost</th><th className="num">Labor cost</th><th className="num">Estimating price</th><th className="num">Disc</th><th>Last purchase</th><th>Notes</th></tr></thead>
          <tbody>{d.map((r) => <tr key={r.InvItemID}><td>{r.InvClass}</td><td><Link to={`/es/items/${r.InvItemID}`}>{r.InvItem}</Link></td><td className="num">{money4(r.LastCost)}</td><td className="num">{money4(r.AverageCost)}</td><td className="num">{money4(r.LaborCost)}</td><td className="num">{money4(r.EstimatingPrice)}</td><td className={`num${r.Disc > 0 ? ' neg' : ''}`}>{money4(r.Disc)}</td><td>{fmtDate(r.LastPurchase)}</td><td className="wrap">{r.Notes}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  )
}
