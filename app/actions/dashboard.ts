"use server";

import { db } from "@/lib/db";
import { getMe } from "./me";

import type { ProposalListItem } from "@/lib/dashboard-mock";
import { packageTotal, type Proposal } from "@/lib/proposal-mock";

/**
 * Computes a proposal's dollar total from its data blob. Falls through
 * to 0 only if the blob has no packages or measurements.
 *
 * Priority:
 *   1. selectedPackageId — what the contractor/homeowner picked
 *   2. Pro Shield / index 1 — the canonical "most popular" tier the
 *      dashboard already highlights in the estimate view
 *   3. First available package
 *
 * Saves us from the bug where saveDraftFromEstimate was writing
 * totalCents: 0 to the row even though the proposal had real package
 * pricing in its data blob.
 */
function deriveProposalTotalCents(
  data: unknown,
  fallbackCents: number,
): number {
  // Already-priced rows (sent / accepted with real totalCents) keep
  // their stored value. Only $0 rows need derivation.
  if (fallbackCents > 0) return fallbackCents;
  const proposal = data as Partial<Proposal> | null;
  if (!proposal || !Array.isArray(proposal.packages) || !proposal.measurements) {
    return 0;
  }
  const packages = proposal.packages;
  if (packages.length === 0) return 0;
  const selectedId = (proposal as { selectedPackageId?: string }).selectedPackageId;
  const pick =
    (selectedId ? packages.find((p) => p.id === selectedId) : null) ??
    packages[1] ??
    packages[0];
  if (!pick) return 0;
  try {
    const { total } = packageTotal(
      pick,
      proposal.measurements,
      proposal.discountPct ?? 0,
    );
    return Math.max(0, Math.round(total * 100));
  } catch {
    return 0;
  }
}
export type MyProposalRow = ProposalListItem;

export type MyKpis = {
  sent: number;
  accepted: number;
  revenueMtd: number;
  conversion: number;
  pipelineValue: number;
  avgDeal: number;
};

export type MyActivityEvent = {
  id: string;
  kind: "viewed" | "accepted" | "paid" | "sent" | "drafted" | "expired" | "declined";
  client: string;
  proposalId: string;
  message: string;
  at: string;
};

const STATUS_TO_UI: Record<
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED",
  MyProposalRow["status"]
> = {
  DRAFT: "draft",
  SENT: "sent",
  VIEWED: "viewed",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  EXPIRED: "expired",
};

export async function listMyProposals(): Promise<MyProposalRow[]> {
  const me = await getMe();
  if (!me) return [];
  const now = new Date();
  const rows = await db.proposal.findMany({
    where: { userId: me.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          events: true,
          changeOrders: { where: { status: "SENT" } },
          installments: { where: { status: "PENDING", dueAt: { lt: now } } },
        },
      },
      events: {
        where: { kind: "VIEWED" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
        take: 50,
      },
    },
  });

  // Live price negotiations, one lightweight query for the whole list.
  // (A second filtered _count on the same relation isn't expressible, so
  // we aggregate proposalId → {open, needsResponse} here.)
  const liveDiscounts = await db.discountRequest.findMany({
    where: { proposal: { userId: me.user.id }, status: { in: ["OPEN", "COUNTERED"] } },
    select: { proposalId: true, turn: true },
  });
  const discountByProposal = new Map<string, { open: number; needs: boolean }>();
  for (const d of liveDiscounts) {
    const cur = discountByProposal.get(d.proposalId) ?? { open: 0, needs: false };
    cur.open += 1;
    if (d.turn === "CONTRACTOR") cur.needs = true;
    discountByProposal.set(d.proposalId, cur);
  }

  return rows.map((r) => {
    const viewEvents = r.events;
    // Derive the dollar total from the data blob when the row's
    // totalCents column is still 0 (proposals saved before the
    // package-price derivation existed).
    const cents = deriveProposalTotalCents(r.data, r.totalCents);
    return {
      id: r.id,
      address: r.address,
      client: r.clientName,
      clientEmail: r.clientEmail || undefined,
      total: cents / 100,
      status: STATUS_TO_UI[r.status as keyof typeof STATUS_TO_UI] ?? "draft",
      selectedPackage: r.selectedPackageId ?? undefined,
      updatedAt: r.updatedAt.toISOString(),
      views: r._count.events,
      viewCount: viewEvents.length,
      firstViewedAt: viewEvents[0]?.createdAt.toISOString(),
      lastViewedAt: viewEvents[viewEvents.length - 1]?.createdAt.toISOString(),
      paid: r.paidCents > 0 ? r.paidCents / 100 : undefined,
      paidTotal: r.paidCents / 100,
      completedAt: r.completedAt?.toISOString(),
      pendingChangeOrders: r._count.changeOrders,
      overdueInstallments: r._count.installments,
      openDiscountRequests: discountByProposal.get(r.id)?.open ?? 0,
      discountNeedsResponse: discountByProposal.get(r.id)?.needs ?? false,
    };
  });
}

