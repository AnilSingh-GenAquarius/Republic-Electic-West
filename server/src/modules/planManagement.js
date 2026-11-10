// Plan management (PM) — Access SwitchPM: customer → job → bid (contract) setup (PmCustomer form), the plan data
// screen (PlanManagement: plans → packs → material + stage/work values), sweeping material edits (PmPackMaterialEdit),
// duplicate bid / plan / pack, update zero item cost, update bid item prices, delete plan data, and the PM reports.
//
// Access rules reproduced:
//   * material item picked → UnitCost & EstimatingPrice = item LaborCost (labor items, cost code L) or JobCostPrice /
//     EstimatingPrice (everything else); warn when the item is inactive (IcItem.StatusId = 2)
//   * every material update/delete is logged to PmMaterialChangeRegistry with the OLD values (Action Update/Delete)
//   * a trued-up pack can't be edited (only its material and values); untick "trued up" first
//   * duplicate plan / pack is refused into a LOCKED bid; duplicating a bid from another job asks for confirmation
//   * delete plan data is refused when any pack of the bid is scheduled on a lot (JsPack), and returns the backup rows
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
function moneyIn(v, label) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  if (isNaN(n)) throw bad(`${label} must be an amount`);
  return fmtMoney(n);
}
const user = (req) => req.user?.username || 'web';

// ---------------------------------------------------------------------------
// Lookups & pickers
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [statuses, jobTypes, divisions, jurisdictions, packTypes, stages, works, gears, substitutions, costCodes] = await Promise.all([
    query('SELECT StatusID AS id, Status AS name FROM LsStatus ORDER BY StatusID'),
    query('SELECT JobTypeID AS id, JobType AS name FROM LsJobType ORDER BY JobType'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query("SELECT JurisdictionID AS id, Jurisdiction + ISNULL(' (' + State + ')','') AS name FROM LsJurisdiction ORDER BY Jurisdiction"),
    query('SELECT PackTypeID AS id, PackType AS name, Std, Opt FROM LsPackType ORDER BY PackTypeID'),
    query('SELECT StageID AS id, Stage AS name, ScheduleStageId FROM LsStage ORDER BY Stage'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query("SELECT GrGearID AS id, Gear + ISNULL(' – ' + Make,'') AS name FROM GrGearName ORDER BY Gear"),
    query('SELECT SubsID AS id, SubsName AS name, Description FROM LsSubstitutionType ORDER BY SubsName'),
    query('SELECT CostCodeId AS id, Description AS name FROM LsCostCode ORDER BY CostCodeId'),
  ]);
  const scheduleStages = await query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage');
  res.json({ statuses, jobTypes, divisions, jurisdictions, packTypes, stages, works, gears, substitutions, costCodes, scheduleStages });
}));
router.get('/pick/customers', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query('SELECT TOP 50 PmCustID AS id, Customer AS name FROM PmCustomer WHERE (@s IS NULL OR Customer LIKE @s) ORDER BY Customer', { s }));
}));
router.get('/pick/jobs', h(async (req, res) => {
  res.json(await query(`SELECT j.PmJobID AS id, j.Job + ISNULL(' (' + j.DivisionId + ')','') AS name, j.DivisionId, j.PmCustId, c.Customer FROM PmJob j JOIN PmCustomer c ON c.PmCustID = j.PmCustId
     WHERE (@c IS NULL OR j.PmCustId = @c) AND (@d IS NULL OR j.DivisionId = @d) ORDER BY c.Customer, j.Job`, { c: int(req.query.customerId), d: req.query.division || null }));
}));
router.get('/pick/contracts', h(async (req, res) => {
  res.json(await query(`SELECT PmContractID AS id, ISNULL(BidNum,'') + ISNULL(' ' + BidRelease,'') + ISNULL(' – ' + BidName,'') AS name, BidDate, Lock, StatusId
     FROM PmContract WHERE PmJobId = @j ORDER BY BidDate DESC, BidNum DESC`, { j: int(req.query.jobId) }));
}));
router.get('/pick/plans', h(async (req, res) => {
  res.json(await query(`SELECT PmPlanID AS id, ISNULL(PlanNum,'') + ISNULL(' – ' + PlanName,'') AS name, SqFt, Bedrooms FROM PmPlan WHERE PmContractId = @c ORDER BY PlanNum`, { c: int(req.query.contractId) }));
}));
router.get('/pick/packs', h(async (req, res) => {
  res.json(await query(`SELECT PmPackID AS id, PackName AS name, BuilderCode FROM PmPack WHERE PmPlanId = @p ORDER BY PackName`, { p: int(req.query.planId) }));
}));
router.get('/pick/items', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query(`SELECT TOP 40 i.InvItemID AS id, i.InvItem + ' – ' + ISNULL(i.Description,'') AS name, i.InvItem, i.CostCodeId, ic.InvClass, i.StatusId
     FROM IcItem i LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s) ORDER BY CASE WHEN i.StatusId = 1 THEN 0 ELSE 1 END, i.InvItem`, { s }));
}));

router.get('/overview', h(async (req, res) => {
  const [counts, recent] = await Promise.all([
    query(`SELECT (SELECT COUNT(*) FROM PmCustomer) AS customers, (SELECT COUNT(*) FROM PmJob WHERE ISNULL(Template,0) = 0) AS jobs,
                  (SELECT COUNT(*) FROM PmContract WHERE StatusId = 1) AS bids, (SELECT COUNT(*) FROM PmPlan WHERE StatusId = 1) AS plans,
                  (SELECT COUNT(*) FROM PmPack) AS packs, (SELECT COUNT(*) FROM PmMaterial) AS material,
                  (SELECT COUNT(*) FROM PmMaterial WHERE ISNULL(UnitCost,0) = 0) AS zeroCost,
                  (SELECT COUNT(*) FROM PmContract WHERE Lock = 1) AS locked`),
    query(`SELECT TOP 8 pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, pc.Lock, j.Job, j.DivisionId, c.Customer,
                  (SELECT COUNT(*) FROM PmPlan p WHERE p.PmContractId = pc.PmContractID) AS Plans
             FROM PmContract pc JOIN PmJob j ON j.PmJobID = pc.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId ORDER BY pc.BidDate DESC, pc.PmContractID DESC`),
  ]);
  res.json({ ...counts[0], recent });
}));

