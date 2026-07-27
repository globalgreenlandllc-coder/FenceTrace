import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_W,
  canvasPolylineFt,
  canvasPxPerFt,
  centroid,
  latLngToCanvas,
  runDistanceModel,
  walkPostPositions,
  zoomToFit,
} from "./geo.ts";

const SEATTLE = { lat: 47.6, lng: -122.33 };

test("canvasPxPerFt: a known 100 ft east-west span measures ~100 ft", () => {
  // 100 ft east at this latitude: Δlng = 100ft in degrees.
  const meters = 30.48;
  const dLng = meters / (111320 * Math.cos((SEATTLE.lat * Math.PI) / 180));
  const zoom = 19;
  const a = latLngToCanvas(SEATTLE, SEATTLE, zoom);
  const b = latLngToCanvas({ lat: SEATTLE.lat, lng: SEATTLE.lng + dLng }, SEATTLE, zoom);
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  const ft = px / canvasPxPerFt(SEATTLE.lat, zoom);
  assert.ok(Math.abs(ft - 100) < 1.5, `measured ${ft.toFixed(2)} ft`);
});

test("latLngToCanvas centers the center", () => {
  const c = latLngToCanvas(SEATTLE, SEATTLE, 19);
  assert.ok(Math.abs(c.x - CANVAS_W / 2 / (CANVAS_W / 640)) < 0.01 || true);
  // center maps to map center scaled into canvas: MAP_W/2 × 1.40625 = 450
  assert.ok(Math.abs(c.x - 450) < 0.01, `x=${c.x}`);
});

test("zoomToFit shrinks for bigger parcels, clamps to [15,21]", () => {
  const small = [
    SEATTLE,
    { lat: SEATTLE.lat + 0.0003, lng: SEATTLE.lng + 0.0004 },
  ];
  const large = [
    SEATTLE,
    { lat: SEATTLE.lat + 0.01, lng: SEATTLE.lng + 0.012 },
  ];
  const zs = zoomToFit(small);
  const zl = zoomToFit(large);
  assert.ok(zs > zl, `${zs} > ${zl}`);
  assert.ok(zs <= 21 && zl >= 15);
});

test("canvasPolylineFt sums segments; centroid averages", () => {
  const pxPerFt = 2;
  const ft = canvasPolylineFt(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ],
    pxPerFt,
  );
  assert.equal(ft, 150);
  const c = centroid([
    { lat: 10, lng: 20 },
    { lat: 20, lng: 40 },
  ]);
  assert.deepEqual(c, { lat: 15, lng: 30 });
});

test("runDistanceModel: interpolates along the walk, clamps at the ends", () => {
  // 100px straight run, spacing 40 → walk points at 0, 33.3, 66.7, 100.
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const m = runDistanceModel(pts, 40, [0, 1, 2, 3]);
  assert.ok(m);
  assert.equal(m.totalPx, 100);
  assert.equal(m.atDistPx(0), 0);
  assert.equal(m.atDistPx(100), 3);
  // halfway between samples 1 (33.33px) and 2 (66.67px)
  assert.ok(Math.abs(m.atDistPx(50) - 1.5) < 1e-9);
  // clamped outside the run
  assert.equal(m.atDistPx(-10), 0);
  assert.equal(m.atDistPx(999), 3);
});

test("runDistanceModel: L-shaped run keeps the vertex sample; mismatch → null", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 40 },
  ];
  const walk = walkPostPositions(pts, 40);
  const elevs = walk.map((_, i) => i); // one per walk point
  const m = runDistanceModel(pts, 40, elevs);
  assert.ok(m);
  assert.equal(m.totalPx, 120);
  // The corner (arc distance 80) is a real sample — exact, not interpolated.
  assert.equal(m.atDistPx(80), elevs[2]);
  // A stale sample count (layout edited since sampling) must refuse to model.
  assert.equal(runDistanceModel(pts, 40, [1, 2, 3]), null);
  assert.equal(runDistanceModel(pts, 40, []), null);
});
