import "server-only";
import type { SpendKind } from "@prisma/client";
import { db } from "@/lib/db";
import { SPEND_CAPS } from "./policies";
import { logAbuseEvent } from "./rate-limit";
import { alertAdmins } from "./alerts";

// Cost-aware throttling + circuit breaker. Request-count limits
// (rate-limit.ts) bound *how often* things run; this module bounds
// *how much money* they can burn:
//
//   1. Every AI / external-API action appends a SpendEvent (actual
//      token-derived cost where usage is captured, conservative flat
//      estimate otherwise).
//   2. Before an AI action runs, checkAiSpendAllowed() compares the
//      hour/day ledger sums against hard caps: per-user daily, global
//      hourly, global daily.
//   3. Crossing a GLOBAL cap opens the circuit — a PlatformSetting row
//      every AI entry point checks first. It stays open until an admin
//      closes it from /admin/abuse (or the env override is lifted).
//      This is the "abuse cannot create a massive bill" backstop: once
//      open, the worst case is capped at roughly the daily cap.
//
// Fail-safe direction: if the ledger/DB is unreadable, AI actions are
// BLOCKED (fail-closed) — an outage should never mean unmetered spend.

const AI_KINDS: SpendKind[] = ["SATELLITE_ESTIMATE", "BLUEPRINT_ANALYSIS", "LEAD_SYNC"];
const CIRCUIT_KEY = "abuse.ai_circuit";

export type SpendDecision = { ok: true } | { ok: false; reason: string };

type CircuitState = {
  open: boolean;
  reason?: string;
  openedAt?: string;
  openedBy?: string;
};

export async function getCircuitState(): Promise<CircuitState> {
  if (process.env.ABUSE_AI_DISABLED === "1") {
    return { open: true, reason: "ABUSE_AI_DISABLED env override", openedBy: "env" };
  }
  const row = await db.platformSetting.findUnique({ where: { key: CIRCUIT_KEY } });
  return (row?.value as CircuitState | null) ?? { open: false };
}

export async function setCircuit(args: {
  open: boolean;
  reason: string;
  by: string;
}): Promise<void> {
  const value: CircuitState = args.open
    ? { open: true, reason: args.reason, openedAt: new Date().toISOString(), openedBy: args.by }
    : { open: false };
  await db.platformSetting.upsert({
    where: { key: CIRCUIT_KEY },
    create: { key: CIRCUIT_KEY, value, updatedBy: args.by },
    update: { value, updatedBy: args.by },
  });
  await logAbuseEvent({
    kind: args.open ? "CIRCUIT_OPENED" : "CIRCUIT_CLOSED",
    scopeKey: "global",
    detail: { reason: args.reason, by: args.by },
  });
}

/**
 * Hard gate in front of every AI action. Checks, in order: env kill
 * switch → circuit → per-user daily cap → global hourly/daily caps.
 * Crossing a global cap OPENS the circuit and alerts admins.
 *
 * SUPER_ADMIN bypasses the per-user cap only — the circuit and global
 * caps apply to everyone, because they exist to bound the bill, and
 * admin traffic costs the same dollars. Admins can close the circuit
 * from /admin/abuse when it's a false alarm.
 */
