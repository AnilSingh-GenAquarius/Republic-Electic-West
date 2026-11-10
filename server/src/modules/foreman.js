// Foreman reports (FM) — the Access SwitchFM screen: builder / job / lot / phase filters and six field reports.
// Read-only. Pay rates are never shown to foremen (Access masks the digits of the pay item), only quantities and percentages.
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const need = (v, what) => { if (!v) throw bad(`Choose a ${what}`); return v; };

// ---- filters (cascading, as the Access combos) ----
router.get('/pick/customers', h(async (req, res) => {
  res.json(await query('SELECT c.CustID AS id, c.CustName AS name FROM JsCustomer c ORDER BY c.CustName'));
}));
router.get('/pick/jobs', h(async (req, res) => {
  res.json(await query('SELECT JobId AS id, JobName AS name, DivisionId FROM JsJob WHERE CustId = @c ORDER BY JobName', { c: int(req.query.customerId) }));
}));
router.get('/pick/lots', h(async (req, res) => {
  res.json(await query(`SELECT LotID AS id, Lot, Block, StartDate, EndDate, CASE WHEN Block IS NULL OR Block = '' THEN Lot ELSE Lot + '/' + Block END AS name
    FROM JsLot WHERE JobId = @j ORDER BY TRY_CAST(Lot AS int), Lot, Block`, { j: int(req.query.jobId) }));
}));
router.get('/pick/phases', h(async (req, res) => {
  res.json(await query('SELECT PhaseID AS id, Phase AS name, PhaseNum, StartDate, EndDate FROM JsPhase WHERE JobId = @j ORDER BY Phase', { j: int(req.query.jobId) }));
}));

// Lot / phase heading shared by the lot reports
const HEAD = `
  SELECT c.CustID, c.CustName, j.JobId, j.JobName, j.DivisionId, ph.PhaseID, ph.Phase, ph.StartDate AS PhaseStart, pt.PhaseType,
         CAST(c.CustID AS varchar(12)) + '.' + CAST(j.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS Code,
         s1.SuperName AS Super1, s1.SuperType AS Super1Type, s2.SuperName AS Super2, s2.SuperType AS Super2Type,
         pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate`;
const HEAD_FROM = `
  FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId
  JOIN JsPhase ph ON ph.JobId = j.JobId
  LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId
  LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
  LEFT JOIN PmContract pc ON pc.PmContractID = ph.PmContractId`;
async function lotHead(lotId) {
  const r = await query(`${HEAD}, l.LotID, l.Lot, l.Block, l.StartDate, l.EndDate, l.Address, l.City, l.State, l.Zip, l.Permit, pl.PlanNum, pl.PlanName, pl.SqFt
    ${HEAD_FROM} JOIN JsLot l ON l.PhaseId = ph.PhaseID AND l.JobId = j.JobId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @id`, { id: lotId });
  if (!r[0]) throw Object.assign(new Error('Lot not found'), { status: 404 });
  return r[0];
}

// A) Start packet — pack labor of a lot (Access FmStartPacketLotLabor + summary of optional packs)
router.get('/reports/start-packet', h(async (req, res) => {
  const lotId = need(int(req.query.lotId), 'lot');
  const head = await lotHead(lotId);
  const base = `FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = pk.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
    JOIN LsStage st ON st.StageID = m.StageId JOIN LsWork w ON w.WorkID = m.WorkId JOIN LsPackType t ON t.PackTypeID = pk.PackTypeId
    WHERE jp.LotId = @id AND m.StatusId = 1 AND i.CostCodeId = 'L' AND st.HideStartPackLabor = 0`;
  const [lines, summary] = await Promise.all([
    query(`SELECT jp.PackID, pk.PackName, t.PackType, pk.PackTypeId, jp.PackQty, st.Stage, w.WorkType, i.AlternateCode, m.Quantity, jp.PackQty * m.UnitCost * m.Quantity AS Price
      ${base} AND jp.PackQty > 0 ORDER BY t.PackType, pk.PackName, st.Stage, w.WorkType, i.AlternateCode`, { id: lotId }),
    query(`SELECT t.PackType, st.Stage, w.WorkType, SUM(jp.PackQty * m.UnitCost * m.Quantity) AS Price
      ${base} AND w.WorkID IN (2, 3) AND t.Opt = 1 GROUP BY t.PackType, st.Stage, w.WorkType ORDER BY t.PackType DESC, st.Stage, w.WorkType`, { id: lotId }),
  ]);
  res.json({ head, lines, summary, total: lines.reduce((a, l) => a + Number(l.Price || 0), 0) });
}));

