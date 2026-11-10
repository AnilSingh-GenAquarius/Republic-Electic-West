// Inventory control (IC) — mirrors the Access SwitchIC screens:
//   Items (InventoryItem), vendors (Vendor), stock by division (IcItemDivision), adjustments (IcInvTransaction),
//   "Update on hand/order qty" (macro IcPostTransaction), inventory counts (IcInventoryCount / IcInventoryCountPost),
//   ship + post pack material to job cost (IcMaterialPost / IcPostPackMaterial) and the inventory reports.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null ? null : Number(v));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const par = (tx, fns) => (tx ? fns.reduce((p, f) => p.then(async (a) => [...a, await f()]), Promise.resolve([])) : Promise.all(fns.map((f) => f())));
const COST = 'CASE WHEN ISNULL(i.LastCost,0) <> 0 THEN i.LastCost ELSE i.AverageCost END'; // value used by transactions and counts

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [invClasses, uoms, costCodes, statuses, transacTypes, divisions, stages, workTypes, updateTypes, vendorCategories, priceLevels] = await Promise.all([
    query('SELECT InvClassID AS id, InvClass AS name, Description FROM LsInvClass ORDER BY InvClass'),
    query("SELECT Uom AS id, Uom + ISNULL(' – ' + UnitOfMeasure,'') AS name FROM LsUom ORDER BY Uom"),
    query("SELECT CostCodeId AS id, CostCodeId + ' – ' + ISNULL(Description,'') AS name, IcTransacPost, TmMarkUp FROM LsCostCode ORDER BY CostCodeId"),
    query('SELECT StatusID AS id, Status AS name, Active FROM LsStatus ORDER BY StatusID'),
    query('SELECT TransacTypeID AS id, TransacType AS name, Description, TransacModifier, StatusId FROM LsInvTransacType ORDER BY TransacTypeID'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query('SELECT StageID AS id, Stage AS name FROM LsStage ORDER BY Stage'),
    query('SELECT WorkID AS id, WorkType AS name FROM LsWork ORDER BY WorkType'),
    query('SELECT UpdateID AS id, UpdateType AS name FROM LsUpdateType ORDER BY UpdateID'),
    query('SELECT CategoryID AS id, Category AS name FROM LsVendorCategory ORDER BY Category'),
    query('SELECT PriceLevelID AS id, PriceLevel AS name, MarkUpValue FROM LsPriceLevel ORDER BY PriceLevelID'),
  ]);
  res.json({ invClasses, uoms, costCodes, statuses, transacTypes, divisions, stages, workTypes, updateTypes, vendorCategories, priceLevels });
}));

// Overview numbers for the module home
router.get('/overview', h(async (req, res) => {
  const [stock, tx, counts, mat] = await Promise.all([
    query(`SELECT d.DivisionId, SUM(CAST(d.QtyOnHand AS decimal(18,4)) * i.AverageCost) AS value, COUNT(DISTINCT d.InvItemId) AS items,
                  SUM(CASE WHEN d.QtyOnHand < 0 THEN 1 ELSE 0 END) AS negative, SUM(CASE WHEN d.QtyReOrder - d.QtyOnHand > 0 THEN 1 ELSE 0 END) AS toOrder
             FROM IcItemDivision d JOIN IcItem i ON i.InvItemID = d.InvItemId WHERE d.QtyOnHand <> 0 OR d.QtyReOrder <> 0 GROUP BY d.DivisionId ORDER BY d.DivisionId`),
    query(`SELECT j.DivisionId, (SELECT COUNT(*) FROM JcLotItem jc2 JOIN JsLot l2 ON l2.LotID = jc2.LotId JOIN JsJob j2 ON j2.JobId = l2.JobId JOIN IcItem i2 ON i2.InvItemID = jc2.InvItemId
                                   WHERE j2.DivisionId = j.DivisionId AND jc2.IcTransacPostedDate IS NULL AND i2.CostCodeId <> 'L') AS jobCostUnposted
             FROM JsJob j GROUP BY j.DivisionId`),
    query(`SELECT TOP 5 c.InventoryID, c.InvDate, c.DivisionId, c.Posted FROM IcInvDate c ORDER BY c.InvDate DESC`),
    query(`SELECT j.DivisionId, COUNT(*) AS lines, COUNT(DISTINCT m.LotId) AS lots, SUM(CASE WHEN m.ShippedQty IS NOT NULL THEN 1 ELSE 0 END) AS shipped
             FROM JsPackMaterialTemp m JOIN JsLot l ON l.LotID = m.LotId JOIN JsJob j ON j.JobId = l.JobId GROUP BY j.DivisionId`),
  ]);
  const unpostedTx = await query(`SELECT DivisionId, COUNT(*) AS n FROM IcInvTransaction WHERE IcTransacPosted = 0 OR IcTransacPosted IS NULL GROUP BY DivisionId`);
  const recUnposted = await query(`SELECT co.DivisionId, COUNT(*) AS n FROM IcPoItemRec r JOIN IcPoItem pi ON pi.PoItemID = r.PoItemId JOIN IcPo p ON p.PoNum = pi.PoNum JOIN LsCompany co ON co.CompanyID = p.ShipToId WHERE r.IcTransacPostedDate IS NULL GROUP BY co.DivisionId`);
  res.json({ stock, jobCost: tx, recentCounts: counts, material: mat, unpostedTransactions: unpostedTx, receiptsUnposted: recUnposted });
}));

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
const ITEM_COLS = ['InvItem', 'AlternateCode', 'InvClassId', 'Description', 'VendorId', 'Manufacturer', 'PartNum', 'UnitsPer', 'Uom', 'DefaultStageId', 'DefaultWorkId',
  'CostCodeId', 'PmItem', 'BillBySuper', 'LaborCost', 'LastCost', 'AverageCost', 'JobCostPrice', 'JobCostPriceUpdateId', 'EstimatingPrice', 'EstimatingPriceMkUp',
  'EstimatingPriceUpdateId', 'VipPrice', 'VipPriceMkUp', 'ResidentialPoPrice', 'ResidentialPoPriceMkUp', 'RetailPrice', 'RetailPriceMkUp', 'LastPurchase', 'StatusId',
  'Notes', 'PackageItem', 'NonTaxable'];
const ITEM = { table: 'IcItem', idCol: 'InvItemID', columns: ITEM_COLS };
const LEVELS = [['EstimatingPrice', 'EstimatingPriceMkUp'], ['VipPrice', 'VipPriceMkUp'], ['ResidentialPoPrice', 'ResidentialPoPriceMkUp'], ['RetailPrice', 'RetailPriceMkUp']];

function itemBody(b, existing) {
  const o = {};
  for (const k of ITEM_COLS) if (k in b) o[k] = b[k] === '' ? null : b[k];
  for (const k of ['InvClassId', 'VendorId', 'UnitsPer', 'DefaultStageId', 'DefaultWorkId', 'JobCostPriceUpdateId', 'EstimatingPriceUpdateId', 'StatusId', 'EstimatingPriceMkUp', 'VipPriceMkUp', 'ResidentialPoPriceMkUp', 'RetailPriceMkUp']) if (k in o) o[k] = int(o[k]);
  for (const k of ['LaborCost', 'LastCost', 'AverageCost', 'JobCostPrice', 'EstimatingPrice', 'VipPrice', 'ResidentialPoPrice', 'RetailPrice']) {
    if (k in o) { o[k] = num(o[k]); if (o[k] != null && (isNaN(o[k]) || o[k] < 0)) throw bad(`${k} must be a positive number`); }
  }
  for (const k of ['PmItem', 'BillBySuper', 'PackageItem', 'NonTaxable']) if (k in o) o[k] = o[k] ? 1 : 0;
  if ('LastPurchase' in o) o.LastPurchase = isoDate(o.LastPurchase);
  if ('InvItem' in o) {
    o.InvItem = String(o.InvItem || '').trim();
    if (o.InvItem.length < 5) throw bad('Item name must be 5+ characters long');
  }
  // price = job cost × (1 + mark-up %) when the cost or a mark-up changes and the price itself was not typed (Access: LostFocus macros)
  const jc = 'JobCostPrice' in o ? o.JobCostPrice : existing?.JobCostPrice;
  for (const [price, mk] of LEVELS) {
    if (price in b && b[price] !== '' && b[price] != null) continue;
    if (('JobCostPrice' in o) || (mk in o)) {
      const m = mk in o ? o[mk] : existing?.[mk];
      if (jc != null && m != null) o[price] = Math.round(jc * (1 + m / 100) * 10000) / 10000;
    }
  }
  return o;
}

