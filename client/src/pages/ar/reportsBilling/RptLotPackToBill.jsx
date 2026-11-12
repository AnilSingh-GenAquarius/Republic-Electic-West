import { Fragment, useState } from 'react'
import { money } from '../shared'
import { Frame, fd, pctText, useReport } from './common'

const COLS = [['CustName', 'Customer'], ['JobName', 'Job'], ['Phase', 'Phase'], ['LotBlock', 'Lot/block'], ['PlanNum', 'Plan'], ['BuilderCode', 'Code'], ['PackName', 'Pack name'], ['PackQty', 'Qty'], ['ContractEa', 'Contract ea'], ['RevContractEa', 'Rev cont ea'], ['ExtVal', 'Ext value'], ['Billing', 'Billing'], ['SumOfPayHours', 'Payroll hours']]

// Pop-up reports of Access: ArLotPackToBillDetailPopUp (payroll in the period) / ArLotPackToBillTotalPopUp (all payroll)
function Payroll({ lotId, params, all }) {
  const st = useReport('lot-pack-to-bill/payroll', { lotId, ...(all ? { all: '1' } : { from: params.from, to: params.to }) })
  if (st.error) return <span>{st.error}</span>
  if (!st.data) return <span>Loading payroll...</span>
  const d = st.data
  return (
    <table className="grid compact">
      <thead><tr><th>Payroll date</th><th>Code</th><th>Pack name</th><th className="num">Hours</th><th>Employee</th><th>Type</th><th>PR notes</th></tr></thead>
      <tbody>
        {d.rows.map((r, i) => <tr key={i}><td>{fd(r.PayrollDate)}</td><td>{r.BuilderCode}</td><td>{r.PackName}</td><td className="num">{r.PayHours}</td><td>{r.EmpName}</td><td>{r.HourType}</td><td>{r.PrNotes}</td></tr>)}
        <tr className="ar-sum"><td colSpan={3}>{d.header.address} - total hours</td><td className="num">{Number(d.totals.hours).toFixed(2)}</td><td colSpan={3} /></tr>
      </tbody>
    </table>
  )
}

export default function RptLotPackToBill({ params }) {
  const st = useReport('lot-pack-to-bill', { division: params.division, from: params.from, to: params.to, customerId: params.customerId })
  const [open, setOpen] = useState(null)
  const d = st.data
  const toggle = (lotId, packId, all) => setOpen((o) => (o && o.packId === packId && o.all === all ? null : { lotId, packId, all }))
  return (
    <Frame state={st} title="Lot-packs ready to bill" filters={[['Division', params.division], ['Customer', d?.header?.customer], ['Payroll between', params.from && params.to ? `${params.from} and ${params.to}` : '']]} csv={{ cols: COLS, name: 'lot-pack-to-bill.csv' }} empty="No payroll was claimed in this period">
      {d?.groups?.map((g) => (
        <div key={g.customer} className="table-wrap">
          <div className="ar-block">{g.customer}</div>
          <table className="grid compact">
            <thead><tr><th>Code</th><th>Lot/block</th><th>Pack name</th><th>Plan</th><th>Phase</th><th className="num">Qty</th><th className="num">Contract ea</th><th className="num">Rev cont ea</th><th className="num">Ext value</th><th className="num">Billing</th><th className="num">Remain %</th></tr></thead>
            <tbody>
              {g.jobs.map((j) => (
                <Fragment key={j.job}>
                  <tr className="ar-grp"><td colSpan={11}>{j.job} {j.jobNum ? `(${j.jobNum})` : ''}</td></tr>
                  {j.rows.map((r) => (
                    <Fragment key={`${r.LotId}-${r.PackID}`}>
                      <tr><td>{r.BuilderCode}</td><td>{r.LotBlock}</td><td>{r.PackName}</td><td>{r.PlanNum}</td><td>{r.Phase}</td><td className="num">{r.PackQty}</td><td className="num">{money(r.ContractEa)}</td><td className="num">{money(r.RevContractEa)}</td><td className="num">{money(r.ExtVal)}</td><td className="num">{money(r.Billing)}</td><td className="num">{pctText(r.ExtVal ? 1 - r.Billing / r.ExtVal : null)}</td></tr>
                      <tr><td /><td colSpan={10}>Payroll hours worked: {r.SumOfPayHours}{r.LastNotes ? ` | ${r.LastNotes}` : ''}{' '}
                        <button className="btn no-print" onClick={() => toggle(r.LotId, r.PackID, false)}>Payroll detail</button>{' '}
                        <button className="btn no-print" onClick={() => toggle(r.LotId, r.PackID, true)}>Payroll total</button></td></tr>
                      {open && open.packId === r.PackID && (
                        <tr className="ar-pop"><td colSpan={11}><Payroll key={`${open.lotId}-${open.all}`} lotId={open.lotId} params={params} all={open.all} /></td></tr>
                      )}
                    </Fragment>
                  ))}
                  <tr className="ar-sum"><td colSpan={8}>Total for {j.job}</td><td className="num">{money(j.extVal)}</td><td className="num">{money(j.billing)}</td><td className="num">{pctText(j.extVal ? 1 - j.billing / j.extVal : null)}</td></tr>
                </Fragment>
              ))}
              <tr className="ar-sum"><td colSpan={8}>Total for {g.customer}</td><td className="num">{money(g.extVal)}</td><td className="num">{money(g.billing)}</td><td className="num">{pctText(g.extVal ? 1 - g.billing / g.extVal : null)}</td></tr>
            </tbody>
          </table>
        </div>
      ))}
      {d && <table className="grid compact"><tbody><tr className="ar-grand"><td>Total for period {params.from} to {params.to}</td><td className="num">{money(d.totals.extVal)}</td><td className="num">{money(d.totals.billing)}</td><td className="num">{pctText(d.totals.remainPct)}</td></tr></tbody></table>}
    </Frame>
  )
}
