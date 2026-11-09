-- Advertiser ad-spend budget (lib/adSpend.ts). Additive; run before deploying.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendAutoPause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendPausedCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Pacing to a target date (added 2026-11-08).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendTargetDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendPacedAt" TIMESTAMP(3);
-- Payments sent outside Stripe (Zelle, check, wire), added 2026-11-08.
CREATE TABLE IF NOT EXISTS "AdSpendPayment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "note" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdSpendPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdSpendPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdSpendPayment_userId_idx" ON "AdSpendPayment"("userId");
-- Other emails a client pays ad spend from (added 2026-11-08).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
