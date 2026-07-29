-- Per-contractor fence price book: what THIS contractor charges per
-- fence type, overriding the catalog's national rate.
--
-- Sparse on purpose — a type with no row (or a NULL column) still
-- prices at the catalog, so a platform price refresh reaches everyone
-- who hasn't deliberately overridden that number.
--
-- Idempotent per house rule.

-- CreateTable
CREATE TABLE IF NOT EXISTS "contractor_fence_rates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fenceTypeId" TEXT NOT NULL,
    "materialPerLf" DOUBLE PRECISION,
    "laborPerLf" DOUBLE PRECISION,
    "gateSingle" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_fence_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_fence_rates_userId_fenceTypeId_key"
  ON "contractor_fence_rates"("userId", "fenceTypeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contractor_fence_rates_userId_idx"
  ON "contractor_fence_rates"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "contractor_fence_rates"
    ADD CONSTRAINT "contractor_fence_rates_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
