import "server-only";
import { db } from "@/lib/db";
import { CREDIT_PACKS, PRO_PLAN } from "@/lib/stripe";

// Subscription-plan pricing, admin-editable at /admin/pricing. (Not to
// be confused with lib/pricing.ts, the gutter-material unit prices.)
// The config lives in one PlatformSetting row (key "billing.pricing")
// as a JSON blob and is resolved DB-override → code default, the same
// contract as lib/ai/prompts.ts getPrompt(). Because checkout uses
// inline price_data (no Stripe Price objects exist), whatever this
// module returns IS what Stripe charges — no dashboard sync step.
//
// Two readers, two strictness levels:
//   getPlanPricing()        — runtime (checkout, webhook, landing page).
//                             Lenient: bad fields fall back per-field to
//                             the code default; never throws.
//   validatePricingInput()  — admin saves. Strict: returns errors so the
//                             editor can surface exactly what's wrong.
//
// The "N blueprint takeoffs every month" bullet is COMPUTED from
// includedCredits (see buildPricingView), never stored in features —
// otherwise editing the credit count would silently strand the copy.
//
// CREDIT MODEL (2026-07): credits meter BLUEPRINT takeoffs only — the
// most expensive action in the app (multi-Opus ensemble). Satellite
// address estimates are free on every plan (bounded by the abuse rails
// in lib/abuse, not by the wallet). The free plan includes a one-time
// allowance of `free.blueprintCredits` (default 1) that does NOT renew
// monthly; Pro refreshes `pro.includedCredits` every billing cycle.

export const PRICING_SETTING_KEY = "billing.pricing";

export type PricingPack = {
  id: string;
  credits: number;
  amountCents: number;
};

export type PlanPricing = {
  pro: {
    name: string;
    priceCents: number;
    includedCredits: number;
    /** Marketing bullets (landing card + settings). Count bullet is computed. */
    features: string[];
    /** Pill next to the price on the landing card. Empty = hidden. */
    badge: string;
  };
  free: {
    /** One-time blueprint takeoffs included on the free plan (no monthly renewal). */
    blueprintCredits: number;
  };
  packs: PricingPack[];
};

export const DEFAULT_PLAN_PRICING: PlanPricing = {
  pro: {
    name: PRO_PLAN.name,
    priceCents: PRO_PLAN.priceCents,
    includedCredits: PRO_PLAN.includedCredits,
    features: [
      "Unlimited satellite property scans",
      "Unlimited proposal sending",
      "Good · Better · Best proposal builder",
      "Branded client portal with e-sign",
      "Payment schedules, receipts & auto-reminders",
      "Change orders clients approve online",
      "Drag-and-drop job calendar + smart scheduling",
      "Crew assignments & worker portal",
      "Permit leads map with door-knock routes",
    ],
    badge: "Founding price — $50 after launch",
  },
  free: {
    blueprintCredits: 1,
  },
  packs: CREDIT_PACKS.map((p) => ({
    id: p.id,
    credits: p.credits,
    amountCents: p.amountCents,
  })),
};

/* ------------------------------------------------------------------ */
/*  Bounds — shared by the lenient and strict paths                    */
/* ------------------------------------------------------------------ */

