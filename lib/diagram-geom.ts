/**
 * diagram-geom.ts — pure geometry helpers for the satellite "smart diagram".
 *
 * Directive-free (no "use client" / "server-only") so it is unit-testable
 * under `tsx --test` and importable from both the client diagram component
 * and any server code. Everything here is DECORATIVE / SUMMARY math derived
 * from the already-computed takeoff (footprint perimeter + eave polylines +
 * the satellite trace's canvas-px-per-foot). It NEVER changes a priced total
 * — per-side LF is a read-only breakdown of the same eave geometry the
 * pricing path already sums.
 *
 * Coordinate space is the 900×580 canvas viewBox the whole takeoff lives in;
 * pxPerFt is the satellite trace's `canvasPxPerFt` (NOT the plan-mode 2.4).
 */

export type Pt = { x: number; y: number };
export type DiagramSide = "front" | "back" | "left" | "right";
export type DBBox = { minX: number; minY: number; maxX: number; maxY: number };

const SIDES: DiagramSide[] = ["front", "back", "left", "right"];

/** Axis-aligned bounding box of a point set, or null if fewer than 2 finite points. */
export function bboxOfPoints(pts: readonly Pt[]): DBBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  if (n < 2 || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Classify one eave polyline to a building SIDE from the footprint bbox.
 *
 * Convention matches the rest of the app (front-at-bottom: canvas +y = front,
 * y-down). A near-horizontal run sits on the top (BACK) or bottom (FRONT)
 * wall; a near-vertical run on the left/right wall. Diagonal-ish runs fall
 * back to whichever bbox edge their midpoint is closest to. The satellite
 * tile is north-up, so this is a spatial reference paired with a north arrow,
 * not a true street-facing "front".
 *
 * Returns null only for a degenerate (<2 point) polyline.
 */
export function classifyEaveSide(
  points: readonly Pt[],
  bbox: DBBox,
): DiagramSide | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;

  // Clear horizontal vs vertical run → top/bottom vs left/right wall.
  // Require a modest dominance so a 45° run instead uses the nearest-edge
  // fallback below rather than being force-binned by a hair.
  if (dx >= dy * 1.3) return midY < cy ? "back" : "front";
  if (dy >= dx * 1.3) return midX < cx ? "left" : "right";

  // Diagonal / ambiguous: pick the bbox edge the midpoint is nearest to.
  const dTop = midY - bbox.minY;
  const dBottom = bbox.maxY - midY;
  const dLeft = midX - bbox.minX;
  const dRight = bbox.maxX - midX;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return "back";
  if (min === dBottom) return "front";
  if (min === dLeft) return "left";
  return "right";
}

/** Summed pixel length of a polyline (canvas space). */
export function polylineLengthPx(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (Number.isFinite(d)) total += d;
  }
  return total;
}

/** Polyline length in feet using the satellite trace's px/ft. 0 when pxPerFt is unusable. */
export function polylineLengthFt(points: readonly Pt[], pxPerFt: number): number {
  if (!Number.isFinite(pxPerFt) || pxPerFt <= 0) return 0;
  return polylineLengthPx(points) / pxPerFt;
}

/**
 * Shoelace area of the footprint ring in square feet. Accepts an open or
 * closed ring (a trailing duplicate of the first point is fine). Returns 0
 * for a degenerate ring or unusable pxPerFt.
 */
export function polygonAreaFt2(ring: readonly Pt[], pxPerFt: number): number {
  if (ring.length < 3 || !Number.isFinite(pxPerFt) || pxPerFt <= 0) return 0;
  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return 0;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const areaPx = Math.abs(twiceArea) / 2;
  return areaPx / (pxPerFt * pxPerFt);
}

/**
 * Reflex (inside) corners of the footprint ring — the concave notches where
 * an inside miter forms (e.g. an L-return or a garage jog). Returns the
 * corner points in canvas space. Winding-agnostic: a vertex is reflex when
 * its turn direction opposes the ring's overall winding. Near-collinear
 * vertices (turn < ~10°) are skipped. Accepts an open or closed ring.
 */
export function reflexCorners(ring: readonly Pt[]): Pt[] {
  // Drop a trailing duplicate of the first point if the ring is closed.
  const pts =
    ring.length > 1 &&
    ring[0].x === ring[ring.length - 1].x &&
    ring[0].y === ring[ring.length - 1].y
      ? ring.slice(0, -1)
      : ring.slice();
  const n = pts.length;
  if (n < 4) return [];
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const positiveWinding = twiceArea > 0;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const nxt = pts[(i + 1) % n];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = nxt.x - cur.x;
    const v2y = nxt.y - cur.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cross = v1x * v2y - v1y * v2x;
    const sin = cross / (l1 * l2);
    if (Math.abs(sin) < 0.17) continue; // <~10° turn → collinear, not a corner
    const reflex = positiveWinding ? cross < 0 : cross > 0;
    if (reflex) out.push(cur);
  }
  return out;
}

/**
 * Per-side gutter LF breakdown (front/back/left/right), rounded to whole
 * feet. Read-only summary of the SAME eaves the pricing path sums — the four
 * values always add up to the total eave LF (modulo rounding). Never used as
 * a priced quantity.
 */
export function perSideLF(
  eaves: readonly { points: Pt[] }[],
  bbox: DBBox,
  pxPerFt: number,
): Record<DiagramSide, number> {
  const acc: Record<DiagramSide, number> = { front: 0, back: 0, left: 0, right: 0 };
  for (const e of eaves) {
    const side = classifyEaveSide(e.points, bbox);
    if (!side) continue;
    acc[side] += polylineLengthFt(e.points, pxPerFt);
  }
  for (const s of SIDES) acc[s] = Math.round(acc[s]);
  return acc;
}
