/*
  008 – Fix column types in the LOCAL StaffwareSample database used by Customer service (CS).

    Appointments (CsScheduleAppt)
    * CsjobTypeId     BIT -> INT            (LsJobTypeCS ids 1..11; BIT could only hold 0/1)
    * EstimatedHours  BIT -> DECIMAL(18,2)  (Access Format=Standard, default 1, e.g. 2.5 hours)
    * RepPhone        INT -> NVARCHAR(50)   (10-digit phone numbers overflow INT above 2147483647)
    * LaborCostHour / TaxMaterial / TaxLabor / MarkUpMaterial / MarkUpOther / PaymentValue
                      NVARCHAR -> DECIMAL(18,4) (reports do arithmetic on them: Nz([LaborCostHour],0) * hours)
                      only when every existing value converts
    * PaymentDate     NVARCHAR -> DATETIME (Access Format=Short Date) only when every existing value converts
    Assemblies / materials
    * CsAssembly.SalePrice          INT -> DECIMAL(18,4)  (Format $#,##0.00)
    * CsAssemblyItem.Quantity       INT -> DECIMAL(18,4)  (Format Standard)
    * CsScheduleMaterial.Quantity   INT -> DECIMAL(18,4)  (Format Standard)
    Lists
    * LsErrorDetailCS.AvgFixHours   BIT -> DECIMAL(18,2)  ("Avg fix hours")
    * LsJobTypeCS.HourlyValue / MaterialMarkUp  INT -> DECIMAL(18,2)
    Quotes (table is empty in the sample)
    * CsQuote.ApprovedBy     BIT -> NVARCHAR(50)  (who approved)
    * CsQuote.CreditCardFee  NVARCHAR -> DECIMAL(18,4)
    * CsQuoteAssemblyItem.CostCodeId  INT -> NVARCHAR(50)  (cost codes are letters: L, M, S, E, NT, SQ — same as IcItem.CostCodeId)
    Call notes
    * CsCallNotes.FollowUp   NVARCHAR -> DATETIME (Access input mask 99/99/0000 = follow-up date) only when every value converts

  Existing values are kept (BIT 1 -> 1, INT -> same number). Confirm production types with Eric before running there. Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='CsjobTypeId' AND DATA_TYPE='bit') ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN CsjobTypeId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='EstimatedHours' AND DATA_TYPE='bit') ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN EstimatedHours decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='RepPhone' AND DATA_TYPE='int') ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN RepPhone nvarchar(50) NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='LaborCostHour' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(LaborCostHour),'') IS NOT NULL AND TRY_CAST(REPLACE(REPLACE(LaborCostHour,'$',''),',','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET LaborCostHour = NULLIF(REPLACE(REPLACE(LTRIM(LaborCostHour),'$',''),',',''),'') WHERE LaborCostHour IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN LaborCostHour decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='TaxMaterial' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(TaxMaterial),'') IS NOT NULL AND TRY_CAST(REPLACE(TaxMaterial,'%','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET TaxMaterial = NULLIF(REPLACE(LTRIM(TaxMaterial),'%',''),'') WHERE TaxMaterial IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN TaxMaterial decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='TaxLabor' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(TaxLabor),'') IS NOT NULL AND TRY_CAST(REPLACE(TaxLabor,'%','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET TaxLabor = NULLIF(REPLACE(LTRIM(TaxLabor),'%',''),'') WHERE TaxLabor IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN TaxLabor decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='MarkUpMaterial' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(MarkUpMaterial),'') IS NOT NULL AND TRY_CAST(REPLACE(MarkUpMaterial,'%','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET MarkUpMaterial = NULLIF(REPLACE(LTRIM(MarkUpMaterial),'%',''),'') WHERE MarkUpMaterial IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN MarkUpMaterial decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='MarkUpOther' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(MarkUpOther),'') IS NOT NULL AND TRY_CAST(REPLACE(MarkUpOther,'%','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET MarkUpOther = NULLIF(REPLACE(LTRIM(MarkUpOther),'%',''),'') WHERE MarkUpOther IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN MarkUpOther decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='PaymentValue' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(PaymentValue),'') IS NOT NULL AND TRY_CAST(REPLACE(REPLACE(PaymentValue,'$',''),',','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET PaymentValue = NULLIF(REPLACE(REPLACE(LTRIM(PaymentValue),'$',''),',',''),'') WHERE PaymentValue IS NOT NULL;
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN PaymentValue decimal(18,4) NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleAppt' AND COLUMN_NAME='PaymentDate' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsScheduleAppt WHERE NULLIF(LTRIM(PaymentDate),'') IS NOT NULL AND TRY_CAST(PaymentDate AS datetime) IS NULL)
BEGIN
  UPDATE dbo.CsScheduleAppt SET PaymentDate = NULL WHERE LTRIM(PaymentDate) = '';
  ALTER TABLE dbo.CsScheduleAppt ALTER COLUMN PaymentDate datetime NULL;
END

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsAssembly' AND COLUMN_NAME='SalePrice' AND DATA_TYPE='int') ALTER TABLE dbo.CsAssembly ALTER COLUMN SalePrice decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsAssemblyItem' AND COLUMN_NAME='Quantity' AND DATA_TYPE='int') ALTER TABLE dbo.CsAssemblyItem ALTER COLUMN Quantity decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsScheduleMaterial' AND COLUMN_NAME='Quantity' AND DATA_TYPE='int') ALTER TABLE dbo.CsScheduleMaterial ALTER COLUMN Quantity decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='LsErrorDetailCS' AND COLUMN_NAME='AvgFixHours' AND DATA_TYPE='bit') ALTER TABLE dbo.LsErrorDetailCS ALTER COLUMN AvgFixHours decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='LsJobTypeCS' AND COLUMN_NAME='HourlyValue' AND DATA_TYPE='int') ALTER TABLE dbo.LsJobTypeCS ALTER COLUMN HourlyValue decimal(18,2) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='LsJobTypeCS' AND COLUMN_NAME='MaterialMarkUp' AND DATA_TYPE='int') ALTER TABLE dbo.LsJobTypeCS ALTER COLUMN MaterialMarkUp decimal(18,2) NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsQuote' AND COLUMN_NAME='ApprovedBy' AND DATA_TYPE='bit') ALTER TABLE dbo.CsQuote ALTER COLUMN ApprovedBy nvarchar(50) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsQuote' AND COLUMN_NAME='CreditCardFee' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsQuote WHERE NULLIF(LTRIM(CreditCardFee),'') IS NOT NULL AND TRY_CAST(REPLACE(REPLACE(CreditCardFee,'$',''),',','') AS decimal(18,4)) IS NULL)
BEGIN
  UPDATE dbo.CsQuote SET CreditCardFee = NULLIF(REPLACE(REPLACE(LTRIM(CreditCardFee),'$',''),',',''),'') WHERE CreditCardFee IS NOT NULL;
  ALTER TABLE dbo.CsQuote ALTER COLUMN CreditCardFee decimal(18,4) NULL;
END

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsCallNotes' AND COLUMN_NAME='FollowUp' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CsCallNotes WHERE NULLIF(LTRIM(FollowUp),'') IS NOT NULL AND TRY_CAST(FollowUp AS datetime) IS NULL)
BEGIN
  UPDATE dbo.CsCallNotes SET FollowUp = NULL WHERE LTRIM(FollowUp) = '';
  ALTER TABLE dbo.CsCallNotes ALTER COLUMN FollowUp datetime NULL;
END
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CsQuoteAssemblyItem' AND COLUMN_NAME='CostCodeId' AND DATA_TYPE='int') ALTER TABLE dbo.CsQuoteAssemblyItem ALTER COLUMN CostCodeId nvarchar(50) NULL;
PRINT '008_fix_cs_column_types applied';
