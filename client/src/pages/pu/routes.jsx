// Public (PU) routes, mounted in App.jsx inside the authenticated layout. Every login can open PU.
import PuHome from './PuHome'
import PuReports from './PuReports'

export const puRoutes = [
  { path: 'pu', element: <PuHome /> }, // ?q= address search, ?lotId= selected lot
  { path: 'pu/jobs', element: <PuReports group="jobs" /> }, // ?report=&division=&statusId=
  { path: 'pu/lots', element: <PuReports group="lots" /> }, // ?report=&jobId=&lotId=&division=&statusId=
  { path: 'pu/plans', element: <PuReports group="plans" /> }, // ?report=&pmCustomerId=&pmJobId=&pmContractId=&planId=
  { path: 'pu/labor', element: <PuReports group="labor" /> }, // ?report=&jobId=&lotId=|phaseId=&scheduleStageId=
]
