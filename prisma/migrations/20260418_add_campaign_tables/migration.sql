-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "adsAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignStatus" TEXT NOT NULL,
    "advertisingChannel" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSyncRun" (
    "id" TEXT NOT NULL,
    "adsAccountId" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalSeen" INTEGER NOT NULL DEFAULT 0,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_adsAccountId_campaignId_key" ON "Campaign"("adsAccountId", "campaignId");

-- CreateIndex
CREATE INDEX "Campaign_adsAccountId_campaignStatus_idx" ON "Campaign"("adsAccountId", "campaignStatus");

-- CreateIndex
CREATE INDEX "CampaignSyncRun_adsAccountId_startedAt_idx" ON "CampaignSyncRun"("adsAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "CampaignSyncRun_status_startedAt_idx" ON "CampaignSyncRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSyncRun" ADD CONSTRAINT "CampaignSyncRun_adsAccountId_fkey" FOREIGN KEY ("adsAccountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
