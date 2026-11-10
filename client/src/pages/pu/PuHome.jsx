// Public: lot finder (Access SwitchPU boxes A / A1 / A2 + "Address lot search", report PuAddressSearchSimple).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapPin, Printer, Search } from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { PuTabs } from './shared'
import { LotSheet } from './PuReports'

export default function PuHome() {
  const [sp, setSp] = useSearchParams()
  const lotId = sp.get('lotId') || ''
  const [q, setQ] = useState(sp.get('q') || '')
  const [hits, setHits] = useState(null)
  const [lot, setLot] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setHits(null); return }
      api('/pu/pick/addresses', { params: { search: q.trim() } }).then(setHits).catch((e) => setError(e.message))
    }, 300)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    setLot(null); setError('')
    if (!lotId) return
    let live = true
    api('/pu/reports/address-lot', { params: { lotId } }).then((d) => live && setLot(d)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [lotId])
  const pick = (id) => setSp({ ...(q ? { q } : {}), lotId: String(id) })
  return (
    <div className="page">
      <PageHeader title="Public look-ups" subtitle="Find a lot by its address, then see its job, phase, bid, plan and packs"
        actions={lot?.length ? <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button> : null} />
      <PuTabs />
      <div className="filters no-print">
        <div className="search-wrap" style={{ flex: 1, maxWidth: 520 }}>
          <input type="search" aria-label="Lot address or house number" placeholder="Type part of the address or the house number…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <span className="muted small">Matches anywhere in the address (Access boxes A, A1 and A2 in one).</span>
      </div>
      {error && <ErrorState message={error} />}
      {hits && (
        <section className="panel no-print" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h2>Addresses</h2><span className="muted small">{hits.length === 100 ? 'First 100 matches – type more to narrow' : `${hits.length} match(es)`}</span></div>
          {!hits.length ? <EmptyState icon={Search} title="No lot has that address" /> : (
            <div className="table-wrap"><table className="grid compact">
              <thead><tr><th>Address</th><th>City</th><th>State</th><th>Job</th><th>Lot/block</th></tr></thead>
              <tbody>{hits.map((h) => (
                <tr key={h.id} className={`link-row${String(h.id) === lotId ? ' selected' : ''}`} onClick={() => pick(h.id)}>
                  <td><a><b>{h.Address}</b></a></td><td>{h.City}</td><td>{h.State}</td><td className="wrap">{h.JobName}</td><td>{h.LotBlock}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
      {!lotId ? (!hits && <EmptyState icon={MapPin} title="Search for an address">Every login can use these look-ups and the reports in the tabs above.</EmptyState>)
        : !lot ? <SkeletonRows rows={6} cols={4} />
          : <div className="fm-sheet"><LotSheet rows={lot} title="Address lot search" /></div>}
    </div>
  )
}