// B) WIP of a job's open lots — labor/material estimate vs paid/posted (labor including burden %)
router.get('/reports/wip', h(async (req, res) => {
  const jobId = need(int(req.query.jobId), 'job');
  const burden = req.query.burden === undefined || req.query.burden === '' ? 25 : Number(req.query.burden);
  if (isNaN(burden) || burden < 0 || burden > 200) throw bad('Labor burden must be a percentage between 0 and 200');
  const f = 1 + burden / 100;
  const rows = await query(`
    SELECT c.CustName, j.DivisionId, j.JobName, ph.Phase, l.LotID, l.Lot + '/' + ISNULL(l.Block,'') AS LotBlock,
           le.LaborEst * @f AS LaborEst, lp.LaborPaid * @f AS LaborPaid, me.MaterialEst, mp.MaterialPosted
      FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      CROSS APPLY (SELECT SUM(jp.PackQty * m.Quantity * m.UnitCost) AS LaborEst FROM JsPack jp JOIN PmMaterial m ON m.PmPackId = jp.PmPackId JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE jp.LotId = l.LotID AND i.CostCodeId = 'L') le
      OUTER APPLY (SELECT SUM(ISNULL(p.ExtItemQty * p.PriceEa * p.PayPercent / 100, 0) + ISNULL(p.PayHours * TRY_CAST(p.HourlyRate AS decimal(18,4)), 0)) AS LaborPaid FROM PrLaborPaid p WHERE p.LotId = l.LotID) lp
      OUTER APPLY (SELECT SUM(jp.PackQty * m.Quantity * m.UnitCost) AS MaterialEst FROM JsPack jp JOIN PmMaterial m ON m.PmPackId = jp.PmPackId JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE jp.LotId = l.LotID AND i.CostCodeId <> 'L') me
      OUTER APPLY (SELECT SUM(CAST(x.ExtItemQty AS decimal(18,4)) * x.JobCostPrice) AS MaterialPosted FROM JcLotItem x WHERE x.LotId = l.LotID AND x.CostCodeId <> 'L') mp
     WHERE l.JobId = @j AND l.EndDate IS NULL AND le.LaborEst IS NOT NULL
     ORDER BY ph.Phase, TRY_CAST(l.Lot AS int), l.Lot, l.Block`, { j: jobId, f });
  for (const r of rows) {
    r.LaborPercent = r.LaborEst ? Number(r.LaborPaid || 0) / Number(r.LaborEst) : null
    r.MaterialPercent = r.MaterialEst ? Number(r.MaterialPosted || 0) / Number(r.MaterialEst) : null
  }
  const t = rows.reduce((a, r) => ({ LaborEst: a.LaborEst + Number(r.LaborEst || 0), LaborPaid: a.LaborPaid + Number(r.LaborPaid || 0), MaterialEst: a.MaterialEst + Number(r.MaterialEst || 0), MaterialPosted: a.MaterialPosted + Number(r.MaterialPosted || 0) }),
    { LaborEst: 0, LaborPaid: 0, MaterialEst: 0, MaterialPosted: 0 });
  res.json({ rows, totals: t, burden });
}));

// C) Labor paid to a lot (no money: the pay item's digits are masked as in Access)
router.get('/reports/labor-paid', h(async (req, res) => {
  const lotId = need(int(req.query.lotId), 'lot');
  const head = await lotHead(lotId);
  const rows = await query(`SELECT p.PayrollDate, p.EmpName, p.PackName, p.PackQty, p.Item, p.ExtItemQty, ss.ScheduleStage, w.WorkType, p.PayPercent, p.PayHours, p.Notes
      FROM PrLaborPaid p JOIN LsScheduleStage ss ON ss.ScheduleStageID = p.ScheduleStageId JOIN LsWork w ON w.WorkID = p.WorkId
     WHERE p.LotId = @id ORDER BY p.PayrollDate, p.EmpName, p.PackName`, { id: lotId });
  for (const r of rows) r.Item = r.Item == null ? null : String(r.Item).replace(/[0-9]/g, 'x');
  res.json({ head, rows });
}));

