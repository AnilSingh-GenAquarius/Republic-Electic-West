// Lots overview (search across all lots) and the lot sheet = Access report JsAddressSearchSimple ("Address lot search").
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarRange, Download, Home as HomeIcon, Pencil, Printer, Search } from 'lucide-react'
import { api } from '../../api'
import { fmtDate } from '../../format'
import { Pager, SearchSelect } from '../../components/Pickers'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { JsTabs, download, nextParams, useDebounced, useJsLookups } from './shared'

export function JsLots() {
  const nav = useNavigate()
  const lk = useJsLookups()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const [search, setSearch] = useState(p.search || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const set = (patch) => setSp(nextParams(p, patch))
  useEffect(() => {
    setError('')
    api('/js/lots', { params: { ...p, pageSize: 50 } }).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  useDebounced(search, (v) => { if (v !== (p.search || '')) set({ search: v }) })
  async function exportCsv() {
    try {
      const all = await api('/js/lots', { params: { ...p, page: 1, pageSize: 200 } })
      download(all.rows, [['CustName', 'Builder'], ['JobName', 'Job'], ['DivisionId', 'Div'], ['Phase', 'Phase'], ['LotBlock', 'Lot/Block'], ['PlanNum', 'Plan'], ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['Zip', 'Zip'], ['Permit', 'Permit'], ['StartDate', 'Start'], ['EndDate', 'End'], ['Status', 'Status']], 'lots.csv')
    } catch (e) { setError(e.message) }
  }
  const open = (id) => nav(`/js/lots/${id}`)
  return (
    <div className="page">
      <PageHeader title="Lots" subtitle="Find any lot by address, permit, lot number, job or builder"
        actions={<button className="btn" onClick={exportCsv} disabled={!data?.rows.length}><Download size={15} /> CSV (first 200)</button>} />
      <JsTabs />
      <div className="filters">
        <div className="search-wrap"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, permit, lot, job, builder…" aria-label="Search lots" /></div>
        <div style={{ minWidth: 220, flex: '1 1 220px' }}>
          <SearchSelect endpoint="/js/pick/jobs" value={p.jobId || null} label={p.jobName || ''} placeholder="Filter by job…"
            onSelect={(r) => set({ jobId: r ? String(r.id) : '', jobName: r ? r.name : '' })} />
        </div>
        <select value={p.division || ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division"><option value="">All divisions</option>{lk.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div className="seg" role="group" aria-label="Lot state">{[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(([v, l]) => (
          <button key={v} type="button" aria-pressed={(p.state || 'all') === v} className={`seg-btn${(p.state || 'all') === v ? ' active' : ''}`} onClick={() => set({ state: v === 'all' ? '' : v })}>{l}</button>))}</div>
      </div>
      {error && <ErrorState message={error} />}
      <div className="table-wrap">
        {!data ? <div style={{ padding: 16 }}><SkeletonRows rows={8} cols={4} /></div> : (
          <table className="grid clickable">
            <thead><tr><th>Lot/Block</th><th>Address</th><th>Builder</th><th>Job</th><th>Phase</th><th>Plan</th><th>Permit</th><th>Start</th><th>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.LotID} tabIndex={0} onClick={() => open(r.LotID)} onKeyDown={(e) => e.key === 'Enter' && open(r.LotID)} className={r.EndDate ? 'dim' : ''}>
                  <td><b>{r.LotBlock}</b></td><td>{[r.Address, r.City, r.State].filter(Boolean).join(', ')}</td><td>{r.CustName}</td><td>{r.JobName}</td><td>{r.Phase}</td>
                  <td>{r.PlanNum}</td><td>{r.Permit}</td><td>{fmtDate(r.StartDate)}</td>
                  <td>{r.EndDate ? <Badge>Closed {fmtDate(r.EndDate)}</Badge> : <Badge tone={r.Status === 'Active' ? 'green' : 'neutral'}>{r.Status}</Badge>}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={9}><EmptyState icon={HomeIcon} title="No lots match">Try a different search or filter.</EmptyState></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(pg) => setSp({ ...p, page: pg })} />}
    </div>
  )
}

