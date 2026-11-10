// Shared lookups and pickers used by several modules (any logged-in user).
const express = require('express');
const { query } = require('../db');
const { h } = require('../crud');

const router = express.Router();

// Lookup lists: name -> SQL returning { id, name, ...extra }
const LOOKUPS = {
  divisions: 'SELECT DivisionID AS id, DivisionID + \' – \' + DivisionName AS name, SalesTax, PieceToHourly FROM LsDivision ORDER BY DivisionID',
  companies: 'SELECT CompanyID AS id, Company AS name, DivisionId, Tax FROM LsCompany ORDER BY Company',
  workTypes: 'SELECT WorkID AS id, WorkType AS name, JobCostOptional FROM LsWork ORDER BY WorkID',
  scheduleStages: 'SELECT ScheduleStageID AS id, ScheduleStage AS name, ScDefaultPack FROM LsScheduleStage ORDER BY ScheduleStageID',
  stages: 'SELECT StageID AS id, Stage AS name, ScheduleStageId FROM LsStage ORDER BY StageID',
  hourTypes: 'SELECT HourTypeID AS id, HourType AS name, HourlyRateMultiplier FROM LsHourTypePR ORDER BY HourTypeID',
  payTypes: 'SELECT PayTypeID AS id, PayType AS name, Piece, Reimburse FROM LsPayTypePr ORDER BY PayTypeID',
  titles: 'SELECT TitleID AS id, Title AS name FROM LsTitlePR ORDER BY Title',
  costCodes: 'SELECT CostCodeId AS id, CostCodeId + \' – \' + ISNULL(Description,\'\') AS name, IcTransacPost, TmMarkUp FROM LsCostCode ORDER BY CostCodeId',
  invClasses: 'SELECT InvClassID AS id, InvClass AS name, Description FROM LsInvClass ORDER BY InvClass',
  invTransacTypes: 'SELECT TransacTypeID AS id, TransacType AS name, Description, TransacModifier, StatusId FROM LsInvTransacType ORDER BY TransacTypeID',
  uoms: 'SELECT Uom AS id, Uom + ISNULL(\' – \' + UnitOfMeasure,\'\') AS name FROM LsUom ORDER BY Uom',
  priceLevels: 'SELECT PriceLevelID AS id, PriceLevel AS name, MarkUpValue FROM LsPriceLevel ORDER BY PriceLevelID',
  tmTypes: 'SELECT TmTypeID AS id, TmType AS name, Contracted, Debit, Credit FROM LsTmType ORDER BY TmTypeID',
  vendorCategories: 'SELECT CategoryID AS id, Category AS name FROM LsVendorCategory ORDER BY Category',
  statuses: 'SELECT StatusID AS id, Status AS name, Active, Inactive FROM LsStatus ORDER BY StatusID',
  superintendents: 'SELECT SuperID AS id, SuperName AS name, SuperType, Active FROM LsSuperintendent ORDER BY SuperName',
  terms: 'SELECT Terms AS id, Terms AS name, Days FROM LsTerms ORDER BY Days',
  counterReasons: 'SELECT CounterReasonID AS id, CounterReason AS name FROM LsCounterReason ORDER BY CounterReason',
  packTypes: 'SELECT PackTypeID AS id, PackType AS name, Std, Opt FROM LsPackType ORDER BY PackTypeID',
  customers: 'SELECT CustID AS id, CustName AS name, CustNum FROM JsCustomer ORDER BY CustName',
};

// GET /api/common/lookups?names=divisions,workTypes
router.get('/lookups', h(async (req, res) => {
  const names = String(req.query.names || '').split(',').filter((n) => LOOKUPS[n]);
  const results = await Promise.all(names.map((n) => query(LOOKUPS[n])));
  res.json(Object.fromEntries(names.map((n, i) => [n, results[i]])));
}));

// Jobs: GET /api/common/jobs?search=&openOnly=1
router.get('/jobs', h(async (req, res) => {
  const params = {};
  const where = ['1=1'];
  if (req.query.search) {
    params.s = `%${req.query.search}%`;
    where.push('(j.JobName LIKE @s OR CAST(j.JobNum AS nvarchar(20)) LIKE @s OR c.CustName LIKE @s)');
  }
  const rows = await query(
    `SELECT TOP 100 j.JobId AS id, j.JobName AS name, j.JobNum, j.DivisionId, j.CustId, c.CustName
       FROM JsJob j LEFT JOIN JsCustomer c ON c.CustID = j.CustId
      WHERE ${where.join(' AND ')} ORDER BY j.JobName`,
    params
  );
  res.json(rows);
}));

