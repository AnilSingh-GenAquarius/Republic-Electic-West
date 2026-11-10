// Process hourly timecard — the web version of the Access PrProcessHourly form (macro PrSubmitHourly).
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Plus, Trash2, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { SearchSelect } from '../../components/Pickers'
import { EmptyState, ErrorState, PageHeader } from '../../components/ui'
import { PayrollDatePicker, PrTabs, money, num, usePayrollDate, usePrLookups } from './shared'

const BLANK = { lotId: '', packId: '', scheduleStageId: '', workId: '', hourTypeId: '1', payTypeId: '', hours: '', hourlyRate: '', dateWorked: '', notes: '' }

export default function HourlyTimecard() {
  const [date, setDate] = usePayrollDate()
  const lk = usePrLookups()
  const [emp, setEmp] = useState(null)
  const [job, setJob] = useState(null)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [lots, setLots] = useState([])
  const [packs, setPacks] = useState([])
  const [f, setF] = useState(BLANK)
  const [list, setList] = useState({ rows: [], byEmployee: [] })
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  // Employee defaults: hourly rate, pay type, default stage (PrEmployee)
  useEffect(() => {
    if (!emp) return
    setF((s) => ({
      ...s,
      hourlyRate: emp.HourlyRate ?? s.hourlyRate,
      payTypeId: emp.PayTypeId ? String(emp.PayTypeId) : s.payTypeId,
      scheduleStageId: emp.DefaultScheduleStageId ? String(emp.DefaultScheduleStageId) : s.scheduleStageId,
    }))
  }, [emp])

  useEffect(() => {
    setLots([]); set('lotId', '')
    if (job?.id) api(`/pr/jobs/${job.id}/lots`, { params: { all: includeClosed ? 1 : undefined } }).then(setLots).catch((e) => setError(e.message))
  }, [job?.id, includeClosed])
  useEffect(() => {
    setPacks([]); set('packId', '')
    if (f.lotId) api(`/common/lots/${f.lotId}/packs`).then(setPacks).catch((e) => setError(e.message))
  }, [f.lotId])

  const load = useCallback(() => {
    api('/pr/hourly', { params: { date, employeeId: showAll ? undefined : emp?.id } }).then(setList).catch((e) => setError(e.message))
  }, [date, emp?.id, showAll])
  useEffect(load, [load])

  const mult = Number(lk.hourTypes.find((h) => String(h.id) === String(f.hourTypeId))?.HourlyRateMultiplier || 1)
  const preview = Number(f.hours || 0) * Number(f.hourlyRate || 0) * mult

  async function add(keep) {
    setError(''); setMsg('')
    if (!emp) return setError('Select an employee')
    setBusy(true)
    try {
      await api('/pr/hourly', { method: 'POST', body: { ...f, payrollDate: date, employeeId: emp.id } })
      setMsg(`Added ${f.hours} h for ${emp.name}.`)
      // "Add & keep" keeps job/lot/pack for the next day's entry (Access PrNSubmitHourlyKeep); "Add" clears like PrSubmitHourly
      setF((s) => keep ? { ...s, hours: '', dateWorked: '', notes: '' } : { ...BLANK, hourlyRate: s.hourlyRate, payTypeId: s.payTypeId, scheduleStageId: s.scheduleStageId })
      if (!keep) setJob(null)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('Delete this hourly entry?')) return
    await api(`/pr/hourly/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message))
    load()
  }

  const total = list.rows.reduce((a, r) => ({ h: a.h + Number(r.PayHours || 0), amt: a.amt + Number(r.Amount || 0) }), { h: 0, amt: 0 })

  return (
    <div className="page">
      <PageHeader title="Process hourly timecard" subtitle="Hours by job, lot and pack — appended to the piece timecard before posting"
        actions={<PayrollDatePicker date={date} setDate={setDate} />} />
      <PrTabs />

      <form className="card form" onSubmit={(e) => { e.preventDefault(); add(false) }}>
        <fieldset>
          <legend>Employee</legend>
          <label className="span2">Employee *
            <SearchSelect endpoint="/common/employees" value={emp?.id} label={emp?.name} placeholder="Search employee…" onSelect={setEmp} />
          </label>
          <label>Date worked<input type="date" value={f.dateWorked} onChange={(e) => set('dateWorked', e.target.value)} /></label>
        </fieldset>
        <fieldset>
          <legend>Where</legend>
          <label className="span2">Job *
            <SearchSelect endpoint="/pr/jobs" params={{ all: includeClosed ? 1 : undefined }} value={job?.id} label={job?.name} placeholder="Search job…" onSelect={setJob} />
          </label>
          <label>Lot *
            <select value={f.lotId} onChange={(e) => set('lotId', e.target.value)} disabled={!job}>
              <option value="">{job ? `${lots.length} lots` : 'Pick a job first'}</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>Pack *
            <select value={f.packId} onChange={(e) => set('packId', e.target.value)} disabled={!f.lotId}>
              <option value="" />
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed lots</label>
        </fieldset>
        <fieldset>
          <legend>Hours</legend>
          <label>Stage
            <select value={f.scheduleStageId} onChange={(e) => set('scheduleStageId', e.target.value)}>
              <option value="" />{lk.scheduleStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Work type *
            <select value={f.workId} onChange={(e) => set('workId', e.target.value)} required>
              <option value="" />{lk.workTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Hour type *
            <select value={f.hourTypeId} onChange={(e) => set('hourTypeId', e.target.value)}>
              {lk.hourTypes.map((s) => <option key={s.id} value={s.id}>{s.name} (×{Number(s.HourlyRateMultiplier)})</option>)}
            </select>
          </label>
          <label>Pay type
            <select value={f.payTypeId} onChange={(e) => set('payTypeId', e.target.value)}>
              <option value="" />{lk.payTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Hours *<input inputMode="decimal" value={f.hours} onChange={(e) => set('hours', e.target.value)} placeholder="0.00" /></label>
          <label>Base hourly rate<input inputMode="decimal" value={f.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} placeholder="0.00" /></label>
          <label className="span2">Notes<input value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={255} /></label>
        </fieldset>
        {error && <ErrorState message={error} />}
        {msg && <div className="success-state"><CheckCircle2 size={16} /> {msg}</div>}
        <div className="row form-actions">
          <button className="btn primary" disabled={busy}><Plus size={15} /> Add entry</button>
          <button type="button" className="btn" disabled={busy} onClick={() => add(true)} title="Keep job, lot and pack for the next entry">Add &amp; keep job</button>
          <span className="muted small">
            {preview ? <>Pay preview: {num(f.hours)} h × {money(f.hourlyRate)}{mult !== 1 ? ` × ${mult}` : ''} = <b>{money(preview)}</b></> : 'Rate is stored × the hour-type multiplier, as in Access.'}
          </span>
        </div>
      </form>

      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head">
            <h2><Clock3 size={16} /> Hourly entries · {fmtDate(date)}</h2>
            <div className="row">
              <span className="muted small">{list.rows.length} entries · {num(total.h)} h · {money(total.amt)}</span>
              <div className="seg">
                <button className={`seg-btn${!showAll ? ' active' : ''}`} onClick={() => setShowAll(false)} disabled={!emp}>This employee</button>
                <button className={`seg-btn${showAll || !emp ? ' active' : ''}`} onClick={() => setShowAll(true)}>Everyone</button>
              </div>
            </div>
          </div>
          {!list.rows.length ? <EmptyState icon={Clock3} title="No hourly entries">Entries you add for this payroll date appear here.</EmptyState> : (
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Employee</th><th>Worked</th><th>Job</th><th>Lot</th><th>Pack</th><th>Work</th><th>Type</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>{list.rows.map((r) => (
                  <tr key={r.TempLaborHourlyID}>
                    <td>{r.EmpName}</td><td>{fmtDate(r.DateWorked)}</td><td>{r.JobName}</td><td>{r.Lot ?? r.LotBlock}{r.Block ? `/${r.Block}` : ''}</td>
                    <td>{r.PackName}</td><td>{r.WorkType}</td><td>{r.HourType}</td><td className="num">{num(r.PayHours)}</td>
                    <td className="num">{r.HourlyRate ? money(r.HourlyRate) : <span className="faint">—</span>}</td><td className="num">{money(r.Amount)}</td>
                    <td className="actions"><button className="btn small ghost danger" onClick={() => remove(r.TempLaborHourlyID)} aria-label="Delete entry"><Trash2 size={13} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2><Users size={16} /> Hours by employee</h2></div>
          {!list.byEmployee.length ? <p className="muted small">None yet.</p> : (
            <table className="grid compact"><thead><tr><th>Employee</th><th className="num">Hours</th><th className="num">Amount</th></tr></thead>
              <tbody>{list.byEmployee.map((r) => (
                <tr key={r.EmployeeId} className="link-row" onClick={() => { setEmp({ id: r.EmployeeId, name: r.EmpName }); setShowAll(false) }}>
                  <td><a>{r.EmpName}</a></td><td className="num">{num(r.hours)}</td><td className="num">{money(r.amount)}</td>
                </tr>
              ))}</tbody></table>
          )}
        </section>
      </div>
    </div>
  )
}
