// Printable account documents — Access reports AmAccountInfo (with zone and call-list subreports)
// and AmAccountInfoTech (technician sheet: service address, panel type, premises phone).
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Printer } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { ErrorState, PageHeader, SkeletonRows } from '../../components/ui'

function useAccount(id) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([api(`/am/accounts/${id}`), api('/am/lookups')])
      .then(([acc, lk]) => setD({ ...acc, lookups: lk }))
      .catch((e) => setError(e.message))
  }, [id])
  return { d, error }
}

const printedAt = () => new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

function Field({ label, value, wide }) {
  return (
    <div className={wide ? 'am-f wide' : 'am-f'}>
      <span className="muted small">{label}</span>
      <b>{value === true ? 'Yes' : value === false ? 'No' : value || '—'}</b>
    </div>
  )
}

function Shell({ id, title, d, error, children, email }) {
  return (
    <div className="page print-doc">
      <PageHeader title={title} track={false}
        actions={<>
          <Link className="btn" to={`/am/accounts/${id}`}><ArrowLeft size={15} /> Back to account</Link>
          {email && d && <a className="btn" href={email} title="Opens a new email. Use Print → Save as PDF and attach the file."><Mail size={15} /> Email</a>}
          <button className="btn primary" disabled={!d} onClick={() => window.print()}><Printer size={15} /> Print</button>
        </>} />
      {error && <ErrorState message={error} />}
      {!d && !error ? <SkeletonRows rows={8} cols={3} /> : d && <article className="po-sheet am-sheet">{children}</article>}
    </div>
  )
}

export function AmAccountPrint() {
  const { id } = useParams()
  const { d, error } = useAccount(id)
  const a = d?.account
  const name = (list, v) => list.find((x) => String(x.id) === String(v))?.name
  return (
    <Shell id={id} title="Account information" d={d} error={error}>
      {a && <>
        <header className="po-head">
          <div><h2>Alarm monitoring account information</h2><div className="muted small">Republic Electric West · REI Security</div></div>
          <div className="po-title"><b>Account {a.AccountNumber}</b><span className="small muted">Printed {printedAt()}</span></div>
        </header>

        <section className="am-sec">
          <h3>Account</h3>
          <div className="am-grid">
            <Field label="Account number" value={a.AccountNumber} />
            <Field label="Customer name" value={a.CustomerName} wide />
            <Field label="Phone" value={a.PhoneNumber} />
            <Field label="Email" value={a.Email} wide />
            <Field label="Contract terms" value={a.ContractTerms || name(d.lookups.contractTerms, a.ContractTermsId)} />
            <Field label="Contract value / month" value={a.MonthlyContractValue} />
            <Field label="Sales person" value={a.SalesPerson} />
          </div>
        </section>

        <div className="am-two">
          <section className="am-sec">
            <h3>Monitoring service address</h3>
            <div className="am-grid one">
              <Field label="Street" value={a.ServiceStreet} />
              <Field label="City / State / Zip" value={[a.ServiceCity, a.ServiceState, a.ServiceZip].filter(Boolean).join(', ')} />
              <Field label="Country" value={a.ServiceCountry} />
            </div>
          </section>
          <section className="am-sec">
            <h3>Mailing address {a.MailingSameService && <span className="muted small">(same as service)</span>}</h3>
            <div className="am-grid one">
              <Field label="Street" value={a.MailStreet} />
              <Field label="City / State / Zip" value={[a.MailCity, a.MailState, a.MailZip].filter(Boolean).join(', ')} />
              <Field label="Country" value={a.MailCountry} />
            </div>
          </section>
        </div>

        <section className="am-sec">
          <h3>Panel and monitoring</h3>
          <div className="am-grid">
            <Field label="Panel info" value={a.PanelInfo} />
            <Field label="Panel type" value={a.PanelType} />
            <Field label="Monitoring type" value={name(d.lookups.monitoringTypes, a.MonitoringTypeId)} />
            <Field label="Permit #" value={a.PermitNumber} />
            <Field label="Activation date" value={fmtDate(a.ActivationDate)} />
            <Field label="Renewal date" value={fmtDate(a.RenewalDate)} />
            <Field label="Disconnection date" value={fmtDate(a.DisconnectionDate)} />
            <Field label="Cancellation reason" value={a.CancellationReason} />
          </div>
        </section>

        {a.AccountNotes && <section className="am-sec"><h3>Account notes</h3><p className="am-notes">{a.AccountNotes}</p></section>}

        <section className="am-sec">
          <h3>Zones</h3>
          <table className="grid">
            <thead><tr><th>Zone</th><th>Zone description</th></tr></thead>
            <tbody>
              {d.zones.map((z) => <tr key={z.ZoneID}><td>{z.Zone}</td><td>{z.ZoneDescription}</td></tr>)}
              {!d.zones.length && <tr><td colSpan={2} className="muted">No zones</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="am-sec">
          <h3>Call list</h3>
          <table className="grid">
            <thead><tr><th>Contact name</th><th>Pass code</th><th>Phone</th><th>Type</th></tr></thead>
            <tbody>
              {d.contacts.map((c) => <tr key={c.ContactID}><td>{c.ContactName}</td><td>{c.PassCode}</td><td>{c.PhoneNumber}</td><td>{c.PhoneType}</td></tr>)}
              {!d.contacts.length && <tr><td colSpan={4} className="muted">No contacts</td></tr>}
            </tbody>
          </table>
        </section>
      </>}
    </Shell>
  )
}

export function AmAccountTechPrint() {
  const { id } = useParams()
  const { d, error } = useAccount(id)
  const a = d?.account
  // Access: IIf([PhoneType] Like "Premises", contact phone, "") — one line per premises phone.
  const premises = (d?.contacts || []).filter((c) => /^premises$/i.test(c.PhoneType || '') && c.PhoneNumber)
  // Access "Email report": SendObject as PDF, no recipient, subject "Alarm monitoring info for homeowner: <name>".
  const email = a && `mailto:?subject=${encodeURIComponent(`Alarm monitoring info for homeowner: ${a.CustomerName || ''}`)}&body=${encodeURIComponent('Find attached alarm monitoring account information.')}`
  return (
    <Shell id={id} title="Account info – tech" d={d} error={error} email={email}>
      {a && <>
        <header className="po-head">
          <div><h2>Account info – technician</h2><div className="muted small">Republic Electric West · REI Security</div></div>
          <div className="po-title"><b>Account {a.AccountNumber}</b><span className="small muted">Printed {printedAt()}</span></div>
        </header>
        <section className="am-sec">
          <div className="am-grid">
            <Field label="Customer name" value={a.CustomerName} wide />
            <Field label="Panel type" value={a.PanelType} />
            <Field label="Service street" value={a.ServiceStreet} wide />
            <Field label="City / State / Zip" value={[a.ServiceCity, a.ServiceState, a.ServiceZip].filter(Boolean).join(', ')} />
            <Field label="Country" value={a.ServiceCountry} />
            <Field label="Premises phone" value={premises.map((c) => c.PhoneNumber).join(' · ')} wide />
          </div>
        </section>
        <section className="am-sec">
          <h3>Zones</h3>
          <table className="grid">
            <thead><tr><th>Zone</th><th>Zone description</th></tr></thead>
            <tbody>
              {d.zones.map((z) => <tr key={z.ZoneID}><td>{z.Zone}</td><td>{z.ZoneDescription}</td></tr>)}
              {!d.zones.length && <tr><td colSpan={2} className="muted">No zones</td></tr>}
            </tbody>
          </table>
        </section>
      </>}
    </Shell>
  )
}