// Lots in a job: GET /api/common/jobs/:jobId/lots
router.get('/jobs/:jobId/lots', h(async (req, res) => {
  const rows = await query(
    `SELECT l.LotID AS id, l.Lot, l.Block, l.Address, l.City, ph.Phase, pl.PlanNum, pl.SqFt, l.EndDate,
            ISNULL(ph.Phase + ' / ', '') + 'Lot ' + ISNULL(l.Lot,'?') + ISNULL(' Blk ' + NULLIF(l.Block,''), '')
              + ISNULL(' – ' + l.Address, '') AS name
       FROM JsLot l
       LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      WHERE l.JobId = @j
      ORDER BY ph.Phase, TRY_CAST(l.Lot AS int), l.Lot`,
    { j: parseInt(req.params.jobId, 10) }
  );
  res.json(rows);
}));

// Packs on a lot: GET /api/common/lots/:lotId/packs
router.get('/lots/:lotId/packs', h(async (req, res) => {
  const rows = await query(
    `SELECT p.PackID AS id, ISNULL(m.PackName, 'Pack ' + CAST(p.PackID AS varchar)) AS name,
            p.PmPackId, p.PackQty, p.PostedQty, p.ContractEa, p.PackTypeId
       FROM JsPack p LEFT JOIN PmPack m ON m.PmPackID = p.PmPackId
      WHERE p.LotId = @l ORDER BY p.PackID`,
    { l: parseInt(req.params.lotId, 10) }
  );
  res.json(rows);
}));

// Full lot context (job / phase / plan) used when posting labor or creating T&M orders.
router.get('/lots/:lotId', h(async (req, res) => {
  const rows = await query(
    `SELECT l.LotID, l.JobId, j.JobName, j.JobNum, j.DivisionId, j.CustId, c.CustName, ph.Phase, l.Lot, l.Block,
            l.Address, l.City, l.State, l.Zip, pl.PlanNum, pl.SqFt AS PlanSqFt
       FROM JsLot l
       JOIN JsJob j ON j.JobId = l.JobId
       LEFT JOIN JsCustomer c ON c.CustID = j.CustId
       LEFT JOIN JsPhase ph ON ph.PhaseID = l.PhaseId
       LEFT JOIN PmPlan pl ON pl.PmPlanID = l.PmPlanId
      WHERE l.LotID = @l`,
    { l: parseInt(req.params.lotId, 10) }
  );
  if (!rows[0]) return res.status(404).json({ error: 'Lot not found' });
  res.json(rows[0]);
}));

// Employees: GET /api/common/employees?search=&active=1
router.get('/employees', h(async (req, res) => {
  const params = {};
  const where = ['1=1'];
  if (req.query.active !== '0') where.push('e.DateTermination IS NULL');
  if (req.query.search) {
    params.s = `%${req.query.search}%`;
    where.push('(e.FName LIKE @s OR e.LName LIKE @s OR e.EmployeeNum LIKE @s OR e.LName + \', \' + e.FName LIKE @s)');
  }
  const rows = await query(
    `SELECT TOP 50 e.EmployeeID AS id, e.LName + ', ' + e.FName AS name, e.EmployeeNum, e.DivisionId,
            e.PayTypeId, e.HourlyRate, e.DefaultScheduleStageId
       FROM PrEmployee e WHERE ${where.join(' AND ')} ORDER BY e.LName, e.FName`,
    params
  );
  res.json(rows);
}));

// Inventory items: GET /api/common/items?search=
router.get('/items', h(async (req, res) => {
  const params = { s: `%${req.query.search || ''}%` };
  const rows = await query(
    `SELECT TOP 50 i.InvItemID AS id, i.InvItem + ISNULL(' – ' + i.Description, '') AS name, i.InvItem, i.Description,
            i.Uom, i.CostCodeId, i.JobCostPrice, i.LastCost, i.AverageCost, i.ResidentialPoPrice, i.RetailPrice,
            i.VipPrice, i.EstimatingPrice, i.LaborCost, i.DefaultStageId, i.DefaultWorkId, i.InvClassId
       FROM IcItem i
      WHERE i.InvItem LIKE @s OR i.Description LIKE @s OR i.AlternateCode LIKE @s OR i.PartNum LIKE @s
      ORDER BY CASE WHEN i.InvItem LIKE @s THEN 0 ELSE 1 END, i.InvItem`,
    params
  );
  res.json(rows);
}));

// Vendors: GET /api/common/vendors?search=
router.get('/vendors', h(async (req, res) => {
  const rows = await query(
    `SELECT TOP 50 VendorID AS id, Vendor AS name, City, Phone FROM IcVendor
      WHERE Vendor LIKE @s ORDER BY Vendor`,
    { s: `%${req.query.search || ''}%` }
  );
  res.json(rows);
}));

module.exports = router;