router.get('/items', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = {
    s: req.query.search ? `%${req.query.search}%` : null, cls: int(req.query.classId), vendor: int(req.query.vendorId), cc: req.query.costCode || null,
    status: req.query.status || 'active', div: req.query.division || null, offset: pg.offset, pageSize: pg.pageSize,
  };
  const low = req.query.lowStock === '1' ? 1 : 0, neg = req.query.negative === '1' ? 1 : 0;
  const where = `WHERE (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s OR i.AlternateCode LIKE @s OR i.PartNum LIKE @s OR i.Manufacturer LIKE @s)
    AND (@cls IS NULL OR i.InvClassId = @cls) AND (@vendor IS NULL OR i.VendorId = @vendor) AND (@cc IS NULL OR i.CostCodeId = @cc)
    AND (@status = 'all' OR (@status = 'active' AND i.StatusId = 1) OR (@status = 'inactive' AND i.StatusId <> 1))
    ${neg ? `AND EXISTS (SELECT 1 FROM IcItemDivision d WHERE d.InvItemId = i.InvItemID AND d.QtyOnHand < 0 AND (@div IS NULL OR d.DivisionId = @div))` : ''}
    ${low ? `AND EXISTS (SELECT 1 FROM IcItemDivision d WHERE d.InvItemId = i.InvItemID AND d.QtyReOrder - d.QtyOnHand > 0 AND (@div IS NULL OR d.DivisionId = @div))` : ''}`;
  const SORT = { item: 'i.InvItem', class: 'c.InvClass, i.InvItem', cost: 'i.JobCostPrice DESC', onhand: 'OnHand DESC' };
  const [rows, total] = await Promise.all([
    query(`SELECT i.InvItemID, i.InvItem, i.AlternateCode, i.Description, c.InvClass, i.CostCodeId, i.Uom, i.JobCostPrice, i.LastCost, i.AverageCost, i.StatusId, v.Vendor,
                  (SELECT SUM(d.QtyOnHand) FROM IcItemDivision d WHERE d.InvItemId = i.InvItemID AND (@div IS NULL OR d.DivisionId = @div)) AS OnHand,
                  (SELECT SUM(d.QtyReOrder) FROM IcItemDivision d WHERE d.InvItemId = i.InvItemID AND (@div IS NULL OR d.DivisionId = @div)) AS ReOrder,
                  (SELECT SUM(d.QtyOnOrder) FROM IcItemDivision d WHERE d.InvItemId = i.InvItemID AND (@div IS NULL OR d.DivisionId = @div)) AS OnOrder
             FROM IcItem i LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId LEFT JOIN IcVendor v ON v.VendorID = i.VendorId ${where}
            ORDER BY ${SORT[req.query.sort] || SORT.item} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM IcItem i ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

router.get('/items/next-name', h(async (req, res) => res.json({ hint: 'Use a code of 5+ characters, e.g. BX-PL-1G-NEW' })));

router.get('/items/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [item, stock, vendorItems, history, usage] = await Promise.all([
    query(`SELECT i.*, c.InvClass, v.Vendor FROM IcItem i LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId LEFT JOIN IcVendor v ON v.VendorID = i.VendorId WHERE i.InvItemID = @id`, { id }),
    query(`SELECT ld.DivisionID AS DivisionId, ld.DivisionName, d.InvDivisionID, ISNULL(d.QtyOnHand,0) AS QtyOnHand, ISNULL(d.QtyReOrder,0) AS QtyReOrder, ISNULL(d.QtyOnOrder,0) AS QtyOnOrder, d.Notes,
                  CASE WHEN d.InvDivisionID IS NULL THEN 0 ELSE 1 END AS HasRow
             FROM LsDivision ld LEFT JOIN IcItemDivision d ON d.DivisionId = ld.DivisionID AND d.InvItemId = @id ORDER BY ld.DivisionID`, { id }),
    query(`SELECT vi.VendItemID, vi.VendorId, v.Vendor, vi.PartNum, vi.Manufacturer, vi.DefaultPrice, vi.DateQuote, vi.LastPrice
             FROM IcVendorItem vi LEFT JOIN IcVendor v ON v.VendorID = vi.VendorId WHERE vi.InvItemId = @id ORDER BY v.Vendor`, { id }),
    query(`SELECT TOP 25 t.TransactionID, t.IcTransacPostedDate AS TransacDate, t.DivisionId, ty.TransacType, t.Quantity, t.Value, t.IcTransacPosted, t.Notes, t.UserEntered
             FROM IcInvTransaction t LEFT JOIN LsInvTransacType ty ON ty.TransacTypeID = t.TransacTypeId WHERE t.InvItemId = @id ORDER BY t.TransactionID DESC`, { id }),
    query(`SELECT (SELECT COUNT(*) FROM PmMaterial WHERE InvItemId = @id AND DateEntered >= DATEADD(day,-365,GETDATE())) AS pmRecent,
                  (SELECT COUNT(*) FROM PmMaterial WHERE InvItemId = @id) AS pm, (SELECT COUNT(*) FROM IcPoItem WHERE InvItemId = @id) AS po,
                  (SELECT COUNT(*) FROM IcInvTransaction WHERE InvItemId = @id) AS tx, (SELECT COUNT(*) FROM JcLotItem WHERE InvItemId = @id) AS jc,
                  (SELECT COUNT(*) FROM TmPOMaterial WHERE InvItemId = @id) AS tm`, { id }),
  ]);
  if (!item[0]) return res.status(404).json({ error: 'Item not found' });
  res.json({ item: item[0], stock, vendorItems, history, usage: usage[0] });
}));

router.post('/items', h(async (req, res) => {
  const o = itemBody(req.body || {}, null);
  if (!o.InvItem) throw bad('Item name must be 5+ characters long');
  if (!o.InvClassId) throw bad('Choose an inventory class');
  if (!o.CostCodeId) throw bad('Choose a cost code');
  const id = await withTransaction(async (tx) => {
    const dup = await query('SELECT 1 AS x FROM IcItem WHERE InvItem = @n', { n: o.InvItem }, tx);
    if (dup.length) throw bad(`Item ${o.InvItem} already exists`, 409);
    const defaults = { UnitsPer: 1, StatusId: 1, LaborCost: 0, LastCost: 0, AverageCost: 0, JobCostPrice: 0, EstimatingPriceMkUp: 3, VipPriceMkUp: 25, ResidentialPoPriceMkUp: 60, RetailPriceMkUp: 120,
      JobCostPriceUpdateId: 3, EstimatingPriceUpdateId: 3, PmItem: 0, BillBySuper: 0, PackageItem: 0, NonTaxable: 0 };
    const merged = { ...defaults, ...o };
    const pr = itemBody({ JobCostPrice: merged.JobCostPrice, EstimatingPriceMkUp: merged.EstimatingPriceMkUp, VipPriceMkUp: merged.VipPriceMkUp, ResidentialPoPriceMkUp: merged.ResidentialPoPriceMkUp, RetailPriceMkUp: merged.RetailPriceMkUp }, null);
    return insertRow(ITEM, { ...merged, ...Object.fromEntries(LEVELS.map(([p]) => [p, o[p] ?? pr[p]])) }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/items/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await query('SELECT * FROM IcItem WHERE InvItemID = @id', { id }, tx);
    if (!cur[0]) throw bad('Item not found', 404);
    const o = itemBody(b, cur[0]);
    if (o.InvItem && o.InvItem !== cur[0].InvItem) {
      const dup = await query('SELECT 1 AS x FROM IcItem WHERE InvItem = @n AND InvItemID <> @id', { n: o.InvItem, id }, tx);
      if (dup.length) throw bad(`Item ${o.InvItem} already exists`, 409);
    }
    if ('StatusId' in o && o.StatusId !== 1 && cur[0].StatusId === 1 && !b.confirmDisable) {
      const used = await query('SELECT COUNT(*) AS n FROM PmMaterial WHERE InvItemId = @id AND DateEntered >= DATEADD(day,-365,GETDATE())', { id }, tx);
      if (used[0].n) throw Object.assign(bad('This item is used in Plan management. Are you sure you want to disable it?', 409), { needsConfirm: true });
    }
    await updateRow(ITEM, id, o, tx);
  });
  res.json({ ok: true });
}));

router.delete('/items/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const u = await query(`SELECT (SELECT COUNT(*) FROM PmMaterial WHERE InvItemId=@id) pm, (SELECT COUNT(*) FROM IcPoItem WHERE InvItemId=@id) po, (SELECT COUNT(*) FROM IcInvTransaction WHERE InvItemId=@id) tx,
      (SELECT COUNT(*) FROM JcLotItem WHERE InvItemId=@id) jc, (SELECT COUNT(*) FROM TmPOMaterial WHERE InvItemId=@id) tm, (SELECT COUNT(*) FROM IcItemDivision WHERE InvItemId=@id AND QtyOnHand<>0) stock`, { id }, tx);
    if (Object.values(u[0]).some((n) => n > 0)) throw bad('This item has been used (stock, orders, transactions, plans or job cost), so it cannot be deleted. Set it to Inactive instead.', 409);
    await query('DELETE FROM IcItemDivision WHERE InvItemId = @id', { id }, tx);
    await query('DELETE FROM IcVendorItem WHERE InvItemId = @id', { id }, tx);
    await deleteRow(ITEM, id, tx);
  });
  res.json({ ok: true });
}));

// Reorder level / notes for one division (on hand only changes through transactions and counts)
router.put('/items/:id/stock/:division', h(async (req, res) => {
  const id = int(req.params.id), div = req.params.division;
  const b = req.body || {};
  const r = int(b.QtyReOrder);
  if (r == null || isNaN(r) || r < 0) throw bad('Reorder quantity must be 0 or more');
  await withTransaction(async (tx) => {
    const d = await query('SELECT DivisionID FROM LsDivision WHERE DivisionID = @d', { d: div }, tx);
    if (!d[0]) throw bad('Unknown division', 404);
    const row = await query('SELECT InvDivisionID FROM IcItemDivision WHERE InvItemId = @i AND DivisionId = @d', { i: id, d: div }, tx);
    if (row[0]) await query('UPDATE IcItemDivision SET QtyReOrder = @r, Notes = @n WHERE InvDivisionID = @x', { r, n: b.Notes || null, x: row[0].InvDivisionID }, tx);
    else {
      const nid = await nextId(tx, 'IcItemDivision', 'InvDivisionID');
      await query('INSERT INTO IcItemDivision (InvDivisionID, InvItemId, DivisionId, QtyOnHand, QtyReOrder, QtyOnOrder, Notes, DateEntered, UserEntered) VALUES (@n, @i, @d, 0, @r, 0, @no, GETDATE(), @u)',
        { n: nid, i: id, d: div, r, no: b.Notes || null, u: req.user.username }, tx);
    }
  });
  res.json({ ok: true });
}));

// Vendor price list for an item
const VITEM = { table: 'IcVendorItem', idCol: 'VendItemID', columns: ['InvItemId', 'VendorId', 'PartNum', 'Manufacturer', 'DefaultPrice', 'DateQuote', 'LastPrice'] };
function vitemBody(b) {
  const o = {};
  for (const k of ['PartNum', 'Manufacturer']) if (k in b) o[k] = b[k] || null;
  for (const k of ['DefaultPrice', 'LastPrice']) if (k in b) { o[k] = num(b[k]); if (o[k] != null && (isNaN(o[k]) || o[k] < 0)) throw bad('Price must be a positive number'); }
  if ('DateQuote' in b) o.DateQuote = isoDate(b.DateQuote);
  return o;
}
router.post('/items/:id/vendors', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  if (!int(b.VendorId)) throw bad('Choose a vendor');
  const nid = await withTransaction(async (tx) => {
    const dup = await query('SELECT 1 AS x FROM IcVendorItem WHERE InvItemId = @i AND VendorId = @v', { i: id, v: int(b.VendorId) }, tx);
    if (dup.length) throw bad('That vendor already has a price for this item. Edit it instead.', 409);
    return insertRow(VITEM, { ...vitemBody(b), InvItemId: id, VendorId: int(b.VendorId) }, req.user.username, tx);
  });
  res.status(201).json({ id: nid });
}));
router.put('/vendor-items/:vid', h(async (req, res) => { const n = await updateRow(VITEM, int(req.params.vid), vitemBody(req.body || {})); if (!n) return res.status(404).json({ error: 'Not found' }); res.json({ ok: true }); }));
router.delete('/vendor-items/:vid', h(async (req, res) => { await deleteRow(VITEM, int(req.params.vid)); res.json({ ok: true }); }));

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
const VENDOR = { table: 'IcVendor', idCol: 'VendorID', columns: ['Vendor', 'CategoryId', 'PayTerms', 'FreeShipping', 'Address', 'City', 'State', 'Zip', 'Phone', 'Fax', 'PayAs', 'PayAddress', 'PayCity', 'PayState', 'PayZip', 'PayPhone', 'PayFax', 'StatusId', 'Notes'] };
const CONTACT = { table: 'IcVendorContact', idCol: 'VendorContID', columns: ['VendorId', 'Name', 'Title', 'MainContact', 'Office', 'Fax', 'Cell', 'Email'], audit: false };

router.get('/vendors', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, cat: int(req.query.categoryId), status: req.query.status || 'active', offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR v.Vendor LIKE @s OR v.City LIKE @s OR v.Phone LIKE @s) AND (@cat IS NULL OR v.CategoryId = @cat)
    AND (@status = 'all' OR (@status = 'active' AND v.StatusId = 1) OR (@status = 'inactive' AND v.StatusId <> 1))`;
  const [rows, total] = await Promise.all([
    query(`SELECT v.VendorID, v.Vendor, c.Category, v.City, v.State, v.Phone, v.PayTerms, v.StatusId,
                  (SELECT COUNT(*) FROM IcVendorItem x WHERE x.VendorId = v.VendorID) AS Items, (SELECT COUNT(*) FROM IcPo po WHERE po.VendorId = v.VendorID) AS Pos
             FROM IcVendor v LEFT JOIN LsVendorCategory c ON c.CategoryID = v.CategoryId ${where} ORDER BY v.Vendor OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM IcVendor v ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/vendors/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [v, contacts, items, pos] = await Promise.all([
    query('SELECT * FROM IcVendor WHERE VendorID = @id', { id }),
    query('SELECT * FROM IcVendorContact WHERE VendorId = @id ORDER BY MainContact DESC, Name', { id }),
    query(`SELECT TOP 100 vi.VendItemID, vi.InvItemId, i.InvItem, i.Description, vi.PartNum, vi.DefaultPrice, vi.LastPrice, vi.DateQuote FROM IcVendorItem vi JOIN IcItem i ON i.InvItemID = vi.InvItemId WHERE vi.VendorId = @id ORDER BY i.InvItem`, { id }),
    query(`SELECT TOP 10 PoNum, PoDate, DateClosed FROM IcPo WHERE VendorId = @id ORDER BY PoNum DESC`, { id }),
  ]);
  if (!v[0]) return res.status(404).json({ error: 'Vendor not found' });
  res.json({ vendor: v[0], contacts, items, recentPos: pos });
}));
function vendorBody(b) {
  const o = {};
  for (const k of VENDOR.columns) if (k in b) o[k] = b[k] === '' ? null : b[k];
  for (const k of ['CategoryId', 'FreeShipping', 'StatusId']) if (k in o) o[k] = int(o[k]);
  if ('Vendor' in o) { o.Vendor = String(o.Vendor || '').trim(); if (!o.Vendor) throw bad('Vendor name is required'); }
  return o;
}
router.post('/vendors', h(async (req, res) => {
  const o = vendorBody(req.body || {});
  if (!o.Vendor) throw bad('Vendor name is required');
  const id = await withTransaction(async (tx) => {
    const dup = await query('SELECT 1 AS x FROM IcVendor WHERE Vendor = @n', { n: o.Vendor }, tx);
    if (dup.length) throw bad(`Vendor ${o.Vendor} already exists`, 409);
    return insertRow(VENDOR, { StatusId: 1, FreeShipping: 0, ...o }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/vendors/:id', h(async (req, res) => {
  const id = int(req.params.id), o = vendorBody(req.body || {});
  await withTransaction(async (tx) => {
    if (o.Vendor) { const dup = await query('SELECT 1 AS x FROM IcVendor WHERE Vendor = @n AND VendorID <> @id', { n: o.Vendor, id }, tx); if (dup.length) throw bad(`Vendor ${o.Vendor} already exists`, 409); }
    const n = await updateRow(VENDOR, id, o, tx);
    if (!n) throw bad('Vendor not found', 404);
  });
  res.json({ ok: true });
}));
router.delete('/vendors/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const u = await query('SELECT (SELECT COUNT(*) FROM IcPo WHERE VendorId=@id) po, (SELECT COUNT(*) FROM IcVendorItem WHERE VendorId=@id) it, (SELECT COUNT(*) FROM IcItem WHERE VendorId=@id) pref', { id }, tx);
    if (u[0].po || u[0].it || u[0].pref) throw bad('This vendor has orders, item prices or is a preferred vendor, so it cannot be deleted. Set it to Inactive instead.', 409);
    await query('DELETE FROM IcVendorContact WHERE VendorId = @id', { id }, tx);
    await deleteRow(VENDOR, id, tx);
  });
  res.json({ ok: true });
}));
function contactBody(b) {
  const o = {};
  for (const k of ['Name', 'Title', 'Office', 'Fax', 'Cell', 'Email']) if (k in b) o[k] = b[k] || null;
  if ('MainContact' in b) o.MainContact = b.MainContact ? 1 : 0;
  if ('Name' in o && !String(o.Name || '').trim()) throw bad('Contact name is required');
  return o;
}
router.post('/vendors/:id/contacts', h(async (req, res) => { const o = contactBody(req.body || {}); if (!o.Name) throw bad('Contact name is required'); const id = await insertRow(CONTACT, { ...o, VendorId: int(req.params.id) }, req.user.username); res.status(201).json({ id }); }));
router.put('/contacts/:cid', h(async (req, res) => { const n = await updateRow(CONTACT, int(req.params.cid), contactBody(req.body || {})); if (!n) return res.status(404).json({ error: 'Not found' }); res.json({ ok: true }); }));
router.delete('/contacts/:cid', h(async (req, res) => { await deleteRow(CONTACT, int(req.params.cid)); res.json({ ok: true }); }));

// ---------------------------------------------------------------------------
// Transactions (IcInvTransaction) and "Update on hand/order qty" (macro IcPostTransaction)
// ---------------------------------------------------------------------------
router.get('/transactions', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { div: req.query.division || null, item: int(req.query.itemId), type: int(req.query.typeId), from: isoDate(req.query.from), to: isoDate(req.query.to), posted: req.query.posted || 'all',
    s: req.query.search ? `%${req.query.search}%` : null, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@div IS NULL OR t.DivisionId = @div) AND (@item IS NULL OR t.InvItemId = @item) AND (@type IS NULL OR t.TransacTypeId = @type)
    AND (@from IS NULL OR t.IcTransacPostedDate >= @from) AND (@to IS NULL OR t.IcTransacPostedDate <= @to) AND (@s IS NULL OR t.InvItem LIKE @s OR t.Notes LIKE @s)
    AND (@posted = 'all' OR (@posted = 'no' AND ISNULL(t.IcTransacPosted,0) = 0) OR (@posted = 'yes' AND t.IcTransacPosted = 1))`;
  const [rows, total] = await Promise.all([
    query(`SELECT t.TransactionID, t.IcTransacPostedDate AS TransacDate, t.DivisionId, t.InvItemId, t.InvItem, i.Description, ty.TransacType, t.TransacTypeId, t.Quantity, t.Value, t.Quantity * t.Value AS ExtValue,
                  t.IcTransacPosted, t.Notes, t.UserEntered
             FROM IcInvTransaction t LEFT JOIN LsInvTransacType ty ON ty.TransacTypeID = t.TransacTypeId LEFT JOIN IcItem i ON i.InvItemID = t.InvItemId ${where}
            ORDER BY t.TransactionID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM IcInvTransaction t ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));

// Manual adjustment. The quantity entered is positive; the type's modifier (+1 / −1 / 0) gives the stock effect.
router.post('/transactions', h(async (req, res) => {
  const b = req.body || {};
  const qty = int(b.quantity);
  if (!qty || qty < 0 || qty > 10000000) throw bad('Enter a quantity (a whole number above 0)');
  const id = await withTransaction(async (tx) => {
    const [it, ty, dv] = await par(tx, [
      () => query('SELECT InvItemID, InvItem, InvClassId, CostCodeId, LastCost, AverageCost FROM IcItem WHERE InvItemID = @i', { i: int(b.invItemId) }, tx),
      () => query('SELECT TransacTypeID, TransacModifier, StatusId FROM LsInvTransacType WHERE TransacTypeID = @t', { t: int(b.typeId) }, tx),
      () => query('SELECT DivisionID FROM LsDivision WHERE DivisionID = @d', { d: b.division }, tx),
    ]);
    if (!it[0]) throw bad('Choose an item');
    if (!ty[0]) throw bad('Choose a transaction type');
    if (!dv[0]) throw bad('Choose a division');
    // Purchases and packs are created by Purchasing / job cost; adjustments here are for the other types
    if ([1, 7].includes(ty[0].TransacTypeID)) throw bad('Purchases and pack material post automatically from receiving and job cost. Choose another type.');
    const value = Number(it[0].LastCost) !== 0 ? it[0].LastCost : it[0].AverageCost;
    return insertRow({ table: 'IcInvTransaction', idCol: 'TransactionID', columns: ['DivisionId', 'InvClassId', 'InvItemId', 'InvItem', 'CostCodeId', 'Quantity', 'Value', 'TransacTypeId', 'Notes', 'IcTransacPostedDate', 'IcTransacPosted'] },
      { DivisionId: b.division, InvClassId: it[0].InvClassId, InvItemId: it[0].InvItemID, InvItem: it[0].InvItem, CostCodeId: it[0].CostCodeId, Quantity: qty * Number(ty[0].TransacModifier), Value: value ?? 0,
        TransacTypeId: ty[0].TransacTypeID, Notes: b.notes || null, IcTransacPostedDate: new Date().toISOString().slice(0, 10), IcTransacPosted: 0 }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.delete('/transactions/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const cur = await query('SELECT IcTransacPosted FROM IcInvTransaction WHERE TransactionID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Transaction not found' });
  if (cur[0].IcTransacPosted) throw bad('A posted transaction has already changed stock and cannot be deleted. Enter an offsetting adjustment instead.', 409);
  await query('DELETE FROM IcInvTransaction WHERE TransactionID = @id', { id });
  res.json({ ok: true });
}));

const TODAY = "CAST(CAST(GETDATE() AS date) AS datetime)";
/** The four steps of macro IcPostTransaction for one division. Runs inside the caller's transaction. */
async function postTransactions(tx, division, user) {
  const out = { jobCost: 0, receipts: 0, posted: 0, itemsUpdated: 0, onOrderUpdated: 0 };
  // 1. material used on lots (job cost) -> type 7 transactions, then mark those job cost rows
  const jc = await nextId(tx, 'IcInvTransaction', 'TransactionID');
  const r1 = await query(
    `INSERT INTO IcInvTransaction (TransactionID, DivisionId, InvClassId, InvItemId, InvItem, CostCodeId, Quantity, Value, TransacTypeId, IcTransacPostedDate, IcTransacPosted, DateEntered, UserEntered)
     SELECT @base + ROW_NUMBER() OVER (ORDER BY i.InvItemID) - 1, @div, i.InvClassId, i.InvItemID, i.InvItem, i.CostCodeId, -SUM(jc.ExtItemQty), ${COST}, 7, ${TODAY}, 0, GETDATE(), @u
       FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId JOIN JsLot l ON l.LotID = jc.LotId JOIN JsJob j ON j.JobId = l.JobId
      WHERE jc.IcTransacPostedDate IS NULL AND j.DivisionId = @div AND i.CostCodeId <> 'L'
      GROUP BY i.InvItemID, i.InvClassId, i.InvItem, i.CostCodeId, ${COST};
     SELECT @@ROWCOUNT AS n`, { base: jc, div: division, u: user }, tx);
  out.jobCost = r1[0].n;
  await query(`UPDATE jc SET jc.IcTransacPostedDate = ${TODAY} FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId JOIN JsLot l ON l.LotID = jc.LotId JOIN JsJob j ON j.JobId = l.JobId
                WHERE jc.IcTransacPostedDate IS NULL AND j.DivisionId = @div AND i.CostCodeId <> 'L'`, { div: division }, tx);
  // 2. purchase receipts -> type 1 transactions, then mark the receipts
  const rc = await nextId(tx, 'IcInvTransaction', 'TransactionID');
  const r2 = await query(
    `INSERT INTO IcInvTransaction (TransactionID, DivisionId, InvClassId, InvItemId, InvItem, CostCodeId, Quantity, Value, TransacTypeId, IcTransacPostedDate, IcTransacPosted, DateEntered, UserEntered)
     SELECT @base + ROW_NUMBER() OVER (ORDER BY i.InvItemID) - 1, @div, i.InvClassId, i.InvItemID, i.InvItem, i.CostCodeId, SUM(r.ReceivedQty), ${COST}, 1, ${TODAY}, 0, GETDATE(), @u
       FROM IcPoItemRec r JOIN IcPoItem pi ON pi.PoItemID = r.PoItemId JOIN IcPo p ON p.PoNum = pi.PoNum JOIN LsCompany co ON co.CompanyID = p.ShipToId JOIN IcItem i ON i.InvItemID = pi.InvItemId
      WHERE r.IcTransacPostedDate IS NULL AND co.DivisionId = @div AND i.CostCodeId <> 'L'
      GROUP BY i.InvItemID, i.InvClassId, i.InvItem, i.CostCodeId, ${COST};
     SELECT @@ROWCOUNT AS n`, { base: rc, div: division, u: user }, tx);
  out.receipts = r2[0].n;
  await query(`UPDATE r SET r.IcTransacPostedDate = ${TODAY} FROM IcPoItemRec r JOIN IcPoItem pi ON pi.PoItemID = r.PoItemId JOIN IcPo p ON p.PoNum = pi.PoNum JOIN LsCompany co ON co.CompanyID = p.ShipToId JOIN IcItem i ON i.InvItemID = pi.InvItemId
                WHERE r.IcTransacPostedDate IS NULL AND co.DivisionId = @div AND i.CostCodeId <> 'L'`, { div: division }, tx);
  // 3. sum every unposted transaction into on-hand
  const sums = await query(`SELECT InvItemId, SUM(Quantity) AS q FROM IcInvTransaction WHERE ISNULL(IcTransacPosted,0) = 0 AND DivisionId = @div AND IcTransacPostedDate IS NOT NULL GROUP BY InvItemId`, { div: division }, tx);
  out.itemsUpdated = sums.length;
  if (sums.length) {
    const base = await nextId(tx, 'IcItemDivision', 'InvDivisionID');
    await query(
      `INSERT INTO IcItemDivision (InvDivisionID, InvItemId, DivisionId, QtyOnHand, QtyReOrder, QtyOnOrder, DateEntered, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY s.InvItemId) - 1, s.InvItemId, @div, 0, 0, 0, GETDATE(), @u
         FROM (SELECT DISTINCT InvItemId FROM IcInvTransaction WHERE ISNULL(IcTransacPosted,0) = 0 AND DivisionId = @div AND IcTransacPostedDate IS NOT NULL) s
        WHERE NOT EXISTS (SELECT 1 FROM IcItemDivision d WHERE d.InvItemId = s.InvItemId AND d.DivisionId = @div)`, { base, div: division, u: user }, tx);
    await query(
      `UPDATE d SET d.QtyOnHand = d.QtyOnHand + s.q FROM IcItemDivision d
         JOIN (SELECT InvItemId, SUM(Quantity) AS q FROM IcInvTransaction WHERE ISNULL(IcTransacPosted,0) = 0 AND DivisionId = @div AND IcTransacPostedDate IS NOT NULL GROUP BY InvItemId) s ON s.InvItemId = d.InvItemId
        WHERE d.DivisionId = @div`, { div: division }, tx);
    const m = await query(`UPDATE IcInvTransaction SET IcTransacPosted = 1 WHERE ISNULL(IcTransacPosted,0) = 0 AND DivisionId = @div AND IcTransacPostedDate IS NOT NULL; SELECT @@ROWCOUNT AS n`, { div: division }, tx);
    out.posted = m[0].n;
  }
  // 4. on-order quantity = ordered − received, for POs that ship to this division
  const o = await query(
    `UPDATE d SET d.QtyOnOrder = x.q FROM IcItemDivision d
       JOIN (SELECT pi.InvItemId, SUM(pi.Quantity) - ISNULL(SUM(rr.rec),0) AS q
               FROM IcPoItem pi JOIN IcPo p ON p.PoNum = pi.PoNum JOIN LsCompany co ON co.CompanyID = p.ShipToId
               OUTER APPLY (SELECT SUM(r.ReceivedQty) AS rec FROM IcPoItemRec r WHERE r.PoItemId = pi.PoItemID) rr
              WHERE co.DivisionId = @div GROUP BY pi.InvItemId) x ON x.InvItemId = d.InvItemId
      WHERE d.DivisionId = @div;
     SELECT @@ROWCOUNT AS n`, { div: division }, tx);
  out.onOrderUpdated = o[0].n;
  return out;
}

router.get('/transactions/pending', h(async (req, res) => {
  const div = req.query.division;
  if (!div) throw bad('Choose a division');
  const [jc, rec, tx] = await Promise.all([
    query(`SELECT COUNT(*) AS lines, COUNT(DISTINCT jc.InvItemId) AS items FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId JOIN JsLot l ON l.LotID = jc.LotId JOIN JsJob j ON j.JobId = l.JobId
             WHERE jc.IcTransacPostedDate IS NULL AND j.DivisionId = @d AND i.CostCodeId <> 'L'`, { d: div }),
    query(`SELECT COUNT(*) AS lines FROM IcPoItemRec r JOIN IcPoItem pi ON pi.PoItemID = r.PoItemId JOIN IcPo p ON p.PoNum = pi.PoNum JOIN LsCompany co ON co.CompanyID = p.ShipToId JOIN IcItem i ON i.InvItemID = pi.InvItemId
             WHERE r.IcTransacPostedDate IS NULL AND co.DivisionId = @d AND i.CostCodeId <> 'L'`, { d: div }),
    query(`SELECT COUNT(*) AS n FROM IcInvTransaction WHERE ISNULL(IcTransacPosted,0) = 0 AND DivisionId = @d`, { d: div }),
  ]);
  res.json({ jobCost: jc[0], receipts: rec[0], unpostedTransactions: tx[0].n });
}));
router.post('/transactions/post', h(async (req, res) => {
  const div = req.body?.division;
  if (!div) throw bad('Choose a division');
  const out = await withTransaction(async (tx) => {
    const d = await query('SELECT DivisionID FROM LsDivision WHERE DivisionID = @d', { d: div }, tx);
    if (!d[0]) throw bad('Unknown division', 404);
    return postTransactions(tx, div, req.user.username);
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Inventory counts (IcInvDate / IcInvItem)
// ---------------------------------------------------------------------------
router.get('/counts', h(async (req, res) => {
  const rows = await query(
    `SELECT c.InventoryID, c.InvDate, c.DivisionId, c.FromDate, c.ToDate, c.Notes, c.Posted, c.UserEntered,
            (SELECT COUNT(*) FROM IcInvItem x WHERE x.InventoryId = c.InventoryID) AS Lines,
            (SELECT SUM(CASE WHEN x.NewQty <> x.CurrentQty THEN 1 ELSE 0 END) FROM IcInvItem x WHERE x.InventoryId = c.InventoryID) AS Changed,
            (SELECT SUM((ISNULL(x.NewQty,0) - x.CurrentQty) * x.Value) FROM IcInvItem x WHERE x.InventoryId = c.InventoryID) AS DiscrepancyValue
       FROM IcInvDate c WHERE (@div IS NULL OR c.DivisionId = @div) ORDER BY c.InvDate DESC, c.InventoryID DESC`, { div: req.query.division || null });
  res.json({ rows });
}));

// "Process inventory count": post pending transactions, create the count and one line per active stocked item
router.post('/counts', h(async (req, res) => {
  const b = req.body || {};
  const date = isoDate(b.invDate), div = b.division, from = isoDate(b.fromDate), to = isoDate(b.toDate);
  if (!date) throw bad('Enter the inventory date');
  if (!div) throw bad('Choose a division');
  if (from && to && to < from) throw bad('The "to" date is before the "from" date');
  const out = await withTransaction(async (tx) => {
    const dup = await query('SELECT 1 AS x FROM IcInvDate WHERE CAST(InvDate AS date) = @d AND DivisionId = @div', { d: date, div }, tx);
    if (dup.length) throw bad('The inventory date selected already exists. Please enter a new inventory date.', 409);
    const posted = await postTransactions(tx, div, req.user.username);
    const id = await insertRow({ table: 'IcInvDate', idCol: 'InventoryID', columns: ['InvDate', 'DivisionId', 'FromDate', 'ToDate', 'Notes', 'Posted'] },
      { InvDate: date, DivisionId: div, FromDate: from, ToDate: to, Notes: b.notes || null, Posted: 0 }, req.user.username, tx);
    const base = await nextId(tx, 'IcInvItem', 'InventoryItemID');
    const lines = await query(
      `INSERT INTO IcInvItem (InventoryItemID, InventoryId, InvClassId, InvItemId, InvItem, Value, CurrentQty, NewQty, DateEntered, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY i.InvClassId, i.InvItem) - 1, @id, i.InvClassId, i.InvItemID, i.InvItem, ${COST}, d.QtyOnHand, d.QtyOnHand, GETDATE(), @u
         FROM IcItem i JOIN IcItemDivision d ON d.InvItemId = i.InvItemID
        WHERE d.DivisionId = @div AND i.StatusId = 1 AND (${COST}) IS NOT NULL;
       SELECT @@ROWCOUNT AS n`, { base, id, div, u: req.user.username }, tx);
    await query('UPDATE IcInvTransaction SET InventoryId = @id WHERE InventoryId IS NULL AND DivisionId = @div', { id, div }, tx);
    return { id, lines: lines[0].n, posted };
  });
  res.status(201).json(out);
}));

router.get('/counts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { id, s: req.query.search ? `%${req.query.search}%` : null, cls: int(req.query.classId), changed: req.query.changed === '1' ? 1 : 0, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE x.InventoryId = @id AND (@s IS NULL OR x.InvItem LIKE @s OR i.Description LIKE @s) AND (@cls IS NULL OR x.InvClassId = @cls) AND (@changed = 0 OR ISNULL(x.NewQty,0) <> x.CurrentQty)`;
  const [head, rows, total, sum] = await Promise.all([
    query('SELECT * FROM IcInvDate WHERE InventoryID = @id', { id }),
    query(`SELECT x.InventoryItemID, x.InvItemId, x.InvItem, i.Description, c.InvClass, x.Value, x.CurrentQty, x.NewQty, ISNULL(x.NewQty,0) - x.CurrentQty AS DiffQty, (ISNULL(x.NewQty,0) - x.CurrentQty) * x.Value AS DiffValue, x.Notes
             FROM IcInvItem x LEFT JOIN IcItem i ON i.InvItemID = x.InvItemId LEFT JOIN LsInvClass c ON c.InvClassID = x.InvClassId ${where}
            ORDER BY c.InvClass, x.InvItem OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM IcInvItem x LEFT JOIN IcItem i ON i.InvItemID = x.InvItemId ${where}`, p),
    query(`SELECT COUNT(*) AS lines, SUM(CASE WHEN ISNULL(NewQty,0) <> CurrentQty THEN 1 ELSE 0 END) AS changed, SUM(CAST(CurrentQty AS decimal(18,4)) * Value) AS currentValue,
                  SUM(CAST(ISNULL(NewQty,0) AS decimal(18,4)) * Value) AS newValue, SUM(CASE WHEN NewQty IS NULL THEN 1 ELSE 0 END) AS blanks FROM IcInvItem WHERE InventoryId = @id`, { id }),
  ]);
  if (!head[0]) return res.status(404).json({ error: 'Count not found' });
  res.json({ count: head[0], rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize, summary: sum[0] });
}));

router.put('/counts/lines/:lineId', h(async (req, res) => {
  const id = int(req.params.lineId);
  const b = req.body || {};
  const cur = await query('SELECT x.InventoryItemID, c.Posted FROM IcInvItem x JOIN IcInvDate c ON c.InventoryID = x.InventoryId WHERE x.InventoryItemID = @id', { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  if (cur[0].Posted) throw bad('This count has been posted and can no longer change.', 409);
  const o = {};
  if ('NewQty' in b) { o.NewQty = b.NewQty === '' || b.NewQty == null ? null : int(b.NewQty); if (o.NewQty != null && (isNaN(o.NewQty) || o.NewQty < -10000000)) throw bad('Enter a whole-number quantity'); }
  if ('Notes' in b) o.Notes = b.Notes || null;
  await updateRow({ table: 'IcInvItem', idCol: 'InventoryItemID', columns: ['NewQty', 'Notes'] }, id, o);
  res.json({ ok: true });
}));

// "Post inventory count": blanks count as 0, on-hand becomes the counted quantity
router.post('/counts/:id/post', h(async (req, res) => {
  const id = int(req.params.id);
  const out = await withTransaction(async (tx) => {
    const c = await query('SELECT InventoryID, DivisionId, Posted FROM IcInvDate WHERE InventoryID = @id', { id }, tx);
    if (!c[0]) throw bad('Count not found', 404);
    if (c[0].Posted) throw bad('This count has already been posted.', 409);
    await query('UPDATE IcInvItem SET NewQty = 0 WHERE InventoryId = @id AND NewQty IS NULL', { id }, tx);
    const r = await query(
      `UPDATE d SET d.QtyOnHand = x.NewQty FROM IcItemDivision d JOIN IcInvItem x ON x.InvItemId = d.InvItemId WHERE x.InventoryId = @id AND d.DivisionId = @div;
       SELECT @@ROWCOUNT AS n`, { id, div: c[0].DivisionId }, tx);
    await query('UPDATE IcInvDate SET Posted = 1 WHERE InventoryID = @id', { id }, tx);
    return { updated: r[0].n };
  });
  res.json(out);
}));
router.delete('/counts/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const c = await query('SELECT Posted FROM IcInvDate WHERE InventoryID = @id', { id }, tx);
    if (!c[0]) throw bad('Count not found', 404);
    if (c[0].Posted) throw bad('A posted count cannot be deleted.', 409);
    await query('UPDATE IcInvTransaction SET InventoryId = NULL WHERE InventoryId = @id', { id }, tx);
    await query('DELETE FROM IcInvItem WHERE InventoryId = @id', { id }, tx);
    await query('DELETE FROM IcInvDate WHERE InventoryID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Pack material: ship, then post to job cost (IcMaterialPost / IcPostPackMaterial)
// ---------------------------------------------------------------------------
router.get('/material/lots', h(async (req, res) => {
  const p = { div: req.query.division || null, s: req.query.search ? `%${req.query.search}%` : null };
  const rows = await query(
    `SELECT m.LotId, j.JobName, j.DivisionId, l.Lot, l.Block, l.Address, l.EndDate, COUNT(*) AS Lines, SUM(CASE WHEN m.ShippedQty IS NOT NULL THEN 1 ELSE 0 END) AS Shipped,
            MIN(m.DateEntered) AS Since, ph.Phase
       FROM JsPackMaterialTemp m JOIN JsLot l ON l.LotID = m.LotId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      WHERE (@div IS NULL OR j.DivisionId = @div) AND (@s IS NULL OR j.JobName LIKE @s OR l.Address LIKE @s OR l.Lot LIKE @s)
      GROUP BY m.LotId, j.JobName, j.DivisionId, l.Lot, l.Block, l.Address, l.EndDate, ph.Phase ORDER BY j.JobName, TRY_CAST(l.Lot AS int), l.Lot`, p);
  res.json({ rows });
}));
router.get('/material/lots/:lotId', h(async (req, res) => {
  const lotId = int(req.params.lotId);
  const [lot, lines, stages] = await Promise.all([
    query(`SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, l.EndDate, j.JobName, j.DivisionId, ph.Phase FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId WHERE l.LotID = @lotId`, { lotId }),
    query(`SELECT m.PackMatTempID, m.PackName, m.InvItemId, m.Item, i.Description, m.ScheduleStageId, ss.ScheduleStage, m.WorkId, w.WorkType, m.ScheduleQty, m.ShippedQty,
                  TRY_CAST(m.ShippedQty AS int) AS Shipped, m.JobCostPrice, m.DateEntered
             FROM JsPackMaterialTemp m LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = m.ScheduleStageId LEFT JOIN LsWork w ON w.WorkID = m.WorkId
            WHERE m.LotId = @lotId ORDER BY ss.ScheduleStage, m.Item`, { lotId }),
    query(`SELECT ss.ScheduleStage, w.WorkType, s.DeliveryDate, s.DatePosted FROM JsStage s JOIN LsScheduleStage ss ON ss.ScheduleStageID = s.ScheduleStageId JOIN LsWork w ON w.WorkID = s.WorkId WHERE s.LotId = @lotId ORDER BY s.DeliveryDate`, { lotId }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json({ lot: lot[0], lines, stages });
}));
// ship: all (= scheduled qty) | none (blank) | zero ; or per line { shipped: n | null }
router.post('/material/lots/:lotId/ship', h(async (req, res) => {
  const lotId = int(req.params.lotId), mode = req.body?.mode;
  if (!['all', 'none', 'zero'].includes(mode)) throw bad('Choose ship all, none or zero');
  const lot = await query('SELECT EndDate FROM JsLot WHERE LotID = @id', { id: lotId });
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  if (lot[0].EndDate) throw bad('This lot is closed. Open it before shipping material to it.', 409);
  const stage = int(req.body?.scheduleStageId);
  const set = mode === 'all' ? 'ShippedQty = CAST(ScheduleQty AS nvarchar(255)), UserSelect = @u' : mode === 'zero' ? "ShippedQty = '0', UserSelect = @u" : 'ShippedQty = NULL, UserSelect = NULL';
  const r = await query(`UPDATE JsPackMaterialTemp SET ${set} WHERE LotId = @lot AND (@stage IS NULL OR ScheduleStageId = @stage); SELECT @@ROWCOUNT AS n`, { lot: lotId, stage, u: req.user.username });
  res.json({ updated: r[0].n });
}));
router.put('/material/lines/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const cur = await query(`SELECT m.PackMatTempID, l.EndDate FROM JsPackMaterialTemp m JOIN JsLot l ON l.LotID = m.LotId WHERE m.PackMatTempID = @id`, { id });
  if (!cur[0]) return res.status(404).json({ error: 'Line not found' });
  if (cur[0].EndDate) throw bad('This lot is closed. Open it before changing shipments.', 409);
  const v = req.body?.shipped;
  const q = v === '' || v == null ? null : int(v);
  if (q != null && (isNaN(q) || q < 0)) throw bad('Shipped quantity must be 0 or more');
  await query('UPDATE JsPackMaterialTemp SET ShippedQty = @q, UserSelect = @u WHERE PackMatTempID = @id', { q: q == null ? null : String(q), u: q == null ? null : req.user.username, id });
  res.json({ ok: true });
}));
// "Post packs to job cost": shipped lines of a division become job cost rows; the shipped temp rows are cleared
router.post('/material/post', h(async (req, res) => {
  const div = req.body?.division;
  if (!div) throw bad('Choose a division');
  const out = await withTransaction(async (tx) => {
    const base = await nextId(tx, 'JcLotItem', 'JcItemID');
    const r = await query(
      `INSERT INTO JcLotItem (JcItemID, LotId, PackId, InvItemId, ScheduleStageId, WorkId, CostCodeId, ExtItemQty, JobCostPrice, Notes, DateEntered, UserEntered)
       SELECT @base + ROW_NUMBER() OVER (ORDER BY m.LotId, m.InvItemId, m.PackMatTempID) - 1, m.LotId, m.PackId, m.InvItemId, m.ScheduleStageId, m.WorkId, m.CostCodeId,
              TRY_CAST(m.ShippedQty AS int), m.JobCostPrice, 'Production pack', GETDATE(), @u
         FROM JsPackMaterialTemp m JOIN JsLot l ON l.LotID = m.LotId JOIN JsJob j ON j.JobId = l.JobId
        WHERE j.DivisionId = @div AND TRY_CAST(m.ShippedQty AS int) <> 0;
       SELECT @@ROWCOUNT AS n`, { base, div, u: req.user.username }, tx);
    const c = await query(
      `DELETE m FROM JsPackMaterialTemp m JOIN JsLot l ON l.LotID = m.LotId JOIN JsJob j ON j.JobId = l.JobId WHERE j.DivisionId = @div AND m.ShippedQty IS NOT NULL; SELECT @@ROWCOUNT AS n`, { div }, tx);
    return { jobCostLines: r[0].n, cleared: c[0].n };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.get('/reports/reorder', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 2000 d.DivisionId, c.InvClass, i.InvItemID, i.InvItem, i.Description, d.QtyOnHand, d.QtyReOrder, d.QtyOnOrder, d.QtyReOrder - d.QtyOnHand AS NeedToOrder, v.Vendor
       FROM IcItem i JOIN IcItemDivision d ON d.InvItemId = i.InvItemID LEFT JOIN IcVendor v ON v.VendorID = i.VendorId JOIN LsInvClass c ON c.InvClassID = i.InvClassId
      WHERE (@div IS NULL OR d.DivisionId = @div) AND d.QtyReOrder - d.QtyOnHand > 0 AND i.StatusId = 1 ORDER BY d.DivisionId, c.InvClass, i.InvItem`, { div: req.query.division || null });
  res.json({ rows });
}));
router.get('/reports/negative', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 2000 d.DivisionId, i.InvItemID, i.InvItem, i.Description, ISNULL(v.Vendor,'No preferred vendor') AS Vendor, d.QtyOnHand, d.QtyReOrder, d.QtyOnOrder, CAST(d.QtyOnHand AS decimal(18,4)) * ${COST} AS Value
       FROM IcItem i JOIN IcItemDivision d ON d.InvItemId = i.InvItemID LEFT JOIN IcVendor v ON v.VendorID = i.VendorId
      WHERE (@div IS NULL OR d.DivisionId = @div) AND d.QtyOnHand < 0 ORDER BY d.DivisionId, i.InvItem`, { div: req.query.division || null });
  res.json({ rows });
}));
router.get('/reports/value', h(async (req, res) => {
  const by = req.query.groupBy === 'division' ? 'division' : 'class';
  const rows = await query(
    `SELECT ${by === 'class' ? 'd.DivisionId, c.InvClass AS GroupLabel' : 'd.DivisionId AS GroupLabel'}, COUNT(DISTINCT d.InvItemId) AS Items, SUM(d.QtyOnHand) AS Qty,
            SUM(CAST(d.QtyOnHand AS decimal(18,4)) * CASE WHEN ISNULL(i.LastCost,0) <> 0 THEN i.LastCost ELSE i.JobCostPrice END) AS ValueLastCost,
            SUM(CAST(d.QtyOnHand AS decimal(18,4)) * CASE WHEN ISNULL(i.AverageCost,0) <> 0 THEN i.AverageCost ELSE i.JobCostPrice END) AS ValueAverageCost,
            SUM(CAST(d.QtyOnHand AS decimal(18,4)) * CASE WHEN ISNULL(i.JobCostPrice,0) <> 0 THEN i.JobCostPrice ELSE i.AverageCost END) AS ValueJobCost
       FROM IcItemDivision d JOIN IcItem i ON i.InvItemID = d.InvItemId JOIN LsInvClass c ON c.InvClassID = i.InvClassId
      WHERE (@div IS NULL OR d.DivisionId = @div) AND d.QtyOnHand <> 0 GROUP BY ${by === 'class' ? 'd.DivisionId, c.InvClass' : 'd.DivisionId'} ORDER BY ${by === 'class' ? 'd.DivisionId, c.InvClass' : 'd.DivisionId'}`, { div: req.query.division || null });
  const totals = rows.reduce((a, r) => ({ Items: a.Items + r.Items, ValueAverageCost: a.ValueAverageCost + (r.ValueAverageCost || 0), ValueLastCost: a.ValueLastCost + (r.ValueLastCost || 0), ValueJobCost: a.ValueJobCost + (r.ValueJobCost || 0) }), { Items: 0, ValueAverageCost: 0, ValueLastCost: 0, ValueJobCost: 0 });
  res.json({ rows, totals, groupBy: by });
}));
router.get('/reports/top', h(async (req, res) => {
  const basis = req.query.basis === 'qty' ? 'qty' : 'value';
  const rows = await query(
    `SELECT TOP 20 c.InvDate, c.DivisionId, i.InvItem, x.CurrentQty, x.NewQty, x.NewQty - x.CurrentQty AS DiffQty, x.Value, (x.NewQty - x.CurrentQty) * x.Value AS DiffValue
       FROM IcInvItem x JOIN IcInvDate c ON c.InventoryID = x.InventoryId JOIN IcItem i ON i.InvItemID = x.InvItemId
      WHERE x.InventoryId = @id AND x.NewQty IS NOT NULL ORDER BY ${basis === 'qty' ? 'ABS(x.NewQty - x.CurrentQty)' : 'ABS((x.NewQty - x.CurrentQty) * x.Value)'} DESC`, { id: int(req.query.countId) });
  res.json({ rows, basis });
}));
router.get('/reports/material-posted', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { div: req.query.division || null, from: isoDate(req.query.from), to: isoDate(req.query.to), cls: int(req.query.classId), offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE jc.CostCodeId <> 'L' AND (@div IS NULL OR j.DivisionId = @div) AND (@from IS NULL OR jc.DateEntered >= @from) AND (@to IS NULL OR jc.DateEntered < DATEADD(day,1,CAST(@to AS date))) AND (@cls IS NULL OR i.InvClassId = @cls)`;
  const from = `FROM JcLotItem jc JOIN IcItem i ON i.InvItemID = jc.InvItemId JOIN JsLot l ON l.LotID = jc.LotId JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId`;
  const [byClass, rows, total] = await Promise.all([
    query(`SELECT c.InvClass, COUNT(*) AS Lines, SUM(jc.ExtItemQty * jc.JobCostPrice) AS Value ${from} ${where} GROUP BY c.InvClass ORDER BY Value DESC`, p),
    query(`SELECT jc.JcItemID, jc.DateEntered, j.DivisionId, j.JobName, l.Lot, l.Block, i.InvItem, c.InvClass, jc.ExtItemQty, jc.JobCostPrice, jc.ExtItemQty * jc.JobCostPrice AS Value, jc.IcTransacPostedDate, jc.Notes
             ${from} ${where} ORDER BY jc.JcItemID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n, SUM(jc.ExtItemQty * jc.JobCostPrice) AS value ${from} ${where}`, p),
  ]);
  res.json({ rows, byClass, total: total[0].n, value: total[0].value, page: pg.page, pageSize: pg.pageSize });
}));

module.exports = router;
