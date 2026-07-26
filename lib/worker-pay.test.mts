import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveEstimateSource,
  resolvePayBase,
  computePayCents,
} from "./worker-pay.ts";

test("deriveEstimateSource: null when there's no priced estimate", () => {
  assert.equal(deriveEstimateSource({ takeoff: { aerial: {} } }, 0), null);
  assert.equal(deriveEstimateSource({}, -100), null);
});

test("deriveEstimateSource: manual tape-measure wins on source flag", () => {
  assert.equal(
    deriveEstimateSource({ source: "manual", takeoff: { aerial: {} } }, 500000),
    "manual",
  );
});

test("deriveEstimateSource: top-level planId ⇒ blueprint", () => {
  assert.equal(deriveEstimateSource({ planId: "pln_1" }, 500000), "blueprint");
  // planId lives ONLY at the top level of the data blob (see
  // saveDraftFromEstimate) — a takeoff-nested planId is not a real shape and
  // must not be treated as one.
  assert.equal(
    deriveEstimateSource({ takeoff: { planId: "pln_1" } }, 500000),
    "estimate",
  );
});

test("deriveEstimateSource: aerial imagery ⇒ satellite", () => {
  assert.equal(
    deriveEstimateSource({ takeoff: { aerial: { imageDataUrl: "x" } } }, 500000),
    "satellite",
  );
});

test("deriveEstimateSource: priced but no telltale ⇒ generic estimate", () => {
  assert.equal(deriveEstimateSource({ packages: [] }, 500000), "estimate");
});

test("resolvePayBase: an uploaded invoice overrides the proposal estimate", () => {
  assert.deepEqual(
    resolvePayBase({ invoiceTotalCents: 120000, proposalBaseCents: 500000 }),
    { baseCents: 120000, baseSource: "invoice" },
  );
});

test("resolvePayBase: falls back to the proposal estimate when no invoice", () => {
  assert.deepEqual(
    resolvePayBase({ invoiceTotalCents: null, proposalBaseCents: 500000 }),
    { baseCents: 500000, baseSource: "estimate" },
  );
});

test("resolvePayBase: null base when neither source is present", () => {
  assert.deepEqual(resolvePayBase({}), { baseCents: null, baseSource: null });
  // Zero/negative are not usable bases.
  assert.deepEqual(resolvePayBase({ invoiceTotalCents: 0, proposalBaseCents: 0 }), {
    baseCents: null,
    baseSource: null,
  });
});

test("computePayCents: pct of base, rounded to cents", () => {
  assert.equal(computePayCents(500000, 40), 200000); // 40% of $5,000 = $2,000
  assert.equal(computePayCents(123456, 12.5), 15432); // rounds 15432.0
});

test("computePayCents: pct is capped at 100 — never pays more than the base", () => {
  assert.equal(computePayCents(500000, 250), 500000); // fat-fingered 250% → 100%
  assert.equal(computePayCents(500000, 100), 500000);
});

test("computePayCents: null when base or pct doesn't drive a pay", () => {
  assert.equal(computePayCents(null, 40), null);
  assert.equal(computePayCents(500000, 0), null);
  assert.equal(computePayCents(500000, NaN), null);
  assert.equal(computePayCents(0, 40), null);
});
