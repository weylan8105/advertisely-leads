-- Advertiser ad-spend budget (lib/adSpend.ts). Additive; run before deploying.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendAutoPause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendPausedCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
