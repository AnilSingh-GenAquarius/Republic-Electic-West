import {
  LayoutDashboard, ShieldCheck, Receipt, FileSignature, Headset, Calculator, Boxes, ShoppingCart,
  HardHat, CalendarClock, ClipboardList, Wallet, Clock3, BarChart3, Cable, Database, ClipboardCheck,
  Globe, TrendingUp,
} from 'lucide-react'

// The 18 modules on the Staffware v5.27 switchboard — same codes and names as Access.
// `code` matches the LoginUsers permission flag (PU "Public" is open to every user).
// `ready` = built in the web app. `screens` = what exists (shown on module cards).
export const MODULES = [
  // Operations
  { code: 'JS', name: 'Job setup', path: '/js', icon: HardHat, group: 'Operations', accent: 'blue', ready: true,
    description: 'Builders and bill-to addresses, jobs, phases, lots, job setup reports and lists.',
    screens: { forms: 7, reports: 6, actions: 3 } },
  { code: 'SC', name: 'Scheduling', path: '/sc', icon: CalendarClock, group: 'Operations', accent: 'blue', ready: true,
    description: 'Schedule packs and stage dates by lot; post pack tickets; schedule, overdue and backlog reports.',
    screens: { forms: 5, reports: 4, actions: 5 } },
  { code: 'FM', name: 'Foreman reports', path: '/fm', icon: ClipboardCheck, group: 'Operations', accent: 'blue', ready: true,
    description: 'Start packets, sequence sheets, WIP, labor paid and material posted by lot, item research.',
    screens: { forms: 1, reports: 7, actions: 0 } },
  { code: 'TM', name: 'Time and material (PO)', path: '/tm', icon: Clock3, group: 'Operations', accent: 'violet', ready: true,
    description: 'T&M orders and quotes: price, process into Plan management, print, pay, reports.',
    screens: { forms: 3, reports: 9, actions: 6 } },
  { code: 'CS', name: 'Customer service', path: '/cs', icon: Headset, group: 'Operations', accent: 'teal', ready: true,
    description: 'Homeowners, properties, service tickets, scheduling calendar, quotes, call notes, technicians and CS reports.',
    screens: { forms: 10, reports: 20, actions: 8 } },
  { code: 'AM', name: 'Alarm monitoring', path: '/am', icon: ShieldCheck, group: 'Operations', accent: 'teal', ready: true,
    description: 'REI security accounts, call lists, zones and contract renewals.', screens: { forms: 2, reports: 2, actions: 6 } },

  // Finance
  { code: 'PR', name: 'Payroll', path: '/pr', icon: Wallet, group: 'Finance', accent: 'green', ready: true,
    description: 'Piece and hourly timecards, posting, employees, pay periods and labor-paid reports.',
    screens: { forms: 6, reports: 8, actions: 4 } },
  { code: 'AR', name: 'Accounts receivable', path: '/ar', icon: Receipt, group: 'Finance', accent: 'green', ready: true,
    description: 'Process billing by lot and stage, post invoices, manual invoices, credits and AR reports.',
    screens: { forms: 6, reports: 3, actions: 7 } },
  { code: 'MG', name: 'Management', path: '/mg', icon: BarChart3, group: 'Finance', accent: 'slate', ready: true,
    description: 'Job cost and profit by builder, job, phase, lot and super; lots to close; labor vs budget; lot details.',
    screens: { forms: 2, reports: 19, actions: 1 } },

  // Supply chain
  { code: 'IC', name: 'Inventory control', path: '/ic', icon: Boxes, group: 'Supply chain', accent: 'amber', ready: true,
    description: 'Items, vendors, stock by division, adjustments, counts, pack material to job cost, reports.',
    screens: { forms: 7, reports: 5, actions: 7 } },
  { code: 'PO', name: 'Purchasing', path: '/po', icon: ShoppingCart, group: 'Supply chain', accent: 'amber', ready: true,
    description: 'Purchase orders, receiving, billing, pack POs and purchasing reports.',
    screens: { forms: 5, reports: 6, actions: 8 } },

  // Pre-construction
  { code: 'ES', name: 'Estimating', path: '/es', icon: Calculator, group: 'Pre-construction', accent: 'violet', ready: true,
    description: 'Customers, jobs and bids; plans, assemblies and option packs; material bids and pack material; transfer to Plan management; master assemblies, items, research, job log and reports.',
    screens: { forms: 11, reports: 3, actions: 9 } },
  { code: 'PM', name: 'Plan management', path: '/pm', icon: ClipboardList, group: 'Pre-construction', accent: 'violet', ready: true,
    description: 'Customers, jobs and bids; plans, packs and pack material; copies, bulk edits and price updates.',
    screens: { forms: 5, reports: 12, actions: 6 } },
  { code: 'CM', name: 'Contract management', path: '/cm', icon: FileSignature, group: 'Pre-construction', accent: 'slate', ready: true,
    description: 'Contracts with addenda, diary and bid links; contract values by plan and pack; revised lot values; latest changes and 20 contract reports.',
    screens: { forms: 17, reports: 22, actions: 6 } },

  // Other
  { code: 'SA', name: 'Sales', path: '/sa', icon: TrendingUp, group: 'Other', accent: 'slate', ready: true,
    description: 'Sales leads with homeowners and phones; sales by plan, billing by lot, option and labor-paid reports, lots closed / by stage.',
    screens: { forms: 1, reports: 8, actions: 3 } },
  { code: 'CX', name: 'Cox cable', path: '/cx', icon: Cable, group: 'Other', accent: 'slate', ready: true,
    description: 'Cox jobs, assessors, plans and plan material; Cox items; billing info; material requests, billing runs and Cox reports.',
    screens: { forms: 4, reports: 12, actions: 3 } },
  { code: 'PU', name: 'Public', path: '/pu', icon: Globe, group: 'Other', accent: 'slate', ready: true, public: true,
    description: 'Lot finder, job lists, lot and plan data, start-pack labor — 11 shared reports for every user.',
    screens: { forms: 5, reports: 11, actions: 0 } },
  { code: 'DM', name: 'Database maintenance', path: '/dm', icon: Database, group: 'Other', accent: 'slate', ready: true,
    description: 'Logins and module permissions, 42 lookup lists, data fix screens, posting and price-update tools, lot close history.',
    screens: { forms: 4, reports: 2, actions: 9 } },
]

export const DASHBOARD = { name: 'Dashboard', path: '/', icon: LayoutDashboard }
export const GROUPS = ['Operations', 'Finance', 'Supply chain', 'Pre-construction', 'Other']
export const moduleByCode = Object.fromEntries(MODULES.map((m) => [m.code, m]))
export const moduleForPath = (p) => MODULES.find((m) => p === m.path || p.startsWith(m.path + '/'))
