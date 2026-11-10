// Scheduling (SC) — mirrors the Access "Schedule packs" form (SchedulePhase / ScheduleSubLot / ScheduleSubStage /
// ScheduleSubPack) and the pack-ticket posting macros (ScPackLotPost, PackLateLot).
//
//  * Lots hold the schedule: JsStage rows (work type + schedule stage + delivery date) and JsPack rows (packs from the
//    plan/universal packs of the phase contract).
//  * Posting a stage turns the lot's packs into a material list (JsPackMaterialTemp) and labor lines (JsPackLaborTemp),
//    marks the stage posted and sets contract values. Inventory posts the material later; Payroll pays the labor.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const par = (tx, fns) => (tx ? fns.reduce((p, f) => p.then(async (a) => [...a, await f()]), Promise.resolve([])) : Promise.all(fns.map((f) => f())));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [workTypes, scheduleStages, statuses, subsTypes, divisions, stages] = await Promise.all([
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name, ScDefaultPack FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT StatusID AS id, Status AS name, Active FROM LsStatus ORDER BY StatusID'),
    query('SELECT SubsID AS id, SubsName AS name FROM LsSubstitutionType ORDER BY SubsName'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query('SELECT StageID AS id, Stage AS name, ScheduleStageId FROM LsStage ORDER BY Stage'),
  ]);
  res.json({ workTypes, scheduleStages, statuses, subsTypes, divisions, stages });
}));

