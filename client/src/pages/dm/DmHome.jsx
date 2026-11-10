// Database maintenance – Functions tab of Access SwitchDM: price updates, posting fixes for a lot, delete lot invoices,
// change payroll dates and load vendor prices. The filter boxes at the top feed every button, as on the switchboard.
import { useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, DollarSign, FileX, Send, Upload } from 'lucide-react'
import { api } from '../../api'
import { ErrorState, PageHeader } from '../../components/ui'
import { DmFilters, DmTabs, int, money, useDmParams } from './shared'

export default function DmHome() {
  const [p, set] = useDmParams()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [low, setLow] = useState(null)
  const [paste, setPaste] = useState('')
  const [mism, setMism] = useState(null)
  async function run(key, question, fn) {
    if (question && !confirm(question)) return
    setBusy(key); setError(''); setMsg(''); setMism(null)
    try { setMsg(await fn()) } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const post = (path, body) => api(path, { method: 'POST', body })
  const lotBody = { lotId: p.lotId ? Number(p.lotId) : null, scheduleStageId: p.scheduleStageId ? Number(p.scheduleStageId) : null }
  const btn = (key, label, Icon, onClick, disabled = false, tone = '') => (
    <button className={`btn ${tone}`} disabled={!!busy || disabled} onClick={onClick}><Icon size={15} /> {busy === key ? 'Working…' : label}</button>
  )

  const actions = {
    prices: () => run('prices', 'Recalculate job cost, estimating and price book prices of every item from cost and mark-ups?', async () => {
      const r = await post('/dm/actions/update-item-prices'); setLow(r.low)
      return `Job cost price updated on ${int(r.jobCost)} item(s), estimating price on ${int(r.estimating)}, price book on ${int(r.priceBook)}. ${r.low.length} active item(s) are priced below cost (listed below).`
    }),
    assembly: () => run('assembly', 'Set the estimating price of every assembly material line from its item (labor items: labor cost)?', async () => {
      const r = await post('/dm/actions/update-assembly-prices'); return `${int(r.updated)} assembly material line(s) re-priced.`
    }),
    materialOnly: () => run('materialOnly', 'Post the material of this lot at this schedule stage to job cost, mark the stage posted and set every pack as posted?', async () => {
      const r = await post('/dm/actions/post-material-only', lotBody)
      return `${int(r.jobCostLines)} job cost line(s) added, ${int(r.stagesPosted)} stage(s) marked posted, ${int(r.packsUpdated)} pack(s) set as posted, ${int(r.valuesAdded)} contract value line(s) added.`
    }),
    newMaterial: () => run('newMaterial', 'Add the material added in Plan management after this lot was posted to the material list of this stage?', async () => {
      const r = await post('/dm/actions/post-new-material', lotBody); return `${int(r.materialLines)} material line(s) added to the lot's material list ("Material pack added late to PM").`
    }),
    unposted: () => run('unposted', `Post the unposted material of this lot at this stage to job cost with date ${p.fromDate || '—'}?`, async () => {
      const r = await post('/dm/actions/post-unposted-pack', { ...lotBody, date: p.fromDate })
      return `${int(r.jobCostLines)} job cost line(s) added and ${int(r.tempLinesCleared)} material list line(s) cleared.`
    }),
    invoices: () => run('invoices', 'Delete EVERY invoice of this lot (bills and their items)? This cannot be undone.', async () => {
      const r = await post('/dm/actions/delete-lot-invoices', { lotId: lotBody.lotId }); return `Invoices deleted: ${int(r.invoices)} invoice(s) with ${int(r.items)} item(s).`
    }),
    payroll: (kind) => run(`payroll-${kind}`, `Move every in-process ${kind} payroll entry of division ${p.division || '—'} dated ${p.fromDate || '—'} to ${p.toDate || '—'}?`, async () => {
      const r = await post('/dm/actions/payroll-dates', { kind, division: p.division, fromDate: p.fromDate, toDate: p.toDate }); return `${int(r.updated)} ${kind} payroll entr${r.updated === 1 ? 'y' : 'ies'} moved.`
    }),
    vendor: () => run('vendor', null, async () => {
      const rows = parsePaste(paste)
      if (!rows.length) throw new Error('Paste the price rows first (item id, item #, part #, manufacturer, price)')
      const r = await post('/dm/actions/load-vendor-prices', { vendorId: p.vendorId ? Number(p.vendorId) : null, quoteDate: p.fromDate, rows })
      if (!r.loaded) { setMism(r.mismatched); throw new Error('These items and item ids do not match the ones in the system. Please correct them and try again. Price import process stopped.') }
      return `Quote prices have been loaded: ${int(r.updated)} vendor item(s) updated, ${int(r.added)} added.`
    }),
  }
  const lotReady = p.lotId && p.scheduleStageId
  return (
    <div className="page">
      <PageHeader title="Database maintenance" subtitle="Repairs and bulk changes. Choose the filters each button needs, then run it." />
      <DmTabs />
      <DmFilters p={p} set={set} fields={['customer', 'job', 'lot', 'stage', 'from', 'to', 'division', 'vendor']} />
      {error && <ErrorState message={error} />}
      {msg && <div className="success-state" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /> {msg}</div>}
      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>Prices</h2></div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{btn('prices', 'Update item prices', DollarSign, actions.prices)}{btn('assembly', 'Update assembly item prices', DollarSign, actions.assembly)}</div>
            <p className="muted small">Item prices: job cost = labor cost (labor items) or average cost for items set to update; estimating and price book prices follow their mark-ups.</p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Posting fixes</h2><span className="muted small">Needs job, lot and schedule stage</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {btn('materialOnly', 'Post material only to JC', Send, actions.materialOnly, !lotReady)}
            {btn('newMaterial', 'Post new material added PM', Send, actions.newMaterial, !lotReady)}
            {btn('unposted', 'Post unposted pack to JC', Send, actions.unposted, !lotReady || !p.fromDate)}
          </div>
          <p className="muted small">Post unposted pack uses “Date from” as the posting date and is refused for a closed lot.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Payroll dates</h2><span className="muted small">Division, date from → date to</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {btn('payroll-piece', 'Change piece payroll dates', CalendarClock, () => actions.payroll('piece'), !p.division || !p.fromDate || !p.toDate)}
            {btn('payroll-hourly', 'Change hourly payroll dates', CalendarClock, () => actions.payroll('hourly'), !p.division || !p.fromDate || !p.toDate)}
          </div>
          <p className="muted small">Changes the in-process payroll date of every piece / hourly entry of the division that has the “Date from” payroll date.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Lot invoices</h2><span className="muted small">Needs job and lot</span></div>
          <div className="row" style={{ gap: 8 }}>{btn('invoices', 'Delete lot invoices', FileX, actions.invoices, !p.lotId, 'danger')}</div>
          <p className="muted small"><AlertTriangle size={12} /> Deletes every AR invoice of the lot and its items.</p>
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Load vendor prices</h2><span className="muted small">Vendor + “Date from” as the quote date</span></div>
          <label className="field" style={{ display: 'block' }}>Price rows – paste from Excel: item id, item #, part #, manufacturer, price (a header row is skipped)
            <textarea aria-label="Price rows" rows={6} style={{ width: '100%', fontFamily: 'monospace' }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1234\tBX-MT-1G\tABC-1\tAcme\t3.25'} />
          </label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>{btn('vendor', 'Load vendor prices', Upload, actions.vendor, !p.vendorId || !p.fromDate || !paste.trim())}<span className="muted small">{parsePaste(paste).length} row(s) read</span></div>
          {mism && <div className="table-wrap" style={{ marginTop: 10 }}><table className="grid compact"><thead><tr><th>Item id</th><th>Item #</th></tr></thead>
            <tbody>{mism.map((m, i) => <tr key={i}><td>{m.ItemID}</td><td>{m.ItemNum}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {low && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2>Low estimating prices</h2><span className="muted small">{low.length} active item(s) whose estimating price is below last, average or labor cost</span></div>
          <div className="table-wrap"><table className="grid compact">
            <thead><tr><th>Class</th><th>Item</th><th>Code</th><th className="num">Last cost</th><th className="num">Average cost</th><th className="num">Labor cost</th><th className="num">Estimating price</th><th className="num">Mark-up %</th></tr></thead>
            <tbody>{low.slice(0, 500).map((r) => <tr key={r.InvItemID}><td>{r.InvClass}</td><td>{r.InvItem}</td><td>{r.CostCodeId}</td><td className="num">{money(r.LastCost)}</td><td className="num">{money(r.AverageCost)}</td><td className="num">{money(r.LaborCost)}</td><td className="num"><b>{money(r.EstimatingPrice)}</b></td><td className="num">{int(r.EstimatingPriceMkUp)}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </div>
  )
}

/** Tab- or comma-separated rows: ItemID, ItemNum, Part#, Manufacturer, Price. Rows whose first cell is not a number are skipped. */
function parsePaste(text) {
  return text.split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t') : l.split(','))).filter((c) => c.length >= 2 && /^\s*\d+\s*$/.test(c[0]))
    .map((c) => ({ ItemID: Number(c[0]), ItemNum: (c[1] || '').trim(), PartNum: (c[2] || '').trim(), Manufacturer: (c[3] || '').trim(), Price: (c[4] || '').trim() }))
}
