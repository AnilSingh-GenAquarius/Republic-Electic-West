// Estimating (ES) — Access SwitchES: customer → job → estimating bid setup (EsCustomer), assembly bid management (EsBid:
// plans → assemblies → "create standard packs", option packs built from assemblies), material bid management (EsJob:
// plans with the bid calculation, packs → material), transfer bid / plan / pack data to Plan management (EsTransfer*),
// master assemblies (AsGroup), inventory item pricing (EsInventoryItem), item research, job history log (EsjobLog),
// update item prices (IcUpdatePrices), update assembly item prices, and the ES reports (EsBidItem, EsJobHistoryLog,
// EsLowEstimatingPrice).
//
// Access rules reproduced:
//   * bid calculation (frmEsBidMatCalc1-3 / frmEsBidAssCalc1-3): material = qty × price for non-labor items (cost code L
//     is labor), tax and material contingency on material, labor contingency = bid contingency labor value when the plan
//     has labor, burden on labor (material calc only), then overhead, profit, wrap and discount compounding
//   * create standard packs (EstimatingCreatePack): refused when a plan of the bid has no assemblies; packs named after
//     LsStage.EsDefaultPack are created for plans that have no pack yet, unposted assembly material is summed into the
//     standard packs of the same name, and the assemblies are marked posted
//   * material item picked → estimating price = item LaborCost (labor items) or EstimatingPrice
//   * transfers: PM bid already linked to an estimating bid → refused; PM bid already has the plan number / PM plan already
//     has the pack name → refused; receiving PM bid locked → refused (plan / pack); PM material unit cost = item job cost price
//   * job history log: you cannot edit somebody else's notes
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { h, paging } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null ? null : Number(v));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const bit = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === -1 ? 1 : 0);
const str = (v, max) => { if (v == null) return null; const s = String(v).trim(); if (!s) return null; if (max && s.length > max) throw bad(`Text is too long (max ${max} characters)`); return s };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmtMoney = (n) => (Number(n) < 0 ? `($${Math.abs(r2(n)).toFixed(2)})` : `$${r2(n).toFixed(2)}`);
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,4))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,4)) END)`;
const moneyNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(n) ? 0 : n };
function moneyIn(v, label) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  if (isNaN(n)) throw bad(`${label} must be an amount`);
  return fmtMoney(n);
}
const user = (req) => req.user?.username || 'web';
const N = (v) => Number(v) || 0;

// Field specs: [column, type, max/label]. Types: s text, i whole number, n number, d date, b yes/no, m money text
function body(b, spec, label = {}) {
  const o = {};
  for (const [k, t, max] of spec) {
    if (!(k in b)) continue;
    const v = b[k], name = label[k] || k;
    if (t === 's') o[k] = str(v, max);
    else if (t === 'i') { o[k] = v === '' || v == null ? null : int(v); if (v !== '' && v != null && (o[k] == null || String(parseInt(v, 10)) !== String(v).trim())) throw bad(`${name} must be a whole number`) }
    else if (t === 'n') { o[k] = num(v); if (o[k] != null && isNaN(o[k])) throw bad(`${name} must be a number`) }
    else if (t === 'd') { o[k] = isoDate(v); if (v && !o[k]) throw bad(`${name} must be a valid date`) }
    else if (t === 'b') o[k] = bit(v);
    else if (t === 'm') o[k] = moneyIn(v, name);
  }
  return o;
}
async function patch(table, idCol, id, o, tx) {
  const keys = Object.keys(o);
  if (!keys.length) return 1;
  const r = await query(`UPDATE ${table} SET ${keys.map((k) => `[${k}] = @${k}`).join(', ')} WHERE ${idCol} = @__id; SELECT @@ROWCOUNT AS n`, { ...o, __id: id }, tx);
  return r[0]?.n ?? 0;
}
// INSERT with the given columns (column names come from code, never from the request)
async function ins(tx, table, o) {
  const keys = Object.keys(o);
  await query(`INSERT INTO ${table} (${keys.map((k) => `[${k}]`).join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`, o, tx);
}

// ---------------------------------------------------------------------------
// Lookups & pickers (SwitchES filter combos: customer → job → PM bid → PM plan; EST bid → EST plan → EST pack)
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [statuses, jobTypes, divisions, jurisdictions, packTypes, stages, works, cities, contractTypes, updateTypes, asGroups, invClasses, costCodes] = await Promise.all([
    query('SELECT StatusID AS id, Status AS name FROM LsStatus ORDER BY StatusID'),
    query('SELECT JobTypeID AS id, JobType AS name FROM LsJobType ORDER BY JobType'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query("SELECT JurisdictionID AS id, Jurisdiction + ISNULL(' (' + State + ')','') AS name FROM LsJurisdiction ORDER BY State, Jurisdiction"),
    query('SELECT PackTypeID AS id, PackType AS name FROM LsPackType ORDER BY PackType'),
    query('SELECT StageID AS id, Stage AS name, EsDefaultPack FROM LsStage ORDER BY Stage'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query('SELECT CityID AS id, City AS name, State FROM LsCity ORDER BY State, City'),
    query('SELECT TypeID AS id, [Type] AS name FROM LsContractType ORDER BY [Type]'),
    query('SELECT UpdateID AS id, UpdateType AS name FROM LsUpdateType WHERE Active = 1 ORDER BY UpdateType'),
    query('SELECT AsGroupID AS id, GroupName AS name FROM AsGroup ORDER BY GroupName'),
    query('SELECT InvClassID AS id, InvClass AS name FROM LsInvClass ORDER BY InvClass'),
    query('SELECT CostCodeId AS id, Description AS name FROM LsCostCode ORDER BY Description'),
  ]);
  res.json({ statuses, jobTypes, divisions, jurisdictions, packTypes, stages, works, cities, contractTypes, updateTypes, asGroups, invClasses, costCodes });
}));
router.get('/pick/customers', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query('SELECT TOP 300 PmCustID AS id, Customer AS name FROM PmCustomer WHERE (@s IS NULL OR Customer LIKE @s) ORDER BY Customer', { s }));
}));
router.get('/pick/jobs', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query(`SELECT TOP 300 j.PmJobID AS id, j.Job + ISNULL(' (' + j.DivisionId + ')','') + CASE WHEN @c IS NULL THEN ISNULL(' – ' + c.Customer,'') ELSE '' END AS name, j.JobNumber, j.DivisionId, j.PmCustId
     FROM PmJob j LEFT JOIN PmCustomer c ON c.PmCustID = j.PmCustId
     WHERE (@c IS NULL OR j.PmCustId = @c) AND (@s IS NULL OR j.Job LIKE @s OR c.Customer LIKE @s) ORDER BY j.Job, j.DivisionId`, { c: int(req.query.customerId), s }));
}));
router.get('/pick/bids', h(async (req, res) => {
  res.json(await query(`SELECT EsBidID AS id, 'Bid ' + ISNULL(CAST(BidNum AS nvarchar(20)),'?') + ISNULL(' – ' + RTRIM(EffectiveRelease),'') + ISNULL(' (' + CONVERT(nvarchar(10), [Date], 101) + ')','') AS name, BidNum, [Date]
     FROM EsBid WHERE PmJobId = @j ORDER BY BidNum`, { j: int(req.query.jobId) }));
}));
router.get('/pick/plans', h(async (req, res) => {
  res.json(await query(`SELECT EsPlanID AS id, ISNULL(PlanNum,'') + ISNULL(' – ' + PlanName,'') + ISNULL(' (' + CAST(SqFt AS nvarchar(20)) + ' sq ft)','') AS name, PlanNum FROM EsPlan WHERE EsBidId = @b ORDER BY PlanNum`, { b: int(req.query.bidId) }));
}));
router.get('/pick/packs', h(async (req, res) => {
  res.json(await query('SELECT EsPackID AS id, PackName AS name FROM EsPack WHERE EsPlanId = @p ORDER BY PackName', { p: int(req.query.planId) }));
}));
router.get('/pick/pm-contracts', h(async (req, res) => {
  res.json(await query(`SELECT PmContractID AS id, ISNULL(BidNum,'') + ISNULL(' ' + BidRelease,'') + ISNULL(' – ' + BidName,'') AS name, BidDate, Lock, EsBidIDLink
     FROM PmContract WHERE PmJobId = @j ORDER BY BidNum`, { j: int(req.query.jobId) }));
}));
router.get('/pick/pm-plans', h(async (req, res) => {
  res.json(await query(`SELECT PmPlanID AS id, ISNULL(PlanNum,'') + ISNULL(' – ' + PlanName,'') AS name, PlanNum FROM PmPlan WHERE PmContractId = @c ORDER BY PlanNum`, { c: int(req.query.contractId) }));
}));
router.get('/pick/items', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query(`SELECT TOP 40 i.InvItemID AS id, i.InvItem + ' – ' + ISNULL(i.Description,'') AS name, i.InvItem, i.CostCodeId, ic.InvClass, i.StatusId, i.EstimatingPrice, i.LaborCost
     FROM IcItem i LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s) ORDER BY CASE WHEN i.StatusId = 1 THEN 0 ELSE 1 END, i.InvItem`, { s }));
}));
router.get('/pick/types', h(async (req, res) => {
  res.json(await query('SELECT AsTypeID AS id, [Type] AS name FROM AsType WHERE AsGroupId = @g ORDER BY [Type]', { g: int(req.query.groupId) }));
}));
// assemblies of one type (EsSelectAssemblySub / EsSelectOptAssemblySub)
router.get('/pick/assemblies', h(async (req, res) => {
  const t = int(req.query.typeId), s = req.query.search ? `%${req.query.search}%` : null;
  if (!t && !s) return res.json([]);
  res.json(await query(`SELECT TOP 500 a.AsAssemblyID AS id, a.Name AS name, a.Description, t.[Type], g.GroupName, (SELECT COUNT(*) FROM AsMaterial m WHERE m.AsAssemblyId = a.AsAssemblyID) AS Items
     FROM AsAssembly a LEFT JOIN AsType t ON t.AsTypeID = a.AsTypeId LEFT JOIN AsGroup g ON g.AsGroupID = t.AsGroupId
     WHERE (@t IS NULL OR a.AsTypeId = @t) AND (@s IS NULL OR a.Name LIKE @s OR a.Description LIKE @s) ORDER BY g.GroupName, t.[Type], a.Name`, { t, s }));
}));
// Pack name combo: names used in Plan management (EsJobSubPack: this job's PM packs; EsBidSubOptPack: every customer)
router.get('/pick/pack-names', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null, j = int(req.query.jobId);
  res.json(await query(`SELECT TOP 60 k.PackName AS id, k.PackName AS name, MAX(t.PackType) AS PackType
     FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId JOIN PmContract pc ON pc.PmContractID = p.PmContractId LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId
     WHERE (@j IS NULL OR pc.PmJobId = @j) AND (@s IS NULL OR k.PackName LIKE @s) GROUP BY k.PackName ORDER BY k.PackName`, { j, s }));
}));
// BuilderCode combo (EsBidSubOptPack): the last builder code used for this pack name by this customer in PM
router.get('/pick/builder-code', h(async (req, res) => {
  const r = await query(`SELECT TOP 1 k.BuilderCode FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId JOIN PmContract pc ON pc.PmContractID = p.PmContractId JOIN PmJob j ON j.PmJobID = pc.PmJobId
     WHERE k.PackName = @n AND j.PmCustId = @c AND k.BuilderCode IS NOT NULL ORDER BY k.PmPackID DESC`, { n: str(req.query.packName, 100), c: int(req.query.customerId) });
  res.json({ BuilderCode: r[0]?.BuilderCode ?? null });
}));

router.get('/overview', h(async (req, res) => {
  const [counts, recent] = await Promise.all([
    query(`SELECT (SELECT COUNT(*) FROM EsBid) AS bids, (SELECT COUNT(*) FROM EsBid WHERE StatusId = 1) AS activeBids, (SELECT COUNT(*) FROM EsPlan) AS plans,
                  (SELECT COUNT(*) FROM EsPack) AS packs, (SELECT COUNT(*) FROM EsMaterial) AS material,
                  (SELECT COUNT(*) FROM EsAssembly WHERE ISNULL(Posted,0) = 0) AS unposted,
                  (SELECT COUNT(*) FROM AsAssembly) AS assemblies,
                  (SELECT COUNT(*) FROM EsBid b WHERE NOT EXISTS (SELECT 1 FROM PmContract pc WHERE pc.EsBidIDLink = b.EsBidID)) AS notTransferred,
                  (SELECT COUNT(*) FROM IcItem WHERE StatusId = 1 AND (EstimatingPrice < LastCost OR EstimatingPrice < AverageCost OR EstimatingPrice < LaborCost)) AS lowPrices`),
    query(`SELECT TOP 10 b.EsBidID, b.BidNum, b.EffectiveRelease, b.[Date], b.Estimator, b.StatusId, j.PmJobID, j.Job, j.DivisionId, c.PmCustID, c.Customer,
                  (SELECT COUNT(*) FROM EsPlan p WHERE p.EsBidId = b.EsBidID) AS Plans,
                  (SELECT TOP 1 pc.BidNum FROM PmContract pc WHERE pc.EsBidIDLink = b.EsBidID) AS PmBid
             FROM EsBid b JOIN PmJob j ON j.PmJobID = b.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId ORDER BY b.[Date] DESC, b.EsBidID DESC`),
  ]);
  res.json({ ...counts[0], recent });
}));

// ---------------------------------------------------------------------------
// Customer → job → bid setup (Access EsCustomer + EsCustomerSubJob + EsCustomerSubBid)
// ---------------------------------------------------------------------------
router.get('/customers', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, st: int(req.query.statusId), offset: pg.offset, pageSize: pg.pageSize };
  const where = 'WHERE (@s IS NULL OR c.Customer LIKE @s) AND (@st IS NULL OR c.StatusId = @st)';
  const [rows, total] = await Promise.all([
    query(`SELECT c.PmCustID, c.Customer, c.StatusId, st.Status, c.Notes, (SELECT COUNT(*) FROM PmJob j WHERE j.PmCustId = c.PmCustID) AS Jobs,
                  (SELECT COUNT(*) FROM EsBid b JOIN PmJob j ON j.PmJobID = b.PmJobId WHERE j.PmCustId = c.PmCustID) AS Bids
             FROM PmCustomer c LEFT JOIN LsStatus st ON st.StatusID = c.StatusId ${where} ORDER BY c.Customer OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM PmCustomer c ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [c, jobs, bids] = await Promise.all([
    query('SELECT c.*, st.Status FROM PmCustomer c LEFT JOIN LsStatus st ON st.StatusID = c.StatusId WHERE c.PmCustID = @id', { id }),
    query(`SELECT j.*, jt.JobType, st.Status, js.Jurisdiction, (SELECT COUNT(*) FROM EsBid b WHERE b.PmJobId = j.PmJobID) AS Bids
             FROM PmJob j LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId LEFT JOIN LsJurisdiction js ON js.JurisdictionID = j.JurisdictionId
            WHERE j.PmCustId = @id ORDER BY j.PmJobID`, { id }),
    query(`SELECT b.*, st.Status, (SELECT COUNT(*) FROM EsPlan p WHERE p.EsBidId = b.EsBidID) AS Plans,
                  (SELECT TOP 1 ISNULL(pc.BidNum,'') + ISNULL(' ' + pc.BidRelease,'') FROM PmContract pc WHERE pc.EsBidIDLink = b.EsBidID) AS PmBid
             FROM EsBid b JOIN PmJob j ON j.PmJobID = b.PmJobId LEFT JOIN LsStatus st ON st.StatusID = b.StatusId WHERE j.PmCustId = @id ORDER BY b.BidNum`, { id }),
  ]);
  if (!c[0]) return res.status(404).json({ error: 'Customer not found' });
  res.json({ customer: c[0], jobs, bids });
}));
function custBody(b, partial) {
  const o = {};
  if (!partial || 'Customer' in b) { o.Customer = str(b.Customer, 50); if (!o.Customer) throw bad('Enter the customer name') }
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  return o;
}
router.post('/customers', h(async (req, res) => {
  const o = custBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if ((await query('SELECT 1 FROM PmCustomer WHERE Customer = @n', { n: o.Customer }, tx))[0]) throw bad('A customer with this name already exists', 409);
    const nid = await nextId(tx, 'PmCustomer', 'PmCustID');
    await ins(tx, 'PmCustomer', { PmCustID: nid, Customer: o.Customer, Notes: o.Notes ?? null, StatusId: o.StatusId, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id), o = custBody(req.body || {}, true);
  if (o.Customer && (await query('SELECT 1 FROM PmCustomer WHERE Customer = @n AND PmCustID <> @id', { n: o.Customer, id }))[0]) throw bad('A customer with this name already exists', 409);
  if (!(await patch('PmCustomer', 'PmCustID', id, o))) return res.status(404).json({ error: 'Customer not found' });
  res.json({ ok: true });
}));
router.delete('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const j = await query('SELECT COUNT(*) AS n FROM PmJob WHERE PmCustId = @id', { id });
  if (j[0].n) throw bad(`This customer has ${j[0].n} job(s). Delete the jobs first.`, 409);
  const r = await query('DELETE FROM PmCustomer WHERE PmCustID = @id; SELECT @@ROWCOUNT AS n', { id });
  if (!r[0].n) return res.status(404).json({ error: 'Customer not found' });
  res.json({ ok: true });
}));

