/**
 * Pure node tests for diagram-geom helpers. Run with:
 *   npx tsx --test lib/diagram-geom.test.mts
 * No DB, no AI, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bboxOfPoints,
  classifyEaveSide,
  polylineLengthPx,
  polylineLengthFt,
  polygonAreaFt2,
  perSideLF,
  reflexCorners,
  type DBBox,
} from "./diagram-geom.ts";

// A 100×60 footprint rectangle in canvas space.
const bbox: DBBox = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
const line = (a: [number, number], b: [number, number]) => ({
  points: [
    { x: a[0], y: a[1] },
    { x: b[0], y: b[1] },
  ],
});

test("bboxOfPoints spans the extent; degenerate → null", () => {
  const bb = bboxOfPoints([
    { x: 10, y: 20 },
    { x: 30, y: 5 },
    { x: 25, y: 40 },
  ]);
  assert.deepEqual(bb, { minX: 10, minY: 5, maxX: 30, maxY: 40 });
  assert.equal(bboxOfPoints([{ x: 1, y: 1 }]), null);
  assert.equal(bboxOfPoints([{ x: 1, y: 1 }, { x: 1, y: 1 }]), null);
});

test("classifyEaveSide bins the four walls (front-at-bottom)", () => {
  // Top wall (min y) = BACK; bottom wall (max y) = FRONT.
  assert.equal(classifyEaveSide(line([5, 0], [95, 0]).points, bbox), "back");
  assert.equal(classifyEaveSide(line([5, 60], [95, 60]).points, bbox), "front");
  // Left wall = LEFT; right wall = RIGHT.
  assert.equal(classifyEaveSide(line([0, 5], [0, 55]).points, bbox), "left");
  assert.equal(classifyEaveSide(line([100, 5], [100, 55]).points, bbox), "right");
});

test("classifyEaveSide falls back to nearest edge for diagonals", () => {
  // A ~45° run near the bottom-left corner: nearest edge should decide.
  const nearBottom = classifyEaveSide(line([2, 55], [12, 58]).points, bbox);
  assert.equal(nearBottom, "front");
  assert.equal(classifyEaveSide([{ x: 1, y: 1 }], bbox), null);
});

test("polyline length in px and ft", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 30, y: 40 }, // 50
    { x: 30, y: 50 }, // +10
  ];
  assert.equal(polylineLengthPx(pts), 60);
  // pxPerFt = 6 → 10 ft
  assert.equal(polylineLengthFt(pts, 6), 10);
  // Unusable scale → 0 (never NaN)
  assert.equal(polylineLengthFt(pts, 0), 0);
  assert.equal(polylineLengthFt(pts, NaN), 0);
});

test("polygonAreaFt2 shoelace, open or closed ring", () => {
  const open = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 40 },
    { x: 0, y: 40 },
  ];
  // 60×40 = 2400 px² ; pxPerFt=2 → /4 → 600 ft²
  assert.equal(polygonAreaFt2(open, 2), 600);
  // Closed ring (duplicate first point) yields the same area.
  assert.equal(polygonAreaFt2([...open, { x: 0, y: 0 }], 2), 600);
  // Guards
  assert.equal(polygonAreaFt2(open, 0), 0);
  assert.equal(polygonAreaFt2([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2), 0);
});

test("reflexCorners finds the single concave notch of an L-shape", () => {
  // L-shape (canvas, y-down). One reflex vertex at the inner corner (60,40).
  const L = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 60, y: 40 }, // <- inside corner
    { x: 60, y: 100 },
    { x: 0, y: 100 },
  ];
  const reflex = reflexCorners(L);
  assert.equal(reflex.length, 1);
  assert.deepEqual(reflex[0], { x: 60, y: 40 });
  // Same result whether the ring is closed or not.
  assert.equal(reflexCorners([...L, { x: 0, y: 0 }]).length, 1);
  // A convex rectangle has zero reflex corners.
  assert.equal(
    reflexCorners([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]).length,
    0,
  );
});

test("perSideLF splits eaves by side and is money-neutral (sums to total)", () => {
  const pxPerFt = 5;
  const eaves = [
    line([0, 0], [100, 0]), // back, 100px = 20ft
    line([100, 0], [100, 60]), // right, 60px = 12ft
    line([100, 60], [0, 60]), // front, 100px = 20ft
    line([0, 60], [0, 0]), // left, 60px = 12ft
  ];
  const per = perSideLF(eaves, bbox, pxPerFt);
  assert.deepEqual(per, { back: 20, front: 20, left: 12, right: 12 });
  const total =
    per.front + per.back + per.left + per.right;
  const directTotal = Math.round(
    eaves.reduce((s, e) => s + polylineLengthFt(e.points, pxPerFt), 0),
  );
  // Per-side breakdown reproduces the same total the pricing path sums.
  assert.equal(total, directTotal);
});
