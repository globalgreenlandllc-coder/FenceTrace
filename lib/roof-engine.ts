/**
 * roof-engine.ts — deterministic roof geometry engine for the gutter takeoff.
 *
 * This is the TypeScript port of the spec's `roof_engine.py`. It draws the roof
 * BY RULE, not by eye: the vision model reads sheets and returns outlines +
 * gables (span / pitch / projection); this engine reconciles them into
 * classified edges, generates each gable's ridge-back and paired valleys,
 * runs the gates (closure, reentrant-corner, gable-anchor, area, long-run), and
 * computes the eave-LF + downspout takeoff. It NEVER guesses — anything it can't
 * resolve becomes a structured `ReviewFlag` instead of an invented number.
 *
 * TWO LAWS it enforces (see the spec):
 *  - LAW 1 — the model reads; the code reconciles. Geometry (closure, offsets,
 *    valley placement, area checks, downspout math) lives HERE, not in a prompt.
 *  - LAW 2 — a projection's side edges are guttered eaves whose length equals
 *    its depth; width comes from the facing view, depth from the perpendicular
 *    view. `buildGableByRule` is the concrete expression of this law.
 *
 * DESIGN RULES (mirror roof-skeleton.ts / reconcile-eaves.ts):
 *  - PURE + directive-free (no "server-only", no DOM, no React) so it runs in
 *    the browser bundle AND under `node`/`tsx --test`.
 *  - Deterministic: same input → same output. No Date.now()/Math.random().
 *  - Never throws on the happy path; malformed input yields flags, not crashes.
 *  - Coordinate-space agnostic: operates in whatever units it's handed (feet for
 *    a scaled takeoff, or raw PDF pixels). The +y direction is a caller choice;
 *    `facing` vectors are relative, so the engine is correct in either.
 */

import type { Pt } from "./roof-skeleton";
import { deriveRoofSkeletonStraight, validateSkeleton } from "./roof-skeleton-straight";

// ── Domain model (canonical, spec-aligned) ─────────────────────────────────

export type EdgeType = "eave" | "rake" | "hip" | "valley" | "ridge";
export type Facing = "N" | "S" | "E" | "W";
export type Confidence = "high" | "medium" | "low";

/** One classified roof edge. `gutter` is the load-bearing bit: eave LF sums
 *  only edges with `gutter === true`. */
export type Edge = {
  p1: Pt;
  p2: Pt;
  type: EdgeType;
  gutter: boolean;
  source?: string;
  confidence?: Confidence;
};

/** How the eave BENEATH a gable behaves (spec §1.4). Drives whether the gable
 *  contributes side eaves (projecting) or leaves a continuous eave whole
 *  (roof_mounted), or neither (flush). */
export type EaveCondition = "projecting" | "roof_mounted" | "flush";

/** What carries the gable. A porch/entry gable on posts or a beam is a real
 *  PROJECTING porch roof (guttered sides), NOT a decorative roof-mounted dormer
 *  — the most commonly mis-classified gable (spec §1.4 GABLE RULES). */
export type SupportedOn = "wall" | "posts" | "beam";

/** Where the projection depth was confirmed. Per the correction addendum, a
 *  gable is FLUSH (no side eaves) unless a side elevation or the roof plan
 *  positively shows it projecting — the face view alone is not sufficient. */
export type ProjectionSource = "side_elevation" | "roof_plan" | "none";

/**
 * A gable to be drawn by rule. `baseCenter` sits on the eave line; `span` is its
 * width on the facing elevation; `pitch` is rise:12.
 *
 * `projection` is how far it juts out in plan. Per the correction addendum it
 * DEFAULTS TO 0 (flush: NO side eaves / zero gutter, the eave runs straight past
 * beneath it unbroken — but the gable is still DRAWN by its ridge-back + two
 * valleys) and is only made positive when a side elevation or the roof-plan
 * footprint confirms the projection — reading
 * projection from the face view alone inflates the takeoff with side eaves that
 * often don't exist. `facing` is the outward direction (front gables face one
 * way, rear gables the other — never copy one face to the other). `intoDepth`
 * is the ridge run-back into the parent roof (default span/2).
 *
 * `setbackFt` handles a SET-BACK / dormer gable: a gable whose base sits a few
 * feet BEHIND the eave, not on it (its base reads ABOVE the eave line in the
 * elevation, because it's further up the slope). The eave keeps running with its
 * gutter in FRONT and the gable rises behind it. Defaults to 0 (base on the
 * eave — the normal case). When > 0 the whole gable is shifted inward by that
 * depth; the front eave is untouched (still guttered), so a set-back gable adds
 * ZERO gutter, exactly like a dormer. `baseCenter` stays on the eave (it's the
 * anchor / position read); `setbackFt` is how far back the gable itself sits.
 */
