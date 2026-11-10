// Public (PU) — Access SwitchPU: the read-only look-up switchboard every login can open.
// Filters on the switchboard (lot address with the A1/A2 "address overflow" search, job → lot / phase, status + division,
// PM customer → job → bid → plan, schedule stage) feed eleven reports:
//   JsJobAlphabetically (residential job list), PmJobList (PM job list by customer), PuAddressSearchSimple (address lot search),
//   PuAddressSearchLot (lot info search), JsJobCity (jobs by city), JsJobDivisionStatus (jobs by division & status),
//   PuStatusSearchLot (status search), PuPlanStandardDataPM / PuPlanOptionDataPM (plan standard / option data),
//   PuStartPacketLaborLotStage / PuStartPacketLaborPhaseStage (start pack labor for a lot / phase at a schedule stage).
//
// Access rules reproduced:
//   * job lists hide customers named "Test*" and (city / division-status lists) jobs named "*Test*"
//   * status 0 ("1-All status") means every job status (StatusId > 0)
//   * start pack labor = active PM material of cost code L, stage not hidden from start-pack labor, pack qty summed per
//     lot + PM pack (only packs whose summed qty <> 0), joined to the lot's JsStage for the same schedule stage + work
//   * Access "Last(SuperName)" has no SQL Server equivalent; MAX() is used (one superintendent per job in practice)
//   * JsLot.StatusId is a BIT in the sample (1 = Active); status search treats 0 as LsStatus 2 (Inactive), like Job setup
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max = 100) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null };
const need = (v, msg) => { if (v == null) throw bad(msg); return v };
const LOTBLOCK = (l = 'l') => `CASE WHEN ${l}.Block IS NULL THEN ${l}.Lot ELSE ISNULL(${l}.Lot,'') + '/' + ${l}.Block END`;
const lotStatusId = (l = 'l') => `CASE WHEN ${l}.StatusId = 1 THEN 1 ELSE 2 END`;

// ---------------------------------------------------------------------------
// Switchboard filter lists (combo RowSources)
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [statuses, divisions, scheduleStages, pmCustomers] = await Promise.all([
    query("SELECT StatusID AS id, Status AS name, Active, Inactive FROM LsStatus ORDER BY Status"),
    query('SELECT DivisionID AS id, DivisionName AS name FROM LsDivision ORDER BY DivisionID'),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT PmCustID AS id, Customer AS name FROM PmCustomer ORDER BY Customer'),
  ]);
  res.json({ statuses: [{ id: 0, name: '1-All status' }, ...statuses], divisions, scheduleStages, pmCustomers });
}));

// cboLotAddress / cboLotAddressOverflow: the overflow box filters on the address number typed in A1.
router.get('/pick/addresses', h(async (req, res) => {
  const s = str(req.query.search, 60);
  res.json(await query(`SELECT TOP 100 l.LotID AS id, l.Address, l.City, l.State, j.JobName, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS LotBlock
       FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId
      WHERE l.Address IS NOT NULL AND (@s IS NULL OR CHARINDEX(@s, l.Address) > 0) ORDER BY l.Address`, { s }));
}));
router.get('/pick/jobs', h(async (req, res) => {
  res.json(await query(`SELECT j.JobId AS id, j.JobName AS name, j.DivisionId, c.CustName FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId ORDER BY j.JobName, j.DivisionId`));
}));
router.get('/pick/lots', h(async (req, res) => {
  const jobId = int(req.query.jobId);
  res.json(jobId == null ? [] : await query(`SELECT l.LotID AS id, ${LOTBLOCK()} AS name, l.EndDate FROM JsLot l WHERE l.JobId = @j ORDER BY ${LOTBLOCK()}`, { j: jobId }));
}));
router.get('/pick/phases', h(async (req, res) => {
  const jobId = int(req.query.jobId);
  res.json(jobId == null ? [] : await query('SELECT PhaseID AS id, Phase AS name, PhaseNum FROM JsPhase WHERE JobId = @j ORDER BY Phase', { j: jobId }));
}));
router.get('/pick/pm-jobs', h(async (req, res) => {
  const c = int(req.query.customerId);
  res.json(c == null ? [] : await query('SELECT PmJobID AS id, Job AS name, JobNumber, DivisionId FROM PmJob WHERE PmCustId = @c ORDER BY Job, DivisionId', { c }));
}));
router.get('/pick/pm-contracts', h(async (req, res) => {
  const j = int(req.query.jobId);
  res.json(j == null ? [] : await query('SELECT PmContractID AS id, BidNum, BidRelease, BidName, BidDate FROM PmContract WHERE PmJobId = @j ORDER BY BidNum', { j }));
}));
router.get('/pick/pm-plans', h(async (req, res) => {
  const c = int(req.query.contractId);
  res.json(c == null ? [] : await query('SELECT PmPlanID AS id, PlanNum, PlanName, SqFt FROM PmPlan WHERE PmContractId = @c ORDER BY PlanNum', { c }));
}));

