// Alarm Monitoring (Am): accounts, call-list contacts, zones.
const express = require('express');
const { query, withTransaction } = require('../db');
const { insertRow, updateRow, deleteRow, h, paging } = require('../crud');

const router = express.Router();

const ACCOUNT = {
  table: 'AmAccount',
  idCol: 'AccountID',
  columns: [
    'AccountNumber', 'CustomerName', 'ContractTermsId', 'MonthlyContractValue',
    'ServiceStreet', 'ServiceCity', 'ServiceState', 'ServiceZip', 'ServiceCountry',
    'MailingSameService', 'MailStreet', 'MailCity', 'MailState', 'MailZip', 'MailCountry',
    'PhoneNumber', 'Email', 'PermitNumber', 'PanelInfo', 'PanelType', 'MonitoringTypeId',
    'ActivationDate', 'RenewalDate', 'DisconnectionDate', 'CancellationReason',
    'SalesPerson', 'AccountNotes',
  ],
};
const CONTACT = {
  table: 'AmAccountContact',
  idCol: 'ContactID',
  columns: ['AccountId', 'ContactName', 'PassCode', 'PhoneNumber', 'PhoneType', 'ContactOrder'],
};
const ZONE = {
  table: 'AmAccountZone',
  idCol: 'ZoneID',
  columns: ['AccountId', 'Zone', 'ZoneDescription'],
};

/**
 * Keep the denormalised ContractTerms text in sync with ContractTermsId (the Access form did this),
 * and copy the service address into the mailing address when "mailing same as service" is ticked.
 */
async function normaliseAccount(body, tx) {
  const b = { ...body };
  if (b.ContractTermsId !== undefined) {
    const t = b.ContractTermsId
      ? await query('SELECT ContractTerms FROM LsAmContractTerms WHERE ContractTermsID=@id', { id: b.ContractTermsId }, tx)
      : [];
    b.ContractTerms = t[0]?.ContractTerms ?? null;
  }
  if (b.MailingSameService) {
    b.MailStreet = b.ServiceStreet;
    b.MailCity = b.ServiceCity;
    b.MailState = b.ServiceState;
    b.MailZip = b.ServiceZip;
    b.MailCountry = b.ServiceCountry;
  }
  return b;
}
const ACCOUNT_WRITE = { ...ACCOUNT, columns: [...ACCOUNT.columns, 'ContractTerms'] };

// ---- Lookups ----
router.get('/lookups', h(async (req, res) => {
  const [contractTerms, monitoringTypes, phoneTypes] = await Promise.all([
    query('SELECT ContractTermsID AS id, ContractTerms AS name, LengthMonths, StatusActive FROM LsAmContractTerms ORDER BY ContractTermsID'),
    query('SELECT MonitoringTypeID AS id, MonitoringType AS name FROM LsAmMonitoringType ORDER BY MonitoringTypeID'),
    query('SELECT PhoneTypeID AS id, PhoneType AS name FROM LsPhoneType ORDER BY PhoneTypeID'),
  ]);
  res.json({ contractTerms, monitoringTypes, phoneTypes });
}));