export type Gable = {
  baseCenter: Pt;
  span: number;
  pitch: number;
  projection: number;
  facing: Facing;
  intoDepth?: number;
  /** Depth the gable base sits BEHIND the eave (dormer / set-back gable). 0 =
   *  on the eave. The front eave stays guttered; the gable draws this far in. */
  setbackFt?: number;
  name?: string;
  eaveCondition?: EaveCondition;
  supportedOn?: SupportedOn;
  /** Which view confirmed the projection. "none" ⇒ flush by default. */
  projectionSource?: ProjectionSource;
};

/** Peak height in the elevation: (span/2) × (pitch/12). A 6:12 gable rises
 *  twice as steeply as a 4:12 for the same span (spec §1.4). */
export function gablePeakHeightFt(g: Gable): number {
  return (g.span / 2) * (g.pitch / 12);
}

/** A gable projects (juts out, gaining guttered side eaves) only when it has a
 *  positive projection depth. Zero projection ⇒ flush/roof-mounted: rakes only,
 *  eave continuous beneath, ZERO gutter contribution. */
export function isProjecting(g: Gable): boolean {
  return g.projection > 1e-6;
}

/** Input for one roof mass/tier. `eaveEdges` names which perimeter edge indices
 *  (edge i spans outline[i] → outline[i+1]) are guttered eaves; the rest are
 *  rakes. */
export type MassInput = {
  name: string;
  outline: Pt[];
  statedArea?: number | null;
  eaveEdges: number[];
  gables?: Gable[];
  overhangFt?: number;
};

/** An assembled mass: the outline plus every classified perimeter + gable edge
 *  and the generated interior lines (ridges / valleys). */
export type Mass = {
  name: string;
  outline: Pt[];
  statedArea: number | null;
  edges: Edge[];
  interior: Edge[];
};

export type FlagSeverity = "info" | "warn" | "error";
export type FlagCode =
  | "outline_open"
  | "gable_unanchored"
  | "gable_flush"
  | "gable_roof_mounted"
  | "reentrant_no_valley"
  | "area_gate"
  | "no_schedule"
  | "long_run"
  | "skeleton_rejected"
  | "gable_rake_end";

/** Structured review flag. Replaces the spec's bare strings so the UI can group
 *  by mass, filter by severity, and place `at` markers on the canvas. */
export type ReviewFlag = {
  code: FlagCode;
  severity: FlagSeverity;
  mass?: string;
  message: string;
  at?: Pt;
};

/** A continuous gutter run — a maximal chain of guttered edges that physically
 *  connect (the gutter turns outside corners). Downspouts are placed per run. */
export type EaveRun = {
  id: string;
  mass: string;
  edges: Edge[];
  lengthFt: number;
};

export type EngineDownspout = {
  mass: string;
  runId: string;
  at: Pt;
};

export type RoofTakeoff = {
  masses: Mass[];
  runs: EaveRun[];
  eaveLfByMass: Record<string, number>;
  totalEaveLf: number;
  downspouts: EngineDownspout[];
  reviewFlags: ReviewFlag[];
};

export type EngineOptions = {
  /** How close a gable base must sit to the roof edge to count as anchored. */
  anchorTolFt?: number;
  /** Area gate tolerance (fraction). Off by more than this ⇒ flag. */
  areaTolFrac?: number;
  /** Downspout spacing: one per run + one per this many feet. */
  downspoutSpacingFt?: number;
  /** Runs shorter than this share drainage and get no dedicated downspout. */
  minDownspoutRunFt?: number;
  /** A single straight guttered edge longer than this is flagged implausible. */
  maxSingleEdgeFt?: number;
  /** Pixels per foot of the input geometry. The engine's lengths/areas are in
   *  the OUTLINE's native units (pixels for a plan trace); the gates/spacing are
   *  in FEET. This converts native length → feet at every comparison. Default 1
   *  (geometry already in feet — e.g. hand-authored test masses). */
  pxPerFt?: number;
};

