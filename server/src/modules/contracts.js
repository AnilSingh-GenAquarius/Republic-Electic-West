// Contract management (CM) — Access SwitchCM: the contract / addendum register per PM job (CmContract + diary + links to
// estimating bids), the bid contract-value screen (CmContractVal: plan → pack → stage/work breakdown, with the pack and plan
// "check your math" warnings), revised contract values of a scheduled lot (CmRevContract), the two bulk actions
// (Set contract values, Update lot contract values), the option picker report (CmOptionSelect) and the CM reports.
//
// Access rules reproduced:
//   * pack check (frmContractValCheckPack): sum of the pack's PmValue breakdown must equal the pack contract value; skipped
//     when the pack value is 0. Plan check (frmContractValCheckPlan): sum of STANDARD (PackTypeId 1) pack values must equal
//     the plan contract value; skipped when the plan value is 0. Warnings only — Access let the save stand.
//   * Set contract values (CmSetContractVal): every pack with no value gets the sum of its breakdown; then every plan with
//     no value gets the sum of its standard packs (when > 0). Runs across ALL bids, like Access.
//   * Update lot contract values (CmUpdateContractVal, scoped to one bid): open lots (EndDate null) get the plan value, their
//     packs the pack value and the breakdown the PmValue value; missing breakdown rows are added; breakdown rows that no
//     longer exist in the bid's PmValue are removed (all lots of the bid, as Access did).
//   * Revised contract values: a closed lot (EndDate set) can't be modified ("open it first").
//   * Latest changes report: prints the contracts flagged "latest print" in a division, then clears the flags.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { h, paging } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const bit = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === -1 ? 1 : 0);
const str = (v, max) => { if (v == null) return null; const s = String(v).trim(); if (!s) return null; if (max && s.length > max) throw bad(`Text is too long (max ${max} characters)`); return s };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmtMoney = (n) => (Number(n) < 0 ? `($${Math.abs(r2(n)).toFixed(2)})` : `$${r2(n).toFixed(2)}`);
// money columns are nvarchar ("$1234.00" / "($5.00)") in this database: parse them in SQL
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,4))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,4)) END)`;
function moneyIn(v, label) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  if (isNaN(n)) throw bad(`${label} must be an amount`);
  return fmtMoney(n);
}
const user = (req) => req.user?.username || 'web';
const need = (v, what) => { if (v == null || v === '') throw bad(`Choose ${what}`); return v };
async function patch(table, idCol, id, o, tx) {
  const keys = Object.keys(o);
  if (!keys.length) return 1;
  const r = await query(`UPDATE ${table} SET ${keys.map((k) => `[${k}] = @${k}`).join(', ')} WHERE ${idCol} = @__id; SELECT @@ROWCOUNT AS n`, { ...o, __id: id }, tx);
  return r[0]?.n ?? 0;
}
function dateRange(q) {
  const from = isoDate(q.from), to = isoDate(q.to);
  if (!from || !to) throw bad('Enter the From and To dates');
  if (from > to) throw bad('From date must be before the To date');
  return { from, to };
}

// ---------------------------------------------------------------------------
// Lookups & switchboard filters (SwitchCM combos)
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [statuses, jobTypes, divisions, jurisdictions, contractTypes, works, scheduleStages, packTypes] = await Promise.all([
    query('SELECT StatusID AS id, Status AS name FROM LsStatus ORDER BY Status'),
    query('SELECT JobTypeID AS id, JobType AS name FROM LsJobType ORDER BY JobType'),
    query("SELECT DivisionID AS id, DivisionID + ISNULL(' – ' + DivisionName,'') AS name FROM LsDivision ORDER BY DivisionID"),
    query("SELECT JurisdictionID AS id, Jurisdiction + ISNULL(' (' + State + ')','') AS name FROM LsJurisdiction ORDER BY State, Jurisdiction"),
    query('SELECT TypeID AS id, Type AS name FROM LsContractType ORDER BY Type'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT PackTypeID AS id, PackType AS name, Std, Opt FROM LsPackType ORDER BY PackType'),
  ]);
  res.json({ statuses, jobTypes, divisions, jurisdictions, contractTypes, works, scheduleStages, packTypes });
}));
// PM side: customer → job → bid (cboCustomerPM / cboJobPM / cboContractPM)
router.get('/pick/pm-customers', h(async (req, res) => {
  res.json(await query('SELECT PmCustID AS id, Customer AS name FROM PmCustomer ORDER BY Customer'));
}));
router.get('/pick/pm-jobs', h(async (req, res) => {
  const c = int(req.query.customerId);
  if (!c) return res.json([]);
  res.json(await query(`SELECT PmJobID AS id, Job + ISNULL(' (' + DivisionId + ')','') + ISNULL(' #' + JobNumber,'') AS name, DivisionId FROM PmJob
     WHERE PmCustId = @c ORDER BY Job, DivisionId`, { c }));
}));
router.get('/pick/pm-bids', h(async (req, res) => {
  const j = int(req.query.jobId);
  if (!j) return res.json([]);
  res.json(await query(`SELECT PmContractID AS id, ISNULL(BidNum,'') + ISNULL(' ' + BidRelease,'') + ISNULL(' – ' + BidName,'') AS name, BidDate, Lock FROM PmContract
     WHERE PmJobId = @j ORDER BY BidNum`, { j }));
}));
// JS side: customer → job → phase / lot (cboCustomerJS / cboJobJS / cboPhaseJs / cboLotJS)
router.get('/pick/js-customers', h(async (req, res) => {
  res.json(await query('SELECT CustID AS id, CustName AS name FROM JsCustomer ORDER BY CustName'));
}));
router.get('/pick/js-jobs', h(async (req, res) => {
  const c = int(req.query.customerId);
  if (!c) return res.json([]);
  res.json(await query(`SELECT JobId AS id, JobName + ISNULL(' #' + CAST(JobNum AS nvarchar(20)),'') + ISNULL(' (' + DivisionId + ')','') AS name FROM JsJob
     WHERE CustId = @c ORDER BY JobName, DivisionId`, { c }));
}));
router.get('/pick/js-phases', h(async (req, res) => {
  const j = int(req.query.jobId);
  if (!j) return res.json([]);
  res.json(await query(`SELECT PhaseID AS id, Phase + ISNULL(' (' + PhaseNum + ')','') AS name, StartDate FROM JsPhase WHERE JobId = @j ORDER BY Phase`, { j }));
}));
router.get('/pick/js-lots', h(async (req, res) => {
  const j = int(req.query.jobId);
  if (!j) return res.json([]);
  res.json(await query(`SELECT l.LotID AS id, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') + ISNULL(' · ' + ph.Phase,'') AS name, l.StartDate, l.EndDate
     FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId WHERE l.JobId = @j ORDER BY ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'')`, { j }));
}));

router.get('/overview', h(async (req, res) => {
  const [counts, recent, due] = await Promise.all([
    query(`SELECT (SELECT COUNT(*) FROM CmContract) AS contracts,
                  (SELECT COUNT(*) FROM CmContract WHERE ISNULL(Executed,0) = 0) AS notExecuted,
                  (SELECT COUNT(*) FROM CmContract WHERE LatestPrint = 1) AS latest,
                  (SELECT COUNT(*) FROM PmJob j WHERE ISNULL(j.Template,0) = 0 AND NOT EXISTS (SELECT 1 FROM CmContract c WHERE c.PmJobId = j.PmJobID)) AS jobsNoContract,
                  (SELECT COUNT(*) FROM CmDiary WHERE DueDate >= CAST(GETDATE() AS date) AND DueDate < DATEADD(day, 8, CAST(GETDATE() AS date))) AS dueThisWeek,
                  (SELECT COUNT(*) FROM PmPlan p JOIN PmContract pc ON pc.PmContractID = p.PmContractId JOIN PmJob j ON j.PmJobID = pc.PmJobId
                    WHERE ISNULL(${MV('p.ContractVal')},0) = 0 AND j.StatusId = 1 AND ISNULL(p.Universal,0) = 0 AND ISNULL(j.Template,0) = 0 AND p.StatusId = 1) AS plansNoValue`),
    query(`SELECT TOP 8 c.CmContractID, c.PmJobId, c.ContractNumber, c.AddendumNumber, c.WorkAgreeNum, t.Type, c.EffectiveDate, c.Executed, c.DateEntered, j.Job, j.DivisionId, cu.Customer
             FROM CmContract c JOIN PmJob j ON j.PmJobID = c.PmJobId JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId LEFT JOIN LsContractType t ON t.TypeID = c.TypeId
            ORDER BY c.DateEntered DESC, c.CmContractID DESC`),
    query(`SELECT TOP 8 d.CmDiaryID, d.DueDate, d.Contact, d.Notes, c.CmContractID, c.PmJobId, c.ContractNumber, c.AddendumNumber, j.Job
             FROM CmDiary d JOIN CmContract c ON c.CmContractID = d.CmContractId JOIN PmJob j ON j.PmJobID = c.PmJobId
            WHERE d.DueDate >= DATEADD(day, -30, CAST(GETDATE() AS date)) ORDER BY d.DueDate`),
  ]);
  res.json({ ...counts[0], recent, due });
}));

// ---------------------------------------------------------------------------
// Contract management (Access CmContract: PM job → contracts/addenda → diary + links to estimating bids)
// ---------------------------------------------------------------------------
// "Go to job" list: non-template PM jobs
router.get('/jobs', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, d: req.query.division || null, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE ISNULL(j.Template,0) = 0 AND (@s IS NULL OR j.Job LIKE @s OR cu.Customer LIKE @s OR j.JobNumber LIKE @s) AND (@d IS NULL OR j.DivisionId = @d)`;
  const [rows, total] = await Promise.all([
    query(`SELECT j.PmJobID, j.Job, j.JobNumber, j.DivisionId, cu.Customer, st.Status,
                  (SELECT COUNT(*) FROM CmContract c WHERE c.PmJobId = j.PmJobID) AS Contracts,
                  (SELECT COUNT(*) FROM CmContract c WHERE c.PmJobId = j.PmJobID AND ISNULL(c.Executed,0) = 0) AS NotExecuted
             FROM PmJob j JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId
             ${where} ORDER BY j.Job, j.DivisionId OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM PmJob j JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [job, contracts, bids] = await Promise.all([
    query(`SELECT j.PmJobID, j.PmCustId, cu.Customer, j.Job, j.JobNumber, j.JobTypeId, j.SpecLevel, j.JurisdictionId, j.DivisionId, j.Address, j.City, j.State, j.Zip,
                  j.EstStartDate, j.EstEndDate, j.UnitQty, j.Notes, j.StatusId, j.Template
             FROM PmJob j JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId WHERE j.PmJobID = @id`, { id }),
    query(`SELECT c.*, t.Type, (SELECT COUNT(*) FROM CmDiary d WHERE d.CmContractId = c.CmContractID) AS Diary,
                  (SELECT COUNT(*) FROM CmContractPmLink l WHERE l.CmContractId = c.CmContractID) AS Links
             FROM CmContract c LEFT JOIN LsContractType t ON t.TypeID = c.TypeId WHERE c.PmJobId = @id
            ORDER BY t.Type, c.AddendumNumber, c.WorkAgreeNum, c.CmContractID`, { id }),
    query(`SELECT PmContractID AS id, ISNULL(BidNum,'') + ' - ' + ISNULL(BidName,'') AS name, BidRelease, BidDate FROM PmContract WHERE PmJobId = @id ORDER BY BidNum`, { id }),
  ]);
  if (!job[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: job[0], contracts, bids });
}));
// Job fields editable on CmContract (Job name and customer are locked there)
router.put('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  for (const [k, max] of [['JobNumber', 50], ['Address', 255], ['City', 50], ['State', 50], ['Zip', 255]]) if (k in b) o[k] = str(b[k], max);
  for (const k of ['EstStartDate', 'EstEndDate']) if (k in b) { o[k] = isoDate(b[k]); if (b[k] && !o[k]) throw bad('Enter a valid date') }
  if (o.EstStartDate || o.EstEndDate) {
    const cur = (await query('SELECT CONVERT(char(10), EstStartDate, 23) AS s, CONVERT(char(10), EstEndDate, 23) AS e FROM PmJob WHERE PmJobID = @id', { id }))[0] || {};
    const s = 'EstStartDate' in o ? o.EstStartDate : cur.s, e = 'EstEndDate' in o ? o.EstEndDate : cur.e;
    if (s && e && e < s) throw bad('Est end date must be after the est start date');
  }
  if ('UnitQty' in b) { o.UnitQty = int(b.UnitQty); if (b.UnitQty !== '' && b.UnitQty != null && (o.UnitQty == null || o.UnitQty < 0)) throw bad('Unit qty must be a whole number') }
  if ('JobTypeId' in b) { o.JobTypeId = int(b.JobTypeId); if (!o.JobTypeId) throw bad('Choose the job type') }
  if ('JurisdictionId' in b) o.JurisdictionId = int(b.JurisdictionId);
  if ('DivisionId' in b) { o.DivisionId = str(b.DivisionId, 50); if (!o.DivisionId) throw bad('Choose the division') }
  if ('StatusId' in b) { o.StatusId = int(b.StatusId); if (!o.StatusId) throw bad('Choose the status') }
  if (!(await patch('PmJob', 'PmJobID', id, o))) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true });
}));

function contractBody(b) {
  const o = {};
  for (const k of ['ContractNumber', 'WorkAgreeNum', 'AddendumNumber', 'Description', 'EffectivePhase', 'Notes']) if (k in b) o[k] = str(b[k], 255);
  if ('TypeId' in b) o.TypeId = int(b.TypeId);
  if ('EffectiveDate' in b) { o.EffectiveDate = isoDate(b.EffectiveDate); if (b.EffectiveDate && !o.EffectiveDate) throw bad('Enter a valid effective date') }
  for (const k of ['Executed', 'LatestPrint']) if (k in b) o[k] = bit(b[k]);
  return o;
}
router.post('/jobs/:id/contracts', h(async (req, res) => {
  const job = int(req.params.id), o = contractBody(req.body || {});
  if (!o.TypeId) throw bad('Choose the contract type');
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM PmJob WHERE PmJobID = @j', { j: job }, tx))[0]) throw bad('Job not found', 404);
    const nid = await nextId(tx, 'CmContract', 'CmContractID');
    const cols = { CmContractID: nid, PmJobId: job, Executed: 0, LatestPrint: 0, ...o, ContractEntry: 1, UserEntered: user(req) };
    await query(`INSERT INTO CmContract (${Object.keys(cols).map((k) => `[${k}]`).join(', ')}, DateEntered) VALUES (${Object.keys(cols).map((k) => `@${k}`).join(', ')}, GETDATE())`, cols, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.get('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [c, diary, links] = await Promise.all([
    query('SELECT c.*, t.Type, j.Job, j.DivisionId FROM CmContract c LEFT JOIN LsContractType t ON t.TypeID = c.TypeId LEFT JOIN PmJob j ON j.PmJobID = c.PmJobId WHERE c.CmContractID = @id', { id }),
    query('SELECT CmDiaryID, CmContractId, [Date], Contact, Notes, DueDate, LinkFile, DateEntered, UserEntered FROM CmDiary WHERE CmContractId = @id ORDER BY [Date], CmDiaryID', { id }),
    query(`SELECT l.CmLinkPmID, l.CmContractId, l.PmContractId, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate FROM CmContractPmLink l LEFT JOIN PmContract pc ON pc.PmContractID = l.PmContractId
            WHERE l.CmContractId = @id ORDER BY l.PmContractId`, { id }),
  ]);
  if (!c[0]) return res.status(404).json({ error: 'Contract not found' });
  res.json({ contract: c[0], diary, links });
}));
router.put('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id), o = contractBody(req.body || {});
  if ('TypeId' in o && !o.TypeId) throw bad('Choose the contract type');
  if (!(await patch('CmContract', 'CmContractID', id, o))) return res.status(404).json({ error: 'Contract not found' });
  res.json({ ok: true });
}));
router.delete('/contracts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM CmContract WHERE CmContractID = @id', { id }, tx))[0]) throw bad('Contract not found', 404);
    const d = await query('DELETE FROM CmDiary WHERE CmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    const l = await query('DELETE FROM CmContractPmLink WHERE CmContractId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    await query('DELETE FROM CmContract WHERE CmContractID = @id', { id }, tx);
    return { diary: d[0].n, links: l[0].n };
  });
  res.json({ ok: true, ...out });
}));

// Diary (CmContractSubDiary): Date defaults to today, DueDate to today + 7
function diaryBody(b, partial) {
  const o = {};
  for (const k of ['Date', 'DueDate']) if (k in b) { o[k] = isoDate(b[k]); if (b[k] && !o[k]) throw bad('Enter a valid date') }
  if ('Contact' in b) o.Contact = str(b.Contact, 255);
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if ('LinkFile' in b) o.LinkFile = str(b.LinkFile, 255);
  if (!partial && !o.Contact && !o.Notes) throw bad('Enter the contact or the notes');
  return o;
}
router.post('/contracts/:id/diary', h(async (req, res) => {
  const cid = int(req.params.id), o = diaryBody(req.body || {}, false);
  const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM CmContract WHERE CmContractID = @c', { c: cid }, tx))[0]) throw bad('Contract not found', 404);
    const nid = await nextId(tx, 'CmDiary', 'CmDiaryID');
    await query(`INSERT INTO CmDiary (CmDiaryID, CmContractId, [Date], Contact, Notes, DueDate, LinkFile, DateEntered, UserEntered)
                 VALUES (@id, @c, @Date, @Contact, @Notes, @DueDate, @LinkFile, GETDATE(), @u)`,
    { id: nid, c: cid, Date: o.Date || iso(today), Contact: o.Contact ?? null, Notes: o.Notes ?? null, DueDate: 'DueDate' in o ? o.DueDate : iso(new Date(today.getTime() + 7 * 864e5)), LinkFile: o.LinkFile ?? null, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/diary/:id', h(async (req, res) => {
  const id = int(req.params.id), o = diaryBody(req.body || {}, true);
  if (!(await patch('CmDiary', 'CmDiaryID', id, o))) return res.status(404).json({ error: 'Diary entry not found' });
  res.json({ ok: true });
}));
router.delete('/diary/:id', h(async (req, res) => {
  const r = await query('DELETE FROM CmDiary WHERE CmDiaryID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) });
  if (!r[0].n) return res.status(404).json({ error: 'Diary entry not found' });
  res.json({ ok: true });
}));

// Links to estimating bids (CmContractSubLink): only bids of the contract's own job
async function checkLinkBid(tx, cmContractId, pmContractId, exceptId) {
  if (!pmContractId) throw bad('Choose the bid');
  const ok = await query('SELECT 1 FROM CmContract c JOIN PmContract pc ON pc.PmJobId = c.PmJobId WHERE c.CmContractID = @c AND pc.PmContractID = @p', { c: cmContractId, p: pmContractId }, tx);
  if (!ok[0]) throw bad('The bid must belong to the same job as the contract');
  const dup = await query('SELECT 1 FROM CmContractPmLink WHERE CmContractId = @c AND PmContractId = @p AND (@x IS NULL OR CmLinkPmID <> @x)', { c: cmContractId, p: pmContractId, x: exceptId ?? null }, tx);
  if (dup[0]) throw bad('This bid is already linked to the contract', 409);
}
router.post('/contracts/:id/links', h(async (req, res) => {
  const cid = int(req.params.id), pid = int(req.body?.PmContractId);
  const id = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 FROM CmContract WHERE CmContractID = @c', { c: cid }, tx))[0]) throw bad('Contract not found', 404);
    await checkLinkBid(tx, cid, pid);
    const nid = await nextId(tx, 'CmContractPmLink', 'CmLinkPmID');
    await query('INSERT INTO CmContractPmLink (CmLinkPmID, CmContractId, PmContractId) VALUES (@id, @c, @p)', { id: nid, c: cid, p: pid }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/links/:id', h(async (req, res) => {
  const id = int(req.params.id), pid = int(req.body?.PmContractId);
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT CmContractId FROM CmContractPmLink WHERE CmLinkPmID = @id', { id }, tx))[0];
    if (!cur) throw bad('Link not found', 404);
    await checkLinkBid(tx, cur.CmContractId, pid, id);
    await query('UPDATE CmContractPmLink SET PmContractId = @p WHERE CmLinkPmID = @id', { id, p: pid }, tx);
  });
  res.json({ ok: true });
}));
router.delete('/links/:id', h(async (req, res) => {
  const r = await query('DELETE FROM CmContractPmLink WHERE CmLinkPmID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) });
  if (!r[0].n) return res.status(404).json({ error: 'Link not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Contract values of a bid (Access CmContractVal: bid header → plans → packs → stage/work breakdown)
// ---------------------------------------------------------------------------
const cents = (n) => Math.round(Number(n || 0) * 100);
// frmContractValCheckPack: the breakdown must add up to the pack value (skipped when the pack value is 0 or it has no breakdown)
function packCheck(pack, values) {
  const mine = values.filter((v) => v.PmPackId === pack.PmPackID);
  if (!mine.length || !cents(pack.ContractVal)) return null;
  const sum = mine.reduce((a, v) => a + Number(v.Value || 0), 0);
  return cents(sum) === cents(pack.ContractVal) ? null : { PmPackID: pack.PmPackID, PackName: pack.PackName, ContractVal: Number(pack.ContractVal || 0), SumOfValue: sum };
}
// frmContractValCheckPlan: standard packs must add up to the plan value (skipped when the plan value is 0 or it has no standard pack)
function planCheck(plan, packs) {
  const std = packs.filter((k) => k.PmPlanId === plan.PmPlanID && k.PackTypeId === 1);
  if (!std.length || !cents(plan.ContractVal)) return null;
  const sum = std.reduce((a, k) => a + Number(k.ContractVal || 0), 0);
  return cents(sum) === cents(plan.ContractVal) ? null : { PmPlanID: plan.PmPlanID, PlanNum: plan.PlanNum, ContractVal: Number(plan.ContractVal || 0), SumOfContractVal: sum };
}
async function bidValues(id, tx) {
  const [head, plans, packs, values] = await Promise.all([
    query(`SELECT cu.PmCustID, cu.Customer, j.PmJobID, j.Job, j.JobTypeId, jt.JobType, j.DivisionId, j.Notes AS JobNotes, j.StatusId AS JobStatusId, js.Status AS JobStatus, j.JobNumber,
                  pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, pc.Notes, pc.StatusId, st.Status, pc.Lock, pc.TrueUpDate, pc.EsBidIDLink
             FROM PmCustomer cu JOIN PmJob j ON j.PmCustId = cu.PmCustID JOIN PmContract pc ON pc.PmJobId = j.PmJobID LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
             LEFT JOIN LsStatus js ON js.StatusID = j.StatusId LEFT JOIN LsStatus st ON st.StatusID = pc.StatusId WHERE pc.PmContractID = @id`, { id }, tx),
    query(`SELECT p.PmPlanID, p.PlanNum, p.PlanName, p.SqFt, ${MV('p.ContractVal')} AS ContractVal, p.Universal, p.StatusId,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PmPlanId = p.PmPlanID) AS Lots
             FROM PmPlan p WHERE p.PmContractId = @id ORDER BY p.PlanNum`, { id }, tx),
    query(`SELECT k.PmPackID, k.PmPlanId, k.PackName, k.BuilderCode, k.Quantity, ${MV('k.ContractVal')} AS ContractVal, ${MV('k.ContractValCost')} AS ContractValCost,
                  k.StatusId, st.Status, k.PackTypeId, t.PackType, k.TruedUp
             FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId LEFT JOIN LsStatus st ON st.StatusID = k.StatusId LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId
            WHERE p.PmContractId = @id ORDER BY k.BuilderCode, k.PackTypeId, k.PackName`, { id }, tx),
    query(`SELECT v.PmValueID, v.PmPackId, ${MV('v.Value')} AS Value, v.WorkId, w.WorkType, v.ScheduleStageId, ss.ScheduleStage
             FROM PmValue v JOIN PmPack k ON k.PmPackID = v.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId
             LEFT JOIN LsWork w ON w.WorkID = v.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = v.ScheduleStageId
            WHERE p.PmContractId = @id ORDER BY v.WorkId, v.PmValueID`, { id }, tx),
  ]);
  if (!head[0]) return null;
  const checks = { packs: packs.map((k) => packCheck(k, values)).filter(Boolean), plans: plans.map((p) => planCheck(p, packs)).filter(Boolean) };
  return { bid: head[0], plans, packs, values, checks };
}
router.get('/bids/:id/values', h(async (req, res) => {
  const d = await bidValues(int(req.params.id));
  if (!d) return res.status(404).json({ error: 'Bid not found' });
  res.json(d);
}));
// Header fields editable on CmContractVal: bid notes / status / lock / true-up date and the job number
router.put('/bids/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('Notes' in b) o.Notes = str(b.Notes, 255);
  if ('StatusId' in b) { o.StatusId = int(b.StatusId); if (!o.StatusId) throw bad('Choose the bid status') }
  if ('Lock' in b) o.Lock = bit(b.Lock);
  if ('TrueUpDate' in b) { o.TrueUpDate = isoDate(b.TrueUpDate); if (b.TrueUpDate && !o.TrueUpDate) throw bad('Enter a valid true up date') }
  await withTransaction(async (tx) => {
    const cur = (await query('SELECT PmJobId FROM PmContract WHERE PmContractID = @id', { id }, tx))[0];
    if (!cur) throw bad('Bid not found', 404);
    await patch('PmContract', 'PmContractID', id, o, tx);
    if ('JobNumber' in b) await query('UPDATE PmJob SET JobNumber = @n WHERE PmJobID = @j', { n: str(b.JobNumber, 50), j: cur.PmJobId }, tx);
  });
  res.json({ ok: true });
}));
async function bidOf(sqlText, id) {
  const r = await query(sqlText, { id });
  if (!r[0]) throw bad('Record not found', 404);
  return r[0].PmContractId;
}
async function checksFor(bidId) { const d = await bidValues(bidId); return d ? d.checks : { packs: [], plans: [] } }
router.put('/plans/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  if (!('ContractVal' in b)) throw bad('Enter the plan contract value');
  const bidId = await bidOf('SELECT PmContractId FROM PmPlan WHERE PmPlanID = @id', id);
  await query('UPDATE PmPlan SET ContractVal = @v WHERE PmPlanID = @id', { id, v: moneyIn(b.ContractVal, 'Contract value') ?? '$0.00' });
  res.json({ ok: true, checks: await checksFor(bidId) });
}));
router.put('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('BuilderCode' in b) o.BuilderCode = str(b.BuilderCode, 50);
  if ('ContractVal' in b) o.ContractVal = moneyIn(b.ContractVal, 'Contract value') ?? '$0.00';
  if ('ContractValCost' in b) o.ContractValCost = moneyIn(b.ContractValCost, 'Contract cost');
  if ('TruedUp' in b) o.TruedUp = bit(b.TruedUp);
  const bidId = await bidOf('SELECT p.PmContractId FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE k.PmPackID = @id', id);
  await patch('PmPack', 'PmPackID', id, o);
  res.json({ ok: true, checks: await checksFor(bidId) });
}));
function valueBody(b) {
  const w = int(b.WorkId), s = int(b.ScheduleStageId), v = moneyIn(b.Value, 'Value');
  if (!w || !s) throw bad('Choose the stage and the type of work');
  if (v == null) throw bad('Enter the value');
  return { WorkId: w, ScheduleStageId: s, Value: v };
}
router.post('/packs/:id/values', h(async (req, res) => {
  const pk = int(req.params.id), o = valueBody(req.body || {});
  const bidId = await bidOf('SELECT p.PmContractId FROM PmPack k JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE k.PmPackID = @id', pk);
  const id = await withTransaction(async (tx) => {
    if ((await query('SELECT 1 FROM PmValue WHERE PmPackId = @p AND WorkId = @w AND ScheduleStageId = @s', { p: pk, w: o.WorkId, s: o.ScheduleStageId }, tx))[0]) throw bad('This pack already has a value for that stage and work', 409);
    const nid = await nextId(tx, 'PmValue', 'PmValueID');
    await query('INSERT INTO PmValue (PmValueID, PmPackId, WorkId, ScheduleStageId, [Value], UserEntered) VALUES (@id, @p, @w, @s, @v, @u)', { id: nid, p: pk, w: o.WorkId, s: o.ScheduleStageId, v: o.Value, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id, checks: await checksFor(bidId) });
}));
router.put('/pm-values/:id', h(async (req, res) => {
  const id = int(req.params.id), o = valueBody(req.body || {});
  const cur = (await query('SELECT v.PmPackId, p.PmContractId FROM PmValue v JOIN PmPack k ON k.PmPackID = v.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE v.PmValueID = @id', { id }))[0];
  if (!cur) throw bad('Value not found', 404);
  if ((await query('SELECT 1 FROM PmValue WHERE PmPackId = @p AND WorkId = @w AND ScheduleStageId = @s AND PmValueID <> @id', { p: cur.PmPackId, w: o.WorkId, s: o.ScheduleStageId, id }))[0]) throw bad('This pack already has a value for that stage and work', 409);
  await query('UPDATE PmValue SET WorkId = @w, ScheduleStageId = @s, [Value] = @v WHERE PmValueID = @id', { id, w: o.WorkId, s: o.ScheduleStageId, v: o.Value });
  res.json({ ok: true, checks: await checksFor(cur.PmContractId) });
}));
router.delete('/pm-values/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const bidId = await bidOf('SELECT p.PmContractId FROM PmValue v JOIN PmPack k ON k.PmPackID = v.PmPackId JOIN PmPlan p ON p.PmPlanID = k.PmPlanId WHERE v.PmValueID = @id', id);
  await query('DELETE FROM PmValue WHERE PmValueID = @id', { id });
  res.json({ ok: true, checks: await checksFor(bidId) });
}));

// Run fn in a transaction; with dryRun the work is rolled back and only the counts are returned (a preview).
const ROLLBACK = Symbol('rollback');
async function runOrPreview(dryRun, fn) {
  let out;
  try {
    await withTransaction(async (tx) => { out = await fn(tx); if (dryRun) throw ROLLBACK });
  } catch (e) { if (e !== ROLLBACK) throw e }
  return { ...out, dryRun: !!dryRun };
}
// money → "$1234.00" / "($5.00)" text like the rest of the app writes it
const FMT = (e) => `(CASE WHEN ${e} < 0 THEN '($' + CONVERT(varchar(30), CAST(ROUND(-(${e}),2) AS decimal(18,2))) + ')' ELSE '$' + CONVERT(varchar(30), CAST(ROUND(${e},2) AS decimal(18,2))) END)`;

// Set contract values (macro CmSetContractVal → qryCmSetValuePack*/Plan*): fill EMPTY pack values from their breakdown, then
// EMPTY plan values from their standard packs. All bids, like Access.
router.post('/set-contract-values', h(async (req, res) => {
  const out = await runOrPreview(req.body?.dryRun, async (tx) => {
    const k = await query(`UPDATE k SET k.ContractVal = ${FMT('v.s')}
        FROM PmPack k JOIN (SELECT PmPackId, SUM(${MV('[Value]')}) AS s FROM PmValue GROUP BY PmPackId) v ON v.PmPackId = k.PmPackID
       WHERE ISNULL(${MV('k.ContractVal')}, 0) = 0 AND v.s IS NOT NULL; SELECT @@ROWCOUNT AS n`, {}, tx);
    const p = await query(`UPDATE p SET p.ContractVal = ${FMT('x.s')}
        FROM PmPlan p JOIN (SELECT PmPlanId, SUM(${MV('ContractVal')}) AS s FROM PmPack WHERE PackTypeId = 1 GROUP BY PmPlanId HAVING SUM(${MV('ContractVal')}) > 0) x ON x.PmPlanId = p.PmPlanID
       WHERE ISNULL(${MV('p.ContractVal')}, 0) = 0; SELECT @@ROWCOUNT AS n`, {}, tx);
    return { packs: k[0].n, plans: p[0].n };
  });
  res.json(out);
}));

// Update lot contract values (macro CmUpdateContractVal → qryCmUpdateContract01..10) for one bid
router.post('/bids/:id/update-lots', h(async (req, res) => {
  const b = int(req.params.id);
  if (!(await query('SELECT 1 FROM PmContract WHERE PmContractID = @b', { b }))[0]) throw bad('Bid not found', 404);
  const who = user(req);
  const out = await runOrPreview(req.body?.dryRun, async (tx) => {
    const P = { b };
    // 01: open lots ← plan value, their packs ← pack value
    const lots = await query(`UPDATE l SET l.Contract = pl.ContractVal FROM JsLot l JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       WHERE ph.PmContractId = @b AND l.EndDate IS NULL AND EXISTS (SELECT 1 FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId WHERE jp.LotId = l.LotID); SELECT @@ROWCOUNT AS n`, P, tx);
    const packs = await query(`UPDATE jp SET jp.ContractEa = k.ContractVal FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN JsLot l ON l.LotID = jp.LotId
       JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       WHERE ph.PmContractId = @b AND l.EndDate IS NULL; SELECT @@ROWCOUNT AS n`, P, tx);
    // 02: existing breakdown of open lots ← PmValue
    const det = await query(`UPDATE jv SET jv.Contract = v.Value FROM JsValue jv JOIN JsPack jp ON jp.PackID = jv.PackId JOIN JsLot l ON l.LotID = jp.LotId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN PmValue v ON v.PmPackId = k.PmPackID AND v.WorkId = jv.WorkId AND v.ScheduleStageId = jv.ScheduleStageId
       WHERE ph.PmContractId = @b AND l.EndDate IS NULL; SELECT @@ROWCOUNT AS n`, P, tx);
    // 03 + 05: breakdown rows missing on open lots are added
    const base = await nextId(tx, 'JsValue', 'JsValueID');
    const add = await query(`INSERT INTO JsValue (JsValueID, PackId, WorkId, ScheduleStageId, Contract, MarkDelete, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY jp.PackID, v.PmValueID) - 1, jp.PackID, v.WorkId, v.ScheduleStageId, v.Value, 0, @u
         FROM JsLot l JOIN JsPack jp ON jp.LotId = l.LotID JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN PmValue v ON v.PmPackId = jp.PmPackId
        WHERE ph.PmContractId = @b AND l.EndDate IS NULL
          AND NOT EXISTS (SELECT 1 FROM JsValue x WHERE x.PackId = jp.PackID AND x.WorkId = v.WorkId AND x.ScheduleStageId = v.ScheduleStageId); SELECT @@ROWCOUNT AS n`, { ...P, base, u: who }, tx);
    // 07–10: breakdown rows (any lot of the bid) whose stage/work no longer exists in the pack's PmValue are removed
    const del = await query(`DELETE jv FROM JsValue jv JOIN JsPack jp ON jp.PackID = jv.PackId JOIN JsLot l ON l.LotID = jp.LotId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN JsJob jj ON jj.JobId = ph.JobId
       WHERE ph.PmContractId = @b
         AND NOT EXISTS (SELECT 1 FROM PmPack k JOIN PmValue v ON v.PmPackId = k.PmPackID WHERE k.PmPackID = jp.PmPackId AND v.WorkId = jv.WorkId AND v.ScheduleStageId = jv.ScheduleStageId); SELECT @@ROWCOUNT AS n`, P, tx);
    return { lots: lots[0].n, packs: packs[0].n, detailUpdated: det[0].n, detailAdded: add[0].n, detailRemoved: del[0].n };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Revised contract values of a scheduled lot (Access CmRevContract + SubPack / SubValue / SubTotal)
// ---------------------------------------------------------------------------
const CLOSED = 'This lot is closed. You need to open it before you can modify it.';
router.get('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [lot, packs, values] = await Promise.all([
    query(`SELECT l.LotID, l.JobId, jj.JobName, ph.PhaseID, ph.Phase, pc.PmContractID, pc.BidNum, pc.BidDate, ISNULL(l.Lot,'') + CASE WHEN l.Block IS NULL THEN '' ELSE '/' + l.Block END AS LotBlock,
                  p.PlanNum, l.StartDate, l.EndDate, st.Status, ${MV('l.Estimate')} AS Estimate, ${MV('l.RevEstimate')} AS RevEstimate, ${MV('l.Contract')} AS Contract, ${MV('l.RevContract')} AS RevContract, l.LotNotes
             FROM JsLot l JOIN JsJob jj ON jj.JobId = l.JobId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId LEFT JOIN LsStatus st ON st.StatusID = jj.StatusId
             LEFT JOIN PmContract pc ON pc.PmContractID = ph.PmContractId LEFT JOIN PmPlan p ON p.PmPlanID = l.PmPlanId WHERE l.LotID = @id`, { id }),
    query(`SELECT jp.PackID, jp.LotId, jp.PmPackId, k.PackName, k.BuilderCode, jp.PackTypeId, t.PackType, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa
             FROM JsPack jp LEFT JOIN PmPack k ON k.PmPackID = jp.PmPackId LEFT JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId WHERE jp.LotId = @id ORDER BY k.PackName, jp.PackID`, { id }),
    query(`SELECT jv.JsValueID, jv.PackId, jv.WorkId, w.WorkType, jv.ScheduleStageId, ss.ScheduleStage, ${MV('jv.Contract')} AS Contract, ${MV('jv.RevContract')} AS RevContract
             FROM JsValue jv JOIN JsPack jp ON jp.PackID = jv.PackId LEFT JOIN LsWork w ON w.WorkID = jv.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = jv.ScheduleStageId
            WHERE jp.LotId = @id ORDER BY jv.WorkId, jv.JsValueID`, { id }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  // CmRevContractSubTotal: Σ qty × (revised each, else contract each) — Access IsNull test, so a revised $0.00 counts as 0
  const total = packs.reduce((a, k) => a + Number(k.PackQty || 0) * Number((k.RevContractEa == null ? k.ContractEa : k.RevContractEa) || 0), 0);
  res.json({ lot: { ...lot[0], closed: !!lot[0].EndDate }, packs, values, total });
}));
async function openLot(tx, sqlText, id) {
  const r = (await query(sqlText, { id }, tx))[0];
  if (!r) throw bad('Record not found', 404);
  if (r.EndDate) throw bad(CLOSED, 409);
  return r;
}
router.put('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('Contract' in b) o.Contract = moneyIn(b.Contract, 'Std contract');
  if ('RevContract' in b) o.RevContract = moneyIn(b.RevContract, 'Rev contract');
  if ('LotNotes' in b) o.LotNotes = str(b.LotNotes, 255);
  await withTransaction(async (tx) => {
    await openLot(tx, 'SELECT LotID, EndDate FROM JsLot WHERE LotID = @id', id);
    await patch('JsLot', 'LotID', id, o, tx);
  });
  res.json({ ok: true });
}));
router.put('/lot-packs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  if ('ContractEa' in b) o.ContractEa = moneyIn(b.ContractEa, 'Contract each');
  if ('RevContractEa' in b) o.RevContractEa = moneyIn(b.RevContractEa, 'Rev contract each');
  await withTransaction(async (tx) => {
    await openLot(tx, 'SELECT jp.PackID, l.EndDate FROM JsPack jp JOIN JsLot l ON l.LotID = jp.LotId WHERE jp.PackID = @id', id);
    await patch('JsPack', 'PackID', id, o, tx);
  });
  res.json({ ok: true });
}));
function jsValueBody(b, partial) {
  const o = {};
  if (!partial || 'WorkId' in b) { o.WorkId = int(b.WorkId); if (!o.WorkId) throw bad('Choose the type of work') }
  if (!partial || 'ScheduleStageId' in b) { o.ScheduleStageId = int(b.ScheduleStageId); if (!o.ScheduleStageId) throw bad('Choose the schedule stage') }
  if ('Contract' in b) o.Contract = moneyIn(b.Contract, 'Contract');
  if ('RevContract' in b) o.RevContract = moneyIn(b.RevContract, 'Rev contract');
  return o;
}
router.post('/lot-packs/:id/values', h(async (req, res) => {
  const pk = int(req.params.id), o = jsValueBody(req.body || {}, false);
  const id = await withTransaction(async (tx) => {
    await openLot(tx, 'SELECT jp.PackID, l.EndDate FROM JsPack jp JOIN JsLot l ON l.LotID = jp.LotId WHERE jp.PackID = @id', pk);
    const nid = await nextId(tx, 'JsValue', 'JsValueID');
    await query('INSERT INTO JsValue (JsValueID, PackId, WorkId, ScheduleStageId, Contract, RevContract, MarkDelete, UserEntered) VALUES (@id, @p, @w, @s, @c, @r, 0, @u)',
      { id: nid, p: pk, w: o.WorkId, s: o.ScheduleStageId, c: o.Contract ?? null, r: o.RevContract ?? null, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/js-values/:id', h(async (req, res) => {
  const id = int(req.params.id), o = jsValueBody(req.body || {}, true);
  await withTransaction(async (tx) => {
    await openLot(tx, 'SELECT jv.JsValueID, l.EndDate FROM JsValue jv JOIN JsPack jp ON jp.PackID = jv.PackId JOIN JsLot l ON l.LotID = jp.LotId WHERE jv.JsValueID = @id', id);
    await patch('JsValue', 'JsValueID', id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/js-values/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    await openLot(tx, 'SELECT jv.JsValueID, l.EndDate FROM JsValue jv JOIN JsPack jp ON jp.PackID = jv.PackId JOIN JsLot l ON l.LotID = jp.LotId WHERE jv.JsValueID = @id', id);
    await query('DELETE FROM JsValue WHERE JsValueID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Reports (SwitchCM report buttons). Each takes only the switchboard filters it used in Access.
// ---------------------------------------------------------------------------
const CU_JOB = 'PmCustomer cu JOIN PmJob j ON j.PmCustId = cu.PmCustID';
const CM_COLS = `c.CmContractID, c.ContractNumber, c.WorkAgreeNum, c.AddendumNumber, t.Type, c.Description, c.EffectivePhase, c.EffectiveDate, c.Executed, c.Notes`;
const pmFilter = (q, depth) => {
  const o = { c: need(int(q.customerId), 'the PM customer') };
  if (depth >= 2) o.j = need(int(q.jobId), 'the PM job');
  if (depth >= 3) o.b = need(int(q.contractId), 'the PM bid');
  return o;
};
const optionSort = {
  'option-contract-val': 'p.PlanNum, k.PackName, ss.ScheduleStage, w.WorkType',
  'option-contract-val-2': 'p.PlanNum, k.BuilderCode, k.PackName, ss.ScheduleStage, w.WorkType',
  'option-contract-val-3': 'k.BuilderCode, k.PackName, p.PlanNum, ss.ScheduleStage, w.WorkType',
};
async function linkedContracts(bidId) {
  // CmPlanContractValSub: CM contracts linked to the bid
  return query(`SELECT l.PmContractId, l.CmContractId, c.ContractNumber, c.WorkAgreeNum, c.AddendumNumber, c.Description, c.EffectivePhase, c.EffectiveDate, c.Executed, c.Notes
      FROM CmContract c JOIN CmContractPmLink l ON l.CmContractId = c.CmContractID WHERE l.PmContractId = @b ORDER BY c.ContractNumber, c.AddendumNumber`, { b: bidId });
}
async function optionContractVal(key, q) {
  const p = pmFilter(q, 3);
  return query(`SELECT cu.Customer, j.Job, j.JobNumber, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate, p.PlanNum, p.PlanName, k.PmPackID, k.PackName, k.BuilderCode, ${MV('k.ContractVal')} AS ContractVal,
         t.PackType, ss.ScheduleStage, w.WorkType, ${MV('v.Value')} AS Value
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      LEFT JOIN PmValue v ON v.PmPackId = k.PmPackID LEFT JOIN LsWork w ON w.WorkID = v.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = v.ScheduleStageId
      LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId
     WHERE cu.PmCustID = @c AND j.PmJobID = @j AND pc.PmContractID = @b AND t.Opt = 1
     ORDER BY ${optionSort[key]}`, p);
}

const REPORTS = {
  // CmJobHistoryLog: the PM job with every contract/addendum, newest entry first
  'job-history-log': (q) => query(`SELECT cu.Customer, cu.Notes AS CustomerNotes, j.Job, j.PmJobID, jt.JobType, j.JobNumber, j.SpecLevel, ISNULL(ju.Jurisdiction,'') + ', ' + ISNULL(ju.State,'') AS Juris,
         j.DivisionId, j.EstStartDate, j.EstEndDate, j.UnitQty, j.Notes AS JobNotes, st.Status, ${CM_COLS}, c.DateEntered, c.UserEntered
      FROM PmJob j LEFT JOIN CmContract c ON c.PmJobId = j.PmJobID LEFT JOIN PmCustomer cu ON cu.PmCustID = j.PmCustId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
      LEFT JOIN LsJurisdiction ju ON ju.JurisdictionID = j.JurisdictionId LEFT JOIN LsStatus st ON st.StatusID = j.StatusId LEFT JOIN LsContractType t ON t.TypeID = c.TypeId
     WHERE j.PmJobID = @j ORDER BY c.DateEntered DESC, c.CmContractID`, { j: need(int(q.jobId), 'the PM job') }),
  // CmContractHistory: contracts of the job → linked bids → their plans
  'contract-history': (q) => query(`SELECT cu.Customer, j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, ${CM_COLS}, pc.PmContractID, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate,
         p.PlanNum, p.PlanName, p.SqFt, ${MV('p.ContractVal')} AS ContractVal
      FROM CmContract c JOIN ${CU_JOB} ON c.PmJobId = j.PmJobID LEFT JOIN LsContractType t ON t.TypeID = c.TypeId
      LEFT JOIN CmContractPmLink l ON l.CmContractId = c.CmContractID LEFT JOIN PmContract pc ON pc.PmContractID = l.PmContractId LEFT JOIN PmPlan p ON p.PmContractId = pc.PmContractID
     WHERE cu.PmCustID = @c AND j.PmJobID = @j ORDER BY c.ContractNumber, c.WorkAgreeNum, c.AddendumNumber, c.CmContractID, pc.BidNum, p.PlanNum`, pmFilter(q, 2)),
  // CmContractJob: contracts of one job (the job shows even with none)
  'contract-job': (q) => query(`SELECT cu.Customer, j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, ${CM_COLS}
      FROM ${CU_JOB} LEFT JOIN CmContract c ON c.PmJobId = j.PmJobID LEFT JOIN LsContractType t ON t.TypeID = c.TypeId
     WHERE cu.PmCustID = @c AND j.PmJobID = @j ORDER BY t.Type, c.ContractNumber, c.AddendumNumber`, pmFilter(q, 2)),
  // CmContractNotExecuted
  'not-executed': () => query(`SELECT cu.Customer, j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, c.PmJobId, ${CM_COLS}
      FROM CmContract c JOIN ${CU_JOB} ON c.PmJobId = j.PmJobID JOIN LsContractType t ON t.TypeID = c.TypeId
     WHERE ISNULL(c.Executed,0) = 0 ORDER BY cu.Customer, j.Job, t.Type, c.ContractNumber, c.AddendumNumber`),
  // CmNoContractJob: PM jobs with no bid at all
  'no-contract-job': () => query(`SELECT cu.Customer, j.PmJobID, j.Job, j.DivisionId
      FROM ${CU_JOB} LEFT JOIN PmContract pc ON pc.PmJobId = j.PmJobID
     WHERE cu.Customer NOT LIKE 'Test%' AND j.Job NOT LIKE '%do not%' AND j.Job NOT LIKE '%plan opt%' AND pc.PmContractID IS NULL ORDER BY cu.Customer, j.Job`),
  // CmNoContractBid: bids not linked to any CM contract
  'no-contract-bid': () => query(`SELECT cu.Customer, j.PmJobID, j.Job, j.DivisionId, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, pc.Notes, st.Status
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID LEFT JOIN CmContractPmLink l ON l.PmContractId = pc.PmContractID JOIN LsStatus st ON st.StatusID = pc.StatusId
     WHERE cu.Customer NOT LIKE 'Test%' AND j.Job NOT LIKE '%do not%' AND j.Job NOT LIKE '%plan opt%' AND l.CmLinkPmID IS NULL ORDER BY cu.Customer, j.Job, pc.BidNum`),
  // CmNoContractVal: active plans of active production jobs with no contract value
  'no-contract-val': (q) => query(`SELECT cu.Customer, j.Job, j.DivisionId, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, p.PmPlanID, p.PlanNum, p.PlanName, p.SqFt, ${MV('p.ContractVal')} AS ContractVal
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID
     WHERE j.DivisionId = @d AND ISNULL(${MV('p.ContractVal')},0) = 0 AND j.StatusId = 1 AND ISNULL(p.Universal,0) = 0 AND ISNULL(j.Template,0) = 0 AND p.StatusId = 1
     ORDER BY cu.Customer, j.Job, pc.BidNum, p.PlanNum`, { d: need(q.division, 'the division') }),
  // CmToDoDiary: diary entries due between From and To
  'to-do-diary': (q) => query(`SELECT cu.Customer, j.Job, j.DivisionId, c.PmJobId, c.CmContractID, c.ContractNumber, c.WorkAgreeNum, c.AddendumNumber, c.Description, t.Type, c.EffectivePhase, c.EffectiveDate,
         d.[Date], d.Contact, d.Notes, d.DueDate
      FROM ${CU_JOB} JOIN CmContract c ON c.PmJobId = j.PmJobID JOIN CmDiary d ON d.CmContractId = c.CmContractID JOIN LsContractType t ON t.TypeID = c.TypeId
     WHERE d.DueDate >= CAST(@from AS date) AND d.DueDate < DATEADD(day, 1, CAST(@to AS date)) ORDER BY cu.Customer, j.Job, c.CmContractID, d.DueDate`, dateRange(q)),
  // CmPlanContractVal: standard packs of a bid with their breakdown + the CM contracts linked to the bid
  'plan-contract-val': async (q) => {
    const p = pmFilter(q, 3);
    const rows = await query(`SELECT cu.Customer, j.Job, j.JobNumber, jt.JobType, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate, p.PlanNum, p.PlanName, ${MV('p.ContractVal')} AS PlanValue,
           k.PmPackID, k.PackName, ${MV('k.ContractVal')} AS PackValue, w.WorkType, ss.ScheduleStage, ${MV('v.Value')} AS Value
        FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
        JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN LsPackType t ON t.PackTypeID = k.PackTypeId LEFT JOIN PmValue v ON v.PmPackId = k.PmPackID
        LEFT JOIN LsWork w ON w.WorkID = v.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = v.ScheduleStageId
       WHERE cu.PmCustID = @c AND j.PmJobID = @j AND pc.PmContractID = @b AND t.Std = 1 ORDER BY p.PlanNum, k.PackName, w.WorkType, ss.ScheduleStage`, p);
    return { rows, links: await linkedContracts(p.b) };
  },
  // CmPlanContractValWork: same bid, breakdown summed per plan and type of work
  'plan-contract-val-work': async (q) => {
    const p = pmFilter(q, 3);
    const rows = await query(`SELECT cu.Customer, j.Job, j.JobNumber, jt.JobType, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate, p.PlanNum, p.PlanName,
           MAX(${MV('p.ContractVal')}) AS MaxOfContractVal, w.WorkType, SUM(${MV('v.Value')}) AS SumOfValue
        FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN PmPlan p ON p.PmContractId = pc.PmContractID
        LEFT JOIN PmPack k ON k.PmPlanId = p.PmPlanID LEFT JOIN PmValue v ON v.PmPackId = k.PmPackID LEFT JOIN LsWork w ON w.WorkID = v.WorkId LEFT JOIN LsPackType t ON t.PackTypeID = k.PackTypeId
       WHERE t.Std = 1 AND cu.PmCustID = @c AND j.PmJobID = @j AND pc.PmContractID = @b
       GROUP BY cu.Customer, j.Job, j.JobNumber, jt.JobType, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate, p.PlanNum, p.PlanName, w.WorkType
      HAVING SUM(${MV('v.Value')}) IS NOT NULL ORDER BY p.PlanNum, w.WorkType`, p);
    return { rows, links: await linkedContracts(p.b) };
  },
  'option-contract-val': (q) => optionContractVal('option-contract-val', q),
  'option-contract-val-2': (q) => optionContractVal('option-contract-val-2', q),
  'option-contract-val-3': (q) => optionContractVal('option-contract-val-3', q),
  // CmSequenceSheet: billing data of a JS phase — lot → pack → breakdown, with the lot sub-total (CmSequenceSheetSubTotal)
  'sequence-sheet': async (q) => {
    const ph = need(int(q.phaseId), 'the JS phase');
    const rows = await query(`SELECT CAST(cu.CustID AS varchar(12)) + '.' + CAST(jj.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS Code, cu.CustName, jj.JobName, jj.JobNum, ph.Phase,
           pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate,
           ISNULL(s1.SuperName,'') + ' - ' + ISNULL(s1.SuperType,'') + '/ ' + ISNULL(s2.SuperName,'') + ' - ' + ISNULL(s2.SuperType,'') AS Supers, ph.StartDate,
           CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END AS LotBlock, l.LotID, p.PlanNum, p.PlanName, l.Address, l.City,
           ${MV('l.Contract')} AS LotContract, ${MV('l.RevContract')} AS LotRevContract,
           jp.PackID, k.PackName, k.BuilderCode, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa,
           jp.PackQty * CASE WHEN jp.RevContractEa IS NULL THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END AS ExtVal,
           w.WorkType, ss.ScheduleStage, ${MV('jv.Contract')} AS DetailContract, ${MV('jv.RevContract')} AS DetailRevContract,
           jp.PackQty * CASE WHEN jv.RevContract IS NULL THEN ${MV('jv.Contract')} ELSE ${MV('jv.RevContract')} END AS DetailExtVal
        FROM JsCustomer cu JOIN JsJob jj ON jj.CustId = cu.CustID JOIN JsPhase ph ON ph.JobId = jj.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID AND l.JobId = jj.JobId
        JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
        LEFT JOIN PmPlan p ON p.PmPlanID = l.PmPlanId LEFT JOIN JsPack jp ON jp.LotId = l.LotID LEFT JOIN PmPack k ON k.PmPackID = jp.PmPackId
        LEFT JOIN JsValue jv ON jv.PackId = jp.PackID LEFT JOIN LsWork w ON w.WorkID = jv.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = jv.ScheduleStageId
       WHERE ph.PhaseID = @ph ORDER BY CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END, l.LotID, k.PackName, jp.PackID, w.WorkType`, { ph });
    const totals = await query(`SELECT l.LotID, SUM(jp.PackQty * CASE WHEN jp.RevContractEa IS NULL THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END) AS ExtVal
        FROM JsLot l LEFT JOIN JsPack jp ON jp.LotId = l.LotID WHERE l.PhaseId = @ph GROUP BY l.LotID`, { ph });
    return { rows, totals };
  },
  // CmNotContracted: active packs priced at the $0.01 placeholder
  'not-contracted': (q) => query(`SELECT cu.Customer, j.Job, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidDate, p.PlanNum, k.BuilderCode, k.PackName, ${MV('k.ContractVal')} AS ContractVal, st.Status
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID JOIN LsStatus st ON st.StatusID = k.StatusId
     WHERE cu.PmCustID = @c AND ${MV('k.ContractVal')} = 0.01 AND st.Active = 1 ORDER BY j.Job, pc.BidNum, p.PlanNum, k.PackName`, { c: need(int(q.customerId), 'the PM customer') }),
  // CmPacksAfterTruedUp: packs entered on/after their bid's true-up date
  'packs-after-trued-up': (q) => query(`SELECT j.DivisionId, cu.Customer, j.Job, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidDate, pc.TrueUpDate, p.PlanNum, k.PackName, k.BuilderCode, ${MV('k.ContractVal')} AS ContractVal, k.TruedUp, k.DateEntered
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
     WHERE j.DivisionId = @d AND k.DateEntered >= pc.TrueUpDate ORDER BY j.DivisionId, cu.Customer, j.Job, pc.BidNum, p.PlanNum, k.BuilderCode, k.PackName`, { d: need(q.division, 'the division') }),
  // CmPacksNotTruedUp: packs not trued up on bids entered between From and To
  'packs-not-trued-up': (q) => query(`SELECT j.DivisionId, cu.Customer, j.Job, pc.PmContractID, pc.BidNum, pc.BidRelease, pc.BidDate, pc.TrueUpDate, p.PlanNum, k.PackName, k.BuilderCode, ${MV('k.ContractVal')} AS ContractVal, k.TruedUp, pc.DateEntered
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID JOIN PmPlan p ON p.PmContractId = pc.PmContractID JOIN PmPack k ON k.PmPlanId = p.PmPlanID
     WHERE j.DivisionId = @d AND ISNULL(k.TruedUp,0) = 0 AND pc.DateEntered >= CAST(@from AS date) AND pc.DateEntered < DATEADD(day, 1, CAST(@to AS date)) AND ISNULL(j.Template,0) = 0
     ORDER BY j.DivisionId, cu.Customer, j.Job, pc.BidNum, p.PlanNum, k.BuilderCode, k.PackName`, { d: need(q.division, 'the division'), ...dateRange(q) }),
  // CmContractValueBuilder: standard pack values + breakdown of a customer's active jobs in a division
  'contract-value-builder': (q) => query(`SELECT j.DivisionId, cu.Customer, j.Job, j.JobNumber, j.SpecLevel, pc.BidNum, pc.BidName, pc.BidRelease, pc.BidDate, p.PlanNum, p.SqFt, ${MV('p.ContractVal')} AS PlanValue,
         k.PackName, ${MV('k.ContractVal')} AS ContractVal, w.WorkType, ss.ScheduleStage, ${MV('v.Value')} AS Value
      FROM ${CU_JOB} JOIN PmContract pc ON pc.PmJobId = j.PmJobID LEFT JOIN PmPlan p ON p.PmContractId = pc.PmContractID LEFT JOIN PmPack k ON k.PmPlanId = p.PmPlanID
      LEFT JOIN PmValue v ON v.PmPackId = k.PmPackID LEFT JOIN LsWork w ON w.WorkID = v.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = v.ScheduleStageId
     WHERE j.DivisionId = @d AND cu.PmCustID = @c AND ${MV('k.ContractVal')} > 0 AND ISNULL(j.Template,0) = 0 AND j.StatusId = 1 AND k.PackTypeId = 1
     ORDER BY cu.Customer, j.Job, pc.BidNum, p.PlanNum, k.PackName, w.WorkType, ss.ScheduleStage`, { d: need(q.division, 'the division'), c: need(int(q.customerId), 'the PM customer') }),
};
router.get('/reports/:key', h(async (req, res) => {
  const fn = Object.prototype.hasOwnProperty.call(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  if (!fn) throw bad('Unknown report', 404);
  res.json(await fn(req.query));
}));

// Contract latest changes (macro CmLatestChanges): the report of contracts flagged "latest print" in a division, then
// qryCmClearLatestPrint clears the flags (Access joins JsJob for the division there). Both in one transaction.
router.post('/reports/latest-changes', h(async (req, res) => {
  const d = need(str(req.body?.division, 50), 'the division');
  const out = await withTransaction(async (tx) => {
    const rows = await query(`SELECT cu.Customer, j.Job, j.JobNumber, j.SpecLevel, j.DivisionId, c.PmJobId, c.CmContractID, c.ContractNumber, c.WorkAgreeNum, c.AddendumNumber, t.Type, c.Description, c.EffectivePhase, c.EffectiveDate, c.Notes, c.LatestPrint
        FROM CmContract c JOIN ${CU_JOB} ON c.PmJobId = j.PmJobID JOIN LsContractType t ON t.TypeID = c.TypeId
       WHERE j.DivisionId = @d AND c.LatestPrint = 1 ORDER BY cu.Customer, j.Job, c.ContractNumber, c.AddendumNumber`, { d }, tx);
    const r = await query(`UPDATE c SET c.LatestPrint = 0 FROM CmContract c JOIN JsJob jj ON jj.PmJobId = c.PmJobId WHERE c.LatestPrint = 1 AND jj.DivisionId = @d; SELECT @@ROWCOUNT AS n`, { d }, tx);
    return { rows, cleared: r[0].n };
  });
  res.json(out);
}));

// Options scheduled-lots (macro CmOptionSelect → rptCmOptionSelectAppend / form CmOptionSelect / report CmOptionSelect).
// Access staged the option names in tempCmOptionSelect per user; here the client keeps the ticked names and posts them.
function optionParams(b) {
  const jobId = int(b.jobId);
  if (!jobId) throw bad('Select job to run report.');
  return { jobId, ...dateRange(b) };
}
router.get('/option-names', h(async (req, res) => {
  const p = optionParams(req.query);
  res.json(await query(`SELECT k.PackName AS name, COUNT(*) AS n FROM JsJob jj JOIN JsLot l ON l.JobId = jj.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
     WHERE jj.JobId = @jobId AND l.StartDate >= CAST(@from AS date) AND l.StartDate < DATEADD(day, 1, CAST(@to AS date)) GROUP BY k.PackName ORDER BY k.PackName`, p));
}));
router.post('/reports/option-select', h(async (req, res) => {
  const b = req.body || {}, p = optionParams(b);
  const names = [...new Set((Array.isArray(b.names) ? b.names : []).map((n) => String(n)).filter(Boolean))];
  if (!names.length) throw bad('Tick at least one option');
  if (names.length > 500) throw bad('Too many options at once (max 500)');
  const params = { ...p };
  names.forEach((n, i) => { params[`n${i}`] = n });
  const inList = names.map((_, i) => `@n${i}`).join(', ');
  res.json(await query(`SELECT cu.CustName, jj.JobName, pc.BidNum, pc.BidDate, l.LotID, l.Lot, l.Block, ph.Phase, p.PlanNum, p.PlanName, l.StartDate, l.EndDate, k.PackName, k.BuilderCode,
         jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa,
         jp.PackQty * CASE WHEN jp.RevContractEa IS NULL OR ISNULL(${MV('jp.RevContractEa')},0) = 0 THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END AS ExtVal
      FROM JsPack jp JOIN JsLot l ON l.LotID = jp.LotId JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN JsJob jj ON jj.JobId = ph.JobId
      JOIN JsCustomer cu ON cu.CustID = jj.CustId JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN PmPlan p ON p.PmPlanID = l.PmPlanId
     WHERE l.StartDate >= CAST(@from AS date) AND l.StartDate < DATEADD(day, 1, CAST(@to AS date)) AND jj.JobId = @jobId AND k.StatusId = 1 AND k.PackName IN (${inList})
     ORDER BY k.PackName, k.BuilderCode, l.StartDate DESC, l.Lot`, params));
}));

module.exports = router;
