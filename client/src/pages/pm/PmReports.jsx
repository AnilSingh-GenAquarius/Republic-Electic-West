// Plan management reports (Access SwitchPM report buttons). Each report shows only the filters it needs.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardList, Download, FileSearch, FileText, Layers, ListChecks, Printer, Receipt, Ruler, Search, Tag, Zap } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PmCascade, PmTabs, download, int, money, money4, usePmLookups, yes } from './shared'

const REPORTS = [
  { key: 'plan-standard', label: 'Plan standard data', icon: FileText, needs: 'plan', text: 'Standard packs and material of one plan' },
  { key: 'plan-full', label: 'Plan full data', icon: Layers, needs: 'bid', text: 'Every active pack and material line of a bid' },
  { key: 'bid-cost', label: 'Bid cost per bid', icon: Receipt, needs: 'bid', text: 'Standard cost by plan, cost code and work vs contract value' },
  { key: 'bid-cost-current', label: 'Bid cost at current prices', icon: Receipt, needs: 'bid', text: 'Same, priced at today\'s job cost price' },
  { key: 'bid-cost-customer', label: 'Bid cost per customer', icon: Receipt, needs: 'customer', text: 'Every active plan of the customer\'s active jobs' },
  { key: 'plan-cost', label: 'Bid cost per plan', icon: Ruler, needs: 'plan', text: 'Each standard material line of one plan' },
  { key: 'standard-prices', label: 'Customer standard prices', icon: Tag, needs: 'customer', text: 'Plan contract value vs standard pack cost' },
  { key: 'option-prices', label: 'Customer option prices', icon: Tag, needs: 'customer', text: 'Option pack value vs cost (latest bid)' },
  { key: 'job-list', label: 'Job list by division', icon: ListChecks, needs: null, text: 'All production jobs with type, status and spec level' },
  { key: 'active-plans', label: 'Active plans', icon: ClipboardList, needs: 'division', text: 'Active plans of active bids in a division' },
  { key: 'pack-search', label: 'Pack search', icon: Search, needs: 'division', text: 'Find packs by name, builder code or words' },
  { key: 'wire-prices', label: 'Wire price check', icon: Zap, needs: 'division', text: 'Wire in standard packs of the latest bids vs item prices' },
]

export default function PmReports() {
  const lk = usePmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [names, setNames] = useState([])
  const [words, setWords] = useState(p.words || '')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const casc = { customerId: p.customerId, jobId: p.jobId, contractId: p.contractId, planId: p.planId }
  const levels = { plan: 4, bid: 3, customer: 1 }[rep?.needs] || 0
  const ready = rep && (rep.needs === null || (rep.needs === 'plan' && p.planId) || (rep.needs === 'bid' && p.contractId) || (rep.needs === 'customer' && p.customerId) || (rep.needs === 'division' && p.division && (rep.key !== 'pack-search' || p.name || p.code || p.words)))
  useEffect(() => { setNames([]); if (p.report === 'pack-search' && p.division) api('/pm/reports/pack-names', { params: { division: p.division } }).then(setNames).catch(() => {}) }, [p.report, p.division])
  useEffect(() => {
    setData(null); setError('')
    if (!ready) return
    let live = true
    const map = {
      'plan-standard': ['/pm/reports/plan-standard', { planId: p.planId }], 'plan-full': ['/pm/reports/plan-full', { contractId: p.contractId }],
      'bid-cost': ['/pm/reports/bid-cost', { scope: 'bid', customerId: p.customerId, jobId: p.jobId, contractId: p.contractId }],
      'bid-cost-current': ['/pm/reports/bid-cost', { scope: 'bid', price: 'current', customerId: p.customerId, jobId: p.jobId, contractId: p.contractId }],
      'bid-cost-customer': ['/pm/reports/bid-cost', { scope: 'customer', customerId: p.customerId }], 'plan-cost': ['/pm/reports/plan-cost', { planId: p.planId }],
      'standard-prices': ['/pm/reports/standard-prices', { customerId: p.customerId }], 'option-prices': ['/pm/reports/option-prices', { customerId: p.customerId }],
      'job-list': ['/pm/reports/job-list', { division: p.division }], 'active-plans': ['/pm/reports/active-plans', { division: p.division }],
      'pack-search': ['/pm/reports/pack-search', { division: p.division, name: p.name, code: p.code, words: p.words }], 'wire-prices': ['/pm/reports/wire-prices', { division: p.division }],
    }
    const [url, params] = map[rep.key]
    api(url, { params }).then((d) => live && setData({ d, k: rep.key })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const ok = data && data.k === p.report
  return (
    <div className="page">
      <PageHeader title="Plan management reports" subtitle="Pick a report; the filters it needs appear below"
        actions={ok && <><button className="btn" onClick={() => exportCsv(rep.key, data.d)}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <PmTabs />
      <div className="fm-reports no-print">{REPORTS.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => set({ report: r.key })}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}</div>
      {rep && (rep.needs || rep.key === 'job-list') && (
        <div className="card form report-filters no-print"><fieldset>
          {levels > 0 && <PmCascade value={casc} levels={levels} onChange={(v) => set({ customerId: v.customerId, jobId: v.jobId, contractId: v.contractId, planId: v.planId })} />}
          {(rep.needs === 'division' || rep.key === 'job-list') && <label>Division<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value, name: '' })}><option value="">{rep.key === 'job-list' ? 'All' : 'Choose…'}</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          {rep.key === 'pack-search' && <>
            <label>Pack name<select aria-label="Pack name" value={p.name || ''} disabled={!p.division} onChange={(e) => set({ name: e.target.value, code: '', words: '' })}><option value="">—</option>{names.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.n})</option>)}</select></label>
            <label>Builder code<input aria-label="Builder code" value={p.code || ''} onChange={(e) => set({ code: e.target.value, name: '', words: '' })} /></label>
            <label>Words in the name<span className="row" style={{ gap: 6 }}><input aria-label="Words" value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && set({ words, name: '', code: '' })} /><button type="button" className="btn small" onClick={() => set({ words, name: '', code: '' })}><FileSearch size={13} /></button></span></label>
          </>}
        </fieldset></div>
      )}
      {error && <ErrorState message={error} />}
      {!rep ? <EmptyState title="Choose a report" /> : !ready ? <EmptyState title="Complete the filters above" /> : !ok ? <SkeletonRows rows={8} cols={5} /> : <div className="fm-sheet"><Report k={rep.key} d={data.d} label={rep.label} /></div>}
    </div>
  )
}

