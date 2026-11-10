// Database maintenance (DM) — Access SwitchDM, two tabs:
//   Lists:     LoginUsers (logins + module permission flags) and the lookup-table forms (Ls*, CxItems, Vendor).
//   Functions: update item / assembly prices, post material only to JC, post new material added in PM, post an unposted
//              pack to JC, edit posted pack quantities (dboEditPackPostedQty), edit T&M approval (DmTmEdit), the dbo* "fix"
//              datasheets for one lot / employee, delete lot invoices, change piece / hourly payroll dates, load vendor
//              prices (IcPriceLoadVendor) and the lot close date history report (DmLotEndDateHistory).
//
// Security:
//   * LoginUsers.Password is never selected for any response. A new password is set only through the write-only
//     `newPassword` field. (LoginUsers stores plain text: the legacy Access front end reads the same column.)
//   * A user cannot deactivate, delete or remove the DM flag from their own login.
//   * Every table / column name used in dynamic SQL comes from the fixed LISTS / FIX / MODULE_COLUMNS allow-lists below;
//     request values are always parameters.
//
// Access rules reproduced:
//   * post unposted pack: refused for a closed lot (EndDate set); needs lot + date (the Access query reads tbxDate,
//     which the switchboard does not have — the "Date from" box is used)
//   * post material only: material lines of the lot's packs at the schedule stage, after lot substitutions (NoChange keeps
//     the item), cost code M only → JcLotItem "Production pack"; then the stage is marked posted, every pack's posted qty
//     is set to its pack qty, pack type / contract values refreshed from PM and missing JsValue rows added
//   * post new material: PM material (not labor) of fully-posted packs minus what was already scheduled (JsPackMaterialTemp)
//     or posted (JcLotItem) at that stage → JsPackMaterialTemp "Material pack added late to PM"
//   * change payroll dates: in-process piece (PrTempPayroll) / hourly (PrTempPayrollHourly) entries of one division
//   * load vendor prices: stops when any row's item id + item number do not match IcItem; otherwise updates the vendor's
//     existing vendor items and appends the rest (LastPrice 0). The Access import table (IcPriceLoad) is replaced by rows
//     pasted in the browser.
//   * "Transfer lot data" is not finished in Access ("This feature is not finished yet.") and is not offered.
const express = require('express');
const { query, withTransaction, nextId } = require('../db');
const { h } = require('../crud');

const router = express.Router();
const int = (v) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) && !isNaN(new Date(String(v).slice(0, 10))) ? String(v).slice(0, 10) : null);
const bit = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === -1 ? 1 : 0);
const str = (v, max) => { if (v == null) return null; const s = String(v).trim(); if (!s) return null; if (max && s.length > max) throw bad(`Text is too long (max ${max} characters)`); return s };
const user = (req) => req.user?.username || 'web';
const TODAY = 'CAST(CAST(GETDATE() AS date) AS datetime)';
const need = (v, msg) => { if (v == null || v === '') throw bad(msg); return v };

// ---------------------------------------------------------------------------
// Column types, read once per table from INFORMATION_SCHEMA (only for allow-listed tables)
// ---------------------------------------------------------------------------
const schemaCache = new Map();
async function columnsOf(table) {
  if (!schemaCache.has(table)) {
    const rows = await query('SELECT COLUMN_NAME AS name, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS max FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t', { t: table });
    schemaCache.set(table, Object.fromEntries(rows.map((r) => [r.name, r])));
  }
  return schemaCache.get(table);
}
/** Convert a request value to the column's SQL type; throws a 400 with the column label on bad input. */
function coerce(v, col, label) {
  if (!col) throw bad(`Unknown column ${label}`);
  if (v === '' || v == null) return null;
  switch (col.type) {
    case 'int': case 'bigint': case 'smallint': case 'tinyint': {
      const n = Number(v); if (!Number.isInteger(n)) throw bad(`${label} must be a whole number`); return n;
    }
    case 'decimal': case 'numeric': case 'float': case 'real': case 'money': {
      const n = Number(String(v).replace(/[$,\s]/g, '')); if (isNaN(n)) throw bad(`${label} must be a number`); return n;
    }
    case 'bit': return bit(v);
    case 'datetime': case 'date': case 'datetime2': case 'smalldatetime': {
      const d = isoDate(v); if (!d) throw bad(`${label} must be a date`); return d;
    }
    default: return str(v, col.max > 0 ? col.max : 4000);
  }
}


