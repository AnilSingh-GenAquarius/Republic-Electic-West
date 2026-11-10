// CS setup: technicians (CsTechnician), assemblies (CsAssembly), master lists (LsCs* forms) and the read-only inventory item list.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { CsTabs, Options, int, money, num, pct, resetCsLookups, useCsLookups } from './shared'

const TABS = [['technicians', 'Technicians'], ['assemblies', 'Assemblies'], ['lists', 'Master lists'], ['items', 'Inventory items']]

export default function CsSetup() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'technicians'
  return (
    <div className="page">
      <PageHeader title="CS setup" subtitle="Technicians, assemblies, master lists and the inventory item list" />
      <CsTabs />
      <div className="seg" role="tablist" style={{ marginBottom: 14, maxWidth: '100%', overflowX: 'auto' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`seg-btn${tab === k ? ' active' : ''}`} onClick={() => setSp({ tab: k })}>{l}</button>)}
      </div>
      {tab === 'technicians' && <Technicians />}
      {tab === 'assemblies' && <Assemblies />}
      {tab === 'lists' && <Lists />}
      {tab === 'items' && <Items />}
    </div>
  )
}

function Technicians() {
  const lk = useCsLookups()
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState('1')
  const [f, setF] = useState({ EmployeeId: null, label: '', TechTypeId: '', Active: true })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => api('/cs/technicians', { params: { active: show } }).then(setRows).catch((e) => setError(e.message)), [show])
  useEffect(() => { load() }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { const r = await fn(...a); setMsg([ok, ...(r?.warnings || [])].filter(Boolean).join(' · ')); resetCsLookups(); await load() } catch (e) { setError(e.message) } }
  const add = run(async (e) => { e.preventDefault(); const r = await api('/cs/technicians', { method: 'POST', body: f }); setF({ EmployeeId: null, label: '', TechTypeId: '', Active: true }); return r }, 'Technician added')
  const upd = run(async (t, patch) => api(`/cs/technicians/${t.TechnicianID}`, { method: 'PUT', body: patch }), 'Technician saved')
  const del = run(async (t) => { if (confirm(`Delete technician ${t.Technician}?`)) await api(`/cs/technicians/${t.TechnicianID}`, { method: 'DELETE' }) }, '')
  return (
    <>
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <form className="card form" onSubmit={add}>
        <fieldset>
          <legend>Add technician</legend>
          <label className="span2">Employee *<SearchSelect endpoint="/common/employees" params={{ active: '0' }} value={f.EmployeeId} label={f.label} placeholder="Search employee…" onSelect={(r) => setF({ ...f, EmployeeId: r?.id ?? null, label: r?.name ?? '' })} /></label>
          <label>Technician type *<select value={f.TechTypeId} onChange={(e) => setF({ ...f, TechTypeId: e.target.value })}><Options list={lk.techTypes} /></select></label>
        </fieldset>
        <div className="row form-actions"><button className="btn primary" disabled={!f.EmployeeId || !f.TechTypeId}><Plus size={15} /> Add technician</button></div>
      </form>
      <div className="filters" style={{ marginTop: 16 }}>
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}><option value="1">Active technicians</option><option value="0">Inactive technicians</option><option value="">All technicians</option></select>
        {rows && <span className="muted">{rows.length} technician(s)</span>}
      </div>
      {!rows ? <SkeletonRows rows={8} cols={4} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>ID</th><th>Technician</th><th>Div</th><th>Type</th><th>Active</th><th className="num">Visits</th><th>Last visit</th><th>Entered</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.TechnicianID}>
                <td>{t.TechnicianID}</td><td>{t.Technician}{t.DateTermination && <> <Badge tone="red">Terminated {fmtDate(t.DateTermination)}</Badge></>}</td><td>{t.DivisionId}</td>
                <td><select aria-label="Technician type" value={t.TechTypeId ?? ''} onChange={(e) => upd(t, { TechTypeId: e.target.value })}><Options list={lk.techTypes} /></select></td>
                <td><input type="checkbox" aria-label="Active" style={{ width: 'auto' }} checked={!!t.Active} onChange={(e) => upd(t, { Active: e.target.checked })} /></td>
                <td className="num">{int(t.Visits)}</td><td>{fmtDate(t.LastVisit) || '—'}</td><td className="cs-mini">{fmtDate(t.DateEntered)} {t.UserEntered}</td>
                <td><button className="btn small icon" aria-label="Delete technician" onClick={() => del(t)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9}><EmptyState title="No technicians" /></td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  )
}

