// Read-only drill-down pages behind every dashboard figure.
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Boxes, HardHat, Receipt, Wallet, AlertCircle } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, fmtMoney } from '../../format'
import DrillTable, { fmtCell } from '../../components/DrillTable'
import { Badge, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { moduleByCode } from '../../modules'

const back = <Link to="/">Dashboard</Link>
const BackBtn = () => <Link className="btn" to="/"><ArrowLeft size={15} /> Dashboard</Link>
const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))

function DivisionTabs({ value, onChange, options = ['', 'REW', 'REI', 'BAY'] }) {
  return (
    <div className="seg" role="tablist" aria-label="Division">
      {options.map((d) => (
        <button key={d || 'all'} role="tab" aria-selected={value === d} className={`seg-btn${value === d ? ' active' : ''}`} onClick={() => onChange(d)}>
          {d || 'All'}
        </button>
      ))}
    </div>
  )
}
function useParam(name) {
  const [sp, setSp] = useSearchParams()
  const set = (v) => { const n = new URLSearchParams(sp); v ? n.set(name, v) : n.delete(name); n.delete('page'); setSp(n) }
  return [sp.get(name) || '', set]
}

export function OpenLots() {
  const [division, setDivision] = useParam('division')
  return (
    <div className="page">
      <PageHeader crumb={back} title={`Open lots${division ? ` – ${division}` : ''}`} subtitle="Lots in the open-lot register with their job, plan and open stages" actions={<BackBtn />} />
      <DrillTable
        endpoint="/dashboard/drill/open-lots"
        searchPlaceholder="Search job, builder, address, lot or plan…"
        filters={<DivisionTabs value={division} onChange={setDivision} />}
        renderTop={(d) => <p className="muted small" style={{ margin: '0 0 10px' }}>{d.total} open lots</p>}
        rowLink={(r) => `/insights/lots/${r.LotID}`}
        columns={[
          { key: 'DivisionId', label: 'Div', render: (r) => <Badge tone="blue">{r.DivisionId}</Badge> },
          { key: 'JobName', label: 'Job' }, { key: 'CustName', label: 'Builder' }, { key: 'Phase', label: 'Phase' },
          { key: 'Lot', label: 'Lot', render: (r) => `${r.Lot ?? ''}${r.Block ? ` / ${r.Block}` : ''}` },
          { key: 'PlanNum', label: 'Plan' }, { key: 'Address', label: 'Address' },
          { key: 'StartDate', label: 'Start', type: 'date' }, { key: 'Packs', label: 'Packs', type: 'num' },
          { key: 'OpenStages', label: 'Open stages', type: 'num' },
        ]}
      />
    </div>
  )
}

export function LotDetail() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/dashboard/drill/lots/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const l = d?.lot
  return (
    <div className="page">
      <PageHeader crumb={<>{back} / <Link to="/insights/open-lots">Open lots</Link></>}
        title={l ? `${l.JobName} · Lot ${l.Lot}${l.Block ? ` / ${l.Block}` : ''}` : 'Lot'}
        subtitle={l ? [l.CustName, l.Phase && `Phase ${l.Phase}`, l.PlanNum && `Plan ${l.PlanNum}`, l.Address].filter(Boolean).join(' · ') : null}
        actions={<Link className="btn" to="/insights/open-lots"><ArrowLeft size={15} /> Open lots</Link>} />
      {error && <ErrorState message={error} />}
      {!d && !error && <SkeletonRows rows={6} cols={3} />}
      {d && (
        <>
          <div className="kpis">
            <StatCard label="Division" icon={HardHat} value={l.DivisionId || '—'} foot={`Job # ${l.JobNum ?? '—'}`} />
            <StatCard label="Contract" icon={Receipt} tone="green" value={l.RevContract && l.RevContract !== '$0.00' ? l.RevContract : l.Contract || '—'} foot={l.RevContract && l.RevContract !== '$0.00' ? `Original ${l.Contract}` : 'Lot contract value'} />
            <StatCard label="Start date" icon={HardHat} value={fmtDate(l.StartDate) || '—'} foot={l.Permit ? `Permit ${l.Permit}` : 'No permit recorded'} />
            <StatCard label="Stages" icon={AlertCircle} tone="amber" value={d.stages.filter((s) => !s.DatePosted).length} foot={`${d.stages.length} scheduled · not yet posted`} />
          </div>
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head"><h2>Packs ({d.packs.length})</h2></div>
            <table className="grid"><thead><tr><th>Pack</th><th>Type</th><th className="num">Qty</th><th className="num">Posted</th><th className="num">Labor posted</th><th className="num">Contract ea</th><th className="num">Revised ea</th></tr></thead>
              <tbody>{d.packs.map((p) => <tr key={p.PackID}><td>{p.PackName}</td><td>{p.PackType}</td><td className="num">{p.PackQty}</td><td className="num">{p.PostedQty}</td><td className="num">{p.PostedLaborQty}</td><td className="num">{p.ContractEa}</td><td className="num">{p.RevContractEa}</td></tr>)}</tbody></table>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Schedule ({d.stages.length})</h2></div>
            <table className="grid"><thead><tr><th>Stage</th><th>Work type</th><th>Delivery</th><th>Status</th><th>Posted by</th></tr></thead>
              <tbody>{d.stages.map((s) => {
                const overdue = !s.DatePosted && s.DeliveryDate && new Date(s.DeliveryDate) < new Date()
                return <tr key={s.StageAutoID}><td>{s.ScheduleStage}</td><td>{s.WorkType}</td><td>{fmtDate(s.DeliveryDate)}</td>
                  <td>{s.DatePosted ? <Badge tone="green">Posted {fmtDate(s.DatePosted)}</Badge> : overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Scheduled</Badge>}</td>
                  <td>{s.UserPosted || '—'}</td></tr>
              })}</tbody></table>
          </section>
        </>
      )}
    </div>
  )
}

