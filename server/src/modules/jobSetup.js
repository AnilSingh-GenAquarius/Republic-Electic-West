// Job setup (JS) — mirrors the Access "SwitchJS" switchboard and its data entry forms / reports:
//   JsCustomer (+ JsCustomerBillToSub)  -> /builders  (builder + bill-to address per division)
//   JsJobSub                            -> /jobs      (job under a builder, PM job link)
//   JsPhase                             -> /phases    (phase: type, bid/contract link, 2 superintendents, dates)
//   JsPhaseSubLot (lots)                -> read-only here (lots are scheduled/edited in the Scheduling module, /api/sc)
//   Js* reports on SwitchJS             -> /reports/*
//   Ls* list forms used by JS           -> /lists/*   (job types, phase types, superintendents, jurisdictions, cities, credit ratings)
const express = require('express');
const { query, withTransaction } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const bad = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, ...(extra || {}) });
const int = (v) => (v === '' || v == null ? null : /^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : NaN);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const money0 = '$0.00';
const MAX_REPORT_ROWS = 20000;

function id(v, what = 'id') {
  const n = int(v);
  if (!n) throw bad(`Invalid ${what}`);
  return n;
}
function isoDate(v, label) {
  if (v === '' || v == null) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw bad(`${label} is not a valid date`);
  return s;
}
function txt(v, max, label, { required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (!s) {
    if (required) throw bad(`${label} is required`);
    return null;
  }
  if (s.length > max) throw bad(`${label} is too long (maximum ${max} characters)`);
  return s;
}
function stateCode(v, label = 'State') {
  const s = txt(v, 50, label);
  if (s == null) return null;
  if (!/^[A-Za-z]{2}$/.test(s)) throw bad(`${label} must be a 2-letter code (for example CA)`);
  return s.toUpperCase();
}
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const lotName = "l.Lot + CASE WHEN NULLIF(l.Block,'') IS NULL THEN '' ELSE '/' + l.Block END";
const lotOrder = 'TRY_CAST(l.Lot AS int), l.Lot, l.Block';
// JsLot.StatusId is a BIT in the sample (1 = active). LsStatus ids 2-4 can never be stored there.
const lotStatus = "CASE WHEN l.StatusId = 1 THEN 'Active' ELSE 'Inactive' END";

async function exists(table, idCol, value, tx) {
  const r = await query(`SELECT 1 AS x FROM [${table}] WHERE [${idCol}] = @v`, { v: value }, tx);
  return r.length > 0;
}

/** Refuse (409) when other tables still point at the record. refs = [[table, column, label]] */
async function refuseIfUsed(refs, value, what, tx) {
  const used = [];
  for (const [table, col, label] of refs) {
    const r = await query(`SELECT COUNT(*) AS n FROM [${table}] WHERE [${col}] = @v`, { v: value }, tx);
    if (r[0].n) used.push(`${r[0].n} ${label}`);
  }
  if (used.length) throw bad(`This ${what} is in use (${used.join(', ')}), so it cannot be deleted.`, 409);
}

// ---------------------------------------------------------------------------
// Lookups, pickers, overview
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [statuses, creditRatings, divisions, jobTypes, phaseTypes, jurisdictions, cities, superintendents] = await Promise.all([
    query('SELECT StatusID AS id, Status AS name, Active FROM LsStatus ORDER BY StatusID'),
    query('SELECT CreditID AS id, Rating AS name FROM LsCreditRating ORDER BY Rating'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query('SELECT JobTypeID AS id, JobType AS name FROM LsJobType ORDER BY JobType'),
    query('SELECT PhaseTypeID AS id, PhaseType AS name, JobTypeId FROM LsPhaseType ORDER BY PhaseType'),
    query('SELECT JurisdictionID AS id, Jurisdiction AS name, State FROM LsJurisdiction ORDER BY Jurisdiction'),
    query('SELECT CityID AS id, City AS name, State FROM LsCity ORDER BY State, City'),
    query("SELECT SuperID AS id, SuperName + ' - ' + ISNULL(SuperType,'') AS name, SuperName, SuperType, Active FROM LsSuperintendent ORDER BY SuperType, SuperName"),
  ]);
  res.json({ statuses, creditRatings, divisions, jobTypes, phaseTypes, jurisdictions, cities, superintendents });
}));

router.get('/overview', h(async (req, res) => {
  const [k, recentJobs, recentLots] = await Promise.all([
    query(`SELECT
        (SELECT COUNT(*) FROM JsCustomer) AS Builders,
        (SELECT COUNT(*) FROM JsCustomer WHERE StatusId = 1) AS ActiveBuilders,
        (SELECT COUNT(*) FROM JsJob) AS Jobs,
        (SELECT COUNT(*) FROM JsJob WHERE StatusId = 1) AS ActiveJobs,
        (SELECT COUNT(*) FROM JsPhase) AS Phases,
        (SELECT COUNT(*) FROM JsLot WHERE EndDate IS NULL AND StatusId = 1) AS OpenLots,
        (SELECT COUNT(*) FROM JsJob j WHERE NOT EXISTS (SELECT 1 FROM JsPhase p WHERE p.JobId = j.JobId)) AS JobsWithoutPhase,
        (SELECT COUNT(*) FROM JsPhase WHERE PmContractId IS NULL) AS PhasesWithoutBid,
        (SELECT COUNT(*) FROM JsJob WHERE PmJobId IS NULL) AS JobsWithoutPmJob,
        (SELECT COUNT(*) FROM JsLot WHERE DateEntered >= DATEADD(day,-30,GETDATE())) AS NewLots30`),
    query(`SELECT TOP 8 j.JobId, j.JobName, j.DivisionId, c.CustName, j.DateEntered, j.UserEntered
             FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId ORDER BY j.JobId DESC`),
    query(`SELECT TOP 8 l.LotID, ${lotName} AS LotBlock, l.Address, l.City, j.JobName, l.DateEntered
             FROM JsLot l LEFT JOIN JsJob j ON j.JobId = l.JobId ORDER BY l.LotID DESC`),
  ]);
  res.json({ ...k[0], recentJobs, recentLots });
}));

const like = (s) => `%${String(s || '').replace(/[%_[]/g, (c) => `[${c}]`)}%`;

router.get('/pick/builders', h(async (req, res) => {
  const rows = await query(
    'SELECT TOP 50 CustID AS id, CustName AS name FROM JsCustomer WHERE CustName LIKE @s ORDER BY CustName',
    { s: like(req.query.search) });
  res.json(rows);
}));
router.get('/pick/jobs', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 50 j.JobId AS id, j.JobName + ISNULL(' (' + j.DivisionId + ')','') AS name, j.CustId, j.DivisionId
       FROM JsJob j WHERE (j.JobName LIKE @s OR CAST(j.JobNum AS nvarchar(20)) LIKE @s) AND (@c IS NULL OR j.CustId = @c)
      ORDER BY j.JobName, j.DivisionId`,
    { s: like(req.query.search), c: int(req.query.builderId) || null });
  res.json(rows);
}));
router.get('/pick/lots', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 50 l.LotID AS id,
            ISNULL(l.Address,'(no address)') + ISNULL(', ' + l.City,'') + ISNULL(', ' + l.State,'') + ' – ' + ISNULL(j.JobName,'') + ' – lot ' + ${lotName} AS name
       FROM JsLot l LEFT JOIN JsJob j ON j.JobId = l.JobId
      WHERE l.Address LIKE @s OR l.City LIKE @s OR l.Permit LIKE @s OR j.JobName LIKE @s
      ORDER BY l.Address, ${lotOrder}`,
    { s: like(req.query.search) });
  res.json(rows);
}));
// PmJob picker (JsJobSub combo PmJobId): job, division, status, customer; Template = INACTIVE in Access
router.get('/pick/pm-jobs', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 100 pj.PmJobID AS id, pj.Job + ISNULL(' (' + pj.DivisionId + ')','') + ISNULL(' – ' + pc.Customer,'') + CASE WHEN pj.Template = 1 THEN ' [INACTIVE]' ELSE '' END AS name,
            pj.Template
       FROM PmJob pj LEFT JOIN PmCustomer pc ON pc.PmCustID = pj.PmCustId
      WHERE pj.Job LIKE @s OR pc.Customer LIKE @s
      ORDER BY pj.Job, pj.DivisionId`,
    { s: like(req.query.search) });
  res.json(rows);
}));

// ---------------------------------------------------------------------------
// Builders (JsCustomer) and bill-to addresses (JsCustomerBillAddres)
// ---------------------------------------------------------------------------
const BUILDER = { table: 'JsCustomer', idCol: 'CustID', columns: ['CustName', 'CustNum', 'Address', 'City', 'State', 'Zip', 'StatusId', 'CreditId'] };

router.get('/builders', h(async (req, res) => {
  const pg = paging(req.query);
  const status = req.query.status === 'active' ? 'active' : req.query.status === 'inactive' ? 'inactive' : 'all';
  const p = { s: req.query.search ? like(req.query.search) : null, status, offset: pg.offset, pageSize: pg.pageSize };
  const from = `FROM JsCustomer c
    WHERE (@s IS NULL OR c.CustName LIKE @s OR c.CustNum LIKE @s OR c.City LIKE @s)
      AND (@status = 'all' OR (@status = 'active' AND c.StatusId = 1) OR (@status = 'inactive' AND ISNULL(c.StatusId,0) <> 1))`;
  const [rows, total] = await Promise.all([
    query(`SELECT c.CustID, c.CustName, c.CustNum, c.City, c.State, c.StatusId,
                  (SELECT Status FROM LsStatus s WHERE s.StatusID = c.StatusId) AS Status,
                  (SELECT COUNT(*) FROM JsJob j WHERE j.CustId = c.CustID) AS Jobs,
                  (SELECT COUNT(*) FROM JsJob j WHERE j.CustId = c.CustID AND j.StatusId = 1) AS ActiveJobs,
                  (SELECT COUNT(*) FROM JsCustomerBillAddres b WHERE b.CustID = c.CustID) AS BillTo
             ${from} ORDER BY c.CustName OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/builders/:id', h(async (req, res) => {
  const cid = id(req.params.id);
  const [b, jobs, billTo] = await Promise.all([
    query(`SELECT c.*, (SELECT Status FROM LsStatus s WHERE s.StatusID = c.StatusId) AS Status,
                  (SELECT Rating FROM LsCreditRating r WHERE r.CreditID = c.CreditId) AS Rating
             FROM JsCustomer c WHERE c.CustID = @id`, { id: cid }),
    query(`SELECT j.JobId, j.JobName, j.JobNum, j.DivisionId, j.City, j.StatusId, st.Status, j.StartDate, j.EndDate,
                  (SELECT COUNT(*) FROM JsPhase p WHERE p.JobId = j.JobId) AS Phases,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId) AS Lots
             FROM JsJob j LEFT JOIN LsStatus st ON st.StatusID = j.StatusId WHERE j.CustId = @id ORDER BY j.JobName, j.DivisionId`, { id: cid }),
    query(`SELECT b.CustBillID, b.CustID, b.DivisionId, d.DivisionName, b.CustContact, b.BillAddress, b.BillCity, b.BillState, b.BillZip
             FROM JsCustomerBillAddres b LEFT JOIN LsDivision d ON d.DivisionID = b.DivisionId WHERE b.CustID = @id ORDER BY b.DivisionId`, { id: cid }),
  ]);
  if (!b[0]) return res.status(404).json({ error: 'Builder not found' });
  res.json({ builder: b[0], jobs, billTo });
}));

