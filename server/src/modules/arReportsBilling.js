// Accounts receivable — "billing reports" of the Access SwitchAR switchboard.
// Routes (mounted under /api/ar):  GET /reports/<key>
//   prebill-detail, prebill-summary, lot-pack-to-bill (+ /payroll popup data), lot-pack-type-to-bill,
//   lots-by-plan, billing-by-super, lot-billing, lot-billing-tm
// Filter params (letters of the switchboard): A customerId, B jobId, C lotId, E from, F to, G packTypeId, H date, I division, K planId
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : /^-?\d+$/.test(String(v).trim()) ? parseInt(v, 10) : NaN);
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const sum = (rows, f) => r2(rows.reduce((a, r) => a + Number(f(r) || 0), 0));
// Money columns are stored as text ("$1234.50", negatives "($107.00)")
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,2))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,2)) END)`;
// Access: IIf(IsNull(RevContractEa), PackQty*ContractEa, PackQty*RevContractEa)
const EXT = (qty, ce, rce) => `(${qty} * CASE WHEN ${rce} IS NULL THEN ${MV(ce)} ELSE ${MV(rce)} END)`;
const TOTAL_BILL = 'CASE WHEN ISNULL(x.BillValue,0) <> 0 THEN x.BillValue ELSE ISNULL(x.Quantity,0) * ISNULL(x.ValueEa,0) * ISNULL(x.BillPercent,0) / 100 END';

// Parameter helpers: each throws a 400 naming the Access filter letter
function pInt(q, name, letter, label, required) {
  const v = int(q[name]);
  if (Number.isNaN(v)) throw bad(`${label} (filter ${letter}) must be a number`);
  if (required && !v) throw bad(`Choose a ${label.toLowerCase()} (filter ${letter})`);
  return v || null;
}
function pDate(q, name, letter, label, required) {
  const raw = q[name];
  const v = isoDate(raw);
  if (raw && !v) throw bad(`${label} (filter ${letter}) must be a date (YYYY-MM-DD)`);
  if (required && !v) throw bad(`Enter the ${label.toLowerCase()} date (filter ${letter})`);
  return v;
}
function pDiv(q, required = true) {
  const v = String(q.division || '').trim();
  if (!v && required) throw bad('Choose a division (filter I)');
  if (v.length > 10) throw bad('Division (filter I) is not valid');
  return v || null;
}
const groupBy = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()];
};
async function lookupNames(p) {
  const out = {};
  if (p.cust) out.customer = (await query('SELECT CustName AS n FROM JsCustomer WHERE CustID = @c', { c: p.cust }))[0]?.n || null;
  return out;
}

// ---------------------------------------------------------------------------
// 1/2) Pre billing detail / summary  (ArTempBillDetail, ArTempBillSumm) — read the ArPreBill* snapshot
// ---------------------------------------------------------------------------
async function preBillLines(p, withLines) {
  const base = `FROM ArPreBillLot l JOIN LsBillingType bt ON bt.BillTypeID = l.BillTypeId
        JOIN ArPreBillPack x ON x.PreBillLotId = l.PreBillLotID
        JOIN JsLot jl ON jl.LotID = l.LotId LEFT JOIN JsPhase ph ON ph.PhaseID = jl.PhaseId
       WHERE l.DivisionId = @div AND (@cust IS NULL OR l.CustId = @cust)`;
  if (withLines) {
    return query(`SELECT l.PreBillLotID AS PreInvoiceNum, l.DivisionId, l.Customer, l.InvDate, l.JobName, l.JobNum, ph.Phase, l.LotBlock, l.PlanNum, l.Address, bt.BillType, l.Terms, l.Lien,
           x.PreBillPackID, x.ItemCode, x.PackName, x.ScheduleStage, x.WorkType, x.Quantity, x.ValueEa, x.BillPercent, x.BillValue, ${TOTAL_BILL} AS TotalBill, x.Notes
         ${base} ORDER BY l.Customer, l.InvDate, l.JobName, l.LotBlock, l.PreBillLotID, x.PackName, x.PreBillPackID`, p);
  }
  return query(`SELECT l.DivisionId, l.Customer, l.InvDate, l.JobName, l.JobNum, ph.Phase, l.LotBlock, l.PlanNum, l.Address, bt.BillType, l.Terms, l.Lien, SUM(${TOTAL_BILL}) AS TotalBill
         ${base} GROUP BY l.DivisionId, l.Customer, l.InvDate, l.JobName, l.JobNum, ph.Phase, l.LotBlock, l.PlanNum, l.Address, bt.BillType, l.Terms, l.Lien
         ORDER BY l.Customer, l.InvDate, l.JobName, l.LotBlock`, p);
}
router.get('/reports/prebill-detail', h(async (req, res) => {
  const p = { div: pDiv(req.query), cust: pInt(req.query, 'customerId', 'A', 'Customer') };
  const rows = await preBillLines(p, true);
  const groups = groupBy(rows, (r) => r.Customer).map(([customer, cr]) => {
    const lots = groupBy(cr, (r) => r.PreInvoiceNum).map(([id, lr]) => ({ ...lr[0], PreInvoiceNum: id, lines: lr, total: sum(lr, (r) => r.TotalBill) }));
    return { customer, division: p.div, lots, total: sum(cr, (r) => r.TotalBill) };
  });
  res.json({ header: { title: `Temporary billing detail for ${p.div}`, division: p.div, ...(await lookupNames(p)) }, groups, rows, totals: { total: sum(rows, (r) => r.TotalBill), invoices: groups.reduce((a, g) => a + g.lots.length, 0) } });
}));
router.get('/reports/prebill-summary', h(async (req, res) => {
  const p = { div: pDiv(req.query), cust: pInt(req.query, 'customerId', 'A', 'Customer') };
  const rows = await preBillLines(p, false);
  const groups = groupBy(rows, (r) => r.Customer).map(([customer, cr]) => ({ customer, division: p.div, rows: cr, total: sum(cr, (r) => r.TotalBill) }));
  res.json({ header: { title: `Temporary billing summary for ${p.div}`, division: p.div, ...(await lookupNames(p)) }, groups, rows, totals: { total: sum(rows, (r) => r.TotalBill), invoices: rows.length } });
}));

// ---------------------------------------------------------------------------
// 3) Lot-pack to bill (ArLotPackToBill <- rptArLotPackToBill02Billing <- rptArLotPackToBill01Payroll)
//    Every lot pack with payroll in the period, its contract value and what is already billed against the pack.
// ---------------------------------------------------------------------------
router.get('/reports/lot-pack-to-bill', h(async (req, res) => {
  const p = { div: pDiv(req.query), from: pDate(req.query, 'from', 'E', 'From', true), to: pDate(req.query, 'to', 'F', 'To', true), cust: pInt(req.query, 'customerId', 'A', 'Customer') };
  const rows = await query(
    `WITH pay AS (
       SELECT j.DivisionId, c.CustName, pr.JobName, j.JobNum, ph.Phase, pr.Lot + '/' + pr.Block AS LotBlock, pr.PlanNum, ct.BidNum, jp.PackID, pr.PackName, pk.BuilderCode, jp.PackQty,
              jp.ContractEa, jp.RevContractEa, SUM(pr.PayHours) AS SumOfPayHours, MAX(pr.LaborPaidID) AS LastPay, pr.LotId
         FROM PrLaborPaid pr JOIN JsPack jp ON pr.PackId = jp.PackID JOIN JsJob j ON pr.JobId = j.JobId JOIN JsCustomer c ON c.CustID = j.CustId
         JOIN PmPack pk ON pr.PmPackId = pk.PmPackID JOIN JsLot jl ON pr.LotId = jl.LotID AND j.JobId = jl.JobId AND jp.LotId = jl.LotID
         JOIN PmPlan pp ON pp.PmPlanID = jl.PmPlanId JOIN PmContract ct ON pp.PmContractId = ct.PmContractID JOIN JsPhase ph ON jl.PhaseId = ph.PhaseID AND ct.PmContractID = ph.PmContractId
        WHERE pr.PayrollDate >= @from AND pr.PayrollDate < DATEADD(day,1,@to) AND (@cust IS NULL OR c.CustID = @cust) AND j.DivisionId = @div
        GROUP BY j.DivisionId, c.CustName, pr.JobName, j.JobNum, ph.Phase, pr.Lot + '/' + pr.Block, pr.PlanNum, ct.BidNum, jp.PackID, pr.PackName, pk.BuilderCode, jp.PackQty, jp.ContractEa, jp.RevContractEa, pr.LotId)
     SELECT pay.DivisionId, pay.CustName, pay.JobName, pay.JobNum, pay.Phase, pay.LotBlock, pay.PlanNum, pay.BidNum, pay.PackID, pay.PackName, pay.BuilderCode, pay.PackQty,
            ${MV('pay.ContractEa')} AS ContractEa, ${MV('pay.RevContractEa')} AS RevContractEa, ${EXT('pay.PackQty', 'pay.ContractEa', 'pay.RevContractEa')} AS ExtVal,
            ISNULL((SELECT SUM(${MV('bi.ItemTotal')}) FROM ArBillingItem bi WHERE bi.PackId = pay.PackID), 0) AS Billing,
            (SELECT n.Notes FROM PrLaborPaid n WHERE n.LaborPaidID = pay.LastPay) AS LastNotes, pay.SumOfPayHours, pay.LotId
       FROM pay ORDER BY pay.CustName, pay.DivisionId, pay.JobName, pay.LotBlock, pay.PackID`, p);
  const groups = groupBy(rows, (r) => r.CustName).map(([customer, cr]) => ({
    customer, extVal: sum(cr, (r) => r.ExtVal), billing: sum(cr, (r) => r.Billing),
    jobs: groupBy(cr, (r) => r.JobName).map(([job, jr]) => ({ job, jobNum: jr[0].JobNum, rows: jr, extVal: sum(jr, (r) => r.ExtVal), billing: sum(jr, (r) => r.Billing) })),
  }));
  const extVal = sum(rows, (r) => r.ExtVal), billing = sum(rows, (r) => r.Billing);
  res.json({ header: { title: 'Lot-packs ready to bill', division: p.div, from: p.from, to: p.to, ...(await lookupNames(p)) }, groups, rows, totals: { extVal, billing, remainPct: extVal ? 1 - billing / extVal : null } });
}));

// Pop-up reports of the lot-pack list: payroll behind one lot (ArLotPackToBillDetailPopUp: within the period; ...TotalPopUp: all payroll)
router.get('/reports/lot-pack-to-bill/payroll', h(async (req, res) => {
  const lotId = pInt(req.query, 'lotId', 'C', 'Lot', true);
  const total = req.query.all === '1';
  const from = total ? null : pDate(req.query, 'from', 'E', 'From', true), to = total ? null : pDate(req.query, 'to', 'F', 'To', true);
  const rows = await query(
    `SELECT pr.PayrollDate, j.DivisionId, c.CustName, pr.JobName, j.JobNum, pr.EmpName, ph.Phase, pr.Lot + '/' + pr.Block AS LotBlock, jl.Address + ', ' + jl.City + ' ' + jl.State AS LotAddress, pr.PlanNum, ct.BidNum,
            jp.PackID, pr.PackName, pk.BuilderCode, jp.PackQty, ${EXT('jp.PackQty', 'jp.ContractEa', 'jp.RevContractEa')} AS ExtVal,
            CASE WHEN pr.Notes LIKE '%shop%' OR pr.Notes LIKE '%bin%' OR pr.Notes LIKE '%drive%' THEN '' ELSE pr.Notes END AS PrNotes, pr.PayHours, ht.HourType, pr.LotId
       FROM PrLaborPaid pr JOIN JsPack jp ON pr.PackId = jp.PackID JOIN JsJob j ON pr.JobId = j.JobId JOIN JsCustomer c ON c.CustID = j.CustId
       JOIN PmPack pk ON pr.PmPackId = pk.PmPackID JOIN JsLot jl ON jp.LotId = jl.LotID AND j.JobId = jl.JobId AND pr.LotId = jl.LotID
       JOIN PmPlan pp ON pp.PmPlanID = jl.PmPlanId JOIN PmContract ct ON pp.PmContractId = ct.PmContractID JOIN JsPhase ph ON ct.PmContractID = ph.PmContractId AND jl.PhaseId = ph.PhaseID
       LEFT JOIN LsHourTypePR ht ON pr.HourTypeId = ht.HourTypeID
      WHERE pr.LotId = @lotId AND (@from IS NULL OR (pr.PayrollDate >= @from AND pr.PayrollDate < DATEADD(day,1,@to)))
      ORDER BY pr.PayrollDate, pr.PackName, pr.EmpName`, { lotId, from, to });
  res.json({ header: { title: total ? 'Lot-packs ready to bill total' : 'Lot-packs ready to bill detail', from, to, lotId, address: rows[0]?.LotAddress || null, customer: rows[0]?.CustName || null, jobName: rows[0]?.JobName || null, lotBlock: rows[0]?.LotBlock || null }, rows, totals: { hours: sum(rows, (r) => r.PayHours) } });
}));

// ---------------------------------------------------------------------------
// 4) Lot-pack by type to bill (ArLotPackTypeToBill): packs of one pack type whose first payroll falls in the period
// ---------------------------------------------------------------------------
router.get('/reports/lot-pack-type-to-bill', h(async (req, res) => {
  const p = { div: pDiv(req.query), from: pDate(req.query, 'from', 'E', 'From', true), to: pDate(req.query, 'to', 'F', 'To', true), type: pInt(req.query, 'packTypeId', 'G', 'Pack type', true), cust: pInt(req.query, 'customerId', 'A', 'Customer') };
  const rows = await query(
    `WITH g AS (
       SELECT j.DivisionId, c.CustName, j.JobName, ph.Phase, ct.BidNum, jl.Lot + '/' + jl.Block AS LotBlock, pk.PackName, pt.PackType, jp.PackQty, jp.ContractEa, jp.RevContractEa, MIN(CAST(pr.PayrollDate AS date)) AS FirstDate
         FROM LsPackType pt JOIN PmPack pk ON pt.PackTypeID = pk.PackTypeId JOIN JsPack jp ON jp.PmPackId = pk.PmPackID JOIN JsLot jl ON jp.LotId = jl.LotID JOIN JsJob j ON j.JobId = jl.JobId
         JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON jl.PhaseId = ph.PhaseID JOIN PmContract ct ON ph.PmContractId = ct.PmContractID
         JOIN PrLaborPaid pr ON j.JobId = pr.JobId AND jl.LotID = pr.LotId AND jp.PackID = pr.PackId AND pk.PmPackID = pr.PmPackId
        WHERE pt.PackTypeID = @type AND (@cust IS NULL OR c.CustID = @cust) AND j.DivisionId = @div
        GROUP BY j.DivisionId, c.CustName, j.JobName, ph.Phase, ct.BidNum, jl.Lot + '/' + jl.Block, pk.PackName, pt.PackType, jp.PackQty, jp.ContractEa, jp.RevContractEa)
     SELECT g.DivisionId, g.CustName, g.JobName, g.Phase, g.BidNum, g.LotBlock, g.PackName, g.PackType, g.PackQty, ${MV('g.ContractEa')} AS ContractEa, ${MV('g.RevContractEa')} AS RevContractEa,
            ${EXT('g.PackQty', 'g.ContractEa', 'g.RevContractEa')} AS ExtVal, g.FirstDate
       FROM g WHERE g.FirstDate >= @from AND g.FirstDate <= @to ORDER BY g.CustName, g.JobName, g.LotBlock, g.PackName`, p);
  const groups = groupBy(rows, (r) => r.CustName).map(([customer, cr]) => ({
    customer, extVal: sum(cr, (r) => r.ExtVal),
    jobs: groupBy(cr, (r) => r.JobName).map(([job, jr]) => ({ job, rows: jr, extVal: sum(jr, (r) => r.ExtVal) })),
  }));
  res.json({ header: { title: `Lots pack by type: ${rows[0]?.PackType || ''}`, division: p.div, from: p.from, to: p.to, packTypeId: p.type, packType: rows[0]?.PackType || null, ...(await lookupNames(p)) }, groups, rows, totals: { extVal: sum(rows, (r) => r.ExtVal) } });
}));

// ---------------------------------------------------------------------------
// 5) Lots by plan (ArLotsByPlan): lots of one job using one plan, by phase (+ contract/bid)
//    Access cboPlan is the plan NUMBER (PlanNum); a numeric PmPlanID that is not a PlanNum is also accepted.
// ---------------------------------------------------------------------------
router.get('/reports/lots-by-plan', h(async (req, res) => {
  const jobId = pInt(req.query, 'jobId', 'B', 'Job', true);
  const planRaw = String(req.query.planId ?? '').trim();
  if (!planRaw) throw bad('Choose a plan (filter K)');
  if (planRaw.length > 50) throw bad('Plan (filter K) is not valid');
  const p = { job: jobId, cust: pInt(req.query, 'customerId', 'A', 'Customer'), plan: planRaw };
  let planNum = planRaw;
  const exact = await query('SELECT TOP 1 PlanNum FROM PmPlan WHERE PlanNum = @plan', p);
  if (!exact[0] && /^\d+$/.test(planRaw)) {
    const byId = await query('SELECT TOP 1 PlanNum FROM PmPlan WHERE PmPlanID = @id', { id: parseInt(planRaw, 10) });
    if (byId[0]) planNum = byId[0].PlanNum;
  }
  const rows = await query(
    `SELECT c.CustName, j.JobName, pl.PlanNum, ph.Phase, ct.BidNum, ct.BidRelease, ct.BidName, ct.BidDate, jl.Lot + '/' + jl.Block AS LotBlock, jl.StartDate, jl.EndDate, jl.LotID
       FROM PmJob pj JOIN PmContract ct ON pj.PmJobID = ct.PmJobId JOIN PmPlan pl ON ct.PmContractID = pl.PmContractId
       JOIN JsLot jl ON pl.PmPlanID = jl.PmPlanId JOIN JsPhase ph ON jl.PhaseId = ph.PhaseID AND ct.PmContractID = ph.PmContractId
       JOIN JsJob j ON pj.PmJobID = j.PmJobId AND ph.JobId = j.JobId JOIN JsCustomer c ON c.CustID = j.CustId
      WHERE pl.PlanNum = @planNum AND j.JobId = @job AND (@cust IS NULL OR j.CustId = @cust)
      ORDER BY ph.Phase, jl.Lot + '/' + jl.Block`, { planNum, job: jobId, cust: p.cust });
  const groups = groupBy(rows, (r) => `${r.Phase}|${r.BidNum}|${r.BidRelease}`).map(([, pr]) => ({ phase: pr[0].Phase, bidNum: pr[0].BidNum, bidRelease: pr[0].BidRelease, bidName: pr[0].BidName, bidDate: pr[0].BidDate, rows: pr }));
  res.json({ header: { title: 'Lots by plan', customer: rows[0]?.CustName || null, job: rows[0]?.JobName || null, plan: planNum, jobId }, groups, rows, totals: { lots: rows.length } });
}));

// ---------------------------------------------------------------------------
// 6) Billing by super (ArBillingBySuper): standard pack concepts paid in the payroll week, items flagged "bill by super"
// ---------------------------------------------------------------------------
router.get('/reports/billing-by-super', h(async (req, res) => {
  const p = { div: pDiv(req.query), date: pDate(req.query, 'date', 'H', 'Payroll', true) };
  const rows = await query(
    `SELECT s.SuperName, CAST(pr.PayrollDate AS date) AS PayrollDate, j.DivisionId, c.CustName, pr.JobName, j.JobNum, jl.Lot + '/' + jl.Block AS LotBlock, pr.PlanNum, ct.BidNum, jp.PackID, pr.PackName, pk.BuilderCode, jp.PackQty, w.WorkType
       FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN PrLaborPaid pr ON pr.JobId = j.JobId JOIN JsPack jp ON pr.PackId = jp.PackID JOIN PmPack pk ON pr.PmPackId = pk.PmPackID
       JOIN JsPhase ph ON j.JobId = ph.JobId JOIN LsSuperintendent s ON ph.SuperId1 = s.SuperID JOIN JsLot jl ON ph.PhaseID = jl.PhaseId AND pr.LotId = jl.LotID
       JOIN PmContract ct ON ph.PmContractId = ct.PmContractID JOIN IcItem ic ON pr.InvItemId = ic.InvItemID JOIN LsWork w ON pr.WorkId = w.WorkID
      WHERE pr.PayPercent > 0 AND pk.PackTypeId = 1 AND ic.BillBySuper = 1 AND CAST(pr.PayrollDate AS date) = @date AND j.DivisionId = @div
      GROUP BY s.SuperName, CAST(pr.PayrollDate AS date), j.DivisionId, c.CustName, pr.JobName, j.JobNum, jl.Lot + '/' + jl.Block, pr.PlanNum, ct.BidNum, jp.PackID, pr.PackName, pk.BuilderCode, jp.PackQty, w.WorkType
      ORDER BY s.SuperName, pr.JobName, jl.Lot + '/' + jl.Block, pr.PackName`, p);
  const groups = groupBy(rows, (r) => r.SuperName).map(([superName, sr]) => ({
    superName, count: sr.length,
    jobs: groupBy(sr, (r) => r.JobName).map(([job, jr]) => ({ job, jobNum: jr[0].JobNum, customer: jr[0].CustName, rows: jr })),
  }));
  res.json({ header: { title: 'Billing by super', division: p.div, date: p.date }, groups, rows, totals: { lines: rows.length, supers: groups.length } });
}));

// ---------------------------------------------------------------------------
// 7/8) Total billing by lot (ArLotBilling) and its T&M variant (ArLotBillingTM#)
//    rptArLotBilling1 (packs + contract) LEFT JOIN rptArLotBilling2 (invoice items of the lot) on PackId
// ---------------------------------------------------------------------------
async function lotBilling(req) {
  const lotId = pInt(req.query, 'lotId', 'C', 'Lot', true);
  const p = { lotId, cust: pInt(req.query, 'customerId', 'A', 'Customer'), job: pInt(req.query, 'jobId', 'B', 'Job') };
  const lot = (await query(
    `SELECT jl.LotID, j.JobId, j.JobName, j.CustId, c.CustName, jl.Lot, jl.Block, jl.LotNotes, pl.PlanNum
       FROM JsLot jl JOIN JsJob j ON j.JobId = jl.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = jl.PmPlanId WHERE jl.LotID = @lotId`, { lotId }))[0];
  if (!lot) throw bad('Lot not found', 404);
  const packs = await query(
    `SELECT jp.PackID, pk.PackName, pk.TmId, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa, ${EXT('jp.PackQty', 'jp.ContractEa', 'jp.RevContractEa')} AS ExtContractVal
       FROM JsPack jp JOIN PmPack pk ON jp.PmPackId = pk.PmPackID WHERE jp.LotId = @lotId ORDER BY pk.PackName, jp.PackID`, { lotId });
  const items = await query(
    `SELECT bi.BillItemID, bi.BillId AS BillID, bi.PackId, bi.Quantity, ${MV('bi.ValueEa')} AS ValueEa, bi.BillPercent, ${MV('bi.ItemTotal')} AS ItemTotal
       FROM ArBilling b JOIN ArBillingItem bi ON b.BillID = bi.BillId WHERE b.LotId = @lotId ORDER BY bi.BillId, bi.BillItemID`, { lotId });
  const byPack = new Map();
  for (const it of items) { if (!byPack.has(it.PackId)) byPack.set(it.PackId, []); byPack.get(it.PackId).push(it); }
  const rows = packs.map((k) => {
    const inv = byPack.get(k.PackID) || [];
    return { ...k, items: inv, invoiced: sum(inv, (i) => i.ItemTotal) };
  });
  const contract = sum(packs, (k) => k.ExtContractVal), invoiced = sum(items, (i) => i.ItemTotal);
  return { header: { title: `Total billing for ${lot.JobName}, lot ${lot.Lot}/${lot.Block} - plan ${lot.PlanNum ?? ''}`, jobName: lot.JobName, customer: lot.CustName, lot: `${lot.Lot}/${lot.Block}`, plan: lot.PlanNum, lotNotes: lot.LotNotes, lotId }, rows, totals: { contract, invoiced, balance: r2(contract - invoiced) } };
}
router.get('/reports/lot-billing', h(async (req, res) => { res.json(await lotBilling(req)); }));
router.get('/reports/lot-billing-tm', h(async (req, res) => { res.json(await lotBilling(req)); }));

module.exports = router;
