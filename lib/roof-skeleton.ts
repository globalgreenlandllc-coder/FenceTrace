/**
 * Roof-skeleton derivation — turn a building FOOTPRINT polygon into a
 * plausible, fully-connected set of roof-plane lines (ridges, hips,
 * valleys) so the takeoff overlay reads like an actual architect's roof
 * plan instead of a bare outline with a couple of floating dashes.
 *
 * Why derive instead of trace? The AI can read the footprint SHAPE and
 * the eave/gable classification reliably off the floor/foundation plans,
 * but it cannot reliably trace interior ridge/hip/valley lines off a
 * dense truss-framing sheet — they come back sparse, floating, and
 * disconnected. The roof's interior geometry, however, is almost fully
 * DETERMINED by the footprint: a hip roof slopes up at ~45° from every
 * eave, ridges form where opposing slopes meet, hips run up from outside
 * corners, valleys drop in at inside (reflex) corners. So we compute it.
 *
 * This output is DECORATIVE ONLY — it never feeds LF, totals, or pricing
 * (those come from the eaves / gutter_runs). It exists purely so the
 * contractor can recognize the house, see its shape and orientation, and
 * judge whether the gutters are on the right edges. It is intentionally
 * schematic: clean straight planes, not a structural truss layout.
 *
 * Approach (robust + node-testable, no special-case event math):
 *   1. Clean + close the polygon.
 *   2. Build a coarse grid from the polygon's own vertex coordinates, so
 *      grid lines fall exactly on the building's wings/jogs.
 *   3. Classify each grid cell inside/outside (point-in-polygon).
 *   4. Greedily merge inside cells into maximal rectangles (the wings).
 *   5. Per rectangle, emit a hip/gable ridge + hips, suppressing roof
 *      lines on edges SHARED with a neighbour rectangle (interior walls
 *      aren't eaves), so the wings' roofs connect instead of double up.
 *   6. Add valley lines at the polygon's reflex (inside) corners.
 *
 * Everything is pure (no DOM, no server-only, no React) so it runs in the
 * browser bundle AND under `node` for tests.
 */

// The exact straight-skeleton engine (preferred for rectilinear footprints).
// Circular import is safe: these are only CALLED inside functions, never at
// module-eval time, and roof-skeleton-straight.ts imports only types + pure
// helpers back from here.
import {
  deriveRoofSkeletonStraight,
  validateSkeleton,
} from "./roof-skeleton-straight";

export type Pt = { x: number; y: number };
export type Seg = [Pt, Pt];
export type SkeletonLine = { points: [Pt, Pt] };
/** A single roof PLANE (the surface between a ridge/hip and its eave).
 *  `downhill` is the unit 2D direction the plane slopes DOWN toward its
 *  eave — used to shade it (faces away from the light read darker) so the
 *  roof reads as solid 3D, and to lift it to pitch in the 3D view. */
export type RoofFace = { polygon: Pt[]; downhill: Pt };
export type RoofSkeleton = {
  ridges: SkeletonLine[];
  hips: SkeletonLine[];
  valleys: SkeletonLine[];
  /** Perimeter segments that are GABLE ends (rake-only, no gutter). The
   *  ridge runs flush to these so the gable reads as part of the connected
   *  roof; callers can label them. */
  gables: SkeletonLine[];
  /** The roof PLANES (shaded surfaces) tiling the footprint. */
  faces: RoofFace[];
};

const EMPTY: RoofSkeleton = {
  ridges: [],
  hips: [],
  valleys: [],
  gables: [],
  faces: [],
};

export function isFinitePt(p: Pt | undefined | null): p is Pt {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Drop consecutive duplicates and a trailing point equal to the first. */
export function cleanRing(poly: readonly Pt[], tol: number): Pt[] {
  const pts = poly.filter(isFinitePt);
  const out: Pt[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > tol) out.push({ x: p.x, y: p.y });
  }
  // Remove closing duplicate (last ≈ first).
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) out.pop();
  }
  return out;
}

/** Collapse near-equal coordinates onto shared grid lines so a wing edge
 *  that the AI drew 2px off still lands on one line. */
function uniqAxis(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v);
    else out[out.length - 1] = (out[out.length - 1] + v) / 2; // average the cluster
  }
  return out;
}

function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

type Rect = { x0: number; x1: number; y0: number; y1: number };

/**
 * Greedy maximal-rectangle cover of the inside-cells grid. `inside[i][j]`
 * is the cell spanning xs[i]..xs[i+1] × ys[j]..ys[j+1]. We repeatedly take
 * the largest-area rectangle of still-uncovered inside cells. Producing a
 * few big rectangles (the main mass + wings) rather than many slivers is
 * what keeps the derived roof clean.
 */
