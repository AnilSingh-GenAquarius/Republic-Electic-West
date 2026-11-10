// Sales (SA) — Access SwitchSA: the sales-leads screen (SaProperty: CsProperty + homeowners/phones + the production
// lot's packs) and the SA reports.
//
// Access objects reproduced:
//   * SaProperty + SaPropertySubCustomer (+ SaPropertySubCustomerPhone) + SaPropertySubPack     -> /properties
//   * SaSalesByPlanEst   (macro: rptSaSalesByPlan07Clear / 05Append into tempSaSalesByPlan, crosstab 06)
//   * SaSalesBillingLot + SaSalesBillingLotSubPackType (rptSaSalesBillingLot01Billing / 02Contract / 03SubPackType)
//   * SaOptionSelect / SaGlobalOptionSelect / SaLaborPaidDivSelect: the macros fill tempCmOptionSelect with the pack
//     names found, the user ticks the ones to show, then the report runs. Here the candidate list is a GET and the
//     ticked names are POSTed with the report request, so no per-user temp table is needed.
//   * SaLotsClosedDate, SaLotsStageDate
//   * "Sales quotes" only showed "Currently under development" in Access.
//
// Access rules reproduced:
//   * every report filters on the SwitchSA From / To dates (lot start, lot end, payroll or stage delivery date)
//   * "Options scheduled-lots" refuses to run without a job ("Select job to run report.")
//   * sales by plan: billing = pack qty x (rev contract each, or contract each when there is no revision);
//     cost = pack qty x pack quantity x material qty x unit cost, plus labor burden % on labor items (cost code L)
//     and the division's sales tax % on everything else. Standard = PmPack.PackTypeId 1, all others are options.
//   * options reports show only active packs (PmPack.StatusId = 1); ext value = qty x rev contract each, or contract
//     each when the revision is empty or 0
const express = require('express');
const { query, withTransaction, nextId, sql } = require('../db');
const { h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null || !/^-?\d+$/.test(String(v).trim()) ? null : parseInt(v, 10));
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const has = (b, k) => Object.prototype.hasOwnProperty.call(b || {}, k);
const isoDate = (v) => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s.slice(0, 10) ? undefined : s.slice(0, 10);
};
const str = (v, max, label = 'Text') => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (max && s.length > max) throw bad(`${label} is too long (max ${max} characters)`);
  return s;
};
const reqStr = (v, max, label) => { const s = str(v, max, label); if (!s) throw bad(`Enter ${label.toLowerCase()}`); return s };
const optInt = (v, label) => { if (v === '' || v == null) return null; const n = int(v); if (n == null) throw bad(`${label} must be a whole number`); return n };
const optDate = (v, label) => { const d = isoDate(v); if (d === undefined) throw bad(`${label} must be a valid date (YYYY-MM-DD)`); return d };
const zip = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^\d{5}$/.test(s)) throw bad('Zip code must be 5 digits');
  return Number(s);
};
const email = (v) => {
  const s = str(v, 255, 'Email');
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Enter a valid email address');
  return s;
};
/** Phones: Access mask (999) 000-0000, stored like the sample data: 916-555-7710. */
const phone = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length !== 10) throw bad('Phone number must have 10 digits');
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
};
const exists = async (sql, p, tx) => (await query(sql, p, tx)).length > 0;
const one = async (sql, p, tx) => (await query(sql, p, tx))[0] || null;
const user = (req) => req.user?.username || 'web';
// Money stored as text ("$2667.00", "($12.50)") in JsPack / ArBillingItem
const MV = (c) => `(CASE WHEN LTRIM(${c}) LIKE '(%)' THEN -TRY_CAST(REPLACE(REPLACE(REPLACE(REPLACE(${c},'(',''),')',''),'$',''),',','') AS decimal(18,4))
                       ELSE TRY_CAST(REPLACE(REPLACE(${c},'$',''),',','') AS decimal(18,4)) END)`;

/** SwitchSA From / To boxes: both required, From <= To. */
function period(q) {
  const from = optDate(q.from, 'From'), to = optDate(q.to, 'To');
  if (!from || !to) throw bad('Enter the From and To dates');
  if (from > to) throw bad('From must be on or before To');
  // YYYYMMDD strings convert to datetime the same way under every DATEFORMAT / language setting
  return { from: from.replace(/-/g, ''), to: to.replace(/-/g, ''), fromIso: from, toIso: to };
}
const need = (v, what) => { if (v == null || v === '') throw bad(`Select ${what}`); return v };
async function division(q) {
  const d = need(str(q.division, 50), 'the division');
  if (!(await exists('SELECT 1 FROM LsDivision WHERE DivisionID = @d', { d }))) throw bad('Select a valid division');
  return d;
}
async function stage(q) {
  const s = need(int(q.stageId), 'the schedule stage');
  if (!(await exists('SELECT 1 FROM LsScheduleStage WHERE ScheduleStageID = @s', { s }))) throw bad('Select a valid schedule stage');
  return s;
}
/** Ticked pack names (tempCmOptionSelect.Select = Yes) sent as a JSON array; matched with OPENJSON. */
function packList(b) {
  const list = Array.isArray(b?.packs) ? b.packs : null;
  if (!list || !list.length) throw bad('Tick at least one pack to display');
  if (list.length > 2000) throw bad('Too many packs selected');
  const out = [...new Set(list.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))];
  if (!out.length) throw bad('Tick at least one pack to display');
  if (out.some((x) => x.length > 150)) throw bad('Pack name is too long');
  return JSON.stringify(out);
}
const IN_PACKS = 'k.PackName IN (SELECT value FROM OPENJSON(@packs))';

