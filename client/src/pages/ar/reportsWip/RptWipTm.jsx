// Access report ArWipTM (+ ArWipTMBilling / ArWipTMLabor / ArWipTMMaterial and their sub reports): one T&M of a lot, with detail
import { fmtDate } from '../../../format'
import { Frame, useReport } from './common'
import LotView from './LotView'

export default function RptWipTm({ params }) {
  const state = useReport('ar-wip-tm', params)
  const h = state.data?.header || {}
  return (
    <Frame state={state} title="Work in progress - T&M" isEmpty={() => false}
      lines={[h.CustName ? `WIP - ${h.DivisionId} | ${h.CustName} | ${h.JobName} | lot ${h.Lot ?? ''}/${h.Block ?? ''} | plan ${h.PlanNum ?? ''} | started ${fmtDate(h.StartDate)} | ${h.tmId}` : '',
        'Profit data is gross and includes sales tax on material (T&M labor has no burden)']}>
      {(d) => <LotView data={d} tm />}
    </Frame>
  )
}
