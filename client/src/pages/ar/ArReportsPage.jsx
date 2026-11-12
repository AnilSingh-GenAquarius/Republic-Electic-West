// Accounts receivable reports, laid out like Management reports: pick a report card, only the filters
// that report needs appear below, and the report opens underneath. (Access switchboard: SwitchAR.)
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Boxes, ClipboardList, Clock3, Download, FileStack, FileText, Gauge, Layers, ListOrdered,
  Printer, Receipt, Send, UserCheck,
} from 'lucide-react'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader } from '../../components/ui'
import { ArTabs } from './shared'
import { BILLING_REPORTS } from './reportsBilling/registry'
import { WIP_REPORTS } from './reportsWip/registry'

const today = () => new Date().toISOString().slice(0, 10)
const yearStart = () => `${new Date().getFullYear()}-01-01`

// Filters (the Access A-M filters) -> request parameter, label and where its choices come from.
const FIELDS = {
  customerId: { label: 'Builder', list: 'customers' },
  jobId: { label: 'Job', list: 'jobs', parent: 'customerId' },
  lotId: { label: 'Lot', list: 'lots', parent: 'jobId' },
  phaseId: { label: 'Phase', list: 'phases', parent: 'jobId' },
  planId: { label: 'Plan', list: 'plans', parent: 'jobId' },
  packTypeId: { label: 'Pack type', list: 'packTypes' },
  division: { label: 'Division', list: 'divisions' },
  invoiceId: { label: 'Invoice', list: 'invoices' },
  tmId: { label: 'T&M order', list: 'tmOrders', parent: 'customerId' },
  from: { label: 'From', type: 'date' },
  to: { label: 'To', type: 'date' },
  date: { label: 'Date', type: 'date' },
  burden: { label: 'Burden %', type: 'number' },
}
const ORDER = ['customerId', 'jobId', 'lotId', 'phaseId', 'planId', 'packTypeId', 'division', 'invoiceId', 'tmId', 'from', 'to', 'date', 'burden']
const LETTER = { A: 'customerId', B: 'jobId', C: 'lotId', D: 'phaseId', E: 'from', F: 'to', G: 'packTypeId', H: 'date', I: 'division', J: 'invoiceId', K: 'planId', L: 'burden', M: 'tmId' }
const CHILDREN = { customerId: ['jobId', 'lotId', 'phaseId', 'planId', 'tmId', 'invoiceId'], jobId: ['lotId', 'phaseId', 'planId', 'tmId'], division: ['invoiceId'] }

// Reports that open an existing web screen instead of running here.
const LINKS = [
  { key: 'inv-date-div', label: 'Invoices by date / division', text: 'Invoice list for a date range and division, with export and print', icon: FileText, to: '/ar/invoices', group: 'Invoices' },
  { key: 'inv-summary', label: 'Invoice summary by date / division', text: 'Invoice totals by division, builder, job, month or day', icon: BarChart3, to: '/ar/reports/totals?kind=invoices&groupBy=division', group: 'Invoices' },
  { key: 'invoice', label: 'Invoice', text: 'Open an invoice and print it', icon: Receipt, to: '/ar/invoices', group: 'Invoices' },
]
const ICONS = {
  'prebill-detail': Send, 'prebill-summary': FileStack, 'lot-pack-to-bill': Boxes, 'lot-pack-type-to-bill': Layers, 'lots-by-plan': ClipboardList,
  'billing-by-super': UserCheck, 'lot-billing': Receipt, 'lot-billing-tm': Clock3, 'ar-wip': Gauge, 'ar-wip-export': Download,
  'ar-wip-timed': Clock3, 'ar-wip-lot': Gauge, 'ar-wip-tm': Gauge, 'ar-wip-tm-job': Gauge, 'ar-sequence-sheet': ListOrdered,
}
const GROUP_OF = (key) => (key.startsWith('prebill') ? 'Pre-billing' : key.startsWith('ar-wip') ? 'Work in progress' : key === 'ar-sequence-sheet' ? 'Other' : 'To bill and billing by lot')
const GROUPS = ['Invoices', 'Pre-billing', 'To bill and billing by lot', 'Work in progress', 'Other']

// The filters a report shows: everything it uses, plus the parents needed to pick them (builder -> job -> lot).
function shownFields(rep) {
  const s = new Set([...(rep.letters || []).map((l) => LETTER[l]), ...(rep.required || [])].filter(Boolean))
  for (const f of [...s]) { let p = FIELDS[f]?.parent; while (p) { s.add(p); p = FIELDS[p].parent } }
  return ORDER.filter((f) => s.has(f))
}

