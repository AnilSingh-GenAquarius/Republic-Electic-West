// SwitchSA report buttons. `filters` lists the switchboard filters each report uses
// (Access letters: A customer, B job, D division, E from, F to, H schedule stage).
import { BarChart3, CalendarCheck, Globe2, Hammer, Layers, ListChecks, Receipt } from 'lucide-react'

export const REPORTS = [
  { key: 'sales-by-plan', label: 'Estimated sales by plan', icon: BarChart3, filters: ['customer', 'division', 'period', 'burden'], text: 'Standard & option billing vs cost per plan for lots started in the period' },
  { key: 'billing-by-lot', label: 'Billing & contract by lot', icon: Receipt, filters: ['customer', 'job', 'period'], text: 'Contract, revised contract and billing per lot and pack type' },
  { key: 'options', label: 'Options scheduled-lots', icon: ListChecks, filters: ['customer', 'job', 'period'], pick: true, text: 'Chosen option packs on the job\'s lots started in the period' },
  { key: 'global-options', label: 'Global options sold', icon: Globe2, filters: ['division', 'period'], pick: true, text: 'Chosen packs on every lot of the division started in the period' },
  { key: 'labor-paid', label: 'Labor paid div & stage', icon: Hammer, filters: ['division', 'period', 'stage'], pick: true, text: 'Lots with labor paid at a stage, with the chosen packs scheduled' },
  { key: 'lots-closed', label: 'Lots closed by date', icon: CalendarCheck, filters: ['division', 'period'], text: 'Lots whose end date falls in the period' },
  { key: 'lots-stage', label: 'Lots stage by date', icon: Layers, filters: ['division', 'period', 'stage'], text: 'Lots with a schedule stage delivered in the period' },
]
