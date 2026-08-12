import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRunSlope,
  summarizeSlopes,
  rackingLimitFt,
  burialFt,
} from "./slope.ts";
import { walkPostPositions } from "./geo.ts";

test("flat run: no steps, flat terrain, standard posts", () => {
  const s = summarizeSlopes([[100, 100.1, 100, 99.9, 100]], 8, 6, "stick");
  assert.equal(s.steppedSections, 0);
  assert.equal(s.suggestedTerrain, "flat");
  // 6' fence: 6 + max(2, 2) = 8' posts
  assert.equal(s.basePostLengthFt, 8);
});

test("steady 10% grade: sloped terrain, stick racks without stepping", () => {
  // 8' sections at 10% = 0.8 ft rise/section — under the 1.0 ft stick limit
  const elev = [100, 100.8, 101.6, 102.4, 103.2];
  const s = summarizeSlopes([elev], 8, 6, "stick");
  assert.equal(s.steppedSections, 0);
  assert.equal(s.suggestedTerrain, "sloped");
  assert.ok(Math.abs(s.avgGradePct - 10) < 0.01);
});

test("same 10% grade FORCES steps for prefab panels (0.5' racking limit)", () => {
  const elev = [100, 100.8, 101.6, 102.4, 103.2];
  const s = summarizeSlopes([elev], 8, 6, "panel");
  assert.equal(s.steppedSections, 4);
  // step posts: 8' base + min(2, 0.8) rise → ceil to even ⇒ 10'
  assert.equal(s.stepPostLengthFt, 10);
});

test("steep hillside: big drops split into code-sized steps", () => {
  // 1.6 ft per 8' section = 20% grade — over the 1.0 stick limit.
  // Each section splits into TWO ≤1' steps (shorter panels + an extra
  // post) so no point of the fence face runs over nominal height.
  const elev = [100, 101.6, 103.2, 104.8];
  const s = summarizeSlopes([elev], 8, 6, "stick");
  assert.equal(s.suggestedTerrain, "steep");
  assert.equal(s.steppedSections, 6); // 3 sections × 2 splits
  assert.equal(s.maxGradePct, 20);
  // per-step drop after splitting: 1.6 / 2 = 0.8 ft → 10' step posts
  assert.ok(Math.abs(s.runs[0]!.maxStepFt - 0.8) < 1e-9);
  assert.equal(s.stepPostLengthFt, 10);
});

test("chain-link racks the most; burial floors at 2 feet", () => {
  assert.equal(rackingLimitFt("mesh"), 1.5);
  assert.ok(rackingLimitFt("panel") < rackingLimitFt("stick"));
  assert.equal(burialFt(4), 2); // 4/3 < 2 → floor
  assert.ok(Math.abs(burialFt(8) - 8 / 3) < 1e-9);
});

test("retaining-wall detection: a sheer one-section drop reads wall-like", () => {
  // 4' drop inside one 8' section amid flat ground
  const s = summarizeSlopes([[100, 100, 96, 96]], 8, 6, "stick");
  assert.equal(s.wallSections, 1);
  assert.equal(s.wallLikeLf, 8);
  // Until the contractor confirms the wall it's priced as code-sized
  // steps (4' → four ≤1' steps) — and wallSteppedSections carries the
  // same count so confirming the wall removes exactly those steps.
  assert.equal(s.steppedSections, 4);
  assert.equal(s.wallSteppedSections, 4);
  // an ordinary 10% grade never reads as a wall
  const g = summarizeSlopes([[100, 100.8, 101.6]], 8, 6, "stick");
  assert.equal(g.wallSections, 0);
  assert.equal(g.wallSteppedSections, 0);
});

test("analyzeRunSlope: too-short runs are inert", () => {
  const r = analyzeRunSlope([100], 8, 1);
  assert.equal(r.steppedSections, 0);
  assert.equal(r.avgGradePct, 0);
});

test("walkPostPositions: vertices kept, spacing respected", () => {
  const pts = walkPostPositions(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ],
    40,
  );
  // 100px seg → ceil(100/40)=3 chunks; 50px seg → 2 chunks; start + 3 + 2
  assert.equal(pts.length, 6);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[3], { x: 100, y: 0 }); // vertex present
  assert.deepEqual(pts[pts.length - 1], { x: 100, y: 50 });
  const gap = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  assert.ok(gap <= 40 + 1e-9);
});

test("racked bays report the extra fabric the map length hides", () => {
  // 8' bays, 1' rise each — rackable for stick (limit 1'): each bay's
  // fabric is √(64+1) ≈ 8.062', so ~0.062' extra per bay.
  const s = summarizeSlopes([[100, 101, 102, 103]], 8, 6, "stick");
  assert.ok(s.rackedExtraLf > 0.15 && s.rackedExtraLf < 0.25, `got ${s.rackedExtraLf}`);
  // Stepped ground (3' per bay beats the limit): panels stay level — no
  // fabric excess, the drop is vertical.
  const st = summarizeSlopes([[100, 103, 106]], 8, 6, "stick");
  assert.equal(st.rackedExtraLf, 0);
  // Flat: nothing.
  assert.equal(summarizeSlopes([[100, 100, 100]], 8, 6, "stick").rackedExtraLf, 0);
});
