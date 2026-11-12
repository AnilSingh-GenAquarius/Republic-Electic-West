// Access report ArWipTimed (rptArTimeWip01..06): lots started between From and To that were still open at To
import { Frame, WipTable, burdenNote, useReport } from './common'
import { TIMED_COLS, TIMED_CSV } from './wipCols'

export default function RptWipTimed({ params }) {
  const state = useReport('ar-wip-timed', params)
  const h = state.data?.header || {}
  return (
    <Frame state={state} title="TWIP - timed work in progress" csv={{ cols: TIMED_CSV, name: 'ar-wip-timed.csv' }} empty="No lots started in this period"
      lines={[`Division ${h.division || ''}${h.customerName ? ` | ${h.customerName}` : ' | all builders'}`,
        h.from ? `Data selected has a start date >= ${h.from} and <= ${h.to}, and a close date > ${h.to} or null` : '', burdenNote(h.burden)]}>
      {(d) => <WipTable rows={d.rows} cols={TIMED_COLS} />}
    </Frame>
  )
}
