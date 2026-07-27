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

test("steep hillside: steep terrain + stepped sections for stick too", () => {
  // 1.6 ft per 8' section = 20% grade — over the 1.0 stick limit
  const elev = [100, 101.6, 103.2, 104.8];
  const s = summarizeSlopes([elev], 8, 6, "stick");
  assert.equal(s.suggestedTerrain, "steep");
  assert.equal(s.steppedSections, 3);
  assert.equal(s.maxGradePct, 20);
});

test("chain-link racks the most; burial floors at 2 feet", () => {
  assert.equal(rackingLimitFt("mesh"), 1.5);
  assert.ok(rackingLimitFt("panel") < rackingLimitFt("stick"));
  assert.equal(burialFt(4), 2); // 4/3 < 2 → floor
  assert.ok(Math.abs(burialFt(8) - 8 / 3) < 1e-9);
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
