/**
 * Axonometric (parallel-projection) 3D massing for the takeoff — a dependency-
 * free "kind of 3D" the contractor can spin to see which wall each gutter +
 * downspout sits on, mirroring the elevation sheets. NO three.js / WebGL: we
 * project 3D points (x,y in canvas px, z in FEET) to 2D with a yaw + fixed
 * tilt and paint faces back-to-front (painter's algorithm).
 *
 * Pure + directive-free (no React/DOM) so it runs under node for a smoke test
 * and so importing it can never drag a "use client" module server-side
 * (the PX_PER_FT-through-use-client RSC NaN bug class). DECORATIVE ONLY — it
 * reads the same eaves/footprint the 2D overlay does and never touches LF or
 * pricing.
 */
import { PX_PER_FT } from "../components/estimate/aerial-constants";
import { STORY_HEIGHT_FT, type Stories } from "./types";

export type Pt = { x: number; y: number };
/** A 3D point: x,y in canvas pixels (the 900×580 takeoff space), z in FEET. */
export type P3 = { x: number; y: number; z: number };
export type Proj = { x: number; y: number; depth: number };
export type Face = { verts: P3[]; kind: "wall" };
export type Edge3 = {
  a: P3;
  b: P3;
  kind: "ridge" | "hip" | "valley" | "gable";
};
export type SkelLine = { points: { x: number; y: number }[] };
export type Skeleton = {
  ridges: SkelLine[];
  hips: SkelLine[];
  valleys: SkelLine[];
  gables: SkelLine[];
};

const isFinitePt = (p: Pt | undefined | null): p is Pt =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Stray stories (0 / 4 / NaN / undefined) would index STORY_HEIGHT_FT to
 *  undefined → NaN z → the whole model collapses. Clamp to a real story. */
export function clampStories(s?: number): Stories {
  return s === 1 || s === 2 || s === 3 ? s : 2;
}

/** Average of the finite perimeter points — the rotation pivot. null when
 *  there aren't enough real points (caller falls back to the eave bbox). */
export function centerOf(perimeter: readonly Pt[]): { cx: number; cy: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of perimeter) {
    if (!isFinitePt(p)) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n < 2 ? null : { cx: sx / n, cy: sy / n };
}

