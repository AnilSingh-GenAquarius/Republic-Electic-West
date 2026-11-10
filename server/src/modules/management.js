// Management (MG) — the Access SwitchMG screen: job cost by builder/division/job/phase/lot/super, lots ready to close,
// labor paid vs budget (+ by employee), lot budget vs job cost, job cost by type of work, option packs scheduled,
// open lots per period, packs with no value, labor/material posted to a lot, lot info detail.
//
// Access built job cost in temp tables (MgJobCostTemp*, "Process job cost info"). Here the same math is computed live:
// lots FINISHED (EndDate) between From and To, labor with burden %, taxable material with the division sales tax.
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,4))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,4)) END)`;
const RATE = (c) => `ISNULL(${MV(c)}, 0)`;
function range(q, { required = true } = {}) {
  const from = isoDate(q.from), to = isoDate(q.to);
  if (required && (!from || !to)) throw bad('Enter the From and To dates');
  if (from && to && from > to) throw bad('From must be before To');
  return { from, to };
}
function burdenOf(q, def = 25) {
  const b = q.burden === undefined || q.burden === '' ? def : Number(q.burden);
  if (isNaN(b) || b < 0 || b > 200) throw bad('Burden must be a percentage between 0 and 200');
  return b;
}

router.get('/lookups', h(async (req, res) => {
  const [customers, divisions, stages, works] = await Promise.all([
    query('SELECT CustID AS id, CustName AS name FROM JsCustomer ORDER BY CustName'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name, SalesTax FROM LsDivision ORDER BY DivisionID"),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
  ]);
  res.json({ customers, divisions, stages, works });
}));
router.get('/pick/jobs', h(async (req, res) => {
  res.json(await query(`SELECT JobId AS id, JobName AS name, JobNum, DivisionId FROM JsJob WHERE (@c IS NULL OR CustId = @c) AND (@d IS NULL OR DivisionId = @d) ORDER BY JobName`,
    { c: int(req.query.customerId), d: req.query.division || null }));
}));
router.get('/pick/lots', h(async (req, res) => {
  res.json(await query(`SELECT LotID AS id, CASE WHEN Block IS NULL OR Block = '' THEN Lot ELSE Lot + '/' + Block END AS name, StartDate, EndDate FROM JsLot WHERE JobId = @j ORDER BY TRY_CAST(Lot AS int), Lot, Block`, { j: int(req.query.jobId) }));
}));
router.get('/pick/phases', h(async (req, res) => {
  res.json(await query('SELECT PhaseID AS id, Phase AS name, PhaseNum FROM JsPhase WHERE JobId = @j ORDER BY Phase', { j: int(req.query.jobId) }));
}));
router.get('/pick/employees', h(async (req, res) => {
  res.json(await query(`SELECT EmployeeID AS id, LTRIM(ISNULL(FName,'') + ISNULL(' ' + NULLIF(MInitial,''),'') + ' ' + ISNULL(LName,'')) AS name FROM PrEmployee ORDER BY LName, FName`));
}));

// Overview: open lots per start month by division (Access SwitchMgSubOpenLot crosstab) + counts
router.get('/overview', h(async (req, res) => {
  const [open, closeSoon, finished] = await Promise.all([
    query(`SELECT FORMAT(l.StartDate,'yyyy-MM') AS Period, j.DivisionId, COUNT(*) AS Lots FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId WHERE l.EndDate IS NULL GROUP BY FORMAT(l.StartDate,'yyyy-MM'), j.DivisionId ORDER BY Period DESC`),
    query(`SELECT COUNT(*) AS n FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
            WHERE l.EndDate IS NULL AND l.StartDate <= DATEADD(day,-122,CAST(GETDATE() AS date))
              AND NOT EXISTS (SELECT 1 FROM PrLaborPaid p WHERE p.LotId = l.LotID GROUP BY p.LotId HAVING MAX(p.PayrollDate) >= DATEADD(day,-60,CAST(GETDATE() AS date)))`),
    query(`SELECT COUNT(*) AS n FROM JsLot WHERE EndDate >= DATEADD(year,-1,CAST(GETDATE() AS date))`),
  ]);
  const divisions = [...new Set(open.map((r) => r.DivisionId))].sort();
  const periods = {};
  for (const r of open) { const k = r.Period || '(no start)'; (periods[k] ||= { Period: k, total: 0 }); periods[k][r.DivisionId] = r.Lots; periods[k].total += r.Lots }
  res.json({ divisions, openByPeriod: Object.values(periods), openLots: open.reduce((a, r) => a + r.Lots, 0), readyToClose: closeSoon[0].n, finishedLastYear: finished[0].n });
}));

// ---------------------------------------------------------------------------
// Job cost (rptMgJobCost00..06) — one row per finished lot, then grouped
// ---------------------------------------------------------------------------
async function jobCostLots({ from, to, burden, division, customerId, jobId }) {
  const f = 1 + burden / 100;
  return query(`
    SELECT j.DivisionId, c.CustID AS CustId, j.JobId, ph.PhaseID AS PhaseId, l.LotID AS LotId, c.CustName AS Customer, j.JobName AS Job, ph.Phase, l.Lot, l.Block, pl.PlanNum,
           s.SuperName, s.SuperType, @burden AS LaborBurden,
           pm.PmLabor, ISNULL(pm.MatNT,0) + ISNULL(pm.MatTax,0) * (1 + ISNULL(d.SalesTax,0) / 100) AS PmMaterial,
           es.EstStdLabor, CASE WHEN es.EsRows > 0 THEN ISNULL(es.MatNT,0) + ISNULL(es.MatTax,0) * (1 + ISNULL(d.SalesTax,0) / 100) END AS EstStdMaterial, es.ContractVal,
           ISNULL(ct.Contract,0) AS Contract,
           ISNULL(jc.JcLabor,0) AS JcLabor, ISNULL(jc.MatNT,0) + ISNULL(jc.MatTax,0) * (1 + ISNULL(d.SalesTax,0) / 100) AS JcMaterial, ISNULL(bl.Billing,0) AS Billing
      FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      JOIN LsSuperintendent s ON s.SuperID = ph.SuperId1 JOIN LsDivision d ON d.DivisionID = j.DivisionId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      CROSS APPLY (SELECT SUM(CASE WHEN i.CostCodeId = 'L' THEN pk.Quantity * m.Quantity * m.UnitCost * @f ELSE 0 END) AS PmLabor,
                          SUM(CASE WHEN i.CostCodeId = 'NT' THEN pk.Quantity * m.Quantity * m.UnitCost ELSE 0 END) AS MatNT,
                          SUM(CASE WHEN i.CostCodeId NOT IN ('L','NT') THEN pk.Quantity * m.Quantity * m.UnitCost ELSE 0 END) AS MatTax
                     FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = pk.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
                    WHERE jp.LotId = l.LotID HAVING COUNT(*) > 0) pm
      OUTER APPLY (SELECT SUM(CASE WHEN i.CostCodeId = 'L' THEN CAST(ep.Quantity AS int) * em.Quantity * em.EstimatingPrice * (1 + ISNULL(eb.BurdenLabor,0) / 100.0) ELSE 0 END) AS EstStdLabor,
                          SUM(CASE WHEN i.CostCodeId = 'NT' THEN CAST(ep.Quantity AS int) * em.Quantity * em.EstimatingPrice ELSE 0 END) AS MatNT,
                          SUM(CASE WHEN i.CostCodeId NOT IN ('L','NT') THEN CAST(ep.Quantity AS int) * em.Quantity * em.EstimatingPrice ELSE 0 END) AS MatTax, COUNT(*) AS EsRows,
                          MAX(${MV('epl.ContractVal')}) AS ContractVal
                     FROM EsBid eb JOIN EsPlan epl ON epl.EsBidId = eb.EsBidID JOIN EsPack ep ON ep.EsPlanId = epl.EsPlanID JOIN EsMaterial em ON em.EsPackdId = ep.EsPackID JOIN IcItem i ON i.InvItemID = em.InvItemId
                     JOIN PmContract pc ON pc.EsBidIDLink = eb.EsBidID
                    WHERE ep.PackName LIKE 'Standard%' AND epl.PlanNum = pl.PlanNum AND pc.PmContractID = ph.PmContractId AND eb.PmJobId = j.PmJobId) es
      OUTER APPLY (SELECT SUM(jp.PackQty * ISNULL(CASE WHEN ISNULL(${MV('jp.RevContractEa')},0) = 0 THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END, 0)) AS Contract FROM JsPack jp WHERE jp.LotId = l.LotID) ct
      OUTER APPLY (SELECT SUM(CASE WHEN x.CostCodeId = 'L' THEN (ISNULL(x.ExtItemQty * x.JobCostPrice * x.PayPercent / 100, 0) + ISNULL(x.Hours * ${RATE('x.HourlyRate')}, 0)) * @f ELSE 0 END) AS JcLabor,
                          SUM(CASE WHEN x.CostCodeId = 'NT' THEN x.ExtItemQty * x.JobCostPrice ELSE 0 END) AS MatNT,
                          SUM(CASE WHEN x.CostCodeId NOT IN ('L','NT') THEN x.ExtItemQty * x.JobCostPrice ELSE 0 END) AS MatTax
                     FROM JcLotItem x WHERE x.LotId = l.LotID) jc
      OUTER APPLY (SELECT SUM(${MV('bi.ItemTotal')}) AS Billing FROM ArBilling b JOIN ArBillingItem bi ON bi.BillId = b.BillID WHERE b.LotId = l.LotID) bl
     WHERE l.EndDate >= @from AND l.EndDate < DATEADD(day, 1, CAST(@to AS date))
       AND (@division IS NULL OR j.DivisionId = @division) AND (@cust IS NULL OR j.CustId = @cust) AND (@job IS NULL OR j.JobId = @job)`,
  { from, to, burden, f, division: division || null, cust: int(customerId), job: int(jobId) });
}
const SUMS = ['EstStdLabor', 'EstStdMaterial', 'ContractVal', 'PmLabor', 'PmMaterial', 'Contract', 'JcLabor', 'JcMaterial', 'Billing'];
function finish(r) {
  const n = (k) => Number(r[k] || 0);
  r.TotalEstimate = n('EstStdLabor') + n('EstStdMaterial');
  r.EsProfit = n('ContractVal') - r.TotalEstimate;
  r.EsProfitPer = n('ContractVal') ? r.EsProfit * 100 / n('ContractVal') : 0;
  r.PmEstimate = n('PmLabor') + n('PmMaterial');
  r.PmProfit = n('Contract') - r.PmEstimate;
  r.PmProfitPer = n('Contract') ? r.PmProfit * 100 / n('Contract') : 0;
  r.JobCost = n('JcLabor') + n('JcMaterial');
  r.GrossProfit = n('Billing') - r.JobCost;
  r.GrossProfitPer = n('Billing') ? r.GrossProfit * 100 / n('Billing') : 0;
  return r;
}
// groupings = the Access reports
const JC_GROUPS = {
  'builder-division': { label: 'Job cost by builder / division', keys: ['Customer', 'DivisionId'] },
  'division-builder': { label: 'Job cost by builder', keys: ['DivisionId', 'Customer'] },
  'division-job': { label: 'Job cost by job', keys: ['DivisionId', 'Customer', 'Job'] },
  'division-job-phase': { label: 'Job cost by phase', keys: ['DivisionId', 'Customer', 'Job', 'Phase'] },
  'division-job-phase-lot': { label: 'Job cost by job / lot', keys: ['DivisionId', 'Customer', 'Job', 'Phase', 'Lot', 'Block', 'PlanNum'] },
  'division-builder-lot': { label: 'Job cost by builder / lot', keys: ['DivisionId', 'Customer', 'Job', 'Lot', 'Block', 'PlanNum'] },
  'division-super-job-phase': { label: 'Job cost by super', keys: ['DivisionId', 'SuperName', 'SuperType', 'Customer', 'Job', 'Phase'] },
};
router.get('/job-cost', h(async (req, res) => {
  const { from, to } = range(req.query);
  const burden = burdenOf(req.query);
  const g = JC_GROUPS[req.query.groupBy] || JC_GROUPS['division-job'];
  const lots = await jobCostLots({ from, to, burden, division: req.query.division, customerId: req.query.customerId, jobId: req.query.jobId });
  const map = new Map();
  for (const l of lots) {
    const key = g.keys.map((k) => l[k] ?? '').join('\u0001');
    let r = map.get(key);
    if (!r) { r = Object.fromEntries(g.keys.map((k) => [k, l[k]])); r.Lots = 0; for (const s of SUMS) r[s] = 0; r.LotId = l.LotId; map.set(key, r) }
    r.Lots++;
    for (const s of SUMS) r[s] += Number(l[s] || 0);
  }
  const rows = [...map.values()].map(finish).sort((a, b) => g.keys.map((k) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true })).find((x) => x) || 0);
  const totals = finish(lots.reduce((a, l) => { for (const s of SUMS) a[s] += Number(l[s] || 0); return a }, Object.fromEntries(SUMS.map((s) => [s, 0]))));
  totals.Lots = lots.length;
  res.json({ rows, totals, keys: g.keys, label: g.label, burden, groups: Object.entries(JC_GROUPS).map(([id, v]) => ({ id, label: v.label })) });
}));

// Packs with no value on lots finished in the range (MgJcPackNoValue)
router.get('/packs-no-value', h(async (req, res) => {
  const { from, to } = range(req.query);
  res.json(await query(`SELECT pj.DivisionId, pcu.Customer, pj.Job, pc.BidNum, pc.BidDate, pc.BidRelease, pl.PlanNum, pk.BuilderCode, pk.PackName, ${MV('jp.ContractEa')} AS ContractEa, st.Status,
         CASE WHEN pk.TruedUp = 1 THEN 'Yes' ELSE 'No' END AS TruedUp, COUNT(*) AS Lots
      FROM PmContract pc JOIN PmPlan pl ON pl.PmContractId = pc.PmContractID JOIN PmPack pk ON pk.PmPlanId = pl.PmPlanID JOIN JsLot l ON l.PmPlanId = pl.PmPlanID
      JOIN JsPack jp ON jp.LotId = l.LotID AND jp.PmPackId = pk.PmPackID JOIN PmJob pj ON pj.PmJobID = pc.PmJobId JOIN PmCustomer pcu ON pcu.PmCustID = pj.PmCustId
      LEFT JOIN LsStatus st ON st.StatusID = pk.StatusId
     WHERE l.EndDate >= @from AND l.EndDate < DATEADD(day,1,CAST(@to AS date))
       AND ((${MV('jp.ContractEa')} = 0.01) OR (ISNULL(pk.TruedUp,0) = 0 AND ISNULL(${MV('jp.ContractEa')},0) = 0))
     GROUP BY pj.DivisionId, pcu.Customer, pj.Job, pc.BidNum, pc.BidDate, pc.BidRelease, pl.PlanNum, pk.BuilderCode, pk.PackName, ${MV('jp.ContractEa')}, st.Status, pk.TruedUp
     ORDER BY pj.DivisionId, pcu.Customer, pj.Job, pl.PlanNum, pk.PackName`, { from, to }));
}));

// Lots ready to close: open, started 122+ days before the date, no labor paid in the 60 days before it (rptMgCloseLot)
router.get('/ready-to-close', h(async (req, res) => {
  const date = isoDate(req.query.date) || new Date().toISOString().slice(0, 10);
  const rows = await query(`SELECT j.DivisionId, s.SuperName, c.CustName, j.JobName, ph.Phase, pc.BidNum, l.LotID, l.Lot + '/' + ISNULL(l.Block,'') AS LotBlock, l.StartDate,
         (SELECT MAX(p.PayrollDate) FROM PrLaborPaid p WHERE p.LotId = l.LotID) AS LastPaid
      FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      JOIN LsSuperintendent s ON s.SuperID = ph.SuperId1 JOIN PmContract pc ON pc.PmContractID = ph.PmContractId
     WHERE l.StartDate <= DATEADD(day,-122,CAST(@d AS date)) AND l.EndDate IS NULL
       AND NOT EXISTS (SELECT 1 FROM PrLaborPaid p WHERE p.LotId = l.LotID GROUP BY p.LotId HAVING MAX(p.PayrollDate) >= DATEADD(day,-60,CAST(@d AS date)))
     ORDER BY ${req.query.bySuper === '1' ? 's.SuperName, ' : ''}j.DivisionId, c.CustName, j.JobName, ph.Phase, TRY_CAST(l.Lot AS int), l.Lot`, { d: date });
  res.json({ date, rows });
}));

// Labor paid vs budget, open lots of a builder + division (rptMgLaborPaidVsBudget01..03)
const PAY_PIECE = 'ROUND(ISNULL(p.ExtItemQty * p.PriceEa * p.PayPercent / 100, 0), 2)';
const PAY_HOURLY = `ROUND(ISNULL(p.PayHours * ${RATE('p.HourlyRate')}, 0), 2)`;
router.get('/labor-vs-budget', h(async (req, res) => {
  const division = req.query.division, cust = int(req.query.customerId);
  if (!division || !cust) throw bad('Choose a builder and a division');
  const rows = await query(`
    WITH u AS (
      SELECT j.DivisionId, p.JobId, p.LotId, p.ScheduleStageId, p.WorkId, ${PAY_PIECE} AS PayPiece, ${PAY_HOURLY} AS PayHourly, CAST(0 AS decimal(18,2)) AS PayContract
        FROM PrLaborPaid p JOIN JsJob j ON j.JobId = p.JobId JOIN JsLot l ON l.LotID = p.LotId AND l.JobId = j.JobId
       WHERE j.DivisionId = @div AND j.CustId = @cust AND l.EndDate IS NULL
      UNION ALL
      SELECT j.DivisionId, j.JobId, l.LotID, st.ScheduleStageId, m.WorkId, 0, 0, ROUND(jp.PackQty * pk.Quantity * m.Quantity * m.UnitCost, 2)
        FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = pk.PmPackID
        JOIN LsStage st ON st.StageID = m.StageId JOIN IcItem i ON i.InvItemID = m.InvItemId
       WHERE j.DivisionId = @div AND j.CustId = @cust AND l.EndDate IS NULL AND i.CostCodeId = 'L')
    SELECT u.DivisionId, jt.JobType, c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, w.WorkType,
           SUM(u.PayPiece) AS PayPiece, SUM(u.PayHourly) AS PayHourly, SUM(u.PayContract) AS PayContract
      FROM u JOIN JsJob j ON j.JobId = u.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsLot l ON l.LotID = u.LotId
      JOIN LsScheduleStage ss ON ss.ScheduleStageID = u.ScheduleStageId JOIN LsWork w ON w.WorkID = u.WorkId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
     GROUP BY u.DivisionId, jt.JobType, c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, w.WorkType
     ORDER BY jt.JobType, j.JobName, TRY_CAST(l.Lot AS int), l.Lot, l.Block, ss.ScheduleStage, w.WorkType`, { div: division, cust });
  res.json({ rows, totals: rows.reduce((a, r) => ({ PayPiece: a.PayPiece + Number(r.PayPiece), PayHourly: a.PayHourly + Number(r.PayHourly), PayContract: a.PayContract + Number(r.PayContract) }), { PayPiece: 0, PayHourly: 0, PayContract: 0 }) });
}));

// Labor paid vs budget by employee: lots where the chosen employees were paid in the range (rptMgLaborPaidVsBudgetEmp00..03).
// Access flagged PrEmployee.TempSelect; here the employee ids are passed in the request, nothing is written.
router.get('/labor-vs-budget-employee', h(async (req, res) => {
  const division = req.query.division;
  const { from, to } = range(req.query);
  const ids = String(req.query.employees || '').split(',').map((x) => int(x)).filter(Boolean);
  if (!division) throw bad('Choose a division');
  if (!ids.length) throw bad('Choose at least one employee');
  const list = ids.join(',');
  const rows = await query(`
    WITH lots AS (SELECT DISTINCT p.LotId FROM PrLaborPaid p JOIN JsJob j ON j.JobId = p.JobId
                   WHERE j.DivisionId = @div AND p.EmployeeId IN (${list}) AND p.PayrollDate >= @from AND p.PayrollDate < DATEADD(day,1,CAST(@to AS date))),
    u AS (
      SELECT j.DivisionId, p.JobId, p.LotId, p.EmployeeId, p.ScheduleStageId, p.WorkId, ${PAY_PIECE} AS PayPiece, ${PAY_HOURLY} AS PayHourly, CAST(0 AS decimal(18,2)) AS PayContract
        FROM PrLaborPaid p JOIN JsJob j ON j.JobId = p.JobId JOIN JsLot l ON l.LotID = p.LotId AND l.JobId = j.JobId JOIN lots ON lots.LotId = l.LotID
      UNION ALL
      SELECT j.DivisionId, j.JobId, l.LotID, 0, st.ScheduleStageId, m.WorkId, 0, 0, ROUND(jp.PackQty * pk.Quantity * m.Quantity * m.UnitCost, 2)
        FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN lots ON lots.LotId = l.LotID JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack pk ON pk.PmPackID = jp.PmPackId
        JOIN PmMaterial m ON m.PmPackId = pk.PmPackID JOIN LsStage st ON st.StageID = m.StageId JOIN IcItem i ON i.InvItemID = m.InvItemId
       WHERE i.CostCodeId = 'L')
    SELECT u.DivisionId, c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, w.WorkType, u.EmployeeId,
           CASE WHEN u.EmployeeId = 0 THEN 'Budget' ELSE LTRIM(ISNULL(e.FName,'') + ISNULL(' ' + NULLIF(e.MInitial,''),'') + ' ' + ISNULL(e.LName,'')) END AS Employee,
           SUM(u.PayPiece) AS PayPiece, SUM(u.PayHourly) AS PayHourly, SUM(u.PayContract) AS PayContract
      FROM u JOIN JsJob j ON j.JobId = u.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsLot l ON l.LotID = u.LotId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      JOIN LsScheduleStage ss ON ss.ScheduleStageID = u.ScheduleStageId JOIN LsWork w ON w.WorkID = u.WorkId LEFT JOIN PrEmployee e ON e.EmployeeID = u.EmployeeId
     GROUP BY u.DivisionId, c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, w.WorkType, u.EmployeeId, e.FName, e.MInitial, e.LName
     ORDER BY c.CustName, j.JobName, TRY_CAST(l.Lot AS int), l.Lot, l.Block, ss.ScheduleStage, w.WorkType, u.EmployeeId`, { div: division, from, to });
  res.json({ rows, totals: rows.reduce((a, r) => ({ PayPiece: a.PayPiece + Number(r.PayPiece), PayHourly: a.PayHourly + Number(r.PayHourly), PayContract: a.PayContract + Number(r.PayContract) }), { PayPiece: 0, PayHourly: 0, PayContract: 0 }) });
}));

// Lot budget vs job cost by cost code / stage / work (rptMgHg01..03; burden here is a fraction-free % like the other reports)
router.get('/lot-budget', h(async (req, res) => {
  const lotId = int(req.query.lotId);
  if (!lotId) throw bad('Choose a lot');
  if (req.query.burden === undefined || req.query.burden === '') throw bad('Enter a value under burden %');
  const f = 1 + burdenOf(req.query) / 100;
  const rows = await query(`
    WITH b AS (SELECT i.CostCodeId, st.ScheduleStageId, m.WorkId, SUM(pk.Quantity * m.Quantity) AS Qty,
                      SUM(CASE WHEN i.CostCodeId = 'L' THEN pk.Quantity * m.Quantity * m.UnitCost * @f ELSE pk.Quantity * m.Quantity * m.UnitCost END) AS ExtVal
                 FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = pk.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsStage st ON st.StageID = m.StageId
                WHERE jp.LotId = @lot GROUP BY i.CostCodeId, st.ScheduleStageId, m.WorkId),
         a AS (SELECT x.CostCodeId, x.ScheduleStageId, x.WorkId, SUM(x.ExtItemQty) AS Qty,
                      SUM(CASE WHEN x.CostCodeId = 'L' THEN (CASE WHEN ISNULL(x.PayPercent,0) <> 0 THEN x.ExtItemQty * x.JobCostPrice * x.PayPercent / 100 ELSE ISNULL(x.Hours,0) * ${RATE('x.HourlyRate')} END) * @f ELSE x.ExtItemQty * x.JobCostPrice END) AS ExtVal
                 FROM JcLotItem x WHERE x.LotId = @lot GROUP BY x.CostCodeId, x.ScheduleStageId, x.WorkId),
         k AS (SELECT CostCodeId, ScheduleStageId, WorkId FROM b UNION SELECT CostCodeId, ScheduleStageId, WorkId FROM a)
    SELECT k.CostCodeId, ss.ScheduleStage, w.WorkType, ISNULL(b.ExtVal,0) AS BudgetValue, ISNULL(a.ExtVal,0) AS JobCostValue
      FROM k LEFT JOIN b ON b.CostCodeId = k.CostCodeId AND b.ScheduleStageId = k.ScheduleStageId AND b.WorkId = k.WorkId
      LEFT JOIN a ON a.CostCodeId = k.CostCodeId AND a.ScheduleStageId = k.ScheduleStageId AND a.WorkId = k.WorkId
      JOIN LsScheduleStage ss ON ss.ScheduleStageID = k.ScheduleStageId JOIN LsWork w ON w.WorkID = k.WorkId
     ORDER BY k.CostCodeId, ss.ScheduleStage, w.WorkType`, { lot: lotId, f });
  const head = (await query(`SELECT c.CustName, j.JobName, l.Lot + '/' + ISNULL(l.Block,'') AS LotBlock, pl.PlanNum FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lot`, { lot: lotId }))[0];
  res.json({ head, rows, totals: rows.reduce((t, r) => ({ BudgetValue: t.BudgetValue + Number(r.BudgetValue), JobCostValue: t.JobCostValue + Number(r.JobCostValue) }), { BudgetValue: 0, JobCostValue: 0 }) });
}));

// Job cost by type of work: builder, finished lots in range, one work type — estimate (packs) vs actual (job cost) by lot/stage/cost code
router.get('/job-cost-work', h(async (req, res) => {
  const cust = int(req.query.customerId), work = int(req.query.workId);
  const { from, to } = range(req.query);
  if (!cust) throw bad('Choose a builder');
  if (!work) throw bad('Choose a type of work');
  const rows = await query(`
    WITH a AS (SELECT l.LotID, x.ScheduleStageId, x.CostCodeId,
                      SUM(CASE WHEN x.CostCodeId = 'M' THEN x.ExtItemQty * x.JobCostPrice WHEN ISNULL(x.PayPercent,0) = 0 THEN ISNULL(x.Hours,0) * ${RATE('x.HourlyRate')} ELSE x.ExtItemQty * x.JobCostPrice * x.PayPercent / 100 END) AS Actual
                 FROM JcLotItem x JOIN JsLot l ON l.LotID = x.LotId JOIN JsJob j ON j.JobId = l.JobId
                WHERE j.CustId = @cust AND l.EndDate >= @from AND l.EndDate < DATEADD(day,1,CAST(@to AS date)) AND x.WorkId = @work
                GROUP BY l.LotID, x.ScheduleStageId, x.CostCodeId),
         e AS (SELECT l.LotID, st.ScheduleStageId, i.CostCodeId, SUM(m.Quantity * m.UnitCost * pk.Quantity * jp.PackQty) AS Estimate
                 FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack pk ON pk.PmPackID = jp.PmPackId
                 JOIN PmMaterial m ON m.PmPackId = pk.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsStage st ON st.StageID = m.StageId
                WHERE j.CustId = @cust AND l.EndDate >= @from AND l.EndDate < DATEADD(day,1,CAST(@to AS date)) AND i.CostCodeId IN ('L','M') AND m.WorkId = @work
                GROUP BY l.LotID, st.ScheduleStageId, i.CostCodeId),
         u AS (SELECT LotID, ScheduleStageId, CostCodeId, Actual, CAST(0 AS decimal(18,4)) AS Estimate FROM a UNION ALL SELECT LotID, ScheduleStageId, CostCodeId, 0, Estimate FROM e)
    SELECT c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, u.CostCodeId, SUM(u.Estimate) AS Estimate, SUM(u.Actual) AS Actual
      FROM u JOIN JsLot l ON l.LotID = u.LotID JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      JOIN LsScheduleStage ss ON ss.ScheduleStageID = u.ScheduleStageId
     GROUP BY c.CustName, j.JobName, l.LotID, l.Lot, l.Block, pl.PlanNum, ss.ScheduleStage, u.CostCodeId
     ORDER BY j.JobName, TRY_CAST(l.Lot AS int), l.Lot, l.Block, ss.ScheduleStage, u.CostCodeId`, { cust, work, from, to });
  res.json({ rows, totals: rows.reduce((t, r) => ({ Estimate: t.Estimate + Number(r.Estimate), Actual: t.Actual + Number(r.Actual) }), { Estimate: 0, Actual: 0 }) });
}));

// Option packs scheduled by job: builder + division, lots started in range (rptMgPacksScheduledJob01/02)
router.get('/option-packs', h(async (req, res) => {
  const cust = int(req.query.customerId), division = req.query.division;
  const { from, to } = range(req.query);
  if (!cust || !division) throw bad('Choose a builder and a division');
  const p = { cust, div: division, from, to };
  const [packs, lots] = await Promise.all([
    query(`SELECT j.DivisionId, c.CustName, j.JobName, pk.PackName, SUM(jp.PackQty) AS PackQty, COUNT(jp.PackID) AS Packs,
             ISNULL(${MV('jp.RevContractEa')}, ${MV('jp.ContractEa')}) AS ContractValue
        FROM JsCustomer c JOIN JsJob j ON j.CustId = c.CustID JOIN JsPhase ph ON ph.JobId = j.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID
        JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId
       WHERE c.CustID = @cust AND j.DivisionId = @div AND t.Opt = 1 AND l.StartDate >= @from AND l.StartDate < DATEADD(day,1,CAST(@to AS date))
       GROUP BY j.DivisionId, c.CustName, j.JobName, pk.PackName, ISNULL(${MV('jp.RevContractEa')}, ${MV('jp.ContractEa')})
       ORDER BY j.JobName, pk.PackName`, p),
    query(`SELECT j.JobName, COUNT(l.LotID) AS Lots FROM JsCustomer c JOIN JsJob j ON j.CustId = c.CustID JOIN JsPhase ph ON ph.JobId = j.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID
       WHERE c.CustID = @cust AND j.DivisionId = @div AND l.StartDate >= @from AND l.StartDate < DATEADD(day,1,CAST(@to AS date)) GROUP BY j.JobName`, p),
  ]);
  const lc = Object.fromEntries(lots.map((l) => [l.JobName, l.Lots]));
  const rows = packs.map((r) => ({ ...r, LotsInJob: lc[r.JobName] || 0, AvePerLot: lc[r.JobName] ? r.PackQty / lc[r.JobName] : null, AvePerBuyer: r.Packs ? r.PackQty / r.Packs : null }));
  res.json({ rows });
}));

// Open lots per period: lots of a division started in the range and still open (MgLotOpenPeriod)
router.get('/open-lots', h(async (req, res) => {
  const division = req.query.division;
  const { from, to } = range(req.query);
  if (!division) throw bad('Choose a division');
  res.json(await query(`SELECT FORMAT(l.StartDate,'yyyy-MM') AS Period, c.CustName, j.DivisionId, j.JobName, ph.Phase, pc.BidNum, l.LotID, l.Lot + '/' + ISNULL(l.Block,'') AS LotBlock, l.StartDate, l.DateEntered, l.UserEntered
      FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON ph.JobId = j.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID JOIN PmContract pc ON pc.PmContractID = ph.PmContractId
     WHERE j.DivisionId = @div AND l.StartDate >= @from AND l.StartDate < DATEADD(day,1,CAST(@to AS date)) AND l.EndDate IS NULL
     ORDER BY Period, c.CustName, j.JobName, ph.Phase, TRY_CAST(l.Lot AS int), l.Lot`, { div: division, from, to }));
}));

// Labor paid to a lot (with pay amounts — management sees money), optional payroll date range (MgLaborPaidLot / MgLaborPaidLotDate)
router.get('/labor-paid', h(async (req, res) => {
  const lotId = int(req.query.lotId);
  if (!lotId) throw bad('Choose a lot');
  const { from, to } = range(req.query, { required: false });
  const rows = await query(`SELECT p.PayrollDate, p.EmpName, p.PackName, p.PackQty, p.Item, p.ExtItemQty, ss.ScheduleStage, w.WorkType, p.PriceEa, p.PayPercent, p.PayHours, ${RATE('p.HourlyRate')} AS HourlyRate,
         ISNULL(p.ExtItemQty * p.PriceEa * p.PayPercent / 100, 0) AS Piece, ISNULL(p.PayHours * ${RATE('p.HourlyRate')}, 0) AS Hourly, p.Notes
      FROM PrLaborPaid p JOIN LsScheduleStage ss ON ss.ScheduleStageID = p.ScheduleStageId JOIN LsWork w ON w.WorkID = p.WorkId
     WHERE p.LotId = @lot AND (@from IS NULL OR p.PayrollDate >= @from) AND (@to IS NULL OR p.PayrollDate < DATEADD(day,1,CAST(@to AS date)))
     ORDER BY p.PayrollDate, p.EmpName, p.PackName`, { lot: lotId, from, to });
  for (const r of rows) r.Subtotal = Number(r.Piece) + Number(r.Hourly);
  res.json({ rows, total: rows.reduce((a, r) => a + r.Subtotal, 0) });
}));

// Material posted to a lot; counter=1 → only counter material with its reason (MgMaterialPostedLot / ...Counter)
router.get('/material-posted', h(async (req, res) => {
  const lotId = int(req.query.lotId);
  if (!lotId) throw bad('Choose a lot');
  const counter = req.query.counter === '1';
  const rows = await query(`SELECT w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItem, i.Description, ${counter ? 'cr.CounterReason' : 'x.Notes'} AS Extra,
         SUM(x.ExtItemQty) AS Qty, SUM(CAST(x.ExtItemQty AS decimal(18,4)) * x.JobCostPrice) AS ExtVal
      FROM JcLotItem x JOIN LsScheduleStage ss ON ss.ScheduleStageID = x.ScheduleStageId JOIN LsWork w ON w.WorkID = x.WorkId JOIN IcItem i ON i.InvItemID = x.InvItemId
      JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId ${counter ? 'JOIN LsCounterReason cr ON cr.CounterReasonID = x.CounterReasonId' : ''}
     WHERE x.LotId = @lot AND x.CostCodeId <> 'L'
     GROUP BY w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItem, i.Description, ${counter ? 'cr.CounterReason' : 'x.Notes'}
     ORDER BY w.WorkType, ss.ScheduleStage, ic.InvClass, i.InvItem`, { lot: lotId });
  res.json({ rows, total: rows.reduce((a, r) => a + Number(r.ExtVal || 0), 0) });
}));

// Lot info detail (MgLotDetails + its pack / job cost / billing subforms) — read-only
router.get('/lots/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [lot, packs, jc, billing] = await Promise.all([
    query(`SELECT l.LotID, l.Lot, l.Block, l.LotNum, l.StartDate, l.EndDate, l.WarrantyDate, l.Address, l.City, l.State, l.Zip, l.Permit, l.Estimate, l.RevEstimate, l.Contract, l.RevContract, l.LotNotes,
                  l.DateEntered, l.UserEntered, c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, jt.JobType, ph.Phase, ph.PhaseNum, pt.PhaseType, pl.PlanNum, pl.PlanName,
                  sb.SubsName, CASE WHEN l.StatusId = 1 THEN 'Active' ELSE 'Inactive' END AS Status,
                  CAST(c.CustID AS varchar(12)) + '.' + CAST(j.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS ComboId
             FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
             LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN LsPhaseType pt ON pt.PhaseTypeID = ph.PhaseTypeId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
             LEFT JOIN LsSubstitutionType sb ON sb.SubsID = l.SubsId WHERE l.LotID = @id`, { id }),
    query(`SELECT pk.PackName, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa,
                  jp.PackQty * ISNULL(${MV('jp.RevContractEa')}, ${MV('jp.ContractEa')}) AS Total
             FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId WHERE jp.LotId = @id ORDER BY pk.PackName`, { id }),
    query(`SELECT ss.ScheduleStage, w.WorkType, x.CostCodeId,
                  SUM(CASE WHEN x.CostCodeId = 'L' THEN ISNULL(x.ExtItemQty * x.JobCostPrice * x.PayPercent / 100, 0) + ISNULL(x.Hours * ${RATE('x.HourlyRate')}, 0) ELSE x.ExtItemQty * x.JobCostPrice END) AS Total
             FROM JcLotItem x JOIN LsScheduleStage ss ON ss.ScheduleStageID = x.ScheduleStageId JOIN LsWork w ON w.WorkID = x.WorkId
            WHERE x.LotId = @id GROUP BY ss.ScheduleStage, w.WorkType, x.CostCodeId ORDER BY ss.ScheduleStage, w.WorkType, x.CostCodeId`, { id }),
    query(`SELECT t.PackType, SUM(${MV('bi.ItemTotal')}) AS Subtotal FROM ArBilling b JOIN ArBillingItem bi ON bi.BillId = b.BillID JOIN JsPack jp ON jp.PackID = bi.PackId
             JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId WHERE b.LotId = @id GROUP BY t.PackType ORDER BY t.PackType`, { id }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json({ lot: lot[0], packs, jobCost: jc, billing });
}));

module.exports = router;
