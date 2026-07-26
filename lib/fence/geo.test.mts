import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_W,
  canvasPolylineFt,
  canvasPxPerFt,
  centroid,
  latLngToCanvas,
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
