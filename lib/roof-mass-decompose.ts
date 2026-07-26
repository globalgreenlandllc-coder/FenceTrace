/**
 * roof-mass-decompose.ts — split ONE articulated rectilinear footprint into the
 * separate tier MASSES that make it up (main body + garage jog + porch/patio),
 * so the roof engine draws a clean per-tier hip for each instead of rejecting
 * one whole-house straight-skeleton as a centroid fan (the Woodinville garage-
 * jog bug). Stage 2 of the roof-architecture rebuild.
 *
 * The engine already prices/draws a `MassInput[]`; production just never fed it
 * more than one "main" mass. This module is the missing decomposer.
 *
 * METHOD — horizontal SLAB decomposition. Cut the polygon at every vertex
 * y-level; within each slab the cross-section is a set of x-intervals, each a
 * rectangle. Then greedily merge axis-adjacent rectangles that share a full edge
 * back into maximal rectangles (so a straight wing spanning two slabs is ONE
 * rectangle, not two with a false ridge between them). Because every cut lands on
 * a vertex coordinate, each rectangle edge lies WHOLLY on a single original edge
 * (or is a wholly-interior cut) — so an edge is guttered iff it sits on a
 * guttered original edge, with no partial-edge ambiguity. That makes the split
 * exactly AREA-preserving and gutter-LF-neutral.
 *
 * SAFETY — this can only ever equal or improve today's single-mass behavior. It
 * returns the ORIGINAL single "main" mass unchanged whenever anything is off:
 * the outline isn't (near-)rectilinear, it's a plain rectangle, the rectangles
 * don't tile the polygon area (±2%), the decomposed guttered LF drifts from the
 * original (±2%), or any exception. It NEVER invents length.
 *
 * PURE + directive-free (no server-only/DOM) so it runs in the browser bundle
 * AND under `node`/`tsx --test`. Deterministic; never throws on the happy path.
 */

import type { Pt } from "./roof-skeleton";
import { polyArea, type MassInput } from "./roof-engine";

const EPS = 1e-6;
const finite = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

type Rect = { x0: number; x1: number; y0: number; y1: number };

function bboxSpan(poly: Pt[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Cluster near-equal coordinates into representative levels (their mean), so a
 *  hand-traced near-rectilinear outline snaps to clean axis lines. On exact
 *  input every level is its own cluster ⇒ identity. */
function clusterReps(vals: number[], tol: number): number[] {
  const sorted = [...vals].sort((a, b) => a - b);
  const reps: number[] = [];
  let group: number[] = [];
  for (const v of sorted) {
    if (group.length === 0 || v - group[group.length - 1] <= tol) group.push(v);
    else {
      reps.push(group.reduce((s, x) => s + x, 0) / group.length);
      group = [v];
    }
  }
  if (group.length) reps.push(group.reduce((s, x) => s + x, 0) / group.length);
  return reps;
}

const nearestRep = (reps: number[], v: number): number =>
  reps.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), reps[0]);

/**
 * Snap a (near-)rectilinear polygon to exact axis-aligned coordinate levels.
 * Preserves vertex COUNT (so a caller's per-edge index array stays valid).
 * Returns null when the result isn't a clean rectilinear ring — a genuinely
 * diagonal edge can't snap to axis-aligned, and a collapsed (zero-length) edge
 * means two corners were within tol — in either case the caller must bail.
 */
function snapRectilinear(poly: Pt[], tol: number): Pt[] | null {
  const xs = clusterReps(poly.map((p) => p.x), tol);
  const ys = clusterReps(poly.map((p) => p.y), tol);
  const snapped = poly.map((p) => ({ x: nearestRep(xs, p.x), y: nearestRep(ys, p.y) }));
  for (let i = 0; i < snapped.length; i++) {
    const a = snapped[i];
    const b = snapped[(i + 1) % snapped.length];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > EPS && dy > EPS) return null; // diagonal ⇒ not rectilinear
    if (dx < EPS && dy < EPS) return null; // degenerate (collapsed) edge
  }
  return snapped;
}

