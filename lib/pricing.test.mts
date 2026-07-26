/**
 * Pure node tests for the BOM builder's 2026-07 additions: standard
 * downspout hardware (outlets / straps / splash blocks) and the
 * old-gutter-removal line (FREE marketing line vs priced tear-off).
 * The invariant that matters most: a LEGACY config (no
 * `oldGutterRemoval` key — every proposal sent before the feature)
 * must produce the exact same BOM it always did, because portals
 * recompute totals live on every view. Run with:
 *   npx tsx --test lib/pricing.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLineItems,
  removalValueDollars,
  REMOVAL_PRICE_PER_LF,
} from "./pricing.ts";
import type { EstimateConfig, Measurements } from "./types.ts";

const m: Measurements = {
  eaveLF: 148,
  rakeLF: 40,
  outsideCorners: 4,
  insideCorners: 1,
  endCaps: 6,
  downspoutCount: 5,
  stories: 1,
  wasteFactorPct: 8,
};

const legacyConfig: EstimateConfig = {
  size: "6",
  style: "k-style",
  material: "aluminum",
  color: "white",
  downspoutSize: "3x4",
};

const ids = (cfg: EstimateConfig, mm: Measurements = m) =>
  buildLineItems(mm, cfg).map((i) => i.id);

test("legacy config (no oldGutterRemoval) builds the exact pre-feature BOM", () => {
  assert.deepEqual(ids(legacyConfig), [
    "gutter",
    "downspouts",
    "outside-corners",
    "inside-corners",
    "end-caps",
    "hangers",
    "elbows",
    "labor",
  ]);
  const labor = buildLineItems(m, legacyConfig).find((i) => i.id === "labor")!;
  assert.match(labor.description!, /Removal of existing/);
});

test("modern config adds outlets, straps and splash blocks with real quantities", () => {
  const cfg: EstimateConfig = { ...legacyConfig, oldGutterRemoval: "none" };
  const items = buildLineItems(m, cfg);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId["outlets"].quantity, 5);
  assert.equal(byId["straps"].quantity, 5 * (m.stories + 1));
  assert.equal(byId["splash-blocks"].quantity, 5);
  // stories drive strap count
  const threeStory = buildLineItems({ ...m, stories: 3 }, cfg);
  assert.equal(threeStory.find((i) => i.id === "straps")!.quantity, 5 * 4);
});

test('removal "free" is a $0 line naming the real value — total unchanged vs "none"', () => {
  const none = buildLineItems(m, { ...legacyConfig, oldGutterRemoval: "none" });
  const free = buildLineItems(m, { ...legacyConfig, oldGutterRemoval: "free" });
  const removal = free.find((i) => i.id === "removal")!;
  assert.equal(removal.unitPrice, 0);
  assert.match(removal.name, /FREE/);
  assert.match(removal.description!, new RegExp(`\\$${removalValueDollars(m.eaveLF)} value`));
  const sum = (xs: typeof none) => xs.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  assert.equal(sum(free), sum(none), "a FREE line must never change the total");
  // Labor stops claiming removal once the line exists
  assert.doesNotMatch(free.find((i) => i.id === "labor")!.description!, /Removal/);
});

test('removal "priced" bills the eave LF at the tear-off rate', () => {
  const none = buildLineItems(m, { ...legacyConfig, oldGutterRemoval: "none" });
  const priced = buildLineItems(m, { ...legacyConfig, oldGutterRemoval: "priced" });
  const removal = priced.find((i) => i.id === "removal")!;
  assert.equal(removal.quantity, m.eaveLF);
  assert.equal(removal.unitPrice, REMOVAL_PRICE_PER_LF);
  const sum = (xs: typeof none) => xs.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  assert.equal(sum(priced) - sum(none), m.eaveLF * REMOVAL_PRICE_PER_LF);
});

test("zero-eave measurements never emit a removal line", () => {
  const items = buildLineItems(
    { ...m, eaveLF: 0 },
    { ...legacyConfig, oldGutterRemoval: "free" },
  );
  assert.equal(items.find((i) => i.id === "removal"), undefined);
});

test("removal value rounds to a clean $5 step", () => {
  assert.equal(removalValueDollars(148) % 5, 0);
  assert.equal(removalValueDollars(1), 5); // floor
});
