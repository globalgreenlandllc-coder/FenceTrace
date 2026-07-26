import { test } from "node:test";
import assert from "node:assert/strict";

import { gableWingFaces, type Pt } from "./roof-skeleton.ts";

function polyArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

test("gable wing: ridge runs from the base midpoint inward by `depth`", () => {
  const { ridge } = gableWingFaces({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 1 }, 80);
  assert.deepEqual(ridge.points[0], { x: 50, y: 0 });
  assert.deepEqual(ridge.points[1], { x: 50, y: 80 });
});

test("gable wing: two planes that tile the wing rectangle", () => {
  const { faces } = gableWingFaces({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 1 }, 80);
  assert.equal(faces.length, 2);
  const area = faces.reduce((s, f) => s + polyArea(f.polygon), 0);
  assert.ok(Math.abs(area - 100 * 80) < 1, `wing planes tile the rect (got ${area})`);
});

test("gable wing: the two planes slope to OPPOSITE sides, perpendicular to the ridge", () => {
  const { faces } = gableWingFaces({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 1 }, 80);
  // ridge is vertical → downhill is horizontal (±x), opposite on each plane.
  assert.ok(Math.abs(faces[0].downhill.y) < 1e-9 && Math.abs(faces[1].downhill.y) < 1e-9);
  assert.equal(Math.sign(faces[0].downhill.x), -Math.sign(faces[1].downhill.x));
  assert.notEqual(faces[0].downhill.x, 0);
});

test("gable wing: a diagonal direction still produces a ridge along that direction", () => {
  const { ridge, faces } = gableWingFaces(
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 1, y: 0 },
    60,
  );
  assert.deepEqual(ridge.points[0], { x: 0, y: 50 });
  assert.deepEqual(ridge.points[1], { x: 60, y: 50 });
  assert.equal(faces.length, 2);
});

test("gable wing: degenerate input (zero dir / zero base / no depth) → no faces", () => {
  assert.equal(gableWingFaces({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, 80).faces.length, 0);
  assert.equal(gableWingFaces({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, 80).faces.length, 0);
  assert.equal(gableWingFaces({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 1 }, 0).faces.length, 0);
});