const DEFAULTS: Required<EngineOptions> = {
  anchorTolFt: 2.0,
  areaTolFrac: 0.15,
  downspoutSpacingFt: 40.0,
  minDownspoutRunFt: 10.0,
  maxSingleEdgeFt: 80.0,
  pxPerFt: 1.0,
};

// ── Vector / polygon helpers ───────────────────────────────────────────────

function dirVector(f: Facing): Pt {
  switch (f) {
    case "S":
      return { x: 0, y: 1 };
    case "N":
      return { x: 0, y: -1 };
    case "E":
      return { x: 1, y: 0 };
    case "W":
      return { x: -1, y: 0 };
  }
}

/** Left-perpendicular of a 2D vector. */
function perp(v: Pt): Pt {
  return { x: -v.y, y: v.x };
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Absolute polygon area (shoelace). */
export function polyArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Signed area (shoelace). >0 ⇒ counter-clockwise in a y-up frame. */
function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Do segments p1p2 and p3p4 properly intersect (share an interior point)? */
function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  return false;
}

/**
 * A ring is "simple" (non-self-intersecting) and closable when it has ≥3 finite
 * vertices and no two non-adjacent edges cross. This is the meaningful closure
 * gate — a self-crossing outline (bow-tie) is geometrically impossible for a
 * roof edge and must be flagged, not silently used.
 */
