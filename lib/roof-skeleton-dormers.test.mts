/**
 * Pure node tests for segmentsOverlap + extraGablesFromRakes.
 * Run: npx tsx --test lib/roof-skeleton-dormers.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segmentsOverlap,
  extraGablesFromRakes,
  type Seg,
  type SkeletonLine,
} from "./roof-skeleton.ts";

const seg = (ax: number, ay: number, bx: number, by: number): Seg => [
  { x: ax, y: ay },
  { x: bx, y: by },
];

test("segmentsOverlap: collinear+overlapping true; offset/perpendicular false", () => {
  assert.equal(segmentsOverlap(seg(0, 0, 100, 0), seg(20, 0, 80, 0), 5), true);
  assert.equal(segmentsOverlap(seg(0, 0, 100, 0), seg(20, 30, 80, 30), 5), false); // parallel, offset
  assert.equal(segmentsOverlap(seg(0, 0, 100, 0), seg(50, 0, 50, 50), 5), false); // perpendicular
  assert.equal(segmentsOverlap(seg(0, 0, 100, 0), seg(120, 0, 200, 0), 5), false); // collinear, disjoint
});

const PERIM = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 160 },
  { x: 0, y: 160 },
];
const skelGables: SkeletonLine[] = [{ points: [{ x: 0, y: 0 }, { x: 0, y: 160 }] }]; // left whole-side gable
const eaves: Seg[] = [seg(0, 0, 300, 0), seg(0, 160, 300, 160)]; // top + bottom eaves

test("extraGablesFromRakes: shows gables the skeleton missed, drops dupes/eave-lines/slivers", () => {
  const rakes: Seg[] = [
    seg(0, 0, 0, 160), // == left skeleton gable -> DEDUPED
    seg(0, 0, 300, 0), // == top eave -> DROPPED (on gutter line)
    seg(120, 40, 180, 40), // mid-face dormer/cross-gable -> KEPT
    seg(200, 5, 205, 5), // 5px sliver -> DROPPED (< minLen)
    seg(300, 0, 300, 160), // right side rake the skeleton didn't make a gable -> KEPT
  ];
  const out = extraGablesFromRakes(rakes, skelGables, PERIM, eaves);
  // Expect the mid dormer + the right side (2), not the dup/eave/sliver.
  assert.equal(out.length, 2, `expected 2 extra gables, got ${out.length}`);
  const mids = out.map((d) => `${Math.round(d.mid.x)},${Math.round(d.mid.y)}`);
  assert.ok(mids.includes("150,40"), "mid-face dormer kept");
  assert.ok(mids.includes("300,80"), "right-side gable kept");
  // inward dir points toward centroid (150,80)
  const dormer = out.find((d) => Math.round(d.mid.x) === 150)!;
  assert.ok(dormer.dir.y > 0.9, "mid dormer points inward (down)");
  const right = out.find((d) => Math.round(d.mid.x) === 300)!;
  assert.ok(right.dir.x < -0.9, "right gable points inward (left)");
});

test("extraGablesFromRakes: empty/malformed safe", () => {
  assert.deepEqual(extraGablesFromRakes([], skelGables, PERIM, eaves), []);
  assert.deepEqual(extraGablesFromRakes([seg(0, 0, 0, 0)], skelGables, PERIM, eaves), []); // zero-length
  assert.deepEqual(extraGablesFromRakes([seg(0, 0, 100, 0)], skelGables, [{ x: 0, y: 0 }], eaves), []); // <3 perim pts
});

test("extraGablesFromRakes: a rake just past eaveTol off a side is shown (not silently lost)", () => {
  // skeleton only made the LEFT a gable; the AI also traced a RIGHT rake offset
  // slightly. It must surface as an extra gable, never vanish.
  const rakes: Seg[] = [seg(298, 0, 298, 160)]; // ~2px inside the right edge
  const out = extraGablesFromRakes(rakes, skelGables, PERIM, eaves);
  assert.equal(out.length, 1, "offset right rake surfaces as an extra gable");
});