async function builderFields(b, curId, tx) {
  const o = {};
  if (has(b, 'CustName')) {
    o.CustName = txt(b.CustName, 50, 'Name', { required: true });
    const dup = await query('SELECT 1 AS x FROM JsCustomer WHERE LOWER(CustName) = LOWER(@n) AND CustID <> @id', { n: o.CustName, id: curId || 0 }, tx);
    if (dup.length) throw bad(`A builder named "${o.CustName}" already exists`, 409);
  }
  if (has(b, 'CustNum')) o.CustNum = txt(b.CustNum, 50, 'Cust Num QB');
  if (has(b, 'Address')) o.Address = txt(b.Address, 50, 'Address');
  if (has(b, 'City')) o.City = txt(b.City, 50, 'City');
  if (has(b, 'State')) o.State = stateCode(b.State);
  if (has(b, 'Zip')) o.Zip = txt(b.Zip, 50, 'Zip');
  if (has(b, 'StatusId')) {
    o.StatusId = int(b.StatusId);
    if (!o.StatusId || !(await exists('LsStatus', 'StatusID', o.StatusId, tx))) throw bad('Choose a valid status');
  }
  if (has(b, 'CreditId')) {
    o.CreditId = int(b.CreditId);
    if (o.CreditId != null && (Number.isNaN(o.CreditId) || !(await exists('LsCreditRating', 'CreditID', o.CreditId, tx)))) throw bad('Choose a valid credit rating');
  }
  return o;
}

router.post('/builders', h(async (req, res) => {
  const b = req.body || {};
  const newId = await withTransaction(async (tx) => {
    const o = await builderFields({ StatusId: 1, ...b }, 0, tx);
    if (!o.CustName) throw bad('Name is required');
    return insertRow(BUILDER, o, req.user.username, tx);
  });
  res.status(201).json({ id: newId });
}));

router.put('/builders/:id', h(async (req, res) => {
  const cid = id(req.params.id);
  const n = await withTransaction(async (tx) => {
    if (!(await exists('JsCustomer', 'CustID', cid, tx))) throw bad('Builder not found', 404);
    const o = await builderFields(req.body || {}, cid, tx);
    return updateRow(BUILDER, cid, o, tx);
  });
  res.json({ ok: true, changed: n });
}));

router.delete('/builders/:id', h(async (req, res) => {
  const cid = id(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await exists('JsCustomer', 'CustID', cid, tx))) throw bad('Builder not found', 404);
    await refuseIfUsed([
      ['JsJob', 'CustId', 'job(s)'], ['JsCustomerBillAddres', 'CustID', 'bill-to address(es) - delete them first'],
      ['ArOcip', 'CustId', 'OCIP record(s)'], ['ArPaySchedule', 'CustId', 'pay schedule(s)'], ['CxJob', 'CustId', 'Cox job(s)'],
      ['IcPackPo', 'CustId', 'pack PO(s)'], ['IcPackPoItem', 'CustId', 'pack PO item(s)'],
    ], cid, 'builder', tx);
    await deleteRow(BUILDER, cid, tx);
  });
  res.json({ ok: true });
}));

const BILL = { table: 'JsCustomerBillAddres', idCol: 'CustBillID', columns: ['CustID', 'DivisionId', 'CustContact', 'BillAddress', 'BillCity', 'BillState', 'BillZip'] };

async function billFields(b, cid, curId, tx) {
  const o = {};
  if (has(b, 'DivisionId')) {
    o.DivisionId = txt(b.DivisionId, 50, 'Division', { required: true });
    if (!(await exists('LsDivision', 'DivisionID', o.DivisionId, tx))) throw bad('Choose a valid division');
    const dup = await query('SELECT 1 AS x FROM JsCustomerBillAddres WHERE CustID = @c AND DivisionId = @d AND CustBillID <> @id', { c: cid, d: o.DivisionId, id: curId || 0 }, tx);
    if (dup.length) throw bad(`This builder already has a billing address for division ${o.DivisionId}`, 409);
  }
  if (has(b, 'CustContact')) o.CustContact = txt(b.CustContact, 50, 'Contact');
  if (has(b, 'BillAddress')) o.BillAddress = txt(b.BillAddress, 50, 'Address');
  if (has(b, 'BillCity')) o.BillCity = txt(b.BillCity, 50, 'City');
  if (has(b, 'BillState')) o.BillState = stateCode(b.BillState, 'Bill state');
  if (has(b, 'BillZip')) o.BillZip = txt(b.BillZip, 50, 'Zip');
  return o;
}

router.post('/builders/:id/billto', h(async (req, res) => {
  const cid = id(req.params.id);
  const newId = await withTransaction(async (tx) => {
    if (!(await exists('JsCustomer', 'CustID', cid, tx))) throw bad('Builder not found', 404);
    const body = req.body || {};
    if (!has(body, 'DivisionId')) throw bad('Division is required');
    const o = await billFields(body, cid, 0, tx);
    return insertRow(BILL, { ...o, CustID: cid }, req.user.username, tx);
  });
  res.status(201).json({ id: newId });
}));

