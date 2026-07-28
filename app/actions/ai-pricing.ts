"use server";

import { getMe } from "./me";
import {
  PRICING_MODEL,
  suggestMarketPrices,
} from "@/lib/ai/price-suggestion";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import {
  checkAiSpendAllowed,
  estimateModelCostCents,
  recordSpend,
} from "@/lib/abuse/spend-guard";
import type { AiPriceQuote } from "@/lib/proposal-mock";
import type { EstimateConfig, Measurements } from "@/lib/types";

/**
 * ai-pricing.ts — the proposal builder's "AI recommended price" fetch.
 *
 * Thin authenticated wrapper around lib/ai/price-suggestion: the client
 * sends the job's address + footage and EVERY package's spec (all tiers
 * go to the client, so all tiers get priced in one AI call), each with
 * its own `inputKey` fingerprint; the action stamps the quotes so the
 * builder can cache them per package and detect staleness later.
 * Signed-in users only — the AI key never leaves the server.
 */

export type AiPricePackageInput = {
  id: string;
  name: string;
  config: EstimateConfig;
  /** Client-computed fingerprint of (address, spec, footage) — echoed
   *  back on the quote so the builder can tell when it goes stale. */
  inputKey: string;
};

export type AiPriceQuotesResult =
  | { ok: true; quotes: Record<string, AiPriceQuote> }
  | { ok: false; reason: string };

export async function getAiPriceQuotes(input: {
  address: string;
  measurements: Measurements;
  packages: AiPricePackageInput[];
}): Promise<AiPriceQuotesResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const address = (input.address ?? "").trim();
  if (!address) {
    return { ok: false, reason: "Add a property address first" };
  }
  if (
    !input.measurements ||
    !Number.isFinite(input.measurements.eaveLF) ||
    input.measurements.eaveLF <= 0
  ) {
    return { ok: false, reason: "Measurements are missing — add footage first" };
  }
  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    return { ok: false, reason: "No packages to price" };
  }

  // Layered cost protection: a per-user request bucket (fail-closed),
  // then the shared AI spend caps + circuit breaker BEFORE any tokens
  // are bought. One quote call prices the whole ladder, so legitimate
  // use is a handful per proposal — 15/hr is generous.
  const rl = await consumeLimit({
    policy: POLICIES.aiPricing,
    key: `ai-pricing:${me.user.id}`,
    context: { userId: me.user.id, route: "ai-pricing" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };
  const estCostCents = estimateModelCostCents(PRICING_MODEL, 4_000, 1_600);
  const spend = await checkAiSpendAllowed({
    userId: me.user.id,
    kind: "AI_PRICE_QUOTE",
    estCostCents,
    isAdmin: me.user.role === "SUPER_ADMIN",
  });
  if (!spend.ok) return { ok: false, reason: spend.reason };

  const res = await suggestMarketPrices({
    address,
    measurements: input.measurements,
    packages: input.packages.map((p) => ({
      id: p.id,
      name: p.name,
      config: p.config,
    })),
  });
  if (!res.ok) return res;

  // Meter the real tokens into the spend ledger — this is what the
  // hourly/daily caps, the circuit breaker and /admin/abuse read.
  await recordSpend({
    userId: me.user.id,
    kind: "AI_PRICE_QUOTE",
    provider: "anthropic",
    costCents: estimateModelCostCents(
      PRICING_MODEL,
      res.usage.inputTokens,
      res.usage.outputTokens,
    ),
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    meta: { packages: input.packages.length },
  });

  const fetchedAt = new Date().toISOString();
  const keyById = new Map(input.packages.map((p) => [p.id, p.inputKey]));
  const quotes: Record<string, AiPriceQuote> = {};
  for (const s of res.suggestion.packages) {
    quotes[s.packageId] = {
      recommendedTotal: s.recommendedTotal,
      lowTotal: s.lowTotal,
      highTotal: s.highTotal,
      perLfInstalled: s.perLfInstalled,
      lineItems:
        s.lineItems.length > 0
          ? Object.fromEntries(s.lineItems.map((li) => [li.id, li.price]))
          : undefined,
      reasoning: res.suggestion.reasoning,
      location: res.suggestion.location,
      fetchedAt,
      inputKey: keyById.get(s.packageId) ?? "",
    };
  }
  return { ok: true, quotes };
}
