/*
  004 – Fix column types in the LOCAL StaffwareSample database used by Purchasing.

    * IcPackPoItem.Quantity  BIT -> INT            (pack PO line quantity)
    * IcPackPoItem.Cost      BIT -> DECIMAL(18,4)  (pack PO line cost)
    * IcPoItemRec.PostedQty  BIT -> INT            (kept for reference; the quantity posted to stock)

  Existing 0/1 values are kept. Confirm production types with Eric before running there. Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='IcPackPoItem' AND COLUMN_NAME='Quantity' AND DATA_TYPE='bit')
  ALTER TABLE dbo.IcPackPoItem ALTER COLUMN Quantity int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='IcPackPoItem' AND COLUMN_NAME='Cost' AND DATA_TYPE='bit')
  ALTER TABLE dbo.IcPackPoItem ALTER COLUMN Cost decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='IcPoItemRec' AND COLUMN_NAME='PostedQty' AND DATA_TYPE='bit')
  ALTER TABLE dbo.IcPoItemRec ALTER COLUMN PostedQty int NULL;
PRINT '004_fix_purchasing_column_types applied';