/** Slab decomposition: rectangles tiling the rectilinear polygon exactly. */
function slabRects(poly: Pt[]): Rect[] {
  const ys = clusterReps(poly.map((p) => p.y), EPS);
  const rects: Rect[] = [];
  for (let s = 0; s + 1 < ys.length; s++) {
    const y0 = ys[s];
    const y1 = ys[s + 1];
    const ym = (y0 + y1) / 2;
    // x of every vertical edge that spans this slab's mid-line.
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (Math.abs(a.x - b.x) < EPS) {
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (ym > lo + EPS && ym < hi - EPS) xs.push(a.x);
      }
    }
    xs.sort((p, q) => p - q);
    // Even-odd: inside between consecutive crossing pairs.
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > EPS) rects.push({ x0: xs[k], x1: xs[k + 1], y0, y1 });
    }
  }
  return rects;
}

const transposePt = (p: Pt): Pt => ({ x: p.y, y: p.x });
const transposeRect = (r: Rect): Rect => ({ x0: r.y0, x1: r.y1, y0: r.x0, y1: r.x1 });

/** Score a tiling for cleanliness: fewer rectangles first, then the SHORTER
 *  total internal cut (∑ rect perimeter — the outer perimeter is fixed, so less
 *  rect-perimeter ⇔ shorter shared walls ⇔ cuts run along the jog, not across
 *  the house). This is what picks main|garage over a top-strip|bottom split when
 *  both are valid 2-rect tilings. */
function tilingScore(rects: Rect[]): [number, number] {
  const perim = rects.reduce((s, r) => s + 2 * ((r.x1 - r.x0) + (r.y1 - r.y0)), 0);
  return [rects.length, perim];
}
function chooseBetterTiling(a: Rect[], b: Rect[]): Rect[] {
  const [ac, ap] = tilingScore(a);
  const [bc, bp] = tilingScore(b);
  if (ac !== bc) return ac < bc ? a : b;
  return ap <= bp ? a : b; // shorter total internal cut = more natural tiers
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

/** Greedily merge two rectangles into their bounding rectangle when they share a
 *  full edge (same x-range stacked in y, or same y-range abutting in x) — the
 *  union is then exactly that rectangle, so this stays area-exact. Reduces a
 *  straight wing split across slabs back to a single rectangle. */
function mergeRects(input: Rect[]): Rect[] {
  const cur = [...input];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cur.length && !changed; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const A = cur[i];
        const B = cur[j];
        const sameX = near(A.x0, B.x0) && near(A.x1, B.x1);
        const sameY = near(A.y0, B.y0) && near(A.y1, B.y1);
        const touchY = near(A.y1, B.y0) || near(A.y0, B.y1);
        const touchX = near(A.x1, B.x0) || near(A.x0, B.x1);
        if (sameX && touchY) {
          cur[i] = { x0: A.x0, x1: A.x1, y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1) };
          cur.splice(j, 1);
          changed = true;
          break;
        }
        if (sameY && touchX) {
          cur[i] = { y0: A.y0, y1: A.y1, x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1) };
          cur.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return cur;
}

/**
 * Split one rectangle edge a→b into contiguous sub-edges, each tagged guttered
 * iff it lies on a GUTTERED original edge. A slab rectangle's edge can be PART
 * boundary, PART interior cut (e.g. an L's wide slab whose bottom is boundary
 * over the foot and interior over the notch) — so classifying the whole edge
 * would over- or under-count. Splitting at the exact boundary/interior
 * transitions is what makes the takeoff gutter-LF-neutral.
 */
function splitEdgeByGuttered(
  a: Pt,
  b: Pt,
  original: Pt[],
  gutteredSet: Set<number>,
  tol: number,
): { start: Pt; guttered: boolean }[] {
  const L = dist(a, b);
  if (L < EPS) return [{ start: a, guttered: false }];
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const proj = (p: Pt) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const perp = (p: Pt) => Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
  // Guttered coverage intervals along a→b (in [0, L]).
  const ivs: [number, number][] = [];
  for (let e = 0; e < original.length; e++) {
    if (!gutteredSet.has(e)) continue;
    const oa = original[e];
    const ob = original[(e + 1) % original.length];
    if (perp(oa) > tol || perp(ob) > tol) continue; // not collinear with this edge
    let t0 = proj(oa);
    let t1 = proj(ob);
    if (t0 > t1) [t0, t1] = [t1, t0];
    const lo = Math.max(0, t0);
    const hi = Math.min(L, t1);
    if (hi - lo > EPS) ivs.push([lo, hi]);
  }
  ivs.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const iv of ivs) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  const pt = (t: number): Pt => ({ x: a.x + ux * t, y: a.y + uy * t });
  const parts: { start: Pt; guttered: boolean }[] = [];
  let cursor = 0;
  for (const [lo, hi] of merged) {
    if (lo > cursor + EPS) parts.push({ start: pt(cursor), guttered: false });
    parts.push({ start: pt(Math.max(lo, cursor)), guttered: true });
    cursor = hi;
  }
  if (cursor < L - EPS) parts.push({ start: pt(cursor), guttered: false });
  if (parts.length === 0) parts.push({ start: a, guttered: false });
  return parts;
}

