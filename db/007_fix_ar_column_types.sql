/*
  007 – Fix column types in the LOCAL StaffwareSample database used by Accounts receivable (billing).

    * ArPreBillLot.DivisionId  INT -> NVARCHAR(50)   (division codes are 'REW', 'REI', 'BAY')
    * ArPreBillLot.PlanNum     INT -> NVARCHAR(50)   (plan numbers like '1-2500A')
    * ArPreBillPack.ComboId    INT -> DECIMAL(18,4)  (pack id . stage/work, same type as ArBillingItem.ComboId)
    * ArPreBillPack.Quantity / ValueEa / BillPercent / BillValue -> DECIMAL(18,4)
    * ArBilling.BillTypeId     BIT -> INT            (1 Invoice, 2 Backcharge, 3 Credit)
    * ArBillingItem.BillPercent INT -> DECIMAL(18,4) (e.g. 33.33 %)

  Existing values are kept. Confirm production types with Eric before running there. Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillLot' AND COLUMN_NAME='DivisionId' AND DATA_TYPE='int') ALTER TABLE dbo.ArPreBillLot ALTER COLUMN DivisionId nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillLot' AND COLUMN_NAME='PlanNum' AND DATA_TYPE='int') ALTER TABLE dbo.ArPreBillLot ALTER COLUMN PlanNum nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillPack' AND COLUMN_NAME='ComboId' AND DATA_TYPE='int') ALTER TABLE dbo.ArPreBillPack ALTER COLUMN ComboId decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillPack' AND COLUMN_NAME='Quantity' AND NOT (DATA_TYPE='decimal' AND NUMERIC_SCALE=4)) ALTER TABLE dbo.ArPreBillPack ALTER COLUMN Quantity decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillPack' AND COLUMN_NAME='ValueEa' AND NOT (DATA_TYPE='decimal' AND NUMERIC_SCALE=4)) ALTER TABLE dbo.ArPreBillPack ALTER COLUMN ValueEa decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillPack' AND COLUMN_NAME='BillPercent' AND NOT (DATA_TYPE='decimal' AND NUMERIC_SCALE=4)) ALTER TABLE dbo.ArPreBillPack ALTER COLUMN BillPercent decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArPreBillPack' AND COLUMN_NAME='BillValue' AND NOT (DATA_TYPE='decimal' AND NUMERIC_SCALE=4)) ALTER TABLE dbo.ArPreBillPack ALTER COLUMN BillValue decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArBilling' AND COLUMN_NAME='BillTypeId' AND DATA_TYPE='bit') ALTER TABLE dbo.ArBilling ALTER COLUMN BillTypeId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArBillingItem' AND COLUMN_NAME='BillPercent' AND DATA_TYPE='int') ALTER TABLE dbo.ArBillingItem ALTER COLUMN BillPercent decimal(18,4) NULL;
PRINT '007_fix_ar_column_types applied';
