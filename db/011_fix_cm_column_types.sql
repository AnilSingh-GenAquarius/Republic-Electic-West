/*
  011 – Fix column types in the LOCAL StaffwareSample database used by Contract management (CM).

  The Access tables store these as AutoNumber / Long / Date; the sample import made them all nvarchar(255):
    * CmDiary.CmDiaryID, CmDiary.CmContractId              nvarchar -> int
    * CmDiary.[Date], CmDiary.DueDate, CmDiary.DateEntered  nvarchar -> datetime
    * CmContractPmLink.CmLinkPmID, CmContractId, PmContractId  nvarchar -> int

  Both tables are empty in the sample. On a database with data, values that don't convert make the ALTER fail
  (nothing is lost; fix the bad rows first). Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmDiary' AND COLUMN_NAME='CmDiaryID' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmDiary ALTER COLUMN CmDiaryID int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmDiary' AND COLUMN_NAME='CmContractId' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmDiary ALTER COLUMN CmContractId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmDiary' AND COLUMN_NAME='Date' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmDiary ALTER COLUMN [Date] datetime NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmDiary' AND COLUMN_NAME='DueDate' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmDiary ALTER COLUMN DueDate datetime NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmDiary' AND COLUMN_NAME='DateEntered' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmDiary ALTER COLUMN DateEntered datetime NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContractPmLink' AND COLUMN_NAME='CmLinkPmID' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmContractPmLink ALTER COLUMN CmLinkPmID int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContractPmLink' AND COLUMN_NAME='CmContractId' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmContractPmLink ALTER COLUMN CmContractId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContractPmLink' AND COLUMN_NAME='PmContractId' AND DATA_TYPE='nvarchar') ALTER TABLE dbo.CmContractPmLink ALTER COLUMN PmContractId int NULL;
PRINT '011_fix_cm_column_types applied';
