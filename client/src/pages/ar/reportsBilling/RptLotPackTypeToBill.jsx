import { Fragment } from 'react'
import { money } from '../shared'
import { Frame, fd, useReport } from './common'

const COLS = [['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['BidNum', 'Bid'], ['LotBlock', 'Lot/block'], ['PackName', 'Pack name'], ['PackType', 'Pack type'], ['PackQty', 'Qty'], ['ContractEa', 'Contract ea'], ['RevContractEa', 'Rev cont ea'], ['ExtVal', 'Ext value'], ['FirstDate', 'First date']]

export default function RptLotPackTypeToBill({ params }) {
  const st = useReport('lot-pack-type-to-bill', { division: params.division, from: params.from, to: params.to, packTypeId: params.packTypeId, customerId: params.customerId })
  const d = st.data
  const type = d?.header?.packType || ''
  return (
    <Frame state={st} filters={[['Division', params.division], ['Customer', d?.header?.customer], ['First payroll between', params.from && params.to ? `${params.from} and ${params.to}` : '']]} csv={{ cols: COLS, name: 'lot-pack-type-to-bill.csv' }} empty="No packs of this type were claimed in this period">
      {d?.groups?.map((g) => (
        <div key={g.customer} className="table-wrap">
          <div className="ar-block">{g.customer} - {params.division}</div>
          <table className="grid compact">
            <thead><tr><th>Lot/block</th><th>Pack name</th><th className="num">Qty</th><th className="num">Contract ea</th><th className="num">Rev cont ea</th><th className="num">Ext value</th><th>First date</th><th>Phase</th><th>Bid</th></tr></thead>
            <tbody>
              {g.jobs.map((j) => (
                <Fragment key={j.job}>
                  <tr className="ar-grp"><td colSpan={9}>{j.job}</td></tr>
                  {j.rows.map((r, i) => (
                    <tr key={i}><td>{r.LotBlock}</td><td>{r.PackName}</td><td className="num">{r.PackQty}</td><td className="num">{money(r.ContractEa)}</td><td className="num">{money(r.RevContractEa)}</td><td className="num">{money(r.ExtVal)}</td><td>{fd(r.FirstDate)}</td><td>{r.Phase}</td><td>{r.BidNum}</td></tr>
                  ))}
                </Fragment>
              ))}
              <tr className="ar-sum"><td colSpan={5}>Total {g.customer} {type}</td><td className="num">{money(g.extVal)}</td><td colSpan={3} /></tr>
            </tbody>
          </table>
        </div>
      ))}
      {d && <p className="ar-block">Total {params.division} {type}: {money(d.totals.extVal)}</p>}
    </Frame>
  )
}
