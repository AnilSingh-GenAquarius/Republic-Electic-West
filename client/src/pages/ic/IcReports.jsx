// Inventory reports: items to reorder, negative on hand, inventory value, count differences (top 20), material posted to job cost.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { IcTabs, download, int, money, money0, useIcLookups } from './shared'

const TABS = [['reorder', 'Need to order'], ['negative', 'Negative on hand'], ['value', 'Inventory value'], ['top', 'Count differences'], ['posted', 'Material posted']]

export default function IcReports() {
  const lk = useIcLookups()
  const [sp, setSp] = useSearchParams()
  const p = { tab: 'reorder', ...Object.fromEntries(sp.entries()) }
  const [data, setData] = useState(null)
  const [counts, setCounts] = useState([])
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  useEffect(() => { api('/ic/counts').then((d) => { setCounts(d.rows); if (!p.countId && d.rows.length) set({ countId: String(d.rows.find((c) => c.Posted)?.InventoryID || d.rows[0].InventoryID) }) }).catch(() => {}) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  useEffect(() => {
    setData(null); setError('')
    const params = { division: p.division, groupBy: p.groupBy, basis: p.basis, countId: p.countId, from: p.from, to: p.to, classId: p.classId, page: p.page }
    if (p.tab === 'top' && !p.countId) return
    api(`/ic/reports/${p.tab === 'posted' ? 'material-posted' : p.tab}`, { params }).then((d) => setData({ ...d, _t: p.tab })).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])

  const ready = data && data._t === p.tab
  function exportCsv() {
    if (!ready) return
    const cols = { reorder: [['DivisionId', 'Div'], ['InvClass', 'Class'], ['InvItem', 'Item'], ['Description', 'Description'], ['QtyOnHand', 'On hand'], ['QtyReOrder', 'Reorder'], ['QtyOnOrder', 'On order'], ['NeedToOrder', 'Need'], ['Vendor', 'Vendor']],
      negative: [['DivisionId', 'Div'], ['InvItem', 'Item'], ['Description', 'Description'], ['Vendor', 'Vendor'], ['QtyOnHand', 'On hand'], ['QtyReOrder', 'Reorder'], ['QtyOnOrder', 'On order'], ['Value', 'Value']],
      value: [['DivisionId', 'Div'], ['GroupLabel', p.groupBy === 'division' ? 'Division' : 'Class'], ['Items', 'Items'], ['Qty', 'Qty'], ['ValueAverageCost', 'Value (avg)'], ['ValueLastCost', 'Value (last)'], ['ValueJobCost', 'Value (job cost)']],
      top: [['InvItem', 'Item'], ['CurrentQty', 'System'], ['NewQty', 'Counted'], ['DiffQty', 'Diff'], ['Value', 'Value ea'], ['DiffValue', 'Diff value']],
      posted: [['DateEntered', 'Date'], ['DivisionId', 'Div'], ['JobName', 'Job'], ['Lot', 'Lot'], ['InvItem', 'Item'], ['InvClass', 'Class'], ['ExtItemQty', 'Qty'], ['JobCostPrice', 'Price'], ['Value', 'Value']] }[p.tab]
    download(data.rows, cols, `inventory-${p.tab}.csv`)
  }

  return (
    <div className="page">
      <PageHeader title="Inventory reports" subtitle="Reorder, negative stock, value, count differences and material posted to job cost"
        actions={<><button className="btn" onClick={exportCsv} disabled={!ready}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <IcTabs />
      <div className="filters">
        <div className="seg" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={p.tab === k} className={`seg-btn${p.tab === k ? ' active' : ''}`} onClick={() => set({ tab: k })}>{l}</button>)}</div>
        {p.tab !== 'top' && <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {p.tab === 'value' && <div className="seg">{[['class', 'By class'], ['division', 'By division']].map(([k, l]) => <button key={k} className={`seg-btn${(p.groupBy || 'class') === k ? ' active' : ''}`} onClick={() => set({ groupBy: k })}>{l}</button>)}</div>}
        {p.tab === 'top' && <>
          <select value={p.countId || ''} onChange={(e) => set({ countId: e.target.value })} aria-label="Count">{counts.map((c) => <option key={c.InventoryID} value={c.InventoryID}>{fmtDate(c.InvDate)} · {c.DivisionId}{c.Posted ? '' : ' (open)'}</option>)}</select>
          <div className="seg">{[['value', 'By value'], ['qty', 'By quantity']].map(([k, l]) => <button key={k} className={`seg-btn${(p.basis || 'value') === k ? ' active' : ''}`} onClick={() => set({ basis: k })}>{l}</button>)}</div>
        </>}
        {p.tab === 'posted' && <>
          <label className="inline">From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={{ width: 150 }} /></label>
          <label className="inline">To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={{ width: 150 }} /></label>
          <select value={p.classId || ''} onChange={(e) => set({ classId: e.target.value })} aria-label="Class"><option value="">All classes</option>{lk.invClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </>}
      </div>
      {error && <ErrorState message={error} />}
      {!ready ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          {p.tab === 'reorder' && <Table cols={['Div', 'Class', 'Item', 'Description', 'On hand', 'Reorder', 'On order', 'Need', 'Vendor']} nums={[4, 5, 6, 7]} empty="Nothing is below its reorder level."
            rows={data.rows.map((r) => [r.DivisionId, r.InvClass, <Link key="i" to={`/ic/items/${r.InvItemID}`}><b>{r.InvItem}</b></Link>, r.Description, int(r.QtyOnHand), int(r.QtyReOrder), int(r.QtyOnOrder), <b key="n">{int(r.NeedToOrder)}</b>, r.Vendor])} />}
          {p.tab === 'negative' && <Table cols={['Div', 'Item', 'Description', 'Vendor', 'On hand', 'Reorder', 'On order', 'Value']} nums={[4, 5, 6, 7]} empty="No item has negative stock."
            rows={data.rows.map((r) => [r.DivisionId, <Link key="i" to={`/ic/items/${r.InvItemID}`}><b>{r.InvItem}</b></Link>, r.Description, r.Vendor, <span key="q" className="text-danger">{int(r.QtyOnHand)}</span>, int(r.QtyReOrder), int(r.QtyOnOrder), money0(r.Value)])} />}
          {p.tab === 'value' && (
            <>
              <div className="kpis"><StatCard label="Value (average cost)" tone="green" value={money0(data.totals.ValueAverageCost)} foot="On hand × average cost" /><StatCard label="Value (last cost)" value={money0(data.totals.ValueLastCost)} foot="On hand × last cost" /><StatCard label="Value (job cost)" value={money0(data.totals.ValueJobCost)} foot="On hand × job cost price" /></div>
              <Table cols={p.groupBy === 'division' ? ['Division', 'Items', 'Qty', 'Average cost', 'Last cost', 'Job cost'] : ['Div', 'Class', 'Items', 'Qty', 'Average cost', 'Last cost', 'Job cost']} nums={p.groupBy === 'division' ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6]} empty="No stock."
                rows={data.rows.map((r) => (p.groupBy === 'division' ? [<b key="g">{r.GroupLabel}</b>, int(r.Items), int(r.Qty), money0(r.ValueAverageCost), money0(r.ValueLastCost), money0(r.ValueJobCost)] : [r.DivisionId, r.GroupLabel, int(r.Items), int(r.Qty), money0(r.ValueAverageCost), money0(r.ValueLastCost), money0(r.ValueJobCost)]))} />
            </>
          )}
          {p.tab === 'top' && <Table cols={['Item', 'System', 'Counted', 'Diff', 'Value ea', 'Diff value']} nums={[1, 2, 3, 4, 5]} empty="Choose a count with entered quantities."
            rows={data.rows.map((r) => [<b key="i">{r.InvItem}</b>, int(r.CurrentQty), int(r.NewQty), <span key="d" className={r.DiffQty < 0 ? 'text-danger' : ''}>{int(r.DiffQty)}</span>, money(r.Value, 4), money(r.DiffValue)])} />}
          {p.tab === 'posted' && (
            <>
              <div className="kpis"><StatCard label="Lines" tone="blue" value={int(data.total)} foot="Material posted to job cost" /><StatCard label="Value" tone="green" value={money0(data.value)} foot="Quantity × job cost price" /></div>
              <div className="table-wrap" style={{ marginBottom: 12 }}><table className="grid compact"><thead><tr><th>Class</th><th className="num">Lines</th><th className="num">Value</th></tr></thead><tbody>{data.byClass.slice(0, 8).map((c) => <tr key={c.InvClass}><td>{c.InvClass}</td><td className="num">{int(c.Lines)}</td><td className="num">{money0(c.Value)}</td></tr>)}</tbody></table></div>
              <Table cols={['Date', 'Div', 'Job', 'Lot', 'Item', 'Class', 'Qty', 'Price', 'Value']} nums={[6, 7, 8]} empty="Nothing posted in this range."
                rows={data.rows.map((r) => [fmtDate(r.DateEntered), r.DivisionId, r.JobName, `${r.Lot ?? ''}${r.Block ? `/${r.Block}` : ''}`, <b key="i">{r.InvItem}</b>, r.InvClass, int(r.ExtItemQty), money(r.JobCostPrice, 4), money(r.Value)])} />
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => set({ page: pg })} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Table({ cols, rows, nums = [], empty }) {
  return (
    <div className="table-wrap">
      <table className="grid compact">
        <thead><tr>{cols.map((c, i) => <th key={c} className={nums.includes(i) ? 'num' : ''}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={nums.includes(j) ? 'num' : j === 3 && cols[j] === 'Description' ? 'wrap' : ''}>{v}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length}><EmptyState title={empty} /></td></tr>}
        </tbody>
      </table>
    </div>
  )
}
