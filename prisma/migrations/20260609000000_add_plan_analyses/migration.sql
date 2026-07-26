-- PlanAnalysis was added to schema.prisma + synced to dev via
-- `prisma db push` but never captured as a migration. Production
-- 500s with P2021 ("public.plan_analyses does not exist") on every
-- POST /api/blueprints. This migration creates the enum + table
-- exactly as schema.prisma declares them.
--
-- All CREATE statements use IF NOT EXISTS so the migration is
-- idempotent: no-op on dev (where the table already exists), applies
-- cleanly on prod (where it's missing).

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PlanAnalysisStatus" AS ENUM ('QUEUED', 'SUCCEEDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "plan_analyses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PlanAnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalData" TEXT,
    "pageImages" JSONB,
    "pageCount" INTEGER,
    "analysisJson" JSONB,
    "editedJson" JSONB,
    "confidence" TEXT,
    "modelUsed" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "plan_analyses_userId_createdAt_idx" ON "plan_analyses"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "plan_analyses_status_idx" ON "plan_analyses"("status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "plan_analyses" ADD CONSTRAINT "plan_analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