const BOUNDS = {
  nameMax: 60,
  priceCentsMin: 100, // $1
  priceCentsMax: 100_000, // $1,000/mo
  creditsMin: 1,
  creditsMax: 1_000,
  featureMax: 140,
  featuresMax: 12,
  badgeMax: 40,
  packsMax: 6,
  packIdMax: 40,
  packCreditsMin: 1,
  packCreditsMax: 1_000,
  packAmountMin: 100, // $1
  packAmountMax: 500_000, // $5,000
  freeCreditsMin: 0, // 0 = no free blueprint takeoff
  freeCreditsMax: 100,
} as const;

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Lenient: unknown JSON → config, falling back per-field to defaults. */
function sanitizePricing(raw: unknown): PlanPricing {
  const d = DEFAULT_PLAN_PRICING;
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const pro = (o.pro ?? {}) as Record<string, unknown>;

  const name =
    typeof pro.name === "string" && pro.name.trim().length > 0
      ? pro.name.trim().slice(0, BOUNDS.nameMax)
      : d.pro.name;
  const priceCents = isIntIn(pro.priceCents, BOUNDS.priceCentsMin, BOUNDS.priceCentsMax)
    ? pro.priceCents
    : d.pro.priceCents;
  const includedCredits = isIntIn(pro.includedCredits, BOUNDS.creditsMin, BOUNDS.creditsMax)
    ? pro.includedCredits
    : d.pro.includedCredits;
  const badge =
    typeof pro.badge === "string" ? pro.badge.trim().slice(0, BOUNDS.badgeMax) : d.pro.badge;

  let features = d.pro.features;
  if (Array.isArray(pro.features)) {
    const cleaned = pro.features
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim().slice(0, BOUNDS.featureMax))
      .filter((f) => f.length > 0)
      .slice(0, BOUNDS.featuresMax);
    if (cleaned.length > 0) features = cleaned;
  }

  const free = (o.free ?? {}) as Record<string, unknown>;
  const blueprintCredits = isIntIn(
    free.blueprintCredits,
    BOUNDS.freeCreditsMin,
    BOUNDS.freeCreditsMax,
  )
    ? free.blueprintCredits
    : d.free.blueprintCredits;

  let packs = d.packs;
  if (Array.isArray(o.packs)) {
    const cleaned: PricingPack[] = [];
    const seen = new Set<string>();
    for (const p of o.packs.slice(0, BOUNDS.packsMax)) {
      if (!p || typeof p !== "object") continue;
      const pk = p as Record<string, unknown>;
      const id =
        typeof pk.id === "string" ? pk.id.trim().slice(0, BOUNDS.packIdMax) : "";
      if (!id || seen.has(id)) continue;
      if (!isIntIn(pk.credits, BOUNDS.packCreditsMin, BOUNDS.packCreditsMax)) continue;
      if (!isIntIn(pk.amountCents, BOUNDS.packAmountMin, BOUNDS.packAmountMax)) continue;
      seen.add(id);
      cleaned.push({ id, credits: pk.credits, amountCents: pk.amountCents });
    }
    // An explicitly-saved empty pack list is respected (packs are optional).
    packs = cleaned;
  }

  return {
    pro: { name, priceCents, includedCredits, features, badge },
    free: { blueprintCredits },
    packs,
  };
}

