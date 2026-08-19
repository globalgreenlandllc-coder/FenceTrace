import type { FenceScanResult } from "@/lib/fence/scan-core";
import type { Pt } from "@/lib/fence/geo";

/**
 * teaser.ts — shapes a real scan into the anonymous landing preview.
 *
 * Deliberately REDACTED: no canvasPxPerFt, no per-run footage — the
 * visitor sees their actual property with the actual parcel boundary
 * traced, plus a SUGGESTED fence layout (back + sides on the property
 * line, returns tying into the house footprint when OSM knows it) so the
 * demo looks like a finished takeoff. The measurements are what the free
 * account unlocks. Counts (sides/corners/acres) are safe social proof.
 */

export type TeaserRun = { id: string; points: Pt[] };

export type TeaserFenceRun = {
  id: string;
  /** "boundary" rides the property line; "return" ties the house into it. */
  kind: "boundary" | "return";
  points: Pt[];
};

export type TeaserPayload = {
  address: string;
  image: { dataUrl: string; width: number; height: number };
  /** Closed parcel ring(s) in canvas coords — the actual property line. */
  runs: TeaserRun[];
  /** Subject house footprint (open ring, canvas coords) — null when OSM
   *  has no building inside the parcel. */
  house: Pt[] | null;
  /** Suggested fence layout: the street side stays open when a house is
   *  known, and two returns run from the house walls to the side lines. */
  fence: TeaserFenceRun[];
  /** Fence segments across the layout — "5 fence lines". */
  sides: number;
  /** Distinct fence corners/ends (closing vertex not counted). */
  corners: number;
  acres: number | null;
  /** False when Regrid had no boundary here — the UI shows the photo and
   *  an honest "draw it in the app" nudge instead of fake lines. */
  parcelFound: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundPts = (pts: Pt[]): Pt[] => pts.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function isClosedRun(pts: Pt[]): boolean {
  return pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) < 1;
}

/** Drop a closing duplicate vertex so rings are open for the math. */
function stripClosing(pts: Pt[]): Pt[] {
  return pts.length >= 3 && dist(pts[0], pts[pts.length - 1]) < 1
    ? pts.slice(0, -1)
    : pts;
}

function ringArea(ring: Pt[]): number {
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 / 2;
}

function ptsCentroid(pts: Pt[]): Pt {
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
  };
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function projectPtSeg(p: Pt, a: Pt, b: Pt): { d: number; t: number; proj: Pt } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  const proj = { x: a.x + vx * t, y: a.y + vy * t };
  return { d: dist(p, proj), t, proj };
}

/** The subject house: largest OSM footprint whose centroid falls inside
 *  the parcel ring. Neighbors across the line never anchor the demo. */
function subjectHouse(buildings: Pt[][], ring: Pt[]): Pt[] | null {
  if (ring.length < 3) return null;
  let best: Pt[] | null = null;
  let bestArea = 0;
  for (const b of buildings) {
    const poly = stripClosing(b);
    if (poly.length < 3) continue;
    if (!pointInRing(ptsCentroid(poly), ring)) continue;
    const area = Math.abs(ringArea(poly));
    if (area > bestArea) {
      bestArea = area;
      best = poly;
    }
  }
  return best;
}

// Front-side detection: edges whose midpoint sits within 1.6× of the
// house's closest approach are "street side" and stay open, capped at
// 40% of the perimeter so an odd-shaped lot never loses half its fence.
const FRONT_D_RATIO = 1.6;
const FRONT_MAX_PERIM = 0.4;
// House returns: skip degenerate stubs (house on the line) and absurd
// spans (house nowhere near that side on acreage lots).
const RETURN_MIN_PX = 10;
const RETURN_MAX_PX = 240;
const RETURN_T_MARGIN = 0.05;

/**
 * Turn a closed parcel ring into the demo fence layout:
 *  - no house known → fence the whole ring;
 *  - house known → drop the edge chain facing the house (the street
 *    side), fence the rest, and tie the house walls into the two side
 *    lines with short perpendicular returns.
 */