// ---------------------------------------------------------------------------
// Jobs and phases
// ---------------------------------------------------------------------------
// GET /jobs?search=&division=&openOnly=1 — jobs with their open-lot and upcoming-stage counts
router.get('/jobs', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = {
    s: req.query.search ? `%${req.query.search}%` : null,
    div: req.query.division || null,
    openOnly: req.query.openOnly === '0' ? 0 : 1,
    offset: pg.offset, pageSize: pg.pageSize,
  };
  const from = `FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId
    WHERE (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s OR CAST(j.JobNum AS nvarchar(20)) LIKE @s)
      AND (@div IS NULL OR j.DivisionId = @div)
      AND (@openOnly = 0 OR EXISTS (SELECT 1 FROM JsLot l WHERE l.JobId = j.JobId AND l.EndDate IS NULL AND l.StatusId = 1))`;
  const [rows, total] = await Promise.all([
    query(`SELECT j.JobId, j.JobName, j.JobNum, j.DivisionId, c.CustName, j.City,
                  (SELECT COUNT(*) FROM JsPhase ph WHERE ph.JobId = j.JobId) AS Phases,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId) AS Lots,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.JobId = j.JobId AND l.EndDate IS NULL AND l.StatusId = 1) AS OpenLots,
                  (SELECT COUNT(*) FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId WHERE l.JobId = j.JobId AND s.DatePosted IS NULL) AS OpenStages,
                  (SELECT COUNT(*) FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId WHERE l.JobId = j.JobId AND s.DatePosted IS NULL AND s.DeliveryDate < CAST(GETDATE() AS date)) AS OverdueStages,
                  (SELECT MIN(s.DeliveryDate) FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId WHERE l.JobId = j.JobId AND s.DatePosted IS NULL AND s.DeliveryDate >= CAST(GETDATE() AS date)) AS NextDelivery
             ${from} ORDER BY j.JobName OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/jobs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [job, phases] = await Promise.all([
    query(`SELECT j.JobId, j.JobName, j.JobNum, j.DivisionId, j.Address, j.City, j.State, j.Notes, c.CustName, c.CustID
             FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId WHERE j.JobId = @id`, { id }),
    query(`SELECT ph.PhaseID, ph.Phase, ph.PhaseNum, pt.PhaseType, ph.StartDate, ph.EndDate, ph.PmContractId,
                  s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PhaseId = ph.PhaseID) AS Lots,
                  (SELECT COUNT(*) FROM JsLot l WHERE l.PhaseId = ph.PhaseID AND l.EndDate IS NULL AND l.StatusId = 1) AS OpenLots,
                  (SELECT COUNT(*) FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId WHERE l.PhaseId = ph.PhaseID AND s.DatePosted IS NULL) AS OpenStages
             FROM JsPhase ph LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId
             LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
            WHERE ph.JobId = @id ORDER BY TRY_CAST(ph.PhaseNum AS int), ph.Phase`, { id }),
  ]);
  if (!job[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: job[0], phases });
}));

// Phase with its lots, each summarised by plan, status and schedule
router.get('/phases/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [ph, lots, plans] = await Promise.all([
    query(`SELECT ph.*, j.JobName, j.JobNum, j.DivisionId, j.City AS JobCity, j.Notes AS JobNotes, c.CustName,
                  s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2, pt.PhaseType
             FROM JsPhase ph JOIN JsJob j ON j.JobId = ph.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
             LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
             LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId WHERE ph.PhaseID = @id`, { id }),
    query(`SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, l.PmPlanId, pl.PlanNum, l.StatusId, st.Status, l.StartDate, l.EndDate, l.SubsId, sb.SubsName,
                  (SELECT COUNT(*) FROM JsPack p WHERE p.LotId = l.LotID) AS Packs,
                  (SELECT COUNT(*) FROM JsStage s WHERE s.LotId = l.LotID) AS Stages,
                  (SELECT COUNT(*) FROM JsStage s WHERE s.LotId = l.LotID AND s.DatePosted IS NULL) AS OpenStages,
                  (SELECT COUNT(*) FROM JsStage s WHERE s.LotId = l.LotID AND s.DatePosted IS NULL AND s.DeliveryDate < CAST(GETDATE() AS date)) AS OverdueStages,
                  (SELECT MIN(s.DeliveryDate) FROM JsStage s WHERE s.LotId = l.LotID AND s.DatePosted IS NULL) AS NextDelivery
             FROM JsLot l LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN LsStatus st ON st.StatusID = l.StatusId
             LEFT JOIN LsSubstitutionType sb ON sb.SubsID = l.SubsId
            WHERE l.PhaseId = @id ORDER BY TRY_CAST(l.Lot AS int), l.Lot, l.Block`, { id }),
    query(`SELECT pl.PmPlanID AS id, pl.PlanNum, pl.PlanName, pl.SqFt, pl.Universal
             FROM JsPhase ph JOIN PmPlan pl ON pl.PmContractId = ph.PmContractId WHERE ph.PhaseID = @id AND ISNULL(pl.Universal,0) = 0
            ORDER BY pl.PlanNum`, { id }),
  ]);
  if (!ph[0]) return res.status(404).json({ error: 'Phase not found' });
  res.json({ phase: ph[0], lots, plans });
}));

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------
const LOT = {
  table: 'JsLot', idCol: 'LotID',
  columns: ['PhaseId', 'JobId', 'Lot', 'Block', 'PmPlanId', 'SubsId', 'StartDate', 'EndDate', 'Address', 'City', 'State', 'Zip', 'Permit',
    'StatusId', 'Estimate', 'RevEstimate', 'Contract', 'RevContract', 'LotNotes'],
};

async function logEndDate(tx, lotId, prev, next, user) {
  const same = (prev ? new Date(prev).toISOString().slice(0, 10) : null) === (next || null);
  if (same) return;
  const id = await nextId(tx, 'JsLotEndDateRegistry', 'LotCloseChangeID');
  await query(
    `INSERT INTO JsLotEndDateRegistry (LotCloseChangeID, LotId, EndDatePrevious, EndDateNew, ChangeUser, ChangeDate, Action)
     VALUES (@id, @lot, @prev, @next, @user, GETDATE(), @action)`,
    { id, lot: lotId, prev: prev || null, next: next || null, user, action: next ? 'Close' : 'Open' }, tx);
}

function lotBody(b) {
  const o = { ...b };
  if (o.Lot !== undefined && !String(o.Lot ?? '').trim()) throw bad('Lot number is required');
  if (o.Zip !== undefined) o.Zip = o.Zip === '' || o.Zip == null ? null : parseInt(o.Zip, 10);
  if (o.PmPlanId !== undefined) o.PmPlanId = int(o.PmPlanId);
  if (o.SubsId !== undefined) o.SubsId = int(o.SubsId);
  if (o.StatusId !== undefined) o.StatusId = o.StatusId === '' || o.StatusId == null ? null : (o.StatusId === true || o.StatusId === 1 || o.StatusId === '1' ? 1 : 0);
  for (const k of ['StartDate', 'EndDate']) if (o[k] !== undefined) o[k] = isoDate(o[k]);
  return o;
}

router.post('/phases/:id/lots', h(async (req, res) => {
  const phaseId = int(req.params.id);
  const input = Array.isArray(req.body?.lots) ? req.body.lots : [req.body || {}];
  if (!input.length || input.length > 200) throw bad('Add between 1 and 200 lots at a time');
  const ids = await withTransaction(async (tx) => {
    const ph = await query('SELECT PhaseID, JobId FROM JsPhase WHERE PhaseID = @id', { id: phaseId }, tx);
    if (!ph[0]) throw bad('Phase not found', 404);
    const out = [];
    for (const raw of input) {
      const b = lotBody(raw);
      if (!b.Lot) throw bad('Lot number is required');
      if (!b.PmPlanId) throw bad(`Choose a plan for lot ${b.Lot}`);
      const dup = await query(`SELECT 1 AS x FROM JsLot WHERE PhaseId = @ph AND Lot = @lot AND ISNULL(Block,'') = ISNULL(@blk,'')`,
        { ph: phaseId, lot: String(b.Lot), blk: b.Block || null }, tx);
      if (dup.length) throw bad(`Lot ${b.Lot}${b.Block ? '/' + b.Block : ''} already exists in this phase`, 409);
      const plan = await query(`SELECT 1 AS x FROM PmPlan pl JOIN JsPhase ph ON ph.PmContractId = pl.PmContractId WHERE pl.PmPlanID = @pl AND ph.PhaseID = @ph`,
        { pl: b.PmPlanId, ph: phaseId }, tx);
      if (!plan.length) throw bad(`Plan for lot ${b.Lot} does not belong to this phase's contract`);
      out.push(await insertRow(LOT, {
        Estimate: '$0.00', RevEstimate: '$0.00', Contract: '$0.00', RevContract: '$0.00', StartDate: new Date().toISOString().slice(0, 10), ...b,
        PhaseId: phaseId, JobId: ph[0].JobId, StatusId: 1, EndDate: null,
      }, req.user.username, tx));
    }
    return out;
  });
  res.status(201).json({ ids });
}));