function Assemblies() {
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api('/cs/assemblies').then(setRows).catch((e) => setError(e.message)) }, [])
  async function add(e) {
    e.preventDefault(); setError('')
    try { const r = await api('/cs/assemblies', { method: 'POST', body: { AssemblyName: name, SalePrice: price } }); nav(`/cs/assemblies/${r.id}`) } catch (err) { setError(err.message) }
  }
  return (
    <>
      {error && <ErrorState message={error} />}
      <form className="cs-inline card" onSubmit={add} style={{ marginBottom: 14 }}>
        <label>New assembly<input maxLength={50} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label style={{ flexBasis: 110 }}>Sale price<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <button className="btn primary" disabled={!name.trim()}><Plus size={14} /> New assembly</button>
      </form>
      {!rows ? <SkeletonRows rows={4} cols={5} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>Assembly</th><th className="num">Items</th><th className="num">Sale price</th><th className="num">Est cost</th><th className="num">Est profit</th><th className="num">Actual cost</th><th className="num">Actual profit %</th><th>Prices updated</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.CsAssemblyID} className="link-row" onClick={() => nav(`/cs/assemblies/${a.CsAssemblyID}`)}>
                <td><a><b>{a.AssemblyName}</b></a></td><td className="num">{int(a.Items)}</td><td className="num">{money(a.SalePrice)}</td><td className="num">{money(a.EstCost)}</td><td className="num">{money(a.EstProfit)}</td>
                <td className="num">{money(a.ActualCost)}</td><td className="num">{pct(a.ActualProfitPct)}</td><td>{fmtDate(a.DateUpdated) || '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><EmptyState title="No assemblies" /></td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  )
}

export function CsAssembly() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [form, setForm] = useState(null)
  const [add, setAdd] = useState({ InvItemId: null, label: '', Quantity: '1', CostEa: '' })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => { const r = await api(`/cs/assemblies/${id}`); setD(r); setForm({ AssemblyName: r.assembly.AssemblyName || '', SalePrice: r.assembly.SalePrice ?? '' }) }, [id])
  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])
  const run = (fn, ok) => async (...a) => { setError(''); setMsg(''); try { await fn(...a); if (ok) setMsg(ok); await load() } catch (e) { setError(e.message) } }
  const save = run(async (e) => { e.preventDefault(); await api(`/cs/assemblies/${id}`, { method: 'PUT', body: form }) }, 'Assembly saved')
  const prices = run(async () => { const r = await api(`/cs/assemblies/${id}/update-prices`, { method: 'POST' }); setMsg(`Assembly prices updated (${r.updated} item(s))`) })
  const addItem = run(async (e) => { e.preventDefault(); await api(`/cs/assemblies/${id}/items`, { method: 'POST', body: add }); setAdd({ InvItemId: null, label: '', Quantity: '1', CostEa: '' }) })
  const upd = run(async (it, patch) => api(`/cs/assembly-items/${it.CsAsItemID}`, { method: 'PUT', body: patch }))
  const del = run(async (it) => { if (confirm(`Remove ${it.InvItem}?`)) await api(`/cs/assembly-items/${it.CsAsItemID}`, { method: 'DELETE' }) })
  async function remove() { if (!confirm('Delete this assembly and its items?')) return; try { await api(`/cs/assemblies/${id}`, { method: 'DELETE' }); nav('/cs/setup?tab=assemblies') } catch (e) { setError(e.message) } }
  const a = d?.assembly
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/setup?tab=assemblies">Assemblies</Link>} title={a ? a.AssemblyName : 'Assembly'} track={!!a}
        subtitle={a ? `Assembly #${a.CsAssemblyID} · ${a.ModuleOrigin || 'CS'}${a.DateUpdated ? ` · prices updated ${fmtDate(a.DateUpdated)}` : ''}` : null}
        actions={<>
          <Link className="btn" to="/cs/setup?tab=assemblies"><ArrowLeft size={15} /> Assemblies</Link>
          {a && <button className="btn" onClick={prices}><RefreshCw size={15} /> Update assembly price</button>}
          {a && <button className="btn danger" onClick={remove}><Trash2 size={15} /> Delete</button>}
        </>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      {!d ? <SkeletonRows rows={6} cols={3} /> : (
        <>
          <form className="card form" onSubmit={save}>
            <fieldset>
              <label className="span2">Assembly name *<input required maxLength={50} value={form.AssemblyName} onChange={(e) => setForm({ ...form, AssemblyName: e.target.value })} /></label>
              <label>Sale price<input inputMode="decimal" value={form.SalePrice} onChange={(e) => setForm({ ...form, SalePrice: e.target.value })} /></label>
            </fieldset>
            <div className="row form-actions"><button className="btn primary"><Save size={15} /> Save</button></div>
          </form>
          <div className="kpis" style={{ marginTop: 16 }}>
            <div className="stat-card"><div className="stat-label">Estimated cost</div><div className="stat-value">{money(a.EstCost)}</div><div className="stat-foot">Profit {money(a.EstProfit)} · {pct(a.EstProfitPct)}</div></div>
            <div className="stat-card"><div className="stat-label">Actual cost (estimating price)</div><div className="stat-value">{money(a.ActualCost)}</div><div className="stat-foot">Profit {money(a.ActualProfit)} · {pct(a.ActualProfitPct)}</div></div>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Items ({d.items.length})</h2></div>
            <div className="table-wrap flat"><table className="grid compact">
              <thead><tr><th>Item</th><th>Class</th><th className="num">Qty</th><th className="num">Cost ea</th><th className="num">Ext cost</th><th className="num">Estimating price</th><th>Entered</th><th /></tr></thead>
              <tbody>
                {d.items.map((it) => (
                  <tr key={it.CsAsItemID}>
                    <td className="wrap">{it.InvItem}<div className="cs-mini">{it.Description}</div></td><td>{it.InvClass}</td>
                    <td className="num"><input className="cell-input" aria-label="Quantity" defaultValue={Number(it.Quantity)} key={`q${it.Quantity}`} onBlur={(e) => e.target.value !== String(Number(it.Quantity)) && upd(it, { Quantity: e.target.value })} /></td>
                    <td className="num"><input className="cell-input" aria-label="Cost each" defaultValue={Number(it.CostEa)} key={`c${it.CostEa}`} onBlur={(e) => e.target.value !== String(Number(it.CostEa)) && upd(it, { CostEa: e.target.value })} /></td>
                    <td className="num">{money(it.ExtCost)}</td><td className="num">{money(it.EstimatingPrice)}</td><td className="cs-mini">{fmtDate(it.DateEntered)} {it.UserEntered}</td>
                    <td><button className="btn small icon" aria-label="Remove item" onClick={() => del(it)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
                {!d.items.length && <tr><td colSpan={8} className="muted">No items yet</td></tr>}
              </tbody>
            </table></div>
            <form className="cs-inline" style={{ marginTop: 10 }} onSubmit={addItem}>
              <label style={{ flexBasis: 240 }}>Item<SearchSelect endpoint="/cs/items/search" value={add.InvItemId} label={add.label} placeholder="Search item…" onSelect={(r) => setAdd({ ...add, InvItemId: r?.id ?? null, label: r?.name ?? '', CostEa: r?.EstimatingPrice != null ? String(Number(r.EstimatingPrice)) : '' })} /></label>
              <label style={{ flexBasis: 70 }}>Qty<input inputMode="decimal" value={add.Quantity} onChange={(e) => setAdd({ ...add, Quantity: e.target.value })} /></label>
              <label style={{ flexBasis: 90 }}>Cost ea<input inputMode="decimal" value={add.CostEa} onChange={(e) => setAdd({ ...add, CostEa: e.target.value })} /></label>
              <button className="btn" disabled={!add.InvItemId}><Plus size={14} /> Add item</button>
            </form>
          </section>
        </>
      )}
    </div>
  )
}

const LISTS = [['apptTimes', 'Appointment times'], ['customerTypes', 'Customer types'], ['errors', 'Errors'], ['errorCategories', 'Error categories'], ['errorDetails', 'Error details'],
  ['jobTypes', 'Job types'], ['resolutions', 'Resolutions'], ['techTypes', 'Technician types'], ['ticketTypes', 'Ticket types']]

function Lists() {
  const lk = useCsLookups()
  const [name, setName] = useState('apptTimes')
  const [errorId, setErrorId] = useState('')
  const [catId, setCatId] = useState('')
  const [cats, setCats] = useState([])
  const [d, setD] = useState(null)
  const [add, setAdd] = useState({})
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const parentId = name === 'errorCategories' ? errorId : name === 'errorDetails' ? catId : ''
  const needsParent = (name === 'errorCategories' || name === 'errorDetails') && !parentId
  const load = useCallback(() => (needsParent ? Promise.resolve(setD({ rows: [], fields: [] })) : api(`/cs/lists/${name}`, { params: { parentId } }).then(setD).catch((e) => setError(e.message))), [name, parentId, needsParent])
  useEffect(() => { setD(null); setAdd({}); setEdit(null); load() }, [load])
  useEffect(() => { setCats([]); setCatId(''); if (errorId) api('/cs/lookups/error-categories', { params: { errorId } }).then(setCats).catch(() => {}) }, [errorId])
  const parentCol = name === 'errorCategories' ? 'ErrorId' : name === 'errorDetails' ? 'ErrorCatId' : null
  const run = (fn) => async (...a) => { setError(''); try { await fn(...a); resetCsLookups(); await load() } catch (e) { setError(e.message) } }
  const create = run(async (e) => { e.preventDefault(); await api(`/cs/lists/${name}`, { method: 'POST', body: { ...add, ...(parentCol ? { [parentCol]: parentId } : {}) } }); setAdd({}) })
  const save = run(async () => { const { id, ...b } = edit; await api(`/cs/lists/${name}/${id}`, { method: 'PUT', body: b }); setEdit(null) })
  const del = run(async (r) => { if (confirm('Delete this entry?')) await api(`/cs/lists/${name}/${r.id}`, { method: 'DELETE' }) })
  const fields = (d?.fields || []).filter((x) => x.col !== parentCol)
  const input = (fd, val, onChange) => fd.type === 'division'
    ? <select aria-label={fd.label} value={val ?? ''} onChange={(e) => onChange(e.target.value)}><Options list={lk.divisions} /></select>
    : fd.type === 'fk:LsStatus:StatusID'
      ? <select aria-label={fd.label} value={val ?? ''} onChange={(e) => onChange(e.target.value)}><Options list={lk.statuses} /></select>
      : <input aria-label={fd.label} inputMode={fd.type === 'text' ? undefined : 'decimal'} value={val ?? ''} onChange={(e) => onChange(e.target.value)} />
  const show = (fd, r) => (fd.type === 'fk:LsStatus:StatusID' ? lk.statuses.find((s) => s.id === r[fd.col])?.name : fd.type === 'num' ? num(r[fd.col]) : r[fd.col])
  return (
    <>
      <div className="filters">
        <select aria-label="List" value={name} onChange={(e) => setName(e.target.value)}>{LISTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {(name === 'errorCategories' || name === 'errorDetails') && <select aria-label="Error" value={errorId} onChange={(e) => setErrorId(e.target.value)}><Options list={lk.errors} blank="Choose error…" /></select>}
        {name === 'errorDetails' && <select aria-label="Error category" value={catId} onChange={(e) => setCatId(e.target.value)} disabled={!errorId}><Options list={cats} blank="Choose category…" /></select>}
      </div>
      {error && <ErrorState message={error} />}
      {needsParent ? <p className="muted">Choose the {name === 'errorDetails' ? 'error and category' : 'error'} first.</p> : !d ? <SkeletonRows rows={6} cols={3} /> : (
        <div className="table-wrap"><table className="grid compact">
          <thead><tr><th>ID</th>{fields.map((fd) => <th key={fd.col}>{fd.label}{fd.required ? ' *' : ''}</th>)}<th className="num">In use</th><th /></tr></thead>
          <tbody>
            {d.rows.map((r) => edit?.id === r.id ? (
              <tr key={r.id}>
                <td>{r.id}</td>{fields.map((fd) => <td key={fd.col}>{input(fd, edit[fd.col], (v) => setEdit({ ...edit, [fd.col]: v }))}</td>)}<td />
                <td className="row" style={{ gap: 4 }}><button className="btn small icon" aria-label="Save" onClick={save}><Save size={13} /></button><button className="btn small icon" aria-label="Cancel" onClick={() => setEdit(null)}><X size={13} /></button></td>
              </tr>
            ) : (
              <tr key={r.id}>
                <td>{r.id}</td>{fields.map((fd) => <td key={fd.col} className="wrap">{show(fd, r)}</td>)}<td className="num">{int(r.InUse)}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small icon" aria-label="Edit" onClick={() => setEdit({ id: r.id, ...Object.fromEntries(fields.map((fd) => [fd.col, r[fd.col] == null ? '' : String(r[fd.col])])) })}><Pencil size={13} /></button>
                  <button className="btn small icon" aria-label="Delete" disabled={r.InUse > 0} title={r.InUse > 0 ? 'In use' : 'Delete'} onClick={() => del(r)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            <tr className="new-row">
              <td />{fields.map((fd) => <td key={fd.col}>{input(fd, add[fd.col], (v) => setAdd({ ...add, [fd.col]: v }))}</td>)}<td />
              <td><button className="btn small" onClick={create}><Plus size={13} /> Add</button></td>
            </tr>
          </tbody>
        </table></div>
      )}
    </>
  )
}

function Items() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { setPage(1) }, [q])
  useEffect(() => {
    const t = setTimeout(() => api('/cs/items', { params: { search: q, page } }).then(setD).catch((e) => setError(e.message)), 300)
    return () => clearTimeout(t)
  }, [q, page])
  return (
    <>
      <div className="filters"><div className="search-wrap"><input type="search" aria-label="Search items" placeholder="Item, description, part #…" value={q} onChange={(e) => setQ(e.target.value)} /></div>{d && <span className="muted">{int(d.total)} item(s)</span>}</div>
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={8} cols={5} /> : (
        <>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Item</th><th>Description</th><th>Class</th><th>UOM</th><th>CC</th><th className="num">Job cost</th><th className="num">Estimating</th><th className="num">Labor cost</th></tr></thead>
            <tbody>
              {d.rows.map((i) => (
                <tr key={i.InvItemID} className="link-row" onClick={() => nav(`/cs/items/${i.InvItemID}`)}>
                  <td><a>{i.InvItem}</a></td><td className="wrap">{i.Description}</td><td>{i.InvClass}</td><td>{i.Uom}</td><td>{i.CostCodeId}</td><td className="num">{money(i.JobCostPrice)}</td><td className="num">{money(i.EstimatingPrice)}</td><td className="num">{money(i.LaborCost)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={8}><EmptyState title="No items match" /></td></tr>}
            </tbody>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
        </>
      )}
    </>
  )
}

export function CsItem() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api(`/cs/items/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const i = d?.item
  const row = (l, v) => <div><dt>{l}</dt><dd>{v ?? '—'}</dd></div>
  return (
    <div className="page">
      <PageHeader crumb={<Link to="/cs/setup?tab=items">Inventory items</Link>} title={i ? i.InvItem : 'Inventory item'} track={!!i} subtitle={i ? `Item #${i.InvItemID} · read only` : null}
        actions={<Link className="btn" to="/cs/setup?tab=items"><ArrowLeft size={15} /> Items</Link>} />
      <CsTabs />
      {error && <ErrorState message={error} />}
      {!d ? <SkeletonRows rows={6} cols={3} /> : (
        <>
          <section className="panel">
            <dl className="cs-dl">
              {row('Item name', i.InvItem)}{row('Paycheck name', i.AlternateCode)}{row('Description', i.Description)}{row('Class', i.InvClass)}{row('UOM', i.Uom)}{row('Units per', i.UnitsPer)}
              {row('Default part #', i.PartNum)}{row('Default manufacturer', i.Manufacturer)}{row('Default vendor', i.Vendor)}{row('Cost code', i.CostCode || i.CostCodeId)}{row('Default stage', i.DefaultStage)}{row('Default work', i.DefaultWork)}
              {row('Status', i.Status)}{row('Plan management only', i.PmItem ? 'Yes' : 'No')}{row('Billing by super report', i.BillBySuper ? 'Yes' : 'No')}{row('Last purchase', fmtDate(i.LastPurchase) || '—')}
            </dl>
          </section>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Prices</h2></div>
            <dl className="cs-dl">
              {row('Labor cost', money(i.LaborCost))}{row('Last cost', money(i.LastCost))}{row('Average cost', money(i.AverageCost))}{row('Job cost price', money(i.JobCostPrice))}
              {row('Estimating price', `${money(i.EstimatingPrice)} (mk up ${i.EstimatingPriceMkUp ?? '—'})`)}{row('VIP price', `${money(i.VipPrice)} (mk up ${i.VipPriceMkUp ?? '—'})`)}
              {row('Resi-PO price', `${money(i.ResidentialPoPrice)} (mk up ${i.ResidentialPoPriceMkUp ?? '—'})`)}{row('Retail price', `${money(i.RetailPrice)} (mk up ${i.RetailPriceMkUp ?? '—'})`)}
            </dl>
            {i.Notes && <p className="muted" style={{ marginTop: 10 }}>{i.Notes}</p>}
          </section>
          <div className="cs-grid2" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head"><h2>Divisions</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <thead><tr><th>Division</th><th className="num">On hand</th><th className="num">Re order</th><th className="num">On order</th><th>Notes</th></tr></thead>
                <tbody>{d.divisions.map((x) => <tr key={x.InvDivisionID}><td>{x.DivisionId}</td><td className="num">{num(x.QtyOnHand)}</td><td className="num">{num(x.QtyReOrder)}</td><td className="num">{num(x.QtyOnOrder)}</td><td className="wrap">{x.Notes}</td></tr>)}
                  {!d.divisions.length && <tr><td colSpan={5} className="muted">None</td></tr>}</tbody>
              </table></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Vendors</h2></div>
              <div className="table-wrap flat"><table className="grid compact">
                <thead><tr><th>Vendor</th><th>Part #</th><th className="num">Default price</th><th className="num">Last price</th></tr></thead>
                <tbody>{d.vendors.map((x) => <tr key={x.VendItemID}><td>{x.Vendor}</td><td>{x.PartNum}</td><td className="num">{money(x.DefaultPrice)}</td><td className="num">{money(x.LastPrice)}</td></tr>)}
                  {!d.vendors.length && <tr><td colSpan={4} className="muted">None</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
