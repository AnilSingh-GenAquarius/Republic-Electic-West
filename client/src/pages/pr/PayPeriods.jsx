import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PrTabs } from './shared'

export default function PayPeriods() {
  const [rows, setRows] = useState(null)
  const [f, setF] = useState({ PayrollDate: '', PeriodFrom: '', PeriodTo: '' })
  const [error, setError] = useState('')

  const load = useCallback(() => { api('/pr/periods').then((d) => setRows(d.rows)).catch((e) => setError(e.message)) }, [])
  useEffect(load, [load])

  // Suggest the next week from the latest period
  useEffect(() => {
    if (!rows?.length || f.PayrollDate) return
    const last = rows[0]
    const add = (v, n) => { const d = new Date(v); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    setF({ PayrollDate: add(last.PayrollDate, 7), PeriodFrom: add(last.PeriodFrom, 7), PeriodTo: add(last.PeriodTo, 7) })
  }, [rows, f.PayrollDate])

  async function add(e) {
    e.preventDefault(); setError('')
    try { await api('/pr/periods', { method: 'POST', body: f }); setF({ PayrollDate: '', PeriodFrom: '', PeriodTo: '' }); load() } catch (err) { setError(err.message) }
  }
  async function remove(id) {
    if (!confirm('Delete this pay period?')) return
    await api(`/pr/periods/${id}`, { method: 'DELETE' }).catch((err) => setError(err.message)); load()
  }

  return (
    <div className="page">
      <PageHeader title="Pay periods" subtitle="Payroll dates and the work period each one covers" />
      <PrTabs />
      <form className="card form" onSubmit={add}>
        <fieldset>
          <legend>Add pay period</legend>
          <label>Payroll date *<input type="date" required value={f.PayrollDate} onChange={(e) => setF({ ...f, PayrollDate: e.target.value })} /></label>
          <label>Period from *<input type="date" required value={f.PeriodFrom} onChange={(e) => setF({ ...f, PeriodFrom: e.target.value })} /></label>
          <label>Period to *<input type="date" required value={f.PeriodTo} onChange={(e) => setF({ ...f, PeriodTo: e.target.value })} /></label>
          <label>&nbsp;<button className="btn primary"><Plus size={15} /> Add</button></label>
        </fieldset>
        {error && <ErrorState message={error} />}
      </form>
      <div className="table-wrap">
        {!rows ? <div style={{ padding: 16 }}><SkeletonRows rows={6} cols={3} /></div> : (
          <table className="grid">
            <thead><tr><th>Payroll date</th><th>Period from</th><th>Period to</th><th>Entered</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.PayPeriodID}><td><b>{fmtDate(r.PayrollDate)}</b></td><td>{fmtDate(r.PeriodFrom)}</td><td>{fmtDate(r.PeriodTo)}</td>
                  <td className="muted small">{fmtDate(r.DateEntered)} {r.UserEntered}</td>
                  <td className="actions"><button className="btn small ghost danger" onClick={() => remove(r.PayPeriodID)} aria-label="Delete"><Trash2 size={13} /></button></td></tr>
              ))}
              {!rows.length && <tr><td colSpan={5}><EmptyState icon={CalendarRange} title="No pay periods" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
