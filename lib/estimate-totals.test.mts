/**
 * Pure node tests for the estimate totals + the AI-market-price back-solve.
 * Run: npx tsx --test lib/estimate-totals.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEstimateTotals,
  markupForEstimateTarget,
} from "./estimate-totals.ts";
import type { LineItem } from "./types.ts";

const items: LineItem[] = [
  { id: "a", name: "Gutter", quantity: 100, unit: "lf", unitPrice: 10, taxable: true },
  { id: "b", name: "Labor", quantity: 1, unit: "lot", unitPrice: 1500, taxable: false },
  { id: "c", name: "Downspout", quantity: 40, unit: "lf", unitPrice: 5, taxable: true },
];

test("markupForEstimateTarget round-trips through computeEstimateTotals", () => {
  for (const target of [3000, 5000, 8756.52, 12000]) {
    for (const discountPct of [0, 10]) {
      for (const taxPct of [0, 8.25]) {
        const m = markupForEstimateTarget(target, items, discountPct, taxPct);
        const total = computeEstimateTotals(items, {
          markupPct: m,
          discountPct,
          taxPct,
        }).total;
        assert.ok(
          Math.abs(total - target) < 0.01,
          `target ${target} d=${discountPct} t=${taxPct}: got ${total.toFixed(2)} (markup ${m.toFixed(3)}%)`,
        );
      }
    }
  }
});

test("markupForEstimateTarget: non-positive base or target → 0 (no divide-by-zero)", () => {
  assert.equal(markupForEstimateTarget(5000, [], 0, 8.25), 0);
  assert.equal(markupForEstimateTarget(0, items, 0, 8.25), 0);
  assert.equal(
    markupForEstimateTarget(5000, [{ id: "z", name: "free", quantity: 1, unit: "lot", unitPrice: 0, taxable: false }], 0, 8.25),
    0,
  );
});

test("a target below cost basis yields a negative markup (a discount to market)", () => {
  // Cost subtotal = 100*10 + 1500 + 40*5 = 2700. Target 2000 < 2700.
  const m = markupForEstimateTarget(2000, items, 0, 0);
  assert.ok(m < 0, `expected negative markup, got ${m}`);
  assert.ok(Math.abs(computeEstimateTotals(items, { markupPct: m, discountPct: 0, taxPct: 0 }).total - 2000) < 0.01);
});
