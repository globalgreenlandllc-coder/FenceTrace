/**
 * Pure node tests for the public-portal proposal scrub. Run with:
 *   npx tsx --test lib/proposal-sanitize.test.mts
 * No DB, no AI, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packageTotal,
  sampleProposal,
  sanitizeProposalForClient,
  type AiPriceQuote,
  type Proposal,
} from "./proposal-mock.ts";

function proposalOnAiPricing(): Proposal {
  const quote: AiPriceQuote = {
    recommendedTotal: 9800,
    lowTotal: 8200,
    highTotal: 11500,
    perLfInstalled: 14,
    reasoning: ["Austin market runs $12–16/LF installed"],
    location: "Austin, TX",
    fetchedAt: "2026-07-20T00:00:00.000Z",
    inputKey: "key",
  };
  return {
    ...sampleProposal,
    packages: sampleProposal.packages.map((p) => ({
      ...p,
      pricingMode: "ai" as const,
      myMarkupPct: 35,
      aiQuote: quote,
      markupPct: 41.7, // back-solved to land on the AI total
    })),
  };
}

test("scrub strips every contractor-private pricing field", () => {
  const pub = sanitizeProposalForClient(proposalOnAiPricing());
  for (const p of pub.packages) {
    assert.equal("aiQuote" in p, false);
    assert.equal("myMarkupPct" in p, false);
    assert.equal("pricingMode" in p, false);
  }
  // Belt and braces: no AI-quote traces anywhere in the serialized
  // payload — this is exactly what the portal page ships to the browser.
  const json = JSON.stringify(pub);
  for (const needle of ["aiQuote", "myMarkupPct", "pricingMode", "8200", "11500", "Austin market"]) {
    assert.equal(json.includes(needle), false, `payload leaks "${needle}"`);
  }
});

test("scrub never changes the price the client is quoted", () => {
  const priced = proposalOnAiPricing();
  const pub = sanitizeProposalForClient(priced);
  for (let i = 0; i < priced.packages.length; i++) {
    const before = packageTotal(
      priced.packages[i],
      priced.measurements,
      priced.discountPct ?? 0,
    );
    const after = packageTotal(
      pub.packages[i],
      pub.measurements,
      pub.discountPct ?? 0,
    );
    assert.equal(after.total, before.total);
    assert.equal(after.subtotal, before.subtotal);
  }
});

test("manual-mode proposals pass through with totals intact", () => {
  const pub = sanitizeProposalForClient(sampleProposal);
  assert.equal(pub.packages.length, sampleProposal.packages.length);
  for (let i = 0; i < pub.packages.length; i++) {
    assert.equal(
      packageTotal(pub.packages[i], pub.measurements, pub.discountPct ?? 0)
        .total,
      packageTotal(
        sampleProposal.packages[i],
        sampleProposal.measurements,
        sampleProposal.discountPct ?? 0,
      ).total,
    );
  }
});
