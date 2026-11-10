// Bid header shared by assembly bid management (EsBid) and material bid management (EsJob):
// job info (PmJob) and bid data / notes / features (EsBid), each editable in place.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { BID_FIELDS, BID_TABS, FormCard, Fields, JOB_FIELDS, TabbedFields, money, pct, toForm, yes } from './shared'

export default function BidHeader({ bid: b, lk, onSaved, onError }) {
  const [job, setJob] = useState(null)
  const [bid, setBid] = useState(null)
  const [busy, setBusy] = useState(false)
  async function save(e, path, body, close) {
    e.preventDefault(); setBusy(true); onError('')
    try { await api(path, { method: 'PUT', body }); close(null); await onSaved(path.includes('/jobs/') ? 'Job saved' : 'Bid saved') } catch (err) { onError(err.message) } finally { setBusy(false) }
  }
  const jobBody = () => { const o = { ...job }; return o }
  return (
    <>
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div className="muted small">Job</div>
            <div><b>{b.Job}</b> ({b.DivisionId}) · {b.JobType || '—'}{yes(b.Template) ? ' · Template' : ''}</div>
            <div className="muted small">{[b.Address, b.City, b.State, b.Zip].filter(Boolean).join(', ') || 'No address'} · Spec level {b.SpecLevel || '—'} · Units {b.UnitQty ?? '—'} · Est {fmtDate(b.EstStartDate) || '—'} – {fmtDate(b.EstEndDate) || '—'}</div>
            {b.CustomerNotes && <div className="muted small">Customer notes: {b.CustomerNotes}</div>}
            {b.JobNotes && <div className="muted small">Job notes: {b.JobNotes}</div>}
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div className="muted small">Bid</div>
            <div><b>Bid {b.BidNum}</b> · {fmtDate(b.Date)}{b.EffectiveRelease?.trim() ? ` · ${b.EffectiveRelease.trim()}` : ''} · {b.Status || '—'}</div>
            <div className="muted small">Recipient {b.Recipient || '—'} · Estimator {b.Estimator || '—'}</div>
            <div className="muted small">Tax {pct(b.TaxPercent)} · Cont mat {pct(b.ContMatPercent)} · Cont labor {money(b.ContLaborValueNum)} · Burden {pct(b.BurdenLabor)} · O/H {pct(b.OverheadPercent)} · Profit {pct(b.ProfitPercent)} · Wrap {pct(b.WrapPercent)} · Discount {pct(b.Discount)}</div>
            <div className="muted small">PM bid: {b.PmContractID ? <Link to={`/pm/bids/${b.PmContractID}`}>{b.PmBid}</Link> : 'not transferred'}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" onClick={() => { setBid(null); setJob({ ...toForm({ ...b, Notes: b.JobNotes, StatusId: b.JobStatusId }, JOB_FIELDS) }) }}><Pencil size={13} /> Job info</button>
            <button className="btn small" onClick={() => { setJob(null); setBid(toForm(b, BID_FIELDS)) }}><Pencil size={13} /> Bid data</button>
          </div>
        </div>
      </section>
      {job && <FormCard legend="Job info" busy={busy} onCancel={() => setJob(null)} onSubmit={(e) => save(e, `/es/jobs/${b.PmJobID}`, jobBody(), setJob)}><Fields fields={JOB_FIELDS} value={job} onChange={setJob} lk={lk} /></FormCard>}
      {bid && <FormCard legend="Bid data" busy={busy} onCancel={() => setBid(null)} onSubmit={(e) => save(e, `/es/bids/${b.EsBidID}`, bid, setBid)}><TabbedFields tabs={BID_TABS} value={bid} onChange={setBid} lk={lk} /></FormCard>}
    </>
  )
}
