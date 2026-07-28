/**
 * The prebuilt demo property behind the landing "watch it work" walkthrough.
 *
 * Everything here is expressed in the SAME 900×580 canvas space a real
 * FenceScan scan produces (lib/fence/geo CANVAS_W/CANVAS_H), so the demo
 * feeds the REAL components and the REAL engine: <Fence3D> renders this
 * geometry unmodified, and computeFenceTakeoff/priceFence produce the
 * footage, bill of materials and package prices the walkthrough shows.
 * Nothing on screen is a hand-typed number.
 *
 * The lot itself is a synthetic sample (a demo address, not a real
 * customer's home) drawn to scale at 3.6 px/ft: a 0.38-acre suburban lot
 * with the house set toward the street and the fence enclosing the
 * backyard — down both side lines, across the back, tying into the
 * house on the west and the garage on the east, with a walk gate on one
 * tie-in and a drive gate on the other.
 */
import type { FenceTypeId } from "@/lib/fence/catalog";

export type Pt = { x: number; y: number };

/** Canvas pixels per foot — the scale everything below is drawn at. */
export const PX_PER_FT = 3.6;

export const DEMO_ADDRESS = "1425 Maple Ave";
export const DEMO_CITY = "Fort Collins, CO 80525";
export const DEMO_APN = "8703142-05-018";

/** Recorded parcel boundary (closed ring, slightly out-of-square like a
 *  real plat). Also what the walkthrough traces in act one. */
export const PARCEL: Pt[] = [
  { x: 196, y: 88 },
  { x: 704, y: 78 },
  { x: 716, y: 500 },
  { x: 206, y: 508 },
];

/** House footprint — main block plus an attached garage wing on the east. */
export const HOUSE: Pt[] = [
  { x: 346, y: 292 },
  { x: 556, y: 292 },
  { x: 556, y: 366 },
  { x: 622, y: 366 },
  { x: 622, y: 448 },
  { x: 346, y: 448 },
];

/**
 * The fence, as a contractor would actually drive it: start on the side
 * of the house, out to the property line, up the west side, across the
 * back, down the east side, and back in to the garage wall. One open run
 * with two ends and four corners — the house closes the loop.
 */
export const FENCE_RUN: Pt[] = [
  { x: 346, y: 348 }, // ties into the house's west wall
  { x: 210, y: 348 }, // west property line
  { x: 204, y: 96 }, // back-west corner
  { x: 696, y: 87 }, // back-east corner
  { x: 705, y: 402 }, // east property line
  { x: 622, y: 402 }, // ties into the garage's east wall
];

export type DemoGate = {
  x: number;
  y: number;
  kind: "single" | "double";
  widthFt: number;
  label: string;
};

/** Both gates sit on the tie-in segments — the walk gate on the west
 *  side-yard, the drive gate on the east so a mower or trailer gets in. */
export const GATES: DemoGate[] = [
  { x: 282, y: 348, kind: "single", widthFt: 4, label: "4′ walk gate" },
  { x: 663, y: 402, kind: "double", widthFt: 10, label: "10′ drive gate" },
];

export const FENCE_TYPE_ID: FenceTypeId = "cedar-privacy";
export const FENCE_HEIGHT_FT = 6;

/** Human-readable name for each drawn segment, in draw order. */
export const SEGMENT_LABELS = [
  "West tie-in",
  "West side line",
  "Back property line",
  "East side line",
  "Garage tie-in",
];

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Per-segment length in feet, in draw order. */
export const SEGMENT_FT: number[] = FENCE_RUN.slice(1).map(
  (p, i) => Math.round((dist(FENCE_RUN[i], p) / PX_PER_FT) * 10) / 10,
);

/** Total drawn fence length in feet (gate openings included). */
export const TOTAL_LF =
  Math.round(SEGMENT_FT.reduce((a, b) => a + b, 0) * 10) / 10;

/** Interior corners (4) and open ends where the fence meets the house (2). */
export const CORNERS = FENCE_RUN.length - 2;
export const ENDS = 2;

/** Lot area from the parcel ring (shoelace), in square feet and acres. */
function ringSqFt(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2) / (PX_PER_FT * PX_PER_FT);
}

export const LOT_SQFT = Math.round(ringSqFt(PARCEL));
export const LOT_ACRES = Math.round((LOT_SQFT / 43_560) * 100) / 100;
export const HOUSE_SQFT = Math.round(ringSqFt(HOUSE));

/* ------------------------------------------------------------------ */
/*  Scenery — driveway, walk, patio and trees, all in canvas space.    */
/*  Purely decorative: the aerial plate draws these, the engine never  */
/*  sees them.                                                         */
/* ------------------------------------------------------------------ */

export const DRIVEWAY: Pt[] = [
  { x: 560, y: 446 },
  { x: 622, y: 446 },
  { x: 646, y: 580 },
  { x: 546, y: 580 },
];

export const WALKWAY: Pt[] = [
  { x: 428, y: 446 },
  { x: 458, y: 446 },
  { x: 470, y: 528 },
  { x: 438, y: 528 },
];

/** Back patio slab, tucked against the house inside the fenced yard. */
export const PATIO: Pt[] = [
  { x: 382, y: 244 },
  { x: 524, y: 244 },
  { x: 524, y: 291 },
  { x: 382, y: 291 },
];

export type DemoTree = { x: number; y: number; r: number; tone: number };

export const TREES: DemoTree[] = [
  // inside the fenced backyard
  { x: 268, y: 188, r: 25, tone: 0 },
  { x: 648, y: 200, r: 30, tone: 1 },
  { x: 452, y: 140, r: 18, tone: 2 },
  { x: 320, y: 118, r: 15, tone: 1 },
  // front yard + neighbours, for depth outside the work area
  { x: 258, y: 470, r: 22, tone: 1 },
  { x: 800, y: 426, r: 28, tone: 0 },
  { x: 112, y: 398, r: 25, tone: 2 },
  { x: 842, y: 150, r: 21, tone: 1 },
  { x: 150, y: 128, r: 19, tone: 0 },
];

/** Neighbouring rooftops clipped by the frame — sells "this is a real
 *  aerial tile" more than anything else in the plate. */
export const NEIGHBOURS: Pt[][] = [
  [
    { x: -60, y: 168 },
    { x: 112, y: 162 },
    { x: 118, y: 300 },
    { x: -60, y: 306 },
  ],
  [
    { x: 796, y: 206 },
    { x: 980, y: 200 },
    { x: 980, y: 340 },
    { x: 802, y: 346 },
  ],
  [
    { x: 250, y: -70 },
    { x: 470, y: -70 },
    { x: 470, y: 34 },
    { x: 250, y: 40 },
  ],
];