/**
 * Loads a proposal by id for the signed-in contractor, returning the
 * full Proposal JSON shape — same one the /proposal editor + send
 * modal expect. Powers (a) opening a saved draft for further editing
 * and (b) the Send-from-list flow on /dashboard/proposals.
 *
 * Returns null when the proposal doesn't exist or belongs to someone
 * else. Doesn't throw on missing — callers redirect or 404.
 */
export async function getMyProposal(id: string): Promise<Proposal | null> {
  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe();
  } catch {
    return null;
  }
  if (!me) return null;
  const row = await db.proposal.findFirst({
    where: { id, userId: me.user.id },
    select: {
      data: true,
      address: true,
      clientName: true,
      clientEmail: true,
      publicToken: true,
    },
  });
  if (!row) return null;
  // The `data` column holds a full Proposal JSON blob (what /proposal
  // serializes when saving). Overlay the canonical address / client
  // columns on top in case those were edited via the list-row UI
  // separately from the JSON blob.
  const base = (row.data as unknown as Proposal) ?? null;
  if (!base) return null;
  return {
    ...base,
    token: row.publicToken,
    address: row.address || base.address,
    client: {
      name: row.clientName || base.client?.name || "",
      email: row.clientEmail || base.client?.email || "",
    },
  };
}

export async function getMyKpis(): Promise<MyKpis> {
  const me = await getMe();
  if (!me) {
    return {
      sent: 0,
      accepted: 0,
      revenueMtd: 0,
      conversion: 0,
      pipelineValue: 0,
      avgDeal: 0,
    };
  }
  const userId = me.user.id;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Pipeline proposals now fetched WITH their data blobs so we can
  // derive the dollar total for any row where totalCents is still 0
  // (proposals created before the package-price derivation existed
  // still need to count toward the contractor's pipeline view).
  const [sentCount, acceptedThisMonth, allDecided, pipelineRows] =
    await Promise.all([
      db.proposal.count({
        where: {
          userId,
          status: { in: ["SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"] },
          updatedAt: { gte: monthStart },
        },
      }),
      db.proposal.findMany({
        where: { userId, status: "ACCEPTED", acceptedAt: { gte: monthStart } },
        select: { paidCents: true, totalCents: true, data: true },
      }),
      db.proposal.findMany({
        where: { userId, status: { in: ["ACCEPTED", "DECLINED"] } },
        select: { status: true },
      }),
      db.proposal.findMany({
        where: {
          userId,
          status: { in: ["DRAFT", "SENT", "VIEWED"] },
        },
        select: { totalCents: true, data: true },
      }),
    ]);

  const acceptedCount = acceptedThisMonth.length;
  const revenueMtd =
    acceptedThisMonth.reduce((sum, p) => sum + p.paidCents, 0) / 100;
  // Accepted-deal totals: derive from data blob when the column says 0.
  const totalAcceptedDollarsMtd =
    acceptedThisMonth.reduce(
      (sum, p) => sum + deriveProposalTotalCents(p.data, p.totalCents),
      0,
    ) / 100;
  const avgDeal = acceptedCount > 0 ? totalAcceptedDollarsMtd / acceptedCount : 0;

  const decidedCount = allDecided.length;
  const decidedAccepted = allDecided.filter((p) => p.status === "ACCEPTED").length;
  const conversion = decidedCount > 0 ? decidedAccepted / decidedCount : 0;
  // Pipeline value: sum derived totals so drafts with package pricing
  // in the data blob (the common case after Save proposal in the
  // estimate top bar) contribute even though the row's totalCents
  // column is 0.
  const pipelineValue =
    pipelineRows.reduce(
      (sum, p) => sum + deriveProposalTotalCents(p.data, p.totalCents),
      0,
    ) / 100;

  return {
    sent: sentCount,
    accepted: acceptedCount,
    revenueMtd,
    conversion,
    pipelineValue,
    avgDeal,
  };
}