export function polygonCloses(pts: Pt[]): boolean {
  if (pts.length < 3) return false;
  if (!pts.every(finite)) return false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (they legitimately share a vertex).
      if (j === i) continue;
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/** The reentrant (reflex / inside) corners of a polygon — each requires a
 *  valley where the roof planes meet (spec §2 step 3). */
export function reentrantCorners(pts: Pt[]): Pt[] {
  if (pts.length < 4) return [];
  // Normalize to counter-clockwise so "reflex ⇔ cross < 0" holds.
  let ring = pts;
  if (signedArea(ring) < 0) ring = [...ring].reverse();
  const out: Pt[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (cross < -1e-6) out.push(b);
  }
  return out;
}

/** Distance from a point to a line segment. */
function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-12) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Min distance from a point to a polygon's boundary. */
function distPointToBoundary(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

// ── Gable-by-rule (the core of LAW 2) ──────────────────────────────────────

export type GableLines = {
  rakes: [Pt, Pt][];
  sideEaves: [Pt, Pt][];
  ridgeBack: [Pt, Pt][];
  valleys: [Pt, Pt][];
  peak: Pt;
  eaveBreak: [Pt, Pt];
  /** True when the gable juts out (has guttered side eaves). False ⇒ flush:
   *  rakes on the eave + ridge-back + valleys are still drawn, but ZERO gutter
   *  (no side eaves). Flush and projecting both DRAW; they differ in gutter. */
  projecting: boolean;
};

/**
 * Generate a gable's rakes, side eaves, ridge-back, and two valleys from its
 * span / pitch / projection. This is the deterministic replacement for asking
 * the model to "draw the gable": the model only supplies the parameters.
 *
 * PROJECTING gable ⇒ two rakes (no gutter), two side eaves (gutter, length =
 * projection), a ridge running back into the parent roof, and two valleys where
 * the gable planes meet it. FLUSH (projection 0) ⇒ the same ridge-back + two
 * valleys (so it DRAWS as a real cross-gable in plan) but NO side eaves and ZERO
 * gutter; the eave beneath is left whole by the caller. Per the correction
 * addendum, flush is the DEFAULT — only pass a positive projection when a side
 * view or the roof plan confirmed it (spec §1.4). Flush vs projecting differ in
 * gutter/eaves, NOT in whether the gable is drawn.
 */
export function buildGableByRule(g: Gable): GableLines {
  const out = dirVector(g.facing);
  const side = perp(out);
  const half = g.span / 2;
  // Set-back / dormer: shift the whole gable INWARD (away from the eave, along
  // −out) by setbackFt. The perimeter eave in front is left untouched by the
  // caller, so a set-back gable keeps its front gutter — exactly a dormer.
  // setbackFt 0 ⇒ base == baseCenter (the normal at-the-eave gable), so existing
  // behaviour is byte-identical.
  const setback = Math.max(0, g.setbackFt ?? 0);
  const base = setback > 1e-9 ? { x: g.baseCenter.x - out.x * setback, y: g.baseCenter.y - out.y * setback } : g.baseCenter;
  const left = { x: base.x - side.x * half, y: base.y - side.y * half };
  const right = { x: base.x + side.x * half, y: base.y + side.y * half };
  const peak = add(base, scale(out, g.projection));

  const lines: GableLines = {
    rakes: [],
    sideEaves: [],
    ridgeBack: [],
    valleys: [],
    peak,
    eaveBreak: [left, right],
    projecting: isProjecting(g),
  };

  if (!isProjecting(g)) {
    // A flush cross-gable carries the FULL ridge+valley plan signature, not just
    // the flat gable-end rakes. The gable-end sits on the eave (zero projection,
    // so peak == baseCenter and the rakes collapse onto the eave line), but its
    // ridge still runs back into the parent roof and its two roof planes meet the
    // main roof in a pair of valleys. Emit ridge-back AND the two valleys so the
    // gable DRAWS as a real gable in plan instead of an invisible flat edge —
    // this is what makes flush front/side gable-ends actually show.
    //
    // Still ZERO gutter (no side eaves): these are decorative interior lines,
    // priced eave LF is unchanged. With the default into = span/2, ridgeEnd is
    // the point where the two valleys converge, so they read as the correct 45°
    // valleys for equal main/cross pitches.
    lines.rakes = [
      [left, peak],
      [peak, right],
    ];
    const into = g.intoDepth ?? half;
    const ridgeEnd = { x: base.x - out.x * into, y: base.y - out.y * into };
    lines.ridgeBack = [[peak, ridgeEnd]];
    lines.valleys = [
      [left, ridgeEnd],
      [right, ridgeEnd],
    ];
    return lines;
  }

  const lp = add(left, scale(out, g.projection));
  const rp = add(right, scale(out, g.projection));
  lines.rakes = [
    [lp, peak],
    [peak, rp],
  ];
  lines.sideEaves = [
    [left, lp],
    [right, rp],
  ];
  const into = g.intoDepth ?? half;
  const ridgeEnd = { x: base.x - out.x * into, y: base.y - out.y * into };
  lines.ridgeBack = [[peak, ridgeEnd]];
  lines.valleys = [
    [left, ridgeEnd],
    [right, ridgeEnd],
  ];
  return lines;
}

// ── Mass assembly + gates ──────────────────────────────────────────────────

const edgeLen = (e: Edge): number => dist(e.p1, e.p2);

/**
 * Assemble one mass: classify its perimeter edges, generate every gable's edges
 * + interior lines by rule, and append gate flags (unanchored gable,
 * roof-mounted note, reentrant-corner-without-valley) to `flags`.
 */
/**
 * Deterministic roof primitive for a NEAR-RECTANGULAR mass. On a simple
 * rectangle the correct skeleton is not a search problem — it is a rule:
 * the RIDGE runs parallel to the opposite EAVE pair, flush out to each
 * RAKE (gable) end, inset by half-depth with two HIPS at each EAVE end.
 * Using this instead of the offset-simulation straight skeleton kills the
 * degenerate "pyramid / long diagonal hips across the roof" failure on the
 * masses tier decomposition produces (which are near-rect by construction).
 * Returns null for articulated outlines (those keep the straight skeleton).
 */
export function rectPrimitiveSkeleton(
  outline: readonly Pt[],
  eaveSet: ReadonlySet<number>,
): { ridges: [Pt, Pt][]; hips: [Pt, Pt][] } | null {
  const n = outline.length;
  if (n < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of outline) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const W = x1 - x0, H = y1 - y0;
  if (!(W > 0) || !(H > 0)) return null;
  // Near-rectangular only — an articulated mass keeps the straight skeleton
  // (its jog valleys are exactly what the offset simulation is FOR).
  if (Math.abs(polyArea([...outline])) / (W * H) < 0.82) return null;
  const tol = Math.max(2, Math.max(W, H) * 0.02);
  // Guttered fraction of the boundary along each bbox side.
  const gut = { top: 0, bottom: 0, left: 0, right: 0 };
  const tot = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l <= 0) continue;
    const g = eaveSet.has(i) ? l : 0;
    if (Math.abs(a.y - y0) <= tol && Math.abs(b.y - y0) <= tol) { tot.top += l; gut.top += g; }
    else if (Math.abs(a.y - y1) <= tol && Math.abs(b.y - y1) <= tol) { tot.bottom += l; gut.bottom += g; }
    else if (Math.abs(a.x - x0) <= tol && Math.abs(b.x - x0) <= tol) { tot.left += l; gut.left += g; }
    else if (Math.abs(a.x - x1) <= tol && Math.abs(b.x - x1) <= tol) { tot.right += l; gut.right += g; }
  }
  const isEave = (s: keyof typeof gut) => tot[s] > 0 && gut[s] / tot[s] >= 0.5;
  const T = isEave("top"), B = isEave("bottom"), L = isEave("left"), R = isEave("right");
  const horiz = T && B, vert = L && R;
  let axis: "h" | "v" | null = null;
  if (horiz && vert) axis = W >= H ? "h" : "v"; // full hip — ridge on the long axis
  else if (horiz) axis = "h";
  else if (vert) axis = "v";
  if (!axis) return null; // no opposite eave pair — not a simple gable/hip form
  const ridges: [Pt, Pt][] = [];
  const hips: [Pt, Pt][] = [];
  if (axis === "h") {
    const ym = (y0 + y1) / 2, half = H / 2;
    let xs = L ? x0 + half : x0; // eave end → hips inset; rake end → ridge to the wall
    let xe = R ? x1 - half : x1;
    if (xe < xs) xs = xe = (x0 + x1) / 2; // near-square pyramid: hips meet centre
    if (xe > xs) ridges.push([{ x: xs, y: ym }, { x: xe, y: ym }]);
    if (L) hips.push([{ x: xs, y: ym }, { x: x0, y: y0 }], [{ x: xs, y: ym }, { x: x0, y: y1 }]);
    if (R) hips.push([{ x: xe, y: ym }, { x: x1, y: y0 }], [{ x: xe, y: ym }, { x: x1, y: y1 }]);
  } else {
    const xm = (x0 + x1) / 2, half = W / 2;
    let ys = T ? y0 + half : y0;
    let ye = B ? y1 - half : y1;
    if (ye < ys) ys = ye = (y0 + y1) / 2;
    if (ye > ys) ridges.push([{ x: xm, y: ys }, { x: xm, y: ye }]);
    if (T) hips.push([{ x: xm, y: ys }, { x: x0, y: y0 }], [{ x: xm, y: ys }, { x: x1, y: y0 }]);
    if (B) hips.push([{ x: xm, y: ye }, { x: x0, y: y1 }], [{ x: xm, y: ye }, { x: x1, y: y1 }]);
  }
  return { ridges, hips };
}