const COLS = {
  'plan-standard': [['PackName', 'Pack'], ['CostCodeId', 'Code'], ['Stage', 'Stage'], ['WorkType', 'Work'], ['InvItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Qty'], ['UnitCost', 'Unit cost'], ['ExtCost', 'Ext cost']],
  'plan-full': [['PlanNum', 'Plan'], ['PackType', 'Type'], ['PackName', 'Pack'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ['CostCodeId', 'Code'], ['InvItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Qty']],
  'plan-cost': [['PackName', 'Pack'], ['PackQty', 'Pack qty'], ['CostCode', 'Cost code'], ['WorkType', 'Work'], ['InvItem', 'Item'], ['Description', 'Description'], ['Quantity', 'Qty'], ['UnitCost', 'Unit cost'], ['ExtCost', 'Ext cost']],
  'standard-prices': [['Job', 'Job'], ['BidNum', 'Bid'], ['PlanNum', 'Plan'], ['ContractVal', 'Contract'], ['Material', 'Material'], ['Labor', 'Labor'], ['Cost', 'Cost'], ['Profit', 'Profit']],
  'option-prices': [['Job', 'Job'], ['MaxOfBidNum', 'Bid'], ['PlanNum', 'Plan'], ['PackName', 'Pack'], ['ContractVal', 'Value'], ['Material', 'Material'], ['Labor', 'Labor'], ['Cost', 'Cost'], ['Profit', 'Profit']],
  'job-list': [['DivisionId', 'Div'], ['Customer', 'Customer'], ['CustomerStatus', 'Cust status'], ['Job', 'Job'], ['JobNumber', 'Job #'], ['JobType', 'Type'], ['SpecLevel', 'Spec level'], ['JobStatus', 'Status']],
  'active-plans': [['Customer', 'Customer'], ['Job', 'Job'], ['BidNum', 'Bid'], ['PlanNum', 'Plan'], ['PlanName', 'Name'], ['Notes', 'Notes']],
  'pack-search': [['Customer', 'Customer'], ['Job', 'Job'], ['BidNum', 'Bid'], ['PlanNum', 'Plan'], ['PackName', 'Pack'], ['BuilderCode', 'Code']],
  'wire-prices': [['Customer', 'Customer'], ['Job', 'Job'], ['MaxOfBidNum', 'Latest bid'], ['InvItem', 'Item'], ['Description', 'Description'], ['BidPrice', 'Bid price'], ['JobCostPrice', 'Job cost price'], ['LastCost', 'Last cost']],
}
const BC = [['Job', 'Job'], ['BidNum', 'Bid'], ['PlanNum', 'Plan'], ['PlanName', 'Name'], ['SqFt', 'Sq ft'], ['Labor', 'Labor'], ['Material', 'Material'], ['Other', 'Other'], ['Cost', 'Cost'], ['ContractVal', 'Contract'], ['Profit', 'Profit'], ['PerSqFt', 'Cost / sq ft']]
const MONEY = new Set(['UnitCost', 'ExtCost', 'ContractVal', 'Material', 'Labor', 'Cost', 'Profit', 'Other', 'BidPrice', 'JobCostPrice', 'LastCost', 'PerSqFt'])
function exportCsv(k, d) { download(d, k.startsWith('bid-cost') ? BC : COLS[k], `pm-${k}.csv`) }

function Report({ k, d, label }) {
  if (!d.length) return <><h2>{label}</h2><EmptyState title="Nothing to show" /></>
  if (k.startsWith('bid-cost')) {
    const t = d.reduce((a, r) => ({ Labor: a.Labor + r.Labor, Material: a.Material + r.Material, Other: a.Other + r.Other, Cost: a.Cost + r.Cost, ContractVal: a.ContractVal + r.ContractVal }), { Labor: 0, Material: 0, Other: 0, Cost: 0, ContractVal: 0 })
    return (
      <>
        <div className="fm-head"><div><h2>{label}</h2><div className="muted">Standard packs of active plans · {d.length} plan(s)</div></div></div>
        <div className="table-wrap"><table className="grid compact"><thead><tr>{BC.map(([c, l]) => <th key={c} className={MONEY.has(c) || c === 'SqFt' ? 'num' : ''}>{l}</th>)}</tr></thead>
          <tbody>{d.map((r) => <tr key={r.PmPlanID}><td className="wrap">{r.Job}</td><td>{[r.BidNum, r.BidRelease].filter(Boolean).join(' ')}</td><td><b>{r.PlanNum}</b></td><td>{r.PlanName}</td><td className="num">{int(r.SqFt)}</td>
            <td className="num">{money(r.Labor)}</td><td className="num">{money(r.Material)}</td><td className="num">{money(r.Other)}</td><td className="num"><b>{money(r.Cost)}</b></td><td className="num">{money(r.ContractVal)}</td>
            <td className={`num${r.Profit < 0 ? ' neg' : ''}`}><b>{money(r.Profit)}</b></td><td className="num">{r.PerSqFt == null ? '—' : money(r.PerSqFt)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}><b>Total</b></td><td className="num"><b>{money(t.Labor)}</b></td><td className="num"><b>{money(t.Material)}</b></td><td className="num"><b>{money(t.Other)}</b></td><td className="num"><b>{money(t.Cost)}</b></td><td className="num"><b>{money(t.ContractVal)}</b></td><td className="num"><b>{money(t.ContractVal - t.Cost)}</b></td><td /></tr></tfoot></table></div>
      </>
    )
  }
  const cols = COLS[k]
  const sum = (c) => d.reduce((a, r) => a + Number(r[c] || 0), 0)
  const head = d[0]
  const sub = k === 'plan-standard' ? `${head.Customer} · ${head.Job} · Bid ${head.BidNum} · Plan ${head.PlanNum} ${head.PlanName || ''} · ${int(head.SqFt)} sq ft`
    : k === 'plan-full' ? `${head.Customer} · ${head.Job} · Bid ${head.BidNum} (${fmtDate(head.BidDate)})` : `${d.length} row(s)`
  return (
    <>
      <div className="fm-head"><div><h2>{label}</h2><div className="muted">{sub}</div></div></div>
      <div className="table-wrap"><table className="grid compact"><thead><tr>{cols.map(([c, l]) => <th key={c} className={MONEY.has(c) || c === 'Quantity' || c === 'PackQty' ? 'num' : ''}>{l}</th>)}</tr></thead>
        <tbody>{d.slice(0, 2000).map((r, i) => <tr key={i}>{cols.map(([c]) => <td key={c} className={MONEY.has(c) || c === 'Quantity' || c === 'PackQty' ? `num${c === 'Profit' && r[c] < 0 ? ' neg' : ''}` : c === 'Description' || c === 'Job' || c === 'PackName' ? 'wrap' : ''}>
          {c === 'PlanNum' && r.PmContractID ? <Link to={`/pm/bids/${r.PmContractID}?plan=${r.PmPlanID}`}>{r[c]}</Link> : c === 'PackName' && r.PmPackID ? <Link to={`/pm/packs/${r.PmPackID}`}>{r[c]}</Link>
            : MONEY.has(c) ? (c === 'UnitCost' || c === 'BidPrice' || c === 'JobCostPrice' || c === 'LastCost' ? money4(r[c]) : money(r[c])) : typeof r[c] === 'boolean' ? (yes(r[c]) ? 'Yes' : '') : r[c]}</td>)}</tr>)}</tbody>
        {['plan-standard', 'plan-cost', 'standard-prices', 'option-prices'].includes(k) && <tfoot><tr>{cols.map(([c], i) => <td key={c} className="num">{i === 0 ? <b style={{ float: 'left' }}>Total</b> : ['ExtCost', 'Material', 'Labor', 'Cost', 'Profit', 'ContractVal'].includes(c) ? <b>{money(sum(c))}</b> : ''}</td>)}</tr></tfoot>}
      </table></div>
      {d.length > 2000 && <p className="muted small">Showing the first 2,000 of {d.length} rows – use CSV for everything.</p>}
    </>
  )
}