export function bboxOf(
  pts: readonly Pt[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const p of pts) {
    if (!isFinitePt(p)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  if (n < 1) return null;
  if (maxX - minX < 1) maxX = minX + 1;
  if (maxY - minY < 1) maxY = minY + 1;
  return { minX, minY, maxX, maxY };
}

/**
 * Project a 3D point to the screen. yaw spins about the vertical axis, tilt is
 * the fixed camera pitch. z (feet) is converted to px ONCE here, so call sites
 * always pass z in feet (kills the double-scale bug). `depth` (the rotated
 * forward axis) drives the painter's sort.
 */
export function project(
  p: P3,
  yaw: number,
  tilt: number,
  c: { cx: number; cy: number },
): Proj {
  const dx = p.x - c.cx;
  const dy = p.y - c.cy;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = dx * cy - dy * sy;
  const ry = dx * sy + dy * cy;
  const zpx = p.z * PX_PER_FT;
  return { x: rx, y: ry * Math.sin(tilt) - zpx * Math.cos(tilt), depth: ry };
}

/** Largest distance from center to any finite point — used to scale the model
 *  into the frame at a STABLE size (rotation preserves it, so no "breathing"). */
export function modelRadius(perimeter: readonly Pt[], c: { cx: number; cy: number }): number {
  let r = 0;
  for (const p of perimeter) {
    if (!isFinitePt(p)) continue;
    r = Math.max(r, Math.hypot(p.x - c.cx, p.y - c.cy));
  }
  return r;
}

const nearAny = (p: Pt, pts: readonly Pt[], tol: number) =>
  pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol);

/**
 * Extrude the footprint to wall height and lift the roof skeleton into 3D.
 * v1: walls are solid FACES (one quad per edge); the roof is drawn as lifted
 * LINES (ridges/hips/valleys + gable triangles) — a clean wireframe cap.
 *   - ridge endpoints  → high (wallFt + ridgeRiseFt)
 *   - hip/valley ends  → low (wallFt) where they meet a perimeter corner,
 *                        high where they run inward to the ridge
 *   - gable            → base at wall top + two rakes up to a synthesized peak
 */
export function buildMassing(
  perimeter: readonly Pt[],
  /** Wall height in feet — a single number, or a per-edge function so lower-tier
   *  sections (porch/patio/garage) step DOWN below the 2-story body. */
  wallFtFor: number | ((a: Pt, b: Pt) => number),
  skeleton: Skeleton,
  ridgeRiseFt: number,
  /** The main-body wall height the roof sits on. Defaults to wallFtFor when
   *  that's a number, else the tallest per-edge height. */
  bodyFt?: number,
): { faces: Face[]; edges: Edge3[] } {
  const ring = perimeter.filter(isFinitePt);
  const resolveWall = (a: Pt, b: Pt) =>
    typeof wallFtFor === "function" ? wallFtFor(a, b) : wallFtFor;
  let body = bodyFt;
  if (body === undefined) {
    if (typeof wallFtFor === "number") body = wallFtFor;
    else {
      body = 0;
      for (let i = 0; i < ring.length; i++) {
        body = Math.max(body, resolveWall(ring[i], ring[(i + 1) % ring.length]));
      }
    }
  }

  const faces: Face[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const h = resolveWall(a, b);
    faces.push({
      verts: [
        { x: a.x, y: a.y, z: 0 },
        { x: b.x, y: b.y, z: 0 },
        { x: b.x, y: b.y, z: h },
        { x: a.x, y: a.y, z: h },
      ],
      kind: "wall",
    });
  }

  const high = body + Math.max(0, ridgeRiseFt);
  // tolerance for "this skeleton endpoint sits on a perimeter corner".
  const span = (() => {
    const bb = bboxOf(ring);
    return bb ? Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) : 1;
  })();
  const tol = Math.max(4, span * 0.04);

  const edges: Edge3[] = [];
  for (const r of skeleton.ridges ?? []) {
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    edges.push({ a: { ...a, z: high }, b: { ...b, z: high }, kind: "ridge" });
  }
  const liftEnd = (p: Pt): P3 => ({ x: p.x, y: p.y, z: nearAny(p, ring, tol) ? body : high });
  for (const h of skeleton.hips ?? []) {
    const a = h.points[0];
    const b = h.points[h.points.length - 1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    edges.push({ a: liftEnd(a), b: liftEnd(b), kind: "hip" });
  }
  for (const v of skeleton.valleys ?? []) {
    const a = v.points[0];
    const b = v.points[v.points.length - 1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    edges.push({ a: liftEnd(a), b: liftEnd(b), kind: "valley" });
  }
  // Gable → a little triangle: base at wall top, two rakes to a lifted peak.
  for (const g of skeleton.gables ?? []) {
    const a = g.points[0];
    const b = g.points[g.points.length - 1];
    if (!isFinitePt(a) || !isFinitePt(b)) continue;
    const peak: P3 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: high };
    edges.push({ a: { ...a, z: body }, b: { ...b, z: body }, kind: "gable" });
    edges.push({ a: { ...a, z: body }, b: peak, kind: "gable" });
    edges.push({ a: { ...b, z: body }, b: peak, kind: "gable" });
  }
  return { faces, edges };
}

/** Painter's algorithm: average projected depth per face, FAR (largest) first
 *  so nearer walls paint over farther ones. */
export function sortFacesByDepth(
  faces: readonly Face[],
  proj: (p: P3) => Proj,
): Face[] {
  return faces
    .map((f) => ({
      f,
      d: f.verts.reduce((s, v) => s + proj(v).depth, 0) / Math.max(1, f.verts.length),
    }))
    .sort((p, q) => q.d - p.d)
    .map((x) => x.f);
}

/** Wall height (ft) for a story count, NaN-safe. */
export function wallHeightFt(stories?: number): number {
  return STORY_HEIGHT_FT[clampStories(stories)];
}
