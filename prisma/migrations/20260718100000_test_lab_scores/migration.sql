-- Accuracy-lab score history: one row per re-test so engine accuracy is
-- graphable over time / per engine version. Idempotent per house rule.

-- CreateTable
CREATE TABLE IF NOT EXISTS "test_lab_scores" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "eaveF1" DOUBLE PRECISION NOT NULL,
    "eavePrecision" DOUBLE PRECISION NOT NULL,
    "eaveRecall" DOUBLE PRECISION NOT NULL,
    "lfErrorPct" DOUBLE PRECISION NOT NULL,
    "clean" BOOLEAN NOT NULL DEFAULT false,
    "engineReturnedNull" BOOLEAN NOT NULL DEFAULT false,
    "engineVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_lab_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "test_lab_scores_runId_createdAt_idx" ON "test_lab_scores"("runId", "createdAt");
CREATE INDEX IF NOT EXISTS "test_lab_scores_createdAt_idx" ON "test_lab_scores"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "test_lab_scores" ADD CONSTRAINT "test_lab_scores_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_lab_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
