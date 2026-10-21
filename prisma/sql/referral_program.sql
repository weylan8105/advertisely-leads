-- Advertisely Bucks Marketing Campaign (DRAFT) — NOT YET APPLIED TO PROD.
-- Additive only. Run on prod BEFORE deploying code that reads these columns,
-- then run scripts/backfill-referral-codes.mjs, then flip
-- REFERRAL_PROGRAM_ENABLED in lib/flags.ts.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bucksCents" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "referrerUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "bucksAppliedCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "BucksTransaction" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amountCents"  INTEGER NOT NULL,
  "kind"         TEXT NOT NULL,
  "note"         TEXT,
  "sourceUserId" TEXT,
  "orderId"      TEXT,
  "paymentRef"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BucksTransaction_paymentRef_userId_kind_key"
  ON "BucksTransaction"("paymentRef", "userId", "kind");
CREATE INDEX IF NOT EXISTS "BucksTransaction_userId_createdAt_idx"
  ON "BucksTransaction"("userId", "createdAt");
