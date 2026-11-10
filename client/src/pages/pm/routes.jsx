// Plan management (PM) routes, mounted in App.jsx inside the authenticated layout.
import PmHome from './PmHome'
import { PmCustomer, PmCustomers } from './PmCustomers'
import PmBid from './PmBid'
import PmPack from './PmPack'
import PmTools from './PmTools'
import PmReports from './PmReports'

export const pmRoutes = [
  { path: 'pm', element: <PmHome /> },
  { path: 'pm/customers', element: <PmCustomers /> },
  { path: 'pm/customers/:id', element: <PmCustomer /> },
  { path: 'pm/bids/:id', element: <PmBid /> }, // ?plan= selects a plan
  { path: 'pm/packs/:id', element: <PmPack /> },
  { path: 'pm/tools', element: <PmTools /> },
  { path: 'pm/reports', element: <PmReports /> },
]
