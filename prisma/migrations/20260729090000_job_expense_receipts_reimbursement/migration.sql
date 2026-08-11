-- Worker expenses grow a receipt and an answer to "who is out the money".
--
-- Both settings cost the job the same; the difference is whether the
-- business still owes the worker cash. Reimbursement is tracked on the
-- expense itself rather than as a separate ledger, because the thing
-- being paid back IS the expense.
--
-- Idempotent per house rule.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobExpensePaidBy" AS ENUM ('COMPANY_CARD', 'OUT_OF_POCKET');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "job_expenses"
  ADD COLUMN IF NOT EXISTS "paidBy" "JobExpensePaidBy" NOT NULL DEFAULT 'COMPANY_CARD',
  ADD COLUMN IF NOT EXISTS "reimbursedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptName" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptType" TEXT;

-- Backfill: every worker-submitted row predating this column was
-- submitted under a form that said "Paid for something out of pocket?
-- Log it". Defaulting those to COMPANY_CARD would quietly erase money
-- the business genuinely owes its crew, so they carry that promise
-- forward. Owner-logged rows keep the COMPANY_CARD default.
UPDATE "job_expenses"
   SET "paidBy" = 'OUT_OF_POCKET'
 WHERE "source" = 'WORKER'
   AND "paidBy" = 'COMPANY_CARD';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_expenses_ownerId_paidBy_reimbursedAt_idx"
  ON "job_expenses"("ownerId", "paidBy", "reimbursedAt");