export function assembleMass(input: MassInput, flags: ReviewFlag[], opts: Required<EngineOptions>): Mass {
  const { name, outline } = input;
  const mass: Mass = { name, outline, statedArea: input.statedArea ?? null, edges: [], interior: [] };

  if (!polygonCloses(outline)) {
    flags.push({
      code: "outline_open",
      severity: "error",
      mass: name,
      message: `[${name}] outline does not close / self-intersects — review before pricing.`,
    });
    return mass;
  }

  const eaveSet = new Set(input.eaveEdges);
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (eaveSet.has(i)) {
      mass.edges.push({ p1: a, p2: b, type: "eave", gutter: true, source: "elevation" });
    } else {
      mass.edges.push({ p1: a, p2: b, type: "rake", gutter: false, source: "elevation" });
    }
  }

  // Nearest outline edge to a point — used to tell which wall a gable base
  // actually sits on (eave vs rake/gable-end).
  const nearestEdgeIdx = (p: Pt): number => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  };

  for (const g of input.gables ?? []) {
    const gname = g.name ?? "gable";

    // A FLUSH gable whose base sits on a RAKE edge is the mass's GABLE END —
    // that end is already drawn by its rake edges plus the ridge running out to
    // it (rectPrimitiveSkeleton holds rake ends flush). Drawing a default-span
    // stub there paints a floating mini-triangle mid-wall (the "tiny side
    // gable" artifact on side reads with span_ft null). Depict it by the end
    // itself; suppress the stub. Projecting gables still draw (a real pop-out
    // on a gable-end side is possible, if rare).
    const baseEdge = nearestEdgeIdx(g.baseCenter);
    if (!isProjecting(g) && baseEdge >= 0 && !eaveSet.has(baseEdge)) {
      flags.push({
        code: "gable_rake_end",
        severity: "info",
        mass: name,
        at: g.baseCenter,
        message: `[${name}] gable '${gname}' sits on a rake/gable-END wall — the end is already drawn by its rakes + the ridge running to it; suppressed the duplicate stub (zero gutter either way).`,
      });
      continue;
    }

    const d = distPointToBoundary(g.baseCenter, outline);
    if (d / opts.pxPerFt > opts.anchorTolFt) {
      flags.push({
        code: "gable_unanchored",
        severity: "error",
        mass: name,
        at: g.baseCenter,
        message: `[${name}] gable '${gname}' base is ${d.toFixed(1)} ft off the roof edge — NOT anchored to an eave. A gable cannot float mid-plane; re-read.`,
      });
    }

    const L = buildGableByRule(g);
    for (const [p1, p2] of L.sideEaves)
      mass.edges.push({ p1, p2, type: "eave", gutter: true, source: `gable:${gname}` });
    for (const [p1, p2] of L.rakes)
      mass.edges.push({ p1, p2, type: "rake", gutter: false, source: `gable:${gname}` });
    for (const [p1, p2] of L.ridgeBack)
      mass.interior.push({ p1, p2, type: "ridge", gutter: false, source: `gable:${gname}` });
    for (const [p1, p2] of L.valleys)
      mass.interior.push({ p1, p2, type: "valley", gutter: false, source: `gable:${gname}` });

    if (!L.projecting) {
      // Zero projection: rakes only, eave continuous beneath, ZERO gutter. Per
      // the correction addendum this is the EXPECTED default (flush), not an
      // error. A roof-mounted dormer is called out separately so it can be
      // re-checked against the side elevation; a flush gable-end is just noted.
      if (g.eaveCondition === "roof_mounted") {
        flags.push({
          code: "gable_roof_mounted",
          severity: "info",
          mass: name,
          at: g.baseCenter,
          message: `[${name}] gable '${gname}' is roof-mounted: rakes only, the eave runs whole beneath it. Confirm the eave continues past it on the roof plan.`,
        });
      } else {
        flags.push({
          code: "gable_flush",
          severity: "info",
          mass: name,
          at: g.baseCenter,
          message: `[${name}] gable '${gname}' read as flush (drawn with its ridge + valleys but NO side eaves — contributes zero gutter); the eave runs straight past beneath it. If a side elevation or the roof plan shows it projecting, set projection = depth to add its side eaves.`,
        });
      }
    }
  }

  // Main-roof skeleton — the exact straight-skeleton of the outline (equal-slope
  // inward offset): converging hips, ridges, and valleys at reentrant corners,
  // gable ends held stationary. DECORATIVE ONLY — pushed to `interior`, never to
  // `edges`, so the priced eave LF is provably unchanged. Returns EMPTY (nothing
  // added) on a non-rectilinear/degenerate footprint, so the caller degrades to
  // its own skeleton rather than drawing junk.
  {
    // NEAR-RECT masses (what tier decomposition produces) get the deterministic
    // primitive — ridge parallel to the eave pair, flush to rake/gable ends,
    // hips only at eave ends. Always geometrically correct; no offset
    // simulation to degenerate into a pyramid / long diagonals.
    const prim = rectPrimitiveSkeleton(outline, eaveSet);
    if (prim) {
      for (const [p1, p2] of prim.hips) mass.interior.push({ p1, p2, type: "hip", gutter: false, source: "skeleton" });
      for (const [p1, p2] of prim.ridges) mass.interior.push({ p1, p2, type: "ridge", gutter: false, source: "skeleton" });
    } else {
    const eaveSegments: [Pt, Pt][] = [];
    const rakeSegments: [Pt, Pt][] = [];
    for (let i = 0; i < n; i++) {
      const seg: [Pt, Pt] = [outline[i], outline[(i + 1) % n]];
      (eaveSet.has(i) ? eaveSegments : rakeSegments).push(seg);
    }
    const skel = deriveRoofSkeletonStraight(outline, { eaveSegments, rakeSegments });
    // Gate BEFORE drawing. deriveRoofSkeletonStraight can degenerate into a
    // centroid-FAN — every hip/ridge/valley converging on one apex, a pyramid
    // not a real hip topology. TWO rejects:
    //   1. validateSkeleton — hub-degree / ridge-length heuristics.
    //   2. A straight skeleton MUST valley at every REENTRANT (inside) corner of
    //      the outline. If a real jog is left without a valley, the skeleton is
    //      geometrically inconsistent with its own footprint — this is the
    //      Woodinville garage-jog fan that validateSkeleton alone misses (its
    //      ridge-spokes fool the ridge-length check). Reliable now that the gate
    //      compares in FEET (pxPerFt), not pixels.
    // On reject: draw NO main skeleton + a flag, and the consumer falls back to
    // the grid skeleton (a clean hip) — never a line that goes nowhere.
    const skelValleyPts = skel.valleys.flatMap((l) => [l.points[0], l.points[1]]);
    const reentrantsCovered = reentrantCorners(outline).every((c) =>
      skelValleyPts.some((vp) => dist(c, vp) / opts.pxPerFt <= opts.anchorTolFt),
    );
    if (validateSkeleton(skel, outline) && reentrantsCovered) {
      for (const l of skel.hips) mass.interior.push({ p1: l.points[0], p2: l.points[1], type: "hip", gutter: false, source: "skeleton" });
      for (const l of skel.ridges) mass.interior.push({ p1: l.points[0], p2: l.points[1], type: "ridge", gutter: false, source: "skeleton" });
      for (const l of skel.valleys) mass.interior.push({ p1: l.points[0], p2: l.points[1], type: "valley", gutter: false, source: "skeleton" });
    } else {
      flags.push({
        code: "skeleton_rejected",
        severity: "warn",
        mass: name,
        message: `[${name}] main-roof skeleton rejected — ${
          reentrantsCovered ? "degenerate centroid-fan" : "leaves a reentrant (jog) corner with no valley"
        }, not a real hip topology. Interior lines omitted (the consumer falls back to the grid skeleton); the true topology needs tier decomposition.`,
      });
    }
    }
  }

  // Long-run gate: an implausibly long single guttered edge is usually a scale
  // misread (spec §2 gates).
  for (const e of mass.edges) {
    if (e.gutter && edgeLen(e) / opts.pxPerFt > opts.maxSingleEdgeFt) {
      flags.push({
        code: "long_run",
        severity: "warn",
        mass: name,
        message: `[${name}] a single guttered edge is ${(edgeLen(e) / opts.pxPerFt).toFixed(0)} ft (> ${opts.maxSingleEdgeFt} ft) — verify the scale / a missed corner.`,
      });
    }
  }

  return mass;
}

