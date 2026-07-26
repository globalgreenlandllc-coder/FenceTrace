import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutLabels,
  dropDanglingLines,
  distPointSeg,
  type LabelBox,
} from "./diagram-labels";

function overlaps(
  a: { cx: number; cy: number; w: number; h: number },
  b: { cx: number; cy: number; w: number; h: number },
): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 &&
    Math.abs(a.cy - b.cy) < (a.h + b.h) / 2
  );
}

test("distPointSeg: perpendicular, endpoint, degenerate", () => {
  assert.equal(distPointSeg({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  assert.equal(distPointSeg({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 4);
  assert.equal(distPointSeg({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});

test("layoutLabels: two stacked labels separate without overlap", () => {
  const items: LabelBox[] = [
    { id: "a", cx: 100, cy: 100, w: 40, h: 14 },
    { id: "b", cx: 104, cy: 102, w: 40, h: 14 },
  ];
  const out = layoutLabels(items);
  const A = { ...out.get("a")!, w: 40, h: 14 };
  const B = { ...out.get("b")!, w: 40, h: 14 };
  assert.ok(!overlaps(A, B), "labels still overlap after layout");
});

test("layoutLabels: label moves off a downspout disc", () => {
  const out = layoutLabels(
    [{ id: "a", cx: 50, cy: 50, w: 40, h: 14 }],
    { discs: [{ x: 50, y: 50, r: 8 }] },
  );
  const p = out.get("a")!;
  // Closest point of the rect to the disc center must clear the radius.
  const qx = Math.min(p.cx + 20, Math.max(p.cx - 20, 50));
  const qy = Math.min(p.cy + 7, Math.max(p.cy - 7, 50));
  assert.ok(Math.hypot(qx - 50, qy - 50) >= 8, "label still covers the pin");
  assert.ok(p.moved > 0);
});

test("layoutLabels: label pushed off a line it crosses", () => {
  const out = layoutLabels(
    [{ id: "a", cx: 50, cy: 50, w: 40, h: 14 }],
    { segments: [{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }] },
  );
  const p = out.get("a")!;
  assert.ok(
    Math.abs(p.cy - 50) >= 7,
    `label center only ${Math.abs(p.cy - 50)} off the line`,
  );
});

test("layoutLabels: bounds clamp wins", () => {
  const out = layoutLabels(
    [{ id: "a", cx: 2, cy: 2, w: 40, h: 14 }],
    {},
    { bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 } },
  );
  const p = out.get("a")!;
  assert.ok(p.cx >= 20 && p.cy >= 7, "label escaped the frame");
});

test("layoutLabels: non-colliding label stays put (moved = 0)", () => {
  const out = layoutLabels(
    [{ id: "a", cx: 100, cy: 100, w: 40, h: 14 }],
    { discs: [{ x: 300, y: 300, r: 8 }] },
  );
  assert.equal(out.get("a")!.moved, 0);
});

test("layoutLabels: deterministic across runs", () => {
  const items: LabelBox[] = [
    { id: "a", cx: 10, cy: 10, w: 30, h: 12 },
    { id: "b", cx: 12, cy: 12, w: 30, h: 12 },
    { id: "c", cx: 14, cy: 8, w: 30, h: 12 },
  ];
  const r1 = layoutLabels(items);
  const r2 = layoutLabels(items);
  for (const id of ["a", "b", "c"]) {
    assert.deepEqual(r1.get(id), r2.get(id));
  }
});

// ---------------------------------------------------------------------------
// dropDanglingLines
// ---------------------------------------------------------------------------

// Square perimeter 0,0 → 100,100 as anchor segments.
const PERIM: [
  { x: number; y: number },
  { x: number; y: number },
][] = [
  [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  [{ x: 100, y: 0 }, { x: 100, y: 100 }],
  [{ x: 100, y: 100 }, { x: 0, y: 100 }],
  [{ x: 0, y: 100 }, { x: 0, y: 0 }],
];

test("dropDanglingLines: floating porch-ridge stub is removed", () => {
  const stub = { points: [{ x: 50, y: 60 }, { x: 50, y: 88 }] }; // 12px shy of the bottom wall
  const kept = dropDanglingLines([stub], PERIM, 6);
  assert.equal(kept.length, 0);
});

test("dropDanglingLines: hip pair + ridge (connected skeleton) survives", () => {
  const hipL1 = { points: [{ x: 0, y: 0 }, { x: 30, y: 50 }] };
  const hipL2 = { points: [{ x: 0, y: 100 }, { x: 30, y: 50 }] };
  const ridge = { points: [{ x: 30, y: 50 }, { x: 70, y: 50 }] };
  const hipR1 = { points: [{ x: 100, y: 0 }, { x: 70, y: 50 }] };
  const hipR2 = { points: [{ x: 100, y: 100 }, { x: 70, y: 50 }] };
  const kept = dropDanglingLines([hipL1, hipL2, ridge, hipR1, hipR2], PERIM, 6);
  assert.equal(kept.length, 5);
});

test("dropDanglingLines: chain hanging off nothing removed to fixpoint", () => {
  // B touches A, A touches nothing — removing A must also remove B.
  const A = { points: [{ x: 40, y: 40 }, { x: 60, y: 40 }] };
  const B = { points: [{ x: 60, y: 40 }, { x: 60, y: 60 }] };
  const kept = dropDanglingLines([A, B], PERIM, 6);
  assert.equal(kept.length, 0);
});

test("dropDanglingLines: ridge touching wall at one end, hip at other, kept", () => {
  const ridge = { points: [{ x: 50, y: 2 }, { x: 50, y: 50 }] }; // top end ~on the top wall
  const hip = { points: [{ x: 0, y: 100 }, { x: 50, y: 50 }] };
  const hip2 = { points: [{ x: 100, y: 100 }, { x: 50, y: 50 }] };
  const kept = dropDanglingLines([ridge, hip, hip2], PERIM, 6);
  assert.equal(kept.length, 3);
});

test("dropDanglingLines: preserves input order and drops degenerate lines", () => {
  const a = { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }; // wall-to-wall
  const bad = { points: [{ x: 10, y: 10 }] };
  const kept = dropDanglingLines([bad as { points: { x: number; y: number }[] }, a], PERIM, 6);
  assert.deepEqual(kept, [a]);
});

test("polylineLabelAnchor: closed loop anchors on longest leg, not the seam", async () => {
  const { polylineLabelAnchor } = await import("./diagram-labels");
  const loop = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 0 },
  ];
  const a = polylineLabelAnchor(loop)!;
  assert.equal(a.mid.y === 0 || a.mid.y === 20, true); // one of the 40-long legs
  assert.equal(Math.abs(a.nx), 0);
  assert.equal(Math.abs(a.ny), 1);
});

test("polylineLabelAnchor: degenerate polyline returns null", async () => {
  const { polylineLabelAnchor } = await import("./diagram-labels");
  assert.equal(polylineLabelAnchor([{ x: 5, y: 5 }, { x: 5, y: 5 }]), null);
});
