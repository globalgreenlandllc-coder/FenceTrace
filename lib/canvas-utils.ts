// Pure geometry helpers shared by the /demo takeoff pages (satellite +
// blueprint). No React, no DOM — safe to import anywhere and unit-test.
//
// The two demo methods differ only in how they establish a pixels-per-foot
// scale (satellite → known ground-sample distance; blueprint → 2-point
// calibration), but once scaled they share the exact same measurement math:
// sum the eave segments, adjust rakes for pitch, price the linear footage.

export type Point = { x: number; y: number };

export type SegmentKind = "eave" | "rake" | "ridge" | "valley";

/** A single roof edge in canvas (viewBox) coordinates. */
export type Segment = {
  id: string;
  a: Point;
  b: Point;
  kind: SegmentKind;
};

/** A downspout drop location in canvas coordinates. */
export type DownspoutMark = {
  id: string;
  at: Point;
};

/** Euclidean distance in canvas pixels. */
export function getDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Midpoint of a segment — where length labels are anchored. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Convert a pixel distance to feet given a calibrated scale. */
export function pxToFeet(px: number, pxPerFt: number): number {
  if (!Number.isFinite(pxPerFt) || pxPerFt <= 0) return 0;
  return px / pxPerFt;
}

/** Real-world length of a segment in feet. */
export function segmentLengthFt(a: Point, b: Point, pxPerFt: number): number {
  return pxToFeet(getDistance(a, b), pxPerFt);
}

/**
 * Two-point calibration → pixels-per-foot. Click a feature of known length
 * (a dimensioned wall, a scale bar) at points A and B, pass the real length
 * in feet, and every subsequent measurement inherits the scale.
 */
export function calibrateScale(a: Point, b: Point, knownFeet: number): number {
  if (!Number.isFinite(knownFeet) || knownFeet <= 0) return 0;
  return getDistance(a, b) / knownFeet;
}

/**
 * Sloped rake / true along-roof length for a flat (plan-view) run. A gutter
 * traced off a flat roof plan under-counts the true edge because the roof
 * rises. Given the flat length and a pitch (rise per 12" of run), return the
 * along-slope length: flat × √(12² + rise²) / 12.
 *
 * Eaves are horizontal so their flat length is already true; this matters for
 * rakes and for pitch-corrected area math.
 */
export function getEaveAdjustment(flatLengthFt: number, pitch: number): number {
  const rise = Math.max(0, pitch);
  const factor = Math.sqrt(144 + rise * rise) / 12;
  return flatLengthFt * factor;
}

/** Sum the feet of every eave-kind segment — the guttered linear footage. */
export function totalEaveFeet(segments: Segment[], pxPerFt: number): number {
  return segments
    .filter((s) => s.kind === "eave")
    .reduce((sum, s) => sum + segmentLengthFt(s.a, s.b, pxPerFt), 0);
}

/** Sum the feet of every segment regardless of kind. */
export function totalRunFeet(segments: Segment[], pxPerFt: number): number {
  return segments.reduce(
    (sum, s) => sum + segmentLengthFt(s.a, s.b, pxPerFt),
    0,
  );
}

/**
 * Scale a set of points about an origin — used to fit a preset roof outline
 * into the canvas viewBox, or to zoom a traced shape.
 */
export function scalePoints(
  points: Point[],
  scale: number,
  origin: Point = { x: 0, y: 0 },
): Point[] {
  return points.map((p) => ({
    x: origin.x + (p.x - origin.x) * scale,
    y: origin.y + (p.y - origin.y) * scale,
  }));
}

/**
 * Nearest point on segment [a,b] to p, plus the distance to it. Lets the
 * canvas snap a downspout onto the closest run when the user clicks near an
 * edge instead of exactly on it.
 */
export function projectOntoSegment(
  p: Point,
  a: Point,
  b: Point,
): { point: Point; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return { point: a, distance: getDistance(p, a) };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * abx, y: a.y + t * aby };
  return { point, distance: getDistance(p, point) };
}

let _idSeq = 0;
/** Monotonic id for freshly drawn segments / downspouts (client runtime). */
export function nextId(prefix = "seg"): string {
  _idSeq += 1;
  return `${prefix}-${_idSeq}`;
}

/** Round to 1 decimal foot for display. */
export function roundFt(feet: number): number {
  return Math.round(feet * 10) / 10;
}