// ---------------------------------------------------------------------------
// Customer → job → bid setup (Access PmCustomer + subforms)
// ---------------------------------------------------------------------------
router.get('/customers', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, st: int(req.query.statusId), offset: pg.offset, pageSize: pg.pageSize };
  const where = 'WHERE (@s IS NULL OR c.Customer LIKE @s) AND (@st IS NULL OR c.StatusId = @st)';
  const [rows, total] = await Promise.all([
    query(`SELECT c.PmCustID, c.Customer, c.StatusId, st.Status, c.Notes, (SELECT COUNT(*) FROM PmJob j WHERE j.PmCustId = c.PmCustID) AS Jobs
             FROM PmCustomer c LEFT JOIN LsStatus st ON st.StatusID = c.StatusId ${where} ORDER BY c.Customer OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM PmCustomer c ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [c, jobs, bids] = await Promise.all([
    query('SELECT * FROM PmCustomer WHERE PmCustID = @id', { id }),
    query(`SELECT j.*, jt.JobType, st.Status, js.Jurisdiction, (SELECT COUNT(*) FROM PmContract pc WHERE pc.PmJobId = j.PmJobID) AS Bids,
                  (SELECT COUNT(*) FROM JsJob x WHERE x.PmJobId = j.PmJobID) AS ScJobs
             FROM PmJob j LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId LEFT JOIN LsJurisdiction js ON js.JurisdictionID = j.JurisdictionId
            WHERE j.PmCustId = @id ORDER BY j.Job`, { id }),
    query(`SELECT pc.*, st.Status, (SELECT COUNT(*) FROM PmPlan p WHERE p.PmContractId = pc.PmContractID) AS Plans
             FROM PmContract pc JOIN PmJob j ON j.PmJobID = pc.PmJobId LEFT JOIN LsStatus st ON st.StatusID = pc.StatusId WHERE j.PmCustId = @id ORDER BY pc.BidDate DESC, pc.BidNum`, { id }),
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
    const dup = await query('SELECT 1 FROM PmCustomer WHERE Customer = @n', { n: o.Customer }, tx);
    if (dup[0]) throw bad('A customer with this name already exists', 409);
    const nid = await nextId(tx, 'PmCustomer', 'PmCustID');
    await query('INSERT INTO PmCustomer (PmCustID, Customer, Notes, StatusId, DateEntered, UserEntered) VALUES (@id, @c, @n, @s, GETDATE(), @u)', { id: nid, c: o.Customer, n: o.Notes ?? null, s: o.StatusId, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
async function patch(table, idCol, id, o, tx) {
  const keys = Object.keys(o);
  if (!keys.length) return 1;
  const r = await query(`UPDATE ${table} SET ${keys.map((k) => `[${k}] = @${k}`).join(', ')} WHERE ${idCol} = @__id; SELECT @@ROWCOUNT AS n`, { ...o, __id: id }, tx);
  return r[0]?.n ?? 0;
}
router.put('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id), o = custBody(req.body || {}, true);
  if (o.Customer) { const d = await query('SELECT 1 FROM PmCustomer WHERE Customer = @n AND PmCustID <> @id', { n: o.Customer, id }); if (d[0]) throw bad('A customer with this name already exists', 409) }
  if (!(await patch('PmCustomer', 'PmCustID', id, o))) return res.status(404).json({ error: 'Customer not found' });
  res.json({ ok: true });
}));
router.delete('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const j = await query('SELECT COUNT(*) AS n FROM PmJob WHERE PmCustId = @id', { id });
  if (j[0].n) throw bad(`This customer has ${j[0].n} job(s). Delete or move the jobs first.`, 409);
  await query('DELETE FROM PmCustomer WHERE PmCustID = @id', { id });
  res.json({ ok: true });
}));

function jobBody(b, partial) {
  const o = {};
  if (!partial || 'Job' in b) { o.Job = str(b.Job, 50); if (!o.Job) throw bad('Enter the job name') }
  if (!partial || 'DivisionId' in b) { o.DivisionId = str(b.DivisionId, 50); if (!o.DivisionId) throw bad('Choose the division') }
  if (!partial || 'JobTypeId' in b) { o.JobTypeId = int(b.JobTypeId); if (!o.JobTypeId) throw bad('Choose the job type') }
  if ('JobNumber' in b) o.JobNumber = str(b.JobNumber, 50);
  if ('SpecLevel' in b) o.SpecLevel = str(b.SpecLevel, 255);
  if ('JurisdictionId' in b) o.JurisdictionId = int(b.JurisdictionId);
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if ('Template' in b) o.Template = bit(b.Template);
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  return o;
}
router.post('/customers/:id/jobs', h(async (req, res) => {
  const cust = int(req.params.id), o = jobBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmCustomer WHERE PmCustID = @c', { c: cust }, tx))[0]) throw bad('Customer not found', 404);
    if ((await query('SELECT 1 FROM PmJob WHERE PmCustId = @c AND Job = @j AND DivisionId = @d', { c: cust, j: o.Job, d: o.DivisionId }, tx))[0]) throw bad('This customer already has a job with this name in that division', 409);
    const nid = await nextId(tx, 'PmJob', 'PmJobID');
    await query(`INSERT INTO PmJob (PmJobID, PmCustId, Job, JobTypeId, JobNumber, SpecLevel, JurisdictionId, DivisionId, Notes, Template, StatusId, DateEntered, UserEntered)
                 VALUES (@id, @c, @Job, @JobTypeId, @JobNumber, @SpecLevel, @JurisdictionId, @DivisionId, @Notes, @Template, @StatusId, GETDATE(), @u)`,
    { id: nid, c: cust, Job: o.Job, JobTypeId: o.JobTypeId, JobNumber: o.JobNumber ?? null, SpecLevel: o.SpecLevel ?? null, JurisdictionId: o.JurisdictionId ?? null, DivisionId: o.DivisionId, Notes: o.Notes ?? null, Template: o.Template ?? 0, StatusId: o.StatusId, u: user(req) }, tx);
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
  const [b, s] = await Promise.all([query('SELECT COUNT(*) AS n FROM PmContract WHERE PmJobId = @id', { id }), query('SELECT COUNT(*) AS n FROM JsJob WHERE PmJobId = @id', { id })]);
  if (b[0].n) throw bad(`This job has ${b[0].n} bid(s). Delete the bids first.`, 409);
  if (s[0].n) throw bad('This job is linked to a job in Job setup / Scheduling and cannot be deleted.', 409);
  await query('DELETE FROM PmJob WHERE PmJobID = @id', { id });
  res.json({ ok: true });
}));

function bidBody(b, partial) {
  const o = {};
  if (!partial || 'BidNum' in b) { o.BidNum = str(b.BidNum, 50); if (!o.BidNum) throw bad('Enter the bid number') }
  if ('BidRelease' in b) o.BidRelease = str(b.BidRelease, 50);
  if ('BidName' in b) o.BidName = str(b.BidName, 50);
  if (!partial || 'BidDate' in b) { o.BidDate = isoDate(b.BidDate); if (!partial && !o.BidDate) o.BidDate = new Date().toISOString().slice(0, 10); if (partial && b.BidDate && !o.BidDate) throw bad('Enter a valid bid date') }
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  if ('Lock' in b) o.Lock = bit(b.Lock);
  if ('TrueUpDate' in b) o.TrueUpDate = isoDate(b.TrueUpDate);
  if ('EsBidIDLink' in b) o.EsBidIDLink = int(b.EsBidIDLink);
  return o;
}
router.post('/jobs/:id/contracts', h(async (req, res) => {
  const job = int(req.params.id), o = bidBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmJob WHERE PmJobID = @j', { j: job }, tx))[0]) throw bad('Job not found', 404);
    if ((await query('SELECT 1 FROM PmContract WHERE PmJobId = @j AND BidNum = @n AND ISNULL(BidRelease,\'\') = ISNULL(@r,\'\')', { j: job, n: o.BidNum, r: o.BidRelease ?? null }, tx))[0]) throw bad('This job already has a bid with this number and release', 409);
    const nid = await nextId(tx, 'PmContract', 'PmContractID');
    await query(`INSERT INTO PmContract (PmContractID, PmJobId, BidNum, BidRelease, BidName, BidDate, Notes, StatusId, Lock, DateEntered, UserEntered)
                 VALUES (@id, @j, @BidNum, @BidRelease, @BidName, @BidDate, @Notes, @StatusId, 0, GETDATE(), @u)`,
    { id: nid, j: job, BidNum: o.BidNum, BidRelease: o.BidRelease ?? null, BidName: o.BidName ?? null, BidDate: o.BidDate, Notes: o.Notes ?? null, StatusId: o.StatusId, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id), o = bidBody(req.body || {}, true);
  if (!(await patch('PmContract', 'PmContractID', id, o))) return res.status(404).json({ error: 'Bid not found' });
  res.json({ ok: true });
}));
router.delete('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [p, s] = await Promise.all([query('SELECT COUNT(*) AS n FROM PmPlan WHERE PmContractId = @id', { id }), query('SELECT COUNT(*) AS n FROM JsPhase WHERE PmContractId = @id', { id })]);
  if (p[0].n) throw bad(`This bid has ${p[0].n} plan(s). Use "Delete plan data" first.`, 409);
  if (s[0].n) throw bad('This bid is used by a phase in Job setup and cannot be deleted.', 409);
  await query('DELETE FROM PmContract WHERE PmContractID = @id', { id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Plan data (Access PlanManagement): bid header + plans; plan → packs; pack → material + values
// ---------------------------------------------------------------------------
router.get('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [head, plans, used] = await Promise.all([
    query(`SELECT pc.*, j.Job, j.JobNumber, j.DivisionId, j.JobTypeId, jt.JobType, j.PmCustId, c.Customer, st.Status
             FROM PmContract pc JOIN PmJob j ON j.PmJobID = pc.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
             LEFT JOIN LsStatus st ON st.StatusID = pc.StatusId WHERE pc.PmContractID = @id`, { id }),
    query(`SELECT p.PmPlanID, p.PlanNum, p.PlanName, p.SqFt, p.Bedrooms, p.ACunits, p.TvOutlet, p.GrGearId, p.Island, p.FloorPlug, p.Detached, p.Universal, ${MV('p.ContractVal')} AS ContractVal, p.Notes, p.StatusId, st.Status,
                  (SELECT COUNT(*) FROM PmPack k WHERE k.PmPlanId = p.PmPlanID) AS Packs,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PmPlanId = p.PmPlanID) AS Lots
             FROM PmPlan p LEFT JOIN LsStatus st ON st.StatusID = p.StatusId WHERE p.PmContractId = @id ORDER BY p.PlanNum`, { id }),
    query('SELECT COUNT(*) AS n FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE p.PmContractId = @id', { id }),
  ]);
  if (!head[0]) return res.status(404).json({ error: 'Bid not found' });
  res.json({ contract: head[0], plans, scheduledPacks: used[0].n });
}));

function planBody(b, partial) {
  const o = {};
  if (!partial || 'PlanNum' in b) { o.PlanNum = str(b.PlanNum, 50); if (!o.PlanNum) throw bad('Enter the plan number') }
  for (const k of ['PlanName']) if (k in b) o[k] = str(b[k], 50);
  for (const k of ['Bedrooms', 'TvOutlet', 'Island', 'FloorPlug', 'Detached', 'Notes']) if (k in b) o[k] = str(b[k], 255);
  if ('GrGearId' in b) o.GrGearId = b.GrGearId === '' || b.GrGearId == null ? null : String(int(b.GrGearId));
  if ('SqFt' in b) { o.SqFt = b.SqFt === '' || b.SqFt == null ? null : int(b.SqFt); if (b.SqFt !== '' && b.SqFt != null && (o.SqFt == null || o.SqFt < 0)) throw bad('Sq ft must be a whole number') }
  if ('ACunits' in b) o.ACunits = bit(b.ACunits);
  if ('Universal' in b) o.Universal = bit(b.Universal);
  if ('ContractVal' in b) o.ContractVal = moneyIn(b.ContractVal, 'Contract value');
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  return o;
}
router.post('/contracts/:id/plans', h(async (req, res) => {
  const cid = int(req.params.id), o = planBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmContract WHERE PmContractID = @c', { c: cid }, tx))[0]) throw bad('Bid not found', 404);
    if ((await query('SELECT 1 FROM PmPlan WHERE PmContractId = @c AND PlanNum = @n', { c: cid, n: o.PlanNum }, tx))[0]) throw bad('This bid already has a plan with this number', 409);
    const nid = await nextId(tx, 'PmPlan', 'PmPlanID');
    const cols = { PmPlanID: nid, PmContractId: cid, ...o, ContractVal: o.ContractVal ?? '$0.00', DateEntered: new Date(), UserEntered: user(req) };
    await query(`INSERT INTO PmPlan (${Object.keys(cols).map((k) => `[${k}]`).join(', ')}) VALUES (${Object.keys(cols).map((k) => `@${k}`).join(', ')})`, cols, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id), o = planBody(req.body || {}, true);
  if (o.PlanNum) { const d = await query('SELECT 1 FROM PmPlan a JOIN PmPlan b ON b.PmContractId = a.PmContractId WHERE a.PmPlanID = @id AND b.PmPlanID <> @id AND b.PlanNum = @n', { id, n: o.PlanNum }); if (d[0]) throw bad('This bid already has a plan with this number', 409) }
  if (!(await patch('PmPlan', 'PmPlanID', id, o))) return res.status(404).json({ error: 'Plan not found' });
  res.json({ ok: true });
}));
router.delete('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [k, l] = await Promise.all([query('SELECT COUNT(*) AS n FROM PmPack WHERE PmPlanId = @id', { id }), query('SELECT COUNT(*) AS n FROM JsLot WHERE PmPlanId = @id', { id })]);
  if (l[0].n) throw bad(`This plan is used by ${l[0].n} lot(s) and cannot be deleted.`, 409);
  if (k[0].n) throw bad(`This plan has ${k[0].n} pack(s). Delete the packs first.`, 409);
  await query('DELETE FROM PmPlan WHERE PmPlanID = @id', { id });
  res.json({ ok: true });
}));

router.get('/plans/:id/packs', h(async (req, res) => {
  const id = int(req.params.id);
  const [plan, packs] = await Promise.all([
    query(`SELECT p.*, ${MV('p.ContractVal')} AS ContractValNum, pc.Lock, pc.BidNum FROM PmPlan p JOIN PmContract pc ON pc.PmContractID = p.PmContractId WHERE p.PmPlanID = @id`, { id }),
    query(`SELECT k.PmPackID, k.PackName, k.PackTypeId, t.PackType, k.BuilderCode, k.Quantity, ${MV('k.ContractVal')} AS ContractVal, ${MV('k.ContractValCost')} AS ContractValCost,
                  k.TruedUp, k.Verified, k.Substitution, k.EstBuildTime, k.StatusId, st.Status, k.Notes,
                  (SELECT COUNT(*) FROM PmMaterial m WHERE m.PmPackId = k.PmPackID) AS Items,
                  (SELECT SUM(m.Quantity * m.UnitCost) FROM PmMaterial m WHERE m.PmPackId = k.PmPackID AND ISNULL(m.StatusId,1) = 1) AS Cost,
                  (SELECT COUNT(*) FROM JsPack jp WHERE jp.PmPackId = k.PmPackID) AS Scheduled
             FROM PmPack k LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId LEFT JOIN LsStatus st ON st.StatusID = k.StatusId
            WHERE k.PmPlanId = @id ORDER BY k.PackTypeId, k.PackName`, { id }),
  ]);
  if (!plan[0]) return res.status(404).json({ error: 'Plan not found' });
  res.json({ plan: plan[0], packs });
}));

function packBody(b, partial) {
  const o = {};
  if (!partial || 'PackName' in b) { o.PackName = str(b.PackName, 100); if (!o.PackName) throw bad('Enter the pack name') }
  if (!partial || 'PackTypeId' in b) { o.PackTypeId = int(b.PackTypeId); if (!o.PackTypeId) throw bad('Choose the pack type') }
  if ('BuilderCode' in b) o.BuilderCode = str(b.BuilderCode, 50);
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if (!partial || 'Quantity' in b) { o.Quantity = b.Quantity === '' || b.Quantity == null ? 1 : int(b.Quantity); if (o.Quantity == null || o.Quantity < 0) throw bad('Pack quantity must be a whole number') }
  if ('ContractVal' in b) o.ContractVal = moneyIn(b.ContractVal, 'Contract value');
  if ('ContractValCost' in b) o.ContractValCost = moneyIn(b.ContractValCost, 'Contract cost');
  if ('EstBuildTime' in b) { o.EstBuildTime = num(b.EstBuildTime); if (o.EstBuildTime != null && isNaN(o.EstBuildTime)) throw bad('Build time must be a number') }
  for (const k of ['TruedUp', 'Verified', 'Substitution']) if (k in b) o[k] = bit(b[k]);
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  return o;
}
router.post('/plans/:id/packs', h(async (req, res) => {
  const pid = int(req.params.id), o = packBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmPlan WHERE PmPlanID = @p', { p: pid }, tx))[0]) throw bad('Plan not found', 404);
    if ((await query('SELECT 1 FROM PmPack WHERE PmPlanId = @p AND PackName = @n', { p: pid, n: o.PackName }, tx))[0]) throw bad('This plan already has a pack with this name', 409);
    const nid = await nextId(tx, 'PmPack', 'PmPackID');
    const cols = { PmPackID: nid, PmPlanId: pid, ContractVal: '$0.00', ContractValCost: '$0.00', TruedUp: 0, Verified: 0, Substitution: 0, ...o, DateEntered: new Date(), UserEntered: user(req) };
    await query(`INSERT INTO PmPack (${Object.keys(cols).map((k) => `[${k}]`).join(', ')}) VALUES (${Object.keys(cols).map((k) => `@${k}`).join(', ')})`, cols, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = packBody(b, true);
  const cur = (await query('SELECT PmPackID, PmPlanId, TruedUp FROM PmPack WHERE PmPackID = @id', { id }))[0];
  if (!cur) return res.status(404).json({ error: 'Pack not found' });
  // Access PlanSubPack BeforeUpdate: a trued-up pack can't be edited (material and labor only). Unticking TruedUp is allowed.
  if (cur.TruedUp && Object.keys(o).some((k) => k !== 'TruedUp')) throw bad('This pack is trued up, you can edit material and labor only. Untick "Trued up" first to change the pack.', 409);
  if (o.PackName) { const d = await query('SELECT 1 FROM PmPack WHERE PmPlanId = @p AND PackName = @n AND PmPackID <> @id', { p: cur.PmPlanId, n: o.PackName, id }); if (d[0]) throw bad('This plan already has a pack with this name', 409) }
  await patch('PmPack', 'PmPackID', id, o);
  res.json({ ok: true });
}));
router.delete('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT TruedUp FROM PmPack WHERE PmPackID = @id', { id }, tx))[0];
    if (!cur) throw bad('Pack not found', 404);
    const s = await query('SELECT COUNT(*) AS n FROM JsPack WHERE PmPackId = @id', { id }, tx);
    if (s[0].n) throw bad(`This pack is scheduled on ${s[0].n} lot(s) and cannot be deleted.`, 409);
    if (cur.TruedUp) throw bad('This pack is trued up and cannot be deleted.', 409);
    await logMaterial(tx, 'm.PmPackId = @id', { id }, 'Delete', user(req));
    await query('DELETE FROM PmMaterial WHERE PmPackId = @id', { id }, tx);
    await query('DELETE FROM PmValue WHERE PmPackId = @id', { id }, tx);
    await query('DELETE FROM PmPack WHERE PmPackID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// pack detail: material + values
router.get('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [pack, material, values, log] = await Promise.all([
    query(`SELECT k.*, ${MV('k.ContractVal')} AS ContractValNum, t.PackType, p.PlanNum, p.PmContractId, pc.Lock FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId JOIN PmContract pc ON pc.PmContractID = p.PmContractId
            LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId WHERE k.PmPackID = @id`, { id }),
    query(`SELECT m.PmMatID, m.InvItemId, i.InvItem, i.Description, i.CostCodeId, i.StatusId AS ItemStatusId, m.Quantity, m.StageId, s.Stage, m.WorkId, w.WorkType, m.UnitCost, m.EstimatingPrice,
                  m.Quantity * m.UnitCost AS ExtCost, m.NoChange, m.Notes, m.StatusId, st.Status, m.DateEntered, m.UserEntered
             FROM PmMaterial m LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId LEFT JOIN LsStage s ON s.StageID = m.StageId LEFT JOIN LsWork w ON w.WorkID = m.WorkId LEFT JOIN LsStatus st ON st.StatusID = m.StatusId
            WHERE m.PmPackId = @id ORDER BY i.CostCodeId, s.Stage, i.InvItem`, { id }),
    query(`SELECT v.PmValueID, v.WorkId, w.WorkType, v.ScheduleStageId, ss.ScheduleStage, ${MV('v.Value')} AS Value FROM PmValue v LEFT JOIN LsWork w ON w.WorkID = v.WorkId
             LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = v.ScheduleStageId WHERE v.PmPackId = @id ORDER BY ss.ScheduleStage, w.WorkType`, { id }),
    query(`SELECT TOP 30 r.PmMatChangeID, r.Action, r.DateEdited, r.UserEdited, i.InvItem, r.Quantity, r.UnitCost, r.EstimatingPrice FROM PmMaterialChangeRegistry r LEFT JOIN IcItem i ON i.InvItemID = r.InvItemId
            WHERE r.PmPackId = @id ORDER BY r.PmMatChangeID DESC`, { id }),
  ]);
  if (!pack[0]) return res.status(404).json({ error: 'Pack not found' });
  const t = material.filter((m) => (m.StatusId ?? 1) === 1).reduce((a, m) => { const x = Number(m.ExtCost || 0); if (m.CostCodeId === 'L') a.labor += x; else a.material += x; return a }, { labor: 0, material: 0 });
  res.json({ pack: pack[0], material, values, log, totals: { ...t, cost: t.labor + t.material, values: values.reduce((a, v) => a + Number(v.Value || 0), 0) } });
}));

// Registry: copy the CURRENT (old) values before an update/delete — Access frmPmMaterialRegistryUpdate/Delete
async function logMaterial(tx, where, params, action, who) {
  const rows = await query(`SELECT m.* FROM PmMaterial m WHERE ${where}`, params, tx);
  if (!rows.length) return 0;
  let id = await nextId(tx, 'PmMaterialChangeRegistry', 'PmMatChangeID');
  for (const m of rows) {
    await query(`INSERT INTO PmMaterialChangeRegistry (PmMatChangeID, PmMatId, PmPackId, InvItemId, Quantity, StageId, WorkId, NoChange, Notes, UnitCost, EstimatingPrice, StatusId, DateEdited, UserEdited, [Action])
                 VALUES (@id, @PmMatID, @PmPackId, @InvItemId, @Quantity, @StageId, @WorkId, @NoChange, @Notes, @UnitCost, @EstimatingPrice, @StatusId, GETDATE(), @u, @a)`,
    { id: id++, PmMatID: m.PmMatID, PmPackId: m.PmPackId, InvItemId: m.InvItemId, Quantity: m.Quantity, StageId: m.StageId, WorkId: m.WorkId, NoChange: m.NoChange, Notes: m.Notes, UnitCost: m.UnitCost, EstimatingPrice: m.EstimatingPrice, StatusId: m.StatusId, u: who, a: action }, tx);
  }
  return rows.length;
}
// Access PlanSubMaterial AfterUpdate: price from the item
async function itemPrices(tx, itemId) {
  const i = (await query('SELECT InvItemID, InvItem, CostCodeId, LaborCost, JobCostPrice, EstimatingPrice, StatusId FROM IcItem WHERE InvItemID = @id', { id: itemId }, tx))[0];
  if (!i) throw bad('Inventory item not found');
  const labor = i.CostCodeId === 'L';
  return { item: i, UnitCost: Number((labor ? i.LaborCost : i.JobCostPrice) || 0), EstimatingPrice: Number((labor ? i.LaborCost : i.EstimatingPrice) || 0), inactive: i.StatusId === 2 };
}
function matBody(b, partial) {
  const o = {};
  if (!partial || 'InvItemId' in b) { o.InvItemId = int(b.InvItemId); if (!o.InvItemId) throw bad('Choose the inventory item') }
  if (!partial || 'Quantity' in b) { o.Quantity = int(b.Quantity); if (o.Quantity == null || isNaN(o.Quantity)) throw bad('Quantity must be a whole number') }
  if (!partial || 'StageId' in b) { o.StageId = int(b.StageId); if (!o.StageId) throw bad('Choose the stage') }
  if (!partial || 'WorkId' in b) { o.WorkId = int(b.WorkId); if (!o.WorkId) throw bad('Choose the type of work') }
  if ('NoChange' in b) o.NoChange = bit(b.NoChange);
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if (!partial || 'StatusId' in b) o.StatusId = int(b.StatusId) || 1;
  for (const k of ['UnitCost', 'EstimatingPrice']) if (k in b && b[k] !== '' && b[k] != null) { o[k] = num(b[k]); if (isNaN(o[k]) || o[k] < 0) throw bad(`${k === 'UnitCost' ? 'Unit cost' : 'Estimating price'} must be a positive number`) }
  return o;
}
router.post('/packs/:id/material', h(async (req, res) => {
  const pk = int(req.params.id), o = matBody(req.body || {}, false);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmPack WHERE PmPackID = @p', { p: pk }, tx))[0]) throw bad('Pack not found', 404);
    const pr = await itemPrices(tx, o.InvItemId);
    if (pr.inactive && !req.body.confirmInactive) throw Object.assign(bad(`${pr.item.InvItem} is inactive, are you sure you want to use it?`, 409), { needsConfirm: true });
    const nid = await nextId(tx, 'PmMaterial', 'PmMatID');
    await query(`INSERT INTO PmMaterial (PmMatID, PmPackId, InvItemId, Quantity, StageId, WorkId, NoChange, Notes, UnitCost, EstimatingPrice, StatusId, DateEntered, UserEntered)
                 VALUES (@id, @p, @InvItemId, @Quantity, @StageId, @WorkId, @NoChange, @Notes, @UnitCost, @EstimatingPrice, @StatusId, GETDATE(), @u)`,
    { id: nid, p: pk, InvItemId: o.InvItemId, Quantity: o.Quantity, StageId: o.StageId, WorkId: o.WorkId, NoChange: o.NoChange ?? 0, Notes: o.Notes ?? null,
      UnitCost: o.UnitCost ?? pr.UnitCost, EstimatingPrice: o.EstimatingPrice ?? pr.EstimatingPrice, StatusId: o.StatusId, u: user(req) }, tx);
    return { id: nid, UnitCost: o.UnitCost ?? pr.UnitCost, EstimatingPrice: o.EstimatingPrice ?? pr.EstimatingPrice };
  });
  res.status(201).json(out);
}));
router.put('/material/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = matBody(b, true);
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT * FROM PmMaterial WHERE PmMatID = @id', { id }, tx))[0];
    if (!cur) throw bad('Material line not found', 404);
    if (o.InvItemId && o.InvItemId !== cur.InvItemId) {
      const pr = await itemPrices(tx, o.InvItemId);
      if (pr.inactive && !b.confirmInactive) throw Object.assign(bad(`${pr.item.InvItem} is inactive, are you sure you want to use it?`, 409), { needsConfirm: true });
      if (!('UnitCost' in o)) o.UnitCost = pr.UnitCost;
      if (!('EstimatingPrice' in o)) o.EstimatingPrice = pr.EstimatingPrice;
    }
    await logMaterial(tx, 'm.PmMatID = @id', { id }, 'Update', user(req));
    await patch('PmMaterial', 'PmMatID', id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/material/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    if (!(await logMaterial(tx, 'm.PmMatID = @id', { id }, 'Delete', user(req)))) throw bad('Material line not found', 404);
    await query('DELETE FROM PmMaterial WHERE PmMatID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// pack values (PmValue: contract value per schedule stage / work)
router.post('/packs/:id/values', h(async (req, res) => {
  const pk = int(req.params.id), b = req.body || {};
  const w = int(b.WorkId), s = int(b.ScheduleStageId), v = moneyIn(b.Value, 'Value');
  if (!w || !s) throw bad('Choose the stage and the type of work');
  if (v == null) throw bad('Enter the value');
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmPack WHERE PmPackID = @p', { p: pk }, tx))[0]) throw bad('Pack not found', 404);
    if ((await query('SELECT 1 FROM PmValue WHERE PmPackId = @p AND WorkId = @w AND ScheduleStageId = @s', { p: pk, w, s }, tx))[0]) throw bad('This pack already has a value for that stage and work', 409);
    const nid = await nextId(tx, 'PmValue', 'PmValueID');
    await query('INSERT INTO PmValue (PmValueID, PmPackId, WorkId, ScheduleStageId, [Value], UserEntered) VALUES (@id, @p, @w, @s, @v, @u)', { id: nid, p: pk, w, s, v, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/values/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('Value' in b) { o.Value = moneyIn(b.Value, 'Value'); if (o.Value == null) throw bad('Enter the value') }
  if ('WorkId' in b) o.WorkId = int(b.WorkId);
  if ('ScheduleStageId' in b) o.ScheduleStageId = int(b.ScheduleStageId);
  if (!(await patch('PmValue', 'PmValueID', id, o))) return res.status(404).json({ error: 'Value not found' });
  res.json({ ok: true });
}));
router.delete('/values/:id', h(async (req, res) => {
  await query('DELETE FROM PmValue WHERE PmValueID = @id', { id: int(req.params.id) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Sweeping material changes (Access PmPackMaterialEdit): customer + item + pack type → lines across all bids
// ---------------------------------------------------------------------------
router.get('/material-sweep', h(async (req, res) => {
  const cust = int(req.query.customerId), item = int(req.query.itemId), type = int(req.query.packTypeId);
  if (!cust || !item || !type) throw bad('Choose the customer, the inventory item and the pack type');
  res.json(await query(`SELECT m.PmMatID, c.Customer, j.DivisionId, j.Job, pc.BidNum, pc.Lock, p.PlanNum, k.PackName, k.TruedUp, m.InvItemId, i.InvItem, m.StageId, s.Stage, m.WorkId, w.WorkType, m.Quantity, m.UnitCost, m.EstimatingPrice
      FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID
      JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN PmMaterial m ON m.PmPackId = k.PmPackID LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId
      LEFT JOIN LsStage s ON s.StageID = m.StageId LEFT JOIN LsWork w ON w.WorkID = m.WorkId
     WHERE j.PmCustId = @c AND m.InvItemId = @i AND k.PackTypeId = @t
     ORDER BY j.DivisionId, j.Job, pc.BidNum, p.PlanNum, k.PackName`, { c: cust, i: item, t: type }));
}));
router.post('/material-sweep', h(async (req, res) => {
  const b = req.body || {};
  const ids = (b.ids || []).map(int).filter(Boolean);
  if (!ids.length) throw bad('Select at least one line');
  if (ids.length > 5000) throw bad('Too many lines at once (max 5000)');
  const o = {};
  if (b.InvItemId) o.InvItemId = int(b.InvItemId);
  if (b.Quantity !== '' && b.Quantity != null) { o.Quantity = int(b.Quantity); if (o.Quantity == null) throw bad('Quantity must be a whole number') }
  if (b.StageId) o.StageId = int(b.StageId);
  if (b.WorkId) o.WorkId = int(b.WorkId);
  for (const k of ['UnitCost', 'EstimatingPrice']) if (b[k] !== '' && b[k] != null) { o[k] = num(b[k]); if (isNaN(o[k]) || o[k] < 0) throw bad('Prices must be positive numbers') }
  if (!Object.keys(o).length) throw bad('Enter at least one change');
  const out = await withTransaction(async (tx) => {
    if (o.InvItemId) {
      const pr = await itemPrices(tx, o.InvItemId);
      if (pr.inactive && !b.confirmInactive) throw Object.assign(bad(`${pr.item.InvItem} is inactive, are you sure you want to use it?`, 409), { needsConfirm: true });
      if (!('UnitCost' in o)) o.UnitCost = pr.UnitCost;
      if (!('EstimatingPrice' in o)) o.EstimatingPrice = pr.EstimatingPrice;
    }
    const list = ids.join(',');
    const logged = await logMaterial(tx, `m.PmMatID IN (${list})`, {}, 'Update', user(req));
    const keys = Object.keys(o);
    await query(`UPDATE PmMaterial SET ${keys.map((k) => `[${k}] = @${k}`).join(', ')} WHERE PmMatID IN (${list})`, o, tx);
    return { updated: logged };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------
// Update zero item cost (qryPmMaterialUpdateCost): every material line with no cost gets the item's labor / job cost price
router.post('/update-zero-cost', h(async (req, res) => {
  const r = await query(`UPDATE m SET m.UnitCost = CASE WHEN i.CostCodeId = 'L' THEN i.LaborCost ELSE i.JobCostPrice END
      FROM PmMaterial m JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE ISNULL(m.UnitCost, 0) = 0; SELECT @@ROWCOUNT AS n`);
  res.json({ updated: r[0]?.n ?? 0 });
}));
// Update bid item prices (qryPmUpdateBidItemPrices): non-labor material of one bid → current job cost / estimating price
router.post('/contracts/:id/update-prices', h(async (req, res) => {
  const id = int(req.params.id);
  const r = await query(`UPDATE m SET m.UnitCost = i.JobCostPrice, m.EstimatingPrice = i.EstimatingPrice
      FROM PmMaterial m JOIN PmPack k ON k.PmPackID = m.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId JOIN IcItem i ON i.InvItemID = m.InvItemId
     WHERE p.PmContractId = @id AND i.CostCodeId <> 'L'; SELECT @@ROWCOUNT AS n`, { id });
  res.json({ updated: r[0]?.n ?? 0 });
}));

// Copy helpers (Access qryPmDuplicate*, qryPmDupPlan*, qryPmDupPack*): the copy gets " new" appended, the copied material is
// priced from the item today, trued-up is cleared. Ids are mapped one-to-one (Access matched by name, which could double up).
async function copyPack(tx, srcPackId, destPlanId, newName, who, { keepVerified = false } = {}) {
  const k = (await query('SELECT * FROM PmPack WHERE PmPackID = @id', { id: srcPackId }, tx))[0];
  const nid = await nextId(tx, 'PmPack', 'PmPackID');
  await query(`INSERT INTO PmPack (PmPackID, PmPlanId, PackName, PackTypeId, Notes, BuilderCode, Quantity, ContractVal, TruedUp, Verified, StatusId, DateEntered, UserEntered)
               VALUES (@id, @plan, @name, @PackTypeId, @Notes, @BuilderCode, @Quantity, @ContractVal, 0, @Verified, @StatusId, GETDATE(), @u)`,
  { id: nid, plan: destPlanId, name: newName ?? k.PackName, PackTypeId: k.PackTypeId, Notes: k.Notes, BuilderCode: k.BuilderCode, Quantity: k.Quantity, ContractVal: k.ContractVal, Verified: keepVerified ? k.Verified : 0, StatusId: k.StatusId, u: who }, tx);
  const mats = await query(`SELECT m.*, i.CostCodeId, i.LaborCost, i.JobCostPrice, i.EstimatingPrice AS ItemEst FROM PmMaterial m LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE m.PmPackId = @id ORDER BY m.PmMatID`, { id: srcPackId }, tx);
  let mid = mats.length ? await nextId(tx, 'PmMaterial', 'PmMatID') : 0;
  for (const m of mats) {
    const labor = m.CostCodeId === 'L';
    await query(`INSERT INTO PmMaterial (PmMatID, PmPackId, InvItemId, Quantity, UnitCost, EstimatingPrice, StageId, WorkId, NoChange, Notes, StatusId, DateEntered, UserEntered)
                 VALUES (@id, @p, @InvItemId, @Quantity, @UnitCost, @EstimatingPrice, @StageId, @WorkId, @NoChange, @Notes, @StatusId, GETDATE(), @u)`,
    { id: mid++, p: nid, InvItemId: m.InvItemId, Quantity: m.Quantity, UnitCost: (labor ? m.LaborCost : m.JobCostPrice) ?? m.UnitCost, EstimatingPrice: (labor ? m.LaborCost : m.ItemEst) ?? m.EstimatingPrice,
      StageId: m.StageId, WorkId: m.WorkId, NoChange: m.NoChange, Notes: m.Notes, StatusId: m.StatusId, u: who }, tx);
  }
  const vals = await query('SELECT * FROM PmValue WHERE PmPackId = @id ORDER BY PmValueID', { id: srcPackId }, tx);
  let vid = vals.length ? await nextId(tx, 'PmValue', 'PmValueID') : 0;
  for (const v of vals) await query('INSERT INTO PmValue (PmValueID, PmPackId, WorkId, ScheduleStageId, [Value], UserEntered) VALUES (@id, @p, @w, @s, @v, @u)', { id: vid++, p: nid, w: v.WorkId, s: v.ScheduleStageId, v: v.Value, u: who }, tx);
  return { packId: nid, material: mats.length, values: vals.length };
}
async function copyPlan(tx, srcPlanId, destContractId, who, { contractVal, status, keepVerified }) {
  const p = (await query('SELECT * FROM PmPlan WHERE PmPlanID = @id', { id: srcPlanId }, tx))[0];
  const newNum = `${p.PlanNum ?? ''} new`.trim();
  if ((await query('SELECT 1 FROM PmPlan WHERE PmContractId = @c AND PlanNum = @n', { c: destContractId, n: newNum }, tx))[0]) throw bad(`The receiving bid already has a plan "${newNum}". Rename it first.`, 409);
  const nid = await nextId(tx, 'PmPlan', 'PmPlanID');
  await query(`INSERT INTO PmPlan (PmPlanID, PmContractId, PlanNum, PlanName, Bedrooms, ACunits, SqFt, TvOutlet, GrGearId, Island, FloorPlug, Detached, Universal, ContractVal, StatusId, DateEntered, UserEntered)
               VALUES (@id, @c, @n, @PlanName, @Bedrooms, @ACunits, @SqFt, @TvOutlet, @GrGearId, @Island, @FloorPlug, @Detached, @Universal, @ContractVal, @StatusId, GETDATE(), @u)`,
  { id: nid, c: destContractId, n: newNum, PlanName: p.PlanName, Bedrooms: p.Bedrooms, ACunits: p.ACunits, SqFt: p.SqFt, TvOutlet: p.TvOutlet, GrGearId: p.GrGearId, Island: p.Island, FloorPlug: p.FloorPlug,
    Detached: p.Detached, Universal: p.Universal, ContractVal: contractVal === 'copy' ? p.ContractVal : '$0.00', StatusId: status ?? p.StatusId, u: who }, tx);
  const packs = await query('SELECT PmPackID FROM PmPack WHERE PmPlanId = @id ORDER BY PmPackID', { id: srcPlanId }, tx);
  let mats = 0, vals = 0;
  for (const k of packs) { const r = await copyPack(tx, k.PmPackID, nid, null, who, { keepVerified }); mats += r.material; vals += r.values }
  return { planId: nid, planNum: newNum, packs: packs.length, material: mats, values: vals };
}
async function lockedBid(tx, contractId) {
  const c = (await query('SELECT PmContractID, Lock FROM PmContract WHERE PmContractID = @id', { id: contractId }, tx))[0];
  if (!c) throw bad('Receiving bid not found', 404);
  return !!c.Lock;
}
// Duplicate bid: every plan of FROM bid → TO bid (plans "x new", inactive, contract value copied)
router.post('/duplicate/bid', h(async (req, res) => {
  const from = int(req.body?.fromContractId), to = int(req.body?.toContractId);
  if (!from) throw bad('Complete the FROM BID field');
  if (!to) throw bad('Complete the TO BID field');
  if (from === to) throw bad('FROM and TO bid must be different');
  const out = await withTransaction(async (tx) => {
    const jobs = await query('SELECT PmContractID, PmJobId FROM PmContract WHERE PmContractID IN (@a, @b)', { a: from, b: to }, tx);
    if (jobs.length < 2) throw bad('Bid not found', 404);
    if (jobs[0].PmJobId !== jobs[1].PmJobId && !req.body.confirmOtherJob) throw Object.assign(bad('You are duplicating a bid from a different job. Let the contract department know.', 409), { needsConfirm: true });
    const plans = await query('SELECT PmPlanID FROM PmPlan WHERE PmContractId = @id ORDER BY PlanNum', { id: from }, tx);
    if (!plans.length) throw bad('The FROM bid has no plans to copy');
    const r = { plans: 0, packs: 0, material: 0, values: 0 };
    for (const p of plans) { const x = await copyPlan(tx, p.PmPlanID, to, user(req), { contractVal: 'copy', status: 2, keepVerified: true }); r.plans++; r.packs += x.packs; r.material += x.material; r.values += x.values }
    return r;
  });
  res.json(out);
}));
router.post('/duplicate/plan', h(async (req, res) => {
  const plan = int(req.body?.fromPlanId), to = int(req.body?.toContractId);
  if (!plan) throw bad('Complete the FROM PLAN field');
  if (!to) throw bad('Complete the TO BID field');
  const out = await withTransaction(async (tx) => {
    if (await lockedBid(tx, to)) throw bad('Bid receiving plan is locked, cannot transfer plan data. Please contact the contract department.', 409);
    if (!(await query('SELECT 1 FROM PmPlan WHERE PmPlanID = @id', { id: plan }, tx))[0]) throw bad('Plan not found', 404);
    return copyPlan(tx, plan, to, user(req), { contractVal: 'zero', keepVerified: false });
  });
  res.json(out);
}));
router.post('/duplicate/pack', h(async (req, res) => {
  const pack = int(req.body?.fromPackId), plan = int(req.body?.toPlanId);
  if (!pack) throw bad('Complete the FROM PACK field');
  if (!plan) throw bad('Complete the TO PLAN field');
  const out = await withTransaction(async (tx) => {
    const p = (await query('SELECT PmContractId FROM PmPlan WHERE PmPlanID = @id', { id: plan }, tx))[0];
    if (!p) throw bad('Receiving plan not found', 404);
    if (await lockedBid(tx, p.PmContractId)) throw bad('Bid receiving plan is locked, cannot transfer plan data. Please contact the contract department.', 409);
    const k = (await query('SELECT PackName FROM PmPack WHERE PmPackID = @id', { id: pack }, tx))[0];
    if (!k) throw bad('Pack not found', 404);
    const name = `${k.PackName} new`;
    if ((await query('SELECT 1 FROM PmPack WHERE PmPlanId = @p AND PackName = @n', { p: plan, n: name }, tx))[0]) throw bad(`The receiving plan already has a pack "${name}". Rename it first.`, 409);
    return copyPack(tx, pack, plan, name, user(req));
  });
  res.json(out);
}));

// Delete plan data (DmDeletePlan): refused when scheduled; returns the backup rows the user downloads first
router.get('/contracts/:id/plan-data', h(async (req, res) => {
  const id = int(req.params.id);
  res.json(await query(`SELECT c.Customer, j.Job, pc.BidNum, pc.BidDate, p.PlanNum, k.PackName, i.InvItem, m.Quantity, m.UnitCost, m.EstimatingPrice, m.StageId, m.WorkId, m.NoChange, m.Notes, m.StatusId, m.PmMatID
      FROM PmContract pc JOIN PmJob j ON j.PmJobID = pc.PmJobId JOIN PmCustomer c ON c.PmCustID = j.PmCustId JOIN PmPlan p ON p.PmContractId = pc.PmContractID
      JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN PmMaterial m ON m.PmPackId = k.PmPackID LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId
     WHERE pc.PmContractID = @id ORDER BY p.PlanNum, k.PackName`, { id }));
}));
router.post('/contracts/:id/delete-plan-data', h(async (req, res) => {
  const id = int(req.params.id);
  if (!req.body?.confirm) throw bad('Confirm the deletion');
  const out = await withTransaction(async (tx) => {
    const used = await query('SELECT COUNT(*) AS n FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE p.PmContractId = @id', { id }, tx);
    if (used[0].n) throw bad('Data cannot be deleted as it has already been scheduled', 409);
    const lots = await query('SELECT COUNT(*) AS n FROM JsLot l JOIN PmPlan p ON p.PmPlanID = l.PmPlanId WHERE p.PmContractId = @id', { id }, tx);
    if (lots[0].n) throw bad(`Plans of this bid are used by ${lots[0].n} lot(s); data cannot be deleted.`, 409);
    const m = await query('DELETE m FROM PmMaterial m JOIN PmPack k ON k.PmPackID = m.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE p.PmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    const v = await query('DELETE v FROM PmValue v JOIN PmPack k ON k.PmPackID = v.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE p.PmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    const k = await query('DELETE k FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE p.PmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    const p = await query('DELETE FROM PmPlan WHERE PmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    return { material: m[0].n, values: v[0].n, packs: k[0].n, plans: p[0].n };
  });
  res.json(out);
}));

router.get('/material-registry', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { pk: int(req.query.packId), offset: pg.offset, pageSize: pg.pageSize };
  const where = 'WHERE (@pk IS NULL OR r.PmPackId = @pk)';
  const [rows, total] = await Promise.all([
    query(`SELECT r.PmMatChangeID, r.Action, r.DateEdited, r.UserEdited, r.PmMatId, r.PmPackId, k.PackName, p.PlanNum, i.InvItem, r.Quantity, r.UnitCost, r.EstimatingPrice
             FROM PmMaterialChangeRegistry r LEFT JOIN IcItem i ON i.InvItemID = r.InvItemId LEFT JOIN PmPack k ON k.PmPackID = r.PmPackId LEFT JOIN PmPlan p ON p.PmPlanID = k.PmPlanId
             ${where} ORDER BY r.PmMatChangeID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM PmMaterialChangeRegistry r ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const need = (v, what) => { if (!v) throw bad(`Choose ${what}`); return v };
// Plan standard data (rptPlanStandardDataPM): standard packs of one plan, active packs + material
router.get('/reports/plan-standard', h(async (req, res) => {
  const plan = need(int(req.query.planId), 'a plan');
  res.json(await query(`SELECT c.Customer, j.Job, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, p.PlanNum, p.PlanName, p.SqFt, k.PackName, t.PackType, i.InvItem, i.Description, m.Quantity, m.UnitCost,
         m.Quantity * m.UnitCost AS ExtCost, s.Stage, w.WorkType, i.CostCodeId
      FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN LsPackType t ON t.PackTypeID = k.PackTypeId JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsStage s ON s.StageID = m.StageId JOIN LsWork w ON w.WorkID = m.WorkId
     WHERE t.PackType = 'Standard' AND p.PmPlanID = @p AND k.StatusId = 1 AND m.StatusId = 1 ORDER BY k.PackName, i.CostCodeId, s.Stage, i.InvItem`, { p: plan }));
}));
// Plan full data (PlanFullDataPM): every active pack + material of a bid
router.get('/reports/plan-full', h(async (req, res) => {
  const c = need(int(req.query.contractId), 'a bid');
  res.json(await query(`SELECT cu.Customer, j.Job, pc.BidNum, pc.BidRelease, pc.BidDate, p.PlanNum, p.PlanName, p.ACunits, p.SqFt, t.PackType, k.PackName, ss.ScheduleStage, w.WorkType, i.InvItem, i.Description, m.Quantity, m.NoChange, i.CostCodeId
      FROM PmCustomer cu JOIN PmJob j ON j.PmCustId = cu.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsStage s ON s.StageID = m.StageId JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId
      JOIN LsWork w ON w.WorkID = m.WorkId JOIN LsPackType t ON t.PackTypeID = k.PackTypeId
     WHERE pc.PmContractID = @c AND m.StatusId = 1 AND k.StatusId = 1 ORDER BY p.PlanNum, t.PackType, k.PackName, ss.ScheduleStage, w.WorkType, i.InvItem`, { c }));
}));
router.get('/reports/job-list', h(async (req, res) => {
  res.json(await query(`SELECT j.PmJobID, j.DivisionId, c.Customer, cs.Status AS CustomerStatus, j.Job, j.JobNumber, jt.JobType, j.SpecLevel, js.Status AS JobStatus
      FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId JOIN LsStatus cs ON cs.StatusID = c.StatusId JOIN LsStatus js ON js.StatusID = j.StatusId
     WHERE ISNULL(j.Template,0) = 0 AND (@d IS NULL OR j.DivisionId = @d) ORDER BY j.DivisionId, c.Customer, j.Job`, { d: req.query.division || null }));
}));
router.get('/reports/active-plans', h(async (req, res) => {
  const d = need(req.query.division, 'a division');
  res.json(await query(`SELECT dv.DivisionID, dv.DivisionName, c.Customer, j.Job, pc.BidNum, p.PmPlanID, p.PlanNum, p.PlanName, p.Notes
      FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN LsDivision dv ON dv.DivisionID = j.DivisionId
     WHERE dv.DivisionID = @d AND ISNULL(j.Template,0) = 0 AND j.StatusId = 1 AND pc.StatusId = 1 AND ISNULL(p.Universal,0) = 0 AND p.StatusId = 1 ORDER BY c.Customer, j.Job, pc.BidNum, p.PlanNum`, { d }));
}));
router.get('/reports/standard-prices', h(async (req, res) => {
  const c = need(int(req.query.customerId), 'a customer');
  const rows = await query(`SELECT cu.Customer, j.Job, p.PlanNum, pc.BidNum, ${MV('p.ContractVal')} AS ContractVal,
         SUM(CASE WHEN i.CostCodeId <> 'L' THEN k.Quantity * m.Quantity * m.UnitCost ELSE 0 END) AS Material,
         SUM(CASE WHEN i.CostCodeId = 'L' THEN k.Quantity * m.Quantity * m.UnitCost ELSE 0 END) AS Labor,
         SUM(k.Quantity * m.Quantity * m.UnitCost) AS Cost
      FROM PmCustomer cu JOIN PmJob j ON j.PmCustId = cu.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID
      JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
     WHERE p.StatusId = 1 AND k.PackTypeId = 1 AND j.StatusId = 1 AND cu.PmCustID = @c
     GROUP BY cu.Customer, j.Job, p.PlanNum, pc.BidNum, ${MV('p.ContractVal')} ORDER BY j.Job, pc.BidNum, p.PlanNum`, { c });
  for (const r of rows) r.Profit = Number(r.ContractVal || 0) - Number(r.Cost || 0);
  res.json(rows);
}));
router.get('/reports/option-prices', h(async (req, res) => {
  const c = need(int(req.query.customerId), 'a customer');
  // rptPmCustomerOptionPrice: latest bid (MAX BidNum) per job/plan/pack; material = M items, labor = L items
  const rows = await query(`WITH x AS (
      SELECT cu.Customer, k.PackName, ${MV('k.ContractVal')} AS ContractVal, j.Job, p.PlanNum, MAX(pc.BidNum) AS MaxOfBidNum, m.Quantity, m.UnitCost, i.CostCodeId
        FROM IcItem i JOIN PmMaterial m ON m.InvItemId = i.InvItemID JOIN PmPack k ON k.PmPackID = m.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId
        JOIN PmContract pc ON pc.PmContractID = p.PmContractId JOIN PmJob j ON j.PmJobID = pc.PmJobId JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId
       WHERE k.PackTypeId > 1 AND p.StatusId = 1 AND k.StatusId = 1 AND ISNULL(j.Template,0) = 0 AND cu.PmCustID = @c
       GROUP BY cu.Customer, k.PackName, ${MV('k.ContractVal')}, j.Job, p.PlanNum, m.Quantity, m.UnitCost, i.CostCodeId)
    SELECT Customer, PackName, Job, MaxOfBidNum, PlanNum, ContractVal,
           SUM(CASE WHEN CostCodeId = 'M' THEN UnitCost * Quantity ELSE 0 END) AS Material, SUM(CASE WHEN CostCodeId = 'L' THEN UnitCost * Quantity ELSE 0 END) AS Labor,
           SUM(Quantity * UnitCost) AS Cost
      FROM x GROUP BY Customer, PackName, Job, MaxOfBidNum, PlanNum, ContractVal ORDER BY Job, PlanNum, PackName`, { c });
  for (const r of rows) r.Profit = Number(r.ContractVal || 0) - Number(r.Cost || 0);
  res.json(rows);
}));
// Bid cost per bid / per customer (PmJcBid, PmJcCustomer, PmJcBidJcCurrentPrice): plan × cost code × work, standard packs, active plans
router.get('/reports/bid-cost', h(async (req, res) => {
  const scope = req.query.scope === 'customer' ? 'customer' : 'bid';
  const current = req.query.price === 'current';
  const c = need(int(req.query.customerId), 'a customer');
  const p = { c, j: int(req.query.jobId), b: int(req.query.contractId) };
  if (scope === 'bid' && (!p.j || !p.b)) throw bad('Choose the job and the bid');
  const rows = await query(`SELECT j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, p.PmPlanID, p.PlanNum, p.PlanName, p.SqFt, ${MV('p.ContractVal')} AS ContractVal,
         cc.Description AS CostCode, i.CostCodeId, w.WorkType, SUM(k.Quantity * m.Quantity * ${current ? 'i.JobCostPrice' : 'm.UnitCost'}) AS ExtCost
      FROM PmCustomer cu JOIN PmJob j ON j.PmCustId = cu.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      LEFT JOIN PmMaterial m ON m.PmPackId = k.PmPackID LEFT JOIN LsWork w ON w.WorkID = m.WorkId LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId LEFT JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId
     WHERE k.PackTypeId = 1 AND p.StatusId = 1 AND (m.StatusId IS NULL OR m.StatusId = 1) AND cu.PmCustID = @c AND cc.Description IS NOT NULL
       ${scope === 'bid' ? 'AND j.PmJobID = @j AND pc.PmContractID = @b' : 'AND ISNULL(j.Template,0) = 0 AND j.StatusId = 1'}
     GROUP BY j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, p.PmPlanID, p.PlanNum, p.PlanName, p.SqFt, ${MV('p.ContractVal')}, cc.Description, i.CostCodeId, w.WorkType
     ORDER BY j.Job, pc.BidNum, p.PlanNum, i.CostCodeId, w.WorkType`, p);
  // roll up per plan for the summary columns
  const plans = new Map();
  for (const r of rows) {
    const k = r.PmPlanID;
    if (!plans.has(k)) plans.set(k, { PmPlanID: k, Job: r.Job, DivisionId: r.DivisionId, BidNum: r.BidNum, BidRelease: r.BidRelease, PlanNum: r.PlanNum, PlanName: r.PlanName, SqFt: r.SqFt, ContractVal: Number(r.ContractVal || 0), Labor: 0, Material: 0, Other: 0, lines: [] });
    const pl = plans.get(k); const x = Number(r.ExtCost || 0);
    if (r.CostCodeId === 'L') pl.Labor += x; else if (r.CostCodeId === 'M' || r.CostCodeId === 'NT') pl.Material += x; else pl.Other += x;
    pl.lines.push({ CostCode: r.CostCode, CostCodeId: r.CostCodeId, WorkType: r.WorkType, ExtCost: x });
  }
  const out = [...plans.values()].map((pl) => ({ ...pl, Cost: pl.Labor + pl.Material + pl.Other, Profit: pl.ContractVal - (pl.Labor + pl.Material + pl.Other), PerSqFt: pl.SqFt ? (pl.Labor + pl.Material + pl.Other) / pl.SqFt : null }));
  res.json(out);
}));
// Bid cost per plan (PmJcPlan): every standard material line of one plan
router.get('/reports/plan-cost', h(async (req, res) => {
  const plan = need(int(req.query.planId), 'a plan');
  res.json(await query(`SELECT k.PackName, k.Quantity AS PackQty, ${MV('k.ContractVal')} AS PackValue, cc.Description AS CostCode, w.WorkType, i.InvItem, i.Description, m.Quantity, m.UnitCost, k.Quantity * m.Quantity * m.UnitCost AS ExtCost
      FROM PmPlan p JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN LsWork w ON w.WorkID = m.WorkId JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId
     WHERE p.PmPlanID = @p AND k.PackTypeId = 1 AND (m.StatusId IS NULL OR m.StatusId = 1) ORDER BY k.PackName, cc.Description, w.WorkType, i.InvItem`, { p: plan }));
}));
// Pack search by name / builder code / words in a division
router.get('/reports/pack-search', h(async (req, res) => {
  const d = need(req.query.division, 'a division');
  const name = str(req.query.name), code = str(req.query.code), words = str(req.query.words);
  if (!name && !code && !words) throw bad('Enter a pack name, a pack code or words to search for');
  res.json(await query(`SELECT TOP 1000 c.Customer, j.Job, pc.BidNum, p.PlanNum, k.PmPackID, k.PackName, k.BuilderCode, j.DivisionId, pc.PmContractID, p.PmPlanID
      FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
     WHERE j.DivisionId = @d AND (@name IS NULL OR k.PackName = @name) AND (@code IS NULL OR k.BuilderCode = @code) AND (@w IS NULL OR k.PackName LIKE @w)
     ORDER BY c.Customer, j.Job, pc.BidNum, p.PlanNum, k.PackName`, { d, name, code, w: words ? `%${words}%` : null }));
}));
router.get('/reports/pack-names', h(async (req, res) => {
  const d = need(req.query.division, 'a division');
  res.json(await query(`SELECT k.PackName AS id, k.PackName AS name, COUNT(*) AS n FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId JOIN PmContract pc ON pc.PmContractID = p.PmContractId JOIN PmJob j ON j.PmJobID = pc.PmJobId
     WHERE j.DivisionId = @d GROUP BY k.PackName ORDER BY k.PackName`, { d }));
}));
// Wire price check (rptPmWirePriceCheck): latest bid of each active production job, wire in standard packs vs item prices
router.get('/reports/wire-prices', h(async (req, res) => {
  const d = need(req.query.division, 'a division');
  res.json(await query(`WITH lb AS (SELECT j.DivisionId, c.Customer, j.Job, j.PmJobID, MAX(pc.BidNum) AS MaxOfBidNum
                FROM PmCustomer c JOIN PmJob j ON j.PmCustId = c.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID
               WHERE ISNULL(j.Template,0) = 0 AND j.StatusId = 1 AND j.JobTypeId IN (1,3) AND j.DivisionId = @d GROUP BY j.DivisionId, c.Customer, j.Job, j.PmJobID)
    SELECT lb.DivisionId, lb.Customer, lb.Job, lb.MaxOfBidNum, i.InvItem, i.Description, m.UnitCost AS BidPrice, i.JobCostPrice, i.LastCost
      FROM lb JOIN PmContract pc ON pc.BidNum = lb.MaxOfBidNum AND pc.PmJobId = lb.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE ic.InvClass = 'wire' AND k.PackName LIKE 'standar%' AND ISNULL(p.Universal,0) = 0
     GROUP BY lb.DivisionId, lb.Customer, lb.Job, lb.MaxOfBidNum, i.InvItem, i.Description, m.UnitCost, i.JobCostPrice, i.LastCost
     ORDER BY lb.Customer, lb.Job, i.InvItem`, { d }));
}));

module.exports = router;