export default function ArReportsPage() {
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const reports = useMemo(() => [...BILLING_REPORTS, ...WIP_REPORTS].map((r) => ({ ...r, icon: ICONS[r.key] || FileText, group: GROUP_OF(r.key) })), [])
  const rep = reports.find((r) => r.key === p.report)
  const [lk, setLk] = useState({})
  const [lkError, setLkError] = useState('')
  const set = (patch) => {
    const n = { ...p, ...patch }
    for (const [k, v] of Object.entries(patch)) for (const c of CHILDREN[k] || []) if (!(c in patch) && v !== p[k]) delete n[c]
    Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k])
    setSp(n)
  }

  useEffect(() => {
    let live = true
    api('/ar/filter-lookups', { params: { customerId: p.customerId, jobId: p.jobId, division: p.division } })
      .then((d) => { if (live) { setLk(d); setLkError('') } })
      .catch((e) => live && setLkError(e.message))
    return () => { live = false }
  }, [p.customerId, p.jobId, p.division])

  const fields = rep ? shownFields(rep) : []
  const params = Object.fromEntries(fields.map((f) => [f, p[f]]).filter(([, v]) => v !== '' && v != null))
  const missing = rep ? (rep.required || []).filter((k) => !params[k]) : []
  const choose = (r) => {
    const patch = { report: r.key }
    const f = shownFields(r)
    if (f.includes('from') && !p.from) patch.from = yearStart()
    if (f.includes('to') && !p.to) patch.to = today()
    if (f.includes('date') && !p.date) patch.date = today()
    set(patch)
  }

  return (
    <div className="page">
      <PageHeader title="Accounts receivable reports" subtitle="Pick a report; the filters it needs appear below"
        actions={rep && !missing.length && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>} />
      <ArTabs />
      {lkError && <ErrorState message={lkError} />}

      <div className="no-print">
        {GROUPS.map((g) => {
          const links = LINKS.filter((r) => r.group === g)
          const reps = reports.filter((r) => r.group === g)
          if (!links.length && !reps.length) return null
          return (
            <section key={g} aria-label={g}>
              <h3 className="ar-group">{g}</h3>
              <div className="fm-reports">
                {links.map((r) => <Link key={r.key} to={r.to} className="fm-report"><r.icon size={18} /><span><b>{r.label} <ArrowRight size={12} /></b><small>{r.text}</small></span></Link>)}
                {reps.map((r) => <button key={r.key} className={`fm-report${p.report === r.key ? ' active' : ''}`} aria-pressed={p.report === r.key} onClick={() => choose(r)}><r.icon size={18} /><span><b>{r.label}</b><small>{r.text}</small></span></button>)}
              </div>
            </section>
          )
        })}
      </div>

      {rep && (
        <div className="card form report-filters no-print"><fieldset>
          {fields.map((f) => {
            const def = FIELDS[f]
            const opt = (rep.required || []).includes(f) ? '' : ' (optional)'
            const label = `${def.label}${opt}`
            if (def.list) {
              const off = def.parent && !p[def.parent]
              const opts = lk[def.list] || []
              return (
                <label key={f}>{label}
                  <select aria-label={def.label} value={p[f] || ''} disabled={off} onChange={(e) => set({ [f]: e.target.value })}>
                    <option value="">{off ? `Choose ${FIELDS[def.parent].label.toLowerCase()} first` : 'Choose…'}</option>
                    {opts.map((o) => <option key={o.id} value={f === 'planId' ? o.name : o.id}>{o.name}</option>)}
                  </select>
                </label>
              )
            }
            return <label key={f}>{label}<input aria-label={def.label} type={def.type === 'date' ? 'date' : 'number'} inputMode={def.type === 'number' ? 'decimal' : undefined} value={p[f] || ''} onChange={(e) => set({ [f]: e.target.value })} /></label>
          })}
        </fieldset></div>
      )}

      {!rep ? <EmptyState icon={ClipboardList} title="Choose a report" />
        : missing.length ? <EmptyState title={`Choose ${missing.map((m) => FIELDS[m].label.toLowerCase().replace(/^(from|to|date)$/, (x) => `a ${x} date`)).join(', ')}`} />
          : <div className="fm-sheet"><rep.Component params={params} /></div>}
    </div>
  )
}
