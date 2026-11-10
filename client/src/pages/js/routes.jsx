// Job setup (JS) routes, ready to be mounted in App.jsx inside the authenticated layout:
//   import { jsRoutes } from './pages/js/routes'
//   const js = (el) => <RequireModule code="JS">{el}</RequireModule>
//   {jsRoutes.map((r) => <Route key={r.path} path={r.path} element={js(r.element)} />)}
// Static paths (".../new") are listed before ":id" paths; react-router ranks them correctly either way.
import JsHome from './JsHome'
import { JsBuilderDetail, JsBuilders } from './JsBuilders'
import { JsJobDetail, JsJobs } from './JsJobs'
import JsPhase from './JsPhase'
import { JsLotDetail, JsLots } from './JsLots'
import JsReports from './JsReports'
import JsLists from './JsLists'

export { jsTabs } from './shared'

export const jsRoutes = [
  { path: 'js', element: <JsHome /> },
  { path: 'js/builders', element: <JsBuilders /> },
  { path: 'js/builders/:id', element: <JsBuilderDetail /> }, // id = "new" creates a builder
  { path: 'js/jobs', element: <JsJobs /> },
  { path: 'js/jobs/:id', element: <JsJobDetail /> }, // id = "new" (optional ?builder=<CustID>)
  { path: 'js/jobs/:jobId/phases/new', element: <JsPhase /> },
  { path: 'js/phases/:id', element: <JsPhase /> },
  { path: 'js/lots', element: <JsLots /> },
  { path: 'js/lots/:id', element: <JsLotDetail /> },
  { path: 'js/reports', element: <JsReports /> },
  { path: 'js/lists', element: <JsLists /> },
]