export function InventoryValue() {
  const [division, setDivision] = useParam('division')
  const [sort, setSort] = useParam('sort')
  const [neg, setNeg] = useParam('negative')
  return (
    <div className="page">
      <PageHeader crumb={back} title="Inventory value" subtitle="Quantity on hand × average cost, by item and division" actions={<BackBtn />} />
      <DrillTable
        endpoint="/dashboard/drill/inventory"
        searchPlaceholder="Search item code, description or class…"
        filters={<>
          <DivisionTabs value={division} onChange={setDivision} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="">Highest value</option><option value="qty">Highest quantity</option><option value="item">Item code</option></select>
          <label className="check"><input type="checkbox" checked={neg === '1'} onChange={(e) => setNeg(e.target.checked ? '1' : '')} /> Negative stock only</label>
        </>}
        renderTop={(d) => (
          <div className="kpis">
            <StatCard label="Value of matching items" icon={Boxes} tone="green" value={money0(d.totalValue)} foot={`${d.total.toLocaleString()} item/division records`} />
          </div>
        )}
        columns={[
          { key: 'InvItem', label: 'Item' }, { key: 'Description', label: 'Description' }, { key: 'InvClass', label: 'Class' },
          { key: 'DivisionId', label: 'Div' }, { key: 'Uom', label: 'UOM' },
          { key: 'QtyOnHand', label: 'On hand', type: 'num', render: (r) => <span className={r.QtyOnHand < 0 ? 'text-danger' : ''}>{fmtCell(r.QtyOnHand, 'num')}</span> },
          { key: 'AverageCost', label: 'Avg cost', type: 'money' }, { key: 'Value', label: 'Value', type: 'money' },
        ]}
      />
    </div>
  )
}

export function PayrollPending() {
  return (
    <div className="page">
      <PageHeader crumb={back} title="Payroll pending" subtitle="Hourly entries staged for the next payroll, not yet posted to labor paid" actions={<BackBtn />} />
      <DrillTable
        endpoint="/dashboard/drill/payroll-pending"
        searchPlaceholder="Search employee, job or pack…"
        renderTop={(d) => (
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head"><h2><Wallet size={16} /> Hours by employee</h2><span className="muted small">{d.byEmployee.length} employees</span></div>
            <div className="chips">{d.byEmployee.map((e) => (
              <span key={e.EmpName} className="chip"><b>{e.EmpName}</b> {Number(e.hours).toLocaleString()} h · {e.entries}</span>
            ))}</div>
          </section>
        )}
        columns={[
          { key: 'EmpName', label: 'Employee' }, { key: 'DateWorked', label: 'Worked', type: 'date' }, { key: 'PayrollDate', label: 'Payroll date', type: 'date' },
          { key: 'JobName', label: 'Job' }, { key: 'Phase', label: 'Phase' }, { key: 'PackName', label: 'Pack' }, { key: 'WorkType', label: 'Work type' },
          { key: 'HourType', label: 'Hour type' }, { key: 'PayHours', label: 'Hours', type: 'num' }, { key: 'UserEntered', label: 'Entered by' },
        ]}
      />
    </div>
  )
}

