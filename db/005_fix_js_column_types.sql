/*
  005 – Fix column types in the LOCAL StaffwareSample database used by Job setup (JS).

    * JsCustomer.StatusId  BIT           -> INT           (LsStatus has 4 values: Active, Inactive, Closed, Lawsuit; a bit holds only 0/1)
    * JsCustomer.CreditId  NVARCHAR(255) -> INT           (LsCreditRating.CreditID is an int)
    * JsJob.EndDate        NVARCHAR(255) -> DATETIME      (the Access form uses a date input; JsPhase/JsLot EndDate are datetime)

  Widening is lossless: existing StatusId 0/1 values are kept, CreditId is NULL everywhere and
  JsJob.EndDate is NULL everywhere in the sample. Non-numeric / non-date text (if any) is set to NULL
  before the conversion so the ALTER cannot fail. Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsCustomer' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit')
  ALTER TABLE dbo.JsCustomer ALTER COLUMN StatusId int NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsCustomer' AND COLUMN_NAME='CreditId' AND DATA_TYPE='nvarchar')
BEGIN
  EXEC('UPDATE dbo.JsCustomer SET CreditId = NULL WHERE CreditId IS NOT NULL AND TRY_CAST(CreditId AS int) IS NULL');
  ALTER TABLE dbo.JsCustomer ALTER COLUMN CreditId int NULL;
END

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='JsJob' AND COLUMN_NAME='EndDate' AND DATA_TYPE='nvarchar')
BEGIN
  EXEC('UPDATE dbo.JsJob SET EndDate = NULL WHERE EndDate IS NOT NULL AND TRY_CAST(EndDate AS datetime) IS NULL');
  ALTER TABLE dbo.JsJob ALTER COLUMN EndDate datetime NULL;
END

PRINT '005_fix_js_column_types applied';
