// Accounts receivable reports, "WIP family" (SwitchAR buttons W I P, Exp, W I P timed, W I P lot, W I P T&M,
// W I P job w/TM ID and Sequence sheet billing data). Routes are GET /reports/<key>; the lead mounts this router under /api/ar.
//
// Access logic ported from rptArWip00..07, rptArTimeWip01..06, rptArWipLot01..06 (+Detail), rptArWipTM00..06 (+Detail),
// rptArWipTMJob01..06 and the ArCmSequenceSheet record source. Switchboard filters map to query params:
//   A customerId, B jobId, C lotId, D phaseId, E from, F to, I division, L burden (percent), M tmId.
// Notes on faithfulness:
//  - Access multiplies labor by (1 + tbxLaborBurden) where the text box is a fraction ("Percent" format); the web `burden`
//    is a percent number (15 = 15%), blank = 0.
//  - Profit columns keep Access null-propagation: a lot without labor paid (or posted material) has no actual profit.
//  - Ratios (labor %, GE %, ...) are NULL instead of #Div/0 when the denominator is 0 / empty.
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null || !/^-?\d+$/.test(String(v).trim()) ? null : parseInt(v, 10));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const str = (v, max = 50) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const need = (v, msg) => { if (v == null) throw bad(msg); return v };

