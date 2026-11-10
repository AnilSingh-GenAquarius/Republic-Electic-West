/*
  009 – Fix column types in the LOCAL StaffwareSample database used by Plan management (PM).

    * PmJob.StatusId                     BIT -> INT   (LsStatus has 4 values: Active, Inactive, Closed, Lawsuit)
    * PmMaterial.StatusId                BIT -> INT   (same list; the Access form uses the LsStatus combo)
    * PmMaterialChangeRegistry.StatusId  BIT -> INT   (copy of PmMaterial.StatusId)

  Widening is lossless: existing 0/1 values are kept. Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PmJob' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.PmJob ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PmMaterial' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.PmMaterial ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PmMaterialChangeRegistry' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.PmMaterialChangeRegistry ALTER COLUMN StatusId int NULL;
PRINT '009_fix_pm_column_types applied';
