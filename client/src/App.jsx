import { Navigate, Route, Routes } from 'react-router-dom'
import { Construction } from 'lucide-react'
import { session } from './api'
import Login from './pages/Login'
import Layout from './components/Layout'
import Home from './pages/Home'
import AmDashboard from './pages/am/AmDashboard'
import AccountList from './pages/am/AccountList'
import AccountDetail from './pages/am/AccountDetail'
import Renewals from './pages/am/Renewals'
import AmReports from './pages/am/AmReports'
import AmAudit from './pages/am/AmAudit'
import { AmAccountPrint, AmAccountTechPrint } from './pages/am/AmPrint'
import {
  AttentionDetail, Billing, BillingDetail, InventoryValue, LotDetail, OpenLots, PayrollDate, PayrollPending,
} from './pages/insights/Insights'
import { EmptyState } from './components/ui'
import PrHome from './pages/pr/PrHome'
import PieceTimecard from './pages/pr/PieceTimecard'
import HourlyTimecard from './pages/pr/HourlyTimecard'
import Timecards from './pages/pr/Timecards'
import { EmployeeDetail, Employees } from './pages/pr/Employees'
import PayPeriods from './pages/pr/PayPeriods'
import PrReports from './pages/pr/Reports'
import ScHome from './pages/sc/ScHome'
import ScJob from './pages/sc/ScJob'
import ScPhase from './pages/sc/ScPhase'
import ScLot from './pages/sc/ScLot'
import ScTicket from './pages/sc/ScTicket'
import { ScBacklog, ScPackSearch, ScSchedule } from './pages/sc/ScReports'
import TmHome from './pages/tm/TmHome'
import TmNew from './pages/tm/TmNew'
import TmDetail from './pages/tm/TmDetail'
import { TmPick, TmPrint } from './pages/tm/TmPrint'
import TmReports from './pages/tm/TmReports'
import IcHome from './pages/ic/IcHome'
import { IcItemDetail, IcItems } from './pages/ic/IcItems'
import { IcVendorDetail, IcVendors } from './pages/ic/IcVendors'
import { IcCountDetail, IcCounts, IcTransactions } from './pages/ic/IcStock'
import { IcMaterial, IcMaterialLot } from './pages/ic/IcMaterial'
import IcReports from './pages/ic/IcReports'
import PoHome from './pages/po/PoHome'
import PoOrders from './pages/po/PoOrders'
import { PoOrder, PoOrderNew, PoPrint } from './pages/po/PoOrder'
import { PoPack, PoPacks } from './pages/po/PoPacks'
import PoReports from './pages/po/PoReports'
import ArHome from './pages/ar/ArHome'
import { ArBilling, ArBillLot } from './pages/ar/ArBilling'
import ArPrebill from './pages/ar/ArPrebill'
import { ArInvoice, ArInvoiceNew, ArInvoicePrint, ArInvoices } from './pages/ar/ArInvoices'
import ArReports from './pages/ar/ArReports'
import FmHome from './pages/fm/FmHome'
import { jsRoutes } from './pages/js/routes'
import MgHome from './pages/mg/MgHome'
import MgJobCost from './pages/mg/MgJobCost'
import MgReports from './pages/mg/MgReports'
import { csRoutes } from './pages/cs/routes'
import { pmRoutes } from './pages/pm/routes'
import { dmRoutes } from './pages/dm/routes'
import { puRoutes } from './pages/pu/routes'
import { cxRoutes } from './pages/cx/routes'
import { cmRoutes } from './pages/cm/routes'
import { esRoutes } from './pages/es/routes'
import { saRoutes } from './pages/sa/routes'

function RequireAuth({ children }) {
  return session.loggedIn ? children : <Navigate to="/login" replace />
}

function RequireModule({ code, children }) {
  return session.user?.modules?.includes(code)
    ? children
    : <div className="page"><EmptyState title="No access">You do not have access to this module. Ask an administrator to enable it on your login.</EmptyState></div>
}