// ---------------------------------------------------------------------------
// Lookups & pickers (SwitchSA combos)
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const [divisions, scheduleStages, customers, priorities, customerTypes, phoneTypes] = await Promise.all([
    query("SELECT DivisionID AS id, DivisionID + ISNULL(' – ' + DivisionName,'') AS name FROM LsDivision ORDER BY DivisionID"),
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT CustID AS id, CustName AS name FROM JsCustomer ORDER BY CustName'),
    query('SELECT SaPriorityID AS id, SalePriority AS name FROM LsSaPriority ORDER BY SalePriority'),
    query('SELECT CustomerTypeID AS id, CustomerType AS name FROM LsCustomerTypeCS ORDER BY CustomerType'),
    query('SELECT PhoneTypeID AS id, PhoneType AS name FROM LsPhoneType ORDER BY PhoneType'),
  ]);
  res.json({ divisions, scheduleStages, customers, priorities, customerTypes, phoneTypes });
}));
// cboJob: jobs of the chosen customer
router.get('/pick/jobs', h(async (req, res) => {
  res.json(await query(`SELECT JobId AS id, JobName + ISNULL(' (' + DivisionId + ')','') AS name, JobNum, DivisionId FROM JsJob
     WHERE (@c IS NULL OR CustId = @c) ORDER BY JobName, DivisionId`, { c: int(req.query.customerId) }));
}));
// Job name combo on SaProperty (CsJob + builder)
router.get('/cs-jobs', h(async (req, res) => {
  const s = req.query.search ? `%${req.query.search}%` : null;
  res.json(await query(`SELECT TOP 40 j.CsJobID AS id, j.Job + ISNULL(' – ' + b.Builder,'') AS name, j.Job, b.Builder FROM CsJob j JOIN CsBuilder b ON b.CsBuilderID = j.CsBuilderId
     WHERE (@s IS NULL OR j.Job LIKE @s OR b.Builder LIKE @s) ORDER BY j.Job`, { s }));
}));

router.get('/overview', h(async (req, res) => {
  const [counts, priorities, recent, starts] = await Promise.all([
    query(`SELECT COUNT(*) AS leads,
                  COUNT(*) - COUNT(ho.PropertyId) AS noHomeowner,
                  SUM(CASE WHEN p.SaPriorityId IS NULL THEN 1 ELSE 0 END) AS noPriority,
                  SUM(CASE WHEN p.LotId IS NOT NULL THEN 1 ELSE 0 END) AS onLot
             FROM CsProperty p LEFT JOIN (SELECT DISTINCT PropertyId FROM CsCustomerProperty) ho ON ho.PropertyId = p.PropertyID`),
    query(`SELECT sp.SaPriorityID AS id, sp.SalePriority AS name, COUNT(p.PropertyID) AS n FROM LsSaPriority sp LEFT JOIN CsProperty p ON p.SaPriorityId = sp.SaPriorityID
            GROUP BY sp.SaPriorityID, sp.SalePriority ORDER BY sp.SalePriority`),
    query(`SELECT TOP 8 p.PropertyID, p.Address, p.UnitApt, p.City, p.StateId, p.DateEntered, sp.SalePriority, cj.Job AS CsJob,
                  (SELECT COUNT(*) FROM CsCustomerProperty cp WHERE cp.PropertyId = p.PropertyID) AS Homeowners
             FROM CsProperty p LEFT JOIN LsSaPriority sp ON sp.SaPriorityID = p.SaPriorityId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
            ORDER BY p.DateEntered DESC, p.PropertyID DESC`),
    query(`SELECT COUNT(*) AS n FROM JsLot WHERE StartDate >= DATEADD(day, -30, CAST(GETDATE() AS date)) AND StartDate <= CAST(GETDATE() AS date)`),
  ]);
  res.json({ ...counts[0], lotsStarted30: starts[0].n, priorities, recent });
}));

