import { Fragment } from 'react'
import { Frame, useReport } from './common'

const COLS = [['SuperName', 'Superintendent'], ['CustName', 'Customer'], ['JobName', 'Job'], ['JobNum', 'Job #'], ['LotBlock', 'Lot/block'], ['BuilderCode', 'Code'], ['PackName', 'Pack name'], ['PackQty', 'Qty'], ['PlanNum', 'Plan'], ['BidNum', 'Bid'], ['WorkType', 'Type of work']]

export default function RptBillingBySuper({ params }) {
  const st = useReport('billing-by-super', { date: params.date, division: params.division })
  const d = st.data
  return (
    <Frame state={st} title="Billing by super" filters={[['Division', params.division], ['Payroll week ending', params.date]]} csv={{ cols: COLS, name: 'billing-by-super.csv' }} empty="No standard concepts were claimed for this payroll date">
      {d?.groups?.map((g) => (
        <div key={g.superName} className="table-wrap">
          <div className="ar-block">Superintendent: {g.superName}</div>
          <table className="grid compact">
            <thead><tr><th>Ready</th><th>Code</th><th>Lot/block</th><th>Pack name</th><th className="num">Qty</th><th>Plan</th><th>Bid</th><th>Type of work</th></tr></thead>
            <tbody>
              {g.jobs.map((j) => (
                <Fragment key={j.job}>
                  <tr className="ar-grp"><td colSpan={8}>{j.job} {j.jobNum ? `(${j.jobNum})` : ''} - {j.customer}</td></tr>
                  {j.rows.map((r) => (
                    <tr key={`${r.PackID}-${r.WorkType}`}><td>[ ]</td><td>{r.BuilderCode}</td><td>{r.LotBlock}</td><td>{r.PackName}</td><td className="num">{r.PackQty}</td><td>{r.PlanNum}</td><td>{r.BidNum}</td><td>{r.WorkType}</td></tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="ar-sign">Superintendent {g.superName} signature</div>
        </div>
      ))}
    </Frame>
  )
}