router.put('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const b = lotBody(req.body || {});
  delete b.PhaseId; delete b.JobId; // a lot never moves between phases here (that is the Database maintenance "lot transfer")
  const n = await withTransaction(async (tx) => {
    const cur = await query('SELECT LotID, EndDate, PmPlanId, PhaseId FROM JsLot WHERE LotID = @id', { id }, tx);
    if (!cur[0]) throw bad('Lot not found', 404);
    if (b.PmPlanId && b.PmPlanId !== cur[0].PmPlanId) {
      const posted = await query('SELECT COUNT(*) AS n FROM JsStage WHERE LotId = @id AND DatePosted IS NOT NULL', { id }, tx);
      if (posted[0].n) throw bad('The plan cannot change after a stage has been posted');
      const ok = await query(`SELECT 1 AS x FROM PmPlan pl JOIN JsPhase ph ON ph.PmContractId = pl.PmContractId WHERE pl.PmPlanID = @pl AND ph.PhaseID = @ph`, { pl: b.PmPlanId, ph: cur[0].PhaseId }, tx);
      if (!ok.length) throw bad("That plan does not belong to this phase's contract");
    }
    if (b.EndDate !== undefined) await logEndDate(tx, id, cur[0].EndDate, b.EndDate, req.user.username);
    return updateRow(LOT, id, b, tx);
  });
  if (!n) return res.status(404).json({ error: 'Lot not found' });
  res.json({ ok: true });
}));

router.delete('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const [posted, paid, billed, packsPosted] = await par(tx, [
      () => query('SELECT COUNT(*) AS n FROM JsStage WHERE LotId = @id AND DatePosted IS NOT NULL', { id }, tx),
      () => query('SELECT COUNT(*) AS n FROM PrLaborPaid WHERE LotId = @id', { id }, tx),
      () => query('SELECT COUNT(*) AS n FROM ArBilling WHERE LotId = @id', { id }, tx),
      () => query('SELECT COUNT(*) AS n FROM JsPack WHERE LotId = @id AND (PostedQty > 0 OR PostedLaborQty > 0)', { id }, tx),
    ]);
    if (posted[0].n || packsPosted[0].n) throw bad('This lot has posted stages. Set it to Closed or Inactive instead of deleting it.', 409);
    if (paid[0].n) throw bad('Labor has been paid on this lot, so it cannot be deleted.', 409);
    if (billed[0].n) throw bad('This lot has been billed, so it cannot be deleted.', 409);
    await query('DELETE FROM JsValue WHERE PackId IN (SELECT PackID FROM JsPack WHERE LotId = @id)', { id }, tx);
    await query('DELETE FROM JsPack WHERE LotId = @id', { id }, tx);
    await query('DELETE FROM JsStage WHERE LotId = @id', { id }, tx);
    await deleteRow(LOT, id, tx);
  });
  res.json({ ok: true });
}));

// Packs that can be scheduled on a lot: the plan's own packs + the universal packs of the phase contract
async function availablePacks(lotId, tx) {
  return query(
    `SELECT pk.PmPackID AS id, pk.PackName, pk.PackTypeId, pt.PackType, pk.BuilderCode, pk.ContractVal, pl.Universal
       FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       JOIN PmPlan pl ON pl.PmContractId = ph.PmContractId AND (pl.PmPlanID = l.PmPlanId OR ISNULL(pl.Universal,0) = 1)
       JOIN PmPack pk ON pk.PmPlanId = pl.PmPlanID LEFT JOIN LsPackType pt ON pt.PackTypeID = pk.PackTypeId
      WHERE l.LotID = @lotId AND ISNULL(pk.StatusId,1) = 1
      ORDER BY pk.PackTypeId, pk.PackName`, { lotId }, tx);
}

router.get('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const lot = await query(
    `SELECT l.*, pl.PlanNum, pl.SqFt, st.Status, sb.SubsName, ph.Phase, ph.PmContractId, j.JobId AS JobIdX, j.JobName, j.JobNum, j.DivisionId, c.CustName,
            s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2
       FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
       LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN LsStatus st ON st.StatusID = l.StatusId
       LEFT JOIN LsSubstitutionType sb ON sb.SubsID = l.SubsId
       LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
      WHERE l.LotID = @id`, { id });
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  const [stages, packs, available, history, plans, paid, billed] = await Promise.all([
    query(`SELECT s.StageAutoID, s.WorkId, w.WorkType, s.ScheduleStageId, ss.ScheduleStage, s.DeliveryDate, s.Notes, s.DatePosted, s.UserPosted,
                  s.DateEntered, s.UserEntered
             FROM JsStage s LEFT JOIN LsWork w ON w.WorkID = s.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId
            WHERE s.LotId = @id ORDER BY s.DeliveryDate, ss.ScheduleStage, w.WorkType`, { id }),
    query(`SELECT p.PackID, p.PmPackId, ISNULL(pk.PackName, 'Pack ' + CAST(p.PackID AS varchar)) AS PackName, pk.BuilderCode, p.PackTypeId, pt.PackType,
                  p.PackQty, p.PostedQty, p.PostedLaborQty, p.ContractEa, p.RevContractEa, p.DateEntered, p.UserEntered,
                  ISNULL(pk.StatusId, 1) AS PackActive
             FROM JsPack p LEFT JOIN PmPack pk ON pk.PmPackID = p.PmPackId LEFT JOIN LsPackType pt ON pt.PackTypeID = p.PackTypeId
            WHERE p.LotId = @id ORDER BY p.PackTypeId, pk.PackName, p.PackID`, { id }),
    availablePacks(id),
    query('SELECT TOP 20 * FROM JsLotEndDateRegistry WHERE LotId = @id ORDER BY ChangeDate DESC', { id }),
    query(`SELECT pl.PmPlanID AS id, pl.PlanNum FROM PmPlan pl WHERE pl.PmContractId = @c AND ISNULL(pl.Universal,0) = 0 ORDER BY pl.PlanNum`, { c: lot[0].PmContractId }),
    query('SELECT COUNT(*) AS n FROM PrLaborPaid WHERE LotId = @id', { id }),
    query('SELECT COUNT(*) AS n FROM ArBilling WHERE LotId = @id', { id }),
  ]);
  res.json({ lot: lot[0], stages, packs, availablePacks: available, endDateHistory: history, plans, laborPaidLines: paid[0].n, invoices: billed[0].n });
}));

