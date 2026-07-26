-- Client-initiated price negotiation: discount requests + offer thread.
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so it
-- applies cleanly on drifted local Neon branches as well as production.

-- New enums ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "DiscountRequestStatus" AS ENUM ('OPEN', 'COUNTERED', 'AGREED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountTurn" AS ENUM ('CONTRACTOR', 'CLIENT', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountOfferParty" AS ENUM ('CLIENT', 'CONTRACTOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Proposal event kinds for the negotiation ---------------------------------
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'DISCOUNT_REQUESTED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'DISCOUNT_COUNTERED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'DISCOUNT_AGREED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'DISCOUNT_DECLINED';
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'DISCOUNT_WITHDRAWN';

-- Discount requests ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "discount_requests" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "listedCents" INTEGER NOT NULL,
  "costCents" INTEGER NOT NULL,
  "floorCents" INTEGER NOT NULL DEFAULT 0,
  "currentCents" INTEGER NOT NULL,
  "status" "DiscountRequestStatus" NOT NULL DEFAULT 'OPEN',
  "turn" "DiscountTurn" NOT NULL DEFAULT 'CONTRACTOR',
  "resolvedCents" INTEGER,
  "resolvedPct" DOUBLE PRECISION,
  "declineReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),

  CONSTRAINT "discount_requests_pkey" PRIMARY KEY ("id")
);

-- Idempotent add for branches where the table was created before floorCents.
ALTER TABLE "discount_requests" ADD COLUMN IF NOT EXISTS "floorCents" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "discount_requests_proposalId_status_idx"
  ON "discount_requests"("proposalId", "status");

DO $$ BEGIN
  ALTER TABLE "discount_requests"
    ADD CONSTRAINT "discount_requests_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Discount offers (one row per move in the thread) --------------------------
CREATE TABLE IF NOT EXISTS "discount_offers" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "party" "DiscountOfferParty" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "discount_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "discount_offers_requestId_createdAt_idx"
  ON "discount_offers"("requestId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "discount_offers"
    ADD CONSTRAINT "discount_offers_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "discount_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
