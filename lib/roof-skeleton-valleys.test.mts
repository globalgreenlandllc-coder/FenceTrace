import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveRoofSkeleton, type Pt, type SkeletonLine } from "./roof-skeleton.ts";

// Shortest distance from a point to a segment.
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
const segLen = (s: SkeletonLine) =>
  Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y);

// An L-shaped footprint has exactly one reflex (inside) corner → one valley.
const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 80 },
  { x: 100, y: 80 },
  { x: 100, y: 160 },
  { x: 0, y: 160 },
];

test("a rectangle has NO valleys (no reflex corner — no dangling dashes)", () => {
  const skel = deriveRoofSkeleton([
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 60 },
    { x: 0, y: 60 },
  ]);
  assert.equal(skel.valleys.length, 0);
});

test("valley TERMINATES on a ridge/hip — its far end lands on the roof body, not floating", () => {
  const skel = deriveRoofSkeleton(L);
  assert.ok(skel.valleys.length >= 1, "L-shape produced a valley");
  const interior = [...skel.ridges, ...skel.hips];
  assert.ok(interior.length > 0, "there are ridge/hip lines to land on");
  for (const v of skel.valleys) {
    const far = v.points[1];
    const nearest = Math.min(
      ...interior.map((l) => distToSeg(far, l.points[0], l.points[1])),
    );
    // The terminal point sits ON a ridge/hip (within a small tolerance) —
    // the old fixed-length stub floated off into the middle of a plane.
    assert.ok(
      nearest < 4,
      `valley end should touch a ridge/hip (got ${nearest.toFixed(2)} px away)`,
    );
  }
});

test("valley starts AT the reflex corner and has real length", () => {
  const skel = deriveRoofSkeleton(L);
  const reflex = { x: 100, y: 80 };
  const v = skel.valleys.find(
    (s) => Math.hypot(s.points[0].x - reflex.x, s.points[0].y - reflex.y) < 2,
  );
  assert.ok(v, "a valley anchored at the reflex corner exists");
  assert.ok(segLen(v!) > 5, "valley has a non-trivial length");
});
