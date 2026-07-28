/**
 * Pure node tests for refund bookkeeping math. Run with:
 *   npx tsx --test lib/refund-math.test.mts
 * No DB, no Stripe, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRefundDelta, computeCreditClawback } from "./refund-math.ts";

test("full refund books the full charge once", () => {
  const delta = computeRefundDelta({
    amountRefundedCents: 4500,
    alreadyBookedCents: 0,
    originalGrossCents: 4500,
  });
  assert.equal(delta, 4500);
});

test("webhook retry of an already-booked refund is a no-op", () => {
  const delta = computeRefundDelta({
    amountRefundedCents: 4500,
    alreadyBookedCents: 4500,
    originalGrossCents: 4500,
  });
  assert.ok(delta <= 0);
});

test("partial refunds book incrementally, never past the charge", () => {
  // First partial: $10 of a $45 pack.
  const first = computeRefundDelta({
    amountRefundedCents: 1000,
    alreadyBookedCents: 0,
    originalGrossCents: 4500,
  });
  assert.equal(first, 1000);
  // Second partial: cumulative $30 → books the $20 difference.
  const second = computeRefundDelta({
    amountRefundedCents: 3000,
    alreadyBookedCents: 1000,
    originalGrossCents: 4500,
  });
  assert.equal(second, 2000);
});

test("a refund larger than the charge is clamped to what was paid", () => {
  // Should be impossible on Stripe's side; the clamp is defense in depth.
  const delta = computeRefundDelta({
    amountRefundedCents: 99_000,
    alreadyBookedCents: 0,
    originalGrossCents: 4500,
  });
  assert.equal(delta, 4500);
  // And a follow-up delivery of the same inflated amount books nothing.
  const retry = computeRefundDelta({
    amountRefundedCents: 99_000,
    alreadyBookedCents: 4500,
    originalGrossCents: 4500,
  });
  assert.ok(retry <= 0);
});

test("full pack refund claws back every granted credit", () => {
  const claw = computeCreditClawback({
    description: "10 blueprint credits",
    deltaCents: 4500,
    originalGrossCents: 4500,
  });
  assert.equal(claw, 10);
});

test("half refund claws back half the credits", () => {
  const claw = computeCreditClawback({
    description: "10 blueprint credits",
    deltaCents: 2250,
    originalGrossCents: 4500,
  });
  assert.equal(claw, 5);
});

test("non-pack descriptions claw back nothing", () => {
  assert.equal(
    computeCreditClawback({
      description: "FenceScan Pro — monthly",
      deltaCents: 3900,
      originalGrossCents: 3900,
    }),
    0,
  );
  assert.equal(
    computeCreditClawback({
      description: null,
      deltaCents: 3900,
      originalGrossCents: 3900,
    }),
    0,
  );
});
