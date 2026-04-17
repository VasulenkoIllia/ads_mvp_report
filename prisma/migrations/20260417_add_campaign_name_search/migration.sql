-- Add campaignNameSearch filter to SheetManualRangeRun
ALTER TABLE "SheetManualRangeRun" ADD COLUMN IF NOT EXISTS "campaignNameSearch" TEXT NOT NULL DEFAULT '';
