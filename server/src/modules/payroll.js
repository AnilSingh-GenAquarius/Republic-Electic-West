// Payroll (PR) — mirrors the Access "SwitchPR" workflow that is in use today:
//   1. Process piece timecard   (PrProcessLot  + macro PrTimecard)          JsPackLaborTemp -> PrTempPayroll
//   2. Process hourly timecard  (PrProcessHourly + macro PrSubmitHourly)    -> PrTempPayrollHourly
//   3. Append hourly to piece   (macro PrTimecardAppendHourly)              PrTempPayrollHourly -> PrTempPayroll
//   4. Post payroll             (macro PrTimecardPost)                      PrTempPayroll -> JcLotItem + PrLaborPaid
// (The "new" PrN* process in Access is switched off — "Feature is not active" — so it is not reproduced.)
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, h, paging } = require('../crud');

const router = express.Router();
const HOURLY_ITEM_ID = 3168; // IcItem LBR-HOURLY, hard-coded in the Access queries

// Pay for one line: qty × price × pay% / 100 + hours × hourly rate  (Access ExtPay)
const EXT_PAY = (t) => `(ISNULL(CAST(${t}.ExtItemQty AS decimal(18,4)),0) * ISNULL(${t}.PriceEa,0) * ISNULL(${t}.PayPercent,0) / 100
  + ISNULL(CAST(${t}.PayHours AS decimal(18,4)),0) * ISNULL(TRY_CAST(${t}.HourlyRate AS decimal(18,4)),0))`;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dateOnly = (v) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw bad('A valid payroll date (YYYY-MM-DD) is required');
  return String(v).slice(0, 10);
};
// Access builds the name as "First M Last"
const EMP_NAME = `e.FName + ' ' + CASE WHEN e.MInitial IS NULL OR e.MInitial = '' THEN e.LName ELSE e.MInitial + ' ' + e.LName END`;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [titles, payTypes, hourTypes, workTypes, scheduleStages, divisions] = await Promise.all([
    query('SELECT TitleID AS id, Title AS name FROM LsTitlePR ORDER BY Title'),
    query('SELECT PayTypeID AS id, PayType AS name, Piece, Reimburse FROM LsPayTypePr ORDER BY PayTypeID'),
    query('SELECT HourTypeID AS id, HourType AS name, HourlyRateMultiplier FROM LsHourTypePR ORDER BY HourTypeID'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
  ]);
  res.json({ titles, payTypes, hourTypes, workTypes, scheduleStages, divisions });
}));

// ---------------------------------------------------------------------------
// Payroll home: pending dates and status for one payroll date
// ---------------------------------------------------------------------------
router.get('/status', h(async (req, res) => {
  const [pieceDates, hourlyDates, postedDates] = await Promise.all([
    query(`SELECT CAST(PayrollDate AS date) AS PayrollDate, COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees,
                  SUM(${EXT_PAY('t')}) AS pay
             FROM PrTempPayroll t GROUP BY CAST(PayrollDate AS date) ORDER BY PayrollDate DESC`),
    query(`SELECT CAST(PayrollDate AS date) AS PayrollDate, COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees,
                  SUM(PayHours) AS hours
             FROM PrTempPayrollHourly GROUP BY CAST(PayrollDate AS date) ORDER BY PayrollDate DESC`),
    query(`SELECT TOP 8 CAST(PayrollDate AS date) AS PayrollDate, COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees,
                  SUM(${EXT_PAY('x')}) AS pay
             FROM PrLaborPaid x GROUP BY CAST(PayrollDate AS date) ORDER BY PayrollDate DESC`),
  ]);
  let date = null;
  if (req.query.date) {
    const d = dateOnly(req.query.date);
    const [piece, hourly, problems, posted] = await Promise.all([
      query(`SELECT COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees, SUM(${EXT_PAY('t')}) AS pay, SUM(PayHours) AS hours
               FROM PrTempPayroll t WHERE CAST(PayrollDate AS date) = @d`, { d }),
      query(`SELECT COUNT(*) AS lines, COUNT(DISTINCT EmployeeId) AS employees, SUM(PayHours) AS hours
               FROM PrTempPayrollHourly WHERE CAST(PayrollDate AS date) = @d`, { d }),
      query(`SELECT COUNT(*) AS n FROM PrTempPayroll t LEFT JOIN JsPack p ON p.LotId = t.LotId AND p.PackID = t.PackId
              WHERE CAST(t.PayrollDate AS date) = @d AND p.PackID IS NULL`, { d }),
      query(`SELECT COUNT(*) AS lines FROM PrLaborPaid WHERE CAST(PayrollDate AS date) = @d`, { d }),
    ]);
    date = { date: d, piece: piece[0], hourly: hourly[0], postProblems: problems[0].n, alreadyPosted: posted[0].lines };
  }
  res.json({ pieceDates, hourlyDates, postedDates, date });
}));

// ---------------------------------------------------------------------------
// Employees (PrEmployee)
// ---------------------------------------------------------------------------
const EMPLOYEE = {
  table: 'PrEmployee', idCol: 'EmployeeID',
  columns: ['EmployeeNum', 'FName', 'MInitial', 'LName', 'DivisionId', 'DateHire', 'DateTermination', 'TitleId',
    'PayTypeId', 'HourlyRate', 'WagesRate', 'Salary', 'PayId', 'DefaultScheduleStageId', 'Notes'],
};

