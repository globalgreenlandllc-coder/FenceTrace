-- Sales-rep worker kind + owner-attached job file / percent pay audit fields.
-- Idempotent (local dev DBs drift from the migration ledger).

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkerKind" AS ENUM ('CREW', 'SALES');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable workers
ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "kind" "WorkerKind" NOT NULL DEFAULT 'CREW';

-- AlterTable job_assignments
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "attachmentType" TEXT;
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "invoiceTotalCents" INTEGER;
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "payPct" DOUBLE PRECISION;
