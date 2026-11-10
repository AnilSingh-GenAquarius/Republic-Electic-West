// Dashboard: KPIs, needs-attention items, charts, recent activity and global search.
// Every number here comes from the live database — nothing is estimated or invented.
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();

// '$4,281.00' text -> money
const MONEY = (col) => `TRY_CAST(REPLACE(REPLACE(${col},'$',''),',','') AS money)`;

const has = (req, code) => req.user.modules.includes(code);

// Optional ?division=REW filter (validated against LsDivision)
async function divisionFilter(req) {
  const d = req.query.division;
  if (!d) return null;
  const ok = await query('SELECT 1 AS x FROM LsDivision WHERE DivisionID=@d', { d });
  return ok.length ? d : null;
}

router.get('/summary', h(async (req, res) => {
  const div = await divisionFilter(req);
  const p = { div };

  const [lots, inv, hourly, piece] = await Promise.all([
    query(`SELECT j.DivisionId, COUNT(*) AS n FROM JsViewLotOpen v JOIN JsJob j ON j.JobId = v.JobId GROUP BY j.DivisionId`),
    has(req, 'IC')
      ? query(`SELECT SUM(CAST(d.QtyOnHand AS decimal(18,4)) * i.AverageCost) AS value, COUNT(DISTINCT d.InvItemId) AS items,
                      SUM(CASE WHEN d.QtyOnHand < 0 THEN 1 ELSE 0 END) AS negative
                 FROM IcItemDivision d JOIN IcItem i ON i.InvItemID = d.InvItemId
                WHERE d.QtyOnHand <> 0 AND (@div IS NULL OR d.DivisionId = @div)`, p)
      : null,
    has(req, 'PR')
      ? query(`SELECT COUNT(*) AS entries, SUM(t.PayHours) AS hours, MIN(t.PayrollDate) AS payrollDate, COUNT(DISTINCT t.EmployeeId) AS employees
                 FROM PrTempPayrollHourly t LEFT JOIN JsJob j ON j.JobId = t.JobId
                WHERE (@div IS NULL OR j.DivisionId = @div)`, p)
      : null,
    // Piece timecards submitted but not yet posted (PrTempPayroll — what the Access "pending piece" panel lists)
    has(req, 'PR')
      ? query(`SELECT COUNT(*) AS entries,
                      SUM(ISNULL(CAST(t.ExtItemQty AS decimal(18,4)),0) * ISNULL(t.PriceEa,0) * ISNULL(t.PayPercent,0) / 100
                          + ISNULL(t.PayHours,0) * ISNULL(t.HourlyRate,0)) AS value
                 FROM PrTempPayroll t LEFT JOIN JsJob j ON j.JobId = t.JobId
                WHERE (@div IS NULL OR j.DivisionId = @div)`, p)
      : null,
  ]);

  const openLots = Object.fromEntries(lots.map((r) => [r.DivisionId, r.n]));
  res.json({
    division: div,
    openLots,
    inventory: inv ? inv[0] : null,
    payrollPending: hourly ? { hourly: hourly[0], piece: piece[0] } : null,
  });
}));