function coverRectangles(
  inside: boolean[][],
  nx: number,
  ny: number,
): { i0: number; i1: number; j0: number; j1: number }[] {
  const covered: boolean[][] = Array.from({ length: nx }, () =>
    new Array(ny).fill(false),
  );
  const rects: { i0: number; i1: number; j0: number; j1: number }[] = [];
  const free = (i: number, j: number) => inside[i][j] && !covered[i][j];

  for (;;) {
    let best: { i0: number; i1: number; j0: number; j1: number; area: number } | null =
      null;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (!free(i, j)) continue;
        // Grow width as far right as the whole column-range stays free.
        let maxI = i;
        while (maxI + 1 < nx && free(maxI + 1, j)) maxI++;
        // For each candidate right edge, grow height while the full row
        // band stays free, and track the largest cell-area rectangle.
        for (let ri = i; ri <= maxI; ri++) {
          let maxJ = j;
          outer: while (maxJ + 1 < ny) {
            for (let c = i; c <= ri; c++) if (!free(c, maxJ + 1)) break outer;
            maxJ++;
          }
          const area = (ri - i + 1) * (maxJ - j + 1);
          if (!best || area > best.area)
            best = { i0: i, i1: ri, j0: j, j1: maxJ, area };
        }
      }
    }
    if (!best) break;
    for (let i = best.i0; i <= best.i1; i++)
      for (let j = best.j0; j <= best.j1; j++) covered[i][j] = true;
    rects.push({ i0: best.i0, i1: best.i1, j0: best.j0, j1: best.j1 });
    if (rects.length > 24) break; // safety valve against pathological input
  }
  return rects;
}

/** Is the whole grid edge between cell (i,j) on the given side adjacent to
 *  another INSIDE cell? Then it's an interior wall, not an eave. */
function sideIsInterior(
  inside: boolean[][],
  nx: number,
  ny: number,
  rect: { i0: number; i1: number; j0: number; j1: number },
  side: "top" | "bottom" | "left" | "right",
): boolean {
  // A rectangle side is "interior" (shared) when EVERY cell just outside
  // that side is also inside the footprint.
  if (side === "left") {
    if (rect.i0 === 0) return false;
    for (let j = rect.j0; j <= rect.j1; j++) if (!inside[rect.i0 - 1][j]) return false;
    return true;
  }
  if (side === "right") {
    if (rect.i1 === nx - 1) return false;
    for (let j = rect.j0; j <= rect.j1; j++) if (!inside[rect.i1 + 1][j]) return false;
    return true;
  }
  if (side === "top") {
    if (rect.j0 === 0) return false;
    for (let i = rect.i0; i <= rect.i1; i++) if (!inside[i][rect.j0 - 1]) return false;
    return true;
  }
  // bottom
  if (rect.j1 === ny - 1) return false;
  for (let i = rect.i0; i <= rect.i1; i++) if (!inside[i][rect.j1 + 1]) return false;
  return true;
}

/**
 * Hip/gable ridge for one rectangle. Sides flagged `interior` get no hip
 * and the ridge runs out to that wall (a gable that abuts the neighbour),
 * so adjacent wings' ridges meet instead of each growing its own hip into
 * a shared wall.
 */
function rectRoof(
  r: Rect,
  flush: { top: boolean; bottom: boolean; left: boolean; right: boolean },
): { ridges: SkeletonLine[]; hips: SkeletonLine[]; faces: RoofFace[] } {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  if (w <= 0 || h <= 0) return { ridges: [], hips: [], faces: [] };
  const ridges: SkeletonLine[] = [];
  const hips: SkeletonLine[] = [];
  const faces: RoofFace[] = [];

  // Ridge runs along the LONGER dimension. inset = half the SHORTER
  // dimension gives 45° hips. A HIP end is inset (with two hip diagonals);
  // a FLUSH end — a gable end, or a wall shared with a neighbour wing —
  // runs the ridge out to the wall with NO hip there. The roof PLANES are
  // the slabs between the ridge/hips and each eave (two trapezoids along
  // the ridge + a triangle at each hipped end).
  if (w >= h) {
    const yc = (r.y0 + r.y1) / 2;
    const inset = h / 2;
    const leftEnd = flush.left ? r.x0 : r.x0 + inset;
    const rightEnd = flush.right ? r.x1 : r.x1 - inset;
    const lo = Math.min(leftEnd, rightEnd);
    const hi = Math.max(leftEnd, rightEnd);
    // Skip a zero-length ridge: a square footprint is a pyramid whose four
    // hips already meet at the apex — there is no ridge line to draw.
    if (hi - lo > 1e-6)
      ridges.push({ points: [{ x: lo, y: yc }, { x: hi, y: yc }] });
    // Top + bottom slabs slope down to the y0 / y1 eaves.
    faces.push({
      polygon: [
        { x: r.x0, y: r.y0 },
        { x: r.x1, y: r.y0 },
        { x: rightEnd, y: yc },
        { x: leftEnd, y: yc },
      ],
      downhill: { x: 0, y: -1 },
    });
    faces.push({
      polygon: [
        { x: r.x0, y: r.y1 },
        { x: leftEnd, y: yc },
        { x: rightEnd, y: yc },
        { x: r.x1, y: r.y1 },
      ],
      downhill: { x: 0, y: 1 },
    });
    if (!flush.left) {
      hips.push({ points: [{ x: leftEnd, y: yc }, { x: r.x0, y: r.y0 }] });
      hips.push({ points: [{ x: leftEnd, y: yc }, { x: r.x0, y: r.y1 }] });
      faces.push({
        polygon: [
          { x: r.x0, y: r.y0 },
          { x: leftEnd, y: yc },
          { x: r.x0, y: r.y1 },
        ],
        downhill: { x: -1, y: 0 },
      });
    }
    if (!flush.right) {
      hips.push({ points: [{ x: rightEnd, y: yc }, { x: r.x1, y: r.y0 }] });
      hips.push({ points: [{ x: rightEnd, y: yc }, { x: r.x1, y: r.y1 }] });
      faces.push({
        polygon: [
          { x: r.x1, y: r.y0 },
          { x: r.x1, y: r.y1 },
          { x: rightEnd, y: yc },
        ],
        downhill: { x: 1, y: 0 },
      });
    }
  } else {
    const xc = (r.x0 + r.x1) / 2;
    const inset = w / 2;
    const topEnd = flush.top ? r.y0 : r.y0 + inset;
    const botEnd = flush.bottom ? r.y1 : r.y1 - inset;
    const lo = Math.min(topEnd, botEnd);
    const hi = Math.max(topEnd, botEnd);
    if (hi - lo > 1e-6)
      ridges.push({ points: [{ x: xc, y: lo }, { x: xc, y: hi }] });
    faces.push({
      polygon: [
        { x: r.x0, y: r.y0 },
        { x: xc, y: topEnd },
        { x: xc, y: botEnd },
        { x: r.x0, y: r.y1 },
      ],
      downhill: { x: -1, y: 0 },
    });
    faces.push({
      polygon: [
        { x: r.x1, y: r.y0 },
        { x: r.x1, y: r.y1 },
        { x: xc, y: botEnd },
        { x: xc, y: topEnd },
      ],
      downhill: { x: 1, y: 0 },
    });
    if (!flush.top) {
      hips.push({ points: [{ x: xc, y: topEnd }, { x: r.x0, y: r.y0 }] });
      hips.push({ points: [{ x: xc, y: topEnd }, { x: r.x1, y: r.y0 }] });
      faces.push({
        polygon: [
          { x: r.x0, y: r.y0 },
          { x: r.x1, y: r.y0 },
          { x: xc, y: topEnd },
        ],
        downhill: { x: 0, y: -1 },
      });
    }
    if (!flush.bottom) {
      hips.push({ points: [{ x: xc, y: botEnd }, { x: r.x0, y: r.y1 }] });
      hips.push({ points: [{ x: xc, y: botEnd }, { x: r.x1, y: r.y1 }] });
      faces.push({
        polygon: [
          { x: r.x0, y: r.y1 },
          { x: xc, y: botEnd },
          { x: r.x1, y: r.y1 },
        ],
        downhill: { x: 0, y: 1 },
      });
    }
  }
  return { ridges, hips, faces };
}