// ---------------------------------------------------------------------------
// Stages (JsStage)
// ---------------------------------------------------------------------------
const STAGE = { table: 'JsStage', idCol: 'StageAutoID', columns: ['LotId', 'WorkId', 'ScheduleStageId', 'DeliveryDate', 'Notes'] };

async function addStage(tx, lotId, b, user) {
  const workId = int(b.WorkId), stageId = int(b.ScheduleStageId);
  const date = isoDate(b.DeliveryDate);
  if (!workId) throw bad('Choose a work type');
  if (!stageId) throw bad('Choose a stage');
  if (!date) throw bad('Enter a delivery date');
  const dup = await query('SELECT 1 AS x FROM JsStage WHERE LotId = @l AND WorkId = @w AND ScheduleStageId = @s', { l: lotId, w: workId, s: stageId }, tx);
  if (dup.length) throw bad('That work type and stage is already scheduled on this lot', 409);
  return insertRow(STAGE, { LotId: lotId, WorkId: workId, ScheduleStageId: stageId, DeliveryDate: date, Notes: b.Notes || null }, user, tx);
}

router.post('/lots/:id/stages', h(async (req, res) => {
  const lotId = int(req.params.id);
  const id = await withTransaction(async (tx) => {
    const lot = await query('SELECT LotID FROM JsLot WHERE LotID = @id', { id: lotId }, tx);
    if (!lot[0]) throw bad('Lot not found', 404);
    return addStage(tx, lotId, req.body || {}, req.user.username);
  });
  res.status(201).json({ id });
}));

// Schedule the same stage on several lots at once; stepDays spreads delivery dates (like the sequential dates in the sample data)
router.post('/phases/:id/stages', h(async (req, res) => {
  const phaseId = int(req.params.id);
  const b = req.body || {};
  const lotIds = (b.lotIds || []).map(int).filter(Boolean);
  if (!lotIds.length) throw bad('Select at least one lot');
  const base = isoDate(b.DeliveryDate);
  if (!base) throw bad('Enter a delivery date');
  const step = Math.max(0, Math.min(30, parseInt(b.stepDays || 0, 10) || 0));
  const result = await withTransaction(async (tx) => {
    const valid = await query(`SELECT LotID FROM JsLot WHERE PhaseId = @ph AND LotID IN (${lotIds.map((_, i) => `@l${i}`).join(',')})`,
      { ph: phaseId, ...Object.fromEntries(lotIds.map((v, i) => [`l${i}`, v])) }, tx);
    const ok = new Set(valid.map((r) => r.LotID));
    const added = [], skipped = [];
    let i = 0;
    for (const lotId of lotIds) {
      if (!ok.has(lotId)) { skipped.push({ lotId, reason: 'not in this phase' }); continue; }
      const d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + step * i);
      const dup = await query('SELECT 1 AS x FROM JsStage WHERE LotId = @l AND WorkId = @w AND ScheduleStageId = @s', { l: lotId, w: int(b.WorkId), s: int(b.ScheduleStageId) }, tx);
      if (dup.length) { skipped.push({ lotId, reason: 'already scheduled' }); continue; }
      await addStage(tx, lotId, { ...b, DeliveryDate: d.toISOString().slice(0, 10) }, req.user.username);
      added.push(lotId); i++;
    }
    return { added: added.length, skipped };
  });
  res.status(201).json(result);
}));

router.put('/stages/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const cur = await query('SELECT StageAutoID, DatePosted FROM JsStage WHERE StageAutoID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Stage not found' });
  const b = req.body || {};
  if (cur[0].DatePosted && (b.WorkId !== undefined || b.ScheduleStageId !== undefined)) throw bad('A posted stage cannot change its work type or stage');
  // Only update the fields that were actually sent — a missing field must never be turned into NULL.
  const body = {};
  if ('Notes' in b) body.Notes = b.Notes;
  if ('DeliveryDate' in b) {
    body.DeliveryDate = isoDate(b.DeliveryDate);
    if (!body.DeliveryDate) throw bad('Enter a valid delivery date');
  }
  if ('WorkId' in b) { body.WorkId = int(b.WorkId); if (!body.WorkId) throw bad('Choose a work type'); }
  if ('ScheduleStageId' in b) { body.ScheduleStageId = int(b.ScheduleStageId); if (!body.ScheduleStageId) throw bad('Choose a stage'); }
  if (body.WorkId || body.ScheduleStageId) {
    const full = await query('SELECT LotId, WorkId, ScheduleStageId FROM JsStage WHERE StageAutoID = @id', { id });
    const w = body.WorkId ?? full[0].WorkId, s = body.ScheduleStageId ?? full[0].ScheduleStageId;
    const dup = await query('SELECT 1 AS x FROM JsStage WHERE LotId = @l AND WorkId = @w AND ScheduleStageId = @s AND StageAutoID <> @id', { l: full[0].LotId, w, s, id });
    if (dup.length) throw bad('That work type and stage is already scheduled on this lot', 409);
  }
  if (!Object.keys(body).length) return res.json({ ok: true });
  await updateRow(STAGE, id, body);
  res.json({ ok: true });
}));

