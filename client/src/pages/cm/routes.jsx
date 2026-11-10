// Contract management (CM) routes, mounted in App.jsx inside the authenticated layout.
import CmHome from './CmHome'
import CmJobs from './CmJobs'
import CmJob from './CmJob'
import CmValues from './CmValues'
import CmLots from './CmLots'
import CmReports from './CmReports'

export const cmRoutes = [
  { path: 'cm', element: <CmHome /> },
  { path: 'cm/jobs', element: <CmJobs /> },
  { path: 'cm/jobs/:id', element: <CmJob /> }, // ?contract= selects a contract
  { path: 'cm/values', element: <CmValues /> }, // ?customerId=&jobId=&contractId=&plan=&pack=
  { path: 'cm/lots', element: <CmLots /> }, // ?jsCustomerId=&jsJobId=&lotId=
  { path: 'cm/reports', element: <CmReports /> }, // ?report=&…filters
]
