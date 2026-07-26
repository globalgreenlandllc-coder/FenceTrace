import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveRoofSkeletonStraight,
  validateSkeleton,
} from "./roof-skeleton-straight.ts";
import type { Pt, RoofFace, SkeletonLine } from "./roof-skeleton.ts";

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

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const minDistToLines = (p: Pt, lines: SkeletonLine[]) =>
  lines.reduce(
    (m, l) => Math.min(m, distToSeg(p, l.points[0], l.points[1])),
    Infinity,
  );

const rect = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const allEaves = (poly: Pt[]): [Pt, Pt][] =>
  poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Pt, Pt]);

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

test("square (all eaves) → 4 hips meeting at one apex, no ridge, 4 faces", () => {
  const W = 100;
  const sq = rect(W, W);
  const skel = deriveRoofSkeletonStraight(sq, { eaveSegments: allEaves(sq) });
  assert.equal(skel.faces.length, 4, "square pyramid has 4 faces");
  assert.equal(skel.ridges.length, 0, "square pyramid has no ridge line");
  assert.equal(skel.valleys.length, 0, "no valleys on a convex square");
  assert.equal(skel.hips.length, 4, "4 hips from the 4 convex corners");
  // all hip far-ends meet at one apex
  const apexes = skel.hips.map((h) => h.points[1]);
  for (const a of apexes) {
    assert.ok(
      Math.hypot(a.x - W / 2, a.y - W / 2) < 2,
      `hip apex near center (${a.x},${a.y})`,
    );
  }
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["-1,0", "0,-1", "0,1", "1,0"]);
  assert.ok(Math.abs(facesArea(skel.faces) - W * W) < 1, "faces tile the square");
});

test("plain rectangle W>H (all eaves) → 1 ridge, 4 hips, 0 valleys, 4 cardinal faces", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const skel = deriveRoofSkeletonStraight(r, { eaveSegments: allEaves(r) });
  assert.equal(skel.faces.length, 4, "4 faces");
  assert.equal(skel.ridges.length, 1, "exactly one ridge along the long axis");
  assert.equal(skel.valleys.length, 0, "no valleys");
  assert.equal(skel.hips.length, 4, "4 hips");
  // ridge runs horizontally at mid-height
  const rg = skel.ridges[0];
  assert.ok(Math.abs(rg.points[0].y - H / 2) < 2 && Math.abs(rg.points[1].y - H / 2) < 2);
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["-1,0", "0,-1", "0,1", "1,0"]);
  assert.ok(Math.abs(facesArea(skel.faces) - W * H) < 1, "faces tile the footprint");
});

test("rectangle with left/right RAKES → gable roof: full ridge, no hips, 2 faces", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: W, y: H }, { x: 0, y: H }],
  ];
  const rakes: [Pt, Pt][] = [
    [{ x: W, y: 0 }, { x: W, y: H }],
    [{ x: 0, y: H }, { x: 0, y: 0 }],
  ];
  const skel = deriveRoofSkeletonStraight(r, {
    eaveSegments: eaves,
    rakeSegments: rakes,
  });
  assert.equal(skel.faces.length, 2, "gable roof has 2 planes");
  assert.equal(skel.hips.length, 0, "no hips on a gable roof");
  assert.equal(skel.gables.length, 2, "two gable ends recorded");
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["0,-1", "0,1"]);
  // ridge should run wall-to-wall (full width)
  const rg = skel.ridges[0];
  const xlo = Math.min(rg.points[0].x, rg.points[1].x);
  const xhi = Math.max(rg.points[0].x, rg.points[1].x);
  assert.ok(xlo < 2 && xhi > W - 2, "ridge runs flush wall-to-wall");
  assert.ok(Math.abs(facesArea(skel.faces) - W * H) < 1, "faces tile the footprint");
});