export function Billing() {
  const [sp] = useSearchParams()
  const month = sp.get('month')
  const label = month ? new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'All months'
  return (
    <div className="page">
      <PageHeader crumb={back} title={`Invoices · ${label}`} subtitle="A/R billing by lot. Open an invoice to see its pack and stage lines." actions={<BackBtn />} />
      <DrillTable
        endpoint="/dashboard/drill/billing"
        searchPlaceholder="Search builder, job, lot or bill #…"
        renderTop={(d) => (
          <div className="kpis">
            <StatCard label="Total invoiced" icon={Receipt} tone="green" value={money0(d.totalAmount)} foot={`${d.total} invoices · ${label}`} />
          </div>
        )}
        rowLink={(r) => `/insights/billing/${r.BillID}`}
        columns={[
          { key: 'Date', label: 'Date', type: 'date' }, { key: 'BillID', label: 'Invoice #' }, { key: 'CustName', label: 'Builder' },
          { key: 'JobName', label: 'Job' }, { key: 'LotBlock', label: 'Lot/Blk' }, { key: 'DivisionId', label: 'Div' },
          { key: 'Terms', label: 'Terms' }, { key: 'Amount', label: 'Amount', type: 'money' },
        ]}
      />
    </div>
  )
}

export function BillingDetail() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/dashboard/drill/billing/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const b = d?.bill
  const month = b ? String(b.Date).slice(0, 7) : ''
  return (
    <div className="page">
      <PageHeader crumb={<>{back} / <Link to={`/insights/billing?month=${month}`}>Invoices</Link></>}
        title={b ? `Invoice ${b.BillNum || b.BillID}` : 'Invoice'}
        subtitle={b ? `${b.CustName} · ${b.JobName} · Lot ${b.LotBlock || '—'} · ${fmtDate(b.Date)}` : null}
        actions={<Link className="btn" to={`/insights/billing?month=${month}`}><ArrowLeft size={15} /> Invoices</Link>} />
      {error && <ErrorState message={error} />}
      {!d && !error && <SkeletonRows rows={6} cols={3} />}
      {b && (
        <>
          <div className="kpis">
            <StatCard label="Invoice total" icon={Receipt} tone="green" value={b.BillTotal || '—'} foot={`Terms ${b.Terms || '—'}`} />
            <StatCard label="Bill to" icon={Receipt} value={<span className="stat-text">{b.CustName}</span>} foot={[b.BillAddress, b.BillCity, b.BillState, b.BillZip].filter(Boolean).join(', ') || '—'} />
            <StatCard label="Contact" icon={Receipt} value={<span className="stat-text">{b.CustContact || '—'}</span>} foot={b.DivisionId ? `Division ${b.DivisionId}` : ''} />
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Invoice lines ({d.items.length})</h2></div>
            <table className="grid"><thead><tr><th>Pack</th><th>Stage</th><th>Work type</th><th>Item</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Bill %</th><th className="num">Line total</th></tr></thead>
              <tbody>{d.items.map((i) => <tr key={i.BillItemID}><td>{i.PackName}</td><td>{i.ScheduleStage}</td><td>{i.WorkType}</td><td>{i.ItemCode}</td>
                <td className="num">{fmtCell(i.Quantity, 'num')}</td><td className="num">{fmtCell(i.ValueEa, 'text')}</td><td className="num">{fmtCell(i.BillPercent, 'text')}</td><td className="num">{fmtCell(i.ItemTotal, 'text')}</td></tr>)}
                {!d.items.length && <tr><td colSpan={8} className="muted">No line items recorded for this invoice.</td></tr>}
              </tbody></table>
          </section>
        </>
      )}
    </div>
  )
}