// Needs attention: real exception queries, each tied to a module and a screen.
router.get('/attention', h(async (req, res) => {
  const items = [];
  const add = (cond, item) => cond && items.push(item);

  const checks = await Promise.all([
    has(req, 'PR') ? query(`SELECT COUNT(*) AS n, SUM(PayHours) AS hrs, MIN(PayrollDate) AS d FROM PrTempPayrollHourly`) : null,
    has(req, 'PR') ? query(`SELECT COUNT(*) AS n, MIN(PayrollDate) AS d FROM PrTempPayroll`) : null,
    has(req, 'SC') ? query(`SELECT COUNT(*) AS n, MIN(DeliveryDate) AS d FROM JsStage WHERE DatePosted IS NULL AND DeliveryDate < CAST(GETDATE() AS date)`) : null,
    has(req, 'IC') ? query(`SELECT COUNT(*) AS n, MIN(InvDate) AS d FROM IcInvDate WHERE ISNULL(Posted,0) = 0`) : null,
    has(req, 'TM') ? query(`SELECT COUNT(*) AS n, MIN(TmDate) AS d FROM TmPO WHERE ApprovedDate IS NULL`) : null,
    has(req, 'TM') ? query(`SELECT COUNT(*) AS n, MIN(ApprovedDate) AS d FROM TmPO WHERE ApprovedDate IS NOT NULL AND PaidDate IS NULL`) : null,
    has(req, 'AM') ? query(`SELECT COUNT(*) AS n, MIN(RenewalDate) AS d FROM AmAccount WHERE DisconnectionDate IS NULL AND RenewalDate < CAST(GETDATE() AS date)`) : null,
    has(req, 'IC') ? query(`SELECT COUNT(*) AS n FROM IcItemDivision WHERE QtyOnHand < 0`) : null,
  ]);
  const [hourly, piece, stages, counts, tmUnapproved, tmUnpaid, renewals, negStock] = checks.map((c) => c && c[0]);

  add(hourly?.n, {
    id: 'payroll-hourly', priority: 'high', module: 'PR',
    title: 'Hourly timecards waiting to be appended',
    detail: `${hourly?.n} hourly entries · ${Number(hourly?.hrs || 0).toLocaleString()} hours are not yet appended to the piece timecard.`,
    since: hourly?.d, action: { label: 'Open payroll', to: `/pr?date=${hourly?.d ? new Date(hourly.d).toISOString().slice(0, 10) : ''}` },
    review: { label: 'Hourly entries', to: `/pr/hourly?date=${hourly?.d ? new Date(hourly.d).toISOString().slice(0, 10) : ''}` },
  });
  add(piece?.n, {
    id: 'payroll-piece', priority: 'medium', module: 'PR',
    title: 'Piece timecards not yet posted',
    detail: `${piece?.n} timecard lines are waiting for "Post payroll".`,
    since: piece?.d, action: { label: 'Open payroll', to: `/pr?date=${piece?.d ? new Date(piece.d).toISOString().slice(0, 10) : ''}` },
    review: { label: 'Timecards', to: '/pr/timecard' },
  });
  add(stages?.n, {
    id: 'stages-overdue', priority: 'high', module: 'SC',
    title: 'Scheduled stages past delivery date',
    detail: `${stages?.n} lot stages were due but have not been posted as complete.`,
    since: stages?.d, action: { label: 'Open schedule', to: '/sc?view=overdue' }, review: { label: 'Calendar', to: '/sc' },
  });
  add(counts?.n, {
    id: 'inv-counts', priority: 'medium', module: 'IC',
    title: 'Inventory counts need posting',
    detail: `${counts?.n} physical counts were entered but never posted to stock.`,
    since: counts?.d, action: { label: 'Review counts', to: '/ic/counts' }, review: { label: 'Stock levels', to: '/ic/items' },
  });
  add(negStock?.n, {
    id: 'inv-negative', priority: 'low', module: 'IC',
    title: 'Items with negative stock on hand',
    detail: `${negStock?.n} item/division records show a quantity below zero.`,
    action: { label: 'Show items', to: '/ic/items?negative=1' },
  });
  add(tmUnapproved?.n, {
    id: 'tm-unapproved', priority: 'medium', module: 'TM',
    title: 'T&M orders awaiting approval',
    detail: `${tmUnapproved?.n} time & material orders have no approval recorded.`,
    since: tmUnapproved?.d, action: { label: 'Review orders', to: '/tm?status=unapproved' },
  });
  add(tmUnpaid?.n, {
    id: 'tm-unpaid', priority: 'low', module: 'TM',
    title: 'Approved T&M orders not marked paid',
    detail: `${tmUnpaid?.n} approved orders have no paid date.`,
    since: tmUnpaid?.d, action: { label: 'Review orders', to: '/tm?status=unpaid' },
  });
  add(renewals?.n, {
    id: 'am-renewals', priority: 'low', module: 'AM',
    title: 'Alarm contracts past renewal date',
    detail: `${renewals?.n} active alarm accounts are past their renewal date.`,
    since: renewals?.d, action: { label: 'Open renewals', to: '/am/renewals' },
  });

  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.priority] - rank[b.priority]);
  res.json({ items });
}));

