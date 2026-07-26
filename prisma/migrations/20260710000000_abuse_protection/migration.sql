-- Abuse protection: rate-limit counters, spend ledger, abuse events.
-- Written idempotent (IF NOT EXISTS / DO-block enums) so it can also be
-- applied to drifted local Neon branches with `prisma db execute`.

DO $$ BEGIN
  CREATE TYPE "SpendKind" AS ENUM ('SATELLITE_ESTIMATE', 'BLUEPRINT_ANALYSIS', 'LEAD_SYNC', 'EMAIL_SEND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AbuseEventKind" AS ENUM ('RATE_LIMITED', 'QUOTA_EXCEEDED', 'SPEND_CAP_USER', 'CIRCUIT_OPENED', 'CIRCUIT_CLOSED', 'ALERT_SENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");

CREATE TABLE IF NOT EXISTS "spend_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "SpendKind" NOT NULL,
    "provider" TEXT,
    "costCents" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "spend_events_createdAt_idx" ON "spend_events"("createdAt");
CREATE INDEX IF NOT EXISTS "spend_events_userId_createdAt_idx" ON "spend_events"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "spend_events_kind_createdAt_idx" ON "spend_events"("kind", "createdAt");

CREATE TABLE IF NOT EXISTS "abuse_events" (
    "id" TEXT NOT NULL,
    "kind" "AbuseEventKind" NOT NULL,
    "policy" TEXT,
    "scopeKey" TEXT,
    "userId" TEXT,
    "ip" TEXT,
    "route" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "abuse_events_createdAt_idx" ON "abuse_events"("createdAt");
CREATE INDEX IF NOT EXISTS "abuse_events_kind_createdAt_idx" ON "abuse_events"("kind", "createdAt");
CREATE INDEX IF NOT EXISTS "abuse_events_scopeKey_createdAt_idx" ON "abuse_events"("scopeKey", "createdAt");
