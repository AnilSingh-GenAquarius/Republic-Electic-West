// Alarm Monitoring Audit — Access form AmAudit with subform AmAuditSubData (query frmAmAuditSubData).
// Filters: contract value from/to, contract terms, monitoring type, cancellation reason, account status toggle.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Download, Printer, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { download } from '../po/shared'
import AmTabs from './AmTabs'

const KEYS = ['fromValue', 'toValue', 'contractTermsId', 'monitoringTypeId', 'cancellationReason', 'status']
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))

export default function AmAudit() {
  const [sp, setSp] = useSearchParams()
  const f = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || '']))
  const [lk, setLk] = useState({ contractTerms: [], monitoringTypes: [] })
  const [reasons, setReasons] = useState([])
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ fromValue: f.fromValue, toValue: f.toValue })

  useEffect(() => { api('/am/lookups').then(setLk).catch(() => {}) }, [])
  useEffect(() => {
    setError('')
    api('/am/audit', { params: f }).then((r) => { setD(r); setReasons(r.reasons) }).catch((e) => { setError(e.message); setD(null) })
  }, [sp.toString()]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }) }
  const applyValues = (e) => { e?.preventDefault(); set(draft) }
  const clear = (k) => <button type="button" className="btn small icon" aria-label="Clear" onClick={() => { if (k === 'value') { setDraft({ fromValue: '', toValue: '' }); set({ fromValue: '', toValue: '' }) } else set({ [k]: '' }) }}><X size={13} /></button>

  return (
    <div className="page">
      <PageHeader title="Alarm monitoring audit" subtitle="Check accounts by contract value, terms, monitoring type, cancellation reason and status"
        actions={<>
          <button className="btn" disabled={!d?.rows.length} onClick={() => download(d.rows, [['AccountNumber', 'Account #'], ['CustomerName', 'Customer'], ['ContractTerms', 'Terms'], ['LengthMonths', 'Months'], ['MonthlyContractValue', 'Monthly value'], ['ServiceCity', 'City'], ['ServiceZip', 'Zip'], ['MonitoringType', 'Monitoring type'], ['ActivationDate', 'Activated'], ['RenewalDate', 'Renewal'], ['DisconnectionDate', 'Disconnected'], ['CancellationReason', 'Cancellation reason']], 'am-audit.csv')}><Download size={15} /> CSV</button>
          <button className="btn primary" disabled={!d} onClick={() => window.print()}><Printer size={15} /> Print</button>
        </>} />
      <AmTabs />

      <form className="filters no-print" onSubmit={applyValues}>
        <label className="inline">Contract value from <input className="cell-input" inputMode="decimal" value={draft.fromValue} onChange={(e) => setDraft((s) => ({ ...s, fromValue: e.target.value }))} onBlur={applyValues} /></label>
        <label className="inline">to <input className="cell-input" inputMode="decimal" value={draft.toValue} onChange={(e) => setDraft((s) => ({ ...s, toValue: e.target.value }))} onBlur={applyValues} />{clear('value')}</label>
        <label className="inline">Contract terms
          <select value={f.contractTermsId} onChange={(e) => set({ contractTermsId: e.target.value })}>
            <option value="">All</option>{lk.contractTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>{f.contractTermsId && clear('contractTermsId')}
        </label>
        <label className="inline">Monitoring type
          <select value={f.monitoringTypeId} onChange={(e) => set({ monitoringTypeId: e.target.value })}>
            <option value="">All</option>{lk.monitoringTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>{f.monitoringTypeId && clear('monitoringTypeId')}
        </label>
        <label className="inline">Cancellation reason
          <select value={f.cancellationReason} onChange={(e) => set({ cancellationReason: e.target.value })}>
            <option value="">All</option>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>{f.cancellationReason && clear('cancellationReason')}
        </label>
        <div className="seg" role="group" aria-label="Account status">
          {[['', 'All accounts'], ['active', 'Active'], ['cancelled', 'Cancelled']].map(([v, l]) => (
            <button key={l} type="button" className={`btn small ${f.status === v ? 'primary' : ''}`} onClick={() => set({ status: v })}>{l}</button>
          ))}
        </div>
      </form>

      {error && <ErrorState message={error} />}
      {!d && !error ? <SkeletonRows rows={8} cols={6} /> : d && (
        <>
          <p className="muted small">{d.rows.length} account(s) · total monthly value {money(d.total)}</p>
          <div className="table-wrap"><table className="grid">
            <thead><tr><th>Acct #</th><th>Customer</th><th>Terms</th><th className="num">Monthly</th><th>City</th><th>Zip</th><th>Monitoring type</th><th>Activated</th><th>Renewal</th><th>Disconnected</th><th>Reason</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.AccountID}>
                  <td><Link to={`/am/accounts/${r.AccountID}`}>{r.AccountNumber}</Link></td>
                  <td>{r.CustomerName}</td><td>{r.ContractTerms}</td><td className="num">{r.MonthlyContractValue}</td>
                  <td>{r.ServiceCity}</td><td>{r.ServiceZip}</td><td>{r.MonitoringType}</td>
                  <td>{fmtDate(r.ActivationDate)}</td><td>{fmtDate(r.RenewalDate)}</td><td>{fmtDate(r.DisconnectionDate)}</td><td>{r.CancellationReason}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={11}><EmptyState icon={ClipboardCheck} title="No accounts">No accounts match these filters.</EmptyState></td></tr>}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  )
}
