-- Contractor payment rails: per-contractor Square / Stripe / Stax API
-- keys (encrypted), provider-invoice bookkeeping on installments, and
-- the rail a proposal is billed on (picked at send time; the first
-- installment is auto-invoiced through it on acceptance).
--
-- Idempotent per house rule.

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_connections_userId_provider_key"
  ON "payment_connections"("userId", "provider");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "payment_connections"
    ADD CONSTRAINT "payment_connections_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Provider-invoice fields on installments.
ALTER TABLE "payment_installments" ADD COLUMN IF NOT EXISTS "invoiceProvider" TEXT;
ALTER TABLE "payment_installments" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;
ALTER TABLE "payment_installments" ADD COLUMN IF NOT EXISTS "invoiceUrl" TEXT;
ALTER TABLE "payment_installments" ADD COLUMN IF NOT EXISTS "invoiceSentAt" TIMESTAMP(3);
ALTER TABLE "payment_installments" ADD COLUMN IF NOT EXISTS "invoiceCanceledAt" TIMESTAMP(3);

-- Which rail bills this job. NULL keeps today's behaviour: the
-- contractor invoices by hand from the payments drawer.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "payWith" TEXT;
