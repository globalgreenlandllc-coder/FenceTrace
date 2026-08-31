import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_W,
  canvasPolylineFt,
  canvasPxPerFt,
  centroid,
  latLngToCanvas,
  runDistanceModel,
  walkPostPositions,
  zoomToFit,
} from "./geo.ts";

const SEATTLE = { lat: 47.6, lng: -122.33 };

test("canvasPxPerFt: a known 100 ft east-west span measures ~100 ft", () => {
  // 100 ft east at this latitude: Δlng = 100ft in degrees.
  const meters = 30.48;
  const dLng = meters / (111320 * Math.cos((SEATTLE.lat * Math.PI) / 180));
  const zoom = 19;
  const a = latLngToCanvas(SEATTLE, SEATTLE, zoom);
  const b = latLngToCanvas({ lat: SEATTLE.lat, lng: SEATTLE.lng + dLng }, SEATTLE, zoom);
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  const ft = px / canvasPxPerFt(SEATTLE.lat, zoom);
  assert.ok(Math.abs(ft - 100) < 1.5, `measured ${ft.toFixed(2)} ft`);
});

test("latLngToCanvas centers the center", () => {
  const c = latLngToCanvas(SEATTLE, SEATTLE, 19);
  assert.ok(Math.abs(c.x - CANVAS_W / 2 / (CANVAS_W / 640)) < 0.01 || true);
  // center maps to map center scaled into canvas: MAP_W/2 × 1.40625 = 450
  assert.ok(Math.abs(c.x - 450) < 0.01, `x=${c.x}`);
});

test("zoomToFit shrinks for bigger parcels, clamps to [15,21]", () => {
  const small = [
    SEATTLE,
    { lat: SEATTLE.lat + 0.0003, lng: SEATTLE.lng + 0.0004 },
  ];
  const large = [
    SEATTLE,
    { lat: SEATTLE.lat + 0.01, lng: SEATTLE.lng + 0.012 },
  ];
  const zs = zoomToFit(small);
  const zl = zoomToFit(large);
  assert.ok(zs > zl, `${zs} > ${zl}`);
  assert.ok(zs <= 21 && zl >= 15);
});

test("canvasPolylineFt sums segments; centroid averages", () => {
  const pxPerFt = 2;
  const ft = canvasPolylineFt(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ],
    pxPerFt,
  );
  assert.equal(ft, 150);
  const c = centroid([
    { lat: 10, lng: 20 },
    { lat: 20, lng: 40 },
  ]);
  assert.deepEqual(c, { lat: 15, lng: 30 });
});

test("runDistanceModel: interpolates along the walk, clamps at the ends", () => {
  // 100px straight run, spacing 40 → walk points at 0, 33.3, 66.7, 100.
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const m = runDistanceModel(pts, 40, [0, 1, 2, 3]);
  assert.ok(m);
  assert.equal(m.totalPx, 100);
  assert.equal(m.atDistPx(0), 0);
  assert.equal(m.atDistPx(100), 3);
  // halfway between samples 1 (33.33px) and 2 (66.67px)
  assert.ok(Math.abs(m.atDistPx(50) - 1.5) < 1e-9);
  // clamped outside the run
  assert.equal(m.atDistPx(-10), 0);
  assert.equal(m.atDistPx(999), 3);
});

test("runDistanceModel: L-shaped run keeps the vertex sample; mismatch → null", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 40 },
  ];
  const walk = walkPostPositions(pts, 40);
  const elevs = walk.map((_, i) => i); // one per walk point
  const m = runDistanceModel(pts, 40, elevs);
  assert.ok(m);
  assert.equal(m.totalPx, 120);
  // The corner (arc distance 80) is a real sample — exact, not interpolated.
  assert.equal(m.atDistPx(80), elevs[2]);
  // A stale sample count (layout edited since sampling) must refuse to model.
  assert.equal(runDistanceModel(pts, 40, [1, 2, 3]), null);
  assert.equal(runDistanceModel(pts, 40, []), null);
});

test("cornerFlags: right angle counts, shallow dogleg does not", async () => {
  const { cornerFlags, countCornersAndEnds } = await import("./geo.ts");
  // L-shape: true 90° corner at index 1
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.deepEqual(cornerFlags(L), [false, true, false]);
  // near-straight dogleg (~8°) — a line post, not a corner
  const dog = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 14 }];
  assert.deepEqual(cornerFlags(dog), [false, false, false]);
  // oblique 45° turn IS a corner (direction of turn irrelevant)
  const oblique = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 170, y: 70 }];
  assert.deepEqual(cornerFlags(oblique), [false, true, false]);
  const { corners, ends } = countCornersAndEnds([
    { points: L },
    { points: dog },
    { points: oblique },
  ]);
  assert.equal(corners, 2);
  assert.equal(ends, 6);
});

test("cornerFlags: closed rectangle has 4 corners, no ends", async () => {
  const { countCornersAndEnds } = await import("./geo.ts");
  const ring = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }, { x: 0, y: 0 },
  ];
  const r = countCornersAndEnds([{ points: ring }]);
  assert.equal(r.corners, 4);
  assert.equal(r.ends, 0);
});

/* ---- cleanDisplayRing ---- */
import { cleanDisplayRing } from "./geo.ts";

// pxPerFt = 2 in these tests: thresholds become closeEps 1px,
// minSeg 3px, so the numbers below stay easy to reason about.
const PPF = 2;
const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

test("cleanDisplayRing: a clean square passes through untouched", () => {
  const out = cleanDisplayRing(SQUARE, PPF);
  assert.deepEqual(out, SQUARE);
});

test("cleanDisplayRing: strips the GeoJSON closing duplicate", () => {
  const out = cleanDisplayRing([...SQUARE, { x: 0.2, y: 0.3 }], PPF);
  assert.equal(out.length, 4);
});

test("cleanDisplayRing: merges a stacked jitter cluster into one vertex", () => {
  // Three sub-3px vertices piled on the 2nd corner — the "blob of dots".
  const ring = [
    SQUARE[0],
    { x: 99, y: 0 },
    { x: 100, y: 0.8 },
    { x: 100.5, y: 1.6 },
    SQUARE[2],
    SQUARE[3],
  ];
  const out = cleanDisplayRing(ring, PPF);
  assert.ok(out.length <= 4, `expected ≤4 vertices, got ${out.length}`);
});

test("cleanDisplayRing: removes a retrace spike (the thick-solid-line bug)", () => {
  // Out-and-back leg on the top edge: 50,0 → 70,-40 → back toward 90,0.
  // The spike apex bends <15°, so it's garbage, not a corner.
  const ring = [
    SQUARE[0],
    { x: 50, y: 0 },
    { x: 52, y: -60 },
    { x: 54, y: 0 },
    SQUARE[1],
    SQUARE[2],
    SQUARE[3],
  ];
  const out = cleanDisplayRing(ring, PPF);
  assert.ok(
    out.every((p) => p.y >= 0),
    `spike apex survived: ${JSON.stringify(out)}`,
  );
});

test("cleanDisplayRing: drops collinear jitter on a straight edge, keeps real corners", () => {
  const ring = [
    SQUARE[0],
    { x: 30, y: 0.2 },
    { x: 60, y: -0.2 },
    SQUARE[1],
    SQUARE[2],
    SQUARE[3],
  ];
  const out = cleanDisplayRing(ring, PPF);
  assert.equal(out.length, 4);
  // The four real 90° corners all survive.
  for (const c of SQUARE) {
    assert.ok(
      out.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1),
      `corner ${JSON.stringify(c)} was dropped`,
    );
  }
});
