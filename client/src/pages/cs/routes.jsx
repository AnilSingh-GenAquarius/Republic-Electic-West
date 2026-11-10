// Customer service (CS) routes, ready to be mounted in App.jsx inside the authenticated layout:
//   import { csRoutes } from './pages/cs/routes'
//   const cs = (el) => <RequireModule code="CS">{el}</RequireModule>
//   {csRoutes.map((r) => <Route key={r.path} path={r.path} element={cs(r.element)} />)}
// ":id" = "new" creates a homeowner / property / quote.
import CsHome from './CsHome'
import CsSchedule from './CsSchedule'
import CsCalendar from './CsCalendar'
import { CsTicket, CsTickets } from './CsTickets'
import { CsCustomerDetail, CsCustomers } from './CsCustomers'
import { CsProperties, CsPropertyDetail } from './CsProperties'
import CsCallNotes from './CsCallNotes'
import { CsQuote, CsQuotes } from './CsQuotes'
import CsReports from './CsReports'
import CsSetup, { CsAssembly, CsItem } from './CsSetup'

export { csTabs } from './shared'

export const csRoutes = [
  { path: 'cs', element: <CsHome /> },
  { path: 'cs/schedule', element: <CsSchedule /> }, // ?customerId= / ?propertyId= pre-fill
  { path: 'cs/calendar', element: <CsCalendar /> },
  { path: 'cs/tickets', element: <CsTickets /> },
  { path: 'cs/tickets/:id', element: <CsTicket /> },
  { path: 'cs/customers', element: <CsCustomers /> },
  { path: 'cs/customers/:id', element: <CsCustomerDetail /> },
  { path: 'cs/properties', element: <CsProperties /> }, // ?tab=production = add production jobs/lots
  { path: 'cs/properties/:id', element: <CsPropertyDetail /> },
  { path: 'cs/call-notes', element: <CsCallNotes /> },
  { path: 'cs/quotes', element: <CsQuotes /> },
  { path: 'cs/quotes/:id', element: <CsQuote /> },
  { path: 'cs/reports', element: <CsReports /> },
  { path: 'cs/setup', element: <CsSetup /> }, // ?tab=technicians|assemblies|lists|items
  { path: 'cs/assemblies/:id', element: <CsAssembly /> },
  { path: 'cs/items/:id', element: <CsItem /> },
]
