// Database maintenance – Lot close date history (Access report DmLotEndDateHistory), grouped by lot.
import { useEffect, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { DmTabs } from './shared'

export default function DmHistory() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { api('/dm/reports/lot-close-history').then(setRows).catch((e) => setError(e.message)) }, [])
  const s = q.trim().toLowerCase()
  const shown = (rows || []).filter((r) => !s || `${r.CustName} ${r.JobName} ${r.Lot}/${r.Block} ${r.ChangeUser}`.toLowerCase().includes(s))
  const groups = []
  for (const r of shown) { const g = groups[groups.length - 1]; if (g && g.LotID === r.LotID) g.rows.push(r); else groups.push({ LotID: r.LotID, head: r, rows: [r] }) }
  function csv() {
    const cols = ['CustName', 'JobName', 'LotID', 'Lot', 'Block', 'Action', 'EndDatePrevious', 'EndDateNew', 'ChangeUser', 'ChangeDate']
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const text = [cols.join(','), ...shown.map((r) => cols.map((c) => esc(typeof r[c] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[c]) ? r[c].slice(0, 10) : r[c])).join(','))].join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'dm-lot-close-history.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  return (
    <div className="page">
      <PageHeader title="Lot close date history" subtitle="Every change to a lot's close (end) date"
        actions={rows?.length ? <><button className="btn" onClick={csv}><Download size={15} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button></> : null} />
      <DmTabs />
      <div className="filters no-print"><div className="search-wrap"><input type="search" aria-label="Filter" placeholder="Filter by customer, job, lot or user…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {error && <ErrorState message={error} />}
      {!rows ? <SkeletonRows rows={8} cols={5} /> : !groups.length ? <EmptyState title="No changes recorded" /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Action</th><th>Previous close date</th><th>New close date</th><th>Changed by</th><th>Changed on</th></tr></thead>
          {groups.map((g) => (
            <tbody key={g.LotID}>
              <tr><td colSpan={5} style={{ background: 'rgba(127,127,127,.08)' }}><b>{g.head.CustName} · {g.head.JobName} · Lot {g.head.Lot}/{g.head.Block}</b>
                <span className="muted small"> · lot {g.LotID} · started {fmtDate(g.head.StartDate) || '—'} · closed {fmtDate(g.head.EndDate) || 'open'}</span></td></tr>
              {g.rows.map((r) => <tr key={r.LotCloseChangeID}><td>{r.Action}</td><td>{fmtDate(r.EndDatePrevious)}</td><td>{fmtDate(r.EndDateNew)}</td><td>{r.ChangeUser}</td><td>{fmtDate(r.ChangeDate)}</td></tr>)}
            </tbody>
          ))}
        </table></div>
      )}
    </div>
  )
}
