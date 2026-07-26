/**
 * Pure node tests for the price-negotiation math in proposal-mock:
 * discountPctForTargetTotal (the inverse used to apply an agreed price)
 * and marginForSaleTotalCents (the contractor's margin coach). Run with:
 *   npx tsx --test lib/discount-negotiation.test.mts
 * No DB, no AI, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sampleProposal,
  packageTotal,
  discountPctForTargetTotal,
  marginForSaleTotalCents,
  EFFECTIVE_TAX_RATE,
} from "./proposal-mock.ts";

const pkg = sampleProposal.packages[1]; // recommended "Pro Shield", 18% markup
const m = sampleProposal.measurements;
const list = packageTotal(pkg, m, 0).total; // list price at zero discount
const cost = packageTotal(pkg, m, 0).subtotal; // pre-markup cost basis

test("discountPctForTargetTotal round-trips through packageTotal", () => {
  // Ask for 10% off the list price → the derived pct must reproduce it.
  const target = list * 0.9;
  const pct = discountPctForTargetTotal(pkg, m, target);
  const back = packageTotal(pkg, m, pct).total;
  assert.ok(Math.abs(back - target) < 0.01, `expected ${target}, got ${back}`);
  assert.ok(pct > 9.9 && pct < 10.1, `pct should be ~10, got ${pct}`);
});

test("a target at the list price derives ~0% discount", () => {
  const pct = discountPctForTargetTotal(pkg, m, list);
  assert.ok(pct < 0.01, `expected ~0, got ${pct}`);
});

test("discount is clamped to 50% off — a deeper ask can't exceed it", () => {
  // Ask for 60% off (40% of list) → clamps to the 50% ceiling.
  const pct = discountPctForTargetTotal(pkg, m, list * 0.4);
  assert.equal(pct, 50);
});

test("the floor price (50% off base) maps to exactly 50% — no silent clamp", () => {
  // This is the invariant the ask-floor must honor: a target AT the floor
  // round-trips to exactly 50 (representable), and anything above the floor
  // is strictly under 50. If the ask floor were computed off a discounted
  // list instead of the base, a client could agree below this and get
  // silently clamped up (overbilled). Guards against that regression.
  const floor = packageTotal(pkg, m, 50).total; // 50% off base
  assert.ok(Math.abs(discountPctForTargetTotal(pkg, m, floor) - 50) < 1e-6);
  assert.ok(discountPctForTargetTotal(pkg, m, floor * 1.001) < 50);
  // A hair below the floor would need >50% off → clamps (the case the
  // ask-floor validation must reject before it ever reaches here).
  assert.equal(discountPctForTargetTotal(pkg, m, floor * 0.999), 50);
});

test("margin coach: at list price the contractor keeps a positive margin", () => {
  const saleCents = Math.round(list * 100);
  const costCents = Math.round(cost * 100);
  const mgn = marginForSaleTotalCents(saleCents, costCents);
  assert.equal(mgn.belowCost, false);
  assert.ok(mgn.marginCents > 0);
  // markup m% → margin fraction ≈ m / (100 + m), derived from the blank
  // package so re-tiering the template can't stale this test.
  const mk = pkg.markupPct;
  assert.ok(
    Math.abs(mgn.marginPct - mk / (100 + mk)) < 0.02,
    `marginPct ${mgn.marginPct} off expected ~${(mk / (100 + mk)).toFixed(4)}`,
  );
  // Revenue strips the effective tax back out of the sale total.
  assert.equal(mgn.revenueCents, Math.round(saleCents / (1 + EFFECTIVE_TAX_RATE)));
});

test("margin coach: selling at cost (pre-tax) flags below-cost", () => {
  // Sale total equal to the cost basis in cents → revenue < cost once tax
  // is stripped, so margin goes negative.
  const costCents = Math.round(cost * 100);
  const mgn = marginForSaleTotalCents(costCents, costCents);
  assert.equal(mgn.belowCost, true);
  assert.ok(mgn.marginCents < 0);
});

test("margin rises monotonically with the sale price", () => {
  const costCents = Math.round(cost * 100);
  const low = marginForSaleTotalCents(Math.round(list * 0.7 * 100), costCents);
  const high = marginForSaleTotalCents(Math.round(list * 100), costCents);
  assert.ok(high.marginCents > low.marginCents);
  assert.ok(high.marginPct > low.marginPct);
});