/**
 * Area gate — the spec's explicit FIRST thing to build. Compares a mass's
 * computed polygon area to a stated schedule area and flags a mismatch beyond
 * tolerance, so you learn WHICH mass the reader botched before anything else.
 * A mass with no stated area gets a `no_schedule` info flag (honest: we can't
 * cross-check it), never a false failure.
 */
export function areaGate(mass: Mass, flags: ReviewFlag[], opts: Required<EngineOptions>): void {
  if (mass.statedArea == null || !(mass.statedArea > 0)) {
    flags.push({
      code: "no_schedule",
      severity: "info",
      mass: mass.name,
      message: `[${mass.name}] no stated schedule area to cross-check — computed ${(polyArea(mass.outline) / (opts.pxPerFt * opts.pxPerFt)).toFixed(0)} sf stands unverified.`,
    });
    return;
  }
  const computed = polyArea(mass.outline) / (opts.pxPerFt * opts.pxPerFt);
  const diff = Math.abs(computed - mass.statedArea) / mass.statedArea;
  const over = diff > opts.areaTolFrac;
  flags.push({
    code: "area_gate",
    severity: over ? "warn" : "info",
    mass: mass.name,
    message:
      `[${mass.name}] area gate: computed ${computed.toFixed(0)} sf vs stated ${mass.statedArea.toFixed(0)} sf ` +
      `(${(diff * 100).toFixed(1)}% off) — ${over ? "FLAG (a plane or gable may be missing)" : "OK"}.`,
  });
}

