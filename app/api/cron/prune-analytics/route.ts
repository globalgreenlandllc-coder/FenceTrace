import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const maxDuration = 60;

// How long raw analytics rows live. The /admin/analytics dashboard only
// ever looks back 90 days, so 180 keeps a comfortable margin for
// quarter-over-quarter comparisons while bounding two insert-heavy
// tables that otherwise grow forever (page_views especially).
const RETENTION_DAYS = 180;

// Delete in capped batches so a large backlog can't blow past maxDuration
// or lock the tables — the daily cadence catches up over a few runs.
const MAX_DELETE = 50_000;

/**
 * Daily cron: prunes visitor_sessions / page_views older than the
 * retention window. Analytics rows are disposable telemetry (no FK, not
 * billing) — safe to hard-delete. Idempotent: a run with nothing to
 * prune deletes 0 and returns ok.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    // deleteMany has no LIMIT, so cap each run by selecting a batch of ids
    // first — a large backlog drains over successive daily runs instead of
    // one unbounded, long-locking delete.
    const staleViews = await db.pageView.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: MAX_DELETE,
    });
    const pageViews = await db.pageView.deleteMany({
      where: { id: { in: staleViews.map((r) => r.id) } },
    });

    const staleEvents = await db.analyticsEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: MAX_DELETE,
    });
    const events = await db.analyticsEvent.deleteMany({
      where: { id: { in: staleEvents.map((r) => r.id) } },
    });

    const staleSessions = await db.visitorSession.findMany({
      where: { startedAt: { lt: cutoff } },
      select: { id: true },
      take: MAX_DELETE,
    });
    const sessions = await db.visitorSession.deleteMany({
      where: { id: { in: staleSessions.map((r) => r.id) } },
    });

    return NextResponse.json({
      ok: true,
      cutoff: cutoff.toISOString(),
      deleted: {
        pageViews: pageViews.count,
        events: events.count,
        sessions: sessions.count,
      },
    });
  } catch (err) {
    console.error("[cron/prune-analytics] failed:", err);
    return NextResponse.json({ error: "Prune failed" }, { status: 500 });
  }
}
