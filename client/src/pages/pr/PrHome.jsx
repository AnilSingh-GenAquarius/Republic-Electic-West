import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock3, Hammer, Send, Upload, Users, Wallet } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PayrollDatePicker, PrTabs, money, num, usePayrollDate } from './shared'

function Step({ n, icon: Icon, title, text, status, children }) {
  return (
    <div className={`step-card ${status || ''}`}>
      <div className="step-head">
        <span className="step-num">{status === 'done' ? <CheckCircle2 size={16} /> : n}</span>
        <Icon size={16} className="muted" />
        <h3>{title}</h3>
      </div>
      <p className="step-text">{text}</p>
      <div className="step-actions">{children}</div>
    </div>
  )
}

export default function PrHome() {
  const nav = useNavigate()
  const [date, setDate] = usePayrollDate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)

  const load = useCallback(() => {
    setError('')
    api('/pr/status', { params: { date } }).then(setData).catch((e) => setError(e.message))
  }, [date])
  useEffect(() => { setResult(null); load() }, [load])

  const d = data?.date
  async function appendHourly() {
    if (!confirm(`Append ${d.hourly.lines} hourly entries for ${fmtDate(date)} to the piece timecard?`)) return
    setBusy('append'); setResult(null)
    try {
      const r = await api('/pr/append-hourly', { method: 'POST', body: { payrollDate: date } })
      setResult({ ok: true, text: `${r.appended} hourly entries appended to the timecard.` })
    } catch (e) {
      // 422 returns the list of records to fix (like the Access "Fix records listed in spreadsheet")
      setResult({ ok: false, text: e.message, problems: (e.data?.problems || []).map((p) => ({ ...p, TempLaborID: p.TempLaborHourlyID, Lot: p.LotBlock, Item: p.Problem })) })
    } finally { setBusy(''); load() }
  }
  const appendCheck = appendHourly
  async function post() {
    const check = await api('/pr/post-check', { params: { date } })
    if (check.problems.length) {
      setResult({ ok: false, text: `${check.problems.length} timecard line(s) no longer match the job data (the pack was removed from the lot). Fix them on the Timecards tab, then post again.`, problems: check.problems })
      return
    }
    if (!confirm(`Post payroll for ${fmtDate(date)}?\n\n${d.piece.lines} timecard lines · ${money(d.piece.pay)}\n\nThis writes labor paid and job cost and clears the timecard. It cannot be undone from here.`)) return
    setBusy('post'); setResult(null)
    try {
      const r = await api('/pr/post', { method: 'POST', body: { payrollDate: date } })
      setResult({ ok: true, text: `Payroll posted: ${r.posted} lines written to labor paid and job cost.`, posted: true })
    } catch (e) { setResult({ ok: false, text: e.message }) } finally { setBusy(''); load() }
  }

  return (
    <div className="page">
      <PageHeader title="Payroll" subtitle="Weekly piece-rate and hourly payroll — process timecards, append hourly, post"
        actions={<PayrollDatePicker date={date} setDate={setDate} />} />
      <PrTabs />
      {error && <ErrorState message={error} onRetry={load} />}

      {result && (
        <div className={result.ok ? 'success-state' : 'error-state'} role="status" style={{ marginBottom: 14 }}>
          {result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{result.text}
            {result.posted && <> <Link to={`/insights/payroll-date?date=${date}`}>View posted payroll</Link></>}
          </span>
        </div>
      )}
      {result?.problems?.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table className="grid compact"><thead><tr><th>Employee</th><th>Job</th><th>Lot</th><th>Pack</th><th>Item</th></tr></thead>
            <tbody>{result.problems.map((p) => <tr key={p.TempLaborID}><td>{p.EmpName}</td><td>{p.JobName}</td><td>{p.Lot}{p.Block ? `/${p.Block}` : ''}</td><td>{p.PackName}</td><td>{p.Item}</td></tr>)}</tbody></table>
        </div>
      )}

      {!d ? <SkeletonRows rows={4} cols={3} /> : (
        <>
          {d.alreadyPosted > 0 && (
            <div className="banner"><AlertTriangle size={16} /> {d.alreadyPosted} labor lines are already posted for {fmtDate(date)}. Posting again adds to them.</div>
          )}
          <div className="steps">
            <Step n={1} icon={Hammer} title="Process piece timecard" status={d.piece.lines ? 'active' : ''}
              text="Pick an employee and an open lot, set the pay % on each labor line, submit to the timecard.">
              <button className="btn primary small" onClick={() => nav(`/pr/piece?date=${date}`)}>Open <ArrowRight size={13} /></button>
            </Step>
            <Step n={2} icon={Clock3} title="Process hourly timecard" status={d.hourly.lines ? 'active' : ''}
              text={d.hourly.lines ? `${d.hourly.lines} entries · ${num(d.hourly.hours)} h from ${d.hourly.employees} employees are waiting.` : 'Enter hours by job, lot and pack. Overtime and double time use the hour-type multiplier.'}>
              <button className="btn primary small" onClick={() => nav(`/pr/hourly?date=${date}`)}>Open <ArrowRight size={13} /></button>
            </Step>
            <Step n={3} icon={Upload} title="Append hourly to piece" status={!d.hourly.lines && d.piece.lines ? 'done' : ''}
              text="Checks every hourly entry still matches a lot and pack, then moves it onto the piece timecard.">
              <button className="btn small" disabled={!d.hourly.lines || busy} onClick={appendCheck}>
                {busy === 'append' ? 'Appending…' : `Append ${d.hourly.lines || ''} hourly`}
              </button>
            </Step>
            <Step n={4} icon={Send} title="Post payroll" status={d.alreadyPosted && !d.piece.lines ? 'done' : ''}
              text={d.piece.lines ? `${d.piece.lines} timecard lines · ${d.piece.employees} employees · ${money(d.piece.pay)}` : 'Nothing on the timecard for this payroll date yet.'}>
              <button className="btn primary small" disabled={!d.piece.lines || busy} onClick={post}>
                {busy === 'post' ? 'Posting…' : 'Post payroll'}
              </button>
              {d.postProblems > 0 && <Badge tone="red">{d.postProblems} to fix</Badge>}
            </Step>
          </div>

          <div className="dash-grid" style={{ marginTop: 18 }}>
            <section className="panel">
              <div className="panel-head"><h2><ClipboardList size={16} /> Pending piece timecards</h2></div>
              {!data.pieceDates.length ? <p className="muted small">None.</p> : (
                <table className="grid compact"><thead><tr><th>Payroll date</th><th className="num">Lines</th><th className="num">Pay</th></tr></thead>
                  <tbody>{data.pieceDates.map((r) => {
                    const ds = String(r.PayrollDate).slice(0, 10)
                    return <tr key={ds} className="link-row" onClick={() => setDate(ds)}><td><a>{fmtDate(r.PayrollDate)}</a></td><td className="num">{r.lines}</td><td className="num">{money(r.pay)}</td></tr>
                  })}</tbody></table>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2><Clock3 size={16} /> Pending hourly</h2></div>
              {!data.hourlyDates.length ? <p className="muted small">None.</p> : (
                <table className="grid compact"><thead><tr><th>Payroll date</th><th className="num">Entries</th><th className="num">Hours</th></tr></thead>
                  <tbody>{data.hourlyDates.map((r) => {
                    const ds = String(r.PayrollDate).slice(0, 10)
                    return <tr key={ds} className="link-row" onClick={() => setDate(ds)}><td><a>{fmtDate(r.PayrollDate)}</a></td><td className="num">{r.lines}</td><td className="num">{num(r.hours)}</td></tr>
                  })}</tbody></table>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2><Wallet size={16} /> Recently posted</h2><Link className="panel-link" to="/pr/reports">Reports <ArrowRight size={13} /></Link></div>
              <table className="grid compact"><thead><tr><th>Payroll date</th><th className="num"><Users size={12} /></th><th className="num">Pay</th></tr></thead>
                <tbody>{data.postedDates.map((r) => {
                  const ds = String(r.PayrollDate).slice(0, 10)
                  return <tr key={ds} className="link-row" onClick={() => nav(`/insights/payroll-date?date=${ds}`)}><td><a>{fmtDate(r.PayrollDate)}</a></td><td className="num">{r.employees}</td><td className="num">{money(r.pay)}</td></tr>
                })}</tbody></table>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
