import { Fragment } from 'react'
import { Frame, fd, useReport } from './common'

const COLS = [['CustName', 'Customer'], ['JobName', 'Job'], ['PlanNum', 'Plan'], ['Phase', 'Phase'], ['BidNum', 'Bid num'], ['BidRelease', 'Bid release'], ['BidName', 'Bid name'], ['BidDate', 'Bid date'], ['LotBlock', 'Lot'], ['StartDate', 'Start'], ['EndDate', 'End']]

export default function RptLotsByPlan({ params }) {
  const st = useReport('lots-by-plan', { jobId: params.jobId, planId: params.planId, customerId: params.customerId })
  const d = st.data
  return (
    <Frame state={st} title="Lots by plan" filters={[['Customer', d?.header?.customer], ['Job', d?.header?.job], ['Plan', d?.header?.plan]]} csv={{ cols: COLS, name: 'lots-by-plan.csv' }} empty="No lots use this plan in this job">
      <div className="table-wrap">
        <table className="grid compact">
          <thead><tr><th>Lot</th><th>Start</th><th>End</th></tr></thead>
          <tbody>
            {d?.groups?.map((g, i) => (
              <Fragment key={i}>
                <tr className="ar-grp"><td colSpan={3}>Phase {g.phase} | Bid {g.bidNum} | Release {g.bidRelease} | {g.bidName} | {fd(g.bidDate)}</td></tr>
                {g.rows.map((r) => <tr key={r.LotID}><td>{r.LotBlock}</td><td>{fd(r.StartDate)}</td><td>{fd(r.EndDate)}</td></tr>)}
              </Fragment>
            ))}
            <tr className="ar-sum"><td colSpan={3}>{d?.totals?.lots} lots</td></tr>
          </tbody>
        </table>
      </div>
    </Frame>
  )
}