const am = (el) => <RequireModule code="AM">{el}</RequireModule>
const pr = (el) => <RequireModule code="PR">{el}</RequireModule>
const sc = (el) => <RequireModule code="SC">{el}</RequireModule>
const tm = (el) => <RequireModule code="TM">{el}</RequireModule>
const ic = (el) => <RequireModule code="IC">{el}</RequireModule>
const po = (el) => <RequireModule code="PO">{el}</RequireModule>
const ar = (el) => <RequireModule code="AR">{el}</RequireModule>
const fm = (el) => <RequireModule code="FM">{el}</RequireModule>
const js = (el) => <RequireModule code="JS">{el}</RequireModule>
const mg = (el) => <RequireModule code="MG">{el}</RequireModule>
const cs = (el) => <RequireModule code="CS">{el}</RequireModule>
const pm = (el) => <RequireModule code="PM">{el}</RequireModule>
const dm = (el) => <RequireModule code="DM">{el}</RequireModule>
const pu = (el) => <RequireModule code="PU">{el}</RequireModule>
const cx = (el) => <RequireModule code="CX">{el}</RequireModule>
const cm = (el) => <RequireModule code="CM">{el}</RequireModule>
const es = (el) => <RequireModule code="ES">{el}</RequireModule>
const sa = (el) => <RequireModule code="SA">{el}</RequireModule>

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="am" element={am(<AmDashboard />)} />
        <Route path="am/accounts" element={am(<AccountList />)} />
        <Route path="am/accounts/:id" element={am(<AccountDetail />)} />
        <Route path="am/renewals" element={am(<Renewals />)} />
        <Route path="am/reports" element={am(<AmReports />)} />
        <Route path="am/audit" element={am(<AmAudit />)} />
        <Route path="am/accounts/:id/print" element={am(<AmAccountPrint />)} />
        <Route path="am/accounts/:id/print-tech" element={am(<AmAccountTechPrint />)} />

        <Route path="pr" element={pr(<PrHome />)} />
        <Route path="pr/piece" element={pr(<PieceTimecard />)} />
        <Route path="pr/hourly" element={pr(<HourlyTimecard />)} />
        <Route path="pr/timecard" element={pr(<Timecards />)} />
        <Route path="pr/employees" element={pr(<Employees />)} />
        <Route path="pr/employees/:id" element={pr(<EmployeeDetail />)} />
        <Route path="pr/periods" element={pr(<PayPeriods />)} />
        <Route path="pr/reports" element={pr(<PrReports />)} />

        <Route path="sc" element={sc(<ScHome />)} />
        <Route path="sc/jobs/:id" element={sc(<ScJob />)} />
        <Route path="sc/phases/:id" element={sc(<ScPhase />)} />
        <Route path="sc/lots/:id" element={sc(<ScLot />)} />
        <Route path="sc/lots/:id/ticket" element={sc(<ScTicket />)} />
        <Route path="sc/schedule" element={sc(<ScSchedule />)} />
        <Route path="sc/overdue" element={sc(<ScSchedule overdue />)} />
        <Route path="sc/backlog" element={sc(<ScBacklog />)} />
        <Route path="sc/packs" element={sc(<ScPackSearch />)} />

        <Route path="tm" element={tm(<TmHome />)} />
        <Route path="tm/new" element={tm(<TmNew />)} />
        <Route path="tm/reports" element={tm(<TmReports />)} />
        <Route path="tm/:id" element={tm(<TmDetail />)} />
        <Route path="tm/:id/print" element={tm(<TmPrint />)} />
        <Route path="tm/:id/pick" element={tm(<TmPick />)} />

        <Route path="ic" element={ic(<IcHome />)} />
        <Route path="ic/items" element={ic(<IcItems />)} />
        <Route path="ic/items/:id" element={ic(<IcItemDetail />)} />
        <Route path="ic/vendors" element={ic(<IcVendors />)} />
        <Route path="ic/vendors/:id" element={ic(<IcVendorDetail />)} />
        <Route path="ic/transactions" element={ic(<IcTransactions />)} />
        <Route path="ic/counts" element={ic(<IcCounts />)} />
        <Route path="ic/counts/:id" element={ic(<IcCountDetail />)} />
        <Route path="ic/material" element={ic(<IcMaterial />)} />
        <Route path="ic/material/:lotId" element={ic(<IcMaterialLot />)} />
        <Route path="ic/reports" element={ic(<IcReports />)} />

        <Route path="po" element={po(<PoHome />)} />
        <Route path="po/orders" element={po(<PoOrders />)} />
        <Route path="po/orders/new" element={po(<PoOrderNew />)} />
        <Route path="po/orders/:id" element={po(<PoOrder />)} />
        <Route path="po/orders/:id/print" element={po(<PoPrint />)} />
        <Route path="po/packs" element={po(<PoPacks />)} />
        <Route path="po/packs/:id" element={po(<PoPack />)} />
        <Route path="po/reports" element={po(<PoReports />)} />
        <Route path="ar" element={ar(<ArHome />)} />
        <Route path="ar/billing" element={ar(<ArBilling />)} />
        <Route path="ar/billing/lots/:lotId" element={ar(<ArBillLot />)} />
        <Route path="ar/prebill" element={ar(<ArPrebill />)} />
        <Route path="ar/invoices" element={ar(<ArInvoices />)} />
        <Route path="ar/invoices/new" element={ar(<ArInvoiceNew />)} />
        <Route path="ar/invoices/:id" element={ar(<ArInvoice />)} />
        <Route path="ar/invoices/:id/print" element={ar(<ArInvoicePrint />)} />
        <Route path="ar/reports" element={ar(<ArReports />)} />
        <Route path="fm" element={fm(<FmHome />)} />
        {jsRoutes.map((r) => <Route key={r.path} path={r.path} element={js(r.element)} />)}
        <Route path="mg" element={mg(<MgHome />)} />
        <Route path="mg/job-cost" element={mg(<MgJobCost />)} />
        <Route path="mg/reports" element={mg(<MgReports />)} />
        {csRoutes.map((r) => <Route key={r.path} path={r.path} element={cs(r.element)} />)}
        {pmRoutes.map((r) => <Route key={r.path} path={r.path} element={pm(r.element)} />)}
        {dmRoutes.map((r) => <Route key={r.path} path={r.path} element={dm(r.element)} />)}
        {puRoutes.map((r) => <Route key={r.path} path={r.path} element={pu(r.element)} />)}
        {cxRoutes.map((r) => <Route key={r.path} path={r.path} element={cx(r.element)} />)}
        {cmRoutes.map((r) => <Route key={r.path} path={r.path} element={cm(r.element)} />)}
        {esRoutes.map((r) => <Route key={r.path} path={r.path} element={es(r.element)} />)}
        {saRoutes.map((r) => <Route key={r.path} path={r.path} element={sa(r.element)} />)}

        {/* Dashboard drill-downs */}
        <Route path="insights/open-lots" element={<OpenLots />} />
        <Route path="insights/lots/:id" element={<LotDetail />} />
        <Route path="insights/inventory" element={<RequireModule code="IC"><InventoryValue /></RequireModule>} />
        <Route path="insights/payroll-pending" element={<RequireModule code="PR"><PayrollPending /></RequireModule>} />
        <Route path="insights/payroll-date" element={<RequireModule code="PR"><PayrollDate /></RequireModule>} />
        <Route path="insights/billing" element={<RequireModule code="AR"><Billing /></RequireModule>} />
        <Route path="insights/billing/:id" element={<RequireModule code="AR"><BillingDetail /></RequireModule>} />
        <Route path="insights/attention/:key" element={<AttentionDetail />} />

        <Route path="*" element={<div className="page"><EmptyState icon={Construction} title="This module is being built">It will appear here as soon as it's ready.</EmptyState></div>} />
      </Route>
    </Routes>
  )
}
