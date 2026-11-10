// Process piece timecard — the web version of the Access PrProcessLot form.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Hammer, Percent, Send, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PayrollDatePicker, PrTabs, money, num, usePayrollDate } from './shared'

export default function PieceTimecard() {
  const [date, setDate] = usePayrollDate()
  const [emp, setEmp] = useState(null)        // { id, name, HourlyRate }
  const [job, setJob] = useState(null)        // { id, name }
  const [lots, setLots] = useState([])
  const [lotId, setLotId] = useState('')
  const [workId, setWorkId] = useState('')
  const [data, setData] = useState(null)      // { lot, lines, workTypes }
  const [edits, setEdits] = useState({})      // packItemId -> { payPercent, payHours, hourlyRate, notes }
  const [xPct, setXPct] = useState('50')
  const [timecard, setTimecard] = useState([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLots([]); setLotId('')
    if (job?.id) api(`/pr/jobs/${job.id}/lots`).then(setLots).catch((e) => setError(e.message))
  }, [job?.id])

  const loadLot = useCallback(() => {
    if (!lotId) { setData(null); return }
    api(`/pr/piece/lot/${lotId}`, { params: { workId } }).then((d) => {
      setData(d)
      if (!workId && d.workTypes.length === 1) setWorkId(String(d.workTypes[0].id))
    }).catch((e) => setError(e.message))
  }, [lotId, workId])
  useEffect(() => { setEdits({}); loadLot() }, [loadLot])

  const loadTimecard = useCallback(() => {
    if (!emp?.id) { setTimecard([]); return }
    api('/pr/timecard', { params: { date, employeeId: emp.id } }).then((d) => setTimecard(d.rows)).catch((e) => setError(e.message))
  }, [emp?.id, date])
  useEffect(loadTimecard, [loadTimecard])

  const lines = data?.lines || []
  const val = (l, k) => edits[l.PackItemID]?.[k] ?? ''
  const setVal = (id, k, v) => setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v } }))
  const setAll = (pct) => setEdits((e) => {
    const n = { ...e }
    lines.forEach((l) => { n[l.PackItemID] = { ...n[l.PackItemID], payPercent: pct } })
    return n
  })
  // Fill each line up to what is still unpaid (100 − paid − pending), like paying out the remainder of a lot
  const setRemaining = () => setEdits((e) => {
    const n = { ...e }
    lines.forEach((l) => { n[l.PackItemID] = { ...n[l.PackItemID], payPercent: String(Math.max(0, 100 - l.PaidPercent - l.PendingPercent)) } })
    return n
  })

  const totals = useMemo(() => lines.reduce((a, l) => {
    const pct = Number(val(l, 'payPercent') || 0), hrs = Number(val(l, 'payHours') || 0), rate = Number(val(l, 'hourlyRate') || 0)
    const pay = Number(l.ExtLaborPrice || 0) * pct / 100 + hrs * rate
    return { labor: a.labor + Number(l.ExtLaborPrice || 0), pay: a.pay + pay, selected: a.selected + (pct > 0 || hrs > 0 ? 1 : 0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { labor: 0, pay: 0, selected: 0 }), [lines, edits])

  async function submit() {
    setError(''); setMsg('')
    if (!emp) return setError('Select an employee')
    const over = lines.filter((l) => Number(val(l, 'payPercent') || 0) + l.PaidPercent + l.PendingPercent > 100.0001)
    if (over.length && !confirm(`${over.length} line(s) will be paid more than 100% in total (including what was already paid or is pending). Submit anyway?`)) return
    setBusy(true)
    try {
      const body = {
        payrollDate: date, employeeId: emp.id, lotId: Number(lotId),
        lines: lines.map((l) => ({ packItemId: l.PackItemID, payPercent: val(l, 'payPercent') || 0, payHours: val(l, 'payHours') || 0, hourlyRate: val(l, 'hourlyRate') || 0, notes: val(l, 'notes') || null })),
      }
      const r = await api('/pr/piece/submit', { method: 'POST', body })
      setMsg(`${r.inserted} line(s) added to ${emp.name}'s timecard for ${fmtDate(date)}.`)
      setEdits({}); loadLot(); loadTimecard()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function removeLine(id) {
    if (!confirm('Remove this line from the timecard?')) return
    await api(`/pr/timecard/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message))
    loadTimecard(); loadLot()
  }

  const tcTotal = timecard.reduce((a, r) => a + Number(r.ExtPay || 0), 0)
  const tcHours = timecard.reduce((a, r) => a + Number(r.PayHours || 0), 0)

  return (
    <div className="page">
      <PageHeader title="Process piece timecard" subtitle="Pay an employee a percentage of the labor on an open lot"
        actions={<PayrollDatePicker date={date} setDate={setDate} />} />
      <PrTabs />

      <section className="card form">
        <fieldset>
          <label>Employee
            <SearchSelect endpoint="/common/employees" value={emp?.id} label={emp?.name} placeholder="Search employee…" onSelect={(r) => setEmp(r)} />
          </label>
          <label>Job
            <SearchSelect endpoint="/pr/jobs" value={job?.id} label={job?.name} placeholder="Search job with open lots…" onSelect={(r) => setJob(r)} />
          </label>
          <label>Lot
            <select value={lotId} onChange={(e) => { setLotId(e.target.value); setWorkId('') }} disabled={!job}>
              <option value="">{job ? `${lots.length} open lots` : 'Pick a job first'}</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.name}{l.laborLines ? '' : ' (no labor lines)'}</option>)}
            </select>
          </label>
          <label>Work type
            <select value={workId} onChange={(e) => setWorkId(e.target.value)} disabled={!data}>
              <option value="">All work types</option>
              {(data?.workTypes || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </fieldset>
        {data?.lot?.LotNotes && <div className="banner" style={{ marginTop: 10 }}>Lot notes: {data.lot.LotNotes}</div>}
      </section>

      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 14 }}><CheckCircle2 size={16} /> {msg}</div>}

      {lotId && !data && <SkeletonRows rows={6} cols={4} />}
      {data && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2><Hammer size={16} /> {data.lot.JobName} · Lot {data.lot.Lot}{data.lot.Block ? `/${data.lot.Block}` : ''} {data.lot.PlanNum && <span className="muted small">· Plan {data.lot.PlanNum}</span>}</h2>
            <div className="row">
              <button className="btn small" onClick={() => setAll('100')}>Set 100%</button>
              <span className="row" style={{ gap: 4 }}>
                <input className="pct-input" value={xPct} onChange={(e) => setXPct(e.target.value)} aria-label="Custom percent" inputMode="decimal" />
                <button className="btn small" onClick={() => setAll(xPct)}><Percent size={13} /> Set {xPct || 'X'}%</button>
              </span>
              <button className="btn small" onClick={setRemaining} title="100% minus what is already paid or pending">Set remaining</button>
              <button className="btn small ghost" onClick={() => setAll('')}>Set 0%</button>
            </div>
          </div>
          {!lines.length ? (
            <EmptyState title="No labor lines">This lot has no labor lines{workId ? ' for this work type' : ''}. Labor lines are created when the stage is posted in Scheduling.</EmptyState>
          ) : (
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr>
                  <th>Pack</th><th>Stage</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Labor $</th>
                  <th className="num">Paid / pending</th><th className="num">Pay %</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Pay</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const pct = Number(val(l, 'payPercent') || 0)
                    const pay = Number(l.ExtLaborPrice || 0) * pct / 100 + Number(val(l, 'payHours') || 0) * Number(val(l, 'hourlyRate') || 0)
                    const used = l.PaidPercent + l.PendingPercent
                    const over = used + pct > 100.0001
                    return (
                      <tr key={l.PackItemID} className={pct > 0 ? 'row-selected' : ''}>
                        <td className="wrap">{l.PackName}</td><td>{l.ScheduleStage}</td>
                        <td className="wrap" title={l.Description}>{l.Item}</td>
                        <td className="num">{num(l.ExtItemQty)}</td><td className="num">{money(l.PriceEa)}</td><td className="num">{money(l.ExtLaborPrice)}</td>
                        <td className="num">
                          {used ? <Badge tone={used >= 100 ? 'green' : 'amber'}>{num(l.PaidPercent, 1)}%{l.PendingPercent ? ` + ${num(l.PendingPercent, 1)}%` : ''}</Badge> : <span className="faint">—</span>}
                        </td>
                        <td className="num"><input className={`pct-input${over ? ' invalid' : ''}`} value={val(l, 'payPercent')} placeholder="0" inputMode="decimal"
                          onChange={(e) => setVal(l.PackItemID, 'payPercent', e.target.value)} aria-label={`Pay % for ${l.Item}`} /></td>
                        <td className="num"><input className="pct-input" value={val(l, 'payHours')} placeholder="0" inputMode="decimal"
                          onChange={(e) => setVal(l.PackItemID, 'payHours', e.target.value)} aria-label="Hours" /></td>
                        <td className="num"><input className="pct-input" value={val(l, 'hourlyRate')} placeholder="0" inputMode="decimal"
                          onChange={(e) => setVal(l.PackItemID, 'hourlyRate', e.target.value)} aria-label="Hourly rate" /></td>
                        <td className="num"><b>{pay ? money(pay) : ''}</b></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot><tr>
                  <td colSpan={5}>{lines.length} lines · {totals.selected} selected</td>
                  <td className="num">{money(totals.labor)}</td><td colSpan={4} /><td className="num"><b>{money(totals.pay)}</b></td>
                </tr></tfoot>
              </table>
            </div>
          )}
          <div className="row form-actions" style={{ justifyContent: 'flex-end' }}>
            <span className="muted small">{emp ? `Adds to ${emp.name}'s timecard for ${fmtDate(date)}` : 'Select an employee to submit'}</span>
            <button className="btn primary" disabled={busy || !emp || !totals.selected} onClick={submit}><Send size={15} /> {busy ? 'Submitting…' : `Submit ${totals.selected || ''} line${totals.selected === 1 ? '' : 's'}`}</button>
          </div>
        </section>
      )}

      {emp && (
        <section className="panel">
          <div className="panel-head">
            <h2>Timecard · {emp.name} · {fmtDate(date)}</h2>
            <span className="muted small">{timecard.length} lines · {num(tcHours)} h · <b>{money(tcTotal)}</b></span>
          </div>
          {!timecard.length ? <EmptyState title="Timecard is empty">Submitted lines for this payroll date appear here.</EmptyState> : (
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Job</th><th>Lot</th><th>Pack</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Pay %</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Pay</th><th /></tr></thead>
                <tbody>{timecard.map((r) => (
                  <tr key={r.TempLaborID} className={r.PackMissing ? 'row-error' : ''}>
                    <td>{r.JobName}</td><td>{r.Lot}{r.Block ? `/${r.Block}` : ''}</td><td className="wrap">{r.PackName}{r.PackMissing ? <Badge tone="red">pack removed</Badge> : null}</td><td className="wrap">{r.Item}</td>
                    <td className="num">{num(r.ExtItemQty)}</td><td className="num">{money(r.PriceEa)}</td><td className="num">{num(r.PayPercent, 1)}</td>
                    <td className="num">{num(r.PayHours)}</td><td className="num">{r.HourlyRate ? money(r.HourlyRate) : ''}</td><td className="num"><b>{money(r.ExtPay)}</b></td>
                    <td className="actions"><button className="btn small ghost danger" onClick={() => removeLine(r.TempLaborID)} aria-label="Remove line"><Trash2 size={13} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
