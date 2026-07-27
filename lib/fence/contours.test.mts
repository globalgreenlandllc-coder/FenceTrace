import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContours, pickContourInterval } from "./contours.ts";

test("pickContourInterval: nice steps targeting ≤9 lines", () => {
  assert.equal(pickContourInterval(0, 0.5), 0); // too flat to contour
  assert.equal(pickContourInterval(100, 103), 1);
  assert.equal(pickContourInterval(0, 12), 2);
  assert.equal(pickContourInterval(0, 40), 5);
  assert.equal(pickContourInterval(0, 100), 20);
});

test("tilted plane: straight vertical contours at interpolated x", () => {
  // elevation = column index (ft): 4 rows × 11 cols, 10px cells
  const grid = Array.from({ length: 4 }, () =>
    Array.from({ length: 11 }, (_, c) => c),
  );
  const lines = buildContours(grid, 10, 10, 2);
  const levels = lines.map((l) => l.levelFt);
  for (const want of [2, 4, 6, 8]) assert.ok(levels.includes(want), `level ${want}`);
  // the +4 ft line is ONE chain, exactly vertical at x=40, full height
  const l4 = lines.find((l) => l.levelFt === 4)!;
  assert.equal(l4.chains.length, 1);
  assert.ok(l4.chains[0].every((p) => Math.abs(p.x - 40) < 1e-6));
  const ys = l4.chains[0].map((p) => p.y);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 30);
});

test("flat and corrupt grids produce no contours", () => {
  const flat = Array.from({ length: 3 }, () => [5, 5, 5]);
  assert.deepEqual(buildContours(flat, 10, 10, 2), []);
  assert.deepEqual(
    buildContours(
      [
        [0, 1],
        [NaN, 2],
      ],
      10,
      10,
      1,
    ),
    [],
  );
});

test("cone: the contour around a knoll closes into a ring", () => {
  const n = 7;
  const grid = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) =>
      10 - 2 * Math.max(Math.abs(r - 3), Math.abs(c - 3)),
    ),
  );
  const l5 = buildContours(grid, 10, 10, 5).find((l) => l.levelFt === 5)!;
  assert.ok(l5.chains.length >= 1);
  const ring = [...l5.chains].sort((a, b) => b.length - a.length)[0];
  const gap = Math.hypot(
    ring[0].x - ring[ring.length - 1].x,
    ring[0].y - ring[ring.length - 1].y,
  );
  assert.ok(gap < 1e-6, `ring should close, gap ${gap}`);
});
