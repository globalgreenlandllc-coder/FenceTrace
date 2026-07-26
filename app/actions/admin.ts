"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getPlanPricing } from "@/lib/plan-pricing";
import {
  clearImpersonationCookie,
  setImpersonationCookie,
} from "@/lib/impersonation";
import { getMe } from "./me";

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }
  return me;
}

async function logAction(
  actorId: string,
  action:
    | "USER_SUSPENDED"
    | "USER_UNSUSPENDED"
    | "USER_CREDITS_ADJUSTED"
    | "USER_IMPERSONATED"
    | "USER_IMPERSONATION_ENDED"
    | "REFUND_ISSUED"
    | "API_KEY_CREATED"
    | "API_KEY_ROTATED"
    | "API_KEY_REVOKED"
    | "API_KEY_VIEWED"
    | "PRICING_UPDATED"
    | "MATERIAL_DEFAULTS_UPDATED"
    | "USER_ROLE_CHANGED"
    | "USER_PLAN_CHANGED",
  targetType: string | null,
  targetId: string | null,
  payload: Record<string, unknown> = {},
) {
  await db.auditLog.create({
    data: {
      actorId,
      action,
      targetType,
      targetId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export type UserTier = "free" | "trial" | "pro";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "CONTRACTOR" | "WORKER" | "SUPER_ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  // Subscription snapshot. `subscriptionStatus` is null when the user has
  // never started a subscription (= free). `stripeLinked` is true when a
  // live Stripe subscription backs the row — the admin plan override is
  // refused in that case to avoid billing desync (Stripe would overwrite it).
  subscriptionStatus:
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "CANCELED"
    | "INCOMPLETE"
    | null;
  planId: string | null;
  tier: UserTier;
  stripeLinked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  company: string;
  contractorName: string;
  creditsIncluded: number;
  creditsUsed: number;
  creditsBonus: number;
  remaining: number;
  estimateRunsTotal: number;
  proposalsTotal: number;
  acceptedTotal: number;
  revenueProcessedCents: number;
  payments: {
    stripe: boolean;
    square: boolean;
  };
};

/** Collapse the five subscription statuses to the three tiers the admin
 *  cares about. Unlike the user-facing settings badge (which lumps
 *  TRIALING / CANCELED / INCOMPLETE / no-row all into "Free plan"), the
 *  admin surfaces TRIALING separately as "trial" for trial tracking.
 *  PAST_DUE maps to "pro" here but the users table renders it as a
 *  distinct "Payment failed" badge off subscriptionStatus. */
function tierOf(status: string | null | undefined): UserTier {
  if (status === "ACTIVE" || status === "PAST_DUE") return "pro";
  if (status === "TRIALING") return "trial";
  return "free";
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  await requireAdmin();
  const users = await db.user.findMany({
    include: {
      contractorProfile: true,
      creditWallet: true,
      subscription: true,
      _count: {
        select: { estimateRuns: true, proposals: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const ids = users.map((u) => u.id);
  const accepted = await db.proposal.groupBy({
    by: ["userId"],
    where: { status: "ACCEPTED", userId: { in: ids } },
    _count: { _all: true },
    _sum: { paidCents: true },
  });
  const acceptedById = new Map(
    accepted.map((a) => [
      a.userId,
      { count: a._count._all, paid: a._sum.paidCents ?? 0 },
    ]),
  );

  return users.map((u) => {
    const total =
      (u.creditWallet?.included ?? 0) + (u.creditWallet?.bonus ?? 0);
    const used = u.creditWallet?.used ?? 0;
    const a = acceptedById.get(u.id) ?? { count: 0, paid: 0 };
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role as "CONTRACTOR" | "WORKER" | "SUPER_ADMIN",
      status: u.status as "ACTIVE" | "SUSPENDED",
      subscriptionStatus: u.subscription?.status ?? null,
      planId: u.subscription?.planId ?? null,
      tier: tierOf(u.subscription?.status),
      stripeLinked: !!u.subscription?.stripeSubscriptionId,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      company: u.contractorProfile?.company ?? "",
      contractorName: u.contractorProfile?.contractorName ?? "",
      creditsIncluded: u.creditWallet?.included ?? 0,
      creditsUsed: used,
      creditsBonus: u.creditWallet?.bonus ?? 0,
      remaining: Math.max(total - used, 0),
      estimateRunsTotal: u._count.estimateRuns,
      proposalsTotal: u._count.proposals,
      acceptedTotal: a.count,
      revenueProcessedCents: a.paid,
      payments: {
        stripe: !!u.contractorProfile?.stripePaymentUrl,
        square: !!u.contractorProfile?.squarePaymentUrl,
      },
    };
  });
}

export async function adjustCredits(
  userId: string,
  delta: number,
  reason: string,
): Promise<{ ok: true; remaining: number }> {
  const me = await requireAdmin();
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("Delta must be a non-zero integer");
  }
  const updated = await db.creditWallet.update({
    where: { userId },
    data:
      delta > 0
        ? { bonus: { increment: delta } }
        : { used: { increment: Math.max(0, -delta) } },
  });

  await logAction(me.user.id, "USER_CREDITS_ADJUSTED", "User", userId, {
    delta,
    reason,
    after: {
      included: updated.included,
      used: updated.used,
      bonus: updated.bonus,
    },
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin");

  const remaining = Math.max(
    updated.included + updated.bonus - updated.used,
    0,
  );
  return { ok: true, remaining };
}

export async function setUserStatus(
  userId: string,
  status: "ACTIVE" | "SUSPENDED",
  reason?: string,
): Promise<{ ok: true }> {
  const me = await requireAdmin();
  const before = await db.user.findUnique({ where: { id: userId } });
  if (!before) throw new Error("User not found");
  if (before.role === "SUPER_ADMIN" && status === "SUSPENDED") {
    throw new Error("Cannot suspend a super admin");
  }
  await db.user.update({ where: { id: userId }, data: { status } });
  await logAction(
    me.user.id,
    status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_UNSUSPENDED",
    "User",
    userId,
    { reason: reason ?? null, prior: before.status },
  );
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Change a contractor's role. Deliberately limited to CONTRACTOR <-> WORKER:
 * SUPER_ADMIN is governed by the ADMIN_EMAILS env allowlist and re-synced on
 * every request in me.ts (a UI-set admin role would just revert on the
 * target's next page load), so we neither grant nor revoke it here — same
 * stance suspend/impersonate already take toward admins.
 */
export async function setUserRole(
  userId: string,
  role: "CONTRACTOR" | "WORKER",
): Promise<{ ok: true }> {
  const me = await requireAdmin();
  if (role !== "CONTRACTOR" && role !== "WORKER") {
    throw new Error("Role must be CONTRACTOR or WORKER");
  }
  const before = await db.user.findUnique({ where: { id: userId } });
  if (!before) throw new Error("User not found");
  if (before.role === "SUPER_ADMIN") {
    throw new Error(
      "Admins are managed via the ADMIN_EMAILS env var, not here.",
    );
  }
  if (before.role === role) return { ok: true };

  await db.user.update({ where: { id: userId }, data: { role } });
  await logAction(me.user.id, "USER_ROLE_CHANGED", "User", userId, {
    from: before.role,
    to: role,
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Admin override of a user's plan tier. Access is gated on CREDITS, not on
 * subscription status, so this is a billing LABEL + accounting lever, not a
 * feature switch — it does not touch the credit wallet (use adjustCredits).
 *
 * Refused when a live Stripe subscription backs the row: mutating status
 * locally would desync (the next Stripe webhook overwrites it, and a
 * hand-set ACTIVE with no real sub locks the user out of checkout). Manage
 * those in Stripe. For comp / manual / pre-Stripe accounts it upserts the
 * local Subscription row.
 */
export async function setUserTier(
  userId: string,
  tier: UserTier,
): Promise<{ ok: true }> {
  const me = await requireAdmin();
  const map: Record<
    UserTier,
    { status: "ACTIVE" | "TRIALING" | "CANCELED"; planId: string }
  > = {
    free: { status: "CANCELED", planId: "free" },
    trial: { status: "TRIALING", planId: "pro_monthly" },
    pro: { status: "ACTIVE", planId: "pro_monthly" },
  };
  const next = map[tier];
  if (!next) throw new Error("Tier must be free, trial, or pro");

  const before = await db.subscription.findUnique({ where: { userId } });
  if (before?.stripeSubscriptionId) {
    throw new Error(
      "This account has a live Stripe subscription — change it in Stripe to avoid billing desync.",
    );
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new Error("User not found");

  if (tier === "free") {
    // Free = NO subscription row, not a CANCELED one. Analytics treats
    // "free users" as having no row and counts CANCELED as genuine paid
    // churn — persisting CANCELED here would misreport a comp/downgrade as
    // churn and drop them out of the free bucket. deleteMany is a no-op
    // when there's no row; the stripeSubscriptionId guard above already
    // protected live Stripe rows from deletion.
    await db.subscription.deleteMany({ where: { userId } });
  } else {
    await db.subscription.upsert({
      where: { userId },
      create: { userId, status: next.status, planId: next.planId },
      update: { status: next.status, planId: next.planId },
    });
  }
  await logAction(me.user.id, "USER_PLAN_CHANGED", "User", userId, {
    tier,
    status: tier === "free" ? null : next.status,
    planId: tier === "free" ? null : next.planId,
    prior: before?.status ?? null,
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin/analytics");
  return { ok: true };
}

export type AdminKpis = {
  contractorsActive: number;
  contractorsSuspended: number;
  estimatesThisMonth: number;
  estimatesAllTime: number;
  proposalsAccepted: number;
  revenueProcessedCents: number;
  platformFeesCents: number;
  mrrCents: number;
};

export async function getAdminKpis(): Promise<AdminKpis> {
  await requireAdmin();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    contractorsActive,
    contractorsSuspended,
    estimatesThisMonth,
    estimatesAllTime,
    proposalsAccepted,
    revenueAgg,
    feesAgg,
    activeSubs,
  ] = await Promise.all([
    db.user.count({ where: { role: "CONTRACTOR", status: "ACTIVE" } }),
    db.user.count({ where: { role: "CONTRACTOR", status: "SUSPENDED" } }),
    db.estimateRun.count({ where: { createdAt: { gte: monthStart } } }),
    db.estimateRun.count(),
    db.proposal.count({ where: { status: "ACCEPTED" } }),
    db.proposal.aggregate({
      where: { status: "ACCEPTED" },
      _sum: { paidCents: true },
    }),
    db.transaction.aggregate({
      where: {
        status: "SUCCEEDED",
        type: { in: ["PROPOSAL_DEPOSIT", "PROPOSAL_FINAL"] },
      },
      _sum: { platformFeeCents: true },
    }),
    db.subscription.count({ where: { status: "ACTIVE" } }),
  ]);

  // Estimate: subscribers who joined at older price points keep their
  // original inline Stripe amount, so subs x current price is an
  // approximation until everyone is on the current price.
  const proPriceCents = (await getPlanPricing()).pro.priceCents;

  return {
    contractorsActive,
    contractorsSuspended,
    estimatesThisMonth,
    estimatesAllTime,
    proposalsAccepted,
    revenueProcessedCents: revenueAgg._sum.paidCents ?? 0,
    platformFeesCents: feesAgg._sum.platformFeeCents ?? 0,
    mrrCents: activeSubs * proPriceCents,
  };
}

export type AdminFinancials = {
  mrrCents: number;
  activeSubs: number;
  pastDueSubs: number;
  revenue30dCents: number;
  subscriptionRevenue30dCents: number;
  creditRevenue30dCents: number;
  /** Negative sum of REFUND rows in the last 30 days (0 when none). */
  refunds30dCents: number;
  allTimeRevenueCents: number;
  transactions: Array<{
    id: string;
    userEmail: string;
    type: string;
    status: string;
    grossCents: number;
    description: string | null;
    createdAt: string;
    /** True when the row is a revenue charge the admin can refund in-app. */
    refundable: boolean;
  }>;
};

/**
 * Platform revenue view for /admin/financials. All rows come from the
 * Transaction ledger the Stripe webhook writes (subscriptions +
 * credit top-ups) — empty until Stripe keys are configured and the
 * first payment lands.
 */
export async function getAdminFinancials(): Promise<AdminFinancials> {
  await requireAdmin();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [activeSubs, pastDueSubs, sub30, credit30, refund30, allTime, recent] =
    await Promise.all([
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.subscription.count({ where: { status: "PAST_DUE" } }),
      db.transaction.aggregate({
        where: {
          status: "SUCCEEDED",
          type: "SUBSCRIPTION",
          createdAt: { gte: since30d },
        },
        _sum: { grossCents: true },
      }),
      db.transaction.aggregate({
        where: {
          status: "SUCCEEDED",
          type: "CREDIT_TOPUP",
          createdAt: { gte: since30d },
        },
        _sum: { grossCents: true },
      }),
      db.transaction.aggregate({
        where: {
          status: "SUCCEEDED",
          type: "REFUND",
          createdAt: { gte: since30d },
        },
        _sum: { grossCents: true },
      }),
      db.transaction.aggregate({
        where: { status: "SUCCEEDED" },
        _sum: { grossCents: true },
      }),
      db.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { user: { select: { email: true } } },
      }),
    ]);

  const subscriptionRevenue30dCents = sub30._sum.grossCents ?? 0;
  const creditRevenue30dCents = credit30._sum.grossCents ?? 0;
  const refunds30dCents = refund30._sum.grossCents ?? 0; // ≤ 0
  const proPriceCents = (await getPlanPricing()).pro.priceCents;

  return {
    mrrCents: activeSubs * proPriceCents,
    activeSubs,
    pastDueSubs,
    revenue30dCents:
      subscriptionRevenue30dCents + creditRevenue30dCents + refunds30dCents,
    subscriptionRevenue30dCents,
    creditRevenue30dCents,
    refunds30dCents,
    allTimeRevenueCents: allTime._sum.grossCents ?? 0,
    transactions: recent.map((t) => ({
      id: t.id,
      userEmail: t.user.email,
      type: t.type,
      status: t.status,
      grossCents: t.grossCents,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      refundable:
        t.status === "SUCCEEDED" &&
        (t.type === "SUBSCRIPTION" || t.type === "CREDIT_TOPUP") &&
        !!(t.stripePaymentIntentId || t.stripeInvoiceId),
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Refunds — admin-issued, hard-capped                                */
/* ------------------------------------------------------------------ */

export type RefundResult =
  | { ok: true; refundedCents: number }
  | { ok: false; reason: string };

/** Both-shape reader: invoice.payment_intent (older API versions) vs
 *  invoice.payments.data[].payment.payment_intent (newer). */
function invoicePaymentIntentId(inv: unknown): string | null {
  const legacy = (inv as { payment_intent?: string | { id: string } })
    .payment_intent;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object") return legacy.id;
  const payments = (
    inv as {
      payments?: {
        data?: Array<{ payment?: { payment_intent?: string | { id: string } } }>;
      };
    }
  ).payments?.data;
  for (const p of payments ?? []) {
    const pi = p.payment?.payment_intent;
    if (typeof pi === "string") return pi;
    if (pi && typeof pi === "object") return pi.id;
  }
  return null;
}

/**
 * Refund a platform charge (subscription invoice or credit pack) from
 * /admin/financials. Safety: the amount is clamped so the customer can
 * NEVER get back more than the un-refunded remainder of that charge —
 * Stripe's own truth (charge.amount − charge.amount_refunded) is the
 * cap, not our ledger. Bookkeeping (REFUND row + credit clawback) is
 * done by the charge.refunded webhook, which stays the single billing
 * writer.
 */
export async function issueRefundForTransaction(
  transactionId: string,
  amountCents?: number,
): Promise<RefundResult> {
  try {
    const me = await requireAdmin();
    const tx = await db.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) return { ok: false, reason: "Transaction not found" };
    if (
      tx.status !== "SUCCEEDED" ||
      (tx.type !== "SUBSCRIPTION" && tx.type !== "CREDIT_TOPUP")
    ) {
      return { ok: false, reason: "Only settled charges can be refunded" };
    }
    if (
      amountCents !== undefined &&
      (!Number.isFinite(amountCents) || amountCents <= 0)
    ) {
      return { ok: false, reason: "Refund amount must be a positive number" };
    }

    const stripe = await getStripe();
    if (!stripe) return { ok: false, reason: "Stripe is not configured" };

    // Resolve the payment intent behind this ledger row.
    let paymentIntentId = tx.stripePaymentIntentId;
    if (!paymentIntentId && tx.stripeInvoiceId) {
      const inv = await stripe.invoices.retrieve(tx.stripeInvoiceId, {
        expand: ["payments"],
      });
      paymentIntentId = invoicePaymentIntentId(inv);
    }
    if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
      return {
        ok: false,
        reason:
          "Couldn't resolve the Stripe payment for this row — refund it from the Stripe dashboard instead.",
      };
    }

    // Stripe is the source of truth for what's left to give back.
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = pi.latest_charge as Stripe.Charge | null;
    if (!charge || typeof charge === "string") {
      return { ok: false, reason: "No settled charge behind this payment" };
    }
    const remaining = charge.amount - charge.amount_refunded;
    if (remaining <= 0) {
      return { ok: false, reason: "This charge is already fully refunded" };
    }
    const amount = Math.min(Math.round(amountCents ?? remaining), remaining);

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount,
    });

    await logAction(me.user.id, "REFUND_ISSUED", "transaction", tx.id, {
      userId: tx.userId,
      refundId: refund.id,
      amountCents: amount,
      requestedCents: amountCents ?? null,
      chargeCents: charge.amount,
      previouslyRefundedCents: charge.amount_refunded,
    });

    revalidatePath("/admin/financials");
    return { ok: true, refundedCents: amount };
  } catch (e) {
    console.error("[issueRefundForTransaction] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Refund failed",
    };
  }
}

export async function startImpersonation(
  targetUserId: string,
  reason: string,
): Promise<{ ok: true; targetEmail: string }> {
  const me = await requireAdmin();

  if (me.impersonation) {
    throw new Error(
      "You're already impersonating — end the current session before starting a new one.",
    );
  }

  if (targetUserId === me.user.id) {
    throw new Error("You can't impersonate yourself.");
  }

  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new Error("Target user not found");
  if (target.role === "SUPER_ADMIN") {
    throw new Error("Cannot impersonate another super admin.");
  }
  if (target.status === "SUSPENDED") {
    throw new Error(
      "Cannot impersonate a suspended user — reinstate them first if you need to debug.",
    );
  }

  const session = await db.impersonationSession.create({
    data: {
      adminId: me.user.id,
      userId: targetUserId,
      reason: reason.trim() || null,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "USER_IMPERSONATED",
      targetType: "User",
      targetId: targetUserId,
      payload: {
        sessionId: session.id,
        targetEmail: target.email,
        reason: reason.trim() || null,
      } as Prisma.InputJsonValue,
    },
  });

  await setImpersonationCookie(session.id);
  revalidatePath("/", "layout");
  return { ok: true, targetEmail: target.email };
}

export async function endImpersonation(): Promise<{ ok: true }> {
  const { readImpersonationSessionId } = await import("@/lib/impersonation");
  const sessionId = await readImpersonationSessionId();
  if (!sessionId) {
    await clearImpersonationCookie();
    return { ok: true };
  }
  const session = await db.impersonationSession.findUnique({
    where: { id: sessionId },
  });
  if (session && !session.endedAt) {
    const startedMs = session.startedAt.getTime();
    await db.impersonationSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        actorId: session.adminId,
        action: "USER_IMPERSONATION_ENDED",
        targetType: "User",
        targetId: session.userId,
        payload: {
          sessionId: session.id,
          durationMs: Date.now() - startedMs,
        } as Prisma.InputJsonValue,
      },
    });
  }
  await clearImpersonationCookie();
  revalidatePath("/", "layout");
  return { ok: true };
}

export type AdminActivityRow = {
  id: string;
  kind: "PROPOSAL" | "USER";
  message: string;
  at: string;
};

export async function recentAdminActivity(): Promise<AdminActivityRow[]> {
  await requireAdmin();
  const recent = await db.proposalEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { proposal: { include: { user: true } } },
  });
  return recent.map((e) => ({
    id: e.id,
    kind: "PROPOSAL",
    message: `${e.proposal.user.email} · ${e.kind.toLowerCase().replace("_", " ")} on ${e.proposal.address}`,
    at: e.createdAt.toISOString(),
  }));
}