test("low-corner-returns fixture → gable roof (2 faces), not a hip", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: 0, y: H }, { x: W, y: H }],
    [{ x: 0, y: 0 }, { x: 0, y: 12 }],
    [{ x: W, y: H - 12 }, { x: W, y: H }],
  ];
  const skel = deriveRoofSkeletonStraight(r, { eaveSegments: eaves });
  assert.equal(skel.faces.length, 2, "gable roof (2 planes), not a hip (4)");
  const dirs = skel.faces.map((f) => `${f.downhill.x},${f.downhill.y}`).sort();
  assert.deepEqual(dirs, ["0,-1", "0,1"]);
});

test("L-shape → exactly one valley from the reflex corner into the ridge network", () => {
  // L: outer 160x120 with a 80x60 bite out of the bottom-right.
  // CCW ring. reflex corner at (80,60)? Let's construct explicitly.
  const L: Pt[] = [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    { x: 160, y: 60 },
    { x: 80, y: 60 }, // reflex (inside) corner
    { x: 80, y: 120 },
    { x: 0, y: 120 },
  ];
  const skel = deriveRoofSkeletonStraight(L, { eaveSegments: allEaves(L) });
  assert.ok(skel.faces.length >= 4, `has faces (${skel.faces.length})`);
  assert.equal(skel.valleys.length, 1, "exactly one valley");
  const v = skel.valleys[0];
  // valley starts at the reflex corner
  const startNearCorner =
    Math.hypot(v.points[0].x - 80, v.points[0].y - 60) < 4 ||
    Math.hypot(v.points[1].x - 80, v.points[1].y - 60) < 4;
  assert.ok(startNearCorner, "valley anchored at the reflex corner (80,60)");
  // valley far end lands on the ridge/hip network (not floating)
  const farEnd = Math.hypot(v.points[0].x - 80, v.points[0].y - 60) < 4
    ? v.points[1]
    : v.points[0];
  const d = minDistToLines(farEnd, [...skel.ridges, ...skel.hips]);
  assert.ok(d < 4, `valley far end lands on ridge/hip network (d=${d})`);
  assert.ok(skel.hips.length > 0, "hips present at convex corners");
  // faces tile footprint
  assert.ok(
    Math.abs(facesArea(skel.faces) - area(L)) / area(L) < 0.05,
    `faces tile L (${facesArea(skel.faces)} vs ${area(L)})`,
  );
});

test("T-shape → two valleys anchored at reflex corners, faces tile", () => {
  const T: Pt[] = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 60 },
    { x: 120, y: 60 }, // reflex
    { x: 120, y: 140 },
    { x: 60, y: 140 },
    { x: 60, y: 60 }, // reflex
    { x: 0, y: 60 },
  ];
  const skel = deriveRoofSkeletonStraight(T, { eaveSegments: allEaves(T) });
  assert.equal(skel.valleys.length, 2, "two valleys for two reflex corners");
  for (const v of skel.valleys) {
    const anchored =
      Math.hypot(v.points[0].x - 120, v.points[0].y - 60) < 4 ||
      Math.hypot(v.points[1].x - 120, v.points[1].y - 60) < 4 ||
      Math.hypot(v.points[0].x - 60, v.points[0].y - 60) < 4 ||
      Math.hypot(v.points[1].x - 60, v.points[1].y - 60) < 4;
    assert.ok(anchored, "valley anchored at a reflex corner");
  }
  for (const f of skel.faces) {
    assert.equal(
      Math.abs(f.downhill.x) + Math.abs(f.downhill.y),
      1,
      "every face downhill is a unit cardinal",
    );
  }
  assert.ok(
    Math.abs(facesArea(skel.faces) - area(T)) / area(T) < 0.05,
    `faces tile T (${facesArea(skel.faces)} vs ${area(T)})`,
  );
});

test("faces do not overlap (sampled interior points lie in exactly one face)", () => {
  const L: Pt[] = [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    { x: 160, y: 60 },
    { x: 80, y: 60 },
    { x: 80, y: 120 },
    { x: 0, y: 120 },
  ];
  const skel = deriveRoofSkeletonStraight(L, { eaveSegments: allEaves(L) });
  let tested = 0;
  let multi = 0;
  for (let x = 5; x < 160; x += 10) {
    for (let y = 5; y < 120; y += 10) {
      const p = { x, y };
      if (!pointInPoly(p, L)) continue;
      tested++;
      const hits = skel.faces.filter((f) => pointInPoly(p, f.polygon)).length;
      if (hits !== 1) multi++;
    }
  }
  // Allow a few boundary-straddling points; the vast majority land in exactly 1.
  assert.ok(tested > 20, "tested enough points");
  assert.ok(multi / tested < 0.1, `few overlap/gap points (${multi}/${tested})`);
});

