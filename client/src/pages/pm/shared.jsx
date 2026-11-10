import { useEffect, useState } from 'react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'

export { int, download } from '../po/shared'

export function PmTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/pm', label: 'Overview', end: true },
      { to: '/pm/customers', label: 'Customers & bids' },
      { to: '/pm/tools', label: 'Copy & bulk edit' },
      { to: '/pm/reports', label: 'Reports' },
    ]} />
  )
}

let cache = null
export function usePmLookups() {
  const [lk, setLk] = useState(cache || { statuses: [], jobTypes: [], divisions: [], jurisdictions: [], packTypes: [], stages: [], works: [], gears: [], substitutions: [], costCodes: [], scheduleStages: [] })
  useEffect(() => { if (!cache) api('/pm/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) }))
export const money4 = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
export const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
export const yes = (v) => (v === true || v === 1 || v === -1)

// Cascading picker: customer → job → bid → plan → pack. `levels` says how deep to go; value = { customerId, jobId, contractId, planId, packId }
export function PmCascade({ value, onChange, levels = 3, labels = {}, prefix = '' }) {
  const [opts, setOpts] = useState({ customers: [], jobs: [], contracts: [], plans: [], packs: [] })
  const v = value || {}
  useEffect(() => { api('/pm/pick/customers', { params: { search: '' } }).then((customers) => setOpts((o) => ({ ...o, customers }))).catch(() => {}) }, [])
  useEffect(() => { setOpts((o) => ({ ...o, jobs: [] })); if (v.customerId) api('/pm/pick/jobs', { params: { customerId: v.customerId } }).then((jobs) => setOpts((o) => ({ ...o, jobs }))).catch(() => {}) }, [v.customerId])
  useEffect(() => { setOpts((o) => ({ ...o, contracts: [] })); if (v.jobId && levels >= 3) api('/pm/pick/contracts', { params: { jobId: v.jobId } }).then((contracts) => setOpts((o) => ({ ...o, contracts }))).catch(() => {}) }, [v.jobId, levels])
  useEffect(() => { setOpts((o) => ({ ...o, plans: [] })); if (v.contractId && levels >= 4) api('/pm/pick/plans', { params: { contractId: v.contractId } }).then((plans) => setOpts((o) => ({ ...o, plans }))).catch(() => {}) }, [v.contractId, levels])
  useEffect(() => { setOpts((o) => ({ ...o, packs: [] })); if (v.planId && levels >= 5) api('/pm/pick/packs', { params: { planId: v.planId } }).then((packs) => setOpts((o) => ({ ...o, packs }))).catch(() => {}) }, [v.planId, levels])
  const sel = (key, label, list, patch, disabled) => (
    <label>{labels[key] || label}
      <select aria-label={`${prefix}${labels[key] || label}`} value={v[key] || ''} disabled={disabled} onChange={(e) => onChange({ ...v, [key]: e.target.value, ...patch })}>
        <option value="">{disabled ? '—' : 'Choose…'}</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o.name}{o.Lock ? ' 🔒' : ''}</option>)}
      </select>
    </label>
  )
  return (
    <>
      {sel('customerId', 'Customer', opts.customers, { jobId: '', contractId: '', planId: '', packId: '' })}
      {levels >= 2 && sel('jobId', 'Job', opts.jobs, { contractId: '', planId: '', packId: '' }, !v.customerId)}
      {levels >= 3 && sel('contractId', 'Bid', opts.contracts, { planId: '', packId: '' }, !v.jobId)}
      {levels >= 4 && sel('planId', 'Plan', opts.plans, { packId: '' }, !v.contractId)}
      {levels >= 5 && sel('packId', 'Pack', opts.packs, {}, !v.planId)}
    </>
  )
}
