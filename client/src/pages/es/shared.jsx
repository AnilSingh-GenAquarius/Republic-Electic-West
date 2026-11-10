import { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'
import { api } from '../../api'
import ModuleTabs from '../../components/ModuleTabs'
import { SearchSelect } from '../../components/Pickers'

export { int, download } from '../po/shared'

export function EsTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/es', label: 'Overview', end: true },
      { to: '/es/customers', label: 'Customers & bids' },
      { to: '/es/transfer', label: 'Transfer to PM' },
      { to: '/es/assemblies', label: 'Master assemblies' },
      { to: '/es/items', label: 'Inventory items' },
      { to: '/es/research', label: 'Item research' },
      { to: '/es/job-log', label: 'Job history log' },
      { to: '/es/reports', label: 'Reports' },
    ]} />
  )
}

const EMPTY = { statuses: [], jobTypes: [], divisions: [], jurisdictions: [], packTypes: [], stages: [], works: [], cities: [], contractTypes: [], updateTypes: [], asGroups: [], invClasses: [], costCodes: [] }
let cache = null
export function useEsLookups() {
  const [lk, setLk] = useState(cache || EMPTY)
  useEffect(() => { if (!cache) api('/es/lookups').then((d) => { cache = d; setLk(d) }).catch(() => {}) }, [])
  return lk
}

export const money = (v, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) }))
export const money4 = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
export const pct = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)
export const yes = (v) => (v === true || v === 1 || v === -1)
export const bidLabel = (b) => (b ? `Bid ${b.BidNum ?? '?'}${b.EffectiveRelease?.trim() ? ` · ${b.EffectiveRelease.trim()}` : ''}` : 'Bid')
// money text columns ("$1,234.00", "($5.00)") → plain number string for inputs
export const moneyText = (v) => { if (v == null || v === '') return ''; const s = String(v).replace(/[$,\s]/g, ''); return /^\(.*\)$/.test(s) ? `-${s.slice(1, -1)}` : s }