// ---------------------------------------------------------------------------
// Sales leads (Access SaProperty: CsProperty, "Go to address" combo, Property info + Homeowner info tabs)
// ---------------------------------------------------------------------------
const PROP_ADDR = "p.Address + ISNULL(' #' + NULLIF(p.UnitApt,''), '') + ', ' + ISNULL(p.City,'') + ', ' + ISNULL(p.StateId,'') + ' ' + ISNULL(CAST(p.Zip AS varchar(10)),'')";
const HO_NAME = "ISNULL(c.FirstName,'') + ISNULL(' ' + NULLIF(c.MiddleName,''), '') + ' ' + ISNULL(c.LastName,'')";
const PROP_SORT = {
  address: 'p.Address, p.UnitApt',
  city: 'p.City, p.Address',
  priority: 'CASE WHEN sp.SalePriority IS NULL THEN 1 ELSE 0 END, sp.SalePriority, p.Address',
  entered: 'p.DateEntered DESC, p.PropertyID DESC',
  escrow: 'CASE WHEN p.Escrow IS NULL THEN 1 ELSE 0 END, p.Escrow DESC, p.Address',
};
router.get('/properties', h(async (req, res) => {
  const pg = paging(req.query);
  const pr = req.query.priorityId === 'none' ? -1 : int(req.query.priorityId);
  const p = { s: req.query.search ? `%${String(req.query.search).trim()}%` : null, pr, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR p.Address LIKE @s OR p.City LIKE @s OR CAST(p.Zip AS varchar(10)) LIKE @s OR p.CsLot LIKE @s OR cj.Job LIKE @s OR cb.Builder LIKE @s
      OR EXISTS (SELECT 1 FROM CsCustomerProperty cp JOIN CsCustomer c ON c.CustomerID = cp.CustomerId WHERE cp.PropertyId = p.PropertyID AND ${HO_NAME} LIKE @s))
    AND (@pr IS NULL OR (@pr = -1 AND p.SaPriorityId IS NULL) OR p.SaPriorityId = @pr)`;
  const from = 'FROM CsProperty p LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId LEFT JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId LEFT JOIN LsSaPriority sp ON sp.SaPriorityID = p.SaPriorityId';
  const order = PROP_SORT[req.query.sort] || PROP_SORT.address;
  const [rows, total] = await Promise.all([
    query(`SELECT p.PropertyID, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow, p.CsLot, p.LotId, p.SaPriorityId, sp.SalePriority, cj.Job AS CsJob, cb.Builder, p.DateEntered,
                  (SELECT COUNT(*) FROM CsCustomerProperty cp WHERE cp.PropertyId = p.PropertyID) AS Homeowners,
                  (SELECT TOP 1 ${HO_NAME} FROM CsCustomerProperty cp JOIN CsCustomer c ON c.CustomerID = cp.CustomerId WHERE cp.PropertyId = p.PropertyID ORDER BY c.CustomerID) AS Homeowner,
                  (SELECT COUNT(*) FROM JsPack jp WHERE jp.LotId = p.LotId) AS Packs
             ${from} ${where} ORDER BY ${order} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p),
    query(`SELECT COUNT(*) AS n ${from} ${where}`, p),
  ]);
  res.json({ rows, total: total[0].n, page: pg.page, pageSize: pg.pageSize });
}));
// "Go to address" combo (Combo36): address, unit, city, state, zip, job, lot
router.get('/properties/search', h(async (req, res) => {
  const s = req.query.search ? `%${String(req.query.search).trim()}%` : null;
  res.json(await query(`SELECT TOP 40 p.PropertyID AS id, ${PROP_ADDR} + ISNULL(' · ' + cj.Job,'') + ISNULL(' · lot ' + p.CsLot,'') AS name
     FROM CsProperty p LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId WHERE (@s IS NULL OR p.Address LIKE @s OR p.City LIKE @s OR cj.Job LIKE @s) ORDER BY p.Address`, { s }));
}));

async function propertyDetail(id) {
  const prop = await one(`SELECT p.PropertyID, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow, p.CsCommunity, p.CsLot, p.CsJobId, p.LotId, p.Notes, p.SaPriorityId,
         p.DateEntered, p.UserEntered, ${PROP_ADDR} AS Property, cj.Job AS CsJob, cb.Builder, sp.SalePriority,
         j.JobName, j.DivisionId, l.Lot + ISNULL('/' + l.Block, '') AS LotBlock, l.StartDate AS LotStartDate, l.EndDate AS LotEndDate
       FROM CsProperty p LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId LEFT JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId LEFT JOIN LsSaPriority sp ON sp.SaPriorityID = p.SaPriorityId
       LEFT JOIN JsLot l ON l.LotID = p.LotId LEFT JOIN JsJob j ON j.JobId = l.JobId
      WHERE p.PropertyID = @id`, { id });
  if (!prop) return null;
  const [packs, homeowners, phones] = await Promise.all([
    // SaPropertySubPack (linked on LotId)
    query(`SELECT jp.PackID, jp.LotId, k.PackName, t.PackType, jp.PackQty, jp.PostedQty, jp.DateEntered
             FROM JsPack jp JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId
            WHERE jp.LotId = @l ORDER BY t.PackTypeID, k.PackName`, { l: prop.LotId ?? -1 }),
    // SaPropertySubCustomer (CsCustomer joined to CsCustomerProperty, linked on PropertyId)
    query(`SELECT c.CustomerID, c.FirstName, c.MiddleName, c.LastName, c.Email, c.Notes, c.DateEntered, c.UserEntered, cp.PropertyId, cp.CustomerTypeId, ct.CustomerType,
                  ${HO_NAME} AS Homeowner
             FROM CsCustomer c JOIN CsCustomerProperty cp ON cp.CustomerId = c.CustomerID LEFT JOIN LsCustomerTypeCS ct ON ct.CustomerTypeID = cp.CustomerTypeId
            WHERE cp.PropertyId = @id ORDER BY c.LastName, c.FirstName`, { id }),
    // SaPropertySubCustomerPhone (linked on CustomerId)
    query(`SELECT ph.CustPhoneID, ph.CustomerId, ph.PhoneNum, ph.PhoneTypeId, t.PhoneType
             FROM CsCustomerPhone ph JOIN CsCustomerProperty cp ON cp.CustomerId = ph.CustomerId LEFT JOIN LsPhoneType t ON t.PhoneTypeID = ph.PhoneTypeId
            WHERE cp.PropertyId = @id ORDER BY ph.CustPhoneID`, { id }),
  ]);
  for (const ho of homeowners) ho.phones = phones.filter((x) => x.CustomerId === ho.CustomerID);
  return { property: prop, packs, homeowners };
}
router.get('/properties/:id', h(async (req, res) => {
  const d = await propertyDetail(int(req.params.id) ?? 0);
  if (!d) return res.status(404).json({ error: 'Property not found' });
  res.json(d);
}));

