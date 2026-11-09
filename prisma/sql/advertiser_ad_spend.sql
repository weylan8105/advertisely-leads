-- Advertiser ad-spend budget (lib/adSpend.ts). Additive; run before deploying.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendAutoPause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendPausedCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Pacing to a target date (added 2026-11-08).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendTargetDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendPacedAt" TIMESTAMP(3);
