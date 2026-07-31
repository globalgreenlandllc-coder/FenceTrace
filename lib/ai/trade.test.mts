/**
 * Pure node tests for the trade classifier that guards AI market pricing.
 * Run with: npx tsx --test lib/ai/trade.test.mts
 * No DB / AI / network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrade } from "./trade.ts";

const fence = { config: { fence: { type: "cedar-privacy" } } };
const gutter = { config: { size: 6, style: "k-style" } };

test("all-fence sets classify as fence", () => {
  assert.equal(classifyTrade([fence]), "fence");
  assert.equal(classifyTrade([fence, fence, fence]), "fence");
});

test("all-gutter sets classify as gutter", () => {
  assert.equal(classifyTrade([gutter]), "gutter");
  assert.equal(classifyTrade([gutter, gutter]), "gutter");
});

test("any mix is flagged, in either order", () => {
  assert.equal(classifyTrade([fence, gutter]), "mixed");
  assert.equal(classifyTrade([gutter, fence]), "mixed");
  assert.equal(classifyTrade([fence, fence, gutter]), "mixed");
  assert.equal(classifyTrade([gutter, gutter, fence]), "mixed");
});

test("a single gutter package among fence tiers does not read as fence", () => {
  // The bug this guards: `.some(p => p.config.fence)` was true here, so the
  // whole job took the fence prompt and the fence measurements header while
  // the gutter package still described downspouts and leaf guards.
  assert.notEqual(classifyTrade([fence, fence, gutter]), "fence");
});

test("empty sets fall back to gutter (callers reject empty first)", () => {
  assert.equal(classifyTrade([]), "gutter");
});

test("a falsy fence config counts as gutter, not fence", () => {
  assert.equal(classifyTrade([{ config: { fence: undefined } }]), "gutter");
  assert.equal(classifyTrade([{ config: { fence: null } }]), "gutter");
});
