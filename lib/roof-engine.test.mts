/**
 * Pure node tests for the roof geometry engine. Run with:
 *   npx tsx --test lib/roof-engine.test.mts
 * No DB, no AI, no network — hand-authored masses in engine coordinate space.
 *
 * The integration test reproduces the spec's `demo_woodinville()` as an oracle:
 * if the ported geometry drifts, the pinned eave LF / interior-line / downspout
 * / flag counts move and the test fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGableByRule,
  gablePeakHeightFt,
  isProjecting,
  polygonCloses,
  reentrantCorners,
  polyArea,
  runRoofEngine,
  type Gable,
  type MassInput,
} from "./roof-engine.ts";

// ── polygon closure / simplicity ───────────────────────────────────────────

test("polygonCloses accepts a simple square, rejects a bow-tie and degenerate", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(polygonCloses(square), true);

  // Bow-tie (self-intersecting): swap the last two vertices.
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];
  assert.equal(polygonCloses(bowtie), false);

  assert.equal(polygonCloses([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
  assert.equal(polygonCloses([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 1 }]), false);
});

// ── reentrant corners ──────────────────────────────────────────────────────

test("reentrantCorners finds exactly one reflex corner on an L-shape", () => {
  // L-shape (CCW): one inside corner at (10,10).
  const L = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
  ];
  const reflex = reentrantCorners(L);
  assert.equal(reflex.length, 1);
  assert.deepEqual(reflex[0], { x: 10, y: 10 });

  // A convex rectangle has none.
  assert.equal(
    reentrantCorners([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]).length,
    0,
  );
});

// ── gable-by-rule ──────────────────────────────────────────────────────────

test("buildGableByRule: projecting gable yields 2 rakes, 2 side eaves, 1 ridge-back, 2 valleys", () => {
  const g: Gable = {
    baseCenter: { x: 10, y: 44 },
    span: 16,
    pitch: 6,
    projection: 4,
    facing: "S",
    name: "g",
  };
  assert.equal(isProjecting(g), true);
  const L = buildGableByRule(g);
  assert.equal(L.projecting, true);
  assert.equal(L.rakes.length, 2);
  assert.equal(L.sideEaves.length, 2);
  assert.equal(L.ridgeBack.length, 1);
  assert.equal(L.valleys.length, 2);
  // Each side eave's length equals the projection depth (LAW 2).
  for (const [a, b] of L.sideEaves) {
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 4) < 1e-9);
  }
});

test("buildGableByRule: flush gable (projection 0) contributes no gutter but DRAWS ridge + valleys", () => {
  const g: Gable = { baseCenter: { x: 30, y: 44 }, span: 12, pitch: 4, projection: 0, facing: "S" };
  assert.equal(isProjecting(g), false);
  const L = buildGableByRule(g);
  assert.equal(L.projecting, false);
  assert.equal(L.rakes.length, 2);
  assert.equal(L.sideEaves.length, 0); // no gutter — the pricing-safe invariant
  assert.equal(L.ridgeBack.length, 1); // a flush cross-gable still has a ridge-back
  assert.equal(L.valleys.length, 2); // ...and two valleys, so it draws as a real gable in plan
});

test("buildGableByRule: a SET-BACK (dormer) gable draws INSIDE the eave; front eave untouched", () => {
  // Case 2 — the gable base reads above the eave line, so it sits setbackFt in.
  // baseCenter on the eave (y=0), facing N (out = {0,-1}); set back 6 ft.
  const g: Gable = { baseCenter: { x: 30, y: 0 }, span: 12, pitch: 6, projection: 0, facing: "N", setbackFt: 6 };
  const L = buildGableByRule(g);
  assert.equal(L.projecting, false);
  assert.equal(L.sideEaves.length, 0); // a dormer adds NO gutter
  assert.equal(L.ridgeBack.length, 1);
  assert.equal(L.valleys.length, 2);
  // The whole gable is shifted 6 ft inside the eave: base = (30,0) − out·6 = (30,6),
  // so every drawn point sits at y ≥ 6 (behind the eave, never on it).
  const pts = [...L.rakes, ...L.ridgeBack, ...L.valleys].flat();
  for (const p of pts) assert.ok(p.y >= 6 - 1e-9, `point y=${p.y} should be behind the eave (≥6)`);
  assert.ok(Math.abs(L.peak.x - 30) < 1e-9 && Math.abs(L.peak.y - 6) < 1e-9, "peak sits at the set-back base");
});

test("buildGableByRule: setbackFt 0 (and omitted) is byte-identical — no regression", () => {
  const g = { baseCenter: { x: 30, y: 0 }, span: 12, pitch: 6, projection: 0, facing: "N" as const };
  assert.deepEqual(buildGableByRule({ ...g, setbackFt: 0 }), buildGableByRule(g));
});

test("a set-back dormer gable adds ZERO gutter — the eave runs whole in front", () => {
  const res = runRoofEngine([
    {
      name: "m",
      outline: box(64, 44),
      statedArea: null,
      eaveEdges: [0, 1, 2, 3],
      gables: [{ baseCenter: { x: 32, y: 0 }, span: 14, pitch: 6, projection: 0, facing: "N", setbackFt: 8, name: "dormer" }],
    },
  ]);
  const mass = res.masses[0];
  assert.equal(mass.edges.filter((e) => e.gutter).length, 4); // 4 perimeter eaves; the dormer adds none
  assert.equal(res.eaveLfByMass.m, 216);
  // It still draws its ridge + 2 valleys, set back behind the (guttered) eave.
  assert.equal(mass.interior.filter((e) => e.type === "valley" && e.source?.startsWith("gable:")).length, 2);
});

test("gablePeakHeightFt: (span/2) x (pitch/12)", () => {
  assert.equal(gablePeakHeightFt({ baseCenter: { x: 0, y: 0 }, span: 16, pitch: 6, projection: 0, facing: "S" }), 4);
  assert.equal(gablePeakHeightFt({ baseCenter: { x: 0, y: 0 }, span: 24, pitch: 4, projection: 0, facing: "S" }), 4);
});

// ── polyArea ───────────────────────────────────────────────────────────────

test("polyArea: shoelace of a 64x44 rectangle", () => {
  assert.equal(
    polyArea([
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 44 },
      { x: 0, y: 44 },
    ]),
    2816,
  );
});

// ── gates via runRoofEngine ────────────────────────────────────────────────

test("area gate: within tolerance → info OK; over → warn FLAG; missing → no_schedule", () => {
  const within = runRoofEngine([
    { name: "m", outline: box(64, 44), statedArea: 2902, eaveEdges: [0, 1, 2, 3] },
  ]);
  const wf = within.reviewFlags.find((f) => f.code === "area_gate");
  assert.ok(wf && wf.severity === "info");

  const over = runRoofEngine([
    { name: "m", outline: box(64, 44), statedArea: 5000, eaveEdges: [0, 1, 2, 3] },
  ]);
  const of = over.reviewFlags.find((f) => f.code === "area_gate");
  assert.ok(of && of.severity === "warn");

  const none = runRoofEngine([{ name: "m", outline: box(64, 44), eaveEdges: [0, 1, 2, 3] }]);
  assert.ok(none.reviewFlags.some((f) => f.code === "no_schedule"));
});

test("anchor gate: a gable whose base floats off the roof edge is flagged", () => {
  const res = runRoofEngine([
    {
      name: "m",
      outline: box(64, 44),
      statedArea: 2816,
      eaveEdges: [0, 1, 2, 3],
      // Base at y=30 — 14 ft inboard of every edge → cannot be anchored.
      gables: [{ baseCenter: { x: 32, y: 30 }, span: 12, pitch: 4, projection: 3, facing: "S", name: "float" }],
    },
  ]);
  assert.ok(res.reviewFlags.some((f) => f.code === "gable_unanchored" && f.severity === "error"));
});

test("flush front gable does NOT break the front eave (keeps a single perimeter eave, adds no eaves)", () => {
  const res = runRoofEngine([
    {
      name: "m",
      outline: box(64, 44),
      statedArea: 2816,
      eaveEdges: [0, 1, 2, 3],
      gables: [{ baseCenter: { x: 32, y: 0 }, span: 16, pitch: 6, projection: 0, facing: "N", name: "flushfront" }],
    },
  ]);
  const mass = res.masses[0];
  const eaveEdges = mass.edges.filter((e) => e.gutter);
  // Only the 4 perimeter eaves — the flush gable adds NO gutter.
  assert.equal(eaveEdges.length, 4);
  // It draws a ridge-back + two valleys (so it shows as a real gable in plan),
  // but still adds no side eaves — zero gutter.
  assert.equal(mass.interior.filter((e) => e.type === "ridge" && e.source?.startsWith("gable:")).length, 1);
  assert.equal(mass.interior.filter((e) => e.type === "valley" && e.source?.startsWith("gable:")).length, 2);
  // The clean main-roof skeleton is drawn too (decorative), but adds no eaves.
  assert.ok(mass.interior.some((e) => e.type === "hip" && e.source === "skeleton"));
  assert.ok(res.reviewFlags.some((f) => f.code === "gable_flush"));
});

// ── default-flush is conservative (the executable safety guarantee) ─────────

test("default-flush is conservative: a flush gable never prices higher than the same gable projecting", () => {
  // Identical roof + gable, differing ONLY in projection. Flush (0) must price
  // at or below projecting (>0) — this is the construction-true encoding of
  // "the engine can't inflate LF from a projection it hasn't confirmed."
  const roof = (proj: number) =>
    runRoofEngine([
      {
        name: "m",
        outline: box(64, 44),
        statedArea: 2816,
        eaveEdges: [0, 1, 2, 3],
        gables: [gable(32, 44, 12, 4, proj, "S", "g")],
      },
    ]).totalEaveLf;

  const flush = roof(0);
  const projecting = roof(5);
  assert.ok(flush <= projecting, "flush LF must be <= projecting LF");
  // Concretely: flush adds 0 side eaves; projecting adds 2×5 ft = 10.
  assert.equal(flush, 216); // perimeter only
  assert.equal(projecting, 226); // + two 5 ft side eaves

  // Sweep several projections — monotonic non-decreasing, flush is the floor.
  const lfs = [0, 2, 4, 8, 12].map(roof);
  for (let i = 1; i < lfs.length; i++) assert.ok(lfs[i] >= lfs[i - 1]);
  assert.equal(Math.min(...lfs), lfs[0]);
});

// ── the Woodinville oracle (ported from demo_woodinville) ───────────────────

test("demo_woodinville oracle: eave LF, interior lines, downspouts, flags are stable", () => {
  const main: MassInput = {
    name: "main",
    outline: [
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 44 },
      { x: 0, y: 44 },
    ],
    statedArea: 2902,
    eaveEdges: [0, 1, 2, 3],
    gables: [
      gable(10, 44, 16, 6, 4, "S", "G1_greatroom"),
      gable(30, 44, 12, 4, 3, "S", "center"),
      gable(30, 44, 8, 4, 6, "S", "porch"), // on posts ⇒ projecting
      gable(46, 44, 12, 4, 3, "S", "G3_master"),
    ],
  };
  const garage: MassInput = {
    name: "garage",
    outline: [
      { x: 64, y: 10 },
      { x: 88, y: 10 },
      { x: 88, y: 40 },
      { x: 64, y: 40 },
    ],
    eaveEdges: [0, 1, 2, 3],
    gables: [gable(76, 40, 14, 4, 3, "S", "G4_garage")],
  };
  const patio: MassInput = {
    name: "patio",
    outline: [
      { x: 24, y: -16 },
      { x: 40, y: -16 },
      { x: 40, y: 0 },
      { x: 24, y: 0 },
    ],
    statedArea: 228,
    eaveEdges: [1, 3],
    gables: [gable(32, -16, 16, 4, 0, "N", "patio_gable")], // flush (projection 0)
  };

  const res = runRoofEngine([main, garage, patio]);

  // Eave LF per mass = perimeter eaves + projecting-gable side eaves.
  assert.equal(res.eaveLfByMass.main, 248); // 216 perimeter + (8+6+12+6) side eaves
  assert.equal(res.eaveLfByMass.garage, 114); // 108 perimeter + 6 side eaves
  assert.equal(res.eaveLfByMass.patio, 32); // 32 perimeter, flush gable adds 0
  assert.equal(res.totalEaveLf, 394);

  // Interior lines: every gable → 1 ridge-back AND 2 valleys (flush + projecting
  // alike now draw the full cross-gable signature; flush just omits side eaves).
  const all = res.masses.flatMap((m) => m.interior);
  const gableLines = (t: string) => all.filter((e) => e.type === t && e.source?.startsWith("gable:")).length;
  // The flush patio gable's base sits on the patio's RAKE (gable-end) edge —
  // its roof end is now depicted by the ridge running to that end (rect
  // primitive), so the duplicate stub is suppressed (gable_rake_end flag).
  assert.equal(gableLines("ridge"), 5); // 4 main + 1 garage (patio end = ridge-to-rake-end)
  assert.equal(gableLines("valley"), 10); // 8 main + 2 garage
  // Clean main-roof skeleton present too (decorative, source "skeleton").
  assert.ok(all.some((e) => e.type === "hip" && e.source === "skeleton"));

  // Downspouts: 1 per run + 1 per 40 ft, runs < 10 ft share drainage.
  assert.equal(res.downspouts.length, 11); // main 6 + garage 3 + patio 2

  // Flags: area gate on main + patio (both OK/info), no_schedule on garage,
  // flush note on the patio gable. No unanchored / open / long-run.
  assert.equal(res.reviewFlags.filter((f) => f.code === "area_gate").length, 2);
  assert.equal(res.reviewFlags.filter((f) => f.code === "no_schedule").length, 1);
  assert.equal(res.reviewFlags.filter((f) => f.code === "gable_flush").length, 0);
  assert.equal(res.reviewFlags.filter((f) => f.code === "gable_rake_end").length, 1);
  assert.equal(res.reviewFlags.filter((f) => f.severity === "error").length, 0);
});

test("main-roof skeleton is DECORATIVE — clean hip drawn, priced eave LF untouched", () => {
  const res = runRoofEngine([
    { name: "m", outline: box(64, 44), statedArea: null, eaveEdges: [0, 1, 2, 3], gables: [] },
  ]);
  const skel = res.masses[0].interior.filter((e) => e.source === "skeleton");
  // A rectangle with eaves all round → a clean hip: a ridge + hips, no valleys.
  assert.ok(skel.some((e) => e.type === "ridge"), "skeleton ridge drawn");
  assert.ok(skel.filter((e) => e.type === "hip").length >= 2, "converging hips drawn");
  // SAFETY: every skeleton line is non-gutter interior, so the eave LF is exactly
  // the perimeter (64+44+64+44 = 216) — the skeleton adds ZERO priced length.
  assert.ok(skel.every((e) => !e.gutter));
  assert.equal(res.eaveLfByMass.m, 216);
});

// ── the REAL Woodinville roof, from the plan (ground-truth fixture) ─────────

test("Woodinville ground truth: engine draws the real asymmetric roof (front 2 gables, rear 1, projecting porch + patio)", () => {
  // Faithful-but-schematic model of 05.13.26 DA HOMES — WOODINVILLE, read off the
  // plan: main upper roof 2902 sf (page 4 ROOF VENTILATION schedule); FRONT/North
  // is a cross-gable (two gable-ends) with a projecting entry PORCH on posts;
  // REAR/South is a hip with ONE gable-end and a projecting covered PATIO on
  // posts. This is exactly the front≠rear asymmetry the per-face read caught and
  // the freehand canvas trace got wrong. Cardinal facings are OUTWARD normals:
  // the front edge (y=0) faces "N" (−y), the rear edge (y=51) faces "S" (+y).
  const main: MassInput = {
    name: "main",
    outline: box(64, 51),
    statedArea: 2902,
    eaveEdges: [0, 1, 2, 3],
    gables: [
      gable(16, 0, 14, 6, 0, "N", "front_gable_L"), // flush gable-end
      gable(48, 0, 14, 4, 0, "N", "front_gable_R"), // flush gable-end → front shows 2
      gable(32, 0, 10, 4, 6, "N", "front_porch"), // projecting entry porch (posts)
      gable(32, 51, 16, 4, 0, "S", "rear_gable"), // flush gable-end → rear shows 1
      gable(48, 51, 12, 4, 5, "S", "rear_patio"), // projecting covered patio (posts)
    ],
  };
  const res = runRoofEngine([main]);

  // Eave LF = 230 perimeter + porch (2×6) + patio (2×5); flush ends add ZERO.
  assert.equal(res.eaveLfByMass.main, 252);

  // Every gable draws a ridge AND two valleys (so flush gable-ends show as real
  // gables in plan, not flat labels); the projecting porch + patio additionally
  // add guttered side eaves.
  const gbl = (t: string) => res.masses[0].interior.filter((e) => e.type === t && e.source?.startsWith("gable:")).length;
  assert.equal(gbl("ridge"), 5); // 3 flush gable-ends + porch + patio
  assert.equal(gbl("valley"), 10); // all 5 gables now draw valleys (3 flush ends + porch + patio)

  // The front≠rear asymmetry is PRESERVED, not mirrored: 2 flush ends on the
  // front, 1 on the rear.
  const flush = res.reviewFlags.filter((f) => f.code === "gable_flush");
  assert.equal(flush.length, 3);
  assert.equal(flush.filter((f) => /front_gable/.test(f.message)).length, 2);
  assert.equal(flush.filter((f) => /rear_gable/.test(f.message)).length, 1);

  // Porch + patio each contribute two guttered side eaves (LAW 2).
  assert.equal(res.masses[0].edges.filter((e) => e.gutter && e.source === "gable:front_porch").length, 2);
  assert.equal(res.masses[0].edges.filter((e) => e.gutter && e.source === "gable:rear_patio").length, 2);

  // Area gate reconciles with the stated 2902 sf (3264 computed, 12.5% ≤ 15%).
  const ag = res.reviewFlags.find((f) => f.code === "area_gate");
  assert.ok(ag && ag.severity === "info");
  assert.equal(res.reviewFlags.filter((f) => f.severity === "error").length, 0);
});

// ── helpers ────────────────────────────────────────────────────────────────

function box(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function gable(
  cx: number,
  cy: number,
  span: number,
  pitch: number,
  projection: number,
  facing: Gable["facing"],
  name: string,
): Gable {
  return { baseCenter: { x: cx, y: cy }, span, pitch, projection, facing, name };
}

// ── rect-primitive skeleton + gable-end stub suppression ────────────────────

test("gable-ended rectangle: skeleton is ONE full-length ridge to both rake ends — no diagonals", () => {
  // 100×43 ft, north+south eaves, east+west RAKE (gable) ends — the Woodinville
  // main-mass shape that used to draw a pyramid of long diagonal hips.
  const rect: MassInput = {
    name: "main",
    outline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 43 },
      { x: 0, y: 43 },
    ],
    statedArea: null,
    eaveEdges: [0, 2], // top + bottom eaves; left/right rakes (gable ends)
    gables: [],
  };
  const res = runRoofEngine([rect]);
  const interior = res.masses[0].interior;
  const ridges = interior.filter((e) => e.type === "ridge");
  const hips = interior.filter((e) => e.type === "hip");
  assert.equal(ridges.length, 1, "one ridge");
  assert.equal(hips.length, 0, "no hips at gable ends");
  // Full-length: ridge runs wall to wall at mid-depth.
  const r = ridges[0];
  const len = Math.hypot(r.p2.x - r.p1.x, r.p2.y - r.p1.y);
  assert.equal(Math.round(len), 100);
  assert.equal(Math.round((r.p1.y + r.p2.y) / 2), 22); // mid-depth (43/2 -> 21.5)
  // LF untouched: two 100-ft eaves.
  assert.equal(res.masses[0].edges.filter((e) => e.gutter).length, 2);
});

test("all-eave rectangle: primitive draws the classic hip — inset ridge + 4 hips", () => {
  const rect: MassInput = {
    name: "main",
    outline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
    ],
    statedArea: null,
    eaveEdges: [0, 1, 2, 3],
    gables: [],
  };
  const res = runRoofEngine([rect]);
  const interior = res.masses[0].interior;
  const ridges = interior.filter((e) => e.type === "ridge");
  const hips = interior.filter((e) => e.type === "hip");
  assert.equal(ridges.length, 1);
  assert.equal(hips.length, 4);
  const r = ridges[0];
  // ridge inset by half-depth (20) at both ends → 60 ft long, centered
  assert.equal(Math.round(Math.hypot(r.p2.x - r.p1.x, r.p2.y - r.p1.y)), 60);
});

test("flush gable based on a RAKE (gable-end) wall is suppressed with a flag; LF unchanged", () => {
  const rect: MassInput = {
    name: "main",
    outline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 43 },
      { x: 0, y: 43 },
    ],
    statedArea: null,
    eaveEdges: [0, 2],
    gables: [
      // the "span_ft null → 12ft default at face centre" side-read artifact:
      // a flush gable whose base sits on the WEST rake end
      { baseCenter: { x: 0, y: 21.5 }, span: 12, pitch: 6, projection: 0, facing: "W", name: "west_end" },
    ],
  };
  const res = runRoofEngine([rect]);
  const gableLines = res.masses[0].interior.filter((e) => e.source.startsWith("gable:"));
  assert.equal(gableLines.length, 0, "no stub ridge/valleys drawn for the gable end");
  assert.ok(res.reviewFlags.some((f) => f.code === "gable_rake_end"));
  // and a flush gable on an EAVE still draws its ridge+valleys
  const withFront: MassInput = {
    ...rect,
    gables: [{ baseCenter: { x: 50, y: 0 }, span: 18, pitch: 6, projection: 0, facing: "N", name: "front" }],
  };
  const res2 = runRoofEngine([withFront]);
  assert.ok(res2.masses[0].interior.some((e) => e.source === "gable:front"));
});
