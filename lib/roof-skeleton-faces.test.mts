import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveRoofSkeleton, type Pt, type RoofFace } from "./roof-skeleton.ts";

/** Sum of polygon areas — sanity that faces actually cover the footprint. */
function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
const facesArea = (fs: RoofFace[]) => fs.reduce((s, f) => s + area(f.polygon), 0);

const rect = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

test("rectangle (all eaves) → 4 hip faces tiling the footprint", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: W, y: 0 }, { x: W, y: H }],
    [{ x: W, y: H }, { x: 0, y: H }],
    [{ x: 0, y: H }, { x: 0, y: 0 }],
  ];
  const skel = deriveRoofSkeleton(r, { eaveSegments: eaves });
  // A hip roof on a rectangle = 4 planes (2 trapezoids + 2 triangles).
  assert.equal(skel.faces.length, 4, "hip roof has 4 planes");
  // Each cardinal downhill direction appears once.
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["-1,0", "0,-1", "0,1", "1,0"]);
  // The planes tile the footprint (areas sum to W*H, no gaps/overlaps).
  assert.ok(
    Math.abs(facesArea(skel.faces) - W * H) < 1,
    `faces cover the footprint (${facesArea(skel.faces)} vs ${W * H})`,
  );
});

test("rectangle with gable ends (left/right rakes) → 2 faces, full-width ridge", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  // Eaves on top + bottom only; left + right are rakes (gable ends).
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: W, y: H }, { x: 0, y: H }],
  ];
  const rakes: [Pt, Pt][] = [
    [{ x: W, y: 0 }, { x: W, y: H }],
    [{ x: 0, y: H }, { x: 0, y: 0 }],
  ];
  const skel = deriveRoofSkeleton(r, { eaveSegments: eaves, rakeSegments: rakes });
  // A gable roof = 2 slopes only (no hip triangles on the gable ends).
  assert.equal(skel.faces.length, 2, "gable roof has 2 planes");
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["0,-1", "0,1"]);
  assert.ok(
    Math.abs(facesArea(skel.faces) - W * H) < 1,
    "gable faces still cover the footprint",
  );
});

test("gable-end sides with only LOW corner returns → gable roof, not a hip", () => {
  // 2-story gable body: full eaves on top+bottom (N/S), but the left+right
  // (E/W) sides carry ONLY a short porch/patio RETURN clipping a corner — the
  // gable face (middle) is bare. Must read as a GABLE roof (2 planes), not a
  // hip (4 planes). This is the Woodinville bug.
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }], // full top eave
    [{ x: 0, y: H }, { x: W, y: H }], // full bottom eave
    [{ x: 0, y: 0 }, { x: 0, y: 12 }], // left: short porch return at the top
    [{ x: W, y: H - 12 }, { x: W, y: H }], // right: short patio return at the bottom
  ];
  const skel = deriveRoofSkeleton(r, { eaveSegments: eaves });
  assert.equal(skel.faces.length, 2, "gable roof (2 planes), not a hip (4)");
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["0,-1", "0,1"], "the two slopes drain N + S");
});

test("never throws; degenerate input → no faces", () => {
  assert.deepEqual(deriveRoofSkeleton([] as Pt[]).faces, []);
  assert.deepEqual(
    deriveRoofSkeleton([{ x: 0, y: 0 }, { x: 1, y: 1 }] as Pt[]).faces,
    [],
  );
});
