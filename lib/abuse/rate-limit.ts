import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import type { Policy } from "./policies";

// Postgres-backed fixed-window rate limiter. One bucket row per
// (policy, identity, window); the increment is a single atomic
// INSERT ... ON CONFLICT UPDATE (Prisma upsert compiles to that for a
// plain unique-key upsert). No Redis in this stack — at this app's
// traffic a single indexed upsert per guarded action is well within
// Neon's budget, and the buckets table is swept daily by cron.
//
// Semantics: increment-then-check. The denied request still counts,
// so a client hammering past the limit keeps pushing its own reset out.

export type LimitDecision =
  | { ok: true }
  | { ok: false; reason: string; retryAfterSec: number };

export async function consumeLimit(args: {
  policy: Policy;
  /** Identity the limit is scoped to: "user:<id>" | "ip:<addr>" | "token:<..>" | "global" */
  key: string;
  /** Weight of this request against the counters (default 1). */
  cost?: number;
  /** Extra context stamped onto the AbuseEvent when the limit trips. */
  context?: { userId?: string; ip?: string; route?: string };
}): Promise<LimitDecision> {
  const { policy, key } = args;
  const cost = args.cost ?? 1;
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    let denial: { retryAfterSec: number; rule: string; count: number } | null = null;

    // Increment every rule's bucket even after one denies — sustained
    // abuse should keep counting against the longer windows too.
    for (const rule of policy.rules) {
      const windowStart = Math.floor(nowSec / rule.windowSec) * rule.windowSec;
      const bucketKey = `${policy.name}|${key}|${rule.windowSec}|${windowStart}`;
      // Keep the row one extra window past its end so a just-denied
      // client's Retry-After math never races the sweep.
      const expiresAt = new Date((windowStart + 2 * rule.windowSec) * 1000);

      const row = await db.rateLimitBucket.upsert({
        where: { key: bucketKey },
        create: { key: bucketKey, count: cost, expiresAt },
        update: { count: { increment: cost } },
      });

      if (row.count > rule.limit && !denial) {
        denial = {
          retryAfterSec: Math.max(windowStart + rule.windowSec - nowSec, 1),
          rule: `${rule.limit}/${rule.windowSec}s`,
          count: row.count,
        };
        // Log only the first denial of the window (count just crossed)
        // plus every 50th after — a flood shouldn't flood abuse_events.
        if (row.count === rule.limit + cost || row.count % 50 === 0) {
          await logAbuseEvent({
            kind: "RATE_LIMITED",
            policy: policy.name,
            scopeKey: key,
            userId: args.context?.userId,
            ip: args.context?.ip,
            route: args.context?.route,
            detail: { rule: denial.rule, count: row.count },
          });
        }
      }
    }

    if (denial) {
      return { ok: false, reason: policy.message, retryAfterSec: denial.retryAfterSec };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[rate-limit] ${policy.name} check failed (${policy.failMode})`, e);
    if (policy.failMode === "open") return { ok: true };
    return {
      ok: false,
      reason: "Temporarily unavailable — please try again in a minute.",
      retryAfterSec: 60,
    };
  }
}

/**
 * Read-only peek at whether a bucket is already exhausted — used by the
 * alert throttle (where "denied" just means "skip the duplicate email").
 */
export async function tryConsumeQuiet(policy: Policy, key: string): Promise<boolean> {
  const decision = await consumeLimit({ policy, key });
  return decision.ok;
}

/** Best-effort abuse-event write — never throws into the caller's path. */
export async function logAbuseEvent(args: {
  kind: "RATE_LIMITED" | "QUOTA_EXCEEDED" | "SPEND_CAP_USER" | "CIRCUIT_OPENED" | "CIRCUIT_CLOSED" | "ALERT_SENT";
  policy?: string;
  scopeKey?: string;
  userId?: string;
  ip?: string;
  route?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.abuseEvent.create({
      data: {
        kind: args.kind,
        policy: args.policy,
        scopeKey: args.scopeKey,
        userId: args.userId,
        ip: args.ip,
        route: args.route,
        detail: args.detail as object | undefined,
      },
    });
  } catch (e) {
    console.error("[abuse-event] write failed", e);
  }
}

/**
 * Client IP as seen through Vercel's proxy headers. For server actions
 * (no Request object in scope). Returns null when unknown (local dev
 * without a proxy) — callers should treat null as "don't IP-limit".
 */
export async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim() || null;
    return h.get("x-real-ip") ?? null;
  } catch {
    return null;
  }
}

/** Same, but from a Request (route handlers). */
export function requestIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return request.headers.get("x-real-ip");
}
