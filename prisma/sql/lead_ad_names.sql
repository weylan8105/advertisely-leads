-- Ad and ad set names on leads, so admins can see which ad each lead came from
-- (added 2026-11-09). Additive; run before deploying.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "adName" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "adsetName" TEXT;