// ---------------------------------------------------------------------------
// Lookup lists (SwitchDM "Lists" tab). Fixed allow-list: table, key column, editable columns.
//   cols: [column, label, { ref: <list key for a drop-down>, req: required }]   name: the unique, required display column
//   text: the key is typed by the user (not MAX+1)   refs: [table, column] pairs checked before a delete
// ---------------------------------------------------------------------------
const LISTS = {
  'am-monitoring-types': { label: 'Alarm monitoring types', group: 'Alarm monitoring', table: 'LsAmMonitoringType', id: 'MonitoringTypeID', name: 'MonitoringType', cols: [['MonitoringType', 'Monitoring type']] },
  'am-contract-terms': { label: 'Alarm contract terms', group: 'Alarm monitoring', table: 'LsAmContractTerms', id: 'ContractTermsID', name: 'ContractTerms', cols: [['ContractTerms', 'Contract terms'], ['LengthMonths', 'Length (months)'], ['StatusActive', 'Active']] },
  'billing-terms': { label: 'Billing terms', group: 'Billing', table: 'LsTerms', id: 'Terms', text: true, name: 'Terms', cols: [['Terms', 'Terms'], ['Days', 'Days']] },
  'billing-types': { label: 'Billing types', group: 'Billing', table: 'LsBillingType', id: 'BillTypeID', name: 'BillType', cols: [['BillType', 'Billing type']] },
  'cities': { label: 'Cities', group: 'General', table: 'LsCity', id: 'CityID', name: 'City', unique: ['City', 'State'], cols: [['City', 'City'], ['State', 'State'], ['CoxService', 'Cox service']] },
  'companies': {
    label: 'Companies', group: 'General', table: 'LsCompany', id: 'CompanyID', name: 'Company', unique: ['Company', 'DivisionId'], refs: [['IcPo', 'ShipToId']],
    cols: [['Company', 'Company'], ['DivisionId', 'Division', { ref: 'divisions' }], ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['Zip', 'Zip'], ['Phone', 'Phone'], ['Fax', 'Fax'], ['Tax', 'Tax %'],
      ['BillAddress', 'Bill address'], ['BillCity', 'Bill city'], ['BillState', 'Bill state'], ['BillZip', 'Bill zip'], ['BillPhone', 'Bill phone'], ['BillFax', 'Bill fax'], ['StatusId', 'Active'], ['Logo', 'Logo file']],
  },
  'contract-types': { label: 'Contract types', group: 'General', table: 'LsContractType', id: 'TypeID', name: 'Type', cols: [['Type', 'Contract type']] },
  'cost-codes': { label: 'Cost codes', group: 'Inventory', table: 'LsCostCode', id: 'CostCodeId', text: true, name: 'CostCodeId', refs: [['IcItem', 'CostCodeId']], cols: [['CostCodeId', 'Code'], ['Description', 'Description'], ['IcTransacPost', 'Post inventory transaction'], ['TmMarkUp', 'T&M mark-up']] },
  'counter-reasons': { label: 'Counter material reasons', group: 'Inventory', table: 'LsCounterReason', id: 'CounterReasonID', name: 'CounterReason', cols: [['CounterReason', 'Reason']] },
  'cx-admin-specialists': { label: 'Cox admin specialists', group: 'Cox cable', table: 'LsAdminSpecCX', id: 'AdminSpecID', name: 'AdminSpec', cols: [['AdminSpec', 'Admin specialist'], ['Phone', 'Phone'], ['Fax', 'Fax'], ['Email', 'Email']] },
  'cx-items': { label: 'Cox items', group: 'Cox cable', table: 'CxItems', id: 'CxItemID', name: 'Item', cols: [['Item', 'Item'], ['Description', 'Description'], ['CxJobTypeId', 'Job type', { ref: 'cx-job-types' }], ['BillPrice', 'Bill price']] },
  'cx-job-types': { label: 'Cox job types', group: 'Cox cable', table: 'LsJobTypeCx', id: 'CxJobTypeID', name: 'JobType', refs: [['CxItems', 'CxJobTypeId']], cols: [['JobType', 'Job type'], ['Description', 'Description']] },
  'cx-project-planners': { label: 'Cox project planners', group: 'Cox cable', table: 'LsProjectPlannerCX', id: 'ProjectPlannerID', name: 'ProjPlanName', cols: [['ProjPlanName', 'Project planner'], ['ProjPlanEmail', 'Email'], ['ProjPlanPhone', 'Phone']] },
  'credit-ratings': { label: 'Credit ratings', group: 'General', table: 'LsCreditRating', id: 'CreditID', name: 'Rating', cols: [['Rating', 'Rating']] },
  'cs-appointment-times': { label: 'CS appointment times', group: 'Customer service', table: 'LsAppTime', id: 'ApptTimeID', name: 'ApptTime', cols: [['ApptTime', 'Appointment time'], ['SortOrder', 'Sort order']] },
  'cs-customer-types': { label: 'CS customer types', group: 'Customer service', table: 'LsCustomerTypeCS', id: 'CustomerTypeID', name: 'CustomerType', cols: [['CustomerType', 'Customer type']] },
  'cs-errors': { label: 'CS errors', group: 'Customer service', table: 'LsErrorCS', id: 'ErrorID', name: 'Error', unique: ['Error', 'DivisionId'], refs: [['LsErrorCategoryCS', 'ErrorId']], cols: [['Error', 'Error'], ['DivisionId', 'Division', { ref: 'divisions' }]] },
  'cs-error-categories': { label: 'CS error categories', group: 'Customer service', table: 'LsErrorCategoryCS', id: 'ErrorCatID', name: 'Category', parent: 'ErrorId', unique: ['Category', 'ErrorId'], refs: [['LsErrorDetailCS', 'ErrorCatId']], cols: [['ErrorId', 'Error', { ref: 'cs-errors', req: 1 }], ['Category', 'Category']] },
  'cs-error-details': { label: 'CS error details', group: 'Customer service', table: 'LsErrorDetailCS', id: 'ErrorDetailID', name: 'Detail', parent: 'ErrorCatId', unique: ['Detail', 'ErrorCatId'], cols: [['ErrorCatId', 'Category', { ref: 'cs-error-categories', req: 1 }], ['Detail', 'Detail'], ['AvgFixHours', 'Average fix hours']] },
  'cs-job-types': { label: 'CS job types', group: 'Customer service', table: 'LsJobTypeCS', id: 'CsJobTypeID', name: 'CsJobType', cols: [['CsJobType', 'Job type'], ['HourlyValue', 'Hourly value'], ['MaterialMarkUp', 'Material mark-up']] },
  'cs-resolutions': { label: 'CS resolutions', group: 'Customer service', table: 'LsResolutionCS', id: 'ResolutionID', name: 'Resolution', cols: [['Resolution', 'Resolution'], ['StatusId', 'Status', { ref: 'statuses' }]] },
  'cs-tech-types': { label: 'CS technician types', group: 'Customer service', table: 'LsTechTypeCS', id: 'TechTypeID', name: 'TechType', cols: [['TechType', 'Technician type']] },
  'cs-ticket-types': { label: 'CS ticket types', group: 'Customer service', table: 'LsTicketTypeCS', id: 'TicketTypeID', name: 'TicketType', cols: [['TicketType', 'Ticket type']] },
  'divisions': {
    label: 'Divisions', group: 'General', table: 'LsDivision', id: 'DivisionID', text: true, name: 'DivisionID', refs: [['JsJob', 'DivisionId'], ['PmJob', 'DivisionId'], ['PrEmployee', 'DivisionId']],
    cols: [['DivisionID', 'Division'], ['DivisionName', 'Name'], ['PackTicketExcel', 'Pack ticket Excel'], ['PackTicketEmail', 'Pack ticket email'], ['PieceToHourly', 'Piece to hourly'], ['SalesTax', 'Sales tax %']],
  },
  'inv-classes': { label: 'Inventory classes', group: 'Inventory', table: 'LsInvClass', id: 'InvClassID', name: 'InvClass', refs: [['IcItem', 'InvClassId']], cols: [['InvClass', 'Class'], ['Description', 'Description']] },
  'inv-transaction-types': { label: 'Inventory transactions', group: 'Inventory', table: 'LsInvTransacType', id: 'TransacTypeID', name: 'TransacType', cols: [['TransacType', 'Transaction type'], ['Description', 'Description'], ['TransacModifier', 'Modifier (+1 / -1)'], ['StatusId', 'Status', { ref: 'statuses' }]] },
  'job-types': { label: 'Job types', group: 'Jobs', table: 'LsJobType', id: 'JobTypeID', name: 'JobType', refs: [['JsJob', 'JobTypeId'], ['PmJob', 'JobTypeId'], ['LsPhaseType', 'JobTypeId']], cols: [['JobType', 'Job type']] },
  'jurisdictions': { label: 'Jurisdictions', group: 'Jobs', table: 'LsJurisdiction', id: 'JurisdictionID', name: 'Jurisdiction', unique: ['Jurisdiction', 'State'], cols: [['Jurisdiction', 'Jurisdiction'], ['State', 'State']] },
  'pack-types': { label: 'Pack types', group: 'Jobs', table: 'LsPackType', id: 'PackTypeID', name: 'PackType', refs: [['PmPack', 'PackTypeId'], ['JsPack', 'PackTypeId']], cols: [['PackType', 'Pack type'], ['Std', 'Standard'], ['Opt', 'Option']] },
  'phase-types': { label: 'Phase types', group: 'Jobs', table: 'LsPhaseType', id: 'PhaseTypeID', name: 'PhaseType', refs: [['JsPhase', 'PhaseTypeId']], cols: [['PhaseType', 'Phase type'], ['JobTypeId', 'Job type', { ref: 'job-types' }]] },
  'stages': { label: 'Plan management stages', group: 'Jobs', table: 'LsStage', id: 'StageID', name: 'Stage', refs: [['PmMaterial', 'StageId']], cols: [['Stage', 'Stage'], ['ScheduleStageId', 'Schedule stage', { ref: 'schedule-stages' }], ['EsDefaultPack', 'EST default pack'], ['HideStartPackLabor', 'Hide on start pack labor']] },
  'pr-hour-types': { label: 'PR hourly types', group: 'Payroll', table: 'LsHourTypePR', id: 'HourTypeID', name: 'HourType', cols: [['HourType', 'Hour type'], ['HourlyRateMultiplier', 'Rate multiplier']] },
  'pr-pay-types': { label: 'PR pay types', group: 'Payroll', table: 'LsPayTypePr', id: 'PayTypeID', name: 'PayType', refs: [['PrEmployee', 'PayTypeId']], cols: [['PayType', 'Pay type'], ['Piece', 'Piece'], ['Reimburse', 'Reimburse']] },
  'schedule-stages': { label: 'Schedule stages', group: 'Jobs', table: 'LsScheduleStage', id: 'ScheduleStageID', name: 'ScheduleStage', refs: [['JsStage', 'ScheduleStageId'], ['LsStage', 'ScheduleStageId']], cols: [['ScheduleStage', 'Schedule stage'], ['ScDefaultPack', 'SC default pack']] },
  'statuses': { label: 'Status', group: 'General', table: 'LsStatus', id: 'StatusID', name: 'Status', refs: [['JsJob', 'StatusId'], ['PmJob', 'StatusId'], ['PmCustomer', 'StatusId'], ['IcItem', 'StatusId']], cols: [['Status', 'Status'], ['Active', 'Counts as open'], ['Inactive', 'Counts as closed']] },
  'superintendents': { label: 'Superintendents', group: 'Jobs', table: 'LsSuperintendent', id: 'SuperID', name: 'SuperName', unique: ['SuperName', 'SuperType'], refs: [['JsPhase', 'SuperId1'], ['JsPhase', 'SuperId2']], cols: [['SuperName', 'Name'], ['SuperType', 'Type'], ['Active', 'Active']] },
  'tm-types': { label: 'T&M types', group: 'Time & material', table: 'LsTmType', id: 'TmTypeID', name: 'TmType', refs: [['TmPO', 'TmTypeId']], cols: [['TmType', 'T&M type'], ['Contracted', 'Contracted'], ['Debit', 'Debit'], ['Credit', 'Credit']] },
  'uoms': { label: 'Units of measure', group: 'Inventory', table: 'LsUom', id: 'Uom', text: true, name: 'Uom', refs: [['IcItem', 'Uom']], cols: [['Uom', 'Code'], ['UnitOfMeasure', 'Unit of measure']] },
  'update-types': { label: 'Update / lien types', group: 'Inventory', table: 'LsUpdateType', id: 'UpdateID', name: 'UpdateType', refs: [['IcItem', 'JobCostPriceUpdateId'], ['IcItem', 'EstimatingPriceUpdateId']], cols: [['UpdateType', 'Update type'], ['Active', 'Active']] },
  'vendors': {
    label: 'Vendors', group: 'Inventory', table: 'IcVendor', id: 'VendorID', name: 'Vendor', refs: [['IcItem', 'VendorId'], ['IcVendorItem', 'VendorId'], ['IcPo', 'VendorId']],
    cols: [['Vendor', 'Vendor'], ['CategoryId', 'Category', { ref: 'vendor-categories' }], ['StatusId', 'Status', { ref: 'statuses' }], ['PayTerms', 'Pay terms', { ref: 'billing-terms' }], ['FreeShipping', 'Free shipping ($)'],
      ['Address', 'Address'], ['City', 'City'], ['State', 'State'], ['Zip', 'Zip'], ['Phone', 'Phone'], ['Fax', 'Fax'],
      ['PayAs', 'Pay as'], ['PayAddress', 'Pay address'], ['PayCity', 'Pay city'], ['PayState', 'Pay state'], ['PayZip', 'Pay zip'], ['PayPhone', 'Pay phone'], ['PayFax', 'Pay fax'], ['Notes', 'Notes']],
  },
  'vendor-categories': { label: 'Vendor categories', group: 'Inventory', table: 'LsVendorCategory', id: 'CategoryID', name: 'Category', refs: [['IcVendor', 'CategoryId']], cols: [['Category', 'Category']] },
  'work-types': { label: 'Work types', group: 'Jobs', table: 'LsWork', id: 'WorkID', name: 'WorkType', refs: [['JsStage', 'WorkId'], ['PmMaterial', 'WorkId']], cols: [['WorkType', 'Work type'], ['JobCostOptional', 'Job cost optional']] },
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const listOf = (key) => { if (!has(LISTS, key)) throw bad('Unknown list', 404); return LISTS[key] };
const qn = (n) => `[${n}]`; // only ever applied to names taken from the allow-lists in this file

async function listMeta(key) {
  const l = listOf(key);
  const cols = await columnsOf(l.table);
  return {
    key, label: l.label, group: l.group, id: l.id, text: !!l.text, name: l.name, parent: l.parent || null,
    cols: l.cols.map(([name, label, o = {}]) => ({ name, label, ref: o.ref || null, req: !!o.req || name === l.name, type: cols[name]?.type || 'nvarchar', max: cols[name]?.max > 0 ? cols[name].max : null })),
  };
}
const listId = (l, v) => (l.text ? str(v, 50) : int(v));
async function refOptions(key) {
  const r = listOf(key);
  return query(`SELECT ${qn(r.id)} AS id, ${qn(r.name)} AS name${r.parent ? `, ${qn(r.parent)} AS parent` : ''} FROM ${qn(r.table)} ORDER BY ${qn(r.name)}`);
}

router.get('/lists', h(async (req, res) => {
  const keys = Object.keys(LISTS);
  const counts = await query(keys.map((k, i) => `SELECT ${i} AS i, COUNT(*) AS n FROM ${qn(LISTS[k].table)}`).join(' UNION ALL '));
  const n = Object.fromEntries(counts.map((c) => [c.i, c.n]));
  res.json([...keys.map((k, i) => ({ key: k, label: LISTS[k].label, group: LISTS[k].group, count: n[i] ?? 0 })), { key: 'logins', label: 'Login access', group: 'Security', count: null }]);
}));

router.get('/lists/:key', h(async (req, res) => {
  const l = listOf(req.params.key);
  const meta = await listMeta(req.params.key);
  const parentVal = l.parent && req.query.parent != null && req.query.parent !== '' ? int(req.query.parent) : null;
  const sel = [l.id, ...l.cols.map(([c]) => c).filter((c) => c !== l.id)].map(qn).join(', ');
  const rows = await query(`SELECT ${sel} FROM ${qn(l.table)} WHERE (@p IS NULL${l.parent ? ` OR ${qn(l.parent)} = @p` : ''}) ORDER BY ${qn(l.name)}`, { p: parentVal });
  const refs = [...new Set(meta.cols.filter((c) => c.ref).map((c) => c.ref))];
  const options = Object.fromEntries(await Promise.all(refs.map(async (k) => [k, await refOptions(k)])));
  res.json({ meta, rows, options });
}));

/** Validate a lookup row. partial = only the columns present in the body (update). */
async function listBody(l, body, partial) {
  const types = await columnsOf(l.table);
  const out = {};
  for (const [c, label, o = {}] of l.cols) {
    if (partial && !has(body, c)) continue;
    if (partial && l.text && c === l.id) continue; // the typed key is not renamed in place
    const v = coerce(body[c], types[c], label);
    if (v == null && (c === l.name || o.req || (l.text && c === l.id))) throw bad(`Enter the ${label.toLowerCase()}`);
    out[c] = v;
  }
  return out;
}
async function assertUnique(l, row, tx, exceptId) {
  const cols = l.unique || [l.name];
  if (!cols.some((c) => has(row, c))) return;
  const cur = exceptId == null ? {} : (await query(`SELECT ${cols.map(qn).join(', ')} FROM ${qn(l.table)} WHERE ${qn(l.id)} = @id`, { id: exceptId }, tx))[0] || {};
  const p = { x: exceptId };
  const where = cols.map((c, i) => { p[`u${i}`] = has(row, c) ? row[c] : cur[c]; return `((${qn(c)} IS NULL AND @u${i} IS NULL) OR ${qn(c)} = @u${i})` }).join(' AND ');
  const d = await query(`SELECT COUNT(*) AS n FROM ${qn(l.table)} WHERE ${where} AND (@x IS NULL OR ${qn(l.id)} <> @x)`, p, tx);
  if (d[0].n) throw bad(`${l.label}: this ${cols.length > 1 ? 'combination' : 'name'} already exists`, 409);
}
async function oneRow(l, id, tx) {
  const r = await query(`SELECT COUNT(*) AS n FROM ${qn(l.table)} WHERE ${qn(l.id)} = @id`, { id }, tx);
  if (!r[0].n) throw bad('Record not found', 404);
  if (r[0].n > 1) throw bad('More than one record has this id; fix the table directly before editing it here', 409);
}

router.post('/lists/:key', h(async (req, res) => {
  const l = listOf(req.params.key);
  const row = await listBody(l, req.body || {}, false);
  const types = await columnsOf(l.table);
  const id = await withTransaction(async (tx) => {
    if (l.text) {
      const d = await query(`SELECT COUNT(*) AS n FROM ${qn(l.table)} WHERE ${qn(l.id)} = @id`, { id: row[l.id] }, tx);
      if (d[0].n) throw bad(`${l.label}: this code already exists`, 409);
    } else {
      await assertUnique(l, row, tx, null);
      row[l.id] = await nextId(tx, l.table, l.id);
    }
    if (l.text) await assertUnique(l, row, tx, null);
    if (types.DateEntered) row.DateEntered = new Date();
    if (types.UserEntered) row.UserEntered = user(req);
    const cols = Object.keys(row);
    const p = {}; cols.forEach((c, i) => (p[`v${i}`] = row[c]));
    await query(`INSERT INTO ${qn(l.table)} (${cols.map(qn).join(', ')}) VALUES (${cols.map((_, i) => `@v${i}`).join(', ')})`, p, tx);
    return row[l.id];
  });
  res.status(201).json({ id });
}));

router.put('/lists/:key/:id', h(async (req, res) => {
  const l = listOf(req.params.key);
  const id = listId(l, req.params.id);
  if (id == null) throw bad('Record not found', 404);
  const row = await listBody(l, req.body || {}, true);
  const cols = Object.keys(row);
  if (!cols.length) return res.json({ ok: true });
  await withTransaction(async (tx) => {
    await oneRow(l, id, tx);
    await assertUnique(l, row, tx, id);
    const p = { id }; cols.forEach((c, i) => (p[`v${i}`] = row[c]));
    await query(`UPDATE ${qn(l.table)} SET ${cols.map((c, i) => `${qn(c)} = @v${i}`).join(', ')} WHERE ${qn(l.id)} = @id`, p, tx);
  });
  res.json({ ok: true });
}));

router.delete('/lists/:key/:id', h(async (req, res) => {
  const l = listOf(req.params.key);
  const id = listId(l, req.params.id);
  if (id == null) throw bad('Record not found', 404);
  await withTransaction(async (tx) => {
    await oneRow(l, id, tx);
    for (const [t, c] of l.refs || []) {
      const u = await query(`SELECT COUNT(*) AS n FROM ${qn(t)} WHERE ${qn(c)} = @id`, { id }, tx);
      if (u[0].n) throw bad(`Cannot delete: ${u[0].n} record(s) in ${t} use it. Mark it inactive or change those records first.`, 409);
    }
    await query(`DELETE FROM ${qn(l.table)} WHERE ${qn(l.id)} = @id`, { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Login access (Access form LoginUsers). The Password column is never read back.
// ---------------------------------------------------------------------------
// LoginUsers column -> module code (same map as server/src/auth.js; fixed allow-list)
const MODULE_COLUMNS = {
  AM: ['AlarmMonitoringAM', 'Alarm monitoring'], AR: ['BillingAR', 'Billing (AR)'], CM: ['ContractsCM', 'Contracts'], CS: ['CustomerServiceCS', 'Customer service'],
  CX: ['CoxCableCX', 'Cox cable'], DM: ['MaintenanceDM', 'Database maintenance'], ES: ['EstimatingES', 'Estimating'], FM: ['ForemanFM', 'Foreman'],
  IC: ['InventoryIC', 'Inventory'], JS: ['JobSetupJS', 'Job setup'], MG: ['ManagementMG', 'Management'], PM: ['PlanManagementPM', 'Plan management'],
  PO: ['PurchasingPO', 'Purchasing'], PR: ['PayrollPR', 'Payroll'], SA: ['SalesSA', 'Sales'], SC: ['SchedulingSC', 'Scheduling'],
  SP: ['SchedulingPanelSP', 'Scheduling panel'], TM: ['TimeMaterialTM', 'Time & material'],
};
const LOGIN_SELECT = `Username, Active, ${Object.values(MODULE_COLUMNS).map(([c]) => qn(c)).join(', ')}, DateEntered, UserEntered,
  CAST(CASE WHEN ISNULL(Password,'') = '' THEN 0 ELSE 1 END AS bit) AS HasPassword`;
function shapeLogin(r) {
  const modules = Object.fromEntries(Object.entries(MODULE_COLUMNS).map(([code, [c]]) => [code, !!r[c]]));
  return { Username: r.Username, Active: !!r.Active, HasPassword: !!r.HasPassword, DateEntered: r.DateEntered, UserEntered: r.UserEntered, modules };
}
const sameUser = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
function newPassword(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw bad('The password must be text');
  if (v.length < 4) throw bad('The password must be at least 4 characters');
  if (v.length > 50) throw bad('The password can be at most 50 characters');
  return v;
}
function moduleFlags(m) {
  const out = {};
  if (m == null) return out;
  if (typeof m !== 'object' || Array.isArray(m)) throw bad('modules must be an object of module code → true/false');
  for (const [code, v] of Object.entries(m)) {
    if (!has(MODULE_COLUMNS, code)) throw bad(`Unknown module ${code}`);
    out[MODULE_COLUMNS[code][0]] = bit(v);
  }
  return out;
}

router.get('/logins', h(async (req, res) => {
  const rows = await query(`SELECT ${LOGIN_SELECT}, COUNT(*) OVER (PARTITION BY Username) AS Dupes FROM LoginUsers ORDER BY Username`);
  res.json({
    modules: Object.entries(MODULE_COLUMNS).map(([code, [, label]]) => ({ code, label })),
    me: req.user?.username || null,
    rows: rows.map((r) => ({ ...shapeLogin(r), duplicate: r.Dupes > 1 })),
  });
}));
router.get('/logins/:username', h(async (req, res) => {
  const rows = await query(`SELECT ${LOGIN_SELECT} FROM LoginUsers WHERE Username = @u`, { u: str(req.params.username, 50) });
  if (!rows[0]) return res.status(404).json({ error: 'Login not found' });
  res.json({ ...shapeLogin(rows[0]), duplicate: rows.length > 1 });
}));
router.post('/logins', h(async (req, res) => {
  const b = req.body || {};
  const username = str(b.Username, 50);
  if (!username) throw bad('Enter the user name');
  if (/\s/.test(username)) throw bad('The user name cannot contain spaces');
  const pw = newPassword(b.newPassword);
  if (!pw) throw bad('Enter a password for the new login');
  const flags = moduleFlags(b.modules);
  await withTransaction(async (tx) => {
    const d = await query('SELECT COUNT(*) AS n FROM LoginUsers WITH (UPDLOCK, HOLDLOCK) WHERE Username = @u', { u: username }, tx);
    if (d[0].n) throw bad('A login with this user name already exists', 409);
    const cols = ['Username', 'Password', 'Active', ...Object.keys(flags), 'DateEntered', 'UserEntered'];
    const vals = [username, pw, b.Active === undefined ? 1 : bit(b.Active), ...Object.values(flags), new Date(), user(req)];
    const p = {}; vals.forEach((v, i) => (p[`v${i}`] = v));
    await query(`INSERT INTO LoginUsers (${cols.map(qn).join(', ')}) VALUES (${cols.map((_, i) => `@v${i}`).join(', ')})`, p, tx);
  });
  res.status(201).json({ username });
}));
router.put('/logins/:username', h(async (req, res) => {
  const b = req.body || {};
  const username = str(req.params.username, 50);
  const set = moduleFlags(b.modules);
  if (has(b, 'Active')) set.Active = bit(b.Active);
  const pw = newPassword(b.newPassword);
  if (pw) set.Password = pw;
  if (sameUser(username, req.user?.username)) {
    if (set.Active === 0) throw bad('You cannot deactivate your own login');
    if (set.MaintenanceDM === 0) throw bad('You cannot remove Database maintenance from your own login');
  }
  const cols = Object.keys(set);
  if (!cols.length) return res.json({ ok: true });
  await withTransaction(async (tx) => {
    const d = await query('SELECT COUNT(*) AS n FROM LoginUsers WITH (UPDLOCK, HOLDLOCK) WHERE Username = @u', { u: username }, tx);
    if (!d[0].n) throw bad('Login not found', 404);
    if (d[0].n > 1) throw bad('More than one login has this user name; remove the duplicate in the database first', 409);
    const p = { u: username }; cols.forEach((c, i) => (p[`v${i}`] = set[c]));
    await query(`UPDATE LoginUsers SET ${cols.map((c, i) => `${qn(c)} = @v${i}`).join(', ')} WHERE Username = @u`, p, tx);
  });
  res.json({ ok: true });
}));
router.delete('/logins/:username', h(async (req, res) => {
  const username = str(req.params.username, 50);
  if (sameUser(username, req.user?.username)) throw bad('You cannot delete your own login');
  await withTransaction(async (tx) => {
    const d = await query('SELECT COUNT(*) AS n FROM LoginUsers WITH (UPDLOCK, HOLDLOCK) WHERE Username = @u', { u: username }, tx);
    if (!d[0].n) throw bad('Login not found', 404);
    if (d[0].n > 1) throw bad('More than one login has this user name; remove the duplicate in the database first', 409);
    await query('DELETE FROM LoginUsers WHERE Username = @u', { u: username }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Functions tab: switchboard filter lists
// ---------------------------------------------------------------------------
router.get('/pick/customers', h(async (req, res) => {
  res.json([{ id: 0, name: '1-All customers' }, ...await query('SELECT CustID AS id, CustName AS name FROM JsCustomer ORDER BY CustName')]);
}));
router.get('/pick/jobs', h(async (req, res) => {
  const c = int(req.query.customerId) || 0;
  res.json(await query(`SELECT j.JobId AS id, j.JobName AS name, j.JobNum, j.DivisionId, c.CustName FROM JsJob j JOIN JsCustomer c ON c.CustID = j.CustId
     WHERE (@c = 0 AND j.CustId > 0) OR j.CustId = @c ORDER BY j.JobName, j.DivisionId`, { c }));
}));
router.get('/pick/lots', h(async (req, res) => {
  const j = int(req.query.jobId);
  res.json(j == null ? [] : await query(`SELECT l.LotID AS id, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS name, ph.Phase, l.StartDate, l.EndDate
     FROM JsLot l JOIN JsPhase ph ON ph.PhaseID = l.PhaseId WHERE l.JobId = @j ORDER BY ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'')`, { j }));
}));
router.get('/pick/lookups', h(async (req, res) => {
  const [scheduleStages, vendors, divisions, employees, tm] = await Promise.all([
    query('SELECT ScheduleStageID AS id, ScheduleStage AS name FROM LsScheduleStage ORDER BY ScheduleStage'),
    query('SELECT VendorID AS id, Vendor AS name FROM IcVendor ORDER BY Vendor'),
    query('SELECT DivisionID AS id, DivisionName AS name FROM LsDivision ORDER BY DivisionID'),
    query(`SELECT EmployeeID AS id, ISNULL(FName,'') + CASE WHEN MInitial IS NULL THEN ' ' + ISNULL(LName,'') ELSE ' ' + MInitial + ' ' + ISNULL(LName,'') END AS name,
                  EmployeeNum, DivisionId, DateTermination FROM PrEmployee ORDER BY 2`),
    query('SELECT TOP 500 TmID AS id, TmDate FROM TmPO ORDER BY TmID DESC'),
  ]);
  res.json({ scheduleStages, vendors, divisions, employees, tm });
}));

// ---------------------------------------------------------------------------
// Price updates (macro IcUpdatePrices; query qryAsItemPriceUpdate)
// ---------------------------------------------------------------------------
router.post('/actions/update-item-prices', h(async (req, res) => {
  const out = await withTransaction(async (tx) => {
    const jc = await query(`UPDATE IcItem SET JobCostPrice = CASE WHEN CostCodeId = 'L' THEN LaborCost ELSE AverageCost END WHERE JobCostPriceUpdateId IN (1, 2); SELECT @@ROWCOUNT AS n`, {}, tx);
    const es = await query('UPDATE IcItem SET EstimatingPrice = JobCostPrice * ((EstimatingPriceMkUp / 100.0) + 1) WHERE EstimatingPriceUpdateId IN (1, 2); SELECT @@ROWCOUNT AS n', {}, tx);
    const pb = await query(`UPDATE IcItem SET VipPrice = JobCostPrice * ((VipPriceMkUp / 100.0) + 1), ResidentialPoPrice = JobCostPrice * ((ResidentialPoPriceMkUp / 100.0) + 1),
                                  RetailPrice = JobCostPrice * ((RetailPriceMkUp / 100.0) + 1); SELECT @@ROWCOUNT AS n`, {}, tx);
    return { jobCost: jc[0].n, estimating: es[0].n, priceBook: pb[0].n };
  });
  // EsLowEstimatingPrice follows in Access: active items whose estimating price is below last, average or labor cost
  const low = await query(`SELECT i.InvItemID, c.InvClass, i.InvItem, i.LastCost, i.AverageCost, i.LaborCost, i.EstimatingPrice, i.EstimatingPriceMkUp, i.LastPurchase, i.CostCodeId
       FROM IcItem i JOIN LsInvClass c ON i.InvClassId = c.InvClassID
      WHERE i.StatusId = 1 AND (i.EstimatingPrice < i.LastCost OR i.EstimatingPrice < i.AverageCost OR i.EstimatingPrice < i.LaborCost) ORDER BY c.InvClass, i.InvItem`);
  res.json({ ...out, low });
}));
router.post('/actions/update-assembly-prices', h(async (req, res) => {
  const r = await query(`UPDATE am SET am.EstimatingPrice = CASE WHEN i.CostCodeId = 'L' THEN i.LaborCost ELSE i.EstimatingPrice END
     FROM AsMaterial am JOIN IcItem i ON i.InvItemID = am.InvItemId; SELECT @@ROWCOUNT AS n`);
  res.json({ updated: r[0].n });
}));

// ---------------------------------------------------------------------------
// Posting fixes for one lot + schedule stage
// ---------------------------------------------------------------------------
async function lotRow(lotId, tx) {
  const l = (await query('SELECT LotID, EndDate FROM JsLot WHERE LotID = @l', { l: lotId }, tx))[0];
  if (!l) throw bad('Lot not found', 404);
  return l;
}
const lotAndStage = (b) => ({ lotId: need(int(b.lotId), 'Select lot'), ss: need(int(b.scheduleStageId), 'Select the schedule stage') });

// IcPostPackMaterialOnly
router.post('/actions/post-material-only', h(async (req, res) => {
  const { lotId, ss } = lotAndStage(req.body || {});
  const out = await withTransaction(async (tx) => {
    await lotRow(lotId, tx);
    const p = { l: lotId, ss, u: user(req) };
    const base = await nextId(tx, 'JcLotItem', 'JcItemID');
    const jc = await query(`WITH m01 AS (
          SELECT l.LotID, js.ScheduleStageId, js.WorkId, m.InvItemId, p.PackQty * pk.Quantity * m.Quantity AS MatExtQty, l.SubsId, m.NoChange
            FROM JsLot l JOIN JsPack p ON l.LotID = p.LotId JOIN JsStage js ON l.LotID = js.LotId JOIN PmPack pk ON p.PmPackId = pk.PmPackID
            JOIN PmMaterial m ON js.WorkId = m.WorkId AND pk.PmPackID = m.PmPackId JOIN LsStage sg ON js.ScheduleStageId = sg.ScheduleStageId AND m.StageId = sg.StageID
           WHERE l.LotID = @l AND js.ScheduleStageId = @ss AND m.StatusId = 1 AND pk.StatusId = 1),
        m02 AS (
          SELECT m01.LotID, m01.ScheduleStageId, m01.WorkId,
                 CASE WHEN si.FromInvItem IS NULL THEN m01.InvItemId WHEN m01.NoChange = 1 THEN m01.InvItemId ELSE si.ToInvItem END AS FinalItemId,
                 SUM(m01.MatExtQty) AS Qty, m01.NoChange
            FROM m01 LEFT JOIN LsSubstitutionItem si ON si.SubsId = m01.SubsId AND si.FromInvItem = m01.InvItemId
           GROUP BY m01.LotID, m01.ScheduleStageId, m01.WorkId, CASE WHEN si.FromInvItem IS NULL THEN m01.InvItemId WHEN m01.NoChange = 1 THEN m01.InvItemId ELSE si.ToInvItem END, m01.NoChange)
      INSERT INTO JcLotItem (JcItemID, LotId, PackId, WorkId, ScheduleStageId, InvItemId, CostCodeId, ExtItemQty, JobCostPrice, Notes, DateEntered, UserEntered)
      SELECT @base + ROW_NUMBER() OVER (ORDER BY m02.WorkId, i.InvItemID) - 1, m02.LotID, 0, m02.WorkId, m02.ScheduleStageId, i.InvItemID, i.CostCodeId, m02.Qty, i.JobCostPrice, 'Production pack', GETDATE(), @u
        FROM m02 JOIN IcItem i ON i.InvItemID = m02.FinalItemId WHERE i.CostCodeId = 'M' AND m02.Qty <> 0;
      SELECT @@ROWCOUNT AS n`, { ...p, base }, tx);
    const st = await query(`UPDATE JsStage SET DatePosted = ${TODAY}, UserPosted = @u WHERE LotId = @l AND ScheduleStageId = @ss; SELECT @@ROWCOUNT AS n`, p, tx);
    const pk = await query('UPDATE JsPack SET PostedQty = PostedQty + (PackQty - PostedQty) WHERE LotId = @l; SELECT @@ROWCOUNT AS n', p, tx);
    await query(`UPDATE p SET p.PackTypeId = pk.PackTypeId FROM JsPack p JOIN PmPack pk ON p.PmPackId = pk.PmPackID
                  WHERE p.LotId = @l AND (p.PackTypeId <> pk.PackTypeId OR p.PackTypeId IS NULL OR pk.PackTypeId IS NULL)`, p, tx);
    await query(`UPDATE l SET l.Contract = pl.ContractVal FROM JsLot l JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID
                  WHERE l.LotID = @l AND EXISTS (SELECT 1 FROM JsPack p JOIN PmPack pk ON p.PmPackId = pk.PmPackID WHERE p.LotId = l.LotID);
                 UPDATE p SET p.ContractEa = pk.ContractVal FROM JsPack p JOIN PmPack pk ON p.PmPackId = pk.PmPackID JOIN JsLot l ON l.LotID = p.LotId JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
                  WHERE p.LotId = @l`, p, tx);
    const vbase = await nextId(tx, 'JsValue', 'JsValueID');
    const jv = await query(`INSERT INTO JsValue (JsValueID, PackId, WorkId, ScheduleStageId, Contract, UserEntered)
      SELECT @vb + ROW_NUMBER() OVER (ORDER BY p.PackID, v.PmValueID) - 1, p.PackID, v.WorkId, v.ScheduleStageId, v.Value, @u
        FROM JsPack p JOIN PmPack pk ON p.PmPackId = pk.PmPackID JOIN PmValue v ON v.PmPackId = pk.PmPackID
       WHERE p.LotId = @l AND NOT EXISTS (SELECT 1 FROM JsValue x WHERE x.PackId = p.PackID);
      SELECT @@ROWCOUNT AS n`, { ...p, vb: vbase }, tx);
    return { jobCostLines: jc[0].n, stagesPosted: st[0].n, packsUpdated: pk[0].n, valuesAdded: jv[0].n };
  });
  res.json(out);
}));

// PackMaterialNewLot
router.post('/actions/post-new-material', h(async (req, res) => {
  const { lotId, ss } = lotAndStage(req.body || {});
  const out = await withTransaction(async (tx) => {
    await lotRow(lotId, tx);
    const base = await nextId(tx, 'JsPackMaterialTemp', 'PackMatTempID');
    const r = await query(`WITH sel AS (
          SELECT p.LotId, m.InvItemId, js.ScheduleStageId, m.WorkId, SUM(p.PackQty * pk.Quantity * m.Quantity) AS ExtQty, MAX(m.UnitCost) AS UnitCost, i.CostCodeId
            FROM JsPack p JOIN PmPack pk ON p.PmPackId = pk.PmPackID JOIN PmMaterial m ON pk.PmPackID = m.PmPackId JOIN IcItem i ON m.InvItemId = i.InvItemID
            JOIN LsStage sg ON m.StageId = sg.StageID JOIN JsStage js ON m.WorkId = js.WorkId AND sg.ScheduleStageId = js.ScheduleStageId AND p.LotId = js.LotId
           WHERE m.StatusId = 1 AND p.PackQty = p.PostedQty
           GROUP BY p.LotId, m.InvItemId, js.ScheduleStageId, m.WorkId, i.CostCodeId
          HAVING p.LotId = @l AND js.ScheduleStageId = @ss AND i.CostCodeId <> 'L'),
        done AS (
          SELECT ScheduleStageId, WorkId, InvItemId, SUM(Qty) AS Qty FROM (
            SELECT ScheduleStageId, WorkId, InvItemId, ScheduleQty AS Qty FROM JsPackMaterialTemp WHERE LotId = @l AND ScheduleStageId = @ss
            UNION ALL SELECT ScheduleStageId, WorkId, InvItemId, ExtItemQty FROM JcLotItem WHERE LotId = @l AND ScheduleStageId = @ss) u
          GROUP BY ScheduleStageId, WorkId, InvItemId)
      INSERT INTO JsPackMaterialTemp (PackMatTempID, LotId, PackId, InvItemId, ScheduleStageId, WorkId, CostCodeId, ScheduleQty, JobCostPrice, Lot, Block, Item, PackName, DateEntered, UserEntered)
      SELECT @base + ROW_NUMBER() OVER (ORDER BY s.InvItemId, s.WorkId) - 1, s.LotId, 0, s.InvItemId, s.ScheduleStageId, s.WorkId, s.CostCodeId, s.ExtQty - ISNULL(d.Qty, 0), s.UnitCost,
             l.Lot, l.Block, i.InvItem, 'Material pack added late to PM', GETDATE(), @u
        FROM sel s LEFT JOIN done d ON d.InvItemId = s.InvItemId AND d.ScheduleStageId = s.ScheduleStageId AND d.WorkId = s.WorkId
        LEFT JOIN IcItem i ON i.InvItemID = s.InvItemId LEFT JOIN JsLot l ON l.LotID = s.LotId
       WHERE s.ExtQty - ISNULL(d.Qty, 0) <> 0;
      SELECT @@ROWCOUNT AS n`, { l: lotId, ss, base, u: user(req) }, tx);
    return { materialLines: r[0].n };
  });
  res.json(out);
}));

// IcPostUnpostedPack
router.post('/actions/post-unposted-pack', h(async (req, res) => {
  const b = req.body || {};
  const lotId = need(int(b.lotId), 'Select lot');
  const ss = need(int(b.scheduleStageId), 'Select the schedule stage');
  const out = await withTransaction(async (tx) => {
    const l = await lotRow(lotId, tx);
    if (l.EndDate) throw bad('Lot is closed. You need to open it before you can post to it.', 409);
    const date = need(isoDate(b.date), 'Enter date');
    const base = await nextId(tx, 'JcLotItem', 'JcItemID');
    const p = { l: lotId, ss, d: date, base, u: user(req) };
    const ins = await query(`INSERT INTO JcLotItem (JcItemID, LotId, PackId, WorkId, ScheduleStageId, InvItemId, CostCodeId, ExtItemQty, JobCostPrice, Notes, IcTransacPostedDate, DateEntered, UserEntered)
      SELECT @base + ROW_NUMBER() OVER (ORDER BY t.PackId, t.WorkId, t.InvItemId) - 1, t.LotId, t.PackId, t.WorkId, t.ScheduleStageId, t.InvItemId, t.CostCodeId, SUM(t.ScheduleQty), t.JobCostPrice,
             'Production pack - unposted', @d, GETDATE(), @u
        FROM JsPackMaterialTemp t JOIN IcItem i ON i.InvItemID = t.InvItemId
       GROUP BY t.LotId, t.PackId, t.WorkId, t.ScheduleStageId, t.InvItemId, t.CostCodeId, t.JobCostPrice
      HAVING t.LotId = @l AND t.ScheduleStageId = @ss AND t.CostCodeId = 'M';
      SELECT @@ROWCOUNT AS n`, p, tx);
    const del = await query("DELETE FROM JsPackMaterialTemp WHERE LotId = @l AND ScheduleStageId = @ss AND CostCodeId = 'M'; SELECT @@ROWCOUNT AS n", p, tx);
    return { jobCostLines: ins[0].n, tempLinesCleared: del[0].n };
  });
  res.json(out);
}));

// Delete lot invoices (dboArInvoiceDetailDelete + dboArInvoiceDelete)
router.post('/actions/delete-lot-invoices', h(async (req, res) => {
  const lotId = need(int((req.body || {}).lotId), 'Enter the lot you want to delete invoices for');
  const out = await withTransaction(async (tx) => {
    await lotRow(lotId, tx);
    const items = await query('DELETE bi FROM ArBillingItem bi JOIN ArBilling b ON b.BillID = bi.BillId WHERE b.LotId = @l; SELECT @@ROWCOUNT AS n', { l: lotId }, tx);
    const bills = await query('DELETE FROM ArBilling WHERE LotId = @l; SELECT @@ROWCOUNT AS n', { l: lotId }, tx);
    return { invoices: bills[0].n, items: items[0].n };
  });
  res.json(out);
}));

// Change piece / hourly payroll dates (DmPrEditDatePiece / DmPrEditDateHourly)
router.post('/actions/payroll-dates', h(async (req, res) => {
  const b = req.body || {};
  const table = { piece: 'PrTempPayroll', hourly: 'PrTempPayrollHourly' }[b.kind];
  if (!table) throw bad('Choose piece or hourly');
  const from = need(isoDate(b.fromDate), 'Enter payroll date to change');
  const to = need(isoDate(b.toDate), 'Enter payroll date to change to');
  const d = need(str(b.division, 50), 'Choose the division');
  const r = await query(`UPDATE t SET t.PayrollDate = @to FROM ${qn(table)} t JOIN JsJob j ON t.JobId = j.JobId WHERE t.PayrollDate = @from AND j.DivisionId = @d; SELECT @@ROWCOUNT AS n`, { to, from, d });
  res.json({ updated: r[0].n });
}));

// ---------------------------------------------------------------------------
// dbo* "fix" datasheets (Access OpenQuery on an updatable select). Fixed allow-list of datasets; each one edits one table.
//   by: lot = ?lotId   emp-date = ?employeeId&fromDate (payroll date)   emp-range = ?employeeId&fromDate&toDate (date entered)
// ---------------------------------------------------------------------------
const JC = ['LotId', 'PackId', 'InvItemId', 'WorkId', 'ScheduleStageId', 'CostCodeId', 'EmployeeId', 'CounterDate', 'CounterReasonId', 'ExtItemQty', 'JobCostPrice', 'PayPercent', 'Hours', 'HourlyRate', 'Notes'];
const LP = ['PayrollDate', 'EmployeeId', 'EmpName', 'JobId', 'JobName', 'Phase', 'LotId', 'Lot', 'Block', 'PlanNum', 'PlanSqFt', 'PackId', 'PmPackId', 'PackName', 'PackQty', 'PackItemId', 'InvItemId', 'Item',
  'ExtItemQty', 'ScheduleStageId', 'WorkId', 'PriceEa', 'PayPercent', 'PayHours', 'HourlyRate', 'HourTypeId', 'Notes'];
const AUDIT = ['DateEntered', 'UserEntered'];
const FIX = {
  'job-cost': { label: 'Fix job cost entries', query: 'dboFixJobCost', by: 'lot', table: 'JcLotItem', id: 'JcItemID', edit: JC, show: AUDIT, from: 'JcLotItem t', where: 't.LotId = @lot', order: 't.JcItemID' },
  'labor-temp': {
    label: 'Fix PR labor temp entries', query: 'dboFixJsLaborTemp', by: 'lot', table: 'JsPackLaborTemp', id: 'PackItemID', from: 'JsPackLaborTemp t', where: 't.LotId = @lot', order: 't.PackId, t.PmPackId, t.InvItemId, t.ScheduleStageId, t.WorkId',
    edit: ['LotId', 'PackId', 'PackQty', 'PmPackId', 'InvItemId', 'ComboLPIid', 'ScheduleStageId', 'WorkId', 'CostCodeId', 'ExtItemQty', 'PriceEa', 'PayPercent', 'PayHours', 'HourlyRate', 'Notes', 'UserSelect'], show: AUDIT,
  },
  'material-temp': {
    label: 'Fix JS material temp entries', query: 'dboFixJsMaterialTemp', by: 'lot', table: 'JsPackMaterialTemp', id: 'PackMatTempID', from: 'JsPackMaterialTemp t', where: 't.LotId = @lot', order: 't.PackMatTempID',
    edit: ['LotId', 'PackId', 'InvItemId', 'Lot', 'Block', 'PackName', 'WorkId', 'ScheduleStageId', 'CostCodeId', 'Item', 'ScheduleQty', 'ShippedQty', 'JobCostPrice', 'UserSelect'], show: AUDIT,
  },
  'packs': { label: 'Fix JS pack entries', query: 'dboFixJsPack', by: 'lot', table: 'JsPack', id: 'PackID', from: 'JsPack t', where: 't.LotId = @lot', order: 't.PackID', edit: ['LotId', 'PackTypeId', 'PmPackId', 'PackQty', 'PostedQty', 'PostedLaborQty', 'ContractEa', 'RevContractEa'], show: [...AUDIT, 'DateRevised'] },
  'stages': { label: 'Fix JS stage entries', query: 'dboFixJsStage', by: 'lot', table: 'JsStage', id: 'StageAutoID', from: 'JsStage t', where: 't.LotId = @lot', order: 't.StageAutoID', edit: ['LotId', 'WorkId', 'ScheduleStageId', 'DeliveryDate', 'Notes', 'DatePosted', 'UserPosted'], show: AUDIT },
  'labor-paid': { label: 'Fix labor paid entries', query: 'dboFixLaborPaid', by: 'lot', table: 'PrLaborPaid', id: 'LaborPaidID', from: 'PrLaborPaid t', where: 't.LotId = @lot', order: 't.PackName, t.InvItemId', edit: LP, show: AUDIT },
  'labor-paid-orphan': {
    label: 'Fix labor paid orphan entries', query: 'dboFixLaborPaidOrphan', by: 'lot', table: 'PrLaborPaid', id: 'LaborPaidID', edit: LP, show: AUDIT, order: 't.PackName, t.InvItemId',
    from: 'PrLaborPaid t JOIN JsPack p ON t.PackId = p.PackID', where: 'p.LotId = @lot', note: 'Labor paid on a pack of this lot (found through the pack, whatever lot the line says)',
  },
  'ar-billing': {
    label: 'Fix AR billing', query: 'dboFixArBilling', by: 'lot', table: 'ArBillingItem', id: 'BillItemID', order: 't.PackName',
    from: 'ArBilling b JOIN ArBillingItem t ON b.BillID = t.BillId LEFT JOIN JsPack p ON p.PackID = t.PackId', where: 'b.LotId = @lot',
    extra: ['b.BillID', 'b.[Date]', 'b.CustName', 'b.JobName', 'b.LotBlock', 'b.LotId', 'p.PackTypeId AS JsPackTypeId', 'p.PmPackId AS JsPmPackId', 'p.PackQty AS JsPackQty', 'p.PostedQty AS JsPostedQty', 'p.ContractEa AS JsContractEa', 'p.RevContractEa AS JsRevContractEa'],
    edit: ['PackName', 'PackId', 'ScheduleStageId', 'WorkId', 'ComboId', 'Quantity', 'ValueEa', 'BillPercent', 'ItemTotal'], show: [],
  },
  'labor-paid-employee': { label: 'Labor paid for an employee card', query: 'dboFixLaborPaidEmployee', by: 'emp-date', table: 'PrLaborPaid', id: 'LaborPaidID', from: 'PrLaborPaid t', where: 't.PayrollDate = @from AND t.EmployeeId = @emp', order: 't.PackName, t.InvItemId', edit: LP, show: AUDIT },
  'labor-paid-employee-jc': {
    label: 'Job cost of an employee card', query: 'dboFixLaborPaidEmployeeJobCost', by: 'emp-date', table: 'JcLotItem', id: 'JcItemID', edit: [...JC, 'IcTransacPostedDate'], show: AUDIT, distinct: true, order: 't.JcItemID',
    from: `PrLaborPaid lp JOIN JcLotItem t ON lp.HourlyRate = t.HourlyRate AND lp.PayHours = t.Hours AND lp.WorkId = t.WorkId AND lp.ScheduleStageId = t.ScheduleStageId
           AND lp.InvItemId = t.InvItemId AND lp.PackId = t.PackId AND lp.LotId = t.LotId AND lp.EmployeeId = t.EmployeeId`, where: 'lp.PayrollDate = @from AND lp.EmployeeId = @emp',
  },
  'job-cost-employee': { label: 'Fix job cost employee labor', query: 'dboFixJobCostEmployee', by: 'emp-range', table: 'JcLotItem', id: 'JcItemID', from: 'JcLotItem t', edit: JC, show: AUDIT, order: 't.DateEntered, t.JcItemID',
    where: "t.CostCodeId = 'L' AND t.EmployeeId = @emp AND t.DateEntered >= @from AND t.DateEntered <= @to" },
};
const fixOf = (key) => { if (!has(FIX, key)) throw bad('Unknown data set', 404); return FIX[key] };

router.get('/fix', h(async (req, res) => {
  res.json(Object.entries(FIX).map(([key, f]) => ({ key, label: f.label, query: f.query, by: f.by, note: f.note || null })));
}));
router.get('/fix/:key', h(async (req, res) => {
  const f = fixOf(req.params.key);
  const p = {};
  if (f.by === 'lot') p.lot = need(int(req.query.lotId), 'Select the lot');
  else {
    p.emp = need(int(req.query.employeeId), 'Select the employee');
    p.from = need(isoDate(req.query.fromDate), f.by === 'emp-date' ? 'Enter the payroll date in the "Date from" box' : 'Enter the date from');
    if (f.by === 'emp-range') p.to = need(isoDate(req.query.toDate), 'Enter the date to');
  }
  const types = await columnsOf(f.table);
  const sel = [`t.${qn(f.id)} AS _id`, ...(f.extra || []), ...[...f.edit, ...f.show].map((c) => `t.${qn(c)}`)].join(', ');
  const rows = await query(`SELECT ${f.distinct ? 'DISTINCT ' : ''}TOP 2000 ${sel} FROM ${f.from} WHERE ${f.where} ORDER BY ${f.order}`, p);
  res.json({
    key: req.params.key, label: f.label, query: f.query, id: f.id, note: f.note || null,
    columns: [
      ...(f.extra || []).map((e) => ({ name: e.split(/\s+AS\s+|\./i).pop().replace(/[[\]]/g, ''), edit: false })),
      ...f.edit.map((c) => ({ name: c, edit: true, type: types[c]?.type })), ...f.show.map((c) => ({ name: c, edit: false, type: types[c]?.type })),
    ],
    rows,
  });
}));
router.put('/fix/:key/:id', h(async (req, res) => {
  const f = fixOf(req.params.key);
  const id = need(int(req.params.id), 'Record not found');
  const types = await columnsOf(f.table);
  const b = req.body || {};
  const set = {};
  for (const c of f.edit) if (has(b, c)) set[c] = coerce(b[c], types[c], c);
  const cols = Object.keys(set);
  if (!cols.length) throw bad('Nothing to change');
  const l = { table: f.table, id: f.id };
  await withTransaction(async (tx) => {
    await oneRow(l, id, tx);
    const p = { id }; cols.forEach((c, i) => (p[`v${i}`] = set[c]));
    await query(`UPDATE ${qn(f.table)} SET ${cols.map((c, i) => `${qn(c)} = @v${i}`).join(', ')} WHERE ${qn(f.id)} = @id`, p, tx);
  });
  res.json({ ok: true });
}));
router.delete('/fix/:key/:id', h(async (req, res) => {
  const f = fixOf(req.params.key);
  const id = need(int(req.params.id), 'Record not found');
  await withTransaction(async (tx) => {
    await oneRow({ table: f.table, id: f.id }, id, tx);
    await query(`DELETE FROM ${qn(f.table)} WHERE ${qn(f.id)} = @id`, { id }, tx);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Edit posted packs (form dboEditPackPostedQty: only the posted material / labor quantities are editable)
// ---------------------------------------------------------------------------
router.get('/posted-packs', h(async (req, res) => {
  const lotId = need(int(req.query.lotId), 'Select the lot');
  res.json(await query(`SELECT j.JobName, ph.Phase, l.Lot, l.Block, pl.PlanNum AS LotPlan, pl.SqFt, p.PackID, pk.PmPackID, pk.BuilderCode, pk.PackName, pt.PackType,
         p.PackQty, p.PostedQty AS MaterialPostedQty, p.PostedLaborQty AS LaborPostedQty, p.ContractEa, p.RevContractEa, l.JobId, l.PhaseId, l.LotID
       FROM JsLot l JOIN JsPhase ph ON l.PhaseId = ph.PhaseID JOIN JsJob j ON j.JobId = ph.JobId JOIN PmPlan pl ON l.PmPlanId = pl.PmPlanID
       JOIN JsPack p ON p.LotId = l.LotID LEFT JOIN PmPack pk ON p.PmPackId = pk.PmPackID LEFT JOIN LsPackType pt ON p.PackTypeId = pt.PackTypeID
      WHERE l.LotID = @l ORDER BY pk.PackName`, { l: lotId }));
}));
router.put('/posted-packs/:id', h(async (req, res) => {
  const id = need(int(req.params.id), 'Pack not found');
  const b = req.body || {};
  const set = {};
  for (const [k, c] of [['MaterialPostedQty', 'PostedQty'], ['LaborPostedQty', 'PostedLaborQty']]) {
    if (!has(b, k)) continue;
    const v = b[k] === '' || b[k] == null ? null : Number(b[k]);
    if (v != null && !Number.isInteger(v)) throw bad('Posted quantities must be whole numbers');
    set[c] = v;
  }
  const cols = Object.keys(set);
  if (!cols.length) throw bad('Nothing to change');
  const r = await query(`UPDATE JsPack SET ${cols.map((c) => `${qn(c)} = @${c}`).join(', ')} WHERE PackID = @id; SELECT @@ROWCOUNT AS n`, { ...set, id });
  if (!r[0].n) throw bad('Pack not found', 404);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Edit T&M data (form DmTmEdit, filtered on the T&M # box: only type, approval and paid date are editable)
// ---------------------------------------------------------------------------
router.get('/tm/:id', h(async (req, res) => {
  const id = need(int(req.params.id), 'Choose the T&M #');
  const [r, types] = await Promise.all([
    query(`SELECT t.TmID, t.TmDate, t.TmCustomerNum, t.TmName, t.TmNotes, t.CustomerId, c.CustName, t.JobId, j.JobName, t.LotId, ISNULL(l.Lot,'') + '/' + ISNULL(l.Block,'') AS LotBlock,
                  t.TmTypeId, t.ApprovedBy, t.ApprovedDate, t.PaidDate, t.DateEntered, t.UserEntered
             FROM TmPO t LEFT JOIN JsCustomer c ON c.CustID = t.CustomerId LEFT JOIN JsJob j ON j.JobId = t.JobId LEFT JOIN JsLot l ON l.LotID = t.LotId WHERE t.TmID = @id`, { id }),
    query('SELECT TmTypeID AS id, TmType AS name, Contracted FROM LsTmType ORDER BY TmType'),
  ]);
  if (!r[0]) return res.status(404).json({ error: 'T&M not found' });
  res.json({ tm: r[0], types });
}));
router.put('/tm/:id', h(async (req, res) => {
  const id = need(int(req.params.id), 'Choose the T&M #');
  const b = req.body || {};
  const types = await columnsOf('TmPO');
  const set = {};
  for (const [c, label] of [['TmTypeId', 'T&M type'], ['ApprovedBy', 'Approved by'], ['ApprovedDate', 'Approved date'], ['PaidDate', 'Paid date']]) if (has(b, c)) set[c] = coerce(b[c], types[c], label);
  const cols = Object.keys(set);
  if (!cols.length) throw bad('Nothing to change');
  const r = await query(`UPDATE TmPO SET ${cols.map((c) => `${qn(c)} = @${c}`).join(', ')} WHERE TmID = @id; SELECT @@ROWCOUNT AS n`, { ...set, id });
  if (!r[0].n) throw bad('T&M not found', 404);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Load vendor prices (macro IcPriceLoadVendor; impPriceLoad01Check / 03Update / 04Append). Rows come from the browser.
// ---------------------------------------------------------------------------
router.post('/actions/load-vendor-prices', h(async (req, res) => {
  const b = req.body || {};
  const vendorId = need(int(b.vendorId), 'Enter vendor name');
  const quote = need(isoDate(b.quoteDate), 'Enter quote date');
  if (!Array.isArray(b.rows) || !b.rows.length) throw bad('Paste the price rows first');
  if (b.rows.length > 5000) throw bad('Load at most 5,000 rows at a time');
  const vt = await columnsOf('IcVendorItem');
  const seen = new Set();
  const rows = [];
  b.rows.forEach((r, i) => {
    const itemId = int(r?.ItemID);
    if (itemId == null) return; // Access skips rows without an item id
    if (seen.has(itemId)) throw bad(`Row ${i + 1}: item id ${itemId} is listed twice`);
    seen.add(itemId);
    rows.push({ ItemID: itemId, ItemNum: str(r.ItemNum, 255), PartNum: coerce(r.PartNum, vt.PartNum, `Row ${i + 1} part #`), Manufacturer: coerce(r.Manufacturer, vt.Manufacturer, `Row ${i + 1} manufacturer`), Price: coerce(r.Price, vt.DefaultPrice, `Row ${i + 1} price`) });
  });
  if (!rows.length) throw bad('No row has an item id');
  const j = JSON.stringify(rows);
  const R = `OPENJSON(@j) WITH (ItemID int, ItemNum nvarchar(255), PartNum nvarchar(255), Manufacturer nvarchar(255), Price decimal(18,4))`;
  const out = await withTransaction(async (tx) => {
    if (!(await query('SELECT 1 AS x FROM IcVendor WHERE VendorID = @v', { v: vendorId }, tx))[0]) throw bad('Vendor not found', 404);
    const mism = await query(`SELECT r.ItemID, r.ItemNum FROM ${R} r LEFT JOIN IcItem i ON i.InvItemID = r.ItemID AND i.InvItem = r.ItemNum WHERE i.InvItemID IS NULL`, { j }, tx);
    if (mism.length) return { loaded: false, mismatched: mism };
    const p = { j, v: vendorId, d: quote, u: user(req) };
    const upd = await query(`UPDATE vi SET vi.PartNum = r.PartNum, vi.Manufacturer = r.Manufacturer, vi.DefaultPrice = r.Price, vi.DateQuote = @d
        FROM IcVendorItem vi JOIN ${R} r ON vi.InvItemId = r.ItemID WHERE vi.VendorId = @v; SELECT @@ROWCOUNT AS n`, p, tx);
    const base = await nextId(tx, 'IcVendorItem', 'VendItemID');
    const ins = await query(`INSERT INTO IcVendorItem (VendItemID, InvItemId, VendorId, PartNum, Manufacturer, DefaultPrice, DateQuote, LastPrice, DateEntered, UserEntered)
        SELECT @base + ROW_NUMBER() OVER (ORDER BY r.ItemID) - 1, r.ItemID, @v, r.PartNum, r.Manufacturer, r.Price, @d, 0, GETDATE(), @u
          FROM ${R} r WHERE NOT EXISTS (SELECT 1 FROM IcVendorItem vi WHERE vi.VendorId = @v AND vi.InvItemId = r.ItemID); SELECT @@ROWCOUNT AS n`, { ...p, base }, tx);
    return { loaded: true, updated: upd[0].n, added: ins[0].n };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
// Lot close date history (report DmLotEndDateHistory)
// ---------------------------------------------------------------------------
router.get('/reports/lot-close-history', h(async (req, res) => {
  res.json(await query(`SELECT c.CustName, j.JobName, l.LotID, l.Lot, l.Block, l.StartDate, l.EndDate, l.WarrantyDate, l.DateEntered, l.UserEntered,
         r.LotCloseChangeID, r.Action, r.EndDatePrevious, r.EndDateNew, r.ChangeUser, r.ChangeDate
       FROM JsLotEndDateRegistry r JOIN JsLot l ON l.LotID = r.LotId JOIN JsJob j ON l.JobId = j.JobId JOIN JsCustomer c ON c.CustID = j.CustId
      ORDER BY c.CustName, j.JobName, l.Lot, l.Block, r.ChangeDate`));
}));

module.exports = router;
