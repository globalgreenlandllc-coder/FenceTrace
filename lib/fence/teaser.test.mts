import { test } from "node:test";
import assert from "node:assert/strict";
import { teaserPayloadFromScan } from "./teaser.ts";
import type { FenceScanResult } from "./scan-core.ts";

function scanWith(
  runs: { id: string; points: { x: number; y: number }[] }[],
  acres: number | null = 0.284,
): FenceScanResult {
  return {
    ok: true,
    address: "1247 Maple Ridge Dr, Austin, TX 78704, USA",
    center: { lat: 30.25, lng: -97.75 },
    zoom: 19,
    canvasPxPerFt: 2.7,
    aerial: { imageDataUrl: "data:image/png;base64,AAA", width: 900, height: 580, zoom: 19 },
    parcelRings: runs.map((r) => r.points),
    suggestedRuns: runs,
    buildings: [],
    parcel: acres === null ? null : { acres, apn: "123-456" },
  };
}

test("closed rectangle ring: 4 sides, 4 corners, redacted payload", () => {
  const ring = [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 480 },
    { x: 100, y: 480 },
    { x: 100, y: 100 }, // closing duplicate
  ];
  const t = teaserPayloadFromScan(scanWith([{ id: "parcel-0", points: ring }]));
  assert.equal(t.sides, 4);
  assert.equal(t.corners, 4);
  assert.equal(t.parcelFound, true);
  assert.equal(t.acres, 0.28);
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0]!.points.length, 5);
  // no measurement fields leak
  assert.ok(!("canvasPxPerFt" in t));
  assert.ok(!("lf" in (t.runs[0] as object)));
});

test("unclosed chain counts every vertex as a corner", () => {
  const chain = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const t = teaserPayloadFromScan(scanWith([{ id: "r", points: chain }]));
  assert.equal(t.sides, 2);
  assert.equal(t.corners, 3);
});

test("no parcel: empty runs, parcelFound false, null acres", () => {
  const t = teaserPayloadFromScan(scanWith([], null));
  assert.equal(t.runs.length, 0);
  assert.equal(t.sides, 0);
  assert.equal(t.parcelFound, false);
  assert.equal(t.acres, null);
});

test("degenerate single-point run is dropped", () => {
  const t = teaserPayloadFromScan(
    scanWith([
      { id: "bad", points: [{ x: 5, y: 5 }] },
      {
        id: "ok",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
      },
    ]),
  );
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0]!.id, "ok");
  assert.equal(t.sides, 1);
});

test("coordinates round to 0.1 px (payload size hygiene)", () => {
  const t = teaserPayloadFromScan(
    scanWith([
      {
        id: "r",
        points: [
          { x: 10.123456, y: 20.987654 },
          { x: 30.55555, y: 40.44444 },
        ],
      },
    ]),
  );
  assert.deepEqual(t.runs[0]!.points, [
    { x: 10.1, y: 21 },
    { x: 30.6, y: 40.4 },
  ]);
});