// D) Material posted to a lot (job cost, not labor)
router.get('/reports/material-posted', h(async (req, res) => {
  const lotId = need(int(req.query.lotId), 'lot');
  const head = await lotHead(lotId);
  const rows = await query(`SELECT w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItemID, i.InvItem, i.Description,
         CASE WHEN x.CounterReasonId > 0 THEN 'Counter material' ELSE 'Production pack' END AS Delivery,
         SUM(x.ExtItemQty) AS Qty, SUM(CAST(x.ExtItemQty AS decimal(18,4)) * x.JobCostPrice) AS ExtVal
      FROM JcLotItem x JOIN LsScheduleStage ss ON ss.ScheduleStageID = x.ScheduleStageId JOIN LsWork w ON w.WorkID = x.WorkId
      JOIN IcItem i ON i.InvItemID = x.InvItemId JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE x.LotId = @id AND x.CostCodeId <> 'L'
     GROUP BY w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItemID, i.InvItem, i.Description, CASE WHEN x.CounterReasonId > 0 THEN 'Counter material' ELSE 'Production pack' END
     ORDER BY w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItem`, { id: lotId });
  res.json({ head, rows, total: rows.reduce((a, r) => a + Number(r.ExtVal || 0), 0) });
}));

// E) Sequence sheet — packs of a lot, or of every lot of a phase
router.get('/reports/sequence', h(async (req, res) => {
  const lotId = int(req.query.lotId), phaseId = int(req.query.phaseId);
  if (!lotId && !phaseId) throw bad('Choose a lot or a phase');
  const rows = await query(`${HEAD}, l.LotID, CASE WHEN l.Block IS NULL OR l.Block = '' THEN l.Lot ELSE l.Lot + '/' + l.Block END AS LotBlock, l.Address, l.City,
         pl.PlanNum, pl.PlanName, pk.PackName, pk.BuilderCode, jp.PackQty, jp.PackID, ISNULL(jp.DateRevised, jp.DateEntered) AS PackDate, CASE WHEN pk.Verified = 1 THEN 'Yes' ELSE 'No' END AS Verified
    ${HEAD_FROM} JOIN JsLot l ON l.PhaseId = ph.PhaseID AND l.JobId = j.JobId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack pk ON pk.PmPackID = jp.PmPackId
    WHERE ${lotId ? 'l.LotID = @lot' : 'ph.PhaseID = @ph'}
    ORDER BY TRY_CAST(l.Lot AS int), l.Lot, l.Block, CASE WHEN pk.BuilderCode IS NULL THEN 1 ELSE 0 END, pk.BuilderCode, pk.PackName`, { lot: lotId, ph: phaseId });
  const lots = [];
  for (const r of rows) {
    let g = lots[lots.length - 1];
    if (!g || g.LotID !== r.LotID) { g = { LotID: r.LotID, LotBlock: r.LotBlock, Address: r.Address, City: r.City, PlanNum: r.PlanNum, PlanName: r.PlanName, packs: [] }; lots.push(g) }
    g.packs.push({ PackID: r.PackID, PackName: r.PackName, BuilderCode: r.BuilderCode, PackQty: r.PackQty, PackDate: r.PackDate, Verified: r.Verified })
  }
  const head = rows[0] ? (({ CustName, JobName, Phase, Code, Super1, Super1Type, Super2, Super2Type, BidNum, BidRelease, BidName, BidDate, PhaseStart, DivisionId }) =>
    ({ CustName, JobName, Phase, Code, Super1, Super1Type, Super2, Super2Type, BidNum, BidRelease, BidName, BidDate, PhaseStart, DivisionId }))(rows[0]) : null;
  res.json({ head, lots });
}));

// Data research — inventory item list / item research (Access InventoryItem + ItemResearch: search the description, no costs)
router.get('/items', h(async (req, res) => {
  const s = String(req.query.search || '').trim();
  const p = { s: s ? `%${s}%` : null, cls: int(req.query.classId) };
  const rows = await query(`SELECT TOP 500 i.InvItemID, ic.InvClass, i.InvItem, i.Description, i.AlternateCode
      FROM IcItem i JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
     WHERE (@s IS NULL OR i.Description LIKE @s OR i.InvItem LIKE @s OR i.AlternateCode LIKE @s) AND (@cls IS NULL OR i.InvClassId = @cls) AND i.StatusId = 1
     ORDER BY ic.InvClass, i.InvItem`, p);
  res.json({ rows, classes: await query('SELECT InvClassID AS id, InvClass AS name FROM LsInvClass ORDER BY InvClass') });
}));

module.exports = router;