/** A generic form section from a field list: [key, label, type ('text'|'num'|'date'|'check'|'select'|'area'), opts]. */
export function Fields({ fields, value, onChange, lk = {} }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return fields.map(([k, label, type = 'text', o = {}]) => {
    const cls = o.span ? `span${o.span}` : undefined
    if (type === 'check') return <label key={k} className="check"><input type="checkbox" checked={!!value[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
    if (type === 'select') return (
      <label key={k} className={cls}>{label}<select aria-label={label} value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">{o.blank ?? ''}</option>{(lk[o.list] || o.options || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    )
    if (type === 'area') return <label key={k} className={cls || 'span3'}>{label}<textarea aria-label={label} rows={o.rows || 2} maxLength={o.max || 255} value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></label>
    return <label key={k} className={cls}>{label}<input aria-label={label} type={type === 'date' ? 'date' : 'text'} inputMode={type === 'num' ? 'decimal' : undefined} maxLength={o.max} value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></label>
  })
}
/** Turn a record into form state for the given field list (dates → yyyy-mm-dd, money text → number, ids → strings). */
export function toForm(rec, fields) {
  const o = {}
  for (const [k, , type, opt = {}] of fields) {
    const v = rec?.[k]
    if (type === 'check') o[k] = yes(v)
    else if (type === 'date') o[k] = v ? String(v).slice(0, 10) : ''
    else if (opt.money) o[k] = moneyText(v)
    else o[k] = v == null ? '' : String(v).trim()
  }
  return o
}
export function FormCard({ legend, onSubmit, onCancel, children, saveLabel = 'Save', busy }) {
  return (
    <form className="card form pm-inline" onSubmit={onSubmit}><fieldset disabled={busy}>
      {legend && <legend>{legend}</legend>}
      {children}
    </fieldset><div className="row form-actions"><button className="btn primary" disabled={busy}><Save size={15} /> {saveLabel}</button>{onCancel && <button type="button" className="btn" onClick={onCancel}><X size={15} /> Cancel</button>}</div></form>
  )
}

// ---- field lists shared by the customer setup, assembly bid and material bid screens ----
export const JOB_FIELDS = [
  ['Job', 'Job *', 'text', { span: 2, max: 50 }], ['DivisionId', 'Division *', 'select', { list: 'divisions' }], ['JobTypeId', 'Job type *', 'select', { list: 'jobTypes' }],
  ['JobNumber', 'Job number', 'text', { max: 50 }], ['SpecLevel', 'Spec level', 'text', { max: 255 }], ['JurisdictionId', 'Jurisdiction', 'select', { list: 'jurisdictions' }],
  ['Address', 'Address', 'text', { span: 2, max: 255 }], ['City', 'City', 'text', { max: 50 }], ['State', 'State', 'text', { max: 2 }], ['Zip', 'Zip', 'text', { max: 20 }],
  ['EstStartDate', 'Est start date', 'date'], ['EstEndDate', 'Est end date', 'date'], ['UnitQty', 'Unit qty', 'num'], ['StatusId', 'Status', 'select', { list: 'statuses' }],
  ['Template', 'Template', 'check'], ['Notes', 'Job notes', 'text', { span: 3, max: 255 }],
]
export const BID_TABS = {
  'Bid data': [
    ['Date', 'Bid date', 'date'], ['BidNum', 'Bid number *', 'num'], ['EffectiveRelease', 'Effective release', 'text', { max: 50 }], ['EffectiveDate', 'Effective date', 'date'],
    ['Recipient', 'Recipient', 'text', { max: 50 }], ['Estimator', 'Estimator', 'text', { max: 50 }], ['StatusId', 'Status', 'select', { list: 'statuses' }],
    ['TaxPercent', 'Tax %', 'num'], ['ContMatPercent', 'Contingency material %', 'num'], ['ContLaborValue', 'Contingency labor $', 'num', { money: true }], ['BurdenLabor', 'Burden %', 'num'],
    ['OverheadPercent', 'Overhead %', 'num'], ['ProfitPercent', 'Profit %', 'num'], ['WrapPercent', 'Wrap %', 'num'], ['Discount', 'Discount %', 'num'],
    ['LtFixtureSupplier', 'Light fixture supplier', 'text', { max: 50 }], ['GearSupplier', 'Gear supplier', 'text', { max: 50 }], ['RoughPiecePrice', 'Rough piece $', 'num'], ['TrimPiecePrice', 'Trim piece $', 'num'],
  ],
  Notes: [['BidQuestions', 'Bid questions', 'area', { rows: 3 }], ['NotesPrivate', 'Notes (private)', 'area', { rows: 3 }]],
  'Features 1': [
    ['RecCanTrimType', 'Rec can trim type'], ['RecCanTrimLoc', 'Rec can trim loc'], ['HalfHot', 'Half hot'], ['MasterBed', 'Master bed'], ['SecondaryBed', 'Secondary bed'],
    ['FloWrap', 'Flo wrap'], ['FloStrip', 'Flo strip'], ['Switch', 'Switch'], ['Receptacle', 'Receptacle', 'text', { max: 50 }], ['AlarmPlug', 'Alarm plug', 'text', { max: 50 }],
    ['WaterSoftLoop', 'Water soft loop', 'text', { max: 50 }], ['RecircPump', 'Recirc pump', 'text', { max: 50 }], ['Dimmer', 'Dimmer', 'text', { max: 50 }], ['GarageCoachLight', 'Garage coach light', 'text', { max: 50 }], ['Chime', 'Chime'],
  ],
  'Features 2': [
    ['DoorbellPushButton', 'Doorbell push button', 'text', { max: 50 }], ['AddressLight', 'Address light', 'text', { max: 50 }], ['CeilingFanPrewireLoc', 'Ceiling fan prewire loc', 'text', { max: 50 }],
    ['PhoneWireType', 'Phone wire type', 'text', { max: 50 }], ['PhoneStdLoc', 'Phone std loc'], ['TvWireType', 'TV wire type', 'text', { max: 50 }], ['TvStdLoc', 'TV std loc'],
    ['SecurityAlarm', 'Security alarm', 'text', { max: 50 }], ['StructuredWiring', 'Structured wiring', 'text', { max: 50 }], ['OtherLowVolt', 'Other low volt'],
  ],
}
export const BID_FIELDS = Object.values(BID_TABS).flat()
export const PLAN_TABS = {
  'Plan info': [
    ['PlanNum', 'Plan number *', 'text', { max: 50 }], ['PlanName', 'Plan name', 'text', { max: 50 }], ['SqFt', 'Sq ft', 'num'], ['Bedrooms', 'Bedrooms'], ['ACunits', 'AC units'],
    ['StatusId', 'Status', 'select', { list: 'statuses' }], ['ContractVal', 'Contract value $', 'num', { money: true }], ['ContractValAdj', 'Plan adjust $', 'num', { money: true }], ['Universal', 'Universal', 'check'],
  ],
  'Plan details': [
    ['GearSize', 'Gear size'], ['GearType', 'Gear type'], ['RiserLoc', 'Riser loc'], ['Island', 'Island'], ['FloorPlug', 'Floor plug'], ['Detached', 'Detached'],
    ['TvOutletQty', 'TV outlet qty'], ['TvCanType', 'TV can'], ['PhOutletQty', 'Phone outlet qty'], ['PhCanType', 'Phone can'], ['AC1WireBrkr', 'AC1 wire/brkr'], ['AC2WireBrkr', 'AC2 wire/brkr'],
    ['AC3WireBrkr', 'AC3 wire/brkr'], ['OvenWireBrkr', 'Oven wire/brkr'], ['OvenType', 'Oven type'], ['OvenLoc', 'Oven location'], ['CooktopWireBrkr', 'Cooktop wire/brkr'], ['ElectricDryer', 'Electric dryer'],
    ['GearPower', 'Gear power', 'check'],
  ],
}
export const PLAN_FIELDS = Object.values(PLAN_TABS).flat()
export const PACK_FIELDS = [
  ['PackTypeId', 'Pack type *', 'select', { list: 'packTypes' }], ['Quantity', 'Qty', 'num'], ['BuilderCode', 'Builder code', 'text', { max: 50 }],
  ['ContractVal', 'Contract value $', 'num', { money: true }], ['StatusId', 'Status', 'select', { list: 'statuses' }], ['Notes', 'Notes', 'text', { span: 3, max: 255 }],
]

/** Tabbed form state for a field-group map (bid / plan). */
export function TabbedFields({ tabs, value, onChange, lk }) {
  const names = Object.keys(tabs)
  const [tab, setTab] = useState(names[0])
  return (
    <>
      <div className="seg span3" style={{ marginBottom: 6 }}>{names.map((n) => <button type="button" key={n} className={`seg-btn${tab === n ? ' active' : ''}`} onClick={() => setTab(n)}>{n}</button>)}</div>
      <Fields fields={tabs[tab]} value={value} onChange={onChange} lk={lk} />
    </>
  )
}

/** Pack name type-ahead over the pack names used in Plan management (free text allowed). */
export function PackNameInput({ value, onChange, jobId }) {
  return (
    <label className="span2">Pack name *
      <span className="row" style={{ gap: 6 }}>
        <input aria-label="Pack name" maxLength={100} value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
        <span style={{ flex: 1 }}><SearchSelect endpoint="/es/pick/pack-names" params={jobId ? { jobId } : {}} value="" label="" placeholder="…or pick a PM pack name" onSelect={(r) => r && onChange(r.name)} /></span>
      </span>
    </label>
  )
}

/**
 * Assembly selection (Access EsSelectAssembly / EsSelectOptAssembly): group → type → tick assemblies with a quantity.
 * onAdd(items[{AsAssemblyId, Qty}]) ; requireQty = option packs (quantity must be > 0)
 */
export function AssemblySelector({ title, onAdd, onCancel, requireQty, busy }) {
  const lk = useEsLookups()
  const [g, setG] = useState('')
  const [t, setT] = useState('')
  const [types, setTypes] = useState([])
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState({}) // id -> { name, qty }
  useEffect(() => { setTypes([]); setT(''); if (g) api('/es/pick/types', { params: { groupId: g } }).then(setTypes).catch(() => {}) }, [g])
  useEffect(() => { setRows([]); if (t) api('/es/pick/assemblies', { params: { typeId: t } }).then(setRows).catch(() => {}) }, [t])
  const picked = Object.entries(sel)
  const toggle = (r, on) => setSel((s) => { const n = { ...s }; if (on) n[r.id] = { name: r.name, qty: n[r.id]?.qty ?? (requireQty ? '1' : '0') }; else delete n[r.id]; return n })
  const ok = picked.length && (!requireQty || picked.some(([, v]) => Number(v.qty) > 0))
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="form"><fieldset>
        <label>Assembly group<select aria-label="Assembly group" value={g} onChange={(e) => setG(e.target.value)}><option value="">Choose…</option>{lk.asGroups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Assembly type<select aria-label="Assembly type" value={t} disabled={!g} onChange={(e) => setT(e.target.value)}><option value="">Choose…</option>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </fieldset></div>
      {t && (
        <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}><table className="grid compact">
          <thead><tr><th>Select</th><th>Assembly</th><th>Description</th><th className="num">Items</th><th className="num">Quantity</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><input type="checkbox" aria-label={`Select ${r.name}`} checked={!!sel[r.id]} onChange={(e) => toggle(r, e.target.checked)} /></td><td>{r.name}</td><td className="wrap">{r.Description}</td><td className="num">{r.Items}</td>
              <td className="num">{sel[r.id] && <input aria-label={`Quantity ${r.name}`} inputMode="numeric" style={{ width: 80 }} value={sel[r.id].qty} onChange={(e) => setSel((s) => ({ ...s, [r.id]: { ...s[r.id], qty: e.target.value } }))} />}</td></tr>
          ))}{!rows.length && <tr><td colSpan={5} className="muted">No assemblies of this type</td></tr>}</tbody>
        </table></div>
      )}
      {picked.length > 0 && <p className="muted small">Selected: {picked.map(([, v]) => `${v.name} × ${v.qty || 0}`).join(' · ')}</p>}
      <div className="row form-actions">
        <button className="btn primary" disabled={!ok || busy} onClick={() => onAdd(picked.map(([id, v]) => ({ AsAssemblyId: Number(id), Qty: v.qty === '' ? 0 : v.qty })))}>{requireQty ? 'Add assembly material' : 'Add assemblies'}</button>
        <button className="btn" onClick={onCancel}><X size={15} /> Cancel</button>
      </div>
    </div>
  )
}

export const blankPlan = () => ({ ...toForm({}, PLAN_FIELDS), StatusId: '1' })
export const blankPack = (type = '2') => ({ ...toForm({}, PACK_FIELDS), PackName: '', PackTypeId: type, Quantity: '1', StatusId: '1' })
