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

// Closed rectangle: (100,100) → (700,100) → (700,480) → (100,480).
const RECT_RING = [
  { x: 100, y: 100 },
  { x: 700, y: 100 },
  { x: 700, y: 480 },
  { x: 100, y: 480 },
  { x: 100, y: 100 }, // closing duplicate
];

test("closed rectangle ring: 4 sides, 4 corners, redacted payload", () => {
  const t = teaserPayloadFromScan(scanWith([{ id: "parcel-0", points: RECT_RING }]));
  assert.equal(t.sides, 4);
  assert.equal(t.corners, 4);
  assert.equal(t.parcelFound, true);
  assert.equal(t.acres, 0.28);
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0]!.points.length, 5);
  // no house known: the demo fences the whole ring
  assert.equal(t.house, null);
  assert.equal(t.fence.length, 1);
  assert.equal(t.fence[0]!.kind, "boundary");
  assert.equal(t.fence[0]!.points.length, 5);
  // no measurement fields leak
  assert.ok(!("canvasPxPerFt" in t));
  assert.ok(!("lf" in (t.runs[0] as object)));
  assert.ok(!("lf" in (t.fence[0] as object)));
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
  assert.equal(t.fence.length, 0);
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

test("house near an edge: that side stays open, returns tie into the side lines", () => {
  // House sits near the bottom (y=480) edge → that's the street side.
  const house = [
    { x: 250, y: 360 },
    { x: 550, y: 360 },
    { x: 550, y: 440 },
    { x: 250, y: 440 },
  ];
  const t = teaserPayloadFromScan(
    scanWith([{ id: "parcel-0", points: RECT_RING }]),
    // buildings arg: a neighbor outside the ring must lose to the subject
    [
      [
        { x: 800, y: 50 },
        { x: 880, y: 50 },
        { x: 880, y: 120 },
        { x: 800, y: 120 },
      ],
      house,
    ],
  );
  assert.deepEqual(t.house, house);

  const boundary = t.fence.filter((f) => f.kind === "boundary");
  assert.equal(boundary.length, 1);
  // Left + top + right stay fenced; the bottom edge is gone.
  assert.deepEqual(boundary[0]!.points, [
    { x: 100, y: 480 },
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 480 },
  ]);

  const returns = t.fence.filter((f) => f.kind === "return");
  assert.equal(returns.length, 2);
  for (const r of returns) {
    assert.equal(r.points.length, 2);
    const [from, to] = r.points as [{ x: number; y: number }, { x: number; y: number }];
    // starts on a house wall corner, lands on a side line
    assert.ok(house.some((v) => v.x === from.x && v.y === from.y));
    assert.ok(to.x === 100 || to.x === 700);
    assert.equal(Math.hypot(to.x - from.x, to.y - from.y), 150);
  }

  // 3 boundary segments + 2 returns
  assert.equal(t.sides, 5);
  assert.equal(t.corners, 8);
});

test("building outside the parcel is ignored — whole ring fenced", () => {
  const t = teaserPayloadFromScan(
    scanWith([{ id: "parcel-0", points: RECT_RING }]),
    [
      [
        { x: 750, y: 50 },
        { x: 850, y: 50 },
        { x: 850, y: 120 },
        { x: 750, y: 120 },
      ],
    ],
  );
  assert.equal(t.house, null);
  assert.equal(t.fence.length, 1);
  assert.equal(t.fence[0]!.kind, "boundary");
  assert.equal(t.sides, 4);
});

test("house hugging the side line: degenerate return is skipped", () => {
  // Western house wall sits 4px off the west property line — a 4px
  // return would be a stub, so only the far side gets one.
  const house = [
    { x: 104, y: 360 },
    { x: 560, y: 360 },
    { x: 560, y: 440 },
    { x: 104, y: 440 },
  ];
  const t = teaserPayloadFromScan(
    scanWith([{ id: "parcel-0", points: RECT_RING }]),
    [house],
  );
  const returns = t.fence.filter((f) => f.kind === "return");
  assert.equal(returns.length, 1);
  assert.equal(returns[0]!.points[1]!.x, 700);
});