/** Turn one rectangle into a MassInput. Each of its 4 sides is split into
 *  sub-edges at the boundary/interior transitions, so `eaveEdges` marks exactly
 *  the portions that sit on a guttered original edge — an interior cut (shared
 *  with a neighbor tier) is never guttered, so the shared wall adds no LF. The
 *  extra collinear vertices don't change the mass area or its clean-rectangle
 *  skeleton. */
function rectToMass(r: Rect, name: string, original: Pt[], gutteredSet: Set<number>, tol: number): MassInput {
  const corners: Pt[] = [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
  // Walk the 4 sides, splitting each; the sub-edge START points, in order, are
  // the mass outline vertices, and sub-edge i is the edge outline[i]→outline[i+1].
  const sub: { start: Pt; guttered: boolean }[] = [];
  for (let i = 0; i < 4; i++) {
    for (const part of splitEdgeByGuttered(corners[i], corners[(i + 1) % 4], original, gutteredSet, tol)) {
      sub.push(part);
    }
  }
  const outline = sub.map((s) => s.start);
  const eaveEdges = sub.map((s, i) => (s.guttered ? i : -1)).filter((i) => i >= 0);
  return { name, outline, statedArea: null, eaveEdges };
}

/** Total length of the outline's guttered edges (the LF-neutrality yardstick). */
function gutteredPerimeter(outline: Pt[], eaveEdges: number[]): number {
  const set = new Set(eaveEdges);
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    if (set.has(i)) sum += dist(outline[i], outline[(i + 1) % outline.length]);
  }
  return sum;
}

export type DecomposeOptions = {
  /** Coordinate-snap tolerance (native units). Default 2% of the bbox span. */
  snapTol?: number;
};

export type TierAreaMatch = { areaFt2: number; label: string } | null;

/**
 * Match each decomposed tier to a stated ROOF-SCHEDULE area (e.g. UPPER 2902 sf,
 * GARAGE 674 sf, PATIO 228 sf) by nearest area, one-to-one, so the engine can
 * area-gate each tier against the plan instead of leaving it unverified. Greedy
 * on the closest relative match; a tier is left UNMATCHED (null ⇒ no gate, an
 * honest `no_schedule`) unless a schedule area is within `tolFrac` — so a wrong
 * label is never force-fit onto a tier.
 *
 * GROUP pass: the decomposition often SPLITS one schedule mass into several
 * tiers (Woodinville: UPPER 2902 sf decomposes as main 1687 + tier-1 1229 =
 * 2916 sf — a 0.5% match that one-to-one can't see, so every tier reported
 * `no_schedule`). After one-to-one, each unused schedule entry tries subsets
 * (size 2–3) of the still-unmatched tiers; when a subset's SUM lands within
 * `tolFrac`, each member tier is gated against its PROPORTIONAL SHARE of the
 * stated area (per-tier rel error then equals the group's — meaningful, not a
 * freebie) with a "(split n/m)" label so the flag reads honestly.
 * Pure + deterministic.
 */
