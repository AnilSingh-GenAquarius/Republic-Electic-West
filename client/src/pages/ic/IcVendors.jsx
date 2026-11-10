import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Search, Trash2, Users } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { IcTabs, money, useIcLookups } from './shared'

export function IcVendors() {
  const nav = useNavigate()
  const lk = useIcLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => { const n = { ...p, ...patch, page: 1 }; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); setSp(n) }
  useEffect(() => { api('/ic/vendors', { params: { ...p, pageSize: 25 } }).then(setData).catch((e) => setError(e.message)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp.toString()])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (p.search || '')) set({ search }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  return (
    <div className="page">
      <PageHeader title="Vendors" subtitle="Suppliers, contacts and the items they quote" actions={<Link className="btn primary" to="/ic/vendors/new"><Plus size={15} /> New vendor</Link>} />
      <IcTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor, city or phone…" aria-label="Search vendors" /></div>
        <select value={p.categoryId || ''} onChange={(e) => set({ categoryId: e.target.value })} aria-label="Category"><option value="">All categories</option>{lk.vendorCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="seg">{[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, l]) => <button key={v} className={`seg-btn${(p.status || 'active') === v ? ' active' : ''}`} onClick={() => set({ status: v })}>{l}</button>)}</div>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={3} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Vendor</th><th>Category</th><th>City</th><th>Phone</th><th>Terms</th><th className="num">Items</th><th className="num">POs</th></tr></thead>
            <tbody>
              {data.rows.map((r) => <tr key={r.VendorID} onClick={() => nav(`/ic/vendors/${r.VendorID}`)} tabIndex={0} className={r.StatusId !== 1 ? 'dim' : ''}><td><b>{r.Vendor}</b></td><td>{r.Category}</td><td>{r.City}{r.State ? `, ${r.State}` : ''}</td><td>{r.Phone}</td><td>{r.PayTerms}</td><td className="num">{r.Items}</td><td className="num">{r.Pos}</td></tr>)}
              {!data.rows.length && <tr><td colSpan={7}><EmptyState icon={Users} title="No vendors match" /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

const EMPTY = { Vendor: '', CategoryId: '', PayTerms: '', FreeShipping: 0, Address: '', City: '', State: '', Zip: '', Phone: '', Fax: '', PayAs: '', PayAddress: '', PayCity: '', PayState: '', PayZip: '', PayPhone: '', PayFax: '', StatusId: 1, Notes: '' }

export function IcVendorDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const lk = useIcLookups()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [nc, setNc] = useState({ Name: '', Title: '', Office: '', Cell: '', Email: '', MainContact: false })
  const [editC, setEditC] = useState(null)

  const load = useCallback(async () => {
    if (isNew) { setForm(EMPTY); return }
    const r = await api(`/ic/vendors/${id}`)
    setD(r)
    const f = { ...EMPTY }; for (const k of Object.keys(EMPTY)) f[k] = r.vendor[k] ?? ''
    setForm(f)
  }, [id, isNew])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm((s) => ({ ...s, [k]: e.target.value })) })
  const wrap = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }

  async function save(e) {
    e.preventDefault(); setSaving(true); setError(''); setMsg('')
    try {
      const body = { ...form }; for (const k of ['CategoryId', 'FreeShipping', 'StatusId']) body[k] = body[k] === '' ? null : Number(body[k])
      if (isNew) { const r = await api('/ic/vendors', { method: 'POST', body }); nav(`/ic/vendors/${r.id}`, { replace: true }) } else { await api(`/ic/vendors/${id}`, { method: 'PUT', body }); setMsg('Vendor saved'); await load() }
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function remove() { if (!confirm(`Delete ${form.Vendor}?`)) return; try { await api(`/ic/vendors/${id}`, { method: 'DELETE' }); nav('/ic/vendors') } catch (e) { setError(e.message) } }
  const addC = wrap(async (e) => { e.preventDefault(); await api(`/ic/vendors/${id}/contacts`, { method: 'POST', body: nc }); setNc({ Name: '', Title: '', Office: '', Cell: '', Email: '', MainContact: false }) })
  const saveC = wrap(async () => { await api(`/ic/contacts/${editC.VendorContID}`, { method: 'PUT', body: editC }); setEditC(null) })
  const delC = wrap(async (cid) => { if (confirm('Remove this contact?')) await api(`/ic/contacts/${cid}`, { method: 'DELETE' }) })

  return (
    <div className="page">
      <PageHeader crumb={<Link to="/ic/vendors">Vendors</Link>} title={isNew ? 'New vendor' : form.Vendor || 'Vendor'} track={!isNew && !!d} actions={<Link className="btn" to="/ic/vendors"><ArrowLeft size={15} /> Vendors</Link>} />
      <IcTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}>{msg}</div>}
      <form className="card form" onSubmit={save}>
        <fieldset>
          <legend>Vendor</legend>
          <label className="span2">Name *<input required maxLength={50} {...f('Vendor')} /></label>
          <label>Category<select {...f('CategoryId')}><option value="" />{lk.vendorCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Status<select {...f('StatusId')}>{lk.statuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Payment terms<input maxLength={50} {...f('PayTerms')} /></label>
          <label>Free shipping over ($)<input type="number" min="0" {...f('FreeShipping')} /></label>
          <label className="span2">Address<input maxLength={50} {...f('Address')} /></label>
          <label>City<input maxLength={50} {...f('City')} /></label><label>State<input maxLength={50} {...f('State')} /></label><label>Zip<input maxLength={50} {...f('Zip')} /></label>
          <label>Phone<input maxLength={50} {...f('Phone')} /></label><label>Fax<input maxLength={50} {...f('Fax')} /></label>
        </fieldset>
        <fieldset>
          <legend>Pay to</legend>
          <label>Pay as<input maxLength={50} {...f('PayAs')} /></label><label className="span2">Address<input maxLength={50} {...f('PayAddress')} /></label>
          <label>City<input maxLength={50} {...f('PayCity')} /></label><label>State<input maxLength={50} {...f('PayState')} /></label><label>Zip<input maxLength={50} {...f('PayZip')} /></label>
          <label>Phone<input maxLength={50} {...f('PayPhone')} /></label><label>Fax<input maxLength={50} {...f('PayFax')} /></label>
          <label className="span3">Notes<textarea rows={2} maxLength={255} {...f('Notes')} /></label>
        </fieldset>
        <div className="row form-actions">
          <button className="btn primary" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create vendor' : 'Save changes'}</button>
          {!isNew && <button type="button" className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
          {d && <span className="muted small">Entered {fmtDate(d.vendor.DateEntered)} by {d.vendor.UserEntered || '—'}</span>}
        </div>
      </form>
      {d && (
        <div className="dash-grid">
          <section className="panel span-2">
            <div className="panel-head"><h2>Contacts ({d.contacts.length})</h2></div>
            <div className="table-wrap flat">
              <table className="grid compact">
                <thead><tr><th>Name</th><th>Title</th><th>Office</th><th>Cell</th><th>Email</th><th>Main</th><th /></tr></thead>
                <tbody>
                  {d.contacts.map((c) => editC?.VendorContID === c.VendorContID ? (
                    <tr key={c.VendorContID} className="row-selected">
                      {['Name', 'Title', 'Office', 'Cell', 'Email'].map((k) => <td key={k}><input value={editC[k] ?? ''} onChange={(e) => setEditC({ ...editC, [k]: e.target.value })} aria-label={k} /></td>)}
                      <td><input type="checkbox" checked={!!editC.MainContact} onChange={(e) => setEditC({ ...editC, MainContact: e.target.checked })} aria-label="Main contact" /></td>
                      <td className="actions"><button className="btn small primary" onClick={saveC}><Save size={13} /></button></td>
                    </tr>
                  ) : (
                    <tr key={c.VendorContID}><td><b>{c.Name}</b></td><td>{c.Title}</td><td>{c.Office}</td><td>{c.Cell}</td><td>{c.Email}</td><td>{c.MainContact ? <Badge tone="blue">Main</Badge> : ''}</td>
                      <td className="actions"><button className="btn small ghost" onClick={() => setEditC(c)} aria-label="Edit contact">Edit</button><button className="btn small ghost danger" onClick={() => delC(c.VendorContID)} aria-label="Remove contact"><Trash2 size={13} /></button></td></tr>
                  ))}
                  <tr className="new-row">
                    {['Name', 'Title', 'Office', 'Cell', 'Email'].map((k) => <td key={k}><input value={nc[k]} onChange={(e) => setNc({ ...nc, [k]: e.target.value })} placeholder={k} aria-label={`New ${k}`} /></td>)}
                    <td><input type="checkbox" checked={nc.MainContact} onChange={(e) => setNc({ ...nc, MainContact: e.target.checked })} aria-label="New main contact" /></td>
                    <td className="actions"><button className="btn small primary" disabled={!nc.Name.trim()} onClick={addC}><Plus size={13} /> Add</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recent POs</h2></div>
            {!d.recentPos.length ? <p className="muted small">No purchase orders.</p> : <table className="grid compact"><thead><tr><th>PO #</th><th>Date</th><th>Closed</th></tr></thead><tbody>{d.recentPos.map((r) => <tr key={r.PoNum}><td>{r.PoNum}</td><td>{fmtDate(r.PoDate)}</td><td>{fmtDate(r.DateClosed)}</td></tr>)}</tbody></table>}
          </section>
          <section className="panel span-2" style={{ gridColumn: '1 / -1' }}>
            <div className="panel-head"><h2>Items quoted ({d.items.length})</h2></div>
            {!d.items.length ? <p className="muted small">No item prices for this vendor.</p> : (
              <table className="grid compact"><thead><tr><th>Item</th><th>Description</th><th>Part #</th><th className="num">Default</th><th className="num">Last</th><th>Quoted</th></tr></thead>
                <tbody>{d.items.map((i) => <tr key={i.VendItemID}><td><Link to={`/ic/items/${i.InvItemId}`}>{i.InvItem}</Link></td><td className="wrap">{i.Description}</td><td>{i.PartNum}</td><td className="num">{money(i.DefaultPrice)}</td><td className="num">{money(i.LastPrice)}</td><td>{fmtDate(i.DateQuote)}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
