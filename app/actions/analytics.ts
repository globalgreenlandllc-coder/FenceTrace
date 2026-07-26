"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  CHANNEL_LABELS,
  classifyIntent,
  eventLabel,
  friendlyPath,
  INTENT_RANK,
  LIVE_ACTIVITY_WINDOW_MS,
  LIVE_WINDOW_MS,
  segmentForPath,
  type Channel,
  type Intent,
  type Segment,
} from "@/lib/analytics";

// Admin analytics queries for /admin/analytics. Read-only over
// visitor_sessions / page_views (written by /api/track) plus the
// business tables (users, subscriptions, wallets, runs, proposals).
//
// Traffic numbers exclude admin-segment sessions and /admin pageviews —
// us watching the dashboard must not count as traffic. The live view
// still shows admins, in their own segment bucket.

export type LiveSession = {
  id: string;
  path: string;
  segment: Segment;
  channel: string;
  source: string;
  country: string | null;
  device: string | null;
  userEmail: string | null;
  startedAt: string;
  lastSeenAt: string;
  pageviews: number;
  // The friendly-labelled pages this session has moved through, oldest →
  // newest (last few), so you see where they're clicking, not just where
  // they are now. Intent = the strongest buying signal in that journey.
  journey: string[];
  intent: Intent;
};

export type LiveNow = {
  generatedAt: string;
  total: number;
  bySegment: Record<Segment, number>;
  sessions: LiveSession[];
};

export type LiveActivityItem = {
  id: string;
  at: string;
  kind: "view" | "event";
  sessionId: string;
  userEmail: string | null;
  country: string | null;
  device: string | null;
  path: string;
  label: string; // friendly page name or event label
  intent: Intent;
};

export type LiveActivity = {
  generatedAt: string;
  items: LiveActivityItem[];
  // Rollup for the "smart" banner: how many subscribe attempts just happened.
  subscribeAttempts: number;
};

export type DayStat = {
  date: string; // ISO date (daily) or ISO datetime (hourly, 24h range)
  sessions: number;
  visitors: number;
  pageviews: number;
  signups: number;
};

export type ChannelStat = {
  channel: string;
  label: string;
  sessions: number;
  visitors: number;
  signups: number;
};

export type CampaignStat = {
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  visitors: number;
  signups: number;
};

export type RankStat = { label: string; sublabel?: string; count: number };

export type FunnelStage = {
  key: string;
  label: string;
  hint: string;
  count: number;
  pctOfPrev: number | null;
  pctOfTop: number;
};

export type AnalyticsOverview = {
  rangeDays: number;
  since: string;
  generatedAt: string;
  totals: {
    sessions: number;
    visitors: number;
    marketingVisitors: number;
    pageviews: number;
    signups: number;
    conversionPct: number | null;
    bounceRatePct: number | null;
    avgSessionSecs: number;
    avgPageviews: number;
  };
  series: DayStat[];
  channels: ChannelStat[];
  sources: RankStat[];
  campaigns: CampaignStat[];
  topPages: RankStat[];
  entryPages: RankStat[];
  countries: RankStat[];
  devices: RankStat[];
  browsers: RankStat[];
  funnel: FunnelStage[];
  business: BusinessStats;
};

export type BusinessStats = {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  liveTrialing: number;
  livePaying: number;
  pastDue: number;
  canceled: number;
  freeUsers: number; // signed up, never started a subscription
  plans: { planId: string; count: number }[];
  credits: { included: number; used: number; bonus: number };
  estimates: { total: number; inRange: number };
  blueprints: { total: number; inRange: number };
  proposals: { status: string; count: number }[];
  workers: number;
};

/** Auth for these read-only queries. Deliberately NOT requireSuperAdmin():
 *  that path runs getMe() → findOrCreateUser(), which writes lastLoginAt
 *  and syncs the wallet on every call — far too heavy for a 10s live
 *  poll. One indexed read, no writes. */