export function PayrollDate() {
  const [sp] = useSearchParams()
  const date = sp.get('date')
  return (
    <div className="page">
      <PageHeader crumb={back} title={`Labor paid · ${date ? fmtDate(date) : ''}`} subtitle="Every labor line posted on this payroll date" actions={<BackBtn />} />
      <DrillTable
        endpoint="/dashboard/drill/payroll-date"
        searchPlaceholder={null}
        renderTop={(d) => {
          const piece = d.byEmployee.reduce((a, e) => a + (e.piece || 0), 0)
          const hours = d.byEmployee.reduce((a, e) => a + (e.hours || 0), 0)
          return (
            <div className="kpis">
              <StatCard label="Piece-rate pay" icon={Wallet} tone="green" value={fmtMoney(piece)} foot="Qty × price × pay %" />
              <StatCard label="Hourly hours" icon={Wallet} value={hours.toLocaleString()} foot="Hours posted on this date" />
              <StatCard label="Employees" icon={Wallet} value={d.byEmployee.length} foot={`${d.total} labor lines`} />
            </div>
          )
        }}
        columns={[
          { key: 'EmpName', label: 'Employee' }, { key: 'JobName', label: 'Job' }, { key: 'Phase', label: 'Phase' },
          { key: 'Lot', label: 'Lot', render: (r) => `${r.Lot ?? ''}${r.Block ? ` / ${r.Block}` : ''}` },
          { key: 'PackName', label: 'Pack' }, { key: 'Item', label: 'Item' }, { key: 'WorkType', label: 'Work type' },
          { key: 'ExtItemQty', label: 'Qty', type: 'num' }, { key: 'PriceEa', label: 'Price', type: 'money' }, { key: 'PayPercent', label: 'Pay %', type: 'num' },
          { key: 'PayHours', label: 'Hours', type: 'num' }, { key: 'PiecePay', label: 'Piece pay', type: 'money' },
        ]}
      />
    </div>
  )
}

// Columns per attention item (keys match the server's ATTENTION map)
const ATTN_COLS = {
  'payroll-hourly': [['EmpName', 'Employee'], ['DateWorked', 'Worked', 'date'], ['PayrollDate', 'Payroll date', 'date'], ['JobName', 'Job'], ['PackName', 'Pack'], ['WorkType', 'Work type'], ['PayHours', 'Hours', 'num'], ['UserEntered', 'Entered by']],
  'payroll-piece': [['DateEntered', 'Payroll date', 'date'], ['EmpName', 'Employee'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Item', 'Item'], ['ScheduleStage', 'Stage'], ['ExtItemQty', 'Qty', 'num'], ['PriceEa', 'Price', 'money'], ['Value', 'Value', 'money'], ['UserEntered', 'By']],
  'stages-overdue': [['DeliveryDate', 'Due', 'date'], ['DaysOverdue', 'Days overdue', 'num'], ['JobName', 'Job'], ['Lot', 'Lot'], ['Address', 'Address'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work type']],
  'inv-counts': [['InvDate', 'Count date', 'date'], ['DivisionId', 'Division'], ['FromDate', 'From', 'date'], ['ToDate', 'To', 'date'], ['Lines', 'Lines', 'num'], ['Notes', 'Notes'], ['UserEntered', 'Entered by']],
  'inv-negative': [['InvItem', 'Item'], ['Description', 'Description'], ['DivisionId', 'Div'], ['QtyOnHand', 'On hand', 'num'], ['AverageCost', 'Avg cost', 'money'], ['Value', 'Value', 'money']],
  'tm-unapproved': [['TmDate', 'Date', 'date'], ['id', 'T&M #'], ['TmName', 'Name'], ['TmCustomerNum', 'Customer #'], ['RequestedBy', 'Requested by'], ['PreparedBy', 'Prepared by'], ['PackTotal', 'Pack total', 'money']],
  'tm-unpaid': [['ApprovedDate', 'Approved', 'date'], ['id', 'T&M #'], ['TmName', 'Name'], ['ApprovedBy', 'Approved by'], ['RequestedBy', 'Requested by'], ['PackTotal', 'Pack total', 'money']],
  'am-renewals': [['RenewalDate', 'Renewal', 'date'], ['AccountNumber', 'Acct #'], ['CustomerName', 'Customer'], ['PhoneNumber', 'Phone'], ['ContractTerms', 'Terms'], ['MonthlyContractValue', 'Monthly']],
}
const ATTN_LINK = {
  'stages-overdue': (r) => `/insights/lots/${r.LotID}`,
  'am-renewals': (r) => `/am/accounts/${r.id}`,
}

export function AttentionDetail() {
  const { key } = useParams()
  const [meta, setMeta] = useState(null)
  const m = meta && moduleByCode[meta.module]
  return (
    <div className="page">
      <PageHeader crumb={back} title={meta?.title || 'Needs attention'} subtitle={m ? `${m.name} · ${meta.total} records` : null} actions={<BackBtn />} />
      <DrillTable
        key={key}
        endpoint={`/dashboard/drill/attention/${key}`}
        renderTop={(d) => { if (!meta || meta.total !== d.total) setTimeout(() => setMeta(d)); return null }}
        rowLink={ATTN_LINK[key]}
        columns={(ATTN_COLS[key] || []).map(([k, label, type]) => ({ key: k, label, type }))}
        emptyTitle="Nothing outstanding"
      />
    </div>
  )
}
