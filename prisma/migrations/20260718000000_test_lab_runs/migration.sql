-- Admin accuracy lab: test_lab_runs stores one engine run per row —
-- engine output, admin-corrected ground truth, failure tags, diff,
-- serialized solar layers for offline replay, and the latest re-test
-- score. Idempotent (IF NOT EXISTS / duplicate_object guards) per the
-- house rule so it no-ops wherever `db push` already created it.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TestLabRunStatus" AS ENUM ('PENDING', 'APPROVED', 'CORRECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "test_lab_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "TestLabRunStatus" NOT NULL DEFAULT 'PENDING',
    "engineJson" JSONB,
    "correctedJson" JSONB,
    "tagsJson" JSONB,
    "diffJson" JSONB,
    "notesJson" JSONB,
    "aerialData" TEXT,
    "aerialW" INTEGER,
    "aerialH" INTEGER,
    "canvasPxPerFt" DOUBLE PRECISION,
    "layersData" TEXT,
    "insightsJson" JSONB,
    "engineVersion" TEXT,
    "runDurationMs" INTEGER,
    "lastScoreJson" JSONB,
    "lastScoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_lab_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "test_lab_runs_userId_createdAt_idx" ON "test_lab_runs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "test_lab_runs_status_idx" ON "test_lab_runs"("status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "test_lab_runs" ADD CONSTRAINT "test_lab_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
