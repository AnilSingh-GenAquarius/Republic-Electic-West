// Accounts receivable (AR) — lot billing, mirroring the Access SwitchAR flow:
//   1. Process billing  : open lots of a builder + division, each pack line (pack × stage × work) with its contract value
//   2. Submit invoice   : set a bill % (or a fixed amount) per line -> pre-bill snapshot (ArPreBillLot / ArPreBillPack)
//   3. Post billing     : snapshot -> invoices (ArBilling + ArBillingItem) with the builder's bill-to address, snapshot cleared
//   plus invoice maintenance (ArInvoice), manual invoices, and the AR reports (invoices, to-bill, WIP).
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null ? null : Number(v));
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const par = (tx, fns) => (tx ? fns.reduce((p, f) => p.then(async (a) => [...a, await f()]), Promise.resolve([])) : Promise.all(fns.map((f) => f())));
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Money is stored as text ("$1234.50", negatives "($107.00)")
const fmtMoney = (n) => (Number(n) < 0 ? `($${Math.abs(r2(n)).toFixed(2)})` : `$${r2(n).toFixed(2)}`);
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,2))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,2)) END)`;

router.get('/lookups', h(async (req, res) => {
  const [billTypes, terms, divisions, customers] = await Promise.all([
    query('SELECT BillTypeID AS id, BillType AS name FROM LsBillingType ORDER BY BillTypeID'),
    query('SELECT Terms AS id, Terms AS name, Days FROM LsTerms ORDER BY Days, Terms'),
    query("SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID"),
    query(`SELECT c.CustID AS id, c.CustName AS name FROM JsCustomer c WHERE EXISTS (SELECT 1 FROM JsJob j WHERE j.CustId = c.CustID) ORDER BY c.CustName`),
  ]);
  res.json({ billTypes, terms, divisions, customers });
}));

router.get('/overview', h(async (req, res) => {
  const [pre, inv, open, month] = await Promise.all([
    query(`SELECT COUNT(DISTINCT l.PreBillLotID) AS lots, COUNT(x.PreBillPackID) AS lines, SUM(CASE WHEN ISNULL(x.BillValue,0) <> 0 THEN x.BillValue ELSE ISNULL(x.Quantity,0) * ISNULL(x.ValueEa,0) * ISNULL(x.BillPercent,0) / 100 END) AS amount
             FROM ArPreBillLot l LEFT JOIN ArPreBillPack x ON x.PreBillLotId = l.PreBillLotID`),
    query(`SELECT TOP 8 b.BillID, b.Date, b.CustName, b.JobName, b.LotBlock, ${MV('b.BillTotal')} AS Total FROM ArBilling b ORDER BY b.BillID DESC`),
    query(`SELECT COUNT(*) AS lots FROM JsLot WHERE EndDate IS NULL AND StatusId = 1`),
    query(`SELECT FORMAT(b.Date,'yyyy-MM') AS month, COUNT(*) AS invoices, SUM(${MV('b.BillTotal')}) AS total FROM ArBilling b WHERE b.Date >= DATEADD(month,-5,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)) GROUP BY FORMAT(b.Date,'yyyy-MM') ORDER BY month`),
  ]);
  res.json({ prebill: pre[0], recent: inv, openLots: open[0].lots, months: month });
}));

// ---------------------------------------------------------------------------
// 1) Lots to bill
// ---------------------------------------------------------------------------
// The billable lines of lots: one per pack × stage × work value (falls back to the pack's contract value)
const LINES = `
  SELECT jp.LotId, jp.PackID, pk.PackName, pk.BuilderCode AS ItemCode, jp.PackQty AS Quantity, ISNULL(jv.ScheduleStageId,0) AS ScheduleStageId, ISNULL(ss.ScheduleStage,'Default') AS ScheduleStage,
         ISNULL(jv.WorkId,0) AS WorkId, ISNULL(w.WorkType,'Default') AS WorkType,
         CASE WHEN jv.JsValueID IS NULL THEN CASE WHEN jp.RevContractEa IS NOT NULL THEN ${MV('jp.RevContractEa')} ELSE ${MV('jp.ContractEa')} END
              WHEN ISNULL(${MV('jv.RevContract')},0) <> 0 THEN ${MV('jv.RevContract')} WHEN ISNULL(${MV('jv.Contract')},0) <> 0 THEN ${MV('jv.Contract')}
              ELSE CASE WHEN jp.RevContractEa IS NOT NULL THEN ${MV('jp.RevContractEa')} ELSE ${MV('jp.ContractEa')} END END AS ValueEa
    FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId
    LEFT JOIN JsValue jv ON jv.PackId = jp.PackID LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = jv.ScheduleStageId LEFT JOIN LsWork w ON w.WorkID = jv.WorkId`;

router.get('/to-bill', h(async (req, res) => {
  const cust = int(req.query.customerId), div = req.query.division;
  if (!cust || !div) throw bad('Choose a builder and a division');
  const p = { cust, div, job: int(req.query.jobId) };
  const lots = await query(
    `SELECT l.LotID, j.JobId, j.JobName, j.JobNum, l.Lot, l.Block, pl.PlanNum, l.Address, l.City, l.State, l.LotNotes, ph.Phase,
            (SELECT SUM(x.Quantity * x.ValueEa) FROM (${LINES}) x WHERE x.LotId = l.LotID) AS Contract,
            (SELECT SUM(${MV('b.BillTotal')}) FROM ArBilling b WHERE b.LotId = l.LotID) AS Billed,
            (SELECT COUNT(*) FROM ArBilling b WHERE b.LotId = l.LotID) AS Invoices,
            (SELECT SUM(CASE WHEN ISNULL(q.BillValue,0) <> 0 THEN q.BillValue ELSE ISNULL(q.Quantity,0) * ISNULL(q.ValueEa,0) * ISNULL(q.BillPercent,0) / 100 END) FROM ArPreBillPack q WHERE q.LotId = l.LotID) AS Queued
       FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      WHERE j.CustId = @cust AND j.DivisionId = @div AND l.EndDate IS NULL AND l.StatusId = 1 AND (@job IS NULL OR j.JobId = @job)
      ORDER BY j.JobName, TRY_CAST(l.Lot AS int), l.Lot, l.Block`, p);
  const jobs = await query(`SELECT DISTINCT j.JobId AS id, j.JobName AS name FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId WHERE j.CustId = @cust AND j.DivisionId = @div AND l.EndDate IS NULL AND l.StatusId = 1 ORDER BY j.JobName`, p);
  const bill = await query('SELECT TOP 1 CustContact, BillAddress, BillCity, BillState, BillZip FROM JsCustomerBillAddres WHERE CustID = @cust AND DivisionId = @div', p);
  res.json({ lots, jobs, billTo: bill[0] || null });
}));

router.get('/lots/:lotId/lines', h(async (req, res) => {
  const lotId = int(req.params.lotId);
  const [lot, lines, queued, notes] = await Promise.all([
    query(`SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, l.State, l.LotNotes, l.EndDate, l.StatusId, j.JobId, j.JobName, j.JobNum, j.DivisionId, j.CustId, c.CustName, pl.PlanNum, ph.Phase,
                  ${MV('l.Contract')} AS LotContract, ${MV('l.RevContract')} AS LotRevContract
             FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId WHERE l.LotID = @lotId`, { lotId }),
    query(`WITH ln AS (${LINES})
           SELECT ln.PackID, ln.PackName, ln.ItemCode, ln.Quantity, ln.ScheduleStageId, ln.ScheduleStage, ln.WorkId, ln.WorkType, ln.ValueEa, ln.Quantity * ln.ValueEa AS ExtValue,
                  ISNULL((SELECT SUM(bi.BillPercent) FROM ArBillingItem bi JOIN ArBilling b ON b.BillID = bi.BillId WHERE b.LotId = ln.LotId AND bi.PackId = ln.PackID AND ISNULL(bi.ScheduleStageId,0) = ln.ScheduleStageId AND ISNULL(bi.WorkId,0) = ln.WorkId),0) AS BilledPercent,
                  ISNULL((SELECT SUM(${MV('bi.ItemTotal')}) FROM ArBillingItem bi JOIN ArBilling b ON b.BillID = bi.BillId WHERE b.LotId = ln.LotId AND bi.PackId = ln.PackID AND ISNULL(bi.ScheduleStageId,0) = ln.ScheduleStageId AND ISNULL(bi.WorkId,0) = ln.WorkId),0) AS BilledAmount,
                  CASE WHEN EXISTS (SELECT 1 FROM PrLaborPaid pp WHERE pp.LotId = ln.LotId AND pp.PackId = ln.PackID) THEN 1 ELSE 0 END AS PayrollPaid,
                  CASE WHEN EXISTS (SELECT 1 FROM JsStage s WHERE s.LotId = ln.LotId AND s.ScheduleStageId = ln.ScheduleStageId AND s.DatePosted IS NOT NULL) THEN 1 ELSE 0 END AS StagePosted
             FROM ln WHERE ln.LotId = @lotId ORDER BY ln.PackName, ln.ScheduleStage, ln.WorkType`, { lotId }),
    query(`SELECT q.PreBillPackID, q.PackId, q.ScheduleStageId, q.WorkId, q.BillPercent, q.BillValue, q.Notes, l.InvDate, l.BillTypeId, l.Terms, l.Lien, l.PreBillLotID
             FROM ArPreBillPack q JOIN ArPreBillLot l ON l.PreBillLotID = q.PreBillLotId WHERE q.LotId = @lotId`, { lotId }),
    query(`SELECT TOP 30 b.BillID, b.Date, b.BillTotal, bi.PackName, bi.ScheduleStage, bi.WorkType, bi.BillPercent, bi.ItemTotal, bi.Notes FROM ArBillingItem bi JOIN ArBilling b ON b.BillID = bi.BillId WHERE b.LotId = @lotId ORDER BY b.BillID DESC, bi.BillItemID`, { lotId }),
  ]);
  if (!lot[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json({ lot: lot[0], lines, queued, history: notes });
}));

// 2) Submit: put the entered lines of one lot into the pre-bill snapshot (replaces that lot's snapshot)
router.post('/prebill', h(async (req, res) => {
  const b = req.body || {};
  const lotId = int(b.lotId);
  const date = isoDate(b.invoiceDate);
  if (!lotId) throw bad('Choose a lot');
  if (!date) throw bad('Enter the invoice date');
  const lines = (b.lines || []).filter((l) => Number(l.billPercent) !== 0 && l.billPercent !== '' && l.billPercent != null || (l.billValue !== '' && l.billValue != null && Number(l.billValue) !== 0));
  if (!lines.length) throw bad('Enter a bill % (or an amount) on at least one line');
  for (const l of lines) {
    const pct = num(l.billPercent) || 0, val = num(l.billValue) || 0;
    if (isNaN(pct) || pct < 0 || pct > 100) throw bad('Bill % must be between 0 and 100');
    if (isNaN(val)) throw bad('Enter a valid amount');
  }
  const out = await withTransaction(async (tx) => {
    const ctx = await query(`SELECT l.LotID, l.Lot, l.Block, l.Address, l.City, l.State, l.EndDate, j.JobId, j.JobName, j.JobNum, j.DivisionId, j.CustId, c.CustName, pl.PlanNum
        FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId WHERE l.LotID = @id`, { id: lotId }, tx);
    if (!ctx[0]) throw bad('Lot not found', 404);
    const L = ctx[0];
    const avail = await query(`WITH ln AS (${LINES}) SELECT ln.PackID, ln.PackName, ln.ItemCode, ln.Quantity, ln.ScheduleStageId, ln.ScheduleStage, ln.WorkId, ln.WorkType, ln.ValueEa,
        ISNULL((SELECT SUM(bi.BillPercent) FROM ArBillingItem bi JOIN ArBilling bb ON bb.BillID = bi.BillId WHERE bb.LotId = ln.LotId AND bi.PackId = ln.PackID AND ISNULL(bi.ScheduleStageId,0) = ln.ScheduleStageId AND ISNULL(bi.WorkId,0) = ln.WorkId),0) AS Billed
        FROM ln WHERE ln.LotId = @id`, { id: lotId }, tx);
    const key = (a) => `${a.PackID ?? a.packId}.${a.ScheduleStageId ?? a.scheduleStageId ?? 0}.${a.WorkId ?? a.workId ?? 0}`;
    const map = new Map(avail.map((a) => [key(a), a]));
    const over = [];
    const resolved = lines.map((l) => {
      const a = map.get(key({ packId: l.packId, scheduleStageId: l.scheduleStageId, workId: l.workId }));
      if (!a) throw bad('One of the lines does not belong to this lot any more. Reload and try again.', 409);
      const pct = num(l.billPercent) || 0;
      if (pct + Number(a.Billed) > 100.0001) over.push(`${a.PackName} (${a.ScheduleStage}/${a.WorkType}): ${a.Billed}% already billed`);
      return { a, pct, val: num(l.billValue) || 0, notes: l.notes || null };
    });
    if (over.length && !b.force) throw Object.assign(bad(`These lines would be billed above 100% in total:\n${over.join('\n')}`, 409), { needsConfirm: true });
    // one pre-bill per lot: replace
    const old = await query('SELECT PreBillLotID FROM ArPreBillLot WHERE LotId = @id', { id: lotId }, tx);
    for (const o of old) { await query('DELETE FROM ArPreBillPack WHERE PreBillLotId = @p', { p: o.PreBillLotID }, tx); await query('DELETE FROM ArPreBillLot WHERE PreBillLotID = @p', { p: o.PreBillLotID }, tx); }
    const ins = await query(`INSERT INTO ArPreBillLot (InvDate, CustId, Customer, DivisionId, JobId, JobName, JobNum, LotId, LotBlock, PlanNum, Address, BillTypeId, Terms, Lien, UserSelect)
                 OUTPUT INSERTED.PreBillLotID AS id VALUES (@d, @cust, @cn, @div, @job, @jn, @jnum, @lot, @lb, @plan, @addr, @bt, @terms, @lien, @u)`,
      { d: date, cust: L.CustId, cn: L.CustName, div: L.DivisionId, job: L.JobId, jn: L.JobName, jnum: L.JobNum, lot: lotId, lb: `${L.Lot ?? ''}/${L.Block ?? ''}`, plan: L.PlanNum,
        addr: [L.Address, L.City, L.State].filter(Boolean).join(', '), bt: int(b.billTypeId) || 1, terms: b.terms || 'Net 30', lien: b.lien || 'Progress', u: req.user.username }, tx);
    const lotRowId = ins[0].id;
    let i = 0;
    for (const r of resolved) {
      await query(`INSERT INTO ArPreBillPack (PreBillLotId, LotId, PackName, PackId, ScheduleStage, ScheduleStageId, WorkType, WorkId, ComboId, ItemCode, Quantity, ValueEa, BillPercent, BillValue, Notes, UserSelect)
                   VALUES (@pl, @lot, @pn, @pk, @ss, @ssid, @wt, @wid, @combo, @code, @q, @v, @pct, @bv, @notes, @u)`,
        { pl: lotRowId, lot: lotId, pn: r.a.PackName, pk: r.a.PackID, ss: r.a.ScheduleStage, ssid: r.a.ScheduleStageId, wt: r.a.WorkType, wid: r.a.WorkId,
          combo: Number(`${r.a.PackID}.${r.a.ScheduleStageId}${r.a.WorkId}`), code: r.a.ItemCode, q: r.a.Quantity, v: r.a.ValueEa, pct: r.pct, bv: r.val, notes: r.notes, u: req.user.username }, tx);
      i++;
    }
    return { preBillLotId: lotRowId, lines: i };
  });
  res.status(201).json(out);
}));

// Snapshot view + maintenance
router.get('/prebill', h(async (req, res) => {
  const p = { cust: int(req.query.customerId), div: req.query.division || null };
  const lots = await query(
    `SELECT l.PreBillLotID, l.InvDate, l.CustId, l.Customer, l.DivisionId, l.JobId, l.JobName, l.LotId, l.LotBlock, l.PlanNum, l.Address, l.BillTypeId, l.Terms, l.Lien, l.UserSelect,
            (SELECT SUM(CASE WHEN ISNULL(x.BillValue,0) <> 0 THEN x.BillValue ELSE ISNULL(x.Quantity,0) * ISNULL(x.ValueEa,0) * ISNULL(x.BillPercent,0) / 100 END) FROM ArPreBillPack x WHERE x.PreBillLotId = l.PreBillLotID) AS Amount,
            (SELECT COUNT(*) FROM ArPreBillPack x WHERE x.PreBillLotId = l.PreBillLotID) AS Lines
       FROM ArPreBillLot l WHERE (@cust IS NULL OR l.CustId = @cust) AND (@div IS NULL OR l.DivisionId = @div) ORDER BY l.Customer, l.JobName, l.LotBlock`, p);
  const lines = lots.length ? await query(
    `SELECT x.PreBillPackID, x.PreBillLotId, x.PackName, x.ScheduleStage, x.WorkType, x.ItemCode, x.Quantity, x.ValueEa, x.BillPercent, x.BillValue, x.Notes,
            CASE WHEN ISNULL(x.BillValue,0) <> 0 THEN x.BillValue ELSE ISNULL(x.Quantity,0) * ISNULL(x.ValueEa,0) * ISNULL(x.BillPercent,0) / 100 END AS Amount
       FROM ArPreBillPack x JOIN ArPreBillLot l ON l.PreBillLotID = x.PreBillLotId WHERE (@cust IS NULL OR l.CustId = @cust) AND (@div IS NULL OR l.DivisionId = @div) ORDER BY x.PreBillLotId, x.PackName`, p) : [];
  const groups = await query(`SELECT l.CustId, l.Customer, l.DivisionId, COUNT(*) AS Lots, MIN(l.InvDate) AS InvDate FROM ArPreBillLot l GROUP BY l.CustId, l.Customer, l.DivisionId ORDER BY l.Customer`);
  res.json({ lots, lines, groups, total: lots.reduce((a, l) => a + Number(l.Amount || 0), 0) });
}));
router.delete('/prebill/lots/:id', h(async (req, res) => { const id = int(req.params.id); await withTransaction(async (tx) => { await query('DELETE FROM ArPreBillPack WHERE PreBillLotId = @id', { id }, tx); await query('DELETE FROM ArPreBillLot WHERE PreBillLotID = @id', { id }, tx); }); res.json({ ok: true }); }));
router.delete('/prebill/lines/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const x = await query('SELECT PreBillLotId FROM ArPreBillPack WHERE PreBillPackID = @id', { id }, tx);
    if (!x[0]) throw bad('Line not found', 404);
    await query('DELETE FROM ArPreBillPack WHERE PreBillPackID = @id', { id }, tx);
    const left = await query('SELECT COUNT(*) AS n FROM ArPreBillPack WHERE PreBillLotId = @p', { p: x[0].PreBillLotId }, tx);
    if (!left[0].n) await query('DELETE FROM ArPreBillLot WHERE PreBillLotID = @p', { p: x[0].PreBillLotId }, tx);
  });
  res.json({ ok: true });
}));
// "Clear billing snapshot" for a builder + division
router.post('/prebill/clear', h(async (req, res) => {
  const cust = int(req.body?.customerId), div = req.body?.division;
  if (!cust || !div) throw bad('Choose a builder and a division');
  const out = await withTransaction(async (tx) => {
    const l = await query('SELECT PreBillLotID FROM ArPreBillLot WHERE CustId = @c AND DivisionId = @d', { c: cust, d: div }, tx);
    for (const x of l) await query('DELETE FROM ArPreBillPack WHERE PreBillLotId = @p', { p: x.PreBillLotID }, tx);
    await query('DELETE FROM ArPreBillLot WHERE CustId = @c AND DivisionId = @d', { c: cust, d: div }, tx);
    return { cleared: l.length };
  });
  res.json(out);
}));

// 3) Post billing: pre-bill snapshot -> invoices
router.post('/post', h(async (req, res) => {
  const cust = int(req.body?.customerId), div = req.body?.division, date = isoDate(req.body?.invoiceDate);
  if (!date) throw bad('Please enter the invoice date');
  if (!cust) throw bad('Please select the builder to post');
  if (!div) throw bad('Please select the division to post');
  const out = await withTransaction(async (tx) => {
    const lots = await query('SELECT * FROM ArPreBillLot WHERE CustId = @c AND DivisionId = @d ORDER BY PreBillLotID', { c: cust, d: div }, tx);
    if (!lots.length) throw bad('There is nothing to post for this builder and division. Submit invoices first.', 409);
    const addr = await query('SELECT TOP 1 * FROM JsCustomerBillAddres WHERE CustID = @c AND DivisionId = @d', { c: cust, d: div }, tx);
    const A = addr[0] || {};
    let billBase = await nextId(tx, 'ArBilling', 'BillID');
    let itemBase = await nextId(tx, 'ArBillingItem', 'BillItemID');
    const invoices = [];
    for (const lot of lots) {
      const items = await query('SELECT * FROM ArPreBillPack WHERE PreBillLotId = @p ORDER BY PreBillPackID', { p: lot.PreBillLotID }, tx);
      if (!items.length) continue;
      const amt = (x) => (Number(x.BillValue || 0) !== 0 ? Number(x.BillValue) : Number(x.Quantity || 0) * Number(x.ValueEa || 0) * Number(x.BillPercent || 0) / 100);
      const total = r2(items.reduce((a, x) => a + amt(x), 0));
      const jn = await query('SELECT JobNum FROM JsJob WHERE JobId = @j', { j: lot.JobId }, tx);
      const billId = billBase++;
      await query(
        `INSERT INTO ArBilling (BillID, PreBillLotId, Date, BillTypeId, CustomerId, CustName, DivisionId, JobId, JobName, JobNum, LotId, LotBlock, Terms, Lien, CustContact, BillAddress, BillCity, BillState, BillZip, BillTotal)
         VALUES (@id, @pl, @d, @bt, @c, @cn, @div, @job, @jn, @jnum, @lot, @lb, @terms, @lien, @cc, @ba, @bc, @bs, @bz, @tot)`,
        { id: billId, pl: lot.PreBillLotID, d: date, bt: lot.BillTypeId || 1, c: lot.CustId, cn: lot.Customer, div: lot.DivisionId, job: lot.JobId, jn: lot.JobName, jnum: jn[0]?.JobNum ?? lot.JobNum, lot: lot.LotId, lb: lot.LotBlock,
          terms: lot.Terms, lien: lot.Lien, cc: A.CustContact || null, ba: A.BillAddress || null, bc: A.BillCity || null, bs: A.BillState || null, bz: int(A.BillZip), tot: fmtMoney(total) }, tx);
      for (const x of items) {
        await query(
          `INSERT INTO ArBillingItem (BillItemID, BillId, PackName, PackId, ScheduleStage, ScheduleStageId, WorkType, WorkId, ComboId, ItemCode, Quantity, ValueEa, BillPercent, ItemTotal, Notes, DateEntered, UserEntered)
           VALUES (@id, @b, @pn, @pk, @ss, @ssid, @wt, @wid, @combo, @code, @q, @v, @pct, @tot, @notes, GETDATE(), @u)`,
          { id: itemBase++, b: billId, pn: x.PackName, pk: x.PackId, ss: x.ScheduleStage, ssid: x.ScheduleStageId, wt: x.WorkType, wid: x.WorkId, combo: x.ComboId, code: x.ItemCode, q: Math.round(Number(x.Quantity || 0)),
            v: fmtMoney(x.ValueEa || 0), pct: x.BillPercent, tot: fmtMoney(amt(x)), notes: x.Notes, u: req.user.username }, tx);
      }
      invoices.push({ billId, lot: lot.LotBlock, total });
    }
    for (const lot of lots) { await query('DELETE FROM ArPreBillPack WHERE PreBillLotId = @p', { p: lot.PreBillLotID }, tx); }
    await query('DELETE FROM ArPreBillLot WHERE CustId = @c AND DivisionId = @d', { c: cust, d: div }, tx);
    return { invoices, total: r2(invoices.reduce((a, i) => a + i.total, 0)), missingBillTo: !addr[0] };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
router.get('/invoices', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 25 });
  const p = { s: req.query.search ? `%${req.query.search}%` : null, cust: int(req.query.customerId), div: req.query.division || null, job: int(req.query.jobId), from: isoDate(req.query.from), to: isoDate(req.query.to),
    type: int(req.query.typeId), offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR b.CustName LIKE @s OR b.JobName LIKE @s OR b.LotBlock LIKE @s OR CAST(b.BillID AS varchar(20)) LIKE @s OR CAST(b.BillNum AS varchar(20)) LIKE @s)
    AND (@cust IS NULL OR b.CustomerId = @cust) AND (@div IS NULL OR b.DivisionId = @div) AND (@job IS NULL OR b.JobId = @job) AND (@from IS NULL OR b.Date >= @from) AND (@to IS NULL OR b.Date <= @to) AND (@type IS NULL OR b.BillTypeId = @type)`;
  const [rows, total, sum] = await Promise.all([
    query(`SELECT b.BillID, b.BillNum, b.Date, b.BillTypeId, bt.BillType, b.CustName, b.DivisionId, b.JobId, b.JobName, b.LotId, b.LotBlock, b.Terms, b.Lien, ${MV('b.BillTotal')} AS Total
             FROM ArBilling b LEFT JOIN LsBillingType bt ON bt.BillTypeID = b.BillTypeId ${where} ORDER BY b.Date DESC, b.BillID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n FROM ArBilling b ${where}`, p),
    query(`SELECT SUM(${MV('b.BillTotal')}) AS amount FROM ArBilling b ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, amount: sum[0].amount, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/invoices/:id', h(async (req, res) => {
  const id = int(req.params.id);
  const [head, items] = await Promise.all([
    query(`SELECT b.*, ${MV('b.BillTotal')} AS Total, bt.BillType FROM ArBilling b LEFT JOIN LsBillingType bt ON bt.BillTypeID = b.BillTypeId WHERE b.BillID = @id`, { id }),
    query(`SELECT bi.*, ${MV('bi.ValueEa')} AS ValueNum, ${MV('bi.ItemTotal')} AS TotalNum FROM ArBillingItem bi WHERE bi.BillId = @id ORDER BY bi.BillItemID`, { id }),
  ]);
  if (!head[0]) return res.status(404).json({ error: 'Invoice not found' });
  const lot = head[0].LotId ? await query('SELECT l.Lot, l.Block, l.Address, l.City, l.State FROM JsLot l WHERE l.LotID = @id', { id: head[0].LotId }) : [];
  res.json({ invoice: head[0], items, lot: lot[0] || null });
}));

const INV = { table: 'ArBilling', idCol: 'BillID', columns: ['BillNum', 'PreBillLotId', 'Date', 'BillTypeId', 'CustomerId', 'CustName', 'DivisionId', 'JobId', 'JobName', 'JobNum', 'LotId', 'LotBlock', 'Terms', 'Lien', 'CustContact', 'BillAddress', 'BillCity', 'BillState', 'BillZip', 'Notes', 'BillTotal'], audit: false };
const ITEM = { table: 'ArBillingItem', idCol: 'BillItemID', columns: ['BillId', 'PackName', 'PackId', 'ScheduleStage', 'ScheduleStageId', 'WorkType', 'WorkId', 'ComboId', 'ItemCode', 'Quantity', 'ValueEa', 'BillPercent', 'ItemTotal', 'Notes'] };

async function recalc(tx, billId) {
  const r = await query(`SELECT ISNULL(SUM(${MV('ItemTotal')}),0) AS t FROM ArBillingItem WHERE BillId = @id`, { id: billId }, tx);
  await query('UPDATE ArBilling SET BillTotal = @t WHERE BillID = @id', { t: fmtMoney(r[0].t), id: billId }, tx);
}
router.put('/invoices/:id', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, o = {};
  for (const k of ['Terms', 'Lien', 'Notes', 'CustContact', 'BillAddress', 'BillCity', 'BillState']) if (k in b) o[k] = b[k] || null;
  if ('Date' in b) { o.Date = isoDate(b.Date); if (!o.Date) throw bad('Enter a valid invoice date'); }
  if ('BillTypeId' in b) { o.BillTypeId = int(b.BillTypeId); if (![1, 2, 3].includes(o.BillTypeId)) throw bad('Choose an invoice type'); }
  if ('BillZip' in b) o.BillZip = int(b.BillZip);
  if ('BillNum' in b) o.BillNum = int(b.BillNum);
  const n = await updateRow(INV, id, o);
  if (!n) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ok: true });
}));
router.delete('/invoices/:id', h(async (req, res) => {
  const id = int(req.params.id);
  await withTransaction(async (tx) => {
    const x = await query('SELECT BillID FROM ArBilling WHERE BillID = @id', { id }, tx);
    if (!x[0]) throw bad('Invoice not found', 404);
    await query('DELETE FROM ArBillingItem WHERE BillId = @id', { id }, tx);
    await deleteRow(INV, id, tx);
  });
  res.json({ ok: true });
}));
// Manual invoice (Access "New invoice" / ArInvoiceManual)
router.post('/invoices', h(async (req, res) => {
  const b = req.body || {};
  const lotId = int(b.LotId);
  if (!lotId) throw bad('Choose a lot');
  const date = isoDate(b.Date) || new Date().toISOString().slice(0, 10);
  const id = await withTransaction(async (tx) => {
    const L = await query(`SELECT l.LotID, l.Lot, l.Block, j.JobId, j.JobName, j.JobNum, j.DivisionId, j.CustId, c.CustName FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId WHERE l.LotID = @id`, { id: lotId }, tx);
    if (!L[0]) throw bad('Lot not found', 404);
    const A = (await query('SELECT TOP 1 * FROM JsCustomerBillAddres WHERE CustID = @c AND DivisionId = @d', { c: L[0].CustId, d: L[0].DivisionId }, tx))[0] || {};
    return insertRow(INV, { Date: date, BillTypeId: int(b.BillTypeId) || 1, CustomerId: L[0].CustId, CustName: L[0].CustName, DivisionId: L[0].DivisionId, JobId: L[0].JobId, JobName: L[0].JobName, JobNum: L[0].JobNum, LotId: lotId,
      LotBlock: `${L[0].Lot ?? ''}/${L[0].Block ?? ''}`, Terms: b.Terms || 'Net 30', Lien: b.Lien || 'Progress', CustContact: A.CustContact || null, BillAddress: A.BillAddress || null, BillCity: A.BillCity || null, BillState: A.BillState || null,
      BillZip: int(A.BillZip), Notes: b.Notes || null, BillTotal: '$0.00' }, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.post('/invoices/:id/items', h(async (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const name = String(b.PackName || '').trim();
  if (!name) throw bad('Enter a description');
  const qty = num(b.Quantity ?? 1), val = num(b.ValueEa ?? 0), pct = num(b.BillPercent ?? 100);
  if ([qty, val, pct].some((v) => v == null || isNaN(v))) throw bad('Quantity, value and % must be numbers');
  if (pct < 0 || pct > 100) throw bad('Bill % must be between 0 and 100');
  const iid = await withTransaction(async (tx) => {
    const x = await query('SELECT BillID FROM ArBilling WHERE BillID = @id', { id }, tx);
    if (!x[0]) throw bad('Invoice not found', 404);
    const total = r2(qty * val * pct / 100);
    const n = await insertRow(ITEM, { BillId: id, PackName: name, PackId: int(b.PackId) || 0, ScheduleStage: b.ScheduleStage || 'Default', ScheduleStageId: int(b.ScheduleStageId) || 0, WorkType: b.WorkType || 'Default', WorkId: int(b.WorkId) || 0,
      ComboId: 0, ItemCode: b.ItemCode || null, Quantity: Math.round(qty), ValueEa: fmtMoney(val), BillPercent: pct, ItemTotal: fmtMoney(total), Notes: b.Notes || null }, req.user.username, tx);
    await recalc(tx, id);
    return n;
  });
  res.status(201).json({ id: iid });
}));
router.put('/invoice-items/:iid', h(async (req, res) => {
  const iid = int(req.params.iid), b = req.body || {};
  await withTransaction(async (tx) => {
    const x = await query('SELECT BillItemID, BillId, Quantity, BillPercent, ValueEa FROM ArBillingItem WHERE BillItemID = @id', { id: iid }, tx);
    if (!x[0]) throw bad('Line not found', 404);
    const qty = 'Quantity' in b ? num(b.Quantity) : x[0].Quantity, pct = 'BillPercent' in b ? num(b.BillPercent) : Number(x[0].BillPercent);
    const val = 'ValueEa' in b ? num(b.ValueEa) : Number(String(x[0].ValueEa || '0').replace(/[$,()]/g, '')) * (String(x[0].ValueEa || '').includes('(') ? -1 : 1);
    if ([qty, pct, val].some((v) => v == null || isNaN(v))) throw bad('Quantity, value and % must be numbers');
    if (pct < 0 || pct > 100) throw bad('Bill % must be between 0 and 100');
    const o = { Quantity: Math.round(qty), ValueEa: fmtMoney(val), BillPercent: pct, ItemTotal: fmtMoney(r2(qty * val * pct / 100)) };
    if ('Notes' in b) o.Notes = b.Notes || null;
    await updateRow(ITEM, iid, o, tx);
    await recalc(tx, x[0].BillId);
  });
  res.json({ ok: true });
}));
router.delete('/invoice-items/:iid', h(async (req, res) => {
  const iid = int(req.params.iid);
  await withTransaction(async (tx) => {
    const x = await query('SELECT BillId FROM ArBillingItem WHERE BillItemID = @id', { id: iid }, tx);
    if (!x[0]) throw bad('Line not found', 404);
    await deleteRow(ITEM, iid, tx); await recalc(tx, x[0].BillId);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const GROUPS = { division: ['b.DivisionId', "ISNULL(b.DivisionId,'(none)')"], customer: ['b.CustomerId', "ISNULL(MAX(b.CustName),'(none)')"], job: ['b.JobId', 'MAX(b.JobName)'], month: ["FORMAT(b.Date,'yyyy-MM')", "FORMAT(b.Date,'yyyy-MM')"], day: ['CAST(b.Date AS date)', "CONVERT(varchar(10), CAST(b.Date AS date), 23)"] };
router.get('/reports/invoices', h(async (req, res) => {
  const g = GROUPS[req.query.groupBy] || GROUPS.division;
  const p = { from: isoDate(req.query.from), to: isoDate(req.query.to), div: req.query.division || null, cust: int(req.query.customerId) };
  const rows = await query(`SELECT TOP 1000 ${g[0]} AS GroupKey, ${g[1]} AS GroupLabel, COUNT(*) AS Invoices, SUM(${MV('b.BillTotal')}) AS Total, MIN(b.Date) AS First, MAX(b.Date) AS Last
      FROM ArBilling b WHERE (@from IS NULL OR b.Date >= @from) AND (@to IS NULL OR b.Date <= @to) AND (@div IS NULL OR b.DivisionId = @div) AND (@cust IS NULL OR b.CustomerId = @cust)
      GROUP BY ${g[0]} ORDER BY ${req.query.groupBy === 'month' || req.query.groupBy === 'day' ? 'GroupKey DESC' : 'Total DESC'}`, p);
  res.json({ rows, totals: rows.reduce((a, r) => ({ Invoices: a.Invoices + r.Invoices, Total: a.Total + (r.Total || 0) }), { Invoices: 0, Total: 0 }) });
}));

// Lots with value left to bill ("Lot-pack to bill"): contract, billed, remaining; payroll/stage readiness
router.get('/reports/to-bill', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { div: req.query.division || null, cust: int(req.query.customerId), onlyReady: req.query.ready === '1' ? 1 : 0, offset: pg.offset, pageSize: pg.pageSize };
  const from = `FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
    CROSS APPLY (SELECT SUM(x.Quantity * x.ValueEa) AS Contract FROM (${LINES}) x WHERE x.LotId = l.LotID) k
    CROSS APPLY (SELECT ISNULL(SUM(${MV('b.BillTotal')}),0) AS Billed FROM ArBilling b WHERE b.LotId = l.LotID) bb
    CROSS APPLY (SELECT COUNT(DISTINCT s.ScheduleStageId) AS PostedStages FROM JsStage s WHERE s.LotId = l.LotID AND s.DatePosted IS NOT NULL) st
    CROSS APPLY (SELECT COUNT(*) AS Paid FROM PrLaborPaid pp WHERE pp.LotId = l.LotID) pd
    WHERE l.EndDate IS NULL AND l.StatusId = 1 AND (@div IS NULL OR j.DivisionId = @div) AND (@cust IS NULL OR j.CustId = @cust) AND ISNULL(k.Contract,0) > 0 AND k.Contract - bb.Billed > 0.005
      AND (@onlyReady = 0 OR st.PostedStages > 0)`;
  const [rows, total, sum] = await Promise.all([
    query(`SELECT l.LotID, j.DivisionId, c.CustName, j.JobName, l.Lot, l.Block, pl.PlanNum, l.Address, k.Contract, bb.Billed, k.Contract - bb.Billed AS Remaining, CASE WHEN k.Contract > 0 THEN bb.Billed / k.Contract * 100 END AS BilledPct,
                  st.PostedStages, pd.Paid AS PayrollLines ${from} ORDER BY k.Contract - bb.Billed DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from}`, p),
    query(`SELECT SUM(k.Contract - bb.Billed) AS remaining, SUM(k.Contract) AS contract, SUM(bb.Billed) AS billed ${from}`, p),
  ]);
  res.json({ rows, total: total[0].n, summary: sum[0], page: pg.page, pageSize: pg.pageSize });
}));

// Work in progress by job (and lot): contract vs billed vs cost
router.get('/reports/wip', h(async (req, res) => {
  const p = { div: req.query.division || null, cust: int(req.query.customerId), job: int(req.query.jobId) };
  const open = req.query.includeClosed === '1' ? '' : 'AND l.EndDate IS NULL AND l.StatusId = 1';
  const rows = await query(
    `SELECT TOP 1000 j.JobId, j.JobName, j.DivisionId, MAX(c.CustName) AS CustName, COUNT(*) AS Lots, SUM(ISNULL(k.Contract,0)) AS Contract, SUM(bb.Billed) AS Billed,
            SUM(lp.Labor) AS LaborPaid, SUM(mt.Material) AS MaterialPosted
       FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer c ON c.CustID = j.CustId
       CROSS APPLY (SELECT SUM(x.Quantity * x.ValueEa) AS Contract FROM (${LINES}) x WHERE x.LotId = l.LotID) k
       CROSS APPLY (SELECT ISNULL(SUM(${MV('b.BillTotal')}),0) AS Billed FROM ArBilling b WHERE b.LotId = l.LotID) bb
       CROSS APPLY (SELECT ISNULL(SUM(ISNULL(CAST(pp.ExtItemQty AS decimal(18,4)),0) * ISNULL(pp.PriceEa,0) * ISNULL(pp.PayPercent,0) / 100 + ISNULL(pp.PayHours,0) * ISNULL(TRY_CAST(pp.HourlyRate AS decimal(18,4)),0)),0) AS Labor FROM PrLaborPaid pp WHERE pp.LotId = l.LotID) lp
       CROSS APPLY (SELECT ISNULL(SUM(CAST(jc.ExtItemQty AS decimal(18,4)) * jc.JobCostPrice),0) AS Material FROM JcLotItem jc WHERE jc.LotId = l.LotID AND jc.CostCodeId <> 'L') mt
      WHERE (@div IS NULL OR j.DivisionId = @div) AND (@cust IS NULL OR j.CustId = @cust) AND (@job IS NULL OR j.JobId = @job) ${open}
      GROUP BY j.JobId, j.JobName, j.DivisionId ORDER BY SUM(ISNULL(k.Contract,0)) - SUM(bb.Billed) DESC`, p);
  const t = rows.reduce((a, r) => ({ Contract: a.Contract + (r.Contract || 0), Billed: a.Billed + (r.Billed || 0), Labor: a.Labor + (r.LaborPaid || 0), Material: a.Material + (r.MaterialPosted || 0) }), { Contract: 0, Billed: 0, Labor: 0, Material: 0 });
  res.json({ rows, totals: t });
}));

module.exports = router;
