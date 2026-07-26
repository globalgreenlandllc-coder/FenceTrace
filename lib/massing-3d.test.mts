/**
 * Pure node tests for the 3D massing geometry.
 * Run: npx tsx --test lib/massing-3d.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampStories,
  centerOf,
  bboxOf,
  project,
  buildMassing,
  sortFacesByDepth,
  wallHeightFt,
  type P3,
} from "./massing-3d.ts";

const TILT = Math.PI / 6;
const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

test("clampStories guards stray values (NaN-collapse blocker)", () => {
  assert.equal(clampStories(0), 2);
  assert.equal(clampStories(4), 2);
  assert.equal(clampStories(NaN), 2);
  assert.equal(clampStories(undefined), 2);
  assert.equal(clampStories(1), 1);
  assert.equal(clampStories(3), 3);
  assert.ok(Number.isFinite(wallHeightFt(NaN)), "wall height never NaN");
});

test("centerOf / bboxOf degrade safely on bad input", () => {
  assert.equal(centerOf([]), null);
  assert.equal(centerOf([{ x: NaN, y: 0 }]), null);
  assert.deepEqual(centerOf(SQUARE), { cx: 50, cy: 40 });
  assert.equal(bboxOf([]), null);
  const bb = bboxOf(SQUARE)!;
  assert.deepEqual([bb.minX, bb.minY, bb.maxX, bb.maxY], [0, 0, 100, 80]);
});

test("project: z (feet) lifts UP the screen, converted once; depth = forward axis", () => {
  const c = { cx: 50, cy: 40 };
  const ground = project({ x: 50, y: 40, z: 0 }, 0, TILT, c);
  const up = project({ x: 50, y: 40, z: 10 }, 0, TILT, c);
  assert.ok(Math.abs(ground.x) < 1e-9 && Math.abs(ground.y) < 1e-9, "center maps to origin at ground");
  assert.ok(up.y < ground.y, "higher z = higher on screen (smaller y)");
  // 10 ft × 2.4 px/ft × cos(30°) ≈ 20.78
  assert.ok(Math.abs(up.y + 10 * 2.4 * Math.cos(TILT)) < 1e-6, "z scaled by PX_PER_FT exactly once");
  const far = project({ x: 50, y: 120, z: 0 }, 0, TILT, c); // dy=+80
  assert.ok(far.depth > ground.depth, "points farther back have larger depth");
});

test("buildMassing: square → 4 wall quads, all finite, plus lifted roof edges", () => {
  const skel = {
    ridges: [{ points: [{ x: 25, y: 40 }, { x: 75, y: 40 }] }],
    hips: [{ points: [{ x: 0, y: 0 }, { x: 25, y: 40 }] }],
    valleys: [],
    gables: [{ points: [{ x: 0, y: 0 }, { x: 0, y: 80 }] }],
  };
  const { faces, edges } = buildMassing(SQUARE, 20, skel, 8);
  assert.equal(faces.length, 4, "one wall quad per edge");
  assert.ok(
    faces.every((f) => f.verts.length === 4 && f.verts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))),
    "all wall verts finite",
  );
  // wall verts span z 0..20
  assert.ok(faces[0].verts.some((v) => v.z === 0) && faces[0].verts.some((v) => v.z === 20));
  // ridge endpoints lifted to wall+rise = 28
  const ridge = edges.find((e) => e.kind === "ridge")!;
  assert.equal(ridge.a.z, 28);
  // hip end on the perimeter corner (0,0) stays at wall top (20), inner end lifts
  const hip = edges.find((e) => e.kind === "hip")!;
  assert.ok((hip.a.z === 20) !== (hip.b.z === 20), "hip has one low (eave) end and one high end");
  // gable becomes a triangle: base + 2 rakes => >=3 gable edges
  assert.ok(edges.filter((e) => e.kind === "gable").length >= 3, "gable drawn as a triangle");
});

test("buildMassing: per-edge tier heights step the lower wall down, roof at body", () => {
  const skel = { ridges: [{ points: [{ x: 25, y: 40 }, { x: 75, y: 40 }] }], hips: [], valleys: [], gables: [] };
  const wallFtFor = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.y === 0 && b.y === 0 ? 10 : 20; // top edge = lower porch
  const { faces, edges } = buildMassing(SQUARE, wallFtFor, skel, 8, 20);
  const topWall = faces.find((f) => f.verts[0].y === 0 && f.verts[1].y === 0)!;
  assert.ok(
    topWall.verts.some((v) => v.z === 10) && !topWall.verts.some((v) => v.z === 20),
    "top wall steps to 10",
  );
  const sideWall = faces.find((f) => !(f.verts[0].y === 0 && f.verts[1].y === 0))!;
  assert.ok(sideWall.verts.some((v) => v.z === 20), "body walls stay at 20");
  assert.equal(
    edges.find((e) => e.kind === "ridge")!.a.z,
    28,
    "ridge at body+rise regardless of tiers",
  );
});

test("buildMassing: number wallFt still works (back-compat)", () => {
  const { faces } = buildMassing(SQUARE, 20, { ridges: [], hips: [], valleys: [], gables: [] }, 8);
  assert.ok(faces.every((f) => f.verts.some((v) => v.z === 20)));
});

test("sortFacesByDepth: far faces first (painter's algorithm)", () => {
  const c = { cx: 50, cy: 40 };
  const near: P3[] = [{ x: 50, y: 0, z: 0 }];
  const far: P3[] = [{ x: 50, y: 80, z: 0 }];
  const faces = [
    { verts: near, kind: "wall" as const },
    { verts: far, kind: "wall" as const },
  ];
  const sorted = sortFacesByDepth(faces, (p) => project(p, 0, TILT, c));
  assert.equal(sorted[0].verts, far, "farthest face painted first");
});

test("buildMassing safe on degenerate perimeter", () => {
  const { faces } = buildMassing([{ x: NaN, y: 0 }], 20, { ridges: [], hips: [], valleys: [], gables: [] }, 8);
  assert.ok(Array.isArray(faces));
});
