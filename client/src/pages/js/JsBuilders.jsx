// Builders = Access form JsCustomer (corporate address, status, credit) + JsCustomerBillToSub (bill-to address per division) + JsJobSub (jobs).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, changed, nextParams, statusTone, useConfirm, useDebounced, useJsLookups } from './shared'

export function JsBuilders() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp(nextParams(p, patch))
  useEffect(() => {
    setError('')
    api('/js/builders', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useDebounced(search, (v) => { if (v !== (p.search || '')) set({ search: v }) })
  const open = (id) => nav(`/js/builders/${id}`)
  return (
    <div className="page">
      <PageHeader title="Builders" subtitle="Customers that jobs are set up for, with a billing address per division"
        actions={<Link className="btn primary" to="/js/builders/new"><Plus size={15} /> New builder</Link>} />
      <JsTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search builder, QB number or city…" aria-label="Search builders" /></div>
        <div className="seg" role="group" aria-label="Status">{[['all', 'All'], ['active', 'Active'], ['inactive', 'Not active']].map(([v, l]) => (
          <button key={v} type="button" aria-pressed={(p.status || 'all') === v} className={`seg-btn${(p.status || 'all') === v ? ' active' : ''}`} onClick={() => set({ status: v === 'all' ? '' : v })}>{l}</button>))}</div>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={6} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Builder</th><th>QB #</th><th>City</th><th>Status</th><th className="num">Jobs</th><th className="num">Active jobs</th><th className="num">Bill-to</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.CustID} tabIndex={0} onClick={() => open(r.CustID)} onKeyDown={(e) => e.key === 'Enter' && open(r.CustID)} className={r.StatusId !== 1 ? 'dim' : ''}>
                  <td><b>{r.CustName}</b></td><td>{r.CustNum}</td><td>{[r.City, r.State].filter(Boolean).join(', ')}</td>
                  <td>{r.Status && <Badge tone={statusTone(r.Status)}>{r.Status}</Badge>}</td>
                  <td className="num">{r.Jobs}</td><td className="num">{r.ActiveJobs}</td><td className="num">{r.BillTo}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={7}><EmptyState icon={Building2} title="No builders match">Try a different search or status.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

const FIELDS = ['CustName', 'CustNum', 'Address', 'City', 'State', 'Zip', 'StatusId', 'CreditId']
const EMPTY = { CustName: '', CustNum: '', Address: '', City: '', State: '', Zip: '', StatusId: '1', CreditId: '' }
const EMPTY_BILL = { DivisionId: '', CustContact: '', BillAddress: '', BillCity: '', BillState: '', BillZip: '' }
const BILL_FIELDS = ['DivisionId', 'CustContact', 'BillAddress', 'BillCity', 'BillState', 'BillZip']

export function JsBuilderDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useJsLookups()
  const [dialog, ask] = useConfirm()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [nb, setNb] = useState(EMPTY_BILL)
  const [editB, setEditB] = useState(null)

  const load = useCallback(async () => {
    if (isNew) { setForm(EMPTY); setD(null); return }
    const r = await api(`/js/builders/${id}`)
    setD(r)
    const f = {}; for (const k of FIELDS) f[k] = r.builder[k] == null ? '' : String(r.builder[k])
    setForm(f)
  }, [id, isNew])
  useEffect(() => { setError(''); load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const run = async (fn, ok) => { setError(''); setMsg(''); try { await fn(); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  async function save(e) {
    e.preventDefault(); setSaving(true); setError(''); setMsg('')
    try {
      if (isNew) {
        const r = await api('/js/builders', { method: 'POST', body: form })
        nav(`/js/builders/${r.id}`, { replace: true })
      } else {
        const body = changed(Object.fromEntries(FIELDS.map((k) => [k, d.builder[k]])), form, FIELDS)
        if (!Object.keys(body).length) { setMsg('Nothing changed'); return }
        await api(`/js/builders/${id}`, { method: 'PUT', body })
        setMsg('Builder saved'); await load()
      }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete builder?', message: `Delete ${d.builder.CustName}? This cannot be undone.`, ok: 'Delete', danger: true }))) return
    try { await api(`/js/builders/${id}`, { method: 'DELETE' }); nav('/js/builders') } catch (e) { setError(e.message) }
  }
  const addBill = (e) => { e.preventDefault(); run(async () => { await api(`/js/builders/${id}/billto`, { method: 'POST', body: nb }); setNb(EMPTY_BILL) }, 'Billing address added') }
  const saveBill = () => run(async () => {
    const orig = d.billTo.find((b) => b.CustBillID === editB.CustBillID)
    const body = changed(orig, editB, BILL_FIELDS)
    if (Object.keys(body).length) await api(`/js/billto/${editB.CustBillID}`, { method: 'PUT', body })
    setEditB(null)
  }, 'Billing address saved')
  const delBill = async (b) => {
    if (!(await ask({ title: 'Remove billing address?', message: `Remove the ${b.DivisionId} billing address?`, ok: 'Remove', danger: true }))) return
    run(() => api(`/js/billto/${b.CustBillID}`, { method: 'DELETE' }), 'Billing address removed')
  }

  const b = d?.builder
  return (
    <div className="page">
      {dialog}
      <PageHeader crumb={<><Link to="/js">Job setup</Link> / <Link to="/js/builders">Builders</Link></>} title={isNew ? 'New builder' : b?.CustName || 'Builder'} track={!isNew && !!b}
        subtitle={b ? [b.City, b.State].filter(Boolean).join(', ') : null}
        actions={<>{!isNew && b && <Link className="btn primary" to={`/js/jobs/new?builder=${id}`}><Plus size={15} /> New job</Link>}<Link className="btn" to="/js/builders"><ArrowLeft size={15} /> Builders</Link></>} />
      <JsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      {!isNew && !d && !error ? <SkeletonRows rows={6} cols={3} /> : (isNew || d) && (
        <form className="card form" onSubmit={save} noValidate>
          <fieldset>
            <legend>Builder</legend>
            <label className="span2">Name *<input required maxLength={50} {...f('CustName')} /></label>
            <label>Cust num (QuickBooks)<input maxLength={50} {...f('CustNum')} /></label>
            <label>Status<select {...f('StatusId')}>{lk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Credit<select {...f('CreditId')}><option value="" />{lk.creditRatings.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </fieldset>
          <fieldset>
            <legend>Corporate address</legend>
            <label className="span2">Address<input maxLength={50} {...f('Address')} /></label>
            <label>City<input maxLength={50} list="js-cities" {...f('City')} /></label>
            <label>State<input maxLength={2} placeholder="CA" {...f('State')} onChange={(e) => setForm((s) => ({ ...s, State: e.target.value.toUpperCase() }))} /></label>
            <label>Zip<input maxLength={50} {...f('Zip')} /></label>
          </fieldset>
          <datalist id="js-cities">{lk.cities.map((c) => <option key={c.id} value={c.name}>{c.State}</option>)}</datalist>
          <div className="row form-actions">
            <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create builder' : 'Save changes'}</button>
            {!isNew && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
            {b && <span className="muted small">Builder ID {b.CustID} · entered {fmtDate(b.DateEntered)} by {b.UserEntered || '—'}</span>}
          </div>
        </form>
      )}
      {d && (
        <>
          <section className="card">
            <div className="panel-head"><h2>Billing addresses per division ({d.billTo.length})</h2></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Division</th><th>Contact</th><th>Address</th><th>City</th><th>State</th><th>Zip</th><th /></tr></thead>
                <tbody>
                  {d.billTo.map((x) => editB?.CustBillID === x.CustBillID ? (
                    <tr key={x.CustBillID} className="row-selected">
                      <td><select value={editB.DivisionId ?? ''} onChange={(e) => setEditB({ ...editB, DivisionId: e.target.value })} aria-label="Division">{lk.divisions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}</select></td>
                      {['CustContact', 'BillAddress', 'BillCity', 'BillState', 'BillZip'].map((k) => <td key={k}><input value={editB[k] ?? ''} maxLength={k === 'BillState' ? 2 : 50} onChange={(e) => setEditB({ ...editB, [k]: k === 'BillState' ? e.target.value.toUpperCase() : e.target.value })} aria-label={k} /></td>)}
                      <td className="actions"><button type="button" className="btn small primary" onClick={saveBill} aria-label="Save billing address"><Save size={13} /></button><button type="button" className="btn small ghost" onClick={() => setEditB(null)}>Cancel</button></td>
                    </tr>
                  ) : (
                    <tr key={x.CustBillID}>
                      <td><b>{x.DivisionId}</b> <span className="muted small">{x.DivisionName}</span></td><td>{x.CustContact}</td><td>{x.BillAddress}</td><td>{x.BillCity}</td><td>{x.BillState}</td><td>{x.BillZip}</td>
                      <td className="actions"><button type="button" className="btn small ghost" onClick={() => setEditB(x)}>Edit</button><button type="button" className="btn small ghost danger" onClick={() => delBill(x)} aria-label={`Remove ${x.DivisionId} billing address`}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                  <tr className="new-row">
                    <td><select value={nb.DivisionId} onChange={(e) => setNb({ ...nb, DivisionId: e.target.value })} aria-label="New division"><option value="">Division…</option>{lk.divisions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}</select></td>
                    {[['CustContact', 'Contact'], ['BillAddress', 'Address'], ['BillCity', 'City'], ['BillState', 'ST'], ['BillZip', 'Zip']].map(([k, ph]) => <td key={k}><input value={nb[k]} placeholder={ph} maxLength={k === 'BillState' ? 2 : 50} onChange={(e) => setNb({ ...nb, [k]: k === 'BillState' ? e.target.value.toUpperCase() : e.target.value })} aria-label={`New ${ph}`} /></td>)}
                    <td className="actions"><button type="button" className="btn small primary" disabled={!nb.DivisionId} onClick={addBill}><Plus size={13} /> Add</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <div className="panel-head"><h2>Jobs ({d.jobs.length})</h2><Link className="btn small" to={`/js/jobs/new?builder=${id}`}><Plus size={13} /> New job</Link></div>
            {!d.jobs.length ? <EmptyState title="No jobs for this builder yet" /> : (
              <div className="table-wrap flat">
                <table className="grid compact clickable">
                  <thead><tr><th>Job</th><th>Job #</th><th>Div</th><th>City</th><th>Status</th><th>Start</th><th className="num">Phases</th><th className="num">Lots</th></tr></thead>
                  <tbody>{d.jobs.map((j) => (
                    <tr key={j.JobId} tabIndex={0} onClick={() => nav(`/js/jobs/${j.JobId}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/js/jobs/${j.JobId}`)}>
                      <td><b>{j.JobName}</b></td><td>{j.JobNum}</td><td>{j.DivisionId}</td><td>{j.City}</td><td>{j.Status && <Badge tone={statusTone(j.Status)}>{j.Status}</Badge>}</td>
                      <td>{fmtDate(j.StartDate)}</td><td className="num">{j.Phases}</td><td className="num">{j.Lots}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
