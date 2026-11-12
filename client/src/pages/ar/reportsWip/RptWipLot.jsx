// Access report ArWipLot (+ ArWipLotBilling / ArWipLotLabor / ArWipLotMaterial and their sub reports): one lot, with detail
import { fmtDate } from '../../../format'
import { Frame, burdenNote, useReport } from './common'
import LotView from './LotView'

export default function RptWipLot({ params }) {
  const state = useReport('ar-wip-lot', params)
  const h = state.data?.header || {}
  return (
    <Frame state={state} title="Work in progress - lot" isEmpty={() => false}
      lines={[h.CustName ? `WIP - ${h.DivisionId} | ${h.CustName} | ${h.JobName} | lot ${h.Lot ?? ''}/${h.Block ?? ''} | plan ${h.PlanNum ?? ''} | started ${fmtDate(h.StartDate)}` : '', burdenNote(h.burden)]}>
      {(d) => <LotView data={d} tm={false} />}
    </Frame>
  )
}