// ---------------------------------------------------------------------------
// Job lists
// ---------------------------------------------------------------------------
// JsJobAlphabetically: every residential job with its (last) phase superintendent, grouped by division in the report.
router.get('/reports/residential-jobs', h(async (req, res) => {
  res.json(await query(`SELECT c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, st.Status, MAX(s.SuperName) AS SuperName
       FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN LsStatus st ON j.StatusId = st.StatusID
       JOIN JsPhase ph ON j.JobId = ph.JobId JOIN LsSuperintendent s ON ph.SuperId1 = s.SuperID
      GROUP BY c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, st.Status
     HAVING c.CustName NOT LIKE 'Test%' ORDER BY j.DivisionId, j.JobName`));
}));
// PmJobList: production (non-template) PM jobs, grouped by division → customer.
router.get('/reports/pm-jobs', h(async (req, res) => {
  res.json(await query(`SELECT j.PmJobID, j.DivisionId, c.Customer, cs.Status AS CustomerStatus, j.Job, j.JobNumber, jt.JobType, j.SpecLevel, js.Status AS JobStatus
       FROM PmCustomer c JOIN PmJob j ON c.PmCustID = j.PmCustId JOIN LsJobType jt ON j.JobTypeId = jt.JobTypeID
       JOIN LsStatus cs ON c.StatusId = cs.StatusID JOIN LsStatus js ON j.StatusId = js.StatusID
      WHERE ISNULL(j.Template, 0) = 0 ORDER BY j.DivisionId, c.Customer, j.Job`));
}));
// JsJobCity / JsJobDivisionStatus: same query, the first grouped by city, the second by customer.
function jobsByDivision(order) {
  return h(async (req, res) => {
    const division = need(str(req.query.division, 50), 'Choose the division');
    const st = int(req.query.statusId) ?? 0;
    res.json(await query(`SELECT j.City, c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, st.Status, MAX(s.SuperName) AS SuperName
         FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN LsStatus st ON j.StatusId = st.StatusID
         JOIN JsPhase ph ON j.JobId = ph.JobId JOIN LsSuperintendent s ON ph.SuperId1 = s.SuperID
        WHERE ((@st = 0 AND j.StatusId > 0) OR j.StatusId = @st)
        GROUP BY j.City, c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, st.Status
       HAVING c.CustName NOT LIKE 'Test%' AND j.JobName NOT LIKE '%Test%' AND j.DivisionId = @d
        ORDER BY ${order}, j.JobName`, { st, d: division }));
  });
}
router.get('/reports/jobs-by-city', jobsByDivision('j.City'));
router.get('/reports/jobs-by-division-status', jobsByDivision('c.CustName'));