async function requireAdminReader(): Promise<void> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Forbidden");
  const user = await db.user.findUnique({
    where: { clerkId },
    select: { role: true },
  });
  if (user?.role !== "SUPER_ADMIN") throw new Error("Forbidden");
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const rankIntent = (i: Intent): number => INTENT_RANK[i];

export async function getLiveNow(): Promise<LiveNow> {
  await requireAdminReader();
  const cutoff = new Date(Date.now() - LIVE_WINDOW_MS);
  const rows = await db.visitorSession.findMany({
    where: { lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
    select: {
      id: true,
      lastPath: true,
      channel: true,
      referrerHost: true,
      utmSource: true,
      country: true,
      device: true,
      userId: true,
      startedAt: true,
      lastSeenAt: true,
      pageviews: true,
    },
  });

  const sessionIds = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const [users, recentViews] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    // Recent pageviews for these live sessions → per-session journey.
    sessionIds.length
      ? db.pageView.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: { createdAt: "desc" },
          take: 600,
          select: { sessionId: true, path: true },
        })
      : Promise.resolve([]),
  ]);
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  // Build oldest→newest friendly journeys (last 5 pages) per session, and
  // track the strongest intent across the FULL recent history (not just the
  // 5 shown) so a high-intent page that scrolled out still flags the session.
  const pathsBySession = new Map<string, string[]>();
  const intentBySession = new Map<string, Intent>();
  for (const v of recentViews) {
    const arr = pathsBySession.get(v.sessionId);
    if (arr) {
      if (arr.length < 5) arr.push(v.path); // desc order → capped at 5 most recent
    } else {
      pathsBySession.set(v.sessionId, [v.path]);
    }
    const cur = intentBySession.get(v.sessionId) ?? "normal";
    const cand = classifyIntent(v.path);
    if (rankIntent(cand) > rankIntent(cur)) intentBySession.set(v.sessionId, cand);
  }

  const bySegment: Record<Segment, number> = {
    marketing: 0,
    app: 0,
    portal: 0,
    admin: 0,
  };
  const sessions: LiveSession[] = rows.map((r) => {
    const segment = segmentForPath(r.lastPath);
    bySegment[segment] += 1;
    const rawPaths = (pathsBySession.get(r.id) ?? [r.lastPath]).slice().reverse();
    const journey = rawPaths.map(friendlyPath);
    // Strongest intent across the whole recent visit (computed above over the
    // uncapped history) — falls back to the current page for a fresh session.
    const intent = intentBySession.get(r.id) ?? classifyIntent(r.lastPath);
    return {
      id: r.id,
      path: r.lastPath,
      segment,
      channel: r.channel,
      source: r.referrerHost ?? r.utmSource ?? "direct",
      country: r.country,
      device: r.device,
      userEmail: r.userId ? (emailById.get(r.userId) ?? null) : null,
      startedAt: r.startedAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      pageviews: r.pageviews,
      journey,
      intent,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    total: sessions.length,
    bySegment,
    sessions,
  };
}

/** Live activity stream: the most recent pageviews + custom events across
 *  real (non-admin) sessions in the last few minutes, newest first, each
 *  classified by intent so the feed can flag subscribe attempts in green.
 *  Powers the "where are they clicking" feed on /admin/analytics. */
export async function getLiveActivity(): Promise<LiveActivity> {
  await requireAdminReader();
  const since = new Date(Date.now() - LIVE_ACTIVITY_WINDOW_MS);

  // One UNION over page_views + analytics_events, joined to the session for
  // who/where context. LEFT JOIN users for the email. Admin traffic excluded.
  const rows = await db.$queryRaw<
    {
      id: string;
      created_at: Date;
      kind: string;
      session_id: string;
      path: string;
      event_name: string | null;
      country: string | null;
      device: string | null;
      email: string | null;
    }[]
  >`
    SELECT a.id, a.created_at, a.kind, a.session_id, a.path, a.event_name,
           vs."country" AS country, vs."device" AS device, u."email" AS email
    FROM (
      SELECT pv.id, pv."createdAt" AS created_at, 'view' AS kind,
             pv."sessionId" AS session_id, pv.path, NULL::text AS event_name
      FROM "page_views" pv
      WHERE pv."createdAt" >= ${since} AND pv.path NOT LIKE '/admin%'
      UNION ALL
      SELECT ev.id, ev."createdAt" AS created_at, 'event' AS kind,
             ev."sessionId" AS session_id, ev.path, ev.name AS event_name
      FROM "analytics_events" ev
      WHERE ev."createdAt" >= ${since} AND ev.path NOT LIKE '/admin%'
    ) a
    -- LEFT JOIN so an event whose session row hasn't landed yet (beacons are
    -- unordered) still shows instead of being silently dropped — losing a
    -- subscribe signal is the worst failure for this feed.
    LEFT JOIN "visitor_sessions" vs ON vs.id = a.session_id
    LEFT JOIN "users" u ON u.id = vs."userId"
    -- Exclude admin PEOPLE, not just /admin pages (an admin dogfooding the
    -- marketing site entered on a non-admin segment). IS DISTINCT FROM keeps
    -- orphan rows (null segment) in.
    WHERE vs."segment" IS DISTINCT FROM 'admin'
      AND (u."role" IS NULL OR u."role" <> 'SUPER_ADMIN')
    ORDER BY a.created_at DESC
    LIMIT 30`;

  // Count subscribe attempts by distinct SESSION, not raw rows — so a burst
  // of forged/duplicate subscribe events from one session can't inflate the
  // headline "N trying to subscribe".
  const subscribeSessions = new Set<string>();
  const items: LiveActivityItem[] = rows.map((r) => {
    const intent = classifyIntent(r.path, r.event_name);
    if (intent === "subscribe") subscribeSessions.add(r.session_id);
    return {
      id: r.id,
      at: r.created_at.toISOString(),
      kind: r.kind === "event" ? "event" : "view",
      sessionId: r.session_id,
      userEmail: r.email,
      country: r.country,
      device: r.device,
      path: r.path,
      label: r.event_name ? eventLabel(r.event_name) : friendlyPath(r.path),
      intent,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    items,
    subscribeAttempts: subscribeSessions.size,
  };
}

const RANGE_WHITELIST = new Set([1, 7, 30, 90]);

export async function getAnalyticsOverview(
  rangeDays: number,
): Promise<AnalyticsOverview> {
  await requireAdminReader();
  if (!RANGE_WHITELIST.has(rangeDays)) rangeDays = 7;

  const now = new Date();
  const hourly = rangeDays === 1;
  // 24h = rolling window bucketed by hour; longer ranges = UTC days
  // including today, matching how the dashboard's revenue chart buckets.
  const since = hourly
    ? new Date(now.getTime() - 24 * 3600_000)
    : new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - (rangeDays - 1),
        ),
      );
  const trunc = hourly ? "hour" : "day";

  const [
    sessionBuckets,
    pageviewBuckets,
    signupBuckets,
    sessionTotals,
    channelRows,
    firstTouch,
    sourceRows,
    campaignRows,
    topPageRows,
    entryRows,
    countryRows,
    deviceRows,
    browserRows,
    activatedCount,
    payingSignups,
    business,
  ] = await Promise.all([
    db.$queryRaw<{ bucket: Date; sessions: bigint; visitors: bigint }[]>`
      SELECT date_trunc(${trunc}, "startedAt") AS bucket,
             COUNT(*)::bigint AS sessions,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin'
      GROUP BY 1`,
    db.$queryRaw<{ bucket: Date; pageviews: bigint }[]>`
      SELECT date_trunc(${trunc}, "createdAt") AS bucket,
             COUNT(*)::bigint AS pageviews
      FROM "page_views"
      WHERE "createdAt" >= ${since} AND "path" NOT LIKE '/admin%'
      GROUP BY 1`,
    db.$queryRaw<{ bucket: Date; signups: bigint }[]>`
      SELECT date_trunc(${trunc}, "createdAt") AS bucket,
             COUNT(*)::bigint AS signups
      FROM "users"
      WHERE "createdAt" >= ${since}
      GROUP BY 1`,
    db.$queryRaw<
      {
        sessions: bigint;
        visitors: bigint;
        marketing_visitors: bigint;
        bounces: bigint;
        avg_secs: number;
        avg_pv: number;
      }[]
    >`
      SELECT COUNT(*)::bigint AS sessions,
             COUNT(DISTINCT "visitorId")::bigint AS visitors,
             COUNT(DISTINCT "visitorId") FILTER (WHERE "segment" = 'marketing')::bigint AS marketing_visitors,
             COUNT(*) FILTER (WHERE "pageviews" <= 1)::bigint AS bounces,
             COALESCE(AVG(EXTRACT(EPOCH FROM ("lastSeenAt" - "startedAt"))), 0)::float AS avg_secs,
             COALESCE(AVG("pageviews"), 0)::float AS avg_pv
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin'`,
    db.$queryRaw<{ channel: string; sessions: bigint; visitors: bigint }[]>`
      SELECT "channel", COUNT(*)::bigint AS sessions,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin'
      GROUP BY 1 ORDER BY 2 DESC`,
    // First-touch attribution: for each user who signed up in range, the
    // channel/campaign of their EARLIEST tracked session. Powers the
    // "signups" column on channels + campaigns.
    db.$queryRaw<
      {
        user_id: string;
        channel: string;
        utm_source: string | null;
        utm_medium: string | null;
        utm_campaign: string | null;
      }[]
    >`
      SELECT DISTINCT ON (vs."userId")
             vs."userId" AS user_id, vs."channel",
             vs."utmSource" AS utm_source, vs."utmMedium" AS utm_medium,
             vs."utmCampaign" AS utm_campaign
      FROM "visitor_sessions" vs
      JOIN "users" u ON u."id" = vs."userId"
      WHERE u."createdAt" >= ${since}
      ORDER BY vs."userId", vs."startedAt" ASC`,
    db.$queryRaw<{ source: string; channel: string; sessions: bigint }[]>`
      SELECT COALESCE("referrerHost", NULLIF("utmSource", ''), '(direct)') AS source,
             "channel", COUNT(*)::bigint AS sessions
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin'
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    db.$queryRaw<
      {
        source: string;
        medium: string;
        campaign: string;
        sessions: bigint;
        visitors: bigint;
      }[]
    >`
      SELECT COALESCE("utmSource", '—') AS source,
             COALESCE("utmMedium", '—') AS medium,
             COALESCE("utmCampaign", '—') AS campaign,
             COUNT(*)::bigint AS sessions,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since}
        AND ("utmSource" IS NOT NULL OR "utmCampaign" IS NOT NULL)
      GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12`,
    db.$queryRaw<{ path: string; views: bigint; visitors: bigint }[]>`
      SELECT "path", COUNT(*)::bigint AS views,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM "page_views"
      WHERE "createdAt" >= ${since} AND "path" NOT LIKE '/admin%'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db.$queryRaw<{ path: string; sessions: bigint }[]>`
      SELECT "entryPath" AS path, COUNT(*)::bigint AS sessions
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db.$queryRaw<{ country: string; sessions: bigint }[]>`
      SELECT "country", COUNT(*)::bigint AS sessions
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin' AND "country" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db.$queryRaw<{ device: string; sessions: bigint }[]>`
      SELECT "device", COUNT(*)::bigint AS sessions
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin' AND "device" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ browser: string; sessions: bigint }[]>`
      SELECT "browser", COUNT(*)::bigint AS sessions
      FROM "visitor_sessions"
      WHERE "startedAt" >= ${since} AND "segment" <> 'admin' AND "browser" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
    // Funnel stage 3: signed up in range AND ran at least one takeoff
    // (satellite estimate or blueprint analysis).
    db.user.count({
      where: {
        createdAt: { gte: since },
        OR: [
          { estimateRuns: { some: {} } },
          { planAnalyses: { some: {} } },
        ],
      },
    }),
    db.user.count({
      where: {
        createdAt: { gte: since },
        subscription: { is: { status: "ACTIVE" } },
      },
    }),
    getBusinessStats(since),
  ]);

  // Totals derived from the raw buckets we already fetched — no second
  // full-table scan. Sum the RAW rows (not the rendered series) so the
  // hourly view's first partial bucket, which the dense axis trims, is
  // still counted.
  const pageviewsTotal = pageviewBuckets.reduce((s, r) => s + n(r.pageviews), 0);
  const signupsTotal = signupBuckets.reduce((s, r) => s + n(r.signups), 0);

  // ---- series: merge the three bucketed queries over a dense axis ----
  const bucketMs = hourly ? 3600_000 : 24 * 3600_000;
  const bucketCount = hourly ? 24 : rangeDays;
  const startMs = hourly
    ? Math.ceil(since.getTime() / bucketMs) * bucketMs
    : since.getTime();
  const key = (d: Date) => d.toISOString().slice(0, hourly ? 13 : 10);
  const sessionsByKey = new Map(sessionBuckets.map((r) => [key(r.bucket), r]));
  const pvByKey = new Map(pageviewBuckets.map((r) => [key(r.bucket), r]));
  const suByKey = new Map(signupBuckets.map((r) => [key(r.bucket), r]));
  const series: DayStat[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(startMs + i * bucketMs);
    if (d.getTime() > now.getTime()) break;
    const k = key(d);
    series.push({
      date: hourly ? d.toISOString() : k,
      sessions: n(sessionsByKey.get(k)?.sessions),
      visitors: n(sessionsByKey.get(k)?.visitors),
      pageviews: n(pvByKey.get(k)?.pageviews),
      signups: n(suByKey.get(k)?.signups),
    });
  }

  // ---- channels + campaigns with first-touch signups ----
  const signupsByChannel = new Map<string, number>();
  const signupsByCampaign = new Map<string, number>();
  for (const row of firstTouch) {
    signupsByChannel.set(row.channel, (signupsByChannel.get(row.channel) ?? 0) + 1);
    const ck = `${row.utm_source ?? "—"}|${row.utm_medium ?? "—"}|${row.utm_campaign ?? "—"}`;
    signupsByCampaign.set(ck, (signupsByCampaign.get(ck) ?? 0) + 1);
  }
  const channels: ChannelStat[] = channelRows.map((r) => ({
    channel: r.channel,
    label: CHANNEL_LABELS[r.channel as Channel] ?? r.channel,
    sessions: n(r.sessions),
    visitors: n(r.visitors),
    signups: signupsByChannel.get(r.channel) ?? 0,
  }));
  const campaigns: CampaignStat[] = campaignRows.map((r) => ({
    source: r.source,
    medium: r.medium,
    campaign: r.campaign,
    sessions: n(r.sessions),
    visitors: n(r.visitors),
    signups: signupsByCampaign.get(`${r.source}|${r.medium}|${r.campaign}`) ?? 0,
  }));

  // ---- totals + funnel ----
  const t = sessionTotals[0];
  const totalSessions = n(t?.sessions);
  const marketingVisitors = n(t?.marketing_visitors);
  const funnelCounts = [
    {
      key: "visitors",
      label: "Visitors",
      hint: "Unique visitors on the marketing site",
      count: marketingVisitors,
    },
    {
      key: "signups",
      label: "Sign-ups",
      hint: "Accounts created",
      count: signupsTotal,
    },
    {
      key: "activated",
      label: "Ran a takeoff",
      hint: "New accounts that ran a satellite or blueprint takeoff",
      count: activatedCount,
    },
    {
      key: "paying",
      label: "Paying",
      hint: "New accounts with an active subscription",
      count: payingSignups,
    },
  ];
  const top = funnelCounts[0].count;
  const funnel: FunnelStage[] = funnelCounts.map((s, i) => ({
    ...s,
    pctOfPrev:
      i === 0
        ? null
        : funnelCounts[i - 1].count > 0
          ? Math.round((s.count / funnelCounts[i - 1].count) * 1000) / 10
          : null,
    pctOfTop: top > 0 ? Math.round((s.count / top) * 1000) / 10 : 0,
  }));

  return {
    rangeDays,
    since: since.toISOString(),
    generatedAt: now.toISOString(),
    totals: {
      sessions: totalSessions,
      visitors: n(t?.visitors),
      marketingVisitors,
      pageviews: pageviewsTotal,
      signups: signupsTotal,
      conversionPct:
        marketingVisitors > 0
          ? Math.round((signupsTotal / marketingVisitors) * 1000) / 10
          : null,
      bounceRatePct:
        totalSessions > 0
          ? Math.round((n(t?.bounces) / totalSessions) * 1000) / 10
          : null,
      avgSessionSecs: Math.round(t?.avg_secs ?? 0),
      avgPageviews: Math.round((t?.avg_pv ?? 0) * 10) / 10,
    },
    series,
    channels,
    sources: sourceRows.map((r) => ({
      label: r.source,
      sublabel: CHANNEL_LABELS[r.channel as Channel] ?? r.channel,
      count: n(r.sessions),
    })),
    campaigns,
    topPages: topPageRows.map((r) => ({
      label: r.path,
      sublabel: `${n(r.visitors)} visitors`,
      count: n(r.views),
    })),
    entryPages: entryRows.map((r) => ({ label: r.path, count: n(r.sessions) })),
    countries: countryRows.map((r) => ({ label: r.country, count: n(r.sessions) })),
    devices: deviceRows.map((r) => ({ label: r.device, count: n(r.sessions) })),
    browsers: browserRows.map((r) => ({ label: r.browser, count: n(r.sessions) })),
    funnel,
    business,
  };
}

