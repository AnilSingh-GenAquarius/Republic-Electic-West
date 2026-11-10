/*
  003 – Fix column types in the LOCAL StaffwareSample database used by Time & Material.

    * TmPO.Discount           BIT -> DECIMAL(18,4)  (a discount is a fraction such as 0.10 — a bit can only hold 0/1)
    * TmPO.LaborRateFlat      BIT -> DECIMAL(18,2)  (flat labor price)
    * TmPO.LaborRate          INT -> DECIMAL(18,2)  (hourly bill rate; 150 by default)
    * TmPO.LaborHoursAdjusted INT -> DECIMAL(18,2)
    * TmPOMaterial.Quantity   INT -> DECIMAL(18,4)  (hours / part quantities can be fractional)

  Existing values are kept (0/1 become 0.0000/1.0000). Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TmPO' AND COLUMN_NAME='Discount' AND DATA_TYPE='bit')
  ALTER TABLE dbo.TmPO ALTER COLUMN Discount decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TmPO' AND COLUMN_NAME='LaborRateFlat' AND DATA_TYPE='bit')
  ALTER TABLE dbo.TmPO ALTER COLUMN LaborRateFlat decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TmPO' AND COLUMN_NAME='LaborRate' AND DATA_TYPE='int')
  ALTER TABLE dbo.TmPO ALTER COLUMN LaborRate decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TmPO' AND COLUMN_NAME='LaborHoursAdjusted' AND DATA_TYPE='int')
  ALTER TABLE dbo.TmPO ALTER COLUMN LaborHoursAdjusted decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TmPOMaterial' AND COLUMN_NAME='Quantity' AND DATA_TYPE='int')
  ALTER TABLE dbo.TmPOMaterial ALTER COLUMN Quantity decimal(18,4) NULL;

PRINT '003_fix_tm_column_types applied';
