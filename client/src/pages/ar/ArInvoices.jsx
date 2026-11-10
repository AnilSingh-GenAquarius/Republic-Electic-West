// Invoices (Access ArInvoice / ArInvoiceManual / ArInvoice report): search, view, edit header and lines, manual invoices, print.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Download, Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate, toInputDate } from '../../format'
import { JobLotPicker, Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import Logo from '../../components/Logo'
import { ArTabs, LIENS, download, int, money, pct, today, typeTone, useArLookups } from './shared'

export function ArInvoices() {
  const lk = useArLookups()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState(p.search || '')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((x) => (n[x] === '' || n[x] == null) && delete n[x]); setSp(n) }
  useEffect(() => { const t = setTimeout(() => q !== (p.search || '') && set({ search: q }), 350); return () => clearTimeout(t) })  
  useEffect(() => {
    let live = true; setD(null); setError('')
    api('/ar/invoices', { params: p }).then((r) => live && setD(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  return (
    <div className="page">
      <PageHeader title="Invoices" subtitle="Every posted invoice, backcharge and credit"
        actions={<>
          <button className="btn" disabled={!d?.rows.length} onClick={() => download(d.rows, [['BillID', 'Invoice'], ['Date', 'Date'], ['BillType', 'Type'], ['CustName', 'Builder'], ['DivisionId', 'Div'], ['JobName', 'Job'], ['LotBlock', 'Lot'], ['Terms', 'Terms'], ['Total', 'Total']], 'invoices.csv')}><Download size={15} /> CSV</button>
          <Link className="btn primary" to="/ar/invoices/new"><Plus size={15} /> Manual invoice</Link>
        </>} />
      <ArTabs />
      <div className="card form report-filters"><fieldset>
        <label>From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>
        <label>Builder<select value={p.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">All</option>{lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Division<select value={p.division || ''} onChange={(e) => set({ division: e.target.value })}><option value="">All</option>{lk.divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Type<select value={p.typeId || ''} onChange={(e) => set({ typeId: e.target.value })}><option value="">All</option>{lk.billTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </fieldset></div>
      <div className="filters"><div className="search-wrap"><input type="search" placeholder="Invoice #, builder, job or lot…" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {d && <span className="muted">{int(d.total)} invoice(s) · {money(d.amount || 0)}</span>}</div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={10} cols={6} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Invoice</th><th>Date</th><th>Type</th><th>Builder</th><th>Div</th><th>Job</th><th>Lot</th><th>Terms</th><th className="num">Total</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.BillID} className="link-row" onClick={() => nav(`/ar/invoices/${r.BillID}`)}>
                  <td><a><b>{r.BillID}</b></a></td><td>{fmtDate(r.Date)}</td><td><Badge tone={typeTone(r.BillTypeId)}>{r.BillType || 'Invoice'}</Badge></td><td>{r.CustName}</td><td>{r.DivisionId}</td>
                  <td className="wrap">{r.JobName}</td><td>{r.LotBlock}</td><td>{r.Terms}</td><td className="num"><b>{money(r.Total)}</b></td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={9}><EmptyState title="No invoices match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />
        </>
      )}
    </div>
  )
}

export function ArInvoiceNew() {
  const nav = useNavigate()
  const lk = useArLookups()
  const [jl, setJl] = useState({})
  const [f, setF] = useState({ Date: today(), BillTypeId: '1', Terms: 'Net 30', Lien: 'Progress', Notes: '' })
  const [error, setError] = useState('')
  async function create(e) {
    e.preventDefault(); setError('')
    try { const r = await api('/ar/invoices', { method: 'POST', body: { ...f, LotId: jl.LotId } }); nav(`/ar/invoices/${r.id}`) } catch (err) { setError(err.message) }
  }
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ar/invoices">Invoices</Link>} title="Manual invoice" subtitle="For backcharges, credits and extras that are not billed from packs" />
      <ArTabs />
      <form className="card form" onSubmit={create}>
        <fieldset>
          <div className="span3"><JobLotPicker value={jl} onChange={setJl} showPack={false} /></div>
          <label>Date<input type="date" value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></label>
          <label>Type<select value={f.BillTypeId} onChange={(e) => setF({ ...f, BillTypeId: e.target.value })}>{lk.billTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Terms<select value={f.Terms} onChange={(e) => setF({ ...f, Terms: e.target.value })}>{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Lien release<select value={f.Lien} onChange={(e) => setF({ ...f, Lien: e.target.value })}>{LIENS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="span2">Notes<input maxLength={255} value={f.Notes} onChange={(e) => setF({ ...f, Notes: e.target.value })} /></label>
        </fieldset>
        {error && <ErrorState message={error} />}
        <div className="row form-actions"><button className="btn primary" disabled={!jl.LotId}><Plus size={15} /> Create invoice</button></div>
      </form>
    </div>
  )
}

export function ArInvoice() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useArLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [add, setAdd] = useState({ PackName: '', Quantity: '1', ValueEa: '', BillPercent: '100', Notes: '' })
  const [edit, setEdit] = useState(null)
  const load = useCallback(async () => {
    const r = await api(`/ar/invoices/${id}`); setD(r)
    const v = r.invoice
    setForm({ Date: toInputDate(v.Date), BillTypeId: String(v.BillTypeId || 1), Terms: v.Terms || '', Lien: v.Lien || '', BillNum: v.BillNum ?? '', CustContact: v.CustContact || '', BillAddress: v.BillAddress || '', BillCity: v.BillCity || '', BillState: v.BillState || '', BillZip: v.BillZip ?? '', Notes: v.Notes || '' })
  }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form?.[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const save = wrap(async (e) => { e.preventDefault(); await api(`/ar/invoices/${id}`, { method: 'PUT', body: form }) }, 'Invoice saved')
  const addLine = wrap(async (e) => { e.preventDefault(); await api(`/ar/invoices/${id}/items`, { method: 'POST', body: add }); setAdd({ PackName: '', Quantity: '1', ValueEa: '', BillPercent: '100', Notes: '' }) })
  const saveLine = wrap(async () => { await api(`/ar/invoice-items/${edit.id}`, { method: 'PUT', body: edit }); setEdit(null) })
  const delLine = wrap(async (iid) => { if (confirm('Remove this line? The invoice total is recalculated.')) await api(`/ar/invoice-items/${iid}`, { method: 'DELETE' }) })
  async function remove() { if (!confirm(`Delete invoice ${id} and all its lines? The lot can then be billed again.`)) return; try { await api(`/ar/invoices/${id}`, { method: 'DELETE' }); nav('/ar/invoices') } catch (e) { setError(e.message) } }
  const v = d?.invoice
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ar/invoices">Invoices</Link>} title={v ? `Invoice ${v.BillID} · ${v.CustName}` : 'Invoice'} track={!!v}
        subtitle={v ? [fmtDate(v.Date), v.JobName, v.LotBlock && `Lot ${v.LotBlock}`, v.DivisionId].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link className="btn" to="/ar/invoices"><ArrowLeft size={15} /> Invoices</Link>
          {v && <Link className="btn" to={`/ar/invoices/${id}/print`}><Printer size={15} /> Print</Link>}
          {v && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <ArTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={8} cols={3} /> : (
        <>
          <form className="card form" onSubmit={save}>
            <fieldset>
              <legend>Invoice <Badge tone={typeTone(v.BillTypeId)}>{v.BillType || 'Invoice'}</Badge> <b style={{ marginLeft: 8 }}>{money(v.Total)}</b></legend>
              <label>Date<input type="date" {...f('Date')} /></label>
              <label>Type<select {...f('BillTypeId')}>{lk.billTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Terms<select {...f('Terms')}><option value="" />{!lk.terms.some((t) => t.id === form.Terms) && form.Terms && <option>{form.Terms}</option>}{lk.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Lien release<select {...f('Lien')}><option value="" />{LIENS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Builder invoice #<input inputMode="numeric" {...f('BillNum')} /></label>
              <label>Contact<input maxLength={50} {...f('CustContact')} /></label>
              <label className="span2">Bill-to address<input maxLength={100} {...f('BillAddress')} /></label>
              <label>City<input maxLength={50} {...f('BillCity')} /></label>
              <label>State<input maxLength={2} {...f('BillState')} /></label>
              <label>ZIP<input inputMode="numeric" {...f('BillZip')} /></label>
              <label className="span3">Notes<input maxLength={255} {...f('Notes')} /></label>
            </fieldset>
            <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div>
          </form>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Lines ({d.items.length})</h2></div>
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Pack / description</th><th>Stage</th><th>Work</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Bill %</th><th className="num">Total</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {d.items.map((it) => edit?.id === it.BillItemID ? (
                  <tr key={it.BillItemID}>
                    <td className="wrap">{it.PackName}</td><td>{it.ScheduleStage}</td><td>{it.WorkType}</td>
                    <td className="num"><input className="cell-input" aria-label="Quantity" value={edit.Quantity} onChange={(e) => setEdit({ ...edit, Quantity: e.target.value })} /></td>
                    <td className="num"><input className="cell-input" aria-label="Value each" value={edit.ValueEa} onChange={(e) => setEdit({ ...edit, ValueEa: e.target.value })} /></td>
                    <td className="num"><input className="cell-input" aria-label="Bill percent" value={edit.BillPercent} onChange={(e) => setEdit({ ...edit, BillPercent: e.target.value })} /></td>
                    <td /><td><input className="cell-input wide" aria-label="Line notes" value={edit.Notes} onChange={(e) => setEdit({ ...edit, Notes: e.target.value })} /></td>
                    <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save line" onClick={saveLine}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
                  </tr>
                ) : (
                  <tr key={it.BillItemID}>
                    <td className="wrap"><b>{it.PackName}</b></td><td>{it.ScheduleStage}</td><td>{it.WorkType}</td><td className="num">{int(it.Quantity)}</td><td className="num">{money(it.ValueNum)}</td>
                    <td className="num">{pct(it.BillPercent)}</td><td className="num"><b>{money(it.TotalNum)}</b></td><td className="wrap">{it.Notes}</td>
                    <td className="row" style={{ gap: 4 }}>
                      <button className="btn small icon" aria-label="Edit line" onClick={() => setEdit({ id: it.BillItemID, Quantity: String(it.Quantity ?? ''), ValueEa: String(it.ValueNum ?? ''), BillPercent: String(Number(it.BillPercent ?? 0)), Notes: it.Notes || '' })}><Pencil size={13} /></button>
                      <button className="btn small icon" aria-label="Delete line" onClick={() => delLine(it.BillItemID)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
                <tr className="new-row">
                  <td><input aria-label="New line description" placeholder="Description *" value={add.PackName} onChange={(e) => setAdd({ ...add, PackName: e.target.value })} /></td><td /><td />
                  <td className="num"><input className="cell-input" aria-label="New line quantity" value={add.Quantity} onChange={(e) => setAdd({ ...add, Quantity: e.target.value })} /></td>
                  <td className="num"><input className="cell-input" aria-label="New line value" placeholder="$" value={add.ValueEa} onChange={(e) => setAdd({ ...add, ValueEa: e.target.value })} /></td>
                  <td className="num"><input className="cell-input" aria-label="New line percent" value={add.BillPercent} onChange={(e) => setAdd({ ...add, BillPercent: e.target.value })} /></td>
                  <td /><td><input className="cell-input wide" aria-label="New line notes" value={add.Notes} onChange={(e) => setAdd({ ...add, Notes: e.target.value })} /></td>
                  <td><button className="btn small" disabled={!add.PackName || add.ValueEa === ''} onClick={addLine}><Plus size={13} /> Add</button></td>
                </tr>
              </tbody>
              <tfoot><tr><td colSpan={6}><b>Invoice total</b></td><td className="num"><b>{money(v.Total)}</b></td><td colSpan={2} /></tr></tfoot>
            </table></div>
          </section>
        </>
      )}
    </div>
  )
}

export function ArInvoicePrint() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/ar/invoices/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  if (error) return <div className="page"><ErrorState message={error} /></div>
  if (!d) return <div className="page"><SkeletonRows rows={8} cols={3} /></div>
  const v = d.invoice
  return (
    <div className="page">
      <div className="row no-print" style={{ gap: 8, marginBottom: 12 }}><Link className="btn" to={`/ar/invoices/${id}`}><ArrowLeft size={15} /> Back</Link><button className="btn primary" onClick={() => window.print()}><Printer size={15} /> Print</button></div>
      <div className="po-sheet ar-sheet">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12 }}><Logo size={64} /><div><h2 style={{ margin: 0 }}>Republic Electric West</h2><div className="muted">Division {v.DivisionId}</div></div></div>
          <div style={{ textAlign: 'right' }}><h2 style={{ margin: 0 }}>{(v.BillType || 'Invoice').toUpperCase()}</h2><div>No. <b>{v.BillID}</b></div><div>Date {fmtDate(v.Date)}</div>{v.Terms && <div>Terms {v.Terms}</div>}</div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 20, gap: 24, flexWrap: 'wrap' }}>
          <div><div className="muted">Bill to</div><b>{v.CustName}</b>{v.CustContact && <div>Attn: {v.CustContact}</div>}<div>{v.BillAddress}</div><div>{[v.BillCity, v.BillState, v.BillZip].filter(Boolean).join(' ')}</div></div>
          <div><div className="muted">Job</div><b>{v.JobName}</b>{v.JobNum && <div>Job # {v.JobNum}</div>}<div>Lot {v.LotBlock}</div>{d.lot && <div>{[d.lot.Address, d.lot.City, d.lot.State].filter(Boolean).join(', ')}</div>}</div>
        </div>
        <table className="grid compact" style={{ marginTop: 20 }}>
          <thead><tr><th>Description</th><th>Stage</th><th className="num">Qty</th><th className="num">Value</th><th className="num">%</th><th className="num">Amount</th></tr></thead>
          <tbody>{d.items.map((it) => <tr key={it.BillItemID}><td>{it.PackName}{it.WorkType && it.WorkType !== 'Default' ? ` · ${it.WorkType}` : ''}{it.Notes ? <div className="muted">{it.Notes}</div> : null}</td><td>{it.ScheduleStage}</td><td className="num">{int(it.Quantity)}</td><td className="num">{money(it.ValueNum)}</td><td className="num">{pct(it.BillPercent)}</td><td className="num">{money(it.TotalNum)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}><b>Total due</b></td><td className="num"><b>{money(v.Total)}</b></td></tr></tfoot>
        </table>
        {v.Lien && <p className="muted" style={{ marginTop: 16 }}>{v.Lien} lien release.</p>}
        {v.Notes && <p>{v.Notes}</p>}
      </div>
    </div>
  )
}
