// Cox cable (CX) routes, mounted in App.jsx inside the authenticated layout.
import CxHome from './CxHome'
import { CxJob, CxJobs } from './CxJobs'
import CxItems from './CxItems'
import CxBillInfo from './CxBillInfo'
import CxReports from './CxReports'

export const cxRoutes = [
  { path: 'cx', element: <CxHome /> },
  { path: 'cx/jobs', element: <CxJobs /> },
  { path: 'cx/jobs/:id', element: <CxJob /> },
  { path: 'cx/items', element: <CxItems /> },
  { path: 'cx/billing-info', element: <CxBillInfo /> }, // ?job= selects a job
  { path: 'cx/reports', element: <CxReports /> }, // ?report=&date=&from=&to=&invoice=&lotId=
]