async function getBusinessStats(since: Date): Promise<BusinessStats> {
  const [
    totalUsers,
    newUsers7d,
    newUsers30d,
    subsByStatus,
    subsTotal,
    planRows,
    wallet,
    estimatesTotal,
    estimatesInRange,
    blueprintsTotal,
    blueprintsInRange,
    proposalsByStatus,
    workers,
  ] = await Promise.all([
    db.user.count({ where: { role: { not: "SUPER_ADMIN" } } }),
    db.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } },
    }),
    db.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
    }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.subscription.count(),
    db.subscription.groupBy({
      by: ["planId"],
      where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
      _count: { _all: true },
      orderBy: { _count: { planId: "desc" } },
    }),
    db.creditWallet.aggregate({
      _sum: { included: true, used: true, bonus: true },
    }),
    db.estimateRun.count(),
    db.estimateRun.count({ where: { createdAt: { gte: since } } }),
    db.planAnalysis.count(),
    db.planAnalysis.count({ where: { createdAt: { gte: since } } }),
    db.proposal.groupBy({ by: ["status"], _count: { _all: true } }),
    db.worker.count(),
  ]);

  const byStatus = new Map(subsByStatus.map((s) => [s.status, s._count._all]));
  return {
    totalUsers,
    newUsers7d,
    newUsers30d,
    liveTrialing: byStatus.get("TRIALING") ?? 0,
    livePaying: byStatus.get("ACTIVE") ?? 0,
    pastDue: byStatus.get("PAST_DUE") ?? 0,
    canceled: byStatus.get("CANCELED") ?? 0,
    freeUsers: Math.max(0, totalUsers - subsTotal),
    plans: planRows.map((p) => ({ planId: p.planId, count: p._count._all })),
    credits: {
      included: wallet._sum.included ?? 0,
      used: wallet._sum.used ?? 0,
      bonus: wallet._sum.bonus ?? 0,
    },
    estimates: { total: estimatesTotal, inRange: estimatesInRange },
    blueprints: { total: blueprintsTotal, inRange: blueprintsInRange },
    proposals: proposalsByStatus.map((p) => ({
      status: p.status,
      count: p._count._all,
    })),
    workers,
  };
}
