-- Add conversion value metrics to campaign daily facts.
ALTER TABLE "CampaignDailyFact"
  ADD COLUMN "conversionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "conversionValuePerCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
