/**
 * Pure node tests for mergeGables. Run: npx tsx --test lib/roof-skeleton-gables.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGables, deriveRoofSkeleton, type SkeletonLine } from "./roof-skeleton.ts";

const seg = (ax: number, ay: number, bx: number, by: number): SkeletonLine => ({
  points: [{ x: ax, y: ay }, { x: bx, y: by }],
});
const len = (s: SkeletonLine) => Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y);

test("collinear, touching horizontal fragments merge into one", () => {
  const out = mergeGables([seg(0, 0, 100, 0), seg(100, 0, 200, 0), seg(200, 0, 300, 0)], 5, 4);
  assert.equal(out.length, 1, "3 fragments of one wall -> 1 gable");
  assert.ok(Math.abs(len(out[0]) - 300) < 0.01, "spans the full merged width");
});

test("small gap (<= tol) bridges; large gap (real step) stays separate", () => {
  const bridged = mergeGables([seg(0, 0, 100, 0), seg(103, 0, 200, 0)], 5, 4); // gap 3 <= tol 5
  assert.equal(bridged.length, 1, "snap-split fragments bridge");
  const stepped = mergeGables([seg(0, 0, 100, 0), seg(140, 0, 240, 0)], 5, 4); // gap 40 > tol
  assert.equal(stepped.length, 2, "two genuinely separate gables stay separate");
});

test("vertical fragments merge on their own axis", () => {
  const out = mergeGables([seg(50, 0, 50, 60), seg(50, 60, 50, 120)], 5, 4);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(len(out[0]) - 120) < 0.01);
});

test("different fixed coords (parallel walls) do not merge", () => {
  const out = mergeGables([seg(0, 0, 100, 0), seg(0, 80, 100, 80)], 5, 4);
  assert.equal(out.length, 2, "top and bottom walls stay distinct");
});

test("slivers shorter than minLen are dropped", () => {
  const out = mergeGables([seg(0, 0, 3, 0), seg(0, 50, 100, 50)], 5, 10);
  assert.equal(out.length, 1, "3px sliver dropped, real wall kept");
});

test("empty / malformed input is safe", () => {
  assert.deepEqual(mergeGables([], 5, 4), []);
  assert.deepEqual(mergeGables([{ points: [{ x: NaN, y: 0 }, { x: 1, y: 0 }] }], 5, 4), []);
});

test("integration: a footprint's gable count is deduped via deriveRoofSkeleton", () => {
  // Plain rectangle, whole top + bottom are rakes (gables), left/right eaves.
  const W = 300, H = 160;
  const fp = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const rakes: [{ x: number; y: number }, { x: number; y: number }][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: 0, y: H }, { x: W, y: H }],
  ];
  const eaves: [{ x: number; y: number }, { x: number; y: number }][] = [
    [{ x: 0, y: 0 }, { x: 0, y: H }],
    [{ x: W, y: 0 }, { x: W, y: H }],
  ];
  const s = deriveRoofSkeleton(fp, { eaveSegments: eaves, rakeSegments: rakes });
  assert.ok(s.gables.length <= 2, `expected <=2 merged gables, got ${s.gables.length}`);
  assert.ok(s.gables.every((g) => g.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
});