// ── Continuous runs + rule-based downspouts + takeoff ──────────────────────

/** Group a mass's guttered edges into continuous runs (edges that share an
 *  endpoint — the gutter turns the corner). Rakes break a run. */
export function continuousEaveRuns(mass: Mass, tol = 0.5): EaveRun[] {
  const gutters = mass.edges.filter((e) => e.gutter);
  const parent = gutters.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };
  const shares = (a: Edge, b: Edge): boolean =>
    dist(a.p1, b.p1) <= tol ||
    dist(a.p1, b.p2) <= tol ||
    dist(a.p2, b.p1) <= tol ||
    dist(a.p2, b.p2) <= tol;
  for (let i = 0; i < gutters.length; i++)
    for (let j = i + 1; j < gutters.length; j++) if (shares(gutters[i], gutters[j])) union(i, j);

  const groups = new Map<number, Edge[]>();
  gutters.forEach((e, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(e);
  });

  const runs: EaveRun[] = [];
  let k = 0;
  for (const edges of groups.values()) {
    const lengthFt = edges.reduce((s, e) => s + edgeLen(e), 0);
    runs.push({ id: `${mass.name}-run-${k++}`, mass: mass.name, edges, lengthFt: round1(lengthFt) });
  }
  return runs;
}

/** Downspouts on one run: one per run + one per spacing interval; runs shorter
 *  than `minDownspoutRunFt` share drainage and get none. */
