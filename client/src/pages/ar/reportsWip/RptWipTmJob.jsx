// Access report ArWipTMJob (rptArWipTMJob01..06 + subreport ArWipTMJobSubTMnumber): WIP of one job, flagging lots with a T&M pack
import { Frame, Plain, Sec, WipTable, burdenNote, useReport } from './common'
import { TMJOB_COLS, TMJOB_CSV } from './wipCols'

export default function RptWipTmJob({ params }) {
  const state = useReport('ar-wip-tm-job', params)
  const h = state.data?.header || {}
  return (
    <Frame state={state} title="Work in progress - job with T&M ID" csv={{ cols: TMJOB_CSV, name: 'ar-wip-tm-job.csv' }} empty="No open lots with a contract for this job"
      lines={[`Division ${h.division || ''} | ${h.customerName || ''} | ${h.jobName || ''}`, burdenNote(h.burden)]}>
      {(d) => (
        <>
          <WipTable rows={d.rows} cols={TMJOB_COLS} />
          {d.tmDetail?.length > 0 && (
            <Sec title="Lot TM detail">
              <Plain rows={d.tmDetail} cols={[['LotBlock', 'Lot / block'], ['TmId', 'TM Id'], ['PackName', 'Pack name']]} />
            </Sec>
          )}
        </>
      )}
    </Frame>
  )
}
