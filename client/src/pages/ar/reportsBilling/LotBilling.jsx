import { Fragment } from 'react'
import { money } from '../shared'
import { Frame, useReport } from './common'

// Shared body of "Total billing by lot" (ArLotBilling) and its T&M variant (ArLotBillingTM#, extra "T & M #" column).
export default function LotBilling({ routeKey, params, tm, csvName }) {
  const st = useReport(routeKey, { lotId: params.lotId, jobId: params.jobId, customerId: params.customerId })
  const d = st.data
  const cols = [['PackName', 'Pack'], ...(tm ? [['TmId', 'T & M #']] : []), ['PackQty', 'Qty'], ['ContractEa', 'Contract ea'], ['RevContractEa', 'Rev cont ea'], ['ExtContractVal', 'Ext value'], ['invoiced', 'Invoiced']]
  const lead = tm ? 6 : 5 // columns before the invoice block
  return (
    <Frame state={st} filters={[['Customer', d?.header?.customer]]} csv={{ cols, name: csvName }} empty="This lot has no packs">
      {d?.header?.lotNotes && <p className="ar-sub">Lot notes: {d.header.lotNotes}</p>}
      <div className="table-wrap">
        <table className="grid compact">
          <thead><tr><th>Pack</th>{tm && <th>T &amp; M #</th>}<th className="num">Qty</th><th className="num">Contract ea</th><th className="num">Rev cont ea</th><th className="num">Ext value</th><th>Invoice</th><th className="num">Qty</th><th className="num">Value</th><th className="num">Percent</th><th className="num">Item total</th></tr></thead>
          <tbody>
            {d?.rows?.map((r) => (
              <Fragment key={r.PackID}>
                <tr><td><b>{r.PackName}</b></td>{tm && <td>{r.TmId}</td>}<td className="num">{r.PackQty}</td><td className="num">{money(r.ContractEa)}</td><td className="num">{money(r.RevContractEa)}</td><td className="num">{money(r.ExtContractVal)}</td>
                  {r.items[0] ? <><td>{r.items[0].BillID}</td><td className="num">{r.items[0].Quantity}</td><td className="num">{money(r.items[0].ValueEa)}</td><td className="num">{r.items[0].BillPercent}</td><td className="num">{money(r.items[0].ItemTotal)}</td></> : <td colSpan={5} />}</tr>
                {r.items.slice(1).map((i) => <tr key={i.BillItemID}><td colSpan={lead} /><td>{i.BillID}</td><td className="num">{i.Quantity}</td><td className="num">{money(i.ValueEa)}</td><td className="num">{i.BillPercent}</td><td className="num">{money(i.ItemTotal)}</td></tr>)}
              </Fragment>
            ))}
            <tr className="ar-sum"><td colSpan={lead - 1}>Total contract value</td><td className="num">{money(d?.totals?.contract)}</td><td colSpan={4}>Total invoiced value</td><td className="num">{money(d?.totals?.invoiced)}</td></tr>
            <tr className="ar-grand"><td colSpan={lead - 1}>Balance</td><td className="num">{money(d?.totals?.balance)}</td><td colSpan={5} /></tr>
          </tbody>
        </table>
      </div>
    </Frame>
  )
}