export function matchTierAreas(
  tierAreasFt2: number[],
  schedule: { label: string; areaFt2: number }[] | null | undefined,
  tolFrac = 0.25,
): TierAreaMatch[] {
  const out: TierAreaMatch[] = tierAreasFt2.map(() => null);
  if (!Array.isArray(schedule) || schedule.length === 0) return out;
  const cand: { t: number; s: number; rel: number }[] = [];
  tierAreasFt2.forEach((ta, t) => {
    if (!(ta > 0)) return;
    schedule.forEach((sc, s) => {
      if (!sc || !(sc.areaFt2 > 0)) return;
      const rel = Math.abs(ta - sc.areaFt2) / sc.areaFt2;
      if (rel <= tolFrac) cand.push({ t, s, rel });
    });
  });
  cand.sort((a, b) => a.rel - b.rel);
  const usedT = new Set<number>();
  const usedS = new Set<number>();
  for (const c of cand) {
    if (usedT.has(c.t) || usedS.has(c.s)) continue;
    out[c.t] = { areaFt2: schedule[c.s].areaFt2, label: schedule[c.s].label };
    usedT.add(c.t);
    usedS.add(c.s);
  }

  // GROUP pass — unused schedule entries vs sums of unmatched tiers.
  const freeTiers = tierAreasFt2
    .map((ta, t) => ({ ta, t }))
    .filter(({ ta, t }) => ta > 0 && !usedT.has(t));
  schedule.forEach((sc, s) => {
    if (usedS.has(s) || !sc || !(sc.areaFt2 > 0)) return;
    const avail = freeTiers.filter(({ t }) => !usedT.has(t));
    let best: { idxs: number[]; rel: number } | null = null;
    const consider = (idxs: number[]) => {
      const sum = idxs.reduce((a, t) => a + tierAreasFt2[t], 0);
      const rel = Math.abs(sum - sc.areaFt2) / sc.areaFt2;
      if (rel <= tolFrac && (!best || rel < best.rel)) best = { idxs: [...idxs], rel };
    };
    for (let i = 0; i < avail.length; i++)
      for (let j = i + 1; j < avail.length; j++) {
        consider([avail[i].t, avail[j].t]);
        for (let k = j + 1; k < avail.length; k++) consider([avail[i].t, avail[j].t, avail[k].t]);
      }
    if (!best) return;
    const chosen: { idxs: number[]; rel: number } = best;
    const sum = chosen.idxs.reduce((a, t) => a + tierAreasFt2[t], 0);
    chosen.idxs.forEach((t, i) => {
      // Proportional share: the per-tier gate then measures the same relative
      // error as the group sum, instead of failing tier-vs-whole.
      const share = (tierAreasFt2[t] / sum) * sc.areaFt2;
      out[t] = {
        areaFt2: Math.round(share * 10) / 10,
        label: `${sc.label} (split ${i + 1}/${chosen.idxs.length})`,
      };
      usedT.add(t);
    });
    usedS.add(s);
  });
  return out;
}

/**
 * Split one footprint into its tier masses. Returns a single `main` mass
 * (unchanged) whenever decomposition isn't clean/safe, so a caller can always
 * use the result directly. Masses are ordered largest-first and named
 * `main`, `tier-1`, `tier-2`, … . `eaveEdges` indexes edges of `outline`.
 */
export function decomposeMasses(outline: Pt[], eaveEdges: number[], opts?: DecomposeOptions): MassInput[] {
  const single: MassInput[] = [{ name: "main", outline, statedArea: null, eaveEdges }];
  try {
    if (!Array.isArray(outline) || outline.length < 4 || !outline.every(finite)) return single;
    const span = bboxSpan(outline);
    if (!(span > 0)) return single;
    const tol = opts?.snapTol ?? span * 0.02;

    const snapped = snapRectilinear(outline, tol);
    if (!snapped) return single; // not (near-)rectilinear

    // Slab-decompose BOTH ways (horizontal cuts and vertical cuts) and keep the
    // cleaner tiling — a jog reads as a clean tier one way and thin strips the
    // other (the garage jog: main+garage vertically vs 3 strips horizontally).
    const rectsH = mergeRects(slabRects(snapped));
    const rectsV = mergeRects(slabRects(snapped.map(transposePt))).map(transposeRect);
    const rects = chooseBetterTiling(rectsH, rectsV);
    if (rects.length <= 1) return single; // a plain rectangle — nothing to split

    // Area sanity: the rectangles must tile ~the whole polygon.
    const rectArea = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    const polyA = polyArea(snapped);
    if (!(polyA > 0) || Math.abs(rectArea - polyA) / polyA > 0.02) return single;

    const gutteredSet = new Set(eaveEdges);
    // Classify against the SNAPPED outline (index-aligned to eaveEdges).
    const masses = rects
      .map((r) => rectToMass(r, "tier", snapped, gutteredSet, Math.max(tol, span * 0.02)))
      .sort((a, b) => polyArea(b.outline) - polyArea(a.outline));

    // LF-neutrality guard: decomposed guttered LF must match the original's — a
    // split must never add or drop priced length. If it drifts, bail.
    const origLf = gutteredPerimeter(outline, eaveEdges);
    const decLf = masses.reduce((s, m) => s + gutteredPerimeter(m.outline, m.eaveEdges), 0);
    if (origLf > 0 && Math.abs(decLf - origLf) / origLf > 0.02) return single;

    masses.forEach((m, i) => (m.name = i === 0 ? "main" : `tier-${i}`));
    return masses;
  } catch {
    return single;
  }
}
