import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFenceTakeoff } from "./takeoff.ts";
import { priceFence, fenceTiers, layoutToPricingInputs } from "./pricing.ts";
import { packageTotal, blankProposal, FENCE_TAX_RATE } from "../proposal-mock.ts";
import { resolveMarket } from "./market.ts";
import { burialFt } from "./slope.ts";
import { fenceClientScope } from "./scope.ts";

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
  // Volume-based: a 6' post in a 10-12" hole at 2' burial runs ~2.5-3
  // bags — the crew must never run out of mix mid-job.
  assert.ok(
    concrete.qty >= t.posts.total * 2 && concrete.qty <= t.posts.total * 3.5,
    `bags=${concrete.qty} for ${t.posts.total} posts`,
  );
  // ~4.5 LF/person-hour stick production: a 3-man crew does 100 LF in
  // a day, not two.
  assert.ok(t.laborHours > 15 && t.laborHours < 40, `hours=${t.laborHours}`);
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
  // those 4 posts lose their concrete (~2.5 volume-based bags each)…
  const cFlat = flat.bom.find((b) => b.key === "concrete")!.qty;
  const cWall = wall.bom.find((b) => b.key === "concrete")!.qty;
  assert.ok(
    cFlat - cWall >= 4 * 2 && cFlat - cWall <= 4 * 3.5,
    `bag credit=${cFlat - cWall}`,
  );
  // …and gain core-drill time
  assert.ok(wall.laborHours > flat.laborHours);
  // money: the wall-mount line prices on the proposal side too — and
  // the $/LF line's dug-footing share comes BACK off as a visible
  // credit, so the client never pays for concrete that isn't poured.
  const priced = priceFence({ ...CEDAR_100, wallTopLf: 24 });
  const line = priced.lines.find((l) => l.key === "fence-wall-mount")!;
  assert.equal(line.amount, 4 * 72);
  const credit = priced.lines.find((l) => l.key === "fence-wall-credit")!;
  assert.ok(credit.amount < 0, "footing credit is a deduction");
  assert.ok(Math.abs(credit.amount) < line.amount, "anchors still net positive");
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