/** Does an eave segment run ALONG this axis-aligned rectangle side? Used to
 *  decide hip vs gable: a side with a gutter on it is an eave side (hip
 *  allowed); a side with no gutter is a gable/return end (flush, no hip). */
export function sideHasEave(
  axis: "h" | "v",
  fixed: number,
  lo: number,
  hi: number,
  eaves: readonly Seg[],
  tol: number,
): boolean {
  for (const [a, b] of eaves) {
    if (axis === "v") {
      // vertical side at x=fixed, y in [lo,hi]; eave must be ~vertical there
      if (Math.abs(a.x - fixed) > tol || Math.abs(b.x - fixed) > tol) continue;
      const elo = Math.min(a.y, b.y);
      const ehi = Math.max(a.y, b.y);
      if (Math.min(hi, ehi) - Math.max(lo, elo) > tol) return true;
    } else {
      if (Math.abs(a.y - fixed) > tol || Math.abs(b.y - fixed) > tol) continue;
      const elo = Math.min(a.x, b.x);
      const ehi = Math.max(a.x, b.x);
      if (Math.min(hi, ehi) - Math.max(lo, elo) > tol) return true;
    }
  }
  return false;
}

/** Fraction of a side's [lo,hi] span covered by collinear eave segments
 *  (merged intervals). A side with a FULL-LENGTH eave is an EAVE side, never a
 *  gable end (a real gable end carries no gutter across its face); but a PARTIAL
 *  eave — a lower porch on a gable-end side — must NOT veto the gable. */
export function sideEaveCoverage(
  axis: "h" | "v",
  fixed: number,
  lo: number,
  hi: number,
  eaves: readonly Seg[],
  tol: number,
): number {
  const span = hi - lo;
  if (span <= 0) return 0;
  const ivals: [number, number][] = [];
  for (const [a, b] of eaves) {
    let elo: number;
    let ehi: number;
    if (axis === "v") {
      if (Math.abs(a.x - fixed) > tol || Math.abs(b.x - fixed) > tol) continue;
      elo = Math.min(a.y, b.y);
      ehi = Math.max(a.y, b.y);
    } else {
      if (Math.abs(a.y - fixed) > tol || Math.abs(b.y - fixed) > tol) continue;
      elo = Math.min(a.x, b.x);
      ehi = Math.max(a.x, b.x);
    }
    const cl = Math.max(lo, elo);
    const ch = Math.min(hi, ehi);
    if (ch - cl > 0) ivals.push([cl, ch]);
  }
  if (ivals.length === 0) return 0;
  ivals.sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curLo = ivals[0][0];
  let curHi = ivals[0][1];
  for (let i = 1; i < ivals.length; i++) {
    const [l, h] = ivals[i];
    if (l <= curHi) curHi = Math.max(curHi, h);
    else {
      total += curHi - curLo;
      curLo = l;
      curHi = h;
    }
  }
  total += curHi - curLo;
  return total / span;
}