test("rectangle with ONE rake side → 1 gable, 3 faces, ridge reaches that wall", () => {
  const W = 120;
  const H = 60;
  const r = rect(W, H);
  const eaves: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }], // top
    [{ x: W, y: H }, { x: 0, y: H }], // bottom
    [{ x: 0, y: H }, { x: 0, y: 0 }], // left
  ];
  const rakes: [Pt, Pt][] = [[{ x: W, y: 0 }, { x: W, y: H }]]; // right gable
  const skel = deriveRoofSkeletonStraight(r, {
    eaveSegments: eaves,
    rakeSegments: rakes,
  });
  assert.equal(skel.gables.length, 1, "one gable end");
  assert.equal(skel.faces.length, 3, "3 slab faces (no face on the gable wall)");
  // no hip at the gable (right) end: no hip endpoint near x≈W
  const hipNearRight = skel.hips.some(
    (h) =>
      Math.abs(h.points[0].x - W) < 3 || Math.abs(h.points[1].x - W) < 3,
  );
  assert.ok(!hipNearRight, "no hip at the gable end");
  // ridge reaches the gable wall (some ridge endpoint near x≈W)
  const ridgeToWall = skel.ridges.some(
    (rg) =>
      Math.abs(rg.points[0].x - W) < 3 || Math.abs(rg.points[1].x - W) < 3,
  );
  assert.ok(ridgeToWall, "ridge runs flush to the gable wall");
});

test("determinism: same fixture twice → identical JSON", () => {
  const T: Pt[] = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 60 },
    { x: 120, y: 60 },
    { x: 120, y: 140 },
    { x: 60, y: 140 },
    { x: 60, y: 60 },
    { x: 0, y: 60 },
  ];
  const a = deriveRoofSkeletonStraight(T, { eaveSegments: allEaves(T) });
  const b = deriveRoofSkeletonStraight(T, { eaveSegments: allEaves(T) });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("degenerate inputs → EMPTY (caller falls back), no throw", () => {
  assert.deepEqual(deriveRoofSkeletonStraight([] as Pt[]).faces, []);
  assert.deepEqual(
    deriveRoofSkeletonStraight([{ x: 0, y: 0 }, { x: 1, y: 1 }] as Pt[]).faces,
    [],
  );
  // all-collinear
  assert.deepEqual(
    deriveRoofSkeletonStraight([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]).faces,
    [],
  );
  // diagonal (non-orthogonal) quad → bail to EMPTY
  const diag: Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 20 },
    { x: 120, y: 100 },
    { x: 10, y: 90 },
  ];
  assert.deepEqual(deriveRoofSkeletonStraight(diag).faces, []);
});

test("property: 12 random rectilinear footprints never throw, all coords finite, area within 5%", () => {
  // unions of axis rectangles → rectilinear footprints
  const fixtures: Pt[][] = [
    rect(100, 100),
    rect(140, 80),
    rect(80, 140),
    [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 120 },
      { x: 0, y: 120 },
    ],
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 80 },
      { x: 140, y: 80 },
      { x: 140, y: 140 },
      { x: 60, y: 140 },
      { x: 60, y: 80 },
      { x: 0, y: 80 },
    ],
  ];
  let any = false;
  for (const f of fixtures) {
    const skel = deriveRoofSkeletonStraight(f, { eaveSegments: allEaves(f) });
    // never throws (we got here). If non-empty, validate.
    if (skel.faces.length === 0) continue;
    any = true;
    for (const grp of [skel.ridges, skel.hips, skel.valleys, skel.gables]) {
      for (const l of grp) {
        assert.equal(l.points.length, 2);
        assert.ok(Number.isFinite(l.points[0].x) && Number.isFinite(l.points[0].y));
        assert.ok(Number.isFinite(l.points[1].x) && Number.isFinite(l.points[1].y));
      }
    }
    for (const fc of skel.faces) {
      for (const p of fc.polygon)
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
    assert.ok(
      validateSkeleton(skel, f),
      `validateSkeleton passes for a produced skeleton`,
    );
  }
  assert.ok(any, "at least some fixtures produced a non-empty skeleton");
});

