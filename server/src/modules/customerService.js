// Customer service (CS) — mirrors the Access SwitchCS module:
//   homeowners (CsCustomer + phones + property links), properties (CsProperty + production lot links),
//   appointment scheduling (CsScheduleAppt + technicians, findings/errors + material), calendar + notes,
//   ticket tracking, call notes, technicians, assemblies, quotes, master lists (Ls*CS) and the CS reports.
// Business rules are taken from the Access forms/macros (CsSchedule + CsScheduleSetAppt, CsTicketTrack,
// CsAssembly, CsQuote*, CsProductionLotsAdd, frmCs* queries); comments name the Access source.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { insertRow, updateRow, h, paging } = require('../crud');

const router = express.Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const int = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) && Number.isInteger(Number(v)) ? Number(v) : NaN);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,]/g, '')));
const isoDate = (v) => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s.slice(0, 10) ? undefined : s.slice(0, 10);
};
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const str = (v, max, label) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (max && s.length > max) throw bad(`${label} is too long (max ${max} characters)`);
  return s;
};
const reqStr = (v, max, label) => { const s = str(v, max, label); if (!s) throw bad(`Enter ${label.toLowerCase()}`); return s; };
const optInt = (v, label) => { const n = int(v); if (Number.isNaN(n)) throw bad(`${label} must be a whole number`); return n; };
const optNum = (v, label, { min, max } = {}) => {
  const n = num(v);
  if (n == null) return null;
  if (Number.isNaN(n)) throw bad(`${label} must be a number`);
  if (min != null && n < min) throw bad(`${label} must be at least ${min}`);
  if (max != null && n > max) throw bad(`${label} must be at most ${max}`);
  return n;
};
const optDate = (v, label) => { const d = isoDate(v); if (d === undefined) throw bad(`${label} must be a valid date (YYYY-MM-DD)`); return d; };
const has = (b, k) => Object.prototype.hasOwnProperty.call(b || {}, k);
const bit = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'Yes' ? 1 : 0);
/** Phones: Access mask (999) 000-0000. Stored like the sample data: 916-555-7710. */
const phone = (v, label = 'Phone number') => {
  if (v == null || String(v).trim() === '') return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length !== 10) throw bad(`${label} must have 10 digits`);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
};
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
const timeHM = (v, label) => {
  if (v == null || String(v).trim() === '') return null;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw bad(`${label} must be a time like 08:30`);
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
};
const exists = async (sql, p, tx) => (await query(sql, p, tx)).length > 0;
const one = async (sql, p, tx) => (await query(sql, p, tx))[0] || null;

// Shared SQL fragments ------------------------------------------------------
const HO_NAME = "c.FirstName + ISNULL(' ' + NULLIF(c.MiddleName,''), '') + ' ' + ISNULL(c.LastName,'')";
const PROP_ADDR = "p.Address + ISNULL(' #' + NULLIF(p.UnitApt,''), '') + ', ' + ISNULL(p.City,'') + ', ' + ISNULL(p.StateId,'') + ' ' + ISNULL(CAST(p.Zip AS varchar(10)),'')";
const TECH_NAME = "e.FName + ISNULL(' ' + NULLIF(e.MInitial,''), '') + ' ' + ISNULL(e.LName,'')";
// Hours between TimeIn and TimeOut (Access: DateDiff("n", Nz(TimeIn,0), Nz(TimeOut,0)) / 60, rounded to 3)
const HOURS = (t) => `ROUND(CAST(ISNULL(DATEDIFF(minute, '00:00', TRY_CAST(${t}.TimeOut AS time)),0) - ISNULL(DATEDIFF(minute, '00:00', TRY_CAST(${t}.TimeIn AS time)),0) AS decimal(18,6)) / 60, 3)`;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
router.get('/lookups', h(async (req, res) => {
  const out = {};
  const q = {
    divisions: "SELECT DivisionID AS id, DivisionID + ' – ' + DivisionName AS name FROM LsDivision ORDER BY DivisionID",
    statuses: 'SELECT StatusID AS id, Status AS name, Active FROM LsStatus ORDER BY Status',
    apptTimes: 'SELECT ApptTimeID AS id, ApptTime AS name, SortOrder FROM LsAppTime ORDER BY SortOrder',
    ticketTypes: 'SELECT TicketTypeID AS id, TicketType AS name FROM LsTicketTypeCS ORDER BY TicketType',
    jobTypes: 'SELECT CsJobTypeID AS id, CsJobType AS name, HourlyValue, MaterialMarkUp FROM LsJobTypeCS ORDER BY CsJobType',
    customerTypes: 'SELECT CustomerTypeID AS id, CustomerType AS name FROM LsCustomerTypeCS ORDER BY CustomerType',
    resolutions: 'SELECT r.ResolutionID AS id, r.Resolution AS name, r.StatusId, s.Status FROM LsResolutionCS r LEFT JOIN LsStatus s ON s.StatusID = r.StatusId ORDER BY r.Resolution',
    techTypes: 'SELECT TechTypeID AS id, TechType AS name FROM LsTechTypeCS ORDER BY TechType',
    phoneTypes: 'SELECT PhoneTypeID AS id, PhoneType AS name FROM LsPhoneType ORDER BY PhoneType',
    errors: 'SELECT ErrorID AS id, Error AS name, DivisionId FROM LsErrorCS ORDER BY Error',
    stages: 'SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage',
    states: 'SELECT StateID AS id, StateID AS name FROM LsState ORDER BY StateID',
    csJobs: "SELECT j.CsJobID AS id, j.Job + ISNULL(' (' + b.Builder + ')', '') AS name, j.Job, j.DivisionId, b.Builder FROM CsJob j LEFT JOIN CsBuilder b ON b.CsBuilderID = j.CsBuilderId ORDER BY j.Job",
    technicians: `SELECT t.TechnicianID AS id, ${TECH_NAME} AS name, tt.TechType, t.Active, CASE WHEN e.DateTermination IS NULL THEN 0 ELSE 1 END AS Terminated
                    FROM CsTechnician t JOIN PrEmployee e ON e.EmployeeID = t.EmployeeId LEFT JOIN LsTechTypeCS tt ON tt.TechTypeID = t.TechTypeId
                   ORDER BY t.Active DESC, e.FName, e.LName`,
    repNames: "SELECT DISTINCT RepName AS id, RepName AS name FROM CsScheduleAppt WHERE NULLIF(RepName,'') IS NOT NULL ORDER BY RepName",
    priceLevels: 'SELECT PriceLevelID AS id, PriceLevel AS name, MarkUpValue FROM LsPriceLevel ORDER BY MarkUpValue',
    leadStatuses: 'SELECT LeadStatusID AS id, LeadStatus AS name FROM LsLeadStatus ORDER BY OrderImportance, LeadStatus',
    cities: "SELECT DISTINCT City AS id, City AS name FROM CsProperty WHERE NULLIF(City,'') IS NOT NULL ORDER BY City",
  };
  for (const [k, sql] of Object.entries(q)) out[k] = await query(sql); // sequential: keeps the pool small
  res.json(out);
}));
router.get('/lookups/error-categories', h(async (req, res) => {
  res.json(await query('SELECT ErrorCatID AS id, Category AS name, ErrorId FROM LsErrorCategoryCS WHERE ErrorId = @e ORDER BY Category', { e: int(req.query.errorId) || 0 }));
}));
router.get('/lookups/error-details', h(async (req, res) => {
  res.json(await query('SELECT ErrorDetailID AS id, Detail AS name, ErrorCatId, AvgFixHours FROM LsErrorDetailCS WHERE ErrorCatId = @c ORDER BY Detail', { c: int(req.query.categoryId) || 0 }));
}));
// Builder rep phone: Access frmCsScheduleSetRepPhone = Last(RepPhone) for the rep name (latest ticket)
router.get('/rep-phone', h(async (req, res) => {
  const r = await one("SELECT TOP 1 RepPhone FROM CsScheduleAppt WHERE RepName = @n AND NULLIF(RepPhone,'') IS NOT NULL ORDER BY TicketID DESC", { n: String(req.query.name || '') });
  res.json({ phone: r ? r.RepPhone : null });
}));

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
router.get('/overview', h(async (req, res) => {
  const p = { today: todayIso(), div: req.query.division || null };
  const k = await one(
    `SELECT (SELECT COUNT(*) FROM CsScheduleAppt a JOIN LsStatus s ON s.StatusID = a.StatusId WHERE s.Active = 1 AND (@div IS NULL OR a.DivisionId = @div)) AS OpenTickets,
            (SELECT COUNT(*) FROM CsScheduleAppt a WHERE a.ApptDate >= @today AND (@div IS NULL OR a.DivisionId = @div)) AS Upcoming,
            (SELECT COUNT(*) FROM CsScheduleAppt a WHERE a.ApptDate = @today AND (@div IS NULL OR a.DivisionId = @div)) AS Today,
            (SELECT COUNT(*) FROM CsCustomer) AS Homeowners,
            (SELECT COUNT(*) FROM CsProperty) AS Properties,
            (SELECT COUNT(*) FROM CsTechnician WHERE Active = 1) AS ActiveTechnicians,
            (SELECT COUNT(*) FROM CsScheduleAppt a WHERE (@div IS NULL OR a.DivisionId = @div)) AS Tickets,
            (SELECT COUNT(*) FROM CsQuote) AS Quotes`, p);
  const upcoming = await query(
    `SELECT TOP 10 a.TicketID, a.ApptDate, t.ApptTime, a.DivisionId, ${HO_NAME} AS Homeowner, ${PROP_ADDR} AS Property, tt.TicketType, s.Status
       FROM CsScheduleAppt a LEFT JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId
       LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId
      WHERE a.ApptDate >= @today AND (@div IS NULL OR a.DivisionId = @div) ORDER BY a.ApptDate, t.SortOrder, a.TicketID`, p);
  const recent = await query(
    `SELECT TOP 8 a.TicketID, a.ApptDate, t.ApptTime, a.DivisionId, ${HO_NAME} AS Homeowner, ${PROP_ADDR} AS Property, s.Status, r.Resolution
       FROM CsScheduleAppt a LEFT JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId
       LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId
      WHERE (@div IS NULL OR a.DivisionId = @div) ORDER BY a.ApptDate DESC, a.TicketID DESC`, p);
  const byResolution = await query(
    `SELECT ISNULL(r.Resolution,'(none)') AS Resolution, COUNT(*) AS Tickets FROM CsScheduleAppt a LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId
      WHERE (@div IS NULL OR a.DivisionId = @div) GROUP BY r.Resolution ORDER BY COUNT(*) DESC`, p);
  res.json({ kpis: k, upcoming, recent, byResolution });
}));

// ---------------------------------------------------------------------------
// Homeowners (Access CsCustomer + CsCustomerSubPhone + CsCustomerSubProperty + CsCustomerSubHistory)
// ---------------------------------------------------------------------------
const CUST = { table: 'CsCustomer', idCol: 'CustomerID', columns: ['FirstName', 'MiddleName', 'LastName', 'Email', 'Notes'] };
function customerBody(b, partial) {
  const o = {};
  if (!partial || has(b, 'FirstName')) o.FirstName = reqStr(b.FirstName, 50, 'First name');
  if (!partial || has(b, 'LastName')) o.LastName = reqStr(b.LastName, 50, 'Last name');
  if (has(b, 'MiddleName')) o.MiddleName = str(b.MiddleName, 255, 'Middle name');
  if (has(b, 'Email')) o.Email = email(b.Email);
  if (has(b, 'Notes')) o.Notes = str(b.Notes, 255, 'Notes');
  return o;
}
router.get('/customers', h(async (req, res) => {
  const pg = paging(req.query);
  const p = { s: req.query.search ? `%${req.query.search}%` : null, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR c.FirstName + ' ' + ISNULL(c.LastName,'') LIKE @s OR ISNULL(c.LastName,'') + ', ' + c.FirstName LIKE @s OR c.Email LIKE @s
      OR EXISTS (SELECT 1 FROM CsCustomerPhone ph WHERE ph.CustomerId = c.CustomerID AND REPLACE(ph.PhoneNum,'-','') LIKE REPLACE(@s,'-',''))
      OR EXISTS (SELECT 1 FROM CsCustomerProperty cp JOIN CsProperty p ON p.PropertyID = cp.PropertyId WHERE cp.CustomerId = c.CustomerID AND p.Address LIKE @s))`;
  const rows = await query(
    `SELECT c.CustomerID, c.FirstName, c.MiddleName, c.LastName, ${HO_NAME} AS Homeowner, c.Email, c.Notes,
            (SELECT TOP 1 ph.PhoneNum FROM CsCustomerPhone ph WHERE ph.CustomerId = c.CustomerID ORDER BY ph.CustPhoneID) AS Phone,
            (SELECT COUNT(*) FROM CsCustomerProperty cp WHERE cp.CustomerId = c.CustomerID) AS Properties,
            (SELECT COUNT(*) FROM CsScheduleAppt a WHERE a.CustomerId = c.CustomerID) AS Tickets
       FROM CsCustomer c ${where} ORDER BY c.LastName, c.FirstName, c.CustomerID OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM CsCustomer c ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));
// Picker: [{id, name}] (Access cboHomeowner: Last, First Middle)
router.get('/customers/search', h(async (req, res) => {
  res.json(await query(
    `SELECT TOP 50 c.CustomerID AS id, ISNULL(c.LastName,'') + ', ' + c.FirstName + ISNULL(' ' + NULLIF(c.MiddleName,''), '') AS name, c.FirstName, c.MiddleName, c.LastName, c.Email
       FROM CsCustomer c WHERE @s IS NULL OR c.FirstName + ' ' + ISNULL(c.LastName,'') LIKE @s OR ISNULL(c.LastName,'') + ', ' + c.FirstName LIKE @s
      ORDER BY c.LastName, c.FirstName`, { s: req.query.search ? `%${req.query.search}%` : null }));
}));
async function customerDetail(id) {
  const c = await one(`SELECT c.*, ${HO_NAME} AS Homeowner FROM CsCustomer c WHERE c.CustomerID = @id`, { id });
  if (!c) return null;
  const phones = await query('SELECT ph.CustPhoneID, ph.CustomerId, ph.PhoneNum, ph.PhoneTypeId, t.PhoneType FROM CsCustomerPhone ph LEFT JOIN LsPhoneType t ON t.PhoneTypeID = ph.PhoneTypeId WHERE ph.CustomerId = @id ORDER BY ph.CustPhoneID', { id });
  const properties = await query(
    `SELECT cp.CustomerId, cp.PropertyId, cp.CustomerTypeId, ct.CustomerType, ${PROP_ADDR} AS Property, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow,
            j.JobName, l.Lot + ISNULL('/' + l.Block, '') AS LotBlock, jc.CustName AS Builder, cj.Job AS CsJob, p.CsLot, p.WarrantyVoid
       FROM CsCustomerProperty cp JOIN CsProperty p ON p.PropertyID = cp.PropertyId LEFT JOIN LsCustomerTypeCS ct ON ct.CustomerTypeID = cp.CustomerTypeId
       LEFT JOIN JsLot l ON l.LotID = p.LotId LEFT JOIN JsJob j ON j.JobId = l.JobId LEFT JOIN JsCustomer jc ON jc.CustID = j.CustId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
      WHERE cp.CustomerId = @id ORDER BY p.Address, p.City`, { id });
  // CsCustomerSubHistory
  const history = await query(
    `SELECT a.TicketID, a.ApptDate, t.ApptTime, tt.TicketType, jt.CsJobType, r.Resolution, s.Status, a.PropertyId, ${PROP_ADDR} AS Property, a.DivisionId
       FROM CsScheduleAppt a LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId
       LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId LEFT JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId
       LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId
      WHERE a.CustomerId = @id ORDER BY a.ApptDate DESC, a.TicketID DESC`, { id });
  return { customer: c, phones, properties, history };
}
router.get('/customers/:id', h(async (req, res) => {
  const d = await customerDetail(int(req.params.id) || 0);
  if (!d) return res.status(404).json({ error: 'Homeowner not found' });
  res.json(d);
}));
router.post('/customers', h(async (req, res) => {
  const b = req.body || {};
  const o = customerBody(b, false);
  const phones = (b.phones || []).map((x) => ({ PhoneNum: phone(x.PhoneNum), PhoneTypeId: optInt(x.PhoneTypeId, 'Phone type') })).filter((x) => x.PhoneNum);
  const id = await withTransaction(async (tx) => {
    if (!b.force && await exists('SELECT 1 FROM CsCustomer WHERE FirstName = @f AND LastName = @l', { f: o.FirstName, l: o.LastName }, tx)) {
      throw Object.assign(bad(`A homeowner named ${o.FirstName} ${o.LastName} already exists. Save anyway?`, 409), { needsConfirm: true });
    }
    for (const ph of phones) if (!ph.PhoneTypeId || !(await exists('SELECT 1 FROM LsPhoneType WHERE PhoneTypeID = @t', { t: ph.PhoneTypeId }, tx))) throw bad(`Choose the phone type for ${ph.PhoneNum}`);
    const cid = await insertRow(CUST, o, req.user.username, tx);
    for (const ph of phones) await insertRow(PHONE, { CustomerId: cid, ...ph }, req.user.username, tx);
    return cid;
  });
  res.status(201).json({ id });
}));
router.put('/customers/:id', h(async (req, res) => {
  const n = await updateRow(CUST, int(req.params.id) || 0, customerBody(req.body || {}, true));
  if (!n && !(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @id', { id: int(req.params.id) || 0 }))) return res.status(404).json({ error: 'Homeowner not found' });
  res.json({ ok: true });
}));
router.delete('/customers/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @id', { id }, tx))) throw bad('Homeowner not found', 404);
    const t = await one('SELECT COUNT(*) AS n FROM CsScheduleAppt WHERE CustomerId = @id', { id }, tx);
    if (t.n) throw bad(`This homeowner has ${t.n} ticket(s) and cannot be deleted.`, 409);
    if (await exists('SELECT 1 FROM CsQuote WHERE CustomerId = @id', { id }, tx)) throw bad('This homeowner has quotes and cannot be deleted.', 409);
    await query('DELETE FROM CsCustomerPhone WHERE CustomerId = @id', { id }, tx);
    await query('DELETE FROM CsCustomerProperty WHERE CustomerId = @id', { id }, tx);
    await query('DELETE FROM CsCustomer WHERE CustomerID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// Phones
const PHONE = { table: 'CsCustomerPhone', idCol: 'CustPhoneID', columns: ['CustomerId', 'PhoneNum', 'PhoneTypeId'] };
router.post('/customers/:id/phones', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const PhoneNum = phone(b.PhoneNum); if (!PhoneNum) throw bad('Enter the phone number');
  const PhoneTypeId = optInt(b.PhoneTypeId, 'Phone type'); if (!PhoneTypeId) throw bad('Choose the phone type');
  const pid = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @id', { id }, tx))) throw bad('Homeowner not found', 404);
    if (!(await exists('SELECT 1 FROM LsPhoneType WHERE PhoneTypeID = @t', { t: PhoneTypeId }, tx))) throw bad('Choose a valid phone type');
    if (await exists('SELECT 1 FROM CsCustomerPhone WHERE CustomerId = @id AND PhoneNum = @n AND PhoneTypeId = @t', { id, n: PhoneNum, t: PhoneTypeId }, tx)) throw bad('This phone number is already on the homeowner', 409);
    return insertRow(PHONE, { CustomerId: id, PhoneNum, PhoneTypeId }, req.user.username, tx);
  });
  res.status(201).json({ id: pid });
}));
router.put('/phones/:pid', h(async (req, res) => {
  const b = req.body || {}, o = {};
  if (has(b, 'PhoneNum')) { o.PhoneNum = phone(b.PhoneNum); if (!o.PhoneNum) throw bad('Enter the phone number'); }
  if (has(b, 'PhoneTypeId')) {
    o.PhoneTypeId = optInt(b.PhoneTypeId, 'Phone type');
    if (!o.PhoneTypeId || !(await exists('SELECT 1 FROM LsPhoneType WHERE PhoneTypeID = @t', { t: o.PhoneTypeId }))) throw bad('Choose a valid phone type');
  }
  const pid = int(req.params.pid) || 0;
  if (!(await exists('SELECT 1 FROM CsCustomerPhone WHERE CustPhoneID = @id', { id: pid }))) return res.status(404).json({ error: 'Phone not found' });
  await updateRow(PHONE, pid, o);
  res.json({ ok: true });
}));
router.delete('/phones/:pid', h(async (req, res) => {
  const r = await one('DELETE FROM CsCustomerPhone WHERE CustPhoneID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.pid) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Phone not found' });
  res.json({ ok: true });
}));

