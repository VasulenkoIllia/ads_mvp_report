-- Partial unique index on AccountSheetConfig: only ACTIVE configs must be unique
-- per (adsAccountId, spreadsheetId, sheetName).
--
-- WHY partial (active = true) instead of a full UNIQUE constraint:
-- - Production already has deactivated orphan configs (e.g. bom.com.ua's
--   "daily campaign" config that became ineligible). A full unique would
--   reject the migration if any such duplicates exist.
-- - A user may legitimately deactivate an old config and create a new one
--   with the same destination — Prisma's @@unique can't model that intent.
-- - At the DB level, this still prevents the race condition where two
--   parallel `upsertSheetExportConfig({createNew:true})` calls both pass
--   the application-level duplicate check and both insert active rows.
--
-- Safety: PostgreSQL creates this index without locking other reads/writes
-- on the table (only takes a brief SHARE lock during creation), and a 6-row
-- table makes it instantaneous. Failure mode: if two active duplicates
-- already exist, the migration fails — but we've verified production has
-- no active duplicates (each account has at most 2 configs with different
-- sheetNames after the multi-config feature).

CREATE UNIQUE INDEX "AccountSheetConfig_active_destination_unique"
  ON "AccountSheetConfig" ("adsAccountId", "spreadsheetId", "sheetName")
  WHERE "active" = true;
