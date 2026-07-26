-- Worker-pay audit: record which "smart base" the pay % was applied to.
-- Idempotent (local dev DB drift).

-- payBasis: 'estimate' (source proposal's contract total) | 'invoice'
-- (AI-read uploaded invoice) | NULL (no base known).
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "payBasis" TEXT;

-- invoiceTotalCents was widened beyond invoices — it now also stores the
-- proposal-estimate base — so rename it to payBaseCents while the column is
-- young (added 20260721000001) and its consumers are three files. Guarded so
-- re-runs and drifted DBs no-op.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assignments' AND column_name = 'invoiceTotalCents'
  ) THEN
    ALTER TABLE "job_assignments" RENAME COLUMN "invoiceTotalCents" TO "payBaseCents";
  ELSE
    ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "payBaseCents" INTEGER;
  END IF;
END $$;

-- Backfill: every base recorded before payBasis existed came from the
-- invoice-upload flow (the only base the old assign modal knew).
UPDATE "job_assignments"
SET "payBasis" = 'invoice'
WHERE "payBaseCents" IS NOT NULL AND "payBasis" IS NULL;
