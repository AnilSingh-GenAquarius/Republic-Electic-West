// Purchasing (PO) — mirrors the Access SwitchPO screens: purchase orders (PurchaseOrder), "Post purchase order" (macro IcPo),
// receiving (PoReceive), billing (PoBilling), pack POs (PoPack + macro IcPoPack) and the PO reports.
//
//   PO totals (as Access): ExtCost = Σ qty × cost (cost 0 = average cost) · tax % = PO tax rate, else the ship-to company tax
//   · tax $ = Σ taxable lines (cost code NT is not taxed) × tax % · total = ExtCost + tax + shipping.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null ? null : Number(v));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const par = (tx, fns) => (tx ? fns.reduce((p, f) => p.then(async (a) => [...a, await f()]), Promise.resolve([])) : Promise.all(fns.map((f) => f())));
const dollars = (v) => `$${Number(v || 0).toFixed(2)}`;                 // money stored as text in IcPo.PoTax / PoShipping
const SHIP = (col) => `ISNULL(TRY_CAST(REPLACE(REPLACE(${col},'$',''),',','') AS decimal(18,2)),0)`;

// Per-PO totals
const TOTALS = `
  SELECT p.PoNum, ISNULL(x.Ext,0) AS ExtCost, ISNULL(x.Taxable,0) AS Taxable,
         CASE WHEN ISNULL(p.PoTaxRate,0) = 0 THEN ISNULL(co.Tax,0) ELSE p.PoTaxRate END AS TaxRate
    FROM IcPo p LEFT JOIN LsCompany co ON co.CompanyID = p.ShipToId
    OUTER APPLY (SELECT SUM(l.Quantity * CASE WHEN ISNULL(l.Cost,0) = 0 THEN ISNULL(i.AverageCost,0) ELSE l.Cost END) AS Ext,
                        SUM(CASE WHEN i.CostCodeId <> 'NT' THEN l.Quantity * CASE WHEN ISNULL(l.Cost,0) = 0 THEN ISNULL(i.AverageCost,0) ELSE l.Cost END ELSE 0 END) AS Taxable
                   FROM IcPoItem l JOIN IcItem i ON i.InvItemID = l.InvItemId WHERE l.PoNum = p.PoNum) x`;
const WITH_TOT = `FROM IcPo p JOIN (${TOTALS}) t ON t.PoNum = p.PoNum`;
const TAXAMT = 'ROUND(t.Taxable * t.TaxRate / 100, 2)';

function finish(r) {
  const ship = Number(r.Shipping || 0);
  const total = Number(r.ExtCost || 0) + Number(r.TaxAmt || 0) + ship;
  return { ...r, Total: Math.round(total * 100) / 100 };
}