router.get('/employees', h(async (req, res) => {
  const pg = paging(req.query);
  const p = {
    s: req.query.search ? `%${req.query.search}%` : null,
    status: req.query.status || 'active',
    div: req.query.division || null,
    title: req.query.titleId ? parseInt(req.query.titleId, 10) : null,
    offset: pg.offset, pageSize: pg.pageSize,
  };
  const where = `WHERE (@s IS NULL OR e.FName LIKE @s OR e.LName LIKE @s OR e.EmployeeNum LIKE @s OR e.LName + ', ' + e.FName LIKE @s)
    AND (@status = 'all' OR (@status = 'active' AND e.DateTermination IS NULL) OR (@status = 'terminated' AND e.DateTermination IS NOT NULL))
    AND (@div IS NULL OR e.DivisionId = @div) AND (@title IS NULL OR e.TitleId = @title)`;
  const SORT = { name: 'e.LName, e.FName', num: 'TRY_CAST(e.EmployeeNum AS int), e.EmployeeNum', hire: 'e.DateHire DESC', last: 'LastPaid DESC' };
  const [rows, total] = await Promise.all([
    query(`SELECT e.EmployeeID, e.EmployeeNum, e.FName, e.MInitial, e.LName, e.DivisionId, e.DateHire, e.DateTermination,
                  t.Title, pt.PayType, e.HourlyRate,
                  (SELECT MAX(PayrollDate) FROM PrLaborPaid x WHERE x.EmployeeId = e.EmployeeID) AS LastPaid
             FROM PrEmployee e LEFT JOIN LsTitlePR t ON t.TitleID = e.TitleId LEFT JOIN LsPayTypePr pt ON pt.PayTypeID = e.PayTypeId
             ${where} ORDER BY ${SORT[req.query.sort] || SORT.name} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM PrEmployee e ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/employees/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp, recent, totals] = await Promise.all([
    query('SELECT * FROM PrEmployee WHERE EmployeeID = @id', { id }),
    query(`SELECT TOP 12 CAST(PayrollDate AS date) AS PayrollDate, COUNT(*) AS lines, SUM(${EXT_PAY('x')}) AS pay,
                  SUM(CAST(x.PayHours AS decimal(18,4))) AS hours
             FROM PrLaborPaid x WHERE x.EmployeeId = @id GROUP BY CAST(PayrollDate AS date) ORDER BY PayrollDate DESC`, { id }),
    query(`SELECT COUNT(*) AS lines, SUM(${EXT_PAY('x')}) AS pay, MIN(PayrollDate) AS firstPaid, MAX(PayrollDate) AS lastPaid
             FROM PrLaborPaid x WHERE x.EmployeeId = @id`, { id }),
  ]);
  if (!emp[0]) return res.status(404).json({ error: 'Employee not found' });
  res.json({ employee: emp[0], recentPayrolls: recent, totals: totals[0] });
}));

function validateEmployee(b) {
  if (b.FName !== undefined && !String(b.FName || '').trim()) throw bad('First name is required');
  if (b.LName !== undefined && !String(b.LName || '').trim()) throw bad('Last name is required');
  if (b.DateHire && b.DateTermination && b.DateTermination < b.DateHire) throw bad('Termination date cannot be before hire date');
}

router.post('/employees', h(async (req, res) => {
  const b = req.body || {};
  if (!b.FName || !b.LName) throw bad('First and last name are required');
  validateEmployee(b);
  const id = await withTransaction(async (tx) => {
    if (b.EmployeeNum) {
      const dup = await query('SELECT 1 AS x FROM PrEmployee WHERE EmployeeNum = @n', { n: b.EmployeeNum }, tx);
      if (dup.length) throw bad(`Employee # ${b.EmployeeNum} is already used`, 409);
    }
    return insertRow(EMPLOYEE, b, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/employees/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  validateEmployee(b);
  const n = await withTransaction(async (tx) => {
    if (b.EmployeeNum) {
      const dup = await query('SELECT 1 AS x FROM PrEmployee WHERE EmployeeNum = @n AND EmployeeID <> @id', { n: b.EmployeeNum, id }, tx);
      if (dup.length) throw bad(`Employee # ${b.EmployeeNum} is already used`, 409);
    }
    return updateRow(EMPLOYEE, id, b, tx);
  });
  if (!n) return res.status(404).json({ error: 'Employee not found' });
  res.json({ ok: true });
}));

router.get('/employees-next-number', h(async (req, res) => {
  const r = await query("SELECT ISNULL(MAX(TRY_CAST(EmployeeNum AS int)),0) + 1 AS n FROM PrEmployee");
  res.json({ employeeNum: String(r[0].n).padStart(3, '0') });
}));

// ---------------------------------------------------------------------------
// Pay periods (PrPayPeriod)
// ---------------------------------------------------------------------------
router.get('/periods', h(async (req, res) => {
  const rows = await query(`SELECT TOP 200 PayPeriodID, PayrollDate, PeriodFrom, PeriodTo, DateEntered, UserEntered
                              FROM PrPayPeriod ORDER BY PayrollDate DESC`);
  res.json({ rows });
}));
router.post('/periods', h(async (req, res) => {
  const b = req.body || {};
  const d = dateOnly(b.PayrollDate);
  if (!b.PeriodFrom || !b.PeriodTo) throw bad('Period from and to dates are required');
  if (b.PeriodTo < b.PeriodFrom) throw bad('Period "to" date is before "from" date');
  const id = await withTransaction(async (tx) => {
    const dup = await query('SELECT 1 AS x FROM PrPayPeriod WHERE CAST(PayrollDate AS date) = @d', { d }, tx);
    if (dup.length) throw bad(`A pay period for payroll date ${d} already exists`, 409);
    return insertRow({ table: 'PrPayPeriod', idCol: 'PayPeriodID', columns: ['PayrollDate', 'PeriodFrom', 'PeriodTo'] },
      { PayrollDate: d, PeriodFrom: b.PeriodFrom, PeriodTo: b.PeriodTo }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.delete('/periods/:id', h(async (req, res) => {
  await query('DELETE FROM PrPayPeriod WHERE PayPeriodID = @id', { id: parseInt(req.params.id, 10) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Pickers specific to payroll: active jobs, open lots (PrProcessLot only offers EndDate IS NULL AND StatusId = 1)
// ---------------------------------------------------------------------------
router.get('/jobs', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 100 j.JobId AS id, j.JobName AS name, j.DivisionId, c.CustName,
            (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId AND l.EndDate IS NULL AND l.StatusId = 1) AS openLots
       FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId
      WHERE (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s)
        AND EXISTS (SELECT 1 FROM JsLot l WHERE l.JobId = j.JobId AND (@openOnly = 0 OR (l.EndDate IS NULL AND l.StatusId = 1)))
      ORDER BY j.JobName`,
    { s: req.query.search ? `%${req.query.search}%` : null, openOnly: req.query.all === '1' ? 0 : 1 }
  );
  res.json(rows);
}));
router.get('/jobs/:jobId/lots', h(async (req, res) => {
  const rows = await query(
    `SELECT l.LotID AS id, ISNULL(ph.Phase + ' · ', '') + 'Lot ' + ISNULL(l.Lot,'') + ISNULL('/' + NULLIF(l.Block,''), '')
              + ISNULL(' – ' + l.Address, '') AS name,
            l.Lot, l.Block, ph.Phase, l.Address, l.LotNotes,
            (SELECT COUNT(*) FROM JsPackLaborTemp t WHERE t.LotId = l.LotID) AS laborLines
       FROM JsLot l LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      WHERE l.JobId = @j AND (@openOnly = 0 OR (l.EndDate IS NULL AND l.StatusId = 1))
      ORDER BY ph.Phase, TRY_CAST(l.Lot AS int), l.Lot`,
    { j: parseInt(req.params.jobId, 10), openOnly: req.query.all === '1' ? 0 : 1 }
  );
  res.json(rows);
}));

// ---------------------------------------------------------------------------
// 1. Process piece timecard
// ---------------------------------------------------------------------------
// Labor lines for a lot (JsPackLaborTemp), with what has already been paid / staged for each line.
router.get('/piece/lot/:lotId', h(async (req, res) => {
  const lotId = parseInt(req.params.lotId, 10);
  const work = req.query.workId ? parseInt(req.query.workId, 10) : null;
  const [lot, lines, works] = await Promise.all([
    query(`SELECT l.LotID, l.Lot, l.Block, l.LotNotes, l.Address, j.JobId, j.JobName, j.DivisionId, ph.Phase, pl.PlanNum
             FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
             LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lotId`, { lotId }),
    query(`SELECT t.PackItemID, t.PackId, t.PmPackId, pk.PackName, pk.PackTypeId, t.PackQty, ss.ScheduleStage, t.ScheduleStageId,
                  w.WorkType, t.WorkId, i.InvItem, i.AlternateCode, ISNULL(i.AlternateCode, i.InvItem) AS Item, i.Description,
                  t.ExtItemQty, t.PriceEa, CAST(t.ExtItemQty AS decimal(18,4)) * t.PriceEa AS ExtLaborPrice, t.Notes,
                  ISNULL((SELECT SUM(x.PayPercent) FROM PrLaborPaid x
                           WHERE x.LotId = t.LotId AND x.PackId = t.PackId AND x.InvItemId = t.InvItemId AND x.ScheduleStageId = t.ScheduleStageId), 0) AS PaidPercent,
                  ISNULL((SELECT SUM(p.PayPercent) FROM PrTempPayroll p
                           WHERE p.LotId = t.LotId AND p.PackId = t.PackId AND p.InvItemId = t.InvItemId AND p.ScheduleStageId = t.ScheduleStageId), 0) AS PendingPercent
             FROM JsPackLaborTemp t
             JOIN IcItem i ON i.InvItemID = t.InvItemId
             JOIN PmPack pk ON pk.PmPackID = t.PmPackId
             LEFT JOIN LsWork w ON w.WorkID = t.WorkId
             LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = t.ScheduleStageId
            WHERE t.LotId = @lotId AND (@work IS NULL OR t.WorkId = @work)
            ORDER BY pk.PackTypeId, ss.ScheduleStage, pk.PackName, ISNULL(i.AlternateCode, i.InvItem)`, { lotId, work }),
    query(`SELECT DISTINCT w.WorkID AS id, w.WorkType AS name FROM JsPackLaborTemp t JOIN LsWork w ON w.WorkID = t.WorkId
            WHERE t.LotId = @lotId ORDER BY w.WorkType`, { lotId }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json({ lot: lot[0], lines, workTypes: works });
}));

// Submit selected lines to an employee's timecard (PrTempPayroll). body: { payrollDate, employeeId, lotId,
//   lines: [{ packItemId, payPercent, payHours, hourlyRate, dateWorked, notes }] }
router.post('/piece/submit', h(async (req, res) => {
  const b = req.body || {};
  const d = dateOnly(b.payrollDate);
  const employeeId = parseInt(b.employeeId, 10);
  const lotId = parseInt(b.lotId, 10);
  if (!employeeId) throw bad('Select an employee');
  if (!lotId) throw bad('Select a lot');
  const lines = (b.lines || []).filter((l) => Number(l.payPercent) > 0 || Number(l.payHours) > 0);
  if (!lines.length) throw bad('Set a pay % (or hours) on at least one line');
  for (const l of lines) {
    const pct = Number(l.payPercent || 0);
    if (pct < 0 || pct > 100) throw bad('Pay % must be between 0 and 100');
    if (Number(l.payHours || 0) < 0) throw bad('Hours cannot be negative');
  }

  const inserted = await withTransaction(async (tx) => {
    const emp = await query(`SELECT ${EMP_NAME} AS EmpName FROM PrEmployee e WHERE e.EmployeeID = @employeeId`, { employeeId }, tx);
    if (!emp[0]) throw bad('Employee not found', 404);
    let n = 0;
    for (const l of lines) {
      const r = await query(
        `INSERT INTO PrTempPayroll (PayrollDate, EmployeeId, EmpName, JobId, JobName, Phase, LotId, Lot, Block, PlanNum, PlanSqFt,
                                   PackId, PmPackId, PackName, PackQty, PackItemId, InvItemId, Item, ExtItemQty, ScheduleStageId, WorkId,
                                   PriceEa, PayPercent, PayHours, HourlyRate, HourTypeId, DateWorked, Notes, DateEntered, UserEntered)
         SELECT @d, @employeeId, @empName, j.JobId, j.JobName, ph.Phase, l.LotID, l.Lot, l.Block, pl.PlanNum, pl.SqFt,
                t.PackId, t.PmPackId, pk.PackName, t.PackQty, t.PackItemID, t.InvItemId, ISNULL(i.AlternateCode, i.InvItem), t.ExtItemQty,
                t.ScheduleStageId, t.WorkId, t.PriceEa, @pct, @hrs, @rate, 1, @worked, @notes, GETDATE(), @user
           FROM JsPackLaborTemp t
           JOIN JsLot l ON l.LotID = t.LotId
           JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
           JOIN JsJob j ON j.JobId = ph.JobId
           JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
           JOIN PmPack pk ON pk.PmPackID = t.PmPackId
           JOIN IcItem i ON i.InvItemID = t.InvItemId
          WHERE t.PackItemID = @packItemId AND t.LotId = @lotId;
         SELECT @@ROWCOUNT AS n`,
        {
          d, employeeId, empName: emp[0].EmpName, lotId, packItemId: parseInt(l.packItemId, 10),
          pct: Number(l.payPercent || 0), hrs: Number(l.payHours || 0), rate: Number(l.hourlyRate || 0),
          worked: l.dateWorked || null, notes: l.notes || null, user: req.user.username,
        },
        tx
      );
      n += r[0].n;
    }
    if (n !== lines.length) throw bad('Some labor lines were not found on this lot (they may have been changed). Reload and try again.', 409);
    return n;
  });
  res.status(201).json({ inserted });
}));

// An employee's timecard for a payroll date (PrTempPayroll)
router.get('/timecard', h(async (req, res) => {
  const d = dateOnly(req.query.date);
  const employeeId = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  const rows = await query(
    `SELECT t.TempLaborID, t.EmployeeId, t.EmpName, t.JobName, t.Phase, t.Lot, t.Block, t.PackName, t.Item, t.ExtItemQty, t.PriceEa,
            t.PayPercent, t.PayHours, t.HourlyRate, t.HourTypeId, ht.HourType, w.WorkType, ss.ScheduleStage, t.DateWorked, t.Notes,
            ${EXT_PAY('t')} AS ExtPay, CASE WHEN p.PackID IS NULL THEN 1 ELSE 0 END AS PackMissing, t.UserEntered
       FROM PrTempPayroll t
       LEFT JOIN JsPack p ON p.LotId = t.LotId AND p.PackID = t.PackId
       LEFT JOIN LsWork w ON w.WorkID = t.WorkId
       LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = t.ScheduleStageId
       LEFT JOIN LsHourTypePR ht ON ht.HourTypeID = t.HourTypeId
      WHERE CAST(t.PayrollDate AS date) = @d AND (@employeeId IS NULL OR t.EmployeeId = @employeeId)
      ORDER BY t.EmpName, t.JobName, t.Lot, t.PackName, t.Item`,
    { d, employeeId }
  );
  res.json({ rows });
}));

router.put('/timecard/:id', h(async (req, res) => {
  const b = req.body || {};
  const pct = b.PayPercent !== undefined ? Number(b.PayPercent) : undefined;
  if (pct !== undefined && (pct < 0 || pct > 100)) throw bad('Pay % must be between 0 and 100');
  const n = await updateRow({ table: 'PrTempPayroll', idCol: 'TempLaborID', columns: ['PayPercent', 'PayHours', 'HourlyRate', 'HourTypeId', 'DateWorked', 'Notes'] },
    parseInt(req.params.id, 10), b);
  if (!n) return res.status(404).json({ error: 'Timecard line not found' });
  res.json({ ok: true });
}));
router.delete('/timecard/:id', h(async (req, res) => {
  await query('DELETE FROM PrTempPayroll WHERE TempLaborID = @id', { id: parseInt(req.params.id, 10) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// 2. Process hourly timecard (PrTempPayrollHourly)
// ---------------------------------------------------------------------------
router.get('/hourly', h(async (req, res) => {
  const d = dateOnly(req.query.date);
  const employeeId = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  const [rows, byEmployee] = await Promise.all([
    query(`SELECT t.TempLaborHourlyID, t.EmployeeId, t.EmpName, t.DateWorked, t.JobId, t.JobName, t.Phase, t.LotId, t.Lot, t.Block,
                  t.LotBlock, t.PackId, t.PackName, t.ScheduleStageId, ss.ScheduleStage, t.WorkId, w.WorkType, t.HourTypeId, ht.HourType,
                  t.PayId, pt.PayType, t.PayHours, t.HourlyRate, CAST(t.PayHours AS decimal(18,4)) * ISNULL(TRY_CAST(t.HourlyRate AS decimal(18,4)),0) AS Amount,
                  t.Notes, t.UserEntered
             FROM PrTempPayrollHourly t
             LEFT JOIN LsWork w ON w.WorkID = t.WorkId
             LEFT JOIN LsHourTypePR ht ON ht.HourTypeID = t.HourTypeId
             LEFT JOIN LsPayTypePr pt ON pt.PayTypeID = t.PayId
             LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = t.ScheduleStageId
            WHERE CAST(t.PayrollDate AS date) = @d AND (@employeeId IS NULL OR t.EmployeeId = @employeeId)
            ORDER BY t.EmpName, t.DateWorked, t.TempLaborHourlyID`, { d, employeeId }),
    query(`SELECT t.EmployeeId, MAX(t.EmpName) AS EmpName, COUNT(*) AS entries, SUM(t.PayHours) AS hours,
                  SUM(CAST(t.PayHours AS decimal(18,4)) * ISNULL(TRY_CAST(t.HourlyRate AS decimal(18,4)),0)) AS amount
             FROM PrTempPayrollHourly t WHERE CAST(t.PayrollDate AS date) = @d GROUP BY t.EmployeeId ORDER BY MAX(t.EmpName)`, { d }),
  ]);
  res.json({ rows, byEmployee });
}));

// body: { payrollDate, employeeId, lotId, packId, scheduleStageId, workId, hourTypeId, payTypeId, hours, hourlyRate, dateWorked, notes }
router.post('/hourly', h(async (req, res) => {
  const b = req.body || {};
  const d = dateOnly(b.payrollDate);
  const need = { employeeId: 'employee', lotId: 'lot', packId: 'pack', workId: 'work type', hourTypeId: 'hour type' };
  for (const [k, label] of Object.entries(need)) if (!b[k]) throw bad(`Select a ${label}`);
  const hours = Number(b.hours);
  if (!(hours > 0) || hours > 24 * 14) throw bad('Enter the hours worked');
  const rate = b.hourlyRate === '' || b.hourlyRate == null ? null : Number(b.hourlyRate);
  if (rate != null && (isNaN(rate) || rate < 0)) throw bad('Hourly rate must be a positive number');

  const id = await withTransaction(async (tx) => {
    const ctx = await query(
      `SELECT ${EMP_NAME} AS EmpName, j.JobId, j.JobName, ph.Phase, l.LotID, l.Lot, l.Block, pl.PlanNum, pl.SqFt,
              p.PackID, p.PmPackId, pk.PackName, ht.HourlyRateMultiplier
         FROM PrEmployee e, JsLot l
         JOIN JsJob j ON j.JobId = l.JobId
         JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
         JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
         JOIN JsPack p ON p.LotId = l.LotID
         JOIN PmPack pk ON pk.PmPackID = p.PmPackId,
              LsHourTypePR ht
        WHERE e.EmployeeID = @emp AND l.LotID = @lot AND p.PackID = @pack AND ht.HourTypeID = @ht`,
      { emp: parseInt(b.employeeId, 10), lot: parseInt(b.lotId, 10), pack: parseInt(b.packId, 10), ht: parseInt(b.hourTypeId, 10) }, tx);
    const c = ctx[0];
    if (!c) throw bad('That employee / lot / pack / hour type combination was not found');
    const newId = await nextId(tx, 'PrTempPayrollHourly', 'TempLaborHourlyID');
    // Access stores the rate already multiplied by the hour-type multiplier (Regular 1, OT 1.5, Double 2)
    const effRate = rate == null ? null : (rate * Number(c.HourlyRateMultiplier || 1)).toFixed(2);
    await query(
      `INSERT INTO PrTempPayrollHourly (TempLaborHourlyID, PayrollDate, EmployeeId, JobName, LotBlock, PackName, WorkId, PayHours, HourlyRate,
              HourTypeId, PayId, DateWorked, Notes, EmpName, JobId, Phase, LotId, Lot, Block, PlanNum, PlanSqFt, PackId, PmPackId, InvItemId,
              ScheduleStageId, DateEntered, UserEntered)
       VALUES (@id, @d, @emp, @jobName, @lotBlock, @packName, @work, @hours, @rate, @ht, @payType, @worked, @notes, @empName, @jobId, @phase,
               @lotId, @lot, @block, @planNum, @sqft, @packId, @pmPackId, ${HOURLY_ITEM_ID}, @stage, GETDATE(), @user)`,
      {
        id: newId, d, emp: parseInt(b.employeeId, 10), jobName: c.JobName, lotBlock: `${c.Lot ?? ''}/${c.Block ?? ''}`, packName: c.PackName,
        work: parseInt(b.workId, 10), hours, rate: effRate, ht: parseInt(b.hourTypeId, 10), payType: b.payTypeId ? parseInt(b.payTypeId, 10) : null,
        worked: b.dateWorked || null, notes: b.notes || null, empName: c.EmpName, jobId: c.JobId, phase: c.Phase, lotId: c.LotID, lot: c.Lot,
        block: c.Block, planNum: c.PlanNum, sqft: c.SqFt, packId: c.PackID, pmPackId: c.PmPackId,
        stage: b.scheduleStageId ? parseInt(b.scheduleStageId, 10) : null, user: req.user.username,
      }, tx);
    return newId;
  });
  res.status(201).json({ id });
}));

router.delete('/hourly/:id', h(async (req, res) => {
  await query('DELETE FROM PrTempPayrollHourly WHERE TempLaborHourlyID = @id', { id: parseInt(req.params.id, 10) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// 3. Append hourly to piece (validates, then moves PrTempPayrollHourly -> PrTempPayroll for the payroll date)
// ---------------------------------------------------------------------------
router.post('/append-hourly', h(async (req, res) => {
  const d = dateOnly((req.body || {}).payrollDate);
  const result = await withTransaction(async (tx) => {
    // Fill gaps exactly like qryPrHourlyAppend1LotId / 1EJL / 3 / 31
    await query(`UPDATE t SET t.LotId = l.LotID FROM PrTempPayrollHourly t JOIN JsJob j ON j.JobName = t.JobName
                  JOIN JsLot l ON l.JobId = j.JobId AND l.JobId = t.JobId AND l.Lot = t.Lot AND l.Block = t.Block
                 WHERE t.LotId IS NULL AND CAST(t.PayrollDate AS date) = @d`, { d }, tx);
    await query(`UPDATE t SET t.Lot = l.Lot, t.Block = l.Block FROM PrTempPayrollHourly t JOIN JsLot l ON l.LotID = t.LotId
                 WHERE t.Lot IS NULL AND t.Block IS NULL AND CAST(t.PayrollDate AS date) = @d`, { d }, tx);
    await query(`UPDATE t SET t.PackName = pk.PackName, t.PmPackId = p.PmPackId, t.InvItemId = ${HOURLY_ITEM_ID}
                   FROM PrTempPayrollHourly t JOIN JsPack p ON p.PackID = t.PackId JOIN PmPack pk ON pk.PmPackID = p.PmPackId
                  WHERE CAST(t.PayrollDate AS date) = @d`, { d }, tx);
    await query(`UPDATE t SET t.PackId = p.PackID FROM PrTempPayrollHourly t JOIN JsPack p ON p.LotId = t.LotId
                   JOIN PmPack pk ON pk.PmPackID = p.PmPackId AND pk.PackName = t.PackName
                  WHERE CAST(t.PayrollDate AS date) = @d AND t.PackId IS NULL`, { d }, tx);

    const problems = await query(
      `SELECT t.TempLaborHourlyID, t.EmpName, t.JobName, t.LotBlock, t.PackName,
              CASE WHEN t.LotId IS NULL OR t.Lot IS NULL THEN 'Lot not found' ELSE 'Pack not found' END AS Problem
         FROM PrTempPayrollHourly t
        WHERE CAST(t.PayrollDate AS date) = @d AND (t.LotId IS NULL OR t.Lot IS NULL OR t.PackId IS NULL OR t.PackName IS NULL)`, { d }, tx);
    if (problems.length) return { appended: 0, problems };

    const r = await query(
      `INSERT INTO PrTempPayroll (PayrollDate, EmployeeId, EmpName, JobId, JobName, Phase, LotId, Lot, Block, PlanNum, PlanSqFt, PackId, PmPackId,
                                 PackName, PackQty, InvItemId, Item, ExtItemQty, ScheduleStageId, WorkId, PriceEa, PayPercent, PayHours, HourlyRate,
                                 HourTypeId, PayId, DateWorked, Notes, DateEntered, UserEntered)
       SELECT t.PayrollDate, t.EmployeeId, t.EmpName, t.JobId, t.JobName, t.Phase, t.LotId, t.Lot, t.Block, t.PlanNum, t.PlanSqFt, t.PackId, t.PmPackId,
              t.PackName, 1, t.InvItemId, i.InvItem, 1, t.ScheduleStageId, t.WorkId, 0, 0, t.PayHours, TRY_CAST(t.HourlyRate AS decimal(18,4)),
              t.HourTypeId, t.PayId, t.DateWorked, t.Notes, GETDATE(), @user
         FROM PrTempPayrollHourly t JOIN IcItem i ON i.InvItemID = t.InvItemId
        WHERE CAST(t.PayrollDate AS date) = @d;
       SELECT @@ROWCOUNT AS n`, { d, user: req.user.username }, tx);
    await query('DELETE FROM PrTempPayrollHourly WHERE CAST(PayrollDate AS date) = @d', { d }, tx);
    return { appended: r[0].n, problems: [] };
  });
  if (result.problems.length) {
    return res.status(422).json({ ...result, error: `${result.problems.length} hourly entries don't match a lot or pack. Fix or delete them, then append again.` });
  }
  res.json(result);
}));

// ---------------------------------------------------------------------------
// 4. Post payroll (PrTempPayroll -> JcLotItem + PrLaborPaid, then clear)
// ---------------------------------------------------------------------------
router.get('/post-check', h(async (req, res) => {
  const d = dateOnly(req.query.date);
  const problems = await query(
    `SELECT t.TempLaborID, t.EmpName, t.JobName, t.Lot, t.Block, t.PackName, t.Item, t.PayPercent, t.PayHours
       FROM PrTempPayroll t LEFT JOIN JsPack p ON p.LotId = t.LotId AND p.PackID = t.PackId
      WHERE CAST(t.PayrollDate AS date) = @d AND p.PackID IS NULL`, { d });
  res.json({ problems });
}));

router.post('/post', h(async (req, res) => {
  const d = dateOnly((req.body || {}).payrollDate);
  const result = await withTransaction(async (tx) => {
    const count = await query('SELECT COUNT(*) AS n FROM PrTempPayroll WHERE CAST(PayrollDate AS date) = @d', { d }, tx);
    if (!count[0].n) throw bad(`There is nothing on the timecard for ${d}`);
    // Same guard as PrTimecardPost: every line must still point at a pack on its lot (qryPrPostPayrollCheck)
    const problems = await query(
      `SELECT t.TempLaborID FROM PrTempPayroll t LEFT JOIN JsPack p ON p.LotId = t.LotId AND p.PackID = t.PackId
        WHERE CAST(t.PayrollDate AS date) = @d AND p.PackID IS NULL`, { d }, tx);
    if (problems.length) throw bad(`${problems.length} timecard line(s) no longer match the job data. Fix or remove them before posting.`, 409);

    // Job cost (qryPrPostPayrollJobCost) — JcItemID has no IDENTITY, allocate a block after MAX
    const jcBase = await nextId(tx, 'JcLotItem', 'JcItemID');
    await query(
      `INSERT INTO JcLotItem (JcItemID, LotId, PackId, InvItemId, ScheduleStageId, WorkId, CostCodeId, EmployeeId, ExtItemQty, JobCostPrice,
                             PayPercent, Hours, HourlyRate, Notes, DateEntered, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY t.TempLaborID) - 1, t.LotId, t.PackId, t.InvItemId, t.ScheduleStageId, t.WorkId, 'L', t.EmployeeId,
              t.ExtItemQty, t.PriceEa, t.PayPercent, t.PayHours, CAST(t.HourlyRate AS nvarchar(255)), t.Notes, GETDATE(), @user
         FROM PrTempPayroll t WHERE CAST(t.PayrollDate AS date) = @d`, { d, base: jcBase, user: req.user.username }, tx);

    // Labor paid (qryPrPostPayrollLabor)
    const lpBase = await nextId(tx, 'PrLaborPaid', 'LaborPaidID');
    const ins = await query(
      `INSERT INTO PrLaborPaid (LaborPaidID, PayrollDate, EmployeeId, EmpName, JobId, JobName, Phase, LotId, Lot, Block, PlanNum, PlanSqFt, PackId,
                               PmPackId, PackName, PackQty, PackItemId, InvItemId, Item, ExtItemQty, ScheduleStageId, WorkId, PriceEa, PayPercent,
                               PayHours, HourlyRate, HourTypeId, DateWorked, Notes, DateEntered, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY t.TempLaborID) - 1, t.PayrollDate, t.EmployeeId, t.EmpName, t.JobId, t.JobName, t.Phase, t.LotId,
              t.Lot, t.Block, t.PlanNum, t.PlanSqFt, t.PackId, t.PmPackId, t.PackName, t.PackQty, t.PackItemId, t.InvItemId, t.Item, t.ExtItemQty,
              t.ScheduleStageId, t.WorkId, t.PriceEa, t.PayPercent, t.PayHours, CAST(t.HourlyRate AS nvarchar(255)), t.HourTypeId,
              CONVERT(nvarchar(30), t.DateWorked, 101), t.Notes, GETDATE(), @user
         FROM PrTempPayroll t WHERE CAST(t.PayrollDate AS date) = @d;
       SELECT @@ROWCOUNT AS n`, { d, base: lpBase, user: req.user.username }, tx);

    await query('DELETE FROM PrTempPayroll WHERE CAST(PayrollDate AS date) = @d', { d }, tx);
    return { posted: ins[0].n };
  });
  res.json({ ...result, payrollDate: d });
}));

// ---------------------------------------------------------------------------
// Reports — labor paid grouped by employee / job / lot / division / builder / work type, plus detail and pending timecards
// ---------------------------------------------------------------------------
const GROUPS = {
  employee: { key: 'x.EmployeeId', label: 'MAX(x.EmpName)', extra: '' },
  job: { key: 'x.JobId', label: 'MAX(x.JobName)', extra: ', MAX(c.CustName) AS Builder' },
  lot: { key: 'x.LotId', label: "MAX(x.JobName) + ' · Lot ' + MAX(ISNULL(x.Lot,'')) + ISNULL('/' + NULLIF(MAX(x.Block),''),'')", extra: ', MAX(x.Phase) AS Phase, MAX(x.PlanNum) AS PlanNum' },
  division: { key: 'j.DivisionId', label: "ISNULL(j.DivisionId,'(none)')", extra: '' },
  builder: { key: 'c.CustID', label: "ISNULL(MAX(c.CustName),'(none)')", extra: '' },
  work: { key: 'x.WorkId', label: "ISNULL(MAX(w.WorkType),'(none)')", extra: '' },
  payroll: { key: 'CAST(x.PayrollDate AS date)', label: 'CONVERT(varchar(10), CAST(x.PayrollDate AS date), 23)', extra: '' },
};

function reportFilter(q) {
  const p = {
    from: q.from || null, to: q.to || null,
    emp: q.employeeId ? parseInt(q.employeeId, 10) : null,
    job: q.jobId ? parseInt(q.jobId, 10) : null,
    lot: q.lotId ? parseInt(q.lotId, 10) : null,
    div: q.division || null,
    work: q.workId ? parseInt(q.workId, 10) : null,
    cust: q.custId ? parseInt(q.custId, 10) : null,
    s: q.search ? `%${q.search}%` : null,
  };
  const where = `WHERE (@from IS NULL OR x.PayrollDate >= @from) AND (@to IS NULL OR x.PayrollDate < DATEADD(day, 1, CAST(@to AS date)))
    AND (@emp IS NULL OR x.EmployeeId = @emp) AND (@job IS NULL OR x.JobId = @job) AND (@lot IS NULL OR x.LotId = @lot)
    AND (@div IS NULL OR j.DivisionId = @div) AND (@work IS NULL OR x.WorkId = @work) AND (@cust IS NULL OR c.CustID = @cust)
    AND (@s IS NULL OR x.EmpName LIKE @s OR x.JobName LIKE @s OR x.PackName LIKE @s OR x.Item LIKE @s OR c.CustName LIKE @s)`;
  return { p, where };
}
const REPORT_FROM = `FROM PrLaborPaid x LEFT JOIN JsJob j ON j.JobId = x.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
  LEFT JOIN LsWork w ON w.WorkID = x.WorkId`;

router.get('/reports/labor-paid', h(async (req, res) => {
  const g = GROUPS[req.query.groupBy] || GROUPS.employee;
  const { p, where } = reportFilter(req.query);
  const rows = await query(
    `SELECT TOP 2000 ${g.key} AS GroupKey, ${g.label} AS GroupLabel ${g.extra},
            COUNT(*) AS Lines, COUNT(DISTINCT x.EmployeeId) AS Employees,
            SUM(ISNULL(CAST(x.ExtItemQty AS decimal(18,4)),0) * ISNULL(x.PriceEa,0) * ISNULL(x.PayPercent,0) / 100) AS PiecePay,
            SUM(ISNULL(CAST(x.PayHours AS decimal(18,4)),0)) AS Hours,
            SUM(ISNULL(CAST(x.PayHours AS decimal(18,4)),0) * ISNULL(TRY_CAST(x.HourlyRate AS decimal(18,4)),0)) AS HourlyPay,
            SUM(${EXT_PAY('x')}) AS TotalPay, MIN(x.PayrollDate) AS FirstPaid, MAX(x.PayrollDate) AS LastPaid
       ${REPORT_FROM} ${where}
      GROUP BY ${g.key}${req.query.groupBy === 'division' ? '' : ''}
      ORDER BY TotalPay DESC`, p);
  const totals = rows.reduce((a, r) => ({
    Lines: a.Lines + r.Lines, PiecePay: a.PiecePay + (r.PiecePay || 0), Hours: a.Hours + (r.Hours || 0),
    HourlyPay: a.HourlyPay + (r.HourlyPay || 0), TotalPay: a.TotalPay + (r.TotalPay || 0),
  }), { Lines: 0, PiecePay: 0, Hours: 0, HourlyPay: 0, TotalPay: 0 });
  res.json({ rows, totals, groupBy: req.query.groupBy || 'employee' });
}));

router.get('/reports/labor-paid/detail', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const { p, where } = reportFilter(req.query);
  const [rows, total] = await Promise.all([
    query(`SELECT x.LaborPaidID, x.PayrollDate, x.EmpName, x.JobName, c.CustName, j.DivisionId, x.Phase, x.Lot, x.Block, x.PlanNum, x.PackName,
                  x.Item, w.WorkType, x.ExtItemQty, x.PriceEa, x.PayPercent, x.PayHours, x.HourlyRate, x.DateWorked, ${EXT_PAY('x')} AS ExtPay, x.Notes
             ${REPORT_FROM} ${where}
            ORDER BY x.PayrollDate DESC, x.EmpName, x.LaborPaidID OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...p, offset: pg.offset, pageSize: pg.pageSize }),
    query(`SELECT COUNT(*) AS n ${REPORT_FROM} ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

// CSV export (replaces the Access "Export payroll" / "Exp labor paid" Excel outputs)
router.get('/reports/labor-paid.csv', h(async (req, res) => {
  const { p, where } = reportFilter(req.query);
  const rows = await query(
    `SELECT TOP 100000 CONVERT(varchar(10), x.PayrollDate, 23) AS PayrollDate, x.EmployeeId, x.EmpName, j.DivisionId, c.CustName AS Builder, x.JobName,
            x.Phase, x.Lot, x.Block, x.PlanNum, x.PackName, x.Item, w.WorkType, x.ExtItemQty, x.PriceEa, x.PayPercent, x.PayHours, x.HourlyRate,
            CAST(${EXT_PAY('x')} AS decimal(18,2)) AS ExtPay, x.DateWorked, x.Notes
       ${REPORT_FROM} ${where} ORDER BY x.PayrollDate, x.EmpName, x.LaborPaidID`, p);
  const cols = rows.length ? Object.keys(rows[0]) : ['PayrollDate'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="labor-paid-${req.query.from || 'all'}-${req.query.to || 'all'}.csv"`);
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : r[c])).join(','))].join('\r\n'));
}));

module.exports = router;