// Charts: monthly billing (A/R) and payroll by payroll date. Only real history.
router.get('/charts', h(async (req, res) => {
  const [billing, payroll] = await Promise.all([
    has(req, 'AR')
      ? query(`SELECT FORMAT([Date],'yyyy-MM') AS month, COUNT(*) AS bills, SUM(${MONEY('BillTotal')}) AS total
                 FROM ArBilling
                WHERE [Date] >= DATEADD(month, -11, DATEFROMPARTS(YEAR((SELECT MAX([Date]) FROM ArBilling)), MONTH((SELECT MAX([Date]) FROM ArBilling)), 1))
                GROUP BY FORMAT([Date],'yyyy-MM') ORDER BY month`)
      : null,
    has(req, 'PR')
      ? query(`SELECT TOP 12 PayrollDate, COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees,
                      SUM(CAST(ExtItemQty AS decimal(18,4)) * PriceEa * PayPercent / 100) AS piece,
                      SUM(PayHours) AS hours
                 FROM PrLaborPaid GROUP BY PayrollDate ORDER BY PayrollDate DESC`)
      : null,
  ]);
  res.json({ billing, payroll: payroll ? payroll.reverse() : null });
}));

// Recent activity across modules (last records entered, with who entered them).
router.get('/activity', h(async (req, res) => {
  const parts = [];
  if (has(req, 'AM')) parts.push(`SELECT TOP 5 'AM' AS module, 'Alarm account' AS kind, CustomerName AS title, '/am/accounts/' + CAST(AccountID AS varchar) AS link, DateEntered, UserEntered FROM AmAccount WHERE DateEntered IS NOT NULL ORDER BY DateEntered DESC`);
  if (has(req, 'PR')) parts.push(`SELECT TOP 5 'PR' AS module, 'Hourly labor' AS kind, ISNULL(EmpName,'') + ' · ' + ISNULL(JobName,'') AS title, '/pr/hourly' AS link, DateEntered, UserEntered FROM PrTempPayrollHourly WHERE DateEntered IS NOT NULL ORDER BY DateEntered DESC`);
  if (has(req, 'SC')) parts.push(`SELECT TOP 5 'SC' AS module, 'Stage scheduled' AS kind, ISNULL(j.JobName,'') + ' · Lot ' + ISNULL(l.Lot,'') AS title, '/sc' AS link, s.DateEntered, s.UserEntered FROM JsStage s JOIN JsLot l ON l.LotID=s.LotId JOIN JsJob j ON j.JobId=l.JobId WHERE s.DateEntered IS NOT NULL ORDER BY s.DateEntered DESC`);
  if (has(req, 'TM')) parts.push(`SELECT TOP 5 'TM' AS module, 'T&M order' AS kind, ISNULL(TmName,'T&M #' + CAST(TmID AS varchar)) AS title, '/tm/' + CAST(TmID AS varchar) AS link, DateEntered, UserEntered FROM TmPO WHERE DateEntered IS NOT NULL ORDER BY DateEntered DESC`);
  if (has(req, 'AR')) parts.push(`SELECT TOP 5 'AR' AS module, 'Invoice' AS kind, ISNULL(CustName,'') + ' · ' + ISNULL(BillTotal,'') AS title, '/ar' AS link, [Date] AS DateEntered, NULL AS UserEntered FROM ArBilling ORDER BY [Date] DESC, BillID DESC`);
  if (!parts.length) return res.json({ rows: [] });
  const rows = await query(`SELECT TOP 12 * FROM (${parts.map((p) => `SELECT * FROM (${p}) x`).join(' UNION ALL ')}) u ORDER BY DateEntered DESC`);
  res.json({ rows });
}));

