-- Drop one-to-one constraint between account and sheet config.
DROP INDEX IF EXISTS "AccountSheetConfig_adsAccountId_key";

-- Speed up account-specific config lookups and ordering.
CREATE INDEX IF NOT EXISTS "AccountSheetConfig_adsAccountId_updatedAt_idx"
  ON "AccountSheetConfig"("adsAccountId", "updatedAt");
