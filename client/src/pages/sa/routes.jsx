// Sales (SA) routes, mounted in App.jsx inside the authenticated layout.
import SaHome from './SaHome'
import { SaLead, SaLeads } from './SaLeads'
import SaReports from './SaReports'

export const saRoutes = [
  { path: 'sa', element: <SaHome /> },
  { path: 'sa/leads', element: <SaLeads /> }, // ?search= &priorityId= (id | none) &sort=
  { path: 'sa/leads/:id', element: <SaLead /> }, // 'new' creates a lead; ?tab=homeowners
  { path: 'sa/reports', element: <SaReports /> }, // ?report= + the switchboard filters
]
