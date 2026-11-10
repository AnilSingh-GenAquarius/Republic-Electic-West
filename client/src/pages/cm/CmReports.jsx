// Contract management reports (Access SwitchCM report buttons). Each report shows only the switchboard filters it used.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardList, Download, FileSignature, FileWarning, History, Layers, ListChecks, Printer, Receipt, Rows3, Tags } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { Cascade, CmTabs, JS_LEVELS, JS_PHASE, PM_LEVELS, download, int, money, useCmLookups, yes } from './shared'

// needs: pm (1 customer, 2 + job, 3 + bid), division, dates, phase (JS customer → job → phase), jsjob (JS customer → job)
const CM = [['Type', 'Type'], ['ContractNumber', 'Contract'], ['WorkAgreeNum', 'Work agreement'], ['AddendumNumber', 'Addendum'], ['Description', 'Description'], ['EffectivePhase', 'Eff. phase'], ['EffectiveDate', 'Eff. date', 'date'], ['Executed', 'Executed', 'bool'], ['Notes', 'Notes']]
const OPT = [['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['ContractVal', 'Pack value', 'money'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ['Value', 'Value', 'money']]
const BID = (r) => `Bid ${[r.BidNum, r.BidRelease].filter(Boolean).join(' ')}${r.BidName ? ` – ${r.BidName}` : ''}${r.BidDate ? ` (${fmtDate(r.BidDate)})` : ''}`
const REPORTS = [
  { key: 'job-history-log', label: 'Job history log', icon: History, pm: 2, text: 'The job with every contract/addendum, newest first', cols: [...CM, ['DateEntered', 'Entered', 'date'], ['UserEntered', 'By']] },
  { key: 'contract-history', label: 'Contract history', icon: History, pm: 2, text: 'Contracts of a job → linked bids → plans', group: (r) => `${r.Type || ''} · contract ${r.ContractNumber || '—'} · WA ${r.WorkAgreeNum || '—'} · addendum ${r.AddendumNumber || '—'}${r.Description ? ` · ${r.Description}` : ''}`,
    cols: [['BidNum', 'Bid'], ['BidName', 'Bid name'], ['BidRelease', 'Release'], ['BidDate', 'Bid date', 'date'], ['PlanNum', 'Plan'], ['PlanName', 'Plan name'], ['SqFt', 'Sq ft', 'num'], ['ContractVal', 'Contract value', 'money']] },
  { key: 'contract-job', label: 'Contract data by job', icon: FileSignature, pm: 2, text: 'Contracts and addenda of one job', cols: CM },
  { key: 'not-executed', label: 'Contracts not executed', icon: FileWarning, text: 'Every contract/addendum not executed yet', group: (r) => `${r.Customer} · ${r.Job} (${r.DivisionId || ''})`, cols: CM },
  { key: 'no-contract-job', label: 'Jobs with no contract', icon: AlertTriangle, text: 'PM jobs without any bid', group: (r) => r.Customer, cols: [['Job', 'Job'], ['DivisionId', 'Division']] },
  { key: 'no-contract-bid', label: 'Bids with no contract', icon: AlertTriangle, text: 'Bids not linked to a CM contract', group: (r) => `${r.Customer} · ${r.Job}`, cols: [['DivisionId', 'Div'], ['BidNum', 'Bid'], ['BidRelease', 'Release'], ['BidName', 'Name'], ['BidDate', 'Bid date', 'date'], ['Status', 'Status']] },
  { key: 'no-contract-val', label: 'Plans w/no contract val', icon: FileWarning, division: true, text: 'Active plans of active jobs with no contract value', group: (r) => `${r.Customer} · ${r.Job} · ${BID(r)}`, cols: [['PlanNum', 'Plan'], ['PlanName', 'Name'], ['SqFt', 'Sq ft', 'num'], ['ContractVal', 'Contract value', 'money']] },
  { key: 'to-do-diary', label: 'To do - diary', icon: CalendarClock, dates: true, text: 'Diary notes due between the dates', group: (r) => `${r.Customer} · ${r.Job} (${r.DivisionId || ''}) · ${r.Type} ${r.ContractNumber || ''} ${r.AddendumNumber || ''}`,
    cols: [['Date', 'Date', 'date'], ['Contact', 'Contact'], ['Notes', 'Notes'], ['DueDate', 'Due', 'date']] },
  { key: 'plan-contract-val', label: 'Plan contract values by pack', icon: Layers, pm: 3, text: 'Standard packs of a bid with their breakdown', group: (r) => `Plan ${r.PlanNum}${r.PlanName ? ` – ${r.PlanName}` : ''} · plan value ${money(r.PlanValue)}`,
    cols: [['PackName', 'Pack'], ['PackValue', 'Pack value', 'money'], ['WorkType', 'Work'], ['ScheduleStage', 'Stage'], ['Value', 'Value', 'money']], sum: ['Value'] },
  { key: 'plan-contract-val-work', label: 'Plan contract values by work', icon: Layers, pm: 3, text: 'Breakdown summed per plan and type of work', group: (r) => `Plan ${r.PlanNum}${r.PlanName ? ` – ${r.PlanName}` : ''} · plan value ${money(r.MaxOfContractVal)}`,
    cols: [['WorkType', 'Work'], ['SumOfValue', 'Value', 'money']], sum: ['SumOfValue'] },
  { key: 'option-contract-val', label: 'Option contract values', icon: Tags, pm: 3, text: 'Option packs of a bid by plan', group: (r) => `Plan ${r.PlanNum}${r.PlanName ? ` – ${r.PlanName}` : ''}`, cols: OPT },
  { key: 'option-contract-val-2', label: 'Option contract values II', icon: Tags, pm: 3, text: 'Option packs by plan and builder code', group: (r) => `Plan ${r.PlanNum}${r.PlanName ? ` – ${r.PlanName}` : ''}`, cols: OPT },
  { key: 'option-contract-val-3', label: 'Option contract values III', icon: Tags, pm: 3, text: 'Option packs by builder code across plans', group: (r) => `${r.BuilderCode || '(no builder code)'}`,
    cols: [['PackName', 'Pack'], ['PlanNum', 'Plan'], ['ContractVal', 'Pack value', 'money'], ['ScheduleStage', 'Stage'], ['WorkType', 'Work'], ['Value', 'Value', 'money']] },
  { key: 'sequence-sheet', label: 'Sequence sheet - billing data', icon: Rows3, phase: true, text: 'Lots of a JS phase with packs and breakdown' },
  { key: 'not-contracted', label: 'Packs not contracted $0.01', icon: Receipt, pm: 1, text: 'Active packs priced at the $0.01 placeholder', group: (r) => `${r.Job} · ${BID(r)}`,
    cols: [['PlanNum', 'Plan'], ['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['ContractVal', 'Value', 'money'], ['Status', 'Status']] },
  { key: 'packs-after-trued-up', label: 'New packs after trued up', icon: ListChecks, division: true, text: 'Packs entered on/after their bid\'s true-up date', group: (r) => `${r.Customer} · ${r.Job} · ${BID(r)} · trued up ${fmtDate(r.TrueUpDate) || '—'}`,
    cols: [['PlanNum', 'Plan'], ['BuilderCode', 'Builder code'], ['PackName', 'Pack'], ['ContractVal', 'Value', 'money'], ['TruedUp', 'T-up', 'bool'], ['DateEntered', 'Entered', 'date']] },
  { key: 'packs-not-trued-up', label: 'Packs not trued up', icon: ListChecks, division: true, dates: true, text: 'Packs not trued up on bids entered between the dates', group: (r) => `${r.Customer} · ${r.Job} · ${BID(r)}`,
    cols: [['PlanNum', 'Plan'], ['BuilderCode', 'Builder code'], ['PackName', 'Pack'], ['ContractVal', 'Value', 'money'], ['TruedUp', 'T-up', 'bool'], ['DateEntered', 'Bid entered', 'date']] },
  { key: 'contract-value-builder', label: 'Contract values by plan', icon: ClipboardList, division: true, pm: 1, text: 'Standard pack values and breakdown of the customer\'s active jobs', group: (r) => `${r.Job}${r.JobNumber ? ` #${r.JobNumber}` : ''} · ${BID(r)}`,
    cols: [['PlanNum', 'Plan'], ['SqFt', 'Sq ft', 'num'], ['PlanValue', 'Plan value', 'money'], ['PackName', 'Pack'], ['ContractVal', 'Pack value', 'money'], ['WorkType', 'Work'], ['ScheduleStage', 'Stage'], ['Value', 'Value', 'money']] },
  { key: 'latest-changes', label: 'Contract latest changes', icon: Printer, division: true, post: true, text: 'Contracts flagged "latest print"; running it clears the flags', group: (r) => `${r.Customer} · ${r.Job} (${r.DivisionId || ''})`,
    cols: [['Type', 'Type'], ['ContractNumber', 'Contract'], ['WorkAgreeNum', 'Work agreement'], ['AddendumNumber', 'Addendum'], ['Description', 'Description'], ['EffectivePhase', 'Eff. phase'], ['EffectiveDate', 'Eff. date', 'date'], ['Notes', 'Notes']] },
  { key: 'option-select', label: 'Options scheduled-lots', icon: Tags, jsjob: true, dates: true, post: true, text: 'Pick options; lots of a JS job that started between the dates', group: (r) => `${r.PackName} · ${r.BuilderCode || ''}`,
    cols: [['LotBlock', 'Lot/Block'], ['Phase', 'Phase'], ['BidNum', 'Bid'], ['PlanNum', 'Plan'], ['StartDate', 'Start', 'date'], ['EndDate', 'End', 'date'], ['PackQty', 'Qty', 'num'], ['ContractEa', 'Contract ea', 'money'], ['RevContractEa', 'Rev ea', 'money'], ['ExtVal', 'Ext value', 'money']], sum: ['ExtVal'] },
]
const SEQ_COLS = [['PackName', 'Pack'], ['BuilderCode', 'Builder code'], ['PackQty', 'Qty', 'num'], ['ContractEa', 'Contract ea', 'money'], ['RevContractEa', 'Rev ea', 'money'], ['ExtVal', 'Ext', 'money'],
  ['WorkType', 'Work'], ['ScheduleStage', 'Stage'], ['DetailContract', 'Contract', 'money'], ['DetailRevContract', 'Revised', 'money'], ['DetailExtVal', 'Ext detail', 'money']]

function ready(rep, p) {
  if (!rep) return false
  if (rep.pm && !p[['customerId', 'jobId', 'contractId'][rep.pm - 1]]) return false
  if (rep.division && !p.division) return false
  if (rep.dates && (!p.from || !p.to)) return false
  if (rep.phase && !p.phaseId) return false
  if (rep.jsjob && !p.jsJobId) return false
  return true
}

export default function CmReports() {
  const lk = useCmLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const rep = REPORTS.find((r) => r.key === p.report)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [names, setNames] = useState(null)
  const [ticked, setTicked] = useState([])
  const set = (patch) => { const n = { ...p, ...patch }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  const ok = ready(rep, p)
  useEffect(() => {
    setData(null); setError(''); setMsg(''); setNames(null); setTicked([])
    if (!ok || rep.post) return
    let live = true
    api(`/cm/reports/${rep.key}`, { params: p }).then((d) => live && setData({ k: rep.key, d })).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  // Options scheduled-lots: list the option names of the job/date range (rptCmOptionSelectAppend) to tick
  useEffect(() => {
    if (!ok || rep.key !== 'option-select') return
    let live = true
    api('/cm/option-names', { params: { jobId: p.jsJobId, from: p.from, to: p.to } }).then((n) => live && setNames(n)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  async function runLatest() {
    if (!confirm('Run "Contract latest changes"?\n\nThe report lists the contracts flagged "latest print" in this division and then CLEARS those flags. If you ran this report by mistake, please save it as a PDF and send it to your contract coordinator.')) return
    setError('')
    try { const r = await api('/cm/reports/latest-changes', { method: 'POST', body: { division: p.division } }); setData({ k: rep.key, d: r.rows }); setMsg(`${int(r.cleared)} "latest print" flag(s) cleared.`) } catch (e) { setError(e.message) }
  }
  async function runOptions() {
    setError('')
    try { const rows = await api('/cm/reports/option-select', { method: 'POST', body: { jobId: p.jsJobId, from: p.from, to: p.to, names: ticked } }); setData({ k: rep.key, d: rows.map((r) => ({ ...r, LotBlock: `${r.Lot ?? ''}/${r.Block ?? ''}` })) }) } catch (e) { setError(e.message) }
  }
  const shown = data && data.k === p.report ? data.d : null
  const rows = shown ? (Array.isArray(shown) ? shown : shown.rows) : null
  const cols = rep?.key === 'sequence-sheet' ? SEQ_COLS : rep?.cols
  return (
    <div className="page">
      <PageHeader title="Contract management reports" subtitle="Pick a report; the filters it needs appear below"
        actions={rows && <><button className="btn" onClick={() => download(rows, cols, `cm-${rep.key}.csv`)}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></>} />
      <CmTabs />
      <div className="fm-reports no-print">{REPORTS.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => set({ report: r.key })}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}</div>
      {rep && (rep.pm || rep.division || rep.dates || rep.phase || rep.jsjob) && (
        <div className="card form report-filters no-print"><fieldset>
          {rep.pm > 0 && <Cascade levels={PM_LEVELS.slice(0, rep.pm)} value={{ customerId: p.customerId, jobId: p.jobId, contractId: p.contractId }} onChange={(v) => set(v)} />}
          {(rep.phase || rep.jsjob) && <Cascade levels={rep.phase ? [...JS_LEVELS, JS_PHASE] : JS_LEVELS} value={{ jsCustomerId: p.jsCustomerId, jsJobId: p.jsJobId, phaseId: p.phaseId }} onChange={(v) => set(v)} />}
          {rep.division && <label>Division<select aria-label="Division" value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">Choose…</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          {rep.dates && <><label>From<input type="date" aria-label="From" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label><label>To<input type="date" aria-label="To" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label></>}
          {rep.key === 'latest-changes' && <div className="row" style={{ alignItems: 'flex-end' }}><button className="btn primary" disabled={!ok} onClick={runLatest}><Printer size={15} /> Run report</button></div>}
        </fieldset></div>
      )}
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}>{msg}</div>}
      {rep?.key === 'option-select' && ok && !rows && (
        <section className="panel no-print">
          <div className="panel-head"><h2>Select options to display</h2>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn small" disabled={!names?.length} onClick={() => setTicked(ticked.length === names.length ? [] : names.map((n) => n.name))}>{names && ticked.length === names.length ? 'Clear all' : 'Tick all'}</button>
              <button className="btn small primary" disabled={!ticked.length} onClick={runOptions}>Display report</button>
            </span></div>
          {!names ? <SkeletonRows rows={5} cols={2} /> : !names.length ? <EmptyState title="No options scheduled on lots started in this date range" /> : (
            <div className="row" style={{ flexWrap: 'wrap', gap: '6px 18px' }}>{names.map((n) => (
              <label key={n.name} className="check"><input type="checkbox" checked={ticked.includes(n.name)} onChange={(e) => setTicked(e.target.checked ? [...ticked, n.name] : ticked.filter((x) => x !== n.name))} /> {n.name} <span className="muted small">({n.n})</span></label>
            ))}</div>
          )}
        </section>
      )}
      {!rep ? <EmptyState title="Choose a report" /> : !ok ? <EmptyState title="Complete the filters above" />
        : rows ? <div className="fm-sheet"><Sheet rep={rep} rows={rows} extra={Array.isArray(shown) ? null : shown} cols={cols} /></div>
          : !rep.post ? <SkeletonRows rows={8} cols={5} /> : rep.key === 'latest-changes' ? <EmptyState title='Press "Run report"' /> : null}
    </div>
  )
}

function cell(v, type) {
  if (v == null || v === '') return type === 'money' ? '—' : ''
  if (type === 'money') return money(v)
  if (type === 'date') return fmtDate(v)
  if (type === 'num') return int(v)
  if (type === 'bool') return yes(v) ? 'Yes' : 'No'
  return v
}

function Table({ rows, cols, group, sum, groupExtra }) {
  const groups = []
  for (const r of rows) {
    const g = group ? group(r) : ''
    if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, rows: [] })
    groups[groups.length - 1].rows.push(r)
  }
  const total = (list, c) => list.reduce((a, r) => a + Number(r[c] || 0), 0)
  const numeric = (t) => t === 'money' || t === 'num'
  return (
    <div className="table-wrap"><table className="grid compact">
      <thead><tr>{cols.map(([c, l, t]) => <th key={c} className={numeric(t) ? 'num' : ''}>{l}</th>)}</tr></thead>
      {groups.map((gr, gi) => (
        <tbody key={gi}>
          {group && <tr className="row-selected"><td colSpan={cols.length}><b>{gr.g}</b>{groupExtra ? groupExtra(gr.rows[0]) : null}</td></tr>}
          {gr.rows.slice(0, 3000).map((r, i) => <tr key={i}>{cols.map(([c, , t]) => <td key={c} className={numeric(t) ? 'num' : c === 'Description' || c === 'Notes' || c === 'PackName' ? 'wrap' : ''}>{cell(r[c], t)}</td>)}</tr>)}
          {sum && group && <tr>{cols.map(([c], i) => <td key={c} className="num">{i === 0 ? <span style={{ float: 'left' }} className="muted">Subtotal</span> : sum.includes(c) ? <b>{money(total(gr.rows, c))}</b> : ''}</td>)}</tr>}
        </tbody>
      ))}
      {sum && <tfoot><tr>{cols.map(([c], i) => <td key={c} className="num">{i === 0 ? <b style={{ float: 'left' }}>Total</b> : sum.includes(c) ? <b>{money(total(rows, c))}</b> : ''}</td>)}</tr></tfoot>}
    </table></div>
  )
}

function Sheet({ rep, rows, extra, cols }) {
  if (!rows.length) return <><h2>{rep.label}</h2><EmptyState title="Nothing to show" /></>
  const h = rows[0]
  if (rep.key === 'job-history-log') {
    const list = rows.filter((r) => r.CmContractID != null)
    return (
      <>
        <div className="fm-head"><div><h2>Job history log</h2><div className="muted">{h.Customer} · {h.Job}</div></div>
          <dl><dt>Type</dt><dd>{h.JobType || '—'}</dd><dt>Job #</dt><dd>{h.JobNumber || '—'}</dd><dt>Spec level</dt><dd>{h.SpecLevel || '—'}</dd><dt>Jurisdiction</dt><dd>{h.Juris}</dd>
            <dt>Division</dt><dd>{h.DivisionId}</dd><dt>Est dates</dt><dd>{fmtDate(h.EstStartDate) || '—'} → {fmtDate(h.EstEndDate) || '—'}</dd><dt>Units</dt><dd>{int(h.UnitQty)}</dd><dt>Status</dt><dd>{h.Status}</dd></dl></div>
        {h.JobNotes && <p className="muted">Job notes: {h.JobNotes}</p>}
        {list.length ? <Table rows={list} cols={cols} /> : <EmptyState title="No contracts entered for this job" />}
      </>
    )
  }
  if (rep.key === 'sequence-sheet') {
    const tot = new Map((extra?.totals || []).map((t) => [t.LotID, t.ExtVal]))
    return (
      <>
        <div className="fm-head"><div><h2>Sequence sheet – billing data</h2><div className="muted">{h.Code} · {h.CustName} · {h.JobName}{h.JobNum ? ` #${h.JobNum}` : ''} · phase {h.Phase} · {BID(h)}</div></div>
          <dl><dt>Supers</dt><dd>{h.Supers}</dd><dt>Phase start</dt><dd>{fmtDate(h.StartDate)}</dd></dl></div>
        <Table rows={rows} cols={cols} group={(r) => `Lot ${r.LotBlock ?? ''} · plan ${r.PlanNum || '—'}${r.Address ? ` · ${r.Address}` : ''}`}
          groupExtra={(r) => <span className="muted"> · lot contract {money(r.LotContract)} · revised {money(r.LotRevContract)} · lot total <b>{money(tot.get(r.LotID))}</b></span>} />
      </>
    )
  }
  const sub = h.Customer && rep.pm ? `${h.Customer}${h.Job ? ` · ${h.Job}` : ''}${rep.pm === 3 ? ` · ${BID(h)}` : ''}` : `${rows.length} row(s)`
  return (
    <>
      <div className="fm-head"><div><h2>{rep.label}</h2><div className="muted">{sub}</div></div></div>
      <Table rows={rows} cols={cols} group={rep.group} sum={rep.sum} />
      {rows.length > 3000 && <p className="muted small">Long report – use CSV for every row.</p>}
      {extra?.links && (
        <section style={{ marginTop: 16 }}>
          <h3>Contracts linked to this bid</h3>
          {extra.links.length ? <Table rows={extra.links} cols={[['ContractNumber', 'Contract'], ['WorkAgreeNum', 'Work agreement'], ['AddendumNumber', 'Addendum'], ['Description', 'Description'], ['EffectivePhase', 'Eff. phase'], ['EffectiveDate', 'Eff. date', 'date'], ['Executed', 'Executed', 'bool'], ['Notes', 'Notes']]} />
            : <p className="muted">No CM contract is linked to this bid. <Link to="/cm/jobs">Link one</Link></p>}
        </section>
      )}
    </>
  )
}
