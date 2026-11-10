// Time & Material (TM) — mirrors the Access TmPO form (header + packs + materials), "Process & schedule" (macro TmProcessSchedule),
// "Update cost & labor hours" (query frmTmPoUpdatePrice), "Duplicate TM" (macro TmDuplicateTm) and the T&M reports.
//
//   Price math (from the Access form + frmTmPoTotals):
//     Subtotal   = Σ pack prices + flat labor
//     Discount   = −Subtotal × Discount%
//     Taxable    = credit type: materials×(1−disc) · else: (Subtotal − labor)×(1−disc), never below 0
//     Sales tax  = Taxable × TaxRate · Total = Subtotal + Discount + Tax · Card total = Total × (1 + card fee)
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null ? null : Number(v));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const par = (tx, fns) => (tx ? fns.reduce((p, f) => p.then(async (a) => [...a, await f()]), Promise.resolve([])) : Promise.all(fns.map((f) => f())));

// Per-TM totals as a derived table so lists, reports and the detail screen all use the same numbers.
const TOTALS = `
  SELECT t.TmID,
         pk.PackSum + CASE WHEN ISNULL(t.LaborRateFlat,0) > 0 THEN t.LaborRateFlat ELSE 0 END AS Subtotal,
         ISNULL(m.MatWMU,0) AS MatWMU, ISNULL(m.MatCost,0) AS MatCost, ISNULL(m.LaborCost,0) AS LaborCost, ISNULL(m.LaborHours,0) AS LaborHours,
         CASE WHEN ISNULL(t.LaborRateFlat,0) > 0 THEN t.LaborRateFlat ELSE ISNULL(m.LaborWMU,0) END AS LaborWMU,
         ISNULL(tt.Credit,0) AS IsCredit
    FROM TmPO t
    LEFT JOIN LsTmType tt ON tt.TmTypeID = t.TmTypeId
    OUTER APPLY (SELECT ISNULL(SUM(p.Price),0) AS PackSum FROM TmPOPack p WHERE p.TmId = t.TmID) pk
    OUTER APPLY (SELECT SUM(CASE WHEN x.CostCode <> 'L' THEN x.Quantity * x.CostEaWMU ELSE 0 END) AS MatWMU,
                        SUM(CASE WHEN x.CostCode <> 'L' THEN x.Quantity * x.CostEa ELSE 0 END) AS MatCost,
                        SUM(CASE WHEN x.CostCode = 'L' THEN x.Quantity * x.CostEaWMU ELSE 0 END) AS LaborWMU,
                        SUM(CASE WHEN x.CostCode = 'L' THEN x.Quantity * x.CostEa ELSE 0 END) AS LaborCost,
                        SUM(CASE WHEN x.CostCode = 'L' THEN x.Quantity ELSE 0 END) AS LaborHours
                   FROM TmPOPack p2 JOIN TmPOMaterial x ON x.TmPackId = p2.TmPackID WHERE p2.TmId = t.TmID) m`;

const CALC = `
  c.Subtotal, c.MatWMU, c.MatCost, c.LaborCost, c.LaborHours, c.LaborWMU,
  -c.Subtotal * ISNULL(t.Discount,0) AS DiscountAmt,
  tax.Taxable,
  CASE WHEN c.IsCredit = 1 THEN tax.Taxable * t.TaxRate WHEN tax.Taxable <= 0 THEN 0 ELSE tax.Taxable * t.TaxRate END AS SalesTax`;
const TAX_APPLY = `
  CROSS APPLY (SELECT CASE WHEN c.IsCredit = 1 THEN c.MatWMU * (1 - ISNULL(t.Discount,0))
                           WHEN ISNULL(t.LaborRateFlat,0) = 0 THEN CASE WHEN c.LaborWMU > c.Subtotal THEN 0 ELSE (c.Subtotal - c.LaborWMU) * (1 - ISNULL(t.Discount,0)) END
                           ELSE (c.Subtotal - t.LaborRateFlat) * (1 - ISNULL(t.Discount,0)) END AS Taxable) tax`;
const WITH_TOTALS = `FROM TmPO t JOIN (${TOTALS}) c ON c.TmID = t.TmID ${TAX_APPLY}`;
const GRAND = `CAST(c.Subtotal - c.Subtotal * ISNULL(t.Discount,0) + CASE WHEN c.IsCredit = 1 THEN tax.Taxable * t.TaxRate WHEN tax.Taxable <= 0 THEN 0 ELSE tax.Taxable * t.TaxRate END AS decimal(18,2))`;

