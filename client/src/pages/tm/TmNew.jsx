import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '../../api'
import { JobLotPicker } from '../../components/Pickers'
import { ErrorState, PageHeader } from '../../components/ui'
import { TmTabs, useTmLookups } from './shared'

export default function TmNew() {
  const nav = useNavigate()
  const lk = useTmLookups()
  const [sp] = useSearchParams()
  const [sel, setSel] = useState({})
  const [f, setF] = useState({ TmName: '', TmCustomerNum: '', TmTypeId: sp.get('typeId') || '3', WorkId: '', RequestedBy: '', RequestorPhone: '', RequestorEmail: '', PriceLevel: '3', TmNotes: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => ({ value: f[k], onChange: (e) => setF((s) => ({ ...s, [k]: e.target.value })) })

  async function create(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const r = await api('/tm', { method: 'POST', body: { ...f, LotId: sel.LotId } })
      nav(`/tm/${r.id}`)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <PageHeader title="New T&M" subtitle="Pick the lot, name the work, then add packs and materials on the next screen" />
      <TmTabs />
      <form className="card form" onSubmit={create}>
        <fieldset>
          <legend>Where</legend>
          <JobLotPicker value={sel} onChange={setSel} showPack={false} />
        </fieldset>
        <fieldset>
          <legend>T&M</legend>
          <label className="span2">Name *<input required maxLength={60} {...set('TmName')} placeholder="e.g. Replace speaker" /></label>
          <label>Customer PO #<input maxLength={50} {...set('TmCustomerNum')} /></label>
          <label>Type
            <select {...set('TmTypeId')}>{lk.tmTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label>Work type
            <select {...set('WorkId')}><option value="" />{lk.workTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label>Price level
            <select {...set('PriceLevel')}>{lk.priceLevels.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label>Requested by<input maxLength={50} {...set('RequestedBy')} /></label>
          <label>Requestor phone<input maxLength={50} {...set('RequestorPhone')} /></label>
          <label>Requestor email<input maxLength={50} {...set('RequestorEmail')} /></label>
          <label className="span3">Notes<textarea rows={2} maxLength={255} {...set('TmNotes')} /></label>
        </fieldset>
        {error && <ErrorState message={error} />}
        <div className="row form-actions">
          <button className="btn primary" disabled={busy || !sel.LotId}><Plus size={15} /> {busy ? 'Creating…' : 'Create T&M'}</button>
          {!sel.LotId && <span className="muted small">Choose a job and a lot first. Closed lots are refused.</span>}
        </div>
      </form>
    </div>
  )
}
