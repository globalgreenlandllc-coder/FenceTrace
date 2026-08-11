/**
 * ReportAll WKT parsing — the one transform between their API and the
 * parcel shape the whole scan pipeline consumes. The fixtures mirror
 * the live v9 response verified against the real API on 2026-08-11.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ringsFromWkt } from "./reportall.ts";

test("MULTIPOLYGON: outer ring parsed, lat/lng in the right slots", () => {
  const rings = ringsFromWkt(
    "MULTIPOLYGON(((-81.20324 41.58302,-81.20323 41.58294,-81.20250 41.58295,-81.20324 41.58302)))",
  );
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 4);
  // WKT is "lng lat" — a swap here would put the parcel in Antarctica.
  assert.ok(Math.abs(rings[0][0].lat - 41.58302) < 1e-9);
  assert.ok(Math.abs(rings[0][0].lng - -81.20324) < 1e-9);
});

test("multi-part parcels give one outer ring per polygon", () => {
  const rings = ringsFromWkt(
    "MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))",
  );
  assert.equal(rings.length, 2);
  assert.equal(rings[1][0].lng, 5);
});

test("holes are dropped — fences follow outer lines", () => {
  const rings = ringsFromWkt(
    "MULTIPOLYGON(((0 0,10 0,10 10,0 10,0 0),(2 2,3 2,3 3,2 2)))",
  );
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
});

test("plain POLYGON works too", () => {
  const rings = ringsFromWkt("POLYGON((0 0,1 0,1 1,0 0))");
  assert.equal(rings.length, 1);
});

test("junk in, empty out — never a throw", () => {
  for (const bad of [null, undefined, "", "POINT(1 2)", "MULTIPOLYGON(((1 1)))", "not wkt at all"]) {
    assert.deepEqual(ringsFromWkt(bad as never), []);
  }
});