export async function listMyActivity(limit = 10): Promise<MyActivityEvent[]> {
  const me = await getMe();
  if (!me) return [];
  const rows = await db.proposalEvent.findMany({
    where: { proposal: { userId: me.user.id } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { proposal: true },
  });
  return rows.map((e) => ({
    id: e.id,
    kind: mapEventKind(e.kind),
    client: e.proposal.clientName,
    proposalId: e.proposalId,
    message: messageForEvent(e.kind, e.proposal.address, e.proposal.clientName),
    at: e.createdAt.toISOString(),
  }));
}

function mapEventKind(
  k: string,
): "viewed" | "accepted" | "paid" | "sent" | "drafted" | "expired" | "declined" {
  switch (k) {
    case "DRAFTED":
      return "drafted";
    case "SENT":
      return "sent";
    case "VIEWED":
      return "viewed";
    case "PACKAGE_SELECTED":
    case "SIGNED":
    case "ACCEPTED":
      return "accepted";
    case "PAID":
    case "COMPLETED":
      return "paid";
    case "CHANGE_ORDER_SENT":
      return "sent";
    case "CHANGE_ORDER_APPROVED":
    case "DISCOUNT_AGREED":
      return "accepted";
    case "CHANGE_ORDER_DECLINED":
    case "DECLINED":
    case "DISCOUNT_DECLINED":
    case "DISCOUNT_WITHDRAWN":
      return "declined";
    case "DISCOUNT_REQUESTED":
    case "DISCOUNT_COUNTERED":
      return "sent";
    case "EXPIRED":
      return "expired";
    default:
      return "drafted";
  }
}

/* ------------------------------------------------------------------ */
/*  Overview page data — KPIs, 90-day revenue series, week + upcoming  */
/* ------------------------------------------------------------------ */

export type OverviewData = {
  revenue30dCents: number;
  revenuePrev30dCents: number;
  /** 90 days, ascending, zero-filled (UTC day buckets). */
  revenueDaily: { date: string; cents: number }[];
  pipelineValueCents: number;
  activeProposals: number;
  openProposals: number;
  wonMtd: number;
  /** EstimateRun + PlanAnalysis counts, last 30 days. */
  takeoffs30d: number;
  /** Next 5 scheduled jobs/appointments. */
  upcoming: { id: string; title: string; dateIso: string; meta: string }[];
  /** Sun..Sat of the current week (caller's timezone). */
  week: { date: string; count: number; firstTitle: string | null }[];
};

const DAY_MS = 86_400_000;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd of the instant `d` as read in `tz` (en-CA = ISO order). */
function dayKeyInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** The UTC instant of local midnight (start of `now`'s day) in `tz`. */
function zonedDayStart(now: Date, tz: string): Date {
  // Minutes the zone is ahead of UTC at instant `d`, as milliseconds.
  const offsetAt = (d: Date): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(d);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24, // some ICU builds emit "24" for midnight
      get("minute"),
      get("second"),
    );
    return asUtc - d.getTime();
  };
  // Wall-clock midnight read as UTC, then shifted by the zone offset.
  // One refinement pass handles an offset change across midnight (DST).
  const guess = new Date(`${dayKeyInTz(now, tz)}T00:00:00Z`);
  let ts = guess.getTime() - offsetAt(guess);
  ts = guess.getTime() - offsetAt(new Date(ts));
  return new Date(ts);
}

function formatMediumDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

