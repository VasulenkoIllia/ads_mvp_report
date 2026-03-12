-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OAuthConnectionStatus" AS ENUM ('DISCONNECTED', 'ACTIVE', 'NEEDS_REAUTH');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('MANUAL', 'SCHEDULER');

-- CreateEnum
CREATE TYPE "IngestionAccountRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SheetWriteMode" AS ENUM ('APPEND', 'OVERWRITE', 'UPSERT');

-- CreateEnum
CREATE TYPE "SheetDataMode" AS ENUM ('CAMPAIGN', 'DAILY_TOTAL');

-- CreateEnum
CREATE TYPE "SheetColumnMode" AS ENUM ('ALL', 'MANUAL');

-- CreateEnum
CREATE TYPE "SheetRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL', 'SKIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GoogleOAuthConnection" (
    "id" TEXT NOT NULL DEFAULT 'GOOGLE',
    "status" "OAuthConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "clientId" TEXT,
    "scopesCsv" TEXT NOT NULL DEFAULT '',
    "encryptedRefreshToken" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "tokenIssuedAt" TIMESTAMP(3),
    "lastTokenRefreshAt" TIMESTAMP(3),
    "tokenWarningSentAt" TIMESTAMP(3),
    "grantedEmail" TEXT,
    "managerCustomerId" TEXT,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "redirectPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAdsSyncRun" (
    "id" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalSeen" INTEGER NOT NULL DEFAULT 0,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "reappearedCount" INTEGER NOT NULL DEFAULT 0,
    "detachedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "GoogleAdsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "descriptiveName" TEXT NOT NULL,
    "currencyCode" TEXT,
    "timeZone" TEXT,
    "googleStatus" TEXT,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "hierarchyLevel" INTEGER,
    "isInMcc" BOOLEAN NOT NULL DEFAULT true,
    "ingestionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "AdsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerSource" "TriggerSource" NOT NULL DEFAULT 'MANUAL',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalAccounts" INTEGER NOT NULL DEFAULT 0,
    "processedAccounts" INTEGER NOT NULL DEFAULT 0,
    "successAccounts" INTEGER NOT NULL DEFAULT 0,
    "failedAccounts" INTEGER NOT NULL DEFAULT 0,
    "skippedAccounts" INTEGER NOT NULL DEFAULT 0,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionAccountRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "status" "IngestionAccountRunStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "adsAccountId" TEXT NOT NULL,

    CONSTRAINT "IngestionAccountRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignDailyFact" (
    "id" TEXT NOT NULL,
    "factDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignStatus" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "ctrPercent" DOUBLE PRECISION NOT NULL,
    "averageCpc" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "conversions" DOUBLE PRECISION NOT NULL,
    "costPerConversion" DOUBLE PRECISION NOT NULL,
    "finalUrlSuffix" TEXT,
    "trackingUrlTemplate" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adsAccountId" TEXT NOT NULL,
    "sourceRunId" TEXT,

    CONSTRAINT "CampaignDailyFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSheetConfig" (
    "id" TEXT NOT NULL,
    "adsAccountId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "writeMode" "SheetWriteMode" NOT NULL DEFAULT 'UPSERT',
    "dataMode" "SheetDataMode" NOT NULL DEFAULT 'CAMPAIGN',
    "columnMode" "SheetColumnMode" NOT NULL DEFAULT 'ALL',
    "selectedColumnsCsv" TEXT NOT NULL DEFAULT '',
    "campaignStatusesCsv" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSheetConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetExportRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "status" "SheetRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerSource" "TriggerSource" NOT NULL DEFAULT 'MANUAL',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsPrepared" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "configId" TEXT NOT NULL,

    CONSTRAINT "SheetExportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetRowState" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,
    "rowIndex" INTEGER,
    "lastExportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunId" TEXT,

    CONSTRAINT "SheetRowState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetManualRangeRun" (
    "id" TEXT NOT NULL,
    "adsAccountId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "writeMode" "SheetWriteMode" NOT NULL DEFAULT 'UPSERT',
    "dataMode" "SheetDataMode" NOT NULL DEFAULT 'CAMPAIGN',
    "columnMode" "SheetColumnMode" NOT NULL DEFAULT 'ALL',
    "selectedColumnsCsv" TEXT NOT NULL DEFAULT '',
    "campaignStatusesCsv" TEXT NOT NULL DEFAULT '',
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "completedDays" INTEGER NOT NULL DEFAULT 0,
    "successDays" INTEGER NOT NULL DEFAULT 0,
    "failedDays" INTEGER NOT NULL DEFAULT 0,
    "status" "SheetRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetManualRangeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetManualRangeRunDay" (
    "id" TEXT NOT NULL,
    "manualRunId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "status" "SheetRunStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsPrepared" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetManualRangeRunDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerSettings" (
    "id" TEXT NOT NULL DEFAULT 'GLOBAL',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "ingestionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ingestionHour" INTEGER NOT NULL DEFAULT 1,
    "ingestionMinute" INTEGER NOT NULL DEFAULT 0,
    "ingestionMaxDailyAttempts" INTEGER NOT NULL DEFAULT 2,
    "ingestionRetryDelayMin" INTEGER NOT NULL DEFAULT 20,
    "ingestionBatchSize" INTEGER NOT NULL DEFAULT 100,
    "ingestionMaxAccounts" INTEGER NOT NULL DEFAULT 5000,
    "sheetsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sheetsHour" INTEGER NOT NULL DEFAULT 1,
    "sheetsMinute" INTEGER NOT NULL DEFAULT 10,
    "sheetsMaxDailyAttempts" INTEGER NOT NULL DEFAULT 2,
    "sheetsRetryDelayMin" INTEGER NOT NULL DEFAULT 20,
    "sheetsMaxConfigsPerTick" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleOAuthState_stateHash_key" ON "GoogleOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "GoogleOAuthState_expiresAt_usedAt_idx" ON "GoogleOAuthState"("expiresAt", "usedAt");

-- CreateIndex
CREATE INDEX "GoogleAdsSyncRun_startedAt_status_idx" ON "GoogleAdsSyncRun"("startedAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdsAccount_customerId_key" ON "AdsAccount"("customerId");

-- CreateIndex
CREATE INDEX "AdsAccount_isInMcc_ingestionEnabled_googleStatus_idx" ON "AdsAccount"("isInMcc", "ingestionEnabled", "googleStatus");

-- CreateIndex
CREATE INDEX "IngestionRun_runDate_triggerSource_status_startedAt_idx" ON "IngestionRun"("runDate", "triggerSource", "status", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionAccountRun_status_finishedAt_idx" ON "IngestionAccountRun"("status", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionAccountRun_runId_adsAccountId_runDate_key" ON "IngestionAccountRun"("runId", "adsAccountId", "runDate");

-- CreateIndex
CREATE INDEX "CampaignDailyFact_factDate_adsAccountId_idx" ON "CampaignDailyFact"("factDate", "adsAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDailyFact_factDate_adsAccountId_campaignId_key" ON "CampaignDailyFact"("factDate", "adsAccountId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSheetConfig_adsAccountId_key" ON "AccountSheetConfig"("adsAccountId");

-- CreateIndex
CREATE INDEX "AccountSheetConfig_active_createdAt_idx" ON "AccountSheetConfig"("active", "createdAt");

-- CreateIndex
CREATE INDEX "SheetExportRun_runDate_triggerSource_status_startedAt_idx" ON "SheetExportRun"("runDate", "triggerSource", "status", "startedAt");

-- CreateIndex
CREATE INDEX "SheetExportRun_configId_startedAt_idx" ON "SheetExportRun"("configId", "startedAt");

-- CreateIndex
CREATE INDEX "SheetRowState_configId_lastExportedAt_idx" ON "SheetRowState"("configId", "lastExportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SheetRowState_configId_rowKey_key" ON "SheetRowState"("configId", "rowKey");

-- CreateIndex
CREATE INDEX "SheetManualRangeRun_status_startedAt_idx" ON "SheetManualRangeRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SheetManualRangeRun_adsAccountId_startedAt_idx" ON "SheetManualRangeRun"("adsAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "SheetManualRangeRunDay_status_runDate_idx" ON "SheetManualRangeRunDay"("status", "runDate");

-- CreateIndex
CREATE UNIQUE INDEX "SheetManualRangeRunDay_manualRunId_runDate_key" ON "SheetManualRangeRunDay"("manualRunId", "runDate");

-- AddForeignKey
ALTER TABLE "GoogleOAuthState" ADD CONSTRAINT "GoogleOAuthState_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleOAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsSyncRun" ADD CONSTRAINT "GoogleAdsSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleOAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsAccount" ADD CONSTRAINT "AdsAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleOAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionAccountRun" ADD CONSTRAINT "IngestionAccountRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionAccountRun" ADD CONSTRAINT "IngestionAccountRun_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDailyFact" ADD CONSTRAINT "CampaignDailyFact_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDailyFact" ADD CONSTRAINT "CampaignDailyFact_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSheetConfig" ADD CONSTRAINT "AccountSheetConfig_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetExportRun" ADD CONSTRAINT "SheetExportRun_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AccountSheetConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowState" ADD CONSTRAINT "SheetRowState_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AccountSheetConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowState" ADD CONSTRAINT "SheetRowState_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "SheetExportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetManualRangeRun" ADD CONSTRAINT "SheetManualRangeRun_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetManualRangeRunDay" ADD CONSTRAINT "SheetManualRangeRunDay_manualRunId_fkey" FOREIGN KEY ("manualRunId") REFERENCES "SheetManualRangeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

