// "Exp" button beside W I P: Access exports query rptArWip07WipExport to Excel. Here: the same rows on screen plus a CSV button.
import { Frame, Plain, pctText, useReport } from './common'
import { EXPORT_COLS } from './wipCols'

export default function RptWipExport({ params }) {
  const state = useReport('ar-wip-export', params)
  const h = state.data?.header || {}
  const pctCols = EXPORT_COLS.filter((c) => c[2] === 'pct').map((c) => c[0])
  return (
    <Frame state={state} title="WIP export" csv={{ cols: EXPORT_COLS.map(([k, l]) => [k, l]), name: 'ar-wip-export.csv' }} empty="No open lots with a contract for these filters"
      lines={[`Division ${h.division || ''}${h.customerName ? ` | ${h.customerName}` : ' | all builders'}${h.jobName ? ` | ${h.jobName}` : ''}`, `Burden ${Number(h.burden || 0)}%`]}>
      {(d) => <Plain cols={EXPORT_COLS} rows={d.rows.map((r) => { const o = { ...r }; pctCols.forEach((c) => { o[c] = pctText(r[c]) }); return o })} />}
    </Frame>
  )
}
