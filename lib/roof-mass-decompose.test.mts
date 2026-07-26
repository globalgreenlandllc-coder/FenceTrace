/**
 * Pure node tests for the tier/mass decomposer. Run:
 *   npx tsx --test lib/roof-mass-decompose.test.mts
 *
 * The load-bearing invariants: decomposition is AREA-preserving and gutter-LF-
 * NEUTRAL (a split never adds or drops priced length), and it BAILS to a single
 * "main" mass whenever it can't split cleanly — so it never makes a takeoff
 * worse than today's single-mass path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decomposeMasses, matchTierAreas } from "./roof-mass-decompose.ts";
import { polyArea, polygonCloses, type MassInput } from "./roof-engine.ts";

type Pt = { x: number; y: number };

function gutterLf(m: MassInput): number {
  const set = new Set(m.eaveEdges);
  let s = 0;
  for (let i = 0; i < m.outline.length; i++) {
    if (set.has(i)) {
      const a = m.outline[i];
      const b = m.outline[(i + 1) % m.outline.length];
      s += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return s;
}
const totalArea = (ms: MassInput[]) => ms.reduce((s, m) => s + polyArea(m.outline), 0);
const totalLf = (ms: MassInput[]) => ms.reduce((s, m) => s + gutterLf(m), 0);
const allIdx = (poly: Pt[]) => poly.map((_, i) => i);
const CLOSE = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// An L: full-width top bar (60×20) over a left column (30×30). Reentrant at (30,20).
const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 20 },
  { x: 30, y: 20 },
  { x: 30, y: 50 },
  { x: 0, y: 50 },
];

// Main body (64×44) with a garage jog out the right side (24×30 at y∈[10,40]).
const GARAGE: Pt[] = [
  { x: 0, y: 0 },
  { x: 64, y: 0 },
  { x: 64, y: 10 },
  { x: 88, y: 10 },
  { x: 88, y: 40 },
  { x: 64, y: 40 },
  { x: 64, y: 44 },
  { x: 0, y: 44 },
];

test("a plain rectangle is a no-op: one 'main' mass, outline unchanged", () => {
  const box: Pt[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
    { x: 0, y: 30 },
  ];
  const ms = decomposeMasses(box, allIdx(box));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].name, "main");
  assert.deepEqual(ms[0].outline, box);
  assert.deepEqual(ms[0].eaveEdges, [0, 1, 2, 3]);
});

test("L-shape splits into 2 masses; area-preserving and LF-neutral (all guttered)", () => {
  const ms = decomposeMasses(L, allIdx(L));
  assert.equal(ms.length, 2);
  assert.ok(CLOSE(totalArea(ms), polyArea(L)), "area preserved");
  assert.ok(CLOSE(totalArea(ms), 2100));
  // Original all-guttered perimeter = 60+20+30+30+30+50 = 220.
  assert.ok(CLOSE(totalLf(ms), 220), `LF-neutral, got ${totalLf(ms)}`);
  for (const m of ms) assert.ok(polygonCloses(m.outline), `${m.name} closes`);
  assert.equal(ms[0].name, "main"); // largest first
});

test("L-shape with a RAKE top edge stays LF-neutral (partial guttering)", () => {
  // Edge 0 (the 60-ft top) is a rake, not an eave → guttered LF = 220 - 60 = 160.
  const eaves = [1, 2, 3, 4, 5];
  const ms = decomposeMasses(L, eaves);
  assert.equal(ms.length, 2);
  assert.ok(CLOSE(totalLf(ms), 160), `expected 160, got ${totalLf(ms)}`);
  assert.ok(CLOSE(totalArea(ms), 2100));
});

test("garage-jog footprint splits into main + garage (2 clean tiers), LF-neutral", () => {
  const ms = decomposeMasses(GARAGE, allIdx(GARAGE));
  assert.equal(ms.length, 2, "main + garage");
  const areas = ms.map((m) => polyArea(m.outline)).sort((a, b) => b - a);
  assert.ok(CLOSE(areas[0], 2816), `main 2816, got ${areas[0]}`);
  assert.ok(CLOSE(areas[1], 720), `garage 720, got ${areas[1]}`);
  assert.ok(CLOSE(totalArea(ms), 3536));
  // Original all-guttered perimeter = 64+10+24+30+24+4+64+44 = 264. The shared
  // main↔garage wall (the 30-ft interior cut) must NOT be guttered on either.
  assert.ok(CLOSE(totalLf(ms), 264), `LF-neutral, got ${totalLf(ms)}`);
  for (const m of ms) assert.ok(polygonCloses(m.outline));
});

// Case 1 — middle-of-wall jogs. Invisible from the side elevations (the sides
// only see the outer profile), but the top-down footprint has them, so the
// decomposer must handle a mid-wall bump/notch like any other jog.
test("Case 1: a middle BUMP-OUT (T) decomposes area-preserving + LF-neutral", () => {
  const T: Pt[] = [
    { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: -12 }, { x: 36, y: -12 },
    { x: 36, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 },
  ];
  const ms = decomposeMasses(T, allIdx(T));
  assert.ok(ms.length >= 2, "the mid-wall bump splits off");
  assert.ok(CLOSE(totalArea(ms), 1944), `area ${totalArea(ms)}`);
  assert.ok(CLOSE(totalLf(ms), 204), `LF-neutral, got ${totalLf(ms)}`);
  for (const m of ms) assert.ok(polygonCloses(m.outline));
});

test("Case 1: a middle NOTCH (courtyard pop-in) decomposes area-preserving + LF-neutral", () => {
  const U: Pt[] = [
    { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 36, y: 12 },
    { x: 36, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 },
  ];
  const ms = decomposeMasses(U, allIdx(U));
  assert.ok(ms.length >= 2, "the notch forces a split");
  assert.ok(CLOSE(totalArea(ms), 1656), `area ${totalArea(ms)}`);
  assert.ok(CLOSE(totalLf(ms), 204), `LF-neutral, got ${totalLf(ms)}`);
  for (const m of ms) assert.ok(polygonCloses(m.outline));
});

test("a non-rectilinear outline (diagonal edge) bails to a single 'main' mass", () => {
  const tri: Pt[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 20, y: 40 }, // diagonal edge — can't snap to axis-aligned
    { x: 0, y: 20 },
  ];
  const ms = decomposeMasses(tri, allIdx(tri));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].name, "main");
  assert.equal(ms[0].outline, tri);
});

test("a NEAR-rectilinear (noisy) L still snaps and splits, area ~preserved", () => {
  // Perturb every vertex by < the 2%-span snap tolerance (span 60 → tol 1.2).
  const noisy = L.map((p, i) => ({ x: p.x + (i % 2 ? 0.6 : -0.5), y: p.y + (i % 3 ? 0.4 : -0.6) }));
  const ms = decomposeMasses(noisy, allIdx(noisy));
  assert.equal(ms.length, 2, "snapped then split");
  assert.ok(Math.abs(totalArea(ms) - 2100) / 2100 < 0.05, "area within 5% of the clean L");
});

test("matchTierAreas: tiers match their nearest schedule area, one-to-one", () => {
  const m = matchTierAreas(
    [2816, 720],
    [
      { label: "upper", areaFt2: 2902 },
      { label: "garage", areaFt2: 674 },
      { label: "patio", areaFt2: 228 },
    ],
  );
  assert.equal(m[0]?.label, "upper");
  assert.equal(m[0]?.areaFt2, 2902);
  assert.equal(m[1]?.label, "garage");
  assert.equal(m[1]?.areaFt2, 674);
});

test("matchTierAreas: a tier with no schedule area within tolerance stays unmatched (null)", () => {
  const m = matchTierAreas([5000], [{ label: "upper", areaFt2: 2902 }]); // 72% off
  assert.equal(m[0], null);
});

test("matchTierAreas: no schedule ⇒ all null", () => {
  assert.deepEqual(matchTierAreas([2816, 720], []), [null, null]);
  assert.deepEqual(matchTierAreas([2816, 720], null), [null, null]);
});

test("matchTierAreas: two similar tiers don't both claim the same schedule entry", () => {
  const m = matchTierAreas([700, 690], [{ label: "garage", areaFt2: 674 }]);
  assert.equal(m.filter(Boolean).length, 1, "only one tier claims the single entry");
  assert.equal(m[1]?.areaFt2, 674); // 690 is nearer than 700
  assert.equal(m[0], null);
});

test("every decomposed mass is a valid closed ring with in-range eave indices", () => {
  for (const shape of [L, GARAGE]) {
    const ms = decomposeMasses(shape, allIdx(shape));
    for (const m of ms) {
      assert.ok(polygonCloses(m.outline));
      for (const e of m.eaveEdges) assert.ok(e >= 0 && e < m.outline.length);
    }
  }
});

test("matchTierAreas GROUP pass: a split schedule mass matches the SUM of tiers (Woodinville UPPER 2902 = main 1687 + tier-1 1229)", () => {
  const m = matchTierAreas(
    [1687, 1229, 266, 262, 57],
    [
      { label: "upper", areaFt2: 2902 },
      { label: "patio", areaFt2: 228 },
      { label: "porch", areaFt2: 180 },
    ],
  );
  // One-to-one: tier index 3 (262) is the nearest to PATIO 228 (14.9%).
  assert.deepEqual(m[3], { areaFt2: 228, label: "patio" });
  // GROUP: main + tier-1 sum to 2916 — a 0.5% match on UPPER 2902; each gets
  // its proportional share so the per-tier gate measures the group's error.
  assert.ok(m[0] && m[0].label.startsWith("upper (split"), `main got ${JSON.stringify(m[0])}`);
  assert.ok(m[1] && m[1].label.startsWith("upper (split"), `tier-1 got ${JSON.stringify(m[1])}`);
  const share0 = (1687 / (1687 + 1229)) * 2902;
  assert.ok(Math.abs(m[0]!.areaFt2 - share0) < 0.2, "proportional share");
  // PORCH 180 has no tier or group within 25% (266+57=323 is 79% off) → honest null.
  assert.equal(m[2], null);
  assert.equal(m[4], null);
});

test("matchTierAreas GROUP pass: no grouping when one-to-one already consumed the schedule", () => {
  const m = matchTierAreas([1000, 500], [{ label: "upper", areaFt2: 1010 }]);
  assert.deepEqual(m[0], { areaFt2: 1010, label: "upper" });
  assert.equal(m[1], null, "leftover tier stays unmatched — never force-fit");
});
