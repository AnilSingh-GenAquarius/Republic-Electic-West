// Cox cable (CX) — Access SwitchCX: Cox job / plan / material setup (CxJob + subforms), Cox items (CxItems),
// required billing info per lot (CxReqBillInfo + CxReqBillInfoDetail), the material request run (macro
// CxMaterialRequest) and its reprint (CxPrintMaterialRequest), process billing (macro CxProcessBilling) and the
// Cox reports (roughed lots / billing by date / summary / by invoice / pending lots without RBI / address search).
//
// Access rules reproduced:
//   * material request: clears the temp request tables, copies the job's Cox job type to lots that have none,
//     marks lots of plans that aren't Cox eligible as "Not Cox" (type 3), gives lots without an assessor the job's
//     assessor; STOPS (returning the CxMatReqCheck list) when an active job has lots whose plan has no Cox plan data;
//     otherwise builds the R1 (single, type 1) and MDU (multi, type 2) requests from lots that have an address,
//     a rough-in stage scheduled (JsStage stage 2 / work 2) and no request date, stamps DateCoxMatReq = run date,
//     and returns the summary for that date ("No new lots to request material for." when empty)
//   * process billing: "Nothing to invoice" when qryCxInv0Check is empty; else one invoice (CxTempInv, next number)
//     per assessor job + labor requisition of lots with RBI (Oracle project #), a material request date, no invoice
//     and a "Standard rough" rough-in labor payment on/before the run date; stamps JsLot.InvoiceNum and copies the
//     Cox plan material (quantity x bill price) into CxTempInvItems
//   * billing info: the assessor of a lot must be one of its job's assessors
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { h, paging } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) && !isNaN(new Date(String(v).slice(0, 10))) ? String(v).slice(0, 10) : null);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const bit = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === -1 ? 1 : 0);
const str = (v, max) => { if (v == null) return null; const s = String(v).trim(); if (!s) return null; if (max && s.length > max) throw bad(`Text is too long (max ${max} characters)`); return s };
const user = (req) => req.user?.username || 'web';
function numIn(v, label, { whole = false, min = null } = {}) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (isNaN(n) || (whole && !Number.isInteger(n))) throw bad(`${label} must be ${whole ? 'a whole number' : 'a number'}`);
  if (min != null && n < min) throw bad(`${label} can't be below ${min}`);
  return n;
}
function dateIn(v, label = 'date') {
  if (v === '' || v == null) throw bad(`Enter the ${label}`);
  const d = isoDate(v);
  if (!d) throw bad(`Enter a valid ${label}`);
  return d;
}
// date parameters are passed as 'YYYY-MM-DD' text; CAST via date keeps them language independent
const D = (p) => `CAST(CAST(@${p} AS date) AS datetime)`;
const LOTBLOCK = "CONCAT(l.Lot, '/', l.Block)"; // Access [Lot] & "/" & [Block]
const exists = async (sql, p, tx) => !!(await query(sql, p, tx))[0];

// Local sample tables sometimes have IDENTITY ids, production uses MAX+1: support both.
const identityCache = {};
async function isIdentity(tx, table, col) {
  const k = `${table}.${col}`;
  if (!(k in identityCache)) identityCache[k] = !!(await query("SELECT COLUMNPROPERTY(OBJECT_ID(@t), @c, 'IsIdentity') AS i", { t: `dbo.${table}`, c: col }, tx))[0]?.i;
  return identityCache[k];
}
// table / column names below always come from code constants, never from the request
async function insertOne(tx, table, idCol, data) {
  const ident = await isIdentity(tx, table, idCol);
  const cols = { ...data };
  if (!ident) cols[idCol] = await nextId(tx, table, idCol);
  const keys = Object.keys(cols);
  const r = await query(`INSERT INTO [${table}] (${keys.map((k) => `[${k}]`).join(', ')}) OUTPUT INSERTED.[${idCol}] AS id VALUES (${keys.map((k) => `@${k}`).join(', ')})`, cols, tx);
  return r[0].id;
}
async function insertSelect(tx, table, idCol, cols, selectSql, params) {
  const ident = await isIdentity(tx, table, idCol);
  const list = cols.map((c) => `[${c}]`).join(', ');
  const sel = cols.map((c) => `x.[${c}]`).join(', ');
  const sqlText = ident
    ? `INSERT INTO [${table}] (${list}) SELECT ${sel} FROM (${selectSql}) x; SELECT @@ROWCOUNT AS n`
    : `DECLARE @base int = (SELECT ISNULL(MAX([${idCol}]),0) FROM [${table}] WITH (UPDLOCK, HOLDLOCK));
       INSERT INTO [${table}] ([${idCol}], ${list}) SELECT @base + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), ${sel} FROM (${selectSql}) x; SELECT @@ROWCOUNT AS n`;
  return (await query(sqlText, params, tx))[0].n;
}
async function patch(table, idCol, id, o, tx) {
  const keys = Object.keys(o);
  if (!keys.length) return 1;
  const r = await query(`UPDATE [${table}] SET ${keys.map((k) => `[${k}] = @${k}`).join(', ')} WHERE [${idCol}] = @__id; SELECT @@ROWCOUNT AS n`, { ...o, __id: id }, tx);
  return r[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Lookups, switchboard overview & pickers
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [cxJobTypes, adminSpecs, planners, statuses, jobTypes] = await Promise.all([
    query('SELECT CxJobTypeID AS id, JobType AS name, Description FROM LsJobTypeCx ORDER BY JobType'),
    query('SELECT AdminSpecID AS id, AdminSpec AS name, Phone, Email FROM LsAdminSpecCX ORDER BY AdminSpec'),
    query('SELECT ProjectPlannerID AS id, ProjPlanName AS name, ProjPlanPhone AS Phone, ProjPlanEmail AS Email FROM LsProjectPlannerCX ORDER BY ProjPlanName'),
    query('SELECT StatusID AS id, Status AS name FROM LsStatus ORDER BY Status'),
    query('SELECT JobTypeID AS id, JobType AS name FROM LsJobType ORDER BY JobType'),
  ]);
  res.json({ cxJobTypes, adminSpecs, planners, statuses, jobTypes });
}));