function withGrand(r) {
  const total = Number(r.Subtotal || 0) + Number(r.DiscountAmt || 0) + Number(r.SalesTax || 0);
  return { ...r, Total: Math.round(total * 100) / 100, CardFee: Math.round(total * Number(r.CreditCardFee || 0) * 100) / 100, TotalWithCard: Math.round(total * (1 + Number(r.CreditCardFee || 0)) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [priceLevels, tmTypes, workTypes, divisions, users] = await Promise.all([
    query('SELECT PriceLevelID AS id, PriceLevel AS name, MarkUpValue FROM LsPriceLevel ORDER BY PriceLevelID'),
    query('SELECT TmTypeID AS id, TmType AS name, Contracted, Credit FROM LsTmType ORDER BY TmTypeID'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name, SalesTax FROM LsDivision ORDER BY DivisionID"),
    query('SELECT DISTINCT PreparedBy AS name FROM TmPO WHERE PreparedBy IS NOT NULL ORDER BY PreparedBy'),
  ]);
  res.json({ priceLevels, tmTypes, workTypes, divisions, users });
}));

// ---------------------------------------------------------------------------
// List (SwitchTM combo + search)
// ---------------------------------------------------------------------------
router.get('/', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = {
    s: req.query.search ? `%${req.query.search}%` : null, from: isoDate(req.query.from), to: isoDate(req.query.to), div: req.query.division || null,
    type: int(req.query.typeId), cust: int(req.query.custId), job: int(req.query.jobId), lot: int(req.query.lotId), by: req.query.preparedBy || null,
    status: req.query.status || 'all', offset: pg.offset, pageSize: pg.pageSize,
  };
  const where = `WHERE (@s IS NULL OR t.TmName LIKE @s OR t.TmCustomerNum LIKE @s OR j.JobName LIKE @s OR cu.CustName LIKE @s OR l.Address LIKE @s OR t.RequestedBy LIKE @s OR CAST(t.TmID AS varchar(20)) LIKE @s)
    AND (@from IS NULL OR t.TmDate >= @from) AND (@to IS NULL OR t.TmDate <= @to) AND (@div IS NULL OR j.DivisionId = @div)
    AND (@type IS NULL OR t.TmTypeId = @type) AND (@cust IS NULL OR t.CustomerId = @cust) AND (@job IS NULL OR t.JobId = @job) AND (@lot IS NULL OR t.LotId = @lot)
    AND (@by IS NULL OR t.PreparedBy = @by)
    AND (@status = 'all' OR (@status = 'unapproved' AND t.ApprovedDate IS NULL) OR (@status = 'approved' AND t.ApprovedDate IS NOT NULL)
         OR (@status = 'unpaid' AND t.ApprovedDate IS NOT NULL AND t.PaidDate IS NULL) OR (@status = 'paid' AND t.PaidDate IS NOT NULL))`;
  const from = `${WITH_TOTALS} JOIN JsJob j ON j.JobId = t.JobId LEFT JOIN JsCustomer cu ON cu.CustID = t.CustomerId LEFT JOIN JsLot l ON l.LotID = t.LotId LEFT JOIN LsTmType ty ON ty.TmTypeID = t.TmTypeId`;
  const [rows, total, sum] = await Promise.all([
    query(`SELECT t.TmID, t.TmDate, t.TmName, t.TmCustomerNum, ty.TmType, t.TmTypeId, t.PreparedBy, t.RequestedBy, t.ApprovedDate, t.PaidDate, t.Budget,
                  cu.CustName, j.JobName, j.DivisionId, l.Lot, l.Block, l.Address, l.EndDate AS LotEndDate, t.Discount, t.TaxRate, t.CreditCardFee, ${CALC}
             ${from} ${where} ORDER BY t.TmDate DESC, t.TmID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from} ${where}`, p),
    query(`SELECT SUM(${GRAND}) AS amount, SUM(CASE WHEN t.ApprovedDate IS NULL THEN 1 ELSE 0 END) AS unapproved,
                  SUM(CASE WHEN t.ApprovedDate IS NOT NULL AND t.PaidDate IS NULL THEN 1 ELSE 0 END) AS unpaid,
                  SUM(CASE WHEN t.ApprovedDate IS NOT NULL AND t.PaidDate IS NULL THEN ${GRAND} ELSE 0 END) AS unpaidAmount ${from} ${where}`, p),
  ]);
  res.json({ rows: rows.map(withGrand), total: total[0].n, page: pg.page, pageSize: pg.pageSize, summary: sum[0] });
}));

// ---------------------------------------------------------------------------
// One T&M
// ---------------------------------------------------------------------------
async function loadTm(id, tx) {
  const head = await query(
    `SELECT t.*, ty.TmType, ty.Credit, ty.Contracted, w.WorkType, cu.CustName, j.JobName, j.JobNum, j.DivisionId, l.Lot, l.Block, l.Address, l.City, l.EndDate AS LotEndDate, l.StatusId AS LotStatusId,
            ph.PhaseID, ph.Phase, s1.SuperName + ' ' + ISNULL(s1.SuperType,'') AS SuperName, co.Company, co.BillAddress, co.BillCity, co.BillState, co.BillZip, co.BillPhone,
            ${CALC}
       ${WITH_TOTALS}
       LEFT JOIN LsTmType ty ON ty.TmTypeID = t.TmTypeId LEFT JOIN LsWork w ON w.WorkID = t.WorkId LEFT JOIN JsCustomer cu ON cu.CustID = t.CustomerId
       LEFT JOIN JsJob j ON j.JobId = t.JobId LEFT JOIN JsLot l ON l.LotID = t.LotId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       LEFT JOIN LsSuperintendent s1 ON s1.SuperID = ph.SuperId1 LEFT JOIN LsCompany co ON co.DivisionId = j.DivisionId
      WHERE t.TmID = @id`, { id }, tx);
  if (!head[0]) return null;
  const packs = await query('SELECT * FROM TmPOPack WHERE TmId = @id ORDER BY TmPackID', { id }, tx);
  const mats = await query(
    `SELECT x.*, i.Description, i.AlternateCode, i.Uom, ic.InvClass, i.JobCostPrice AS ItemJobCost, i.EstimatingPrice, i.VipPrice, i.ResidentialPoPrice, i.RetailPrice, i.LaborCost AS ItemLaborCost,
            x.Quantity * x.CostEaWMU AS ExtPrice, x.Quantity * x.CostEa AS ExtCost
       FROM TmPOPack p JOIN TmPOMaterial x ON x.TmPackId = p.TmPackID LEFT JOIN IcItem i ON i.InvItemID = x.InvItemId LEFT JOIN LsInvClass ic ON ic.InvClassID = i.InvClassId
      WHERE p.TmId = @id ORDER BY x.TmMaterialID`, { id }, tx);
  const plan = await query(`SELECT TOP 1 pk.PmPackID, pk.PackName, pk.ContractVal FROM PmPack pk WHERE CAST(pk.TmId AS varchar(30)) = CAST(@id AS varchar(30))`, { id }, tx);
  const h0 = withGrand(head[0]);
  return { tm: h0, packs: packs.map((p) => ({ ...p, materials: mats.filter((m) => m.TmPackId === p.TmPackID) })), pmPack: plan[0] || null,
    flags: { processed: !!h0.ApprovedDate, lotClosed: !!h0.LotEndDate, paid: !!h0.PaidDate } };
}

