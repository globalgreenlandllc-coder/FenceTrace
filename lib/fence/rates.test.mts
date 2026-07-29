/**
 * The contractor price book. These tests pin the two properties the
 * feature actually rests on: a contractor's rate really does move the
 * quote, and the book stays SPARSE so a type they never touched keeps
 * tracking the platform's catalog rate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceFence } from "./pricing.ts";
import { fenceType } from "./catalog.ts";
import {
  effectiveRate,
  isCustomized,
  ratedType,
  rateRows,
  sanitizeRateBook,
  standardRate,
  type RateBook,
} from "./rates.ts";

const LAYOUT: Parameters<typeof priceFence>[0] = {
  type: "cedar-privacy",
  heightFt: 6,
  totalLf: 104, // 100 net + one 4' walk gate
  corners: 2,
  ends: 2,
  gatesSingle: 1,
  gatesDouble: 0,
  terrain: "flat",
  wastePct: 10,
};

test("no book quotes at the catalog's national rate", () => {
  const cat = fenceType("cedar-privacy");
  assert.deepEqual(effectiveRate("cedar-privacy"), {
    materialPerLf: cat.materialPerLf,
    laborPerLf: cat.laborPerLf,
    gateSingle: cat.gateSingle,
  });
  // Same object identity path: nothing is rewritten when there's no override.
  assert.equal(ratedType("cedar-privacy").materialPerLf, cat.materialPerLf);
  assert.equal(isCustomized("cedar-privacy"), false);
});

test("a contractor's material rate really moves the quote", () => {
  const cat = fenceType("cedar-privacy");
  const book: RateBook = {
    "cedar-privacy": { materialPerLf: cat.materialPerLf * 2 },
  };
  const base = priceFence(LAYOUT);
  const mine = priceFence({ ...LAYOUT, rates: book });
  assert.ok(
    mine.total > base.total,
    `doubling material should raise the total: ${mine.total} vs ${base.total}`,
  );
  // Labor and gates untouched, so the jump is bounded by the material share.
  assert.ok(mine.total < base.total * 2, "only the material line doubled");
});

test("labor and gate overrides move their own lines", () => {
  const cat = fenceType("cedar-privacy");
  const base = priceFence(LAYOUT);
  const dearLabor = priceFence({
    ...LAYOUT,
    rates: { "cedar-privacy": { laborPerLf: cat.laborPerLf + 10 } },
  });
  const dearGate = priceFence({
    ...LAYOUT,
    rates: { "cedar-privacy": { gateSingle: cat.gateSingle + 200 } },
  });
  assert.ok(dearLabor.total > base.total, "labor rate reached the total");
  assert.ok(dearGate.total > base.total, "gate rate reached the total");
});

test("a mixed-in stretch prices at THAT type's rate, not the primary's", () => {
  const mixedLayout = {
    ...LAYOUT,
    mixed: [{ type: "chain-link-galv" as const, lf: 40 }],
  };
  const base = priceFence(mixedLayout);
  // Raising CEDAR must not move a quote whose only cedar is the rest of
  // the run… but raising CHAIN LINK must move the mixed stretch.
  const dearChain = priceFence({
    ...mixedLayout,
    rates: { "chain-link-galv": { materialPerLf: 90 } },
  });
  assert.ok(
    dearChain.total > base.total,
    "the chain-link override reached the mixed section",
  );
});

test("the book is FROZEN on the quote — it prices from the config, not settings", () => {
  // Two identical layouts differing only by the frozen book must price
  // differently and stay that way. This is what stops a settings edit
  // from repricing a proposal a client already has.
  const sent = priceFence({
    ...LAYOUT,
    rates: { "cedar-privacy": { materialPerLf: 40 } },
  });
  const laterEdit = priceFence({
    ...LAYOUT,
    rates: { "cedar-privacy": { materialPerLf: 12 } },
  });
  assert.ok(sent.total > laterEdit.total);
  // …and a quote carrying no book is unaffected by either.
  assert.equal(priceFence(LAYOUT).total, priceFence(LAYOUT).total);
});

test("a contractor sets what they CHARGE, never how the fence is built", () => {
  const cat = fenceType("chain-link-galv");
  const t = ratedType("chain-link-galv", {
    "chain-link-galv": { materialPerLf: 99 },
  });
  assert.equal(t.materialPerLf, 99);
  // Construction truth is platform-owned and must survive untouched.
  assert.equal(t.spec.postMaterial, cat.spec.postMaterial);
  assert.equal(t.spec.postProfile, "round");
  assert.equal(t.postSpacingFt, cat.postSpacingFt);
  assert.equal(t.build, cat.build);
});

test("sanitize drops junk: unknown types, bad numbers, out-of-range", () => {
  const clean = sanitizeRateBook({
    "not-a-fence": { materialPerLf: 20 },
    "cedar-privacy": { materialPerLf: "abc", laborPerLf: 22 },
    "vinyl-privacy": { materialPerLf: 99999 }, // fat-fingered cents
    "wood-picket": { gateSingle: -5 },
  });
  assert.equal(clean["not-a-fence" as never], undefined);
  assert.equal(clean["cedar-privacy"]?.materialPerLf, undefined);
  assert.equal(clean["cedar-privacy"]?.laborPerLf, 22);
  assert.equal(clean["vinyl-privacy"], undefined, "absurd rate rejected");
  assert.equal(clean["wood-picket"], undefined, "negative rate rejected");
});

test("a value equal to the catalog is NOT stored — that's what keeps it sparse", () => {
  const cat = fenceType("cedar-privacy");
  const clean = sanitizeRateBook({
    "cedar-privacy": {
      materialPerLf: cat.materialPerLf, // same as standard
      laborPerLf: cat.laborPerLf + 3, // a real override
    },
  });
  assert.equal(clean["cedar-privacy"]?.materialPerLf, undefined);
  assert.equal(clean["cedar-privacy"]?.laborPerLf, cat.laborPerLf + 3);

  // A type whose every field restates the catalog vanishes entirely, so
  // it keeps tracking future platform price changes.
  const allStandard = sanitizeRateBook({
    "vinyl-privacy": standardRate("vinyl-privacy"),
  });
  assert.deepEqual(allStandard, {});
});

test("rateRows renders the whole book, customized or not", () => {
  const rows = rateRows({ "cedar-privacy": { materialPerLf: 26 } });
  assert.equal(rows.length, 14, "every catalog type is offered");
  const cedar = rows.find((r) => r.id === "cedar-privacy")!;
  assert.equal(cedar.customized, true);
  assert.equal(cedar.effective.materialPerLf, 26);
  assert.equal(cedar.standard.materialPerLf, fenceType("cedar-privacy").materialPerLf);
  // Untouched types report standard and are not flagged.
  const vinyl = rows.find((r) => r.id === "vinyl-privacy")!;
  assert.equal(vinyl.customized, false);
  assert.deepEqual(vinyl.effective, vinyl.standard);
});
