"use server";

import { db } from "@/lib/db";
import { FREE_PROPOSALS_PER_MONTH } from "@/lib/stripe";
import { PRO_PLAN, getStripe } from "@/lib/stripe";
import { getPlanPricing, packBlurb } from "@/lib/plan-pricing";
import { getMe, type MeData } from "./me";

/* ------------------------------------------------------------------ */
/*  Read: billing state for the settings page                          */
/* ------------------------------------------------------------------ */

export type BillingPack = {
  id: string;
  credits: number;
  amountCents: number;
  blurb: string;
};

export type MyBilling = {
  /** False until an admin adds STRIPE_SECRET to the key vault. */
  configured: boolean;
  plan: {
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  packs: BillingPack[];
  proName: string;
  proPriceCents: number;
  /** Pro's monthly blueprint-takeoff allowance (plan config, not the wallet). */
  includedCredits: number;
  /** One-time blueprint takeoffs on the free plan. */
  freeBlueprintCredits: number;
  /** The caller's actual wallet — same shape the session carries. */
  wallet: MeData["credits"];
  features: string[];
  recentTopups: Array<{ id: string; description: string; amountCents: number; at: string }>;
  /** Proposals sent this calendar month — the number the free plan caps. */
  sentThisMonth: number;
  freeSendCap: number;
};

export async function getMyBilling(): Promise<MyBilling | null> {
  const me = await getMe();
  if (!me) return null;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [stripe, pricing, sub, topups, sentThisMonth] = await Promise.all([
    getStripe(),
    getPlanPricing(),
    db.subscription.findUnique({ where: { userId: me.user.id } }),
    db.transaction.findMany({
      where: { userId: me.user.id, type: "CREDIT_TOPUP", status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, description: true, grossCents: true, createdAt: true },
    }),
    db.proposal.count({
      where: { userId: me.user.id, sentAt: { gte: monthStart } },
    }),
  ]);
  return {
    configured: !!stripe,
    plan: sub
      ? {
          status: sub.status,
          renewsAt: sub.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
    packs: pricing.packs.map((p) => ({ ...p, blurb: packBlurb(p) })),
    proName: pricing.pro.name,
    proPriceCents: pricing.pro.priceCents,
    includedCredits: pricing.pro.includedCredits,
    freeBlueprintCredits: pricing.free.blueprintCredits,
    wallet: me.credits,
    features: pricing.pro.features,
    recentTopups: topups.map((t) => ({
      id: t.id,
      description: t.description ?? "Credit top-up",
      amountCents: t.grossCents,
      at: t.createdAt.toISOString(),
    })),
    sentThisMonth,
    freeSendCap: FREE_PROPOSALS_PER_MONTH,
  };
}

/* ------------------------------------------------------------------ */
/*  Checkout: Pro subscription + credit packs                          */
/* ------------------------------------------------------------------ */

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Finds or creates the Stripe customer for this user, persisting the
 *  id on the Subscription row (created as INCOMPLETE if absent). */
async function ensureStripeCustomer(
  userId: string,
  email: string,
  name: string,
): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");
  const existing = await db.subscription.findUnique({
    where: { userId },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { userId },
  });
  await db.subscription.upsert({
    where: { userId },
    create: {
      userId,
      status: "INCOMPLETE",
      planId: PRO_PLAN.id,
      stripeCustomerId: customer.id,
    },
    update: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createSubscriptionCheckout(
  interval: "month" | "year" = "month",
): Promise<CheckoutResult> {
  // Yearly is DERIVED, not configured: 10× the admin-set monthly price,
  // i.e. two months free by construction — it can never drift out of
  // sync when the monthly price is edited at /admin/pricing.
  const billingInterval = interval === "year" ? "year" : "month";
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const stripe = await getStripe();
    if (!stripe) {
      return {
        ok: false,
        reason:
          "Payments aren't configured yet — add a Stripe secret key in /admin/api-keys.",
      };
    }
    const sub = await db.subscription.findUnique({
      where: { userId: me.user.id },
    });
    if (sub?.status === "ACTIVE" || sub?.status === "PAST_DUE") {
      return { ok: false, reason: "You already have an active plan — use Manage plan." };
    }

    const customerId = await ensureStripeCustomer(
      me.user.id,
      me.user.email,
      me.profile.contractorName || me.user.name,
    );
    const pricing = await getPlanPricing();
    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: me.user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount:
              billingInterval === "year"
                ? pricing.pro.priceCents * 10
                : pricing.pro.priceCents,
            recurring: { interval: billingInterval },
            product_data: {
              name:
                billingInterval === "year"
                  ? `${pricing.pro.name} (annual — 2 months free)`
                  : pricing.pro.name,
              description:
                "Unlimited proposals · e-sign, scheduling, payments & crew tools",
            },
          },
        },
      ],
      subscription_data: { metadata: { userId: me.user.id } },
      metadata: { userId: me.user.id, kind: "subscription", interval: billingInterval },
      allow_promotion_codes: true,
      success_url: `${base}/dashboard/settings?billing=success`,
      cancel_url: `${base}/dashboard/settings?billing=cancelled`,
    });
    if (!session.url) return { ok: false, reason: "Stripe returned no checkout URL" };
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[createSubscriptionCheckout] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't start checkout",
    };
  }
}

export async function createCreditsCheckout(
  _packId: string,
): Promise<CheckoutResult> {
  // FenceScan sells ONE thing: Pro (unlimited proposal sending).
  // Blueprint credits metered a feature the fence platform doesn't
  // have — never let anyone pay for them. The full checkout body lives
  // in git history; re-enable only alongside a real credit-metered
  // feature.
  return {
    ok: false,
    reason:
      "Credit top-ups aren't a FenceScan thing — scans and takeoffs are free, and Pro is unlimited proposals.",
  };
}

export async function openBillingPortal(): Promise<CheckoutResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const stripe = await getStripe();
    if (!stripe) return { ok: false, reason: "Payments aren't configured yet" };
    const sub = await db.subscription.findUnique({
      where: { userId: me.user.id },
      select: { stripeCustomerId: true },
    });
    if (!sub?.stripeCustomerId) {
      return { ok: false, reason: "No billing profile yet — upgrade first." };
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appBaseUrl()}/dashboard/settings`,
    });
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[openBillingPortal] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't open the billing portal",
    };
  }
}
