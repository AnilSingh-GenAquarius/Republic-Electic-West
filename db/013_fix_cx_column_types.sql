/*
  013 – Fix column types in the LOCAL StaffwareSample database used by Cox cable (CX).

  The sample created the Cox columns on JsLot as nvarchar(255), but the Access queries join / compare them with
  numeric ids and dates (JsLot.AssessorId = CxJobAssessor.AssessorID, JsLot.InvoiceNum = CxTempInv.InvoiceNum,
  JsLot.LaborReqNum = CxTempInv.LaborReqNum, JsLot.AdminSpecialist = LsAdminSpecCx.AdminSpecID,
  JsLot.CoxJobTypeId <> 3, JsLot.DateCoxMatReq = [tbxDate]).

    * JsLot.CoxJobTypeId       nvarchar -> int       (LsJobTypeCx id)
    * JsLot.AssessorId         nvarchar -> int       (CxJobAssessor id)
    * JsLot.AdminSpecialist    nvarchar -> int       (LsAdminSpecCx id, combo on CxReqBillInfoDetail)
    * JsLot.ProjPlanner        nvarchar -> int       (LsProjectPlannerCx id, combo on CxReqBillInfoDetail)
    * JsLot.InvoiceNum         nvarchar -> int       (CxTempInv.InvoiceNum is int)
    * JsLot.LaborReqNum        nvarchar -> int       (CxTempInv.LaborReqNum is int; the two are joined)
    * JsLot.DateCoxMatReq      nvarchar -> datetime
    * CxPlan.PlanNum           int      -> nvarchar(50)  (joined to PmPlan.PlanNum / PrLaborPaid.PlanNum, both text)
    * CxPlan.CoxElegible       nvarchar -> bit       (Yes/No, default Yes; queries test = 1 / = 0)
    * tempCxMatReqMulti.PlanNum int     -> nvarchar(50)
    * tempCxMatReqMulti.HomeRuns / LockboxPrewire / OutletPrewire / RiserPrewire, tempCxMatReqSingle.OutletPrewire
                               nvarchar -> decimal(18,4)  (sums of CxPlanMaterial.QuantityCox; the reports Sum() them)

  Each change only runs while the column still has the wrong type AND every existing value converts, so it never
  loses data. OpExAccNum, TaskNum and LaborPoNum stay text. Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;

-- JsLot ints
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='CoxJobTypeId' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE CoxJobTypeId IS NOT NULL AND TRY_CAST(CoxJobTypeId AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN CoxJobTypeId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='AssessorId' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE AssessorId IS NOT NULL AND TRY_CAST(AssessorId AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN AssessorId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='AdminSpecialist' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE AdminSpecialist IS NOT NULL AND TRY_CAST(AdminSpecialist AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN AdminSpecialist int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='ProjPlanner' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE ProjPlanner IS NOT NULL AND TRY_CAST(ProjPlanner AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN ProjPlanner int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='InvoiceNum' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE InvoiceNum IS NOT NULL AND TRY_CAST(InvoiceNum AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN InvoiceNum int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='LaborReqNum' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE LaborReqNum IS NOT NULL AND TRY_CAST(LaborReqNum AS int) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN LaborReqNum int NULL;

-- JsLot date
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsLot' AND COLUMN_NAME='DateCoxMatReq' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.JsLot WHERE DateCoxMatReq IS NOT NULL AND TRY_CAST(DateCoxMatReq AS datetime) IS NULL)
  ALTER TABLE dbo.JsLot ALTER COLUMN DateCoxMatReq datetime NULL;

-- CxPlan
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CxPlan' AND COLUMN_NAME='PlanNum' AND DATA_TYPE='int')
  ALTER TABLE dbo.CxPlan ALTER COLUMN PlanNum nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CxPlan' AND COLUMN_NAME='CoxElegible' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CxPlan WHERE CoxElegible IS NOT NULL AND CoxElegible NOT IN ('0','1','-1','True','False','Yes','No'))
BEGIN
  EXEC('UPDATE dbo.CxPlan SET CoxElegible = CASE WHEN CoxElegible IN (''1'',''-1'',''True'',''Yes'') THEN ''1'' WHEN CoxElegible IS NULL THEN NULL ELSE ''0'' END');
  ALTER TABLE dbo.CxPlan ALTER COLUMN CoxElegible bit NULL;
END

-- Material request temp tables
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqMulti' AND COLUMN_NAME='PlanNum' AND DATA_TYPE='int')
  ALTER TABLE dbo.tempCxMatReqMulti ALTER COLUMN PlanNum nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqMulti' AND COLUMN_NAME='HomeRuns' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.tempCxMatReqMulti WHERE HomeRuns IS NOT NULL AND TRY_CAST(HomeRuns AS decimal(18,4)) IS NULL)
  ALTER TABLE dbo.tempCxMatReqMulti ALTER COLUMN HomeRuns decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqMulti' AND COLUMN_NAME='LockboxPrewire' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.tempCxMatReqMulti WHERE LockboxPrewire IS NOT NULL AND TRY_CAST(LockboxPrewire AS decimal(18,4)) IS NULL)
  ALTER TABLE dbo.tempCxMatReqMulti ALTER COLUMN LockboxPrewire decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqMulti' AND COLUMN_NAME='OutletPrewire' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.tempCxMatReqMulti WHERE OutletPrewire IS NOT NULL AND TRY_CAST(OutletPrewire AS decimal(18,4)) IS NULL)
  ALTER TABLE dbo.tempCxMatReqMulti ALTER COLUMN OutletPrewire decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqMulti' AND COLUMN_NAME='RiserPrewire' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.tempCxMatReqMulti WHERE RiserPrewire IS NOT NULL AND TRY_CAST(RiserPrewire AS decimal(18,4)) IS NULL)
  ALTER TABLE dbo.tempCxMatReqMulti ALTER COLUMN RiserPrewire decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='tempCxMatReqSingle' AND COLUMN_NAME='OutletPrewire' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.tempCxMatReqSingle WHERE OutletPrewire IS NOT NULL AND TRY_CAST(OutletPrewire AS decimal(18,4)) IS NULL)
  ALTER TABLE dbo.tempCxMatReqSingle ALTER COLUMN OutletPrewire decimal(18,4) NULL;

PRINT '013_fix_cx_column_types applied';
