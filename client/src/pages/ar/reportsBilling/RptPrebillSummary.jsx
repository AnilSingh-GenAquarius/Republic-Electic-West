import { money } from '../shared'
import { Frame, fd, useReport } from './common'

const COLS = [['Customer', 'Customer'], ['InvDate', 'Date'], ['JobName', 'Job'], ['JobNum', 'Job #'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['PlanNum', 'Plan'], ['BillType', 'Bill type'], ['Terms', 'Terms'], ['Lien', 'Lien'], ['TotalBill', 'Invoice total']]

export default function RptPrebillSummary({ params }) {
  const st = useReport('prebill-summary', { division: params.division, customerId: params.customerId })
  const d = st.data
  return (
    <Frame state={st} filters={[['Division', params.division], ['Customer', d?.header?.customer]]} csv={{ cols: COLS, name: 'prebill-summary.csv' }} empty="No pre-billing snapshot for this division">
      {d?.groups?.map((g) => (
        <div key={g.customer} className="table-wrap">
          <div className="ar-block">{g.customer} - {g.division}</div>
          <table className="grid compact">
            <thead><tr><th>Date</th><th>Job</th><th>Phase</th><th>Lot/block</th><th>Plan</th><th>Bill type</th><th>Terms</th><th className="num">Invoice total</th></tr></thead>
            <tbody>
              {g.rows.map((r, i) => (
                <tr key={i}><td>{fd(r.InvDate)}</td><td>{r.JobName} {r.JobNum ? `(${r.JobNum})` : ''}</td><td>{r.Phase}</td><td>{r.LotBlock}</td><td>{r.PlanNum}</td><td>{r.BillType}</td><td>{r.Terms}</td><td className="num">{money(r.TotalBill)}</td></tr>
              ))}
              <tr className="ar-sum"><td colSpan={7}>Total billing for {g.customer} - {g.division}</td><td className="num">{money(g.total)}</td></tr>
            </tbody>
          </table>
        </div>
      ))}
      {d && <p className="ar-block">Grand total: {money(d.totals.total)}</p>}
    </Frame>
  )
}