/**
 * `timeZone` is the caller's IANA zone (the Overview page passes the
 * browser's) — "This week" and "Upcoming jobs" bucket by that zone so
 * they agree with the calendar page. The revenue series intentionally
 * stays UTC-bucketed. Falls back to UTC when absent or invalid.
 */
export async function getOverviewData(timeZone?: string): Promise<OverviewData> {
  let tz = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC"; // garbage from the client must never throw
  }
  const empty: OverviewData = {
    revenue30dCents: 0,
    revenuePrev30dCents: 0,
    revenueDaily: [],
    pipelineValueCents: 0,
    activeProposals: 0,
    openProposals: 0,
    wonMtd: 0,
    takeoffs30d: 0,
    upcoming: [],
    week: [],
  };
  const me = await getMe();
  if (!me) return empty;
  const userId = me.user.id;

  const now = new Date();
  // Start of "today" in the caller's zone — anchors the upcoming feed
  // and the week window to the contractor's wall clock.
  const todayStart = zonedDayStart(now, tz);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const d60 = new Date(now.getTime() - 60 * DAY_MS);
  // 90 daily buckets ending today — start of the earliest bucket.
  // (Chart buckets stay UTC by design; the extra slack is harmless.)
  const seriesStart = new Date(todayStart.getTime() - 89 * DAY_MS);
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  // Sun..Sat of the current week in the caller's zone. The local
  // weekday index comes from reading today's calendar date in tz.
  // (DAY_MS stepping is off by 1h across a DST boundary — acceptable
  // for day-window queries.)
  const localDow = new Date(`${dayKeyInTz(now, tz)}T00:00:00Z`).getUTCDay();
  const weekStart = new Date(todayStart.getTime() - localDow * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const [
    paidInstallments,
    pipelineRows,
    wonMtd,
    estimateRuns30d,
    planAnalyses30d,
    upcomingJobs,
    upcomingAppointments,
    weekJobs,
    weekAppointments,
  ] = await Promise.all([
    // Revenue: everything PAID in the last 60 days covers both windows;
    // the 90-day chart needs the wider slice, so fetch from seriesStart.
    db.paymentInstallment.findMany({
      where: {
        proposal: { userId },
        status: "PAID",
        paidAt: { gte: seriesStart },
      },
      select: { paidAt: true, amountCents: true },
    }),
    db.proposal.findMany({
      where: { userId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      select: { status: true, totalCents: true, data: true },
    }),
    db.proposal.count({
      where: { userId, status: "ACCEPTED", acceptedAt: { gte: monthStart } },
    }),
    db.estimateRun.count({ where: { userId, createdAt: { gte: d30 } } }),
    db.planAnalysis.count({ where: { userId, createdAt: { gte: d30 } } }),
    db.jobAssignment.findMany({
      where: {
        ownerId: userId,
        status: { notIn: ["DECLINED", "CANCELLED"] },
        startsAt: { gte: todayStart },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true, status: true },
    }),
    db.appointment.findMany({
      where: { userId, status: "SCHEDULED", startsAt: { gte: todayStart } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true },
    }),
    db.jobAssignment.findMany({
      where: {
        ownerId: userId,
        status: { notIn: ["DECLINED", "CANCELLED"] },
        startsAt: { gte: weekStart, lt: weekEnd },
      },
      select: { title: true, startsAt: true },
    }),
    db.appointment.findMany({
      where: {
        userId,
        status: "SCHEDULED",
        startsAt: { gte: weekStart, lt: weekEnd },
      },
      select: { title: true, startsAt: true },
    }),
  ]);

  // --- Revenue windows + daily buckets (UTC day slice) ---------------
  let revenue30dCents = 0;
  let revenuePrev30dCents = 0;
  const byDay = new Map<string, number>();
  for (const i of paidInstallments) {
    if (!i.paidAt) continue;
    if (i.paidAt >= d30) revenue30dCents += i.amountCents;
    else if (i.paidAt >= d60) revenuePrev30dCents += i.amountCents;
    const key = utcDayKey(i.paidAt);
    byDay.set(key, (byDay.get(key) ?? 0) + i.amountCents);
  }
  const revenueDaily: OverviewData["revenueDaily"] = [];
  for (let i = 0; i < 90; i++) {
    const key = utcDayKey(new Date(seriesStart.getTime() + i * DAY_MS));
    revenueDaily.push({ date: key, cents: byDay.get(key) ?? 0 });
  }

  // --- Pipeline ------------------------------------------------------
  const pipelineValueCents = pipelineRows.reduce(
    (sum, p) => sum + deriveProposalTotalCents(p.data, p.totalCents),
    0,
  );
  const openProposals = pipelineRows.filter(
    (p) => p.status === "SENT" || p.status === "VIEWED",
  ).length;

  // --- Upcoming: merge assignments + appointments, next 5 -------------
  const merged = [
    ...upcomingJobs.map((j) => ({
      id: `job-${j.id}`,
      title: j.title,
      startsAt: j.startsAt,
      meta: `${formatMediumDate(j.startsAt, tz)} — ${j.status.toLowerCase().replace(/_/g, " ")}`,
    })),
    ...upcomingAppointments.map((a) => ({
      id: `appt-${a.id}`,
      title: a.title,
      startsAt: a.startsAt,
      meta: `${formatMediumDate(a.startsAt, tz)} — scheduled`,
    })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 5);

  // --- This week: bucket Sun..Sat by the caller's calendar day --------
  const week: OverviewData["week"] = [];
  const weekEvents = [...weekJobs, ...weekAppointments].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  // Column keys are pure calendar math off today's LOCAL date (UTC-space
  // stepping over date-only values, so no DST drift in the labels).
  const localToday = new Date(`${dayKeyInTz(now, tz)}T00:00:00Z`);
  const weekStartDay = new Date(localToday.getTime() - localDow * DAY_MS);
  for (let i = 0; i < 7; i++) {
    const key = utcDayKey(new Date(weekStartDay.getTime() + i * DAY_MS));
    const todays = weekEvents.filter((e) => dayKeyInTz(e.startsAt, tz) === key);
    week.push({
      date: key,
      count: todays.length,
      firstTitle: todays[0]?.title ?? null,
    });
  }

  return {
    revenue30dCents,
    revenuePrev30dCents,
    revenueDaily,
    pipelineValueCents,
    activeProposals: pipelineRows.length,
    openProposals,
    wonMtd,
    takeoffs30d: estimateRuns30d + planAnalyses30d,
    upcoming: merged.map(({ id, title, startsAt, meta }) => ({
      id,
      title,
      dateIso: startsAt.toISOString(),
      meta,
    })),
    week,
  };
}

function messageForEvent(kind: string, address: string, client: string): string {
  switch (kind) {
    case "DRAFTED":
      return `Drafted estimate · ${address}`;
    case "SENT":
      return `Proposal sent to ${client}`;
    case "VIEWED":
      return `${client} opened the proposal`;
    case "PACKAGE_SELECTED":
      return `${client} picked a package`;
    case "SIGNED":
      return `${client} signed the proposal`;
    case "ACCEPTED":
      return `Accepted · ${address}`;
    case "PAID":
      return `Payment received · ${address}`;
    case "COMPLETED":
      return `Job complete — paid in full · ${address}`;
    case "CHANGE_ORDER_SENT":
      return `Change order sent to ${client}`;
    case "CHANGE_ORDER_APPROVED":
      return `${client} approved a change order`;
    case "CHANGE_ORDER_DECLINED":
      return `${client} declined a change order`;
    case "DISCOUNT_REQUESTED":
      return `${client} asked for a better price`;
    case "DISCOUNT_COUNTERED":
      return `Price counter-offer · ${client}`;
    case "DISCOUNT_AGREED":
      return `Price agreed with ${client}`;
    case "DISCOUNT_DECLINED":
      return `Price request declined · ${client}`;
    case "DISCOUNT_WITHDRAWN":
      return `${client} withdrew a price request`;
    case "DECLINED":
      return `Declined · ${address}`;
    case "EXPIRED":
      return `Expired · ${address}`;
    default:
      return `${kind} · ${address}`;
  }
}
