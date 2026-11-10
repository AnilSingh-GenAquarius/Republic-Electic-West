// Estimating (ES) routes, mounted in App.jsx inside the authenticated layout.
import EsHome from './EsHome'
import { EsCustomer, EsCustomers } from './EsCustomers'
import EsBid from './EsBid'
import EsMaterial from './EsMaterial'
import EsPack from './EsPack'
import EsTransfer from './EsTransfer'
import EsAssemblies from './EsAssemblies'
import { EsItem, EsItems, EsResearch } from './EsItems'
import EsJobLog from './EsJobLog'
import EsReports from './EsReports'

export const esRoutes = [
  { path: 'es', element: <EsHome /> },
  { path: 'es/customers', element: <EsCustomers /> },
  { path: 'es/customers/:id', element: <EsCustomer /> },
  { path: 'es/bids/:id', element: <EsBid /> }, // assembly bid management; ?plan= selects a plan
  { path: 'es/bids/:id/material', element: <EsMaterial /> }, // material bid management; ?plan=
  { path: 'es/packs/:id', element: <EsPack /> },
  { path: 'es/transfer', element: <EsTransfer /> },
  { path: 'es/assemblies', element: <EsAssemblies /> },
  { path: 'es/items', element: <EsItems /> },
  { path: 'es/items/:id', element: <EsItem /> },
  { path: 'es/research', element: <EsResearch /> },
  { path: 'es/job-log', element: <EsJobLog /> }, // ?job=
  { path: 'es/reports', element: <EsReports /> }, // ?report=bid-detail|job-history|low-prices
]