async function propertyBody(b, partial, tx) {
  const o = {};
  if (!partial || has(b, 'Address')) o.Address = reqStr(b.Address, 50, 'Address');
  if (has(b, 'UnitApt')) o.UnitApt = str(b.UnitApt, 255, 'Unit');
  if (has(b, 'City')) o.City = str(b.City, 50, 'City');
  if (has(b, 'StateId')) {
    o.StateId = str(b.StateId, 50, 'State');
    if (o.StateId) { o.StateId = o.StateId.toUpperCase(); if (!/^[A-Z]{2}$/.test(o.StateId)) throw bad('State must be 2 letters (e.g. CA)') }
  }
  if (has(b, 'Zip')) o.Zip = zip(b.Zip);
  if (has(b, 'Escrow')) o.Escrow = optDate(b.Escrow, 'Escrow');
  if (has(b, 'CsLot')) o.CsLot = str(b.CsLot, 50, 'Lot / block');
  if (has(b, 'Notes')) o.Notes = str(b.Notes, 255, 'Notes');
  if (has(b, 'CsJobId')) {
    o.CsJobId = optInt(b.CsJobId, 'Job name');
    if (o.CsJobId && !(await exists('SELECT 1 FROM CsJob WHERE CsJobID = @j', { j: o.CsJobId }, tx))) throw bad('Choose a valid job name');
  }
  if (has(b, 'SaPriorityId')) {
    o.SaPriorityId = optInt(b.SaPriorityId, 'Sale priority');
    if (o.SaPriorityId && !(await exists('SELECT 1 FROM LsSaPriority WHERE SaPriorityID = @p', { p: o.SaPriorityId }, tx))) throw bad('Choose a valid sale priority');
  }
  return o;
}
async function dupProperty(tx, o, exceptId) {
  return one(`SELECT TOP 1 PropertyID FROM CsProperty WHERE Address = @a AND ISNULL(City,'') = ISNULL(@c,'') AND ISNULL(UnitApt,'') = ISNULL(@u,'') AND (@x IS NULL OR PropertyID <> @x)`,
    { a: o.Address, c: o.City ?? null, u: o.UnitApt ?? null, x: exceptId ?? null }, tx);
}
// fixed allow-list: the only columns the property form may write
const PROP_COLS = ['Address', 'UnitApt', 'City', 'StateId', 'Zip', 'Escrow', 'CsLot', 'Notes', 'CsJobId', 'SaPriorityId'];
router.post('/properties', h(async (req, res) => {
  const b = req.body || {};
  const id = await withTransaction(async (tx) => {
    const o = await propertyBody(b, false, tx);
    const d = await dupProperty(tx, o);
    if (d && !b.force) throw Object.assign(bad(`Property #${d.PropertyID} already has this address. Save a second one anyway?`, 409), { needsConfirm: true });
    const nid = await nextId(tx, 'CsProperty', 'PropertyID');
    const cols = PROP_COLS.filter((c) => c in o);
    const p = { id: nid, u: user(req) };
    cols.forEach((c) => (p[c] = o[c]));
    await query(`INSERT INTO CsProperty (PropertyID, ${cols.map((c) => `[${c}]`).join(', ')}, WarrantyVoid, DateEntered, UserEntered)
                 VALUES (@id, ${cols.map((c) => `@${c}`).join(', ')}, 0, GETDATE(), @u)`, p, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/properties/:id', h(async (req, res) => {
  const id = int(req.params.id) ?? 0, b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await one('SELECT * FROM CsProperty WHERE PropertyID = @id', { id }, tx);
    if (!cur) throw bad('Property not found', 404);
    const o = await propertyBody(b, true, tx);
    if (('Address' in o || 'City' in o || 'UnitApt' in o) && !b.force) {
      const d = await dupProperty(tx, { ...cur, ...o }, id);
      if (d) throw Object.assign(bad(`Property #${d.PropertyID} already has this address. Save anyway?`, 409), { needsConfirm: true });
    }
    const cols = PROP_COLS.filter((c) => c in o);
    if (!cols.length) return;
    const p = { id };
    cols.forEach((c) => (p[c] = o[c]));
    await query(`UPDATE CsProperty SET ${cols.map((c) => `[${c}] = @${c}`).join(', ')} WHERE PropertyID = @id`, p, tx);
  });
  res.json({ ok: true });
}));
router.delete('/properties/:id', h(async (req, res) => {
  const id = int(req.params.id) ?? 0;
  await withTransaction(async (tx) => {
    const cur = await one('SELECT LotId FROM CsProperty WHERE PropertyID = @id', { id }, tx);
    if (!cur) throw bad('Property not found', 404);
    if (cur.LotId) throw bad('This property is linked to a production lot and cannot be deleted.', 409);
    const t = await one('SELECT COUNT(*) AS n FROM CsScheduleAppt WHERE PropertyId = @id', { id }, tx);
    if (t.n) throw bad(`This property has ${t.n} customer service ticket(s) and cannot be deleted.`, 409);
    if (await exists('SELECT 1 FROM CsCallNotes WHERE PropertyId = @id', { id }, tx)) throw bad('This property has call notes and cannot be deleted.', 409);
    if (await exists('SELECT 1 FROM CsQuote WHERE PropertyId = @id', { id }, tx)) throw bad('This property has quotes and cannot be deleted.', 409);
    await query('DELETE FROM CsCustomerProperty WHERE PropertyId = @id', { id }, tx);
    await query('DELETE FROM CsPropertyLink WHERE PropertyID = @id', { id }, tx);
    await query('DELETE FROM CsProperty WHERE PropertyID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));
// ---------------------------------------------------------------------------
// Homeowner info tab (SaPropertySubCustomer: CsCustomer + CsCustomerProperty; SaPropertySubCustomerPhone)
// A new row in the Access subform creates the CsCustomer and its CsCustomerProperty link to this property.
// Deleting a row of that join removes the link (CsCustomerProperty) only; the homeowner record stays.
// ---------------------------------------------------------------------------
function homeownerBody(b, partial) {
  const o = {};
  if (!partial || has(b, 'FirstName')) o.FirstName = reqStr(b.FirstName, 50, 'First name');
  if (!partial || has(b, 'LastName')) o.LastName = reqStr(b.LastName, 50, 'Last name');
  if (has(b, 'MiddleName')) o.MiddleName = str(b.MiddleName, 255, 'Middle name');
  if (has(b, 'Email')) o.Email = email(b.Email);
  if (has(b, 'Notes')) o.Notes = str(b.Notes, 255, 'Notes');
  return o;
}
async function customerType(v, tx) {
  const t = optInt(v, 'Customer type');
  if (!t || !(await exists('SELECT 1 FROM LsCustomerTypeCS WHERE CustomerTypeID = @t', { t }, tx))) throw bad('Choose the customer type');
  return t;
}
async function phoneType(v, tx) {
  const t = optInt(v, 'Phone type') ?? 1; // Access default value 1
  if (!(await exists('SELECT 1 FROM LsPhoneType WHERE PhoneTypeID = @t', { t }, tx))) throw bad('Choose a valid phone type');
  return t;
}
router.post('/properties/:id/homeowners', h(async (req, res) => {
  const pid = int(req.params.id) ?? 0, b = req.body || {};
  const o = homeownerBody(b, false);
  const ph = phone(b.PhoneNum);
  const cid = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @p', { p: pid }, tx))) throw bad('Property not found', 404);
    const t = await customerType(b.CustomerTypeId, tx);
    const pt = ph ? await phoneType(b.PhoneTypeId, tx) : null;
    if (!b.force && await exists('SELECT 1 FROM CsCustomer WHERE FirstName = @f AND LastName = @l', { f: o.FirstName, l: o.LastName }, tx)) {
      throw Object.assign(bad(`A homeowner named ${o.FirstName} ${o.LastName} already exists. Add a new one anyway?`, 409), { needsConfirm: true });
    }
    const id = await nextId(tx, 'CsCustomer', 'CustomerID');
    await query(`INSERT INTO CsCustomer (CustomerID, FirstName, MiddleName, LastName, Email, Notes, DateEntered, UserEntered)
                 VALUES (@id, @FirstName, @MiddleName, @LastName, @Email, @Notes, GETDATE(), @u)`,
    { id, FirstName: o.FirstName, MiddleName: o.MiddleName ?? null, LastName: o.LastName, Email: o.Email ?? null, Notes: o.Notes ?? null, u: user(req) }, tx);
    await query('INSERT INTO CsCustomerProperty (CustomerId, PropertyId, CustomerTypeId, ScheduleAppt, DateEntered, UserEntered) VALUES (@c, @p, @t, 0, GETDATE(), @u)',
      { c: id, p: pid, t, u: user(req) }, tx);
    if (ph) {
      const phId = await nextId(tx, 'CsCustomerPhone', 'CustPhoneID');
      await query('INSERT INTO CsCustomerPhone (CustPhoneID, CustomerId, PhoneNum, PhoneTypeId, DateEntered, UserEntered) VALUES (@id, @c, @n, @t, GETDATE(), @u)',
        { id: phId, c: id, n: ph, t: pt, u: user(req) }, tx);
    }
    return id;
  });
  res.status(201).json({ id: cid });
}));
router.put('/properties/:id/homeowners/:cid', h(async (req, res) => {
  const pid = int(req.params.id) ?? 0, cid = int(req.params.cid) ?? 0, b = req.body || {};
  const o = homeownerBody(b, true);
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCustomerProperty WHERE CustomerId = @c AND PropertyId = @p', { c: cid, p: pid }, tx))) throw bad('Homeowner not found on this property', 404);
    const cols = ['FirstName', 'MiddleName', 'LastName', 'Email', 'Notes'].filter((c) => c in o);
    if (cols.length) {
      const p = { id: cid };
      cols.forEach((c) => (p[c] = o[c]));
      await query(`UPDATE CsCustomer SET ${cols.map((c) => `[${c}] = @${c}`).join(', ')} WHERE CustomerID = @id`, p, tx);
    }
    if (has(b, 'CustomerTypeId')) {
      const t = await customerType(b.CustomerTypeId, tx);
      await query('UPDATE CsCustomerProperty SET CustomerTypeId = @t WHERE CustomerId = @c AND PropertyId = @p', { t, c: cid, p: pid }, tx);
    }
  });
  res.json({ ok: true });
}));
router.delete('/properties/:id/homeowners/:cid', h(async (req, res) => {
  const r = await one('DELETE FROM CsCustomerProperty WHERE CustomerId = @c AND PropertyId = @p; SELECT @@ROWCOUNT AS n', { c: int(req.params.cid) ?? 0, p: int(req.params.id) ?? 0 });
  if (!r.n) return res.status(404).json({ error: 'Homeowner not found on this property' });
  res.json({ ok: true });
}));

router.post('/homeowners/:cid/phones', h(async (req, res) => {
  const cid = int(req.params.cid) ?? 0, b = req.body || {};
  const n = phone(b.PhoneNum); if (!n) throw bad('Enter the phone number');
  const id = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @c', { c: cid }, tx))) throw bad('Homeowner not found', 404);
    const t = await phoneType(b.PhoneTypeId, tx);
    if (await exists('SELECT 1 FROM CsCustomerPhone WHERE CustomerId = @c AND PhoneNum = @n AND PhoneTypeId = @t', { c: cid, n, t }, tx)) throw bad('This phone number is already on the homeowner', 409);
    const nid = await nextId(tx, 'CsCustomerPhone', 'CustPhoneID');
    await query('INSERT INTO CsCustomerPhone (CustPhoneID, CustomerId, PhoneNum, PhoneTypeId, DateEntered, UserEntered) VALUES (@id, @c, @n, @t, GETDATE(), @u)', { id: nid, c: cid, n, t, u: user(req) }, tx);
    return nid;
  });
  res.status(201).json({ id });
}));
router.put('/phones/:pid', h(async (req, res) => {
  const pid = int(req.params.pid) ?? 0, b = req.body || {};
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCustomerPhone WHERE CustPhoneID = @id', { id: pid }, tx))) throw bad('Phone not found', 404);
    if (has(b, 'PhoneNum')) { const n = phone(b.PhoneNum); if (!n) throw bad('Enter the phone number'); await query('UPDATE CsCustomerPhone SET PhoneNum = @n WHERE CustPhoneID = @id', { n, id: pid }, tx) }
    if (has(b, 'PhoneTypeId')) { const t = await phoneType(b.PhoneTypeId, tx); await query('UPDATE CsCustomerPhone SET PhoneTypeId = @t WHERE CustPhoneID = @id', { t, id: pid }, tx) }
  });
  res.json({ ok: true });
}));
router.delete('/phones/:pid', h(async (req, res) => {
  const r = await one('DELETE FROM CsCustomerPhone WHERE CustPhoneID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.pid) ?? 0 });
  if (!r.n) return res.status(404).json({ error: 'Phone not found' });
  res.json({ ok: true });
}));
// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const BILL_EA = `(CASE WHEN NULLIF(LTRIM(jp.RevContractEa),'') IS NULL THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END)`;
// options reports: IIf(IsNull(RevContractEa) Or RevContractEa = 0, ContractEa, RevContractEa)
const EXT_EA = `(CASE WHEN ISNULL(${MV('jp.RevContractEa')},0) = 0 THEN ${MV('jp.ContractEa')} ELSE ${MV('jp.RevContractEa')} END)`;

// Estimated sales by plan (SaSalesByPlanEst <- rptSaSalesByPlan01SelectBill / 02SelectCost / 03join / 04LotCount / 06 crosstab)
// Filters A D E F: customer, division, from, to (lot start date). [LaborBurden] is an Access parameter prompt -> ?burden=
router.get('/reports/sales-by-plan', h(async (req, res) => {
  const { from, to } = period(req.query);
  const d = await division(req.query);
  const c = int(req.query.customerId) || null; // 0 = "1-All customers"
  if (req.query.burden === undefined || req.query.burden === '') throw bad('Enter the labor burden %');
  const burden = num(req.query.burden);
  if (burden == null || burden < 0 || burden > 1000) throw bad('Labor burden must be a percentage between 0 and 1000');
  const rows = await query(`WITH lots AS (
      SELECT j.DivisionId, c.CustName, j.JobName, j.JobId, p.PlanNum, l.LotID
        FROM JsCustomer c JOIN JsJob j ON j.CustId = c.CustID JOIN JsLot l ON l.JobId = j.JobId JOIN PmPlan p ON p.PmPlanID = l.PmPlanId
        JOIN PmJob pj ON pj.PmJobID = j.PmJobId JOIN PmCustomer pc ON pc.PmCustID = pj.PmCustId
       WHERE l.StartDate >= @from AND l.StartDate <= @to AND j.DivisionId = @d AND (@c IS NULL OR j.CustId = @c)),
    bill AS (
      SELECT lots.LotID,
             SUM(CASE WHEN k.PackTypeId = 1 THEN jp.PackQty * ${BILL_EA} END) AS Std,
             SUM(CASE WHEN ISNULL(k.PackTypeId,0) <> 1 THEN jp.PackQty * ${BILL_EA} END) AS Opt
        FROM lots JOIN JsPack jp ON jp.LotId = lots.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId
       GROUP BY lots.LotID),
    cost AS (
      SELECT lots.LotID,
             SUM(CASE WHEN k.PackTypeId = 1 THEN x.v END) AS Std,
             SUM(CASE WHEN ISNULL(k.PackTypeId,0) <> 1 THEN x.v END) AS Opt
        FROM lots JOIN JsPack jp ON jp.LotId = lots.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId
        JOIN PmMaterial m ON m.PmPackId = k.PmPackID JOIN IcItem i ON i.InvItemID = m.InvItemId JOIN LsDivision dv ON dv.DivisionID = lots.DivisionId
        CROSS APPLY (SELECT CAST(jp.PackQty AS decimal(18,4)) * k.Quantity * m.Quantity * m.UnitCost
                            * CASE WHEN i.CostCodeId = 'L' THEN (100 + @b) / 100 ELSE (100 + ISNULL(dv.SalesTax,0)) / 100 END AS v) x
       GROUP BY lots.LotID)
    SELECT lots.DivisionId, lots.CustName, lots.JobName, lots.JobId, lots.PlanNum, COUNT(*) AS LotCount,
           SUM(b.Std) AS StandardBilling, SUM(b.Opt) AS OptionBilling, SUM(cs.Std) AS StandardCost, SUM(cs.Opt) AS OptionCost
      FROM lots LEFT JOIN bill b ON b.LotID = lots.LotID LEFT JOIN cost cs ON cs.LotID = lots.LotID
     GROUP BY lots.DivisionId, lots.CustName, lots.JobName, lots.JobId, lots.PlanNum
    HAVING COUNT(b.LotID) + COUNT(cs.LotID) > 0
     ORDER BY lots.CustName, lots.JobName, lots.PlanNum`, { from, to, d, c, b: [sql.Decimal(18, 4), burden] });
  res.json({ rows, burden, division: d });
}));

// Billing & contract by lot (SaSalesBillingLot <- rptSaSalesBillingLot01Billing / 02Contract, sub-report 03SubPackType)
// Filters A B E F: customer -> job (required), from, to (lot start date)
router.get('/reports/billing-by-lot', h(async (req, res) => {
  const { from, to } = period(req.query);
  const j = need(int(req.query.jobId), 'the job');
  const base = `WITH b AS (
      SELECT j.DivisionId, l.StartDate, c.CustName, j.JobName, ph.Phase, l.LotID, l.Lot, l.Block, p.PlanNum, t.PackType, jp.PackQty,
             ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa,
             (SELECT SUM(${MV('bi.ItemTotal')}) FROM ArBillingItem bi WHERE bi.PackId = jp.PackID) AS TotalBilling
        FROM JsCustomer c JOIN JsJob j ON j.CustId = c.CustID JOIN JsPhase ph ON ph.JobId = j.JobId JOIN JsLot l ON l.PhaseId = ph.PhaseID
        JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPlan p ON p.PmPlanID = l.PmPlanId JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN LsPackType t ON t.PackTypeID = jp.PackTypeId
       WHERE j.JobId = @j AND l.StartDate >= @from AND l.StartDate <= @to)`;
  const [rows, packTypes] = await Promise.all([
    query(`${base}
      SELECT DivisionId, StartDate, CustName, JobName, Phase, LotID, Lot, Block, PlanNum, PackType,
             SUM(PackQty * ContractEa) AS TotalContract, SUM(PackQty * RevContractEa) AS TotalRevContract, SUM(TotalBilling) AS SumOfTotalBilling
        FROM b GROUP BY DivisionId, StartDate, CustName, JobName, Phase, LotID, Lot, Block, PlanNum, PackType
       ORDER BY JobName, Lot, Block, PackType`, { j, from, to }),
    query(`${base}
      SELECT DivisionId, CustName, PackType, SUM(PackQty * ContractEa) AS TotalContract, SUM(PackQty * RevContractEa) AS TotalRevContract, SUM(TotalBilling) AS SumOfTotalBilling
        FROM b GROUP BY DivisionId, CustName, PackType ORDER BY PackType`, { j, from, to }),
  ]);
  res.json({ rows, packTypes });
}));
// Options scheduled-lots (macro SaOptionSelect -> form SaOptionSelect -> report SaOptionSelect)
// Filters A B E F: customer -> job (required: "Select job to run report."), from, to (lot start date)
async function optionJob(v) {
  const j = int(v);
  if (!j) throw bad('Select job to run report.');
  if (!(await exists('SELECT 1 FROM JsJob WHERE JobId = @j', { j }))) throw bad('Select a valid job');
  return j;
}
// rptSaOptionSelectAppend: every pack name scheduled on the job's lots that start in the period
router.get('/reports/options/packs', h(async (req, res) => {
  const j = await optionJob(req.query.jobId);
  const { from, to } = period(req.query);
  res.json(await query(`SELECT k.PackName AS name, COUNT(*) AS n FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
     WHERE j.JobId = @j AND l.StartDate >= @from AND l.StartDate <= @to GROUP BY k.PackName ORDER BY k.PackName`, { j, from, to }));
}));
const OPTION_COLS = `c.CustName, j.JobName, j.DivisionId, pc.BidNum, pc.BidDate, l.LotID, l.Lot, l.Block, l.Address, l.City, l.State, l.Zip, ph.Phase, p.PlanNum, p.PlanName, l.StartDate, l.EndDate,
       k.PackName, k.BuilderCode, jp.PackID, jp.PackQty, ${MV('jp.ContractEa')} AS ContractEa, ${MV('jp.RevContractEa')} AS RevContractEa, jp.PackQty * ${EXT_EA} AS ExtVal`;
const OPTION_FROM = `FROM JsPack jp JOIN JsLot l ON l.LotID = jp.LotId JOIN PmPack k ON k.PmPackID = jp.PmPackId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       JOIN JsJob j ON j.JobId = ph.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN PmPlan p ON p.PmPlanID = l.PmPlanId`;
router.post('/reports/options', h(async (req, res) => {
  const b = req.body || {};
  const j = await optionJob(b.jobId);
  const { from, to } = period(b);
  const packs = packList(b);
  res.json(await query(`SELECT ${OPTION_COLS} ${OPTION_FROM}
     WHERE l.StartDate >= @from AND l.StartDate <= @to AND ${IN_PACKS} AND j.JobId = @j AND k.StatusId = 1
     ORDER BY k.PackName, k.BuilderCode, l.StartDate, l.Lot`, { j, from, to, packs }));
}));

// Global options sold (macro SaGlobalOptionSelect -> form SaGlobalOptionSelect -> report SaGlobalOptionSelect)
// Filters D E F: division, from, to (lot start date)
router.get('/reports/global-options/packs', h(async (req, res) => {
  const d = await division(req.query);
  const { from, to } = period(req.query);
  res.json(await query(`SELECT k.PackName AS name, COUNT(*) AS n FROM JsJob j JOIN JsLot l ON l.JobId = j.JobId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
     WHERE l.StartDate >= @from AND l.StartDate <= @to AND j.DivisionId = @d GROUP BY k.PackName ORDER BY k.PackName`, { d, from, to }));
}));
router.post('/reports/global-options', h(async (req, res) => {
  const b = req.body || {};
  const d = await division(b);
  const { from, to } = period(b);
  const packs = packList(b);
  // The Access report source has no division condition (only the pick list does); the report header shows the
  // division, so the lots are limited to it here as well.
  res.json(await query(`SELECT ${OPTION_COLS} ${OPTION_FROM}
     WHERE l.StartDate >= @from AND l.StartDate <= @to AND ${IN_PACKS} AND k.StatusId = 1 AND j.DivisionId = @d
     ORDER BY k.PackName, c.CustName, j.JobName, l.Lot, l.Block`, { d, from, to, packs }));
}));

// Labor paid div & stage (macro SaLaborPaidDivSelect -> form SaLaborPaidDivSelect -> report SaLaborPaidDivision)
// Filters D E F H: division, from, to (payroll date), schedule stage
router.get('/reports/labor-paid/packs', h(async (req, res) => {
  const d = await division(req.query);
  const s = await stage(req.query);
  const { from, to } = period(req.query);
  res.json(await query(`SELECT k.PackName AS name, COUNT(DISTINCT jp.PackID) AS n
       FROM JsJob j JOIN PrLaborPaid lp ON lp.JobId = j.JobId JOIN JsLot l ON l.JobId = j.JobId AND l.LotID = lp.LotId JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
      WHERE j.DivisionId = @d AND lp.PayrollDate >= @from AND lp.PayrollDate <= @to AND lp.ScheduleStageId = @s
      GROUP BY k.PackName ORDER BY k.PackName`, { d, s, from, to }));
}));
router.post('/reports/labor-paid', h(async (req, res) => {
  const b = req.body || {};
  const d = await division(b);
  const s = await stage({ stageId: b.stageId });
  const { from, to } = period(b);
  const packs = packList(b);
  res.json(await query(`SELECT j.DivisionId, c.CustName, j.JobName, jt.JobType, ISNULL(lp.Lot,'') + '/' + ISNULL(lp.Block,'') AS LotBlock, p.PlanNum, l.StartDate,
         ISNULL(l.Address,'') + ', ' + ISNULL(l.City,'') + ', ' + ISNULL(l.State,'') + ' ' + ISNULL(CAST(l.Zip AS varchar(10)),'') AS LotAddress,
         ss.ScheduleStage, CONVERT(char(10), MIN(lp.PayrollDate), 23) AS DatePayroll, k.PackName AS PackScheduled
       FROM PrLaborPaid lp JOIN JsJob j ON j.JobId = lp.JobId JOIN JsLot l ON l.LotID = lp.LotId JOIN LsScheduleStage ss ON ss.ScheduleStageID = lp.ScheduleStageId
       JOIN JsCustomer c ON c.CustID = j.CustId JOIN PmPlan p ON p.PmPlanID = l.PmPlanId JOIN LsJobType jt ON jt.JobTypeID = j.JobTypeId
       JOIN JsPack jp ON jp.LotId = l.LotID JOIN PmPack k ON k.PmPackID = jp.PmPackId
      WHERE ${IN_PACKS} AND lp.PayrollDate >= @from AND lp.PayrollDate <= @to AND ss.ScheduleStageID = @s AND j.DivisionId = @d
      GROUP BY j.DivisionId, c.CustName, j.JobName, jt.JobType, ISNULL(lp.Lot,'') + '/' + ISNULL(lp.Block,''), p.PlanNum, l.StartDate,
         ISNULL(l.Address,'') + ', ' + ISNULL(l.City,'') + ', ' + ISNULL(l.State,'') + ' ' + ISNULL(CAST(l.Zip AS varchar(10)),''), ss.ScheduleStage, k.PackName
      ORDER BY c.CustName, j.JobName, LotBlock, k.PackName`, { d, s, from, to, packs }));
}));

// Lots closed by date (SaLotsClosedDate) — filters D E F: division, from, to (lot end date)
const LOT_COLS = `j.DivisionId, c.CustName, j.JobName, ph.Phase, l.LotID, l.Lot, l.Block, p.PlanNum, p.Bedrooms, p.SqFt, g.Gear, p.TvOutlet, p.Island, p.FloorPlug, p.Detached, l.StartDate`;
const LOT_FROM = `FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer c ON c.CustID = j.CustId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId AND ph.JobId = j.JobId
       JOIN PmPlan p ON p.PmPlanID = l.PmPlanId LEFT JOIN GrGearName g ON g.GrGearID = TRY_CAST(p.GrGearId AS int)`;
router.get('/reports/lots-closed', h(async (req, res) => {
  const d = await division(req.query);
  const { from, to } = period(req.query);
  res.json(await query(`SELECT ${LOT_COLS}, l.EndDate ${LOT_FROM}
     WHERE j.DivisionId = @d AND l.EndDate >= @from AND l.EndDate <= @to
     ORDER BY c.CustName, j.JobName, l.Lot, l.Block`, { d, from, to }));
}));
// Lots stage by date (SaLotsStageDate) — filters D E F H: division, from, to (stage delivery date), schedule stage
router.get('/reports/lots-stage', h(async (req, res) => {
  const d = await division(req.query);
  const s = await stage(req.query);
  const { from, to } = period(req.query);
  res.json(await query(`SELECT DISTINCT ${LOT_COLS}, st.DeliveryDate, st.ScheduleStageId, ss.ScheduleStage ${LOT_FROM}
       JOIN JsStage st ON st.LotId = l.LotID JOIN LsScheduleStage ss ON ss.ScheduleStageID = st.ScheduleStageId
     WHERE j.DivisionId = @d AND st.DeliveryDate >= @from AND st.DeliveryDate <= @to AND st.ScheduleStageId = @s
     ORDER BY c.CustName, j.JobName, l.Lot, l.Block, st.DeliveryDate`, { d, s, from, to }));
}));

module.exports = router;
