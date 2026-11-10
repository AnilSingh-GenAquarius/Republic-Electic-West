// Database maintenance (DM) routes, mounted in App.jsx inside the authenticated layout.
import DmHome from './DmHome'
import DmFix from './DmFix'
import DmTm from './DmTm'
import DmHistory from './DmHistory'
import DmLogins from './DmLogins'
import { DmList, DmLists } from './DmLists'

export const dmRoutes = [
  { path: 'dm', element: <DmHome /> }, // switchboard functions; filters in the query string
  { path: 'dm/fix', element: <DmFix /> }, // ?set=<data set>&lotId= | &employeeId=&fromDate=&toDate=
  { path: 'dm/tm', element: <DmTm /> }, // ?tmId=
  { path: 'dm/lists', element: <DmLists /> },
  { path: 'dm/lists/:key', element: <DmList /> }, // ?parent= for CS error categories / details
  { path: 'dm/logins', element: <DmLogins /> },
  { path: 'dm/history', element: <DmHistory /> },
]
