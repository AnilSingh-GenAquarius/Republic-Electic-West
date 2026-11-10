// Purchasing reports: back-ordered, received-not-billed, overages, all PO lines, totals by vendor/division/class, price fluctuation.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { PoTabs, download, int, money, money0, usePoLookups } from './shared'

const KINDS = [['backordered', 'Back ordered'], ['not-billed', 'Received, not billed'], ['overages', 'Overages'], ['all', 'All PO lines'], ['by', 'Totals'], ['price', 'Price fluctuation']]

export default function PoReports() {
  const lk = usePoLookups()
  const [sp, setSp] = useSearchParams()
  const y = new Date(); y.setFullYear(y.getFullYear() - 1)
  const p = { kind: 'backordered', groupBy: 'vendor', from: y.toISOString().slice(0, 10), ...Object.fromEntries(sp.entries()) }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => {
    setData(null); setError('')
    const params = { division: p.division, vendorId: p.vendorId, from: p.from, to: p.to, search: p.search, page: p.page, groupBy: p.groupBy, kind: p.kind }
    const url = p.kind === 'by' ? '/po/reports/by' : p.kind === 'price' ? '/po/reports/price-fluctuation' : '/po/reports/lines'
    api(url, { params }).then((d) => setData({ ...d, _k: p.kind })).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const ready = data && data._k === p.kind
  function exportCsv() {
    if (!ready) return
    if (p.kind === 'by') download(data.rows, [['GroupLabel', 'Group'], ['Pos', 'POs'], ['Lines', 'Lines'], ['Value', 'Value']], 'po-totals.csv')
    else if (p.kind === 'price') download(data.rows, [['InvItem', 'Item'], ['Description', 'Description'], ['Lines', 'Lines'], ['MinCost', 'Min'], ['MaxCost', 'Max'], ['AvgCost', 'Average'], ['SpreadPct', 'Spread %']], 'po-price-fluctuation.csv')
    else download(data.rows, [['PoNum', 'PO #'], ['PoDate', 'Date'], ['Vendor', 'Vendor'], ['DivisionId', 'Div'], ['InvItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Ordered'], ['Received', 'Received'], ['Billed', 'Billed'], ['Cost', 'Cost'], ['ExtCost', 'Ext cost']], `po-${p.kind}.csv`)
  }
  return (
    <div className="page">
      <PageHeader title="Purchasing reports" subtitle="Back orders, billing gaps, overages, totals and price changes"
        actions={<><button className="btn" onClick={exportCsv} disabled={!ready}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <PoTabs />
      <div className="card form report-filters"><fieldset>
        <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Vendor<SearchSelect endpoint="/common/vendors" value={p.vendorId} label={p.vendorName} placeholder="Any vendor" onSelect={(r) => set({ vendorId: r?.id, vendorName: r?.name })} /></label>
      </fieldset></div>
      <div className="filters">
        <div className="seg" role="tablist">{KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={p.kind === k} className={`seg-btn${p.kind === k ? ' active' : ''}`} onClick={() => set({ kind: k })}>{l}</button>)}</div>
        {p.kind === 'by' && <div className="seg">{[['vendor', 'By vendor'], ['division', 'By division'], ['class', 'By class']].map(([k, l]) => <button key={k} className={`seg-btn${p.groupBy === k ? ' active' : ''}`} onClick={() => set({ groupBy: k })}>{l}</button>)}</div>}
      </div>
      {error && <ErrorState message={error} />}
      {!ready ? <SkeletonRows rows={8} cols={4} /> : p.kind === 'by' ? (
        <>
          <div className="kpis"><StatCard label="Purchase orders" tone="blue" value={int(data.totals.Pos)} foot="In the range" /><StatCard label="Value" tone="green" value={money0(data.totals.Value)} foot="Quantity × cost" /></div>
          <div className="table-wrap"><table className="grid compact"><thead><tr><th>{p.groupBy === 'vendor' ? 'Vendor' : p.groupBy === 'division' ? 'Division' : 'Class'}</th><th className="num">POs</th><th className="num">Lines</th><th className="num">Value</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.GroupLabel}><td><b>{r.GroupLabel}</b></td><td className="num">{int(r.Pos)}</td><td className="num">{int(r.Lines)}</td><td className="num">{money0(r.Value)}</td></tr>)}{!data.rows.length && <tr><td colSpan={4}><EmptyState title="Nothing in this range" /></td></tr>}</tbody></table></div>
        </>
      ) : p.kind === 'price' ? (
        <div className="table-wrap"><table className="grid compact"><thead><tr><th>Item</th><th>Description</th><th>Class</th><th className="num">PO lines</th><th className="num">Lowest</th><th className="num">Highest</th><th className="num">Average</th><th className="num">Spread</th></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.InvItemID}><td><Link to={`/ic/items/${r.InvItemID}`}><b>{r.InvItem}</b></Link></td><td className="wrap">{r.Description}</td><td>{r.InvClass}</td><td className="num">{int(r.Lines)}</td><td className="num">{money(r.MinCost, 4)}</td><td className="num">{money(r.MaxCost, 4)}</td><td className="num">{money(r.AvgCost, 4)}</td><td className="num"><b>{r.SpreadPct == null ? '' : `${Number(r.SpreadPct).toFixed(1)}%`}</b></td></tr>)}
            {!data.rows.length && <tr><td colSpan={8}><EmptyState title="No item changed price in this range" /></td></tr>}</tbody></table></div>
      ) : (
        <>
          <div className="kpis"><StatCard label="Lines" tone="blue" value={int(data.total)} foot={KINDS.find(([k]) => k === p.kind)[1]} /><StatCard label="Ordered value" tone="green" value={money0(data.value)} foot="Quantity × cost" /></div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>PO #</th><th>Date</th><th>Vendor</th><th>Div</th><th>Item</th><th>Description</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Billed</th><th className="num">{p.kind === 'backordered' ? 'Back ordered' : p.kind === 'not-billed' ? 'Not billed' : p.kind === 'overages' ? 'Overage' : 'Cost'}</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={`${r.PoNum}-${r.InvItemID}`}>
              <td><Link to={`/po/orders/${r.PoNum}`}><b>{r.PoNum}</b></Link></td><td>{fmtDate(r.PoDate)}</td><td className="wrap">{r.Vendor}</td><td>{r.DivisionId}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td>
              <td className="num">{int(r.Quantity)}</td><td className="num">{int(r.Received)}</td><td className="num">{int(r.Billed)}</td>
              <td className="num">{p.kind === 'backordered' ? int(r.BackOrdered) : p.kind === 'not-billed' ? int(r.NotBilled) : p.kind === 'overages' ? int(r.Overage) : money(r.Cost, 4)}</td></tr>)}
              {!data.rows.length && <tr><td colSpan={10}><EmptyState title="Nothing to list" /></td></tr>}</tbody></table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}
