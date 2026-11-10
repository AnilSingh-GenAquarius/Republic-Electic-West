// Job cost (Access "Process job cost info" + the MgJc* reports): lots finished in the range, estimate vs PM budget vs actual vs billing.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { MgTabs, download, int, money, money0, pct1, today, useMgLookups, yearAgo } from './shared'

const KEY_LABEL = { DivisionId: 'Div', Customer: 'Builder', Job: 'Job', Phase: 'Phase', Lot: 'Lot', Block: 'Block', PlanNum: 'Plan', SuperName: 'Superintendent', SuperType: 'Type' }
const COLS = [
  ['TotalEstimate', 'Bid estimate', 'es'], ['ContractVal', 'Bid contract', 'es'], ['EsProfitPer', 'Bid profit %', 'es', 'pct'],
  ['PmEstimate', 'PM budget', 'pm'], ['Contract', 'Contract', 'pm'], ['PmProfitPer', 'Budget profit %', 'pm', 'pct'],
  ['JcLabor', 'Labor', 'jc'], ['JcMaterial', 'Material', 'jc'], ['JobCost', 'Job cost', 'jc'], ['Billing', 'Billed', 'jc'], ['GrossProfit', 'Gross profit', 'jc'], ['GrossProfitPer', 'GP %', 'jc', 'pct'],
]

export default function MgJobCost() {
  const lk = useMgLookups()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = { groupBy: 'division-job', from: yearAgo(), to: today(), burden: '25', ...Object.fromEntries(sp.entries()) }
  const [form, setForm] = useState({ from: p.from, to: p.to, burden: p.burden })
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/mg/job-cost', { params: { from: p.from, to: p.to, burden: p.burden, groupBy: p.groupBy, division: p.division, customerId: p.customerId } })
      .then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const t = d?.totals
  const lotLevel = d?.keys.includes('Lot')
  function exportCsv() {
    download(d.rows, [...d.keys.map((k) => [k, KEY_LABEL[k] || k]), ['Lots', 'Lots'], ['EstStdLabor', 'Bid labor'], ['EstStdMaterial', 'Bid material'], ['TotalEstimate', 'Bid estimate'], ['ContractVal', 'Bid contract'], ['EsProfit', 'Bid profit'], ['EsProfitPer', 'Bid profit %'],
      ['PmLabor', 'PM labor'], ['PmMaterial', 'PM material'], ['PmEstimate', 'PM budget'], ['Contract', 'Contract'], ['PmProfit', 'Budget profit'], ['PmProfitPer', 'Budget profit %'],
      ['JcLabor', 'Labor'], ['JcMaterial', 'Material'], ['JobCost', 'Job cost'], ['Billing', 'Billed'], ['GrossProfit', 'Gross profit'], ['GrossProfitPer', 'GP %']], `job-cost-${p.groupBy}-${p.from}-${p.to}.csv`)
  }
  return (
    <div className="page">
      <PageHeader title="Job cost" subtitle={`Lots finished ${p.from} to ${p.to} · labor includes ${p.burden}% burden, taxable material includes division sales tax`}
        actions={<><button className="btn" disabled={!d?.rows.length} onClick={exportCsv}><Download size={15} /> Excel (CSV)</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <MgTabs />
      <form className="card form report-filters no-print" onSubmit={(e) => { e.preventDefault(); set(form) }}>
        <fieldset>
          <label>Finished from *<input type="date" aria-label="From" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
          <label>To *<input type="date" aria-label="To" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
          <label>Labor burden %<input inputMode="decimal" aria-label="Burden" value={form.burden} onChange={(e) => setForm({ ...form, burden: e.target.value })} /></label>
          <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Builder<select value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">All</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary">Process job cost</button></div>
      </form>
      <div className="filters no-print"><div className="seg" role="tablist">{(d?.groups || []).map((g) => <button key={g.id} role="tab" aria-selected={p.groupBy === g.id} className={`seg-btn${p.groupBy === g.id ? ' active' : ''}`} onClick={() => set({ groupBy: g.id })}>{g.label.replace('Job cost ', '')}</button>)}</div></div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={8} cols={6} /> : (
        <>
          <div className="kpis">
            <StatCard label="Lots" tone="blue" value={int(t.Lots)} foot="Finished in the range" />
            <StatCard label="Contract" tone="violet" value={money0(t.Contract)} foot={`PM budget ${money0(t.PmEstimate)}`} />
            <StatCard label="Job cost" tone="amber" value={money0(t.JobCost)} foot={`Labor ${money0(t.JcLabor)} · material ${money0(t.JcMaterial)}`} />
            <StatCard label="Gross profit" tone={t.GrossProfit < 0 ? 'red' : 'green'} value={money0(t.GrossProfit)} foot={`${pct1(t.GrossProfitPer)} of ${money0(t.Billing)} billed`} />
          </div>
          <div className="table-wrap"><table className="grid compact mg-jc">
            <thead>
              <tr className="mg-band"><th colSpan={d.keys.length + 1} /><th colSpan={3}>Bid (estimating)</th><th colSpan={3}>Plan management</th><th colSpan={6}>Actual</th></tr>
              <tr>{d.keys.map((k) => <th key={k}>{KEY_LABEL[k] || k}</th>)}<th className="num">Lots</th>{COLS.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i} className={lotLevel ? 'link-row' : ''} onClick={lotLevel ? () => nav(`/mg/reports?report=lot-detail&lotId=${r.LotId}`) : undefined}>
                  {d.keys.map((k) => <td key={k} className={k === 'Job' || k === 'Customer' ? 'wrap' : ''}>{k === d.keys[0] ? <b>{r[k]}</b> : r[k]}</td>)}
                  <td className="num">{int(r.Lots)}</td>
                  {COLS.map(([k, , , f]) => <td key={k} className={`num${(k === 'GrossProfit' || k === 'GrossProfitPer') && r[k] < 0 ? ' neg' : ''}`}>{f === 'pct' ? pct1(r[k]) : money(r[k])}</td>)}
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={d.keys.length + 1 + COLS.length}><EmptyState title="No lots finished in this range">Job cost covers lots with an end date between From and To.</EmptyState></td></tr>}
            </tbody>
            {d.rows.length > 0 && <tfoot><tr><td colSpan={d.keys.length}><b>Total</b></td><td className="num"><b>{int(t.Lots)}</b></td>{COLS.map(([k, , , f]) => <td key={k} className="num"><b>{f === 'pct' ? pct1(t[k]) : money(t[k])}</b></td>)}</tr></tfoot>}
          </table></div>
          <p className="muted small">Bid columns come from the estimating bid linked to the contract (standard packs). Billed is everything invoiced on these lots; credits subtract.</p>
        </>
      )}
    </div>
  )
}
