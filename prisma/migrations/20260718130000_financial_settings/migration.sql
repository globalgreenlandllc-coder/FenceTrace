-- Profit planner: per-contractor revenue split (% of revenue to the crew,
-- % to the salesperson; the remainder after overhead is the owner's profit).
-- Idempotent per house rule.

-- CreateTable
CREATE TABLE IF NOT EXISTS "financial_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crewPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_settings_userId_key" ON "financial_settings"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "financial_settings"
    ADD CONSTRAINT "financial_settings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
