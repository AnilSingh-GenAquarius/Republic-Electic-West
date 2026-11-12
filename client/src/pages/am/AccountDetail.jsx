import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import ChildGrid from '../../components/ChildGrid'
import { AlertTriangle, ArrowLeft, Printer, Save, Trash2, Wrench } from 'lucide-react'
import { ErrorState, PageHeader } from '../../components/ui'

const EMPTY = {
  AccountNumber: '', CustomerName: '', ContractTermsId: '', MonthlyContractValue: '',
  ServiceStreet: '', ServiceCity: '', ServiceState: 'CA', ServiceZip: '', ServiceCountry: 'USA',
  MailingSameService: true, MailStreet: '', MailCity: '', MailState: '', MailZip: '', MailCountry: '',
  PhoneNumber: '', Email: '', PermitNumber: '', PanelInfo: '', PanelType: '', MonitoringTypeId: '',
  ActivationDate: '', RenewalDate: '', DisconnectionDate: '', CancellationReason: '',
  SalesPerson: '', AccountNotes: '',
}
const DATE_FIELDS = ['ActivationDate', 'RenewalDate', 'DisconnectionDate']

export default function AccountDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [meta, setMeta] = useState(null)
  const [contacts, setContacts] = useState([])
  const [zones, setZones] = useState([])
  const [lookups, setLookups] = useState({ contractTerms: [], monitoringTypes: [], phoneTypes: [], panelTypes: [], cancellationReasons: [], cities: [] })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (isNew) {
      const { accountNumber } = await api('/am/accounts/next-number')
      setForm({ ...EMPTY, AccountNumber: accountNumber })
      return
    }
    const d = await api(`/am/accounts/${id}`)
    const a = { ...EMPTY }
    for (const k of Object.keys(EMPTY)) a[k] = d.account[k] ?? (typeof EMPTY[k] === 'boolean' ? false : '')
    DATE_FIELDS.forEach((k) => (a[k] = toInputDate(d.account[k])))
    setForm(a)
    setMeta(d.account)
    setContacts(d.contacts)
    setZones(d.zones)
  }, [id, isNew])

  useEffect(() => { api('/am/lookups').then(setLookups).catch(() => {}) }, [])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  const f = (k) => ({
    value: form[k] ?? '',
    onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  })

  // Suggest a renewal date from activation date + contract length (the Access form did this on update)
  function applyTermsToRenewal() {
    const t = lookups.contractTerms.find((c) => String(c.id) === String(form.ContractTermsId))
    if (!t || !form.ActivationDate || !t.LengthMonths) return
    const d = new Date(form.ActivationDate + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + t.LengthMonths)
    setForm((s) => ({ ...s, RenewalDate: d.toISOString().slice(0, 10) }))
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError(''); setMsg('')
    try {
      const body = { ...form }
      for (const k of ['AccountNumber', 'ServiceZip', 'MailZip', 'ContractTermsId', 'MonitoringTypeId']) {
        body[k] = body[k] === '' || body[k] == null ? null : parseInt(body[k], 10)
      }
      if (isNew) {
        const r = await api('/am/accounts', { method: 'POST', body })
        nav(`/am/accounts/${r.id}`, { replace: true })
      } else {
        await api(`/am/accounts/${id}`, { method: 'PUT', body })
        setMsg('Saved')
        await load()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // In-page confirmation (the browser's confirm() popup can be blocked, which made Delete do nothing)
  async function doDelete() {
    setDeleting(true); setError('')
    try {
      await api(`/am/accounts/${id}`, { method: 'DELETE' })
      nav('/am/accounts')
    } catch (err) {
      setError(err.message)
      setConfirmDel(false)
      setDeleting(false)
    }
  }

  const reload = () => load().catch((e) => setError(e.message))

  return (
    <div className="page">
      <PageHeader
        crumb={<><Link to="/am">Alarm Monitoring</Link> / <Link to="/am/accounts">Accounts</Link></>}
        title={isNew ? 'New alarm account' : meta ? `${form.AccountNumber} – ${form.CustomerName}` : 'Loading…'}
        track={!isNew && !!meta}
        actions={<>
          {!isNew && meta && <Link className="btn" to={`/am/accounts/${id}/print`} title="Access report: Account information"><Printer size={15} /> Print account</Link>}
          {!isNew && meta && <Link className="btn" to={`/am/accounts/${id}/print-tech`} title="Access report: Account info tech"><Wrench size={15} /> Tech sheet</Link>}
          <Link className="btn" to="/am/accounts"><ArrowLeft size={15} /> Back to list</Link>
        </>}
      />
      {form.DisconnectionDate && <div className="banner"><AlertTriangle size={16} />Disconnected {fmtDate(form.DisconnectionDate)}{form.CancellationReason ? ` – ${form.CancellationReason}` : ''}</div>}

      <form className="card form" onSubmit={save}>
        <fieldset>
          <legend>Account</legend>
          <label>Account Number<input type="number" {...f('AccountNumber')} /></label>
          <label className="span2">Customer name *<input required maxLength={50} {...f('CustomerName')} /></label>
          <label>Phone<input maxLength={50} {...f('PhoneNumber')} /></label>
          <label className="span2">Email<input type="email" maxLength={50} {...f('Email')} /></label>
          <label>Sales person<input maxLength={255} {...f('SalesPerson')} /></label>
        </fieldset>

        <fieldset>
          <legend>Contract</legend>
          <label>Monitoring type
            <select {...f('MonitoringTypeId')}>
              <option value="" />
              {lookups.monitoringTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Contract terms
            <select {...f('ContractTermsId')}>
              <option value="" />
              {lookups.contractTerms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Monthly Contract Value<input maxLength={50} placeholder="$0.00" {...f('MonthlyContractValue')} /></label>
          <label>Activation date<input type="date" {...f('ActivationDate')} /></label>
          <label>Renewal date
            <div className="row">
              <input type="date" {...f('RenewalDate')} />
              <button type="button" className="btn small" title="Activation date + contract length" onClick={applyTermsToRenewal}>Calc</button>
            </div>
          </label>
          <label>Disconnection date<input type="date" {...f('DisconnectionDate')} /></label>
          <label className="span2">Cancellation reason<input maxLength={50} list="am-cancel-list" autoComplete="off" {...f('CancellationReason')} /><datalist id="am-cancel-list">{(lookups.cancellationReasons || []).map((v) => <option key={v} value={v} />)}</datalist></label>
        </fieldset>

        <fieldset>
          <legend>Service address</legend>
          <label className="span2">Street<input maxLength={50} {...f('ServiceStreet')} /></label>
          <label>City<input maxLength={50} list="am-city-list" autoComplete="off" {...f('ServiceCity')} /></label>
          <label>State<input maxLength={50} {...f('ServiceState')} /></label>
          <label>Zip<input inputMode="numeric" {...f('ServiceZip')} /></label>
          <label>Country<input maxLength={50} {...f('ServiceCountry')} /></label>
          <label className="check span3"><input type="checkbox" checked={!!form.MailingSameService} onChange={f('MailingSameService').onChange} /> Mailing address same as service</label>
        </fieldset>

        {!form.MailingSameService && (
          <fieldset>
            <legend>Mailing address</legend>
            <label className="span2">Street<input maxLength={50} {...f('MailStreet')} /></label>
            <label>City<input maxLength={50} list="am-city-list" autoComplete="off" {...f('MailCity')} /></label>
            <label>State<input maxLength={50} {...f('MailState')} /></label>
            <label>Zip<input inputMode="numeric" {...f('MailZip')} /></label>
            <label>Country<input maxLength={50} {...f('MailCountry')} /></label>
          </fieldset>
        )}

        <fieldset>
          <legend>Panel</legend>
          <label>Panel type<input maxLength={50} list="am-panel-list" autoComplete="off" {...f('PanelType')} /><datalist id="am-panel-list">{(lookups.panelTypes || []).map((v) => <option key={v} value={v} />)}</datalist></label>
          <label className="span2">Panel information<input maxLength={255} {...f('PanelInfo')} /></label>
          <label className="span3">Account Notes<textarea rows={3} maxLength={255} {...f('AccountNotes')} /></label>
        <datalist id="am-city-list">{(lookups.cities || []).map((v) => <option key={v} value={v} />)}</datalist>
        </fieldset>

        {error && <ErrorState message={error} />}
        {msg && <div className="ok">{msg}</div>}
        <div className="row form-actions">
          <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create account' : 'Save changes'}</button>
          {!isNew && <button type="button" className="btn danger" onClick={() => { setError(''); setConfirmDel(true) }}><Trash2 size={15} /> Delete account</button>}
          {meta && <span className="muted small">Entered {fmtDate(meta.DateEntered)} by {meta.UserEntered || '—'}</span>}
        </div>
      </form>

      {!isNew && (
        <>
          <ChildGrid
            title="Call list (contacts)"
            rows={contacts}
            idKey="ContactID"
            fields={[
              { key: 'ContactOrder', label: 'Order', width: 70 },
              { key: 'ContactName', label: 'Name' },
              { key: 'PhoneNumber', label: 'Phone' },
              { key: 'PhoneType', label: 'Phone type', type: 'select', options: lookups.phoneTypes.map((p) => p.name) },
              { key: 'PassCode', label: 'Passcode' },
            ]}
            onAdd={(r) => api(`/am/accounts/${id}/contacts`, { method: 'POST', body: r })}
            onSave={(cid, r) => api(`/am/contacts/${cid}`, { method: 'PUT', body: r })}
            onDelete={(cid) => api(`/am/contacts/${cid}`, { method: 'DELETE' })}
            onChanged={reload}
          />
          <ChildGrid
            title="Zones"
            rows={zones}
            idKey="ZoneID"
            fields={[
              { key: 'Zone', label: 'Zone', width: 90 },
              { key: 'ZoneDescription', label: 'Description' },
            ]}
            onAdd={(r) => api(`/am/accounts/${id}/zones`, { method: 'POST', body: r })}
            onSave={(zid, r) => api(`/am/zones/${zid}`, { method: 'PUT', body: r })}
            onDelete={(zid) => api(`/am/zones/${zid}`, { method: 'DELETE' })}
            onChanged={reload}
          />
        </>
      )}

      {confirmDel && (
        <div className="dialog-scrim" onClick={() => !deleting && setConfirmDel(false)} onKeyDown={(e) => e.key === 'Escape' && !deleting && setConfirmDel(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-title"><AlertTriangle size={18} /> Delete this account?</h2>
            <p><b>{form.AccountNumber} – {form.CustomerName}</b></p>
            <p className="muted">This also deletes its call-list contacts ({contacts.length}) and zones ({zones.length}). It cannot be undone.</p>
            <div className="row dialog-actions">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmDel(false)} disabled={deleting}>Cancel</button>
              <button type="button" className="btn danger" onClick={doDelete} disabled={deleting}><Trash2 size={15} /> {deleting ? 'Deleting…' : 'Delete account'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
