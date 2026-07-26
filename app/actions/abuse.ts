"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/admin";
import { getCircuitState, setCircuit } from "@/lib/abuse/spend-guard";
import { SPEND_CAPS, POLICIES } from "@/lib/abuse/policies";

// Admin-only observability + controls for the abuse-protection system.
// Read: spend ledger rollups, recent abuse events, circuit state.
// Write: open/close the AI circuit breaker.

export type AbuseOverview = {
  circuit: { open: boolean; reason?: string; openedAt?: string; openedBy?: string };
  caps: {
    userDailyCents: number;
    globalHourlyCents: number;
    globalDailyCents: number;
  };
  spend: {
    hourCents: number;
    dayCents: number;
    weekCents: number;
    byKindDay: { kind: string; cents: number; count: number }[];
    topUsersDay: { userId: string; email: string | null; cents: number; count: number }[];
  };
  events: {
    id: string;
    kind: string;
    policy: string | null;
    scopeKey: string | null;
    ip: string | null;
    route: string | null;
    detail: unknown;
    createdAt: string;
  }[];
  limitedLastDay: number;
};

export async function getAbuseOverview(): Promise<AbuseOverview> {
  await requireSuperAdmin();

  const now = Date.now();
  const hourAgo = new Date(now - 3600_000);
  const dayAgo = new Date(now - 86_400_000);
  const weekAgo = new Date(now - 7 * 86_400_000);

  const [circuit, hourAgg, dayAgg, weekAgg, byKind, byUser, events, limitedLastDay] =
    await Promise.all([
      getCircuitState(),
      db.spendEvent.aggregate({
        _sum: { costCents: true },
        where: { createdAt: { gte: hourAgo } },
      }),
      db.spendEvent.aggregate({
        _sum: { costCents: true },
        where: { createdAt: { gte: dayAgo } },
      }),
      db.spendEvent.aggregate({
        _sum: { costCents: true },
        where: { createdAt: { gte: weekAgo } },
      }),
      db.spendEvent.groupBy({
        by: ["kind"],
        _sum: { costCents: true },
        _count: { _all: true },
        where: { createdAt: { gte: dayAgo } },
      }),
      db.spendEvent.groupBy({
        by: ["userId"],
        _sum: { costCents: true },
        _count: { _all: true },
        where: { createdAt: { gte: dayAgo }, userId: { not: null } },
        orderBy: { _sum: { costCents: "desc" } },
        take: 10,
      }),
      db.abuseEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.abuseEvent.count({
        where: { kind: "RATE_LIMITED", createdAt: { gte: dayAgo } },
      }),
    ]);

  const userIds = byUser.map((u) => u.userId).filter((v): v is string => !!v);
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      })
    : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return {
    circuit,
    caps: {
      userDailyCents: SPEND_CAPS.userDailyCents(),
      globalHourlyCents: SPEND_CAPS.globalHourlyCents(),
      globalDailyCents: SPEND_CAPS.globalDailyCents(),
    },
    spend: {
      hourCents: hourAgg._sum.costCents ?? 0,
      dayCents: dayAgg._sum.costCents ?? 0,
      weekCents: weekAgg._sum.costCents ?? 0,
      byKindDay: byKind.map((k) => ({
        kind: k.kind,
        cents: k._sum.costCents ?? 0,
        count: k._count._all,
      })),
      topUsersDay: byUser.map((u) => ({
        userId: u.userId!,
        email: emailById.get(u.userId!) ?? null,
        cents: u._sum.costCents ?? 0,
        count: u._count._all,
      })),
    },
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      policy: e.policy,
      scopeKey: e.scopeKey,
      ip: e.ip,
      route: e.route,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
    limitedLastDay,
  };
}

export type CircuitActionResult = { ok: true } | { ok: false; reason: string };

export async function setAiCircuitAction(args: {
  open: boolean;
  reason?: string;
}): Promise<CircuitActionResult> {
  const me = await requireSuperAdmin();
  try {
    await setCircuit({
      open: args.open,
      reason:
        args.reason?.trim() ||
        (args.open ? "Manually opened from /admin/abuse" : "Manually closed from /admin/abuse"),
      by: me.user.email,
    });
    revalidatePath("/admin/abuse");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Circuit update failed",
    };
  }
}

/** Key request-rate policies, surfaced read-only on the admin page. */
export async function getPolicySummary(): Promise<
  { name: string; rules: string; failMode: string }[]
> {
  await requireSuperAdmin();
  return Object.values(POLICIES).map((p) => ({
    name: p.name,
    rules: p.rules.map((r) => `${r.limit}/${humanWindow(r.windowSec)}`).join(", "),
    failMode: p.failMode,
  }));
}

function humanWindow(sec: number): string {
  if (sec % 86400 === 0) return sec === 86400 ? "day" : `${sec / 86400}d`;
  if (sec % 3600 === 0) return sec === 3600 ? "hr" : `${sec / 3600}h`;
  if (sec % 60 === 0) return sec === 60 ? "min" : `${sec / 60}m`;
  return `${sec}s`;
}
