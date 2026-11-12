// Access report ArWip (rptArWip00..06): work in progress of every open lot of a division
import { Frame, WipTable, burdenNote, useReport } from './common'
import { WIP_COLS, WIP_CSV } from './wipCols'

export default function RptWip({ params }) {
  const state = useReport('ar-wip', params)
  const h = state.data?.header || {}
  return (
    <Frame state={state} title="Work in progress" csv={{ cols: WIP_CSV, name: 'ar-wip.csv' }} empty="No open lots with a contract for these filters"
      lines={[`Division ${h.division || ''}${h.customerName ? ` | ${h.customerName}` : ' | all builders'}${h.jobName ? ` | ${h.jobName}` : ''}`, burdenNote(h.burden)]}>
      {(d) => <WipTable rows={d.rows} cols={WIP_COLS} />}
    </Frame>
  )
}
