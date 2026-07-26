-- Payment schedule (installments) + change orders + done-jobs tracking.
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so it
-- applies cleanly on drifted local Neon branches as well as production.

-- New enums ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'CASH', 'CHECK', 'BANK_TRANSFER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ChangeOrderStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Proposal event kinds for change orders + completion ----------------------
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'CHANGE_ORDER_SENT';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'CHANGE_ORDER_APPROVED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'CHANGE_ORDER_DECLINED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Done-jobs stamp on proposals ---------------------------------------------
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- Change orders --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "change_orders" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amountCents" INTEGER NOT NULL,
  "status" "ChangeOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "approvedName" TEXT,
  "declineReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "change_orders_proposalId_number_key"
  ON "change_orders"("proposalId", "number");
CREATE INDEX IF NOT EXISTS "change_orders_proposalId_status_idx"
  ON "change_orders"("proposalId", "status");

DO $$ BEGIN
  ALTER TABLE "change_orders"
    ADD CONSTRAINT "change_orders_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Payment installments -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "payment_installments" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "amountCents" INTEGER NOT NULL,
  "dueAt" TIMESTAMP(3),
  "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "method" "PaymentMethod",
  "note" TEXT,
  "receiptSentAt" TIMESTAMP(3),
  "remindedAt" TIMESTAMP(3),
  "reminderCount" INTEGER NOT NULL DEFAULT 0,
  "changeOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_installments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_installments_changeOrderId_key"
  ON "payment_installments"("changeOrderId");
CREATE INDEX IF NOT EXISTS "payment_installments_proposalId_sortOrder_idx"
  ON "payment_installments"("proposalId", "sortOrder");
CREATE INDEX IF NOT EXISTS "payment_installments_status_dueAt_idx"
  ON "payment_installments"("status", "dueAt");

DO $$ BEGIN
  ALTER TABLE "payment_installments"
    ADD CONSTRAINT "payment_installments_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_installments"
    ADD CONSTRAINT "payment_installments_changeOrderId_fkey"
    FOREIGN KEY ("changeOrderId") REFERENCES "change_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