// ---- Accounts ----
// GET /accounts?search=&status=active|disconnected|all&monitoringTypeId=&page=&pageSize=&sort=
router.get('/accounts', h(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['1=1'];
  const params = { offset, pageSize };

  if (req.query.search) {
    params.s = `%${req.query.search}%`;
    where.push(`(a.CustomerName LIKE @s OR CAST(a.AccountNumber AS nvarchar(20)) LIKE @s OR a.ServiceStreet LIKE @s
      OR a.ServiceCity LIKE @s OR a.PhoneNumber LIKE @s OR a.Email LIKE @s OR a.PanelType LIKE @s)`);
  }
  if (req.query.status === 'active') where.push('a.DisconnectionDate IS NULL');
  if (req.query.status === 'disconnected') where.push('a.DisconnectionDate IS NOT NULL');
  if (req.query.monitoringTypeId) {
    params.mt = parseInt(req.query.monitoringTypeId, 10);
    where.push('a.MonitoringTypeId = @mt');
  }

  const SORTS = {
    number: 'a.AccountNumber', name: 'a.CustomerName', city: 'a.ServiceCity',
    activation: 'a.ActivationDate', renewal: 'a.RenewalDate',
  };
  const sortCol = SORTS[req.query.sort] || SORTS.number;
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const w = where.join(' AND ');

  const [rows, total] = await Promise.all([
    query(
      `SELECT a.AccountID, a.AccountNumber, a.CustomerName, a.ServiceStreet, a.ServiceCity, a.ServiceState,
              a.PhoneNumber, a.MonthlyContractValue, a.ContractTerms, a.PanelType,
              mt.MonitoringType, a.ActivationDate, a.RenewalDate, a.DisconnectionDate
         FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
        WHERE ${w}
        ORDER BY ${sortCol} ${dir}, a.AccountID
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      params
    ),
    query(`SELECT COUNT(*) AS n FROM AmAccount a WHERE ${w}`, params),
  ]);
  res.json({ rows, total: total[0].n, page, pageSize });
}));

router.get('/accounts/next-number', h(async (req, res) => {
  const r = await query('SELECT ISNULL(MAX(AccountNumber),0)+1 AS n FROM AmAccount');
  res.json({ accountNumber: r[0].n });
}));

router.get('/accounts/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [acc, contacts, zones] = await Promise.all([
    query('SELECT * FROM AmAccount WHERE AccountID=@id', { id }),
    query('SELECT * FROM AmAccountContact WHERE AccountId=@id ORDER BY TRY_CAST(ContactOrder AS int), ContactID', { id }),
    query('SELECT * FROM AmAccountZone WHERE AccountId=@id ORDER BY TRY_CAST(Zone AS int), Zone, ZoneID', { id }),
  ]);
  if (!acc[0]) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: acc[0], contacts, zones });
}));

router.post('/accounts', h(async (req, res) => {
  const b = req.body || {};
  if (!b.CustomerName) return res.status(400).json({ error: 'Customer name is required' });
  const id = await withTransaction(async (tx) => {
    if (b.AccountNumber) {
      const dup = await query('SELECT 1 AS x FROM AmAccount WHERE AccountNumber=@n', { n: b.AccountNumber }, tx);
      if (dup.length) throw Object.assign(new Error(`Account number ${b.AccountNumber} already exists`), { status: 409 });
    }
    return insertRow(ACCOUNT_WRITE, await normaliseAccount(b, tx), req.user.username, tx);
  });
  res.status(201).json({ id });
}));

router.put('/accounts/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const n = await withTransaction(async (tx) => {
    if (b.AccountNumber) {
      const dup = await query('SELECT 1 AS x FROM AmAccount WHERE AccountNumber=@n AND AccountID<>@id', { n: b.AccountNumber, id }, tx);
      if (dup.length) throw Object.assign(new Error(`Account number ${b.AccountNumber} already exists`), { status: 409 });
    }
    return updateRow(ACCOUNT_WRITE, id, await normaliseAccount(b, tx), tx);
  });
  if (!n) return res.status(404).json({ error: 'Account not found' });
  res.json({ ok: true });
}));

router.delete('/accounts/:id', h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const n = await withTransaction(async (tx) => {
    await query('DELETE FROM AmAccountContact WHERE AccountId=@id', { id }, tx);
    await query('DELETE FROM AmAccountZone WHERE AccountId=@id', { id }, tx);
    return deleteRow(ACCOUNT, id, tx);
  });
  if (!n) return res.status(404).json({ error: 'Account not found' });
  res.json({ ok: true });
}));

// ---- Contacts & zones (child rows) ----
function childRoutes(path, def) {
  router.post(`/accounts/:id/${path}`, h(async (req, res) => {
    const body = { ...req.body, AccountId: parseInt(req.params.id, 10) };
    const id = await insertRow(def, body, req.user.username);
    res.status(201).json({ id });
  }));
  router.put(`/${path}/:childId`, h(async (req, res) => {
    const { AccountId, ...body } = req.body || {}; // never move a child to another account
    const n = await updateRow(def, parseInt(req.params.childId, 10), body);
    if (!n) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  }));
  router.delete(`/${path}/:childId`, h(async (req, res) => {
    const n = await deleteRow(def, parseInt(req.params.childId, 10));
    if (!n) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  }));
}
childRoutes('contacts', CONTACT);
childRoutes('zones', ZONE);

// ---- Reports ----
// Renewals due within N days (default 60), and summary counts for the dashboard.
router.get('/reports/renewals', h(async (req, res) => {
  const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 60));
  const rows = await query(
    `SELECT AccountID, AccountNumber, CustomerName, PhoneNumber, ContractTerms, MonthlyContractValue, RenewalDate
       FROM AmAccount
      WHERE DisconnectionDate IS NULL AND RenewalDate BETWEEN CAST(GETDATE() AS date) AND DATEADD(day, @d, CAST(GETDATE() AS date))
      ORDER BY RenewalDate`,
    { d: days }
  );
  res.json({ rows, days });
}));

router.get('/reports/summary', h(async (req, res) => {
  const [totals, byType] = await Promise.all([
    query(`SELECT COUNT(*) AS total,
                  SUM(CASE WHEN DisconnectionDate IS NULL THEN 1 ELSE 0 END) AS active,
                  SUM(CASE WHEN DisconnectionDate IS NOT NULL THEN 1 ELSE 0 END) AS disconnected,
                  SUM(CASE WHEN DisconnectionDate IS NULL
                           THEN TRY_CAST(REPLACE(REPLACE(MonthlyContractValue,'$',''),',','') AS money) ELSE 0 END) AS monthlyRevenue
             FROM AmAccount`),
    query(`SELECT ISNULL(mt.MonitoringType,'(none)') AS MonitoringType, COUNT(*) AS n
             FROM AmAccount a LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID=a.MonitoringTypeId
            WHERE a.DisconnectionDate IS NULL
            GROUP BY mt.MonitoringType ORDER BY n DESC`),
  ]);
  res.json({ ...totals[0], byType });
}));

// ---- Switchboard reports (Access SwitchAM report buttons) ----
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const MV = "TRY_CAST(REPLACE(REPLACE(a.MonthlyContractValue,'$',''),',','') AS money)";
const START = 'ISNULL(a.ActivationDate, a.DateEntered)'; // Access: IIf(IsNull([ActivationDate]),[DateEntered],[ActivationDate])
function dateParam(v, label) {
  if (!v) throw bad(`Enter the ${label} date`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw bad(`${label} date is not valid`);
  return String(v);
}
function range(q) {
  const from = dateParam(q.from, 'From');
  const to = dateParam(q.to, 'To');
  if (from > to) throw bad('From date must be on or before the To date');
  return { from, to };
}
// Monitoring type filter: blank / 0 = all accounts (Access cboMonitoringTypeId = 0).
const typeParam = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null };

// AmAccountsCreated (rptAmAccounts01New): new accounts by monitoring type and month, with % of total.
router.get('/reports/created', h(async (req, res) => {
  const p = { ...range(req.query), mt: typeParam(req.query.monitoringTypeId) };
  const rows = await query(
    `SELECT mt.MonitoringType, FORMAT(${START}, 'yyyy-MM') AS PeriodActive, COUNT(a.AccountID) AS NewAccounts
       FROM AmAccount a JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
      WHERE CAST(${START} AS date) BETWEEN @from AND @to AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
      GROUP BY mt.MonitoringType, FORMAT(${START}, 'yyyy-MM')
      ORDER BY mt.MonitoringType, PeriodActive`, p);
  res.json({ ...p, rows, total: rows.reduce((s, r) => s + r.NewAccounts, 0) });
}));

// AmAccountsCreatedYear (rptAmAccounts01NewYear): new accounts per year.
router.get('/reports/created-year', h(async (req, res) => {
  const p = { ...range(req.query), mt: typeParam(req.query.monitoringTypeId) };
  const rows = await query(
    `SELECT FORMAT(${START}, 'yyyy') AS PeriodActive, CASE WHEN @mt IS NULL THEN 'All accounts' ELSE MAX(mt.MonitoringType) END AS MonitorType,
            COUNT(a.AccountID) AS NewAccounts
       FROM AmAccount a JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
      WHERE CAST(${START} AS date) BETWEEN @from AND @to AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
      GROUP BY FORMAT(${START}, 'yyyy')
      ORDER BY PeriodActive`, p);
  res.json({ ...p, rows, total: rows.reduce((s, r) => s + r.NewAccounts, 0) });
}));

// AmAccountsCancelled (rptAmAccounts02Cancel): cancelled accounts by type, month and reason.
router.get('/reports/cancelled', h(async (req, res) => {
  const p = { ...range(req.query), mt: typeParam(req.query.monitoringTypeId) };
  const rows = await query(
    `SELECT mt.MonitoringType, a.CancellationReason, FORMAT(a.DisconnectionDate, 'yyyy-MM') AS PeriodCancelled, COUNT(a.AccountID) AS CancelledAccounts
       FROM AmAccount a JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
      WHERE a.DisconnectionDate IS NOT NULL AND CAST(a.DisconnectionDate AS date) BETWEEN @from AND @to AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
      GROUP BY mt.MonitoringType, a.CancellationReason, FORMAT(a.DisconnectionDate, 'yyyy-MM')
      ORDER BY mt.MonitoringType, PeriodCancelled, a.CancellationReason`, p);
  res.json({ ...p, rows, total: rows.reduce((s, r) => s + r.CancelledAccounts, 0) });
}));

const EXPIRY_COLS = `a.AccountID, a.AccountNumber, a.CustomerName, a.PhoneNumber, a.Email, a.ServiceStreet, a.ServiceCity, a.ServiceState,
  t.ContractTerms, a.MonthlyContractValue, a.ActivationDate, a.RenewalDate`;

// AmAccountsExpiring: contracts longer than one month whose term ends between From and To.
router.get('/reports/expiring', h(async (req, res) => {
  const p = range(req.query);
  const rows = await query(
    `SELECT ${EXPIRY_COLS}, DATEADD(month, t.LengthMonths, ISNULL(a.RenewalDate, a.ActivationDate)) AS FutureExpirationDate
       FROM AmAccount a JOIN LsAmContractTerms t ON t.ContractTermsID = a.ContractTermsId
      WHERE t.LengthMonths > 1 AND a.DisconnectionDate IS NULL
        AND CAST(DATEADD(month, t.LengthMonths, ISNULL(a.RenewalDate, a.ActivationDate)) AS date) BETWEEN @from AND @to
      ORDER BY FutureExpirationDate, a.AccountNumber`, p);
  res.json({ ...p, rows });
}));

// AmAccountsExpiringMonthly: active monthly / N/A contracts (no date filter in Access).
router.get('/reports/expiring-monthly', h(async (req, res) => {
  const rows = await query(
    `SELECT ${EXPIRY_COLS}
       FROM AmAccount a JOIN LsAmContractTerms t ON t.ContractTermsID = a.ContractTermsId
      WHERE t.LengthMonths = 1 AND a.DisconnectionDate IS NULL
      ORDER BY a.ActivationDate, a.AccountNumber`);
  res.json({ rows });
}));

// AmAudit form (frmAmAuditSubData): accounts by contract value range, terms, type, cancellation reason and status.
router.get('/audit', h(async (req, res) => {
  const num = (v, label) => {
    if (v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[$,]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw bad(`${label} must be a positive amount`);
    return n;
  };
  const p = {
    fromV: num(req.query.fromValue, 'From value'),
    toV: num(req.query.toValue, 'To value'),
    terms: typeParam(req.query.contractTermsId),
    mt: typeParam(req.query.monitoringTypeId),
    reason: req.query.cancellationReason ? String(req.query.cancellationReason).slice(0, 255) : null,
    status: ['active', 'cancelled'].includes(req.query.status) ? req.query.status : 'all',
  };
  if (p.fromV != null && p.toV != null && p.fromV > p.toV) throw bad('From value must be less than or equal to To value');
  const [rows, reasons] = await Promise.all([
    query(
      `SELECT a.AccountID, a.AccountNumber, a.CustomerName, t.ContractTerms, t.LengthMonths, a.MonthlyContractValue, ${MV} AS MonthlyValue,
              a.ServiceCity, a.ServiceZip, mt.MonitoringType, a.ActivationDate, a.RenewalDate, a.DisconnectionDate, a.CancellationReason
         FROM AmAccount a
         LEFT JOIN LsAmContractTerms t ON t.ContractTermsID = a.ContractTermsId
         LEFT JOIN LsAmMonitoringType mt ON mt.MonitoringTypeID = a.MonitoringTypeId
        WHERE (@fromV IS NULL OR ${MV} >= @fromV) AND (@toV IS NULL OR ${MV} <= @toV)
          AND (@terms IS NULL OR a.ContractTermsId = @terms) AND (@mt IS NULL OR a.MonitoringTypeId = @mt)
          AND (@reason IS NULL OR a.CancellationReason = @reason)
          AND (@status = 'all' OR (@status = 'active' AND a.DisconnectionDate IS NULL) OR (@status = 'cancelled' AND a.DisconnectionDate IS NOT NULL))
        ORDER BY a.AccountID`, p),
    query("SELECT DISTINCT CancellationReason AS name FROM AmAccount WHERE ISNULL(CancellationReason,'') <> '' ORDER BY CancellationReason"),
  ]);
  res.json({ rows, reasons: reasons.map((r) => r.name), total: rows.reduce((s, r) => s + (r.MonthlyValue || 0), 0) });
}));

module.exports = router;