/** Strict: admin-save validation. Returns the config only when clean. */
export function validatePricingInput(raw: unknown): {
  config: PlanPricing | null;
  errors: string[];
} {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { config: null, errors: ["Pricing payload must be an object"] };
  }
  const o = raw as Record<string, unknown>;
  const pro = (o.pro ?? {}) as Record<string, unknown>;

  if (typeof pro.name !== "string" || pro.name.trim().length === 0) {
    errors.push("Plan name is required");
  } else if (pro.name.trim().length > BOUNDS.nameMax) {
    errors.push(`Plan name must be ≤ ${BOUNDS.nameMax} characters`);
  }
  if (!isIntIn(pro.priceCents, BOUNDS.priceCentsMin, BOUNDS.priceCentsMax)) {
    errors.push(
      `Monthly price must be between $${BOUNDS.priceCentsMin / 100} and $${BOUNDS.priceCentsMax / 100}`,
    );
  }
  if (!isIntIn(pro.includedCredits, BOUNDS.creditsMin, BOUNDS.creditsMax)) {
    errors.push(
      `Included takeoffs must be an integer between ${BOUNDS.creditsMin} and ${BOUNDS.creditsMax}`,
    );
  }
  if (typeof pro.badge !== "string") {
    errors.push("Badge must be text (empty hides it)");
  } else if (pro.badge.trim().length > BOUNDS.badgeMax) {
    errors.push(`Badge must be ≤ ${BOUNDS.badgeMax} characters`);
  }
  if (!Array.isArray(pro.features)) {
    errors.push("Features must be a list");
  } else {
    const cleaned = pro.features
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (cleaned.length === 0) errors.push("At least one feature bullet is required");
    if (cleaned.length > BOUNDS.featuresMax)
      errors.push(`At most ${BOUNDS.featuresMax} feature bullets`);
    if (cleaned.some((f) => f.length > BOUNDS.featureMax))
      errors.push(`Each feature must be ≤ ${BOUNDS.featureMax} characters`);
  }
  const free = (o.free ?? {}) as Record<string, unknown>;
  if (
    !isIntIn(free.blueprintCredits, BOUNDS.freeCreditsMin, BOUNDS.freeCreditsMax)
  ) {
    errors.push(
      `Free-plan takeoff credits must be an integer between ${BOUNDS.freeCreditsMin} and ${BOUNDS.freeCreditsMax}`,
    );
  }

  if (!Array.isArray(o.packs)) {
    errors.push("Credit packs must be a list (it can be empty)");
  } else {
    if (o.packs.length > BOUNDS.packsMax) errors.push(`At most ${BOUNDS.packsMax} credit packs`);
    const seen = new Set<string>();
    o.packs.forEach((p, i) => {
      const pk = (p ?? {}) as Record<string, unknown>;
      const label = `Pack ${i + 1}`;
      const id = typeof pk.id === "string" ? pk.id.trim() : "";
      if (!id) errors.push(`${label}: missing id`);
      else if (id.length > BOUNDS.packIdMax)
        errors.push(`${label}: id must be ≤ ${BOUNDS.packIdMax} characters`);
      else if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`);
      else seen.add(id);
      if (!isIntIn(pk.credits, BOUNDS.packCreditsMin, BOUNDS.packCreditsMax)) {
        errors.push(`${label}: credits must be 1–${BOUNDS.packCreditsMax}`);
      }
      if (!isIntIn(pk.amountCents, BOUNDS.packAmountMin, BOUNDS.packAmountMax)) {
        errors.push(
          `${label}: price must be between $${BOUNDS.packAmountMin / 100} and $${BOUNDS.packAmountMax / 100}`,
        );
      }
    });
  }

  if (errors.length > 0) return { config: null, errors };
  // Round-trip through the sanitizer so stored JSON is exactly canonical.
  return { config: sanitizePricing(raw), errors: [] };
}

/* ------------------------------------------------------------------ */
/*  Runtime read                                                       */
/* ------------------------------------------------------------------ */

/** Effective pricing: DB override merged over code defaults. Never throws. */
export async function getPlanPricing(): Promise<PlanPricing> {
  try {
    const row = await db.platformSetting.findUnique({
      where: { key: PRICING_SETTING_KEY },
    });
    if (!row) return DEFAULT_PLAN_PRICING;
    return sanitizePricing(row.value);
  } catch (e) {
    console.warn("[plan-pricing] read failed — using code defaults", e);
    return DEFAULT_PLAN_PRICING;
  }
}

/* ------------------------------------------------------------------ */
/*  Display helpers                                                    */
/* ------------------------------------------------------------------ */

export function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$4.50 / takeoff" — always computed, never stored (can't drift). */
export function packBlurb(pack: PricingPack): string {
  const per = pack.amountCents / pack.credits / 100;
  return `$${per.toFixed(2)} / takeoff`;
}

/** Serializable view for the public landing Pricing section. */
export type PricingView = {
  planName: string;
  priceLabel: string;
  badge: string;
  features: string[];
  /** One-time blueprint takeoffs on the free plan (for free-tier copy). */
  freeBlueprintCredits: number;
  packs: Array<{ qty: string; price: string; per: string }>;
};

export function buildPricingView(cfg: PlanPricing): PricingView {
  return {
    planName: cfg.pro.name,
    priceLabel: usd(cfg.pro.priceCents),
    badge: cfg.pro.badge,
    features: [
      ...cfg.pro.features,
    ],
    freeBlueprintCredits: cfg.free.blueprintCredits,
    packs: cfg.packs.map((p) => ({
      qty: `${p.credits} takeoffs`,
      price: usd(p.amountCents),
      per: packBlurb(p),
    })),
  };
}
