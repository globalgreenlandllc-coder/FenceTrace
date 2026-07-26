-- Worker-set day availability + assignable appointments.
-- Idempotent on purpose: local dev DBs drift from the migration ledger, so
-- this file must be safe to run on a branch that already has pieces of it.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "worker_availability" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The unique index serves every read + the upsert lookup; no separate index.
CREATE UNIQUE INDEX IF NOT EXISTS "worker_availability_workerId_date_key" ON "worker_availability"("workerId", "date");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "worker_availability" ADD CONSTRAINT "worker_availability_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: appointments can be assigned to a crew member
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "workerId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "appointments_workerId_idx" ON "appointments"("workerId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
