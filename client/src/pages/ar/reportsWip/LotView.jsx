// Detail body shared by the lot (ArWipLot) and T&M (ArWipTM) reports: WIP card, billing, labor and material detail
import { fmtDate } from '../../../format'
import { EmptyState } from '../../../components/ui'
import { money } from '../shared'
import { Plain, Sec, WipTable } from './common'
import { WIP_COLS } from './wipCols'

const pctNum = (v) => (v == null ? '' : `${Number(v)}%`)
const mon = (v) => (v == null ? '' : money(v))

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}

export default function LotView({ data, tm }) {
  const t = data.totals
  const billingByPack = [...groupBy(data.billing, 'PackID').values()]
  const packs = new Map()
  for (const r of data.laborEst) packs.set(r.PackID, r.PackName)
  for (const r of data.laborPaid) if (!packs.has(r.PackId)) packs.set(r.PackId, r.PackName)
  const laborPacks = [...packs.entries()].sort((a, b) => String(a[1] ?? '').localeCompare(String(b[1] ?? '')))
  const estBy = groupBy(data.laborEst, 'PackID')
  const paidBy = groupBy(data.laborPaid, 'PackId')
  const hasAny = data.summary || data.billing.length || data.laborEst.length || data.laborPaid.length || data.materialEst.length || data.materialPosted.length
  if (!hasAny) return <EmptyState title="Nothing found for this selection" />
  return (
    <>
      {data.summary
        ? <div className="arw-sec"><WipTable rows={data.rows} cols={WIP_COLS} /></div>
        : <p className="muted">No contract summary for this selection{tm ? ' (the T&M pack is not on the lot plan)' : ''}.</p>}

      <Sec title="Billing detail">
        {!data.billing.length ? <p className="muted">No packs.</p> : (
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Pack name</th>{!tm && <th>TM #</th>}<th className="num">Qty</th><th className="num">PM contract value ea</th><th className="num">Lot contract value ea</th><th className="num">Ext contract value</th>
              <th>Invoice #</th><th>Invoice date</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Bill %</th><th className="num">Amount billed</th></tr></thead>
            <tbody>
              {billingByPack.flatMap((rows) => rows.map((r, i) => (
                <tr key={`${r.PackID}-${r.BillID ?? 'x'}-${i}`}>
                  <td>{i === 0 ? r.PackName : ''}</td>{!tm && <td>{i === 0 ? r.TmId ?? '' : ''}</td>}
                  <td className="num">{i === 0 ? r.PackQty : ''}</td><td className="num">{i === 0 ? mon(r.PmContractValueEa) : ''}</td><td className="num">{i === 0 ? mon(r.ContractValueEa) : ''}</td><td className="num">{i === 0 ? mon(r.ExtContractVal) : ''}</td>
                  <td>{r.BillID ?? ''}</td><td>{fmtDate(r.Date)}</td><td className="num">{r.Quantity ?? ''}</td><td className="num">{mon(r.ValueEa)}</td><td className="num">{pctNum(r.BillPercent)}</td><td className="num">{mon(r.AmountBilled)}</td>
                </tr>
              )))}
              <tr className="subtotal"><td colSpan={tm ? 3 : 4}><b>Total contract value</b></td><td /><td className="num"><b>{money(t.contract)}</b></td><td colSpan={4} className="num"><b>Total billed value</b></td><td /><td className="num"><b>{money(t.billed)}</b></td></tr>
            </tbody>
          </table></div>
        )}
      </Sec>

      <Sec title="Labor detail">
        {!laborPacks.length ? <p className="muted">No labor estimate or labor paid.</p> : laborPacks.map(([id, name]) => (
          <div key={id} className="arw-two" style={{ marginBottom: 10 }}>
            <div><b>{name}</b>
              <Plain rows={estBy.get(id) || []} cols={[['InvItem', 'Estimate labor concept'], ['Quantity', 'Quantity', 'num'], ['UnitCost', 'Unit cost', 'money'], ['LaborEst', 'Labor estimate', 'money']]} /></div>
            <div><b>&nbsp;</b>
              <Plain rows={paidBy.get(id) || []} cols={[['Item', 'Labor paid concept'], ['ExtItemQty', 'Qty', 'num'], ['PriceEa', 'PriceEa', 'money'], ['PayPercent', 'Pay %', 'num'], ['PayHours', 'Hours', 'num'], ['HourlyRate', 'Hr rate', 'money'], ['LaborPaid', 'Labor paid', 'money'], ['PayrollDate', 'Date', 'date'], ['EmpName', 'Employee']]} /></div>
          </div>
        ))}
        <p><b>Total labor estimate</b> {money(t.laborEst)}{!tm && <> | burden {money(t.laborEstBurden)}</>} &nbsp;&nbsp; <b>Total labor paid</b> {money(t.laborPaid)}{!tm && <> | burden {money(t.laborPaidBurden)}</>}</p>
      </Sec>

      <Sec title="Material detail">
        <div className="arw-two">
          <div><b>Posted (job cost)</b>
            <Plain rows={data.materialPosted} cols={[tm ? ['Posted', 'Posted'] : ['PackId', 'Pack ID'], ['PackType', 'Type'], ['InvItem', 'InvItem'], ['ExtItemQty', 'Qty', 'num'], ['JobCostPrice', 'Unit cost', 'money'], ['MaterialPosted', 'Ext cost', 'money']]}
              total={{ label: 'Total posted (JC) material cost', values: { MaterialPosted: t.materialPosted } }} /></div>
          <div><b>Estimated (PM)</b>
            <Plain rows={data.materialEst} cols={[['PackName', 'Pack'], ['InvItem', 'InvItem'], ['Quantity', 'Qty', 'num'], ['UnitCost', 'Unit cost', 'money'], ['ExtEstCost', 'Ext est cost', 'money']]}
              total={{ label: 'Total estimated (PM) material cost', values: { ExtEstCost: t.materialEst } }} /></div>
        </div>
      </Sec>
    </>
  )
}
