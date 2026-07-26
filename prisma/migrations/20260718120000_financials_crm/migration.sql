-- Contractor money OS: recurring overhead items, per-job expenses
-- (owner-logged or worker-submitted), and CRM client notes.
-- Idempotent per house rule.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OverheadCadence" AS ENUM ('MONTHLY', 'YEARLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobExpenseSource" AS ENUM ('OWNER', 'WORKER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "overhead_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cadence" "OverheadCadence" NOT NULL DEFAULT 'MONTHLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overhead_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_expenses" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "proposalId" TEXT,
    "assignmentId" TEXT,
    "workerId" TEXT,
    "source" "JobExpenseSource" NOT NULL DEFAULT 'OWNER',
    "status" "JobExpenseStatus" NOT NULL DEFAULT 'APPROVED',
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "job_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "client_notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "overhead_items_userId_idx" ON "overhead_items"("userId");
CREATE INDEX IF NOT EXISTS "job_expenses_ownerId_status_idx" ON "job_expenses"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "job_expenses_proposalId_idx" ON "job_expenses"("proposalId");
CREATE INDEX IF NOT EXISTS "job_expenses_workerId_idx" ON "job_expenses"("workerId");
CREATE INDEX IF NOT EXISTS "client_notes_userId_clientKey_idx" ON "client_notes"("userId", "clientKey");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "overhead_items" ADD CONSTRAINT "overhead_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "job_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