// Global search (Ctrl+K) across the modules this user can open.
router.get('/search', h(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const s = `%${q}%`;
  const jobs = [];
  if (has(req, 'AM')) jobs.push(query(`SELECT TOP 5 'AM' AS module, 'Alarm account' AS kind, CAST(AccountNumber AS varchar) + ' – ' + CustomerName AS title, ISNULL(ServiceStreet,'') + ' ' + ISNULL(ServiceCity,'') AS subtitle, '/am/accounts/' + CAST(AccountID AS varchar) AS link FROM AmAccount WHERE CustomerName LIKE @s OR CAST(AccountNumber AS varchar) LIKE @s OR ServiceStreet LIKE @s OR PhoneNumber LIKE @s`, { s }));
  if (has(req, 'PR')) jobs.push(query(`SELECT TOP 5 'PR' AS module, 'Employee' AS kind, LName + ', ' + FName AS title, 'Emp # ' + ISNULL(EmployeeNum,'') + ' · ' + ISNULL(DivisionId,'') + CASE WHEN DateTermination IS NULL THEN '' ELSE ' · terminated' END AS subtitle, '/pr/employees/' + CAST(EmployeeID AS varchar) AS link FROM PrEmployee WHERE FName LIKE @s OR LName LIKE @s OR EmployeeNum LIKE @s OR LName + ', ' + FName LIKE @s ORDER BY CASE WHEN DateTermination IS NULL THEN 0 ELSE 1 END`, { s }));
  if (has(req, 'IC')) jobs.push(query(`SELECT TOP 5 'IC' AS module, 'Item' AS kind, InvItem AS title, ISNULL(Description,'') AS subtitle, '/ic/items/' + CAST(InvItemID AS varchar) AS link FROM IcItem WHERE InvItem LIKE @s OR Description LIKE @s OR PartNum LIKE @s`, { s }));
  if (has(req, 'IC')) jobs.push(query(`SELECT TOP 3 'IC' AS module, 'Vendor' AS kind, Vendor AS title, ISNULL(City,'') + ' ' + ISNULL(Phone,'') AS subtitle, '/ic/vendors/' + CAST(VendorID AS varchar) AS link FROM IcVendor WHERE Vendor LIKE @s`, { s }));
  if (has(req, 'SC')) jobs.push(query(`SELECT TOP 5 'SC' AS module, 'Job' AS kind, JobName AS title, 'Job # ' + ISNULL(CAST(JobNum AS varchar),'—') + ' · ' + ISNULL(DivisionId,'') AS subtitle, '/sc?jobId=' + CAST(JobId AS varchar) AS link FROM JsJob WHERE JobName LIKE @s OR CAST(JobNum AS varchar) LIKE @s`, { s }));
  if (has(req, 'TM')) jobs.push(query(`SELECT TOP 5 'TM' AS module, 'T&M order' AS kind, 'T&M #' + CAST(TmID AS varchar) + ISNULL(' – ' + TmName,'') AS title, ISNULL(RequestedBy,'') AS subtitle, '/tm/' + CAST(TmID AS varchar) AS link FROM TmPO WHERE TmName LIKE @s OR CAST(TmID AS varchar) LIKE @s OR TmCustomerNum LIKE @s OR RequestedBy LIKE @s`, { s }));
  const results = (await Promise.all(jobs)).flat();
  res.json({ results });
}));

// ---------------------------------------------------------------------------
// Drill-downs behind each dashboard figure (read-only, paged).
// ---------------------------------------------------------------------------
const { paging } = require('../crud');

function deny(res, code) { res.status(403).json({ error: `You do not have access to module ${code}` }); }