export async function checkAiSpendAllowed(args: {
  userId: string;
  kind: SpendKind;
  estCostCents: number;
  isAdmin?: boolean;
}): Promise<SpendDecision> {
  try {
    const circuit = await getCircuitState();
    if (circuit.open) {
      return {
        ok: false,
        reason:
          "Sorry — AI analysis is temporarily unavailable. Please try again later.",
      };
    }

    const now = Date.now();
    const hourAgo = new Date(now - 3600_000);
    const dayAgo = new Date(now - 86_400_000);

    const [userDay, globalHour, globalDay] = await Promise.all([
      args.isAdmin
        ? Promise.resolve(0)
        : sumCents({ userId: args.userId, since: dayAgo }),
      sumCents({ since: hourAgo }),
      sumCents({ since: dayAgo }),
    ]);

    const userCap = SPEND_CAPS.userDailyCents();
    const hourCap = SPEND_CAPS.globalHourlyCents();
    const dayCap = SPEND_CAPS.globalDailyCents();

    if (!args.isAdmin && userDay + args.estCostCents > userCap) {
      await logAbuseEvent({
        kind: "SPEND_CAP_USER",
        scopeKey: `user:${args.userId}`,
        userId: args.userId,
        detail: { userDayCents: userDay, capCents: userCap, kind: args.kind },
      });
      await alertAdmins({
        alertKey: `user-spend-cap:${args.userId}`,
        subject: "Per-user daily AI spend cap hit",
        lines: [
          `User ${args.userId} hit the daily AI spend cap.`,
          `Spent (est): $${(userDay / 100).toFixed(2)} / cap $${(userCap / 100).toFixed(2)}`,
          `Action blocked: ${args.kind}`,
          `Review at /admin/abuse.`,
        ],
      });
      return {
        ok: false,
        reason: "You've reached today's AI usage cap. It resets tomorrow — or contact support.",
      };
    }

    if (globalHour + args.estCostCents > hourCap || globalDay + args.estCostCents > dayCap) {
      const which = globalHour + args.estCostCents > hourCap ? "hourly" : "daily";
      const spent = which === "hourly" ? globalHour : globalDay;
      const cap = which === "hourly" ? hourCap : dayCap;
      await setCircuit({
        open: true,
        reason: `Global ${which} AI spend cap crossed: $${(spent / 100).toFixed(2)} of $${(cap / 100).toFixed(2)}`,
        by: "spend-guard",
      });
      await alertAdmins({
        alertKey: "circuit-open",
        subject: `🚨 AI circuit OPENED — global ${which} spend cap crossed`,
        lines: [
          `The global ${which} AI spend cap was crossed and all AI endpoints are now paused.`,
          `Estimated spend: $${(spent / 100).toFixed(2)} (cap $${(cap / 100).toFixed(2)}).`,
          `Last action: ${args.kind} by user ${args.userId}.`,
          `Close the circuit at /admin/abuse once you've confirmed this is legitimate,`,
          `or raise ABUSE_GLOBAL_${which.toUpperCase()}_AI_CENTS if the business has outgrown the cap.`,
        ],
      });
      return {
        ok: false,
        reason:
          "Sorry — AI analysis is temporarily unavailable. Please try again later.",
      };
    }

    // Early warning at 80% of the daily cap — one email, not a wall.
    if (globalDay + args.estCostCents > dayCap * 0.8) {
      await alertAdmins({
        alertKey: "spend-80pct",
        subject: "AI spend at 80% of the daily cap",
        lines: [
          `Global AI spend is at $${(globalDay / 100).toFixed(2)} of the $${(dayCap / 100).toFixed(2)} daily cap.`,
          `If this keeps up, the circuit will open and pause all AI endpoints.`,
          `Review /admin/abuse for the top spenders.`,
        ],
      });
    }

    return { ok: true };
  } catch (e) {
    // Fail CLOSED: if we can't read the ledger we can't bound the bill.
    console.error("[spend-guard] check failed — blocking AI action", e);
    return {
      ok: false,
      reason: "AI analysis is temporarily unavailable — please try again in a minute.",
    };
  }
}

/** Append to the spend ledger. Best-effort — never throws into the caller. */
export async function recordSpend(args: {
  userId: string | null;
  kind: SpendKind;
  provider?: string;
  costCents: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.spendEvent.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        provider: args.provider,
        costCents: Math.max(0, Math.round(args.costCents)),
        inputTokens: args.inputTokens ?? undefined,
        outputTokens: args.outputTokens ?? undefined,
        meta: args.meta as object | undefined,
      },
    });
  } catch (e) {
    console.error("[spend-guard] recordSpend failed", e);
  }
}

async function sumCents(where: { userId?: string; since: Date }): Promise<number> {
  const agg = await db.spendEvent.aggregate({
    _sum: { costCents: true },
    where: {
      kind: { in: AI_KINDS },
      createdAt: { gte: where.since },
      ...(where.userId ? { userId: where.userId } : {}),
    },
  });
  return agg._sum.costCents ?? 0;
}

// ---------------------------------------------------------------------
// Cost estimation from token usage. Rates in cents per million tokens,
// intentionally rounded UP to current list prices — the ledger caps
// spend, it doesn't invoice anyone. Unknown models fall back to the
// most expensive rate so a new model can never sneak under the caps.
// ---------------------------------------------------------------------

const MODEL_RATES: Array<{ match: string; inPerMtok: number; outPerMtok: number }> = [
  { match: "opus", inPerMtok: 1_500, outPerMtok: 7_500 },
  { match: "sonnet", inPerMtok: 300, outPerMtok: 1_500 },
  { match: "haiku", inPerMtok: 100, outPerMtok: 500 },
  { match: "gemini", inPerMtok: 125, outPerMtok: 1_000 },
  { match: "gpt-4o-mini", inPerMtok: 15, outPerMtok: 60 },
  { match: "gpt-4o", inPerMtok: 250, outPerMtok: 1_000 },
];

export function estimateModelCostCents(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const m = (model ?? "").toLowerCase();
  const rate =
    MODEL_RATES.find((r) => m.includes(r.match)) ?? MODEL_RATES[0]!;
  const inTok = Math.max(0, inputTokens ?? 0);
  const outTok = Math.max(0, outputTokens ?? 0);
  return Math.ceil((inTok * rate.inPerMtok + outTok * rate.outPerMtok) / 1_000_000);
}