router.get('/lookups', h(async (req, res) => {
  const [companies, terms, divisions] = await Promise.all([
    query('SELECT CompanyID AS id, Company + \' (\' + ISNULL(DivisionId,\'\') + \')\' AS name, DivisionId, Tax, StatusId FROM LsCompany ORDER BY Company, DivisionId'),
    query('SELECT Terms AS id, Terms AS name, Days FROM LsTerms ORDER BY Days, Terms'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
  ]);
  res.json({ companies, terms, divisions });
}));

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
router.get('/overview', h(async (req, res) => {
  const [open, recent, backorder] = await Promise.all([
    query(`SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM IcPo e WHERE e.DateClosed IS NULL AND NOT EXISTS (SELECT 1 FROM IcPoItem l WHERE l.PoNum = e.PoNum)) AS empty FROM IcPo p WHERE p.DateClosed IS NULL`),
    query(`SELECT TOP 8 p.PoNum, p.PoDate, v.Vendor, p.DateClosed FROM IcPo p JOIN IcVendor v ON v.VendorID = p.VendorId ORDER BY p.PoNum DESC`),
    query(`SELECT COUNT(*) AS lines FROM IcPoItem l JOIN IcPo p ON p.PoNum = l.PoNum
            WHERE p.DateClosed IS NULL AND l.Quantity > ISNULL((SELECT SUM(r.ReceivedQty) FROM IcPoItemRec r WHERE r.PoItemId = l.PoItemID),0)`),
  ]);
  const [notBilled, packs] = await Promise.all([
    query(`SELECT COUNT(*) AS lines FROM IcPoItem l JOIN IcPo p ON p.PoNum = l.PoNum
            WHERE ISNULL((SELECT SUM(r.ReceivedQty) FROM IcPoItemRec r WHERE r.PoItemId = l.PoItemID),0) > ISNULL((SELECT SUM(b.BilledQty) FROM IcPoItemBill b WHERE b.PoItemId = l.PoItemID),0)`),
    query(`SELECT COUNT(*) AS n, SUM(CASE WHEN PoConversionDate IS NULL THEN 1 ELSE 0 END) AS unconverted FROM IcPackPo`),
  ]);
  res.json({ open: open[0], recent, backOrderedLines: backorder[0].lines, notBilledLines: notBilled[0].lines, packs: packs[0] });
}));

router.get('/orders', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, vendor: int(req.query.vendorId), div: req.query.division || null, from: isoDate(req.query.from), to: isoDate(req.query.to),
    status: req.query.status || 'all', offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR v.Vendor LIKE @s OR CAST(p.PoNum AS varchar(20)) LIKE @s OR p.Notes LIKE @s) AND (@vendor IS NULL OR p.VendorId = @vendor) AND (@div IS NULL OR co.DivisionId = @div)
    AND (@from IS NULL OR p.PoDate >= @from) AND (@to IS NULL OR p.PoDate <= @to)
    AND (@status = 'all' OR (@status = 'open' AND p.DateClosed IS NULL) OR (@status = 'closed' AND p.DateClosed IS NOT NULL))`;
  const from = `${WITH_TOT} JOIN IcVendor v ON v.VendorID = p.VendorId LEFT JOIN LsCompany co ON co.CompanyID = p.ShipToId`;
  const [rows, total, sum] = await Promise.all([
    query(`SELECT p.PoNum, p.PoDate, p.DateClosed, p.PoPackNum, v.Vendor, co.DivisionId, co.Company AS ShipTo, p.PayTerms, p.UserEntered, t.ExtCost, ${TAXAMT} AS TaxAmt, ${SHIP('p.PoShipping')} AS Shipping,
                  (SELECT COUNT(*) FROM IcPoItem l WHERE l.PoNum = p.PoNum) AS Lines,
                  (SELECT COUNT(*) FROM IcPoItem l CROSS APPLY (SELECT ISNULL(SUM(r.ReceivedQty),0) AS got FROM IcPoItemRec r WHERE r.PoItemId = l.PoItemID) x WHERE l.PoNum = p.PoNum AND l.Quantity <= x.got) AS LinesReceived
             ${from} ${where} ORDER BY p.PoNum DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from} ${where}`, p),
    query(`SELECT SUM(t.ExtCost + ${TAXAMT} + ${SHIP('p.PoShipping')}) AS amount, SUM(CASE WHEN p.DateClosed IS NULL THEN 1 ELSE 0 END) AS openCount ${from} ${where}`, p),
  ]);
  res.json({ rows: rows.map(finish), total: total[0].n, page: pg.page, pageSize: pg.pageSize, summary: sum[0] });
}));

async function loadPo(id, tx) {
  const head = await query(
    `SELECT p.*, v.Vendor, v.Phone AS VendorPhone, v.FreeShipping, v.PayTerms AS VendorTerms, bt.Company AS BillTo, bt.BillAddress, bt.BillCity, bt.BillState, bt.BillZip, bt.BillPhone,
            st.Company AS ShipTo, st.DivisionId, st.Address AS ShipAddress, st.City AS ShipCity, st.State AS ShipState, st.Zip AS ShipZip,
            t.ExtCost, t.Taxable, t.TaxRate, ${TAXAMT} AS TaxAmt, ${SHIP('p.PoShipping')} AS Shipping
       ${WITH_TOT} JOIN IcVendor v ON v.VendorID = p.VendorId LEFT JOIN LsCompany bt ON bt.CompanyID = p.BillToId LEFT JOIN LsCompany st ON st.CompanyID = p.ShipToId
      WHERE p.PoNum = @id`, { id }, tx);
  if (!head[0]) return null;
  const lines = await query(
    `SELECT l.PoItemID, l.InvItemId, i.InvItem, i.Description, i.AlternateCode, i.Uom, i.CostCodeId, l.Quantity, l.Cost, i.LastCost, i.AverageCost,
            CASE WHEN ISNULL(l.Cost,0) = 0 THEN ISNULL(i.AverageCost,0) ELSE l.Cost END AS EffCost,
            l.Quantity * CASE WHEN ISNULL(l.Cost,0) = 0 THEN ISNULL(i.AverageCost,0) ELSE l.Cost END AS ExtCost, l.Notes,
            ISNULL((SELECT SUM(r.ReceivedQty) FROM IcPoItemRec r WHERE r.PoItemId = l.PoItemID),0) AS Received,
            ISNULL((SELECT SUM(b.BilledQty) FROM IcPoItemBill b WHERE b.PoItemId = l.PoItemID),0) AS Billed,
            (SELECT TOP 1 vi.DefaultPrice FROM IcVendorItem vi WHERE vi.InvItemId = l.InvItemId AND vi.VendorId = @vendor) AS VendorPrice
       FROM IcPoItem l JOIN IcItem i ON i.InvItemID = l.InvItemId WHERE l.PoNum = @id ORDER BY l.PoItemID`, { id, vendor: head[0].VendorId }, tx);
  const [recs, bills] = await Promise.all([
    query(`SELECT r.PoItemRecID, r.PoItemId, i.InvItem, r.ReceivedQty, r.ReceivedDate, r.IcTransacPostedDate, r.UserEntered FROM IcPoItemRec r JOIN IcPoItem l ON l.PoItemID = r.PoItemId JOIN IcItem i ON i.InvItemID = l.InvItemId WHERE l.PoNum = @id ORDER BY r.PoItemRecID DESC`, { id }, tx),
    query(`SELECT b.PoItemBillID, b.PoItemId, i.InvItem, b.BilledQty, b.BilledDate, b.UserEntered FROM IcPoItemBill b JOIN IcPoItem l ON l.PoItemID = b.PoItemId JOIN IcItem i ON i.InvItemID = l.InvItemId WHERE l.PoNum = @id ORDER BY b.PoItemBillID DESC`, { id }, tx),
  ]);
  return { po: finish(head[0]), lines, receipts: recs, bills };
}

router.get('/orders/:id', h(async (req, res) => {
  const d = await loadPo(int(req.params.id));
  if (!d) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(d);
}));

const PO = { table: 'IcPo', idCol: 'PoNum', columns: ['VendorId', 'BillToId', 'ShipToId', 'PayTerms', 'PoDate', 'PoTaxRate', 'PoTax', 'PoShipping', 'Notes', 'DateClosed', 'PoPackNum'] };
function poBody(b) {
  const o = {};
  for (const k of ['PayTerms', 'Notes']) if (k in b) o[k] = b[k] || null;
  for (const k of ['VendorId', 'BillToId', 'ShipToId']) if (k in b) o[k] = int(b[k]);
  if ('PoDate' in b) { o.PoDate = isoDate(b.PoDate); if (!o.PoDate) throw bad('Enter the PO date'); }
  if ('PoTaxRate' in b) { o.PoTaxRate = num(b.PoTaxRate) ?? 0; if (o.PoTaxRate < 0 || o.PoTaxRate > 25) throw bad('Tax rate is a percent between 0 and 25 (use 0 for the ship-to company rate)'); }
  if ('PoShipping' in b) { const s = num(b.PoShipping) ?? 0; if (isNaN(s) || s < 0) throw bad('Shipping must be 0 or more'); o.PoShipping = dollars(s); }
  return o;
}

router.post('/orders', h(async (req, res) => {
  const b = req.body || {};
  const o = poBody(b);
  if (!o.VendorId) throw bad('Choose a vendor');
  const id = await withTransaction(async (tx) => {
    const v = await query('SELECT VendorID, PayTerms, StatusId FROM IcVendor WHERE VendorID = @id', { id: o.VendorId }, tx);
    if (!v[0]) throw bad('Vendor not found', 404);
    return insertRow(PO, { ShipToId: 2, BillToId: o.ShipToId ?? 2, PayTerms: v[0].PayTerms, PoDate: new Date().toISOString().slice(0, 10), PoTaxRate: 0, PoTax: '$0.00', PoShipping: '$0.00', ...o, PoPackNum: null, DateClosed: null }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/orders/:id', h(async (req, res) => {
  const id = int(req.params.id), o = poBody(req.body || {});
  delete o.PoPackNum; delete o.DateClosed;
  const n = await updateRow(PO, id, o);
  if (!n) return res.status(404).json({ error: 'Purchase order not found' });
  res.json({ ok: true });
}));
router.delete('/orders/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const u = await query(`SELECT (SELECT COUNT(*) FROM IcPoItemRec r JOIN IcPoItem l ON l.PoItemID = r.PoItemId WHERE l.PoNum = @id) rec, (SELECT COUNT(*) FROM IcPoItemBill b JOIN IcPoItem l ON l.PoItemID = b.PoItemId WHERE l.PoNum = @id) bill,
      (SELECT COUNT(*) FROM IcPo WHERE PoNum = @id) ex`, { id }, tx);
    if (!u[0].ex) throw bad('Purchase order not found', 404);
    if (u[0].rec || u[0].bill) throw bad('This purchase order has receipts or billing and cannot be deleted. Close it instead.', 409);
    await query('DELETE FROM IcPoItem WHERE PoNum = @id', { id }, tx);
    await deleteRow(PO, id, tx);
  });
  res.json({ ok: true });
}));
router.post('/orders/:id/close', h(async (req, res) => { await query('UPDATE IcPo SET DateClosed = CAST(GETDATE() AS date) WHERE PoNum = @id AND DateClosed IS NULL', { id: int(req.params.id) }); res.json({ ok: true }); }));
router.post('/orders/:id/reopen', h(async (req, res) => { await query('UPDATE IcPo SET DateClosed = NULL WHERE PoNum = @id', { id: int(req.params.id) }); res.json({ ok: true }); }));

// ---- lines ----
const LINE = { table: 'IcPoItem', idCol: 'PoItemID', columns: ['PoNum', 'InvItemId', 'Quantity', 'Cost', 'NewReceived', 'NewBilled', 'Notes'] };
async function openPo(tx, poNum) {
  const p = await query('SELECT PoNum, VendorId, DateClosed FROM IcPo WHERE PoNum = @id', { id: poNum }, tx);
  if (!p[0]) throw bad('Purchase order not found', 404);
  if (p[0].DateClosed) throw bad('This purchase order is closed. Reopen it to change it.', 409);
  return p[0];
}
router.post('/orders/:id/lines', h(async (req, res) => {
  const poNum = int(req.params.id), b = req.body || {};
  const qty = int(b.Quantity);
  if (!qty || qty < 1 || qty > 10000000) throw bad('Enter a quantity (a whole number above 0)');
  const cost = b.Cost === '' || b.Cost == null ? null : num(b.Cost);
  if (cost != null && (isNaN(cost) || cost < 0)) throw bad('Cost must be 0 or more');
  const id = await withTransaction(async (tx) => {
    const po = await openPo(tx, poNum);
    const it = await query('SELECT InvItemID, LastCost, AverageCost FROM IcItem WHERE InvItemID = @i', { i: int(b.InvItemId) }, tx);
    if (!it[0]) throw bad('Choose an item');
    const dup = await query('SELECT 1 AS x FROM IcPoItem WHERE PoNum = @p AND InvItemId = @i', { p: poNum, i: it[0].InvItemID }, tx);
    if (dup.length) throw bad('That item is already on the PO. Change its quantity instead.', 409);
    // default cost: vendor price → last cost → average cost (Access leaves 0 and fills it when the PO is posted)
    let c = cost;
    if (c == null) {
      const vp = await query('SELECT TOP 1 DefaultPrice FROM IcVendorItem WHERE InvItemId = @i AND VendorId = @v AND DefaultPrice > 0', { i: it[0].InvItemID, v: po.VendorId }, tx);
      c = vp[0]?.DefaultPrice ?? (Number(it[0].LastCost) ? it[0].LastCost : it[0].AverageCost) ?? 0;
    }
    return insertRow(LINE, { PoNum: poNum, InvItemId: it[0].InvItemID, Quantity: qty, Cost: c, NewReceived: 0, NewBilled: 0, Notes: b.Notes || null }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/lines/:lineId', h(async (req, res) => {
  const id = int(req.params.lineId), b = req.body || {};
  const cur = await query('SELECT PoNum FROM IcPoItem WHERE PoItemID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  await withTransaction(async (tx) => {
    await openPo(tx, cur[0].PoNum);
    const o = {};
    if ('Quantity' in b) { const q = int(b.Quantity); if (!q || q < 1) throw bad('Enter a quantity (a whole number above 0)'); const rec = await query('SELECT ISNULL(SUM(ReceivedQty),0) AS r FROM IcPoItemRec WHERE PoItemId = @id', { id }, tx); if (q < rec[0].r) throw bad(`${rec[0].r} have already been received, so the quantity cannot go below that.`, 409); o.Quantity = q; }
    if ('Cost' in b) { const c = num(b.Cost); if (c == null || isNaN(c) || c < 0) throw bad('Cost must be 0 or more'); o.Cost = c; }
    if ('Notes' in b) o.Notes = b.Notes || null;
    await updateRow(LINE, id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/lines/:lineId', h(async (req, res) => {
  const id = int(req.params.lineId);
  const cur = await query('SELECT PoNum FROM IcPoItem WHERE PoItemID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  await withTransaction(async (tx) => {
    await openPo(tx, cur[0].PoNum);
    const u = await query('SELECT (SELECT COUNT(*) FROM IcPoItemRec WHERE PoItemId=@id) r, (SELECT COUNT(*) FROM IcPoItemBill WHERE PoItemId=@id) b', { id }, tx);
    if (u[0].r || u[0].b) throw bad('This line has receipts or billing and cannot be removed.', 409);
    await deleteRow(LINE, id, tx);
  });
  res.json({ ok: true });
}));

// ---- "Post purchase order": the steps of macro IcPo, for one PO or all POs of a pack PO ----
async function postPo(tx, where, params) {
  // 1. cost 0 -> last cost, else average cost
  await query(`UPDATE l SET l.Cost = CASE WHEN ISNULL(i.LastCost,0) = 0 THEN ISNULL(i.AverageCost,0) ELSE i.LastCost END FROM IcPoItem l JOIN IcPo p ON p.PoNum = l.PoNum JOIN IcItem i ON i.InvItemID = l.InvItemId WHERE ISNULL(l.Cost,0) = 0 AND ${where}`, params, tx);
  // 2. item last cost + last purchase date
  await query(`UPDATE i SET i.LastCost = l.Cost, i.LastPurchase = p.PoDate FROM IcItem i JOIN IcPoItem l ON l.InvItemId = i.InvItemID JOIN IcPo p ON p.PoNum = l.PoNum WHERE l.Cost > 0 AND ${where}`, params, tx);
  // 3-4. tax % and tax $ on the PO
  await query(`UPDATE p SET p.PoTaxRate = t.TaxRate, p.PoTax = '$' + CAST(CAST(ROUND(t.Taxable * t.TaxRate / 100, 2) AS decimal(18,2)) AS varchar(30)) FROM IcPo p JOIN (${TOTALS}) t ON t.PoNum = p.PoNum WHERE ${where}`, params, tx);
  // 5. average cost = Σ qty×cost / Σ qty over the item's PO lines of the last 365 days
  await query(`UPDATE i SET i.AverageCost = a.avg FROM IcItem i
     JOIN (SELECT l2.InvItemId, SUM(l2.Quantity * l2.Cost) / NULLIF(SUM(l2.Quantity),0) AS avg FROM IcPoItem l2 JOIN IcPo p2 ON p2.PoNum = l2.PoNum
            WHERE p2.PoDate > DATEADD(day,-365,CAST(GETDATE() AS date)) AND l2.InvItemId IN (SELECT l.InvItemId FROM IcPoItem l JOIN IcPo p ON p.PoNum = l.PoNum WHERE ${where}) GROUP BY l2.InvItemId) a ON a.InvItemId = i.InvItemID
     WHERE a.avg IS NOT NULL`, params, tx);
  // 6. automatic job cost price (update type 1)
  await query(`UPDATE i SET i.JobCostPrice = CASE WHEN i.CostCodeId = 'L' THEN i.LaborCost ELSE i.AverageCost END FROM IcItem i JOIN IcPoItem l ON l.InvItemId = i.InvItemID JOIN IcPo p ON p.PoNum = l.PoNum WHERE i.JobCostPriceUpdateId = 1 AND ${where}`, params, tx);
  // 7. selling prices from job cost × mark-ups
  const r = await query(`UPDATE i SET i.VipPrice = i.JobCostPrice * (ISNULL(i.VipPriceMkUp,0)/100.0 + 1), i.ResidentialPoPrice = i.JobCostPrice * (ISNULL(i.ResidentialPoPriceMkUp,0)/100.0 + 1), i.RetailPrice = i.JobCostPrice * (ISNULL(i.RetailPriceMkUp,0)/100.0 + 1)
     FROM IcItem i JOIN IcPoItem l ON l.InvItemId = i.InvItemID JOIN IcPo p ON p.PoNum = l.PoNum WHERE ${where}; SELECT @@ROWCOUNT AS n`, params, tx);
  return { itemsRepriced: r[0].n };
}
router.post('/orders/:id/post', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    const po = await openPo(tx, id);
    const n = await query('SELECT COUNT(*) AS n FROM IcPoItem WHERE PoNum = @id', { id }, tx);
    if (!n[0].n) throw bad('Add at least one item before posting the purchase order.');
    const r = await postPo(tx, 'p.PoNum = @po', { po: id });
    return { ...r, vendorId: po.VendorId };
  });
  const d = await loadPo(id);
  res.json({ ...out, po: d.po });
}));

// ---- receiving ----
const REC = { table: 'IcPoItemRec', idCol: 'PoItemRecID', columns: ['PoItemId', 'ReceivedQty', 'PostedQty', 'ReceivedDate'] };
router.post('/lines/:lineId/receive', h(async (req, res) => {
  const lineId = int(req.params.lineId), b = req.body || {};
  const qty = int(b.ReceivedQty);
  if (!qty || qty < 1) throw bad('Enter the received quantity (a whole number above 0)');
  const date = isoDate(b.ReceivedDate) || new Date().toISOString().slice(0, 10);
  const out = await withTransaction(async (tx) => {
    const l = await query('SELECT l.PoItemID, l.PoNum, l.Quantity, (SELECT ISNULL(SUM(ReceivedQty),0) FROM IcPoItemRec WHERE PoItemId = l.PoItemID) AS rec FROM IcPoItem l WHERE l.PoItemID = @id', { id: lineId }, tx);
    if (!l[0]) throw bad('Line not found', 404);
    const id = await insertRow(REC, { PoItemId: lineId, ReceivedQty: qty, PostedQty: 0, ReceivedDate: date }, req.user.username, tx);
    return { id, overage: Math.max(0, l[0].rec + qty - l[0].Quantity), balance: Math.max(0, l[0].Quantity - l[0].rec - qty) };
  });
  res.status(201).json(out);
}));
router.post('/orders/:id/receive-all', h(async (req, res) => {
  const id = int(req.params.id), date = isoDate(req.body?.ReceivedDate) || new Date().toISOString().slice(0, 10);
  const out = await withTransaction(async (tx) => {
    await openPo(tx, id);
    const lines = await query('SELECT l.PoItemID, l.Quantity - ISNULL((SELECT SUM(ReceivedQty) FROM IcPoItemRec WHERE PoItemId = l.PoItemID),0) AS bal FROM IcPoItem l WHERE l.PoNum = @id', { id }, tx);
    let n = 0;
    for (const l of lines) if (l.bal > 0) { await insertRow(REC, { PoItemId: l.PoItemID, ReceivedQty: l.bal, PostedQty: 0, ReceivedDate: date }, req.user.username, tx); n++; }
    return { received: n };
  });
  res.json(out);
}));
router.delete('/receipts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const r = await query('SELECT IcTransacPostedDate FROM IcPoItemRec WHERE PoItemRecID = @id', { id });
  if (!r[0]) return res.status(404).json({ error: 'Receipt not found' });
  if (r[0].IcTransacPostedDate) throw bad('This receipt has been posted to inventory and cannot be deleted.', 409);
  await deleteRow(REC, id); res.json({ ok: true });
}));

// ---- billing ----
const BILL = { table: 'IcPoItemBill', idCol: 'PoItemBillID', columns: ['PoItemId', 'BilledQty', 'BilledDate'] };
router.post('/lines/:lineId/bill', h(async (req, res) => {
  const lineId = int(req.params.lineId), b = req.body || {};
  const qty = int(b.BilledQty);
  if (!qty || qty < 1) throw bad('Enter the billed quantity (a whole number above 0)');
  const date = isoDate(b.BilledDate) || new Date().toISOString().slice(0, 10);
  const id = await withTransaction(async (tx) => {
    const l = await query('SELECT PoItemID FROM IcPoItem WHERE PoItemID = @id', { id: lineId }, tx);
    if (!l[0]) throw bad('Line not found', 404);
    return insertRow(BILL, { PoItemId: lineId, BilledQty: qty, BilledDate: date }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.post('/orders/:id/bill-received', h(async (req, res) => {
  const id = int(req.params.id), date = isoDate(req.body?.BilledDate) || new Date().toISOString().slice(0, 10);
  const out = await withTransaction(async (tx) => {
    const lines = await query(`SELECT l.PoItemID, ISNULL((SELECT SUM(ReceivedQty) FROM IcPoItemRec WHERE PoItemId = l.PoItemID),0) - ISNULL((SELECT SUM(BilledQty) FROM IcPoItemBill WHERE PoItemId = l.PoItemID),0) AS bal FROM IcPoItem l WHERE l.PoNum = @id`, { id }, tx);
    let n = 0;
    for (const l of lines) if (l.bal > 0) { await insertRow(BILL, { PoItemId: l.PoItemID, BilledQty: l.bal, BilledDate: date }, req.user.username, tx); n++; }
    return { billed: n };
  });
  res.json(out);
}));
router.delete('/bills/:id', h(async (req, res) => { await deleteRow(BILL, int(req.params.id)); res.json({ ok: true }); }));

// ---------------------------------------------------------------------------
// Pack POs (IcPackPo / IcPackPoItem) — convert to a regular PO of the pack's package items
// ---------------------------------------------------------------------------
const PPO = { table: 'IcPackPo', idCol: 'PoPackNum', columns: ['PoNumLink', 'VendorId', 'BillToId', 'ShipToId', 'PayTerms', 'PoDate', 'CustId', 'JobId', 'LotId', 'PmPackId', 'PoTaxRate', 'PoTax', 'PoShipping', 'PoConversionDate', 'Notes'] };
const PPOI = { table: 'IcPackPoItem', idCol: 'PoPackItemID', columns: ['PoPackNum', 'CustId', 'JobId', 'LotId', 'PmPackId', 'Quantity', 'Cost', 'Notes'] };

router.get('/packs', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, st: req.query.status || 'all', offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR v.Vendor LIKE @s OR CAST(k.PoPackNum AS varchar(20)) LIKE @s OR j.JobName LIKE @s) AND (@st = 'all' OR (@st = 'open' AND k.PoConversionDate IS NULL) OR (@st = 'converted' AND k.PoConversionDate IS NOT NULL))`;
  const from = `FROM IcPackPo k JOIN IcVendor v ON v.VendorID = k.VendorId LEFT JOIN JsJob j ON j.JobId = k.JobId LEFT JOIN JsCustomer c ON c.CustID = k.CustId`;
  const [rows, total] = await Promise.all([
    query(`SELECT k.PoPackNum, k.PoNumLink, k.PoDate, k.PoConversionDate, v.Vendor, c.CustName, j.JobName, k.UserEntered,
                  (SELECT COUNT(*) FROM IcPackPoItem x WHERE x.PoPackNum = k.PoPackNum) AS Lines, (SELECT SUM(x.Quantity * x.Cost) FROM IcPackPoItem x WHERE x.PoPackNum = k.PoPackNum) AS ExtCost
             ${from} ${where} ORDER BY k.PoPackNum DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from} ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [head, items] = await Promise.all([
    query(`SELECT k.*, v.Vendor, c.CustName, j.JobName, bt.Company AS BillTo, st.Company AS ShipTo FROM IcPackPo k JOIN IcVendor v ON v.VendorID = k.VendorId LEFT JOIN JsJob j ON j.JobId = k.JobId LEFT JOIN JsCustomer c ON c.CustID = k.CustId
             LEFT JOIN LsCompany bt ON bt.CompanyID = k.BillToId LEFT JOIN LsCompany st ON st.CompanyID = k.ShipToId WHERE k.PoPackNum = @id`, { id }),
    query(`SELECT x.PoPackItemID, x.LotId, x.PmPackId, x.Quantity, x.Cost, x.Quantity * x.Cost AS ExtCost, x.Notes, l.Lot, l.Block, l.Address, j.JobName, pk.PackName, pk.BuilderCode,
                  (SELECT COUNT(*) FROM PmMaterial m JOIN IcItem i ON i.InvItemID = m.InvItemId WHERE m.PmPackId = x.PmPackId AND i.PackageItem = 1) AS PackageItems
             FROM IcPackPoItem x LEFT JOIN JsLot l ON l.LotID = x.LotId LEFT JOIN JsJob j ON j.JobId = x.JobId LEFT JOIN PmPack pk ON pk.PmPackID = x.PmPackId WHERE x.PoPackNum = @id ORDER BY x.PoPackItemID`, { id }),
  ]);
  if (!head[0]) return res.status(404).json({ error: 'Pack PO not found' });
  let linkedPo = null;
  if (head[0].PoNumLink) linkedPo = (await loadPo(head[0].PoNumLink))?.po || null;
  res.json({ pack: head[0], items, linkedPo });
}));
router.post('/packs', h(async (req, res) => {
  const b = req.body || {};
  if (!int(b.VendorId)) throw bad('Choose a vendor');
  const id = await withTransaction(async (tx) => {
    const v = await query('SELECT PayTerms FROM IcVendor WHERE VendorID = @id', { id: int(b.VendorId) }, tx);
    if (!v[0]) throw bad('Vendor not found', 404);
    const co = await query('SELECT Tax FROM LsCompany WHERE CompanyID = @id', { id: int(b.ShipToId) || 2 }, tx);
    return insertRow(PPO, { VendorId: int(b.VendorId), BillToId: int(b.BillToId) || 2, ShipToId: int(b.ShipToId) || 2, PayTerms: b.PayTerms || v[0].PayTerms, PoDate: isoDate(b.PoDate) || new Date().toISOString().slice(0, 10),
      CustId: int(b.CustId), JobId: int(b.JobId), PoTaxRate: co[0]?.Tax ?? 0, PoTax: '$0.00', PoShipping: dollars(num(b.PoShipping) || 0), Notes: b.Notes || null }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const cur = await query('SELECT PoConversionDate FROM IcPackPo WHERE PoPackNum = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Pack PO not found' });
  if (cur[0].PoConversionDate) throw bad('This pack PO has already been converted and cannot change.', 409);
  const o = {};
  for (const k of ['PayTerms', 'Notes']) if (k in b) o[k] = b[k] || null;
  for (const k of ['VendorId', 'BillToId', 'ShipToId', 'CustId', 'JobId']) if (k in b) o[k] = int(b[k]);
  if ('PoDate' in b) o.PoDate = isoDate(b.PoDate);
  if ('PoTaxRate' in b) o.PoTaxRate = num(b.PoTaxRate) ?? 0;
  if ('PoShipping' in b) o.PoShipping = dollars(num(b.PoShipping) || 0);
  await updateRow(PPO, id, o); res.json({ ok: true });
}));
router.delete('/packs/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await query('SELECT PoConversionDate FROM IcPackPo WHERE PoPackNum = @id', { id }, tx);
    if (!cur[0]) throw bad('Pack PO not found', 404);
    if (cur[0].PoConversionDate) throw bad('A converted pack PO cannot be deleted.', 409);
    await query('DELETE FROM IcPackPoItem WHERE PoPackNum = @id', { id }, tx); await deleteRow(PPO, id, tx);
  });
  res.json({ ok: true });
}));
router.post('/packs/:id/items', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const qty = int(b.Quantity ?? 1);
  if (!qty || qty < 1) throw bad('Enter a quantity (a whole number above 0)');
  const out = await withTransaction(async (tx) => {
    const k = await query('SELECT PoPackNum, PoConversionDate FROM IcPackPo WHERE PoPackNum = @id', { id }, tx);
    if (!k[0]) throw bad('Pack PO not found', 404);
    if (k[0].PoConversionDate) throw bad('This pack PO has already been converted.', 409);
    const x = await query(`SELECT jp.PmPackId, l.LotID, l.JobId, j.CustId FROM JsPack jp JOIN JsLot l ON l.LotID = jp.LotId JOIN JsJob j ON j.JobId = l.JobId WHERE jp.PackID = @pk AND l.LotID = @lot`, { pk: int(b.PackId), lot: int(b.LotId) }, tx);
    if (!x[0]) throw bad('Choose a lot and one of its scheduled packs');
    const dup = await query('SELECT 1 AS x FROM IcPackPoItem WHERE PoPackNum = @id AND LotId = @lot AND PmPackId = @pm', { id, lot: x[0].LotID, pm: x[0].PmPackId }, tx);
    if (dup.length) throw bad('That lot and pack are already on this pack PO.', 409);
    return insertRow(PPOI, { PoPackNum: id, CustId: x[0].CustId, JobId: x[0].JobId, LotId: x[0].LotID, PmPackId: x[0].PmPackId, Quantity: qty, Cost: num(b.Cost) ?? 0, Notes: b.Notes || null }, req.user.username, tx);
  });
  res.status(201).json({ id: out });
}));
router.put('/pack-items/:iid', h(async (req, res) => {
  const id = int(req.params.iid), b = req.body || {}, o = {};
  if ('Quantity' in b) { const q = int(b.Quantity); if (!q || q < 1) throw bad('Enter a quantity (a whole number above 0)'); o.Quantity = q; }
  if ('Cost' in b) { const c = num(b.Cost); if (c == null || isNaN(c) || c < 0) throw bad('Cost must be 0 or more'); o.Cost = c; }
  if ('Notes' in b) o.Notes = b.Notes || null;
  const cur = await query('SELECT k.PoConversionDate FROM IcPackPoItem x JOIN IcPackPo k ON k.PoPackNum = x.PoPackNum WHERE x.PoPackItemID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Not found' });
  if (cur[0].PoConversionDate) throw bad('This pack PO has already been converted.', 409);
  await updateRow(PPOI, id, o); res.json({ ok: true });
}));
router.delete('/pack-items/:iid', h(async (req, res) => {
  const id = int(req.params.iid);
  const cur = await query('SELECT k.PoConversionDate FROM IcPackPoItem x JOIN IcPackPo k ON k.PoPackNum = x.PoPackNum WHERE x.PoPackItemID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Not found' });
  if (cur[0].PoConversionDate) throw bad('This pack PO has already been converted.', 409);
  await deleteRow(PPOI, id); res.json({ ok: true });
}));
// "Post pack PO" (macro IcPoPack)
router.post('/packs/:id/post', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    const k = await query('SELECT * FROM IcPackPo WHERE PoPackNum = @id', { id }, tx);
    if (!k[0]) throw bad('Pack PO not found', 404);
    if (k[0].PoConversionDate) throw bad('This pack PO has already been converted. Action stopped.', 409);
    const lines = await query(`SELECT x.LotId, m.InvItemId, SUM(x.Quantity * m.Quantity) AS Qty, i.LastCost FROM IcPackPoItem x JOIN PmMaterial m ON m.PmPackId = x.PmPackId JOIN IcItem i ON i.InvItemID = m.InvItemId
        WHERE x.PoPackNum = @id AND i.PackageItem = 1 GROUP BY x.LotId, m.InvItemId, i.LastCost HAVING SUM(CASE WHEN x.Quantity * m.Quantity < 0 THEN 0 ELSE x.Quantity * m.Quantity END) > 0`, { id }, tx);
    if (!lines.length) throw bad('None of the packs on this pack PO contain package items, so there is nothing to order.', 409);
    const poNum = await insertRow(PO, { VendorId: k[0].VendorId, BillToId: k[0].BillToId, ShipToId: k[0].ShipToId, PayTerms: k[0].PayTerms, PoDate: k[0].PoDate, PoTaxRate: k[0].PoTaxRate ?? 0, PoTax: k[0].PoTax || '$0.00', PoShipping: k[0].PoShipping || '$0.00', Notes: k[0].Notes, PoPackNum: String(id) }, req.user.username, tx);
    // one PO line per item (the Access query groups by lot, then sums by item for the PO)
    const merged = new Map();
    for (const l of lines) { const e = merged.get(l.InvItemId) || { qty: 0, cost: l.LastCost }; e.qty += Math.max(0, l.Qty); merged.set(l.InvItemId, e); }
    const base = await nextId(tx, 'IcPoItem', 'PoItemID');
    let i = 0;
    for (const [item, e] of merged) {
      if (e.qty <= 0) continue;
      await query('INSERT INTO IcPoItem (PoItemID, PoNum, InvItemId, Quantity, Cost, NewReceived, NewBilled, DateEntered, UserEntered) VALUES (@id, @po, @it, @q, @c, 0, 0, GETDATE(), @u)',
        { id: base + i, po: poNum, it: item, q: Math.round(e.qty), c: e.cost ?? 0, u: req.user.username }, tx);
      i++;
    }
    const posted = await postPo(tx, 'p.PoNum = @po', { po: poNum });
    const tax = await query(`SELECT PoTax FROM IcPo WHERE PoNum = @po`, { po: poNum }, tx);
    await query('UPDATE IcPackPo SET PoConversionDate = CAST(GETDATE() AS date), PoNumLink = @po, PoTax = @tax WHERE PoPackNum = @id', { po: poNum, tax: tax[0].PoTax, id }, tx);
    return { poNum, lines: i, ...posted };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function rf(q) {
  return { p: { div: q.division || null, vendor: int(q.vendorId), from: isoDate(q.from), to: isoDate(q.to), cls: int(q.classId), item: int(q.itemId), s: q.search ? `%${q.search}%` : null },
    where: `WHERE (@div IS NULL OR co.DivisionId = @div) AND (@vendor IS NULL OR p.VendorId = @vendor) AND (@from IS NULL OR p.PoDate >= @from) AND (@to IS NULL OR p.PoDate <= @to)
      AND (@cls IS NULL OR i.InvClassId = @cls) AND (@item IS NULL OR l.InvItemId = @item) AND (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s OR v.Vendor LIKE @s)` };
}
const LINEFROM = `FROM IcPoItem l JOIN IcPo p ON p.PoNum = l.PoNum JOIN IcItem i ON i.InvItemID = l.InvItemId JOIN IcVendor v ON v.VendorID = p.VendorId LEFT JOIN LsCompany co ON co.CompanyID = p.ShipToId LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId`;
const REC_SUM = '(SELECT ISNULL(SUM(r.ReceivedQty),0) FROM IcPoItemRec r WHERE r.PoItemId = l.PoItemID)';
const BILL_SUM = '(SELECT ISNULL(SUM(b.BilledQty),0) FROM IcPoItemBill b WHERE b.PoItemId = l.PoItemID)';
const KINDS = {
  backordered: { extra: `AND p.DateClosed IS NULL AND l.Quantity > ${REC_SUM}`, order: 'p.PoDate, p.PoNum' },
  'not-billed': { extra: `AND ${REC_SUM} > ${BILL_SUM}`, order: 'p.PoDate, p.PoNum' },
  overages: { extra: `AND ${REC_SUM} > l.Quantity`, order: 'p.PoDate DESC' },
  all: { extra: '', order: 'p.PoDate DESC, p.PoNum DESC' },
};
router.get('/reports/lines', h(async (req, res) => {
  const k = KINDS[req.query.kind] || KINDS.all;
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const { p, where } = rf(req.query);
  const [rows, total] = await Promise.all([
    query(`SELECT p.PoNum, p.PoDate, p.DateClosed, v.Vendor, co.DivisionId, i.InvItemID, i.InvItem, i.Description, c.InvClass, l.Quantity, l.Cost, ${REC_SUM} AS Received, ${BILL_SUM} AS Billed,
                  l.Quantity - ${REC_SUM} AS BackOrdered, ${REC_SUM} - ${BILL_SUM} AS NotBilled, ${REC_SUM} - l.Quantity AS Overage, l.Quantity * l.Cost AS ExtCost
             ${LINEFROM} ${where} ${k.extra} ORDER BY ${k.order} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, { ...p, offset: pg.offset, pageSize: pg.pageSize }),
    query(`SELECT COUNT(*) AS n, SUM(l.Quantity * l.Cost) AS value ${LINEFROM} ${where} ${k.extra}`, p),
  ]);
  res.json({ rows, total: total[0].n, value: total[0].value, page: pg.page, pageSize: pg.pageSize, kind: req.query.kind || 'all' });
}));
router.get('/reports/by', h(async (req, res) => {
  const by = req.query.groupBy === 'division' ? 'co.DivisionId' : req.query.groupBy === 'class' ? 'c.InvClass' : 'v.Vendor';
  const { p, where } = rf(req.query);
  const rows = await query(`SELECT TOP 500 ISNULL(${by},'(none)') AS GroupLabel, COUNT(DISTINCT p.PoNum) AS Pos, COUNT(*) AS Lines, SUM(l.Quantity * l.Cost) AS Value
      ${LINEFROM} ${where} GROUP BY ${by} ORDER BY Value DESC`, p);
  res.json({ rows, totals: rows.reduce((a, r) => ({ Pos: a.Pos + r.Pos, Value: a.Value + (r.Value || 0) }), { Pos: 0, Value: 0 }) });
}));
router.get('/reports/price-fluctuation', h(async (req, res) => {
  const { p, where } = rf(req.query);
  const rows = await query(
    `SELECT TOP 500 i.InvItemID, i.InvItem, i.Description, c.InvClass, COUNT(*) AS Lines, MIN(l.Cost) AS MinCost, MAX(l.Cost) AS MaxCost, SUM(l.Quantity * l.Cost) / NULLIF(SUM(l.Quantity),0) AS AvgCost,
            CASE WHEN MIN(l.Cost) > 0 THEN (MAX(l.Cost) - MIN(l.Cost)) / MIN(l.Cost) * 100 END AS SpreadPct, SUM(l.Quantity) AS Qty
       ${LINEFROM} ${where} AND l.Cost > 0 GROUP BY i.InvItemID, i.InvItem, i.Description, c.InvClass HAVING COUNT(*) > 1 AND MAX(l.Cost) <> MIN(l.Cost) ORDER BY SpreadPct DESC`, p);
  res.json({ rows });
}));

module.exports = router;
