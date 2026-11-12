import { Fragment } from 'react'
import { money } from '../shared'
import { Frame, fd, useReport } from './common'

const COLS = [['PreInvoiceNum', 'Pre-invoice'], ['Customer', 'Customer'], ['InvDate', 'Date'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['PlanNum', 'Plan'], ['BillType', 'Bill type'], ['Terms', 'Terms'], ['ItemCode', 'Item code'], ['PackName', 'Pack name'], ['Quantity', 'Qty'], ['ValueEa', 'Value Ea'], ['BillPercent', 'Bill %'], ['BillValue', 'Bill value'], ['TotalBill', 'Subtotal'], ['Notes', 'Notes']]

export default function RptPrebillDetail({ params }) {
  const st = useReport('prebill-detail', { division: params.division, customerId: params.customerId })
  const d = st.data
  return (
    <Frame state={st} filters={[['Division', params.division], ['Customer', d?.header?.customer]]} csv={{ cols: COLS, name: 'prebill-detail.csv' }} empty="No pre-billing snapshot for this division">
      {d?.groups?.map((g) => (
        <div key={g.customer}>
          <div className="ar-block">{g.customer} - {g.division}</div>
          {g.lots.map((l) => (
            <div key={l.PreInvoiceNum} className="table-wrap">
              <table className="grid compact">
                <thead>
                  <tr className="ar-grp"><td colSpan={4}>{l.JobName} {l.JobNum ? `(${l.JobNum})` : ''} - lot {l.LotBlock} - plan {l.PlanNum}</td><td colSpan={5}>Pre-invoice {l.PreInvoiceNum} | {fd(l.InvDate)} | {l.BillType} | {l.Terms} | {l.Phase}</td></tr>
                  <tr><th>Item code</th><th>Pack name</th><th>Stage</th><th>Work</th><th className="num">Qty</th><th className="num">Value Ea</th><th className="num">Bill %</th><th className="num">Bill value</th><th className="num">Subtotal</th></tr>
                </thead>
                <tbody>
                  {l.lines.map((r) => (
                    <Fragment key={r.PreBillPackID}>
                      <tr><td>{r.ItemCode}</td><td>{r.PackName}</td><td>{r.ScheduleStage}</td><td>{r.WorkType}</td><td className="num">{r.Quantity}</td><td className="num">{money(r.ValueEa)}</td><td className="num">{r.BillPercent}</td><td className="num">{Number(r.BillValue) ? money(r.BillValue) : ''}</td><td className="num">{money(r.TotalBill)}</td></tr>
                      {r.Notes && <tr><td /><td colSpan={8}><i>{r.Notes}</i></td></tr>}
                    </Fragment>
                  ))}
                  <tr className="ar-sum"><td colSpan={8}>Invoice total</td><td className="num">{money(l.total)}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
          <p className="ar-block">Total billing for {g.customer} - {g.division}: {money(g.total)}</p>
        </div>
      ))}
      {d && <p className="ar-block">Grand total: {money(d.totals.total)} ({d.totals.invoices} invoices)</p>}
    </Frame>
  )
}