/** Is the MIDDLE of a side covered by an eave? A genuine eave side runs a
 *  continuous eave across its middle; a GABLE END is bare in the middle (the
 *  gable face carries no gutter) with at most short end-returns (a low
 *  porch/patio drip clipping the corners). This is what distinguishes a
 *  gable-end-with-returns from a real eave side — total coverage alone can't. */
export function sideMiddleHasEave(
  axis: "h" | "v",
  fixed: number,
  lo: number,
  hi: number,
  eaves: readonly Seg[],
  tol: number,
): boolean {
  const span = hi - lo;
  if (span <= 0) return false;
  const mid = (lo + hi) / 2;
  for (const [a, b] of eaves) {
    let elo: number;
    let ehi: number;
    if (axis === "v") {
      if (Math.abs(a.x - fixed) > tol || Math.abs(b.x - fixed) > tol) continue;
      elo = Math.min(a.y, b.y);
      ehi = Math.max(a.y, b.y);
    } else {
      if (Math.abs(a.y - fixed) > tol || Math.abs(b.y - fixed) > tol) continue;
      elo = Math.min(a.x, b.x);
      ehi = Math.max(a.x, b.x);
    }
    if (elo <= mid + tol && ehi >= mid - tol) return true;
  }
  return false;
}

/** Cross-product sign at vertex b for the ring a→b→c. Sign tells convex
 *  vs reflex once we know the ring's winding. */
export function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

export function signedArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x * poly[i].y) - (poly[i].x * poly[j].y);
  }
  return s / 2;
}

/**
 * Valley lines at reflex (inside) corners. A reflex corner is where the
 * footprint cuts inward; two roof planes meet there and water runs down a
 * valley along the corner's inward 45° bisector. We draw a short valley
 * stub inward — enough to read, not so long it crosses the whole roof.
 *
 * ASSUMES a (near-)rectilinear footprint, which residential roof outlines
 * overwhelmingly are. The bisector below is the exact inward 45° line for a
 * 90° corner; for a non-orthogonal corner it still points generally inward
 * (a reasonable schematic) but is no longer a true angle bisector. This is
 * decorative-only, so an approximate direction on a rare angled corner is
 * acceptable — it never affects measurements.
 */
function valleyLines(
  poly: readonly Pt[],
  reach: number,
  interior: readonly SkeletonLine[] = [],
): SkeletonLine[] {
  const n = poly.length;
  if (n < 4) return [];
  const area = signedArea(poly);
  const ccw = area > 0;
  const out: SkeletonLine[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const cr = cross(prev, cur, next);
    // Reflex when the turn is opposite to the polygon's winding.
    const reflex = ccw ? cr < 0 : cr > 0;
    if (!reflex) continue;
    // Inward bisector = normalized(prev-dir + next-dir reversed)…
    // Simpler & robust for rectilinear corners: average the two edge
    // directions pointing AWAY from the corner, negate to point inward.
    const d1 = norm({ x: prev.x - cur.x, y: prev.y - cur.y });
    const d2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
    let bx = d1.x + d2.x;
    let by = d1.y + d2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) continue; // straight-ish, skip
    bx /= bl;
    by /= bl;
    // For a reflex corner the inward direction is the bisector NEGATED
    // (the d1+d2 bisector points back out of the notch). TERMINATE the
    // valley where its inward ray first meets a ridge/hip — a real valley
    // runs UP to the roof body and stops; a fixed-length stub that floats
    // off into the middle of a plane is exactly the "random dashed line"
    // that reads as noise. Fall back to `reach` only when nothing is hit.
    const dir = { x: -bx, y: -by };
    let bestT = Infinity;
    for (const l of interior) {
      const t = rayHitSeg(cur, dir, l.points[0], l.points[1]);
      if (t !== null && t > 1e-6 && t < bestT) bestT = t;
    }
    const r = Number.isFinite(bestT) ? bestT : reach;
    if (r <= 1e-6) continue;
    out.push({
      points: [
        { x: cur.x, y: cur.y },
        { x: cur.x + dir.x * r, y: cur.y + dir.y * r },
      ],
    });
  }
  return out;
}

export function norm(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/** Distance along ray (P + t·D, t≥0) to its intersection with segment [a,b],
 *  or null if they don't cross (parallel, behind, or off the segment). */
function rayHitSeg(p: Pt, d: Pt, a: Pt, b: Pt): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = ex * d.y - ey * d.x; // cross(E, D)
  if (Math.abs(det) < 1e-9) return null; // parallel / collinear
  const fx = a.x - p.x;
  const fy = a.y - p.y;
  const t = (ex * fy - ey * fx) / det; // distance along the ray
  const u = (d.x * fy - d.y * fx) / det; // position along the segment
  if (t <= 0 || u < -1e-6 || u > 1 + 1e-6) return null;
  return t;
}

