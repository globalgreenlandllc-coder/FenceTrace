/**
 * Geo math for the fence estimator — pure functions, no I/O.
 *
 * The estimate canvas is a 900×580 viewBox. We fetch a Google Static Map
 * at 640×412 (scale 2 for retina) — the same 1.5528 aspect — and draw it
 * full-bleed, so map-pixel → canvas-pixel is one uniform factor
 * (900 / 640 = 1.40625). All lat/lng → canvas math funnels through the
 * standard Web Mercator world-coordinate projection at the chosen zoom.
 */

export const CANVAS_W = 900;
export const CANVAS_H = 580;
export const MAP_W = 640;
export const MAP_H = 412;
export const MAP_SCALE = 2; // retina static map
const CANVAS_PER_MAP = CANVAS_W / MAP_W; // 1.40625, uniform both axes

export type LatLng = { lat: number; lng: number };
export type Pt = { x: number; y: number };

/** Web Mercator "world coordinates" (256×256 world at zoom 0). */
function worldCoord(p: LatLng): Pt {
  const siny = Math.min(
    0.9999,
    Math.max(-0.9999, Math.sin((p.lat * Math.PI) / 180)),
  );
  return {
    x: 256 * (0.5 + p.lng / 360),
    y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

/** Meters covered by one map pixel at this latitude/zoom (scale-adjusted). */
export function metersPerMapPx(lat: number, zoom: number): number {
  return (
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

/** Canvas px per FOOT for a map centered at `lat` rendered at `zoom`. */
export function canvasPxPerFt(lat: number, zoom: number): number {
  const metersPerCanvasPx = metersPerMapPx(lat, zoom) / CANVAS_PER_MAP;
  return 0.3048 / metersPerCanvasPx;
}

/** Project lat/lng into canvas coordinates for a map centered on `center`
 *  at `zoom` (map W×H at that zoom, drawn into the 900×580 canvas). */
export function latLngToCanvas(p: LatLng, center: LatLng, zoom: number): Pt {
  const scale = Math.pow(2, zoom);
  const w = worldCoord(p);
  const c = worldCoord(center);
  const mapPx = { x: (w.x - c.x) * scale + MAP_W / 2, y: (w.y - c.y) * scale + MAP_H / 2 };
  return {
    x: mapPx.x * CANVAS_PER_MAP,
    y: mapPx.y * CANVAS_PER_MAP,
  };
}

/** Pick the tightest integer zoom that fits the bbox in the map with ~12%
 *  margin. Clamped to residential-useful range. */
export function zoomToFit(points: LatLng[], fallback = 19, margin = 1.24): number {
  if (points.length < 2) return fallback;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    const w = worldCoord(p);
    minX = Math.min(minX, w.x);
    maxX = Math.max(maxX, w.x);
    minY = Math.min(minY, w.y);
    maxY = Math.max(maxY, w.y);
  }
  const spanX = (maxX - minX) * margin;
  const spanY = (maxY - minY) * margin;
  for (let z = 21; z >= 15; z--) {
    const scale = Math.pow(2, z);
    if (spanX * scale <= MAP_W && spanY * scale <= MAP_H) return z;
  }
  return 15;
}

/** Centroid of a lat/lng ring (good enough for parcel centering). */
export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  let lat = 0,
    lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Inverse of latLngToCanvas — canvas point back to lat/lng for a map
 *  centered on `center` at `zoom` (used to sample real-world elevation
 *  along drawn fence runs). */
export function canvasToLatLng(p: Pt, center: LatLng, zoom: number): LatLng {
  const scale = Math.pow(2, zoom);
  const c = worldCoord(center);
  const mapPx = { x: p.x / CANVAS_PER_MAP, y: p.y / CANVAS_PER_MAP };
  const wx = (mapPx.x - MAP_W / 2) / scale + c.x;
  const wy = (mapPx.y - MAP_H / 2) / scale + c.y;
  const lng = (wx / 256 - 0.5) * 360;
  const n = Math.PI - (2 * Math.PI * wy) / 256;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Positions along a polyline every `spacingPx`, vertices included —
 *  the post positions of a run (used for elevation sampling + 3D). */
export function walkPostPositions(points: Pt[], spacingPx: number): Pt[] {
  if (points.length < 2 || spacingPx <= 0) return [...points];
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 0.5) continue;
    const chunks = Math.max(1, Math.ceil(segLen / spacingPx));
    for (let c = 1; c <= chunks; c++) {
      out.push({
        x: a.x + ((b.x - a.x) * c) / chunks,
        y: a.y + ((b.y - a.y) * c) / chunks,
      });
    }
  }
  return out;
}

export type RunElevationModel = {
  /** Full arc length of the run, canvas px. */
  totalPx: number;
  /** Ground elevation (ft) at an arc distance along the run, clamped. */
  atDistPx: (d: number) => number;
};

/** Pair walk-sampled elevations back onto arc distance along a run, so
 *  the 3D preview can read the ground anywhere between posts. MUST be
 *  built with the same spacing the sampler used — walk points are not
 *  uniformly spaced (vertices are always kept), so we re-walk the
 *  polyline and zip. Null when the counts don't match (stale layout —
 *  render flat rather than guess) or there's nothing to model. */
export function runDistanceModel(
  points: Pt[],
  spacingPx: number,
  elevationsFt: number[],
): RunElevationModel | null {
  if (points.length < 2 || elevationsFt.length < 2) return null;
  const walk = walkPostPositions(points, spacingPx);
  if (walk.length !== elevationsFt.length) return null;
  const dists: number[] = [0];
  for (let i = 1; i < walk.length; i++) {
    dists.push(
      dists[i - 1] +
        Math.hypot(walk[i].x - walk[i - 1].x, walk[i].y - walk[i - 1].y),
    );
  }
  const totalPx = dists[dists.length - 1];
  if (totalPx <= 0) return null;
  const atDistPx = (d: number): number => {
    if (d <= 0) return elevationsFt[0];
    if (d >= totalPx) return elevationsFt[elevationsFt.length - 1];
    let i = 1;
    while (dists[i] < d) i++;
    const span = dists[i] - dists[i - 1];
    const s = span > 0 ? (d - dists[i - 1]) / span : 0;
    return elevationsFt[i - 1] + (elevationsFt[i] - elevationsFt[i - 1]) * s;
  };
  return { totalPx, atDistPx };
}

/** Length of a canvas polyline in feet given the canvas scale. */
export function canvasPolylineFt(points: Pt[], pxPerFt: number): number {
  if (pxPerFt <= 0) return 0;
  let px = 0;
  for (let i = 1; i < points.length; i++) {
    px += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return px / pxPerFt;
}

/** A vertex is a CORNER when the fence actually changes direction there
 *  — deflection ≥ this many degrees. Anything shallower is a dogleg the
 *  crew absorbs with a line post (no bracing, no corner hardware), and
 *  parcel rings are full of such near-collinear vertices. Direction of
 *  the turn (left/right/oblique) is irrelevant — only the angle. */
export const CORNER_MIN_DEG = 25;

function deflectionDeg(prev: Pt, cur: Pt, next: Pt): number {
  const ax = cur.x - prev.x;
  const ay = cur.y - prev.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Per-vertex corner flags for a run. Closed rings (first ≈ last point)
 *  evaluate the shared closing vertex too (flag lands on index 0; the
 *  duplicate last index stays false). Endpoints of open runs are never
 *  corners — they're ends. */
export function cornerFlags(points: Pt[], minDeg = CORNER_MIN_DEG): boolean[] {
  const n = points.length;
  const flags = new Array<boolean>(n).fill(false);
  if (n < 3) return flags;
  const closed =
    Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) < 1.5;
  for (let i = 1; i < n - 1; i++) {
    flags[i] = deflectionDeg(points[i - 1], points[i], points[i + 1]) >= minDeg;
  }
  if (closed && n >= 4) {
    flags[0] = deflectionDeg(points[n - 2], points[0], points[1]) >= minDeg;
  }
  return flags;
}

/** Corner + end counts across a set of runs (angle-aware). */
export function countCornersAndEnds(
  runs: { points: Pt[] }[],
  minDeg = CORNER_MIN_DEG,
): { corners: number; ends: number } {
  let corners = 0;
  let ends = 0;
  for (const run of runs) {
    const pts = run.points;
    if (pts.length < 2) continue;
    const closed =
      Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1.5;
    corners += cornerFlags(pts, minDeg).filter(Boolean).length;
    ends += closed ? 0 : 2;
  }
  return { corners, ends };
}

/* ------------------------------------------------------------------ */
/*  Parcel-ring display cleaning                                       */
/* ------------------------------------------------------------------ */

/**
 * Clean a county parcel ring for DISPLAY. Provider rings arrive with
 * three kinds of garbage that render badly: the GeoJSON closing
 * duplicate (a phantom corner dot on top of a real one), dense
 * sub-foot jitter chains (a blob of stacked vertex dots), and
 * doubled-back "spike" edges (two dashed strokes overlapping at
 * opposite phase — which reads as one THICK SOLID line). This strips
 * all three while keeping every real corner, so the drawn line still
 * sits on the county boundary.
 *
 * Distinct from straightenSeed in scan-core: that cleans the FENCE
 * seed aggressively; this is the lightest touch that makes the
 * boundary itself render honestly.
 */
export function cleanDisplayRing(ring: Pt[], pxPerFt: number): Pt[] {
  if (ring.length < 3) return ring;
  let pts = ring.slice();

  // 1. GeoJSON closure duplicate(s): the polygon element closes itself.
  const closeEps = Math.max(1, pxPerFt * 0.5);
  while (
    pts.length > 1 &&
    Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < closeEps
  ) {
    pts.pop();
  }

  // 2. Merge consecutive near-duplicates (< ~1.5 ft apart) — each one
  //    was a full-size corner dot stacked on its neighbour.
  const minSeg = Math.max(1.2, pxPerFt * 1.5);
  const merged: Pt[] = [];
  for (const p of pts) {
    const last = merged[merged.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minSeg) merged.push(p);
  }
  while (
    merged.length > 3 &&
    Math.hypot(
      merged[0].x - merged[merged.length - 1].x,
      merged[0].y - merged[merged.length - 1].y,
    ) < minSeg
  ) {
    merged.pop();
  }
  pts = merged;

  // 3. Spike + jitter removal, one cyclic pass repeated to fixpoint:
  //    - a vertex whose incoming and outgoing edges point in nearly the
  //      SAME direction (<15° between them) is a retrace artifact,
  //      never a real lot corner — counties bend, they don't double
  //      back;
  //    - a vertex that barely deflects the line (<4°) is GPS jitter on
  //      a straight edge — the edge renders identically without it, and
  //      its corner dot disappears.
  const COS_SPIKE = Math.cos((15 * Math.PI) / 180);
  const COS_STRAIGHT = -Math.cos((4 * Math.PI) / 180);
  for (let pass = 0; pass < 6 && pts.length >= 4; pass++) {
    const n = pts.length;
    const keep: Pt[] = [];
    let dropped = false;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const bax = a.x - b.x, bay = a.y - b.y;
      const bcx = c.x - b.x, bcy = c.y - b.y;
      const la = Math.hypot(bax, bay) || 1;
      const lc = Math.hypot(bcx, bcy) || 1;
      const cos = (bax * bcx + bay * bcy) / (la * lc);
      if (cos > COS_SPIKE || cos < COS_STRAIGHT) {
        dropped = true;
        continue;
      }
      keep.push(b);
    }
    pts = keep;
    if (!dropped) break;
  }

  return pts.length >= 3 ? pts : ring;
}