router.delete('/stages/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const cur = await query('SELECT DatePosted FROM JsStage WHERE StageAutoID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Stage not found' });
  if (cur[0].DatePosted) throw bad('A posted stage cannot be removed', 409);
  await deleteRow(STAGE, id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Packs on a lot (JsPack)
// ---------------------------------------------------------------------------
const PACK = { table: 'JsPack', idCol: 'PackID', columns: ['LotId', 'PackTypeId', 'PmPackId', 'PackQty', 'PostedQty', 'PostedLaborQty', 'ContractEa'] };

router.post('/lots/:id/packs', h(async (req, res) => {
  const lotId = int(req.params.id);
  const b = req.body || {};
  const qty = b.PackQty === '' || b.PackQty == null ? 1 : parseInt(b.PackQty, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw bad('Quantity must be a whole number of 1 or more');
  const id = await withTransaction(async (tx) => {
    const avail = await availablePacks(lotId, tx);
    const pk = avail.find((a) => a.id === int(b.PmPackId));
    if (!pk) throw bad('That pack is not available for this lot (it must belong to the lot\'s plan or to the universal plan)');
    const dup = await query('SELECT PackID FROM JsPack WHERE LotId = @l AND PmPackId = @p', { l: lotId, p: pk.id }, tx);
    if (dup.length) throw bad('This pack is already scheduled on the lot. Change its quantity instead.', 409);
    return insertRow(PACK, { LotId: lotId, PackTypeId: pk.PackTypeId, PmPackId: pk.id, PackQty: qty, PostedQty: 0, PostedLaborQty: 0, ContractEa: pk.ContractVal || '$0.00' }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

// Add the default pack of a stage (LsScheduleStage.ScDefaultPack, e.g. "Standard rough") to every selected lot that lacks it
router.post('/phases/:id/default-packs', h(async (req, res) => {
  const phaseId = int(req.params.id);
  const b = req.body || {};
  const stage = await query('SELECT ScDefaultPack FROM LsScheduleStage WHERE ScheduleStageID = @s', { s: int(b.ScheduleStageId) });
  const name = stage[0]?.ScDefaultPack;
  if (!name) throw bad('This stage has no default pack');
  const lotIds = (b.lotIds || []).map(int).filter(Boolean);
  if (!lotIds.length) throw bad('Select at least one lot');
  const out = await withTransaction(async (tx) => {
    let added = 0; const missing = [];
    for (const lotId of lotIds) {
      const ok = await query('SELECT 1 AS x FROM JsLot WHERE LotID = @l AND PhaseId = @p', { l: lotId, p: phaseId }, tx);
      if (!ok.length) continue;
      const avail = await availablePacks(lotId, tx);
      const pk = avail.find((a) => a.PackName === name);
      if (!pk) { missing.push(lotId); continue; }
      const dup = await query('SELECT 1 AS x FROM JsPack WHERE LotId = @l AND PmPackId = @p', { l: lotId, p: pk.id }, tx);
      if (dup.length) continue;
      await insertRow(PACK, { LotId: lotId, PackTypeId: pk.PackTypeId, PmPackId: pk.id, PackQty: 1, PostedQty: 0, PostedLaborQty: 0, ContractEa: pk.ContractVal || '$0.00' }, req.user.username, tx);
      added++;
    }
    return { added, missing, packName: name };
  });
  res.status(201).json(out);
}));

router.put('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const qty = parseInt(req.body?.PackQty, 10);
  if (!Number.isInteger(qty) || qty < 0 || qty > 9999) throw bad('Quantity must be a whole number');
  const n = await updateRow(PACK, id, { PackQty: qty });
  if (!n) return res.status(404).json({ error: 'Pack not found' });
  await query('UPDATE JsPack SET DateRevised = GETDATE() WHERE PackID = @id', { id });
  res.json({ ok: true });
}));

router.delete('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await query('SELECT PackID, PostedQty, PostedLaborQty FROM JsPack WHERE PackID = @id', { id }, tx);
    if (!cur[0]) throw bad('Pack not found', 404);
    if (cur[0].PostedQty > 0 || cur[0].PostedLaborQty > 0) throw bad('This pack has been posted, so it cannot be removed. Set its quantity to 0 instead.', 409);
    await query('DELETE FROM JsValue WHERE PackId = @id', { id }, tx);
    await deleteRow(PACK, id, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Pack ticket + posting (macros ScPackLotPost / PackLateLot)
// ---------------------------------------------------------------------------
// Lines that a stage would generate for a lot (qryJsMaterialLot01..05). `late` = only packs that were never posted.
function ticketCte(late) {
  const stageJoin = late
    ? 'JOIN JsStage js ON js.LotId = l.LotID AND js.ScheduleStageId = @stage AND js.WorkId = pm.WorkId'
    : 'JOIN JsStage js ON js.LotId = l.LotID AND js.ScheduleStageId = @stage AND js.WorkId = pm.WorkId AND js.DatePosted IS NULL';
  const packFilter = late
    ? 'AND ISNULL(pp.StatusId,1) = 1 AND jp.PackQty <> 0 AND jp.PostedQty = 0'
    : '';
  return `
  base AS (
    SELECT l.LotID, l.Lot, l.Block, l.SubsId, jp.PackID, jp.PackQty, jp.PostedLaborQty, pp.PmPackID, pp.PackName, ISNULL(pp.StatusId,1) AS PackActive,
           pm.InvItemId, pm.NoChange, pm.Notes AS PMItemNotes, pm.WorkId, pm.UnitCost, ls.StageID, ls.Stage, ls.ScheduleStageId, js.DeliveryDate,
           CAST(jp.PackQty AS decimal(18,4)) * ISNULL(pp.Quantity,1) * pm.Quantity AS MatExtQty
      FROM JsLot l
      JOIN JsPack jp ON jp.LotId = l.LotID
      JOIN PmPack pp ON pp.PmPackID = jp.PmPackId
      JOIN PmMaterial pm ON pm.PmPackId = pp.PmPackID AND pm.StatusId = 1
      JOIN LsStage ls ON ls.StageID = pm.StageId AND ls.ScheduleStageId = @stage
      ${stageJoin}
      JOIN IcItem i0 ON i0.InvItemID = pm.InvItemId AND ISNULL(i0.PmItem,0) = 0
     WHERE l.LotID = @lot ${packFilter}
  ),
  fin AS (
    SELECT b.*, CASE WHEN s.FromInvItem IS NULL THEN b.InvItemId WHEN b.NoChange = 1 THEN b.InvItemId ELSE s.ToInvItem END AS FinalItemId
      FROM base b OUTER APPLY (SELECT TOP 1 si.FromInvItem, si.ToInvItem FROM LsSubstitutionItem si
                                WHERE si.FromInvItem = b.InvItemId AND si.SubsId = b.SubsId ORDER BY si.Counter) s
  ),
  items AS (
    SELECT f.*, i.InvItem, i.Description, i.CostCodeId, i.JobCostPrice AS ItemJobCost, i.LaborCost,
           CASE WHEN i.CostCodeId = 'L' THEN i.LaborCost WHEN ISNULL(i.LastCost,0) <> 0 THEN i.LastCost ELSE i.JobCostPrice END AS JobCostPrice
      FROM fin f JOIN IcItem i ON i.InvItemID = f.FinalItemId
  )`;
}

async function ticket(lotId, stageId, late, tx) {
  const p = { lot: lotId, stage: stageId };
  const cte = `WITH ${ticketCte(late)}`;
  const [materials, labor, head] = await par(tx, [
    () => query(`${cte}
      SELECT StageID, Stage, WorkId, FinalItemId AS InvItemId, InvItem, Description, MAX(PMItemNotes) AS Notes, CostCodeId, SUM(MatExtQty) AS Qty, JobCostPrice
        FROM items WHERE CostCodeId = 'M' ${late ? 'AND MatExtQty <> 0' : ''}
       GROUP BY StageID, Stage, WorkId, FinalItemId, InvItem, Description, CostCodeId, JobCostPrice
       ORDER BY Stage, InvItem`, p, tx),
    () => query(`${cte}
      SELECT PackID, PackName, WorkId, FinalItemId AS InvItemId, InvItem, Description, MatExtQty AS Qty,
             ${late ? 'UnitCost' : 'JobCostPrice'} AS Price
        FROM items WHERE CostCodeId = 'L' ${late ? 'AND PostedLaborQty = 0' : 'AND PackActive = 1'}
       ORDER BY PackName, InvItem`, p, tx),
    () => query(`SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, l.State, l.Zip, l.SubsId, sb.SubsName, ph.Phase, j.JobName, j.JobNum, j.DivisionId, c.CustName, pl.PlanNum,
                  s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS Super1, s2.SuperName + ' ' + ISNULL(s2.SuperType,'') AS Super2,
                  (SELECT MIN(s.DeliveryDate) FROM JsStage s WHERE s.LotId = l.LotID AND s.ScheduleStageId = @stage) AS DeliveryDate,
                  (SELECT ScheduleStage FROM LsScheduleStage WHERE ScheduleStageID = @stage) AS ScheduleStage
             FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
             LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN LsSubstitutionType sb ON sb.SubsID = l.SubsId
             LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
            WHERE l.LotID = @lot`, p, tx),
  ]);
  return { head: head[0], materials, labor };
}

// What posting would do and whether it is allowed
async function postState(lotId, stageId, tx) {
  const [packs, stageRows, lateCandidates] = await par(tx, [
    () => query('SELECT COUNT(*) AS n FROM JsPack WHERE LotId = @lot AND PackQty <> 0', { lot: lotId }, tx),
    () => query(`SELECT SUM(CASE WHEN DatePosted IS NULL THEN 1 ELSE 0 END) AS openRows, SUM(CASE WHEN DatePosted IS NOT NULL THEN 1 ELSE 0 END) AS postedRows, COUNT(*) AS total
             FROM JsStage WHERE LotId = @lot AND ScheduleStageId = @stage`, { lot: lotId, stage: stageId }, tx),
    () => query(`SELECT COUNT(*) AS n FROM JsPack jp WHERE jp.LotId = @lot AND jp.PackQty <> 0 AND jp.PostedQty = 0`, { lot: lotId }, tx),
  ]);
  const s = stageRows[0];
  const state = {
    packsScheduled: packs[0].n, stageRows: s.total || 0, openRows: s.openRows || 0, postedRows: s.postedRows || 0, latePacks: lateCandidates[0].n,
  };
  state.canPost = state.packsScheduled > 0 && state.stageRows > 0 && state.postedRows === 0 && state.openRows > 0;
  state.canPostLate = state.postedRows > 0 && state.latePacks > 0;
  state.reason = !state.packsScheduled ? 'Schedule packs on this lot before posting.'
    : !state.stageRows ? 'This stage is not scheduled on the lot.'
    : state.postedRows ? 'This stage has already been sent out. Use "Post late packs" if packs were added since.'
    : null;
  return state;
}

router.get('/lots/:id/ticket', h(async (req, res) => {
  const lotId = int(req.params.id), stageId = int(req.query.scheduleStageId);
  if (!stageId) throw bad('Choose a stage');
  const late = req.query.late === '1';
  const [state, t] = await Promise.all([postState(lotId, stageId), ticket(lotId, stageId, late)]);
  if (!t.head) return res.status(404).json({ error: 'Lot not found' });
  res.json({ ...t, state, late });
}));

// Contract values (qryJsPostLotContractVal / ContractValDetail) — shared by both post flows
async function setContractValues(tx, lotId, user) {
  await query(
    `UPDATE l SET l.Contract = pl.ContractVal FROM JsLot l JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lot AND pl.ContractVal IS NOT NULL;
     UPDATE jp SET jp.ContractEa = pk.ContractVal FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId WHERE jp.LotId = @lot AND pk.ContractVal IS NOT NULL;
     UPDATE jp SET jp.PackTypeId = pk.PackTypeId FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId WHERE jp.LotId = @lot AND ISNULL(jp.PackTypeId,-1) <> ISNULL(pk.PackTypeId,-1)`,
    { lot: lotId }, tx);
  const base = await nextId(tx, 'JsValue', 'JsValueID');
  await query(
    `INSERT INTO JsValue (JsValueID, PackId, WorkId, ScheduleStageId, Contract, MarkDelete, UserEntered)
     SELECT @base + ROW_NUMBER() OVER (ORDER BY jp.PackID, v.PmValueID) - 1, jp.PackID, v.WorkId, v.ScheduleStageId, v.Value, 0, @user
       FROM JsPack jp JOIN PmValue v ON v.PmPackId = jp.PmPackId
      WHERE jp.LotId = @lot AND NOT EXISTS (SELECT 1 FROM JsValue x WHERE x.PackId = jp.PackID)`,
    { lot: lotId, base, user }, tx);
}

router.post('/lots/:id/post', h(async (req, res) => {
  const lotId = int(req.params.id), stageId = int(req.body?.scheduleStageId);
  if (!stageId) throw bad('Choose a stage');
  const late = req.body?.late === true;
  const out = await withTransaction(async (tx) => {
    const lot = await query('SELECT LotID, Lot, Block FROM JsLot WHERE LotID = @lot', { lot: lotId }, tx);
    if (!lot[0]) throw bad('Lot not found', 404);
    const state = await postState(lotId, stageId, tx);
    if (late ? !state.canPostLate : !state.canPost) throw bad(late ? 'There are no packs waiting to be posted late for this stage.' : state.reason || 'Nothing to post.', 409);
    const t = await ticket(lotId, stageId, late, tx);
    const user = req.user.username;
    const cte = `WITH ${ticketCte(late)}`;

    // Material list (qryJsPostLotMaterial / qryJsPostLatePack04FinalItem)
    const matBase = await nextId(tx, 'JsPackMaterialTemp', 'PackMatTempID');
    const mat = await query(
      `${cte}
       INSERT INTO JsPackMaterialTemp (PackMatTempID, LotId, PackId, InvItemId, Lot, Block, PackName, Item, ScheduleStageId, WorkId, CostCodeId, ScheduleQty, JobCostPrice, DateEntered, UserEntered)
       SELECT @matBase + ROW_NUMBER() OVER (ORDER BY InvItem) - 1, LotID, 0, FinalItemId, @lotNo, @block, @packName, InvItem, ScheduleStageId, WorkId, CostCodeId,
              SUM(MatExtQty), ${late ? 'MAX(ItemJobCost)' : 'JobCostPrice'}, GETDATE(), @user
         FROM items WHERE CostCodeId = 'M' ${late ? 'AND MatExtQty <> 0' : ''}
        GROUP BY LotID, FinalItemId, InvItem, ScheduleStageId, WorkId, CostCodeId${late ? '' : ', JobCostPrice'}
       ${late ? 'HAVING SUM(MatExtQty) <> 0' : ''};
       SELECT @@ROWCOUNT AS n`,
      { lot: lotId, stage: stageId, matBase, lotNo: lot[0].Lot, block: lot[0].Block, packName: late ? 'Late pack' : 'Material pack', user }, tx);

    // Labor lines (qryJsPostLotLabor / qryJsPostLatePack05Labor)
    const labBase = await nextId(tx, 'JsPackLaborTemp', 'PackItemID');
    const lab = await query(
      `${cte}
       INSERT INTO JsPackLaborTemp (PackItemID, ComboLPIid, LotId, PackId, PackQty, PmPackId, InvItemId, ScheduleStageId, WorkId, CostCodeId, ExtItemQty, PriceEa, DateEntered, UserEntered)
       SELECT @labBase + ROW_NUMBER() OVER (ORDER BY PackID, FinalItemId) - 1, CAST(LotID AS varchar) + '.' + CAST(PackID AS varchar) + '.' + CAST(FinalItemId AS varchar),
              LotID, PackID, PackQty, PmPackID, FinalItemId, ScheduleStageId, WorkId, 'L',
              ${late ? 'CAST(PackQty - PostedLaborQty AS decimal(18,4)) * (MatExtQty / NULLIF(PackQty,0))' : 'MatExtQty'}, ${late ? 'UnitCost' : 'JobCostPrice'}, GETDATE(), @user
         FROM items WHERE CostCodeId = 'L' ${late ? 'AND PostedLaborQty = 0 AND PackQty - PostedLaborQty <> 0' : 'AND PackActive = 1'};
       SELECT @@ROWCOUNT AS n`,
      { lot: lotId, stage: stageId, labBase, user }, tx);

    if (late) {
      await query(
        `UPDATE jp SET jp.PostedQty = jp.PackQty, jp.PostedLaborQty = jp.PackQty FROM JsPack jp
          WHERE jp.LotId = @lot AND jp.PostedQty = 0 AND jp.PackQty <> 0
            AND EXISTS (SELECT 1 FROM JsStage s WHERE s.LotId = @lot AND s.ScheduleStageId = @stage AND s.DatePosted IS NOT NULL)`,
        { lot: lotId, stage: stageId }, tx);
    } else {
      await query(`UPDATE JsStage SET DatePosted = CAST(GETDATE() AS date), UserPosted = @user WHERE LotId = @lot AND ScheduleStageId = @stage`, { lot: lotId, stage: stageId, user }, tx);
      await query(`UPDATE JsPack SET PostedQty = PackQty, PostedLaborQty = PackQty WHERE LotId = @lot`, { lot: lotId }, tx);
    }
    await setContractValues(tx, lotId, user);
    return { materialLines: mat[0].n, laborLines: lab[0].n, ticket: t };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
// Stages by date: GET /schedule?from=&to=&division=&workId=&scheduleStageId=&custId=&jobId=&status=open|overdue|posted|all
router.get('/schedule', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const status = req.query.status || 'open';
  const p = {
    from: isoDate(req.query.from), to: isoDate(req.query.to), div: req.query.division || null, work: int(req.query.workId),
    stage: int(req.query.scheduleStageId), cust: int(req.query.custId), job: int(req.query.jobId), status,
    s: req.query.search ? `%${req.query.search}%` : null, offset: pg.offset, pageSize: pg.pageSize,
  };
  const from = `FROM JsStage s JOIN JsLot l ON l.LotID = s.LotId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
    LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN LsWork w ON w.WorkID = s.WorkId
    LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId
    WHERE (@from IS NULL OR s.DeliveryDate >= @from) AND (@to IS NULL OR s.DeliveryDate <= @to)
      AND (@div IS NULL OR j.DivisionId = @div) AND (@work IS NULL OR s.WorkId = @work) AND (@stage IS NULL OR s.ScheduleStageId = @stage)
      AND (@cust IS NULL OR j.CustId = @cust) AND (@job IS NULL OR j.JobId = @job)
      AND (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s OR l.Address LIKE @s OR l.Lot LIKE @s)
      AND (@status = 'all' OR (@status = 'open' AND s.DatePosted IS NULL AND l.EndDate IS NULL)
           OR (@status = 'overdue' AND s.DatePosted IS NULL AND s.DeliveryDate < CAST(GETDATE() AS date) AND l.EndDate IS NULL)
           OR (@status = 'posted' AND s.DatePosted IS NOT NULL))`;
  const [rows, total, byStage] = await Promise.all([
    query(`SELECT s.StageAutoID, s.DeliveryDate, s.DatePosted, s.ScheduleStageId, ss.ScheduleStage, w.WorkType, l.LotID, l.Lot, l.Block, l.Address, l.City, pl.PlanNum,
                  j.JobId, j.JobName, j.DivisionId, c.CustName, ph.Phase,
                  CASE WHEN s.DatePosted IS NULL AND s.DeliveryDate < CAST(GETDATE() AS date) THEN DATEDIFF(day, s.DeliveryDate, CAST(GETDATE() AS date)) END AS DaysOverdue
             ${from} ORDER BY s.DeliveryDate, j.JobName, TRY_CAST(l.Lot AS int), l.Lot OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from}`, p),
    query(`SELECT ss.ScheduleStage, w.WorkType, COUNT(*) AS n ${from} GROUP BY ss.ScheduleStage, w.WorkType ORDER BY n DESC`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize, summary: byStage });
}));

// Lot scheduling backlog: lots of a job with whether a stage is scheduled (ScLotBacklog)
router.get('/backlog', h(async (req, res) => {
  const jobId = int(req.query.jobId), stageId = int(req.query.scheduleStageId);
  if (!jobId || !stageId) throw bad('Choose a job and a stage');
  const rows = await query(
    `SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, pl.PlanNum, l.EndDate, ph.Phase,
            s.StageAutoID, s.DeliveryDate, s.DatePosted, w.WorkType,
            CASE WHEN s.StageAutoID IS NULL THEN 'Not scheduled' WHEN s.DatePosted IS NOT NULL THEN 'Posted' ELSE 'Scheduled' END AS Status
       FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
       LEFT JOIN JsStage s ON s.LotId = l.LotID AND s.ScheduleStageId = @stage LEFT JOIN LsWork w ON w.WorkID = s.WorkId
      WHERE l.JobId = @job AND l.StatusId = 1 AND (@all = 1 OR l.EndDate IS NULL)
      ORDER BY ph.Phase, TRY_CAST(l.Lot AS int), l.Lot, w.WorkType`,
    { job: jobId, stage: stageId, all: req.query.includeClosed === '1' ? 1 : 0 });
  res.json({ rows, summary: {
    lots: new Set(rows.map((r) => r.LotID)).size,
    notScheduled: new Set(rows.filter((r) => r.Status === 'Not scheduled').map((r) => r.LotID)).size,
  } });
}));

// Pack search (ScPackSearchWord): pack names containing every word, with how many open lots have them scheduled
router.get('/pack-search', h(async (req, res) => {
  const words = String(req.query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return res.json({ rows: [] });
  const p = { div: req.query.division || null };
  words.forEach((w, i) => (p[`w${i}`] = `%${w}%`));
  const cond = words.map((_, i) => `pk.PackName LIKE @w${i}`).join(' AND ');
  const rows = await query(
    `SELECT TOP 200 pk.PackName, pt.PackType, COUNT(DISTINCT jp.LotId) AS Lots, SUM(jp.PackQty) AS Qty, SUM(jp.PackQty - jp.PostedQty) AS Unposted
       FROM PmPack pk LEFT JOIN LsPackType pt ON pt.PackTypeID = pk.PackTypeId
       JOIN JsPack jp ON jp.PmPackId = pk.PmPackID JOIN JsLot l ON l.LotID = jp.LotId AND l.EndDate IS NULL AND l.StatusId = 1
       JOIN JsJob j ON j.JobId = l.JobId
      WHERE ${cond} AND (@div IS NULL OR j.DivisionId = @div)
      GROUP BY pk.PackName, pt.PackType ORDER BY pk.PackName`, p);
  res.json({ rows });
}));

module.exports = router;