export function planTeaserFence(ringPoints: Pt[], house: Pt[] | null): TeaserFenceRun[] {
  const whole: TeaserFenceRun[] = [
    { id: "fence-line", kind: "boundary", points: ringPoints },
  ];
  const ring = stripClosing(ringPoints);
  if (ring.length < 3 || !house || house.length < 3) return whole;

  const H = ptsCentroid(house);
  const n = ring.length;
  const edges = ring.map((v, i) => {
    const w = ring[(i + 1) % n];
    return {
      len: dist(v, w),
      d: Math.hypot((v.x + w.x) / 2 - H.x, (v.y + w.y) / 2 - H.y),
    };
  });
  const perim = edges.reduce((a, e) => a + e.len, 0);
  if (perim < 40) return whole;

  let i0 = 0;
  edges.forEach((e, i) => {
    if (e.d < edges[i0].d) i0 = i;
  });
  // A house that touches the line would zero the ratio test — floor it.
  const base = Math.max(edges[i0].d, perim * 0.02);

  let a = i0;
  let b = i0;
  let chainLen = edges[i0].len;
  let chainCount = 1;
  while (chainCount < n - 2) {
    const prev = (a - 1 + n) % n;
    const next = (b + 1) % n;
    const pickPrev = edges[prev].d <= edges[next].d;
    const cand = pickPrev ? prev : next;
    if (edges[cand].d > base * FRONT_D_RATIO) break;
    if (chainLen + edges[cand].len > perim * FRONT_MAX_PERIM) break;
    chainLen += edges[cand].len;
    chainCount++;
    if (pickPrev) a = prev;
    else b = next;
  }

  // Fence = the ring minus the front chain, walked forward as one open run.
  const pts: Pt[] = [];
  for (let k = (b + 1) % n; ; k = (k + 1) % n) {
    pts.push(ring[k]);
    if (k === a) break;
  }
  if (pts.length < 2) return whole;
  const out: TeaserFenceRun[] = [{ id: "fence-line", kind: "boundary", points: pts }];

  // Returns: nearest house wall corner → its foot on the side line the
  // fence enters on (the run's first and last edges).
  const sideEdges: [Pt, Pt][] =
    pts.length >= 3
      ? [
          [pts[0], pts[1]],
          [pts[pts.length - 2], pts[pts.length - 1]],
        ]
      : [[pts[0], pts[1]]];
  const houseRing = stripClosing(house);
  sideEdges.forEach(([A, B], idx) => {
    let best: { d: number; t: number; proj: Pt; v: Pt } | null = null;
    for (const v of houseRing) {
      const hit = projectPtSeg(v, A, B);
      if (!best || hit.d < best.d) best = { ...hit, v };
    }
    if (!best) return;
    if (best.d < RETURN_MIN_PX || best.d > RETURN_MAX_PX) return;
    if (best.t < RETURN_T_MARGIN || best.t > 1 - RETURN_T_MARGIN) return;
    out.push({
      id: `fence-return-${idx}`,
      kind: "return",
      points: [best.v, best.proj],
    });
  });
  return out;
}

export function teaserPayloadFromScan(
  scan: FenceScanResult,
  buildings: Pt[][] = scan.buildings,
): TeaserPayload {
  const runs: TeaserRun[] = scan.suggestedRuns
    .filter((r) => r.points.length >= 2)
    .map((r) => ({ id: r.id, points: roundPts(r.points) }));

  // The main ring (largest closed one) gets the planned layout; extra
  // rings (multi-parcel oddities) just get fenced whole.
  let mainIdx = -1;
  let bestArea = 0;
  runs.forEach((r, i) => {
    if (!isClosedRun(r.points)) return;
    const area = Math.abs(ringArea(stripClosing(r.points)));
    if (area > bestArea) {
      bestArea = area;
      mainIdx = i;
    }
  });
  const house =
    mainIdx >= 0
      ? subjectHouse(buildings, stripClosing(runs[mainIdx].points))
      : null;
  const fence: TeaserFenceRun[] = runs.flatMap((r, i) =>
    i === mainIdx
      ? planTeaserFence(r.points, house).map((f) => ({
          ...f,
          id: `${r.id}:${f.id}`,
          points: roundPts(f.points),
        }))
      : [{ id: `${r.id}:fence-line`, kind: "boundary" as const, points: r.points }],
  );

  let sides = 0;
  let corners = 0;
  for (const f of fence) {
    sides += f.points.length - 1;
    corners += isClosedRun(f.points) ? f.points.length - 1 : f.points.length;
  }

  return {
    address: scan.address,
    image: {
      dataUrl: scan.aerial.imageDataUrl,
      width: scan.aerial.width,
      height: scan.aerial.height,
    },
    runs,
    house: house ? roundPts(house) : null,
    fence,
    sides,
    corners,
    acres:
      typeof scan.parcel?.acres === "number" && Number.isFinite(scan.parcel.acres)
        ? Math.round(scan.parcel.acres * 100) / 100
        : null,
    parcelFound: runs.length > 0,
  };
}
