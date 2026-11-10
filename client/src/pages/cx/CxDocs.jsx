// Printable Cox paperwork: material requests (Access CxMatReqSingle / CxMatReqMulti and their reprints, CxMatReqSum,
// CxMatReqCheck) and invoices (CxBillingDate / CxBillingInvNum / CxBillingDateSumm).
import { fmtDate } from '../../format'
import { EmptyState } from '../../components/ui'
import { Link } from 'react-router-dom'
import { groupBy, money, qty } from './shared'

const CO = { name: 'Republic Electric, Inc.', street: '4225 W. Post Road', city: 'Las Vegas, NV 89118', phone: '(702) 643-2688', fax: '(702) 835-0122', email: 'jorge@nvrepublic.com' }
const COX_NOTE = "*Please use the project name listed on the Assessor's page. Please fax completed form to (702) 545-2606 or email to construction.fax@cox.com. For faster processing please write legibly or type your information. This request will be filled within 7 business days upon receipt. Incomplete forms will result in delayed processing. Please contact the Cox Construction Front Desk at (702) 545-1606 for any questions."
const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0)
const brk = (i) => (i ? { breakBefore: 'page', marginTop: 28 } : undefined)

// rows come either from the temp tables (run) or from the reprint queries: normalise the names
const norm = (r) => ({ ...r, job: r.Job ?? r.JobName, lot: r.LotBlock ?? r.Lot, date: r.DateReq ?? r.DateCoxMatReq })

function ReqHead({ title, r }) {
  return (
    <div className="fm-head">
      <div><h2>{title}</h2><div className="muted">Material request date: <b>{fmtDate(r.date)}</b></div></div>
      <dl>
        <div><dt>Company name</dt><dd>{CO.name}</dd></div>
        <div><dt>Project name*</dt><dd>{r.AssessorName}</dd></div>
        <div><dt>Also known as (aka)</dt><dd>{r.job}</dd></div>
        <div><dt>Your e-mail address</dt><dd>{CO.email}</dd></div>
        <div><dt>Phone / fax</dt><dd>{CO.phone} / {CO.fax}</dd></div>
        <div><dt>Planner #</dt><dd>{r.ProjPlanner || ''}</dd></div>
      </dl>
    </div>
  )
}
function ReqFoot() {
  return (
    <>
      <table className="grid compact" style={{ marginTop: 12 }}><tbody>
        <tr><td>Project planner signature</td><td style={{ width: '30%' }} /><td>Date issued</td><td style={{ width: '20%' }} /></tr>
        <tr><td>Project planner # and phone</td><td /><td>Material req. #</td><td /></tr>
        <tr><td>Admin specialist and phone</td><td /><td>Material P.O. #</td><td /></tr>
        <tr><td>Admin specialist email</td><td /><td>Oracle project #</td><td /></tr>
      </tbody></table>
      <p className="muted small">Please note: items in red are required to be completed to process your request.</p>
      <p className="muted small">{COX_NOTE}</p>
      <p className="small"><b>Please call the Cox warehouse to schedule material pick up: (702) 545-1174</b></p>
    </>
  )
}