// Homeowner <-> property links (CsCustomerProperty, composite key CustomerId + PropertyId)
async function checkLink(tx, customerId, propertyId, typeId) {
  if (!(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @c', { c: customerId }, tx))) throw bad('Homeowner not found', 404);
  if (!(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @p', { p: propertyId }, tx))) throw bad('Choose a property');
  if (typeId == null || !(await exists('SELECT 1 FROM LsCustomerTypeCS WHERE CustomerTypeID = @t', { t: typeId }, tx))) throw bad('Choose the customer type (owner, tenant…)');
}
router.post('/customers/:id/properties', h(async (req, res) => {
  const c = int(req.params.id) || 0, p = optInt(req.body?.PropertyId, 'Property'), t = optInt(req.body?.CustomerTypeId, 'Customer type');
  if (!p) throw bad('Choose a property');
  await withTransaction(async (tx) => {
    await checkLink(tx, c, p, t);
    if (await exists('SELECT 1 FROM CsCustomerProperty WHERE CustomerId = @c AND PropertyId = @p', { c, p }, tx)) throw bad('This property is already linked to the homeowner', 409);
    await query('INSERT INTO CsCustomerProperty (CustomerId, PropertyId, CustomerTypeId, ScheduleAppt, DateEntered, UserEntered) VALUES (@c, @p, @t, 0, GETDATE(), @u)', { c, p, t, u: req.user.username }, tx);
  });
  res.status(201).json({ ok: true });
}));
router.put('/customers/:id/properties/:propertyId', h(async (req, res) => {
  const c = int(req.params.id) || 0, p = int(req.params.propertyId) || 0, t = optInt(req.body?.CustomerTypeId, 'Customer type');
  await withTransaction(async (tx) => {
    await checkLink(tx, c, p, t);
    const r = await one('UPDATE CsCustomerProperty SET CustomerTypeId = @t WHERE CustomerId = @c AND PropertyId = @p; SELECT @@ROWCOUNT AS n', { c, p, t }, tx);
    if (!r.n) throw bad('Link not found', 404);
  });
  res.json({ ok: true });
}));
router.delete('/customers/:id/properties/:propertyId', h(async (req, res) => {
  const r = await one('DELETE FROM CsCustomerProperty WHERE CustomerId = @c AND PropertyId = @p; SELECT @@ROWCOUNT AS n', { c: int(req.params.id) || 0, p: int(req.params.propertyId) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Link not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Properties (Access CsProperty + CsPropertySubCustomer + CsPropertySubProductionJobLot)
// ---------------------------------------------------------------------------
const PROP = { table: 'CsProperty', idCol: 'PropertyID', columns: ['Address', 'UnitApt', 'City', 'StateId', 'Zip', 'Escrow', 'CsCommunity', 'CsLot', 'CsJobId', 'LotId', 'Notes', 'WarrantyVoid', 'WarrantyVoidNotes', 'UserSelect', 'DoNotChange', 'SaPriorityId'] };
async function propertyBody(b, partial, tx) {
  const o = {};
  if (!partial || has(b, 'Address')) o.Address = reqStr(b.Address, 50, 'Street address');
  if (!partial || has(b, 'City')) o.City = reqStr(b.City, 50, 'City');
  if (!partial || has(b, 'StateId')) {
    o.StateId = reqStr(b.StateId, 50, 'State').toUpperCase();
    if (!/^[A-Z]{2}$/.test(o.StateId)) throw bad('State must be 2 letters (e.g. CA)');
  }
  if (has(b, 'Zip')) o.Zip = zip(b.Zip);
  if (has(b, 'UnitApt')) o.UnitApt = str(b.UnitApt, 255, 'Unit/apt');
  if (has(b, 'Escrow')) o.Escrow = optDate(b.Escrow, 'Escrow date');
  if (has(b, 'CsLot')) o.CsLot = str(b.CsLot, 50, 'CS lot/block');
  if (has(b, 'Notes')) o.Notes = str(b.Notes, 255, 'Notes');
  if (has(b, 'WarrantyVoid')) o.WarrantyVoid = bit(b.WarrantyVoid);
  if (has(b, 'WarrantyVoidNotes')) o.WarrantyVoidNotes = str(b.WarrantyVoidNotes, 255, 'Warranty void notes');
  if (has(b, 'CsJobId')) {
    o.CsJobId = optInt(b.CsJobId, 'CS job');
    if (o.CsJobId) {
      const j = await one('SELECT Job FROM CsJob WHERE CsJobID = @j', { j: o.CsJobId }, tx);
      if (!j) throw bad('Choose a valid CS job / community');
      o.CsCommunity = j.Job; // Access: community combo sets CsJobId from CsJob.Job
    } else o.CsCommunity = null;
  }
  if (has(b, 'LotId')) {
    o.LotId = optInt(b.LotId, 'Production lot');
    if (o.LotId && !(await exists('SELECT 1 FROM JsLot WHERE LotID = @l', { l: o.LotId }, tx))) throw bad('Choose a valid production lot');
  }
  return o;
}
const PROP_SELECT = `p.PropertyID, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow, p.CsCommunity, p.CsLot, p.CsJobId, p.LotId, p.Notes, p.WarrantyVoid, p.WarrantyVoidNotes,
  p.DateEntered, p.UserEntered, ${PROP_ADDR} AS Property, cj.Job AS CsJob, cb.Builder, j.JobName, l.Lot + ISNULL('/' + l.Block, '') AS LotBlock, l.EndDate AS LotEndDate`;
const PROP_FROM = `FROM CsProperty p LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId LEFT JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId
  LEFT JOIN JsLot l ON l.LotID = p.LotId LEFT JOIN JsJob j ON j.JobId = l.JobId`;
router.get('/properties', h(async (req, res) => {
  const pg = paging(req.query);
  const p = { s: req.query.search ? `%${req.query.search}%` : null, city: req.query.city ? `%${req.query.city}%` : null, job: optInt(req.query.csJobId, 'CS job'), offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@s IS NULL OR p.Address LIKE @s OR p.CsCommunity LIKE @s OR p.CsLot LIKE @s OR CAST(p.Zip AS varchar(10)) LIKE @s
      OR EXISTS (SELECT 1 FROM CsCustomerProperty cp JOIN CsCustomer c ON c.CustomerID = cp.CustomerId WHERE cp.PropertyId = p.PropertyID AND c.FirstName + ' ' + ISNULL(c.LastName,'') LIKE @s))
    AND (@city IS NULL OR p.City LIKE @city) AND (@job IS NULL OR p.CsJobId = @job)`;
  const rows = await query(
    `SELECT ${PROP_SELECT},
            (SELECT COUNT(*) FROM CsCustomerProperty cp WHERE cp.PropertyId = p.PropertyID) AS Homeowners,
            (SELECT COUNT(*) FROM CsScheduleAppt a WHERE a.PropertyId = p.PropertyID) AS Tickets
       ${PROP_FROM} ${where} ORDER BY p.Address, p.City, p.PropertyID OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM CsProperty p ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));
router.get('/properties/search', h(async (req, res) => {
  res.json(await query(
    `SELECT TOP 50 p.PropertyID AS id, ${PROP_ADDR} AS name, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow, p.CsCommunity, p.CsLot, p.CsJobId, p.LotId
       FROM CsProperty p WHERE @s IS NULL OR p.Address LIKE @s OR p.City LIKE @s ORDER BY p.Address, p.City`, { s: req.query.search ? `%${req.query.search}%` : null }));
}));
async function propertyDetail(id) {
  const prop = await one(`SELECT ${PROP_SELECT} ${PROP_FROM} WHERE p.PropertyID = @id`, { id });
  if (!prop) return null;
  // Access CsSchedule PropertyId AfterUpdate: "This property is still open in production" when the lot has no end date
  prop.OpenInProduction = !!(prop.LotId && !prop.LotEndDate);
  const customers = await query(
    `SELECT cp.CustomerId, cp.CustomerTypeId, ct.CustomerType, ${HO_NAME} AS Homeowner, c.Email,
            (SELECT TOP 1 ph.PhoneNum FROM CsCustomerPhone ph WHERE ph.CustomerId = c.CustomerID ORDER BY ph.CustPhoneID) AS Phone
       FROM CsCustomerProperty cp JOIN CsCustomer c ON c.CustomerID = cp.CustomerId LEFT JOIN LsCustomerTypeCS ct ON ct.CustomerTypeID = cp.CustomerTypeId
      WHERE cp.PropertyId = @id ORDER BY c.LastName, c.FirstName`, { id });
  const tickets = await query(
    `SELECT a.TicketID, a.ApptDate, t.ApptTime, a.DivisionId, s.Status, r.Resolution, tt.TicketType, ${HO_NAME} AS Homeowner
       FROM CsScheduleAppt a LEFT JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId
       LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId
      WHERE a.PropertyId = @id ORDER BY a.ApptDate DESC, a.TicketID DESC`, { id });
  const callNotes = await query('SELECT CallNotesID, CallDate, Customer, CallNotes, FollowUp, DateEntered, UserEntered FROM CsCallNotes WHERE PropertyId = @id ORDER BY CallDate DESC, CallNotesID DESC', { id });
  const links = await query(
    `SELECT k.CsPropertyLinkID, k.CsJobId, cj.Job AS CsJob, k.CsLot, k.JsJobId, j.JobName, j.DivisionId, k.LotId, l.Lot + ISNULL('/' + l.Block, '') AS LotBlock, l.Address AS LotAddress, l.StartDate, l.EndDate, k.DateEntered
       FROM CsPropertyLink k LEFT JOIN CsJob cj ON cj.CsJobID = k.CsJobId LEFT JOIN JsLot l ON l.LotID = k.LotId LEFT JOIN JsJob j ON j.JobId = ISNULL(k.JsJobId, l.JobId)
      WHERE k.PropertyID = @id ORDER BY k.CsPropertyLinkID`, { id });
  // CsScheduleSubLotPacks: packs of the production lot(s) behind the property
  const packs = await query(
    `SELECT jp.LotId, pt.PackType, pk.PackName, jp.PackQty, jp.PostedQty
       FROM JsPack jp JOIN PmPack pk ON pk.PmPackID = jp.PmPackId LEFT JOIN LsPackType pt ON pt.PackTypeID = jp.PackTypeId
      WHERE jp.LotId IN (SELECT LotId FROM CsPropertyLink WHERE PropertyID = @id AND LotId IS NOT NULL UNION SELECT LotId FROM CsProperty WHERE PropertyID = @id AND LotId IS NOT NULL)
      ORDER BY jp.LotId, pk.PackName`, { id });
  return { property: prop, customers, tickets, callNotes, links, packs };
}
router.get('/properties/:id', h(async (req, res) => {
  const d = await propertyDetail(int(req.params.id) || 0);
  if (!d) return res.status(404).json({ error: 'Property not found' });
  res.json(d);
}));
async function dupProperty(tx, o, exceptId) {
  return one(`SELECT TOP 1 PropertyID FROM CsProperty WHERE Address = @a AND City = @c AND StateId = @s AND ISNULL(UnitApt,'') = ISNULL(@u,'') AND (@x IS NULL OR PropertyID <> @x)`,
    { a: o.Address, c: o.City, s: o.StateId, u: o.UnitApt ?? null, x: exceptId ?? null }, tx);
}
router.post('/properties', h(async (req, res) => {
  const b = req.body || {};
  const id = await withTransaction(async (tx) => {
    const o = await propertyBody(b, false, tx);
    const d = await dupProperty(tx, o);
    if (d && !b.force) throw Object.assign(bad(`Property #${d.PropertyID} already has this address. Save a second one anyway?`, 409), { needsConfirm: true, existingId: d.PropertyID });
    if (o.WarrantyVoid == null) o.WarrantyVoid = 0;
    return insertRow(PROP, o, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/properties/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await one('SELECT * FROM CsProperty WHERE PropertyID = @id', { id }, tx);
    if (!cur) throw bad('Property not found', 404);
    const o = await propertyBody(b, true, tx);
    const m = { ...cur, ...o };
    if (('Address' in o || 'City' in o || 'StateId' in o || 'UnitApt' in o) && !b.force) {
      const d = await dupProperty(tx, m, id);
      if (d) throw Object.assign(bad(`Property #${d.PropertyID} already has this address. Save anyway?`, 409), { needsConfirm: true, existingId: d.PropertyID });
    }
    await updateRow(PROP, id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/properties/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @id', { id }, tx))) throw bad('Property not found', 404);
    const t = await one('SELECT COUNT(*) AS n FROM CsScheduleAppt WHERE PropertyId = @id', { id }, tx);
    if (t.n) throw bad(`This property has ${t.n} ticket(s) and cannot be deleted.`, 409);
    if (await exists('SELECT 1 FROM CsCallNotes WHERE PropertyId = @id', { id }, tx)) throw bad('This property has call notes and cannot be deleted.', 409);
    if (await exists('SELECT 1 FROM CsQuote WHERE PropertyId = @id', { id }, tx)) throw bad('This property has quotes and cannot be deleted.', 409);
    await query('DELETE FROM CsCustomerProperty WHERE PropertyId = @id', { id }, tx);
    await query('DELETE FROM CsPropertyLink WHERE PropertyID = @id', { id }, tx);
    await query('DELETE FROM CsProperty WHERE PropertyID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// CS jobs / communities (CsJob + CsBuilder) for the property form
router.get('/cs-jobs', h(async (req, res) => {
  res.json(await query(
    `SELECT TOP 100 j.CsJobID AS id, j.Job + ISNULL(' – ' + b.Builder, '') AS name, j.Job, j.DivisionId, b.Builder, j.JobId
       FROM CsJob j LEFT JOIN CsBuilder b ON b.CsBuilderID = j.CsBuilderId
      WHERE (@s IS NULL OR j.Job LIKE @s OR b.Builder LIKE @s) AND (@d IS NULL OR j.DivisionId = @d) ORDER BY j.Job`,
    { s: req.query.search ? `%${req.query.search}%` : null, d: req.query.division || null }));
}));

// ---------------------------------------------------------------------------
// Production lots -> CS properties
// ---------------------------------------------------------------------------
const LOT_ADDR_OK = "l.Address IS NOT NULL AND l.Address NOT LIKE 'Unknow%' AND l.Address NOT LIKE 'Construction%' AND l.Address NOT LIKE 'Sales%'";
// Lots not yet in CS (Access vCsPropertySearchJLot with the address / city filters of the CsProperty form)
router.get('/production-lots', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = { a: req.query.address ? `%${req.query.address}%` : null, c: req.query.city ? `%${req.query.city}%` : null, d: req.query.division || null, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE ${LOT_ADDR_OK} AND (@a IS NULL OR l.Address LIKE @a) AND (@c IS NULL OR l.City LIKE @c) AND (@d IS NULL OR j.DivisionId = @d)
      AND NOT EXISTS (SELECT 1 FROM CsPropertyLink k WHERE k.LotId = l.LotID) AND NOT EXISTS (SELECT 1 FROM CsProperty p WHERE p.LotId = l.LotID)
      AND NOT EXISTS (SELECT 1 FROM CsProperty p WHERE p.Address = l.Address AND p.City = l.City AND p.StateId = l.State)`;
  const rows = await query(
    `SELECT l.LotID, l.Address, l.City, l.State, l.Zip, j.DivisionId, j.JobName, l.Lot, l.Block, l.Lot + ISNULL('/' + l.Block, '') AS LotBlock, l.StartDate, l.EndDate
       FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId ${where} ORDER BY l.Address, l.City OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));
// Make sure the lot's builder + job exist as CsBuilder / CsJob (qryCsProperty01AddBuilder / 02AddJob for one job)
async function ensureCsJob(tx, jobId, username) {
  const cj = await one('SELECT CsJobID, Job FROM CsJob WHERE JobId = @j', { j: jobId }, tx);
  if (cj) return cj;
  const j = await one('SELECT j.JobId, j.JobName, j.DivisionId, j.CustId, c.CustName FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId WHERE j.JobId = @j', { j: jobId }, tx);
  if (!j) return null;
  let b = await one('SELECT CsBuilderID FROM CsBuilder WHERE Builder = @n', { n: j.CustName }, tx);
  if (!b) b = { CsBuilderID: await insertRow({ table: 'CsBuilder', idCol: 'CsBuilderID', columns: ['Builder', 'JsCustId'] }, { Builder: j.CustName, JsCustId: j.CustId }, username, tx) };
  const id = await insertRow({ table: 'CsJob', idCol: 'CsJobID', columns: ['CsBuilderId', 'Job', 'JobId', 'DivisionId', 'DoNotChange'] }, { CsBuilderId: b.CsBuilderID, Job: j.JobName, JobId: j.JobId, DivisionId: j.DivisionId, DoNotChange: 0 }, username, tx);
  return { CsJobID: id, Job: j.JobName };
}
// Escrow: Access IIf(IsNull(WarrantyDate), EndDate, WarrantyDate) (WarrantyDate is text in JsLot)
const ESCROW = 'COALESCE(TRY_CAST(l.WarrantyDate AS datetime), l.EndDate)';
// Click a lot in the property form list (frmCsPropertySearchAdd01Address + 02LotId)
router.post('/production-lots/:lotId/add', h(async (req, res) => {
  const lotId = int(req.params.lotId) || 0;
  const out = await withTransaction(async (tx) => {
    const l = await one(`SELECT l.LotID, l.JobId, l.Address, l.City, l.State, l.Zip, l.Lot, l.Block, ${ESCROW} AS Escrow FROM JsLot l WHERE l.LotID = @l`, { l: lotId }, tx);
    if (!l) throw bad('Lot not found', 404);
    if (!l.Address) throw bad('This lot has no address');
    if (await exists('SELECT 1 FROM CsPropertyLink WHERE LotId = @l UNION ALL SELECT 1 FROM CsProperty WHERE LotId = @l', { l: lotId }, tx)) throw bad('This lot is already a CS property', 409);
    const cj = await ensureCsJob(tx, l.JobId, req.user.username);
    const lotBlock = `${l.Lot ?? ''}/${l.Block ?? ''}`; // Access: [Lot] & "/" & [Block]
    const pid = await insertRow(PROP, { Address: l.Address, City: l.City || 'No city selected', StateId: l.State || 'CA', Zip: l.Zip ?? 66666, Escrow: l.Escrow,
      CsCommunity: cj?.Job ?? null, CsJobId: cj?.CsJobID ?? null, CsLot: lotBlock, LotId: lotId, WarrantyVoid: 0 }, req.user.username, tx);
    await query('INSERT INTO CsPropertyLink (PropertyID, CsJobId, CsLot, JsJobId, LotId, DateEntered, UserEntered) VALUES (@p, @cj, @lb, @j, @l, GETDATE(), @u)',
      { p: pid, cj: cj?.CsJobID ?? null, lb: lotBlock, j: l.JobId, l: lotId, u: req.user.username }, tx);
    return { propertyId: pid };
  });
  res.status(201).json(out);
}));
// "Add production jobs/lots" for a division (macro CsProductionLotsAdd: qryCsProperty01..05 + 06 check)
router.post('/production-lots/import', h(async (req, res) => {
  const div = str(req.body?.division, 50, 'Division');
  if (!div) throw bad('Select division');
  const out = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM LsDivision WHERE DivisionID = @d', { d: div }, tx))) throw bad('Select a valid division');
    const u = req.user.username, P = { d: div, u };
    // 01: builders of active builders with jobs in the division
    const b0 = await nextId(tx, 'CsBuilder', 'CsBuilderID');
    const b = await query(`INSERT INTO CsBuilder (CsBuilderID, Builder, JsCustId, DateEntered, UserEntered)
      SELECT @b0 - 1 + ROW_NUMBER() OVER (ORDER BY x.CustName), x.CustName, x.CustID, GETDATE(), @u FROM (
        SELECT DISTINCT c.CustName, c.CustID FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId JOIN LsStatus s ON s.StatusID = c.StatusId
         WHERE j.DivisionId = @d AND s.Active = 1 AND NOT EXISTS (SELECT 1 FROM CsBuilder cb WHERE cb.Builder = c.CustName)) x; SELECT @@ROWCOUNT AS n`, { ...P, b0 }, tx);
    // 02: active jobs of those builders
    const j0 = await nextId(tx, 'CsJob', 'CsJobID');
    const j = await query(`INSERT INTO CsJob (CsJobID, CsBuilderId, Job, JobId, DivisionId, DoNotChange, DateEntered, UserEntered)
      SELECT @j0 - 1 + ROW_NUMBER() OVER (ORDER BY x.JobName, x.JobId), x.CsBuilderID, x.JobName, x.JobId, x.DivisionId, 0, GETDATE(), @u FROM (
        SELECT MIN(cb.CsBuilderID) AS CsBuilderID, jj.JobName, jj.JobId, jj.DivisionId FROM CsBuilder cb JOIN JsJob jj ON jj.CustId = cb.JsCustId JOIN LsStatus s ON s.StatusID = jj.StatusId
         WHERE jj.DivisionId = @d AND s.Active = 1 AND NOT EXISTS (SELECT 1 FROM CsJob c2 WHERE c2.JobId = jj.JobId) GROUP BY jj.JobName, jj.JobId, jj.DivisionId) x; SELECT @@ROWCOUNT AS n`, { ...P, j0 }, tx);
    // 03: links without a lot id get the matching lot
    const u3 = await query(`UPDATE k SET k.LotId = l.LotID FROM CsPropertyLink k JOIN CsProperty p ON p.PropertyID = k.PropertyID
        JOIN JsLot l ON l.Address = p.Address AND l.City = p.City AND l.State = p.StateId JOIN JsJob jj ON jj.JobId = l.JobId JOIN CsJob cj ON cj.JobId = jj.JobId
       WHERE k.LotId IS NULL AND jj.DivisionId = @d; SELECT @@ROWCOUNT AS n`, P, tx);
    // 04: one property per new address (Access inserted one per lot; duplicates of the same address are collapsed here)
    const p0 = await nextId(tx, 'CsProperty', 'PropertyID');
    const p4 = await query(`INSERT INTO CsProperty (PropertyID, Address, City, StateId, Zip, Escrow, CsCommunity, CsLot, Notes, CsJobId, LotId, WarrantyVoid, DateEntered, UserEntered)
      SELECT @p0 - 1 + ROW_NUMBER() OVER (ORDER BY x.Address, x.City, x.LotID), x.Address, x.City, x.StateId, x.Zip, x.Escrow, x.Job, x.LotBlock, x.Notes, x.CsJobID, x.LotID, 0, GETDATE(), @u FROM (
        SELECT l.LotID, l.Address, ISNULL(l.City,'No city selected') AS City, ISNULL(l.State,'CA') AS StateId, ISNULL(l.Zip,66666) AS Zip, ${ESCROW} AS Escrow, cj.Job, cj.CsJobID,
               ISNULL(l.Lot,'') + ISNULL('/' + l.Block, '') AS LotBlock,
               LEFT('Production start date ' + ISNULL(FORMAT(l.StartDate,'M/d/yyyy'),'') + '.  ' + ISNULL(l.LotNotes,''), 255) AS Notes,
               ROW_NUMBER() OVER (PARTITION BY l.Address, ISNULL(l.City,'No city selected'), ISNULL(l.State,'CA') ORDER BY l.LotID DESC) AS rn
          FROM JsLot l JOIN JsJob jj ON jj.JobId = l.JobId JOIN CsJob cj ON cj.JobId = jj.JobId
         WHERE ${LOT_ADDR_OK} AND jj.DivisionId = @d
           AND NOT EXISTS (SELECT 1 FROM CsProperty p WHERE p.Address = l.Address AND p.City = l.City AND p.StateId = l.State)) x
      WHERE x.rn = 1; SELECT @@ROWCOUNT AS n`, { ...P, p0 }, tx);
    // 05: link every lot to its property
    const l5 = await query(`INSERT INTO CsPropertyLink (PropertyID, CsJobId, CsLot, JsJobId, LotId, DateEntered, UserEntered)
      SELECT p.PropertyID, cj.CsJobID, ISNULL(l.Lot,'') + ISNULL('/' + l.Block, ''), cj.JobId, l.LotID, GETDATE(), @u
        FROM JsLot l JOIN CsProperty p ON l.Address = p.Address AND l.City = p.City AND l.State = p.StateId JOIN JsJob jj ON jj.JobId = l.JobId JOIN CsJob cj ON cj.JobId = jj.JobId
       WHERE l.Address NOT LIKE 'Unknow%' AND jj.DivisionId = @d AND NOT EXISTS (SELECT 1 FROM CsPropertyLink k WHERE k.LotId = l.LotID)
       GROUP BY p.PropertyID, cj.CsJobID, ISNULL(l.Lot,'') + ISNULL('/' + l.Block, ''), cj.JobId, l.LotID; SELECT @@ROWCOUNT AS n`, P, tx);
    // 06: lots linked twice to the same property (Access report CsPropertyUpdate)
    const dup = await query(`SELECT cj.DivisionId, cb.Builder, cj.Job, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, k.CsLot, k.LotId
        FROM (SELECT CsJobId, PropertyID, LotId FROM CsPropertyLink GROUP BY CsJobId, PropertyID, LotId HAVING COUNT(*) > 1) d
        JOIN CsJob cj ON cj.CsJobID = d.CsJobId LEFT JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId JOIN CsProperty p ON p.PropertyID = d.PropertyID
        JOIN CsPropertyLink k ON k.PropertyID = d.PropertyID AND k.CsJobId = d.CsJobId AND k.LotId = d.LotId
       WHERE cj.DivisionId = @d ORDER BY cj.Job, k.CsLot`, P, tx);
    return { builders: b[0].n, jobs: j[0].n, linksUpdated: u3[0].n, properties: p4[0].n, links: l5[0].n, duplicates: dup };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Appointments / tickets (CsScheduleAppt)
// ---------------------------------------------------------------------------
const APPT_SELECT = `a.TicketID, a.ApptDate, a.ApptTimeId, t.ApptTime, t.SortOrder, a.TicketTypeId, tt.TicketType, a.CsjobTypeId, jt.CsJobType, a.DivisionId,
  a.PropertyId, ${PROP_ADDR} AS Property, p.City, cj.Job, p.CsLot, a.CustomerId, ${HO_NAME} AS Homeowner, a.RepName, a.RepPhone, a.EstimatedHours, a.CustomerPONum, a.HighCeiling,
  a.StatusId, s.Status, s.Active AS StatusActive, a.ResolutionId, r.Resolution, a.Notes,
  (SELECT COUNT(*) FROM CsScheduleTechnician x WHERE x.TicketId = a.TicketID AND x.ApptDate = a.ApptDate) AS TechQty`;
const APPT_FROM = `FROM CsScheduleAppt a LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId LEFT JOIN CsCustomer c ON c.CustomerID = a.CustomerId
  LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId
  LEFT JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId`;

router.get('/appointments', h(async (req, res) => {
  const pg = paging({ ...req.query, pageSize: req.query.pageSize || 50 });
  const p = {
    s: req.query.search ? `%${req.query.search}%` : null, div: req.query.division || null, from: optDate(req.query.from, 'From date'), to: optDate(req.query.to, 'To date'),
    st: optInt(req.query.statusId, 'Status'), res: optInt(req.query.resolutionId, 'Resolution'), cust: optInt(req.query.customerId, 'Homeowner'), prop: optInt(req.query.propertyId, 'Property'),
    open: req.query.open === '1' ? 1 : 0, offset: pg.offset, pageSize: pg.pageSize,
  };
  const where = `WHERE (@s IS NULL OR CAST(a.TicketID AS varchar(20)) LIKE @s OR p.Address LIKE @s OR c.FirstName + ' ' + ISNULL(c.LastName,'') LIKE @s OR a.RepName LIKE @s OR cj.Job LIKE @s)
    AND (@div IS NULL OR a.DivisionId = @div) AND (@from IS NULL OR a.ApptDate >= @from) AND (@to IS NULL OR a.ApptDate <= @to) AND (@st IS NULL OR a.StatusId = @st)
    AND (@res IS NULL OR a.ResolutionId = @res) AND (@cust IS NULL OR a.CustomerId = @cust) AND (@prop IS NULL OR a.PropertyId = @prop) AND (@open = 0 OR s.Active = 1)`;
  const order = req.query.sort === 'asc' ? 'a.ApptDate, t.SortOrder, a.TicketID' : 'a.TicketID DESC';
  const rows = await query(`SELECT ${APPT_SELECT} ${APPT_FROM} ${where} ORDER BY ${order} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n ${APPT_FROM} ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));

// Ticket tracking "Go to ticket" list: division required, open tickets (LsStatus.Active) or all
router.get('/tickets', h(async (req, res) => {
  const div = req.query.division;
  if (!div) throw bad('Select division');
  res.json(await query(
    `SELECT a.TicketID AS id, CAST(a.TicketID AS varchar(20)) + ' | ' + CONVERT(varchar(10), a.ApptDate, 101) + ' | ' + ISNULL(c.LastName,'') + ' | ' + ISNULL(p.Address,'') + ', ' + ISNULL(p.City,'') AS name,
            a.ApptDate, c.LastName AS Customer, p.Address + ', ' + ISNULL(p.City,'') AS Property, s.Status
       FROM CsScheduleAppt a JOIN CsCustomer c ON c.CustomerID = a.CustomerId JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN LsStatus s ON s.StatusID = a.StatusId
      WHERE a.DivisionId = @d AND (@open = 0 OR s.Active = 1) AND (@s IS NULL OR CAST(a.TicketID AS varchar(20)) LIKE @s OR c.LastName LIKE @s OR p.Address LIKE @s)
      ORDER BY a.TicketID DESC`, { d: div, open: req.query.open === '0' ? 0 : 1, s: req.query.search ? `%${req.query.search}%` : null }));
}));

async function apptDetail(id) {
  const a = await one(`SELECT a.*, t.ApptTime, tt.TicketType, jt.CsJobType, s.Status, s.Active AS StatusActive, r.Resolution, ${HO_NAME} AS Homeowner, c.Email, c.Notes AS CustomerNotes,
      ${PROP_ADDR} AS Property, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow, p.CsCommunity, p.CsLot, p.LotId, p.WarrantyVoid, p.WarrantyVoidNotes, cj.Job,
      (SELECT TOP 1 ct.CustomerType FROM CsCustomerProperty cp JOIN LsCustomerTypeCS ct ON ct.CustomerTypeID = cp.CustomerTypeId WHERE cp.PropertyId = a.PropertyId AND cp.CustomerId = a.CustomerId) AS CustomerType,
      (SELECT TOP 1 cp.CustomerTypeId FROM CsCustomerProperty cp WHERE cp.PropertyId = a.PropertyId AND cp.CustomerId = a.CustomerId) AS CustomerTypeId,
      l.EndDate AS LotEndDate
      FROM CsScheduleAppt a LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId LEFT JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
      LEFT JOIN JsLot l ON l.LotID = p.LotId LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId
      LEFT JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId LEFT JOIN LsStatus s ON s.StatusID = a.StatusId LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId
     WHERE a.TicketID = @id`, { id });
  if (!a) return null;
  a.OpenInProduction = !!(a.LotId && !a.LotEndDate);
  const technicians = await query(
    `SELECT x.TicketTechID, x.TicketId, x.ApptDate, x.TechnicianId, ${TECH_NAME} AS Technician, tt.TechType, x.TimeIn, x.TimeOut, ${HOURS('x')} AS Hours
       FROM CsScheduleTechnician x LEFT JOIN CsTechnician t ON t.TechnicianID = x.TechnicianId LEFT JOIN PrEmployee e ON e.EmployeeID = t.EmployeeId LEFT JOIN LsTechTypeCS tt ON tt.TechTypeID = t.TechTypeId
      WHERE x.TicketId = @id ORDER BY x.ApptDate DESC, x.TicketTechID`, { id });
  const errors = await query(
    `SELECT er.ScheduleErrorID, er.TicketId, er.ApptDate, er.ErrorId, le.Error, er.ErrorCatId, lc.Category, er.ErrorDetailId, ld.Detail, er.StageId, ss.ScheduleStage,
            er.LeadTechnicianId, ${TECH_NAME} AS LeadTechnician
       FROM CsScheduleError er LEFT JOIN LsErrorCS le ON le.ErrorID = er.ErrorId LEFT JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId
       LEFT JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId LEFT JOIN LsScheduleStage ss ON ss.ScheduleStageID = er.StageId
       LEFT JOIN CsTechnician t ON t.TechnicianID = er.LeadTechnicianId LEFT JOIN PrEmployee e ON e.EmployeeID = t.EmployeeId
      WHERE er.TicketId = @id ORDER BY er.ScheduleErrorID`, { id });
  const materials = await query(
    `SELECT m.ScheduleMaterialID, m.ScheduleErrorId, m.InvItemId, i.InvItem, i.Description, m.Quantity, m.ItemCostEa, m.Quantity * m.ItemCostEa AS ExtCost
       FROM CsScheduleMaterial m JOIN CsScheduleError er ON er.ScheduleErrorID = m.ScheduleErrorId LEFT JOIN IcItem i ON i.InvItemID = m.InvItemId
      WHERE er.TicketId = @id ORDER BY m.ScheduleMaterialID`, { id });
  const phones = await query('SELECT ph.CustPhoneID, ph.PhoneNum, ph.PhoneTypeId, t.PhoneType FROM CsCustomerPhone ph LEFT JOIN LsPhoneType t ON t.PhoneTypeID = ph.PhoneTypeId WHERE ph.CustomerId = @c ORDER BY ph.CustPhoneID', { c: a.CustomerId || 0 });
  const jobLots = await query('SELECT k.CsPropertyLinkID, cj.Job, k.CsLot, k.LotId, k.DateEntered FROM CsPropertyLink k JOIN CsJob cj ON cj.CsJobID = k.CsJobId WHERE k.PropertyID = @p', { p: a.PropertyId || 0 });
  return { appointment: a, technicians, errors, materials, phones, jobLots };
}
router.get('/appointments/:id', h(async (req, res) => {
  const d = await apptDetail(int(req.params.id) || 0);
  if (!d) return res.status(404).json({ error: 'Ticket not found' });
  res.json(d);
}));

// Validate the appointment fields shared by schedule + edit. partial = only fields present.
async function apptFields(b, partial, tx) {
  const o = {};
  const need = (k) => !partial || has(b, k);
  const lookup = async (k, label, sql, msg) => {
    if (!need(k)) return;
    const v = optInt(b[k], label);
    if (v == null) throw bad(msg);
    if (!(await exists(sql, { v }, tx))) throw bad(`Choose a valid ${label.toLowerCase()}`);
    o[k] = v;
  };
  if (need('ApptDate')) { o.ApptDate = optDate(b.ApptDate, 'Appointment date'); if (!o.ApptDate) throw bad('Please set appointment date'); }
  await lookup('ApptTimeId', 'Appointment time', 'SELECT 1 FROM LsAppTime WHERE ApptTimeID = @v', 'Set appointment time');
  await lookup('TicketTypeId', 'Ticket type', 'SELECT 1 FROM LsTicketTypeCS WHERE TicketTypeID = @v', 'Set ticket type');
  await lookup('CsjobTypeId', 'Job type', 'SELECT 1 FROM LsJobTypeCS WHERE CsJobTypeID = @v', 'Set job type');
  if (need('DivisionId')) {
    o.DivisionId = str(b.DivisionId, 50, 'Division');
    if (!o.DivisionId) throw bad('Select division');
    if (!(await exists('SELECT 1 FROM LsDivision WHERE DivisionID = @v', { v: o.DivisionId }, tx))) throw bad('Select a valid division');
  }
  if (has(b, 'StatusId')) {
    o.StatusId = optInt(b.StatusId, 'Status');
    if (o.StatusId == null || !(await exists('SELECT 1 FROM LsStatus WHERE StatusID = @v', { v: o.StatusId }, tx))) throw bad('Choose a valid status');
  }
  if (has(b, 'ResolutionId')) {
    o.ResolutionId = optInt(b.ResolutionId, 'Resolution');
    if (o.ResolutionId != null && !(await exists('SELECT 1 FROM LsResolutionCS WHERE ResolutionID = @v', { v: o.ResolutionId }, tx))) throw bad('Choose a valid resolution');
  }
  if (has(b, 'RepName')) o.RepName = str(b.RepName, 50, 'Builder representative');
  if (has(b, 'RepPhone')) o.RepPhone = phone(b.RepPhone, 'Representative phone');
  if (has(b, 'CustomerPONum')) o.CustomerPONum = str(b.CustomerPONum, 255, 'Customer PO#');
  if (has(b, 'EstimatedHours')) o.EstimatedHours = optNum(b.EstimatedHours, 'Estimated hours', { min: 0, max: 999 });
  if (has(b, 'HighCeiling')) o.HighCeiling = bit(b.HighCeiling);
  if (has(b, 'CallHoXminutesBefore')) o.CallHoXminutesFefore = str(b.CallHoXminutesBefore, 255, 'Call homeowner minutes'); // column is misspelled in the table
  if (has(b, 'CallHoXminutesFefore')) o.CallHoXminutesFefore = str(b.CallHoXminutesFefore, 255, 'Call homeowner minutes');
  if (has(b, 'CallRepXminutesBefore')) o.CallRepXminutesBefore = str(b.CallRepXminutesBefore, 255, 'Call rep minutes');
  for (const k of ['CallHoXminutesFefore', 'CallRepXminutesBefore']) if (o[k] != null && !/^\d+$/.test(o[k])) throw bad('Call-before minutes must be a whole number');
  if (has(b, 'Notes')) o.Notes = str(b.Notes, 255, 'Ticket notes');
  if (has(b, 'ResolutionNotes')) o.ResolutionNotes = str(b.ResolutionNotes, 255, 'Resolution notes');
  for (const [k, label] of [['LaborCostHour', 'Labor cost per hour'], ['TaxMaterial', 'Material tax'], ['TaxLabor', 'Labor tax'], ['MarkUpMaterial', 'Material mark up'], ['MarkUpOther', 'Other mark up'], ['PaymentValue', 'Payment value']]) {
    if (has(b, k)) o[k] = optNum(b[k], label, { min: 0 });
  }
  if (has(b, 'PaymentDate')) o.PaymentDate = optDate(b.PaymentDate, 'Payment date');
  return o;
}
const pastWarning = (d) => (d && d < addDays(todayIso(), -10) ? 'Your appointment date is set at least 10 days in the past' : null);

// Schedule an appointment = Access CsSchedule "Schedule" button (macro CsScheduleSetAppt + frmCsSchedule01..18)
router.post('/appointments', h(async (req, res) => {
  const b = req.body || {};
  const out = await withTransaction(async (tx) => {
    const a = await apptFields(b, false, tx); // date, time, ticket type, job type (+ division below, macro order)
    // homeowner
    let customerId = optInt(b.CustomerId, 'Homeowner');
    const LastName = str(b.LastName, 50, 'Last name'), FirstName = str(b.FirstName, 50, 'First name');
    if (!customerId && !LastName) throw bad('Enter homeowner last name');
    if (!customerId && !FirstName) throw bad('Enter homeowner first name');
    const CustomerTypeId = optInt(b.CustomerTypeId, 'Customer type');
    if (!CustomerTypeId) throw bad('Set customer type');
    if (!(await exists('SELECT 1 FROM LsCustomerTypeCS WHERE CustomerTypeID = @t', { t: CustomerTypeId }, tx))) throw bad('Set a valid customer type');
    // property
    let propertyId = optInt(b.PropertyId, 'Property');
    const pb = {};
    if (!propertyId) {
      pb.Address = str(b.Address, 50, 'Street address'); if (!pb.Address) throw bad('Set property address');
      pb.City = str(b.City, 50, 'City'); if (!pb.City) throw bad('Set city');
      pb.StateId = str(b.StateId, 50, 'State'); if (!pb.StateId) throw bad('Enter state');
      pb.StateId = pb.StateId.toUpperCase(); if (!/^[A-Z]{2}$/.test(pb.StateId)) throw bad('State must be 2 letters (e.g. CA)');
      if (b.Zip == null || String(b.Zip).trim() === '') throw bad('Set zip code');
    }
    const Zip = has(b, 'Zip') ? zip(b.Zip) : undefined;
    const Escrow = has(b, 'Escrow') ? optDate(b.Escrow, 'Escrow date') : undefined;
    if (!a.DivisionId) throw bad('Select division');
    // defaults (macro): estimated hours null/0 -> 1, high ceiling null -> No, status default Active (1)
    if (!a.EstimatedHours) a.EstimatedHours = 1;
    if (a.HighCeiling == null) a.HighCeiling = 0;
    if (a.StatusId == null) a.StatusId = 1;
    const phones = Array.isArray(b.phones) ? b.phones.map((x) => ({ PhoneNum: phone(x.PhoneNum), PhoneTypeId: optInt(x.PhoneTypeId, 'Phone type') })).filter((x) => x.PhoneNum) : null;
    for (const ph of phones || []) if (!ph.PhoneTypeId || !(await exists('SELECT 1 FROM LsPhoneType WHERE PhoneTypeID = @t', { t: ph.PhoneTypeId }, tx))) throw bad(`Choose the phone type for ${ph.PhoneNum}`);
    const techIds = [...new Set((b.technicians || []).map((x) => optInt(typeof x === 'object' ? x.TechnicianId : x, 'Technician')).filter(Boolean))];
    for (const t of techIds) if (!(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @t', { t }, tx))) throw bad('Choose a valid technician');
    const created = { customer: false, property: false, link: false };

    // 01/02: property — use the chosen one, else the one with this exact address, else create it
    if (propertyId) {
      if (!(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @p', { p: propertyId }, tx))) throw bad('Property not found');
    } else {
      const m = await query("SELECT PropertyID FROM CsProperty WHERE Address = @a AND City = @c AND StateId = @s AND ISNULL(UnitApt,'') = ISNULL(@u,'')",
        { a: pb.Address, c: pb.City, s: pb.StateId, u: str(b.UnitApt, 255, 'Unit') }, tx);
      if (m.length > 1) throw Object.assign(bad('More than one property has this address. Pick the property from the list.', 409), { choices: m.map((x) => x.PropertyID) });
      if (m.length === 1) propertyId = m[0].PropertyID;
      else {
        let CsJobId = optInt(b.CsJobId, 'Community'), CsCommunity = str(b.Community ?? b.CsCommunity, 50, 'Community');
        if (CsJobId) { const j = await one('SELECT Job FROM CsJob WHERE CsJobID = @j', { j: CsJobId }, tx); if (!j) throw bad('Choose a valid community'); CsCommunity = j.Job; }
        else if (CsCommunity) { const j = await one('SELECT TOP 1 CsJobID FROM CsJob WHERE Job = @n ORDER BY CsJobID', { n: CsCommunity }, tx); CsJobId = j ? j.CsJobID : null; }
        propertyId = await insertRow(PROP, { ...pb, UnitApt: str(b.UnitApt, 255, 'Unit'), Zip: Zip ?? null, Escrow: Escrow ?? null, CsCommunity, CsJobId, CsLot: str(b.CsLot, 50, 'CS lot'), WarrantyVoid: 0 }, req.user.username, tx);
        created.property = true;
      }
    }
    // 04/05: homeowner — chosen, else the single one with this first + last name, else create
    if (customerId) {
      if (!(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @c', { c: customerId }, tx))) throw bad('Homeowner not found');
    } else {
      const m = await query('SELECT CustomerID FROM CsCustomer WHERE FirstName = @f AND LastName = @l', { f: FirstName, l: LastName }, tx);
      if (m.length > 1) throw Object.assign(bad(`There are ${m.length} homeowners named ${FirstName} ${LastName}. Pick the homeowner from the list.`, 409), { choices: m.map((x) => x.CustomerID) });
      if (m.length === 1) customerId = m[0].CustomerID;
      else {
        customerId = await insertRow(CUST, { FirstName, MiddleName: str(b.MiddleName, 255, 'Middle name'), LastName, Email: email(b.CustEmail) }, req.user.username, tx);
        created.customer = true;
      }
    }
    // 09: link homeowner <-> property when missing
    if (!(await exists('SELECT 1 FROM CsCustomerProperty WHERE CustomerId = @c AND PropertyId = @p', { c: customerId, p: propertyId }, tx))) {
      await query('INSERT INTO CsCustomerProperty (CustomerId, PropertyId, CustomerTypeId, ScheduleAppt, DateEntered, UserEntered) VALUES (@c, @p, @t, 0, GETDATE(), @u)',
        { c: customerId, p: propertyId, t: CustomerTypeId, u: req.user.username }, tx);
      created.link = true;
    }
    // 10: the appointment
    const ticketId = await nextId(tx, 'CsScheduleAppt', 'TicketID');
    const row = { TicketID: ticketId, ...a, PropertyId: propertyId, CustomerId: customerId, DateEntered: todayIso(), UserEntered: req.user.username };
    const cols = Object.keys(row);
    await query(`INSERT INTO CsScheduleAppt (${cols.map((c) => `[${c}]`).join(',')}) VALUES (${cols.map((_, i) => `@v${i}`).join(',')})`, Object.fromEntries(cols.map((c, i) => [`v${i}`, row[c]])), tx);
    // 12: technicians
    for (const t of techIds) {
      await query('INSERT INTO CsScheduleTechnician (TicketTechID, TicketId, ApptDate, TechnicianId, DateEntered, UserEntered) VALUES (@id, @tk, @d, @t, GETDATE(), @u)',
        { id: await nextId(tx, 'CsScheduleTechnician', 'TicketTechID'), tk: ticketId, d: a.ApptDate, t, u: req.user.username }, tx);
    }
    // 06 / 13 / 14: the phone list on the form becomes the homeowner's phone list (only when a list was sent)
    if (phones) {
      const cur = await query('SELECT CustPhoneID, PhoneNum, PhoneTypeId FROM CsCustomerPhone WHERE CustomerId = @c', { c: customerId }, tx);
      const key = (x) => `${x.PhoneNum}|${x.PhoneTypeId}`;
      const want = new Set(phones.map(key));
      for (const ph of phones) if (!cur.some((x) => key(x) === key(ph))) { await insertRow(PHONE, { CustomerId: customerId, ...ph }, req.user.username, tx); cur.push({ ...ph, CustPhoneID: 0 }); }
      for (const x of cur) if (x.CustPhoneID && !want.has(key(x))) await query('DELETE FROM CsCustomerPhone WHERE CustPhoneID = @id', { id: x.CustPhoneID }, tx);
    }
    // 15: keep property zip / escrow and homeowner email in line with what was entered
    if (!created.property) {
      if (Zip !== undefined && Zip !== null) await query('UPDATE CsProperty SET Zip = @z WHERE PropertyID = @p AND ISNULL(Zip,-1) <> @z', { z: Zip, p: propertyId }, tx);
      if (Escrow !== undefined) await query('UPDATE CsProperty SET Escrow = @e WHERE PropertyID = @p AND ((Escrow IS NULL AND @e IS NOT NULL) OR (Escrow IS NOT NULL AND @e IS NULL) OR Escrow <> @e)', { e: Escrow, p: propertyId }, tx);
    }
    if (!created.customer && has(b, 'CustEmail')) await query("UPDATE CsCustomer SET Email = @e WHERE CustomerID = @c AND ISNULL(Email,'') <> ISNULL(@e,'')", { e: email(b.CustEmail), c: customerId }, tx);
    const lot = await one('SELECT l.EndDate FROM CsProperty p JOIN JsLot l ON l.LotID = p.LotId WHERE p.PropertyID = @p', { p: propertyId }, tx);
    const warnings = [pastWarning(a.ApptDate), lot && !lot.EndDate ? 'This property is still open in production' : null].filter(Boolean);
    return { id: ticketId, ticketId, customerId, propertyId, created, warnings };
  });
  res.status(201).json(out);
}));

// Edit (CsScheduleApptPopUp / CsTicketTrack). Resolution -> status from LsResolutionCS + status stamp (Access AfterUpdate).
router.put('/appointments/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const out = await withTransaction(async (tx) => {
    const cur = await one('SELECT * FROM CsScheduleAppt WHERE TicketID = @id', { id }, tx);
    if (!cur) throw bad('Ticket not found', 404);
    const o = await apptFields(b, true, tx);
    if (has(b, 'PropertyId')) { o.PropertyId = optInt(b.PropertyId, 'Property'); if (!o.PropertyId || !(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @p', { p: o.PropertyId }, tx))) throw bad('Choose a valid property'); }
    if (has(b, 'CustomerId')) { o.CustomerId = optInt(b.CustomerId, 'Homeowner'); if (!o.CustomerId || !(await exists('SELECT 1 FROM CsCustomer WHERE CustomerID = @c', { c: o.CustomerId }, tx))) throw bad('Choose a valid homeowner'); }
    if ('EstimatedHours' in o && !o.EstimatedHours) o.EstimatedHours = 1;
    if ('ResolutionId' in o && o.ResolutionId !== cur.ResolutionId) {
      if (o.ResolutionId != null && !has(b, 'StatusId')) o.StatusId = (await one('SELECT StatusId FROM LsResolutionCS WHERE ResolutionID = @r', { r: o.ResolutionId }, tx)).StatusId;
    }
    if (('ResolutionId' in o && o.ResolutionId !== cur.ResolutionId) || ('StatusId' in o && o.StatusId !== cur.StatusId)) { o.StatusDateTime = new Date(); o.StatusBy = req.user.username; }
    const cols = Object.keys(o);
    if (cols.length) await query(`UPDATE CsScheduleAppt SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE TicketID = @id`, { id, ...Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])) }, tx);
    // keep the technicians of this visit attached when the date moves (they are linked on TicketId + ApptDate)
    if (o.ApptDate && cur.ApptDate && o.ApptDate !== cur.ApptDate.toISOString().slice(0, 10)) {
      await query('UPDATE CsScheduleTechnician SET ApptDate = @n WHERE TicketId = @id AND ApptDate = @o', { n: o.ApptDate, o: cur.ApptDate, id }, tx);
    }
    return { ok: true, StatusId: o.StatusId ?? cur.StatusId, warnings: [o.ApptDate ? pastWarning(o.ApptDate) : null].filter(Boolean) };
  });
  res.json(out);
}));
// Delete appt (Access: frmCsScheduleDeleteTech + frmCsScheduleDeleteAppt). Refused once findings/material are entered.
router.delete('/appointments/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsScheduleAppt WHERE TicketID = @id', { id }, tx))) throw bad('Ticket not found', 404);
    const e = await one('SELECT COUNT(*) AS n FROM CsScheduleError WHERE TicketId = @id', { id }, tx);
    if (e.n) throw bad(`This ticket has ${e.n} finding(s) entered in ticket tracking. Remove them first.`, 409);
    if (await exists('SELECT 1 FROM CsQuote WHERE Scheduled_TicketId = @id', { id }, tx)) throw bad('A quote is linked to this ticket. Unlink it first.', 409);
    await query('DELETE FROM CsSchedulePicture WHERE TicketId = @id', { id }, tx);
    await query('DELETE FROM CsScheduleTechnician WHERE TicketId = @id', { id }, tx);
    await query('DELETE FROM CsScheduleAppt WHERE TicketID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// Technicians on a ticket (CsScheduleTechnician; TimeIn/TimeOut entered in ticket tracking)
router.post('/appointments/:id/technicians', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const t = optInt(b.TechnicianId, 'Technician'); if (!t) throw bad('Choose a technician');
  const TimeIn = timeHM(b.TimeIn, 'Time in'), TimeOut = timeHM(b.TimeOut, 'Time out');
  if (TimeIn && TimeOut && TimeOut < TimeIn) throw bad('Time out must be after time in');
  const tid = await withTransaction(async (tx) => {
    const a = await one('SELECT TicketID, ApptDate FROM CsScheduleAppt WHERE TicketID = @id', { id }, tx);
    if (!a) throw bad('Ticket not found', 404);
    if (!(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @t', { t }, tx))) throw bad('Choose a valid technician');
    if (await exists('SELECT 1 FROM CsScheduleTechnician WHERE TicketId = @id AND ApptDate = @d AND TechnicianId = @t', { id, d: a.ApptDate, t }, tx)) throw bad('This technician is already on the ticket', 409);
    const n = await nextId(tx, 'CsScheduleTechnician', 'TicketTechID');
    await query('INSERT INTO CsScheduleTechnician (TicketTechID, TicketId, ApptDate, TechnicianId, TimeIn, TimeOut, DateEntered, UserEntered) VALUES (@n, @id, @d, @t, @ti, @to, GETDATE(), @u)',
      { n, id, d: a.ApptDate, t, ti: TimeIn, to: TimeOut, u: req.user.username }, tx);
    return n;
  });
  res.status(201).json({ id: tid });
}));
router.put('/appointment-techs/:tid', h(async (req, res) => {
  const tid = int(req.params.tid) || 0, b = req.body || {};
  await withTransaction(async (tx) => {
    const cur = await one('SELECT * FROM CsScheduleTechnician WHERE TicketTechID = @t', { t: tid }, tx);
    if (!cur) throw bad('Technician line not found', 404);
    const o = {};
    if (has(b, 'TechnicianId')) {
      o.TechnicianId = optInt(b.TechnicianId, 'Technician');
      if (!o.TechnicianId || !(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @t', { t: o.TechnicianId }, tx))) throw bad('Choose a valid technician');
    }
    if (has(b, 'TimeIn')) o.TimeIn = timeHM(b.TimeIn, 'Time in');
    if (has(b, 'TimeOut')) o.TimeOut = timeHM(b.TimeOut, 'Time out');
    const ti = 'TimeIn' in o ? o.TimeIn : timeHM(cur.TimeIn, 'Time in'), to = 'TimeOut' in o ? o.TimeOut : timeHM(cur.TimeOut, 'Time out');
    if (ti && to && to < ti) throw bad('Time out must be after time in');
    await updateRow({ table: 'CsScheduleTechnician', idCol: 'TicketTechID', columns: ['TechnicianId', 'TimeIn', 'TimeOut'] }, tid, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/appointment-techs/:tid', h(async (req, res) => {
  const r = await one('DELETE FROM CsScheduleTechnician WHERE TicketTechID = @t; SELECT @@ROWCOUNT AS n', { t: int(req.params.tid) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Technician line not found' });
  res.json({ ok: true });
}));

// Findings (CsScheduleError) — Access CsTicketTrack "Submit" (frmCsTicketTrackSubmit)
router.post('/appointments/:id/errors', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const ErrorId = optInt(b.ErrorId, 'Error'), ErrorCatId = optInt(b.ErrorCatId, 'Error category'), ErrorDetailId = optInt(b.ErrorDetailId, 'Error detail');
  if (!ErrorId) throw bad('Select error to submit');
  if (!ErrorCatId) throw bad('Select error category to submit');
  if (!ErrorDetailId) throw bad('Select error detail to submit');
  const StageId = optInt(b.StageId, 'Stage'), lead = optInt(b.LeadTechnicianId, 'Lead technician');
  const eid = await withTransaction(async (tx) => {
    const a = await one('SELECT TicketID, ApptDate FROM CsScheduleAppt WHERE TicketID = @id', { id }, tx);
    if (!a) throw bad('Ticket not found', 404);
    if (!(await exists('SELECT 1 FROM LsErrorCS WHERE ErrorID = @e', { e: ErrorId }, tx))) throw bad('Select a valid error');
    if (!(await exists('SELECT 1 FROM LsErrorCategoryCS WHERE ErrorCatID = @c AND ErrorId = @e', { c: ErrorCatId, e: ErrorId }, tx))) throw bad('The error category does not belong to the selected error');
    if (!(await exists('SELECT 1 FROM LsErrorDetailCS WHERE ErrorDetailID = @d AND ErrorCatId = @c', { d: ErrorDetailId, c: ErrorCatId }, tx))) throw bad('The error detail does not belong to the selected category');
    if (StageId && !(await exists('SELECT 1 FROM LsScheduleStage WHERE ScheduleStageID = @s', { s: StageId }, tx))) throw bad('Select a valid stage');
    let LeadTechnicianId = lead;
    if (LeadTechnicianId) { if (!(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @t', { t: LeadTechnicianId }, tx))) throw bad('Choose a valid lead technician'); }
    else { // Access took the technician selected in the ticket's technician list (first one by default)
      const t = await one('SELECT TOP 1 TechnicianId FROM CsScheduleTechnician WHERE TicketId = @id AND ApptDate = @d ORDER BY TicketTechID', { id, d: a.ApptDate }, tx);
      LeadTechnicianId = t ? t.TechnicianId : null;
    }
    return insertRow({ table: 'CsScheduleError', idCol: 'ScheduleErrorID', columns: ['TicketId', 'ApptDate', 'ErrorId', 'ErrorCatId', 'ErrorDetailId', 'StageId', 'LeadTechnicianId'] },
      { TicketId: id, ApptDate: a.ApptDate, ErrorId, ErrorCatId, ErrorDetailId, StageId, LeadTechnicianId }, req.user.username, tx);
  });
  res.status(201).json({ id: eid });
}));
router.put('/appointment-errors/:eid', h(async (req, res) => {
  const eid = int(req.params.eid) || 0, b = req.body || {}, o = {};
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsScheduleError WHERE ScheduleErrorID = @e', { e: eid }, tx))) throw bad('Finding not found', 404);
    if (has(b, 'LeadTechnicianId')) {
      o.LeadTechnicianId = optInt(b.LeadTechnicianId, 'Lead technician');
      if (o.LeadTechnicianId && !(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @t', { t: o.LeadTechnicianId }, tx))) throw bad('Choose a valid lead technician');
    }
    if (has(b, 'StageId')) {
      o.StageId = optInt(b.StageId, 'Stage');
      if (o.StageId && !(await exists('SELECT 1 FROM LsScheduleStage WHERE ScheduleStageID = @s', { s: o.StageId }, tx))) throw bad('Select a valid stage');
    }
    await updateRow({ table: 'CsScheduleError', idCol: 'ScheduleErrorID', columns: ['LeadTechnicianId', 'StageId'] }, eid, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/appointment-errors/:eid', h(async (req, res) => {
  const eid = int(req.params.eid) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsScheduleError WHERE ScheduleErrorID = @e', { e: eid }, tx))) throw bad('Finding not found', 404);
    await query('DELETE FROM CsScheduleMaterial WHERE ScheduleErrorId = @e', { e: eid }, tx);
    await query('DELETE FROM CsScheduleError WHERE ScheduleErrorID = @e', { e: eid }, tx);
  });
  res.json({ ok: true });
}));
// Material used on a finding (CsScheduleMaterial; cost defaults to IcItem.JobCostPrice like the Access AfterUpdate)
const MAT = { table: 'CsScheduleMaterial', idCol: 'ScheduleMaterialID', columns: ['ScheduleErrorId', 'InvItemId', 'Quantity', 'ItemCostEa'] };
router.post('/appointment-errors/:eid/materials', h(async (req, res) => {
  const eid = int(req.params.eid) || 0, b = req.body || {};
  const InvItemId = optInt(b.InvItemId, 'Item'); if (!InvItemId) throw bad('Choose an item');
  const Quantity = optNum(b.Quantity, 'Quantity', { min: 0 }); if (!Quantity) throw bad('Enter a quantity greater than 0');
  let ItemCostEa = optNum(b.ItemCostEa, 'Cost each', { min: 0 });
  const mid = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsScheduleError WHERE ScheduleErrorID = @e', { e: eid }, tx))) throw bad('First click on the error before you enter material', 404);
    const i = await one('SELECT JobCostPrice FROM IcItem WHERE InvItemID = @i', { i: InvItemId }, tx);
    if (!i) throw bad('Choose a valid item');
    if (ItemCostEa == null) ItemCostEa = i.JobCostPrice ?? 0;
    return insertRow(MAT, { ScheduleErrorId: eid, InvItemId, Quantity, ItemCostEa }, req.user.username, tx);
  });
  res.status(201).json({ id: mid });
}));
router.put('/appointment-materials/:mid', h(async (req, res) => {
  const mid = int(req.params.mid) || 0, b = req.body || {}, o = {};
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsScheduleMaterial WHERE ScheduleMaterialID = @m', { m: mid }, tx))) throw bad('Material line not found', 404);
    if (has(b, 'InvItemId')) {
      o.InvItemId = optInt(b.InvItemId, 'Item');
      const i = o.InvItemId ? await one('SELECT JobCostPrice FROM IcItem WHERE InvItemID = @i', { i: o.InvItemId }, tx) : null;
      if (!i) throw bad('Choose a valid item');
      if (!has(b, 'ItemCostEa')) o.ItemCostEa = i.JobCostPrice ?? 0; // item changed -> cost reset
    }
    if (has(b, 'Quantity')) { o.Quantity = optNum(b.Quantity, 'Quantity', { min: 0 }); if (!o.Quantity) throw bad('Enter a quantity greater than 0'); }
    if (has(b, 'ItemCostEa')) { o.ItemCostEa = optNum(b.ItemCostEa, 'Cost each', { min: 0 }); if (o.ItemCostEa == null) throw bad('Enter the cost each'); }
    await updateRow(MAT, mid, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/appointment-materials/:mid', h(async (req, res) => {
  const r = await one('DELETE FROM CsScheduleMaterial WHERE ScheduleMaterialID = @m; SELECT @@ROWCOUNT AS n', { m: int(req.params.mid) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Material line not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Calendar (CsScheduleSubCalendar / CalendarAppt / CalendarNote / ApptCalendar / ApptTechnician)
// ---------------------------------------------------------------------------
router.get('/calendar', h(async (req, res) => {
  const from = optDate(req.query.from, 'From date') || todayIso();
  const to = optDate(req.query.to, 'To date') || addDays(from, 6);
  if (to < from) throw bad('The to date must be on or after the from date');
  if (addDays(from, 62) < to) throw bad('Show at most 62 days at a time');
  const p = { from, to, div: req.query.division || null };
  // frmCsScheduleCalendar (inner joins on homeowner, time, job type, status, ticket type like Access)
  const appointments = await query(
    `SELECT a.TicketID, a.ApptDate, t.ApptTime, t.SortOrder, tt.TicketType, jt.CsJobType, a.DivisionId, cj.Job, a.PropertyId,
            p.Address + ', ' + ISNULL(p.City,'') + ' ' + ISNULL(p.StateId,'') AS Property, p.City, a.CustomerId,
            c.FirstName + ISNULL(' ' + NULLIF(c.MiddleName,''), '') + ' ' + ISNULL(c.LastName,'') AS Homeowner, a.RepName, a.RepPhone, a.EstimatedHours, s.Status, s.Active AS StatusActive, r.Resolution,
            (SELECT COUNT(*) FROM CsScheduleTechnician x WHERE x.TicketId = a.TicketID AND x.ApptDate = a.ApptDate) AS TechQty,
            (SELECT STRING_AGG(e.FName + ' ' + ISNULL(e.LName,''), ', ') FROM CsScheduleTechnician x JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId WHERE x.TicketId = a.TicketID AND x.ApptDate = a.ApptDate) AS Technicians
       FROM CsScheduleAppt a LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN CsCustomer c ON c.CustomerID = a.CustomerId JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId
       JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId LEFT JOIN LsResolutionCS r ON r.ResolutionID = a.ResolutionId JOIN LsStatus s ON s.StatusID = a.StatusId
       JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
      WHERE a.ApptDate >= @from AND a.ApptDate <= @to AND (@div IS NULL OR a.DivisionId = @div)
      ORDER BY a.ApptDate, t.SortOrder, Homeowner`, p);
  const notes = await query('SELECT CalendarDate, DivisionId, CalendarNotes, DateEntered, UserEntered FROM CsCalendarNotes WHERE CalendarDate >= @from AND CalendarDate <= @to AND (@div IS NULL OR DivisionId = @div) ORDER BY CalendarDate', p);
  res.json({ from, to, division: p.div, appointments, notes });
}));
// Upcoming load (from today) by date/city/time and by technician, like the two summary subforms
router.get('/calendar/upcoming', h(async (req, res) => {
  const p = { today: todayIso(), div: req.query.division || null };
  const byCity = await query(
    `SELECT a.ApptDate, p.City, t.ApptTime, tt.TicketType, jt.CsJobType, COUNT(a.TicketID) AS Appointments
       FROM CsScheduleAppt a JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId JOIN CsProperty p ON p.PropertyID = a.PropertyId
      WHERE a.ApptDate >= @today AND (@div IS NULL OR a.DivisionId = @div)
      GROUP BY a.ApptDate, p.City, t.ApptTime, tt.TicketType, jt.CsJobType, t.SortOrder ORDER BY a.ApptDate, p.City, t.SortOrder`, p);
  const byTech = await query(
    `SELECT a.ApptDate, e.FName + ' ' + ISNULL(e.LName,'') AS TechName, t.ApptTime, p.City, tt.TicketType, jt.CsJobType, COUNT(a.TicketID) AS Appointments
       FROM CsScheduleAppt a JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId
       JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId JOIN CsProperty p ON p.PropertyID = a.PropertyId
      WHERE a.ApptDate >= @today AND (@div IS NULL OR a.DivisionId = @div)
      GROUP BY a.ApptDate, e.FName + ' ' + ISNULL(e.LName,''), t.ApptTime, p.City, tt.TicketType, jt.CsJobType, t.SortOrder ORDER BY a.ApptDate, TechName, t.SortOrder`, p);
  res.json({ byCity, byTech });
}));
// Calendar note for a day + division (CsCalendarNotes has no id: key = date + division). Empty text removes it.
router.put('/calendar-notes', h(async (req, res) => {
  const b = req.body || {};
  const d = optDate(b.date, 'Date'); if (!d) throw bad('Choose the date');
  const div = str(b.division, 50, 'Division'); if (!div) throw bad('Select division');
  const text = str(b.notes, 255, 'Calendar notes');
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM LsDivision WHERE DivisionID = @v', { v: div }, tx))) throw bad('Select a valid division');
    await query('DELETE FROM CsCalendarNotes WHERE CalendarDate = @d AND DivisionId = @v', { d, v: div }, tx);
    if (text) await query('INSERT INTO CsCalendarNotes (CalendarDate, DivisionId, CalendarNotes, DateEntered, UserEntered) VALUES (@d, @v, @t, GETDATE(), @u)', { d, v: div, t: text, u: req.user.username }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Call notes (CsCallNotes)
// ---------------------------------------------------------------------------
const NOTE = { table: 'CsCallNotes', idCol: 'CallNotesID', columns: ['CallDate', 'PropertyId', 'Customer', 'CallNotes', 'FollowUp'] };
async function noteBody(b, partial, tx) {
  const o = {};
  if (!partial || has(b, 'CallDate')) o.CallDate = optDate(b.CallDate, 'Call date') || (partial ? (() => { throw bad('Enter the call date'); })() : todayIso());
  if (!partial || has(b, 'PropertyId')) {
    o.PropertyId = optInt(b.PropertyId, 'Property');
    if (!o.PropertyId) throw bad('Choose the property address');
    if (!(await exists('SELECT 1 FROM CsProperty WHERE PropertyID = @p', { p: o.PropertyId }, tx))) throw bad('Choose a valid property');
  }
  if (has(b, 'Customer')) o.Customer = str(b.Customer, 50, 'Customer name');
  if (!partial || has(b, 'CallNotes')) { o.CallNotes = str(b.CallNotes, 255, 'Call notes'); if (!o.CallNotes) throw bad('Enter the call notes'); }
  if (has(b, 'FollowUp')) o.FollowUp = optDate(b.FollowUp, 'Follow up date');
  return o;
}
router.get('/call-notes', h(async (req, res) => {
  const pg = paging(req.query);
  const p = { prop: optInt(req.query.propertyId, 'Property'), s: req.query.search ? `%${req.query.search}%` : null, fu: req.query.followUp === '1' ? 1 : 0, offset: pg.offset, pageSize: pg.pageSize };
  const where = `WHERE (@prop IS NULL OR n.PropertyId = @prop) AND (@s IS NULL OR n.CallNotes LIKE @s OR n.Customer LIKE @s OR p.Address LIKE @s) AND (@fu = 0 OR n.FollowUp IS NOT NULL)`;
  const rows = await query(`SELECT n.CallNotesID, n.CallDate, n.PropertyId, ${PROP_ADDR} AS Property, n.Customer, n.CallNotes, n.FollowUp, n.DateEntered, n.UserEntered
      FROM CsCallNotes n LEFT JOIN CsProperty p ON p.PropertyID = n.PropertyId ${where} ORDER BY n.CallDate DESC, n.CallNotesID DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM CsCallNotes n LEFT JOIN CsProperty p ON p.PropertyID = n.PropertyId ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));
router.post('/call-notes', h(async (req, res) => {
  const id = await withTransaction(async (tx) => insertRow(NOTE, await noteBody(req.body || {}, false, tx), req.user.username, tx));
  res.status(201).json({ id });
}));
router.put('/call-notes/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsCallNotes WHERE CallNotesID = @id', { id }, tx))) throw bad('Call note not found', 404);
    await updateRow(NOTE, id, await noteBody(req.body || {}, true, tx), tx);
  });
  res.json({ ok: true });
}));
router.delete('/call-notes/:id', h(async (req, res) => {
  const r = await one('DELETE FROM CsCallNotes WHERE CallNotesID = @id; SELECT @@ROWCOUNT AS n', { id: int(req.params.id) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Call note not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Technicians (CsTechnician)
// ---------------------------------------------------------------------------
const TECH = { table: 'CsTechnician', idCol: 'TechnicianID', columns: ['EmployeeId', 'TechTypeId', 'Active'] };
router.get('/technicians', h(async (req, res) => {
  const p = { s: req.query.search ? `%${req.query.search}%` : null, act: req.query.active === '1' ? 1 : req.query.active === '0' ? 0 : null };
  res.json(await query(
    `SELECT t.TechnicianID, t.EmployeeId, ${TECH_NAME} AS Technician, e.EmployeeNum, e.DivisionId, e.DateHire, e.DateTermination, t.TechTypeId, tt.TechType, t.Active, t.DateEntered, t.UserEntered,
            (SELECT COUNT(*) FROM CsScheduleTechnician x WHERE x.TechnicianId = t.TechnicianID) AS Visits,
            (SELECT MAX(x.ApptDate) FROM CsScheduleTechnician x WHERE x.TechnicianId = t.TechnicianID) AS LastVisit
       FROM CsTechnician t LEFT JOIN PrEmployee e ON e.EmployeeID = t.EmployeeId LEFT JOIN LsTechTypeCS tt ON tt.TechTypeID = t.TechTypeId
      WHERE (@s IS NULL OR e.FName + ' ' + ISNULL(e.LName,'') LIKE @s) AND (@act IS NULL OR t.Active = @act)
      ORDER BY e.FName, e.LName`, p));
}));
async function techBody(b, partial, tx, exceptId) {
  const o = {}, warnings = [];
  if (!partial || has(b, 'EmployeeId')) {
    o.EmployeeId = optInt(b.EmployeeId, 'Employee'); if (!o.EmployeeId) throw bad('Choose the employee');
    const e = await one('SELECT DateTermination FROM PrEmployee WHERE EmployeeID = @e', { e: o.EmployeeId }, tx);
    if (!e) throw bad('Choose a valid employee');
    if (e.DateTermination) warnings.push('You have selected an employee that has been terminated');
    if (await exists('SELECT 1 FROM CsTechnician WHERE EmployeeId = @e AND (@x IS NULL OR TechnicianID <> @x)', { e: o.EmployeeId, x: exceptId ?? null }, tx)) throw bad('This employee is already a CS technician', 409);
  }
  if (!partial || has(b, 'TechTypeId')) {
    o.TechTypeId = optInt(b.TechTypeId, 'Technician type'); if (!o.TechTypeId) throw bad('Choose the technician type');
    if (!(await exists('SELECT 1 FROM LsTechTypeCS WHERE TechTypeID = @t', { t: o.TechTypeId }, tx))) throw bad('Choose a valid technician type');
  }
  if (has(b, 'Active')) o.Active = bit(b.Active); else if (!partial) o.Active = 1;
  return { o, warnings };
}
router.post('/technicians', h(async (req, res) => {
  const out = await withTransaction(async (tx) => {
    const { o, warnings } = await techBody(req.body || {}, false, tx);
    return { id: await insertRow(TECH, o, req.user.username, tx), warnings };
  });
  res.status(201).json(out);
}));
router.put('/technicians/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  const out = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @id', { id }, tx))) throw bad('Technician not found', 404);
    const { o, warnings } = await techBody(req.body || {}, true, tx, id);
    await updateRow(TECH, id, o, tx);
    return { ok: true, warnings };
  });
  res.json(out);
}));
router.delete('/technicians/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsTechnician WHERE TechnicianID = @id', { id }, tx))) throw bad('Technician not found', 404);
    if (await exists('SELECT 1 FROM CsScheduleTechnician WHERE TechnicianId = @id UNION ALL SELECT 1 FROM CsScheduleError WHERE LeadTechnicianId = @id', { id }, tx)) {
      throw bad('This technician is on tickets and cannot be deleted. Untick Active instead.', 409);
    }
    await query('DELETE FROM CsTechnician WHERE TechnicianID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Assemblies (CsAssembly + CsAssemblyItem). Est cost = Σ qty × CostEa; actual cost = Σ qty × IcItem.EstimatingPrice (frmCsAssembly)
// profit = sale price − cost; profit % = profit / cost (Access calcEstProfitMargin)
// ---------------------------------------------------------------------------
const ASM = { table: 'CsAssembly', idCol: 'CsAssemblyID', columns: ['AssemblyName', 'SalePrice', 'ModuleOrigin', 'DateUpdated'] };
const ASMI = { table: 'CsAssemblyItem', idCol: 'CsAsItemID', columns: ['CsAssemblyId', 'InvItemId', 'Quantity', 'CostEa'] };
const ASM_COST = `(SELECT SUM(ai.Quantity * ai.CostEa) FROM CsAssemblyItem ai JOIN IcItem i ON i.InvItemID = ai.InvItemId WHERE ai.CsAssemblyId = a.CsAssemblyID) AS EstCost,
  (SELECT SUM(ai.Quantity * i.EstimatingPrice) FROM CsAssemblyItem ai JOIN IcItem i ON i.InvItemID = ai.InvItemId WHERE ai.CsAssemblyId = a.CsAssemblyID) AS ActualCost`;
const withProfit = (a) => {
  const est = Number(a.EstCost || 0), act = Number(a.ActualCost || 0), sp = Number(a.SalePrice || 0);
  return { ...a, EstCost: est, ActualCost: act, EstProfit: r2(sp - est), ActualProfit: r2(sp - act), EstProfitPct: est ? (sp - est) / est : null, ActualProfitPct: act ? (sp - act) / act : null };
};
router.get('/assemblies', h(async (req, res) => {
  const rows = await query(`SELECT a.CsAssemblyID, a.AssemblyName, a.SalePrice, a.ModuleOrigin, a.DateUpdated, a.DateEntered, a.UserEntered,
      (SELECT COUNT(*) FROM CsAssemblyItem ai WHERE ai.CsAssemblyId = a.CsAssemblyID) AS Items, ${ASM_COST}
      FROM CsAssembly a WHERE (@s IS NULL OR a.AssemblyName LIKE @s) ORDER BY a.AssemblyName`, { s: req.query.search ? `%${req.query.search}%` : null });
  res.json(rows.map(withProfit));
}));
router.get('/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  const a = await one(`SELECT a.*, ${ASM_COST} FROM CsAssembly a WHERE a.CsAssemblyID = @id`, { id });
  if (!a) return res.status(404).json({ error: 'Assembly not found' });
  const items = await query(`SELECT ai.CsAsItemID, ai.CsAssemblyId, ai.InvItemId, i.InvItem, i.Description, c.InvClass, ai.Quantity, ai.CostEa, ai.Quantity * ai.CostEa AS ExtCost, i.EstimatingPrice, ai.DateEntered, ai.UserEntered
      FROM CsAssemblyItem ai LEFT JOIN IcItem i ON i.InvItemID = ai.InvItemId LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId WHERE ai.CsAssemblyId = @id ORDER BY c.InvClass, i.InvItem`, { id });
  res.json({ assembly: withProfit(a), items });
}));
const asmBody = (b, partial) => {
  const o = {};
  if (!partial || has(b, 'AssemblyName')) o.AssemblyName = reqStr(b.AssemblyName, 50, 'Assembly name');
  if (has(b, 'SalePrice')) o.SalePrice = optNum(b.SalePrice, 'Sale price', { min: 0 });
  if (!partial) o.ModuleOrigin = 'CS';
  return o;
};
router.post('/assemblies', h(async (req, res) => {
  const id = await withTransaction(async (tx) => {
    const o = asmBody(req.body || {}, false);
    if (await exists('SELECT 1 FROM CsAssembly WHERE AssemblyName = @n', { n: o.AssemblyName }, tx)) throw bad('An assembly with this name already exists', 409);
    return insertRow(ASM, o, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsAssembly WHERE CsAssemblyID = @id', { id }, tx))) throw bad('Assembly not found', 404);
    const o = asmBody(req.body || {}, true);
    if (o.AssemblyName && await exists('SELECT 1 FROM CsAssembly WHERE AssemblyName = @n AND CsAssemblyID <> @id', { n: o.AssemblyName, id }, tx)) throw bad('An assembly with this name already exists', 409);
    await updateRow(ASM, id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/assemblies/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsAssembly WHERE CsAssemblyID = @id', { id }, tx))) throw bad('Assembly not found', 404);
    if (await exists('SELECT 1 FROM CsQuoteAssembly WHERE CsAssemblyId = @id', { id }, tx)) throw bad('This assembly is used on quotes and cannot be deleted.', 409);
    await query('DELETE FROM CsAssemblyItem WHERE CsAssemblyId = @id', { id }, tx);
    await query('DELETE FROM CsAssembly WHERE CsAssemblyID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));
// "Update assembly price": item cost = IcItem.EstimatingPrice, DateUpdated = today (frmCsAssemblyUpdate)
router.post('/assemblies/:id/update-prices', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  const n = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsAssembly WHERE CsAssemblyID = @id', { id }, tx))) throw bad('Assembly not found', 404);
    const r = await one('UPDATE ai SET ai.CostEa = i.EstimatingPrice FROM CsAssemblyItem ai JOIN IcItem i ON i.InvItemID = ai.InvItemId WHERE ai.CsAssemblyId = @id; SELECT @@ROWCOUNT AS n', { id }, tx);
    await query('UPDATE CsAssembly SET DateUpdated = @d WHERE CsAssemblyID = @id', { d: todayIso(), id }, tx);
    return r.n;
  });
  res.json({ ok: true, updated: n });
}));
router.post('/assemblies/:id/items', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const InvItemId = optInt(b.InvItemId, 'Item'); if (!InvItemId) throw bad('Choose an item');
  const Quantity = optNum(b.Quantity ?? 1, 'Quantity', { min: 0 }); if (!Quantity) throw bad('Enter a quantity greater than 0');
  let CostEa = optNum(b.CostEa, 'Cost each', { min: 0 });
  const iid = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsAssembly WHERE CsAssemblyID = @id', { id }, tx))) throw bad('Assembly not found', 404);
    const i = await one('SELECT EstimatingPrice FROM IcItem WHERE InvItemID = @i', { i: InvItemId }, tx);
    if (!i) throw bad('Choose a valid item');
    if (CostEa == null) CostEa = i.EstimatingPrice ?? 0; // Access: CostEa = IcItem.EstimatingPrice
    return insertRow(ASMI, { CsAssemblyId: id, InvItemId, Quantity, CostEa }, req.user.username, tx);
  });
  res.status(201).json({ id: iid });
}));
router.put('/assembly-items/:iid', h(async (req, res) => {
  const iid = int(req.params.iid) || 0, b = req.body || {}, o = {};
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsAssemblyItem WHERE CsAsItemID = @i', { i: iid }, tx))) throw bad('Item line not found', 404);
    if (has(b, 'InvItemId')) {
      o.InvItemId = optInt(b.InvItemId, 'Item');
      const i = o.InvItemId ? await one('SELECT EstimatingPrice FROM IcItem WHERE InvItemID = @i', { i: o.InvItemId }, tx) : null;
      if (!i) throw bad('Choose a valid item');
      if (!has(b, 'CostEa')) o.CostEa = i.EstimatingPrice ?? 0;
    }
    if (has(b, 'Quantity')) { o.Quantity = optNum(b.Quantity, 'Quantity', { min: 0 }); if (!o.Quantity) throw bad('Enter a quantity greater than 0'); }
    if (has(b, 'CostEa')) { o.CostEa = optNum(b.CostEa, 'Cost each', { min: 0 }); if (o.CostEa == null) throw bad('Enter the cost each'); }
    await updateRow(ASMI, iid, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/assembly-items/:iid', h(async (req, res) => {
  const r = await one('DELETE FROM CsAssemblyItem WHERE CsAsItemID = @i; SELECT @@ROWCOUNT AS n', { i: int(req.params.iid) || 0 });
  if (!r.n) return res.status(404).json({ error: 'Item line not found' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Quotes (CsQuote -> CsQuoteCategory -> CsQuoteAssembly / CsQuoteAssemblyItem). All four tables are IDENTITY.
// Pricing (Access CsQuoteSubAssembly / CsQuoteSubAssemblyItem):
//   assembly line : price ea = CsAssembly.SalePrice × (1 + mark up); its items are exploded with qty = assembly qty × item qty,
//                   CostEa = IcItem.JobCostPrice, cost code from the item, price 0 (they are priced through the assembly)
//   loose item    : cost code L -> CostEa = IcItem.LaborCost, price = quote labor hourly rate;
//                   otherwise CostEa = IcItem.JobCostPrice, price = JobCostPrice × (1 + mark up)
//   changing an assembly's quantity deletes and re-adds its items; the assembly itself cannot be swapped (delete + add)
//   totals        : subtotal = Σ qty × price (+ flat labor); discount = subtotal × discount %; sales tax = material (cost code M) cost × tax rate
//                   total = subtotal − discount + tax + credit card fee
// Percentages are stored as fractions (0.0775 = 7.75 %), like the Access Percent-formatted fields.
// ---------------------------------------------------------------------------
async function quoteBody(b, partial, tx) {
  const o = {};
  if (!partial || has(b, 'QuoteName')) o.QuoteName = reqStr(b.QuoteName, 255, 'Quote name');
  if (!partial || has(b, 'QuoteDate')) { o.QuoteDate = optDate(b.QuoteDate, 'Quote date'); if (!o.QuoteDate) { if (partial) throw bad('Enter the quote date'); o.QuoteDate = todayIso(); } }
  const fk = async (k, label, sql) => {
    if (!has(b, k)) return;
    o[k] = optInt(b[k], label);
    if (o[k] != null && !(await exists(sql, { v: o[k] }, tx))) throw bad(`Choose a valid ${label.toLowerCase()}`);
  };
  await fk('CsTicketTypeId', 'Ticket type', 'SELECT 1 FROM LsTicketTypeCS WHERE TicketTypeID = @v');
  await fk('PropertyId', 'Property', 'SELECT 1 FROM CsProperty WHERE PropertyID = @v');
  await fk('CustomerId', 'Homeowner', 'SELECT 1 FROM CsCustomer WHERE CustomerID = @v');
  await fk('LeadStatusId', 'Lead status', 'SELECT 1 FROM LsLeadStatus WHERE LeadStatusID = @v');
  await fk('Scheduled_TicketId', 'Ticket', 'SELECT 1 FROM CsScheduleAppt WHERE TicketID = @v');
  if (has(b, 'CustomerReferenceNum')) o.CustomerReferenceNum = str(b.CustomerReferenceNum, 255, 'Customer reference #');
  if (has(b, 'QuoteNotes')) o.QuoteNotes = str(b.QuoteNotes, 4000, 'Notes');
  if (has(b, 'LaborHourlyRate')) o.LaborHourlyRate = optNum(b.LaborHourlyRate, 'Labor hourly rate', { min: 0 });
  if (has(b, 'LaborRateFlat')) o.LaborRateFlat = optNum(b.LaborRateFlat, 'Flat labor', { min: 0 });
  if (has(b, 'PriceMarkUpPercent')) o.PriceMarkUpPercent = optNum(b.PriceMarkUpPercent, 'Mark up', { min: 0, max: 100 });
  if (has(b, 'DiscountPercent')) o.DiscountPercent = optNum(b.DiscountPercent, 'Discount', { min: 0, max: 1 });
  if (has(b, 'TaxRate')) o.TaxRate = optNum(b.TaxRate, 'Sales tax', { min: 0, max: 1 });
  else if (!partial) o.TaxRate = 0.0775; // Access default
  if (has(b, 'CreditCardFee')) o.CreditCardFee = optNum(b.CreditCardFee, 'Credit card fee', { min: 0 });
  if (has(b, 'ApprovedDate')) o.ApprovedDate = optDate(b.ApprovedDate, 'Approved date');
  if (has(b, 'ApprovedBy')) o.ApprovedBy = str(b.ApprovedBy, 50, 'Approved by');
  if (has(b, 'PaidDate')) o.PaidDate = optDate(b.PaidDate, 'Paid date');
  if (!partial) o.ModuleOrigin = 'CS';
  return o;
}
async function quoteTotals(id, tx) {
  const q = await one('SELECT * FROM CsQuote WHERE QuoteID = @id', { id }, tx);
  if (!q) return null;
  const asm = await one(`SELECT ISNULL(SUM(qa.Quantity * qa.MarkUpPrice),0) AS Price FROM CsQuoteAssembly qa JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qa.QuoteCategoryId WHERE qc.QuoteId = @id`, { id }, tx);
  const it = await one(`SELECT ISNULL(SUM(CASE WHEN qi.QuoteAssemblyId IS NULL THEN qi.Quantity * ISNULL(qi.MarkUpPrice,0) ELSE 0 END),0) AS Price,
        ISNULL(SUM(CASE WHEN qi.CostCodeId = 'L' THEN qi.Quantity * ISNULL(q.LaborHourlyRate,0) ELSE qi.Quantity * ISNULL(qi.CostEa,0) END),0) AS Cost,
        ISNULL(SUM(qi.Quantity * ISNULL(i.JobCostPrice,0)),0) AS RealCost,
        ISNULL(SUM(CASE WHEN qi.CostCodeId = 'M' THEN qi.Quantity * ISNULL(qi.CostEa,0) ELSE 0 END),0) AS MatCost
      FROM CsQuoteAssemblyItem qi JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qi.QuoteCategoryId JOIN CsQuote q ON q.QuoteID = qc.QuoteId LEFT JOIN IcItem i ON i.InvItemID = qi.InvItemId
     WHERE qc.QuoteId = @id`, { id }, tx);
  const subtotal = r2(Number(asm.Price) + Number(it.Price) + Number(q.LaborRateFlat || 0));
  const discount = r2(subtotal * Number(q.DiscountPercent || 0));
  const tax = r2(Number(it.MatCost) * Number(q.TaxRate || 0));
  const fee = r2(Number(q.CreditCardFee || 0));
  const total = r2(subtotal - discount + tax + fee);
  const cost = r2(Number(it.Cost));
  return { subtotal, assemblies: r2(asm.Price), items: r2(it.Price), flatLabor: r2(q.LaborRateFlat || 0), discount, materialCost: r2(it.MatCost), tax, creditCardFee: fee, total,
    cost, realCost: r2(it.RealCost), profit: r2(subtotal - discount - cost) };
}
router.get('/quotes', h(async (req, res) => {
  const rows = await query(
    `SELECT q.QuoteID, q.QuoteName, q.QuoteDate, q.CustomerId, ${HO_NAME} AS Homeowner, q.PropertyId, ${PROP_ADDR} AS Property, tt.TicketType, q.ApprovedDate, q.PaidDate, q.Scheduled_TicketId, q.DateEntered, q.UserEntered
       FROM CsQuote q LEFT JOIN CsCustomer c ON c.CustomerID = q.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = q.PropertyId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = q.CsTicketTypeId
      WHERE (@s IS NULL OR q.QuoteName LIKE @s OR CAST(q.QuoteID AS varchar(20)) LIKE @s OR c.LastName LIKE @s OR p.Address LIKE @s) ORDER BY q.QuoteID DESC`,
    { s: req.query.search ? `%${req.query.search}%` : null });
  for (const r of rows) r.Total = (await quoteTotals(r.QuoteID)).total;
  res.json(rows);
}));
router.get('/quotes/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  const q = await one(`SELECT q.*, ${HO_NAME} AS Homeowner, ${PROP_ADDR} AS Property FROM CsQuote q LEFT JOIN CsCustomer c ON c.CustomerID = q.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = q.PropertyId WHERE q.QuoteID = @id`, { id });
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  const categories = await query('SELECT * FROM CsQuoteCategory WHERE QuoteId = @id ORDER BY QuoteCategoryID', { id });
  const assemblies = await query(`SELECT qa.*, a.AssemblyName, qa.Quantity * qa.MarkUpPrice AS ExtPrice FROM CsQuoteAssembly qa JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qa.QuoteCategoryId
      LEFT JOIN CsAssembly a ON a.CsAssemblyID = qa.CsAssemblyId WHERE qc.QuoteId = @id ORDER BY qa.QuoteAssemblyID`, { id });
  const items = await query(`SELECT qi.*, i.InvItem, i.Description, qi.Quantity * ISNULL(qi.MarkUpPrice,0) AS ExtPrice, qi.Quantity * ISNULL(qi.CostEa,0) AS ExtCost
      FROM CsQuoteAssemblyItem qi JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qi.QuoteCategoryId LEFT JOIN IcItem i ON i.InvItemID = qi.InvItemId WHERE qc.QuoteId = @id ORDER BY qi.QuoteAssemblyId, qi.QuoteItemID`, { id });
  res.json({ quote: q, categories, assemblies, items, totals: await quoteTotals(id) });
}));
router.post('/quotes', h(async (req, res) => {
  const id = await withTransaction(async (tx) => {
    const o = await quoteBody(req.body || {}, false, tx);
    o.DateEntered = new Date(); o.UserEntered = req.user.username;
    const cols = Object.keys(o);
    const r = await one(`INSERT INTO CsQuote (${cols.map((c) => `[${c}]`).join(',')}) OUTPUT INSERTED.QuoteID AS id VALUES (${cols.map((_, i) => `@v${i}`).join(',')})`, Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])), tx);
    await query('INSERT INTO CsQuoteCategory (QuoteId, CategoryName, DateEntered, UserEntered) VALUES (@q, @n, GETDATE(), @u)', { q: r.id, n: str(req.body?.CategoryName, 255, 'Category') || 'General', u: req.user.username }, tx);
    return r.id;
  });
  res.status(201).json({ id });
}));
router.put('/quotes/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsQuote WHERE QuoteID = @id', { id }, tx))) throw bad('Quote not found', 404);
    const o = await quoteBody(req.body || {}, true, tx);
    const cols = Object.keys(o);
    if (cols.length) await query(`UPDATE CsQuote SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE QuoteID = @id`, { id, ...Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])) }, tx);
  });
  res.json({ ok: true, totals: await quoteTotals(id) });
}));
router.delete('/quotes/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsQuote WHERE QuoteID = @id', { id }, tx))) throw bad('Quote not found', 404);
    await query('DELETE qi FROM CsQuoteAssemblyItem qi JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qi.QuoteCategoryId WHERE qc.QuoteId = @id', { id }, tx);
    await query('DELETE qa FROM CsQuoteAssembly qa JOIN CsQuoteCategory qc ON qc.QuoteCategoryID = qa.QuoteCategoryId WHERE qc.QuoteId = @id', { id }, tx);
    await query('DELETE FROM CsQuoteCategory WHERE QuoteId = @id', { id }, tx);
    await query('DELETE FROM CsQuote WHERE QuoteID = @id', { id }, tx);
  });
  res.json({ ok: true });
}));
// Categories
router.post('/quotes/:id/categories', h(async (req, res) => {
  const id = int(req.params.id) || 0, b = req.body || {};
  const name = reqStr(b.CategoryName, 255, 'Category name');
  const cid = await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsQuote WHERE QuoteID = @id', { id }, tx))) throw bad('Quote not found', 404);
    return (await one('INSERT INTO CsQuoteCategory (QuoteId, CategoryName, CategoryNotes, DateEntered, UserEntered) OUTPUT INSERTED.QuoteCategoryID AS id VALUES (@q, @n, @t, GETDATE(), @u)',
      { q: id, n: name, t: str(b.CategoryNotes, 4000, 'Notes'), u: req.user.username }, tx)).id;
  });
  res.status(201).json({ id: cid });
}));
router.put('/quote-categories/:cid', h(async (req, res) => {
  const cid = int(req.params.cid) || 0, b = req.body || {}, o = {};
  if (has(b, 'CategoryName')) o.CategoryName = reqStr(b.CategoryName, 255, 'Category name');
  if (has(b, 'CategoryNotes')) o.CategoryNotes = str(b.CategoryNotes, 4000, 'Notes');
  const cols = Object.keys(o);
  if (!(await exists('SELECT 1 FROM CsQuoteCategory WHERE QuoteCategoryID = @c', { c: cid }))) return res.status(404).json({ error: 'Category not found' });
  if (cols.length) await query(`UPDATE CsQuoteCategory SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE QuoteCategoryID = @c`, { c: cid, ...Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])) });
  res.json({ ok: true });
}));
router.delete('/quote-categories/:cid', h(async (req, res) => {
  const cid = int(req.params.cid) || 0;
  await withTransaction(async (tx) => {
    const c = await one('SELECT QuoteId FROM CsQuoteCategory WHERE QuoteCategoryID = @c', { c: cid }, tx);
    if (!c) throw bad('Category not found', 404);
    if ((await one('SELECT COUNT(*) AS n FROM CsQuoteCategory WHERE QuoteId = @q', { q: c.QuoteId }, tx)).n < 2) throw bad('A quote needs at least one category', 409);
    if (await exists('SELECT 1 FROM CsQuoteAssembly WHERE QuoteCategoryId = @c UNION ALL SELECT 1 FROM CsQuoteAssemblyItem WHERE QuoteCategoryId = @c', { c: cid }, tx)) throw bad('Remove the lines of this category first', 409);
    await query('DELETE FROM CsQuoteCategory WHERE QuoteCategoryID = @c', { c: cid }, tx);
  });
  res.json({ ok: true });
}));
async function quoteOfCategory(tx, cid) {
  const c = await one('SELECT qc.QuoteCategoryID, qc.QuoteId, q.PriceMarkUpPercent, q.LaborHourlyRate FROM CsQuoteCategory qc JOIN CsQuote q ON q.QuoteID = qc.QuoteId WHERE qc.QuoteCategoryID = @c', { c: cid }, tx);
  if (!c) throw bad('Choose a category of the quote');
  return c;
}
async function explodeAssembly(tx, qa, username) {
  await query('DELETE FROM CsQuoteAssemblyItem WHERE QuoteAssemblyId = @a', { a: qa.QuoteAssemblyID }, tx);
  await query(`INSERT INTO CsQuoteAssemblyItem (QuoteCategoryId, QuoteAssemblyId, InvItemId, CostCodeId, Quantity, CostEa, MarkUpPrice, DateEntered, UserEntered)
      SELECT @c, @a, ai.InvItemId, i.CostCodeId, @q * ai.Quantity, i.JobCostPrice, 0, GETDATE(), @u
        FROM CsAssemblyItem ai JOIN IcItem i ON i.InvItemID = ai.InvItemId WHERE ai.CsAssemblyId = @asm`,
  { c: qa.QuoteCategoryId, a: qa.QuoteAssemblyID, q: qa.Quantity, asm: qa.CsAssemblyId, u: username }, tx);
}
router.post('/quote-categories/:cid/assemblies', h(async (req, res) => {
  const cid = int(req.params.cid) || 0, b = req.body || {};
  const CsAssemblyId = optInt(b.CsAssemblyId, 'Assembly'); if (!CsAssemblyId) throw bad('Choose an assembly');
  const Quantity = optNum(b.Quantity ?? 1, 'Quantity', { min: 0 }); if (!Quantity) throw bad('Enter a quantity greater than 0');
  const manual = optNum(b.MarkUpPrice, 'Price each', { min: 0 });
  const id = await withTransaction(async (tx) => {
    const c = await quoteOfCategory(tx, cid);
    const a = await one('SELECT SalePrice FROM CsAssembly WHERE CsAssemblyID = @a', { a: CsAssemblyId }, tx);
    if (!a) throw bad('Choose a valid assembly');
    const price = manual != null ? manual : r2(Number(a.SalePrice || 0) * (1 + Number(c.PriceMarkUpPercent || 0)));
    const r = await one(`INSERT INTO CsQuoteAssembly (QuoteCategoryId, CsAssemblyId, Quantity, AssemblySalePrice, MarkUpPrice, MUManualEntry, DateEntered, UserEntered)
        OUTPUT INSERTED.QuoteAssemblyID AS id VALUES (@c, @a, @q, @sp, @mp, @mu, GETDATE(), @u)`,
    { c: cid, a: CsAssemblyId, q: Quantity, sp: a.SalePrice, mp: price, mu: manual != null ? 'Yes' : null, u: req.user.username }, tx);
    await explodeAssembly(tx, { QuoteAssemblyID: r.id, QuoteCategoryId: cid, Quantity, CsAssemblyId }, req.user.username);
    return r.id;
  });
  res.status(201).json({ id });
}));
router.put('/quote-assemblies/:aid', h(async (req, res) => {
  const aid = int(req.params.aid) || 0, b = req.body || {};
  await withTransaction(async (tx) => {
    const qa = await one('SELECT * FROM CsQuoteAssembly WHERE QuoteAssemblyID = @a', { a: aid }, tx);
    if (!qa) throw bad('Assembly line not found', 404);
    if (has(b, 'CsAssemblyId') && optInt(b.CsAssemblyId, 'Assembly') !== qa.CsAssemblyId) throw bad('To edit assembly, first delete and then enter the new one');
    const o = {};
    if (has(b, 'Quantity')) { o.Quantity = optNum(b.Quantity, 'Quantity', { min: 0 }); if (!o.Quantity) throw bad('Enter a quantity greater than 0'); }
    if (has(b, 'MarkUpPrice')) {
      o.MarkUpPrice = optNum(b.MarkUpPrice, 'Price each', { min: 0 });
      if (o.MarkUpPrice == null) { // cleared -> back to the calculated price
        const c = await quoteOfCategory(tx, qa.QuoteCategoryId);
        o.MarkUpPrice = r2(Number(qa.AssemblySalePrice || 0) * (1 + Number(c.PriceMarkUpPercent || 0))); o.MUManualEntry = null;
      } else o.MUManualEntry = 'Yes';
    }
    const cols = Object.keys(o);
    if (cols.length) await query(`UPDATE CsQuoteAssembly SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE QuoteAssemblyID = @a`, { a: aid, ...Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])) }, tx);
    if ('Quantity' in o) await explodeAssembly(tx, { ...qa, Quantity: o.Quantity }, req.user.username);
  });
  res.json({ ok: true });
}));
router.delete('/quote-assemblies/:aid', h(async (req, res) => {
  const aid = int(req.params.aid) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists('SELECT 1 FROM CsQuoteAssembly WHERE QuoteAssemblyID = @a', { a: aid }, tx))) throw bad('Assembly line not found', 404);
    await query('DELETE FROM CsQuoteAssemblyItem WHERE QuoteAssemblyId = @a', { a: aid }, tx);
    await query('DELETE FROM CsQuoteAssembly WHERE QuoteAssemblyID = @a', { a: aid }, tx);
  });
  res.json({ ok: true });
}));
// Loose item / labor line
router.post('/quote-categories/:cid/items', h(async (req, res) => {
  const cid = int(req.params.cid) || 0, b = req.body || {};
  const InvItemId = optInt(b.InvItemId, 'Item'); if (!InvItemId) throw bad('Choose an item');
  const Quantity = optNum(b.Quantity ?? 1, 'Quantity', { min: 0 }); if (!Quantity) throw bad('Enter a quantity greater than 0');
  const manual = optNum(b.MarkUpPrice, 'Price each', { min: 0 });
  const id = await withTransaction(async (tx) => {
    const c = await quoteOfCategory(tx, cid);
    const i = await one('SELECT CostCodeId, JobCostPrice, LaborCost FROM IcItem WHERE InvItemID = @i', { i: InvItemId }, tx);
    if (!i) throw bad('Choose a valid item');
    const labor = i.CostCodeId === 'L';
    const CostEa = optNum(b.CostEa, 'Cost each', { min: 0 }) ?? Number(labor ? i.LaborCost || 0 : i.JobCostPrice || 0);
    const price = manual != null ? manual : labor ? Number(c.LaborHourlyRate || 0) : r2(Number(i.JobCostPrice || 0) * (1 + Number(c.PriceMarkUpPercent || 0)));
    return (await one(`INSERT INTO CsQuoteAssemblyItem (QuoteCategoryId, QuoteAssemblyId, InvItemId, CostCodeId, Quantity, CostEa, MarkUpPrice, MUManualEntry, DateEntered, UserEntered)
        OUTPUT INSERTED.QuoteItemID AS id VALUES (@c, NULL, @i, @cc, @q, @ce, @p, @mu, GETDATE(), @u)`,
    { c: cid, i: InvItemId, cc: labor ? 'L' : i.CostCodeId, q: Quantity, ce: CostEa, p: price, mu: manual != null ? 'Yes' : null, u: req.user.username }, tx)).id;
  });
  res.status(201).json({ id });
}));
router.put('/quote-items/:iid', h(async (req, res) => {
  const iid = int(req.params.iid) || 0, b = req.body || {}, o = {};
  await withTransaction(async (tx) => {
    const qi = await one('SELECT * FROM CsQuoteAssemblyItem WHERE QuoteItemID = @i', { i: iid }, tx);
    if (!qi) throw bad('Item line not found', 404);
    if (has(b, 'Quantity')) { o.Quantity = optNum(b.Quantity, 'Quantity', { min: 0 }); if (!o.Quantity) throw bad('Enter a quantity greater than 0'); }
    if (has(b, 'CostEa')) { o.CostEa = optNum(b.CostEa, 'Cost each', { min: 0 }); if (o.CostEa == null) throw bad('Enter the cost each'); }
    if (has(b, 'MarkUpPrice')) {
      if (qi.QuoteAssemblyId) throw bad('Items of an assembly are priced through the assembly');
      o.MarkUpPrice = optNum(b.MarkUpPrice, 'Price each', { min: 0 }); if (o.MarkUpPrice == null) throw bad('Enter the price each');
      o.MUManualEntry = 'Yes';
    }
    const cols = Object.keys(o);
    if (cols.length) await query(`UPDATE CsQuoteAssemblyItem SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE QuoteItemID = @i`, { i: iid, ...Object.fromEntries(cols.map((c, i) => [`v${i}`, o[c]])) }, tx);
  });
  res.json({ ok: true });
}));
router.delete('/quote-items/:iid', h(async (req, res) => {
  const iid = int(req.params.iid) || 0;
  const qi = await one('SELECT QuoteAssemblyId FROM CsQuoteAssemblyItem WHERE QuoteItemID = @i', { i: iid });
  if (!qi) return res.status(404).json({ error: 'Item line not found' });
  await query('DELETE FROM CsQuoteAssemblyItem WHERE QuoteItemID = @i', { i: iid });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Master lists (Access LsCs* forms). f = [column, label, type, required, max]
// ---------------------------------------------------------------------------
const LISTS = {
  apptTimes: { table: 'LsAppTime', idCol: 'ApptTimeID', name: 'ApptTime', audit: false, order: 'SortOrder, ApptTime', f: [['ApptTime', 'Appointment time', 'text', true, 50], ['SortOrder', 'Sort order', 'int']], used: [['CsScheduleAppt', 'ApptTimeId']] },
  customerTypes: { table: 'LsCustomerTypeCS', idCol: 'CustomerTypeID', name: 'CustomerType', audit: true, f: [['CustomerType', 'Customer type', 'text', true, 50]], used: [['CsCustomerProperty', 'CustomerTypeId']] },
  errors: { table: 'LsErrorCS', idCol: 'ErrorID', name: 'Error', audit: true, f: [['Error', 'Error', 'text', true, 50], ['DivisionId', 'Division', 'division', true]], used: [['CsScheduleError', 'ErrorId'], ['LsErrorCategoryCS', 'ErrorId']] },
  errorCategories: { table: 'LsErrorCategoryCS', idCol: 'ErrorCatID', name: 'Category', parent: 'ErrorId', audit: true, f: [['ErrorId', 'Error', 'fk:LsErrorCS:ErrorID', true], ['Category', 'Category', 'text', true, 50]], used: [['CsScheduleError', 'ErrorCatId'], ['LsErrorDetailCS', 'ErrorCatId']] },
  errorDetails: { table: 'LsErrorDetailCS', idCol: 'ErrorDetailID', name: 'Detail', parent: 'ErrorCatId', audit: true, f: [['ErrorCatId', 'Error category', 'fk:LsErrorCategoryCS:ErrorCatID', true], ['Detail', 'Error detail', 'text', true, 100], ['AvgFixHours', 'Avg fix hours', 'num']], used: [['CsScheduleError', 'ErrorDetailId']] },
  jobTypes: { table: 'LsJobTypeCS', idCol: 'CsJobTypeID', name: 'CsJobType', audit: true, f: [['CsJobType', 'Job type', 'text', true, 50], ['HourlyValue', 'Hourly value', 'num'], ['MaterialMarkUp', 'Material mark up', 'num']], used: [['CsScheduleAppt', 'CsjobTypeId']] },
  resolutions: { table: 'LsResolutionCS', idCol: 'ResolutionID', name: 'Resolution', audit: false, f: [['Resolution', 'Resolution', 'text', true, 50], ['StatusId', 'Status', 'fk:LsStatus:StatusID', true]], used: [['CsScheduleAppt', 'ResolutionId']] },
  techTypes: { table: 'LsTechTypeCS', idCol: 'TechTypeID', name: 'TechType', audit: true, f: [['TechType', 'Technician type', 'text', true, 50]], used: [['CsTechnician', 'TechTypeId']] },
  ticketTypes: { table: 'LsTicketTypeCS', idCol: 'TicketTypeID', name: 'TicketType', audit: false, f: [['TicketType', 'Ticket type', 'text', true, 50]], used: [['CsScheduleAppt', 'TicketTypeId'], ['CsQuote', 'CsTicketTypeId']] },
};
const listDef = (n) => { const d = LISTS[n]; if (!d) throw bad('Unknown list', 404); return d; };
async function listBody(d, b, partial, tx) {
  const o = {};
  for (const [col, label, type, required, max] of d.f) {
    if (partial && !has(b, col)) continue;
    let v;
    if (type === 'text') v = str(b[col], max, label);
    else if (type === 'int') v = optInt(b[col], label);
    else if (type === 'num') v = optNum(b[col], label, { min: 0 });
    else if (type === 'division') { v = str(b[col], 50, label); if (v && !(await exists('SELECT 1 FROM LsDivision WHERE DivisionID = @v', { v }, tx))) throw bad(`Choose a valid ${label.toLowerCase()}`); }
    else if (type.startsWith('fk:')) { const [, t, c] = type.split(':'); v = optInt(b[col], label); if (v != null && !(await exists(`SELECT 1 FROM [${t}] WHERE [${c}] = @v`, { v }, tx))) throw bad(`Choose a valid ${label.toLowerCase()}`); }
    if (required && (v == null || v === '')) throw bad(`Enter ${label.toLowerCase()}`);
    o[col] = v;
  }
  return o;
}
router.get('/lists/:name', h(async (req, res) => {
  const d = listDef(req.params.name);
  const p = { parent: d.parent ? optInt(req.query.parentId, 'Parent') : null };
  const usedSql = d.used.map(([t, c]) => `(SELECT COUNT(*) FROM [${t}] u WHERE u.[${c}] = x.[${d.idCol}])`).join(' + ');
  const rows = await query(`SELECT x.*, x.[${d.idCol}] AS id, ${usedSql} AS InUse FROM [${d.table}] x WHERE (@parent IS NULL OR ${d.parent ? `x.[${d.parent}]` : 'NULL'} = @parent) ORDER BY ${d.order || `x.[${d.name}]`}`, p);
  res.json({ rows, fields: d.f.map(([col, label, type, required]) => ({ col, label, type, required: !!required })), idCol: d.idCol });
}));
router.post('/lists/:name', h(async (req, res) => {
  const d = listDef(req.params.name);
  const id = await withTransaction(async (tx) => {
    const o = await listBody(d, req.body || {}, false, tx);
    const dupWhere = d.parent ? `AND [${d.parent}] = @p` : '';
    if (await exists(`SELECT 1 FROM [${d.table}] WHERE [${d.name}] = @n ${dupWhere}`, { n: o[d.name], p: d.parent ? o[d.parent] : null }, tx)) throw bad(`"${o[d.name]}" is already in the list`, 409);
    return insertRow({ table: d.table, idCol: d.idCol, columns: d.f.map((x) => x[0]), audit: d.audit }, o, req.user.username, tx);
  });
  res.status(201).json({ id });
}));
router.put('/lists/:name/:id', h(async (req, res) => {
  const d = listDef(req.params.name), id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    const cur = await one(`SELECT * FROM [${d.table}] WHERE [${d.idCol}] = @id`, { id }, tx);
    if (!cur) throw bad('Entry not found', 404);
    const o = await listBody(d, req.body || {}, true, tx);
    if (o[d.name] != null) {
      const dupWhere = d.parent ? `AND [${d.parent}] = @p` : '';
      if (await exists(`SELECT 1 FROM [${d.table}] WHERE [${d.name}] = @n AND [${d.idCol}] <> @id ${dupWhere}`, { n: o[d.name], id, p: d.parent ? (o[d.parent] ?? cur[d.parent]) : null }, tx)) throw bad(`"${o[d.name]}" is already in the list`, 409);
    }
    await updateRow({ table: d.table, idCol: d.idCol, columns: d.f.map((x) => x[0]) }, id, o, tx);
  });
  res.json({ ok: true });
}));
router.delete('/lists/:name/:id', h(async (req, res) => {
  const d = listDef(req.params.name), id = int(req.params.id) || 0;
  await withTransaction(async (tx) => {
    if (!(await exists(`SELECT 1 FROM [${d.table}] WHERE [${d.idCol}] = @id`, { id }, tx))) throw bad('Entry not found', 404);
    for (const [t, c] of d.used) {
      const n = (await one(`SELECT COUNT(*) AS n FROM [${t}] WHERE [${c}] = @id`, { id }, tx)).n;
      if (n) throw bad(`This entry is used by ${n} record(s) and cannot be deleted.`, 409);
    }
    await query(`DELETE FROM [${d.table}] WHERE [${d.idCol}] = @id`, { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Inventory items, read only (Access InventoryItemRead + subforms)
// ---------------------------------------------------------------------------
router.get('/items', h(async (req, res) => {
  const pg = paging(req.query);
  const p = { s: req.query.search ? `%${req.query.search}%` : null, offset: pg.offset, pageSize: pg.pageSize };
  const where = 'WHERE (@s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s OR i.AlternateCode LIKE @s OR i.PartNum LIKE @s)';
  const rows = await query(`SELECT i.InvItemID, i.InvItem AS name, i.InvItemID AS id, i.InvItem, i.Description, c.InvClass, i.Uom, i.CostCodeId, i.JobCostPrice, i.EstimatingPrice, i.LaborCost, i.RetailPrice
      FROM IcItem i LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId ${where} ORDER BY c.InvClass, i.InvItem OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM IcItem i ${where}`, p);
  res.json({ rows, total: total.n, page: pg.page, pageSize: pg.pageSize });
}));
// Picker: [{id, name, JobCostPrice, EstimatingPrice, LaborCost, CostCodeId}]
router.get('/items/search', h(async (req, res) => {
  res.json(await query(`SELECT TOP 50 i.InvItemID AS id, i.InvItem + ISNULL(' – ' + i.Description, '') AS name, i.InvItem, i.CostCodeId, i.JobCostPrice, i.EstimatingPrice, i.LaborCost
      FROM IcItem i WHERE @s IS NULL OR i.InvItem LIKE @s OR i.Description LIKE @s OR i.PartNum LIKE @s
      ORDER BY CASE WHEN i.InvItem LIKE @s THEN 0 ELSE 1 END, i.InvItem`, { s: req.query.search ? `%${req.query.search}%` : null }));
}));
router.get('/items/:id', h(async (req, res) => {
  const id = int(req.params.id) || 0;
  const item = await one(`SELECT i.*, c.InvClass, v.Vendor, s.Status, cc.Description AS CostCode, st.Stage AS DefaultStage, w.WorkType AS DefaultWork
      FROM IcItem i LEFT JOIN LsInvClass c ON c.InvClassID = i.InvClassId LEFT JOIN IcVendor v ON v.VendorID = i.VendorId LEFT JOIN LsStatus s ON s.StatusID = i.StatusId
      LEFT JOIN LsCostCode cc ON cc.CostCodeId = i.CostCodeId LEFT JOIN LsStage st ON st.StageID = i.DefaultStageId LEFT JOIN LsWork w ON w.WorkID = i.DefaultWorkId WHERE i.InvItemID = @id`, { id });
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const divisions = await query('SELECT InvDivisionID, DivisionId, QtyOnHand, QtyReOrder, QtyOnOrder, Notes FROM IcItemDivision WHERE InvItemId = @id ORDER BY DivisionId', { id });
  const vendors = await query('SELECT vi.VendItemID, v.Vendor, vi.PartNum, vi.Manufacturer, vi.DefaultPrice, vi.LastPrice, vi.DateQuote FROM IcVendorItem vi LEFT JOIN IcVendor v ON v.VendorID = vi.VendorId WHERE vi.InvItemId = @id ORDER BY v.Vendor', { id });
  res.json({ item, divisions, vendors });
}));

// ---------------------------------------------------------------------------
// Reports (SwitchCS "Reports" tab). Filters = the switchboard boxes:
//   A lotAddressId, B jobId, C lotId, D resolutionId, E division, F customerId, G from, H to, I errorId
// Each report keeps the joins of its Access record source (inner joins drop rows exactly like Access did).
// ---------------------------------------------------------------------------
function filters(q) {
  return {
    lotAddressId: optInt(q.lotAddressId, 'Lot address'), jobId: optInt(q.jobId, 'Job'), lotId: optInt(q.lotId, 'Lot'), resolutionId: optInt(q.resolutionId, 'Resolution'),
    division: q.division || null, customerId: optInt(q.customerId, 'Homeowner'), from: optDate(q.from, 'From date'), to: optDate(q.to, 'To date'), errorId: optInt(q.errorId, 'Error type'),
  };
}
const need = (f, keys) => {
  const msg = { lotAddressId: 'Select the lot address (filter A)', jobId: 'Select the job (filter B)', lotId: 'Select the lot (filter C)', division: 'Select division (filter E)',
    customerId: 'Select the homeowner (filter F)', from: 'Enter a date in the from date filter (G)', to: 'Enter a date in the to date filter (H)', errorId: 'Select the error type (filter I)' };
  for (const k of keys) if (f[k] == null || f[k] === '') throw bad(msg[k]);
  if (keys.includes('from') && keys.includes('to') && f.to < f.from) throw bad('The to date must be on or after the from date');
};
const LOTBLOCK = "CASE WHEN l.Block IS NULL THEN l.Lot ELSE ISNULL(l.Lot,'') + '/' + l.Block END";
const STREET = "p.Address + ISNULL(' #' + p.UnitApt, '')";
const CUSTNAME = "c.FirstName + CASE WHEN c.MiddleName IS NULL THEN ' ' ELSE ' ' + c.MiddleName + ' ' END + ISNULL(c.LastName,'')";
const PROPERTY = "p.Address + CASE WHEN p.UnitApt IS NULL THEN ', ' ELSE ' #' + p.UnitApt + ', ' END + ISNULL(p.City,'') + ', ' + ISNULL(p.StateId,'') + ' ' + ISNULL(CAST(p.Zip AS varchar(10)),'')";
const LOT_COLS = `CAST(c.CustID AS varchar(20)) + '.' + CAST(j.JobId AS varchar(20)) + '.' + CAST(ph.PhaseID AS varchar(20)) AS Code, c.CustName, j.JobName, ph.Phase, pc.BidNum, pc.BidRelease, pc.BidName, pc.BidDate,
  su.SuperName, ph.StartDate AS PhaseStartDate, ${LOTBLOCK} AS LotBlock, s.Status, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes, l.StartDate, l.EndDate,
  l.DateEntered, l.UserEntered, l.WarrantyDate, pk.PackName, pk.BuilderCode, jp.PackQty, l.LotID, l.InvoiceNum`;

const REPORTS = {
  // CsSearchLotProdAddress (A)
  'lot-address': async (f) => {
    need(f, ['lotAddressId']);
    return { rows: await query(`SELECT ${LOT_COLS}
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId JOIN JsLot l ON ph.PhaseID = l.PhaseId AND j.JobId = l.JobId
      LEFT JOIN JsPack jp ON jp.LotId = l.LotID LEFT JOIN PmPack pk ON pk.PmPackID = jp.PmPackId JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1
      LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN LsStatus s ON s.StatusID = CAST(l.StatusId AS int)
      WHERE l.LotID = @lot ORDER BY ${LOTBLOCK}, pk.PackName`, { lot: f.lotAddressId }), group: ['LotBlock'] };
  },
  // CsSearchLotProd (C)
  'lot-info': async (f) => {
    need(f, ['lotId']);
    return { rows: await query(`SELECT ${LOT_COLS}
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId JOIN JsLot l ON ph.PhaseID = l.PhaseId
      LEFT JOIN JsPack jp ON jp.LotId = l.LotID LEFT JOIN PmPack pk ON pk.PmPackID = jp.PmPackId LEFT JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1
      LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId LEFT JOIN PmContract pc ON pc.PmContractID = ph.PmContractId JOIN LsStatus s ON s.StatusID = j.StatusId
      WHERE l.LotID = @lot ORDER BY ${LOTBLOCK}, pk.PackName`, { lot: f.lotId }), group: ['LotBlock'] };
  },
  // JsJobAlphabetically: jobs with a phase + superintendent, builders not named Test*; grouped by division
  'jobs-alpha': async () => ({ rows: await query(`SELECT c.CustID, c.CustName, j.JobId, j.JobName, j.JobNum, j.DivisionId, s.Status, ls.SuperName AS LastOfSuperName
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN LsStatus s ON s.StatusID = j.StatusId
      CROSS APPLY (SELECT TOP 1 su.SuperName FROM JsPhase ph JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1 WHERE ph.JobId = j.JobId ORDER BY ph.PhaseID DESC) ls
      WHERE c.CustName NOT LIKE 'Test%' ORDER BY j.DivisionId, j.JobName`), group: ['DivisionId'] }),
  // JsJobCity (division E optional; Access read it from the PU switchboard)
  'jobs-city': async (f) => ({ rows: await query(`SELECT j.City, c.CustName, j.JobName, j.JobNum, j.DivisionId, s.Status, ls.SuperName AS LastOfSuperName
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN LsStatus s ON s.StatusID = j.StatusId
      CROSS APPLY (SELECT TOP 1 su.SuperName FROM JsPhase ph JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1 WHERE ph.JobId = j.JobId ORDER BY ph.PhaseID DESC) ls
      WHERE c.CustName NOT LIKE 'Test%' AND j.JobName NOT LIKE '%Test%' AND (@div IS NULL OR j.DivisionId = @div) ORDER BY j.City, j.JobName`, { div: f.division }), group: ['City'] }),
  // CsSearchHomeowner (F)
  homeowner: async (f) => {
    need(f, ['customerId']);
    return { rows: await query(`SELECT c.CustomerID, c.FirstName + CASE WHEN c.MiddleName IS NULL THEN ' ' ELSE ' ' + c.MiddleName + ' ' END + ISNULL(c.LastName,'') AS Homeowner, ct.CustomerType, cj.Job, p.CsLot,
        pl.PlanNum, pl.PlanName, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, ${PROPERTY} AS Property, p.Notes, l.Permit, l.LotNotes, l.StartDate, l.EndDate, l.WarrantyDate, pk.PackName, pk.BuilderCode, jp.PackQty
      FROM CsProperty p LEFT JOIN JsLot l ON l.LotID = p.LotId LEFT JOIN JsPack jp ON jp.LotId = l.LotID LEFT JOIN PmPack pk ON pk.PmPackID = jp.PmPackId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      JOIN CsJob cj ON cj.CsJobID = p.CsJobId JOIN CsCustomerProperty cp ON cp.PropertyId = p.PropertyID JOIN CsCustomer c ON c.CustomerID = cp.CustomerId JOIN LsCustomerTypeCS ct ON ct.CustomerTypeID = cp.CustomerTypeId
      WHERE c.CustomerID = @c ORDER BY cj.Job, p.CsLot, pk.PackName`, { c: f.customerId }), group: ['Job', 'CsLot'] };
  },
  'ticket-hv': async (f) => ticketSheet(f, true),
  'ticket-lv': async (f) => ticketSheet(f, false),
  // CsRouteSheet (G + E): one line per ticket and technician, a page per technician
  'route-sheet': async (f) => {
    need(f, ['from', 'division']);
    return { rows: await query(`SELECT a.TicketID, e.FName + ' ' + ISNULL(e.LName,'') AS Tech, a.ApptDate, t.ApptTime, tt.TicketType, jt.CsJobType, a.DivisionId,
        ISNULL(cj.Job,'Undisclosed job') + ' | ' + ISNULL(p.CsLot,'No lot') AS JobLot, ${PROPERTY} AS Property, ${CUSTNAME} AS Customer, a.CustomerPONum, a.HighCeiling, a.Notes, MIN(x.TechnicianId) AS TechnicianId
      FROM CsScheduleAppt a JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
      LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId LEFT JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId
      JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId
      WHERE a.ApptDate = @d AND a.DivisionId = @div
      GROUP BY a.TicketID, e.FName + ' ' + ISNULL(e.LName,''), a.ApptDate, t.ApptTime, t.SortOrder, tt.TicketType, jt.CsJobType, a.DivisionId, ISNULL(cj.Job,'Undisclosed job') + ' | ' + ISNULL(p.CsLot,'No lot'),
               ${PROPERTY}, ${CUSTNAME}, a.CustomerPONum, a.HighCeiling, a.Notes
      ORDER BY Tech, t.SortOrder, a.TicketID`, { d: f.from, div: f.division }), group: ['Tech'] };
  },
  'feedback-address': async (f) => ({ rows: await feedbackRows(f), group: ['Job', 'CsLot'] }),
  // CsFeedbackEmployee: feedback rows + the labor paid on each lot (CsFeedbackEmployeeSub)
  'feedback-employee': async (f) => {
    const rows = await feedbackRows(f);
    const lots = [...new Set(rows.map((r) => r.LotId).filter(Boolean))];
    const labor = lots.length ? await query(`SELECT pp.LotId, e.FName + ISNULL(' ' + e.MInitial, '') + ' ' + ISNULL(e.LName,'') AS Employee, pp.PackName, pp.PackQty, pp.Item, pp.ExtItemQty, ss.ScheduleStage, w.WorkType,
        pp.PriceEa, pp.PayPercent, pp.PayHours, pp.HourlyRate, pp.Notes
      FROM PrLaborPaid pp JOIN PrEmployee e ON e.EmployeeID = pp.EmployeeId JOIN LsWork w ON w.WorkID = pp.WorkId JOIN LsScheduleStage ss ON ss.ScheduleStageID = pp.ScheduleStageId
      WHERE pp.LotId IN (${lots.map((_, i) => `@l${i}`).join(',')}) ORDER BY pp.LotId, Employee, pp.PackName`, Object.fromEntries(lots.map((l, i) => [`l${i}`, l]))) : [];
    return { rows, labor, group: ['Job', 'CsLot'] };
  },
  // CsFeedbackError: hot spot = how often the error detail occurs in the period/division; first technician of the ticket
  'feedback-error': async (f) => {
    need(f, ['from', 'to', 'division']);
    const p = { from: f.from, to: f.to, div: f.division };
    const rows = await query(`WITH hs AS (SELECT er.ErrorDetailId, COUNT(er.ScheduleErrorID) AS Cnt FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID
           WHERE er.ApptDate >= @from AND er.ApptDate <= @to AND a.DivisionId = @div GROUP BY er.ErrorDetailId)
      SELECT hs.Cnt AS HotSpot, er.ApptDate, er.TicketId, le.Error, lc.Category, ld.Detail, ss.ScheduleStage, cj.Job, p.CsLot, ${STREET} AS Street, p.City, p.StateId, p.Zip, p.LotId,
             MIN(x.TechnicianId) AS FirstOfTechnicianId, MIN(e.FName + ISNULL(' ' + e.MInitial + ' ', ' ') + ISNULL(e.LName,'')) AS TechName, a.DivisionId
        FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId
        JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId JOIN LsScheduleStage ss ON ss.ScheduleStageID = er.StageId JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN CsJob cj ON cj.CsJobID = p.CsJobId
        JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId JOIN hs ON hs.ErrorDetailId = ld.ErrorDetailID
       WHERE er.ApptDate >= @from AND er.ApptDate <= @to AND a.DivisionId = @div
       GROUP BY hs.Cnt, er.ApptDate, er.TicketId, le.Error, lc.Category, ld.Detail, ss.ScheduleStage, cj.Job, p.CsLot, ${STREET}, p.City, p.StateId, p.Zip, p.LotId, a.DivisionId
       ORDER BY hs.Cnt DESC, le.Error, lc.Category, ld.Detail, er.ApptDate, er.TicketId`, p);
    // CsFeedbackErrorSubSummary (Access filters this summary on the dates only)
    const summary = await query(`SELECT COUNT(er.TicketId) AS Tickets, le.Error, lc.Category FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID
        JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId
       WHERE er.ApptDate >= @from AND er.ApptDate <= @to GROUP BY le.Error, lc.Category ORDER BY COUNT(er.TicketId) DESC, le.Error, lc.Category`, p);
    return { rows, summary, group: ['Error', 'Category', 'Detail'] };
  },
  // CsTicketErrorType (G H I): tickets due to an error type with hours on site × hourly cost
  'ticket-error-type': async (f) => {
    need(f, ['from', 'to', 'errorId']);
    const rows = await query(`SELECT le.Error, er.ApptDate, er.TicketId, cb.Builder, cj.Job, p.CsLot, ${STREET} AS Street, p.City, p.StateId, p.Zip,
        ISNULL(a.LaborCostHour,0) AS HourlyCost, a.EstimatedHours, ISNULL(SUM(${HOURS('x')}),0) AS TimeAtJob
      FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId
      JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId JOIN LsScheduleStage ss ON ss.ScheduleStageID = er.StageId JOIN CsProperty p ON p.PropertyID = a.PropertyId
      JOIN CsJob cj ON cj.CsJobID = p.CsJobId JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId LEFT JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID
      WHERE er.ApptDate >= @from AND er.ApptDate <= @to AND le.ErrorID = @err
      GROUP BY le.Error, er.ApptDate, er.TicketId, cb.Builder, cj.Job, p.CsLot, ${STREET}, p.City, p.StateId, p.Zip, ISNULL(a.LaborCostHour,0), a.EstimatedHours, le.ErrorID
      ORDER BY cb.Builder, cj.Job, er.ApptDate, er.TicketId`, { from: f.from, to: f.to, err: f.errorId });
    rows.forEach((r) => { r.Cost = r2(Number(r.HourlyCost) * Number(r.TimeAtJob)); });
    return { rows, totals: { TimeAtJob: Math.round(rows.reduce((s, r) => s + Number(r.TimeAtJob), 0) * 1000) / 1000, Cost: r2(rows.reduce((s, r) => s + r.Cost, 0)), Tickets: rows.length }, group: ['Builder', 'Job'] };
  },
  'worker-error-type': async (f) => ({ rows: await workerRows(f), group: ['EmpName', 'SuperName', 'Job'] }),
  'job-worker-error-type': async (f) => {
    const rows = await workerRows(f);
    const tickets = [...new Set(rows.map((r) => r.TicketId))];
    const hrs = tickets.length ? await query(`SELECT x.TicketId, SUM(${HOURS('x')}) AS Hours FROM CsScheduleTechnician x WHERE x.TicketId IN (${tickets.map((_, i) => `@t${i}`).join(',')}) GROUP BY x.TicketId`,
      Object.fromEntries(tickets.map((t, i) => [`t${i}`, t]))) : [];
    const m = new Map(hrs.map((x) => [x.TicketId, x.Hours]));
    rows.forEach((r) => { r.TicketHours = m.get(r.TicketId) ?? null; });
    rows.sort((a, b) => String(a.Job).localeCompare(String(b.Job)) || String(a.CsLot).localeCompare(String(b.CsLot)) || a.TicketId - b.TicketId || String(a.Category).localeCompare(String(b.Category)) || String(a.ErrorDetail).localeCompare(String(b.ErrorDetail)) || String(a.EmpName).localeCompare(String(b.EmpName)));
    return { rows, group: ['Job', 'CsLot', 'TicketId'] };
  },
  // CsTicketErrorTypeSummary (G H): per division / error / builder
  'ticket-error-summary': async (f) => {
    need(f, ['from', 'to']);
    const rows = await query(`SELECT j.DivisionId, le.Error, cb.Builder, COUNT(er.TicketId) AS TicketCount, ISNULL(a.LaborCostHour,0) AS HourlyCost, ISNULL(SUM(${HOURS('x')}),0) AS TimeAtJob
      FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN CsProperty p ON p.PropertyID = a.PropertyId
      JOIN CsJob cj ON cj.CsJobID = p.CsJobId JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId LEFT JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID
      JOIN JsLot l ON l.LotID = p.LotId JOIN JsJob j ON j.JobId = l.JobId
      WHERE er.ApptDate >= @from AND er.ApptDate <= @to
      GROUP BY j.DivisionId, le.Error, cb.Builder, ISNULL(a.LaborCostHour,0) ORDER BY j.DivisionId, le.Error, cb.Builder`, { from: f.from, to: f.to });
    rows.forEach((r) => { r.Cost = r2(Number(r.HourlyCost) * Number(r.TimeAtJob)); r.CostPerTicket = r.TicketCount ? r2(r.Cost / r.TicketCount) : null; });
    const t = rows.reduce((s, r) => ({ TicketCount: s.TicketCount + r.TicketCount, TimeAtJob: s.TimeAtJob + Number(r.TimeAtJob), Cost: s.Cost + r.Cost }), { TicketCount: 0, TimeAtJob: 0, Cost: 0 });
    return { rows, totals: { ...t, TimeAtJob: Math.round(t.TimeAtJob * 1000) / 1000, Cost: r2(t.Cost), CostPerTicket: t.TicketCount ? r2(t.Cost / t.TicketCount) : null }, group: ['DivisionId', 'Error'] };
  },
  // CsTicketHoursSummary (G H): hours per ticket and technician; hourly cost defaults to 50 like Access Nz(LaborCostHour,50)
  'ticket-hours-summary': async (f) => {
    need(f, ['from', 'to']);
    const rows = await query(`SELECT j.DivisionId, cb.Builder, cj.Job, ju.Jurisdiction, su1.SuperName, su2.SuperName AS SuperName2, a.ApptDate, a.TicketID, e.FName + ' ' + ISNULL(e.LName,'') AS Technician, x.TechnicianId,
        ROUND(ISNULL(a.LaborCostHour,50),2) AS HourlyCost, ISNULL(SUM(${HOURS('x')}),0) AS TimeAtJob
      FROM CsScheduleAppt a JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN CsJob cj ON cj.CsJobID = p.CsJobId JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId
      LEFT JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID JOIN JsLot l ON l.LotID = p.LotId JOIN JsJob j ON j.JobId = l.JobId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
      JOIN LsJurisdiction ju ON ju.JurisdictionID = j.JurisdictionId JOIN LsSuperintendent su2 ON su2.SuperID = ph.SuperId2 LEFT JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId
      LEFT JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId JOIN LsSuperintendent su1 ON su1.SuperID = ph.SuperId1
      WHERE a.ApptDate >= @from AND a.ApptDate <= @to
      GROUP BY j.DivisionId, cb.Builder, cj.Job, ju.Jurisdiction, su1.SuperName, su2.SuperName, a.ApptDate, a.TicketID, e.FName + ' ' + ISNULL(e.LName,''), x.TechnicianId, ROUND(ISNULL(a.LaborCostHour,50),2)
      ORDER BY j.DivisionId, cb.Builder, cj.Job, a.TicketID`, { from: f.from, to: f.to });
    rows.forEach((r) => { r.Cost = r2(Number(r.HourlyCost) * Number(r.TimeAtJob)); });
    const t = rows.reduce((s, r) => ({ Lines: s.Lines + 1, TimeAtJob: s.TimeAtJob + Number(r.TimeAtJob), Cost: s.Cost + r.Cost }), { Lines: 0, TimeAtJob: 0, Cost: 0 });
    return { rows, totals: { ...t, TimeAtJob: Math.round(t.TimeAtJob * 1000) / 1000, Cost: r2(t.Cost), CostPerTicket: t.Lines ? r2(t.Cost / t.Lines) : null }, group: ['DivisionId', 'Builder'] };
  },
  // CsOpenLotsScheduled: tickets from 15 days ago on, on lots still open in production
  'open-lots-scheduled': async () => {
    const since = addDays(todayIso(), -15);
    return { since, rows: await query(`SELECT a.TicketID, a.ApptDate, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, l.EndDate, jc.CustName, j.JobName, l.Lot, l.Block, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS LotBlock
      FROM CsScheduleAppt a JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN JsLot l ON l.LotID = p.LotId JOIN JsJob j ON j.JobId = l.JobId JOIN JsCustomer jc ON jc.CustID = j.CustId
      WHERE a.ApptDate >= @since AND l.EndDate IS NULL ORDER BY a.ApptDate, a.TicketID`, { since }) };
  },
  // CsMaterialPostedLot (C): material (not labor) posted to the lot
  'material-posted-lot': async (f) => {
    need(f, ['lotId']);
    return { rows: await query(`SELECT j.JobName, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS LotBlock, w.WorkType, ss.ScheduleStage, jc.CostCodeId, i.InvItem, jc.ExtItemQty, jc.Notes, jc.DateEntered, jc.UserEntered, l.LotID AS LotId
      FROM JcLotItem jc JOIN JsLot l ON l.LotID = jc.LotId JOIN JsJob j ON j.JobId = l.JobId JOIN LsScheduleStage ss ON ss.ScheduleStageID = jc.ScheduleStageId JOIN LsWork w ON w.WorkID = jc.WorkId JOIN IcItem i ON i.InvItemID = jc.InvItemId
      WHERE jc.CostCodeId <> 'L' AND l.LotID = @lot ORDER BY w.WorkType, ss.ScheduleStage, i.InvItem`, { lot: f.lotId }), group: ['LotId', 'WorkType', 'ScheduleStage'] };
  },
  // CsSearchLotTicket (C): the lot and every CS ticket on it
  'lot-ticket': async (f) => {
    need(f, ['lotId']);
    return { rows: await query(`SELECT c.CustName, j.JobName, ph.Phase, ph.StartDate AS PhaseStartDate, ${LOTBLOCK} AS LotBlock, s.Status, pl.PlanNum, pl.PlanName, l.Address, l.City, l.State, l.Zip, l.Permit, l.LotNotes,
        l.StartDate, l.EndDate, l.WarrantyDate, l.LotID, a.TicketID, a.ApptDate, a.Notes
      FROM JsCustomer c JOIN JsJob j ON c.CustID = j.CustId JOIN JsPhase ph ON j.JobId = ph.JobId JOIN JsLot l ON ph.PhaseID = l.PhaseId LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      JOIN LsStatus s ON s.StatusID = j.StatusId JOIN CsProperty p ON p.LotId = l.LotID JOIN CsScheduleAppt a ON a.PropertyId = p.PropertyID
      WHERE l.LotID = @lot ORDER BY a.TicketID`, { lot: f.lotId }) };
  },
  // "Exp appointment data" (expCsAppt01..06): active tickets in the period and the production data of their lots
  'export-appointments': async (f) => {
    need(f, ['from', 'to']);
    const p = { from: f.from, to: f.to };
    const base = `SELECT a.TicketID, a.ApptDate, a.ApptTimeId, a.TicketTypeId, a.CsjobTypeId, a.HighCeiling, a.Notes AS TicketNotes, a.DivisionId, a.PropertyId, p.Address, p.UnitApt, p.City, p.StateId, p.Zip, p.Escrow,
        p.CsJobId, cj.Job, p.LotId, p.CsLot, p.Notes AS PropertyNotes, a.CustomerId, ${CUSTNAME} AS CustomerName, cp.CustomerTypeId, c.Notes AS CustomerNotes, a.RepName, a.RepPhone, a.EstimatedHours, a.CustomerPONum, s.Active
      FROM CsScheduleAppt a JOIN CsCustomer c ON c.CustomerID = a.CustomerId JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN LsStatus s ON s.StatusID = a.StatusId JOIN CsJob cj ON cj.CsJobID = p.CsJobId
      JOIN CsCustomerProperty cp ON cp.PropertyId = p.PropertyID AND cp.CustomerId = c.CustomerID
      WHERE a.ApptDate >= @from AND a.ApptDate <= @to AND s.Active = 1`;
    const appts = await query(`${base} ORDER BY a.ApptDate, a.TicketID`, p);
    const techs = await query(`SELECT x.TicketId, x.ApptDate, x.TechnicianId FROM (${base}) e JOIN CsScheduleTechnician x ON x.TicketId = e.TicketID ORDER BY x.TicketId`, p);
    const pmPacks = await query(`SELECT pk.PmPackID, pk.PackName, pk.PackTypeId, pk.Quantity FROM PmPlan pl JOIN PmPack pk ON pk.PmPlanId = pl.PmPlanID JOIN JsLot l ON l.PmPlanId = pl.PmPlanID JOIN (${base}) e ON e.LotId = l.LotID
      GROUP BY pk.PmPackID, pk.PackName, pk.PackTypeId, pk.Quantity ORDER BY pk.PmPackID`, p);
    const jsPacks = await query(`SELECT jp.PackID, jp.LotId, jp.PackTypeId, jp.PmPackId, jp.PostedQty AS PackQty FROM JsLot l JOIN (${base}) e ON e.LotId = l.LotID JOIN JsPack jp ON jp.LotId = l.LotID`, p);
    const jsStages = await query(`SELECT st.StageAutoID, st.LotId, st.WorkId, st.ScheduleStageId, st.DeliveryDate, st.Notes, st.DatePosted, st.UserPosted, st.DateEntered, st.UserEntered FROM JsLot l JOIN (${base}) e ON e.LotId = l.LotID JOIN JsStage st ON st.LotId = l.LotID`, p);
    const labor = await query(`SELECT pp.LaborPaidID, pp.PayrollDate, pp.EmployeeId, pp.EmpName, pp.LotId, pp.PackId, pp.PackName, pp.PackQty, pp.Item, pp.ExtItemQty, pp.ScheduleStageId, pp.WorkId, pp.PayPercent, pp.PayHours
      FROM JsLot l JOIN (${base}) e ON e.LotId = l.LotID JOIN PrLaborPaid pp ON pp.LotId = l.LotID`, p);
    return { files: [
      { name: '01ExpAppt', rows: appts }, { name: '02ExpTech', rows: techs }, { name: '03ExpPmPack', rows: pmPacks },
      { name: '04ExpJsPack', rows: jsPacks }, { name: '05ExpJsStage', rows: jsStages }, { name: '06ExpLabor', rows: labor }] };
  },
};
// CsTicketHv / CsTicketLv (G + E): ticket sheets for a day, with technicians and homeowner phones
async function ticketSheet(f, hv) {
  need(f, ['from', 'division']);
  const rows = await query(`SELECT a.TicketID, a.ApptDate, t.ApptTime, tt.TicketType, jt.CsJobType, a.DivisionId, ${hv ? 'cb.Builder,' : ''} cj.Job, p.CsLot, ${PROPERTY} AS Property, p.Escrow, c.CustomerID,
      ${CUSTNAME} AS Customer, a.RepName, a.RepPhone, a.CustomerPONum, a.HighCeiling, a.Notes, s.Status
    FROM CsScheduleAppt a JOIN CsCustomer c ON c.CustomerID = a.CustomerId LEFT JOIN CsProperty p ON p.PropertyID = a.PropertyId LEFT JOIN CsJob cj ON cj.CsJobID = p.CsJobId
    LEFT JOIN LsAppTime t ON t.ApptTimeID = a.ApptTimeId LEFT JOIN LsTicketTypeCS tt ON tt.TicketTypeID = a.TicketTypeId LEFT JOIN LsJobTypeCS jt ON jt.CsJobTypeID = a.CsjobTypeId
    LEFT JOIN LsStatus s ON s.StatusID = a.StatusId ${hv ? 'LEFT JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId' : ''}
    WHERE a.ApptDate = @d AND a.DivisionId = @div ORDER BY t.SortOrder, a.TicketID`, { d: f.from, div: f.division });
  for (const r of rows) {
    r.JobLot = `${hv ? `${r.Builder ?? 'Undisclosed builder'} | ` : ''}${r.Job ?? 'Undisclosed job'} | ${r.CsLot ?? 'No lot'}`;
    r.Technicians = (await query("SELECT e.FName + ' ' + ISNULL(e.LName,'') AS Tech FROM CsScheduleTechnician x JOIN CsTechnician tc ON tc.TechnicianID = x.TechnicianId JOIN PrEmployee e ON e.EmployeeID = tc.EmployeeId WHERE x.TicketId = @t AND x.ApptDate = @d ORDER BY x.TicketTechID",
      { t: r.TicketID, d: r.ApptDate })).map((x) => x.Tech);
    r.Phones = await query('SELECT t.PhoneType, ph.PhoneNum FROM CsCustomerPhone ph JOIN LsPhoneType t ON t.PhoneTypeID = ph.PhoneTypeId WHERE ph.CustomerId = @c ORDER BY ph.CustPhoneID', { c: r.CustomerID });
  }
  return { rows };
}
// CsFeedbackAddress / CsFeedbackEmployee record source (G H E)
async function feedbackRows(f) {
  need(f, ['from', 'to', 'division']);
  return query(`SELECT er.ApptDate, er.TicketId, le.Error, lc.Category, ld.Detail, ss.ScheduleStage, cj.Job, p.CsLot, ${STREET} AS Street, p.City, p.StateId, p.Zip, p.LotId, a.DivisionId
    FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId
    JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId JOIN LsScheduleStage ss ON ss.ScheduleStageID = er.StageId JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN CsJob cj ON cj.CsJobID = p.CsJobId
    WHERE er.ApptDate >= @from AND er.ApptDate <= @to AND a.DivisionId = @div ORDER BY cj.Job, p.CsLot, p.LotId, er.ApptDate, er.TicketId`, { from: f.from, to: f.to, div: f.division });
}
// CsWorkerErrorType / CsJobWorkerErrorType (G H I): installers paid on the lot for the stage of the error
async function workerRows(f) {
  need(f, ['from', 'to', 'errorId']);
  return query(`SELECT er.ApptDate, er.TicketId, cb.Builder, cj.Job, p.CsLot, ss.ScheduleStage, le.Error, lc.Category, ld.Detail AS ErrorDetail, pp.EmpName, su.SuperName
    FROM CsScheduleAppt a JOIN CsScheduleError er ON er.TicketId = a.TicketID JOIN LsErrorCS le ON le.ErrorID = er.ErrorId JOIN LsErrorCategoryCS lc ON lc.ErrorCatID = er.ErrorCatId
    JOIN LsErrorDetailCS ld ON ld.ErrorDetailID = er.ErrorDetailId JOIN CsProperty p ON p.PropertyID = a.PropertyId JOIN CsJob cj ON cj.CsJobID = p.CsJobId JOIN CsBuilder cb ON cb.CsBuilderID = cj.CsBuilderId
    JOIN CsScheduleTechnician x ON x.TicketId = a.TicketID JOIN LsScheduleStage ss ON ss.ScheduleStageID = er.StageId JOIN PrLaborPaid pp ON pp.ScheduleStageId = ss.ScheduleStageID
    JOIN JsLot l ON l.LotID = pp.LotId AND l.LotID = p.LotId JOIN JsPhase ph ON ph.PhaseID = l.PhaseId JOIN LsSuperintendent su ON su.SuperID = ph.SuperId1
    WHERE er.ApptDate >= @from AND er.ApptDate <= @to AND le.ErrorID = @err
    GROUP BY er.ApptDate, er.TicketId, cb.Builder, cj.Job, p.CsLot, ss.ScheduleStage, le.Error, lc.Category, ld.Detail, pp.EmpName, su.SuperName, le.ErrorID
    ORDER BY pp.EmpName, su.SuperName, cj.Job, p.CsLot`, { from: f.from, to: f.to, err: f.errorId });
}
router.get('/reports/:key', h(async (req, res) => {
  const fn = REPORTS[req.params.key];
  if (!fn) return res.status(404).json({ error: 'Unknown report' });
  res.json(await fn(filters(req.query)));
}));
// Switchboard filter combos (A lot address, B job, C lots of the job)
router.get('/filters/lot-addresses', h(async (req, res) => {
  res.json(await query(`SELECT TOP 50 l.LotID AS id, l.Address + ISNULL(', ' + l.City, '') + ' — ' + j.JobName + ' ' + ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS name
      FROM JsLot l JOIN JsJob j ON j.JobId = l.JobId WHERE l.Address <> '0' AND (@s IS NULL OR l.Address LIKE @s) ORDER BY l.Address, l.City`, { s: req.query.search ? `%${req.query.search}%` : null }));
}));
router.get('/filters/jobs', h(async (req, res) => {
  res.json(await query(`SELECT TOP 50 j.JobId AS id, j.JobName + ' (' + ISNULL(j.DivisionId,'') + ') — ' + c.CustName AS name FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId
      WHERE (@s IS NULL OR j.JobName LIKE @s OR c.CustName LIKE @s) ORDER BY j.JobName, j.DivisionId`, { s: req.query.search ? `%${req.query.search}%` : null }));
}));
router.get('/filters/lots', h(async (req, res) => {
  res.json(await query(`SELECT l.LotID AS id, ${LOTBLOCK} + CASE WHEN l.EndDate IS NULL THEN '' ELSE ' (closed)' END AS name FROM JsLot l WHERE l.JobId = @j ORDER BY ${LOTBLOCK}`, { j: optInt(req.query.jobId, 'Job') || 0 }));
}));

module.exports = router;
