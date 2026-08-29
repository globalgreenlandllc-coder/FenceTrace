-- The contractor's proposal boilerplate, written ONCE in Settings and
-- stamped onto every new estimate automatically: the terms blocks
-- (scope of work, warranty, payment, scheduling, exclusions) plus the
-- default client price display (totals / split / itemized).
--
-- Absent row = the platform's sample terms — exactly what every
-- proposal shipped with before this table existed.
--
-- Idempotent per house rule.

-- CreateTable
CREATE TABLE IF NOT EXISTS "contractor_proposal_defaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "terms" JSONB,
    "priceDisplay" TEXT NOT NULL DEFAULT 'totals',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_proposal_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_proposal_defaults_userId_key"
  ON "contractor_proposal_defaults"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "contractor_proposal_defaults"
    ADD CONSTRAINT "contractor_proposal_defaults_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