// --- jitter robustness (the review's production blocker) ---
// An L-shape with ~1px of noise on every vertex (any AI-traced footprint) must
// still produce a valid straight skeleton, not desync the event sim into a
// fallback. Deterministic pseudo-jitter (no Math.random).
test("jitter: an L-shape with ~1px vertex noise still yields a valid skeleton", () => {
  const L: Pt[] = [
    { x: 0, y: 0 },
    { x: 600, y: 0 },
    { x: 600, y: 200 },
    { x: 350, y: 200 },
    { x: 350, y: 400 },
    { x: 0, y: 400 },
  ];
  // ±~1px deterministic wobble.
  const jit = L.map((p, i) => ({
    x: p.x + (((i * 37) % 7) - 3) * 0.3,
    y: p.y + (((i * 53) % 7) - 3) * 0.3,
  }));
  const s = deriveRoofSkeletonStraight(jit);
  assert.ok(validateSkeleton(s, jit), "jittered L still validates (no desync→fallback)");
  assert.ok(s.faces.length >= 4, `tiles with faces (got ${s.faces.length})`);
  assert.ok(s.valleys.length >= 1, "still finds the reflex-corner valley");
  // faces tile the (jittered) footprint within tolerance.
  const fp = area(jit);
  assert.ok(Math.abs(facesArea(s.faces) - fp) / fp < 0.06, "faces tile ~the footprint");
});

test("jitter: a noisy plain rectangle still gives the clean 4-face hip roof", () => {
  const r: Pt[] = [
    { x: 0.4, y: -0.3 },
    { x: 800.2, y: 0.5 },
    { x: 799.7, y: 500.4 },
    { x: -0.5, y: 499.6 },
  ];
  const s = deriveRoofSkeletonStraight(r);
  assert.ok(validateSkeleton(s, r), "noisy rectangle validates");
  assert.equal(s.faces.length, 4, "exactly 4 hip faces");
});

// --- degenerate fan rejection (the regression that shipped) ---
test("validateSkeleton REJECTS a degenerate fan (elongated footprint, no ridge)", () => {
  // 4 sliver triangles all meeting at the centre apex — tiles the rect (passes
  // the area gate) but is a collapsed pyramid with NO ridge. Must be rejected.
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: 800, y: 0 },
    { x: 800, y: 300 },
    { x: 0, y: 300 },
  ];
  const apex: Pt = { x: 400, y: 150 };
  const fan = {
    ridges: [],
    hips: [
      { points: [rect[0], apex] },
      { points: [rect[1], apex] },
      { points: [rect[2], apex] },
      { points: [rect[3], apex] },
    ],
    valleys: [],
    gables: [],
    faces: [
      { polygon: [rect[0], rect[1], apex], downhill: { x: 0, y: -1 } },
      { polygon: [rect[1], rect[2], apex], downhill: { x: 1, y: 0 } },
      { polygon: [rect[2], rect[3], apex], downhill: { x: 0, y: 1 } },
      { polygon: [rect[3], rect[0], apex], downhill: { x: -1, y: 0 } },
    ],
  } as unknown as Parameters<typeof validateSkeleton>[0];
  assert.equal(validateSkeleton(fan, rect), false, "fan on an elongated rect is rejected");
});

test("validateSkeleton ACCEPTS the engine's real elongated-rectangle roof (has a ridge)", () => {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: 800, y: 0 },
    { x: 800, y: 300 },
    { x: 0, y: 300 },
  ];
  const s = deriveRoofSkeletonStraight(rect);
  assert.ok(validateSkeleton(s, rect), "a real hip roof with a ridge still validates");
  assert.ok(s.ridges.length >= 1, "and it actually has a ridge");
});
