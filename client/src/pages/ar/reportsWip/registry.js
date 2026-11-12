// WIP family of the SwitchAR report buttons (see arReportsWip.js on the server)
import RptWip from './RptWip'
import RptWipExport from './RptWipExport'
import RptWipTimed from './RptWipTimed'
import RptWipLot from './RptWipLot'
import RptWipTm from './RptWipTm'
import RptWipTmJob from './RptWipTmJob'
import RptSequenceSheet from './RptSequenceSheet'

export const WIP_REPORTS = [
  { key: 'ar-wip', label: 'WIP', access: 'W I P', accessObject: 'ArWip', letters: ['A', 'I', 'L'], required: ['division'], text: 'Work in progress of all open lots of a division: contract, billed, labor and material estimate vs actual, profit', Component: RptWip },
  { key: 'ar-wip-export', label: 'WIP export', access: 'Exp', accessObject: 'extArWip', letters: ['A', 'I', 'L'], required: ['division'], text: 'The WIP rows as an export list (Excel in Access, CSV here)', Component: RptWipExport },
  { key: 'ar-wip-timed', label: 'WIP timed', access: 'W I P timed', accessObject: 'ArWipTimed', letters: ['A', 'E', 'F', 'I', 'L'], required: ['division', 'from', 'to'], text: 'Open lots started between two dates, with standard vs total estimate columns (burden is asked for in Access)', Component: RptWipTimed },
  { key: 'ar-wip-lot', label: 'WIP lot', access: 'W I P lot', accessObject: 'ArWipLot', letters: ['A', 'B', 'C', 'L'], required: ['lotId'], text: 'One lot: WIP card with billing, labor and material detail', Component: RptWipLot },
  { key: 'ar-wip-tm', label: 'WIP T&M', access: 'W I P T&M', accessObject: 'ArWipTM', letters: ['A', 'B', 'M'], required: ['tmId'], text: 'One T&M of a lot: WIP card with billing, labor and material detail', Component: RptWipTm },
  { key: 'ar-wip-tm-job', label: 'WIP job w/TM ID', access: 'W I P job w/TM ID', accessObject: 'ArWipTMJob', letters: ['A', 'B', 'I', 'L'], required: ['division', 'jobId'], text: 'WIP of one job, flagging the lots that carry a T&M pack', Component: RptWipTmJob },
  { key: 'ar-sequence-sheet', label: 'Sequence sheet billing data', access: 'Sequence sheet billing data', accessObject: 'ArCmSequenceSheet', letters: ['A', 'B', 'D'], required: ['phaseId'], text: 'Lots of a phase with packs, value breakdown and lot totals', Component: RptSequenceSheet },
]
