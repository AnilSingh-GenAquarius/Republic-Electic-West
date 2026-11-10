// Inventory transactions (adjustments) and inventory counts.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui'
import { IcTabs, int, money, money0, useIcLookups } from './shared'

export function IcTransactions() {
  const lk = useIcLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [add, setAdd] = useState({ division: '', item: null, typeId: '', quantity: '', notes: '' })
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  const load = useCallback(() => { setError(''); api('/ic/transactions', { params: { ...p, pageSize: 50 } }).then(setData).catch((e) => setError(e.message)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp.toString()])
  useEffect(load, [load])

  async function create(e) {
    e.preventDefault(); setError(''); setMsg('')
    try {
      await api('/ic/transactions', { method: 'POST', body: { division: add.division, invItemId: add.item?.id, typeId: add.typeId, quantity: add.quantity, notes: add.notes } })
      setMsg('Adjustment saved. It changes stock when you post it from the Overview ("Update now").'); setAdd((s) => ({ ...s, item: null, quantity: '', notes: '' })); load()
    } catch (err) { setError(err.message) }
  }
  async function del(id) { if (!confirm('Delete this unposted adjustment?')) return; try { await api(`/ic/transactions/${id}`, { method: 'DELETE' }); load() } catch (e) { setError(e.message) } }
  async function post() {
    const div = p.division || add.division
    if (!div) return setError('Choose a division to post')
    if (!confirm(`Post all pending transactions for ${div}?`)) return
    try { const r = await api('/ic/transactions/post', { method: 'POST', body: { division: div } }); setMsg(`${div}: ${r.posted} transactions posted; on-order updated on ${r.onOrderUpdated} items.`); load() } catch (e) { setError(e.message) }
  }
  const adjTypes = lk.transacTypes.filter((t) => ![1, 7].includes(t.id))

  return (
    <div className="page">
      <PageHeader title="Inventory transactions" subtitle="Adjustments you enter, plus purchases and pack material posted by the system"
        actions={<button className="btn primary" onClick={post}><Send size={15} /> Update on-hand &amp; on-order{p.division ? ` (${p.division})` : ''}</button>} />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <form className="card form" onSubmit={create}>
        <fieldset>
          <legend>New adjustment</legend>
          <label>Division *<select required value={add.division} onChange={(e) => setAdd({ ...add, division: e.target.value })}><option value="" />{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="span2">Item *<SearchSelect endpoint="/common/items" value={add.item?.id} label={add.item?.name} placeholder="Search item…" onSelect={(r) => setAdd({ ...add, item: r })} /></label>
          <label>Type *<select required value={add.typeId} onChange={(e) => setAdd({ ...add, typeId: e.target.value })}><option value="" />{adjTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.TransacModifier > 0 ? '+' : t.TransacModifier < 0 ? '−' : '0'})</option>)}</select></label>
          <label>Quantity *<input required inputMode="numeric" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} placeholder="whole number" /></label>
          <label className="span2">Notes<input maxLength={255} value={add.notes} onChange={(e) => setAdd({ ...add, notes: e.target.value })} /></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary" disabled={!add.item}><Plus size={15} /> Add adjustment</button><span className="muted small">Enter a positive quantity — the type decides whether stock goes up or down.</span></div>
      </form>

      <div className="filters">
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={p.typeId || ''} onChange={(e) => set({ typeId: e.target.value })} aria-label="Type"><option value="">All types</option>{lk.transacTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <div className="seg">{[['all', 'All'], ['no', 'Unposted'], ['yes', 'Posted']].map(([v, l]) => <button key={v} className={`seg-btn${(p.posted || 'all') === v ? ' active' : ''}`} onClick={() => set({ posted: v })}>{l}</button>)}</div>
        <label className="inline">From<input type="date" value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={{ width: 150 }} /></label>
        <label className="inline">To<input type="date" value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={{ width: 150 }} /></label>
        {p.itemId && <Badge tone="blue">Item #{p.itemId} <button className="chip-x" onClick={() => set({ itemId: '' })} aria-label="Clear item">×</button></Badge>}
      </div>
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid">
            <thead><tr><th>#</th><th>Date</th><th>Div</th><th>Item</th><th>Type</th><th className="num">Qty</th><th className="num">Value ea</th><th className="num">Ext value</th><th>Status</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.TransactionID}>
                  <td>{r.TransactionID}</td><td>{fmtDate(r.TransacDate)}</td><td>{r.DivisionId}</td><td><Link to={`/ic/items/${r.InvItemId}`}><b>{r.InvItem}</b></Link></td><td>{r.TransacType}</td>
                  <td className="num"><span className={r.Quantity < 0 ? 'text-danger' : ''}>{int(r.Quantity)}</span></td><td className="num">{money(r.Value, 4)}</td><td className="num">{money(r.ExtValue)}</td>
                  <td>{r.IcTransacPosted ? <Badge tone="green">Posted</Badge> : <Badge tone="amber">Waiting</Badge>}</td><td className="wrap">{r.Notes}</td>
                  <td className="actions">{!r.IcTransacPosted && <button className="btn small ghost danger" onClick={() => del(r.TransactionID)} aria-label="Delete"><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={11}><EmptyState title="No transactions match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

export function IcCounts() {
  const nav = useNavigate()
  const lk = useIcLookups()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ invDate: today, division: '', fromDate: '', toDate: today, notes: '' })
  const load = useCallback(() => api('/ic/counts').then((d) => setRows(d.rows)).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  async function create(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api('/ic/counts', { method: 'POST', body: f }); nav(`/ic/counts/${r.id}`) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Inventory counts" subtitle="Process a count (lists every active stocked item), enter counted quantities, then post" />
      <IcTabs />
      {error && <ErrorState message={error} />}
      <form className="card form" onSubmit={create}>
        <fieldset>
          <legend>Start a new count</legend>
          <label>Count date *<input type="date" required value={f.invDate} onChange={(e) => setF({ ...f, invDate: e.target.value })} /></label>
          <label>Division *<select required value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })}><option value="" />{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Activity from<input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></label>
          <label>Activity to<input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></label>
          <label className="span2">Notes<input maxLength={255} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary" disabled={busy}><ClipboardCheck size={15} /> {busy ? 'Processing…' : 'Process count'}</button><span className="muted small">Pending transactions for the division are posted first so the starting quantities are current.</span></div>
      </form>
      <div className="table-wrap">
        {!rows ? <div style={{ padding: 16 }}><SkeletonRows rows={5} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Date</th><th>Division</th><th>Activity period</th><th className="num">Lines</th><th className="num">Changed</th><th className="num">Difference value</th><th>Status</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.InventoryID} onClick={() => nav(`/ic/counts/${c.InventoryID}`)} tabIndex={0}>
                  <td><b>{fmtDate(c.InvDate)}</b></td><td>{c.DivisionId}</td><td>{fmtDate(c.FromDate)} – {fmtDate(c.ToDate)}</td><td className="num">{int(c.Lines)}</td><td className="num">{int(c.Changed ?? 0)}</td>
                  <td className="num">{money0(c.DiscrepancyValue)}</td><td>{c.Posted ? <Badge tone="green">Posted</Badge> : <Badge tone="amber">Open</Badge>}</td><td>{c.UserEntered}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><EmptyState title="No counts yet" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function IcCountDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const lk = useIcLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [edits, setEdits] = useState({})
  const [search, setSearch] = useState(p.search || '')
  const set = (patch) => { const n = { ...p, ...patch }; if (!('page' in patch)) delete n.page; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }

  const load = useCallback(() => { api(`/ic/counts/${id}`, { params: { ...p, pageSize: 50 } }).then(setD).catch((e) => setError(e.message)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, sp.toString()])
  useEffect(load, [load])
  useEffect(() => { const t = setTimeout(() => { if (search !== (p.search || '')) set({ search }) }, 300); return () => clearTimeout(t) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search])

  async function commit(line) {
    const v = edits[line.InventoryItemID]
    if (v === undefined) return
    try { await api(`/ic/counts/lines/${line.InventoryItemID}`, { method: 'PUT', body: { NewQty: v } }); setEdits((e) => { const n = { ...e }; delete n[line.InventoryItemID]; return n }); load() } catch (e) { setError(e.message) }
  }
  async function post() {
    if (!confirm(`Post this count?\n\nOn-hand quantities for ${d.count.DivisionId} will be replaced with the counted quantities (blank lines count as 0). This cannot be undone.`)) return
    try { const r = await api(`/ic/counts/${id}/post`, { method: 'POST' }); setMsg(`Count posted: ${r.updated} items updated.`); load() } catch (e) { setError(e.message) }
  }
  async function remove() { if (!confirm('Delete this count?')) return; try { await api(`/ic/counts/${id}`, { method: 'DELETE' }); nav('/ic/counts') } catch (e) { setError(e.message) } }

  const c = d?.count, s = d?.summary
  const posted = !!c?.Posted
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ic/counts">Counts</Link>} title={c ? `Count ${fmtDate(c.InvDate)} · ${c.DivisionId}` : 'Count'} track={false}
        subtitle={c ? `Activity ${fmtDate(c.FromDate)} – ${fmtDate(c.ToDate)}${c.Notes ? ` · ${c.Notes}` : ''}` : null}
        actions={<><Link className="btn" to="/ic/counts"><ArrowLeft size={15} /> Counts</Link><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
          {c && !posted && <><button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button><button className="btn primary" onClick={post}><Send size={15} /> Post count</button></>}</>} />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {c && <div className="kpis">
        <StatCard label="Status" tone={posted ? 'green' : 'amber'} value={posted ? 'Posted' : 'Open'} foot={`${int(s.lines)} items on the sheet`} />
        <StatCard label="Changed lines" tone="blue" value={int(s.changed ?? 0)} foot={s.blanks ? `${s.blanks} blank (count as 0 when posted)` : 'Counted quantity ≠ system'} onClick={() => set({ changed: p.changed === '1' ? '' : '1' })} />
        <StatCard label="System value" value={money0(s.currentValue)} foot="Before the count" />
        <StatCard label="Counted value" tone="green" value={money0(s.newValue)} foot={`Difference ${money0(Number(s.newValue) - Number(s.currentValue))}`} />
      </div>}
      <div className="filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or description…" style={{ maxWidth: 320 }} aria-label="Search lines" />
        <select value={p.classId || ''} onChange={(e) => set({ classId: e.target.value })} aria-label="Class"><option value="">All classes</option>{lk.invClasses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <label className="check"><input type="checkbox" checked={p.changed === '1'} onChange={(e) => set({ changed: e.target.checked ? '1' : '' })} /> Changed only</label>
      </div>
      <div className="table-wrap">
        {!d ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid compact">
            <thead><tr><th>Class</th><th>Item</th><th>Description</th><th className="num">Value ea</th><th className="num">System qty</th><th className="num">Counted</th><th className="num">Diff</th><th className="num">Diff value</th></tr></thead>
            <tbody>
              {d.rows.map((r) => {
                const val = edits[r.InventoryItemID] ?? (r.NewQty ?? '')
                return (
                  <tr key={r.InventoryItemID} className={r.DiffQty !== 0 ? 'row-selected' : ''}>
                    <td>{r.InvClass}</td><td><b>{r.InvItem}</b></td><td className="wrap">{r.Description}</td><td className="num">{money(r.Value, 4)}</td><td className="num">{int(r.CurrentQty)}</td>
                    <td className="num">{posted ? int(r.NewQty) : <input className="pct-input" inputMode="numeric" value={val} placeholder="blank = 0" onChange={(e) => setEdits((x) => ({ ...x, [r.InventoryItemID]: e.target.value }))} onBlur={() => commit(r)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Counted quantity for ${r.InvItem}`} />}</td>
                    <td className="num"><span className={r.DiffQty < 0 ? 'text-danger' : ''}>{r.DiffQty > 0 ? '+' : ''}{int(r.DiffQty)}</span></td><td className="num">{r.DiffQty ? money(r.DiffValue) : ''}</td>
                  </tr>
                )
              })}
              {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No lines match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(pg) => set({ page: pg })} />}
    </div>
  )
}