// ---------------------------------------------------------------------------
// Lot look-ups
// ---------------------------------------------------------------------------
// PuAddressSearchSimple (lot picked by address) and PuAddressSearchLot (lot picked by job → lot). One row per lot pack.
// The two Access queries differ: the address search takes the LOT status and needs a bid + superintendent on the phase,
// the lot info search takes the JOB status and keeps lots whose phase has no bid / superintendent.
function lotSearch(kind) {
  return h(async (req, res) => {
    const lotId = need(int(req.query.lotId), kind === 'address' ? 'Choose the lot address' : 'Choose the job and lot');
    const simple = kind === 'address';
    res.json(await query(`SELECT CAST(c.CustID AS varchar(12)) + '.' + CAST(j.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS Code,
           c.CustName, j.JobName, ph.Phase, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, s.SuperName, ph.StartDate AS PhaseStartDate,
           ${LOTBLOCK()} AS LotBlock, st.Status, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes,
           l.StartDate, l.EndDate, l.DateEntered, l.UserEntered, l.WarrantyDate, pk.PackName, pk.BuilderCode, p.PackQty, l.LotID, l.InvoiceNum, l.JobId, l.PhaseId
         FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId
         JOIN JsLot l ON ph.PhaseID = l.PhaseId ${simple ? 'AND j.JobId = l.JobId' : ''}
         LEFT JOIN JsPack p ON l.LotID = p.LotId LEFT JOIN PmPack pk ON pk.PmPackID = p.PmPackId
         ${simple ? 'JOIN' : 'LEFT JOIN'} LsSuperintendent s ON ph.SuperId1 = s.SuperID
         LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
         ${simple ? 'JOIN' : 'LEFT JOIN'} PmContract pc ON pc.PmContractID = ph.PmContractId
         JOIN LsStatus st ON st.StatusID = ${simple ? lotStatusId() : 'j.StatusId'}
        WHERE l.LotID = @id ORDER BY ${LOTBLOCK()}, pk.PackName`, { id: lotId }));
  });
}
router.get('/reports/address-lot', lotSearch('address'));
router.get('/reports/lot-info', lotSearch('lot'));

// PuStatusSearchLot: lots of a division with one lot status, grouped customer → job → phase.
router.get('/reports/status-search', h(async (req, res) => {
  const division = need(str(req.query.division, 50), 'Choose the division');
  const st = int(req.query.statusId);
  if (!st) throw bad('Choose one status (the status search does not use "All")');
  res.json(await query(`SELECT c.CustName, j.JobName, j.JobId, ph.Phase, l.LotID, ${LOTBLOCK()} AS LotBlock, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip,
         l.StartDate, l.EndDate, ${lotStatusId()} AS StatusId, st.Status, j.DivisionId
       FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId JOIN JsLot l ON ph.PhaseID = l.PhaseId
       JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN LsStatus st ON st.StatusID = ${lotStatusId()}
      WHERE ${lotStatusId()} = @st AND j.DivisionId = @d
      ORDER BY c.CustName, j.JobName, ph.Phase, ${LOTBLOCK()}`, { st, d: division }));
}));

// ---------------------------------------------------------------------------
// PM plan data (rptPuPlanStandardDataPM / rptPuPlanOptionDataPM)
// ---------------------------------------------------------------------------
function planData(flag) {
  return h(async (req, res) => {
    const planId = need(int(req.query.planId), 'Choose the PM customer, job, bid and plan');
    res.json(await query(`SELECT c.Customer, j.Job, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate, pl.PmPlanID, pl.PlanNum, pl.PlanName, pl.SqFt, pl.Bedrooms,
           pl.ACunits, pl.TvOutlet, pl.Island, pl.FloorPlug, pk.PmPackID, pk.PackName, pt.PackType, i.InvItem, i.Description, m.Quantity, sg.Stage, w.WorkType, i.CostCodeId
         FROM PmCustomer c JOIN PmJob j ON c.PmCustID = j.PmCustId JOIN PmContract pc ON j.PmJobID = pc.PmJobId JOIN PmPlan pl ON pc.PmContractID = pl.PmContractId
         JOIN PmPack pk ON pl.PmPlanID = pk.PmPlanId JOIN PmMaterial m ON pk.PmPackID = m.PmPackId JOIN LsPackType pt ON pt.PackTypeID = pk.PackTypeId
         JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsStage sg ON sg.StageID = m.StageId JOIN LsWork w ON w.WorkID = m.WorkId
        WHERE pt.${flag} = 1 AND pl.PmPlanID = @p AND pk.StatusId = 1 AND m.StatusId = 1
        ORDER BY pl.PlanNum, pk.PackName, sg.Stage, i.CostCodeId, i.InvItem`, { p: planId }));
  });
}
router.get('/reports/plan-standard', planData('Std'));
router.get('/reports/plan-option', planData('Opt'));

