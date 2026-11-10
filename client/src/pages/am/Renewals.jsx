import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { CalendarCheck, Printer } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader } from '../../components/ui'
import AmTabs from './AmTabs'

export default function Renewals() {
  const [days, setDays] = useState(60)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api('/am/reports/renewals', { params: { days } }).then((d) => setRows(d.rows)).catch((e) => setError(e.message))
  }, [days])

  return (
    <div className="page">
      <PageHeader title="Renewals due" subtitle="Active alarm contracts renewing soon" actions={
        <div className="row">
          <label className="inline">Next
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>} />
      <AmTabs />
      {error && <ErrorState message={error} />}
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>Renewal</th><th>Acct #</th><th>Customer</th><th>Phone</th><th>Terms</th><th>Monthly</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.AccountID}>
              <td>{fmtDate(r.RenewalDate)}</td>
              <td><Link to={`/am/accounts/${r.AccountID}`}>{r.AccountNumber}</Link></td>
              <td>{r.CustomerName}</td><td>{r.PhoneNumber}</td><td>{r.ContractTerms}</td><td>{r.MonthlyContractValue}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6}><EmptyState icon={CalendarCheck} title="No renewals due">No active accounts renew in the next {days} days.</EmptyState></td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}