/**
 * Merge the per-rectangle gable EDGES into the handful of real gable ends.
 * The grid decomposition splits one physical gable wall into several
 * collinear, touching fragments (one per rectangle column/row it spans), so a
 * single front gable can surface as 4-5 separate edges — each of which the
 * overlay would label "GABLE", piling boxes on top of each other.
 *
 * Group by orientation + the (clustered) fixed coordinate, then union spans
 * that touch or overlap (gap <= tol). Two GENUINELY separate gables on the
 * same wall sit more than tol apart (a real recess/step) and stay distinct.
 * Drop merged slivers shorter than minLen. Pure + deterministic.
 */
export function mergeGables(
  gables: SkeletonLine[],
  tol: number,
  minLen: number,
): SkeletonLine[] {
  type S = { fixed: number; lo: number; hi: number; vertical: boolean };
  const segs: S[] = [];
  for (const g of gables) {
    const a = g.points[0];
    const b = g.points[1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    // A gable edge from a rect side is axis-aligned; classify by its longer run.
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    if (vertical) {
      segs.push({ fixed: (a.x + b.x) / 2, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), vertical: true });
    } else {
      segs.push({ fixed: (a.y + b.y) / 2, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), vertical: false });
    }
  }
  const out: SkeletonLine[] = [];
  const emit = (vertical: boolean, lo: number, hi: number, f: number) => {
    if (hi - lo < minLen) return;
    out.push(
      vertical
        ? { points: [{ x: f, y: lo }, { x: f, y: hi }] }
        : { points: [{ x: lo, y: f }, { x: hi, y: f }] },
    );
  };
  for (const vertical of [false, true]) {
    const group = segs
      .filter((s) => s.vertical === vertical)
      .sort((p, q) => p.fixed - q.fixed || p.lo - q.lo);
    let i = 0;
    while (i < group.length) {
      // Cluster segments whose fixed coord is within tol of this run's first.
      const ref = group[i].fixed;
      const cluster: S[] = [];
      let j = i;
      while (j < group.length && Math.abs(group[j].fixed - ref) <= tol) {
        cluster.push(group[j]);
        j++;
      }
      cluster.sort((p, q) => p.lo - q.lo);
      let lo = cluster[0].lo;
      let hi = cluster[0].hi;
      let fSum = cluster[0].fixed;
      let fCount = 1;
      for (let k = 1; k < cluster.length; k++) {
        const s = cluster[k];
        if (s.lo <= hi + tol) {
          hi = Math.max(hi, s.hi); // touching/overlapping fragment of same wall
          fSum += s.fixed;
          fCount++;
        } else {
          emit(vertical, lo, hi, fSum / fCount);
          lo = s.lo;
          hi = s.hi;
          fSum = s.fixed;
          fCount = 1;
        }
      }
      emit(vertical, lo, hi, fSum / fCount);
      i = j;
    }
  }
  return out;
}

/** Are two segments roughly COLLINEAR and OVERLAPPING (>50% of the shorter)?
 *  Used to tell whether an AI rake is the same edge as a gable/eave already
 *  drawn, so we don't double-draw it. */
export function segmentsOverlap(s1: Seg, s2: Seg, tol: number): boolean {
  const [a, b] = s1;
  let ex = b.x - a.x;
  let ey = b.y - a.y;
  const el = Math.hypot(ex, ey);
  if (el <= 1e-6) return false;
  ex /= el;
  ey /= el;
  const perp = (p: Pt) => Math.abs((p.x - a.x) * -ey + (p.y - a.y) * ex);
  if (perp(s2[0]) > tol || perp(s2[1]) > tol) return false; // not collinear
  const t = (p: Pt) => (p.x - a.x) * ex + (p.y - a.y) * ey; // 0..el along s1
  let u0 = t(s2[0]);
  let u1 = t(s2[1]);
  if (u0 > u1) [u0, u1] = [u1, u0];
  const overlap = Math.max(0, Math.min(el, u1) - Math.max(0, u0));
  const s2len = Math.hypot(s2[1].x - s2[0].x, s2[1].y - s2[0].y);
  return overlap > 0.5 * Math.min(el, s2len || el);
}

export type Dormer = { points: [Pt, Pt]; mid: Pt; dir: Pt };

/**
 * Gables the AI traced (rakes) that the derived skeleton does NOT already show
 * as whole-side gable ends — i.e. DORMERS / CROSS-GABLES that sit on or above
 * a continuous eave (a gable in the middle of a wall, not a whole side). These
 * have no footprint side to derive from, so they can only come from the AI.
 *
 * Dedup: drop a rake that overlaps a skeleton gable (already drawn) OR an eave
 * (it would paint a gable along the gutter line — a mis-read). Drop slivers.
 * Merge collinear-adjacent survivors. Return a marker (edge + midpoint + the
 * inward direction toward the roof centroid) so the overlay can draw a small
 * connected gable chevron. Pure + never throws — decorative only.
 */
