// Database maintenance – Edit T&M data (Access form DmTmEdit, filtered on the switchboard's T&M # box).
// Only the T&M type, approval and paid date can change; the rest is shown read-only.
import { useEffect, useState } from 'react'
import { CheckCircle2, Save } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { DmFilters, DmTabs, useDmParams } from './shared'

export default function DmTm() {
  const [p, set] = useDmParams()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = async () => {
    const r = await api(`/dm/tm/${p.tmId}`); setD(r)
    setForm({ TmTypeId: r.tm.TmTypeId ?? '', ApprovedBy: r.tm.ApprovedBy || '', ApprovedDate: toInputDate(r.tm.ApprovedDate), PaidDate: toInputDate(r.tm.PaidDate) })
  }
  useEffect(() => { setD(null); setError(''); setMsg(''); if (p.tmId) load().catch((e) => setError(e.message)) }, [p.tmId]) // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e) {
    e.preventDefault(); setError(''); setMsg('')
    try { await api(`/dm/tm/${p.tmId}`, { method: 'PUT', body: form }); setMsg('T&M saved'); await load() } catch (err) { setError(err.message) }
  }
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const t = d?.tm
  return (
    <div className="page">
      <PageHeader title="Edit T&M data" subtitle="Change the type, approval or paid date of a T&M ticket" />
      <DmTabs />
      <DmFilters p={p} set={set} fields={['tm']} />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!p.tmId ? <EmptyState title="Choose the T&M #" /> : !t ? <SkeletonRows rows={4} cols={4} /> : (
        <form className="card form" onSubmit={save}>
          <dl className="mg-dl" style={{ padding: 16 }}>
            {[['T&M #', t.TmID], ['Date', fmtDate(t.TmDate)], ['Customer #', t.TmCustomerNum], ['Name', t.TmName], ['Customer', t.CustName], ['Job', t.JobName], ['Lot', t.LotBlock], ['Entered', `${fmtDate(t.DateEntered)} ${t.UserEntered || ''}`.trim()], ['Notes', t.TmNotes]]
              .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
          </dl>
          <fieldset>
            <label>T&amp;M type<select aria-label="T&M type" {...f('TmTypeId')}><option value="">—</option>{d.types.map((x) => <option key={x.id} value={x.id}>{x.name}{x.Contracted ? ' (contracted)' : ''}</option>)}</select></label>
            <label>Approved by<input aria-label="Approved by" maxLength={50} {...f('ApprovedBy')} /></label>
            <label>Approved date<input type="date" aria-label="Approved date" {...f('ApprovedDate')} /></label>
            <label>Paid date<input type="date" aria-label="Paid date" {...f('PaidDate')} /></label>
          </fieldset>
          <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div>
        </form>
      )}
    </div>
  )
}