/** Pre-wire R1 request(s), one per assessor project / job. */
export function SingleRequest({ rows, start = 0 }) {
  return groupBy(rows.map(norm), (r) => `${r.AssessorName}|${r.job}`).map(([k, g], i) => (
    <div key={k} style={brk(i + start)}>
      <ReqHead title="Pre-wire R1 request" r={g[0]} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th className="num">#</th><th>Lot</th><th>Complete address (number and name)</th><th>Permit #</th><th className="num"># of outlets</th></tr></thead>
        <tbody>{g.map((r, n) => <tr key={n}><td className="num">{n + 1}</td><td>{r.lot}</td><td>{r.Address}</td><td>{r.Permit}</td><td className="num">{qty(r.OutletPrewire)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}><b>Total lots per order: {g.length}</b></td><td colSpan={2} className="num"><b>Total outlets per order</b></td><td className="num"><b>{qty(sum(g, 'OutletPrewire'))}</b></td></tr></tfoot>
      </table></div>
      <ReqFoot />
    </div>
  ))
}

/** Pre-wire MDU request(s), one per assessor project / job. */
export function MultiRequest({ rows, start = 0 }) {
  return groupBy(rows.map(norm), (r) => `${r.AssessorName}|${r.job}`).map(([k, g], i) => (
    <div key={k} style={brk(i + start)}>
      <ReqHead title="Pre-wire MDU request" r={g[0]} />
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Lot/Bldg #</th><th>Address</th><th>Plan #</th><th className="num"># of bed rooms</th><th>Permit</th><th className="num"># of home runs</th><th className="num"># of lock boxes</th><th className="num"># of outlets</th><th className="num"># of risers</th></tr></thead>
        <tbody>{g.map((r, n) => <tr key={n}><td>{r.lot}</td><td>{r.Address}</td><td>{r.PlanNum}</td><td className="num">{r.Bedrooms}</td><td>{r.Permit}</td><td className="num">{qty(r.HomeRuns)}</td><td className="num">{qty(r.LockboxPrewire)}</td><td className="num">{qty(r.OutletPrewire)}</td><td className="num">{qty(r.RiserPrewire)}</td></tr>)}</tbody>
      </table></div>
      <div className="fm-head" style={{ marginTop: 12 }}><dl>
        <div><dt>Total units per order</dt><dd>{g.length}</dd></div>
        <div><dt>Total home runs per order</dt><dd>{qty(sum(g, 'HomeRuns'))}</dd></div>
        <div><dt>Total outlets per order</dt><dd>{qty(sum(g, 'OutletPrewire'))}</dd></div>
        <div><dt>Total risers per order</dt><dd>{qty(sum(g, 'RiserPrewire'))}</dd></div>
        <div><dt>Total lock boxes per order</dt><dd>{qty(sum(g, 'LockboxPrewire'))}</dd></div>
        <div><dt>Home runs only</dt><dd>Yes ☐ &nbsp; No ☐</dd></div>
      </dl></div>
      <ReqFoot />
    </div>
  ))
}

/** CxMatReqSum: items requested on a date with the estimated billing. */
export function RequestSummary({ rows, date, breakBefore }) {
  return (
    <div style={breakBefore ? brk(1) : undefined}>
      <div className="fm-head"><div><h2>Cox material requested summary</h2><div className="muted">Date requested: <b>{fmtDate(date || rows[0]?.DateCoxMatReq)}</b></div></div></div>
      {!rows.length ? <EmptyState title="Nothing requested on this date" /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th className="num">Lots</th><th>Item</th><th className="num">Quantity</th><th className="num">Amount ea</th><th className="num">Estimated billing</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.Item + r.BillPrice}><td className="num">{r.Lots}</td><td>{r.Item}</td><td className="num">{qty(r.Quantity)}</td><td className="num">{money(r.BillPrice)}</td><td className="num">{money(r.ExtCost)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{qty(sum(rows, 'Quantity'))}</b></td><td /><td className="num"><b>{money(sum(rows, 'ExtCost'))}</b></td></tr></tfoot>
        </table></div>
      )}
    </div>
  )
}

/** CxMatReqCheck: the material request was stopped. */
export function RequestCheck({ rows }) {
  return (
    <div>
      <div className="fm-head"><div><h2>Active jobs without Cox job data</h2><div className="muted">{fmtDate(new Date().toISOString())} · total unmatched jobs {rows.length}</div></div></div>
      <div className="banner warn">Material request has been stopped! Add the Cox plan data (and job assessor names) to the jobs listed here before running the material request again.</div>
      <div className="table-wrap"><table className="grid compact">
        <thead><tr><th>Customer</th><th>Job – scheduling module</th><th>Sample address</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.CustName + r.JobName}><td>{r.CustName}</td><td>{r.JobId ? <Link to={`/cx/jobs/${r.JobId}`}>{r.JobName}</Link> : r.JobName}</td><td>{r.SampleAddress}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}

/** Full material request paperwork: R1 + MDU forms and the summary. */
export function MaterialRequestDocs({ single = [], multi = [], summary = [], date }) {
  if (!single.length && !multi.length && !summary.length) return <EmptyState title="No material requests for this date" />
  const nSingle = groupBy(single, (r) => `${r.AssessorName}|${r.Job ?? r.JobName}`).length
  return (
    <>
      <SingleRequest rows={single} />
      <MultiRequest rows={multi} start={nSingle} />
      <RequestSummary rows={summary} date={date} breakBefore={single.length + multi.length > 0} />
    </>
  )
}

/** CxBillingDate / CxBillingInvNum: one invoice per Cox invoice number. */
export function Invoices({ rows }) {
  if (!rows.length) return <EmptyState title="No invoice lines – check the lots have an admin specialist, assessor and invoice items" />
  return groupBy(rows, (r) => r.InvoiceNum).map(([k, g], i) => {
    const r = g[0]
    return (
      <div key={k} style={brk(i)}>
        <div className="fm-head">
          <div><h2>{CO.name}</h2><div className="muted">{CO.street}<br />{CO.city}</div></div>
          <dl>
            <div><dt>Invoice #</dt><dd><b>{r.Invoice}</b></dd></div>
            <div><dt>Date</dt><dd>{fmtDate(r.Date)}</dd></div>
            <div><dt>Project</dt><dd>{r.AssessorName}</dd></div>
            <div><dt>Job (our name)</dt><dd>{r.JobName}</dd></div>
            <div><dt>Sub contact</dt><dd>{r.Contact}</dd></div>
            <div><dt>Dept</dt><dd>{r.Dept}</dd></div>
            <div><dt>Project #</dt><dd>{r.OpExAccNum}</dd></div>
            <div><dt>Task #</dt><dd>{r.TaskNum}</dd></div>
            <div><dt>Labor req #</dt><dd>{r.LaborReqNum}</dd></div>
            <div><dt>Labor PO #</dt><dd>{r.LaborPoNum}</dd></div>
            <div><dt>Project planner</dt><dd>{r.ProjPlanName || r.ProjPlanner}</dd></div>
            <div><dt>Admin specialist</dt><dd>{r.AdminSpec}</dd></div>
            <div><dt>Admin spec phone</dt><dd>{r.Phone}</dd></div>
            <div><dt>Admin spec e-mail</dt><dd>{r.Email}</dd></div>
          </dl>
        </div>
        <InvoiceLines rows={g} />
        <p className="muted small">{CO.name} - {CO.street}, {CO.city} - Ph {CO.phone} - Fax {CO.fax}</p>
      </div>
    )
  })
}

function InvoiceLines({ rows }) {
  return (
    <div className="table-wrap"><table className="grid compact">
      <thead><tr><th>Lot</th><th>Address</th><th>Item</th><th className="num">Qty</th><th className="num">Price ea</th><th className="num">Ext price</th></tr></thead>
      <tbody>{rows.map((r, n) => <tr key={n}><td>{r.LotBlock}</td><td>{r.Address}</td><td>{r.Item}</td><td className="num">{qty(r.Quantity)}</td><td className="num">{money(r.PriceEa)}</td><td className="num">{money(r.ExtPrice)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={5}><b>Invoice total</b></td><td className="num"><b>{money(sum(rows, 'ExtPrice'))}</b></td></tr></tfoot>
    </table></div>
  )
}

/** CxBillingDateSumm: invoice run summary. */
export function InvoiceRunSummary({ rows, date }) {
  if (!rows.length) return <EmptyState title="No invoices on this date" />
  return (
    <>
      <div className="fm-head"><div><h2>Invoice run summary</h2><div className="muted">Date {fmtDate(date || rows[0].Date)} · {groupBy(rows, (r) => r.InvoiceNum).length} invoice(s) · {money(sum(rows, 'ExtPrice'))}</div></div></div>
      {groupBy(rows, (r) => r.InvoiceNum).map(([k, g]) => (
        <div key={k} className="fm-lot">
          <h3>{g[0].Invoice} · {g[0].AssessorName} <span className="muted">· {g[0].JobName} · {g[0].JobType} · Req {g[0].LaborReqNum ?? '—'} · PO {g[0].LaborPoNum ?? '—'}</span></h3>
          <InvoiceLines rows={g} />
        </div>
      ))}
    </>
  )
}


