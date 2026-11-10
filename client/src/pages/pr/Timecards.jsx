// All timecards for a payroll date (PrTempPayroll) — review, correct and remove lines before posting.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ClipboardList, Pencil, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PayrollDatePicker, PrTabs, money, num, usePayrollDate } from './shared'

export default function Timecards() {
  const [date, setDate] = usePayrollDate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState(null) // { id, PayPercent, PayHours, HourlyRate, Notes }
  const [filter, setFilter] = useState('')

  const load = useCallback(() => {
    setError('')
    api('/pr/timecard', { params: { date } }).then((d) => setRows(d.rows)).catch((e) => setError(e.message))
  }, [date])
  useEffect(load, [load])

  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) {
      if (filter && !`${r.EmpName} ${r.JobName} ${r.Item}`.toLowerCase().includes(filter.toLowerCase())) continue
      if (!m.has(r.EmployeeId)) m.set(r.EmployeeId, { name: r.EmpName, rows: [], pay: 0, hours: 0 })
      const g = m.get(r.EmployeeId)
      g.rows.push(r); g.pay += Number(r.ExtPay || 0); g.hours += Number(r.PayHours || 0)
    }
    return [...m.values()]
  }, [rows, filter])

  const missing = (rows || []).filter((r) => r.PackMissing).length
  const grand = groups.reduce((a, g) => ({ pay: a.pay + g.pay, hours: a.hours + g.hours }), { pay: 0, hours: 0 })

  async function save() {
    try {
      await api(`/pr/timecard/${edit.id}`, { method: 'PUT', body: { PayPercent: edit.PayPercent, PayHours: edit.PayHours, HourlyRate: edit.HourlyRate, Notes: edit.Notes } })
      setEdit(null); load()
    } catch (e) { setError(e.message) }
  }
  async function remove(id) {
    if (!confirm('Remove this line from the timecard?')) return
    await api(`/pr/timecard/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message))
    load()
  }

  return (
    <div className="page">
      <PageHeader title="Timecards" subtitle="Everything waiting to be posted for this payroll date"
        actions={<PayrollDatePicker date={date} setDate={setDate} />} />
      <PrTabs />
      {error && <ErrorState message={error} onRetry={load} />}
      {missing > 0 && <div className="banner"><AlertTriangle size={16} /> {missing} line(s) point at a pack that is no longer on the lot. Remove or re-enter them before posting.</div>}

      <div className="filters">
        <input placeholder="Filter by employee, job or item…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} />
        <span className="muted small">{rows ? `${rows.length} lines · ${groups.length} employees · ${num(grand.hours)} h · ` : ''}<b>{rows ? money(grand.pay) : ''}</b></span>
      </div>

      {!rows ? <SkeletonRows rows={6} cols={4} /> : !groups.length ? (
        <EmptyState icon={ClipboardList} title={`No timecards for ${fmtDate(date)}`}>Submit piece lines or append hourly entries first.</EmptyState>
      ) : groups.map((g) => (
        <section key={g.name} className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head"><h2>{g.name}</h2><span className="muted small">{g.rows.length} lines · {num(g.hours)} h · <b>{money(g.pay)}</b></span></div>
          <div className="table-wrap flat">
            <table className="grid compact">
              <thead><tr><th>Job</th><th>Lot</th><th>Pack</th><th>Item</th><th>Work</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Pay %</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Pay</th><th>Entered</th><th /></tr></thead>
              <tbody>{g.rows.map((r) => edit?.id === r.TempLaborID ? (
                <tr key={r.TempLaborID} className="row-selected">
                  <td>{r.JobName}</td><td>{r.Lot}{r.Block ? `/${r.Block}` : ''}</td><td>{r.PackName}</td><td>{r.Item}</td><td>{r.WorkType}</td>
                  <td className="num">{num(r.ExtItemQty)}</td><td className="num">{money(r.PriceEa)}</td>
                  <td className="num"><input className="pct-input" value={edit.PayPercent ?? ''} onChange={(e) => setEdit({ ...edit, PayPercent: e.target.value })} /></td>
                  <td className="num"><input className="pct-input" value={edit.PayHours ?? ''} onChange={(e) => setEdit({ ...edit, PayHours: e.target.value })} /></td>
                  <td className="num"><input className="pct-input" value={edit.HourlyRate ?? ''} onChange={(e) => setEdit({ ...edit, HourlyRate: e.target.value })} /></td>
                  <td /><td /><td className="actions">
                    <button className="btn small primary" onClick={save} aria-label="Save"><Save size={13} /></button>
                    <button className="btn small ghost" onClick={() => setEdit(null)} aria-label="Cancel"><X size={13} /></button>
                  </td>
                </tr>
              ) : (
                <tr key={r.TempLaborID} className={r.PackMissing ? 'row-error' : ''}>
                  <td>{r.JobName}</td><td>{r.Lot}{r.Block ? `/${r.Block}` : ''}</td>
                  <td className="wrap">{r.PackName} {r.PackMissing ? <Badge tone="red">pack removed</Badge> : null}</td><td className="wrap">{r.Item}</td><td>{r.WorkType}</td>
                  <td className="num">{num(r.ExtItemQty)}</td><td className="num">{money(r.PriceEa)}</td><td className="num">{num(r.PayPercent, 1)}</td>
                  <td className="num">{num(r.PayHours)}</td><td className="num">{r.HourlyRate ? money(r.HourlyRate) : ''}</td><td className="num"><b>{money(r.ExtPay)}</b></td>
                  <td className="muted small">{r.UserEntered}</td>
                  <td className="actions">
                    <button className="btn small ghost" onClick={() => setEdit({ id: r.TempLaborID, PayPercent: r.PayPercent, PayHours: r.PayHours, HourlyRate: r.HourlyRate, Notes: r.Notes })} aria-label="Edit"><Pencil size={13} /></button>
                    <button className="btn small ghost danger" onClick={() => remove(r.TempLaborID)} aria-label="Remove"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
