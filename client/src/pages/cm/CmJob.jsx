// One PM job in contract management (Access CmContract): job details, its contracts / addenda (CmContractSubAdden),
// and for the selected contract its diary (CmContractSubDiary) and links to estimating bids (CmContractSubLink).
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Link2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CmTabs, useCmLookups, yes } from './shared'

const blankContract = { TypeId: '', ContractNumber: '', WorkAgreeNum: '', AddendumNumber: '', Description: '', EffectivePhase: '', EffectiveDate: '', Executed: false, LatestPrint: false, Notes: '' }
const JOB_FIELDS = ['JobNumber', 'Address', 'City', 'State', 'Zip', 'EstStartDate', 'EstEndDate', 'UnitQty', 'JobTypeId', 'JurisdictionId', 'DivisionId', 'StatusId']

export default function CmJob() {
  const { id } = useParams()
  const lk = useCmLookups()
  const [sp, setSp] = useSearchParams()
  const sel = Number(sp.get('contract')) || null
  const [d, setD] = useState(null)
  const [job, setJob] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const r = await api(`/cm/jobs/${id}`)
    setD(r)
    setJob(Object.fromEntries(JOB_FIELDS.map((k) => [k, k.startsWith('Est') && k.endsWith('Date') ? toInputDate(r.job[k]) : r.job[k] ?? ''])))
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); if (r === false) return; if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const jf = (k) => ({ value: job?.[k] ?? '', onChange: (e) => setJob((s) => ({ ...s, [k]: e.target.value })) })
  const cf = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const saveJob = run(async (e) => { e.preventDefault(); await api(`/cm/jobs/${id}`, { method: 'PUT', body: job }) }, 'Job saved')
  const saveContract = run(async (e) => {
    e.preventDefault(); const body = { ...form }; delete body.id
    if (form.id) await api(`/cm/contracts/${form.id}`, { method: 'PUT', body })
    else { const r = await api(`/cm/jobs/${id}/contracts`, { method: 'POST', body }); setSp({ contract: r.id }) }
    setForm(null)
  }, 'Contract saved')
  const delContract = run(async (c) => {
    if (!confirm(`Delete contract ${c.ContractNumber || ''} ${c.AddendumNumber || ''} with its ${c.Diary} diary note(s) and ${c.Links} bid link(s)?`)) return false
    await api(`/cm/contracts/${c.CmContractID}`, { method: 'DELETE' }); setSp({}, { replace: true })
  }, 'Contract deleted')
  const edit = (c) => setForm({ id: c.CmContractID, TypeId: String(c.TypeId ?? ''), ContractNumber: c.ContractNumber || '', WorkAgreeNum: c.WorkAgreeNum || '', AddendumNumber: c.AddendumNumber || '',
    Description: c.Description || '', EffectivePhase: c.EffectivePhase || '', EffectiveDate: toInputDate(c.EffectiveDate), Executed: yes(c.Executed), LatestPrint: yes(c.LatestPrint), Notes: c.Notes || '' })
  const j = d?.job

  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cm/jobs">Contracts</Link>} title={j ? j.Job : 'Job'} track={!!j}
        subtitle={j ? `${j.Customer} · ${j.DivisionId || ''}${j.JobNumber ? ` · #${j.JobNumber}` : ''}` : null}
        actions={<Link className="btn" to="/cm/jobs"><ArrowLeft size={15} /> All jobs</Link>} />
      <CmTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={4} /> : (
        <>
          <form className="card form" onSubmit={saveJob}><fieldset>
            <legend>Job</legend>
            <label>Customer<input value={j.Customer} disabled /></label>
            <label>Job<input value={j.Job} disabled /></label>
            <label>Job number<input maxLength={50} {...jf('JobNumber')} /></label>
            <label>Job type<select aria-label="Job type" {...jf('JobTypeId')}>{lk.jobTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Division<select aria-label="Division" {...jf('DivisionId')}>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Status<select aria-label="Job status" {...jf('StatusId')}>{lk.statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="span2">Address<input maxLength={255} {...jf('Address')} /></label>
            <label>City<input maxLength={50} {...jf('City')} /></label>
            <label>State<input maxLength={50} {...jf('State')} /></label>
            <label>Zip<input maxLength={20} {...jf('Zip')} /></label>
            <label>Jurisdiction<select aria-label="Jurisdiction" {...jf('JurisdictionId')}><option value="" />{lk.jurisdictions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Est start date<input type="date" {...jf('EstStartDate')} /></label>
            <label>Est end date<input type="date" {...jf('EstEndDate')} /></label>
            <label>Unit qty<input inputMode="numeric" {...jf('UnitQty')} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save job</button></div></form>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Contracts / addenda ({d.contracts.length})</h2><button className="btn small primary" onClick={() => setForm({ ...blankContract })}><Plus size={13} /> Add contract/addendum</button></div>
            {form && (
              <form className="card form" onSubmit={saveContract}><fieldset>
                <legend>{form.id ? 'Edit contract / addendum' : 'New contract / addendum'}</legend>
                <label>Contract type *<select aria-label="Contract type" {...cf('TypeId')}><option value="">Choose…</option>{lk.contractTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Contract number<input maxLength={255} aria-label="Contract number" {...cf('ContractNumber')} /></label>
                <label>Work agreement num<input maxLength={255} {...cf('WorkAgreeNum')} /></label>
                <label>Addendum number<input maxLength={255} aria-label="Addendum number" {...cf('AddendumNumber')} /></label>
                <label className="span2">Description<input maxLength={255} {...cf('Description')} /></label>
                <label>Effective phase<input maxLength={255} {...cf('EffectivePhase')} /></label>
                <label>Effective date<input type="date" {...cf('EffectiveDate')} /></label>
                <label className="check"><input type="checkbox" checked={!!form.Executed} onChange={(e) => setForm({ ...form, Executed: e.target.checked })} /> Executed</label>
                <label className="check"><input type="checkbox" checked={!!form.LatestPrint} onChange={(e) => setForm({ ...form, LatestPrint: e.target.checked })} /> Latest print</label>
                <label className="span3">Notes<input maxLength={255} {...cf('Notes')} /></label>
              </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button><button type="button" className="btn" onClick={() => setForm(null)}><X size={15} /> Cancel</button></div></form>
            )}
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Type</th><th>Contract</th><th>Work agreement</th><th>Addendum</th><th>Description</th><th>Effective</th><th>Executed</th><th className="num">Diary</th><th className="num">Bids</th><th /></tr></thead>
              <tbody>{d.contracts.map((c) => (
                <tr key={c.CmContractID} className={`link-row${sel === c.CmContractID ? ' row-selected' : ''}`} onClick={() => setSp({ contract: c.CmContractID })}>
                  <td>{c.Type}</td><td><b>{c.ContractNumber || '—'}</b>{yes(c.LatestPrint) && <> <Badge tone="violet">Latest</Badge></>}</td><td>{c.WorkAgreeNum}</td><td>{c.AddendumNumber}</td><td className="wrap">{c.Description}</td>
                  <td>{fmtDate(c.EffectiveDate)}{c.EffectivePhase ? ` · ${c.EffectivePhase}` : ''}</td>
                  <td>{yes(c.Executed) ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>}</td><td className="num">{c.Diary || ''}</td><td className="num">{c.Links || ''}</td>
                  <td className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn small icon" aria-label={`Edit contract ${c.CmContractID}`} onClick={() => edit(c)}><Pencil size={13} /></button>
                    <button className="btn small icon" aria-label={`Delete contract ${c.CmContractID}`} onClick={() => delContract(c)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}{!d.contracts.length && <tr><td colSpan={10}><EmptyState title="No contracts for this job yet" /></td></tr>}</tbody>
            </table></div>
          </section>
          {sel && d.contracts.some((c) => c.CmContractID === sel) && <ContractDetail key={sel} id={sel} bids={d.bids} onChanged={load} />}
        </>
      )}
    </div>
  )
}

// Diary + bid links of one contract
function ContractDetail({ id, bids, onChanged }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [link, setLink] = useState('')
  const load = useCallback(async () => setD(await api(`/cm/contracts/${id}`)), [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn) => async (...a) => { setError(''); try { const r = await fn(...a); if (r === false) return; await load(); onChanged() } catch (e) { setError(e.message) } }
  const today = new Date().toISOString().slice(0, 10)
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const nf = (k) => ({ value: note?.[k] ?? '', onChange: (e) => setNote((s) => ({ ...s, [k]: e.target.value })) })
  const saveNote = run(async (e) => {
    e.preventDefault(); const body = { Date: note.Date, Contact: note.Contact, Notes: note.Notes, DueDate: note.DueDate, LinkFile: note.LinkFile }
    if (note.id) await api(`/cm/diary/${note.id}`, { method: 'PUT', body }); else await api(`/cm/contracts/${id}/diary`, { method: 'POST', body })
    setNote(null)
  })
  const delNote = run(async (nid) => { if (!confirm('Delete this diary note?')) return false; await api(`/cm/diary/${nid}`, { method: 'DELETE' }) })
  const addLink = run(async () => { await api(`/cm/contracts/${id}/links`, { method: 'POST', body: { PmContractId: link } }); setLink('') })
  const changeLink = run(async (l, pid) => api(`/cm/links/${l.CmLinkPmID}`, { method: 'PUT', body: { PmContractId: pid } }))
  const delLink = run(async (lid) => { if (!confirm('Remove this bid link?')) return false; await api(`/cm/links/${lid}`, { method: 'DELETE' }) })
  if (!d) return error ? <ErrorState message={error} /> : <SkeletonRows rows={4} cols={4} />
  const c = d.contract
  return (
    <div className="dash-grid" style={{ marginTop: 16 }}>
      <section className="panel span-2">
        <div className="panel-head"><h2>Diary · {[c.ContractNumber, c.AddendumNumber].filter(Boolean).join(' / ') || c.Type}</h2>
          <button className="btn small primary" onClick={() => setNote({ Date: today, DueDate: week, Contact: '', Notes: '', LinkFile: '' })}><Plus size={13} /> Add note</button></div>
        {error && <ErrorState message={error} />}
        {note && (
          <form className="card form" onSubmit={saveNote}><fieldset>
            <label>Date<input type="date" {...nf('Date')} /></label>
            <label>Due date<input type="date" aria-label="Due date" {...nf('DueDate')} /></label>
            <label>Contact<input maxLength={255} aria-label="Contact" {...nf('Contact')} /></label>
            <label className="span3">Notes<input maxLength={255} aria-label="Diary notes" {...nf('Notes')} /></label>
            <label className="span3">File (path or link)<input maxLength={255} {...nf('LinkFile')} /></label>
          </fieldset><div className="row form-actions"><button className="btn primary"><Save size={15} /> Save note</button><button type="button" className="btn" onClick={() => setNote(null)}><X size={15} /> Cancel</button></div></form>
        )}
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Date</th><th>Contact</th><th>Notes</th><th>Due</th><th>File</th><th /></tr></thead>
          <tbody>{d.diary.map((n) => (
            <tr key={n.CmDiaryID}><td>{fmtDate(n.Date)}</td><td>{n.Contact}</td><td className="wrap">{n.Notes}</td><td>{fmtDate(n.DueDate)}</td><td className="wrap">{n.LinkFile}</td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn small icon" aria-label={`Edit note ${n.CmDiaryID}`} onClick={() => setNote({ id: n.CmDiaryID, Date: toInputDate(n.Date), DueDate: toInputDate(n.DueDate), Contact: n.Contact || '', Notes: n.Notes || '', LinkFile: n.LinkFile || '' })}><Pencil size={13} /></button>
                <button className="btn small icon" aria-label={`Delete note ${n.CmDiaryID}`} onClick={() => delNote(n.CmDiaryID)}><Trash2 size={13} /></button>
              </td></tr>
          ))}{!d.diary.length && <tr><td colSpan={6}><EmptyState title="No diary notes" /></td></tr>}</tbody>
        </table></div>
      </section>
      <section className="panel span-2">
        <div className="panel-head"><h2><Link2 size={15} /> Link to estimating bids</h2></div>
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Bid</th><th>Release</th><th>Bid date</th><th /></tr></thead>
          <tbody>{d.links.map((l) => (
            <tr key={l.CmLinkPmID}>
              <td><select aria-label={`Linked bid ${l.CmLinkPmID}`} value={l.PmContractId ?? ''} onChange={(e) => changeLink(l, e.target.value)}>
                {bids.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>
              <td>{l.BidRelease}</td><td>{fmtDate(l.BidDate)}</td>
              <td><button className="btn small icon" aria-label={`Remove link ${l.CmLinkPmID}`} onClick={() => delLink(l.CmLinkPmID)}><Trash2 size={13} /></button></td>
            </tr>
          ))}
            <tr><td colSpan={3}><select aria-label="Bid to link" value={link} onChange={(e) => setLink(e.target.value)}><option value="">Choose a bid of this job…</option>
              {bids.filter((b) => !d.links.some((l) => l.PmContractId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}{b.BidRelease ? ` (${b.BidRelease})` : ''}</option>)}</select></td>
              <td><button className="btn small" disabled={!link} onClick={addLink}><Plus size={13} /> Link</button></td></tr>
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
