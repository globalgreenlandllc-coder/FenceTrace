-- Web analytics: first-party visitor sessions + pageviews for /admin/analytics.
-- Written idempotent (IF NOT EXISTS) so it can also be applied to drifted
-- local Neon branches with `prisma db execute`.

CREATE TABLE IF NOT EXISTS "visitor_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'marketing',
    "entryPath" TEXT NOT NULL,
    "lastPath" TEXT NOT NULL,
    "referrer" TEXT,
    "referrerHost" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'direct',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "pageviews" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "visitor_sessions_lastSeenAt_idx" ON "visitor_sessions"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "visitor_sessions_startedAt_idx" ON "visitor_sessions"("startedAt");
CREATE INDEX IF NOT EXISTS "visitor_sessions_visitorId_startedAt_idx" ON "visitor_sessions"("visitorId", "startedAt");
CREATE INDEX IF NOT EXISTS "visitor_sessions_userId_startedAt_idx" ON "visitor_sessions"("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "page_views" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "page_views_createdAt_idx" ON "page_views"("createdAt");
CREATE INDEX IF NOT EXISTS "page_views_path_createdAt_idx" ON "page_views"("path", "createdAt");