const JOB_SPEC = [['Job', 's', 50], ['JobNumber', 's', 50], ['SpecLevel', 's', 255], ['DivisionId', 's', 50], ['JobTypeId', 'i'], ['JurisdictionId', 'i'], ['Address', 's', 255],
  ['City', 's', 50], ['State', 's', 2], ['Zip', 's', 255], ['EstStartDate', 'd'], ['EstEndDate', 'd'], ['UnitQty', 'i'], ['Notes', 's', 255], ['Template', 'b'], ['StatusId', 'i']];
const JOB_LABEL = { EstStartDate: 'Est start date', EstEndDate: 'Est end date', UnitQty: 'Unit qty', State: 'State' };
function jobBody(b, partial) {
  const o = body(b, JOB_SPEC, JOB_LABEL);
  if (o.State) { o.State = o.State.toUpperCase(); if (!/^[A-Z]{2}$/.test(o.State)) throw bad('State must be 2 letters') }
  if (!partial || 'Job' in b) if (!o.Job) throw bad('Enter the job name');
  if (!partial || 'DivisionId' in b) if (!o.DivisionId) throw bad('Choose the division');
  if (!partial || 'JobTypeId' in b) if (!o.JobTypeId) throw bad('Choose the job type');
  if (!partial) { o.StatusId = o.StatusId || 1; o.Template = o.Template ?? 0 }
  return o;
}
router.post('/customers/:id/jobs', h(async (req, res) => {
  const cust = int(req.params.id), o = jobBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmCustomer WHERE PmCustID = @c', { c: cust }, tx))[0]) throw bad('Customer not found', 404);
    if ((await query('SELECT 1 FROM PmJob WHERE PmCustId = @c AND Job = @j AND DivisionId = @d', { c: cust, j: o.Job, d: o.DivisionId }, tx))[0]) throw bad('This customer already has a job with this name in that division', 409);
    const nid = await nextId(tx, 'PmJob', 'PmJobID');
    await ins(tx, 'PmJob', { PmJobID: nid, PmCustId: cust, ...o, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id), o = jobBody(req.body || {}, true);
  if (!(await patch('PmJob', 'PmJobID', id, o))) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true });
}));
router.delete('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const u = (await query(`SELECT (SELECT COUNT(*) FROM EsBid WHERE PmJobId = @id) AS es, (SELECT COUNT(*) FROM PmContract WHERE PmJobId = @id) AS pm,
                                 (SELECT COUNT(*) FROM JsJob WHERE PmJobId = @id) AS js, (SELECT COUNT(*) FROM CmContract WHERE PmJobId = @id) AS cm`, { id }))[0];
  if (u.es) throw bad(`This job has ${u.es} estimating bid(s). Delete the bids first.`, 409);
  if (u.pm) throw bad(`This job has ${u.pm} Plan management bid(s) and cannot be deleted here.`, 409);
  if (u.js) throw bad('This job is linked to a job in Job setup / Scheduling and cannot be deleted.', 409);
  if (u.cm) throw bad('This job has job history log entries and cannot be deleted.', 409);
  const r = await query('DELETE FROM PmJob WHERE PmJobID = @id; SELECT @@ROWCOUNT AS n', { id });
  if (!r[0].n) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true });
}));

// estimating bid (EsBid table; same fields on EsCustomerSubBid, EsBid and EsJob)
const BID_SPEC = [['Date', 'd'], ['BidNum', 'i'], ['EffectiveRelease', 's', 50], ['EffectiveDate', 'd'], ['Recipient', 's', 50], ['Estimator', 's', 50],
  ['TaxPercent', 'n'], ['ContMatPercent', 'n'], ['ContLaborValue', 'm'], ['BurdenLabor', 'n'], ['OverheadPercent', 'n'], ['ProfitPercent', 'n'], ['WrapPercent', 'n'], ['Discount', 'n'],
  ['LtFixtureSupplier', 's', 50], ['GearSupplier', 's', 50], ['RoughPiecePrice', 'n'], ['TrimPiecePrice', 'n'],
  ['RecCanTrimType', 's', 255], ['RecCanTrimLoc', 's', 255], ['HalfHot', 's', 255], ['MasterBed', 's', 255], ['SecondaryBed', 's', 255], ['FloWrap', 's', 255], ['FloStrip', 's', 255], ['Switch', 's', 255],
  ['Receptacle', 's', 50], ['AlarmPlug', 's', 50], ['WaterSoftLoop', 's', 50], ['RecircPump', 's', 50], ['Dimmer', 's', 50], ['GarageCoachLight', 's', 50], ['Chime', 's', 255],
  ['DoorbellPushButton', 's', 50], ['AddressLight', 's', 50], ['CeilingFanPrewireLoc', 's', 50], ['PhoneWireType', 's', 50], ['PhoneStdLoc', 's', 255], ['TvWireType', 's', 50], ['TvStdLoc', 's', 255],
  ['SecurityAlarm', 's', 50], ['StructuredWiring', 's', 50], ['OtherLowVolt', 's', 255], ['BidQuestions', 's', 255], ['NotesPrivate', 's', 255], ['StatusId', 'i']];
const BID_LABEL = { Date: 'Bid date', BidNum: 'Bid number', EffectiveDate: 'Effective date', TaxPercent: 'Tax %', ContMatPercent: 'Contingency material %', ContLaborValue: 'Contingency labor',
  BurdenLabor: 'Burden %', OverheadPercent: 'Overhead %', ProfitPercent: 'Profit %', WrapPercent: 'Wrap %', Discount: 'Discount %', RoughPiecePrice: 'Rough piece price', TrimPiecePrice: 'Trim piece price' };
function bidBody(b, partial) {
  const o = body(b, BID_SPEC, BID_LABEL);
  if (!partial || 'BidNum' in b) if (o.BidNum == null) throw bad('Enter the bid number');
  if (!partial) { o.Date = o.Date || new Date().toISOString().slice(0, 10); o.StatusId = o.StatusId || 1; if (o.ContLaborValue == null) o.ContLaborValue = '$0.00' }
  return o;
}
router.post('/jobs/:id/bids', h(async (req, res) => {
  const job = int(req.params.id), o = bidBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmJob WHERE PmJobID = @j', { j: job }, tx))[0]) throw bad('Job not found', 404);
    if ((await query('SELECT 1 FROM EsBid WHERE PmJobId = @j AND BidNum = @n', { j: job, n: o.BidNum }, tx))[0]) throw bad('This job already has an estimating bid with this number', 409);
    const nid = await nextId(tx, 'EsBid', 'EsBidID');
    await ins(tx, 'EsBid', { EsBidID: nid, PmJobId: job, ...o, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/bids/:id', h(async (req, res) => {
  const id = int(req.params.id), o = bidBody(req.body || {}, true);
  if (o.BidNum != null && (await query('SELECT 1 FROM EsBid a JOIN EsBid b ON b.PmJobId = a.PmJobId WHERE a.EsBidID = @id AND b.EsBidID <> @id AND b.BidNum = @n', { id, n: o.BidNum }))[0]) throw bad('This job already has an estimating bid with this number', 409);
  if (!(await patch('EsBid', 'EsBidID', id, o))) return res.status(404).json({ error: 'Bid not found' });
  res.json({ ok: true });
}));
router.delete('/bids/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const u = (await query('SELECT (SELECT COUNT(*) FROM EsPlan WHERE EsBidId = @id) AS plans, (SELECT COUNT(*) FROM PmContract WHERE EsBidIDLink = @id) AS pm', { id }))[0];
  if (u.plans) throw bad(`This bid has ${u.plans} plan(s). Delete the plans first.`, 409);
  if (u.pm) throw bad('This bid was transferred to Plan management (a PM bid is linked to it) and cannot be deleted.', 409);
  const r = await query('DELETE FROM EsBid WHERE EsBidID = @id; SELECT @@ROWCOUNT AS n', { id });
  if (!r[0].n) return res.status(404).json({ error: 'Bid not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Bid calculation (frmEsBidMatCalc1-3 = standard packs' material; frmEsBidAssCalc1-3 = the plan's assemblies, no burden)
// ---------------------------------------------------------------------------
function calc(bid, row, withBurden) {
  if (!row) return null;
  const Mat = N(row.Mat), Labor = N(row.Labor);
  const MatTax = Mat * N(bid.TaxPercent) / 100;
  const MatCont = (Mat + MatTax) * N(bid.ContMatPercent) / 100;
  const LaborCont = row.HasLabor ? moneyNum(bid.ContLaborValue) : 0;
  const Burden = withBurden ? (Labor + LaborCont) * N(bid.BurdenLabor) / 100 : 0;
  const Basic = Mat + MatTax + MatCont + Labor + LaborCont + Burden;
  const oh = N(bid.OverheadPercent) / 100, pr = N(bid.ProfitPercent) / 100, wr = N(bid.WrapPercent) / 100, ds = N(bid.Discount) / 100;
  const OH = Basic * oh, Profit = Basic * (1 + oh) * pr, Wrap = Basic * (1 + oh) * (1 + pr) * wr, Disc = Basic * (1 + oh) * (1 + pr) * (1 + wr) * ds;
  return { Mat, MatTax, MatCont, Labor, LaborCont, Burden, Basic, OH, Profit, Wrap, Disc, Total: Basic + OH + Profit + Wrap - Disc };
}
const IS_L = "i.CostCodeId LIKE 'L'";
async function planCalcs(where, params) {
  const [mat, asm] = await Promise.all([
    query(`SELECT p.EsPlanID, SUM(CASE WHEN ${IS_L} THEN 0 ELSE k.Quantity * m.Quantity * m.EstimatingPrice END) AS Mat,
                  SUM(CASE WHEN ${IS_L} THEN k.Quantity * m.Quantity * m.EstimatingPrice ELSE 0 END) AS Labor, MAX(CASE WHEN ${IS_L} THEN 1 ELSE 0 END) AS HasLabor
             FROM EsPlan p JOIN EsPack k ON k.EsPlanId = p.EsPlanID JOIN EsMaterial m ON m.EsPackdId = k.EsPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
            WHERE ${where} AND k.PackTypeId = 1 GROUP BY p.EsPlanID`, params),
    query(`SELECT p.EsPlanID, SUM(CASE WHEN ${IS_L} THEN 0 ELSE a.Qty * am.Quantity * am.EstimatingPrice END) AS Mat,
                  SUM(CASE WHEN ${IS_L} THEN a.Qty * am.Quantity * am.EstimatingPrice ELSE 0 END) AS Labor, MAX(CASE WHEN ${IS_L} THEN 1 ELSE 0 END) AS HasLabor
             FROM EsPlan p JOIN EsAssembly a ON a.EsPlanId = p.EsPlanID JOIN AsAssembly aa ON aa.AsAssemblyID = a.AsAssemblyId JOIN AsMaterial am ON am.AsAssemblyId = aa.AsAssemblyID
             JOIN IcItem i ON i.InvItemID = am.InvItemId WHERE ${where} GROUP BY p.EsPlanID`, params),
  ]);
  return { mat: new Map(mat.map((r) => [r.EsPlanID, r])), asm: new Map(asm.map((r) => [r.EsPlanID, r])) };
}
async function bidHeader(id, tx) {
  return (await query(`SELECT b.*, ${MV('b.ContLaborValue')} AS ContLaborValueNum, st.Status, j.PmJobID, j.Job, j.JobNumber, j.JobTypeId, jt.JobType, j.SpecLevel, j.JurisdictionId, j.DivisionId, j.Address, j.City, j.State, j.Zip,
                  j.EstStartDate, j.EstEndDate, j.UnitQty, j.Notes AS JobNotes, j.Template, j.StatusId AS JobStatusId, c.PmCustID, c.Customer, c.Notes AS CustomerNotes,
                  (SELECT TOP 1 pc.PmContractID FROM PmContract pc WHERE pc.EsBidIDLink = b.EsBidID) AS PmContractID,
                  (SELECT TOP 1 ISNULL(pc.BidNum,'') + ISNULL(' ' + pc.BidRelease,'') FROM PmContract pc WHERE pc.EsBidIDLink = b.EsBidID) AS PmBid
             FROM EsBid b JOIN PmJob j ON j.PmJobID = b.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
             LEFT JOIN LsStatus st ON st.StatusID = b.StatusId WHERE b.EsBidID = @id`, { id }, tx))[0];
}
// Bid header (frmEsBid / EsJob record source) + plans with both calculations
router.get('/bids/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const bid = await bidHeader(id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  const [plans, calcs] = await Promise.all([
    query(`SELECT p.*, ${MV('p.ContractVal')} AS ContractValNum, ${MV('p.ContractValAdj')} AS ContractValAdjNum, st.Status,
                  (SELECT COUNT(*) FROM EsPack k WHERE k.EsPlanId = p.EsPlanID) AS Packs,
                  (SELECT COUNT(*) FROM EsAssembly a WHERE a.EsPlanId = p.EsPlanID) AS Assemblies,
                  (SELECT COUNT(*) FROM EsAssembly a WHERE a.EsPlanId = p.EsPlanID AND ISNULL(a.Posted,0) = 0) AS Unposted
             FROM EsPlan p LEFT JOIN LsStatus st ON st.StatusID = p.StatusId WHERE p.EsBidId = @id ORDER BY p.PlanNum`, { id }),
    planCalcs('p.EsBidId = @id', { id }),
  ]);
  for (const p of plans) {
    p.matCalc = calc(bid, calcs.mat.get(p.EsPlanID), true);
    p.asmCalc = calc(bid, calcs.asm.get(p.EsPlanID), false);
    // EsJobSubPlan "Total" = basic + overhead + profit + wrap − discount + plan adjust
    p.PlanTotal = p.matCalc ? p.matCalc.Total + N(p.ContractValAdjNum) : null;
  }
  res.json({ bid, plans });
}));

// ---------------------------------------------------------------------------
// Plans (EsBidSubPlan / EsJobSubPlan)
// ---------------------------------------------------------------------------
const PLAN_SPEC = [['PlanNum', 's', 50], ['PlanName', 's', 50], ['Universal', 'b'], ['Bedrooms', 's', 255], ['ACunits', 's', 255], ['SqFt', 'i'], ['GearSize', 's', 255], ['GearType', 's', 255],
  ['GearPower', 'b'], ['RiserLoc', 's', 255], ['Island', 's', 255], ['FloorPlug', 's', 255], ['Detached', 's', 255], ['TvOutletQty', 's', 255], ['TvCanType', 's', 255], ['PhOutletQty', 's', 255],
  ['PhCanType', 's', 255], ['AC1WireBrkr', 's', 255], ['AC2WireBrkr', 's', 255], ['AC3WireBrkr', 's', 255], ['OvenWireBrkr', 's', 255], ['OvenType', 's', 255], ['OvenLoc', 's', 255],
  ['CooktopWireBrkr', 's', 255], ['ElectricDryer', 's', 255], ['ContractValAdj', 'm'], ['ContractVal', 'm'], ['StatusId', 'i']];
function planBody(b, partial) {
  const o = body(b, PLAN_SPEC, { SqFt: 'Sq ft', ContractValAdj: 'Plan adjust', ContractVal: 'Contract value' });
  if (!partial || 'PlanNum' in b) if (!o.PlanNum) throw bad('Enter the plan number');
  if (o.SqFt != null && o.SqFt < 0) throw bad('Sq ft must be a whole number');
  if (!partial) { o.StatusId = o.StatusId || 1; o.ContractVal = o.ContractVal ?? '$0.00'; o.ContractValAdj = o.ContractValAdj ?? '$0.00'; o.Universal = o.Universal ?? 0; o.GearPower = o.GearPower ?? 0 }
  return o;
}
router.post('/bids/:id/plans', h(async (req, res) => {
  const bidId = int(req.params.id), o = planBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsBid WHERE EsBidID = @b', { b: bidId }, tx))[0]) throw bad('Bid not found', 404);
    if ((await query('SELECT 1 FROM EsPlan WHERE EsBidId = @b AND PlanNum = @n', { b: bidId, n: o.PlanNum }, tx))[0]) throw bad('This bid already has a plan with this number', 409);
    const nid = await nextId(tx, 'EsPlan', 'EsPlanID');
    await ins(tx, 'EsPlan', { EsPlanID: nid, EsBidId: bidId, ...o, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id), o = planBody(req.body || {}, true);
  if (o.PlanNum && (await query('SELECT 1 FROM EsPlan a JOIN EsPlan b ON b.EsBidId = a.EsBidId WHERE a.EsPlanID = @id AND b.EsPlanID <> @id AND b.PlanNum = @n', { id, n: o.PlanNum }))[0]) throw bad('This bid already has a plan with this number', 409);
  if (!(await patch('EsPlan', 'EsPlanID', id, o))) return res.status(404).json({ error: 'Plan not found' });
  res.json({ ok: true });
}));
router.delete('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPlan WHERE EsPlanID = @id', { id }, tx))[0]) throw bad('Plan not found', 404);
    const k = await query('SELECT COUNT(*) AS n FROM EsPack WHERE EsPlanId = @id', { id }, tx);
    if (k[0].n) throw bad(`This plan has ${k[0].n} pack(s). Delete the packs first.`, 409);
    const a = await query('DELETE FROM EsAssembly WHERE EsPlanId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    await query('DELETE FROM EsPlan WHERE EsPlanID = @id', { id }, tx);
    return { assemblies: a[0].n };
  });
  res.json({ ok: true, ...out });
}));

// plan detail: assemblies (EsBidSubAssembly), assembly cost by cost code (EsBidSubPlanCalc), packs (EsBidSubOptPack / EsJobSubPack)
router.get('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const plan = (await query('SELECT p.*, b.PmJobId, j.PmCustId FROM EsPlan p JOIN EsBid b ON b.EsBidID = p.EsBidId JOIN PmJob j ON j.PmJobID = b.PmJobId WHERE p.EsPlanID = @id', { id }))[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const [assemblies, byCode, packs] = await Promise.all([
    query(`SELECT a.EsAssemblyID, a.AsAssemblyId, aa.Name AS Assembly, aa.Description, t.[Type], g.GroupName, a.Qty, a.Posted, a.DateEntered, a.UserEntered,
                  (SELECT SUM(am.Quantity * am.EstimatingPrice) FROM AsMaterial am WHERE am.AsAssemblyId = a.AsAssemblyId) AS UnitValue
             FROM EsAssembly a LEFT JOIN AsAssembly aa ON aa.AsAssemblyID = a.AsAssemblyId LEFT JOIN AsType t ON t.AsTypeID = aa.AsTypeId LEFT JOIN AsGroup g ON g.AsGroupID = t.AsGroupId
            WHERE a.EsPlanId = @id ORDER BY aa.Name`, { id }),
    query(`SELECT i.CostCodeId, cc.Description AS CostCode, SUM(CASE WHEN ${IS_L} THEN 0 ELSE a.Qty * am.Quantity * am.EstimatingPrice END) AS MaterialCost,
                  SUM(CASE WHEN ${IS_L} THEN 0 ELSE a.Qty * am.Quantity * am.EstimatingPrice * b.TaxPercent / 100 END) AS MaterialTax,
                  SUM(CASE WHEN ${IS_L} THEN a.Qty * am.Quantity * am.EstimatingPrice ELSE 0 END) AS LaborCost
             FROM EsAssembly a JOIN EsPlan p ON p.EsPlanID = a.EsPlanId JOIN EsBid b ON b.EsBidID = p.EsBidId JOIN AsMaterial am ON am.AsAssemblyId = a.AsAssemblyId
             JOIN IcItem i ON i.InvItemID = am.InvItemId LEFT JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId
            WHERE a.EsPlanId = @id GROUP BY i.CostCodeId, cc.Description ORDER BY i.CostCodeId`, { id }),
    query(`SELECT k.EsPackID, k.PackName, k.PackTypeId, t.PackType, k.BuilderCode, k.Quantity, ${MV('k.ContractVal')} AS ContractVal, k.Notes, k.StatusId, st.Status,
                  (SELECT COUNT(*) FROM EsMaterial m WHERE m.EsPackdId = k.EsPackID) AS Items,
                  (SELECT SUM(m.Quantity * m.EstimatingPrice) FROM EsMaterial m WHERE m.EsPackdId = k.EsPackID) AS Value
             FROM EsPack k LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId LEFT JOIN LsStatus st ON st.StatusID = k.StatusId
            WHERE k.EsPlanId = @id ORDER BY t.PackType, k.PackName`, { id }),
  ]);
  res.json({ plan, assemblies, byCode, packs });
}));

// ---------------------------------------------------------------------------
// Plan assemblies (EsSelectAssembly → qrySelectAssemblyAppend; EsBidSubAssembly)
// The Access selection used shared AsAssembly.TempSelect/UserSelect flags; the web posts the selection directly.
// ---------------------------------------------------------------------------
function selection(b) {
  const items = (Array.isArray(b?.items) ? b.items : []).map((x) => ({ id: int(x.AsAssemblyId ?? x.id), qty: x.Qty === '' || x.Qty == null ? 0 : int(x.Qty) })).filter((x) => x.id);
  if (!items.length) throw bad('Select at least one assembly');
  if (items.length > 500) throw bad('Too many assemblies at once (max 500)');
  if (items.some((x) => x.qty == null || x.qty < 0)) throw bad('Quantities must be whole numbers');
  return items;
}
router.post('/plans/:id/assemblies', h(async (req, res) => {
  const id = int(req.params.id), items = selection(req.body);
  const n = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPlan WHERE EsPlanID = @id', { id }, tx))[0]) throw bad('Plan not found', 404);
    let nid = await nextId(tx, 'EsAssembly', 'EsAssemblyID');
    for (const x of items) {
      if (!(await query('SELECT 1 FROM AsAssembly WHERE AsAssemblyID = @a', { a: x.id }, tx))[0]) throw bad('Assembly not found', 404);
      await ins(tx, 'EsAssembly', { EsAssemblyID: nid++, EsPlanId: id, AsAssemblyId: x.id, Qty: x.qty, Posted: 0, DateEntered: new Date(), UserEntered: user(req) });
    }
    return items.length;
  });
  res.status(201).json({ added: n });
}));
router.put('/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = body(b, [['Qty', 'i'], ['AsAssemblyId', 'i']], { Qty: 'Quantity' });
  if ('Qty' in o && (o.Qty == null || o.Qty < 0)) throw bad('Quantity must be a whole number');
  if ('AsAssemblyId' in b && !o.AsAssemblyId) throw bad('Choose the assembly');
  if (!(await patch('EsAssembly', 'EsAssemblyID', id, o))) return res.status(404).json({ error: 'Assembly line not found' });
  res.json({ ok: true });
}));
router.delete('/assemblies/:id', h(async (req, res) => {
  const r = await query('DELETE FROM EsAssembly WHERE EsAssemblyID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) });
  if (!r[0].n) return res.status(404).json({ error: 'Assembly line not found' });
  res.json({ ok: true });
}));

// Create standard packs (macro EstimatingCreatePack: qryEsBidCheckPlanEmpty → qryEsBidPackCreate → qryEsBidPackItemCreate → qryEsBidPackPost)
router.post('/bids/:id/create-packs', h(async (req, res) => {
  const id = int(req.params.id), who = user(req);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsBid WHERE EsBidID = @id', { id }, tx))[0]) throw bad('Bid not found', 404);
    const empty = await query('SELECT p.PlanNum FROM EsPlan p WHERE p.EsBidId = @id AND NOT EXISTS (SELECT 1 FROM EsAssembly a WHERE a.EsPlanId = p.EsPlanID) ORDER BY p.PlanNum', { id }, tx);
    if (empty.length) throw bad(`Process ended as there is a plan with no assemblies (${empty.map((p) => p.PlanNum).join(', ')}). Add assemblies to the plan or delete the plan and then try again.`, 409);
    // packs: plans with unposted assemblies and no pack at all, one per LsStage.EsDefaultPack of the assembly material stages
    const newPacks = await query(`SELECT p.EsPlanID, s.EsDefaultPack FROM EsPlan p JOIN EsAssembly a ON a.EsPlanId = p.EsPlanID JOIN AsMaterial am ON am.AsAssemblyId = a.AsAssemblyId JOIN LsStage s ON s.StageID = am.StageId
       WHERE p.EsBidId = @id AND ISNULL(a.Posted,0) = 0 AND NOT EXISTS (SELECT 1 FROM EsPack k WHERE k.EsPlanId = p.EsPlanID) AND s.EsDefaultPack IS NOT NULL
       GROUP BY p.EsPlanID, s.EsDefaultPack ORDER BY p.EsPlanID, s.EsDefaultPack`, { id }, tx);
    let kid = newPacks.length ? await nextId(tx, 'EsPack', 'EsPackID') : 0;
    for (const k of newPacks) await ins(tx, 'EsPack', { EsPackID: kid++, EsPlanId: k.EsPlanID, PackName: k.EsDefaultPack, PackTypeId: 1, Quantity: 1, StatusId: 1, ContractVal: '$0.00', DateEntered: new Date(), UserEntered: who });
    // material: unposted assembly material summed into the standard pack named after the stage's default pack
    const mats = await query(`SELECT k.EsPackID, am.InvItemId, SUM(a.Qty * am.Quantity) AS Qty, am.EstimatingPrice, am.StageId, am.WorkId, am.ToggleNoChange
       FROM EsPlan p JOIN EsAssembly a ON a.EsPlanId = p.EsPlanID JOIN AsAssembly aa ON aa.AsAssemblyID = a.AsAssemblyId JOIN AsMaterial am ON am.AsAssemblyId = aa.AsAssemblyID
       JOIN LsStage s ON s.StageID = am.StageId JOIN EsPack k ON k.EsPlanId = p.EsPlanID AND k.PackName = s.EsDefaultPack
       WHERE p.EsBidId = @id AND ISNULL(a.Posted,0) = 0 AND k.PackTypeId = 1
       GROUP BY k.EsPackID, am.InvItemId, am.EstimatingPrice, am.StageId, am.WorkId, am.ToggleNoChange ORDER BY k.EsPackID, am.InvItemId`, { id }, tx);
    let mid = mats.length ? await nextId(tx, 'EsMaterial', 'EsBidItemID') : 0;
    for (const m of mats) await ins(tx, 'EsMaterial', { EsBidItemID: mid++, EsPackdId: m.EsPackID, InvItemId: m.InvItemId, Quantity: m.Qty, EstimatingPrice: m.EstimatingPrice, StageId: m.StageId, WorkId: m.WorkId, NoChange: m.ToggleNoChange ?? 0, StatusId: 1, UserEntered: who });
    const posted = await query('UPDATE a SET a.Posted = 1 FROM EsAssembly a JOIN EsPlan p ON p.EsPlanID = a.EsPlanId WHERE p.EsBidId = @id AND ISNULL(a.Posted,0) = 0; SELECT @@ROWCOUNT AS n', { id }, tx);
    return { packs: newPacks.length, material: mats.length, posted: posted[0].n };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Packs (EsBidSubOptPack / EsJobSubPack) and pack material (EsBidSubOptPackMaterialSub / EsJobSubMaterial)
// ---------------------------------------------------------------------------
const PACK_SPEC = [['PackName', 's', 100], ['PackTypeId', 'i'], ['BuilderCode', 's', 50], ['Quantity', 'i'], ['ContractVal', 'm'], ['Notes', 's', 255], ['StatusId', 'i']];
function packBody(b, partial) {
  const o = body(b, PACK_SPEC, { Quantity: 'Pack quantity', ContractVal: 'Contract value' });
  if (!partial || 'PackName' in b) if (!o.PackName) throw bad('Enter the pack name');
  if (!partial || 'PackTypeId' in b) if (!o.PackTypeId) throw bad('Choose the pack type');
  if (o.Quantity != null && o.Quantity < 0) throw bad('Pack quantity must be a whole number');
  if (!partial) { o.Quantity = o.Quantity ?? 1; o.StatusId = o.StatusId || 1; o.ContractVal = o.ContractVal ?? '$0.00' }
  return o;
}
router.post('/plans/:id/packs', h(async (req, res) => {
  const pid = int(req.params.id), o = packBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPlan WHERE EsPlanID = @p', { p: pid }, tx))[0]) throw bad('Plan not found', 404);
    if ((await query('SELECT 1 FROM EsPack WHERE EsPlanId = @p AND PackName = @n', { p: pid, n: o.PackName }, tx))[0]) throw bad('This plan already has a pack with this name', 409);
    const nid = await nextId(tx, 'EsPack', 'EsPackID');
    await ins(tx, 'EsPack', { EsPackID: nid, EsPlanId: pid, ...o, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id), o = packBody(req.body || {}, true);
  if (o.PackName && (await query('SELECT 1 FROM EsPack a JOIN EsPack b ON b.EsPlanId = a.EsPlanId WHERE a.EsPackID = @id AND b.EsPackID <> @id AND b.PackName = @n', { id, n: o.PackName }))[0]) throw bad('This plan already has a pack with this name', 409);
  if (!(await patch('EsPack', 'EsPackID', id, o))) return res.status(404).json({ error: 'Pack not found' });
  res.json({ ok: true });
}));
router.delete('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPack WHERE EsPackID = @id', { id }, tx))[0]) throw bad('Pack not found', 404);
    const m = await query('DELETE FROM EsMaterial WHERE EsPackdId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    await query('DELETE FROM EsPack WHERE EsPackID = @id', { id }, tx);
    return { material: m[0].n };
  });
  res.json({ ok: true, ...out });
}));
router.get('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [pack, material] = await Promise.all([
    query(`SELECT k.*, ${MV('k.ContractVal')} AS ContractValNum, t.PackType, p.PlanNum, p.PlanName, p.EsBidId, b.BidNum, j.Job, c.Customer
             FROM EsPack k JOIN EsPlan p ON p.EsPlanID = k.EsPlanId JOIN EsBid b ON b.EsBidID = p.EsBidId JOIN PmJob j ON j.PmJobID = b.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId
             LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId WHERE k.EsPackID = @id`, { id }),
    query(`SELECT m.EsBidItemID, m.InvItemId, i.InvItem, i.Description, i.CostCodeId, i.StatusId AS ItemStatusId, m.Quantity, m.EstimatingPrice, m.Quantity * m.EstimatingPrice AS ExtPrice,
                  m.StageId, s.Stage, m.WorkId, w.WorkType, m.NoChange, m.Notes, m.StatusId, st.Status, m.UserEntered
             FROM EsMaterial m LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId LEFT JOIN LsStage s ON s.StageID = m.StageId LEFT JOIN LsWork w ON w.WorkID = m.WorkId LEFT JOIN LsStatus st ON st.StatusID = m.StatusId
            WHERE m.EsPackdId = @id ORDER BY i.InvItem, m.Quantity`, { id }),
  ]);
  if (!pack[0]) return res.status(404).json({ error: 'Pack not found' });
  const t = material.reduce((a, m) => { const x = N(m.ExtPrice); if (m.CostCodeId === 'L') a.labor += x; else a.material += x; return a }, { labor: 0, material: 0 });
  res.json({ pack: pack[0], material, totals: { ...t, total: t.labor + t.material } });
}));

// Add assembly material to a pack (EsSelectOptAssembly → qrySelectOptAssemblyTemp + qrySelectOptAssemblyAppend):
// quantity × assembly material quantity, summed per item / price / stage / work / no-change / status
router.post('/packs/:id/assemblies', h(async (req, res) => {
  const id = int(req.params.id), items = selection(req.body).filter((x) => x.qty > 0);
  if (!items.length) throw bad('Enter a quantity for at least one assembly');
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPack WHERE EsPackID = @id', { id }, tx))[0]) throw bad('Pack not found', 404);
    const params = {};
    const values = items.map((x, i) => { params[`a${i}`] = x.id; params[`q${i}`] = x.qty; return `(@a${i}, @q${i})` }).join(', ');
    const mats = await query(`SELECT am.InvItemId, SUM(s.Qty * am.Quantity) AS Qty, am.EstimatingPrice, am.StageId, am.WorkId, am.ToggleNoChange, am.StatusId
       FROM (VALUES ${values}) AS s(AsAssemblyId, Qty) JOIN AsMaterial am ON am.AsAssemblyId = s.AsAssemblyId
       GROUP BY am.InvItemId, am.EstimatingPrice, am.StageId, am.WorkId, am.ToggleNoChange, am.StatusId ORDER BY am.InvItemId`, params, tx);
    let mid = mats.length ? await nextId(tx, 'EsMaterial', 'EsBidItemID') : 0;
    for (const m of mats) await ins(tx, 'EsMaterial', { EsBidItemID: mid++, EsPackdId: id, InvItemId: m.InvItemId, Quantity: m.Qty, EstimatingPrice: m.EstimatingPrice, StageId: m.StageId, WorkId: m.WorkId, NoChange: m.ToggleNoChange ?? 0, StatusId: m.StatusId, UserEntered: user(req) });
    return { material: mats.length };
  });
  res.status(201).json(out);
}));

// EsJobSubMaterial InvItemId AfterUpdate: estimating price = LaborCost (cost code L) or the item's EstimatingPrice
async function itemPrice(tx, itemId) {
  const i = (await query('SELECT InvItemID, InvItem, CostCodeId, LaborCost, EstimatingPrice, StatusId FROM IcItem WHERE InvItemID = @id', { id: itemId }, tx))[0];
  if (!i) throw bad('Inventory item not found');
  return { item: i, price: Number((i.CostCodeId === 'L' ? i.LaborCost : i.EstimatingPrice) || 0) };
}
const MAT_SPEC = [['InvItemId', 'i'], ['Quantity', 'i'], ['EstimatingPrice', 'n'], ['StageId', 'i'], ['WorkId', 'i'], ['NoChange', 'b'], ['Notes', 's', 255], ['StatusId', 'i']];
function matBody(b, partial) {
  const o = body(b, MAT_SPEC, { Quantity: 'Quantity', EstimatingPrice: 'Estimating price' });
  if (!partial || 'InvItemId' in b) if (!o.InvItemId) throw bad('Choose the inventory item');
  if (!partial || 'Quantity' in b) if (o.Quantity == null) throw bad('Quantity must be a whole number');
  if (!partial || 'StageId' in b) if (!o.StageId) throw bad('Choose the stage');
  if (!partial || 'WorkId' in b) if (!o.WorkId) throw bad('Choose the type of work');
  if (o.EstimatingPrice != null && o.EstimatingPrice < 0) throw bad('Estimating price must be a positive number');
  if ('EstimatingPrice' in o && o.EstimatingPrice == null) delete o.EstimatingPrice;
  if (!partial) { o.StatusId = o.StatusId || 1; o.NoChange = o.NoChange ?? 0 }
  return o;
}
router.post('/packs/:id/material', h(async (req, res) => {
  const pk = int(req.params.id), o = matBody(req.body || {}, false);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM EsPack WHERE EsPackID = @p', { p: pk }, tx))[0]) throw bad('Pack not found', 404);
    const pr = await itemPrice(tx, o.InvItemId);
    const nid = await nextId(tx, 'EsMaterial', 'EsBidItemID');
    const row = { EsBidItemID: nid, EsPackdId: pk, ...o, EstimatingPrice: o.EstimatingPrice ?? pr.price, UserEntered: user(req) };
    await ins(tx, 'EsMaterial', row);
    return { id: nid, EstimatingPrice: row.EstimatingPrice, inactive: pr.item.StatusId === 2 };
  });
  res.status(201).json(out);
}));
router.put('/material/:id', h(async (req, res) => {
  const id = int(req.params.id), o = matBody(req.body || {}, true);
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT InvItemId FROM EsMaterial WHERE EsBidItemID = @id', { id }, tx))[0];
    if (!cur) throw bad('Material line not found', 404);
    if (o.InvItemId && o.InvItemId !== cur.InvItemId && !('EstimatingPrice' in o)) o.EstimatingPrice = (await itemPrice(tx, o.InvItemId)).price;
    await patch('EsMaterial', 'EsBidItemID', id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/material/:id', h(async (req, res) => {
  const r = await query('DELETE FROM EsMaterial WHERE EsBidItemID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) });
  if (!r[0].n) return res.status(404).json({ error: 'Material line not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Transfer to Plan management (macros EsTransferBid / EsTransferPlan / EsTransferPack and their qryEsTransfer* queries).
// Access matched the new PM plans / packs back by PlanNum / PackName; here every copied row is mapped one-to-one.
// ---------------------------------------------------------------------------
const yesText = (v) => { const s = String(v ?? '').trim().toLowerCase(); if (!s) return 0; if (['yes', 'y', 'true', '-1', 'x'].includes(s)) return 1; const n = Number(s); return !isNaN(n) && n !== 0 ? 1 : 0 };
async function packToPm(tx, esPackId, pmPlanId, who) {
  const k = (await query('SELECT * FROM EsPack WHERE EsPackID = @id', { id: esPackId }, tx))[0];
  const nid = await nextId(tx, 'PmPack', 'PmPackID');
  await ins(tx, 'PmPack', { PmPackID: nid, PmPlanId: pmPlanId, PackName: k.PackName, PackTypeId: k.PackTypeId, BuilderCode: k.BuilderCode, Quantity: k.Quantity, ContractVal: k.ContractVal, Notes: k.Notes,
    StatusId: k.StatusId, TruedUp: 0, Verified: 0, Substitution: 0, DateEntered: new Date(), UserEntered: who });
  // qryEsTransfer*Material: unit cost = item job cost price, estimating price copied (inner join on IcItem like Access)
  const mats = await query(`SELECT m.*, i.JobCostPrice FROM EsMaterial m JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE m.EsPackdId = @id ORDER BY m.EsBidItemID`, { id: esPackId }, tx);
  let mid = mats.length ? await nextId(tx, 'PmMaterial', 'PmMatID') : 0;
  for (const m of mats) {
    await ins(tx, 'PmMaterial', { PmMatID: mid++, PmPackId: nid, InvItemId: m.InvItemId, Quantity: m.Quantity, UnitCost: m.JobCostPrice, EstimatingPrice: m.EstimatingPrice, StageId: m.StageId, WorkId: m.WorkId,
      NoChange: m.NoChange, Notes: m.Notes, StatusId: m.StatusId, DateEntered: new Date(), UserEntered: who });
  }
  return { packId: nid, material: mats.length };
}
async function planToPm(tx, esPlanId, pmContractId, who) {
  const p = (await query('SELECT * FROM EsPlan WHERE EsPlanID = @id', { id: esPlanId }, tx))[0];
  const nid = await nextId(tx, 'PmPlan', 'PmPlanID');
  await ins(tx, 'PmPlan', { PmPlanID: nid, PmContractId: pmContractId, PlanNum: p.PlanNum, PlanName: p.PlanName, Bedrooms: p.Bedrooms, ACunits: yesText(p.ACunits), SqFt: p.SqFt, TvOutlet: p.TvOutletQty,
    Island: p.Island, FloorPlug: p.FloorPlug, Detached: p.Detached, Universal: p.Universal, ContractVal: p.ContractVal, StatusId: p.StatusId, DateEntered: new Date(), UserEntered: who });
  const packs = await query('SELECT EsPackID FROM EsPack WHERE EsPlanId = @id ORDER BY EsPackID', { id: esPlanId }, tx);
  let material = 0;
  for (const k of packs) material += (await packToPm(tx, k.EsPackID, nid, who)).material;
  return { planId: nid, packs: packs.length, material };
}
async function pmContract(tx, id) {
  const c = (await query('SELECT PmContractID, PmJobId, Lock, EsBidIDLink, BidNum FROM PmContract WHERE PmContractID = @id', { id }, tx))[0];
  if (!c) throw bad('Plan management bid not found', 404);
  return c;
}
const LOCKED = 'Bid receiving plan is locked, cannot transfer plan data. Please contact the contract manager.';
const OTHER_JOB = 'The Plan management bid belongs to a different job than the estimating bid. Choose a PM bid of the same job.';
router.post('/transfer/bid', h(async (req, res) => {
  const esBidId = int(req.body?.esBidId), pmId = int(req.body?.pmContractId);
  if (!esBidId) throw bad('Choose the EST bid');
  if (!pmId) throw bad('Choose the PM bid');
  const out = await withTransaction(async (tx) => {
    const pc = await pmContract(tx, pmId);
    const es = (await query('SELECT EsBidID, PmJobId FROM EsBid WHERE EsBidID = @id', { id: esBidId }, tx))[0];
    if (!es) throw bad('Estimating bid not found', 404);
    if (pc.EsBidIDLink != null) throw bad('Receiving Plan Management bid is already linked to an Estimating bid. Unable to transfer data.', 409);
    if (pc.PmJobId !== es.PmJobId) throw bad(OTHER_JOB);
    if (pc.Lock) throw bad(LOCKED, 409);
    const plans = await query('SELECT EsPlanID, PlanNum FROM EsPlan WHERE EsBidId = @id ORDER BY PlanNum', { id: esBidId }, tx);
    if (!plans.length) throw bad('The estimating bid has no plans to transfer');
    const dup = await query('SELECT p.PlanNum FROM PmPlan p WHERE p.PmContractId = @c AND p.PlanNum IN (SELECT PlanNum FROM EsPlan WHERE EsBidId = @b)', { c: pmId, b: esBidId }, tx);
    if (dup.length) throw bad(`Receiving PM bid already has plan(s) ${dup.map((d) => d.PlanNum).join(', ')}. Unable to transfer data.`, 409);
    await query('UPDATE PmContract SET EsBidIDLink = @b WHERE PmContractID = @c', { b: esBidId, c: pmId }, tx);
    const r = { plans: 0, packs: 0, material: 0 };
    for (const p of plans) { const x = await planToPm(tx, p.EsPlanID, pmId, user(req)); r.plans++; r.packs += x.packs; r.material += x.material }
    return r;
  });
  res.json(out);
}));
router.post('/transfer/plan', h(async (req, res) => {
  const esPlanId = int(req.body?.esPlanId), pmId = int(req.body?.pmContractId);
  if (!esPlanId) throw bad('Choose the EST plan');
  if (!pmId) throw bad('Choose the PM bid');
  const out = await withTransaction(async (tx) => {
    const pc = await pmContract(tx, pmId);
    const es = (await query('SELECT p.EsPlanID, p.PlanNum, b.EsBidID, b.PmJobId FROM EsPlan p JOIN EsBid b ON b.EsBidID = p.EsBidId WHERE p.EsPlanID = @id', { id: esPlanId }, tx))[0];
    if (!es) throw bad('Estimating plan not found', 404);
    if (pc.PmJobId !== es.PmJobId) throw bad(OTHER_JOB);
    if ((await query('SELECT 1 FROM PmPlan WHERE PmContractId = @c AND PlanNum = @n', { c: pmId, n: es.PlanNum }, tx))[0]) throw bad('Receiving PM bid has already got a plan with this PlanNum, change the PM PlanNum description and try again. Unable to transfer data.', 409);
    if (pc.Lock) throw bad(LOCKED, 409);
    // qryEsTransferPlan1Bid: link the PM bid to the estimating bid when it isn't linked yet
    await query('UPDATE PmContract SET EsBidIDLink = @b WHERE PmContractID = @c AND EsBidIDLink IS NULL', { b: es.EsBidID, c: pmId }, tx);
    return planToPm(tx, esPlanId, pmId, user(req));
  });
  res.json(out);
}));
router.post('/transfer/pack', h(async (req, res) => {
  const esPackId = int(req.body?.esPackId), pmPlanId = int(req.body?.pmPlanId);
  if (!esPackId) throw bad('Choose the EST pack');
  if (!pmPlanId) throw bad('Choose the PM plan');
  const out = await withTransaction(async (tx) => {
    const pp = (await query('SELECT PmPlanID, PmContractId FROM PmPlan WHERE PmPlanID = @id', { id: pmPlanId }, tx))[0];
    if (!pp) throw bad('Plan management plan not found', 404);
    const pc = await pmContract(tx, pp.PmContractId);
    const es = (await query('SELECT k.EsPackID, k.PackName, b.PmJobId FROM EsPack k JOIN EsPlan p ON p.EsPlanID = k.EsPlanId JOIN EsBid b ON b.EsBidID = p.EsBidId WHERE k.EsPackID = @id', { id: esPackId }, tx))[0];
    if (!es) throw bad('Estimating pack not found', 404);
    if (pc.PmJobId !== es.PmJobId) throw bad(OTHER_JOB);
    if ((await query('SELECT 1 FROM PmPack WHERE PmPlanId = @p AND PackName = @n', { p: pmPlanId, n: es.PackName }, tx))[0]) throw bad('Receiving PM plan has already got a pack with this name, change the PM pack name and try again. Unable to transfer data.', 409);
    if (pc.Lock) throw bad('Bid receiving pack is locked, cannot transfer pack data. Please contact the contract manager.', 409);
    return packToPm(tx, esPackId, pmPlanId, user(req));
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Switchboard actions
// ---------------------------------------------------------------------------
// Update item prices (macro IcUpdatePrices; the low estimating price report is shown afterwards by the client)
router.post('/update-item-prices', h(async (req, res) => {
  const out = await withTransaction(async (tx) => {
    const jc = await query(`UPDATE IcItem SET JobCostPrice = CASE WHEN CostCodeId = 'L' THEN LaborCost ELSE AverageCost END WHERE JobCostPriceUpdateId IN (1, 2); SELECT @@ROWCOUNT AS n`, {}, tx);
    const es = await query('UPDATE IcItem SET EstimatingPrice = JobCostPrice * ((EstimatingPriceMkUp / 100.0) + 1) WHERE EstimatingPriceUpdateId IN (1, 2); SELECT @@ROWCOUNT AS n', {}, tx);
    const pb = await query(`UPDATE IcItem SET VipPrice = JobCostPrice * ((VipPriceMkUp / 100.0) + 1), ResidentialPoPrice = JobCostPrice * ((ResidentialPoPriceMkUp / 100.0) + 1),
                                  RetailPrice = JobCostPrice * ((RetailPriceMkUp / 100.0) + 1); SELECT @@ROWCOUNT AS n`, {}, tx);
    return { jobCost: jc[0].n, estimating: es[0].n, priceBook: pb[0].n };
  });
  res.json(out);
}));
// Update assembly item prices (qryAsItemPriceUpdate)
router.post('/update-assembly-prices', h(async (req, res) => {
  const r = await query(`UPDATE am SET am.EstimatingPrice = CASE WHEN i.CostCodeId = 'L' THEN i.LaborCost ELSE i.EstimatingPrice END
     FROM AsMaterial am JOIN IcItem i ON i.InvItemID = am.InvItemId; SELECT @@ROWCOUNT AS n`);
  res.json({ updated: r[0].n });
}));

// ---------------------------------------------------------------------------
// Inventory item (EsInventoryItem: estimating prices and mark-ups; most item fields are read-only here)
// ---------------------------------------------------------------------------
router.get('/items', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, c: int(req.query.classId), st: int(req.query.statusId), offset: pg.offset, pageSize: pg.pageSize };
  const where = 'WHERE (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s) AND (@c IS NULL OR i.InvClassId = @c) AND (@st IS NULL OR i.StatusId = @st)';
  const [rows, total] = await Promise.all([
    query(`SELECT i.InvItemID, i.InvItem, i.Description, ic.InvClass, i.CostCodeId, i.LastCost, i.AverageCost, i.LaborCost, i.JobCostPrice, i.EstimatingPrice, i.EstimatingPriceMkUp, i.StatusId, st.Status
             FROM IcItem i LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId LEFT JOIN LsStatus st ON st.StatusID = i.StatusId ${where}
            ORDER BY ic.InvClass, i.InvItem OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM IcItem i ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/items/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const r = await query(`SELECT i.*, ic.InvClass, v.Vendor, u.UnitOfMeasure, s.Stage AS DefaultStage, w.WorkType AS DefaultWork, cc.Description AS CostCode, st.Status,
                ju.UpdateType AS JobCostUpdate, eu.UpdateType AS EstimatingUpdate
           FROM IcItem i LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId LEFT JOIN IcVendor v ON v.VendorID = i.VendorId LEFT JOIN LsUom u ON u.Uom = i.Uom
           LEFT JOIN LsStage s ON s.StageID = i.DefaultStageId LEFT JOIN LsWork w ON w.WorkID = i.DefaultWorkId LEFT JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId
           LEFT JOIN LsStatus st ON st.StatusID = i.StatusId LEFT JOIN LsUpdateType ju ON ju.UpdateID = i.JobCostPriceUpdateId LEFT JOIN LsUpdateType eu ON eu.UpdateID = i.EstimatingPriceUpdateId
          WHERE i.InvItemID = @id`, { id });
  if (!r[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(r[0]);
}));
// Editable on EsInventoryItem: description, notes, estimating price, the four mark-ups and the two update types.
// Mark-up LostFocus macros: estimating mark-up (update type < 3) re-prices estimating / VIP / resi-PO / retail from the job cost
// price; with update type 3 (manual) the price book prices follow the estimating price. Each other mark-up re-prices its own price.
router.put('/items/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const o = body(b, [['Description', 's', 250], ['Notes', 's', 255], ['EstimatingPrice', 'n'], ['EstimatingPriceMkUp', 'i'], ['VipPriceMkUp', 'i'], ['ResidentialPoPriceMkUp', 'i'], ['RetailPriceMkUp', 'i'],
    ['JobCostPriceUpdateId', 'i'], ['EstimatingPriceUpdateId', 'i']], { EstimatingPrice: 'Estimating price', EstimatingPriceMkUp: 'Estimating mark-up (%)', VipPriceMkUp: 'VIP mark-up (%)', ResidentialPoPriceMkUp: 'Resi-PO mark-up (%)', RetailPriceMkUp: 'Retail mark-up (%)' });
  if (o.EstimatingPrice != null && o.EstimatingPrice < 0) throw bad('Estimating price must be a positive number');
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT * FROM IcItem WHERE InvItemID = @id', { id }, tx))[0];
    if (!cur) throw bad('Item not found', 404);
    const v = { ...cur, ...o };
    const jc = N(v.JobCostPrice), changed = (k) => k in o && o[k] !== cur[k];
    if (changed('EstimatingPriceMkUp')) {
      if (N(v.EstimatingPriceUpdateId) < 3) {
        o.EstimatingPrice = jc * (1 + N(v.EstimatingPriceMkUp) / 100);
        o.VipPrice = jc * (1 + N(v.VipPriceMkUp) / 100); o.ResidentialPoPrice = jc * (1 + N(v.ResidentialPoPriceMkUp) / 100); o.RetailPrice = jc * (1 + N(v.RetailPriceMkUp) / 100);
      } else if (N(v.EstimatingPriceUpdateId) === 3) {
        const ep = N(o.EstimatingPrice ?? cur.EstimatingPrice);
        o.VipPrice = ep * (1 + N(v.VipPriceMkUp) / 100); o.ResidentialPoPrice = ep * (1 + N(v.ResidentialPoPriceMkUp) / 100); o.RetailPrice = ep * (1 + N(v.RetailPriceMkUp) / 100);
      }
    }
    if (changed('VipPriceMkUp')) o.VipPrice = jc * (1 + N(v.VipPriceMkUp) / 100);
    if (changed('ResidentialPoPriceMkUp')) o.ResidentialPoPrice = jc * (1 + N(v.ResidentialPoPriceMkUp) / 100);
    if (changed('RetailPriceMkUp')) o.RetailPrice = jc * (1 + N(v.RetailPriceMkUp) / 100);
    await patch('IcItem', 'InvItemID', id, o, tx);
  });
  res.json({ ok: true });
}));
// Item research (ItemResearch / EsInventoryItemSubResearch: description contains the words; ItemResearchSubPo: cost / vendor of picked items)
router.get('/research', h(async (req, res) => {
  const s = str(req.query.search, 100);
  if (!s) return res.json([]);
  res.json(await query(`SELECT TOP 500 i.InvItemID, ic.InvClass, i.InvItem, i.Description, i.StatusId FROM IcItem i JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE CHARINDEX(@s, i.Description) > 0 ORDER BY ic.InvClass, i.InvItem`, { s }));
}));
router.get('/research/po', h(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(int).filter(Boolean).slice(0, 100);
  if (!ids.length) return res.json([]);
  const params = {}; ids.forEach((v, i) => (params[`i${i}`] = v));
  res.json(await query(`SELECT i.InvItemID, i.InvItem, i.Description, i.AverageCost, i.LastCost, i.LastPurchase, v.Vendor, i.PartNum
     FROM IcItem i LEFT JOIN IcVendor v ON v.VendorID = i.VendorId WHERE i.InvItemID IN (${ids.map((_, i) => `@i${i}`).join(', ')}) ORDER BY i.InvItem`, params));
}));

