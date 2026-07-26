import { test } from "node:test";
import assert from "node:assert/strict";
import { engineDrawnGeometry, isNearPerimeter } from "./roof-structure-view.ts";

const pts = (...xy: number[][]) => xy.map(([x, y]) => ({ x, y }));

test("engine ids present → stored geometry verbatim; labels and bases share one source", () => {
  const structure = {
    ridges: [{ id: "engine-ridge-0", points: pts([0, 50], [100, 50]) }],
    hips: [],
    valleys: [{ id: "engine-valley-0", points: pts([0, 0], [40, 40]) }],
    gables: [
      { id: "engine-gable-end-0", points: pts([0, 0], [10, 5], [20, 0]) },
    ],
    faces: [
      { polygon: pts([0, 0], [100, 0], [100, 100], [0, 100]), downhill: { x: 0, y: 1 } },
    ],
  };
  const g = engineDrawnGeometry(structure);
  assert.ok(g, "engine rows must select the stored geometry");
  assert.equal(g.ridges.length, 1);
  assert.equal(g.valleys.length, 1);
  assert.equal(g.faces, structure.faces, "faces pass through by reference — no re-derivation");
  // Gable base = first/last stored points: the SAME entry that drives the label.
  assert.equal(g.gables.length, 1);
  assert.deepEqual(g.gables[0].points, [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ]);
});

test("faces without engine ids (bridge-built structures) still select verbatim", () => {
  const structure = {
    ridges: [],
    valleys: [],
    gables: [],
    faces: [
      { polygon: pts([0, 0], [10, 0], [10, 10]), downhill: { x: 0, y: 1 } },
    ],
  };
  const g = engineDrawnGeometry(structure);
  assert.ok(g);
  assert.equal(g.ridges.length, 0);
  assert.equal(g.faces.length, 1);
});

test("post-suppression rows (engine valleys only, no faces) render exactly the stored lines — no invented dashes", () => {
  const structure = {
    ridges: [],
    valleys: [
      { id: "engine-valley-3", points: pts([10, 10], [40, 40]) },
      { id: "engine-valley-4", points: pts([90, 10], [60, 40]) },
    ],
    gables: [],
  };
  const g = engineDrawnGeometry(structure);
  assert.ok(g);
  assert.equal(g.valleys.length, 2);
  assert.equal(g.hips.length, 0);
  assert.equal(g.ridges.length, 0, "nothing may be invented beyond the stored lines");
});

test("legacy structures (no engine ids, no faces) return null — caller keeps its client derivation", () => {
  const structure = {
    ridges: [{ id: "sat-ridge-1", points: pts([0, 0], [10, 10]) }],
    valleys: [],
    gables: [{ points: pts([0, 0], [5, 5]) }],
  };
  assert.equal(engineDrawnGeometry(structure), null);
});

test("tier STEPS pass through verbatim, like every other engine channel", () => {
  const steps = [
    { id: "engine-step-0", points: pts([30, 20], [70, 20]) },
    { id: "engine-step-1", points: pts([70, 20], [70, 45]) },
  ];
  const structure = {
    ridges: [{ id: "engine-ridge-0", points: pts([0, 50], [100, 50]) }],
    valleys: [],
    steps,
  };
  const g = engineDrawnGeometry(structure);
  assert.ok(g);
  assert.equal(g.steps.length, 2);
  assert.deepEqual(
    g.steps.map((s) => s.points),
    steps.map((s) => s.points),
    "step points render exactly as stored — nothing re-derived",
  );
});

test("a steps-ONLY row (interior omitted) still selects engine rendering — the grid must not re-invent lines", () => {
  const structure = {
    ridges: [],
    valleys: [],
    steps: [{ id: "engine-step-0", points: pts([30, 20], [70, 20]) }],
  };
  const g = engineDrawnGeometry(structure);
  assert.ok(g, "steps carry an engine id — verbatim mode");
  assert.equal(g.ridges.length, 0);
  assert.equal(g.steps.length, 1);
});

test("rows without steps expose an empty steps channel (back-compat)", () => {
  const g = engineDrawnGeometry({
    ridges: [{ id: "engine-ridge-0", points: pts([0, 0], [10, 10]) }],
    valleys: [],
  });
  assert.ok(g);
  assert.deepEqual(g.steps, []);
});

// ── isNearPerimeter (the canvas gable-WING guard) ───────────────────────────

const WING_PERIM = pts([0, 0], [100, 0], [100, 60], [0, 60]);

test("isNearPerimeter: off-perimeter midpoint → false (no wing drawn mid-roof)", () => {
  assert.equal(isNearPerimeter({ x: 50, y: 30 }, WING_PERIM), false);
  assert.equal(isNearPerimeter({ x: 40, y: 20 }, WING_PERIM), false);
});

test("isNearPerimeter: on or near a wall (within the span-relative tolerance) → true", () => {
  assert.equal(isNearPerimeter({ x: 50, y: 0 }, WING_PERIM), true);
  // 100-unit span → tol 5; a 3-unit offset (projection noise) still counts.
  assert.equal(isNearPerimeter({ x: 50, y: 3 }, WING_PERIM), true);
  assert.equal(isNearPerimeter({ x: 0, y: 30 }, WING_PERIM), true);
});

test("isNearPerimeter: missing/degenerate perimeter never vetoes; garbage point does", () => {
  assert.equal(isNearPerimeter({ x: 50, y: 30 }, undefined), true);
  assert.equal(isNearPerimeter({ x: 50, y: 30 }, pts([0, 0], [10, 10])), true);
  assert.equal(isNearPerimeter({ x: NaN, y: 0 }, WING_PERIM), false);
});