async function paged(sqlFrom, select, orderBy, params, page) {
  const [rows, total] = await Promise.all([
    query(`SELECT ${select} ${sqlFrom} ORDER BY ${orderBy} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset: page.offset, pageSize: page.pageSize }),
    query(`SELECT COUNT(*) AS n ${sqlFrom}`, params),
  ]);
  return { rows, total: total[0].n, page: page.page, pageSize: page.pageSize };
}

// Open lots (JsViewLotOpen) — ?division=REW|REI|BAY&search=
router.get('/drill/open-lots', h(async (req, res) => {
  const pg = paging(req.query);
  const p = { div: req.query.division || null, s: req.query.search ? `%${req.query.search}%` : null };
  const from = `FROM JsViewLotOpen v
    JOIN JsJob j ON j.JobId = v.JobId
    LEFT JOIN JsCustomer c ON c.CustID = j.CustId
    LEFT JOIN JsPhase ph ON ph.PhaseID = v.PhaseId
    LEFT JOIN PmPlan pl ON pl.PmPlanID = v.PmPlanId
    WHERE (@div IS NULL OR j.DivisionId = @div)
      AND (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s OR v.Address LIKE @s OR v.Lot LIKE @s OR pl.PlanNum LIKE @s)`;
  const out = await paged(from,
    `v.LotID, j.DivisionId, c.CustName, j.JobName, j.JobNum, ph.Phase, v.Lot, v.Block, pl.PlanNum, v.Address, v.City,
     v.StartDate, v.Permit, v.RevContract, v.Contract,
     (SELECT COUNT(*) FROM JsPack pk WHERE pk.LotId = v.LotID) AS Packs,
     (SELECT COUNT(*) FROM JsStage st WHERE st.LotId = v.LotID AND st.DatePosted IS NULL) AS OpenStages`,
    'j.JobName, ph.Phase, TRY_CAST(v.Lot AS int), v.Lot', p, pg);
  res.json(out);
}));

// Lot detail — packs and stages for one lot
router.get('/drill/lots/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [lot, packs, stages] = await Promise.all([
    query(`SELECT l.*, j.JobName, j.JobNum, j.DivisionId, c.CustName, ph.Phase, pl.PlanNum, pl.SqFt
             FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
             LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
            WHERE l.LotID = @id`, { id }),
    query(`SELECT p.PackID, ISNULL(m.PackName, 'Pack ' + CAST(p.PackID AS varchar)) AS PackName, pt.PackType, p.PackQty, p.PostedQty,
                  p.PostedLaborQty, p.ContractEa, p.RevContractEa
             FROM JsPack p LEFT JOIN PmPack m ON m.PmPackID = p.PmPackId LEFT JOIN LsPackType pt ON pt.PackTypeID = p.PackTypeId
            WHERE p.LotId = @id ORDER BY p.PackID`, { id }),
    query(`SELECT s.StageAutoID, w.WorkType, ss.ScheduleStage, s.DeliveryDate, s.DatePosted, s.UserPosted, s.Notes
             FROM JsStage s LEFT JOIN LsWork w ON w.WorkID = s.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId
            WHERE s.LotId = @id ORDER BY s.DeliveryDate`, { id }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json({ lot: lot[0], packs, stages });
}));

// Inventory value by item — ?division=&search=&negative=1&sort=value|qty|item
router.get('/drill/inventory', h(async (req, res) => {
  if (!has(req, 'IC')) return deny(res, 'IC');
  const pg = paging(req.query);
  const p = { div: req.query.division || null, s: req.query.search ? `%${req.query.search}%` : null, neg: req.query.negative === '1' ? 1 : 0 };
  const from = `FROM IcItemDivision d JOIN IcItem i ON i.InvItemID = d.InvItemId LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
    WHERE d.QtyOnHand <> 0 AND (@div IS NULL OR d.DivisionId = @div) AND (@neg = 0 OR d.QtyOnHand < 0)
      AND (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s OR ic.InvClass LIKE @s)`;
  const SORT = { value: 'Value DESC', qty: 'd.QtyOnHand DESC', item: 'i.InvItem' };
  const out = await paged(from,
    `d.InvDivisionID, i.InvItemID, i.InvItem, i.Description, ic.InvClass, d.DivisionId, i.Uom, d.QtyOnHand, d.QtyReOrder, d.QtyOnOrder,
     i.AverageCost, CAST(d.QtyOnHand AS decimal(18,4)) * i.AverageCost AS Value`,
    SORT[req.query.sort] || SORT.value, p, pg);
  const tot = await query(`SELECT SUM(CAST(d.QtyOnHand AS decimal(18,4)) * i.AverageCost) AS value ${from}`, p);
  res.json({ ...out, totalValue: tot[0].value });
}));

// Payroll pending — hourly entries staged for the next payroll (PrTempPayrollHourly)
router.get('/drill/payroll-pending', h(async (req, res) => {
  if (!has(req, 'PR')) return deny(res, 'PR');
  const pg = paging(req.query);
  const p = { s: req.query.search ? `%${req.query.search}%` : null };
  const from = `FROM PrTempPayrollHourly t LEFT JOIN LsWork w ON w.WorkID = t.WorkId LEFT JOIN LsHourTypePR ht ON ht.HourTypeID = t.HourTypeId
    WHERE (@s IS NULL OR t.EmpName LIKE @s OR t.JobName LIKE @s OR t.PackName LIKE @s)`;
  const [out, byEmp] = await Promise.all([
    paged(from, `t.TempLaborHourlyID, t.PayrollDate, t.DateWorked, t.EmpName, t.JobName, t.Phase, t.PlanNum, t.PackName, w.WorkType, ht.HourType, t.PayHours, t.Notes, t.UserEntered`,
      't.EmpName, t.DateWorked', p, pg),
    query(`SELECT t.EmpName, COUNT(*) AS entries, SUM(t.PayHours) AS hours ${from} GROUP BY t.EmpName ORDER BY hours DESC`, p),
  ]);
  res.json({ ...out, byEmployee: byEmp });
}));

// Billing for a month — ?month=YYYY-MM
router.get('/drill/billing', h(async (req, res) => {
  if (!has(req, 'AR')) return deny(res, 'AR');
  const pg = paging(req.query);
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
  const p = { m, s: req.query.search ? `%${req.query.search}%` : null };
  const from = `FROM ArBilling b WHERE (@m IS NULL OR FORMAT(b.[Date],'yyyy-MM') = @m)
    AND (@s IS NULL OR b.CustName LIKE @s OR b.JobName LIKE @s OR CAST(b.BillNum AS nvarchar(30)) LIKE @s OR b.LotBlock LIKE @s)`;
  const out = await paged(from,
    `b.BillID, b.BillNum, b.[Date], b.CustName, b.JobName, b.JobNum, b.LotBlock, b.DivisionId, b.Terms, b.BillTotal, ${MONEY('b.BillTotal')} AS Amount`,
    'b.[Date] DESC, b.BillID DESC', p, pg);
  const tot = await query(`SELECT SUM(${MONEY('b.BillTotal')}) AS total ${from}`, p);
  res.json({ ...out, month: m, totalAmount: tot[0].total });
}));

router.get('/drill/billing/:id', h(async (req, res) => {
  if (!has(req, 'AR')) return deny(res, 'AR');
  const id = parseInt(req.params.id, 10);
  const [bill, items] = await Promise.all([
    query('SELECT * FROM ArBilling WHERE BillID = @id', { id }),
    query(`SELECT BillItemID, PackName, ScheduleStage, WorkType, ItemCode, Quantity, ValueEa, BillPercent, ItemTotal, Notes
             FROM ArBillingItem WHERE BillId = @id ORDER BY BillItemID`, { id }),
  ]);
  if (!bill[0]) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ bill: bill[0], items });
}));

// Labor paid on one payroll date — ?date=YYYY-MM-DD
router.get('/drill/payroll-date', h(async (req, res) => {
  if (!has(req, 'PR')) return deny(res, 'PR');
  const pg = paging(req.query);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  if (!d) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  const p = { d };
  const from = `FROM PrLaborPaid x LEFT JOIN LsWork w ON w.WorkID = x.WorkId WHERE CAST(x.PayrollDate AS date) = @d`;
  const [out, byEmp] = await Promise.all([
    paged(from, `x.LaborPaidID, x.EmpName, x.JobName, x.Phase, x.Lot, x.Block, x.PackName, x.Item, w.WorkType, x.ExtItemQty, x.PriceEa, x.PayPercent, x.PayHours,
                 CAST(x.ExtItemQty AS decimal(18,4)) * x.PriceEa * x.PayPercent / 100 AS PiecePay, x.DateWorked`, 'x.EmpName, x.LaborPaidID', p, pg),
    query(`SELECT x.EmpName, COUNT(*) AS lines, SUM(CAST(x.ExtItemQty AS decimal(18,4)) * x.PriceEa * x.PayPercent / 100) AS piece, SUM(x.PayHours) AS hours
           ${from} GROUP BY x.EmpName ORDER BY piece DESC`, p),
  ]);
  res.json({ ...out, date: d, byEmployee: byEmp });
}));

// Records behind each "needs attention" item
const ATTENTION = {
  'payroll-hourly': { code: 'PR', title: 'Hourly payroll entries waiting to be posted', from: `FROM PrTempPayrollHourly t LEFT JOIN LsWork w ON w.WorkID = t.WorkId`, select: `t.TempLaborHourlyID AS id, t.PayrollDate, t.DateWorked, t.EmpName, t.JobName, t.PackName, w.WorkType, t.PayHours, t.UserEntered`, order: 't.EmpName, t.DateWorked' },
  'payroll-piece': { code: 'PR', title: 'Piece timecards not yet posted', from: `FROM PrTempPayroll t LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = t.ScheduleStageId`, select: `t.TempLaborID AS id, t.PayrollDate AS DateEntered, t.EmpName, t.JobName, t.Lot, t.Item, ss.ScheduleStage, t.ExtItemQty, t.PriceEa, ISNULL(CAST(t.ExtItemQty AS decimal(18,4)),0) * ISNULL(t.PriceEa,0) * ISNULL(t.PayPercent,0) / 100 + ISNULL(t.PayHours,0) * ISNULL(t.HourlyRate,0) AS Value, t.UserEntered`, order: 't.PayrollDate, t.EmpName' },
  'stages-overdue': { code: 'SC', title: 'Scheduled stages past delivery date', from: `FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId LEFT JOIN LsWork w ON w.WorkID = s.WorkId WHERE s.DatePosted IS NULL AND s.DeliveryDate < CAST(GETDATE() AS date)`, select: `s.StageAutoID AS id, s.LotId AS LotID, s.DeliveryDate, DATEDIFF(day, s.DeliveryDate, GETDATE()) AS DaysOverdue, j.JobName, l.Lot, l.Block, l.Address, ss.ScheduleStage, w.WorkType`, order: 's.DeliveryDate' },
  'inv-counts': { code: 'IC', title: 'Inventory counts need posting', from: `FROM IcInvDate c WHERE ISNULL(c.Posted,0) = 0`, select: `c.InventoryID AS id, c.InvDate, c.DivisionId, c.FromDate, c.ToDate, c.Notes, (SELECT COUNT(*) FROM IcInvItem ii WHERE ii.InventoryId = c.InventoryID) AS Lines, c.UserEntered`, order: 'c.InvDate' },
  'inv-negative': { code: 'IC', title: 'Items with negative stock on hand', from: `FROM IcItemDivision d JOIN IcItem i ON i.InvItemID = d.InvItemId WHERE d.QtyOnHand < 0`, select: `d.InvDivisionID AS id, i.InvItem, i.Description, d.DivisionId, d.QtyOnHand, i.AverageCost, CAST(d.QtyOnHand AS decimal(18,4)) * i.AverageCost AS Value`, order: 'd.QtyOnHand' },
  'tm-unapproved': { code: 'TM', title: 'T&M orders awaiting approval', from: `FROM TmPO t WHERE t.ApprovedDate IS NULL`, select: `t.TmID AS id, t.TmDate, t.TmName, t.TmCustomerNum, t.RequestedBy, t.PreparedBy, (SELECT SUM(Price) FROM TmPOPack k WHERE k.TmId = t.TmID) AS PackTotal`, order: 't.TmDate' },
  'tm-unpaid': { code: 'TM', title: 'Approved T&M orders not marked paid', from: `FROM TmPO t WHERE t.ApprovedDate IS NOT NULL AND t.PaidDate IS NULL`, select: `t.TmID AS id, t.TmDate, t.TmName, t.ApprovedDate, t.ApprovedBy, t.RequestedBy, (SELECT SUM(Price) FROM TmPOPack k WHERE k.TmId = t.TmID) AS PackTotal`, order: 't.ApprovedDate' },
  'am-renewals': { code: 'AM', title: 'Alarm contracts past renewal date', from: `FROM AmAccount a WHERE a.DisconnectionDate IS NULL AND a.RenewalDate < CAST(GETDATE() AS date)`, select: `a.AccountID AS id, a.AccountNumber, a.CustomerName, a.PhoneNumber, a.ContractTerms, a.MonthlyContractValue, a.RenewalDate`, order: 'a.RenewalDate' },
};
router.get('/drill/attention/:key', h(async (req, res) => {
  const def = ATTENTION[req.params.key];
  if (!def) return res.status(404).json({ error: 'Unknown item' });
  if (!has(req, def.code)) return deny(res, def.code);
  const out = await paged(def.from, def.select, def.order, {}, paging(req.query));
  res.json({ ...out, title: def.title, module: def.code });
}));

module.exports = router;