router.get('/:id', h(async (req, res) => {
  const d = await loadTm(int(req.params.id));
  if (!d) return res.status(404).json({ error: 'T&M not found' });
  res.json(d);
}));

const HEADER = ['TmDate', 'TmCustomerNum', 'TmName', 'TmNotes', 'TmTypeId', 'WorkId', 'PriceLevel', 'RequestedBy', 'RequestorPhone', 'RequestorEmail', 'Discount',
  'LaborRate', 'LaborRateFlat', 'TaxRate', 'CreditCardFee', 'Budget', 'PaidDate', 'PreparedBy'];
const TM = { table: 'TmPO', idCol: 'TmID', columns: ['CustomerId', 'JobId', 'LotId', 'LaborHoursAdjusted', 'ApprovedDate', 'ApprovedBy', ...HEADER] };

async function assertLotOpen(tx, lotId) {
  const l = await query('SELECT LotID, Lot, EndDate FROM JsLot WHERE LotID = @id', { id: lotId }, tx);
  if (!l[0]) throw bad('Lot not found', 404);
  if (l[0].EndDate) throw bad('This lot is closed. Open the lot first (in Scheduling) before entering or changing a T&M.', 409);
  return l[0];
}

function validateHeader(b, lot) {
  if (b.TmName !== undefined) {
    const name = String(b.TmName || '').trim();
    if (!name) throw bad('Enter a T&M name');
    // the name becomes part of a PM pack name: "PO - Lot <lot> - <name>" (Access limit: name + lot + 12 <= 100)
    if (lot && name.length + String(lot.Lot || '').length + 12 > 100) throw bad('The T&M name is too long to be imported into the PM module. Please make it shorter.');
  }
  if (b.Discount != null && b.Discount !== '' && (num(b.Discount) < 0 || num(b.Discount) > 1)) throw bad('Discount is a fraction between 0 and 1 (e.g. 0.10 for 10%)');
  if (b.TaxRate != null && b.TaxRate !== '' && (num(b.TaxRate) < 0 || num(b.TaxRate) > 0.25)) throw bad('Tax rate is a fraction (e.g. 0.0775)');
  if (b.CreditCardFee != null && b.CreditCardFee !== '' && (num(b.CreditCardFee) < 0 || num(b.CreditCardFee) > 0.2)) throw bad('Credit card fee is a fraction (e.g. 0.05)');
  if (b.LaborRate != null && b.LaborRate !== '' && num(b.LaborRate) < 0) throw bad('Labor rate cannot be negative');
  if (b.LaborRateFlat != null && b.LaborRateFlat !== '' && num(b.LaborRateFlat) < 0) throw bad('Flat labor cannot be negative');
  if (b.PriceLevel != null && b.PriceLevel !== '' && ![1, 2, 3, 4].includes(int(b.PriceLevel))) throw bad('Choose a price level');
}
function clean(b) {
  const o = {};
  for (const k of HEADER) if (k in b) o[k] = b[k] === '' ? null : b[k];
  for (const k of ['TmDate', 'PaidDate']) if (k in o) o[k] = isoDate(o[k]);
  for (const k of ['Discount', 'LaborRate', 'LaborRateFlat', 'TaxRate', 'CreditCardFee']) if (k in o) o[k] = num(o[k]);
  for (const k of ['TmTypeId', 'WorkId', 'PriceLevel']) if (k in o) o[k] = int(o[k]);
  if ('Budget' in o) o.Budget = o.Budget ? 1 : 0;
  return o;
}