router.put('/billto/:id', h(async (req, res) => {
  const bid = id(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await query('SELECT CustID FROM JsCustomerBillAddres WHERE CustBillID = @id', { id: bid }, tx);
    if (!cur[0]) throw bad('Billing address not found', 404);
    const o = await billFields(req.body || {}, cur[0].CustID, bid, tx);
    await updateRow(BILL, bid, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/billto/:id', h(async (req, res) => {
  const bid = id(req.params.id);
  const n = await deleteRow(BILL, bid);
  if (!n) return res.status(404).json({ error: 'Billing address not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Jobs (JsJob)
// ---------------------------------------------------------------------------
const JOB = {
  table: 'JsJob', idCol: 'JobId',
  columns: ['CustId', 'JobName', 'JobNum', 'Address', 'City', 'State', 'Zip', 'JobTypeId', 'PmJobId', 'LotQty', 'JurisdictionId', 'DivisionId',
    'CxJobTypeId', 'StartDate', 'EndDate', 'StatusId', 'Estimate', 'RevEstimate', 'Contract', 'RevContract', 'WarningJS', 'Notes'],
};

router.get('/jobs', h(async (req, res) => {
  const pg = paging(req.query);
  const status = req.query.status === 'active' ? 'active' : req.query.status === 'inactive' ? 'inactive' : 'all';
  const p = {
    s: req.query.search ? like(req.query.search) : null,
    c: int(req.query.builderId) || null,
    div: req.query.division || null,
    jt: int(req.query.jobTypeId) || null,
    status, offset: pg.offset, pageSize: pg.pageSize,
  };
  const from = `FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
    WHERE (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s OR CAST(j.JobNum AS nvarchar(20)) LIKE @s OR j.City LIKE @s)
      AND (@c IS NULL OR j.CustId = @c) AND (@div IS NULL OR j.DivisionId = @div) AND (@jt IS NULL OR j.JobTypeId = @jt)
      AND (@status = 'all' OR (@status = 'active' AND j.StatusId = 1) OR (@status = 'inactive' AND ISNULL(j.StatusId,0) <> 1))`;
  const [rows, total] = await Promise.all([
    query(`SELECT j.JobId, j.JobName, j.JobNum, j.DivisionId, j.CustId, c.CustName, j.City, j.StatusId, st.Status, jt.JobType, j.StartDate, j.EndDate, j.LotQty, j.WarningJS,
                  (SELECT COUNT(*) FROM JsPhase ph WHERE ph.JobId = j.JobId) AS Phases,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId) AS Lots
             ${from} ORDER BY j.JobName, j.DivisionId OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/jobs/:id', h(async (req, res) => {
  const jid = id(req.params.id);
  const [job, phases] = await Promise.all([
    query(`SELECT j.*, c.CustName, st.Status, jt.JobType, ju.Jurisdiction, d.DivisionName,
                  pj.Job AS PmJob, pj.Template AS PmJobInactive, pc.Customer AS PmCustomer
             FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId
             LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN LsJurisdiction ju ON ju.JurisdictionID = j.JurisdictionId
             LEFT JOIN LsDivision d ON d.DivisionID = j.DivisionId LEFT JOIN PmJob pj ON pj.PmJobID = j.PmJobId
             LEFT JOIN PmCustomer pc ON pc.PmCustID = pj.PmCustId
            WHERE j.JobId = @id`, { id: jid }),
    query(`SELECT ph.PhaseID, ph.Phase, ph.PhaseNum, pt.PhaseType, ph.StartDate, ph.EndDate, ph.PmContractId,
                  ct.BidNum, ct.BidRelease,
                  s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PhaseId = ph.PhaseID) AS Lots,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PhaseId = ph.PhaseID AND l.EndDate IS NULL AND l.StatusId = 1) AS OpenLots
             FROM JsPhase ph LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId
             LEFT JOIN PmContract ct ON ct.PmContractID = ph.PmContractId
             LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
            WHERE ph.JobId = @id ORDER BY TRY_CAST(ph.PhaseNum AS int), ph.Phase`, { id: jid }),
  ]);
  if (!job[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: job[0], phases });
}));

async function jobFields(b, cur, tx) {
  const o = {};
  if (has(b, 'JobName')) o.JobName = txt(b.JobName, 50, 'Job name', { required: true });
  if (has(b, 'JobNum')) {
    o.JobNum = int(b.JobNum);
    if (Number.isNaN(o.JobNum)) throw bad('Job num must be a whole number');
  }
  if (has(b, 'Address')) o.Address = txt(b.Address, 255, 'Address');
  if (has(b, 'City')) o.City = txt(b.City, 50, 'City');
  if (has(b, 'State')) o.State = stateCode(b.State);
  if (has(b, 'Zip')) o.Zip = txt(b.Zip, 255, 'Zip');
  if (has(b, 'Notes')) o.Notes = txt(b.Notes, 255, 'Notes');
  if (has(b, 'LotQty')) {
    o.LotQty = int(b.LotQty);
    if (Number.isNaN(o.LotQty)) throw bad('Lot qty must be a whole number (0 or more)');
  }
  if (has(b, 'DivisionId')) {
    o.DivisionId = txt(b.DivisionId, 50, 'Division', { required: true });
    if (!(await exists('LsDivision', 'DivisionID', o.DivisionId, tx))) throw bad('Choose a valid division');
  }
  if (has(b, 'JobTypeId')) {
    o.JobTypeId = int(b.JobTypeId);
    if (o.JobTypeId != null && (Number.isNaN(o.JobTypeId) || !(await exists('LsJobType', 'JobTypeID', o.JobTypeId, tx)))) throw bad('Choose a valid job type');
  }
  if (has(b, 'JurisdictionId')) {
    o.JurisdictionId = int(b.JurisdictionId);
    if (o.JurisdictionId != null && (Number.isNaN(o.JurisdictionId) || !(await exists('LsJurisdiction', 'JurisdictionID', o.JurisdictionId, tx)))) throw bad('Choose a valid jurisdiction');
  }
  if (has(b, 'StatusId')) {
    o.StatusId = int(b.StatusId);
    if (!o.StatusId || !(await exists('LsStatus', 'StatusID', o.StatusId, tx))) throw bad('Choose a valid status');
  }
  if (has(b, 'StartDate')) o.StartDate = isoDate(b.StartDate, 'Start date');
  if (has(b, 'EndDate')) o.EndDate = isoDate(b.EndDate, 'End date');
  if (has(b, 'WarningJS')) o.WarningJS = flag(b.WarningJS);
  const start = has(o, 'StartDate') ? o.StartDate : cur?.StartDate ? new Date(cur.StartDate).toISOString().slice(0, 10) : null;
  const end = has(o, 'EndDate') ? o.EndDate : cur?.EndDate ? new Date(cur.EndDate).toISOString().slice(0, 10) : null;
  if (start && end && end < start) throw bad('End date cannot be before the start date');

  // Link to the Plan-management job (Access: BeforeUpdate warnings on JsJobSub.PmJobId)
  const warnings = [];
  if (has(b, 'PmJobId')) {
    o.PmJobId = int(b.PmJobId);
    if (o.PmJobId != null) {
      if (Number.isNaN(o.PmJobId)) throw bad('Choose a valid PM job');
      const pm = await query('SELECT PmJobID, Template FROM PmJob WHERE PmJobID = @v', { v: o.PmJobId }, tx);
      if (!pm[0]) throw bad('Choose a valid PM job');
      const changed = !cur || cur.PmJobId !== o.PmJobId;
      if (changed) {
        if (cur && cur.PmJobId != null && !flag(b.confirmPmLink)) {
          throw bad('You are about to change the link between SC and PM for this job. Are you sure?', 409, { code: 'CONFIRM_PM_LINK' });
        }
        if (pm[0].Template && !flag(b.confirmInactivePm)) {
          throw bad('This job is INACTIVE. Are you sure you want to select it?', 409, { code: 'CONFIRM_INACTIVE_PM' });
        }
        if (cur) {
          const orphan = await query(
            `SELECT COUNT(*) AS n FROM JsPhase ph WHERE ph.JobId = @j AND ph.PmContractId IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM PmContract c WHERE c.PmContractID = ph.PmContractId AND c.PmJobId = @pm)`,
            { j: cur.JobId, pm: o.PmJobId }, tx);
          if (orphan[0].n) warnings.push(`${orphan[0].n} phase(s) are linked to a bid of the previous PM job - review their bid.`);
        }
      }
    }
  }
  if (cur && has(o, 'JobTypeId') && o.JobTypeId !== cur.JobTypeId) {
    const mism = await query(
      `SELECT COUNT(*) AS n FROM JsPhase ph LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId
        WHERE ph.JobId = @j AND ISNULL(pt.JobTypeId,-1) <> ISNULL(@t,-2)`, { j: cur.JobId, t: o.JobTypeId }, tx);
    if (mism[0].n) warnings.push(`${mism[0].n} phase(s) have a phase type that belongs to a different job type - review them.`);
  }
  return { o, warnings };
}

async function jobDuplicate(custId, name, division, selfId, tx) {
  const dup = await query(
    'SELECT 1 AS x FROM JsJob WHERE CustId = @c AND LOWER(JobName) = LOWER(@n) AND ISNULL(DivisionId,\'\') = ISNULL(@d,\'\') AND JobId <> @id',
    { c: custId, n: name, d: division, id: selfId || 0 }, tx);
  if (dup.length) throw bad(`This builder already has a job named "${name}" in division ${division || '(none)'}`, 409);
}

router.post('/jobs', h(async (req, res) => {
  const b = req.body || {};
  const custId = int(b.CustId);
  if (!custId) throw bad('Choose the builder this job belongs to');
  const out = await withTransaction(async (tx) => {
    if (!(await exists('JsCustomer', 'CustID', custId, tx))) throw bad('Builder not found');
    const { o, warnings } = await jobFields({ StatusId: 1, ...b }, null, tx);
    if (!o.JobName) throw bad('Job name is required');
    if (!o.DivisionId) throw bad('Division is required');
    await jobDuplicate(custId, o.JobName, o.DivisionId, 0, tx);
    const newId = await insertRow(JOB, {
      Estimate: money0, RevEstimate: money0, Contract: money0, RevContract: money0, WarningJS: 0, CxJobTypeId: 0,
      ...o, CustId: custId,
    }, req.user.username, tx);
    return { id: newId, warnings };
  });
  res.status(201).json(out);
}));

router.put('/jobs/:id', h(async (req, res) => {
  const jid = id(req.params.id);
  const b = req.body || {};
  const out = await withTransaction(async (tx) => {
    const cur = await query('SELECT * FROM JsJob WHERE JobId = @id', { id: jid }, tx);
    if (!cur[0]) throw bad('Job not found', 404);
    if (has(b, 'CustId') && int(b.CustId) !== cur[0].CustId) throw bad('A job cannot be moved to another builder');
    const { o, warnings } = await jobFields(b, cur[0], tx);
    if (has(o, 'JobName') || has(o, 'DivisionId')) {
      await jobDuplicate(cur[0].CustId, o.JobName ?? cur[0].JobName, has(o, 'DivisionId') ? o.DivisionId : cur[0].DivisionId, jid, tx);
    }
    await updateRow(JOB, jid, o, tx);
    return { ok: true, warnings };
  });
  res.json(out);
}));

router.delete('/jobs/:id', h(async (req, res) => {
  const jid = id(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await exists('JsJob', 'JobId', jid, tx))) throw bad('Job not found', 404);
    await refuseIfUsed([
      ['JsPhase', 'JobId', 'phase(s) - delete them first'], ['JsLot', 'JobId', 'lot(s)'], ['ArBilling', 'JobId', 'billing record(s)'],
      ['ArOcipJob', 'JobId', 'OCIP job record(s)'], ['CsJob', 'JobId', 'customer service job record(s)'], ['CxJobAssessor', 'JobId', 'Cox assessor record(s)'],
      ['CxPlan', 'JobId', 'Cox plan(s)'], ['IcPackPo', 'JobId', 'pack PO(s)'], ['IcPackPoItem', 'JobId', 'pack PO item(s)'],
      ['PrLaborPaid', 'JobId', 'paid labor line(s)'], ['TmPO', 'JobId', 'T&M order(s)'],
    ], jid, 'job', tx);
    await deleteRow(JOB, jid, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Phases (JsPhase)
// ---------------------------------------------------------------------------
const PHASE = {
  table: 'JsPhase', idCol: 'PhaseID',
  columns: ['JobId', 'Phase', 'PhaseNum', 'PhaseTypeId', 'PmContractId', 'SuperId1', 'SuperId2', 'StartDate', 'EndDate', 'Estimate', 'RevEstimate', 'Contract', 'RevContract', 'Notes'],
};
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

// Bids of the job's PM job: label as in Access = BidNum & " effective " & BidRelease
async function bidsForJob(pmJobId, tx) {
  if (!pmJobId) return [];
  return query(
    `SELECT c.PmContractID AS id, c.BidNum + ISNULL(' effective ' + c.BidRelease, '') AS name, c.BidNum, c.BidRelease, c.BidName, c.BidDate, c.StatusId, st.Status
       FROM PmContract c LEFT JOIN LsStatus st ON st.StatusID = c.StatusId WHERE c.PmJobId = @p ORDER BY c.BidNum DESC`, { p: pmJobId }, tx);
}

async function phaseFields(b, job, cur, tx) {
  const o = {};
  if (has(b, 'Phase')) o.Phase = txt(b.Phase, 50, 'Phase', { required: true });
  if (has(b, 'PhaseNum')) o.PhaseNum = txt(b.PhaseNum, 50, 'Phase num');
  if (has(b, 'Notes')) o.Notes = txt(b.Notes, 255, 'Notes');
  if (has(b, 'PhaseTypeId')) {
    o.PhaseTypeId = int(b.PhaseTypeId);
    if (!o.PhaseTypeId) throw bad('Phase type is required');
    if (!job.JobTypeId) throw bad('Set the job type on the job before adding phases (phase types depend on it)');
    const ok = await query('SELECT 1 AS x FROM LsPhaseType WHERE PhaseTypeID = @t AND JobTypeId = @jt', { t: o.PhaseTypeId, jt: job.JobTypeId }, tx);
    if (!ok.length) throw bad("That phase type does not belong to the job's job type");
  }
  for (const k of ['SuperId1', 'SuperId2']) {
    if (has(b, k)) {
      o[k] = int(b[k]);
      if (o[k] != null && (Number.isNaN(o[k]) || !(await exists('LsSuperintendent', 'SuperID', o[k], tx)))) throw bad('Choose a valid superintendent');
    }
  }
  if (has(o, 'SuperId1') && !o.SuperId1) throw bad('Super high voltage is required');
  if (has(b, 'StartDate')) o.StartDate = isoDate(b.StartDate, 'Start date');
  if (has(b, 'EndDate')) o.EndDate = isoDate(b.EndDate, 'End date');
  const start = has(o, 'StartDate') ? o.StartDate : dateOnly(cur?.StartDate);
  const end = has(o, 'EndDate') ? o.EndDate : dateOnly(cur?.EndDate);
  if (start && end && end < start) throw bad('End date cannot be before the start date');

  const warnings = [];
  if (has(b, 'PmContractId')) {
    o.PmContractId = int(b.PmContractId);
    if (o.PmContractId != null) {
      if (Number.isNaN(o.PmContractId)) throw bad('Choose a valid bid');
      if (!job.PmJobId) throw bad('Link the job to a Plan-management job before choosing a bid');
      const ok = await query('SELECT 1 AS x FROM PmContract WHERE PmContractID = @c AND PmJobId = @p', { c: o.PmContractId, p: job.PmJobId }, tx);
      if (!ok.length) throw bad("That bid does not belong to the job's Plan-management job");
    }
    if (cur && o.PmContractId !== cur.PmContractId) {
      // Access: frmJsPhaseCheckLink — no bid change once packs are scheduled on any lot of the phase
      const packs = await query('SELECT COUNT(*) AS n FROM JsLot l JOIN JsPack p ON p.LotId = l.LotID WHERE l.PhaseId = @ph', { ph: cur.PhaseID }, tx);
      if (packs[0].n) throw bad('You cannot change the bid. You already have packs scheduled for these lots.', 409);
      const plans = await query(
        `SELECT COUNT(*) AS n FROM JsLot l WHERE l.PhaseId = @ph AND l.PmPlanId IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM PmPlan pl WHERE pl.PmPlanID = l.PmPlanId AND pl.PmContractId = @c)`, { ph: cur.PhaseID, c: o.PmContractId }, tx);
      if (plans[0].n) warnings.push(`${plans[0].n} lot(s) use a plan from the previous bid - change their plan in Scheduling.`);
    }
  }
  return { o, warnings };
}

router.get('/phases/:id', h(async (req, res) => {
  const pid = id(req.params.id);
  const ph = await query(
    `SELECT ph.*, j.JobName, j.JobNum, j.DivisionId, j.CustId, j.JobTypeId, j.PmJobId, j.WarningJS, c.CustName, pt.PhaseType,
            ct.BidNum, ct.BidRelease, ct.BidName,
            s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2
       FROM JsPhase ph JOIN JsJob j ON j.JobId = ph.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
       LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId LEFT JOIN PmContract ct ON ct.PmContractID = ph.PmContractId
       LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
      WHERE ph.PhaseID = @id`, { id: pid });
  if (!ph[0]) return res.status(404).json({ error: 'Phase not found' });
  const [lots, packs, bids, phaseTypes] = await Promise.all([
    query(`SELECT l.LotID, ${lotName} AS LotBlock, l.Lot, l.Block, l.PmPlanId, l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes,
                  pl.PlanNum, l.StartDate, l.EndDate, CAST(l.StatusId AS int) AS StatusId, ${lotStatus} AS Status,
                  (SELECT COUNT(*) FROM JsPack p WHERE p.LotId = l.LotID) AS Packs
             FROM JsLot l LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.PhaseId = @id ORDER BY ${lotOrder}`, { id: pid }),
    query('SELECT COUNT(*) AS n FROM JsLot l JOIN JsPack p ON p.LotId = l.LotID WHERE l.PhaseId = @id', { id: pid }),
    bidsForJob(ph[0].PmJobId),
    ph[0].JobTypeId ? query('SELECT PhaseTypeID AS id, PhaseType AS name FROM LsPhaseType WHERE JobTypeId = @t ORDER BY PhaseType', { t: ph[0].JobTypeId }) : [],
  ]);
  const plans = await plansForContract(ph[0].PmContractId);
  res.json({ phase: ph[0], lots, packsScheduled: packs[0].n, bids, phaseTypes, plans });
}));

// Options needed to fill in a NEW phase for a job (phase types of its job type, bids of its PM job)
router.get('/jobs/:id/phase-options', h(async (req, res) => {
  const jid = id(req.params.id);
  const j = await query('SELECT JobId, JobName, JobTypeId, PmJobId FROM JsJob WHERE JobId = @id', { id: jid });
  if (!j[0]) return res.status(404).json({ error: 'Job not found' });
  const [bids, phaseTypes] = await Promise.all([
    bidsForJob(j[0].PmJobId),
    j[0].JobTypeId ? query('SELECT PhaseTypeID AS id, PhaseType AS name FROM LsPhaseType WHERE JobTypeId = @t ORDER BY PhaseType', { t: j[0].JobTypeId }) : [],
  ]);
  res.json({ job: j[0], bids, phaseTypes });
}));

router.post('/jobs/:id/phases', h(async (req, res) => {
  const jid = id(req.params.id);
  const b = req.body || {};
  const out = await withTransaction(async (tx) => {
    const job = await query('SELECT JobId, JobTypeId, PmJobId FROM JsJob WHERE JobId = @id', { id: jid }, tx);
    if (!job[0]) throw bad('Job not found', 404);
    const body = { ...b };
    if (!has(body, 'StartDate') || !body.StartDate) body.StartDate = new Date().toISOString().slice(0, 10);
    const { o, warnings } = await phaseFields(body, job[0], null, tx);
    if (!o.Phase) throw bad('Phase is required');
    if (!o.PhaseTypeId) throw bad('Phase type is required');
    if (!o.SuperId1) throw bad('Super high voltage is required');
    if (!has(o, 'PhaseNum') || o.PhaseNum == null) o.PhaseNum = o.Phase;
    const dup = await query('SELECT 1 AS x FROM JsPhase WHERE JobId = @j AND LOWER(Phase) = LOWER(@p)', { j: jid, p: o.Phase }, tx);
    if (dup.length) throw bad(`This job already has a phase named "${o.Phase}"`, 409);
    const newId = await insertRow(PHASE, { Estimate: money0, RevEstimate: money0, Contract: money0, RevContract: money0, ...o, JobId: jid }, req.user.username, tx);
    return { id: newId, warnings };
  });
  res.status(201).json(out);
}));

router.put('/phases/:id', h(async (req, res) => {
  const pid = id(req.params.id);
  const b = req.body || {};
  const out = await withTransaction(async (tx) => {
    const cur = await query('SELECT * FROM JsPhase WHERE PhaseID = @id', { id: pid }, tx);
    if (!cur[0]) throw bad('Phase not found', 404);
    if (has(b, 'JobId') && int(b.JobId) !== cur[0].JobId) throw bad('A phase cannot be moved to another job');
    const job = await query('SELECT JobId, JobTypeId, PmJobId FROM JsJob WHERE JobId = @id', { id: cur[0].JobId }, tx);
    const { o, warnings } = await phaseFields(b, job[0], cur[0], tx);
    if (has(o, 'Phase') && o.Phase.toLowerCase() !== String(cur[0].Phase || '').toLowerCase()) {
      const dup = await query('SELECT 1 AS x FROM JsPhase WHERE JobId = @j AND LOWER(Phase) = LOWER(@p) AND PhaseID <> @id', { j: cur[0].JobId, p: o.Phase, id: pid }, tx);
      if (dup.length) throw bad(`This job already has a phase named "${o.Phase}"`, 409);
    }
    await updateRow(PHASE, pid, o, tx);
    return { ok: true, warnings };
  });
  res.json(out);
}));

router.delete('/phases/:id', h(async (req, res) => {
  const pid = id(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await exists('JsPhase', 'PhaseID', pid, tx))) throw bad('Phase not found', 404);
    await refuseIfUsed([['JsLot', 'PhaseId', 'lot(s) - delete them first'], ['JcPhase', 'PhaseId', 'job cost phase record(s)']], pid, 'phase', tx);
    await deleteRow(PHASE, pid, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Lots overview (read-only; lots are edited in Scheduling)
// ---------------------------------------------------------------------------
const LOT_FROM = `FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
  LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId
  LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2`;

router.get('/lots', h(async (req, res) => {
  const pg = paging(req.query);
  const state = ['open', 'closed'].includes(req.query.state) ? req.query.state : 'all';
  const p = {
    s: req.query.search ? like(req.query.search) : null,
    c: int(req.query.builderId) || null, j: int(req.query.jobId) || null, ph: int(req.query.phaseId) || null, div: req.query.division || null,
    from: isoDate(req.query.from, 'From date'), to: isoDate(req.query.to, 'To date'), state, offset: pg.offset, pageSize: pg.pageSize,
  };
  const where = `WHERE (@s IS NULL OR l.Address LIKE @s OR l.City LIKE @s OR l.Permit LIKE @s OR l.Lot LIKE @s OR j.JobName LIKE @s OR c.CustName LIKE @s OR l.LotNotes LIKE @s)
      AND (@c IS NULL OR j.CustId = @c) AND (@j IS NULL OR l.JobId = @j) AND (@ph IS NULL OR l.PhaseId = @ph) AND (@div IS NULL OR j.DivisionId = @div)
      AND (@from IS NULL OR ph.StartDate >= @from) AND (@to IS NULL OR ph.StartDate <= @to)
      AND (@state = 'all' OR (@state = 'open' AND l.EndDate IS NULL AND l.StatusId = 1) OR (@state = 'closed' AND l.EndDate IS NOT NULL))`;
  const [rows, total] = await Promise.all([
    query(`SELECT l.LotID, ${lotName} AS LotBlock, l.Address, l.City, l.State, l.Zip, l.Permit, l.StartDate, l.EndDate, ${lotStatus} AS Status,
                  pl.PlanNum, j.JobId, j.JobName, j.DivisionId, c.CustName, ph.PhaseID, ph.Phase, ph.StartDate AS PhaseStart
             ${LOT_FROM} ${where} ORDER BY j.JobName, ph.Phase, ${lotOrder} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${LOT_FROM} ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

// Address lot search result (Access report JsAddressSearchSimple): everything about one lot + its packs
router.get('/lots/:id', h(async (req, res) => {
  const lid = id(req.params.id);
  const lot = await query(
    `SELECT l.LotID, ${lotName} AS LotBlock, l.Lot, l.Block, l.PmPlanId, l.StatusId, ph.PmContractId,
            l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes, l.StartDate, l.EndDate, l.WarrantyDate,
            l.InvoiceNum, l.DateEntered, l.UserEntered, ${lotStatus} AS Status, pl.PlanNum, pl.PlanName,
            c.CustID, c.CustName, j.JobId, j.JobName, j.DivisionId, ph.PhaseID, ph.Phase, ph.StartDate AS PhaseStart,
            ct.BidNum, ct.BidRelease, ct.BidName, ct.BidDate, s1.SuperName AS Super1, s2.SuperName AS Super2,
            CAST(c.CustID AS varchar(20)) + '.' + CAST(j.JobId AS varchar(20)) + '.' + CAST(ph.PhaseID AS varchar(20)) + '.' + CAST(l.LotID AS varchar(20)) AS Code
       ${LOT_FROM} LEFT JOIN PmContract ct ON ct.PmContractID = ph.PmContractId WHERE l.LotID = @id`, { id: lid });
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  const packs = await query(
    `SELECT p.PackID, pk.PackName, pk.BuilderCode, p.PackQty FROM JsPack p LEFT JOIN PmPack pk ON pk.PmPackID = p.PmPackId
      WHERE p.LotId = @id ORDER BY pk.PackName, p.PackID`, { id: lid });
  const plans = await plansForContract(lot[0].PmContractId);
  res.json({ lot: lot[0], packs, plans });
}));

// ---------------------------------------------------------------------------
// Lot create / update / delete — Access subform JsPhaseSubLot (inside JsPhase "Phase and Lot setup")
//   * a closed lot (EndDate filled) cannot be modified: "This lot is closed. You need to open the lot before you can modify it."
//   * the plan cannot change once packs are scheduled on the lot (frmJsPhaseSubLotCheckLink)
//   * plan list = plans of the phase's bid (PmPlan.PmContractId = JsPhase.PmContractId)
//   * new lot StartDate defaults to the phase start date
//   * EndDate is locked in the Access subform (closing / re-opening is done in Scheduling, which logs it)
// ---------------------------------------------------------------------------
const LOT = {
  table: 'JsLot', idCol: 'LotID',
  columns: ['PhaseId', 'JobId', 'Lot', 'Block', 'PmPlanId', 'StartDate', 'Address', 'City', 'State', 'Zip', 'Permit', 'StatusId', 'Estimate', 'RevEstimate', 'Contract', 'RevContract', 'LotNotes'],
};

async function plansForContract(contractId, tx) {
  if (!contractId) return [];
  return query(
    `SELECT pl.PmPlanID AS id, pl.PlanNum + ISNULL(' – ' + pl.PlanName, '') AS name, pl.PlanNum, pl.PlanName, pl.SqFt, pl.StatusId
       FROM PmPlan pl WHERE pl.PmContractId = @c AND ISNULL(pl.Universal, 0) = 0 ORDER BY pl.PlanNum`, { c: contractId }, tx);
}

async function lotFields(b, phase, tx) {
  const o = {};
  if (has(b, 'Lot')) o.Lot = txt(b.Lot, 50, 'Lot', { required: true });
  if (has(b, 'Block')) o.Block = txt(b.Block, 50, 'Block');
  if (has(b, 'Address')) o.Address = txt(b.Address, 50, 'Address');
  if (has(b, 'City')) o.City = txt(b.City, 50, 'City');
  if (has(b, 'State')) o.State = stateCode(b.State);
  if (has(b, 'Zip')) {
    const z = b.Zip == null ? '' : String(b.Zip).trim();
    if (z && !/^\d{1,9}$/.test(z)) throw bad('Zip must be digits only (for example 95630)');
    o.Zip = z ? parseInt(z, 10) : null;
  }
  if (has(b, 'Permit')) o.Permit = txt(b.Permit, 255, 'Permit');
  if (has(b, 'LotNotes')) o.LotNotes = txt(b.LotNotes, 255, 'Notes');
  if (has(b, 'StartDate')) o.StartDate = isoDate(b.StartDate, 'Start date');
  // JsLot.StatusId is a bit: 1 = active, 0 = inactive (same as Scheduling)
  if (has(b, 'StatusId')) o.StatusId = flag(b.StatusId);
  if (has(b, 'PmPlanId')) {
    o.PmPlanId = int(b.PmPlanId);
    if (!o.PmPlanId) throw bad('Choose a plan');
    if (!phase.PmContractId) throw bad('Choose a bid on the phase before adding lots (the plan list comes from the bid)');
    const ok = await query('SELECT 1 AS x FROM PmPlan WHERE PmPlanID = @p AND PmContractId = @c', { p: o.PmPlanId, c: phase.PmContractId }, tx);
    if (!ok.length) throw bad("That plan does not belong to the phase's bid");
  }
  return o;
}

async function lotDuplicate(phaseId, lot, block, selfId, tx) {
  const dup = await query(`SELECT 1 AS x FROM JsLot WHERE PhaseId = @ph AND Lot = @l AND ISNULL(Block,'') = ISNULL(@b,'') AND LotID <> @id`,
    { ph: phaseId, l: lot, b: block, id: selfId || 0 }, tx);
  if (dup.length) throw bad(`Lot ${lot}${block ? '/' + block : ''} already exists in this phase`, 409);
}

router.post('/phases/:id/lots', h(async (req, res) => {
  const pid = id(req.params.id);
  const b = req.body || {};
  const newId = await withTransaction(async (tx) => {
    const ph = await query('SELECT PhaseID, JobId, PmContractId, StartDate FROM JsPhase WHERE PhaseID = @id', { id: pid }, tx);
    if (!ph[0]) throw bad('Phase not found', 404);
    if (!has(b, 'Lot')) throw bad('Lot is required');
    if (!has(b, 'PmPlanId')) throw bad('Choose a plan');
    const o = await lotFields(b, ph[0], tx);
    if (!has(o, 'StartDate') || !o.StartDate) o.StartDate = dateOnly(ph[0].StartDate);
    await lotDuplicate(pid, o.Lot, o.Block ?? null, 0, tx);
    return insertRow(LOT, {
      Estimate: money0, RevEstimate: money0, Contract: money0, RevContract: money0, StatusId: 1,
      ...o, PhaseId: pid, JobId: ph[0].JobId,
    }, req.user.username, tx);
  });
  res.status(201).json({ id: newId });
}));

router.put('/lots/:id', h(async (req, res) => {
  const lid = id(req.params.id);
  const b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await query('SELECT LotID, PhaseId, Lot, Block, PmPlanId, EndDate FROM JsLot WHERE LotID = @id', { id: lid }, tx);
    if (!cur[0]) throw bad('Lot not found', 404);
    if (has(b, 'EndDate') || has(b, 'PhaseId') || has(b, 'JobId')) throw bad('End date, phase and job of a lot are changed in Scheduling / Maintenance, not here');
    if (cur[0].EndDate) throw bad('This lot is closed. You need to open the lot before you can modify it.', 409);
    const ph = await query('SELECT PhaseID, PmContractId FROM JsPhase WHERE PhaseID = @id', { id: cur[0].PhaseId }, tx);
    const o = await lotFields(b, ph[0], tx);
    if (has(o, 'PmPlanId') && o.PmPlanId !== cur[0].PmPlanId) {
      const packs = await query('SELECT COUNT(*) AS n FROM JsPack WHERE LotId = @id', { id: lid }, tx);
      if (packs[0].n) throw bad('You cannot change the plan. You already have scheduled packs linked to the original entry.', 409);
    }
    if (has(o, 'Lot') || has(o, 'Block')) {
      await lotDuplicate(cur[0].PhaseId, o.Lot ?? cur[0].Lot, has(o, 'Block') ? o.Block : cur[0].Block, lid, tx);
    }
    await updateRow(LOT, lid, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/lots/:id', h(async (req, res) => {
  const lid = id(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await exists('JsLot', 'LotID', lid, tx))) throw bad('Lot not found', 404);
    await refuseIfUsed([
      ['JsPack', 'LotId', 'scheduled pack(s)'], ['JsStage', 'LotId', 'scheduled stage(s)'], ['PrLaborPaid', 'LotId', 'paid labor line(s)'],
      ['JcLotItem', 'LotId', 'job cost line(s)'], ['ArBilling', 'LotId', 'billing record(s)'], ['ArPreBillLot', 'LotId', 'pre-billing record(s)'],
      ['ArPreBillPack', 'LotId', 'pre-billing pack(s)'], ['IcPackPo', 'LotId', 'pack PO(s)'], ['IcPackPoItem', 'LotId', 'pack PO item(s)'],
      ['TmPO', 'LotId', 'T&M order(s)'], ['CsProperty', 'LotId', 'customer service propert(ies)'], ['CsPropertyLink', 'LotId', 'customer service link(s)'],
      ['JsLotEndDateRegistry', 'LotId', 'close/open history entr(ies)'], ['JsPackLaborArchive', 'LotId', 'archived labor line(s)'],
    ], lid, 'lot', tx);
    await deleteRow(LOT, lid, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Reports (SwitchJS buttons). Every report returns { title, columns, rows, truncated }.
// ---------------------------------------------------------------------------
function need(v, what) {
  const n = int(v);
  if (!n) throw bad(`Choose ${what}`);
  return n;
}
function range(q) {
  const from = isoDate(q.from, 'From date'), to = isoDate(q.to, 'To date');
  if (!from || !to) throw bad('Enter both a from and a to date');
  if (to < from) throw bad('The to date cannot be before the from date');
  return { from, to };
}
function finish(res, title, columns, rows, extra = {}) {
  const truncated = rows.length > MAX_REPORT_ROWS;
  res.json({ title, columns, rows: truncated ? rows.slice(0, MAX_REPORT_ROWS) : rows, total: Math.min(rows.length, MAX_REPORT_ROWS), truncated, ...extra });
}
const LOT_COLS = {
  code: ['Code', 'Code'], cust: ['CustName', 'Builder'], job: ['JobName', 'Job'], div: ['DivisionId', 'Div'], phase: ['Phase', 'Phase'], phaseNum: ['PhaseNum', 'Phase number'],
  phaseType: ['PhaseType', 'Phase type'], super1: ['Super1', 'Super 1'], super2: ['Super2', 'Super 2'], phaseStart: ['PhaseStart', 'Start date'],
  lot: ['LotBlock', 'Lot/block'], plan: ['PlanNum', 'Plan number'], planName: ['PlanName', 'Plan name'], address: ['Address', 'Address'], city: ['City', 'City'],
  state: ['State', 'State'], zip: ['Zip', 'Zip'], permit: ['Permit', 'Permit'], lotStart: ['StartDate', 'Lot start'], lotEnd: ['EndDate', 'Lot end'], status: ['Status', 'Status'],
};
const cols = (...k) => k.map((x) => ({ key: LOT_COLS[x][0], label: LOT_COLS[x][1] }));
const CODE = "CAST(c.CustID AS varchar(20)) + '.' + CAST(j.JobId AS varchar(20)) + '.' + CAST(ph.PhaseID AS varchar(20)) + '.' + CAST(l.LotID AS varchar(20))";
const SUPERS = "s1.SuperName + ' - ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' - ' + ISNULL(s2.SuperType,'') AS Super2";

// JsJobAlphabetically: jobs with the last phase's high-voltage superintendent; builders named Test* are left out
router.get('/reports/jobs-alphabetical', h(async (req, res) => {
  const all = req.query.all === '1' ? 1 : 0;
  const rows = await query(
    `SELECT TOP (${MAX_REPORT_ROWS + 1}) c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, st.Status,
            (SELECT TOP 1 s.SuperName FROM JsPhase p JOIN LsSuperintendent s ON s.SuperID = p.SuperId1 WHERE p.JobId = j.JobId ORDER BY p.PhaseID DESC) AS LastSuperName
       FROM JsCustomer c JOIN JsJob j ON j.CustId = c.CustID LEFT JOIN LsStatus st ON st.StatusID = j.StatusId
      WHERE c.CustName NOT LIKE 'Test%'
        AND (@all = 1 OR EXISTS (SELECT 1 FROM JsPhase p JOIN LsSuperintendent s ON s.SuperID = p.SuperId1 WHERE p.JobId = j.JobId))
        AND (@div IS NULL OR j.DivisionId = @div)
      ORDER BY j.JobName, j.DivisionId`, { all, div: req.query.division || null });
  finish(res, 'Job list - alphabetical', [
    { key: 'DivisionId', label: 'Div' }, { key: 'JobName', label: 'Job' }, { key: 'CustName', label: 'Customer' }, { key: 'JobNum', label: 'Job num' },
    { key: 'LastSuperName', label: 'Superintendent' }, { key: 'Status', label: 'Status' }], rows);
}));

// JsLotNew: lots created between two dates (the to-date is inclusive)
router.get('/reports/new-lots', h(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await query(
    `SELECT TOP (${MAX_REPORT_ROWS + 1}) j.DivisionId, ${CODE} AS Code, c.CustName, j.JobName, ph.Phase, ph.PhaseNum, pt.PhaseType, ${SUPERS},
            ph.StartDate AS PhaseStart, ${lotName} AS LotBlock, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip, l.Permit, l.DateEntered
       ${LOT_FROM} WHERE l.DateEntered >= @from AND l.DateEntered < DATEADD(day, 1, @to)
      ORDER BY j.DivisionId, c.CustName, j.JobName, ph.Phase, ${lotOrder}`, { from, to });
  finish(res, `New lots created between ${from} and ${to}`,
    [...cols('div', 'code', 'cust', 'job', 'phase', 'phaseNum', 'phaseType', 'super1', 'super2', 'phaseStart', 'lot', 'plan', 'address', 'city', 'state', 'zip', 'permit'), { key: 'DateEntered', label: 'Entered' }], rows);
}));

// JsLotStartDate: lots whose PHASE start date is in the range
router.get('/reports/lots-by-start-date', h(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await query(
    `SELECT TOP (${MAX_REPORT_ROWS + 1}) ${CODE} AS Code, c.CustName, j.JobName, j.DivisionId, ph.Phase, ph.PhaseNum, pt.PhaseType, ${SUPERS},
            ph.StartDate AS PhaseStart, ${lotName} AS LotBlock, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip, l.Permit
       ${LOT_FROM} WHERE ph.StartDate >= @from AND ph.StartDate <= @to
      ORDER BY ph.StartDate, c.CustName, j.JobName, ph.Phase, ${lotOrder}`, { from, to });
  finish(res, `Lots with start date between ${from} and ${to}`,
    cols('code', 'cust', 'job', 'div', 'phase', 'phaseNum', 'phaseType', 'super1', 'super2', 'phaseStart', 'lot', 'plan', 'address', 'city', 'state', 'zip', 'permit'), rows);
}));

// JsJobLotList: every lot of a builder
router.get('/reports/builder-lots', h(async (req, res) => {
  const c = need(req.query.builderId, 'a builder');
  const [b, rows] = await Promise.all([
    query('SELECT CustName FROM JsCustomer WHERE CustID = @c', { c }),
    query(
      `SELECT TOP (${MAX_REPORT_ROWS + 1}) j.DivisionId, c.CustName, j.JobName, j.JobNum, ${lotName} AS LotBlock, pl.PlanNum, l.StartDate, l.EndDate,
              l.Address, l.City, l.State, l.Zip, l.Permit, ${lotStatus} AS Status, l.LotNotes
         ${LOT_FROM} WHERE j.CustId = @c ORDER BY j.JobName, j.DivisionId, ${lotOrder}`, { c }),
  ]);
  if (!b[0]) throw bad('Builder not found', 404);
  finish(res, `Full lot list for ${b[0].CustName}`, [
    { key: 'DivisionId', label: 'Div' }, { key: 'JobName', label: 'Job' }, { key: 'JobNum', label: 'Builder job #' }, { key: 'LotBlock', label: 'Lot/Block' },
    { key: 'PlanNum', label: 'Plan' }, { key: 'StartDate', label: 'Start date' }, { key: 'EndDate', label: 'End date' }, { key: 'Address', label: 'Address' },
    { key: 'City', label: 'City' }, { key: 'State', label: 'State' }, { key: 'Zip', label: 'Zip' }, { key: 'Permit', label: 'Permit' },
    { key: 'Status', label: 'Status' }, { key: 'LotNotes', label: 'Notes' }], rows);
}));

// JsLotPerBid: lots of one builder's job grouped by Plan-management bid
router.get('/reports/lots-per-bid', h(async (req, res) => {
  const c = need(req.query.builderId, 'a builder'), jb = need(req.query.jobId, 'a job');
  const [j, rows] = await Promise.all([
    query('SELECT j.JobName, c.CustName FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId WHERE j.JobId = @j AND j.CustId = @c', { j: jb, c }),
    query(
      `SELECT TOP (${MAX_REPORT_ROWS + 1}) j.DivisionId, c.CustName, j.JobName, ph.Phase, ct.BidNum, ${lotName} AS LotBlock, pl.PlanNum, l.StartDate, l.EndDate, l.Address, l.City, l.State, l.Zip
         ${LOT_FROM} LEFT JOIN PmContract ct ON ct.PmContractID = ph.PmContractId
        WHERE j.CustId = @c AND j.JobId = @j ORDER BY ct.BidNum, ph.Phase, ${lotOrder}`, { c, j: jb }),
  ]);
  if (!j[0]) throw bad('That job does not belong to the chosen builder', 404);
  finish(res, `Lots per bid for ${j[0].CustName} - ${j[0].JobName}`, [
    { key: 'BidNum', label: 'PM bid' }, { key: 'Phase', label: 'Phase' }, { key: 'LotBlock', label: 'Lot/Block' }, { key: 'PlanNum', label: 'Plan' },
    { key: 'StartDate', label: 'Start date' }, { key: 'EndDate', label: 'End date' }, { key: 'Address', label: 'Address' }, { key: 'City', label: 'City' },
    { key: 'State', label: 'State' }, { key: 'Zip', label: 'Zip' }], rows);
}));

// JsLotList: lots of one job with the last trim delivery date (work type 2 or 3, schedule stage 3)
router.get('/reports/job-lots', h(async (req, res) => {
  const jb = need(req.query.jobId, 'a job');
  const [j, rows] = await Promise.all([
    query('SELECT j.JobName, c.CustName FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId WHERE j.JobId = @j', { j: jb }),
    query(
      `SELECT TOP (${MAX_REPORT_ROWS + 1}) j.DivisionId, c.CustName, j.JobName, ${lotName} AS LotBlock, pl.PlanNum, l.StartDate, l.EndDate, l.Address, l.City, l.State, l.Zip,
              ${lotStatus} AS Status,
              (SELECT MAX(s.DeliveryDate) FROM JsStage s WHERE s.LotId = l.LotID AND s.WorkId IN (2,3) AND s.ScheduleStageId = 3) AS LastTrimDate
         ${LOT_FROM} WHERE l.JobId = @j ORDER BY ${lotOrder}`, { j: jb }),
  ]);
  if (!j[0]) throw bad('Job not found', 404);
  finish(res, `Full lot list for ${j[0].CustName || ''} - ${j[0].JobName}`, [
    { key: 'LotBlock', label: 'Lot/Block' }, { key: 'PlanNum', label: 'Plan' }, { key: 'StartDate', label: 'Start date' }, { key: 'EndDate', label: 'End date' },
    { key: 'Address', label: 'Address' }, { key: 'City', label: 'City' }, { key: 'State', label: 'State' }, { key: 'Zip', label: 'Zip' },
    { key: 'Status', label: 'Status' }, { key: 'LastTrimDate', label: 'Last trim date' }], rows);
}));

// ---------------------------------------------------------------------------
// Lists (Ls* maintenance forms used by Job setup)
// ---------------------------------------------------------------------------
const LISTS = {
  'job-types': {
    label: 'job type', table: 'LsJobType', idCol: 'JobTypeID', audit: false, columns: ['JobType'], order: 'JobType',
    usage: 't', uses: '(SELECT COUNT(*) FROM JsJob WHERE JobTypeId = t.JobTypeID) + (SELECT COUNT(*) FROM LsPhaseType WHERE JobTypeId = t.JobTypeID) + (SELECT COUNT(*) FROM PmJob WHERE JobTypeId = t.JobTypeID)',
    async fields(b, cur, tx) {
      const o = {};
      if (has(b, 'JobType')) o.JobType = txt(b.JobType, 50, 'Job type', { required: true });
      return o;
    },
    unique: ['JobType'],
  },
  'phase-types': {
    label: 'phase type', table: 'LsPhaseType', idCol: 'PhaseTypeID', audit: false, columns: ['PhaseType', 'JobTypeId'], order: 'JobTypeId, PhaseType',
    uses: '(SELECT COUNT(*) FROM JsPhase WHERE PhaseTypeId = t.PhaseTypeID)',
    async fields(b, cur, tx) {
      const o = {};
      if (has(b, 'PhaseType')) o.PhaseType = txt(b.PhaseType, 50, 'Phase type', { required: true });
      if (has(b, 'JobTypeId')) {
        o.JobTypeId = int(b.JobTypeId);
        if (!o.JobTypeId || !(await exists('LsJobType', 'JobTypeID', o.JobTypeId, tx))) throw bad('Choose a valid job type');
      }
      return o;
    },
    unique: ['PhaseType', 'JobTypeId'],
    lockWhenUsed: ['JobTypeId'],
  },
  superintendents: {
    label: 'superintendent', table: 'LsSuperintendent', idCol: 'SuperID', audit: true, columns: ['SuperName', 'SuperType', 'Active'], order: 'SuperType, SuperName',
    uses: '(SELECT COUNT(*) FROM JsPhase WHERE SuperId1 = t.SuperID OR SuperId2 = t.SuperID)',
    usedHint: ' Set it to inactive instead.',
    async fields(b) {
      const o = {};
      if (has(b, 'SuperName')) o.SuperName = txt(b.SuperName, 50, 'Superintendent', { required: true });
      if (has(b, 'SuperType')) o.SuperType = txt(b.SuperType, 50, 'Super type', { required: true });
      if (has(b, 'Active')) o.Active = flag(b.Active);
      return o;
    },
    unique: ['SuperName', 'SuperType'],
  },
  jurisdictions: {
    label: 'jurisdiction', table: 'LsJurisdiction', idCol: 'JurisdictionID', audit: true, columns: ['Jurisdiction', 'State'], order: 'Jurisdiction',
    uses: '(SELECT COUNT(*) FROM JsJob WHERE JurisdictionId = t.JurisdictionID) + (SELECT COUNT(*) FROM PmJob WHERE JurisdictionId = t.JurisdictionID)',
    async fields(b) {
      const o = {};
      if (has(b, 'Jurisdiction')) o.Jurisdiction = txt(b.Jurisdiction, 50, 'Jurisdiction', { required: true });
      if (has(b, 'State')) o.State = stateCode(b.State);
      return o;
    },
    unique: ['Jurisdiction'],
  },
  cities: {
    label: 'city', table: 'LsCity', idCol: 'CityID', audit: false, columns: ['City', 'State', 'CoxService'], order: 'State, City',
    // cities are stored by NAME on customers, jobs, lots and bill-to addresses
    uses: `(SELECT COUNT(*) FROM JsCustomer WHERE City = t.City AND State = t.State) + (SELECT COUNT(*) FROM JsJob WHERE City = t.City AND State = t.State)
      + (SELECT COUNT(*) FROM JsLot WHERE City = t.City AND State = t.State) + (SELECT COUNT(*) FROM JsCustomerBillAddres WHERE BillCity = t.City AND BillState = t.State)
      + (SELECT COUNT(*) FROM PmJob WHERE City = t.City AND State = t.State)`,
    async fields(b) {
      const o = {};
      if (has(b, 'City')) o.City = txt(b.City, 50, 'City', { required: true });
      if (has(b, 'State')) {
        o.State = stateCode(b.State);
        if (!o.State) throw bad('State is required');
      }
      if (has(b, 'CoxService')) o.CoxService = flag(b.CoxService);
      return o;
    },
    unique: ['City', 'State'],
    lockWhenUsed: ['City', 'State'],
  },
  'credit-ratings': {
    label: 'credit rating', table: 'LsCreditRating', idCol: 'CreditID', audit: false, columns: ['Rating'], order: 'Rating',
    uses: '(SELECT COUNT(*) FROM JsCustomer WHERE CreditId = t.CreditID)',
    async fields(b) {
      const o = {};
      if (has(b, 'Rating')) o.Rating = txt(b.Rating, 255, 'Rating', { required: true });
      return o;
    },
    unique: ['Rating'],
  },
};

function listCfg(req) {
  const cfg = LISTS[req.params.list];
  if (!cfg) throw bad('Unknown list', 404);
  return cfg;
}
async function listUsage(cfg, rid, tx) {
  const r = await query(`SELECT ${cfg.uses} AS n FROM [${cfg.table}] t WHERE t.[${cfg.idCol}] = @id`, { id: rid }, tx);
  return r[0] ? r[0].n : 0;
}
async function listUnique(cfg, merged, selfId, tx) {
  const where = cfg.unique.map((k, i) => `[${k}] = @u${i}`).join(' AND ');
  const params = { id: selfId || 0 };
  cfg.unique.forEach((k, i) => (params[`u${i}`] = merged[k]));
  const dup = await query(`SELECT 1 AS x FROM [${cfg.table}] WHERE ${where} AND [${cfg.idCol}] <> @id`, params, tx);
  if (dup.length) throw bad(`That ${cfg.label} already exists`, 409);
}

router.get('/lists/:list', h(async (req, res) => {
  const cfg = listCfg(req);
  const rows = await query(
    `SELECT t.*, ${cfg.uses} AS InUse FROM [${cfg.table}] t WHERE (@s IS NULL OR ${cfg.columns.filter((c) => c !== 'Active' && c !== 'CoxService' && c !== 'JobTypeId').map((c) => `t.[${c}] LIKE @s`).join(' OR ')})
      ORDER BY ${cfg.order}`, { s: req.query.search ? like(req.query.search) : null });
  res.json({ rows, idCol: cfg.idCol });
}));

router.post('/lists/:list', h(async (req, res) => {
  const cfg = listCfg(req);
  const newId = await withTransaction(async (tx) => {
    const o = await cfg.fields({ ...(req.body || {}) }, null, tx);
    for (const k of cfg.unique) if (o[k] == null || o[k] === '') throw bad('Fill in all required fields');
    if (cfg.table === 'LsSuperintendent' && o.Active === undefined) o.Active = 1;
    await listUnique(cfg, o, 0, tx);
    // Some Ls tables have an IDENTITY id (LsCreditRating in the sample); then let SQL Server assign it.
    const ident = await query('SELECT 1 AS x FROM sys.identity_columns WHERE object_id = OBJECT_ID(@t) AND name = @c', { t: `dbo.${cfg.table}`, c: cfg.idCol }, tx);
    if (!ident.length) return insertRow({ table: cfg.table, idCol: cfg.idCol, columns: cfg.columns, audit: cfg.audit }, o, req.user.username, tx);
    const data = { ...o };
    if (cfg.audit) { data.DateEntered = new Date(); data.UserEntered = req.user.username; }
    const keys = Object.keys(data);
    const params = {};
    keys.forEach((k, i) => (params[`v${i}`] = data[k]));
    const r = await query(`INSERT INTO [${cfg.table}] (${keys.map((k) => `[${k}]`).join(',')}) OUTPUT INSERTED.[${cfg.idCol}] AS id VALUES (${keys.map((_, i) => `@v${i}`).join(',')})`, params, tx);
    return r[0].id;
  });
  res.status(201).json({ id: newId });
}));

router.put('/lists/:list/:id', h(async (req, res) => {
  const cfg = listCfg(req);
  const rid = id(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await query(`SELECT * FROM [${cfg.table}] WHERE [${cfg.idCol}] = @id`, { id: rid }, tx);
    if (!cur[0]) throw bad(`${cfg.label[0].toUpperCase()}${cfg.label.slice(1)} not found`, 404);
    const o = await cfg.fields(req.body || {}, cur[0], tx);
    const merged = { ...cur[0], ...o };
    await listUnique(cfg, merged, rid, tx);
    for (const k of cfg.lockWhenUsed || []) {
      if (has(o, k) && o[k] !== cur[0][k] && (await listUsage(cfg, rid, tx))) {
        throw bad(`This ${cfg.label} is in use, so its ${k === 'JobTypeId' ? 'job type' : k.toLowerCase()} cannot be changed.`, 409);
      }
    }
    await updateRow({ table: cfg.table, idCol: cfg.idCol, columns: cfg.columns }, rid, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/lists/:list/:id', h(async (req, res) => {
  const cfg = listCfg(req);
  const rid = id(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await exists(cfg.table, cfg.idCol, rid, tx))) throw bad(`${cfg.label[0].toUpperCase()}${cfg.label.slice(1)} not found`, 404);
    const n = await listUsage(cfg, rid, tx);
    if (n) throw bad(`This ${cfg.label} is in use (${n} record(s)), so it cannot be deleted.${cfg.usedHint || ''}`, 409);
    await deleteRow(cfg, rid, tx);
  });
  res.json({ ok: true });
}));

module.exports = router;
