import "server-only";
import Stripe from "stripe";
import { getActiveApiKey } from "@/lib/api-keys";

// Platform billing (FenceScan Pro subscriptions + credit packs).
// Keys come from the admin vault (/admin/api-keys) with env fallbacks,
// same resolution pattern as the AI providers:
//   STRIPE_SECRET  → sk_live_… / sk_test_…   (vault) | STRIPE_SECRET_KEY (env)
//   STRIPE_WEBHOOK → whsec_…                 (vault) | STRIPE_WEBHOOK_SECRET (env)
//
// Prices are defined inline (price_data) on each Checkout session, so
// no products need to be pre-created in the Stripe dashboard.
//
// PRO_PLAN and CREDIT_PACKS are the CODE DEFAULTS only — the effective
// values are resolved through lib/plan-pricing.ts getPlanPricing()
// (admin-editable at /admin/pricing). Checkout, the webhook, and every
// pricing display read from there; don't consume these directly.

export const PRO_PLAN = {
  id: "pro_monthly",
  name: "FenceScan Pro",
  // Founding-contractor launch price — the plan is worth $50 and the
  // landing badge says so; raise here (or at /admin/pricing, which
  // overrides this default) once traction justifies it.
  priceCents: 3900,
  includedCredits: 12,
} as const;

/** Free-plan monthly ceiling on SENT proposals (drafts are unlimited).
 *  Scanning stays free — sending a real quote to a real client is the
 *  money moment, so it's the fair place for the upgrade nudge. */
export const FREE_PROPOSALS_PER_MONTH = 3;

export type CreditPack = {
  id: string;
  credits: number;
  amountCents: number;
  blurb: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack10", credits: 10, amountCents: 4500, blurb: "$4.50 / estimate" },
  { id: "pack25", credits: 25, amountCents: 10000, blurb: "$4.00 / estimate" },
];

let cached: { key: string; client: Stripe } | null = null;

/** Vault-backed Stripe client. Null when no key is configured yet. */
export async function getStripe(): Promise<Stripe | null> {
  const key =
    (await getActiveApiKey("STRIPE_SECRET")) ??
    process.env.STRIPE_SECRET_KEY?.trim() ??
    null;
  if (!key) return null;
  if (cached?.key === key) return cached.client;
  const client = new Stripe(key);
  cached = { key, client };
  return client;
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  return (
    (await getActiveApiKey("STRIPE_WEBHOOK")) ??
    process.env.STRIPE_WEBHOOK_SECRET?.trim() ??
    null
  );
}

/* ------------------------------------------------------------------ */
/*  API-version drift helpers                                          */
/*                                                                     */
/*  Recent Stripe API versions moved a few fields around; these        */
/*  helpers read both shapes so the webhook stays correct regardless   */
/*  of the account's pinned version.                                   */
/* ------------------------------------------------------------------ */

/** current_period_end lives on the subscription item on newer API
 *  versions and on the subscription on older ones. Returns a Date. */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_end?: number })
    | undefined;
  const legacy = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const ts = item?.current_period_end ?? legacy;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

/** invoice.subscription moved to invoice.parent.subscription_details on
 *  newer API versions. Returns the subscription id, if any. */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const parent = (
    inv as unknown as {
      parent?: { subscription_details?: { subscription?: string | { id: string } } };
    }
  ).parent;
  const modern = parent?.subscription_details?.subscription;
  if (typeof modern === "string") return modern;
  if (modern && typeof modern === "object") return modern.id;
  const legacy = (inv as unknown as { subscription?: string | { id: string } })
    .subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object") return legacy.id;
  return null;
}

export function mapStripeSubStatus(
  s: Stripe.Subscription.Status,
): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  switch (s) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}
