/**
 * Pure node tests for orientation-anchor. Run: npx tsx --test lib/orientation-anchor.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { perimBBox, anchorForSide, sideSplit, type EaveMid } from "./orientation-anchor.ts";

const BB = { minX: 0, minY: 0, maxX: 200, maxY: 120 };

const offEdge = (at: { x: number; y: number }, side: "front" | "back" | "left" | "right", bb = BB) => {
  if (side === "front" || side === "back") return at.y < bb.minY || at.y > bb.maxY;
  return at.x < bb.minX || at.x > bb.maxX;
};

test("FRONT split top porch + bottom main -> snaps to the long (bottom) edge, never interior", () => {
  // porch eave near top (len 22), main eaves near bottom (52 + 35) -> bottom wins
  const mids: EaveMid[] = [
    { x: 100, y: 8, len: 22 },
    { x: 50, y: 115, len: 52 },
    { x: 150, y: 115, len: 35 },
  ];
  const at = anchorForSide(mids, "front", BB, 1)!;
  assert.ok(at, "returns a point");
  assert.ok(at.y > BB.maxY, `y (${at.y}) must be below the bottom edge, off-edge`);
  assert.ok(at.y < BB.minY === false, "not above");
  assert.ok(at.x >= BB.minX && at.x <= BB.maxX, "x clamped within the building span");
  // length-weighted parallel mean of the bottom bucket, NOT dragged by the porch
  assert.ok(Math.abs(at.x - (50 * 52 + 150 * 35) / 87) < 0.01, "x is length-weighted mean of winning bucket");
  assert.ok(offEdge(at, "front"), "off-edge invariant");
});

test("LEFT / RIGHT single clusters snap to their own vertical edge (regression)", () => {
  const left = anchorForSide([{ x: 2, y: 60, len: 65 }], "left", BB, 1)!;
  assert.ok(left.x < BB.minX, "LEFT off the left edge");
  assert.equal(left.y, 60);
  const right = anchorForSide([{ x: 198, y: 60, len: 65 }], "right", BB, 1)!;
  assert.ok(right.x > BB.maxX, "RIGHT off the right edge");
  assert.ok(offEdge(left, "left") && offEdge(right, "right"));
});

test("axis-restriction: corner-hugging LEFT eave on a wide-short bbox stays on the LEFT edge", () => {
  const wide = { minX: 0, minY: 0, maxX: 900, maxY: 100 };
  const at = anchorForSide([{ x: 5, y: 50, len: 80 }], "left", wide, 1)!;
  assert.ok(at.x < wide.minX, "snaps to LEFT (x negative), NOT flipped to top/bottom");
  assert.equal(at.y, 50);
});

test("scale scales the pad", () => {
  const a1 = anchorForSide([{ x: 100, y: 115, len: 40 }], "front", BB, 1)!;
  const a2 = anchorForSide([{ x: 100, y: 115, len: 40 }], "front", BB, 2)!;
  assert.equal(a1.y, BB.maxY + 22);
  assert.equal(a2.y, BB.maxY + 44, "pad doubles with scale 2");
});

test("degenerate inputs never produce NaN", () => {
  assert.equal(anchorForSide([], "front", BB, 1), null);
  assert.equal(anchorForSide([{ x: 1, y: 1, len: 1 }], "front", null, 1), null);
  assert.equal(perimBBox([{ x: 0, y: 0 }]), null, "<2 pts -> null bbox");
  assert.equal(perimBBox([{ x: NaN, y: 0 }, { x: 1, y: 1 }]), null, "drops non-finite -> <2 -> null");
  const bb = perimBBox([{ x: 5, y: 5 }, { x: 5, y: 60 }]); // collapsed X
  assert.ok(bb && bb.maxX - bb.minX >= 1, "collapsed axis widened to >=1");
});

test("no input mutation (frozen mids array + elements)", () => {
  const mids: EaveMid[] = [Object.freeze({ x: 100, y: 8, len: 22 }), Object.freeze({ x: 60, y: 115, len: 80 })] as EaveMid[];
  Object.freeze(mids);
  assert.doesNotThrow(() => anchorForSide(mids, "front", BB, 1));
});

test("sideSplit flags a genuine top/bottom split, not a clean cluster", () => {
  const split = sideSplit([{ x: 100, y: 8, len: 30 }, { x: 100, y: 115, len: 50 }], "front", BB);
  assert.equal(split.split, true);
  assert.ok(Math.abs(split.minorityFrac - 30 / 80) < 0.01);
  const clean = sideSplit([{ x: 50, y: 115, len: 52 }, { x: 150, y: 115, len: 35 }], "front", BB);
  assert.equal(clean.split, false, "both near bottom -> not split");
});