// ---------------------------------------------------------------------------
// Master assemblies (AsGroup → AsGroupSubType → AsGroupSubAssembly → AsGroupSubMaterial)
// ---------------------------------------------------------------------------
router.get('/as/groups', h(async (req, res) => {
  res.json(await query(`SELECT g.AsGroupID, g.GroupName, (SELECT COUNT(*) FROM AsType t WHERE t.AsGroupId = g.AsGroupID) AS Types,
     (SELECT COUNT(*) FROM AsAssembly a JOIN AsType t ON t.AsTypeID = a.AsTypeId WHERE t.AsGroupId = g.AsGroupID) AS Assemblies FROM AsGroup g ORDER BY g.GroupName`));
}));
const nameIn = (v, max, what) => { const s = str(v, max); if (!s) throw bad(`Enter the ${what}`); return s };
router.post('/as/groups', h(async (req, res) => {
  const n = nameIn(req.body?.GroupName, 50, 'group name');
  const id = await withTransaction(async (tx) => {
    if ((await query('SELECT 1 FROM AsGroup WHERE GroupName = @n', { n }, tx))[0]) throw bad('A group with this name already exists', 409);
    const nid = await nextId(tx, 'AsGroup', 'AsGroupID');
    await ins(tx, 'AsGroup', { AsGroupID: nid, GroupName: n });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/as/groups/:id', h(async (req, res) => {
  const id = int(req.params.id), n = nameIn(req.body?.GroupName, 50, 'group name');
  if ((await query('SELECT 1 FROM AsGroup WHERE GroupName = @n AND AsGroupID <> @id', { n, id }))[0]) throw bad('A group with this name already exists', 409);
  if (!(await patch('AsGroup', 'AsGroupID', id, { GroupName: n }))) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
}));
router.delete('/as/groups/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const t = await query('SELECT COUNT(*) AS n FROM AsType WHERE AsGroupId = @id', { id });
  if (t[0].n) throw bad(`This group has ${t[0].n} assembly type(s). Delete them first.`, 409);
  const r = await query('DELETE FROM AsGroup WHERE AsGroupID = @id; SELECT @@ROWCOUNT AS n', { id });
  if (!r[0].n) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
}));
router.get('/as/groups/:id/types', h(async (req, res) => {
  res.json(await query('SELECT t.AsTypeID, t.AsGroupId, t.[Type], (SELECT COUNT(*) FROM AsAssembly a WHERE a.AsTypeId = t.AsTypeID) AS Assemblies FROM AsType t WHERE t.AsGroupId = @id ORDER BY t.[Type]', { id: int(req.params.id) }));
}));
router.post('/as/groups/:id/types', h(async (req, res) => {
  const g = int(req.params.id), n = nameIn(req.body?.Type, 100, 'assembly type');
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM AsGroup WHERE AsGroupID = @g', { g }, tx))[0]) throw bad('Group not found', 404);
    if ((await query('SELECT 1 FROM AsType WHERE AsGroupId = @g AND [Type] = @n', { g, n }, tx))[0]) throw bad('This group already has a type with this name', 409);
    const nid = await nextId(tx, 'AsType', 'AsTypeID');
    await ins(tx, 'AsType', { AsTypeID: nid, AsGroupId: g, Type: n });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/as/types/:id', h(async (req, res) => {
  const id = int(req.params.id), n = nameIn(req.body?.Type, 100, 'assembly type');
  if (!(await patch('AsType', 'AsTypeID', id, { Type: n }))) return res.status(404).json({ error: 'Type not found' });
  res.json({ ok: true });
}));
router.delete('/as/types/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const a = await query('SELECT COUNT(*) AS n FROM AsAssembly WHERE AsTypeId = @id', { id });
  if (a[0].n) throw bad(`This type has ${a[0].n} assemblies. Delete them first.`, 409);
  const r = await query('DELETE FROM AsType WHERE AsTypeID = @id; SELECT @@ROWCOUNT AS n', { id });
  if (!r[0].n) return res.status(404).json({ error: 'Type not found' });
  res.json({ ok: true });
}));
router.get('/as/types/:id/assemblies', h(async (req, res) => {
  res.json(await query(`SELECT a.AsAssemblyID, a.AsTypeId, a.Name, a.Description, a.Notes, (SELECT COUNT(*) FROM AsMaterial m WHERE m.AsAssemblyId = a.AsAssemblyID) AS Items,
     (SELECT SUM(m.Quantity * m.EstimatingPrice) FROM AsMaterial m WHERE m.AsAssemblyId = a.AsAssemblyID) AS Value,
     (SELECT COUNT(*) FROM EsAssembly e WHERE e.AsAssemblyId = a.AsAssemblyID) AS Used
     FROM AsAssembly a WHERE a.AsTypeId = @id ORDER BY a.Name`, { id: int(req.params.id) }));
}));
const ASM_SPEC = [['Name', 's', 150], ['Description', 's', 150], ['Notes', 's', 255], ['AsTypeId', 'i']];
router.post('/as/types/:id/assemblies', h(async (req, res) => {
  const t = int(req.params.id), o = body(req.body || {}, ASM_SPEC);
  if (!o.Name) throw bad('Enter the assembly name');
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM AsType WHERE AsTypeID = @t', { t }, tx))[0]) throw bad('Type not found', 404);
    const nid = await nextId(tx, 'AsAssembly', 'AsAssemblyID');
    await ins(tx, 'AsAssembly', { AsAssemblyID: nid, ...o, AsTypeId: t, TempSelect: 0, TempSelectNum: 0, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/as/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = body(b, ASM_SPEC);
  if ('Name' in b && !o.Name) throw bad('Enter the assembly name');
  if ('AsTypeId' in b && !o.AsTypeId) throw bad('Choose the assembly type');
  if (!(await patch('AsAssembly', 'AsAssemblyID', id, o))) return res.status(404).json({ error: 'Assembly not found' });
  res.json({ ok: true });
}));
router.delete('/as/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM AsAssembly WHERE AsAssemblyID = @id', { id }, tx))[0]) throw bad('Assembly not found', 404);
    const u = await query('SELECT COUNT(*) AS n FROM EsAssembly WHERE AsAssemblyId = @id', { id }, tx);
    if (u[0].n) throw bad(`This assembly is used on ${u[0].n} estimating plan line(s) and cannot be deleted.`, 409);
    const m = await query('DELETE FROM AsMaterial WHERE AsAssemblyId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    await query('DELETE FROM AsAssembly WHERE AsAssemblyID = @id', { id }, tx);
    return { material: m[0].n };
  });
  res.json({ ok: true, ...out });
}));
router.get('/as/assemblies/:id/material', h(async (req, res) => {
  res.json(await query(`SELECT m.AsMaterialID, m.InvItemId, i.InvItem, i.Description, i.CostCodeId, m.Quantity, m.EstimatingPrice, m.Quantity * m.EstimatingPrice AS ExtPrice,
     m.StageId, s.Stage, m.WorkId, w.WorkType, m.StatusId, st.Status, m.ToggleNoChange, m.Notes
     FROM AsMaterial m LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId LEFT JOIN LsStage s ON s.StageID = m.StageId LEFT JOIN LsWork w ON w.WorkID = m.WorkId LEFT JOIN LsStatus st ON st.StatusID = m.StatusId
     WHERE m.AsAssemblyId = @id ORDER BY s.Stage, i.InvItem`, { id: int(req.params.id) }));
}));
const ASMAT_SPEC = [['InvItemId', 'i'], ['Quantity', 'i'], ['EstimatingPrice', 'n'], ['StageId', 'i'], ['WorkId', 'i'], ['StatusId', 'i'], ['ToggleNoChange', 'b'], ['Notes', 's', 255]];
function asMatBody(b, partial) {
  const o = body(b, ASMAT_SPEC, { EstimatingPrice: 'Estimating price' });
  if (!partial || 'InvItemId' in b) if (!o.InvItemId) throw bad('Choose the inventory item');
  if (!partial || 'Quantity' in b) if (o.Quantity == null) throw bad('Quantity must be a whole number');
  if (o.EstimatingPrice != null && o.EstimatingPrice < 0) throw bad('Estimating price must be a positive number');
  if ('EstimatingPrice' in o && o.EstimatingPrice == null) delete o.EstimatingPrice;
  return o;
}
// AsGroupSubMaterial InvItemId AfterUpdate: estimating price = the item's EstimatingPrice
router.post('/as/assemblies/:id/material', h(async (req, res) => {
  const a = int(req.params.id), o = asMatBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM AsAssembly WHERE AsAssemblyID = @a', { a }, tx))[0]) throw bad('Assembly not found', 404);
    const it = (await query('SELECT EstimatingPrice, DefaultStageId, DefaultWorkId FROM IcItem WHERE InvItemID = @i', { i: o.InvItemId }, tx))[0];
    if (!it) throw bad('Inventory item not found');
    const nid = await nextId(tx, 'AsMaterial', 'AsMaterialID');
    await ins(tx, 'AsMaterial', { AsMaterialID: nid, AsAssemblyId: a, ...o, EstimatingPrice: o.EstimatingPrice ?? it.EstimatingPrice, StageId: o.StageId ?? it.DefaultStageId, WorkId: o.WorkId ?? it.DefaultWorkId,
      StatusId: o.StatusId || 1, ToggleNoChange: o.ToggleNoChange ?? 0, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/as/material/:id', h(async (req, res) => {
  const id = int(req.params.id), o = asMatBody(req.body || {}, true);
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT InvItemId FROM AsMaterial WHERE AsMaterialID = @id', { id }, tx))[0];
    if (!cur) throw bad('Material line not found', 404);
    if (o.InvItemId && o.InvItemId !== cur.InvItemId && !('EstimatingPrice' in o)) {
      const it = (await query('SELECT EstimatingPrice FROM IcItem WHERE InvItemID = @i', { i: o.InvItemId }, tx))[0];
      if (!it) throw bad('Inventory item not found');
      o.EstimatingPrice = it.EstimatingPrice;
    }
    await patch('AsMaterial', 'AsMaterialID', id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/as/material/:id', h(async (req, res) => {
  const r = await query('DELETE FROM AsMaterial WHERE AsMaterialID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) });
  if (!r[0].n) return res.status(404).json({ error: 'Material line not found' });
  res.json({ ok: true });
}));
// Set default values (qryAssemblyMaterialSetDefault + qryAssemblyMaterialSetPrice)
router.post('/as/set-defaults', h(async (req, res) => {
  const out = await withTransaction(async (tx) => {
    const d = await query(`UPDATE am SET am.StageId = i.DefaultStageId, am.WorkId = i.DefaultWorkId, am.StatusId = 1, am.EstimatingPrice = i.EstimatingPrice
       FROM AsMaterial am JOIN IcItem i ON i.InvItemID = am.InvItemId WHERE am.StageId IS NULL AND am.WorkId IS NULL AND am.StatusId IS NULL AND am.EstimatingPrice IS NULL; SELECT @@ROWCOUNT AS n`, {}, tx);
    const p = await query('UPDATE am SET am.EstimatingPrice = i.EstimatingPrice FROM AsMaterial am JOIN IcItem i ON i.InvItemID = am.InvItemId WHERE am.EstimatingPrice IS NULL; SELECT @@ROWCOUNT AS n', {}, tx);
    return { defaults: d[0].n, prices: p[0].n };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Job history log (EsjobLog + EsJobLogSubNotes on CmContract)
// ---------------------------------------------------------------------------
router.get('/joblog/jobs', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query(`SELECT TOP 200 j.PmJobID, j.Job, j.DivisionId, j.JobNumber, c.Customer, (SELECT COUNT(*) FROM CmContract n WHERE n.PmJobId = j.PmJobID) AS Entries
     FROM PmJob j LEFT JOIN PmCustomer c ON c.PmCustID = j.PmCustId WHERE (@s IS NULL OR j.Job LIKE @s OR c.Customer LIKE @s OR j.JobNumber LIKE @s) ORDER BY j.Job`, { s }));
}));
async function jobInfo(id) {
  return (await query(`SELECT j.*, c.Customer, c.Notes AS CustomerNotes, jt.JobType, js.Jurisdiction + ISNULL(', ' + js.State,'') AS Juris, st.Status
     FROM PmJob j LEFT JOIN PmCustomer c ON c.PmCustID = j.PmCustId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN LsJurisdiction js ON js.JurisdictionID = j.JurisdictionId
     LEFT JOIN LsStatus st ON st.StatusID = j.StatusId WHERE j.PmJobID = @id`, { id }))[0];
}
const LOG_COLS = `n.CmContractID, n.PmJobId, n.TypeId, t.[Type], n.ContractNumber, n.WorkAgreeNum, n.AddendumNumber, n.Description, n.EffectivePhase, n.EffectiveDate, n.Executed, n.Notes, n.ContractEntry, n.DateEntered, n.UserEntered`;
router.get('/jobs/:id/log', h(async (req, res) => {
  const id = int(req.params.id);
  const job = await jobInfo(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const entries = await query(`SELECT ${LOG_COLS} FROM CmContract n LEFT JOIN LsContractType t ON t.TypeID = n.TypeId WHERE n.PmJobId = @id ORDER BY n.DateEntered, n.UserEntered, n.CmContractID`, { id });
  res.json({ job, entries });
}));
const LOG_SPEC = [['TypeId', 'i'], ['Description', 's', 255], ['EffectivePhase', 's', 255], ['EffectiveDate', 'd'], ['Notes', 's', 255]];
router.post('/jobs/:id/log', h(async (req, res) => {
  const job = int(req.params.id), o = body(req.body || {}, LOG_SPEC, { EffectiveDate: 'Effective date' });
  if (!o.Description && !o.Notes) throw bad('Enter a title or notes');
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmJob WHERE PmJobID = @j', { j: job }, tx))[0]) throw bad('Job not found', 404);
    const nid = await nextId(tx, 'CmContract', 'CmContractID');
    await ins(tx, 'CmContract', { CmContractID: nid, PmJobId: job, ...o, ContractEntry: 0, DateEntered: new Date(), UserEntered: user(req) });
    return nid;
  });
  res.status(201).json({ id });
}));
// EsJobLogSubNotes OnDirty: "You cannot edit somebody else's notes. Please create your own."
async function ownEntry(tx, id, who) {
  const n = (await query('SELECT CmContractID, UserEntered FROM CmContract WHERE CmContractID = @id', { id }, tx))[0];
  if (!n) throw bad('Log entry not found', 404);
  if (n.UserEntered != null && n.UserEntered !== who) throw bad("You cannot edit somebody else's notes. Please create your own.", 403);
}
router.put('/log/:id', h(async (req, res) => {
  const id = int(req.params.id), o = body(req.body || {}, LOG_SPEC, { EffectiveDate: 'Effective date' });
  await withTransaction(async (tx) => { await ownEntry(tx, id, user(req)); await patch('CmContract', 'CmContractID', id, o, tx) });
  res.json({ ok: true });
}));
router.delete('/log/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => { await ownEntry(tx, id, user(req)); await query('DELETE FROM CmContract WHERE CmContractID = @id', { id }, tx) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
// Bid full detail (EsBidItem ← rptEsBidItem01/02/03): every material line of the bid with its share of tax, contingency,
// burden, overhead, profit, wrap and discount; plan totals; bid total includes the contingency labor total.
router.get('/reports/bid-detail', h(async (req, res) => {
  const id = int(req.query.bidId);
  if (!id) throw bad('Choose an estimating bid');
  const head = (await query(`SELECT c.Customer, j.Job, b.EsBidID, b.[Date] AS BidDate, b.BidNum, b.Recipient, b.Estimator, b.ContLaborValue, b.BurdenLabor, b.OverheadPercent, b.ProfitPercent,
       b.WrapPercent, b.Discount, b.TaxPercent, b.ContMatPercent FROM EsBid b JOIN PmJob j ON j.PmJobID = b.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId WHERE b.EsBidID = @id`, { id }))[0];
  if (!head) return res.status(404).json({ error: 'Bid not found' });
  const rows = await query(`SELECT p.EsPlanID, p.PlanNum, p.PlanName, k.EsPackID, k.PackName, k.Notes AS PackNotes, k.PackTypeId, i.InvItemID, i.CostCodeId, i.InvItem, ISNULL(m.Notes, i.InvItem) AS QuotedItem,
       i.Description, m.Quantity, k.Quantity * m.Quantity * m.EstimatingPrice AS ItemValue
     FROM EsPlan p JOIN EsPack k ON k.EsPlanId = p.EsPlanID JOIN EsMaterial m ON m.EsPackdId = k.EsPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
     WHERE p.EsBidId = @id ORDER BY p.PlanNum, k.PackName, i.InvItem`, { id });
  const tax = N(head.TaxPercent) / 100, cm = N(head.ContMatPercent) / 100, bu = N(head.BurdenLabor) / 100, oh = N(head.OverheadPercent) / 100, pr = N(head.ProfitPercent) / 100, wr = N(head.WrapPercent) / 100, ds = N(head.Discount) / 100;
  for (const r of rows) {
    const v = N(r.ItemValue), L = /^L$/i.test(r.CostCodeId || '');
    const base = v + (L ? 0 : v * cm) + (L ? 0 : v * tax) + (L ? v * bu : 0);
    // rptEsBidItem02 formulas as written in Access (wrap and discount multiply by the overhead / profit percentages)
    r.ItemTotalValue = base + base * oh + base * (1 + oh) * pr + base * oh * (1 + pr) * wr - base * oh * pr * (1 + wr) * ds;
  }
  const cl = moneyNum(head.ContLaborValue);
  head.ContingencyLaborTotalValue = cl + cl * bu + cl * (1 + bu) * oh + cl * (1 + bu) * (1 + oh) * pr + cl * (1 + bu) * (1 + oh) * (1 + pr) * wr - cl * (1 + bu) * (1 + oh) * (1 + pr) * (1 + wr) * ds;
  head.ItemsTotal = rows.reduce((a, r) => a + r.ItemTotalValue, 0);
  head.BidTotal = head.ItemsTotal + head.ContingencyLaborTotalValue;
  res.json({ head, rows });
}));
router.get('/reports/job-history', h(async (req, res) => {
  const id = int(req.query.jobId);
  if (!id) throw bad('Choose a job');
  const job = await jobInfo(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const entries = await query(`SELECT ${LOG_COLS} FROM CmContract n LEFT JOIN LsContractType t ON t.TypeID = n.TypeId WHERE n.PmJobId = @id ORDER BY n.DateEntered, n.CmContractID`, { id });
  res.json({ job, entries });
}));
// Low estimating prices (EsLowEstimatingPrice): active items priced below last, average or labor cost
router.get('/reports/low-prices', h(async (req, res) => {
  res.json(await query(`SELECT i.InvItemID, ic.InvClass, i.InvItem, i.Description, i.LastCost, i.AverageCost, i.LaborCost, i.EstimatingPrice, i.EstimatingPriceMkUp, i.LastPurchase, i.CostCodeId, i.Notes,
       CASE WHEN i.LastCost > i.AverageCost THEN i.LastCost ELSE i.AverageCost END - i.EstimatingPrice AS Disc
     FROM IcItem i JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE i.StatusId = 1 AND (i.EstimatingPrice - i.LastCost < 0 OR i.EstimatingPrice - i.AverageCost < 0 OR i.EstimatingPrice - i.LaborCost < 0)
     ORDER BY ic.InvClass, i.InvItem`));
}));

module.exports = router;
