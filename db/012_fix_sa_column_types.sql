/*
  012 – Fix column types in the LOCAL StaffwareSample database used by Sales (SA).

    * CsProperty.SaPriorityId   NVARCHAR(255) -> INT   (Access SaProperty "Sale priority" combo is bound to
                                                        LsSaPriority.SaPriorityID, a Long)

  Only converted when every stored value is empty or a whole number, so nothing is lost
  (blank strings become NULL). Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsProperty' AND COLUMN_NAME='SaPriorityId' AND DATA_TYPE IN ('nvarchar','varchar','nchar','char'))
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.CsProperty WHERE LTRIM(RTRIM(ISNULL(SaPriorityId,''))) <> '' AND TRY_CAST(SaPriorityId AS int) IS NULL)
    PRINT '012: CsProperty.SaPriorityId has non-numeric values - left unchanged';
  ELSE
  BEGIN
    EXEC('UPDATE dbo.CsProperty SET SaPriorityId = NULL WHERE LTRIM(RTRIM(SaPriorityId)) = ''''');
    ALTER TABLE dbo.CsProperty ALTER COLUMN SaPriorityId int NULL;
  END
END
PRINT '012_fix_sa_column_types applied';