// SwitchCX: counts + the three date lists (SwitchCxSubMatReqDate / SubInvoiceDate / SubPrLaborPaidDate) + cboCoxInvoice
router.get('/overview', h(async (req, res) => {
  const [counts, matReqDates, invoiceDates, payrollDates, invoices] = await Promise.all([
    query(`SELECT (SELECT COUNT(*) FROM JsJob WHERE CxJobTypeId IN (1,2)) AS coxJobs,
                  (SELECT COUNT(*) FROM CxJobAssessor) AS assessors, (SELECT COUNT(*) FROM CxPlan) AS plans, (SELECT COUNT(*) FROM CxItems) AS items,
                  (SELECT COUNT(*) FROM JsLot WHERE DateCoxMatReq IS NOT NULL) AS requested,
                  (SELECT COUNT(*) FROM JsLot WHERE InvoiceNum IS NOT NULL) AS invoiced,
                  (SELECT COUNT(*) FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId WHERE l.DateCoxMatReq IS NOT NULL AND j.CxJobTypeId <> 3 AND l.InvoiceNum IS NULL AND l.OpExAccNum IS NULL) AS pendingNoRbi,
                  (SELECT COUNT(*) FROM CxTempInv) AS invoiceCount`),
    query('SELECT TOP 60 DateCoxMatReq AS d, COUNT(*) AS n FROM JsLot WHERE DateCoxMatReq IS NOT NULL GROUP BY DateCoxMatReq ORDER BY DateCoxMatReq DESC'),
    query('SELECT TOP 60 [Date] AS d, COUNT(*) AS n FROM CxTempInv WHERE [Date] IS NOT NULL GROUP BY [Date] ORDER BY [Date] DESC'),
    query('SELECT TOP 60 PayrollDate AS d FROM PrLaborPaid GROUP BY PayrollDate ORDER BY PayrollDate DESC'),
    query('SELECT TOP 300 InvoiceNum, AssessorJob, [Date] FROM CxTempInv WHERE InvoiceNum IS NOT NULL ORDER BY InvoiceNum DESC'),
  ]);
  res.json({ ...counts[0], matReqDates, invoiceDates, payrollDates, invoices });
}));

// cboLotAddress
router.get('/pick/lots', h(async (req, res) => {
  const s = req.query.search ? `%${String(req.query.search).slice(0, 100)}%` : null;
  res.json(await query(`SELECT TOP 50 l.LotID AS id, ISNULL(l.Address,'(no address)') + ISNULL(', ' + l.City,'') + ' · ' + ISNULL(j.JobName,'') + ' · ' + ${LOTBLOCK} AS name,
      l.Address, l.City, l.State, j.JobName, ${LOTBLOCK} AS LotBlock, l.InvoiceNum
    FROM JsLot l JOIN JsJob j ON l.JobId = j.JobId WHERE (@s IS NULL OR l.Address LIKE @s OR j.JobName LIKE @s) ORDER BY l.Address`, { s }));
}));

// ---------------------------------------------------------------------------
// Setup job and plan data (Access CxJob: JsJob header, CxJobSubAssessor, CxJobSubPlan → CxJobSubMaterial)
// ---------------------------------------------------------------------------
router.get('/jobs', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${String(req.query.search).slice(0, 100)}%` : null, t: req.query.cxType === 'none' ? -1 : int(req.query.cxType), offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s)
    AND (@t IS NULL OR (@t = -1 AND t.CxJobTypeID IS NULL) OR j.CxJobTypeId = @t)`;
  const from = 'FROM JsJob j LEFT JOIN LsJobTypeCx t ON t.CxJobTypeID = j.CxJobTypeId LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId';
  const [rows, total] = await Promise.all([
    query(`SELECT j.JobId, j.JobName, j.DivisionId, j.CxJobTypeId, t.JobType AS CxJobType, c.CustName, st.Status,
                  (SELECT COUNT(*) FROM CxJobAssessor a WHERE a.JobId = j.JobId) AS Assessors, (SELECT COUNT(*) FROM CxPlan p WHERE p.JobId = j.JobId) AS Plans,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId) AS Lots
             ${from} ${where} ORDER BY j.JobName OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from} ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const job = (await query(`SELECT j.CustId, j.JobId, j.JobName, j.City, j.State, j.JobTypeId, j.CxJobTypeId, j.StartDate, j.EndDate, j.StatusId, j.Notes, j.DivisionId,
      c.CustName, st.Status, jt.JobType, t.JobType AS CxJobType, t.Description AS CxJobTypeDesc
    FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
    LEFT JOIN LsJobTypeCx t ON t.CxJobTypeID = j.CxJobTypeId WHERE j.JobId = @id`, { id }))[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const [assessors, plans, planOptions, items] = await Promise.all([
    query(`SELECT a.AssessorID, a.JobId, a.AssessorName, (SELECT COUNT(*) FROM JsLot l WHERE l.AssessorId = a.AssessorID) AS Lots
             FROM CxJobAssessor a WHERE a.JobId = @id ORDER BY a.AssessorName`, { id }),
    query(`SELECT p.CxPlanID, p.JobId, p.CxJobId, p.PlanNum, p.SqFt, p.Bedrooms, p.CoxElegible,
                  (SELECT COUNT(*) FROM CxPlanMaterial m WHERE m.CxPlanId = p.CxPlanID) AS Items,
                  (SELECT SUM(m.QuantityCox * i.BillPrice) FROM CxPlanMaterial m JOIN CxItems i ON i.CxItemID = m.CxItemId WHERE m.CxPlanId = p.CxPlanID) AS BillValue
             FROM CxPlan p WHERE p.JobId = @id ORDER BY p.PlanNum, p.Bedrooms`, { id }),
    // CxJobSubPlan.PlanNum row source: the PM plans of the job's PM job
    query(`SELECT pl.PlanNum, pl.PlanName, pl.SqFt, pl.Bedrooms, pl.TvOutlet
             FROM PmJob pj JOIN JsJob j ON pj.PmJobID = j.PmJobId JOIN PmContract pc ON pj.PmJobID = pc.PmJobId JOIN PmPlan pl ON pc.PmContractID = pl.PmContractId
            WHERE j.JobId = @id GROUP BY pl.PlanNum, pl.PlanName, pl.SqFt, pl.Bedrooms, pl.TvOutlet ORDER BY pl.PlanNum`, { id }),
    // CxJobSubMaterial.CxItemId row source: items of the job's Cox job type
    query('SELECT CxItemID AS id, Item AS name, Description, CxJobTypeId, BillPrice FROM CxItems WHERE CxJobTypeId = @t ORDER BY Item', { t: job.CxJobTypeId }),
  ]);
  res.json({ job, assessors, plans, planOptions, items });
}));

// Only the Cox job type and notes are editable on CxJob (the other JsJob fields are locked; they belong to Job setup)
router.put('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('CxJobTypeId' in b) {
    o.CxJobTypeId = int(b.CxJobTypeId);
    if (o.CxJobTypeId != null && !(await exists('SELECT 1 FROM LsJobTypeCx WHERE CxJobTypeID = @t', { t: o.CxJobTypeId }))) throw bad('Choose a valid Cox job type');
    if (o.CxJobTypeId == null) o.CxJobTypeId = 0; // Job setup's default for "not set"
  }
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if (!(await patch('JsJob', 'JobId', id, o))) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true });
}));

// Assessor job names (CxJobSubAssessor)
const assessorName = (b) => { const n = str(b.AssessorName, 255); if (!n) throw bad('Enter the assessor job name'); return n };
router.post('/jobs/:id/assessors', h(async (req, res) => {
  const job = int(req.params.id), name = assessorName(req.body || {});
  const id = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM JsJob WHERE JobId = @j', { j: job }, tx))) throw bad('Job not found', 404);
    if (await exists('SELECT 1 FROM CxJobAssessor WHERE JobId = @j AND AssessorName = @n', { j: job, n: name }, tx)) throw bad('This job already has this assessor job name', 409);
    return insertOne(tx, 'CxJobAssessor', 'AssessorID', { JobId: job, AssessorName: name });
  });
  res.status(201).json({ id });
}));
router.put('/assessors/:id', h(async (req, res) => {
  const id = int(req.params.id), name = assessorName(req.body || {});
  const cur = (await query('SELECT JobId FROM CxJobAssessor WHERE AssessorID = @id', { id }))[0];
  if (!cur) return res.status(404).json({ error: 'Assessor not found' });
  if (await exists('SELECT 1 FROM CxJobAssessor WHERE JobId = @j AND AssessorName = @n AND AssessorID <> @id', { j: cur.JobId, n: name, id })) throw bad('This job already has this assessor job name', 409);
  await patch('CxJobAssessor', 'AssessorID', id, { AssessorName: name });
  res.json({ ok: true });
}));
router.delete('/assessors/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const n = (await query('SELECT COUNT(*) AS n FROM JsLot WHERE AssessorId = @id', { id }))[0].n;
  if (n) throw bad(`This assessor job is set on ${n} lot(s) and is used on their Cox paperwork; it can't be deleted.`, 409);
  await query('DELETE FROM CxJobAssessor WHERE AssessorID = @id', { id });
  res.json({ ok: true });
}));

// Cox plans (CxJobSubPlan)
function planBody(b, partial) {
  const o = {};
  if (!partial || 'PlanNum' in b) { o.PlanNum = str(b.PlanNum, 50); if (!o.PlanNum) throw bad('Choose the plan number') }
  if ('SqFt' in b) o.SqFt = str(b.SqFt, 255);
  if ('Bedrooms' in b) o.Bedrooms = str(b.Bedrooms, 255);
  if (!partial || 'CoxElegible' in b) o.CoxElegible = 'CoxElegible' in b ? bit(b.CoxElegible) : 1; // DefaultValue Yes
  return o;
}
router.post('/jobs/:id/plans', h(async (req, res) => {
  const job = int(req.params.id), o = planBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM JsJob WHERE JobId = @j', { j: job }, tx))) throw bad('Job not found', 404);
    if (await exists("SELECT 1 FROM CxPlan WHERE JobId = @j AND PlanNum = @n AND ISNULL(Bedrooms,'') = ISNULL(@b,'')", { j: job, n: o.PlanNum, b: o.Bedrooms ?? null }, tx)) throw bad('This job already has Cox data for this plan (and bedrooms)', 409);
    return insertOne(tx, 'CxPlan', 'CxPlanID', { JobId: job, PlanNum: o.PlanNum, SqFt: o.SqFt ?? null, Bedrooms: o.Bedrooms ?? null, CoxElegible: o.CoxElegible });
  });
  res.status(201).json({ id });
}));
router.put('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id), o = planBody(req.body || {}, true);
  if (!(await patch('CxPlan', 'CxPlanID', id, o))) return res.status(404).json({ error: 'Plan not found' });
  res.json({ ok: true });
}));
router.delete('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const n = (await query('SELECT COUNT(*) AS n FROM CxPlanMaterial WHERE CxPlanId = @id', { id }))[0].n;
  if (n) throw bad(`This plan has ${n} material line(s). Delete them first.`, 409);
  await query('DELETE FROM CxPlan WHERE CxPlanID = @id', { id });
  res.json({ ok: true });
}));