test("mixed-type sections: footage carved out, priced at own rates", () => {
  const base = computeFenceTakeoff(CEDAR_100);
  const mix = computeFenceTakeoff({
    ...CEDAR_100,
    mixed: [{ type: "chain-link-galv", lf: 24 }],
  });
  // total fabric unchanged; the chain-link block appears in the BOM
  assert.equal(mix.netFenceLf, base.netFenceLf);
  assert.ok(mix.bom.some((b) => b.key === "mix-chain-link-galv-mesh"));
  // primary pickets shrink (24 LF of the run is no longer cedar)
  const pk = (t: ReturnType<typeof computeFenceTakeoff>) =>
    t.bom.find((b) => b.key === "picket")!.qty;
  assert.ok(pk(mix) < pk(base));
  // pricing rail: chain-link lines present, cedar footage reduced
  const priced = priceFence({
    ...CEDAR_100,
    mixed: [{ type: "chain-link-galv", lf: 24 }],
  });
  assert.ok(priced.lines.some((l) => l.key === "fence-mixed-chain-link-galv"));
  const cedarLf = priced.lines.find((l) => l.key === "fence-materials")!;
  assert.equal(cedarLf.amount > 0, true);
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
    mixed: [{ type: "chain-link-galv" as const, lf: 20 }],
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

test("bucket adjusters: labor +20% moves labor only; tax is untouched", async () => {
  const { blankProposal, packageClientBreakdown } = await import("../proposal-mock.ts");
  const blank = blankProposal();
  const pkg = blank.packages[1]!;
  const before = packageClientBreakdown(pkg, blank.measurements, 0);
  const after = packageClientBreakdown(
    { ...pkg, laborAdjPct: 20 },
    blank.measurements,
    0,
  );
  // labor bucket up ~20%, materials identical
  assert.ok(after.labor > before.labor * 1.15, `${after.labor} vs ${before.labor}`);
  assert.ok(Math.abs(after.materials - before.materials) < 1.5);
  // labor is untaxed — the tax embedded in the total must not move
  assert.ok(Math.abs(after.tax - before.tax) < 0.02, `${after.tax} vs ${before.tax}`);
  assert.ok(after.total > before.total);
  // materials +10% raises the materials bucket AND the tax with it
  const mat = packageClientBreakdown(
    { ...pkg, materialsAdjPct: 10 },
    blank.measurements,
    0,
  );
  assert.ok(mat.materials > before.materials * 1.05);
  assert.ok(mat.tax > before.tax);
  // clamped: ±50 max
  const wild = packageClientBreakdown(
    { ...pkg, laborAdjPct: 500 },
    blank.measurements,
    0,
  );
  const capped = packageClientBreakdown(
    { ...pkg, laborAdjPct: 50 },
    blank.measurements,
    0,
  );
  assert.ok(Math.abs(wild.total - capped.total) < 0.02);
});

test("post spacing override: tighter spacing = more posts; panels ignore it", () => {
  const std = computeFenceTakeoff(CEDAR_100);
  const tight = computeFenceTakeoff({ ...CEDAR_100, postSpacingFt: 4 });
  // 8' → 4' o.c. roughly doubles the sections on the same footage.
  assert.ok(
    tight.sections >= std.sections * 1.8,
    `4' o.c. should ~double sections: ${tight.sections} vs ${std.sections}`,
  );
  assert.ok(tight.posts.total > std.posts.total, "more posts at tighter spacing");
  assert.ok(
    tight.bom.find((b) => b.key === "post-line")!.label.includes("4'"),
    "BOM label names the chosen spacing",
  );
  // Junk values fall back to the catalog spacing.
  const junk = computeFenceTakeoff({ ...CEDAR_100, postSpacingFt: 99 });
  assert.equal(junk.sections, std.sections);
  // Prefab panel systems keep their fixed section width.
  const vinyl = computeFenceTakeoff({ ...CEDAR_100, type: "vinyl-privacy", heightFt: 6 });
  const vinylTight = computeFenceTakeoff({ ...CEDAR_100, type: "vinyl-privacy", heightFt: 6, postSpacingFt: 4 });
  assert.equal(vinylTight.sections, vinyl.sections, "panels ignore the override");
});

/* ------------- the fixes the 2026-08 engine audit forced ------------- */

test("tighter post spacing raises the PRICE, not just the BOM", () => {
  const std = priceFence(CEDAR_100);
  const tight = priceFence({ ...CEDAR_100, postSpacingFt: 4 });
  // Doubling the posts is ~25% material / ~30% labor on the post share.
  assert.ok(tight.total > std.total * 1.1, `${tight.total} vs ${std.total}`);
  assert.ok(tight.total < std.total * 1.5, "but nowhere near double");
  // Panels ignore the override in dollars exactly as they do in quantities.
  const vinyl = priceFence({ ...CEDAR_100, type: "vinyl-privacy" });
  const vinylTight = priceFence({ ...CEDAR_100, type: "vinyl-privacy", postSpacingFt: 4 });
  assert.equal(vinyl.total, vinylTight.total);
});

test("frost country digs deeper and buys more concrete", () => {
  const dallas = resolveMarket({ state: "TX" }); // 6" frost line
  const fargo = resolveMarket({ state: "ND" }); // 48" frost line
  const south = computeFenceTakeoff({ ...CEDAR_100, market: dallas });
  const north = computeFenceTakeoff({ ...CEDAR_100, market: fargo });
  const cS = south.bom.find((b) => b.key === "concrete")!.qty;
  const cN = north.bom.find((b) => b.key === "concrete")!.qty;
  // 4' burial vs 2' burial ≈ double the mix.
  assert.ok(cN >= cS * 1.7, `Fargo ${cN} bags vs Dallas ${cS}`);
  // …and the frost line rides on the snapshot for the burial math.
  assert.equal(fargo.frostIn, 48);
  assert.equal(burialFt(6, 48), 4);
  assert.equal(burialFt(6, 0), 2);
});

test("a tiny job floors at the mobilization minimum", () => {
  // 8 LF of bare fence ≈ $290 of work — under the $450 truck-roll floor.
  const tiny = priceFence({
    ...CEDAR_100,
    totalLf: 8,
    corners: 0,
    gatesSingle: 0,
  });
  const line = tiny.lines.find((l) => l.key === "fence-job-minimum");
  assert.ok(line, "minimum line present on a sub-$450 job");
  const subtotal = tiny.lines.reduce((a, l) => a + l.amount, 0);
  assert.ok(Math.abs(subtotal - 450) < 1, `floors at 450, got ${subtotal}`);
  // A real-size job never sees the line.
  const normal = priceFence(CEDAR_100);
  assert.ok(!normal.lines.some((l) => l.key === "fence-job-minimum"));
});

test("custom gate pricing is continuous through the 4-10' range", () => {
  const at = (w: number) =>
    priceFence({ ...CEDAR_100, gatesSingle: 0, gatesCustomWidthsFt: [w] })
      .lines.find((l) => l.key === "gate-custom-0")!.amount;
  // No cliff: each half-foot step moves the price by a small, similar amount.
  let prev = at(4);
  for (let w = 4.5; w <= 10; w += 0.5) {
    const cur = at(w);
    assert.ok(cur > prev, `monotone at ${w}'`);
    assert.ok(cur - prev < prev * 0.2, `no cliff at ${w}': +${cur - prev}`);
    prev = cur;
  }
  // The 10' custom gate prices exactly like the 10' drive-gate preset.
  const drive = priceFence({ ...CEDAR_100, gatesSingle: 0, gatesDouble: 1 })
    .lines.find((l) => l.key === "gate-double")!.amount;
  assert.ok(Math.abs(at(10) - drive) < 1);
});

test("horizontal-modern board count grows with height, not with the picket formula", () => {
  const short = computeFenceTakeoff({ ...CEDAR_100, type: "horizontal-modern", heightFt: 4 });
  const tall = computeFenceTakeoff({ ...CEDAR_100, type: "horizontal-modern", heightFt: 6 });
  const sQty = short.bom.find((b) => b.key === "picket")!.qty;
  const tQty = tall.bom.find((b) => b.key === "picket")!.qty;
  // 6' is ~1.5× the courses of 4' — identical counts was the bug.
  assert.ok(tQty >= sQty * 1.3, `6' ${tQty} slats vs 4' ${sQty}`);
});

test("tier ladder holds the job's height and never inverts Good over Better", () => {
  // Steel ornamental at 6': aluminum sibling comes in 6' — keep it; at
  // 8' aluminum doesn't exist, so Good must quote the base type instead
  // of silently downgrading an 8' job to a 4' fence.
  const okTiers = fenceTiers("steel-ornamental", 6);
  assert.equal(okTiers[0]!.type, "aluminum-ornamental");
  const talls = fenceTiers("steel-ornamental", 8);
  assert.equal(talls[0]!.type, "steel-ornamental");
  // Cedar at 5': pt-pine comes in 4/6/8 only — Good stays cedar at 5'.
  const fives = fenceTiers("cedar-privacy", 5);
  assert.equal(fives[0]!.type, "cedar-privacy");
  // …and at 8', pine DOES come in 8' and is cheaper — the swap stands.
  const eights = fenceTiers("cedar-privacy", 8);
  assert.equal(eights[0]!.type, "pt-pine-privacy");
});

test("client scope sheet shows the same LF the price billed (no double gate subtraction)", () => {
  const { measurements, config } = layoutToPricingInputs(CEDAR_100);
  const scope = fenceClientScope(config.fence!, measurements);
  assert.ok(scope);
  // 104 drawn − 4' gate = 100 net, matching the priced quantity.
  assert.equal(scope!.spec.netLf, 100);
  assert.equal(scope!.spec.totalLf, 104);
  assert.equal(scope!.spec.sections, computeFenceTakeoff(CEDAR_100).sections);
});

test("same-type 'mixed' sections are a no-op, not a double-billed carve-out", () => {
  const plain = priceFence(CEDAR_100);
  const selfMixed = priceFence({
    ...CEDAR_100,
    mixed: [{ type: "cedar-privacy", lf: 40 }],
  });
  assert.ok(Math.abs(plain.total - selfMixed.total) < 0.02);
});

test("mixed sections longer than the fence shrink proportionally", () => {
  const priced = priceFence({
    ...CEDAR_100,
    totalLf: 104,
    mixed: [{ type: "chain-link-galv", lf: 200 }],
  });
  const line = priced.lines.find((l) => l.key === "fence-mixed-chain-link-galv")!;
  // Clamped to the net fence, not billed at the drawn 200.
  assert.ok(line.label.includes("100 LF"), line.label);
});