function downspoutsForRun(run: EaveRun, opts: Required<EngineOptions>): EngineDownspout[] {
  // run.lengthFt is in the geometry's NATIVE units (pixels for a plan trace);
  // convert to real feet before applying the ft-based spacing / minimum.
  const runFt = run.lengthFt / opts.pxPerFt;
  if (runFt < opts.minDownspoutRunFt) return [];
  const k = Math.max(1, Math.ceil(runFt / opts.downspoutSpacingFt));
  // Place each downspout at the midpoint of one of the run's longest edges,
  // cycling — deterministic, and near where a real drop would land.
  const byLen = [...run.edges].sort((a, b) => edgeLen(b) - edgeLen(a));
  const out: EngineDownspout[] = [];
  for (let i = 0; i < k; i++) {
    const e = byLen[i % byLen.length];
    out.push({ mass: run.mass, runId: run.id, at: { x: (e.p1.x + e.p2.x) / 2, y: (e.p1.y + e.p2.y) / 2 } });
  }
  return out;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The full takeoff: eave LF per mass (sum of guttered edges), continuous runs,
 * and rule-based downspouts. Flags accumulated by assembly / gates are carried
 * through unchanged.
 */
export function computeTakeoff(masses: Mass[], flags: ReviewFlag[], opts: Required<EngineOptions>): RoofTakeoff {
  const eaveLfByMass: Record<string, number> = {};
  const runs: EaveRun[] = [];
  const downspouts: EngineDownspout[] = [];
  for (const m of masses) {
    const lf = m.edges.filter((e) => e.gutter).reduce((s, e) => s + edgeLen(e), 0);
    eaveLfByMass[m.name] = round1(lf);
    const massRuns = continuousEaveRuns(m);
    runs.push(...massRuns);
    for (const r of massRuns) downspouts.push(...downspoutsForRun(r, opts));
  }
  const totalEaveLf = round1(Object.values(eaveLfByMass).reduce((s, v) => s + v, 0));
  return { masses, runs, eaveLfByMass, totalEaveLf, downspouts, reviewFlags: flags };
}

/**
 * Top-level entry: assemble every mass, run the area gate on each, and compute
 * the takeoff. This is what the pipeline calls after the vision read.
 */
export function runRoofEngine(inputs: MassInput[], options: EngineOptions = {}): RoofTakeoff {
  const opts = { ...DEFAULTS, ...options };
  const flags: ReviewFlag[] = [];
  const masses = inputs.map((inp) => {
    const m = assembleMass(inp, flags, opts);
    areaGate(m, flags, opts);
    return m;
  });
  return computeTakeoff(masses, flags, opts);
}