// Cox plan material (CxJobSubMaterial)
router.get('/plans/:id/material', h(async (req, res) => {
  const id = int(req.params.id);
  const plan = (await query('SELECT p.*, j.JobName, j.CxJobTypeId FROM CxPlan p LEFT JOIN JsJob j ON j.JobId = p.JobId WHERE p.CxPlanID = @id', { id }))[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const rows = await query(`SELECT m.CxMaterialID, m.CxPlanId, m.CxItemId, m.QuantityCox, m.QuantityTrue, i.Item, i.Description, i.BillPrice, i.CxJobTypeId,
      m.QuantityCox * i.BillPrice AS ExtBill FROM CxPlanMaterial m LEFT JOIN CxItems i ON i.CxItemID = m.CxItemId WHERE m.CxPlanId = @id ORDER BY i.Item`, { id });
  res.json({ plan, rows });
}));
async function materialBody(b, partial) {
  const o = {};
  if (!partial || 'CxItemId' in b) {
    o.CxItemId = int(b.CxItemId);
    if (!o.CxItemId) throw bad('Choose the item');
    if (!(await exists('SELECT 1 FROM CxItems WHERE CxItemID = @i', { i: o.CxItemId }))) throw bad('Choose a valid item');
  }
  if ('QuantityCox' in b) o.QuantityCox = numIn(b.QuantityCox, 'Cox pay quantity', { min: 0 });
  if ('QuantityTrue' in b) o.QuantityTrue = numIn(b.QuantityTrue, 'True quantity', { min: 0 });
  return o;
}
router.post('/plans/:id/material', h(async (req, res) => {
  const pid = int(req.params.id), o = await materialBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CxPlan WHERE CxPlanID = @p', { p: pid }, tx))) throw bad('Plan not found', 404);
    if (await exists('SELECT 1 FROM CxPlanMaterial WHERE CxPlanId = @p AND CxItemId = @i', { p: pid, i: o.CxItemId }, tx)) throw bad('This item is already on the plan', 409);
    return insertOne(tx, 'CxPlanMaterial', 'CxMaterialID', { CxPlanId: pid, CxItemId: o.CxItemId, QuantityCox: o.QuantityCox ?? null, QuantityTrue: o.QuantityTrue ?? null });
  });
  res.status(201).json({ id });
}));
router.put('/material/:id', h(async (req, res) => {
  const id = int(req.params.id), o = await materialBody(req.body || {}, true);
  if (o.CxItemId) {
    const cur = (await query('SELECT CxPlanId FROM CxPlanMaterial WHERE CxMaterialID = @id', { id }))[0];
    if (cur && (await exists('SELECT 1 FROM CxPlanMaterial WHERE CxPlanId = @p AND CxItemId = @i AND CxMaterialID <> @id', { p: cur.CxPlanId, i: o.CxItemId, id }))) throw bad('This item is already on the plan', 409);
  }
  if (!(await patch('CxPlanMaterial', 'CxMaterialID', id, o))) return res.status(404).json({ error: 'Material line not found' });
  res.json({ ok: true });
}));
router.delete('/material/:id', h(async (req, res) => {
  await query('DELETE FROM CxPlanMaterial WHERE CxMaterialID = @id', { id: int(req.params.id) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Cox items (Access CxItems)
// ---------------------------------------------------------------------------
router.get('/items', h(async (req, res) => {
  res.json(await query(`SELECT i.CxItemID, i.Item, i.Description, i.CxJobTypeId, t.JobType AS CxJobType, i.BillPrice,
      (SELECT COUNT(*) FROM CxPlanMaterial m WHERE m.CxItemId = i.CxItemID) AS Used
    FROM CxItems i LEFT JOIN LsJobTypeCx t ON t.CxJobTypeID = i.CxJobTypeId WHERE (@t IS NULL OR i.CxJobTypeId = @t) ORDER BY i.Item`, { t: int(req.query.cxType) }));
}));
async function itemBody(b, partial) {
  const o = {};
  if (!partial || 'Item' in b) { o.Item = str(b.Item, 255); if (!o.Item) throw bad('Enter the item') }
  if ('Description' in b) o.Description = str(b.Description, 4000);
  if (!partial || 'CxJobTypeId' in b) {
    o.CxJobTypeId = int(b.CxJobTypeId);
    if (!o.CxJobTypeId) throw bad('Choose the Cox job type');
    if (!(await exists('SELECT 1 FROM LsJobTypeCx WHERE CxJobTypeID = @t', { t: o.CxJobTypeId }))) throw bad('Choose a valid Cox job type');
  }
  if ('BillPrice' in b) o.BillPrice = numIn(b.BillPrice, 'Bill price', { min: 0 });
  return o;
}
router.post('/items', h(async (req, res) => {
  const o = await itemBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (await exists('SELECT 1 FROM CxItems WHERE Item = @n AND CxJobTypeId = @t', { n: o.Item, t: o.CxJobTypeId }, tx)) throw bad('This item already exists for that job type', 409);
    return insertOne(tx, 'CxItems', 'CxItemID', { Item: o.Item, Description: o.Description ?? null, CxJobTypeId: o.CxJobTypeId, BillPrice: o.BillPrice ?? null });
  });
  res.status(201).json({ id });
}));
router.put('/items/:id', h(async (req, res) => {
  const id = int(req.params.id), o = await itemBody(req.body || {}, true);
  if (o.Item || o.CxJobTypeId) {
    const cur = (await query('SELECT Item, CxJobTypeId FROM CxItems WHERE CxItemID = @id', { id }))[0];
    if (cur && (await exists('SELECT 1 FROM CxItems WHERE Item = @n AND CxJobTypeId = @t AND CxItemID <> @id', { n: o.Item ?? cur.Item, t: o.CxJobTypeId ?? cur.CxJobTypeId, id }))) throw bad('This item already exists for that job type', 409);
  }
  if (!(await patch('CxItems', 'CxItemID', id, o))) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
}));
router.delete('/items/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [m, v] = await Promise.all([query('SELECT COUNT(*) AS n FROM CxPlanMaterial WHERE CxItemId = @id', { id }), query('SELECT COUNT(*) AS n FROM CxTempInvItems WHERE CxItemId = @id', { id })]);
  if (m[0].n) throw bad(`This item is on ${m[0].n} Cox plan material line(s) and can't be deleted.`, 409);
  if (v[0].n) throw bad(`This item has been invoiced (${v[0].n} line(s)) and can't be deleted.`, 409);
  await query('DELETE FROM CxItems WHERE CxItemID = @id', { id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Enter billing info (Access CxReqBillInfo → CxReqBillInfoDetail on JsLot)
// ---------------------------------------------------------------------------
// Combo44 / the form's record source: jobs that have an assessor job name
router.get('/billinfo/jobs', h(async (req, res) => {
  res.json(await query(`SELECT j.JobId, j.JobName AS Job, MIN(a.AssessorName) AS AssessorJob, COUNT(DISTINCT a.AssessorID) AS Assessors,
      (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId) AS Lots,
      (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId AND l.DateCoxMatReq IS NOT NULL AND l.OpExAccNum IS NULL AND l.InvoiceNum IS NULL) AS NoRbi
    FROM JsJob j JOIN CxJobAssessor a ON j.JobId = a.JobId GROUP BY j.JobId, j.JobName ORDER BY j.JobName, MIN(a.AssessorName)`));
}));
router.get('/billinfo/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const s = req.query.search ? `%${String(req.query.search).slice(0, 100)}%` : null;
  const job = (await query(`SELECT j.JobId, j.JobName, j.CxJobTypeId, (SELECT MIN(a.AssessorName) FROM CxJobAssessor a WHERE a.JobId = j.JobId) AS FirstOfAssessorName
    FROM JsJob j WHERE j.JobId = @id`, { id }))[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const [assessors, lots] = await Promise.all([
    query('SELECT AssessorID AS id, AssessorName AS name FROM CxJobAssessor WHERE JobId = @id ORDER BY AssessorName', { id }),
    query(`SELECT l.LotID, l.JobId, l.Lot, l.Block, l.Address, l.LaborReqNum, l.LaborPoNum, l.InvoiceNum, l.AdminSpecialist, l.ProjPlanner, l.AssessorId,
                  l.DateCoxMatReq, l.OpExAccNum, l.CoxJobTypeId, a.AssessorName, ad.AdminSpec, pp.ProjPlanName, t.JobType AS CoxJobType
             FROM JsLot l LEFT JOIN CxJobAssessor a ON a.AssessorID = l.AssessorId LEFT JOIN LsAdminSpecCX ad ON ad.AdminSpecID = l.AdminSpecialist
             LEFT JOIN LsProjectPlannerCX pp ON pp.ProjectPlannerID = l.ProjPlanner LEFT JOIN LsJobTypeCx t ON t.CxJobTypeID = l.CoxJobTypeId
            WHERE l.JobId = @id AND (@s IS NULL OR l.Address LIKE @s OR l.Lot LIKE @s) ORDER BY l.Address`, { id, s }),
  ]);
  res.json({ job, assessors, lots });
}));
router.put('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  const lot = (await query('SELECT LotID, JobId FROM JsLot WHERE LotID = @id', { id }))[0];
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  if ('LaborReqNum' in b) o.LaborReqNum = numIn(b.LaborReqNum, 'Requisition #', { whole: true, min: 0 });
  if ('InvoiceNum' in b) o.InvoiceNum = numIn(b.InvoiceNum, 'Invoice', { whole: true, min: 0 });
  if ('LaborPoNum' in b) o.LaborPoNum = str(b.LaborPoNum, 255);
  if ('OpExAccNum' in b) o.OpExAccNum = str(b.OpExAccNum, 255);
  if ('DateCoxMatReq' in b) { o.DateCoxMatReq = b.DateCoxMatReq === '' || b.DateCoxMatReq == null ? null : isoDate(b.DateCoxMatReq); if (b.DateCoxMatReq && !o.DateCoxMatReq) throw bad('Enter a valid material date') }
  if ('AdminSpecialist' in b) { o.AdminSpecialist = int(b.AdminSpecialist); if (o.AdminSpecialist != null && !(await exists('SELECT 1 FROM LsAdminSpecCX WHERE AdminSpecID = @v', { v: o.AdminSpecialist }))) throw bad('Choose a valid admin specialist') }
  if ('ProjPlanner' in b) { o.ProjPlanner = int(b.ProjPlanner); if (o.ProjPlanner != null && !(await exists('SELECT 1 FROM LsProjectPlannerCX WHERE ProjectPlannerID = @v', { v: o.ProjPlanner }))) throw bad('Choose a valid project planner') }
  if ('CoxJobTypeId' in b) { o.CoxJobTypeId = int(b.CoxJobTypeId); if (o.CoxJobTypeId != null && !(await exists('SELECT 1 FROM LsJobTypeCx WHERE CxJobTypeID = @v', { v: o.CoxJobTypeId }))) throw bad('Choose a valid Cox job type') }
  if ('AssessorId' in b) {
    o.AssessorId = int(b.AssessorId);
    // AssessorId combo only lists the assessor job names of the lot's job
    if (o.AssessorId != null && !(await exists('SELECT 1 FROM CxJobAssessor WHERE AssessorID = @a AND JobId = @j', { a: o.AssessorId, j: lot.JobId }))) throw bad("Choose one of this job's assessor job names");
  }
  if (o.InvoiceNum != null && !(await exists('SELECT 1 FROM CxTempInv WHERE InvoiceNum = @n', { n: o.InvoiceNum }))) throw bad(`Cox invoice ${o.InvoiceNum} does not exist`);
  await patch('JsLot', 'LotID', id, o);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Material request (macro CxMaterialRequest) and its reports
// ---------------------------------------------------------------------------
// qryCxMatReqCheck1 + qryCxMatReqCheck2: active jobs with unrequested lots whose plan has no Cox plan data
const CHECK_SQL = `WITH c1 AS (
    SELECT c.CustID, c.CustName, j.JobId, j.JobName, MIN(l.Address) AS FirstOfAddress, pl.PlanNum
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsLot l ON j.JobId = l.JobId JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN LsStatus st ON j.StatusId = st.StatusID
     WHERE l.CoxJobTypeId <> 3 AND st.Active = 1 AND l.DateCoxMatReq IS NULL
     GROUP BY c.CustID, c.CustName, j.JobId, j.JobName, pl.PlanNum)
  SELECT c1.CustName, c1.JobName, MIN(c1.FirstOfAddress) AS SampleAddress, MIN(c1.JobId) AS JobId
    FROM c1 LEFT JOIN CxPlan p ON c1.PlanNum = p.PlanNum AND c1.JobId = p.JobId
   WHERE p.CxPlanID IS NULL GROUP BY c1.CustName, c1.JobName ORDER BY c1.CustName, c1.JobName`;
// qryCxMatReqMultiItems: crosstab of the MDU (type 2) item quantities per Cox plan
const MULTI_ITEMS = `SELECT cj.CxJobID, p.CxPlanID, p.JobId, cj.CoxJob, p.PlanNum, p.Bedrooms,
      SUM(CASE WHEN i.Item = 'Home runs' THEN m.QuantityCox END) AS HomeRuns,
      SUM(CASE WHEN i.Item = 'Lockbox prewire' THEN m.QuantityCox END) AS LockboxPrewire,
      SUM(CASE WHEN i.Item = 'Outlet prewire' THEN m.QuantityCox END) AS OutletPrewire,
      SUM(CASE WHEN i.Item = 'Riser prewire' THEN m.QuantityCox END) AS RiserPrewire
    FROM CxItems i JOIN CxPlanMaterial m ON i.CxItemID = m.CxItemId JOIN CxPlan p ON p.CxPlanID = m.CxPlanId JOIN CxJob cj ON p.CxJobId = cj.CxJobID
    JOIN LsJobTypeCx t ON i.CxJobTypeId = t.CxJobTypeID
   WHERE cj.CoxJob IS NOT NULL AND p.CoxElegible = 1 AND i.CxJobTypeId = 2
   GROUP BY cj.CxJobID, p.CxPlanID, p.JobId, cj.CoxJob, p.PlanNum, p.Bedrooms`;
// qryCxMatReqSingle (crosstab; only its [Outlet Prewire] column is used)
const SINGLE_SQL = `SELECT l.LotID, j.JobName, a.AssessorName, ${LOTBLOCK} AS Lot, l.Address, l.Permit,
      SUM(CASE WHEN i.Item = 'Outlet Prewire' THEN m.QuantityCox END) AS OutletPrewire
    FROM JsLot l JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN CxPlan p ON pl.PlanNum = p.PlanNum JOIN CxPlanMaterial m ON p.CxPlanID = m.CxPlanId
    JOIN CxItems i ON i.CxItemID = m.CxItemId JOIN JsJob j ON l.JobId = j.JobId AND p.JobId = j.JobId JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID
    JOIN JsStage s ON l.LotID = s.LotId
   WHERE l.Address IS NOT NULL AND l.CoxJobTypeId = 1 AND l.DateCoxMatReq IS NULL AND s.WorkId = 2 AND s.ScheduleStageId = 2 AND p.CoxElegible = 1
   GROUP BY l.LotID, j.JobName, a.AssessorName, ${LOTBLOCK}, l.Address, l.Permit`;
// qryCxMatReqMulti
const MULTI_SQL = `SELECT DISTINCT l.LotID, j.JobName, a.AssessorName, ${LOTBLOCK} AS Lot, pl.PlanNum, mi.Bedrooms, l.Address, l.Permit,
      mi.HomeRuns, mi.LockboxPrewire, mi.OutletPrewire, mi.RiserPrewire
    FROM JsLot l JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN JsJob j ON l.JobId = j.JobId JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID
    JOIN JsStage s ON l.LotID = s.LotId JOIN (${MULTI_ITEMS}) mi ON j.JobId = mi.JobId AND pl.PlanNum = mi.PlanNum
   WHERE l.Address IS NOT NULL AND l.CoxJobTypeId = 2 AND l.DateCoxMatReq IS NULL AND s.WorkId = 2 AND s.ScheduleStageId = 2`;
// qryCxMatReqSummary for one request date
const SUMMARY_SQL = `SELECT COUNT(l.LotID) AS Lots, i.Item, SUM(m.QuantityCox) AS Quantity, l.DateCoxMatReq, i.BillPrice, SUM(m.QuantityCox) * i.BillPrice AS ExtCost
    FROM PmPlan pl JOIN CxPlan p ON pl.PlanNum = p.PlanNum JOIN CxPlanMaterial m ON p.CxPlanID = m.CxPlanId JOIN CxItems i ON i.CxItemID = m.CxItemId
    JOIN JsLot l ON p.JobId = l.JobId AND pl.PmPlanID = l.PmPlanId
   WHERE l.DateCoxMatReq = ${D('d')} GROUP BY i.Item, l.DateCoxMatReq, i.BillPrice ORDER BY COUNT(l.LotID), i.Item`;
// qryCxPrintMatReqSingle / qryCxPrintMatReqMulti (reprint for a request date)
const REPRINT_SINGLE = `SELECT l.DateCoxMatReq, j.JobName, a.AssessorName, ${LOTBLOCK} AS LotBlock, l.Address, l.Permit,
      SUM(CASE WHEN i.Item = 'Outlet prewire' THEN m.QuantityCox END) AS OutletPrewire
    FROM CxJobAssessor a JOIN JsLot l ON a.AssessorID = l.AssessorId JOIN JsJob j ON j.JobId = l.JobId JOIN CxPlan p ON l.JobId = p.JobId
    JOIN CxPlanMaterial m ON p.CxPlanID = m.CxPlanId JOIN CxItems i ON m.CxItemId = i.CxItemID JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID AND p.PlanNum = pl.PlanNum
    JOIN PmJob pj ON j.PmJobId = pj.PmJobID JOIN PmContract pc ON pl.PmContractId = pc.PmContractID AND pj.PmJobID = pc.PmJobId
   WHERE l.DateCoxMatReq = ${D('d')} AND l.CoxJobTypeId = 1
   GROUP BY l.DateCoxMatReq, j.JobName, a.AssessorName, ${LOTBLOCK}, l.Address, l.Permit, l.CoxJobTypeId
   ORDER BY j.JobName, ${LOTBLOCK}`;
const REPRINT_MULTI = `SELECT l.DateCoxMatReq, j.JobName, a.AssessorName, ${LOTBLOCK} AS LotBlock, l.Address, pl.PlanNum, mi.Bedrooms, l.Permit,
      mi.HomeRuns, mi.LockboxPrewire, mi.OutletPrewire, mi.RiserPrewire
    FROM CxJobAssessor a JOIN JsLot l ON a.AssessorID = l.AssessorId JOIN JsJob j ON j.JobId = l.JobId JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID
    JOIN PmJob pj ON j.PmJobId = pj.PmJobID JOIN PmContract pc ON pl.PmContractId = pc.PmContractID AND pj.PmJobID = pc.PmJobId
    JOIN (${MULTI_ITEMS}) mi ON pl.PlanNum = mi.PlanNum AND l.JobId = mi.JobId
   WHERE l.DateCoxMatReq = ${D('d')} AND l.CoxJobTypeId = 2
   ORDER BY j.JobName, ${LOTBLOCK}`;

router.get('/matreq/preview', h(async (req, res) => {
  // what a run would pick up right now (read only; the run itself first refreshes lot job types / assessors)
  const [check, single, multi] = await Promise.all([query(CHECK_SQL), query(`${SINGLE_SQL} ORDER BY j.JobName, ${LOTBLOCK}`), query(`SELECT * FROM (${MULTI_SQL}) x ORDER BY JobName, Lot`)]);
  res.json({ check, single, multi });
}));

router.post('/matreq/run', h(async (req, res) => {
  const d = dateIn((req.body || {}).date, 'request date');
  const out = await withTransaction(async (tx) => {
    // clear temp cox material request single / multi
    await query('DELETE FROM tempCxMatReqSingle WHERE Job IS NOT NULL; DELETE FROM tempCxMatReqMulti WHERE Job IS NOT NULL', {}, tx);
    // qryCxMatReqAppendJobInfo: lots without a Cox job type get the job's
    const jobInfo = (await query(`UPDATE l SET CoxJobTypeId = j.CxJobTypeId FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId
        WHERE (l.CoxJobTypeId = 0 OR l.CoxJobTypeId IS NULL) AND j.CxJobTypeId IS NOT NULL; SELECT @@ROWCOUNT AS n`, {}, tx))[0].n;
    // qryCxMatReqAppendNotElegible: lots of plans that are not Cox eligible become "Not Cox" (3)
    const notEligible = (await query(`UPDATE l SET CoxJobTypeId = 3
        FROM JsLot l JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN PmContract pc ON pl.PmContractId = pc.PmContractID JOIN PmJob pj ON pc.PmJobId = pj.PmJobID
        JOIN JsJob j ON pj.PmJobID = j.PmJobId AND l.JobId = j.JobId JOIN CxPlan p ON pl.PlanNum = p.PlanNum AND j.JobId = p.JobId
        WHERE l.CoxJobTypeId <> 3 AND p.CoxElegible = 0; SELECT @@ROWCOUNT AS n`, {}, tx))[0].n;
    // qryCxMatReqAppendAssessor: lots without an assessor get their job's (first) assessor job name
    const assessor = (await query(`UPDATE l SET AssessorId = (SELECT MIN(a.AssessorID) FROM CxJobAssessor a WHERE a.JobId = l.JobId)
        FROM JsLot l WHERE (l.AssessorId = 0 OR l.AssessorId IS NULL) AND l.CoxJobTypeId <> 3 AND EXISTS (SELECT 1 FROM CxJobAssessor a WHERE a.JobId = l.JobId); SELECT @@ROWCOUNT AS n`, {}, tx))[0].n;
    const updated = { jobInfo, notEligible, assessor };
    // CxMatReqCheck: stop when active jobs have lots on plans without Cox plan data
    const check = await query(CHECK_SQL, {}, tx);
    if (check.length) return { stopped: true, updated, check };
    // single (R1) requests
    const single = await query(SINGLE_SQL, {}, tx);
    if (single.length) {
      await insertSelect(tx, 'tempCxMatReqSingle', 'UniqueID', ['Job', 'AssessorName', 'LotBlock', 'Address', 'Permit', 'DateReq', 'OutletPrewire', 'LotId'],
        `SELECT q.JobName AS Job, q.AssessorName, q.Lot AS LotBlock, q.Address, q.Permit, ${D('d')} AS DateReq, q.OutletPrewire, q.LotID AS LotId FROM (${SINGLE_SQL}) q`, { d }, tx);
      await query(`UPDATE l SET DateCoxMatReq = ${D('d')} FROM JsLot l JOIN tempCxMatReqSingle t ON l.LotID = t.LotId WHERE l.DateCoxMatReq IS NULL`, { d }, tx);
    }
    // multi (MDU) requests
    const multi = await query(MULTI_SQL, {}, tx);
    if (multi.length) {
      await insertSelect(tx, 'tempCxMatReqMulti', 'UniqueID', ['LotId', 'Job', 'AssessorName', 'Lot', 'PlanNum', 'Bedrooms', 'Address', 'Permit', 'DateReq', 'HomeRuns', 'LockboxPrewire', 'OutletPrewire', 'RiserPrewire'],
        `SELECT q.LotID AS LotId, q.JobName AS Job, q.AssessorName, q.Lot, q.PlanNum, q.Bedrooms, q.Address, q.Permit, ${D('d')} AS DateReq, q.HomeRuns, q.LockboxPrewire, q.OutletPrewire, q.RiserPrewire FROM (${MULTI_SQL}) q`, { d }, tx);
      await query(`UPDATE l SET DateCoxMatReq = ${D('d')} FROM JsLot l JOIN tempCxMatReqMulti t ON l.LotID = t.LotId WHERE l.DateCoxMatReq IS NULL`, { d }, tx);
    }
    // (one request at a time on a transaction)
    const singleRows = await query('SELECT * FROM tempCxMatReqSingle ORDER BY Job, LotBlock', {}, tx);
    const multiRows = await query('SELECT * FROM tempCxMatReqMulti ORDER BY Job, Lot', {}, tx);
    const summary = await query(SUMMARY_SQL, { d }, tx);
    return { stopped: false, updated, date: d, single: singleRows, multi: multiRows, summary, message: summary.length ? null : 'No new lots to request material for.' };
  });
  res.json(out);
}));

// CxPrintMaterialRequest: reprint single + multi request (and the summary) of a request date
router.get('/matreq/reprint', h(async (req, res) => {
  const d = dateIn(req.query.date, 'request date');
  const [single, multi, summary] = await Promise.all([query(REPRINT_SINGLE, { d }), query(REPRINT_MULTI, { d }), query(SUMMARY_SQL, { d })]);
  res.json({ date: d, single, multi, summary });
}));
router.get('/matreq/check', h(async (req, res) => res.json(await query(CHECK_SQL))));

// ---------------------------------------------------------------------------
// Process billing (macro CxProcessBilling: qryCxInv0Check → qryCxInv1AddJob → qryCxInv2AddInvNum → qryCxInv3AddItems)
// ---------------------------------------------------------------------------
const ROUGH_PAID = `FROM JsJob j JOIN JsLot l ON j.JobId = l.JobId JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID
    JOIN PrLaborPaid lp ON l.LotID = lp.LotId AND l.JobId = lp.JobId JOIN CxPlan p ON j.JobId = p.JobId AND lp.PlanNum = p.PlanNum
   WHERE lp.PackName LIKE 'Standard rough%' AND lp.ScheduleStageId = 2 AND lp.WorkId = 2 AND l.OpExAccNum IS NOT NULL AND l.InvoiceNum IS NULL
     AND l.DateCoxMatReq IS NOT NULL AND j.CxJobTypeId <> 3`;
const INV0_CHECK = `SELECT j.JobName, a.AssessorName ${ROUGH_PAID} AND p.CoxElegible = 1 GROUP BY j.JobName, a.AssessorName HAVING MIN(lp.PayrollDate) <= ${D('d')} ORDER BY j.JobName, a.AssessorName`;

router.get('/billing/preview', h(async (req, res) => {
  const d = dateIn(req.query.date, 'invoice date');
  res.json(await query(INV0_CHECK, { d }));
}));

router.post('/billing/process', h(async (req, res) => {
  const d = dateIn((req.body || {}).date, 'invoice date');
  const out = await withTransaction(async (tx) => {
    const check = await query(INV0_CHECK, { d }, tx);
    if (!check.length) return { created: 0, message: 'Nothing to invoice, no invoices were created' };
    // qryCxInv1AddJob: one invoice (next number) per assessor job + labor requisition
    const created = (await query(`DECLARE @base int = (SELECT ISNULL(MAX(InvoiceNum),0) FROM CxTempInv WITH (UPDLOCK, HOLDLOCK));
      INSERT INTO CxTempInv (InvoiceNum, AssessorJob, LaborReqNum, [Date], JobId)
      SELECT @base + ROW_NUMBER() OVER (ORDER BY x.AssessorName, x.LaborReqNum, x.JobId), x.AssessorName, x.LaborReqNum, ${D('d')}, x.JobId
        FROM (SELECT a.AssessorName, l.LaborReqNum, j.JobId ${ROUGH_PAID} GROUP BY a.AssessorName, l.LaborReqNum, j.JobId HAVING MIN(lp.PayrollDate) <= ${D('d')}) x;
      SELECT @@ROWCOUNT AS n, @base AS base`, { d }, tx))[0];
    // qryCxInv2AddInvNum: link the lots to their invoice
    const lots = (await query(`UPDATE l SET InvoiceNum = t.InvoiceNum
        FROM CxTempInv t JOIN JsLot l ON t.LaborReqNum = l.LaborReqNum AND t.JobId = l.JobId
        JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID AND t.AssessorJob = a.AssessorName JOIN PrLaborPaid lp ON l.LotID = lp.LotId
       WHERE l.InvoiceNum IS NULL AND t.[Date] = ${D('d')} AND l.OpExAccNum IS NOT NULL AND l.DateCoxMatReq IS NOT NULL AND lp.PayrollDate <= ${D('d')}
         AND lp.PackName LIKE 'Standard rough%' AND lp.ScheduleStageId = 2 AND lp.WorkId = 2 AND l.CoxJobTypeId <> 3; SELECT @@ROWCOUNT AS n`, { d }, tx))[0].n;
    // qryCxInv3AddItems: invoiced lots get their Cox plan material at the item bill price
    const items = await insertSelect(tx, 'CxTempInvItems', 'CxInvItemID', ['LotId', 'CxItemId', 'Quantity', 'PriceEa', 'CxId'],
      `SELECT l.LotID AS LotId, m.CxItemId, m.QuantityCox AS Quantity, i.BillPrice AS PriceEa, 0 AS CxId
         FROM JsLot l JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN CxPlan p ON p.PlanNum = pl.PlanNum AND l.JobId = p.JobId
         JOIN CxPlanMaterial m ON p.CxPlanID = m.CxPlanId JOIN CxItems i ON i.CxItemID = m.CxItemId JOIN CxTempInv t ON l.InvoiceNum = t.InvoiceNum
        WHERE t.[Date] = ${D('d')} AND NOT EXISTS (SELECT 1 FROM CxTempInvItems x WHERE x.LotId = l.LotID) AND l.DateCoxMatReq IS NOT NULL AND l.OpExAccNum IS NOT NULL`, { d }, tx);
    return { created: created.n, firstInvoice: created.base + 1, lastInvoice: created.base + created.n, lots, items, date: d };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const BILL_COLS = `t.InvoiceNum, 'Cox' + CAST(t.InvoiceNum AS varchar(20)) AS Invoice, t.[Date], a.AssessorName, j.JobName, l.OpExAccNum, l.TaskNum, l.LaborReqNum, l.LaborPoNum,
  ${LOTBLOCK} AS LotBlock, l.Address, i.Item, x.Quantity, x.PriceEa, x.Quantity * x.PriceEa AS ExtPrice, l.LotID`;
const BILL_FROM = `FROM JsLot l JOIN CxTempInv t ON l.InvoiceNum = t.InvoiceNum JOIN CxTempInvItems x ON l.LotID = x.LotId JOIN CxItems i ON i.CxItemID = x.CxItemId
  JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID JOIN JsJob j ON l.JobId = j.JobId`;
// CxBillingDate / CxBillingInvNum: invoice to Cox (admin specialist required: inner join as in Access)
const BILL_SQL = (where) => `SELECT ${BILL_COLS}, 'jorge@nvrepublic.com' AS Contact, '4200R' AS Dept, l.ProjPlanner, pp.ProjPlanName, ad.AdminSpec, ad.Phone, ad.Email
  ${BILL_FROM} JOIN LsAdminSpecCX ad ON l.AdminSpecialist = ad.AdminSpecID LEFT JOIN LsProjectPlannerCX pp ON pp.ProjectPlannerID = l.ProjPlanner
  WHERE ${where} ORDER BY t.InvoiceNum, ${LOTBLOCK}, i.Item`;
const REPORTS = {
  // CxRoughedLot: roughed lots with a material request, not invoiced, first rough payroll between from and to
  'roughed-lots': async (q) => {
    const from = dateIn(q.from, 'from date'), to = dateIn(q.to, 'to date');
    if (to < from) throw bad('The to date must be on or after the from date');
    return query(`SELECT c.CustName, j.JobName, a.AssessorName, t.JobType, ${LOTBLOCK} AS LotBlock, MIN(lp.PayrollDate) AS PayrollDate, l.Address,
        ISNULL(l.City, j.City) AS City, l.State, l.DateCoxMatReq, l.OpExAccNum, l.TaskNum, l.LaborReqNum, l.LaborPoNum, l.ProjPlanner, l.AdminSpecialist,
        CASE WHEN l.LaborReqNum IS NULL THEN 'No' ELSE 'Yes' END AS RBI, l.LotID
      FROM JsJob j JOIN JsLot l ON j.JobId = l.JobId JOIN PrLaborPaid lp ON l.LotID = lp.LotId JOIN LsScheduleStage ss ON ss.ScheduleStageID = lp.ScheduleStageId
      JOIN JsCustomer c ON j.CustId = c.CustID JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID JOIN LsJobTypeCx t ON j.CxJobTypeId = t.CxJobTypeID
      JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID JOIN CxPlan p ON pl.PlanNum = p.PlanNum AND l.JobId = p.JobId
     WHERE l.CoxJobTypeId <> 3 AND ss.ScheduleStageID = 2 AND lp.PackName LIKE 'Standard roug%' AND l.InvoiceNum IS NULL AND p.CoxElegible = 1 AND l.DateCoxMatReq IS NOT NULL
     GROUP BY c.CustName, j.JobName, a.AssessorName, t.JobType, ${LOTBLOCK}, l.Address, ISNULL(l.City, j.City), l.State, l.DateCoxMatReq, l.OpExAccNum, l.TaskNum,
              l.LaborReqNum, l.LaborPoNum, l.ProjPlanner, l.AdminSpecialist, l.LotID
    HAVING MIN(lp.PayrollDate) >= ${D('f')} AND MIN(lp.PayrollDate) <= ${D('t')}
     ORDER BY j.JobName, l.Address`, { f: from, t: to });
  },
  'billing-date': async (q) => query(BILL_SQL(`t.[Date] = ${D('d')}`), { d: dateIn(q.date, 'invoice date') }),
  // CxBillingDateSumm: no admin specialist join, adds the Cox job type
  'billing-date-summary': async (q) => query(`SELECT ${BILL_COLS}, ct.JobType ${BILL_FROM} JOIN LsJobTypeCx ct ON j.CxJobTypeId = ct.CxJobTypeID
      WHERE t.[Date] = ${D('d')} ORDER BY t.InvoiceNum, ${LOTBLOCK}, i.Item`, { d: dateIn(q.date, 'invoice date') }),
  'billing-invoice': async (q) => {
    const inv = int(q.invoice);
    if (inv == null) throw bad('Choose the Cox invoice');
    return query(BILL_SQL('t.InvoiceNum = @inv'), { inv });
  },
  // CxPendingLotNoRBI
  'pending-no-rbi': async () => query(`SELECT l.DateCoxMatReq, j.JobName, a.AssessorName, ${LOTBLOCK} AS LotBlock, l.Address, j.CxJobTypeId, l.OpExAccNum, l.LotID, l.JobId
      FROM JsLot l JOIN CxJobAssessor a ON l.AssessorId = a.AssessorID JOIN JsJob j ON l.JobId = j.JobId
     WHERE l.DateCoxMatReq IS NOT NULL AND j.CxJobTypeId <> 3 AND l.InvoiceNum IS NULL AND l.OpExAccNum IS NULL
     ORDER BY l.DateCoxMatReq, j.JobName, a.AssessorName`),
  // CxAddressSearchSimple
  'address-search': async (q) => {
    const lot = int(q.lotId);
    if (lot == null) throw bad('Choose the lot address');
    const LB = "CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END";
    return query(`SELECT CAST(c.CustID AS varchar(20)) + '.' + CAST(j.JobId AS varchar(20)) + '.' + CAST(ph.PhaseID AS varchar(20)) AS Code, c.CustName, j.JobName, ph.Phase,
        pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, su.SuperName, ph.StartDate AS PhaseStartDate, ${LB} AS LotBlock, pl.PlanNum, pl.PlanName,
        l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes, l.StartDate, l.EndDate, l.DateEntered, l.UserEntered, l.WarrantyDate,
        pk.PackName, pk.BuilderCode, jp.PackQty, l.LotID, l.InvoiceNum
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId JOIN JsLot l ON j.JobId = l.JobId AND ph.PhaseID = l.PhaseId
      LEFT JOIN JsPack jp ON l.LotID = jp.LotId LEFT JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN LsSuperintendent su ON ph.SuperId1 = su.SuperID
      LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN PmContract pc ON pc.PmContractID = ph.PmContractId
     WHERE l.LotID = @lot ORDER BY ${LB}, pk.PackName`, { lot });
  },
  'matreq-summary': async (q) => query(SUMMARY_SQL, { d: dateIn(q.date, 'request date') }),
  'matreq-check': async () => query(CHECK_SQL),
};
router.get('/reports/:key', h(async (req, res) => {
  const fn = Object.prototype.hasOwnProperty.call(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  if (!fn) return res.status(404).json({ error: 'Unknown report' });
  res.json(await fn(req.query));
}));

module.exports = router;
