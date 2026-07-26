import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFenceTakeoff } from "./takeoff.ts";
import { priceFence, fenceTiers } from "./pricing.ts";

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
  // posts: line 10 (12 boundaries − 2 corners) + 2 corner + 2 end + 2 gate
  assert.equal(t.posts.corner, 2);
  assert.equal(t.posts.end, 2);
  assert.equal(t.posts.gate, 2);
  assert.equal(t.posts.total, t.posts.line + 6);
  const pickets = t.bom.find((b) => b.key === "picket")!;
  // 100 LF × 12 / 5.5" pitch ≈ 218 × 1.1 waste ⇒ ~240
  assert.ok(pickets.qty >= 230 && pickets.qty <= 260, `pickets=${pickets.qty}`);
  const concrete = t.bom.find((b) => b.key === "concrete")!;
  assert.ok(concrete.qty >= t.posts.total * 2 - 2, "2 bags per 6' post");
  assert.ok(t.laborHours > 30 && t.laborHours < 60, `hours=${t.laborHours}`);
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

test("shadowbox pickets ≈ double a solid face; chain-link has mesh not pickets", () => {
  const solid = computeFenceTakeoff({ ...CEDAR_100, type: "cedar-privacy" });
  const shadow = computeFenceTakeoff({ ...CEDAR_100, type: "shadowbox" });
  const sp = solid.bom.find((b) => b.key === "picket")!.qty;
  const shp = shadow.bom.find((b) => b.key === "picket")!.qty;
  assert.ok(shp > sp * 1.2, `shadowbox ${shp} vs solid ${sp}`);

  const cl = computeFenceTakeoff({ ...CEDAR_100, type: "chain-link-galv", heightFt: 4 });
  assert.ok(!cl.bom.some((b) => b.key === "picket"));
  assert.ok(cl.bom.some((b) => b.key === "mesh"));
  assert.ok(cl.bom.some((b) => b.key === "top-rail"));
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

test("priceFence: order of operations markup → discount → tax", () => {
  const p = priceFence(CEDAR_100, {
    markupPct: 40,
    discountPct: 10,
    taxPct: 10,
  });
  const afterMarkup = p.subtotal + p.markup;
  assert.ok(Math.abs(p.markup - p.subtotal * 0.4) < 0.02);
  assert.ok(Math.abs(p.discount - afterMarkup * 0.1) < 0.02);
  assert.ok(Math.abs(p.tax - (afterMarkup - p.discount) * 0.1) < 0.02);
  assert.ok(
    Math.abs(p.total - (afterMarkup - p.discount + p.tax)) < 0.02,
    "total reconciles",
  );
  assert.ok(p.pricePerLf > 0);
});

test("terrain multiplies labor only", () => {
  const flat = priceFence({ ...CEDAR_100, terrain: "flat" });
  const rocky = priceFence({ ...CEDAR_100, terrain: "rocky" });
  const flatLabor = flat.lines.find((l) => l.key === "labor")!.amount;
  const rockyLabor = rocky.lines.find((l) => l.key === "labor")!.amount;
  assert.ok(Math.abs(rockyLabor / flatLabor - 1.55) < 0.01);
  const flatMat = flat.lines.find((l) => l.key === "materials")!.amount;
  const rockyMat = rocky.lines.find((l) => l.key === "materials")!.amount;
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