// Money is stored as text ("$1234.50", negatives "($107.00)")
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,2))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,2)) END)`;
// contract value of a lot pack: the revised value when there is one
const CV = `(CASE WHEN jp.RevContractEa IS NULL THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END)`;
const PAID = `(ISNULL(CAST(pp.ExtItemQty AS decimal(18,4)) * pp.PriceEa * pp.PayPercent / 100.0, 0) + ISNULL(pp.PayHours * ${MV('pp.HourlyRate')}, 0))`;
const EST = 'CAST(jp.PackQty AS decimal(18,4)) * m.Quantity * m.UnitCost';
const LOTBLOCK = `(ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,''))`;

const burdenOf = (q) => {
  if (q.burden === '' || q.burden == null) return 0;
  const n = Number(q.burden);
  if (!Number.isFinite(n) || n < -100 || n > 1000) throw bad('Burden (filter L) must be a percent number, e.g. 15');
  return n;
};
const divisionOf = (q) => need(str(q.division, 10), 'Choose the division (filter I)');
const BURDEN = '(1 + @burden / 100.0)';

// ---------------------------------------------------------------------------
// WIP engine: one row per lot, built from per-lot aggregates (the rptArWip0x chain)
// opts.lots    : SQL giving L(LotID, DivisionId, CustName, JobName, Lot, Block, PlanNum, StartDate, PmPlanId)
// opts.tm      : restrict contract / estimates / billing / labor paid to packs with BuilderCode = @tm (rptArWipTM*)
// opts.billDiv : only invoices of @div (rptArWip01Billing HAVING DivisionId)
// opts.timed   : timed WIP (standard-pack columns, plan required, pack type Std flag)
// ---------------------------------------------------------------------------
function wipSql(opts) {
  const { lots, tm = false, billDiv = false, timed = false } = opts;
  const tmPack = tm ? 'JOIN PmPack k ON k.PmPackID = jp.PmPackId AND k.BuilderCode = @tm' : '';
  const std = (x) => `CASE WHEN t.Std = 0 THEN 0 ELSE ${x} END`;
  const ptJoin = timed ? 'JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId' : '';
  const matJoin = `JOIN JsPack jp ON jp.LotId = l.LotID ${ptJoin} JOIN PmPack k ON k.PmPackID = jp.PmPackId ${tm ? "AND k.BuilderCode = @tm" : ''}
        JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId`;
  const contractJoin = tm ? 'JOIN PmPack k ON k.PmPackID = jp.PmPackId AND k.PmPlanId = l.PmPlanId AND k.BuilderCode = @tm' : '';
  return `WITH L AS (${lots}),
 CT AS (SELECT l.LotID, SUM(CAST(jp.PackQty AS decimal(18,4)) * ${CV}) AS ExtContractVal,
          SUM(CAST(jp.PackQty AS decimal(18,4)) * CASE WHEN jp.PackTypeId = 1 THEN 0 ELSE ${CV} END) AS ExtContractLessStd
          ${timed ? `, SUM(CAST(jp.PackQty AS decimal(18,4)) * (${std(CV)})) AS StdContractVal` : ''}
        FROM L l JOIN JsPack jp ON jp.LotId = l.LotID ${ptJoin} ${contractJoin} GROUP BY l.LotID),
 BL AS (SELECT b.LotId, SUM(${MV('bi.ItemTotal')}) AS SumOfItemTotal, SUM(CASE WHEN jp.PackTypeId = 1 THEN 0 ELSE ${MV('bi.ItemTotal')} END) AS ItemTotalLessStd
        FROM ArBilling b JOIN ArBillingItem bi ON bi.BillId = b.BillID JOIN JsPack jp ON jp.PackID = bi.PackId ${tmPack}
        WHERE b.LotId IN (SELECT LotID FROM L) ${billDiv ? 'AND b.DivisionId = @div' : ''} GROUP BY b.LotId),
 LE AS (SELECT l.LotID, SUM(${EST}) * ${BURDEN} AS LaborEst
          ${timed ? `, SUM(${std(`${EST} * ${BURDEN}`)}) AS LaborEstStd` : ''}
        FROM L l ${matJoin} WHERE i.CostCodeId = 'L' GROUP BY l.LotID),
 LP AS (SELECT l.LotID, SUM(${PAID}) * ${BURDEN} AS LaborPaid FROM L l JOIN PrLaborPaid pp ON pp.LotId = l.LotID
        ${tm ? 'JOIN PmPack k ON k.PmPackID = pp.PmPackId AND k.BuilderCode = @tm' : ''} GROUP BY l.LotID),
 ME AS (SELECT l.LotID, SUM(${EST}) AS MaterialEst ${timed ? `, SUM(${std(EST)}) AS MaterialEstStd` : ''}
        FROM L l ${matJoin} WHERE i.CostCodeId <> 'L' GROUP BY l.LotID),
 MP AS (SELECT l.LotID, SUM(CAST(jc.ExtItemQty AS decimal(18,4)) * jc.JobCostPrice) AS MaterialPosted
        FROM L l JOIN JcLotItem jc ON jc.LotId = l.LotID WHERE jc.CostCodeId <> 'L' GROUP BY l.LotID),
 X AS (SELECT l.*, d.SalesTax, ct.ExtContractVal, ct.ExtContractLessStd ${timed ? ', ct.StdContractVal, le.LaborEstStd, me.MaterialEstStd' : ''},
        bl.SumOfItemTotal AS Invoiced, bl.ItemTotalLessStd AS InvoicedOpt, le.LaborEst, lp.LaborPaid, me.MaterialEst, mp.MaterialPosted
       FROM L l JOIN CT ct ON ct.LotID = l.LotID LEFT JOIN BL bl ON bl.LotId = l.LotID LEFT JOIN LE le ON le.LotID = l.LotID LEFT JOIN LP lp ON lp.LotID = l.LotID
       LEFT JOIN ME me ON me.LotID = l.LotID LEFT JOIN MP mp ON mp.LotID = l.LotID LEFT JOIN LsDivision d ON d.DivisionID = l.DivisionId)
 SELECT x.*, x.LaborPaid / NULLIF(x.LaborEst, 0) AS LaborPercent, x.MaterialPosted / NULLIF(x.MaterialEst, 0) AS MaterialPercent,
        x.Invoiced / NULLIF(x.ExtContractVal, 0) AS BillingPercent, ISNULL(x.ExtContractVal, 0) - ISNULL(x.Invoiced, 0) AS Balance,
        ISNULL(x.ExtContractVal, 0) - (x.LaborEst + x.MaterialEst + (x.MaterialEst * x.SalesTax / 100)) AS ProfitEst,
        ISNULL(x.Invoiced, 0) - (x.LaborPaid + (x.MaterialPosted * x.SalesTax / 100) + x.MaterialPosted) AS ProfitActual
        ${timed ? ", ISNULL(x.StdContractVal, 0) - (x.LaborEstStd + x.MaterialEstStd + (x.MaterialEstStd * x.SalesTax / 100)) AS ProfitStd" : ''}
        , x.MaterialEst * x.SalesTax / 100 AS MaterialSalesTaxEst, x.MaterialPosted * x.SalesTax / 100 AS MaterialSalesTaxAct
   FROM X x`;
}

const ratio = (a, b) => (b == null || Number(b) === 0 || a == null ? null : Number(a) / Number(b));
function addRatios(rows, timed) {
  for (const r of rows) {
    r.GEpct = ratio(r.ProfitEst, r.ExtContractVal);
    r.GApct = ratio(r.ProfitActual, r.Invoiced);
    if (timed) r.GSpct = ratio(r.ProfitStd, r.StdContractVal);
  }
  return rows;
}
const SUM_COLS = ['LaborEst', 'LaborPaid', 'MaterialEst', 'MaterialPosted', 'ExtContractVal', 'ExtContractValOpt', 'Invoiced', 'InvoicedOpt', 'Balance', 'ProfitEst', 'ProfitActual',
  'LaborEstStd', 'MaterialEstStd', 'StdContractVal', 'ProfitStd'];
function totalsOf(rows, timed) {
  const t = {};
  for (const c of SUM_COLS) { let s = 0, any = false; for (const r of rows) if (r[c] != null) { s += Number(r[c]); any = true } t[c] = any ? s : null }
  t.LaborPercent = ratio(t.LaborPaid, t.LaborEst); t.MaterialPercent = ratio(t.MaterialPosted, t.MaterialEst); t.BillingPercent = ratio(t.Invoiced, t.ExtContractVal);
  t.GEpct = ratio(t.ProfitEst, t.ExtContractVal); t.GApct = ratio(t.ProfitActual, t.Invoiced);
  if (timed) t.GSpct = ratio(t.ProfitStd, t.StdContractVal);
  t.Lots = rows.length;
  return t;
}
const withOpt = (rows) => rows.map((r) => ({ ...r, ExtContractValOpt: r.ExtContractLessStd, LotBlock: `${r.Lot ?? ''}/${r.Block ?? ''}` }));

const OPEN_LOTS = (extra) => `SELECT cu.CustID, j.DivisionId, j.JobId, l.LotID, cu.CustName, j.JobName, l.Lot, l.Block, CAST(NULL AS nvarchar(50)) AS PlanNum, l.StartDate, l.PmPlanId
   FROM JsCustomer cu JOIN JsJob j ON j.CustId = cu.CustID JOIN JsLot l ON l.JobId = j.JobId
  WHERE l.EndDate IS NULL AND j.DivisionId = @div ${extra}`;

async function customerName(id) { const r = id ? await query('SELECT CustName FROM JsCustomer WHERE CustID = @id', { id }) : []; return r[0]?.CustName || null }
async function jobName(id) { const r = id ? await query('SELECT JobName FROM JsJob WHERE JobId = @id', { id }) : []; return r[0]?.JobName || null }

// W I P (ArWip) and Exp (rptArWip07WipExport): open lots of a division, optional builder / job
async function wipReport(q) {
  const div = divisionOf(q), cust = int(q.customerId), job = int(q.jobId), burden = burdenOf(q);
  const rows = addRatios(withOpt(await query(
    `${wipSql({ lots: OPEN_LOTS('AND (@cust IS NULL OR cu.CustID = @cust) AND (@job IS NULL OR j.JobId = @job)'), billDiv: true })} ORDER BY x.CustName, x.JobName, x.Lot, x.Block`,
    { div, cust, job, burden })));
  return {
    rows, totals: totalsOf(rows),
    header: { title: 'Work in progress', division: div, customerId: cust, customerName: await customerName(cust), jobId: job, jobName: await jobName(job), burden },
  };
}

// W I P timed (ArWipTimed): lots started between From and To that are still open at To
async function timedReport(q) {
  const div = divisionOf(q), cust = int(q.customerId), burden = burdenOf(q);
  const from = need(isoDate(q.from), 'Enter the From date (filter E)'), to = need(isoDate(q.to), 'Enter the To date (filter F)');
  const lots = `SELECT cu.CustID, j.DivisionId, j.JobId, l.LotID, cu.CustName, j.JobName, l.Lot, l.Block, pl.PlanNum, l.StartDate, l.PmPlanId
     FROM JsCustomer cu JOIN JsJob j ON j.CustId = cu.CustID JOIN JsLot l ON l.JobId = j.JobId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
    WHERE j.DivisionId = @div AND l.StartDate >= CAST(@from AS date) AND l.StartDate < DATEADD(day, 1, CAST(@to AS date))
      AND (l.EndDate IS NULL OR l.EndDate > CAST(@to AS date)) AND (@cust IS NULL OR cu.CustID = @cust)`;
  const rows = addRatios((await query(`${wipSql({ lots, timed: true })} ORDER BY x.CustName, x.JobName, x.Lot, x.Block`, { div, cust, from, to, burden }))
    .map((r) => ({ ...r, LotBlock: `${r.Lot ?? ''}/${r.Block ?? ''}-${r.PlanNum ?? ''}` })), true);
  return { rows, totals: totalsOf(rows, true), header: { title: 'TWIP - timed work in progress', division: div, customerId: cust, customerName: await customerName(cust), from, to, burden } };
}

// W I P job w/TM ID (ArWipTMJob): every open lot of one job, flagging the lots that carry a T&M pack
async function tmJobReport(q) {
  const div = divisionOf(q), job = need(int(q.jobId), 'Choose the job (filter B)'), cust = int(q.customerId), burden = burdenOf(q);
  const rows = addRatios(withOpt(await query(
    `${wipSql({ lots: OPEN_LOTS('AND j.JobId = @job'), billDiv: true })}
     ORDER BY x.CustName, x.JobName, x.Lot, x.Block`, { div, job, burden })));
  const tmIds = await query(
    `SELECT l.LotID, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS LotBlock, k.TmId, k.PackName
       FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
      WHERE j.JobId = @job AND j.DivisionId = @div AND l.EndDate IS NULL AND k.TmId IS NOT NULL
      GROUP BY l.LotID, l.Lot, l.Block, k.TmId, k.PackName ORDER BY l.Lot, l.Block, k.TmId`, { div, job });
  const has = new Set(tmIds.map((t) => t.LotID));
  for (const r of rows) r.TMpresent = has.has(r.LotID) ? 'TM' : '';
  return { rows, totals: totalsOf(rows), tmDetail: tmIds, header: { title: 'Work in progress (job with T&M ID)', division: div, customerId: cust, customerName: rows[0]?.CustName || await customerName(cust), jobId: job, jobName: rows[0]?.JobName || await jobName(job), burden } };
}

// ---------------------------------------------------------------------------
// W I P lot (ArWipLot) and W I P T&M (ArWipTM): one lot with billing / labor / material detail
// ---------------------------------------------------------------------------
const tmNorm = (v) => { const s = str(v, 20); if (!s) return null; return /^\d+$/.test(s) ? `TM${s}` : s.toUpperCase().replace(/\s+/g, '') };

async function lotDetail({ lot, tm, burden }) {
  const p = { lot, tm, burden };
  const tmWhere = 'AND (@tm IS NULL OR k.BuilderCode = @tm)';
  const [info, billing, laborEst, laborPaid, matEst, matPosted] = await Promise.all([
    query(`SELECT j.DivisionId, cu.CustName, j.JobName, l.Lot, l.Block, pl.PlanNum, l.StartDate, l.EndDate FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer cu ON cu.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lot`, p),
    // contract detail (rptArWipLot02ContractDetail) LEFT JOIN billing detail (rptArWipLot01BillingDetail) on the pack
    query(`SELECT c.PackID, c.PackName, c.TmId, c.PackQty, c.PmContractValueEa, c.ContractValueEa, c.ExtContractVal, bd.BillID, bd.Date, bd.Quantity, bd.ValueEa, bd.BillPercent, bd.AmountBilled, bd.Notes
        FROM (SELECT jp.PackID, k.PackName, k.TmId, jp.PackQty, ${MV('k.ContractVal')} AS PmContractValueEa, ${CV} AS ContractValueEa, CAST(jp.PackQty AS decimal(18,4)) * ${CV} AS ExtContractVal
                FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId WHERE jp.LotId = @lot ${tmWhere}) c
        LEFT JOIN (SELECT bi.PackId, b.BillID, b.Date, bi.Quantity, ${MV('bi.ValueEa')} AS ValueEa, bi.BillPercent, ${MV('bi.ItemTotal')} AS AmountBilled, bi.Notes
                     FROM ArBilling b JOIN ArBillingItem bi ON bi.BillId = b.BillID JOIN JsPack jp ON jp.PackID = bi.PackId JOIN PmPack k ON k.PmPackID = jp.PmPackId
                    WHERE b.LotId = @lot ${tmWhere}) bd ON bd.PackId = c.PackID
       ORDER BY c.PackName, c.PackID, bd.Date, bd.BillID`, p),
    query(`SELECT jp.PackID, k.PackName, i.InvItem, m.Quantity, m.UnitCost, ${EST} AS LaborEst, i.PmItem AS NoShowLaborTicket
        FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
       WHERE jp.LotId = @lot AND i.CostCodeId = 'L' ${tmWhere} ORDER BY k.PackName, jp.PackID, i.InvItem`, p),
    query(`SELECT pp.LaborPaidID, pp.PackId, pp.PackName, pp.PayrollDate, pp.EmpName, pp.Item, pp.ExtItemQty, pp.PriceEa, pp.PayPercent, pp.PayHours, ${MV('pp.HourlyRate')} AS HourlyRate, ${PAID} AS LaborPaid
        FROM PrLaborPaid pp LEFT JOIN PmPack k ON k.PmPackID = pp.PmPackId WHERE pp.LotId = @lot ${tmWhere} ORDER BY pp.PackName, pp.PackId, pp.PayrollDate, pp.LaborPaidID`, p),
    query(`SELECT k.PackName, i.InvItem, m.Quantity, m.UnitCost, ${EST} AS ExtEstCost
        FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId
       WHERE jp.LotId = @lot AND i.CostCodeId <> 'L' ${tmWhere} ORDER BY k.PackName, i.InvItem`, p),
    // posted job cost (rptArWipLot05MaterialPostedDetail / TM05...): lot version groups by pack, T&M version by posting date
    tm
      ? query(`SELECT FORMAT(jc.DateEntered, 'MM-dd-yyyy') AS Posted, CASE WHEN jc.CounterDate IS NOT NULL THEN 'Counter material' ELSE 'Warehouse pack' END AS PackType, i.InvItem, jc.ExtItemQty, jc.JobCostPrice,
                      SUM(CAST(jc.ExtItemQty AS decimal(18,4)) * jc.JobCostPrice) AS MaterialPosted
                 FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId WHERE jc.LotId = @lot AND jc.CostCodeId <> 'L'
                GROUP BY FORMAT(jc.DateEntered, 'MM-dd-yyyy'), CASE WHEN jc.CounterDate IS NOT NULL THEN 'Counter material' ELSE 'Warehouse pack' END, i.InvItem, jc.ExtItemQty, jc.JobCostPrice
                ORDER BY FORMAT(jc.DateEntered, 'MM-dd-yyyy'), i.InvItem`, p)
      : query(`SELECT jc.PackId, CASE WHEN jc.CounterDate IS NOT NULL THEN 'Counter material' ELSE 'Warehouse pack' END AS PackType, i.InvItem, jc.ExtItemQty, jc.JobCostPrice,
                      SUM(CAST(jc.ExtItemQty AS decimal(18,4)) * jc.JobCostPrice) AS MaterialPosted
                 FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId WHERE jc.LotId = @lot AND jc.CostCodeId <> 'L'
                GROUP BY jc.PackId, CASE WHEN jc.CounterDate IS NOT NULL THEN 'Counter material' ELSE 'Warehouse pack' END, i.InvItem, jc.ExtItemQty, jc.JobCostPrice
                ORDER BY i.InvItem`, p),
  ]);
  if (!info.length) throw bad('Lot not found (filter C)', 404);
  const sum = (arr, c) => arr.reduce((a, r) => a + (r[c] == null ? 0 : Number(r[c])), 0);
  const seen = new Set();
  const contract = billing.reduce((a, r) => { if (seen.has(r.PackID)) return a; seen.add(r.PackID); return a + (r.ExtContractVal == null ? 0 : Number(r.ExtContractVal)) }, 0);
  const lb = (burden || 0) / 100;
  const totals = {
    contract, billed: sum(billing, 'AmountBilled'), laborEst: sum(laborEst, 'LaborEst'), laborPaid: sum(laborPaid, 'LaborPaid'),
    materialEst: sum(matEst, 'ExtEstCost'), materialPosted: sum(matPosted, 'MaterialPosted'),
  };
  totals.laborEstBurden = totals.laborEst * lb; totals.laborPaidBurden = totals.laborPaid * lb;
  return { info: info[0], billing, laborEst, laborPaid, materialEst: matEst, materialPosted: matPosted, totals };
}

async function lotReport(q) {
  const lot = need(int(q.lotId), 'Choose the lot (filter C)'), burden = burdenOf(q);
  const [detail, srows] = await Promise.all([
    lotDetail({ lot, tm: null, burden }),
    query(`${wipSql({ lots: `SELECT cu.CustID, j.DivisionId, j.JobId, l.LotID, cu.CustName, j.JobName, l.Lot, l.Block, pl.PlanNum, l.StartDate, l.PmPlanId
        FROM JsCustomer cu JOIN JsJob j ON j.CustId = cu.CustID JOIN JsLot l ON l.JobId = j.JobId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lot` })}`, { lot, burden }),
  ]);
  const rows = addRatios(withOpt(srows));
  return { summary: rows[0] || null, rows, totals: totalsOf(rows), ...detail, header: { title: 'Work in progress - lot', lotId: lot, burden, ...detail.info } };
}

async function tmReport(q) {
  const tm = need(tmNorm(q.tmId), 'Choose the T&M # (filter M)');
  let lot = int(q.lotId);
  if (!lot) {
    const r = await query(`SELECT TOP 1 LotID FROM TmPO WHERE 'TM' + CAST(TmID AS varchar(20)) = @tm AND LotID IS NOT NULL`, { tm });
    lot = r[0]?.LotID;
    if (!lot) throw bad(`T&M ${tm} is not attached to a lot - choose the lot (filter C)`);
  }
  const burden = burdenOf(q);
  const [detail, srows] = await Promise.all([
    lotDetail({ lot, tm, burden: 0 }),
    query(`${wipSql({ tm: true, lots: `SELECT cu.CustID, j.DivisionId, j.JobId, l.LotID, cu.CustName, j.JobName, l.Lot, l.Block, pl.PlanNum, l.StartDate, l.PmPlanId
        FROM JsCustomer cu JOIN JsJob j ON j.CustId = cu.CustID JOIN JsLot l ON l.JobId = j.JobId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @lot` })}`, { lot, tm, burden: 0 }),
  ]);
  // TM material posted is the whole lot's job cost in Access (rptArWipTM05 is not restricted to the T&M packs)
  const rows = addRatios(withOpt(srows));
  return { summary: rows[0] || null, rows, totals: totalsOf(rows), ...detail, header: { title: 'Work in progress - T&M', lotId: lot, tmId: tm, burden: 0, ...detail.info } };
}

// ---------------------------------------------------------------------------
// Sequence sheet billing data (ArCmSequenceSheet + ArCmSequenceSheetSubTotal): lot -> pack -> breakdown of a JS phase
// ---------------------------------------------------------------------------
async function sequenceSheet(q) {
  const ph = need(int(q.phaseId), 'Choose the phase (filter D)');
  const rows = await query(`SELECT CAST(cu.CustID AS varchar(12)) + '.' + CAST(jj.JobId AS varchar(12)) + '.' + CAST(ph.PhaseID AS varchar(12)) AS Code, cu.CustName, jj.JobName, jj.JobNum, ph.Phase,
       pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate,
       ISNULL(s1.SuperName,'') + ' - ' + ISNULL(s1.SuperType,'') + ' / ' + ISNULL(s2.SuperName,'') + ' - ' + ISNULL(s2.SuperType,'') AS Supers, ph.StartDate,
       CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END AS LotBlock, l.LotID, p.PlanNum, p.PlanName, l.Address, l.City,
       ${MV('l.Contract')} AS LotContract, ${MV('l.RevContract')} AS LotRevContract,
       jp.PackID, k.PackName, k.BuilderCode, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa,
       jp.PackQty * ${CV} AS ExtVal,
       w.WorkType, ss.ScheduleStage, ${MV('jv.Contract')} AS DetailContract, ${MV('jv.RevContract')} AS DetailRevContract,
       jp.PackQty * CASE WHEN jv.RevContract IS NULL THEN ${MV('jv.Contract')} ELSE ${MV('jv.RevContract')} END AS DetailExtVal
    FROM JsCustomer cu JOIN JsJob jj ON jj.CustId = cu.CustID JOIN JsPhase ph ON ph.JobId = jj.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID AND l.JobId = jj.JobId
    JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsSuperintendent s2 ON s2.SuperID = ph.SuperId2
    LEFT JOIN PmPlan p ON p.PmPlanID = l.PmPlanId LEFT JOIN JsPack jp ON jp.LotId = l.LotID LEFT JOIN PmPack k ON k.PmPackID = jp.PmPackId
    LEFT JOIN JsValue jv ON jv.PackId = jp.PackID LEFT JOIN LsWork w ON w.WorkID = jv.WorkId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = jv.ScheduleStageId
   WHERE ph.PhaseID = @ph ORDER BY CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END, l.LotID, k.PackName, jp.PackID, w.WorkType`, { ph });
  const totals = await query(`SELECT l.LotID, SUM(jp.PackQty * ${CV}) AS ExtVal FROM JsLot l LEFT JOIN JsPack jp ON jp.LotId = l.LotID WHERE l.PhaseId = @ph GROUP BY l.LotID`, { ph });
  return { rows, totals, header: { title: 'Sequence sheet - billing data', phaseId: ph, ...(rows[0] ? { code: rows[0].Code, customerName: rows[0].CustName, jobName: rows[0].JobName, phase: rows[0].Phase } : {}) } };
}

const REPORTS = {
  'ar-wip': wipReport,
  'ar-wip-export': async (q) => {
    const d = await wipReport(q);
    return { ...d, rows: d.rows.map((r) => ({
      CustName: r.CustName, JobName: r.JobName, LotBlock: r.LotBlock, LaborEst: r.LaborEst, LaborPaid: r.LaborPaid, LaborPercent: r.LaborPercent, MaterialEst: r.MaterialEst,
      MaterialPosted: r.MaterialPosted, MaterialPercent: r.MaterialPercent, ExtContractVal: r.ExtContractVal, ExtContractValOpt: r.ExtContractValOpt, Invoiced: r.Invoiced, InvoicedOpt: r.InvoicedOpt,
      BillingPercent: r.BillingPercent, Balance: r.Balance, ProfitEst: r.ProfitEst, 'GE%': r.GEpct, ProfitActual: r.ProfitActual, 'GA%': r.GApct })), header: { ...d.header, title: 'WIP export' } };
  },
  'ar-wip-timed': timedReport,
  'ar-wip-lot': lotReport,
  'ar-wip-tm': tmReport,
  'ar-wip-tm-job': tmJobReport,
  'ar-sequence-sheet': sequenceSheet,
};

router.get('/reports/:key', h(async (req, res, next) => {
  const fn = Object.prototype.hasOwnProperty.call(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  if (!fn) return next(); // other routers (receivables.js) own the remaining /reports/* keys
  res.json(await fn(req.query));
}));

module.exports = router;
