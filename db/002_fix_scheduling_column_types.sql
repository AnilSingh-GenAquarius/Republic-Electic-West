/*
  002 – Fix column types in the LOCAL StaffwareSample database used by Scheduling / pack posting.

    * PmPack.Quantity            BIT      -> INT            (Access computes PackQty x PmPack.Quantity x PmMaterial.Quantity)
    * JsPackMaterialTemp.PackId  BIT      -> INT            (pack id of a posted material row)
    * JsPackMaterialTemp.Lot     INT      -> NVARCHAR(50)   (lot numbers like '047' / '12B')
    * JsPackLaborTemp.PayPercent BIT      -> DECIMAL(18,4)  (pay % set while processing a piece timecard)
    * JsPackLaborTemp.PayHours   BIT      -> DECIMAL(18,4)

  Widening is lossless. Confirm production types with Eric before running similar changes there.
  Safe to re-run.
*/
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PmPack' AND COLUMN_NAME = 'Quantity' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.PmPack ALTER COLUMN Quantity int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JsPackMaterialTemp' AND COLUMN_NAME = 'PackId' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JsPackMaterialTemp ALTER COLUMN PackId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JsPackMaterialTemp' AND COLUMN_NAME = 'Lot' AND DATA_TYPE = 'int')
  ALTER TABLE dbo.JsPackMaterialTemp ALTER COLUMN Lot nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JsPackLaborTemp' AND COLUMN_NAME = 'PayPercent' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JsPackLaborTemp ALTER COLUMN PayPercent decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'JsPackLaborTemp' AND COLUMN_NAME = 'PayHours' AND DATA_TYPE = 'bit')
  ALTER TABLE dbo.JsPackLaborTemp ALTER COLUMN PayHours decimal(18,4) NULL;

PRINT '002_fix_scheduling_column_types applied';
