/*
  010 – Fix column types in the LOCAL StaffwareSample database used by Estimating (ES).

    * EsBid.StatusId / EsPlan.StatusId / EsPack.StatusId / EsMaterial.StatusId  BIT -> INT
          (LsStatus combo on every Access form: Active, Inactive, Closed, Lawsuit)
    * AsMaterial.StatusId                                   BIT -> INT   (same LsStatus combo on AsGroupSubMaterial)
    * EsPack.Quantity                                       BIT -> INT   (Access "Qty", Standard, 0 decimals; pack quantity)
    * AsAssembly.TempSelectNum                              BIT -> INT   (Access EsSelectOptAssemblySub "Quantity")
    * EsBid.ContMatPercent / WrapPercent / Discount         BIT -> DECIMAL(18,4)  (Access "Cont mat %", "Wrap %", "Discount %", Standard 2 dp)
    * EsBid.BurdenLabor / OverheadPercent                   INT -> DECIMAL(18,4)  (Access "Burden %", "Overhead %", Standard 2 dp)
    * PmJob.EstEndDate                                      NVARCHAR -> DATETIME  (Access "Est end date", Short Date; EsCustomerSubJob)
    * CmContract (job history log notes, every column was NVARCHAR(255)):
          CmContractID / PmJobId / TypeId -> INT, EffectiveDate / DateEntered -> DATETIME,
          Executed / ContractEntry / LatestPrint -> BIT
      Each text -> typed change only runs when every existing value converts (TRY_CAST guard).

  Widening is lossless: existing 0/1 values are kept. Confirm production types with Eric before running there.
  Safe to re-run.
*/
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.EsBid ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsPlan' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.EsPlan ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsPack' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.EsPack ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsMaterial' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.EsMaterial ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AsMaterial' AND COLUMN_NAME='StatusId' AND DATA_TYPE='bit') ALTER TABLE dbo.AsMaterial ALTER COLUMN StatusId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsPack' AND COLUMN_NAME='Quantity' AND DATA_TYPE='bit') ALTER TABLE dbo.EsPack ALTER COLUMN Quantity int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AsAssembly' AND COLUMN_NAME='TempSelectNum' AND DATA_TYPE='bit') ALTER TABLE dbo.AsAssembly ALTER COLUMN TempSelectNum int NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='ContMatPercent' AND DATA_TYPE='bit') ALTER TABLE dbo.EsBid ALTER COLUMN ContMatPercent decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='WrapPercent' AND DATA_TYPE='bit') ALTER TABLE dbo.EsBid ALTER COLUMN WrapPercent decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='Discount' AND DATA_TYPE='bit') ALTER TABLE dbo.EsBid ALTER COLUMN Discount decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='BurdenLabor' AND DATA_TYPE='int') ALTER TABLE dbo.EsBid ALTER COLUMN BurdenLabor decimal(18,4) NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='EsBid' AND COLUMN_NAME='OverheadPercent' AND DATA_TYPE='int') ALTER TABLE dbo.EsBid ALTER COLUMN OverheadPercent decimal(18,4) NULL;

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PmJob' AND COLUMN_NAME='EstEndDate' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.PmJob WHERE EstEndDate IS NOT NULL AND LTRIM(EstEndDate) <> '' AND TRY_CAST(EstEndDate AS datetime) IS NULL)
BEGIN
  UPDATE dbo.PmJob SET EstEndDate = NULL WHERE LTRIM(EstEndDate) = '';
  ALTER TABLE dbo.PmJob ALTER COLUMN EstEndDate datetime NULL;
END

-- CmContract: id / foreign keys
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='CmContractID' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE CmContractID IS NOT NULL AND TRY_CAST(CmContractID AS int) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN CmContractID int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='PmJobId' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE PmJobId IS NOT NULL AND TRY_CAST(PmJobId AS int) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN PmJobId int NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='TypeId' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE TypeId IS NOT NULL AND TRY_CAST(TypeId AS int) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN TypeId int NULL;
-- CmContract: dates
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='EffectiveDate' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE EffectiveDate IS NOT NULL AND TRY_CAST(EffectiveDate AS datetime) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN EffectiveDate datetime NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='DateEntered' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE DateEntered IS NOT NULL AND TRY_CAST(DateEntered AS datetime) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN DateEntered datetime NULL;
-- CmContract: yes/no flags
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='Executed' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE Executed IS NOT NULL AND TRY_CAST(Executed AS bit) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN Executed bit NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='ContractEntry' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE ContractEntry IS NOT NULL AND TRY_CAST(ContractEntry AS bit) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN ContractEntry bit NULL;
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CmContract' AND COLUMN_NAME='LatestPrint' AND DATA_TYPE='nvarchar')
   AND NOT EXISTS (SELECT 1 FROM dbo.CmContract WHERE LatestPrint IS NOT NULL AND TRY_CAST(LatestPrint AS bit) IS NULL)
  ALTER TABLE dbo.CmContract ALTER COLUMN LatestPrint bit NULL;
PRINT '010_fix_es_column_types applied';