export function extraGablesFromRakes(
  rakeSegs: readonly Seg[],
  skeletonGables: readonly SkeletonLine[],
  perimeter: readonly Pt[],
  eaveSegs: readonly Seg[] = [],
): Dormer[] {
  try {
    const finite = (perimeter ?? []).filter(isFinitePt);
    if (finite.length < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cxs = 0, cys = 0;
    for (const p of finite) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      cxs += p.x;
      cys += p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!Number.isFinite(span) || span <= 0) return [];
    const tol = Math.max(2, span * 0.03);
    const eaveTol = tol * 2; // SAME coupling deriveRoofSkeleton uses to make gables
    const minLen = Math.max(8, span * 0.04);
    const centroid = { x: cxs / finite.length, y: cys / finite.length };

    const segLenPt = (s: Seg) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
    const survivors = (rakeSegs ?? []).filter(
      (r) =>
        r &&
        isFinitePt(r[0]) &&
        isFinitePt(r[1]) &&
        segLenPt(r) >= minLen &&
        // not already shown as a whole-side gable…
        !skeletonGables.some(
          (g) => segmentsOverlap(r, [g.points[0], g.points[1]], eaveTol),
        ) &&
        // …and not lying along an eave (would read as a gable on the gutter)
        !eaveSegs.some((e) => segmentsOverlap(r, e, eaveTol)),
    );
    if (survivors.length === 0) return [];

    const merged = mergeGables(
      survivors.map((s) => ({ points: [s[0], s[1]] as [Pt, Pt] })),
      tol,
      minLen,
    );
    return merged.map((g) => {
      const a = g.points[0];
      const b = g.points[1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let dx = centroid.x - mid.x;
      let dy = centroid.y - mid.y;
      const d = Math.hypot(dx, dy) || 1;
      return { points: [a, b] as [Pt, Pt], mid, dir: { x: dx / d, y: dy / d } };
    });
  } catch {
    return [];
  }
}

/**
 * Plan-view geometry of a CROSS-GABLE — a gable WING projecting inward from a
 * wall (the front garage/entry gables, a side cross-gable). Lets the overlay
 * draw it as a real gable FORM — a ridge with two sloped planes — instead of a
 * flat chevron, so every gable on the roof reads as an actual gable shape.
 *
 * The gable END is the base edge a→b (on the wall). The ridge runs from the
 * base midpoint inward along unit `dir` for `depth`; one plane slopes from that
 * ridge down to the a-side eave, the other down to the b-side — exactly the two
 * faces of a gabled wing seen from above. Pure; returns no faces on degenerate
 * input (zero-length base or direction) so a caller can fall back.
 */
export function gableWingFaces(
  a: Pt,
  b: Pt,
  dir: Pt,
  depth: number,
): { ridge: SkeletonLine; faces: RoofFace[] } {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const empty: { ridge: SkeletonLine; faces: RoofFace[] } = {
    ridge: { points: [m, m] },
    faces: [],
  };
  const dl = Math.hypot(dir.x, dir.y);
  const baseLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (!isFinitePt(a) || !isFinitePt(b) || dl < 1e-6 || baseLen < 1e-6 || !(depth > 0))
    return empty;
  const d = { x: dir.x / dl, y: dir.y / dl };
  const r1 = { x: m.x + d.x * depth, y: m.y + d.y * depth };
  const aIn = { x: a.x + d.x * depth, y: a.y + d.y * depth };
  const bIn = { x: b.x + d.x * depth, y: b.y + d.y * depth };
  // Each plane slopes DOWN off the ridge toward its side eave — the downhill
  // direction is perpendicular to the ridge, pointing at the a- / b-side.
  const perp = { x: -d.y, y: d.x };
  const towardA =
    (a.x - m.x) * perp.x + (a.y - m.y) * perp.y >= 0 ? 1 : -1;
  const faces: RoofFace[] = [
    { polygon: [a, m, r1, aIn], downhill: { x: perp.x * towardA, y: perp.y * towardA } },
    { polygon: [b, bIn, r1, m], downhill: { x: -perp.x * towardA, y: -perp.y * towardA } },
  ];
  return { ridge: { points: [m, r1] }, faces };
}

/**
 * Connect each GABLE end to the body of the roof with a ridge line, so the
 * gable reads as a finished, attached gable instead of a floating dashed
 * stub. From the gable edge's midpoint we shoot a ray straight inward
 * (perpendicular to the gable wall) and stop at the first existing ridge/hip
 * it meets — that meeting point is the gable wing's apex, and the line we
 * draw is that wing's ridge. A gable end whose ridge already lands on it
 * (the flush main-body case) is skipped so we don't double a line.
 */
function gableConnectors(
  gables: SkeletonLine[],
  interior: SkeletonLine[],
  centroid: Pt,
  tol: number,
  maxReach: number,
): SkeletonLine[] {
  const out: SkeletonLine[] = [];
  for (const g of gables) {
    const a = g.points[0];
    const b = g.points[1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Skip gables that a ridge already reaches (flush main-body gable end).
    const reached = interior.some(
      (l) =>
        Math.hypot(l.points[0].x - m.x, l.points[0].y - m.y) <= tol * 1.5 ||
        Math.hypot(l.points[1].x - m.x, l.points[1].y - m.y) <= tol * 1.5,
    );
    if (reached) continue;
    // Inward unit normal to the gable wall (toward the roof centroid).
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    ex /= el;
    ey /= el;
    let nx = -ey;
    let ny = ex;
    if ((centroid.x - m.x) * nx + (centroid.y - m.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const d = { x: nx, y: ny };
    // First ridge/hip the inward ray meets = the wing's apex.
    let bestT = Infinity;
    for (const l of interior) {
      const t = rayHitSeg(m, d, l.points[0], l.points[1]);
      if (t !== null && t > tol && t < bestT) bestT = t;
    }
    const reach = Number.isFinite(bestT)
      ? bestT
      : Math.min(Math.hypot(centroid.x - m.x, centroid.y - m.y), maxReach);
    if (reach <= tol) continue;
    out.push({ points: [m, { x: m.x + d.x * reach, y: m.y + d.y * reach }] });
  }
  return out;
}

/**
 * Try the exact straight-skeleton engine and validate its output. Returns the
 * skeleton only if it is non-degenerate (caller keeps it); otherwise null so
 * the caller falls back to the grid-decomposition. Wrapped in try/catch — the
 * engine never throws on its own, but this is belt-and-suspenders so a future
 * change there can never break deriveRoofSkeleton.
 */
function tryStraight(
  perimeter: readonly Pt[],
  opts?: { eaveSegments?: readonly Seg[]; rakeSegments?: readonly Seg[] },
): RoofSkeleton | null {
  try {
    const s = deriveRoofSkeletonStraight(perimeter, opts);
    return validateSkeleton(s, perimeter) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Derive the roof skeleton from a footprint polygon (canvas coordinates).
 * Returns clean ridge/hip/valley line segments. Never throws — returns
 * empty on degenerate input so the caller can fall back to a bare outline.
 */
export function deriveRoofSkeleton(
  perimeter: readonly Pt[],
  opts?: { eaveSegments?: readonly Seg[]; rakeSegments?: readonly Seg[] },
): RoofSkeleton {
  try {
    // Prefer the exact straight-skeleton engine on (near-)rectilinear
    // footprints — it gives the architecturally-correct ridge/hip/valley
    // network with hips meeting at shared nodes and valleys running
    // corner-to-ridge. It returns EMPTY (or fails validation) on anything it
    // can't handle, in which case we SILENTLY fall through to the
    // grid-decomposition below. Never throws, never regresses.
    const straight = tryStraight(perimeter, opts);
    if (straight) return straight;

    const finite = (perimeter ?? []).filter(isFinitePt);
    if (finite.length < 4) return EMPTY;
    // Tolerance scales with building size so snapping is resolution-aware.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of finite) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!Number.isFinite(span) || span <= 0) return EMPTY;
    const tol = Math.max(2, span * 0.03);

    const ring = cleanRing(finite, tol);
    if (ring.length < 4) return EMPTY;

    const xs = uniqAxis(
      ring.map((p) => p.x).concat([minX, maxX]),
      tol,
    );
    const ys = uniqAxis(
      ring.map((p) => p.y).concat([minY, maxY]),
      tol,
    );
    const nx = xs.length - 1;
    const ny = ys.length - 1;
    if (nx < 1 || ny < 1) return EMPTY;

    // Classify cells.
    const inside: boolean[][] = Array.from({ length: nx }, () =>
      new Array(ny).fill(false),
    );
    let insideCount = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        const cy = (ys[j] + ys[j + 1]) / 2;
        if (pointInPolygon({ x: cx, y: cy }, ring)) {
          inside[i][j] = true;
          insideCount++;
        }
      }
    }
    if (insideCount === 0) return EMPTY;

    const rectCells = coverRectangles(inside, nx, ny);
    // If decomposition fragmented badly, fall back to a single bounding
    // hip roof — still clean, still reads as a roof. Threshold kept high
    // (was 8 — too eager: an articulated house with a garage + porch +
    // patio + a few jogs legitimately exceeds 8 wings, and collapsing it to
    // a bounding box was a real cause of "just a box" renders). Only a truly
    // over-fragmented (noisy) footprint should fall back.
    const rects: Rect[] =
      rectCells.length === 0 || rectCells.length > 18
        ? [{ x0: minX, x1: maxX, y0: minY, y1: maxY }]
        : rectCells.map((rc) => ({
            x0: xs[rc.i0],
            x1: xs[rc.i1 + 1],
            y0: ys[rc.j0],
            y1: ys[rc.j1 + 1],
          }));

    // Eave segments (gutter runs) let us tell a HIP side (gutter present)
    // from a GABLE side (no gutter). Without them we fall back to all-hip.
    const eaveSegs = (opts?.eaveSegments ?? []).filter(
      (s) => s && isFinitePt(s[0]) && isFinitePt(s[1]),
    );
    // Rake (gable) segments: the AI's explicit gable classification. A side
    // a rake runs along is a GABLE end — render it flush (ridge to wall) so
    // the gable connects to the roof, instead of as a floating stub.
    const rakeSegs = (opts?.rakeSegments ?? []).filter(
      (s) => s && isFinitePt(s[0]) && isFinitePt(s[1]),
    );
    const haveEaves = eaveSegs.length > 0;
    const eaveTol = tol * 2; // eaves sit ~1-2 ft inside the eave line (overhang)

    // Guard: if eaves were passed but NONE align with any rectangle side
    // (coordinate-space mismatch / bad data), don't turn every side into a
    // gable — fall back to all-hip so we still draw a recognizable roof.
    let anyEaveMatch = false;
    if (haveEaves) {
      for (const rc of rectCells.length
        ? rectCells.map((c) => ({
            x0: xs[c.i0],
            x1: xs[c.i1 + 1],
            y0: ys[c.j0],
            y1: ys[c.j1 + 1],
          }))
        : [{ x0: minX, x1: maxX, y0: minY, y1: maxY }]) {
        if (
          sideHasEave("h", rc.y0, rc.x0, rc.x1, eaveSegs, eaveTol) ||
          sideHasEave("h", rc.y1, rc.x0, rc.x1, eaveSegs, eaveTol) ||
          sideHasEave("v", rc.x0, rc.y0, rc.y1, eaveSegs, eaveTol) ||
          sideHasEave("v", rc.x1, rc.y0, rc.y1, eaveSegs, eaveTol)
        ) {
          anyEaveMatch = true;
          break;
        }
      }
    }
    const useEaves = haveEaves && anyEaveMatch;

    const ridges: SkeletonLine[] = [];
    const hips: SkeletonLine[] = [];
    const gables: SkeletonLine[] = [];
    const faces: RoofFace[] = [];
    const single = rects.length === 1 && rectCells.length <= 1;
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      const interior =
        single || rectCells.length === 0
          ? { top: false, bottom: false, left: false, right: false }
          : {
              top: sideIsInterior(inside, nx, ny, rectCells[k], "top"),
              bottom: sideIsInterior(inside, nx, ny, rectCells[k], "bottom"),
              left: sideIsInterior(inside, nx, ny, rectCells[k], "left"),
              right: sideIsInterior(inside, nx, ny, rectCells[k], "right"),
            };
      // A side is a GABLE end when a RAKE runs along it (the AI's explicit
      // classification — wins), OR — knowing the eaves — when it carries no
      // gutter. A gable side renders FLUSH (ridge to wall, no hip) so it
      // connects to the roof, and is recorded so the caller can label it.
      const isGable = (axis: "h" | "v", fixed: number, lo: number, hi: number) => {
        // A side with a FULL-LENGTH eave is an EAVE side, never a gable end —
        // a real gable end has no gutter across its face. This vetoes a stray
        // rake that would otherwise paint a GABLE on a genuine eave side. A
        // PARTIAL eave (a lower porch on a gable-end side) does NOT veto it.
        if (sideEaveCoverage(axis, fixed, lo, hi, eaveSegs, eaveTol) > 0.6)
          return false;
        // An explicit rake along the side is a gable end (AI classification).
        if (sideHasEave(axis, fixed, lo, hi, rakeSegs, eaveTol)) return true;
        if (!useEaves) return false;
        // No rake + not a full eave: it's a GABLE END when the MIDDLE of the
        // side (the gable face) carries no gutter. This is the key fix for a
        // 2-story gable body whose gable-end sides only have a LOW porch/patio
        // RETURN eave clipping the corners — total coverage is non-zero so the
        // old "no eave at all" test missed it and drew a wrong HIP. A genuine
        // eave side runs a continuous eave across its middle.
        return !sideMiddleHasEave(axis, fixed, lo, hi, eaveSegs, eaveTol);
      };
      const SIDES = [
        { k: "top" as const, axis: "h" as const, fixed: r.y0, lo: r.x0, hi: r.x1, a: { x: r.x0, y: r.y0 }, b: { x: r.x1, y: r.y0 } },
        { k: "bottom" as const, axis: "h" as const, fixed: r.y1, lo: r.x0, hi: r.x1, a: { x: r.x0, y: r.y1 }, b: { x: r.x1, y: r.y1 } },
        { k: "left" as const, axis: "v" as const, fixed: r.x0, lo: r.y0, hi: r.y1, a: { x: r.x0, y: r.y0 }, b: { x: r.x0, y: r.y1 } },
        { k: "right" as const, axis: "v" as const, fixed: r.x1, lo: r.y0, hi: r.y1, a: { x: r.x1, y: r.y0 }, b: { x: r.x1, y: r.y1 } },
      ];
      const flush = { top: false, bottom: false, left: false, right: false };
      for (const s of SIDES) {
        if (interior[s.k]) {
          flush[s.k] = true;
          continue;
        }
        if (isGable(s.axis, s.fixed, s.lo, s.hi)) {
          flush[s.k] = true;
          gables.push({ points: [s.a, s.b] });
        }
      }
      const rr = rectRoof(r, flush);
      ridges.push(...rr.ridges);
      hips.push(...rr.hips);
      faces.push(...rr.faces);
    }

    // Valleys terminate on the ridges/hips already built (so they connect to
    // the roof body instead of dangling); fall back to a short stub otherwise.
    const valleys = valleyLines(ring, Math.max(tol * 2, span * 0.12), [
      ...ridges,
      ...hips,
    ]);

    // Collapse the per-rectangle gable fragments into the real gable ends so
    // the overlay doesn't stack a "GABLE" label per fragment (the 8-pill pile).
    const mergedGables = mergeGables(gables, tol, Math.max(span * 0.03, 4));

    // Tie every gable end into the roof body with a ridge line so it reads as
    // a finished, attached gable rather than a floating stub + label.
    let rcx = 0;
    let rcy = 0;
    for (const p of ring) {
      rcx += p.x;
      rcy += p.y;
    }
    const centroid = { x: rcx / ring.length, y: rcy / ring.length };
    const connectors = gableConnectors(
      mergedGables,
      [...ridges, ...hips],
      centroid,
      tol,
      span * 0.5,
    );
    ridges.push(...connectors);

    return { ridges, hips, valleys, gables: mergedGables, faces };
  } catch {
    return EMPTY;
  }
}