router.post('/', h(async (req, res) => {
  const b = req.body || {};
  const id = await withTransaction(async (tx) => {
    const lotId = int(b.LotId);
    if (!lotId) throw bad('Choose a lot');
    const lot = await assertLotOpen(tx, lotId);
    const ctx = await query(`SELECT j.JobId, j.CustId, d.SalesTax FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN LsDivision d ON d.DivisionID = j.DivisionId WHERE l.LotID = @id`, { id: lotId }, tx);
    validateHeader({ TmName: b.TmName, ...b }, lot);
    const data = {
      TmDate: new Date().toISOString().slice(0, 10), PriceLevel: 3, TmTypeId: 3, LaborRate: 150, LaborRateFlat: 0, Discount: 0, LaborHoursAdjusted: 0,
      TaxRate: ctx[0].SalesTax != null ? Number(ctx[0].SalesTax) / 100 : 0.0775, // division sales tax is stored as a percent (7.75)
      CreditCardFee: 0.05, Budget: 0, PreparedBy: req.user.username, ...clean(b),
      CustomerId: ctx[0].CustId, JobId: ctx[0].JobId, LotId: lotId, ApprovedDate: null, ApprovedBy: null,
    };
    if (!data.TmName) throw bad('Enter a T&M name');
    return insertRow(TM, data, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await query('SELECT TmID, LotId, ApprovedDate, PriceLevel, LaborRate, LaborRateFlat, Discount, TaxRate FROM TmPO WHERE TmID = @id', { id }, tx);
    if (!cur[0]) throw bad('T&M not found', 404);
    const lot = await assertLotOpen(tx, cur[0].LotId);
    validateHeader(b, lot);
    const o = clean(b);
    if (cur[0].ApprovedDate) {
      // Access: "This TM is already processed, you cannot update prices."
      for (const k of ['PriceLevel', 'LaborRate', 'LaborRateFlat', 'Discount', 'TaxRate']) {
        if (k in o && Number(o[k] ?? 0) !== Number(cur[0][k] ?? 0)) throw bad('This T&M is already processed, so prices, labor rate, discount and tax can no longer change.', 409);
      }
    }
    await updateRow(TM, id, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await query('SELECT ApprovedDate FROM TmPO WHERE TmID = @id', { id }, tx);
    if (!cur[0]) throw bad('T&M not found', 404);
    if (cur[0].ApprovedDate) throw bad('A processed T&M created a pack in Plan management and cannot be deleted.', 409);
    await query('DELETE FROM TmPOMaterial WHERE TmPackId IN (SELECT TmPackID FROM TmPOPack WHERE TmId = @id)', { id }, tx);
    await query('DELETE FROM TmPOPack WHERE TmId = @id', { id }, tx);
    await deleteRow(TM, id, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Packs and materials
// ---------------------------------------------------------------------------
const PACK = { table: 'TmPOPack', idCol: 'TmPackID', columns: ['TmId', 'TmPackName', 'Price', 'Notes'] };
const MAT = { table: 'TmPOMaterial', idCol: 'TmMaterialID', columns: ['TmPackId', 'InvItemId', 'InvItem', 'Quantity', 'CostCode', 'CostEa', 'ManualCost', 'CostEaWMU', 'StageId', 'WorkId', 'Notes'], audit: true };

async function editableTm(tx, tmId) {
  const t = await query('SELECT t.TmID, t.LotId, t.PriceLevel, t.LaborRate, t.ApprovedDate FROM TmPO t WHERE t.TmID = @id', { id: tmId }, tx);
  if (!t[0]) throw bad('T&M not found', 404);
  await assertLotOpen(tx, t[0].LotId);
  return t[0];
}
const markup = async (tx, level) => {
  const r = await query('SELECT MarkUpValue FROM LsPriceLevel WHERE PriceLevelID = @l', { l: level }, tx);
  return 1 + Number(r[0]?.MarkUpValue ?? 0);
};

// Cost / sell price of an item for a T&M (Access: macro on the material InvItemId combo)
async function priceItem(tx, tm, itemId) {
  const i = await query(`SELECT InvItemID, InvItem, CostCodeId, DefaultStageId, DefaultWorkId, JobCostPrice, LaborCost, EstimatingPrice, VipPrice, ResidentialPoPrice, RetailPrice FROM IcItem WHERE InvItemID = @id`, { id: itemId }, tx);
  if (!i[0]) throw bad('Item not found');
  const it = i[0];
  let costEa, wmu;
  if (it.CostCodeId === 'L') { costEa = it.LaborCost; wmu = tm.LaborRate; }
  else {
    costEa = it.JobCostPrice;
    wmu = tm.PriceLevel === 1 ? it.EstimatingPrice : tm.PriceLevel === 2 ? it.VipPrice : tm.PriceLevel === 3 ? it.ResidentialPoPrice : tm.PriceLevel === 4 ? it.RetailPrice : 0;
  }
  return { item: it, costEa: costEa ?? 0, wmu: wmu ?? 0 };
}

router.post('/:id/packs', h(async (req, res) => {
  const tmId = int(req.params.id);
  const b = req.body || {};
  const id = await withTransaction(async (tx) => {
    await editableTm(tx, tmId);
    if (!String(b.TmPackName || '').trim()) throw bad('Enter a pack name');
    return insertRow({ ...PACK, audit: false }, { TmId: tmId, TmPackName: String(b.TmPackName).trim(), Price: num(b.Price) ?? 0, Notes: b.Notes || null }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/packs/:packId', h(async (req, res) => {
  const id = int(req.params.packId);
  const b = req.body || {};
  const cur = await query('SELECT TmId FROM TmPOPack WHERE TmPackID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Pack not found' });
  await withTransaction(async (tx) => {
    await editableTm(tx, cur[0].TmId);
    const o = {};
    if ('TmPackName' in b) { if (!String(b.TmPackName || '').trim()) throw bad('Enter a pack name'); o.TmPackName = String(b.TmPackName).trim(); }
    if ('Price' in b) o.Price = num(b.Price) ?? 0;
    if ('Notes' in b) o.Notes = b.Notes || null;
    await updateRow(PACK, id, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/packs/:packId', h(async (req, res) => {
  const id = int(req.params.packId);
  const cur = await query('SELECT TmId FROM TmPOPack WHERE TmPackID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Pack not found' });
  await withTransaction(async (tx) => {
    const t = await editableTm(tx, cur[0].TmId);
    if (t.ApprovedDate) throw bad('This T&M is already processed; its packs cannot be removed.', 409);
    await query('DELETE FROM TmPOMaterial WHERE TmPackId = @id', { id }, tx);
    await deleteRow(PACK, id, tx);
  });
  res.json({ ok: true });
}));

router.post('/packs/:packId/materials', h(async (req, res) => {
  const packId = int(req.params.packId);
  const b = req.body || {};
  const cur = await query('SELECT TmId FROM TmPOPack WHERE TmPackID = @id', { id: packId });
  if (!cur[0]) return res.status(404).json({ error: 'Pack not found' });
  const qty = num(b.Quantity ?? 1);
  if (qty == null || isNaN(qty) || qty === 0 || Math.abs(qty) > 100000) throw bad('Enter a quantity');
  const id = await withTransaction(async (tx) => {
    const tm = await editableTm(tx, cur[0].TmId);
    const p = await priceItem(tx, tm, int(b.InvItemId));
    return insertRow(MAT, {
      TmPackId: packId, InvItemId: p.item.InvItemID, InvItem: p.item.InvItem, Quantity: qty, CostCode: p.item.CostCodeId, CostEa: p.costEa, CostEaWMU: p.wmu,
      ManualCost: 0, StageId: p.item.DefaultStageId, WorkId: p.item.DefaultWorkId, Notes: b.Notes || null,
    }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/materials/:matId', h(async (req, res) => {
  const id = int(req.params.matId);
  const b = req.body || {};
  const cur = await query(`SELECT x.*, p.TmId FROM TmPOMaterial x JOIN TmPOPack p ON p.TmPackID = x.TmPackId WHERE x.TmMaterialID = @id`, { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  await withTransaction(async (tx) => {
    const tm = await editableTm(tx, cur[0].TmId);
    const o = {};
    if ('Quantity' in b) { const q = num(b.Quantity); if (q == null || isNaN(q) || q === 0 || Math.abs(q) > 100000) throw bad('Enter a quantity'); o.Quantity = q; }
    if ('Notes' in b) o.Notes = b.Notes || null;
    if (b.ManualCost === false) {
      // back to catalogue pricing
      const p = await priceItem(tx, tm, cur[0].InvItemId);
      o.CostEa = p.costEa; o.CostEaWMU = p.wmu; o.ManualCost = 0;
    } else {
      if ('CostEa' in b) {
        const c = num(b.CostEa); if (c == null || isNaN(c) || c < 0) throw bad('Enter a cost');
        o.CostEa = c; o.ManualCost = 1; o.CostEaWMU = Math.round(c * (await markup(tx, tm.PriceLevel)) * 10000) / 10000; // Access: factor × CostEa
      }
      if ('CostEaWMU' in b) {
        const c = num(b.CostEaWMU); if (c == null || isNaN(c) || c < 0) throw bad('Enter a price');
        o.CostEaWMU = c; o.ManualCost = 1;
      }
    }
    await updateRow(MAT, id, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/materials/:matId', h(async (req, res) => {
  const id = int(req.params.matId);
  const cur = await query(`SELECT p.TmId FROM TmPOMaterial x JOIN TmPOPack p ON p.TmPackID = x.TmPackId WHERE x.TmMaterialID = @id`, { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  await withTransaction(async (tx) => {
    const t = await editableTm(tx, cur[0].TmId);
    if (t.ApprovedDate) throw bad('This T&M is already processed; its lines cannot be removed.', 409);
    await deleteRow(MAT, id, tx);
  });
  res.json({ ok: true });
}));

// "Update cost & labor hours" (frmTmPoUpdatePrice) — refresh non-manual, mark-up cost-code lines from the catalogue
router.post('/:id/update-prices', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    const t = await editableTm(tx, id);
    if (t.ApprovedDate) throw bad('This T&M has already been processed. Prices have not been updated.', 409);
    const r = await query(
      `UPDATE x SET x.CostEa = i.JobCostPrice,
              x.CostEaWMU = CASE t.PriceLevel WHEN 1 THEN i.EstimatingPrice WHEN 2 THEN i.VipPrice WHEN 3 THEN i.ResidentialPoPrice WHEN 4 THEN i.RetailPrice ELSE 0 END
         FROM TmPOMaterial x JOIN TmPOPack p ON p.TmPackID = x.TmPackId JOIN TmPO t ON t.TmID = p.TmId JOIN IcItem i ON i.InvItemID = x.InvItemId
         JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId
        WHERE t.TmID = @id AND cc.TmMarkUp = 1 AND i.CostCodeId <> 'L' AND ISNULL(x.ManualCost,0) = 0;
       SELECT @@ROWCOUNT AS n`, { id }, tx);
    const hours = await query(`SELECT ISNULL(SUM(x.Quantity),0) AS hrs FROM TmPOMaterial x JOIN TmPOPack p ON p.TmPackID = x.TmPackId WHERE p.TmId = @id AND x.CostCode = 'L'`, { id }, tx);
    await query('UPDATE TmPO SET LaborHoursAdjusted = @h WHERE TmID = @id', { h: hours[0].hrs, id }, tx);
    return { updated: r[0].n, laborHours: hours[0].hrs };
  });
  res.json(out);
}));

// Suggested price of a pack from its lines (labor at the T&M labor rate)
router.get('/packs/:packId/suggested-price', h(async (req, res) => {
  const r = await query(`SELECT ISNULL(SUM(x.Quantity * x.CostEaWMU),0) AS price FROM TmPOMaterial x WHERE x.TmPackId = @id`, { id: int(req.params.packId) });
  res.json({ price: Math.round(r[0].price * 100) / 100 });
}));

// ---------------------------------------------------------------------------
// Process & schedule (macro TmProcessSchedule): creates a "PO" pack in Plan management, schedules it on the lot and approves the T&M
// ---------------------------------------------------------------------------
async function processTm(tx, tmId, user) {
  const d = await loadTm(tmId, tx);
  if (!d) throw bad('T&M not found', 404);
  const t = d.tm;
  if (t.LotEndDate) throw bad('Lot is closed. You need to open the lot before you can process the T&M.', 409);
  if (t.ApprovedDate) throw bad('This T&M has already been processed.', 409);
  if (!d.packs.length || !d.packs.some((p) => p.materials.length)) throw bad('Add at least one pack with material or labor lines before processing.');
  const exists = await query('SELECT COUNT(*) AS n FROM PmPack WHERE CAST(TmId AS varchar(30)) = CAST(@id AS varchar(30))', { id: tmId }, tx);
  if (exists[0].n) throw bad('This T&M number is already in use in Plan management. Contact your database administrator.', 409);
  const lot = await query(`SELECT l.LotID, l.Lot, ph.PmContractId FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId WHERE l.LotID = @id`, { id: t.LotId }, tx);
  const contractId = lot[0]?.PmContractId;
  if (!contractId) throw bad('The phase of this lot has no contract in Plan management, so the T&M cannot be scheduled.', 409);

  // the contract's universal "PO" plan (created on first use)
  let plan = await query(`SELECT PmPlanID FROM PmPlan WHERE PmContractId = @c AND PlanNum = 'PO'`, { c: contractId }, tx);
  let planId = plan[0]?.PmPlanID;
  if (!planId) {
    planId = await nextId(tx, 'PmPlan', 'PmPlanID');
    await query(`INSERT INTO PmPlan (PmPlanID, PmContractId, PlanNum, Universal, StatusId, DateEntered, UserEntered) VALUES (@id, @c, 'PO', 1, 1, GETDATE(), @u)`, { id: planId, c: contractId, u: user }, tx);
  }

  const packName = `PO - Lot ${lot[0].Lot} - ${t.TmName}`;
  const contractVal = `$${Number(t.Total).toFixed(2)}`; // the total shown on the T&M PO (see note in the T&M docs about the Access formula)
  const pmPackId = await nextId(tx, 'PmPack', 'PmPackID');
  const stamp = new Date().toLocaleString('en-US');
  await query(
    `INSERT INTO PmPack (PmPackID, PmPlanId, TmId, BuilderCode, PackName, PackTypeId, Quantity, TruedUp, StatusId, Notes, ContractVal, DateEntered, UserEntered)
     VALUES (@id, @plan, @tm, @code, @name, 7, 1, 0, 1, @notes, @val, GETDATE(), @u)`,
    { id: pmPackId, plan: planId, tm: String(tmId), code: t.TmCustomerNum || `TM${tmId}`, name: packName, notes: `TmID ${tmId} - created on ${stamp} - ${t.TmNotes || ''}`.slice(0, 255), val: contractVal, u: user }, tx);

  // one PmMaterial per item (qty summed over the T&M's packs) with the item's default stage/work and prices
  const base = await nextId(tx, 'PmMaterial', 'PmMatID');
  const mats = await query(
    `INSERT INTO PmMaterial (PmMatID, PmPackId, InvItemId, Quantity, StageId, WorkId, NoChange, UnitCost, EstimatingPrice, StatusId, DateEntered, UserEntered)
     SELECT @base + ROW_NUMBER() OVER (ORDER BY q.InvItemId) - 1, @pack, q.InvItemId, q.Qty, q.DefaultStageId, q.DefaultWorkId, 0, q.JobCostPrice, q.EstimatingPrice, 1, GETDATE(), @u
       FROM (SELECT x.InvItemId, CAST(ROUND(SUM(x.Quantity),0) AS int) AS Qty, i.DefaultStageId, i.DefaultWorkId, i.JobCostPrice, i.EstimatingPrice
               FROM TmPOPack p JOIN TmPOMaterial x ON x.TmPackId = p.TmPackID JOIN IcItem i ON i.InvItemID = x.InvItemId
              WHERE p.TmId = @tm GROUP BY x.InvItemId, i.DefaultStageId, i.DefaultWorkId, i.JobCostPrice, i.EstimatingPrice) q;
     SELECT @@ROWCOUNT AS n`, { base, pack: pmPackId, tm: tmId, u: user }, tx);

  // schedule the pack on the lot
  const jpId = await nextId(tx, 'JsPack', 'PackID');
  await query(`INSERT INTO JsPack (PackID, LotId, PackTypeId, PmPackId, PackQty, PostedQty, PostedLaborQty, ContractEa, DateEntered, UserEntered) VALUES (@id, @lot, 7, @pm, 1, 0, 0, @val, GETDATE(), @u)`,
    { id: jpId, lot: t.LotId, pm: pmPackId, val: contractVal, u: user }, tx);

  // verify like qryTmProcess07ScheduleCheck, then approve (qryTmProcess08PostTM)
  const ok = await query('SELECT COUNT(*) AS n FROM JsPack WHERE LotId = @lot AND PmPackId = @pm', { lot: t.LotId, pm: pmPackId }, tx);
  if (!ok[0].n) throw bad('The T&M did not process properly. Try again.', 500);
  await query('UPDATE TmPO SET ApprovedDate = CAST(GETDATE() AS date), ApprovedBy = @u WHERE TmID = @id', { u: user, id: tmId }, tx);
  return { pmPackId, jsPackId: jpId, packName, materialLines: mats[0].n, contractVal };
}

router.post('/:id/process', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction((tx) => processTm(tx, id, req.user.username));
  res.json(out);
}));

// Duplicate TM (macro TmDuplicateTm): copy to another lot; optionally process & schedule it right away like Access does
router.post('/:id/duplicate', h(async (req, res) => {
  const id = int(req.params.id);
  const toLot = int(req.body?.lotId);
  if (!toLot) throw bad('Choose the lot that will receive the copy');
  const out = await withTransaction(async (tx) => {
    const src = await loadTm(id, tx);
    if (!src) throw bad('T&M not found', 404);
    if (src.tm.LotId === toLot) throw bad('The lot receiving the T&M is the same as the origin. Choose a different lot.');
    const lot = await assertLotOpen(tx, toLot);
    const ctx = await query('SELECT j.JobId, j.CustId FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId WHERE l.LotID = @id', { id: toLot }, tx);
    const s = src.tm;
    validateHeader({ TmName: s.TmName }, lot);
    const newId = await insertRow(TM, {
      TmDate: new Date().toISOString().slice(0, 10), TmCustomerNum: s.TmCustomerNum, TmName: s.TmName, TmNotes: s.TmNotes, CustomerId: ctx[0].CustId, JobId: ctx[0].JobId,
      LotId: toLot, PriceLevel: s.PriceLevel, PreparedBy: req.user.username, RequestedBy: s.RequestedBy, RequestorPhone: s.RequestorPhone, RequestorEmail: s.RequestorEmail,
      Discount: s.Discount, TaxRate: s.TaxRate, LaborRate: s.LaborRate, LaborRateFlat: s.LaborRateFlat, CreditCardFee: s.CreditCardFee, TmTypeId: s.TmTypeId, WorkId: s.WorkId,
      Budget: s.Budget, LaborHoursAdjusted: s.LaborHoursAdjusted,
    }, req.user.username, tx);
    for (const p of src.packs) {
      const np = await insertRow({ ...PACK, audit: false }, { TmId: newId, TmPackName: p.TmPackName, Price: p.Price, Notes: p.Notes }, req.user.username, tx);
      for (const m of p.materials) {
        await insertRow(MAT, { TmPackId: np, InvItemId: m.InvItemId, InvItem: m.InvItem, Quantity: m.Quantity, CostCode: m.CostCode, CostEa: m.CostEa, ManualCost: m.ManualCost, CostEaWMU: m.CostEaWMU, StageId: m.StageId, WorkId: m.WorkId, Notes: m.Notes }, req.user.username, tx);
      }
    }
    let processed = null;
    if (req.body?.process) processed = await processTm(tx, newId, req.user.username);
    return { id: newId, processed };
  });
  res.status(201).json(out);
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function rf(q) {
  const p = { from: isoDate(q.from), to: isoDate(q.to), div: q.division || null, by: q.preparedBy || null, cust: int(q.custId), sup: int(q.superId), type: q.kind || 'all' };
  const where = `WHERE (@from IS NULL OR t.TmDate >= @from) AND (@to IS NULL OR t.TmDate <= @to) AND (@div IS NULL OR j.DivisionId = @div)
    AND (@by IS NULL OR t.PreparedBy = @by) AND (@cust IS NULL OR t.CustomerId = @cust) AND (@sup IS NULL OR ph.SuperId1 = @sup)
    AND ISNULL(jt.JobType,'') NOT LIKE 'Test%' AND ISNULL(jt.JobType,'') NOT LIKE 'Template%'`;
  return { p, where };
}
const RFROM = `${WITH_TOTALS} JOIN JsJob j ON j.JobId = t.JobId LEFT JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId LEFT JOIN JsCustomer cu ON cu.CustID = t.CustomerId
  LEFT JOIN JsLot l ON l.LotID = t.LotId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId LEFT JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1
  LEFT JOIN LsTmType ty ON ty.TmTypeID = t.TmTypeId LEFT JOIN LsWork w ON w.WorkID = t.WorkId`;

const GROUPS = {
  user: { key: 't.PreparedBy', label: "ISNULL(t.PreparedBy,'(none)')" },
  customer: { key: 'cu.CustID', label: "ISNULL(MAX(cu.CustName),'(none)')" },
  job: { key: 'j.JobId', label: 'MAX(j.JobName)' },
  work: { key: 't.WorkId', label: "ISNULL(MAX(w.WorkType),'(none)')" },
  division: { key: 'j.DivisionId', label: "ISNULL(j.DivisionId,'(none)')" },
  super: { key: 'ph.SuperId1', label: "ISNULL(MAX(su.SuperName + ' ' + ISNULL(su.SuperType,'')),'(none)')" },
  month: { key: "FORMAT(t.TmDate,'yyyy-MM')", label: "FORMAT(t.TmDate,'yyyy-MM')" },
};

// Summary grouped by …  — status: all | paid | unpaid
router.get('/reports/summary', h(async (req, res) => {
  const g = GROUPS[req.query.groupBy] || GROUPS.user;
  const { p, where } = rf(req.query);
  const status = req.query.status || 'all';
  const rows = await query(
    `SELECT TOP 1000 ${g.key} AS GroupKey, ${g.label} AS GroupLabel, COUNT(*) AS Tms,
            SUM(c.Subtotal) AS Subtotal, SUM(-c.Subtotal * ISNULL(t.Discount,0)) AS DiscountAmt,
            SUM(CASE WHEN c.IsCredit = 1 THEN tax.Taxable * t.TaxRate WHEN tax.Taxable <= 0 THEN 0 ELSE tax.Taxable * t.TaxRate END) AS SalesTax,
            SUM(${GRAND}) AS Total,
            SUM(CASE WHEN t.PaidDate IS NULL THEN ${GRAND} ELSE 0 END) AS Unpaid, SUM(CASE WHEN t.PaidDate IS NOT NULL THEN ${GRAND} ELSE 0 END) AS Paid
       ${RFROM} ${where} AND (@kind = 'all' OR (@kind = 'unpaid' AND t.PaidDate IS NULL AND ty.Contracted = 1) OR (@kind = 'paid' AND t.PaidDate IS NOT NULL) OR (@kind = 'quotes' AND ty.Contracted = 0))
      GROUP BY ${g.key} ORDER BY Total DESC`, { ...p, kind: status });
  const totals = rows.reduce((a, r) => ({ Tms: a.Tms + r.Tms, Total: a.Total + (r.Total || 0), Unpaid: a.Unpaid + (r.Unpaid || 0), Paid: a.Paid + (r.Paid || 0) }), { Tms: 0, Total: 0, Unpaid: 0, Paid: 0 });
  res.json({ rows, totals, groupBy: req.query.groupBy || 'user' });
}));

// Detail list for the reports: kind = unpaid | quotes | no-customer-po | all
router.get('/reports/detail', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const { p, where } = rf(req.query);
  const kind = req.query.kind || 'all';
  const extra = { unpaid: 'AND ty.Contracted = 1 AND t.PaidDate IS NULL', quotes: 'AND ty.Contracted = 0 AND t.PaidDate IS NULL',
    'no-customer-po': 'AND ty.Contracted = 1 AND t.TmCustomerNum IS NULL AND t.PaidDate IS NULL', all: '' }[kind] ?? '';
  const [rows, total, sum] = await Promise.all([
    query(`SELECT t.TmID, t.TmDate, t.TmName, t.TmCustomerNum, ty.TmType, t.PreparedBy, t.RequestedBy, t.RequestorPhone, t.ApprovedDate, t.PaidDate, cu.CustName, j.JobName, j.DivisionId,
                  l.Lot, l.Block, su.SuperName, ${CALC}, ${GRAND} AS Total
             ${RFROM} ${where} ${extra} ORDER BY t.TmDate DESC, t.TmID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, { ...p, offset: pg.offset, pageSize: pg.pageSize }),
    query(`SELECT COUNT(*) AS n ${RFROM} ${where} ${extra}`, p),
    query(`SELECT SUM(${GRAND}) AS total ${RFROM} ${where} ${extra}`, p),
  ]);
  res.json({ rows, total: total[0].n, amount: sum[0].total, page: pg.page, pageSize: pg.pageSize, kind });
}));

// Pick ticket: materials only (macro TmPickTicket)
router.get('/:id/pick-ticket', h(async (req, res) => {
  const id = int(req.params.id);
  const [head, rows] = await Promise.all([
    query(`SELECT t.TmID, t.TmDate, t.TmName, t.PreparedBy, cu.CustName, j.JobName, l.Lot, l.Block, l.Address, l.City FROM TmPO t JOIN JsJob j ON j.JobId = t.JobId
             LEFT JOIN JsCustomer cu ON cu.CustID = t.CustomerId LEFT JOIN JsLot l ON l.LotID = t.LotId WHERE t.TmID = @id`, { id }),
    query(`SELECT p.TmPackName, p.Notes AS PackNotes, x.CostCode, i.InvItem, i.Description, x.Notes AS LineNotes, SUM(x.Quantity) AS Qty
             FROM TmPOPack p JOIN TmPOMaterial x ON x.TmPackId = p.TmPackID JOIN IcItem i ON i.InvItemID = x.InvItemId
            WHERE p.TmId = @id AND x.CostCode <> 'L' GROUP BY p.TmPackName, p.Notes, x.CostCode, i.InvItem, i.Description, x.Notes ORDER BY p.TmPackName, i.InvItem`, { id }),
  ]);
  if (!head[0]) return res.status(404).json({ error: 'T&M not found' });
  res.json({ head: head[0], rows });
}));

module.exports = router;
