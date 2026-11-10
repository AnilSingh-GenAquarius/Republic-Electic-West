/*
  001 – Fix column types in the LOCAL StaffwareSample database that block payroll posting.

  Why: the sample export / stub script typed some columns wrongly, which silently corrupts data:
    * JcLotItem.PackId, PayPercent, Hours are BIT  -> a pack id of 638910 is stored as 1,
      a 50% pay split as 1, 7.5 hours as 1. (Every existing row already shows PackId = 0/1.)
    * PrTempPayroll.PlanNum is INT (stub guess) -> plan numbers such as '2-3610' cannot be stored.
    * PrTempPayroll.PlanSqFt is NVARCHAR (stub guess) -> should be INT like PrLaborPaid.PlanSqFt.

  Widening is lossless. Production (StaffwareSQL) types must be confirmed with Eric before
  running anything similar there — these are almost certainly sample-export artefacts.

  Safe to re-run.
*/
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JcLotItem' AND COLUMN_NAME = 'PackId' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JcLotItem ALTER COLUMN PackId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JcLotItem' AND COLUMN_NAME = 'PayPercent' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JcLotItem ALTER COLUMN PayPercent decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JcLotItem' AND COLUMN_NAME = 'Hours' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JcLotItem ALTER COLUMN Hours decimal(18,4) NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PrTempPayroll' AND COLUMN_NAME = 'PlanNum' AND DATA_TYPE = 'int')
  ALTER TABLE dbo.PrTempPayroll ALTER COLUMN PlanNum nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PrTempPayroll' AND COLUMN_NAME = 'PlanSqFt' AND DATA_TYPE = 'nvarchar')
  ALTER TABLE dbo.PrTempPayroll ALTER COLUMN PlanSqFt int NULL;

PRINT '001_fix_sample_column_types applied';
