import RptPrebillDetail from './RptPrebillDetail'
import RptPrebillSummary from './RptPrebillSummary'
import RptLotPackToBill from './RptLotPackToBill'
import RptLotPackTypeToBill from './RptLotPackTypeToBill'
import RptLotsByPlan from './RptLotsByPlan'
import RptBillingBySuper from './RptBillingBySuper'
import RptLotBilling from './RptLotBilling'
import RptLotBillingTM from './RptLotBillingTM'

export const BILLING_REPORTS = [
  { key: 'prebill-detail', label: 'Pre billing detail', access: 'Pre billing detail', accessObject: 'ArTempBillDetail', letters: ['A', 'I'], required: ['division'], text: 'Every line of the pre-billing snapshot by customer and invoice, with invoice and customer totals', Component: RptPrebillDetail },
  { key: 'prebill-summary', label: 'Pre billing summary', access: 'Pre billing summary', accessObject: 'ArTempBillSumm', letters: ['A', 'I'], required: ['division'], text: 'One line per pre-billed lot with the invoice total, by customer', Component: RptPrebillSummary },
  { key: 'lot-pack-to-bill', label: 'Lot-pack to bill', access: 'Lot-pack to bill', accessObject: 'ArLotPackToBill', letters: ['A', 'E', 'F', 'I'], required: ['division', 'from', 'to'], text: 'Packs with payroll in the period: contract value, billed so far and what remains, with payroll pop-ups', Component: RptLotPackToBill },
  { key: 'lot-pack-type-to-bill', label: 'Lot-pack by type to bill', access: 'Lot-pack by type to bill', accessObject: 'ArLotPackTypeToBill', letters: ['A', 'E', 'F', 'G', 'I'], required: ['division', 'from', 'to', 'packTypeId'], text: 'Packs of one pack type whose first payroll falls in the period, with contract value', Component: RptLotPackTypeToBill },
  { key: 'lots-by-plan', label: 'Lots by plan', access: 'Lots by plan', accessObject: 'ArLotsByPlan', letters: ['A', 'B', 'K'], required: ['jobId', 'planId'], text: 'Lots of a job that use a plan, by phase and bid', Component: RptLotsByPlan },
  { key: 'billing-by-super', label: 'Billing by super', access: 'Billing by super', accessObject: 'ArBillingBySuper', letters: ['H', 'I'], required: ['date', 'division'], text: 'Standard concepts claimed in the payroll week, by superintendent, for signature', Component: RptBillingBySuper },
  { key: 'lot-billing', label: 'Total billing by lot', access: 'Total billing by lot', accessObject: 'ArLotBilling', letters: ['A', 'B', 'C'], required: ['lotId'], text: 'Contract value of each pack of a lot against its invoices, with balance', Component: RptLotBilling },
  { key: 'lot-billing-tm', label: 'Total billing by lot (T&M)', access: 'T&M', accessObject: 'ArLotBillingTM#', letters: ['A', 'B', 'C'], required: ['lotId'], text: 'Same as total billing by lot, with the T&M number of each pack', Component: RptLotBillingTM },
]