// ---------------------------------------------------------------------------
// Start pack labor (PuStartPacketLaborLotStage / PuStartPacketLaborPhaseStage)
// ---------------------------------------------------------------------------
function startPack(kind) {
  return h(async (req, res) => {
    const ss = need(int(req.query.scheduleStageId), 'Choose the schedule stage');
    const id = need(int(kind === 'lot' ? req.query.lotId : req.query.phaseId), kind === 'lot' ? 'Choose the job and lot' : 'Choose the job and phase');
    res.json(await query(`WITH sp AS (
           SELECT c.CustID, j.JobId, ph.PhaseID, l.LotID, p.PmPackId, SUM(p.PackQty) AS SumOfPackQty
             FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId
             JOIN JsLot l ON ph.PhaseID = l.PhaseId LEFT JOIN JsPack p ON l.LotID = p.LotId
            WHERE ${kind === 'lot' ? 'l.LotID' : 'ph.PhaseID'} = @id
            GROUP BY c.CustID, j.JobId, ph.PhaseID, l.LotID, p.PmPackId
           HAVING SUM(p.PackQty) <> 0)
         SELECT c.CustName, j.JobName, ph.Phase, l.LotID, ${LOTBLOCK()} AS LotBlock, pl.PlanNum, pl.SqFt, pk.PackTypeId, pk.PackName, pt.PackType,
                sp.SumOfPackQty, ss.ScheduleStageID, ss.ScheduleStage, sg.Stage, w.WorkType, i.AlternateCode,
                sp.SumOfPackQty * m.Quantity AS ItemQuantity, sp.SumOfPackQty * m.UnitCost * m.Quantity AS Price,
                ph.StartDate AS PhaseStartDate, s1.SuperName AS Superintendent1, s1.SuperType AS Stype1, s2.SuperName AS Superintendent2, s2.SuperType AS Stype2,
                l.StartDate AS LotStartDate, js.DeliveryDate, l.Address, l.City, l.State, l.Zip, l.Permit, pht.PhaseType,
                CAST(c.CustID AS varchar(12)) + '.' + CAST(j.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS Code
           FROM sp JOIN JsCustomer c ON c.CustID = sp.CustID JOIN JsJob j ON j.JobId = sp.JobId JOIN JsPhase ph ON ph.PhaseID = sp.PhaseID
           JOIN LsSuperintendent s1 ON ph.SuperId1 = s1.SuperID LEFT JOIN LsSuperintendent s2 ON ph.SuperId2 = s2.SuperID
           JOIN LsPhaseType pht ON ph.PhaseTypeId = pht.PhaseTypeID
           JOIN JsLot l ON l.LotID = sp.LotID JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
           JOIN PmPack pk ON pk.PmPackID = sp.PmPackId JOIN PmMaterial m ON pk.PmPackID = m.PmPackId
           JOIN IcItem i ON m.InvItemId = i.InvItemID JOIN LsStage sg ON m.StageId = sg.StageID JOIN LsWork w ON m.WorkId = w.WorkID
           JOIN LsPackType pt ON pk.PackTypeId = pt.PackTypeID JOIN LsScheduleStage ss ON sg.ScheduleStageId = ss.ScheduleStageID
           JOIN JsStage js ON js.LotId = l.LotID AND js.ScheduleStageId = ss.ScheduleStageID AND js.WorkId = w.WorkID
          WHERE m.StatusId = 1 AND ss.ScheduleStageID = @ss AND i.CostCodeId = 'L' AND ISNULL(sg.HideStartPackLabor, 0) = 0
          ORDER BY j.JobName, ph.Phase, ${LOTBLOCK()}, ${kind === 'lot' ? 'pk.PackTypeId, ss.ScheduleStage' : 'sg.Stage'}, i.AlternateCode`, { id, ss }));
  });
}
router.get('/reports/start-pack-labor-lot', startPack('lot'));
router.get('/reports/start-pack-labor-phase', startPack('phase'));

module.exports = router;
