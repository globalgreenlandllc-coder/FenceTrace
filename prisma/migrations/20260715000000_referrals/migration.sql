-- Referral program: shareable code per user + referred-by attribution.
-- Written idempotently (IF NOT EXISTS guards) so it applies cleanly on
-- drifted local Neon branches as well as production.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_referralCode_key" ON "users"("referralCode");
