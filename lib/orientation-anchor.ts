/**
 * Placement math for the FRONT / BACK / LEFT / RIGHT orientation chips on the
 * roof-plan takeoff overlay.
 *
 * Why a separate, directive-free module: aerial-shared.tsx is a "use client"
 * file (framer-motion, React), so its functions can't be imported under
 * node/tsx for tests. This module is pure geometry (no DOM, no React) so the
 * chip-placement logic is unit-testable — same pattern as lib/roof-skeleton.ts
 * and lib/aerial-constants.ts.
 *
 * THE BUG THIS REPLACES: the old sideAnchor averaged the midpoints of every
 * eave tagged a side and pushed the result only 26px outward from the roof
 * centroid. When a side's eaves sit on two different bands (e.g. a front entry
 * porch's short eave near the top + the main front eave lower down), their
 * midpoints average toward the roof CENTER, so the chip floated in the
 * interior over the hip lines instead of sitting off an edge.
 *
 * THE FIX: snap each chip to the building's bounding-box EDGE.
 *   - A side only votes between its OWN two candidate edges (front/back ->
 *     top vs bottom; left/right -> left vs right) — axis-restricted, never a
 *     free argmax over all four (which could flip LEFT to the top edge on a
 *     wide-short footprint).
 *   - The vote is LENGTH-WEIGHTED so a small porch eave can't drag the anchor
 *     across the roof; the long main eave wins.
 *   - The perpendicular coordinate is pinned OUTSIDE the bbox (edge ± pad), so
 *     the chip is off-edge by construction — it can never land in the interior.
 *   - The parallel coordinate is the length-weighted mean of the winning
 *     bucket, clamped to the bbox span so the chip stays beside the building.
 *
 * Decorative only — never touches LF / pricing / eave geometry.
 */

export type APt = { x: number; y: number };
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };
/** The four orientation sides (the "interior" eave side has no chip). */
export type OrientSide = "front" | "back" | "left" | "right";
export type EaveMid = { x: number; y: number; len: number };

/** Axis-aligned bounding box of a perimeter polygon, or null if degenerate
 *  (<2 finite points). Collapsed axes are widened to 1px to avoid div-by-zero. */
export function perimBBox(points: readonly APt[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  if (n < 2) return null;
  if (maxX - minX < 1) maxX = minX + 1;
  if (maxY - minY < 1) maxY = minY + 1;
  return { minX, minY, maxX, maxY };
}

/** Whether a side's chip is vertical-axis (front/back -> top/bottom edges). */
function isVertical(side: OrientSide): boolean {
  return side === "front" || side === "back";
}

/**
 * Bucket a side's eave midpoints by which of its two candidate edges each is
 * nearer, summing segment length per bucket. `lo` = top (vertical) / left
 * (horizontal) edge; `hi` = bottom / right.
 */
function voteBuckets(mids: readonly EaveMid[], side: OrientSide, bbox: BBox) {
  const vertical = isVertical(side);
  const lo = vertical ? bbox.minY : bbox.minX;
  const hi = vertical ? bbox.maxY : bbox.maxX;
  let loLen = 0;
  let hiLen = 0;
  let loPar = 0; // length-weighted sum of the PARALLEL coord in the lo bucket
  let hiPar = 0;
  for (const m of mids) {
    const v = vertical ? m.y : m.x; // coord along the side's axis
    const par = vertical ? m.x : m.y; // coord along the edge
    const len = Number.isFinite(m.len) && m.len > 0 ? m.len : 1;
    if (Math.abs(v - lo) <= Math.abs(v - hi)) {
      loLen += len;
      loPar += par * len;
    } else {
      hiLen += len;
      hiPar += par * len;
    }
  }
  return { vertical, lo, hi, loLen, hiLen, loPar, hiPar };
}

/**
 * Off-edge anchor point for a side's chip, or null when the side has no eaves
 * / no usable bbox. Guaranteed: the perpendicular coordinate is OUTSIDE the
 * bbox (chip never lands in the roof interior).
 */
export function anchorForSide(
  mids: readonly EaveMid[],
  side: OrientSide,
  bbox: BBox | null,
  scale: number,
): APt | null {
  if (!bbox || !mids || mids.length === 0) return null;
  const pad = 22 * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const { minX, minY, maxX, maxY } = bbox;
  const { vertical, loLen, hiLen, loPar, hiPar } = voteBuckets(mids, side, bbox);

  // Pick the winning candidate edge by total eave length. Ties fall back to
  // the project convention (front->bottom, back->top, left->left, right->right)
  // so a perfectly-split side is still deterministic.
  let winHi: boolean;
  if (hiLen > loLen) winHi = true;
  else if (loLen > hiLen) winHi = false;
  else winHi = side === "front" || side === "right";

  const winLen = winHi ? hiLen : loLen;
  const winPar = winHi ? hiPar : loPar;

  // Parallel coordinate (along the edge): length-weighted mean of the winning
  // bucket, clamped to the building span. Guard an empty bucket -> bbox center.
  let par = winLen > 0 ? winPar / winLen : vertical ? (minX + maxX) / 2 : (minY + maxY) / 2;
  if (vertical) par = Math.min(maxX, Math.max(minX, par));
  else par = Math.min(maxY, Math.max(minY, par));

  if (vertical) {
    const y = winHi ? maxY + pad : minY - pad;
    return { x: par, y };
  }
  const x = winHi ? maxX + pad : minX - pad;
  return { x, y: par };
}

/**
 * Dev-only diagnostic: does this side's eaves split across BOTH candidate
 * edges (the signature of an upstream mis-tagged side)? Returns the minority
 * length fraction so the caller can warn when it's significant.
 */
export function sideSplit(
  mids: readonly EaveMid[],
  side: OrientSide,
  bbox: BBox | null,
): { split: boolean; minorityFrac: number } {
  if (!bbox || !mids || mids.length === 0) return { split: false, minorityFrac: 0 };
  const { loLen, hiLen } = voteBuckets(mids, side, bbox);
  const total = loLen + hiLen;
  if (total <= 0) return { split: false, minorityFrac: 0 };
  const minority = Math.min(loLen, hiLen);
  return { split: loLen > 0 && hiLen > 0, minorityFrac: minority / total };
}
