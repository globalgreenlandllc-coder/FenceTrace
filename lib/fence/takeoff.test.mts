import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFenceTakeoff } from "./takeoff.ts";
import { priceFence, fenceTiers, layoutToPricingInputs } from "./pricing.ts";
import { packageTotal, blankProposal, FENCE_TAX_RATE } from "../proposal-mock.ts";

const CEDAR_100: Parameters<typeof computeFenceTakeoff>[0] = {
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

test("cedar 6' privacy, 100 net LF: sections, posts, pickets sane", () => {
  const t = computeFenceTakeoff(CEDAR_100);
  assert.equal(t.netFenceLf, 100); // gate opening excluded
  assert.equal(t.sections, 13); // ceil(100/8)
  assert.equal(t.posts.corner, 2);
  assert.equal(t.posts.end, 2);
  assert.equal(t.posts.gate, 2);
  assert.equal(t.posts.total, t.posts.line + 6);
  const pickets = t.bom.find((b) => b.key === "picket")!;
  // 100 LF × 12 / 5.5" pitch ≈ 218 × 1.1 waste ⇒ ~240 (no height scaling —
  // taller fences use LONGER pickets, not more)
  assert.ok(pickets.qty >= 230 && pickets.qty <= 260, `pickets=${pickets.qty}`);
  const tall = computeFenceTakeoff({ ...CEDAR_100, heightFt: 8 });
  assert.equal(tall.bom.find((b) => b.key === "picket")!.qty, pickets.qty);
  const concrete = t.bom.find((b) => b.key === "concrete")!;
  assert.ok(concrete.qty >= t.posts.total * 2 - 2, "2 bags per 6' post");
  assert.ok(t.laborHours > 30 && t.laborHours < 60, `hours=${t.laborHours}`);
});

test("per-run sections: three 34' runs need more sections than one 102' run", () => {
  const one = computeFenceTakeoff({ ...CEDAR_100, totalLf: 102, gatesSingle: 0 });
  const three = computeFenceTakeoff({
    ...CEDAR_100,
    totalLf: 102,
    gatesSingle: 0,
    runLengths: [34, 34, 34],
    ends: 6,
  });
  assert.equal(one.sections, 13);
  assert.equal(three.sections, 15); // ceil(34/8)=5 per run
  assert.equal(three.posts.end, 6);
});

test("closed ring (ends=0) carries no end posts", () => {
  const ring = computeFenceTakeoff({
    ...CEDAR_100,
    totalLf: 160,
    corners: 4,
    ends: 0,
    gatesSingle: 0,
  });
  assert.equal(ring.posts.end, 0);
});

test("gate openings subtract from fabric; double gate = 10 ft", () => {
  const withDouble = computeFenceTakeoff({
    ...CEDAR_100,
    totalLf: 110,
    gatesSingle: 0,
    gatesDouble: 1,
  });
  assert.equal(withDouble.netFenceLf, 100);
  assert.equal(withDouble.posts.gate, 2);
});

test("custom gates: width subtracts, posts + kit added, priced between anchors", () => {
  const t = computeFenceTakeoff({
    ...CEDAR_100,
    totalLf: 106,
    gatesSingle: 0,
    gatesDouble: 0,
    gatesCustomWidthsFt: [6],
  });
  assert.equal(t.netFenceLf, 100);
  assert.equal(t.posts.gate, 2);
  assert.ok(t.bom.some((b) => b.key === "gate-custom-0"));
  const p = priceFence({
    ...CEDAR_100,
    totalLf: 106,
    gatesSingle: 0,
    gatesDouble: 0,
    gatesCustomWidthsFt: [6],
  });
  const gateLine = p.lines.find((l) => l.key === "gate-custom-0")!;
  // 6' gate: between a 4' walk ($385) and a 10' drive ($924)
  assert.ok(gateLine.amount > 385 && gateLine.amount < 924, `got ${gateLine.amount}`);
});

test("shadowbox pickets ≈ double a solid face; chain-link bands only on terminals", () => {
  const solid = computeFenceTakeoff({ ...CEDAR_100, type: "cedar-privacy" });
  const shadow = computeFenceTakeoff({ ...CEDAR_100, type: "shadowbox" });
  const sp = solid.bom.find((b) => b.key === "picket")!.qty;
  const shp = shadow.bom.find((b) => b.key === "picket")!.qty;
  assert.ok(shp > sp * 1.2, `shadowbox ${shp} vs solid ${sp}`);

  const cl = computeFenceTakeoff({ ...CEDAR_100, type: "chain-link-galv", heightFt: 4 });
  assert.ok(!cl.bom.some((b) => b.key === "picket"));
  assert.ok(cl.bom.some((b) => b.key === "mesh"));
  const bands = cl.bom.find((b) => b.key === "tension-band")!;
  // terminals only: (2 ends + 2 corners + 2 gate posts) × 4ft/1.2 ⇒ 20
  assert.ok(bands.qty <= 24, `bands=${bands.qty} should not count line posts`);
});

test("stain only applies to stainable wood; removal adds a line", () => {
  const stained = computeFenceTakeoff({ ...CEDAR_100, stain: true, removalLf: 80 });
  assert.ok(stained.bom.some((b) => b.key === "stain"));
  assert.ok(stained.bom.some((b) => b.key === "removal"));
  const vinyl = computeFenceTakeoff({
    ...CEDAR_100,
    type: "vinyl-privacy",
    stain: true,
  });
  assert.ok(!vinyl.bom.some((b) => b.key === "stain"));
});

test("retaining wall: anchors replace concrete for wall-span posts", () => {
  const flat = computeFenceTakeoff(CEDAR_100);
  const wall = computeFenceTakeoff({ ...CEDAR_100, wallTopLf: 24 });
  // 24 LF at 8' spacing → 4 anchored posts
  const anchors = wall.bom.find((b) => b.key === "wall-anchor")!;
  assert.equal(anchors.qty, 4);
  assert.ok(!flat.bom.some((b) => b.key === "wall-anchor"));
  // those 4 posts lose their concrete (2 bags each at 6' height)…
  const cFlat = flat.bom.find((b) => b.key === "concrete")!.qty;
  const cWall = wall.bom.find((b) => b.key === "concrete")!.qty;
  assert.equal(cFlat - cWall, 8);
  // …and gain core-drill time
  assert.ok(wall.laborHours > flat.laborHours);
  // money: the wall-mount line prices on the proposal side too
  const priced = priceFence({ ...CEDAR_100, wallTopLf: 24 });
  const line = priced.lines.find((l) => l.key === "fence-wall-mount")!;
  assert.equal(line.amount, 4 * 72);
  assert.ok(priced.total > priceFence(CEDAR_100).total);
});

test("post upgrade: every post counted once, priced on both rails", () => {
  const base = computeFenceTakeoff(CEDAR_100);
  const steel = computeFenceTakeoff({ ...CEDAR_100, postUpgrade: "steel" });
  const up = steel.bom.find((b) => b.key === "post-upgrade")!;
  assert.equal(up.qty, base.posts.total);
  assert.ok(!base.bom.some((b) => b.key === "post-upgrade"));
  // money: the pricing rail mirrors the same post count
  const priced = priceFence({ ...CEDAR_100, postUpgrade: "steel" });
  const line = priced.lines.find((l) => l.key === "fence-post-upgrade")!;
  assert.equal(line.amount, base.posts.total * 24);
  const sixBySix = priceFence({ ...CEDAR_100, postUpgrade: "6x6" });
  assert.equal(
    sixBySix.lines.find((l) => l.key === "fence-post-upgrade")!.amount,
    base.posts.total * 14,
  );
});

test("PARITY: priceFence total === packageTotal for the same layout", () => {
  const layout = {
    ...CEDAR_100,
    stain: true,
    removalLf: 104,
    terrain: "rocky" as const,
    gatesCustomWidthsFt: [7],
    steppedSections: 3,
    wallTopLf: 16,
    postUpgrade: "steel" as const,
  };
  for (const markupPct of [30, 35, 38]) {
    const rail = priceFence(layout, { markupPct });
    const { measurements, config } = layoutToPricingInputs(layout);
    const blank = blankProposal();
    const pkg = { ...blank.packages[1], config, markupPct, addOns: [] };
    const proposal = packageTotal(pkg, measurements, 0);
    assert.ok(
      Math.abs(rail.total - proposal.total) < 0.02,
      `markup ${markupPct}: rail ${rail.total} vs proposal ${proposal.total}`,
    );
  }
});

test("priceFence: markup → discount → taxable-share tax order", () => {
  const p = priceFence(CEDAR_100, { markupPct: 40, discountPct: 10 });
  const afterMarkup = p.subtotal + p.markup;
  assert.ok(Math.abs(p.markup - p.subtotal * 0.4) < 0.02);
  assert.ok(Math.abs(p.discount - afterMarkup * 0.1) < 0.02);
  // tax must be BELOW full-base tax (labor is untaxed) and above zero
  const fullTax = (afterMarkup - p.discount) * FENCE_TAX_RATE;
  assert.ok(p.tax > 0 && p.tax < fullTax, `tax ${p.tax} < full ${fullTax}`);
  assert.ok(Math.abs(p.total - (afterMarkup - p.discount + p.tax)) < 0.02);
  assert.ok(p.pricePerLf > 0);
});

test("terrain multiplies labor only", () => {
  const flat = priceFence({ ...CEDAR_100, terrain: "flat" });
  const rocky = priceFence({ ...CEDAR_100, terrain: "rocky" });
  const flatLabor = flat.lines.find((l) => l.key === "fence-labor")!.amount;
  const rockyLabor = rocky.lines.find((l) => l.key === "fence-labor")!.amount;
  assert.ok(Math.abs(rockyLabor / flatLabor - 1.55) < 0.01);
  const flatMat = flat.lines.find((l) => l.key === "fence-materials")!.amount;
  const rockyMat = rocky.lines.find((l) => l.key === "fence-materials")!.amount;
  assert.equal(flatMat, rockyMat);
});

test("tiers: Good ≤ Better ≤ Best for a cedar design", () => {
  const tiers = fenceTiers("cedar-privacy");
  assert.equal(tiers.length, 3);
  assert.ok(tiers.find((t) => t.id === "better")!.recommended);
  const totals = tiers.map(
    (tier) =>
      priceFence(
        { ...CEDAR_100, type: tier.type, stain: tier.stain },
        { markupPct: tier.markupPct },
      ).total,
  );
  assert.ok(totals[0] < totals[1], `good ${totals[0]} < better ${totals[1]}`);
  assert.ok(totals[1] < totals[2], `better ${totals[1]} < best ${totals[2]}`);
});

test("zero-length layout prices to zero without NaN", () => {
  const p = priceFence({ ...CEDAR_100, totalLf: 4, gatesSingle: 1 });
  assert.equal(p.pricePerLf, 0);
  assert.ok(Number.isFinite(p.total));
});
