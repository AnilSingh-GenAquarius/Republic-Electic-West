// Access report ArCmSequenceSheet (+ ArCmSequenceSheetSubTotal): lots of a JS phase with packs and value breakdown
import { fmtDate } from '../../../format'
import { money } from '../shared'
import { Frame, useReport } from './common'

const COLS = [['PackName', 'Pack name'], ['BuilderCode', 'Builder code'], ['PackQty', 'Qty', 'num'], ['ContractEa', 'Value', 'money'], ['RevContractEa', 'Rev value', 'money'], ['ExtVal', 'Ext value', 'money'],
  ['WorkType', 'Work'], ['ScheduleStage', 'Stage'], ['DetailContract', 'Contract', 'money'], ['DetailRevContract', 'Rev', 'money'], ['DetailExtVal', 'Ext', 'money']]
export const SEQ_CSV = [['Code', 'Code'], ['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/Block'], ['PlanNum', 'Plan'], ['Address', 'Address'], ...COLS.map(([k, l]) => [k, l])]
const bid = (r) => `Bid ${[r.BidNum, r.BidRelease].filter(Boolean).join(' ')}${r.BidName ? ` - ${r.BidName}` : ''}${r.BidDate ? ` (${fmtDate(r.BidDate)})` : ''}`

export default function RptSequenceSheet({ params }) {
  const state = useReport('ar-sequence-sheet', params)
  const f = state.data?.rows?.[0]
  return (
    <Frame state={state} title="Sequence sheet - billing data" csv={{ cols: SEQ_CSV, name: 'ar-sequence-sheet.csv' }} empty="No lots in this phase"
      lines={f ? [`Code ${f.Code} | ${f.CustName} | ${f.JobName}${f.JobNum ? ` #${f.JobNum}` : ''} | phase ${f.Phase}`, `Supers ${f.Supers} | phase start ${fmtDate(f.StartDate)} | ${bid(f)}`] : []}>
      {(d) => {
        const tot = new Map(d.totals.map((x) => [x.LotID, x.ExtVal]))
        const lots = []
        for (const r of d.rows) { const last = lots[lots.length - 1]; if (last && last.LotID === r.LotID) last.rows.push(r); else lots.push({ LotID: r.LotID, head: r, rows: [r] }) }
        return (
          <div className="table-wrap"><table className="grid compact">
            <thead><tr>{COLS.map(([k, l, t]) => <th key={k} className={t === 'num' || t === 'money' ? 'num' : ''}>{l}</th>)}</tr></thead>
            {lots.map((lot) => (
              <tbody key={lot.LotID}>
                <tr className="group-row"><td colSpan={COLS.length}><b>Lot {lot.head.LotBlock ?? ''}</b> | plan {lot.head.PlanNum || ''} | {lot.head.Address || ''} | contract {money(lot.head.LotContract)} | rev {money(lot.head.LotRevContract)}</td></tr>
                {lot.rows.map((r, i) => <tr key={i}>{COLS.map(([k, , t]) => <td key={k} className={t === 'num' || t === 'money' ? 'num' : ''}>{t === 'money' ? (r[k] == null ? '' : money(r[k])) : r[k] ?? ''}</td>)}</tr>)}
                <tr className="subtotal"><td colSpan={COLS.length - 1}>Rough billing date ____/____/____ &nbsp; Trim billing date ____/____/____ &nbsp; <b>Lot total</b></td><td className="num"><b>{money(tot.get(lot.LotID))}</b></td></tr>
              </tbody>
            ))}
          </table></div>
        )
      }}
    </Frame>
  )
}
