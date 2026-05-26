-- Add campaignNameExcludeCsv to AccountSheetConfig (auto-export configs)
ALTER TABLE "AccountSheetConfig"
  ADD COLUMN "campaignNameExcludeCsv" TEXT NOT NULL DEFAULT '';

-- Add campaignNameExcludeCsv to SheetManualRangeRun (manual range exports)
ALTER TABLE "SheetManualRangeRun"
  ADD COLUMN "campaignNameExcludeCsv" TEXT NOT NULL DEFAULT '';