export function JsLotDetail() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { setD(null); setError(''); api(`/js/lots/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  const l = d?.lot
  const kv = (label, v) => <><dt>{label}</dt><dd>{v || <span className="faint">—</span>}</dd></>
  return (
    <div className="page">
      <PageHeader track={!!l}
        crumb={<><Link to="/js/lots">Lots</Link>{l && <> / <Link to={`/js/jobs/${l.JobId}`}>{l.JobName}</Link> / <Link to={`/js/phases/${l.PhaseID}`}>Phase {l.Phase}</Link></>}</>}
        title={l ? `Lot ${l.LotBlock}` : 'Lot'} subtitle={l ? [l.Address, l.City, l.State, l.Zip].filter(Boolean).join(', ') : null}
        actions={<>
          {l && <Link className="btn" to={`/js/phases/${l.PhaseID}`}><Pencil size={15} /> Edit in phase</Link>}
          {l && <Link className="btn" to={`/sc/lots/${id}`}><CalendarRange size={15} /> Schedule</Link>}
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
          <Link className="btn" to="/js/lots"><ArrowLeft size={15} /> Lots</Link>
        </>} />
      <JsTabs />
      {error && <ErrorState message={error} />}
      {!d && !error ? <SkeletonRows rows={8} cols={2} /> : d && (
        <>
          <div className="js-grid2">
            <section className="panel">
              <div className="panel-head"><h2>Job</h2><span className="muted small">Code {l.Code}</span></div>
              <dl className="js-kv">
                {kv('Builder', <Link to={`/js/builders/${l.CustID}`}>{l.CustName}</Link>)}
                {kv('Job', <Link to={`/js/jobs/${l.JobId}`}>{l.JobName}</Link>)}
                {kv('Division', l.DivisionId)}
                {kv('Phase', <Link to={`/js/phases/${l.PhaseID}`}>{l.Phase}</Link>)}
                {kv('Phase start', fmtDate(l.PhaseStart))}
                {kv('Superintendents', [l.Super1, l.Super2].filter(Boolean).join(', '))}
                {kv('Bid', l.BidNum && `${l.BidNum}${l.BidRelease ? ' · eff. release ' + l.BidRelease : ''}`)}
                {kv('Bid name', l.BidName)}
                {kv('Bid eff. date', fmtDate(l.BidDate))}
              </dl>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Lot</h2>{l.EndDate ? <Badge>Closed</Badge> : <Badge tone={l.Status === 'Active' ? 'green' : 'neutral'}>{l.Status}</Badge>}</div>
              <dl className="js-kv">
                {kv('Plan', l.PlanNum && `${l.PlanNum}${l.PlanName ? ' – ' + l.PlanName : ''}`)}
                {kv('Address', [l.Address, l.City, l.State, l.Zip].filter(Boolean).join(', '))}
                {kv('Permit', l.Permit)}
                {kv('Lot start date', fmtDate(l.StartDate))}
                {kv('Lot end date', fmtDate(l.EndDate))}
                {kv('Warranty date', l.WarrantyDate)}
                {kv('Cox invoice', l.InvoiceNum)}
                {kv('Notes', l.LotNotes)}
                {kv('Entered', l.DateEntered && `${fmtDate(l.DateEntered)} by ${l.UserEntered || '—'}`)}
              </dl>
            </section>
          </div>
          <section className="card">
            <div className="panel-head"><h2>Packs / options ({d.packs.length})</h2></div>
            {!d.packs.length ? <EmptyState title="No packs scheduled on this lot" /> : (
              <div className="table-wrap flat">
                <table className="grid compact">
                  <thead><tr><th>Pack/option name</th><th>Builder option code</th><th className="num">Pack qty</th></tr></thead>
                  <tbody>{d.packs.map((p) => <tr key={p.PackID}><td>{p.PackName}</td><td>{p.BuilderCode}</td><td className="num">{p.PackQty}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
