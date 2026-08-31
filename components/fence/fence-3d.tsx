"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import { MAX_STEP_DROP_FT, rackingLimitFt, WALL_RISE_FT } from "@/lib/fence/slope";
import {
  CANVAS_H,
  CANVAS_W,
  runDistanceModel,
  type RunElevationModel,
} from "@/lib/fence/geo";
import { buildContours } from "@/lib/fence/contours";
import {
  DEFAULT_SQUASH,
  DEFAULT_YAW_DEG,
  SQUASH_MAX,
  SQUASH_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  easeInOut,
  lerpView,
  lerpZoom,
  type Fence3DView,
  type Fence3DZoom,
  type FenceInteraction,
  type FenceShot,
} from "@/lib/fence/viewpoints";

/**
 * Fence3D — a to-scale preview of the drawn fence, hand-rolled in SVG
 * (no 3D library: deterministic, fast, prints cleanly in the proposal
 * PDF and the client portal).
 *
 * One WORLD model (fence faces, terrain cells, trees — all in plan px +
 * height px), two cameras:
 *  - ORBIT: axonometric bird's-eye. Drag spins/tilts, wheel or pinch zooms
 *    toward the cursor, double-click zooms a spot.
 *  - WALK: click any spot on the ground to stand there — a simple
 *    first-person perspective renderer. WASD/arrows walk & turn, drag
 *    looks around, Esc (or the chip) exits.
 * The ground renders as a slope-shaded lawn with natural tone variation
 * and decorative trees outside the fence; big lots are vertically
 * softened past 5× the fence height so hillsides stay readable.
 */

type Pt = { x: number; y: number };
type V3 = { x: number; y: number; z: number };

/** Gates from the estimator carry kind/widthFt; proposal takeoffs carry
 *  gateKind/gateWidthFt on downspouts; legacy blobs carry only x/y. */
type GateIn = Pt & {
  kind?: "single" | "double" | "custom";
  widthFt?: number;
  gateKind?: "single" | "double" | "custom";
  gateWidthFt?: number;
};

const VIEW_W = 900;
const VIEW_H = 560;
const HEIGHT_EXAGGERATION = 1.3; // readability: fences are long + short
/** Posts render at TRUE stock width so a 1⅝″ chain-link pipe can't be
 *  mistaken for a 5×5 vinyl post — with a small uniform gain (ratios
 *  preserved) and a floor, or thin pipe would vanish on a big lot. */
const POST_GAIN = 1.5;
const POST_MIN_PX = 0.7;
const GATE_SNAP_PX = 30; // gates farther than this from every run are ignored
const EYE_FT = 5.5; // walk-mode eye height
const WALK_FT_PER_S = 16;
const TURN_RAD_PER_S = 2.0;
const FOCAL = 640; // walk-mode focal length, screen px
const NEAR_PX = 4; // walk-mode near plane, plan px

/** Re-exported so existing importers (estimator, proposal, portal)
 *  keep working now that the camera model lives in lib/fence/viewpoints
 *  alongside the saved-shot logic. */
export type { Fence3DView, Fence3DZoom } from "@/lib/fence/viewpoints";

type WFace = {
  kind: "panel" | "gate" | "post" | "skirt" | "wall" | "ground" | "tree" | "bwall" | "roof" | "shadow" | "contour";
  /** World corners (plan x/y in canvas px, z up in screen px). Trees
   *  store [base, top]. */
  pts: V3[];
  /** Painter bias: negative draws earlier among coplanar faces. */
  bias: number;
  shaded: boolean;
  baseLenPx: number;
  leaves?: 1 | 2;
  heavy?: boolean;
  fill?: string;
  /** Trees: canopy tone index. */
  tone?: number;
  /** Panels inside a mixed-type section render as THAT fence. */
  alt?: { cat: string; rails: number; cap: boolean; id?: string };
  /** Posts: true for the second (perpendicular) quad of the cross. */
  sub?: boolean;
  /** Panels: nominal height in feet (drives horizontal-board counts). */
  hFt?: number;
  /** Posts: round stock (chain-link pipe, split-rail cedar) shades as a
   *  cylinder; square stock (4×4, vinyl 5×5, ornamental tube) as a box. */
  round?: boolean;
  /** Posts: terminal (corner / end / gate) stock — heavier on every
   *  system, and the one that carries chain-link fabric tension. */
  term?: boolean;
  /** Post caps: the shape actually sold for this system. */
  cap?: "flat" | "pyramid" | "gothic" | "dome" | "loop";
  /** Posts: which fence type's stock stands here — so a chain-link span
   *  inside a cedar job gets galvanized pipe, not a brown 4×4. */
  tid?: string;
  /** Contours: a major line (heavier stroke, gets the elevation label). */
  major?: boolean;
};

type WLabel = { anchor: V3; text: string };

type ProjFace = {
  face: WFace;
  poly: Pt[];
  /** True when the projection kept the original 4 corners (details safe). */
  isQuad: boolean;
  depth: number;
};

type FStyle = {
  face: string;
  shade: string;
  post: string;
  stroke: string;
  lines?: "pickets" | "bars" | "mesh" | "rails";
  /** Chain link: the woven fabric and the framework it hangs on. */
  mesh?: string;
  rail?: string;
};

const STYLES: Record<string, FStyle> = {
  // Cedar with a real stain depth — the face carries amber warmth, the
  // shade side drops a full value step (weak sun/shade delta is what
  // makes wood render like cardboard), and posts sit darker than the
  // boards so the structure anchors the panel run.
  wood: { face: "#B87E42", shade: "#875A2B", post: "#6E4B26", stroke: "#4A3115", lines: "pickets" },
  vinyl: { face: "#F4F4EE", shade: "#DDDDD4", post: "#E9E9E2", stroke: "#9C9C92" },
  // Chain link is a SCREEN, not a wall — the yard has to show through it.
  "chain-link": { face: "rgba(148,158,166,0.17)", shade: "rgba(120,130,138,0.22)", post: "#8B9298", stroke: "#6E767D", lines: "mesh", mesh: "rgba(88,98,106,0.46)", rail: "#9AA3AA" },
  // Ornamental is mostly air: the face tone is a hint of plane, and the
  // pickets themselves are what you actually see.
  aluminum: { face: "rgba(38,42,48,0.10)", shade: "rgba(30,33,38,0.16)", post: "#1E2126", stroke: "#2B2F35", lines: "bars" },
  steel: { face: "rgba(32,36,40,0.12)", shade: "rgba(26,29,33,0.18)", post: "#1A1D21", stroke: "#23272C", lines: "bars" },
  "split-rail": { face: "#B2854E", shade: "#8E6739", post: "#75512C", stroke: "#553B1D", lines: "rails" },
};

/** Per-TYPE overrides, for categories that ship in more than one finish.
 *  Black vinyl-coated chain link is a different fence to look at than
 *  galvanized even though the framework underneath is identical. */
const TYPE_STYLE: Record<string, Partial<FStyle>> = {
  "chain-link-black": {
    face: "rgba(34,40,44,0.16)",
    shade: "rgba(24,29,32,0.22)",
    post: "#2C3236",
    stroke: "#16191B",
    mesh: "rgba(26,31,34,0.52)",
    rail: "#3B4247",
  },
};

function styleOf(t: { id: string; category: string }): FStyle {
  const base = STYLES[t.category] ?? STYLES.wood;
  const over = TYPE_STYLE[t.id];
  return over ? { ...base, ...over } : base;
}

/** Wood/vinyl subtypes that build differently get their own detail
 *  pass — so a shadowbox reads as a shadowbox, not generic "wood". */
const TYPE_DETAIL: Record<string, "hboards" | "spaced" | "shadowbox" | "bob"> = {
  "horizontal-modern": "hboards",
  "wood-picket": "spaced",
  "vinyl-picket": "spaced",
  shadowbox: "shadowbox",
  "board-on-board": "bob",
};

const TREE_TONES = [
  ["#5C7A4C", "#49623C"],
  ["#67824F", "#536D42"],
  ["#4F6E48", "#40593A"],
];

function cumLengths(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
}

function pointAt(pts: Pt[], cum: number[], d: number): Pt {
  const total = cum[cum.length - 1];
  if (d <= 0) return pts[0];
  if (d >= total) return pts[pts.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const span = cum[i] - cum[i - 1];
  const s = span > 0 ? (d - cum[i - 1]) / span : 0;
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * s,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * s,
  };
}

function nearestOnPolyline(p: Pt, pts: Pt[], cum: number[]): { dist: number; perp: number } {
  let best = { dist: 0, perp: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.25) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const perp = Math.hypot(p.x - q.x, p.y - q.y);
    if (perp < best.perp) {
      best = { dist: cum[i - 1] + Math.sqrt(len2) * t, perp };
    }
  }
  return best;
}

const fmtFt = (w: number) => `${Math.round(w * 10) / 10}`;

/**
 * String-line a fence profile. Crews stretch a line between grade
 * breaks and build the rails STRAIGHT to it — post lengths absorb the
 * dips. Draping every bay on the exact dirt under it made the top rail
 * wave with each terrain ripple and the whole fence read as "curved".
 * Douglas-Peucker over the (distance, z) profile keeps genuine grade
 * breaks (> tolerance) and flattens everything between them; values
 * return per input index, interpolated along the kept breaks.
 */
function stringLineProfile(ds: number[], zs: number[], tolPx: number): number[] {
  const n = ds.length;
  if (n <= 2) return zs.slice();
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 < 2) continue;
    const dx = ds[i1] - ds[i0];
    let worst = -1;
    let worstDev = tolPx;
    for (let i = i0 + 1; i < i1; i++) {
      const t = dx > 0 ? (ds[i] - ds[i0]) / dx : 0;
      const dev = Math.abs(zs[i] - (zs[i0] + (zs[i1] - zs[i0]) * t));
      if (dev > worstDev) {
        worstDev = dev;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  const out = new Array<number>(n);
  let prev = 0;
  out[0] = zs[0];
  for (let i = 1; i < n; i++) {
    if (!keep[i]) continue;
    for (let j = prev + 1; j <= i; j++) {
      const t = ds[i] > ds[prev] ? (ds[j] - ds[prev]) / (ds[i] - ds[prev]) : 1;
      out[j] = zs[prev] + (zs[i] - zs[prev]) * t;
    }
    prev = i;
  }
  return out;
}

/** Deterministic 0..1 hash — grass tone jitter + tree placement. */
function hash2(r: number, c: number): number {
  const n = Math.sin(r * 127.1 + c * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth 2D value noise (0..1) — LARGE soft patches of tone so the
 *  lawn reads as grass, not per-tile pixels. ~150 px patch size. */
function smoothNoise(x: number, y: number): number {
  const gx = x / 150;
  const gy = y / 150;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return (
    hash2(x0, y0) * (1 - sx) * (1 - sy) +
    hash2(x0 + 1, y0) * sx * (1 - sy) +
    hash2(x0, y0 + 1) * (1 - sx) * sy +
    hash2(x0 + 1, y0 + 1) * sx * sy
  );
}

/** Ray-cast point-in-polygon (trees must stay out of buildings). */
function pointInPoly(p: Pt, ring: Pt[]): boolean {
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

/**
 * Ground color for a terrain cell — drawn like land, not a lawn chart:
 *  - a natural sage/olive ramp by ELEVATION (deep valley green → dry
 *    crest), fading in only when the lot has real relief;
 *  - warm/cool DIRECTIONAL light: sun-facing cells warm toward yellow-
 *    green, shadow faces cool toward blue-gray — the classic terrain-
 *    painting trick that makes relief read as light, not as banding;
 *  - steep faces blend toward EARTH: grass thins where the ground
 *    stands up, so slope magnitude pulls in a soil tone;
 *  - cells OUTSIDE the parcel wash out toward pale gray-green, so the
 *    property itself reads as the subject and the neighbors as context
 *    — the way a site plan presents it;
 *  - large soft noise so it still reads as ground cover.
 */
function groundFill(
  e01: number,
  gxFt: number,
  gyFt: number,
  jitter: number,
  hypso: number,
  /** 1 = on the property, 0 = far outside; fractional near the line. */
  inParcel: number,
): string {
  const LO = [104, 142, 96]; // valley sage
  const MID = [149, 176, 126]; // mid lawn
  const HI = [186, 194, 146]; // dry crest
  const EARTH = [148, 134, 102]; // steep-face soil
  const t = Math.max(0, Math.min(1, e01));
  let c =
    t < 0.5
      ? LO.map((v, i) => v + (MID[i] - v) * (t / 0.5))
      : MID.map((v, i) => v + (HI[i] - v) * ((t - 0.5) / 0.5));
  c = c.map((v, i) => MID[i] + (v - MID[i]) * hypso);
  // Steep ground → earth. Grade in ft/plan-px; ~0.35 ≈ very steep.
  const slopeMag = Math.hypot(gxFt, gyFt);
  const earth = Math.max(0, Math.min(0.55, (slopeMag - 0.1) * 2.2));
  c = c.map((v, i) => v + (EARTH[i] - v) * earth);
  // Warm light from the NW, cool shade opposite. The amplitude is the
  // whole ballgame on a rolling lot: too timid and a hump doesn't read
  // as a hump, which is what makes a straight fence crossing it look
  // like a BENT fence. Sun-facing slopes lift hard, away-facing drop.
  const lit = Math.tanh((-gxFt * 2.4 + gyFt * 1.2) * 1.9);
  const bright = 1 + 0.27 * lit;
  c = [
    c[0] * bright * (1 + 0.06 * lit),
    c[1] * bright * (1 + 0.02 * lit),
    c[2] * bright * (1 - 0.06 * lit),
  ];
  // Sky light: flat ground sees the whole dome and picks up its cool
  // cast, steep faces see a slice of it. Pairs with the warm sun above
  // to give the surface two light sources, the way real land is lit.
  const flat = 1 - Math.min(1, slopeMag * 3.2);
  c = [c[0] + (150 - c[0]) * 0.05 * flat, c[1] + (168 - c[1]) * 0.05 * flat, c[2] + (188 - c[2]) * 0.11 * flat];
  // Off-parcel context washes out — brighter, grayer, quieter. `inParcel`
  // is a 0..1 fade (1 on the property), so the wash rolls in smoothly
  // instead of stair-stepping cell by cell along the boundary.
  const wash = 1 - Math.max(0, Math.min(1, inParcel));
  if (wash > 0) {
    const gray = (c[0] + c[1] + c[2]) / 3;
    c = c.map((v) => (v + (gray - v) * 0.42 * wash) * (1 + 0.06 * wash) + 14 * wash);
  }
  const n = 0.955 + jitter * 0.09;
  const px = c.map((v) => Math.round(Math.max(0, Math.min(255, v * n))));
  return `rgb(${px[0]},${px[1]},${px[2]})`;
}

let sessionDragMode: "move" | "spin" = "move";

export function Fence3D({
  runs,
  gates,
  heightFt,
  typeId = "cedar-privacy",
  pxPerFt,
  parcelRings = [],
  runElevationsFt,
  elevationSpacingPx,
  topoGridFt = null,
  buildings = null,
  sections = null,
  retainingWall = false,
  postUpgrade,
  postSpacingFt,
  initialView,
  onViewChange,
  shots,
  activeShotId,
  onActiveShotChange,
  interaction = "free",
  onCapture,
  className,
}: {
  /** Fence runs in canvas space ({points} is all that's read). */
  runs: { points: Pt[] }[];
  /** Gate markers sitting on runs (canvas space). */
  gates: GateIn[];
  heightFt: number;
  typeId?: string;
  pxPerFt?: number;
  parcelRings?: Pt[][];
  /** Measured ground elevations (ft) per run, walk-sampled at the post
   *  spacing — same order as `runs`. Absent/misaligned ⇒ flat ground. */
  runElevationsFt?: number[][];
  /** Walk spacing the elevations were sampled at (canvas px). Defaults
   *  to this fence type's post spacing — pass it when the rendered type
   *  may differ from the type that was active when sampling. */
  elevationSpacingPx?: number;
  /** The scan's topo lattice (rows × cols of ft, spanning the full
   *  900×580 canvas). When present the yard renders as a shaded terrain
   *  surface and the fence grounds on it. */
  topoGridFt?: number[][] | null;
  /** Building footprints (canvas coords) — extruded as simple houses so
   *  the client sees the home the fence connects to. */
  buildings?: Pt[][] | null;
  /** Mixed-type stretches: from-here-to-here spans of a run built as a
   *  different fence — rendered with that type's material + height. */
  sections?: { a: Pt; b: Pt; type: string }[] | null;
  /** Contractor confirmed the fence mounts on a retaining wall: sheer
   *  drops render as a masonry wall face with the fence anchored on top
   *  (instead of an earth bank), and get a summary chip. */
  retainingWall?: boolean;
  /** Post stock: steel renders gray galvanized posts, 6×6 renders
   *  visibly heavier posts. */
  postUpgrade?: "steel" | "6x6";
  /** Line-post spacing override, ft o.c. — panel builds keep their
   *  prefab section width regardless. */
  postSpacingFt?: number;
  /** Starting camera (yaw + tilt). The contractor's saved angle becomes
   *  the client's opening view; both can drag to orbit from there. */
  initialView?: Fence3DView;
  /** Fires when the user releases a drag — the estimator stores the
   *  angle so "Build the proposal" freezes it as the client's view. */
  onViewChange?: (v: Fence3DView) => void;
  /** Saved camera positions the contractor froze onto the proposal.
   *  Rendered as a strip the viewer can step through; the camera FLIES
   *  to the tapped shot rather than cutting, so the client keeps their
   *  bearings on which side of the yard they're looking at. */
  shots?: FenceShot[];
  /** Which shot is currently framed (controlled). */
  activeShotId?: string | null;
  onActiveShotChange?: (id: string) => void;
  /** How much camera freedom the viewer gets — see lib/fence/viewpoints.
   *  "free" spins, "guided" allows saved shots only, "locked" is a
   *  fixed image with no controls at all. */
  interaction?: FenceInteraction;
  /** Provided in builder mode: renders "Save this angle", handing back
   *  the live camera INCLUDING zoom so a framed close-up survives. */
  onCapture?: (view: Fence3DView, zoom: Fence3DZoom | null) => void;
  className?: string;
}) {
  const [view, setView] = useState<Fence3DView>({
    yawDeg: initialView?.yawDeg ?? DEFAULT_YAW_DEG,
    squash: Math.min(
      SQUASH_MAX,
      Math.max(SQUASH_MIN, initialView?.squash ?? DEFAULT_SQUASH),
    ),
  });
  // "locked" hides every control and ignores every gesture; "guided"
  // keeps the saved-shot strip but takes away free spin and walk mode.
  const canOrbit = interaction === "free";
  const canWalk = interaction === "free";
  // Screen zoom over the orbit view: screen = world*k + t (an SVG group
  // transform, so zooming never rebuilds the scene).
  const [zoomCam, setZoomCam] = useState({ k: 1, tx: 0, ty: 0 });
  // What a PLAIN drag does. "move" pans the scene (what everyone tries
  // first — the old spin-only camera felt nailed to the center); "spin"
  // orbits. Shift or middle-drag always does the OTHER one, so both
  // gestures are permanently reachable. Remembered per session.
  const [dragMode, setDragMode] = useState<"move" | "spin">(
    () => sessionDragMode,
  );
  const dragModeRef = useRef(dragMode);
  dragModeRef.current = dragMode;
  const pickDragMode = (m: "move" | "spin") => {
    sessionDragMode = m;
    setDragMode(m);
  };
  const [mode, setMode] = useState<"orbit" | "walk">("orbit");
  const [walkCam, setWalkCam] = useState({ x: 450, y: 300, heading: 0, pitch: 0 });

  const svgRef = useRef<SVGSVGElement | null>(null);
  // Overlay sizing follows the CANVAS, not the viewport: the portal
  // embeds this in a narrow column where full-size touch pills + hint +
  // shot strip + summary chips stacked into rows and buried the yard.
  const [uiW, setUiW] = useState(900);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) setUiW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compactUi = uiW < 560;
  /** Overlay pill sizing: compact canvases get dense pills; big ones
   *  keep the touch-friendly mobile sizing. */
  const pillCls = compactUi
    ? "px-2.5 py-1.5 text-[11px]"
    : "px-3 py-1.5 text-xs";
  const dragRef = useRef<{ sx: number; sy: number; yaw0: number; sq0: number; h0: number; p0: number; moved: boolean; pan: boolean; modified: boolean; k0: number; tx0: number; ty0: number; vscale: number } | null>(null);
  // Live pointers over the svg: one spins the camera, two pinch-zoom it.
  // Touch has no wheel, so without this the orbit view can't zoom at all
  // on a phone.
  const ptrsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d: number; k0: number; wx: number; wy: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const walkRafRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const viewRef = useRef(view);
  viewRef.current = view;
  const walkCamRef = useRef(walkCam);
  walkCamRef.current = walkCam;
  const zoomRef = useRef(zoomCam);
  zoomRef.current = zoomCam;
  const flightRef = useRef<number | null>(null);

  const scheduleFrame = useCallback((apply: () => void) => {
    pendingRef.current = apply;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        pendingRef.current?.();
        pendingRef.current = null;
      });
    }
  }, []);

  /* ================= world model (camera-independent) ================ */
  const world = useMemo(() => {
    const t = fenceType(typeId as FenceTypeId);
    const style = styleOf(t);
    const scale = pxPerFt && pxPerFt > 0 ? pxPerFt : 2.4;
    const zTop = heightFt * scale * HEIGHT_EXAGGERATION;
    const spacingFt =
      t.build !== "panel" &&
      postSpacingFt !== undefined &&
      Number.isFinite(postSpacingFt) &&
      postSpacingFt >= 4 &&
      postSpacingFt <= 12
        ? postSpacingFt
        : t.postSpacingFt;
    const spacingPx = spacingFt * scale;
    const rackFt = rackingLimitFt(t.build);
    // Cast-shadow plan direction (sun from the NW) — solid fences throw
    // a darker strip than see-through ones. Length ~ half the height.
    const SH = { x: -0.58, y: 0.62 };
    /** Two-band cast shadow: a dark core at the base + a lighter outer
     *  half — reads like a penumbra even where the axonometric squash
     *  flattens the strip to a few pixels. */
    const castShadow = (
      F0: V3,
      F1: V3,
      B0: V3,
      B1: V3,
      lenPx: number,
      inner: string,
      outer: string,
    ) => {
      const M0 = { x: F0.x + (B0.x - F0.x) * 0.45, y: F0.y + (B0.y - F0.y) * 0.45, z: F0.z + (B0.z - F0.z) * 0.45 };
      const M1 = { x: F1.x + (B1.x - F1.x) * 0.45, y: F1.y + (B1.y - F1.y) * 0.45, z: F1.z + (B1.z - F1.z) * 0.45 };
      faces.push({ kind: "shadow", bias: 0, shaded: false, baseLenPx: lenPx, fill: inner, pts: [F0, F1, M1, M0] });
      faces.push({ kind: "shadow", bias: 0.001, shaded: false, baseLenPx: lenPx, fill: outer, pts: [M0, M1, B1, B0] });
    };

    const grid =
      topoGridFt &&
      topoGridFt.length >= 2 &&
      topoGridFt[0].length >= 2 &&
      topoGridFt.every(
        (r) => r.length === topoGridFt[0].length && r.every((v) => Number.isFinite(v)),
      )
        ? topoGridFt
        : null;
    const gridRows = grid?.length ?? 0;
    const gridCols = grid?.[0]?.length ?? 0;
    const cellW = grid ? CANVAS_W / (gridCols - 1) : 0;
    const cellH = grid ? CANVAS_H / (gridRows - 1) : 0;

    const sampleSpacing =
      elevationSpacingPx && elevationSpacingPx > 0 ? elevationSpacingPx : spacingPx;
    const models: (RunElevationModel | null)[] = runs.map((r, i) =>
      runDistanceModel(r.points, sampleSpacing, runElevationsFt?.[i] ?? []),
    );

    let minElev = Infinity;
    let maxElev = -Infinity;
    const noteElev = (v: number) => {
      minElev = Math.min(minElev, v);
      maxElev = Math.max(maxElev, v);
    };
    if (grid) for (const row of grid) for (const v of row) noteElev(v);
    models.forEach((m, i) => {
      if (m) for (const v of runElevationsFt![i]) noteElev(v);
    });
    if (!Number.isFinite(minElev)) {
      minElev = 0;
      maxElev = 0;
    }
    const relief = maxElev - minElev;

    const bilinear = (x: number, y: number): number => {
      if (!grid) return minElev;
      const fx = Math.max(0, Math.min(gridCols - 1.001, x / cellW));
      const fy = Math.max(0, Math.min(gridRows - 1.001, y / cellH));
      const c0 = Math.floor(fx);
      const r0 = Math.floor(fy);
      const sx = fx - c0;
      const sy = fy - r0;
      return (
        grid[r0][c0] * (1 - sx) * (1 - sy) +
        grid[r0][c0 + 1] * sx * (1 - sy) +
        grid[r0 + 1][c0] * (1 - sx) * sy +
        grid[r0 + 1][c0 + 1] * sx * sy
      );
    };

    // Softening must never touch the ground the fence actually stands
    // on. The old cap was scene-relative (true scale for the first
    // 5×height above the SCENE minimum, 0.35× beyond) — so a ravine or
    // hill anywhere in the viewport pushed the whole yard into the
    // compressed zone and a 27′ sloped fence line rendered flat while
    // the pricing engine priced 90 steps. Now the fence's own elevation
    // band renders 1:1 (padded a fence-height each way) and only relief
    // beyond that band compresses.
    let bandLo = Infinity;
    let bandHi = -Infinity;
    models.forEach((m, i) => {
      if (!m) return;
      for (const v of runElevationsFt![i]) {
        bandLo = Math.min(bandLo, v);
        bandHi = Math.max(bandHi, v);
      }
    });
    if (!Number.isFinite(bandLo) && grid) {
      for (const r of runs) {
        for (const p of r.points) {
          const v = bilinear(p.x, p.y);
          bandLo = Math.min(bandLo, v);
          bandHi = Math.max(bandHi, v);
        }
      }
    }
    if (!Number.isFinite(bandLo)) {
      // No fence on the ground yet — fall back to the old scene cap.
      bandLo = minElev;
      bandHi = minElev + heightFt * 5;
    }
    const lo = Math.max(0, bandLo - heightFt - minElev);
    const hi = bandHi + heightFt - minElev;
    const soften = (ft: number) =>
      ft < lo
        ? lo - (lo - ft) * 0.35
        : ft <= hi
          ? ft
          : hi + (ft - hi) * 0.35;

    const zAtPlan = (x: number, y: number): number =>
      soften(bilinear(x, y) - minElev) * scale * HEIGHT_EXAGGERATION;

    const geo = runs.map((r) => ({ pts: r.points, cum: cumLengths(r.points) }));
    // Terminal posts: every run end and every corner. On chain link these
    // are the 2⅜″ pipes that take the fabric tension; on wood they're the
    // 4×6 at the gate. Everything between them is lighter line stock.
    // Only vertices where the fence genuinely TURNS (≥25°, matching the
    // priced corner count) get terminal stock. A county-traced polyline
    // carries hundreds of sub-degree jitter vertices — treating each as
    // a corner dressed the whole fence in heavy posts and tension bands.
    const terminalDs = geo.map((rg) => {
      const total = rg.cum[rg.cum.length - 1];
      const ds = [0, total];
      for (let i = 1; i < rg.pts.length - 1; i++) {
        const a = rg.pts[i - 1];
        const b = rg.pts[i];
        const c2 = rg.pts[i + 1];
        const inA = Math.atan2(b.y - a.y, b.x - a.x);
        const outA = Math.atan2(c2.y - b.y, c2.x - b.x);
        let d2 = Math.abs(outA - inA);
        if (d2 > Math.PI) d2 = 2 * Math.PI - d2;
        if (d2 >= (25 * Math.PI) / 180) ds.push(rg.cum[i]);
      }
      return ds;
    });
    const isTerminal = (ri: number, d: number) =>
      terminalDs[ri].some((td) => Math.abs(td - d) < 0.75);
    const hasGroundFor = (ri: number) => !!grid || !!models[ri];
    const elevAt = (ri: number, d: number): number => {
      if (grid) {
        const p = pointAt(geo[ri].pts, geo[ri].cum, d);
        return bilinear(p.x, p.y);
      }
      const m = models[ri];
      return m ? m.atDistPx(d) : minElev;
    };
    const zOf = (ri: number, d: number): number =>
      soften(elevAt(ri, d) - minElev) * scale * HEIGHT_EXAGGERATION;

    // Gates → spans per run.
    const spansByRun: { c: number; w: number; kind: "single" | "double" | "custom" }[][] =
      runs.map(() => []);
    let gateCount = 0;
    for (const g of gates) {
      const kind = g.kind ?? g.gateKind ?? "single";
      const widthFt = g.widthFt ?? g.gateWidthFt ?? (kind === "double" ? 10 : 4);
      let bestRun = -1;
      let best = { dist: 0, perp: Infinity };
      geo.forEach((rg, ri) => {
        if (rg.pts.length < 2) return;
        const n = nearestOnPolyline(g, rg.pts, rg.cum);
        if (n.perp < best.perp) {
          best = n;
          bestRun = ri;
        }
      });
      if (bestRun < 0 || best.perp > GATE_SNAP_PX) continue;
      const total = geo[bestRun].cum[geo[bestRun].cum.length - 1];
      const wPx = widthFt * scale;
      if (total <= wPx + 2) continue;
      spansByRun[bestRun].push({
        c: Math.max(wPx / 2, Math.min(total - wPx / 2, best.dist)),
        w: wPx,
        kind,
      });
      gateCount++;
    }

    const faces: WFace[] = [];
    const labels: WLabel[] = [];
    // Muted elevation tags on the major contour lines ("+120′").
    const elevLabels: WLabel[] = [];
    let steppedCount = 0;
    let wallCount = 0;

    // Mixed-type spans, pinned to their run by arc distance.
    const typedByRun: { s: number; e: number; type: FenceTypeId }[][] =
      runs.map(() => []);
    for (const sec of sections ?? []) {
      let bestRun = -1;
      let bestPerp = Infinity;
      let sA = 0;
      let sB = 0;
      geo.forEach((rg, ri) => {
        if (rg.pts.length < 2) return;
        const na = nearestOnPolyline(sec.a, rg.pts, rg.cum);
        const nb = nearestOnPolyline(sec.b, rg.pts, rg.cum);
        if (na.perp + nb.perp < bestPerp) {
          bestPerp = na.perp + nb.perp;
          bestRun = ri;
          sA = na.dist;
          sB = nb.dist;
        }
      });
      if (bestRun < 0 || bestPerp > 60) continue;
      typedByRun[bestRun].push({
        s: Math.min(sA, sB),
        e: Math.max(sA, sB),
        type: sec.type as FenceTypeId,
      });
    }

    // Terrain surface — mesh density adapts to the lattice so a big
    // hilly lot gets enough quads to roll smoothly instead of showing
    // its cells. Shading and geometry read the same SOFTENED surface,
    // so light and shape can't disagree.
    let contourIntervalFt = 0;
    /** Plan-px pitch of one terrain quad — the feathering radius is a
     *  fraction of THIS, so the surface reads smooth at every zoom. */
    let groundStepPx = 0;
    /** Plan extent the terrain surface covers, for its silhouette clip. */
    let groundRect: { w: number; h: number } | null = null;
    if (grid) {
      const baseQuads = (gridCols - 1) * (gridRows - 1);
      // Subdivide toward a fixed CELL size, not a fixed multiple — a
      // coarse county grid needs SUB 6 where a dense scan needs 2, and
      // capping too low is what left zoom-ins staring at giant soft
      // blocks. The budget bounds total quads so the painter's sort
      // stays interactive.
      const SUB = Math.max(
        2,
        Math.min(6, Math.round(Math.sqrt(6400 / Math.max(1, baseQuads)))),
      );
      const stepX = cellW / SUB;
      const stepY = cellH / SUB;
      groundStepPx = Math.min(stepX, stepY);
      const nx = (gridCols - 1) * SUB;
      const ny = (gridRows - 1) * SUB;
      groundRect = { w: nx * stepX, h: ny * stepY };
      /** Softened elevation (ft above the lot's low point) — the surface
       *  the quads actually sit on. */
      const sElevFt = (x: number, y: number) => soften(bilinear(x, y) - minElev);
      // The subject parcel keeps full color; everything beyond it fades
      // to context. No ring ⇒ everything is "the property".
      const parcelRing0 =
        parcelRings.length > 0 && parcelRings[0].length >= 3
          ? parcelRings[0]
          : null;
      const FADE_PX = 55;
      const cellInParcel = (x: number, y: number): number => {
        if (!parcelRing0) return 1;
        if (pointInPoly({ x, y }, parcelRing0)) return 1;
        // Outside: fade by distance to the nearest boundary edge.
        let d2 = Infinity;
        for (let i = 0, j = parcelRing0.length - 1; i < parcelRing0.length; j = i++) {
          const a = parcelRing0[j];
          const b = parcelRing0[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          const t2 = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
          const qx = a.x + dx * t2 - x;
          const qy = a.y + dy * t2 - y;
          d2 = Math.min(d2, qx * qx + qy * qy);
        }
        return Math.max(0, 1 - Math.sqrt(d2) / FADE_PX);
      };
      // Hypsometric tint fades in with real relief: nothing under 2 ft,
      // full valley-to-crest ramp by 8 ft.
      const hypso = Math.max(0, Math.min(1, (relief - 2) / 6));
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          const x0 = c * stepX;
          const y0 = r * stepY;
          const x1 = x0 + stepX;
          const y1 = y0 + stepY;
          const mx = x0 + stepX / 2;
          const my = y0 + stepY / 2;
          const gx = (sElevFt(x1, my) - sElevFt(x0, my)) / stepX;
          const gy = (sElevFt(mx, y1) - sElevFt(mx, y0)) / stepY;
          const e01 = relief > 0 ? (bilinear(mx, my) - minElev) / relief : 0;
          faces.push({
            kind: "ground",
            bias: -0.5,
            pts: [
              { x: x0, y: y0, z: zAtPlan(x0, y0) },
              { x: x1, y: y0, z: zAtPlan(x1, y0) },
              { x: x1, y: y1, z: zAtPlan(x1, y1) },
              { x: x0, y: y1, z: zAtPlan(x0, y1) },
            ],
            shaded: false,
            baseLenPx: stepX,
            fill: groundFill(e01, gx, gy, smoothNoise(mx, my), hypso, cellInParcel(mx, my)),
          });
        }
      }

      // Topographic contour lines draped ON the surface — the same
      // marching-squares engine the 2D canvas uses, denser here (≤12
      // lines) because the 3D view is where the hill gets judged.
      // Chains split into short slices so the painter sorts them
      // locally instead of one lot-length line jumping layers.
      if (relief >= 2) {
        for (const step of [1, 2, 5, 10, 20, 50]) {
          if (relief / step <= 12) {
            contourIntervalFt = step;
            break;
          }
        }
      }
      if (contourIntervalFt > 0) {
        const topo = buildContours(grid, cellW, cellH, contourIntervalFt);
        const majorEvery = contourIntervalFt * 5;
        for (const line of topo) {
          const major = Math.round(line.levelFt) % majorEvery === 0;
          for (const chain of line.chains) {
            for (let s = 0; s < chain.length - 1; s += 7) {
              const slice = chain.slice(s, Math.min(chain.length, s + 8));
              if (slice.length < 2) continue;
              faces.push({
                kind: "contour",
                bias: -0.46,
                shaded: false,
                baseLenPx: 0,
                major,
                pts: slice.map((p) => ({
                  x: p.x,
                  y: p.y,
                  z: zAtPlan(p.x, p.y) + 0.5,
                })),
              });
            }
          }
        }
        // Elevation labels: up to ~6 levels, each tagged once at the
        // midpoint of its longest chain, in feet above the lot's low
        // point — "+120′" reads instantly; absolute datum would not.
        const stride = Math.max(1, Math.ceil(topo.length / 6));
        topo.forEach((line, i) => {
          if (i % stride !== 0) return;
          const chain = line.chains.reduce(
            (a, b) => (b.length > a.length ? b : a),
            line.chains[0] ?? [],
          );
          if (!chain || chain.length < 4) return;
          const p = chain[Math.floor(chain.length / 2)];
          elevLabels.push({
            anchor: { x: p.x, y: p.y, z: zAtPlan(p.x, p.y) + 2 },
            text: `+${Math.round(line.levelFt - minElev)}′`,
          });
        });
      }
      // Decorative trees on open ground, clear of the fence lines.
      let treeCount = 0;
      for (let r = 1; r < gridRows - 1 && treeCount < 14; r++) {
        for (let c = 1; c < gridCols - 1 && treeCount < 14; c++) {
          const h = hash2(r * 3 + 7, c * 5 + 11);
          if (h < 0.8) continue;
          const x = (c + (hash2(r, c + 99) - 0.5) * 0.8) * cellW;
          const y = (r + (hash2(r + 99, c) - 0.5) * 0.8) * cellH;
          const clear =
            geo.every(
              (rg) =>
                rg.pts.length < 2 || nearestOnPolyline({ x, y }, rg.pts, rg.cum).perp > 60,
            ) && !(buildings ?? []).some((ring) => pointInPoly({ x, y }, ring));
          if (!clear) continue;
          const hFt = 14 + h * 16;
          const z0 = zAtPlan(x, y);
          faces.push({
            kind: "tree",
            bias: 0.02,
            pts: [
              { x, y, z: z0 },
              { x, y, z: z0 + hFt * scale * HEIGHT_EXAGGERATION },
            ],
            shaded: false,
            baseLenPx: hFt * scale,
            tone: Math.floor(h * 997) % TREE_TONES.length,
          });
          treeCount++;
        }
      }
    }

    // Buildings: simple extruded houses — walls, a fascia band and a
    // flat roof slab. Base sits at the LOWEST ground under the
    // footprint so the house never floats on a slope.
    for (const ring of buildings ?? []) {
      if (ring.length < 3) continue;
      let base = Infinity;
      for (const p of ring) base = Math.min(base, grid ? zAtPlan(p.x, p.y) : 0);
      if (!Number.isFinite(base)) base = 0;
      const wallTop = base + 10 * scale * HEIGHT_EXAGGERATION;
      const roofTop = wallTop + 1.2 * scale * HEIGHT_EXAGGERATION;
      // Eave overhang: real roofs stand ~1.5' proud of the walls. The
      // fascia band and cap ride the EXPANDED ring; the walls keep the
      // footprint. Centroid-scaled — fine at this small offset.
      let bcx = 0;
      let bcy = 0;
      for (const p of ring) {
        bcx += p.x;
        bcy += p.y;
      }
      bcx /= ring.length;
      bcy /= ring.length;
      const avgR =
        ring.reduce((a, p) => a + Math.hypot(p.x - bcx, p.y - bcy), 0) /
        ring.length;
      const ok = 1 + Math.min(0.12, (1.5 * scale) / Math.max(1, avgR));
      const eave = ring.map((p) => ({
        x: bcx + (p.x - bcx) * ok,
        y: bcy + (p.y - bcy) * ok,
      }));
      for (let i = 0; i < ring.length; i++) {
        const A = ring[i];
        const B = ring[(i + 1) % ring.length];
        const segLen = Math.hypot(B.x - A.x, B.y - A.y);
        if (segLen < 1) continue;
        const uy = (B.y - A.y) / segLen;
        faces.push({
          kind: "bwall",
          bias: 0,
          pts: [
            { ...A, z: base },
            { ...B, z: base },
            { ...B, z: wallTop },
            { ...A, z: wallTop },
          ],
          shaded: -uy < 0,
          baseLenPx: segLen,
        });
        const EA = eave[i];
        const EB = eave[(i + 1) % ring.length];
        faces.push({
          kind: "roof",
          bias: 0.005,
          pts: [
            { ...EA, z: wallTop },
            { ...EB, z: wallTop },
            { ...EB, z: roofTop },
            { ...EA, z: roofTop },
          ],
          shaded: -uy < 0,
          baseLenPx: segLen,
        });
      }
      faces.push({
        kind: "roof",
        bias: 0.01,
        pts: eave.map((p) => ({ ...p, z: roofTop })),
        shaded: false,
        baseLenPx: 0,
      });
    }

    // Building cast shadows — one draped quad per sun-facing wall.
    for (const ring of buildings ?? []) {
      if (ring.length < 3) continue;
      let bcx = 0;
      let bcy = 0;
      for (const p of ring) {
        bcx += p.x;
        bcy += p.y;
      }
      bcx /= ring.length;
      bcy /= ring.length;
      const shLen = 10 * scale * 1.35;
      const gz = (x: number, y: number) => (grid ? zAtPlan(x, y) : 0) + 0.3;
      for (let ei = 0; ei < ring.length; ei++) {
        const A = ring[ei];
        const B = ring[(ei + 1) % ring.length];
        const el = Math.hypot(B.x - A.x, B.y - A.y);
        if (el < 1) continue;
        let nx = (B.y - A.y) / el;
        let ny = -(B.x - A.x) / el;
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        if (nx * (mx - bcx) + ny * (my - bcy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        if (nx * SH.x + ny * SH.y <= 0.12) continue;
        castShadow(
          { x: A.x, y: A.y, z: gz(A.x, A.y) },
          { x: B.x, y: B.y, z: gz(B.x, B.y) },
          { x: A.x + SH.x * shLen, y: A.y + SH.y * shLen, z: gz(A.x + SH.x * shLen, A.y + SH.y * shLen) },
          { x: B.x + SH.x * shLen, y: B.y + SH.y * shLen, z: gz(B.x + SH.x * shLen, B.y + SH.y * shLen) },
          el,
          "rgba(22,40,24,0.26)",
          "rgba(22,40,24,0.11)",
        );
      }
    }

    // Posts merge by (run, rounded distance).
    const posts = new Map<
      string,
      { plan: Pt; zGround: number; zPostTop: number; heavy: boolean; tid: FenceTypeId }
    >();
    const notePost = (
      ri: number,
      d: number,
      panelTopZ: number,
      heavy = false,
      zBase?: number,
      /** The fence type standing at this post — a mixed-type span puts
       *  ITS post stock here (steel pipe where chain link takes over). */
      tid: FenceTypeId = t.id,
    ) => {
      const key = `${ri}:${Math.round(d)}`;
      const plan = pointAt(geo[ri].pts, geo[ri].cum, d);
      const zGround = zBase ?? zOf(ri, d);
      const prev = posts.get(key);
      posts.set(key, {
        plan,
        zGround: prev ? Math.min(prev.zGround, zGround) : zGround,
        zPostTop: Math.max(prev?.zPostTop ?? 0, panelTopZ),
        heavy: (prev?.heavy ?? false) || heavy || isTerminal(ri, d),
        tid: prev?.tid ?? tid,
      });
    };

    geo.forEach((rg, ri) => {
      const total = rg.cum[rg.cum.length - 1];
      if (rg.pts.length < 2 || total < 1) return;

      const spans = spansByRun[ri].sort((a, b) => a.c - b.c);
      type Interval = { s: number; e: number; gate?: { kind: "single" | "double" | "custom"; w: number } };
      const intervals: Interval[] = [];
      let cursor = 0;
      for (const sp of spans) {
        let s = sp.c - sp.w / 2;
        const e = Math.min(total, sp.c + sp.w / 2);
        if (s < cursor) s = cursor;
        if (e - s < 4) continue;
        if (s - cursor > 0.5) intervals.push({ s: cursor, e: s });
        intervals.push({ s, e, gate: { kind: sp.kind, w: sp.w } });
        cursor = e;
      }
      if (total - cursor > 0.5) intervals.push({ s: cursor, e: total });

      for (const iv of intervals) {
        const len = iv.e - iv.s;
        const A0 = pointAt(rg.pts, rg.cum, iv.s);
        const B0 = pointAt(rg.pts, rg.cum, iv.e);
        const uy = (B0.y - A0.y) / Math.max(1e-6, Math.hypot(B0.x - A0.x, B0.y - A0.y));
        const shaded = -uy < 0;

        if (iv.gate) {
          const zA = zOf(ri, iv.s);
          const zB = zOf(ri, iv.e);
          const base = Math.max(zA, zB) + 0.12 * scale;
          const top = base + zTop - 0.12 * scale;
          const mid = { x: (A0.x + B0.x) / 2, y: (A0.y + B0.y) / 2 };
          faces.push({
            kind: "gate",
            bias: 0,
            pts: [
              { ...A0, z: base },
              { ...B0, z: base },
              { ...B0, z: top },
              { ...A0, z: top },
            ],
            shaded,
            baseLenPx: len,
            leaves: iv.gate.kind === "double" ? 2 : 1,
          });
          // Gate posts are terminals: they stand as proud as the system
          // allows, plus a touch, so the cap clears the swinging leaf.
          const gateTopZ =
            top + (t.spec.postProudIn / 12 + 0.1) * scale * HEIGHT_EXAGGERATION;
          notePost(ri, iv.s, gateTopZ, true);
          notePost(ri, iv.e, gateTopZ, true);
          labels.push({
            anchor: { x: mid.x, y: mid.y, z: top + 2.6 * scale },
            text: `${fmtFt(iv.gate.w / scale)}′ gate`,
          });
          {
            const shLen = (zTop / HEIGHT_EXAGGERATION) * 1.5;
            const backZ = (x: number, y: number, fz: number) =>
              grid ? zAtPlan(x, y) + 0.3 : fz + 0.3;
            const solid = t.category === "wood" || t.category === "vinyl";
            castShadow(
              { x: A0.x, y: A0.y, z: zA + 0.3 },
              { x: B0.x, y: B0.y, z: zB + 0.3 },
              { x: A0.x + SH.x * shLen, y: A0.y + SH.y * shLen, z: backZ(A0.x + SH.x * shLen, A0.y + SH.y * shLen, zA) },
              { x: B0.x + SH.x * shLen, y: B0.y + SH.y * shLen, z: backZ(B0.x + SH.x * shLen, B0.y + SH.y * shLen, zB) },
              len,
              solid ? "rgba(22,40,24,0.30)" : "rgba(22,40,24,0.12)",
              solid ? "rgba(22,40,24,0.13)" : "rgba(22,40,24,0.05)",
            );
          }
          continue;
        }

        // Chunks whose rise beats the racking limit SPLIT into
        // code-sized steps (extra posts, each drop ≤ MAX_STEP_DROP_FT)
        // — the same rule the slope engine prices.
        const sections = Math.max(1, Math.ceil(len / spacingPx));
        const bounds: number[] = [];
        for (let c = 0; c <= sections; c++) {
          bounds.push(iv.s + (len * c) / sections);
        }
        const cuts: number[] = [bounds[0]];
        for (let c = 0; c < sections; c++) {
          const c0 = bounds[c];
          const c1 = bounds[c + 1];
          const rise = hasGroundFor(ri)
            ? Math.abs(elevAt(ri, c1) - elevAt(ri, c0))
            : 0;
          const splits =
            rise > rackFt && rise < WALL_RISE_FT
              ? Math.max(1, Math.ceil(rise / MAX_STEP_DROP_FT))
              : 1;
          for (let k = 1; k <= splits; k++) {
            cuts.push(c0 + ((c1 - c0) * k) / splits);
          }
        }
        // The rails run straight between grade breaks (~½ ft string-line
        // tolerance); the ground keeps its real shape underneath.
        const zsRaw = cuts.map((d) => zOf(ri, d));
        const zsLine = hasGroundFor(ri)
          ? stringLineProfile(cuts, zsRaw, 0.5 * scale * HEIGHT_EXAGGERATION)
          : zsRaw;
        for (let c = 0; c < cuts.length - 1; c++) {
          const d0 = cuts[c];
          const d1 = cuts[c + 1];
          const A = pointAt(rg.pts, rg.cum, d0);
          const B = pointAt(rg.pts, rg.cum, d1);
          const zRawA = zsRaw[c];
          const zRawB = zsRaw[c + 1];
          const zA = zsLine[c];
          const zB = zsLine[c + 1];
          const riseFt = hasGroundFor(ri) ? elevAt(ri, d1) - elevAt(ri, d0) : 0;
          const wallish =
            retainingWall && hasGroundFor(ri) && Math.abs(riseFt) >= WALL_RISE_FT;
          // Racking is an ANGLE limit — a half-length panel can only
          // absorb half the rise before it must step level.
          const rackAllowFt = rackFt * Math.max(0.15, (d1 - d0) / spacingPx);
          const stepped =
            !wallish && hasGroundFor(ri) && Math.abs(riseFt) > rackAllowFt;
          const level = stepped || wallish;
          const bzA = level ? Math.max(zA, zB) : zA;
          const bzB = level ? Math.max(zA, zB) : zB;
          if (stepped) steppedCount++;
          if (wallish) wallCount++;
          const segLen = Math.hypot(B.x - A.x, B.y - A.y);
          // Mixed-type span at this chunk? Its material + height win.
          const dMid = (d0 + d1) / 2;
          const span = typedByRun[ri].find((sp) => dMid >= sp.s && dMid <= sp.e);
          const altT = span ? fenceType(span.type) : null;
          const zTopLocal = altT
            ? altT.defaultHeightFt * scale * HEIGHT_EXAGGERATION
            : zTop;
          const alt = altT
            ? {
                cat: altT.category,
                rails: altT.railsPerSection(altT.defaultHeightFt),
                cap: altT.category === "wood" || altT.category === "vinyl",
                id: altT.id,
              }
            : undefined;
          if (wallish) {
            const zLo = Math.min(zA, zB);
            faces.push({
              kind: "wall",
              bias: -0.02,
              pts: [
                { ...A, z: bzA },
                { ...B, z: bzB },
                { ...B, z: zLo },
                { ...A, z: zLo },
              ],
              shaded,
              baseLenPx: segLen,
            });
          } else if (
            grid &&
            (stepped ||
              bzA > zRawA + 0.15 * scale ||
              bzB > zRawB + 0.15 * scale)
          ) {
            // A stepped bay stays LEVEL while the ground drops beneath
            // it — physically true, but in the axonometric view the
            // floating panel bottom reads as "the fence left the
            // boundary line". Fill the wedge between the level base and
            // the falling ground as earth, so the fence stays visually
            // planted on its line.
            faces.push({
              kind: "skirt",
              bias: -0.02,
              pts: [
                { ...A, z: Math.min(zRawA, bzA) },
                { ...B, z: Math.min(zRawB, bzB) },
                { ...B, z: bzB },
                { ...A, z: bzA },
              ],
              shaded,
              baseLenPx: segLen,
            });
          } else if (!grid && models[ri] && (zA > 0.5 || zB > 0.5)) {
            const ribbon = 4 * scale * HEIGHT_EXAGGERATION;
            faces.push({
              kind: "skirt",
              bias: -0.02,
              pts: [
                { ...A, z: zA },
                { ...B, z: zB },
                { ...B, z: Math.max(0, zB - ribbon) },
                { ...A, z: Math.max(0, zA - ribbon) },
              ],
              shaded,
              baseLenPx: segLen,
            });
          }
          faces.push({
            kind: "panel",
            bias: 0,
            pts: [
              { ...A, z: bzA },
              { ...B, z: bzB },
              { ...B, z: bzB + zTopLocal },
              { ...A, z: bzA + zTopLocal },
            ],
            shaded,
            baseLenPx: segLen,
            alt,
            hFt: zTopLocal / (scale * HEIGHT_EXAGGERATION),
          });
          // How far the post stands above the fabric is a per-system
          // tell: a vinyl cap floats above the panel, a chain-link line
          // post dies flush into the top rail (proud = 0).
          const chunkT = altT ?? t;
          const proudZ =
            (chunkT.spec.postProudIn / 12) * scale * HEIGHT_EXAGGERATION;
          notePost(ri, d0, bzA + zTopLocal + proudZ, false, wallish ? bzA : undefined, chunkT.id);
          notePost(ri, d1, bzB + zTopLocal + proudZ, false, wallish ? bzB : undefined, chunkT.id);
          {
            const shCat = alt ? alt.cat : t.category;
            const shId = alt?.id ?? t.id;
            const spacedType = TYPE_DETAIL[shId] === "spaced";
            const solid = (shCat === "wood" || shCat === "vinyl") && !spacedType;
            // A picket fence is mostly air — its shadow is a whisper, and
            // anything stronger bleeds through the gaps as gray mush.
            const shLen =
              (zTopLocal / HEIGHT_EXAGGERATION) * (spacedType ? 0.6 : 1.2);
            const backZ = (x: number, y: number, fz: number) =>
              grid ? zAtPlan(x, y) + 0.3 : fz + 0.3;
            castShadow(
              { x: A.x, y: A.y, z: zRawA + 0.3 },
              { x: B.x, y: B.y, z: zRawB + 0.3 },
              { x: A.x + SH.x * shLen, y: A.y + SH.y * shLen, z: backZ(A.x + SH.x * shLen, A.y + SH.y * shLen, zRawA) },
              { x: B.x + SH.x * shLen, y: B.y + SH.y * shLen, z: backZ(B.x + SH.x * shLen, B.y + SH.y * shLen, zRawB) },
              segLen,
              solid ? "rgba(22,40,24,0.30)" : spacedType ? "rgba(22,40,24,0.055)" : "rgba(22,40,24,0.12)",
              solid ? "rgba(22,40,24,0.13)" : spacedType ? "rgba(22,40,24,0.03)" : "rgba(22,40,24,0.05)",
            );
          }
        }
      }
    });

    // Posts draw at TRUE stock width — a 1⅝″ chain-link pipe next to a
    // 5×5 vinyl post is a 3× difference, and that difference is most of
    // what tells the two systems apart from across the yard.
    const postPx = (widthIn: number) =>
      Math.max(POST_MIN_PX, (widthIn / 12) * scale * POST_GAIN);
    /** Cap heights, feet — a gothic vinyl cap is a real silhouette, a
     *  chain-link loop cap barely clears the pipe. */
    const CAP_FT: Record<string, number> = {
      flat: 0.08,
      pyramid: 0.18,
      gothic: 0.3,
      dome: 0.14,
      loop: 0.1,
    };
    for (const p of posts.values()) {
      const ps = fenceType(p.tid).spec;
      // A post upgrade overrides the system's own stock everywhere.
      const widthIn =
        postUpgrade === "6x6"
          ? 5.5
          : postUpgrade === "steel"
            ? 2.5
            : p.heavy
              ? ps.terminalWidthIn
              : ps.postWidthIn;
      const round = !postUpgrade && ps.postProfile === "round";
      // Loop caps carry the top rail on chain-link LINE posts; the
      // terminals that anchor the fabric get a solid dome instead.
      const cap =
        ps.postCap === "none"
          ? null
          : ps.postCap === "loop" && p.heavy
            ? ("dome" as const)
            : ps.postCap;
      const w = postPx(widthIn);
      const common = {
        kind: "post" as const,
        shaded: false,
        baseLenPx: w,
        heavy: p.heavy,
        round,
        term: p.heavy,
        tid: p.tid,
      };
      faces.push({
        ...common,
        bias: 0.008,
        pts: [
          { x: p.plan.x, y: p.plan.y - w / 2, z: p.zGround },
          { x: p.plan.x, y: p.plan.y + w / 2, z: p.zGround },
          { x: p.plan.x, y: p.plan.y + w / 2, z: p.zPostTop },
          { x: p.plan.x, y: p.plan.y - w / 2, z: p.zPostTop },
        ],
        sub: true,
      });
      faces.push({
        ...common,
        bias: 0.01,
        pts: [
          { x: p.plan.x - w / 2, y: p.plan.y, z: p.zGround },
          { x: p.plan.x + w / 2, y: p.plan.y, z: p.zGround },
          { x: p.plan.x + w / 2, y: p.plan.y, z: p.zPostTop },
          { x: p.plan.x - w / 2, y: p.plan.y, z: p.zPostTop },
        ],
      });
      if (cap) {
        // Loop caps are wider than the pipe (the rail threads through);
        // moulded caps overhang the post by about half an inch.
        const half = w * (cap === "loop" ? 0.78 : 0.62);
        const capZ = p.zPostTop + CAP_FT[cap] * scale * HEIGHT_EXAGGERATION;
        faces.push({
          ...common,
          bias: 0.015,
          pts: [
            { x: p.plan.x - half, y: p.plan.y, z: p.zPostTop },
            { x: p.plan.x + half, y: p.plan.y, z: p.zPostTop },
            { x: p.plan.x + half, y: p.plan.y, z: capZ },
            { x: p.plan.x - half, y: p.plan.y, z: capZ },
          ],
          cap,
        });
      }
    }

    // Boundary drape. County rings carry a vertex every few px; draping
    // EACH against the terrain let the dashed line ride every ground
    // bulge between the fence's panel chords — on steep lots it
    // periodically floated up across the fence face (measured: aligned
    // within ~0.6px for 94% of points, up to 6px adrift on bulges).
    // Instead: keep real corners (≥25°, the same rule everything else
    // uses), then walk each straight span at a chord step near the
    // fence's own bay length, so line and fence bend over the ground
    // the SAME way.
    const rings: V3[][] = parcelRings.map((ring) => {
      if (ring.length < 3) {
        return ring.map((p) => ({ x: p.x, y: p.y, z: (grid ? zAtPlan(p.x, p.y) : 0) + 1 }));
      }
      const corners: Pt[] = [ring[0]];
      for (let i = 1; i < ring.length - 1; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        const c2 = ring[i + 1];
        const inA = Math.atan2(b.y - a.y, b.x - a.x);
        const outA = Math.atan2(c2.y - b.y, c2.x - b.x);
        let d2 = Math.abs(outA - inA);
        if (d2 > Math.PI) d2 = 2 * Math.PI - d2;
        if (d2 >= (25 * Math.PI) / 180) corners.push(b);
      }
      corners.push(ring[ring.length - 1]);
      const step = Math.max(6, Math.min(14, spacingPx));
      const out: V3[] = [];
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(L / step));
        for (let k2 = 0; k2 < n; k2++) {
          const t = k2 / n;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          out.push({ x, y, z: (grid ? zAtPlan(x, y) : 0) + 1 });
        }
      }
      return out;
    });

    // Where a walk should start: centroid of the drawn fence.
    const runPts = runs.flatMap((r) => r.points);
    const centroidOf =
      runPts.length > 0
        ? {
            x: runPts.reduce((a, p) => a + p.x, 0) / runPts.length,
            y: runPts.reduce((a, p) => a + p.y, 0) / runPts.length,
          }
        : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    const centroid = centroidOf;

    // Default walk-in spot: a few steps inside the first gate, facing
    // it — never inside the house (the old centroid default could stand
    // INSIDE a traced building and open on a blank wall).
    let walkSpot: { pos: Pt; look: Pt } | null = null;
    outer: for (let ri = 0; ri < spansByRun.length; ri++) {
      for (const sp of spansByRun[ri]) {
        if (geo[ri].pts.length < 2) continue;
        const g = pointAt(geo[ri].pts, geo[ri].cum, sp.c);
        const vx = centroid.x - g.x;
        const vy = centroid.y - g.y;
        const vl = Math.hypot(vx, vy);
        if (vl < 1) continue;
        const step = Math.min(26 * scale, vl * 0.6);
        walkSpot = {
          pos: { x: g.x + (vx / vl) * step, y: g.y + (vy / vl) * step },
          look: g,
        };
        break outer;
      }
    }
    if (!walkSpot) {
      const pos = { x: centroid.x, y: centroid.y };
      for (
        let tries = 0;
        tries < 10 && (buildings ?? []).some((ring) => pointInPoly(pos, ring));
        tries++
      ) {
        pos.y += 26;
      }
      const look =
        geo[0] && geo[0].pts.length >= 2
          ? pointAt(geo[0].pts, geo[0].cum, geo[0].cum[geo[0].cum.length - 1] / 2)
          : { x: centroid.x, y: centroid.y - 60 };
      walkSpot = { pos, look };
    }

    return {
      style,
      scale,
      label: `${heightFt}' ${t.label}`,
      faces,
      labels,
      elevLabels,
      rings,
      zAtPlan,
      centroid,
      styleKey: t.category,
      walkSpot,
      railCount: t.railsPerSection(heightFt),
      capRail: t.category === "wood" || t.category === "vinyl",
      gateCount,
      steppedCount,
      wallCount,
      hasSurface: !!grid,
      reliefFt: Math.round(relief),
      contourIntervalFt,
      groundStepPx,
      groundRect,
    };
  }, [runs, gates, heightFt, typeId, pxPerFt, parcelRings, runElevationsFt, elevationSpacingPx, topoGridFt, buildings, sections, retainingWall, postUpgrade, postSpacingFt]);

  /* ===================== orbit (axonometric) ======================== */
  const orbitScene = useMemo(() => {
    if (world.faces.length === 0) return null;
    const rot = (view.yawDeg * Math.PI) / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const squash = view.squash;
    const proj = (p: V3): Pt => ({
      x: p.x * cosR - p.y * sinR,
      y: (p.x * sinR + p.y * cosR) * squash - p.z,
    });
    const depthOf = (f: WFace): number => {
      let mx = 0;
      let my = 0;
      const n = f.kind === "tree" ? 1 : f.pts.length;
      for (let i = 0; i < n; i++) {
        mx += f.pts[i].x;
        my += f.pts[i].y;
      }
      return ((mx / n) * sinR + (my / n) * cosR) * squash + f.bias;
    };

    const pfaces: ProjFace[] = world.faces.map((f) => ({
      face: f,
      poly: f.pts.map(proj),
      isQuad: f.pts.length === 4,
      depth: depthOf(f),
    }));
    pfaces.sort((a, b) => a.depth - b.depth);

    const plabels = world.labels.map((l) => ({ text: l.text, at: proj(l.anchor) }));
    const pElev = world.elevLabels.map((l) => ({ text: l.text, at: proj(l.anchor) }));
    const prings = world.rings.map((ring) => ring.map(proj));

    const all: Pt[] = [
      ...pfaces.flatMap((f) => f.poly),
      ...prings.flat(),
      ...plabels.flatMap((l) => [
        { x: l.at.x - l.text.length * 3.4 - 10, y: l.at.y - 24 },
        { x: l.at.x + l.text.length * 3.4 + 10, y: l.at.y },
      ]),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of all) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const margin = 40;
    const fit = Math.min(
      (VIEW_W - margin * 2) / Math.max(1, maxX - minX),
      (VIEW_H - margin * 2) / Math.max(1, maxY - minY),
    );
    const ox = (VIEW_W - (maxX - minX) * fit) / 2 - minX * fit;
    const oy = (VIEW_H - (maxY - minY) * fit) / 2 - minY * fit;
    const T = (p: Pt): Pt => ({ x: p.x * fit + ox, y: p.y * fit + oy });

    const faces = pfaces.map((f) => ({ ...f, poly: f.poly.map(T) }));
    let marker: { base: Pt; top: Pt } | null = null;
    for (const f of faces) {
      if (f.face.kind !== "post") continue;
      const base = { x: (f.poly[0].x + f.poly[1].x) / 2, y: (f.poly[0].y + f.poly[1].y) / 2 };
      const top = { x: (f.poly[2].x + f.poly[3].x) / 2, y: (f.poly[2].y + f.poly[3].y) / 2 };
      if (Math.abs(base.y - top.y) < 6) continue;
      if (!marker || base.x < marker.base.x) marker = { base, top };
    }
    // Silhouette of the terrain slab: the feathering that melts the
    // quad facets would otherwise fuzz the lot's OUTER edge into a gray
    // smudge, so the blurred layer gets clipped back to its true
    // outline. Sampled densely enough that the undulating far edge
    // stays faithful — a straight-line clip would slice off crests.
    let groundClip: Pt[] | null = null;
    if (world.groundRect) {
      const { w, h } = world.groundRect;
      const pts: Pt[] = [];
      const N = 48;
      const edge = (x0: number, y0: number, x1: number, y1: number) => {
        for (let s = 0; s < N; s++) {
          const x = x0 + (x1 - x0) * (s / N);
          const y = y0 + (y1 - y0) * (s / N);
          pts.push(T(proj({ x, y, z: world.zAtPlan(x, y) })));
        }
      };
      edge(0, 0, w, 0);
      edge(w, 0, w, h);
      edge(w, h, 0, h);
      edge(0, h, 0, 0);
      groundClip = pts;
    }
    return {
      faces,
      labels: plabels.map((l) => ({ ...l, at: T(l.at) })),
      elevLabels: pElev.map((l) => ({ ...l, at: T(l.at) })),
      rings: prings.map((r) => r.map(T)),
      groundClip,
      marker,
      fit,
      ox,
      oy,
      cosR,
      sinR,
      squash,
    };
  }, [world, view]);

  /* ===================== walk (perspective) ========================= */
  const walkScene = useMemo(() => {
    if (mode !== "walk" || world.faces.length === 0) return null;
    const { x: cx, y: cy, heading, pitch } = walkCam;
    const camZ = world.zAtPlan(cx, cy) + EYE_FT * world.scale * HEIGHT_EXAGGERATION;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const horizon = VIEW_H * 0.5 - pitch * FOCAL * 0.9;

    type CPt = { d: number; l: number; h: number };
    const toCam = (p: V3): CPt => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        d: dx * cosH + dy * sinH,
        l: -dx * sinH + dy * cosH,
        h: p.z - camZ,
      };
    };
    const projC = (c: CPt): Pt => ({
      x: VIEW_W / 2 + (c.l / c.d) * FOCAL,
      y: horizon - (c.h / c.d) * FOCAL,
    });
    /** Sutherland–Hodgman clip against d >= NEAR_PX. */
    const clipNear = (pts: CPt[]): CPt[] => {
      const out: CPt[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const aIn = a.d >= NEAR_PX;
        const bIn = b.d >= NEAR_PX;
        if (aIn) out.push(a);
        if (aIn !== bIn) {
          const s = (NEAR_PX - a.d) / (b.d - a.d);
          out.push({
            d: NEAR_PX,
            l: a.l + (b.l - a.l) * s,
            h: a.h + (b.h - a.h) * s,
          });
        }
      }
      return out;
    };

    const faces: ProjFace[] = [];
    for (const f of world.faces) {
      if (f.kind === "tree") {
        const base = toCam(f.pts[0]);
        if (base.d < NEAR_PX || base.d > 2600) continue;
        const top = toCam(f.pts[1]);
        faces.push({ face: f, poly: [projC(base), projC({ ...top, d: base.d })], isQuad: false, depth: base.d });
        continue;
      }
      // Contours are open polylines, not polygons — the near-plane
      // clipper would wrap them shut. They're decorative, so any slice
      // that straddles the near plane (or sits far off) just drops.
      if (f.kind === "contour") {
        const cpts2 = f.pts.map(toCam);
        if (cpts2.some((c) => c.d < NEAR_PX) || cpts2[0].d > 2600) continue;
        const poly = cpts2.map(projC);
        if (
          poly.every((p) => p.x < -80) ||
          poly.every((p) => p.x > VIEW_W + 80) ||
          poly.every((p) => p.y < -80) ||
          poly.every((p) => p.y > VIEW_H + 80)
        )
          continue;
        let meanD = 0;
        for (const c of cpts2) meanD += c.d;
        meanD /= cpts2.length;
        faces.push({ face: f, poly, isQuad: false, depth: meanD - f.bias * 2 });
        continue;
      }
      const cpts = f.pts.map(toCam);
      if (cpts.every((c) => c.d < NEAR_PX)) continue;
      let maxD = 0;
      for (const c of cpts) maxD = Math.max(maxD, c.d);
      if (maxD > 3200 && f.kind === "ground") continue; // distance cull
      const clipped = cpts.every((c) => c.d >= NEAR_PX) ? cpts : clipNear(cpts);
      if (clipped.length < 3) continue;
      const poly = clipped.map(projC);
      // off-screen cull
      if (
        poly.every((p) => p.x < -80) ||
        poly.every((p) => p.x > VIEW_W + 80) ||
        poly.every((p) => p.y < -80) ||
        poly.every((p) => p.y > VIEW_H + 80)
      )
        continue;
      let meanD = 0;
      for (const c of clipped) meanD += c.d;
      meanD /= clipped.length;
      faces.push({
        face: f,
        poly,
        isQuad: clipped.length === 4 && cpts.every((c) => c.d >= NEAR_PX),
        depth: meanD - f.bias * 2,
      });
    }
    faces.sort((a, b) => b.depth - a.depth); // far → near

    const labels = world.labels
      .map((l) => {
        const c = toCam(l.anchor);
        if (c.d < NEAR_PX * 3 || c.d > 1600) return null;
        return { text: l.text, at: projC(c) };
      })
      .filter(Boolean) as { text: string; at: Pt }[];

    const elevLabels = world.elevLabels
      .map((l) => {
        const c = toCam(l.anchor);
        if (c.d < NEAR_PX * 3 || c.d > 2000) return null;
        return { text: l.text, at: projC(c) };
      })
      .filter(Boolean) as { text: string; at: Pt }[];

    return { faces, labels, elevLabels, horizon };
  }, [mode, walkCam, world]);

  /* ======================= interactions ============================= */

  /**
   * Fly the camera to a saved shot instead of cutting to it.
   *
   * A hard jump between two angles of the same yard is disorienting —
   * the client can't tell whether they're looking at a different side
   * or a different job. An eased ~620 ms move over the shortest yaw
   * path keeps the geometry continuous, so the fence visibly rotates
   * to its new face. Respects prefers-reduced-motion by cutting.
   */
  const flyTo = useCallback(
    (shot: FenceShot) => {
      if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
      setMode("orbit");
      const from = { ...viewRef.current };
      const fromZoom = { ...zoomRef.current };
      const to = shot.view;
      const toZoom = shot.zoom ?? { k: 1, tx: 0, ty: 0 };
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        setView(to);
        setZoomCam(toZoom);
        return;
      }
      const t0 = performance.now();
      const DURATION = 620;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / DURATION);
        const e = easeInOut(t);
        setView(lerpView(from, to, e));
        setZoomCam(lerpZoom(fromZoom, toZoom, e));
        if (t < 1) flightRef.current = requestAnimationFrame(step);
        else flightRef.current = null;
      };
      flightRef.current = requestAnimationFrame(step);
    },
    [],
  );

  useEffect(
    () => () => {
      if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
    },
    [],
  );

  // Follow the controlled active shot. Keyed on the id (not the object)
  // so a parent re-render can't retrigger the flight mid-move.
  const shotList = shots ?? [];
  const lastShotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeShotId || shotList.length === 0) return;
    if (lastShotRef.current === activeShotId) return;
    const shot = shotList.find((s) => s.id === activeShotId);
    if (!shot) return;
    lastShotRef.current = activeShotId;
    flyTo(shot);
  }, [activeShotId, shotList, flyTo]);

  const selectShot = useCallback(
    (shot: FenceShot) => {
      lastShotRef.current = shot.id;
      flyTo(shot);
      onActiveShotChange?.(shot.id);
    },
    [flyTo, onActiveShotChange],
  );

  /** Client point → VIEW-space point on the svg. */
  const toView = useCallback((clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * VIEW_W,
      y: ((clientY - r.top) / r.height) * VIEW_H,
    };
  }, []);

  /** The camera is FREE: pan at any zoom (the old clamp pinned the
   *  frame dead-center until you zoomed in — "stuck in the middle"),
   *  and zoom out below the framed view for context. The only rule is
   *  that a meaningful slice of the scene must stay on screen, so the
   *  yard can never be lost off an edge. */
  const clampCam = (k: number, tx: number, ty: number) => {
    const kc = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
    const KEEP = 170; // px of scene that must remain visible
    const cx = Math.min(VIEW_W - KEEP, Math.max(KEEP - VIEW_W * kc, tx));
    const cy = Math.min(VIEW_H - KEEP, Math.max(KEEP - VIEW_H * kc, ty));
    return { k: kc, tx: cx, ty: cy };
  };
  const zoomTo = useCallback(
    (k: number, wx: number, wy: number, sx: number, sy: number) => {
      const kc = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
      const c = clampCam(kc, sx - wx * kc, sy - wy * kc);
      setZoomCam((z0) =>
        // Wheel and pinch both fire in bursts; once a gesture is pressed
        // against the zoom stop every event would otherwise re-render.
        z0.k === c.k && z0.tx === c.tx && z0.ty === c.ty ? z0 : c,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Native wheel: zoom the orbit view toward the cursor (React root
  // wheel handlers are passive — preventDefault needs a native listener).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "orbit") return;
      // Locked/guided views are a fixed frame — scrolling the page over
      // the preview must scroll the page, not the camera.
      if (!canOrbit) return;
      e.preventDefault();
      const s = toView(e.clientX, e.clientY);
      const z0 = zoomRef.current;
      const k = z0.k * Math.exp(-e.deltaY * 0.0022);
      // keep the world point under the cursor fixed
      zoomTo(k, (s.x - z0.tx) / z0.k, (s.y - z0.ty) / z0.k, s.x, s.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [canOrbit, toView, zoomTo]);

  /** Screen → plan-ground point (inverts zoom, fit and the axonometric
   *  rotation, iterating for terrain height). */
  const pickGround = useCallback(
    (clientX: number, clientY: number): Pt | null => {
      const svg = svgRef.current;
      const sc = orbitScene;
      if (!svg || !sc) return null;
      const r = svg.getBoundingClientRect();
      let sx = ((clientX - r.left) / r.width) * VIEW_W;
      let sy = ((clientY - r.top) / r.height) * VIEW_H;
      const z0 = zoomRef.current;
      sx = (sx - z0.tx) / z0.k;
      sy = (sy - z0.ty) / z0.k;
      const px = (sx - sc.ox) / sc.fit;
      const py = (sy - sc.oy) / sc.fit;
      let x = CANVAS_W / 2;
      let y = CANVAS_H / 2;
      let z = 0;
      for (let i = 0; i < 3; i++) {
        const yr = (py + z) / sc.squash;
        x = px * sc.cosR + yr * sc.sinR;
        y = -px * sc.sinR + yr * sc.cosR;
        z = world.zAtPlan(
          Math.max(0, Math.min(CANVAS_W, x)),
          Math.max(0, Math.min(CANVAS_H, y)),
        );
      }
      return {
        x: Math.max(10, Math.min(CANVAS_W - 10, x)),
        y: Math.max(10, Math.min(CANVAS_H - 10, y)),
      };
    },
    [orbitScene, world],
  );

  const enterWalk = useCallback(
    (at?: Pt) => {
      const pos = at ?? world.walkSpot.pos;
      const look = at ? world.centroid : world.walkSpot.look;
      const heading = Math.atan2(look.y - pos.y, look.x - pos.x);
      setWalkCam({ x: pos.x, y: pos.y, heading, pitch: 0 });
      setMode("walk");
    },
    [world],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Left drag spins; Shift+left or MIDDLE drag pans the zoomed frame
      // (touch already pans via the two-finger pinch midpoint).
      if (e.button !== 0 && e.button !== 1) return;
      // Guided/locked: the camera belongs to the contractor. Swallow the
      // gesture entirely rather than starting a drag that goes nowhere.
      if (!canOrbit) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Second finger down → pinch. Drop the spin drag so the camera
      // doesn't lurch while the fingers settle, and remember the world
      // point under the midpoint so it stays pinned as the pinch runs.
      if (ptrsRef.current.size === 2 && modeRef.current === "orbit") {
        const [a, b] = [...ptrsRef.current.values()];
        const s = toView((a.x + b.x) / 2, (a.y + b.y) / 2);
        const z0 = zoomRef.current;
        pinchRef.current = {
          d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          k0: z0.k,
          wx: (s.x - z0.tx) / z0.k,
          wy: (s.y - z0.ty) / z0.k,
        };
        dragRef.current = null;
        return;
      }
      // Extra fingers in walk mode: leave the existing drag alone rather
      // than re-seating its origin, which snapped the heading sideways.
      if (ptrsRef.current.size > 1) return;
      const v = viewRef.current;
      const w = walkCamRef.current;
      const z0 = zoomRef.current;
      const invert = e.button === 1 || e.shiftKey;
      const pan =
        modeRef.current === "orbit" &&
        (dragModeRef.current === "move") !== invert;
      const modified = invert;
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
      const rect = e.currentTarget.getBoundingClientRect();
      dragRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        yaw0: v.yawDeg,
        sq0: v.squash,
        h0: w.heading,
        p0: w.pitch,
        moved: false,
        pan,
        modified,
        k0: z0.k,
        tx0: z0.tx,
        ty0: z0.ty,
        // client px → VIEW px, so the frame tracks the cursor 1:1 on
        // any rendered size.
        vscale: VIEW_W / Math.max(1, rect.width),
      };
    },
    [canOrbit, toView],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (ptrsRef.current.has(e.pointerId)) {
        ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // Pinch: scale by the finger spread, and let the midpoint drag the
      // zoomed frame around (two-finger pan comes free with it).
      const pinch = pinchRef.current;
      if (pinch && ptrsRef.current.size >= 2) {
        const [a, b] = [...ptrsRef.current.values()];
        const s = toView((a.x + b.x) / 2, (a.y + b.y) / 2);
        // Scale off the spread the pinch STARTED at — reading the live k
        // here would compound it into a runaway zoom.
        const k = pinch.k0 * (Math.hypot(b.x - a.x, b.y - a.y) / pinch.d);
        scheduleFrame(() => zoomTo(k, pinch.wx, pinch.wy, s.x, s.y));
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (!d.moved) return;
      if (modeRef.current === "walk") {
        scheduleFrame(() =>
          setWalkCam((w) => ({
            ...w,
            heading: d.h0 + dx * 0.0042,
            pitch: Math.max(-0.42, Math.min(0.42, d.p0 + dy * 0.0028)),
          })),
        );
      } else if (d.pan) {
        // Same clamp as zoomTo: the framed scene never pans off-screen,
        // and at k=1 the clamp collapses to no-op.
        const c = clampCam(d.k0, d.tx0 + dx * d.vscale, d.ty0 + dy * d.vscale);
        scheduleFrame(() =>
          setZoomCam((z) =>
            z.tx === c.tx && z.ty === c.ty ? z : { ...z, tx: c.tx, ty: c.ty },
          ),
        );
      } else {
        scheduleFrame(() =>
          setView({
            yawDeg: d.yaw0 + dx * 0.35,
            squash: Math.min(0.8, Math.max(0.3, d.sq0 + dy * 0.0022)),
          }),
        );
      }
    },
    [scheduleFrame],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      ptrsRef.current.delete(e.pointerId);
      const wasPinching = !!pinchRef.current;
      if (ptrsRef.current.size < 2) pinchRef.current = null;
      const d = dragRef.current;
      dragRef.current = null;
      // Lifting one finger out of a pinch is not a tap — without this it
      // read as a clean click and dropped the client into walk mode.
      if (wasPinching) return;
      if (!d) return;
      if (d.moved) {
        if (modeRef.current === "orbit" && !d.pan) onViewChange?.(viewRef.current);
        return;
      }
      // clean click: in orbit mode, step into the yard at that spot.
      // Only a MODIFIED click (shift / middle) that never moved is
      // ignored — a plain click walks in both drag modes.
      if (d.modified) return;
      if (modeRef.current === "orbit" && canWalk) {
        const at = pickGround(e.clientX, e.clientY);
        if (at) enterWalk(at);
      }
    },
    [onViewChange, pickGround, enterWalk, canWalk],
  );

  // Walk-mode movement loop + keys.
  useEffect(() => {
    if (mode !== "walk") return;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "escape") {
        setMode("orbit");
        return;
      }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
        e.preventDefault();
        keysRef.current.add(k);
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      const keys = keysRef.current;
      if (keys.size > 0) {
        setWalkCam((w) => {
          const boost = keys.has("shift") ? 2 : 1;
          const speed = WALK_FT_PER_S * world.scale * boost;
          let { x, y, heading } = w;
          const fwd =
            (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
            (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
          const turn =
            (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
            (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
          heading += turn * TURN_RAD_PER_S * dt;
          x += Math.cos(heading) * fwd * speed * dt;
          y += Math.sin(heading) * fwd * speed * dt;
          x = Math.max(6, Math.min(CANVAS_W - 6, x));
          y = Math.max(6, Math.min(CANVAS_H - 6, y));
          return { ...w, x, y, heading };
        });
      }
      walkRafRef.current = requestAnimationFrame(tick);
    };
    walkRafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (walkRafRef.current) cancelAnimationFrame(walkRafRef.current);
      keysRef.current.clear();
    };
  }, [mode, world.scale]);

  /* ========================== render ================================ */

  if (!orbitScene) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400", className)}>
        Draw a fence run to see the 3D preview.
      </div>
    );
  }

  const { style, styleKey, label, railCount, capRail, gateCount, steppedCount, wallCount, hasSurface, reliefFt, contourIntervalFt } = world;
  const polyPath = (pts: Pt[]) =>
    `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")} Z`;

  // Detail density scales with how big the geometry is on screen —
  // walking up to the fence earns more boards/bars than the fit view.
  const lodK = mode === "walk" ? 1.6 : zoomCam.k;
  const renderFace = (f: ProjFace, i: number) => {
    const kind = f.face.kind;
    if (kind === "ground") {
      return (
        <path key={i} d={polyPath(f.poly)} fill={f.face.fill} stroke={f.face.fill} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      );
    }
    if (kind === "shadow") {
      return <path key={i} d={polyPath(f.poly)} fill={f.face.fill ?? "rgba(22,40,24,0.12)"} />;
    }
    if (kind === "contour") {
      // Open polyline draped on the ground — solid (never dashed, so it
      // can't be confused with the dashed parcel boundary), majors
      // heavier and darker.
      const d = "M" + f.poly.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L");
      return (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={f.face.major ? "rgba(38,64,38,0.44)" : "rgba(38,64,38,0.20)"}
          strokeWidth={f.face.major ? 1.4 : 0.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Constant screen width: zooming the orbit must not fatten a
          // hairline contour into sludge.
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    if (kind === "tree") {
      const [base, top] = f.poly;
      const hPx = Math.max(4, base.y - top.y);
      const r = hPx * 0.34;
      const tones = TREE_TONES[f.face.tone ?? 0];
      return (
        <g key={i}>
          <ellipse cx={base.x - r * 0.5} cy={base.y + 1.5} rx={r * 1.05} ry={r * 0.24} fill="rgba(30,50,28,0.22)" />
          <line x1={base.x} y1={base.y} x2={base.x} y2={base.y - hPx * 0.55} stroke="#6B4E2E" strokeWidth={Math.max(1, hPx * 0.05)} />
          <circle cx={base.x - r * 0.35} cy={base.y - hPx * 0.62} r={r * 0.72} fill={tones[1]} />
          <circle cx={base.x + r * 0.3} cy={base.y - hPx * 0.58} r={r * 0.66} fill={tones[1]} />
          <circle cx={base.x} cy={base.y - hPx * 0.74} r={r} fill={tones[0]} />
        </g>
      );
    }
    if (kind === "bwall") {
      // Wall height on screen drives the line work — a distant house
      // gets hairlines, a close one crisp edges, never fat outlines.
      const wh = f.isQuad
        ? Math.hypot(f.poly[3].x - f.poly[0].x, f.poly[3].y - f.poly[0].y)
        : 24;
      const eaveW = Math.max(0.8, Math.min(3.2, wh * 0.07));
      return (
        <g key={i}>
          <path
            d={polyPath(f.poly)}
            fill={f.face.shaded ? "url(#f3d-wall-sh)" : "url(#f3d-wall-lit)"}
            stroke="rgba(128,119,102,0.55)"
            strokeWidth={Math.max(0.35, Math.min(1, wh * 0.02))}
            strokeLinejoin="round"
          />
          {/* eave shadow — the soft dark band a roof throws on its wall */}
          {f.isQuad && (
            <line
              x1={f.poly[3].x}
              y1={f.poly[3].y + eaveW * 0.6}
              x2={f.poly[2].x}
              y2={f.poly[2].y + eaveW * 0.6}
              stroke="rgba(52,54,60,0.16)"
              strokeWidth={eaveW}
            />
          )}
        </g>
      );
    }
    if (kind === "roof") {
      // Fascia bands are quads with a real base length; the roof slab is
      // the ring face — it gets the sky-lit gradient.
      const slab = f.face.baseLenPx === 0;
      const rh = f.isQuad
        ? Math.hypot(f.poly[3].x - f.poly[0].x, f.poly[3].y - f.poly[0].y)
        : 6;
      return (
        <path
          key={i}
          d={polyPath(f.poly)}
          fill={slab ? "url(#f3d-roof-top)" : f.face.shaded ? "#575E6A" : "#6A7180"}
          stroke="rgba(64,70,80,0.6)"
          strokeWidth={slab ? 0.7 : Math.max(0.35, Math.min(0.9, rh * 0.1))}
          strokeLinejoin="round"
        />
      );
    }
    if (kind === "skirt") {
      return (
        <path key={i} d={polyPath(f.poly)} fill="url(#f3d-earth)" stroke="rgba(46,72,42,0.14)" strokeWidth={0.7} strokeLinejoin="round" />
      );
    }
    if (kind === "wall") {
      const q = f.poly;
      const courses: React.ReactNode[] = [];
      if (f.isQuad) {
        const [wa, wb, wlb, wla] = q;
        for (let k = 1; k <= 3; k++) {
          const s = k / 4;
          courses.push(
            <line
              key={k}
              x1={wa.x + (wla.x - wa.x) * s}
              y1={wa.y + (wla.y - wa.y) * s}
              x2={wb.x + (wlb.x - wb.x) * s}
              y2={wb.y + (wlb.y - wb.y) * s}
              stroke="rgba(70,64,54,0.18)"
              strokeWidth={0.8}
            />,
          );
        }
      }
      return (
        <g key={i}>
          <path d={polyPath(q)} fill={f.face.shaded ? "#B6AFA2" : "#CBC4B7"} stroke="#8E8778" strokeWidth={0.9} strokeLinejoin="round" />
          {courses}
          {f.isQuad && (
            <line x1={q[0].x} y1={q[0].y} x2={q[1].x} y2={q[1].y} stroke="#7A7365" strokeWidth={2.2} strokeLinecap="round" />
          )}
        </g>
      );
    }
    if (kind === "post") {
      // A post belongs to ITS OWN system, not the job's primary type —
      // the chain-link stretch across the back gets galvanized pipe even
      // on a cedar job.
      const pT = fenceType((f.face.tid ?? typeId) as FenceTypeId);
      const pStyle = styleOf(pT);
      const ps = pT.spec;
      const steel = postUpgrade === "steel";
      const baseFill = steel ? "#8B9298" : pStyle.post;
      const subFill = steel ? "#767D83" : pStyle.shade;
      const strokeC = steel ? "#666D74" : pStyle.stroke;
      const q = f.poly;
      const wPx = f.isQuad ? Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) : 0;
      const mix = (a: Pt, b: Pt, s: number): Pt => ({
        x: a.x + (b.x - a.x) * s,
        y: a.y + (b.y - a.y) * s,
      });

      // ---------------------------- caps ----------------------------
      if (f.face.cap) {
        if (!f.isQuad) return null;
        const [c0, c1, t1, t0] = q;
        const mid = mix(c0, c1, 0.5);
        const apex = mix(t0, t1, 0.5);
        if (f.face.cap === "loop") {
          // A loop cap is a ring the top rail runs THROUGH — drawing it
          // as a slab is what makes bad chain-link renders look wooden.
          const rx = Math.max(0.9, wPx * 0.5);
          return (
            <ellipse
              key={i}
              cx={mid.x}
              cy={(mid.y + apex.y) / 2}
              rx={rx}
              ry={Math.max(0.6, rx * 0.55)}
              fill="none"
              stroke={baseFill}
              strokeWidth={Math.max(0.7, wPx * 0.3)}
            />
          );
        }
        // A cap is the one part of a fence at eye level that catches full
        // sky — in every reference photo it's the brightest edge on the
        // whole run. Flat-filling it is what makes caps disappear.
        const capLit = (
          <line
            key="cap-lit"
            x1={mix(c0, apex, 0.55).x}
            y1={mix(c0, apex, 0.55).y}
            x2={mix(c1, apex, 0.55).x}
            y2={mix(c1, apex, 0.55).y}
            stroke="rgba(255,244,214,0.5)"
            strokeWidth={Math.max(0.4, wPx * 0.22)}
            strokeLinecap="round"
          />
        );
        const capPath =
          f.face.cap === "dome"
            ? // parabola peaking at the post centerline
              `M${c0.x.toFixed(1)} ${c0.y.toFixed(1)} Q${(mid.x + (apex.x - mid.x) * 2).toFixed(1)} ${(mid.y + (apex.y - mid.y) * 2).toFixed(1)} ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} Z`
            : f.face.cap === "gothic"
              ? polyPath([c0, c1, mix(t1, apex, 0.6), apex, mix(t0, apex, 0.6)])
              : f.face.cap === "pyramid"
                ? polyPath([c0, c1, mix(t1, apex, 0.5), mix(t0, apex, 0.5)])
                : polyPath(q); // flat
        return (
          <g key={i}>
            <path
              d={capPath}
              fill={baseFill}
              stroke={strokeC}
              strokeWidth={0.7}
              strokeLinejoin="round"
            />
            {wPx >= 2.2 && capLit}
          </g>
        );
      }

      // ---------------------------- shaft ---------------------------
      // Footing collar — concrete on every system but split rail, which
      // is dropped in and tamped with gravel so rails can be re-seated.
      const footing =
        !f.face.sub && f.isQuad && wPx >= 3.4 ? (
          <path
            d={`M${q[0].x - wPx * 0.26} ${q[0].y} L${q[1].x + wPx * 0.26} ${q[1].y} L${q[1].x + wPx * 0.16} ${q[1].y + wPx * 0.55} L${q[0].x - wPx * 0.16} ${q[0].y + wPx * 0.55} Z`}
            fill={ps.setInConcrete ? "#BDBAB0" : "#A9A296"}
            stroke={ps.setInConcrete ? "#9C998F" : "#8B8478"}
            strokeWidth={0.6}
            strokeDasharray={ps.setInConcrete ? undefined : "1.5 1.2"}
          />
        ) : null;

      // Round stock reads as a cylinder: one hot highlight down the
      // shaft instead of the flat facet a square post shows.
      const highlight =
        f.face.round && !f.face.sub && f.isQuad && wPx >= 1.3 ? (
          <line
            x1={mix(q[0], q[1], 0.33).x}
            y1={mix(q[0], q[1], 0.33).y}
            x2={mix(q[3], q[2], 0.33).x}
            y2={mix(q[3], q[2], 0.33).y}
            stroke="rgba(255,255,255,0.34)"
            strokeWidth={Math.max(0.5, wPx * 0.24)}
            strokeLinecap="round"
          />
        ) : null;

      // Square stock is TWO faces meeting at a corner: the sun catches
      // one, the other falls away. Flat-filling the quad is what left
      // posts reading as dark bars stuck on the panel instead of solid
      // timbers standing in front of it — the thing that reads loudest
      // in a photo of a real fence.
      const facets =
        !f.face.round && !f.face.sub && f.isQuad && wPx >= 1.8 ? (
          <>
            <path
              d={polyPath([q[0], mix(q[0], q[1], 0.42), mix(q[3], q[2], 0.42), q[3]])}
              fill="rgba(255,246,222,0.16)"
            />
            <path
              d={polyPath([mix(q[0], q[1], 0.72), q[1], q[2], mix(q[3], q[2], 0.72)])}
              fill="rgba(12,8,4,0.22)"
            />
          </>
        ) : null;

      // Chain-link terminals wear the tension bands that clamp the
      // fabric — the giveaway that this post is an end, not a line post.
      const bands =
        pT.category === "chain-link" &&
        f.face.term &&
        !f.face.sub &&
        f.isQuad &&
        wPx >= 1.6
          ? [0.18, 0.52, 0.86].map((s) => (
              <line
                key={`bd-${s}`}
                x1={mix(q[0], q[3], s).x - wPx * 0.34}
                y1={mix(q[0], q[3], s).y}
                x2={mix(q[1], q[2], s).x + wPx * 0.34}
                y2={mix(q[1], q[2], s).y}
                stroke="#6E767D"
                strokeWidth={Math.max(0.6, wPx * 0.26)}
              />
            ))
          : null;

      // Outline scales with the post's screen width so distant posts
      // stay slender instead of turning into dark bars.
      const psw = Math.max(0.3, Math.min(1, wPx * 0.16));
      return (
        <g key={i}>
          {footing}
          <path
            d={polyPath(q)}
            fill={f.face.sub ? subFill : baseFill}
            stroke={strokeC}
            strokeWidth={f.face.heavy ? psw * 1.4 : psw}
          />
          {highlight}
          {facets}
          {bands}
        </g>
      );
    }
    if (kind === "gate") {
      // Gates match the fence material — a cedar yard gets a cedar gate,
      // an ornamental fence a steel one — with X-bracing and hinges.
      const cat = styleKey;
      const metal = cat === "aluminum" || cat === "steel";
      // A gate leaf is denser than the fence beside it (frame + infill),
      // but it still takes the finish of ITS system — a black chain-link
      // gate is black, not galvanized gray.
      const gFill =
        cat === "vinyl"
          ? "#F1F1EA"
          : cat === "chain-link"
            ? style.face
            : metal
              ? style.post
              : // a cedar gate is cedar — same stock, same gradient as
                // the panels it hangs between
                "url(#f3d-wood)";
      const gStroke = style.stroke;
      const braceStroke = metal || cat === "chain-link" ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.22)";
      if (!f.isQuad) {
        return <path key={i} d={polyPath(f.poly)} fill={gFill} stroke={gStroke} strokeWidth={0.8} strokeLinejoin="round" />;
      }
      const [a, b, tb, ta] = f.poly;
      // Hardware and line work scale with the leaf's SCREEN height —
      // hinges on a distant gate used to render as fixed-radius black
      // balloons that swallowed the whole leaf.
      const gh = Math.hypot(ta.x - a.x, ta.y - a.y);
      const gsw = Math.max(0.4, Math.min(1.3, gh * 0.022));
      const hingeR = Math.max(0.45, Math.min(1.8, gh * 0.038));
      const leaves = f.face.leaves ?? 1;
      const leafEls: React.ReactNode[] = [];
      for (let k = 0; k < leaves; k++) {
        const s0 = k / leaves;
        const s1 = (k + 1) / leaves;
        const la = { x: a.x + (b.x - a.x) * s0, y: a.y + (b.y - a.y) * s0 };
        const lb = { x: a.x + (b.x - a.x) * s1, y: a.y + (b.y - a.y) * s1 };
        const lta = { x: ta.x + (tb.x - ta.x) * s0, y: ta.y + (tb.y - ta.y) * s0 };
        const ltb = { x: ta.x + (tb.x - ta.x) * s1, y: ta.y + (tb.y - ta.y) * s1 };
        // hinge side: outer edge of each leaf
        const hb = k === 0 ? la : lb;
        const ht = k === 0 ? lta : ltb;
        // Wood/vinyl leaves read as built boards, not blank slabs.
        const seams: React.ReactNode[] = [];
        const leafW = Math.hypot(lb.x - la.x, lb.y - la.y);
        if (!metal && cat !== "chain-link" && leafW >= 14) {
          const n = Math.max(3, Math.round(leafW / 7));
          for (let s = 1; s < n; s++) {
            const t2 = s / n;
            seams.push(
              <line
                key={`sm-${s}`}
                x1={la.x + (lb.x - la.x) * t2}
                y1={la.y + (lb.y - la.y) * t2}
                x2={lta.x + (ltb.x - lta.x) * t2}
                y2={lta.y + (ltb.y - lta.y) * t2}
                stroke="rgba(0,0,0,0.10)"
                strokeWidth={gsw * 0.7}
              />,
            );
          }
        }
        leafEls.push(
          <g key={k}>
            <path d={`M${la.x} ${la.y} L${lb.x} ${lb.y} L${ltb.x} ${ltb.y} L${lta.x} ${lta.y} Z`} fill={gFill} stroke={gStroke} strokeWidth={gsw} strokeLinejoin="round" />
            {seams}
            <line x1={la.x} y1={la.y} x2={ltb.x} y2={ltb.y} stroke={braceStroke} strokeWidth={gsw} />
            <line x1={lb.x} y1={lb.y} x2={lta.x} y2={lta.y} stroke={braceStroke} strokeWidth={gsw} />
            {gh >= 10 &&
              [0.2, 0.8].map((t2) => (
                <circle
                  key={t2}
                  cx={hb.x + (ht.x - hb.x) * t2}
                  cy={hb.y + (ht.y - hb.y) * t2}
                  r={hingeR}
                  fill="#4A4A52"
                />
              ))}
          </g>,
        );
      }
      return (
        <g key={i}>
          {leafEls}
          {leaves === 2 && (
            <line x1={(a.x + b.x) / 2} y1={(a.y + b.y) / 2} x2={(ta.x + tb.x) / 2} y2={(ta.y + tb.y) / 2} stroke={gStroke} strokeWidth={gsw} />
          )}
          {gh >= 10 && (
            <circle cx={(a.x + b.x + ta.x + tb.x) / 4} cy={(a.y + b.y + ta.y + tb.y) / 4} r={hingeR * 1.15} fill="#4A4A52" />
          )}
        </g>
      );
    }
    // panel — mixed-type sections swap in THAT fence's style
    const panelT = fenceType((f.face.alt?.id ?? typeId) as FenceTypeId);
    const st = f.face.alt ? styleOf(panelT) : style;
    const rc = f.face.alt?.rails ?? railCount;
    const cap = f.face.alt ? f.face.alt.cap : capRail;
    // Wood and vinyl take the material gradients — sun-warmed at the
    // top, grounded at the base — instead of one flat swatch.
    const pcat = f.face.alt?.cat ?? styleKey;
    const fill =
      pcat === "wood"
        ? f.face.shaded
          ? "url(#f3d-wood-sh)"
          : "url(#f3d-wood)"
        : pcat === "vinyl"
          ? f.face.shaded
            ? "url(#f3d-vinyl-sh)"
            : "url(#f3d-vinyl)"
          : f.face.shaded
            ? st.shade
            : st.face;
    if (!f.isQuad) {
      return <path key={i} d={polyPath(f.poly)} fill={fill} stroke={st.stroke} strokeWidth={0.7} strokeOpacity={0.45} strokeLinejoin="round" />;
    }
    const [a, b, tb, ta] = f.poly;
    const ftLen = f.face.baseLenPx / world.scale;
    const projW = Math.hypot(b.x - a.x, b.y - a.y) * lodK;
    // Screen height of this panel — every accent (rails, cap, ground
    // shadow, board seams) is sized from it, so line weights stay in
    // proportion whether the fence fills the frame or sits far away.
    const hPx = Math.max(4, Math.hypot(ta.x - a.x, ta.y - a.y));
    const u = Math.max(0.4, Math.min(1.6, hPx / 42));
    // Board / picket / bar counts come from the system's REAL pitch, not
    // a look-nice multiplier: 5½″ cedar pickets, 2″ chain-link diamonds,
    // ornamental pickets under the 4″ pool-code gap.
    const pspec = panelT.spec;
    const pitchIn = pspec.infillPitchIn ?? 6;
    const infillCount = Math.max(2, Math.round((ftLen * 12) / pitchIn));
    const atB = (s2: number): Pt => ({ x: a.x + (b.x - a.x) * s2, y: a.y + (b.y - a.y) * s2 });
    const atT = (s2: number): Pt => ({ x: ta.x + (tb.x - ta.x) * s2, y: ta.y + (tb.y - ta.y) * s2 });
    const sliceD = (s0: number, s1: number): string => {
      const p0 = atB(s0);
      const p1 = atB(s1);
      const q1 = atT(s1);
      const q0 = atT(s0);
      return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${q1.x.toFixed(1)} ${q1.y.toFixed(1)} L${q0.x.toFixed(1)} ${q0.y.toFixed(1)} Z`;
    };
    const seed = f.face.pts[0].x * 1.7 + f.face.pts[0].y * 0.9;
    const details: React.ReactNode[] = [];
    const detailKind = TYPE_DETAIL[f.face.alt?.id ?? (typeId as string)];
    const hFt = f.face.hFt ?? 6;

    if (detailKind === "hboards") {
      // Horizontal-modern: 1×6 slats stacked up the bay at a ¾″ reveal —
      // a 6' fence is ~11 boards, not a decorative half-dozen.
      const m = Math.max(3, Math.min(18, Math.round((hFt * 12) / pitchIn)));
      const boardH = hPx / m;
      const els: React.ReactNode[] = [];
      for (let j = 0; j < m; j++) {
        const t0 = j / m;
        const t1 = (j + 1) / m - 0.05;
        const h = hash2(Math.round(seed + j * 31.7), Math.round(seed - j * 17.3));
        const bl0 = { x: a.x + (ta.x - a.x) * t0, y: a.y + (ta.y - a.y) * t0 };
        const br0 = { x: b.x + (tb.x - b.x) * t0, y: b.y + (tb.y - b.y) * t0 };
        const br1 = { x: b.x + (tb.x - b.x) * t1, y: b.y + (tb.y - b.y) * t1 };
        const bl1 = { x: a.x + (ta.x - a.x) * t1, y: a.y + (ta.y - a.y) * t1 };
        // Slats out of the same lift still land a shade apart — some
        // heartwood-dark, some sap-light, a few with a red cast. The
        // spread is what separates real cedar from a painted band.
        const tone =
          h < 0.3
            ? "rgba(86,50,18,0.28)"
            : h > 0.72
              ? "rgba(255,222,164,0.26)"
              : h > 0.44 && h < 0.56
                ? "rgba(158,82,28,0.2)"
                : "rgba(0,0,0,0.03)";
        els.push(
          <path
            key={`hb-${j}`}
            d={`M${bl0.x.toFixed(1)} ${bl0.y.toFixed(1)} L${br0.x.toFixed(1)} ${br0.y.toFixed(1)} L${br1.x.toFixed(1)} ${br1.y.toFixed(1)} L${bl1.x.toFixed(1)} ${bl1.y.toFixed(1)} Z`}
            fill={tone}
          />,
        );
        // The ¾″ reveal between slats is a shadow slot, not an outline —
        // and each slat's top edge catches the sun above it.
        if (j > 0) {
          els.push(
            <line
              key={`gap-${j}`}
              x1={bl0.x}
              y1={bl0.y}
              x2={br0.x}
              y2={br0.y}
              stroke="rgba(26,15,6,0.38)"
              strokeWidth={Math.max(0.4, Math.min(1.6, boardH * 0.12))}
            />,
          );
        }
        if (boardH >= 3.5) {
          els.push(
            <line
              key={`hl-${j}`}
              x1={bl1.x}
              y1={bl1.y}
              x2={br1.x}
              y2={br1.y}
              stroke="rgba(255,232,188,0.22)"
              strokeWidth={Math.max(0.35, boardH * 0.09)}
            />,
          );
        }
      }
      return (
        <g key={i}>
          <path d={polyPath(f.poly)} fill={fill} stroke={st.stroke} strokeOpacity={0.35} strokeWidth={0.5 * u} strokeLinejoin="round" />
          {els}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(18,22,15,0.26)" strokeWidth={Math.max(0.8, Math.min(3, hPx * 0.05))} />
        </g>
      );
    }

    if (detailKind === "spaced") {
      // Picket fence: individual pickets with REAL gaps — the backer
      // rails and the yard show through, exactly how it's built.
      const np = infillCount;
      const pw = projW / np;
      const isWoodPk = (f.face.alt?.cat ?? styleKey) === "wood";
      const pkFill = isWoodPk && f.face.shaded ? "#96683A" : st.face;
      const lift = 0.05; // pickets stop just above grade
      const els: React.ReactNode[] = [];
      const pkRailW = Math.max(1, Math.min(2.8, hPx * 0.05));
      for (const s2 of [0.28, 0.78]) {
        els.push(
          <line
            key={`rl-${s2}`}
            x1={a.x + (ta.x - a.x) * s2}
            y1={a.y + (ta.y - a.y) * s2}
            x2={b.x + (tb.x - b.x) * s2}
            y2={b.y + (tb.y - b.y) * s2}
            stroke={st.post}
            strokeWidth={pkRailW}
            strokeLinecap="round"
          />,
        );
      }
      if (pw >= 1.5) {
        // Picket face over pitch — a 1×4 on 6″ centers covers 58%, so
        // the gap the client sees through is the gap they'll get.
        const duty = Math.min(0.9, (panelT.picketWidthIn ?? pitchIn * 0.58) / pitchIn);
        for (let k = 0; k < np; k++) {
          const c0 = k / np + (1 - duty) / 2 / np;
          const c1 = c0 + duty / np;
          const h = hash2(Math.round(seed + k * 23.1), Math.round(seed * 0.7 + k * 11.9));
          const b0 = atB(c0);
          const b1 = atB(c1);
          const q1 = atT(c1);
          const q0 = atT(c0);
          const p0 = { x: b0.x + (q0.x - b0.x) * lift, y: b0.y + (q0.y - b0.y) * lift };
          const p1 = { x: b1.x + (q1.x - b1.x) * lift, y: b1.y + (q1.y - b1.y) * lift };
          if (isWoodPk) {
            const sh = 0.12;
            const s0 = { x: q0.x + (p0.x - q0.x) * sh, y: q0.y + (p0.y - q0.y) * sh };
            const s1 = { x: q1.x + (p1.x - q1.x) * sh, y: q1.y + (p1.y - q1.y) * sh };
            const apex = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
            els.push(
              <path
                key={`pk-${k}`}
                d={`M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${s1.x.toFixed(1)} ${s1.y.toFixed(1)} L${apex.x.toFixed(1)} ${apex.y.toFixed(1)} L${s0.x.toFixed(1)} ${s0.y.toFixed(1)} Z`}
                fill={h > 0.72 ? "#C89253" : h < 0.24 ? "#A06B34" : pkFill}
                stroke={st.stroke}
                strokeOpacity={0.55}
                strokeWidth={0.4 * u}
                strokeLinejoin="round"
              />,
            );
          } else {
            els.push(
              <path
                key={`pk-${k}`}
                d={`M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${q1.x.toFixed(1)} ${q1.y.toFixed(1)} L${q0.x.toFixed(1)} ${q0.y.toFixed(1)} Z`}
                fill={pkFill}
                stroke={st.stroke}
                strokeOpacity={0.55}
                strokeWidth={0.4 * u}
                strokeLinejoin="round"
              />,
            );
          }
        }
      } else {
        els.push(<path key="wash" d={polyPath(f.poly)} fill={pkFill} opacity={0.55} />);
      }
      return (
        <g key={i}>
          {els}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(20,26,18,0.2)" strokeWidth={Math.max(0.7, Math.min(2.2, hPx * 0.04))} />
        </g>
      );
    }

    if (detailKind === "shadowbox") {
      // Good-neighbor stagger: shaded back boards behind, proud front
      // boards with gaps that let the back layer read through.
      const boards = infillCount;
      const bw = projW / boards;
      const els: React.ReactNode[] = [
        <path key="back" d={polyPath(f.poly)} fill={st.shade} stroke={st.stroke} strokeOpacity={0.35} strokeWidth={0.5 * u} strokeLinejoin="round" />,
      ];
      if (bw >= 2.6) {
        for (let k = 0; k < boards; k++) {
          const c0 = k / boards;
          const c1 = Math.min(1, c0 + 0.62 / boards);
          const h = hash2(Math.round(seed + k * 19.3), Math.round(seed - k * 9.1));
          els.push(
            <path key={`fb-${k}`} d={sliceD(c0, c1)} fill={h > 0.6 ? "#C68F4E" : h < 0.22 ? "#A26D35" : st.face} stroke="rgba(74,49,21,0.4)" strokeWidth={0.4 * u} />,
          );
        }
      }
      els.push(<line key="ao" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(18,22,15,0.26)" strokeWidth={Math.max(0.8, Math.min(3, hPx * 0.05))} />);
      if (cap) {
        els.push(<line key="cap" x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke={st.post} strokeWidth={Math.max(1, Math.min(2.8, hPx * 0.05))} strokeLinecap="round" />);
      }
      return <g key={i}>{els}</g>;
    }

    if (detailKind === "bob") {
      // Board-on-board: a dark under-course with over-boards lapped at
      // the half pitch — the double layer reads at any zoom.
      const boards = infillCount;
      const bw = projW / boards;
      if (bw >= 2.4) {
        for (let k = 0; k < boards; k++) {
          details.push(<path key={`ub-${k}`} d={sliceD(k / boards, Math.min(1, (k + 0.55) / boards))} fill="rgba(60,36,14,0.18)" />);
        }
        for (let k = 0; k < boards; k++) {
          const c = (k + 0.5) / boards;
          if (c >= 1) continue;
          const h = hash2(Math.round(seed + k * 27.7), Math.round(seed + k * 5.3));
          details.push(
            <path key={`ob-${k}`} d={sliceD(Math.max(0, c - 0.06 / boards), Math.min(1, c + 0.61 / boards))} fill={h > 0.55 ? "#C68F4E" : "#AD7639"} stroke="rgba(74,49,21,0.4)" strokeWidth={0.4 * u} />,
          );
        }
      } else {
        const n = Math.max(2, Math.min(boards, Math.floor(projW / 2.6)));
        for (let k = 1; k < n; k++) {
          const sp = atB(k / n);
          const sq = atT(k / n);
          details.push(<line key={`s-${k}`} x1={sp.x} y1={sp.y} x2={sq.x} y2={sq.y} stroke="rgba(0,0,0,0.08)" strokeWidth={0.55 * u} />);
        }
      }
    } else if (st.lines === "rails") {
      // split-rail / ranch — chunky rounded rails with a sun highlight
      const rails: React.ReactNode[] = [];
      for (let r = 1; r <= rc; r++) {
        const s2 = r / (rc + 1);
        const rA = { x: a.x + (ta.x - a.x) * s2, y: a.y + (ta.y - a.y) * s2 };
        const rB = { x: b.x + (tb.x - b.x) * s2, y: b.y + (tb.y - b.y) * s2 };
        rails.push(
          <line key={r} x1={rA.x} y1={rA.y} x2={rB.x} y2={rB.y} stroke={fill} strokeWidth={4.4} strokeLinecap="round" />,
          <line key={`hl-${r}`} x1={rA.x} y1={rA.y - 1.1} x2={rB.x} y2={rB.y - 1.1} stroke="rgba(255,244,214,0.28)" strokeWidth={1} strokeLinecap="round" />,
        );
      }
      return <g key={i}>{rails}</g>;
    }

    if (st.lines === "pickets" && !detailKind) {
      // Wood reads as WOOD: ~6-inch boards with per-board tone variation
      // and occasional grain streaks — board counts derive from real feet.
      // Seams are hairlines BETWEEN boards, not outlines around each one:
      // outlined boards at distance collapse into a barcode of dark bars.
      const boards = infillCount;
      const bw = projW / boards;
      if (bw >= 2.4) {
        const seamW = Math.max(0.3, Math.min(0.8, bw * 0.12)) * u;
        for (let k = 0; k < boards; k++) {
          const s0 = k / boards;
          const s1 = (k + 1) / boards;
          const h = hash2(Math.round(seed + k * 13.7), Math.round(seed * 0.6 - k * 7.3));
          // Two scales of variation: boards from the same bundle drift
          // together (the slow hash over groups of four), and each board
          // adds its own cast on top. One scale alone reads as noise or
          // as paint; both together read as lumber.
          const hg = hash2(Math.round(seed * 0.41 + Math.floor(k / 4) * 89.7), Math.round(seed * 1.13));
          if (hg < 0.3) details.push(<path key={`bg-${k}`} d={sliceD(s0, s1)} fill="rgba(76,45,16,0.1)" />);
          else if (hg > 0.74) details.push(<path key={`bg-${k}`} d={sliceD(s0, s1)} fill="rgba(255,228,182,0.1)" />);
          if (h < 0.3) details.push(<path key={`b-${k}`} d={sliceD(s0, s1)} fill="rgba(76,45,16,0.2)" />);
          else if (h > 0.74) details.push(<path key={`b-${k}`} d={sliceD(s0, s1)} fill="rgba(255,228,182,0.2)" />);
          else if (h > 0.44 && h < 0.52) details.push(<path key={`b-${k}`} d={sliceD(s0, s1)} fill="rgba(152,76,26,0.14)" />);
          if (k > 0) {
            const sp = atB(s0);
            const sq = atT(s0);
            details.push(<line key={`s-${k}`} x1={sp.x} y1={sp.y} x2={sq.x} y2={sq.y} stroke="rgba(30,18,6,0.2)" strokeWidth={seamW} />);
          }
          if (bw >= 5 && h > 0.38 && h < 0.6) {
            const sm = s0 + (s1 - s0) * (0.3 + h * 0.45);
            const gp = atB(sm);
            const gq = atT(sm);
            details.push(
              <line key={`g-${k}`} x1={gp.x + (gq.x - gp.x) * 0.15} y1={gp.y + (gq.y - gp.y) * 0.15} x2={gp.x + (gq.x - gp.x) * 0.78} y2={gp.y + (gq.y - gp.y) * 0.78} stroke="rgba(56,34,12,0.16)" strokeWidth={0.7 * u} />,
            );
          }
        }
      } else if (bw >= 1.1) {
        // Too small for per-board seams — a few whisper lines keep the
        // texture read without turning the panel into stripes.
        const n = Math.max(2, Math.min(boards, Math.floor(projW / 3.2)));
        for (let k = 1; k < n; k++) {
          const sp = atB(k / n);
          const sq = atT(k / n);
          details.push(<line key={`s-${k}`} x1={sp.x} y1={sp.y} x2={sq.x} y2={sq.y} stroke="rgba(0,0,0,0.06)" strokeWidth={0.5 * u} />);
        }
      }
      // Only the back side shows backer rails — the street side of a
      // privacy fence is clean boards, exactly as built.
      if (f.face.shaded) {
        const railW = Math.max(1, Math.min(3.2, hPx * 0.052));
        for (const s2 of [0.14, 0.5, 0.86]) {
          details.push(
            <line
              key={`rail-${s2}`}
              x1={a.x + (ta.x - a.x) * s2}
              y1={a.y + (ta.y - a.y) * s2}
              x2={b.x + (tb.x - b.x) * s2}
              y2={b.y + (tb.y - b.y) * s2}
              stroke="rgba(58,38,15,0.4)"
              strokeWidth={railW}
            />,
          );
        }
      }
    } else if (st.lines === "bars") {
      // Ornamental is mostly AIR — you see dark pickets against the yard,
      // not a dark slab. So the pickets are the drawn thing: ¾″ tubes on
      // 4⅝″ centers, dark, with the lawn showing between them.
      const bars = infillCount;
      const n = Math.max(3, Math.min(bars, Math.floor(projW / 2.4)));
      const barW = Math.max(0.9, Math.min(2.4, (projW / n) * 0.34));
      const showFinials = projW / n >= 5;
      for (let k = 1; k < n; k++) {
        const s2 = k / n;
        const bp = atB(s2);
        const bq = atT(s2);
        details.push(
          <line key={`bar-${k}`} x1={bp.x} y1={bp.y} x2={bq.x} y2={bq.y} stroke={st.post} strokeWidth={barW} />,
        );
        if (showFinials) {
          details.push(
            <circle key={`fin-${k}`} cx={bq.x + (bq.x - bp.x) * 0.05} cy={bq.y + (bq.y - bp.y) * 0.05} r={barW * 0.8} fill={st.post} />,
          );
        }
      }
      // Top and bottom channel rails carry the pickets.
      const chRailW = Math.max(1, Math.min(2.4, hPx * 0.045));
      for (const s2 of [0.07, 0.9]) {
        details.push(
          <line key={`rl-${s2}`} x1={a.x + (ta.x - a.x) * s2} y1={a.y + (ta.y - a.y) * s2} x2={b.x + (tb.x - b.x) * s2} y2={b.y + (tb.y - b.y) * s2} stroke={st.post} strokeWidth={chRailW} strokeLinecap="round" />,
        );
      }
    } else if (st.lines === "mesh") {
      // Chain link — 2″ fabric woven at a true 45°, so the wire climbs
      // the panel in the same feet it travels along it. (The old fixed
      // 18% slant drew stretched cross-hatch, not diamonds.) Galvanized
      // top rail above, 7-ga tension wire along the bottom.
      const meshIn = pspec.meshDiamondIn ?? 2;
      const runFt = Math.max(0.5, ftLen);
      const slant = hFt / runFt; // 45° expressed in panel-normalized space
      // Diagonals at 45° cross the bottom edge every mesh×√2 inches.
      const want = Math.ceil((runFt * 12) / (meshIn * Math.SQRT2));
      const n = Math.max(4, Math.min(want, Math.floor(projW / 2.2)));
      const step = 1 / n;
      /** Panel-normalized (along, up) → screen. */
      const at2 = (s2: number, t2: number): Pt => {
        const bp = atB(s2);
        const tp = atT(s2);
        return { x: bp.x + (tp.x - bp.x) * t2, y: bp.y + (tp.y - bp.y) * t2 };
      };
      const spread = Math.ceil(slant * n);
      for (const dir of [1, -1] as const) {
        for (let k = -spread; k <= n + spread; k++) {
          const s0 = k * step; // where this wire meets the bottom edge
          const d = dir * slant;
          let tLo = 0;
          let tHi = 1;
          if (Math.abs(d) > 1e-6) {
            const tA = -s0 / d;
            const tB = (1 - s0) / d;
            tLo = Math.max(0, Math.min(tA, tB));
            tHi = Math.min(1, Math.max(tA, tB));
          }
          if (tHi - tLo < 0.02) continue;
          const p0 = at2(s0 + d * tLo, tLo);
          const p1 = at2(s0 + d * tHi, tHi);
          details.push(
            <line
              key={`m${dir}-${k}`}
              x1={p0.x.toFixed(1)}
              y1={p0.y.toFixed(1)}
              x2={p1.x.toFixed(1)}
              y2={p1.y.toFixed(1)}
              stroke={st.mesh ?? "rgba(88,98,106,0.46)"}
              strokeWidth={0.8}
            />,
          );
        }
      }
      details.push(
        <line key="toprail" x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke={st.rail ?? "#9AA3AA"} strokeWidth={Math.max(1, Math.min(2.4, hPx * 0.045))} strokeLinecap="round" />,
        <line key="tension" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={st.rail ?? "#8B949B"} strokeWidth={0.8 * u} />,
      );
    } else if (panelT.category === "vinyl") {
      // Vinyl — tongue-and-groove seams at the real 6″ board pitch.
      const n = Math.max(2, Math.min(infillCount, Math.floor(projW / 4)));
      for (let k = 1; k < n; k++) {
        const vp = atB(k / n);
        const vq = atT(k / n);
        details.push(<line key={`v-${k}`} x1={vp.x} y1={vp.y} x2={vq.x} y2={vq.y} stroke="rgba(0,0,0,0.05)" strokeWidth={0.7 * u} />);
      }
    }

    // Whole bays weather a half-shade apart — from across the yard that
    // slow drift is ALL the texture you can resolve, and without it a
    // long run flattens into one continuous painted ribbon.
    const bayH = hash2(Math.round(seed * 0.37), Math.round(seed * 1.91));
    const bayTone =
      pcat === "wood"
        ? bayH < 0.3
          ? "rgba(70,42,16,0.08)"
          : bayH > 0.72
            ? "rgba(255,226,180,0.09)"
            : null
        : null;
    return (
      <g key={i}>
        <path d={polyPath(f.poly)} fill={fill} stroke={st.stroke} strokeOpacity={0.35} strokeWidth={0.5 * u} strokeLinejoin="round" />
        {bayTone && <path d={polyPath(f.poly)} fill={bayTone} />}
        {details}
        {/* contact shadow where boards meet grass — soft spill, hard core */}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(20,26,18,0.1)" strokeWidth={Math.max(1.4, Math.min(5, hPx * 0.085))} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(18,22,15,0.26)" strokeWidth={Math.max(0.8, Math.min(3, hPx * 0.05))} />
        {pcat === "wood" && !cap && (
          /* sun rakes across the open board tops */
          <line x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke="rgba(255,236,196,0.32)" strokeWidth={Math.max(0.5, Math.min(1.8, hPx * 0.025))} strokeLinecap="round" />
        )}
        {cap && (
          <g>
            {/* A 2×6 cap rail is a BOARD laid flat across the tops, and
                in a photo it's the line your eye follows down the run.
                Body, then the sun on its upper face. */}
            <line x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke={st.post} strokeWidth={Math.max(1, Math.min(5, hPx * 0.062))} strokeLinecap="round" />
            <line x1={ta.x} y1={ta.y - Math.max(0.5, hPx * 0.02)} x2={tb.x} y2={tb.y - Math.max(0.5, hPx * 0.02)} stroke="rgba(255,242,214,0.45)" strokeWidth={Math.max(0.4, hPx * 0.018)} strokeLinecap="round" />
          </g>
        )}
      </g>
    );
  };

  /** Muted elevation tag on a major contour — quiet by design; the pink
   *  chips are for things the client buys (gates), not the landscape. */
  const elevChip = (l: { text: string; at: Pt }, i: number, unscale = 1) => {
    const w = l.text.length * 5 + 10;
    return (
      <g key={`ev-${i}`} transform={unscale !== 1 ? `translate(${l.at.x} ${l.at.y}) scale(${unscale}) translate(${-l.at.x} ${-l.at.y})` : undefined}>
        <rect x={l.at.x - w / 2} y={l.at.y - 8} width={w} height={14} rx={7} fill="rgba(255,255,255,0.82)" stroke="rgba(58,92,56,0.4)" strokeWidth={0.8} />
        <text x={l.at.x} y={l.at.y + 2.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#3D5C3B">
          {l.text}
        </text>
      </g>
    );
  };

  const labelChip = (l: { text: string; at: Pt }, i: number, unscale = 1) => {
    const w = l.text.length * 6.4 + 16;
    return (
      <g key={i} transform={unscale !== 1 ? `translate(${l.at.x} ${l.at.y}) scale(${unscale}) translate(${-l.at.x} ${-l.at.y})` : undefined}>
        <line x1={l.at.x} y1={l.at.y} x2={l.at.x} y2={l.at.y + 9} stroke="#DB2777" strokeWidth={1.2} />
        <rect x={l.at.x - w / 2} y={l.at.y - 20} width={w} height={20} rx={10} fill="rgba(255,255,255,0.95)" stroke="#DB2777" strokeWidth={1.2} />
        <text x={l.at.x} y={l.at.y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#9D174D">
          {l.text}
        </text>
      </g>
    );
  };

  const walking = mode === "walk" && walkScene;
  // The strip is worth showing only when there is somewhere to go.
  const showShots = shotList.length > 1 && interaction !== "locked";
  const isDefaultView =
    Math.abs(view.yawDeg - DEFAULT_YAW_DEG) < 0.5 &&
    Math.abs(view.squash - DEFAULT_SQUASH) < 0.005 &&
    zoomCam.k === 1;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-zinc-200", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={cn(
          "block h-full w-full",
          !canOrbit
            ? "cursor-default"
            : walking
              ? "cursor-move"
              : "cursor-grab active:cursor-grabbing",
        )}
        // A locked view must not swallow touch scrolling — the client is
        // reading a proposal on a phone and needs the page to move.
        style={{ touchAction: canOrbit ? "none" : "auto" }}
        role="img"
        aria-label={
          canOrbit
            ? `3D preview of the ${label} fence as designed — drag to orbit, click a spot to walk`
            : interaction === "guided"
              ? `3D preview of the ${label} fence as designed — choose a saved angle to view it from another side`
              : `3D preview of the ${label} fence as designed`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (modeRef.current !== "orbit" || !canOrbit) return;
          const s2 = toView(e.clientX, e.clientY);
          const z0 = zoomRef.current;
          // World point under the cursor → put it at the view center,
          // one comfortable zoom step closer.
          zoomTo(
            Math.min(ZOOM_MAX, z0.k * 1.6),
            (s2.x - z0.tx) / z0.k,
            (s2.y - z0.ty) / z0.k,
            VIEW_W / 2,
            VIEW_H / 2,
          );
        }}
      >
        <defs>
          <linearGradient id="f3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9DEEF" />
            <stop offset="46%" stopColor="#E9EEDB" />
            <stop offset="100%" stopColor="#CFD8BE" />
          </linearGradient>
          <linearGradient id="f3d-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#AFD3EE" />
            <stop offset="100%" stopColor="#E6F1E6" />
          </linearGradient>
          <linearGradient id="f3d-earth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C7DBBD" />
            <stop offset="100%" stopColor="#A9C29B" />
          </linearGradient>
          <radialGradient id="f3d-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="rgba(255,246,214,0.9)" />
            <stop offset="45%" stopColor="rgba(255,246,214,0.35)" />
            <stop offset="100%" stopColor="rgba(255,246,214,0)" />
          </radialGradient>
          {/* Material gradients — sun-bleached tops fading to richer
              bases give flat SVG quads the depth a single fill can't. */}
          <linearGradient id="f3d-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D19A58" />
            <stop offset="45%" stopColor="#BB7F45" />
            <stop offset="100%" stopColor="#8F5C29" />
          </linearGradient>
          <linearGradient id="f3d-wood-sh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9A6A34" />
            <stop offset="50%" stopColor="#845727" />
            <stop offset="100%" stopColor="#623F1B" />
          </linearGradient>
          <linearGradient id="f3d-vinyl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FCFCF8" />
            <stop offset="100%" stopColor="#E9E9DE" />
          </linearGradient>
          <linearGradient id="f3d-vinyl-sh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E8E8E0" />
            <stop offset="100%" stopColor="#CBCBBB" />
          </linearGradient>
          <linearGradient id="f3d-wall-lit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5F1E9" />
            <stop offset="100%" stopColor="#E3DCCE" />
          </linearGradient>
          <linearGradient id="f3d-wall-sh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E4DED1" />
            <stop offset="100%" stopColor="#CDC5B5" />
          </linearGradient>
          <linearGradient id="f3d-roof-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7B828F" />
            <stop offset="100%" stopColor="#646B78" />
          </linearGradient>
          {/* The terrain lattice is honest geometry but hard-edged quads
              read as a board game, not land. Feathering ONLY the ground
              layer melts the facets into continuous shaded relief; the
              blur counter-scales with zoom so the softness stays a
              constant couple of screen pixels instead of smearing at 8×.
              Contours, shadows and the fence render above, un-blurred. */}
          <filter id="f3d-terra" x="-4%" y="-4%" width="108%" height="108%">
            <feGaussianBlur stdDeviation={Math.max(1.2, world.groundStepPx * 0.42)} />
          </filter>
          {orbitScene?.groundClip && (
            <clipPath id="f3d-terra-clip">
              <polygon points={orbitScene.groundClip.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
            </clipPath>
          )}
        </defs>

        {walking ? (
          <>
            {/* sky above the horizon, warm ground tone below */}
            <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-sky)" />
            <circle cx={VIEW_W * 0.78} cy={Math.min(walkScene!.horizon - 60, 120)} r={90} fill="url(#f3d-sun)" />
            <rect x={0} y={Math.max(0, walkScene!.horizon)} width={VIEW_W} height={Math.max(0, VIEW_H - walkScene!.horizon)} fill="#A9C29B" />
            <g filter="url(#f3d-terra)">{walkScene!.faces.filter((f) => f.face.kind === "ground").map(renderFace)}</g>
            <g>{walkScene!.faces.filter((f) => f.face.kind === "contour" || f.face.kind === "shadow").map(renderFace)}</g>
            <g>{walkScene!.faces.filter((f) => f.face.kind !== "ground" && f.face.kind !== "shadow" && f.face.kind !== "contour").map(renderFace)}</g>
            {walkScene!.elevLabels.map((l, i) => elevChip(l, i))}
            {walkScene!.labels.map((l, i) => labelChip(l, i))}
          </>
        ) : (
          <>
            <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-bg)" />
            <circle cx={VIEW_W * 0.8} cy={70} r={110} fill="url(#f3d-sun)" />
            <g transform={`translate(${zoomCam.tx} ${zoomCam.ty}) scale(${zoomCam.k})`}>
              <g filter="url(#f3d-terra)" clipPath={orbitScene.groundClip ? "url(#f3d-terra-clip)" : undefined}>
                {orbitScene.faces.filter((f) => f.face.kind === "ground").map(renderFace)}
              </g>
              <g>{orbitScene.faces.filter((f) => f.face.kind === "contour" || f.face.kind === "shadow").map(renderFace)}</g>
              <g>{orbitScene.faces.filter((f) => f.face.kind !== "ground" && f.face.kind !== "shadow" && f.face.kind !== "contour").map(renderFace)}</g>
              {orbitScene.rings.map((ring, i) => {
                const pts = ring.map((p) => `${p.x},${p.y}`).join(" ");
                // Dash lengths live in world units, so zoom would blow
                // them into slabs — counter-scale them. White boundary
                // over a dark casing stays readable on light lawn and
                // shaded slopes alike, at any zoom.
                const dash = `${7 / zoomCam.k} ${5 / zoomCam.k}`;
                return (
                  <g key={i}>
                    <polygon
                      points={pts}
                      fill="none"
                      stroke="rgba(30,44,32,0.5)"
                      strokeWidth={5}
                      strokeDasharray={dash}
                      vectorEffect="non-scaling-stroke"
                    />
                    <polygon
                      points={pts}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={2.4}
                      strokeDasharray={dash}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.95}
                    />
                  </g>
                );
              })}
              {orbitScene.elevLabels
                .filter((l) => {
                  // A chip clipped by the frame is noise, not information.
                  const sx = l.at.x * zoomCam.k + zoomCam.tx;
                  const sy = l.at.y * zoomCam.k + zoomCam.ty;
                  return sx > 36 && sx < VIEW_W - 36 && sy > 20 && sy < VIEW_H - 14;
                })
                .map((l, i) => elevChip(l, i, 1 / zoomCam.k))}
              {orbitScene.labels.map((l, i) => labelChip(l, i, 1 / zoomCam.k))}
              {orbitScene.marker && (
                <g stroke="#52525B" strokeWidth={1.2} fill="none">
                  <line x1={orbitScene.marker.base.x - 14} y1={orbitScene.marker.base.y} x2={orbitScene.marker.base.x - 14} y2={orbitScene.marker.top.y} />
                  <line x1={orbitScene.marker.base.x - 18} y1={orbitScene.marker.base.y} x2={orbitScene.marker.base.x - 10} y2={orbitScene.marker.base.y} />
                  <line x1={orbitScene.marker.base.x - 18} y1={orbitScene.marker.top.y} x2={orbitScene.marker.base.x - 10} y2={orbitScene.marker.top.y} />
                  <g stroke="none" fill="#3F3F46">
                    <text x={orbitScene.marker.base.x - 22} y={(orbitScene.marker.base.y + orbitScene.marker.top.y) / 2 + 4} textAnchor="end" fontSize={12} fontWeight={700}>
                      {heightFt}′
                    </text>
                  </g>
                </g>
              )}
            </g>
          </>
        )}
      </svg>

      {/* mode controls */}
      <div className="absolute inset-x-3 top-3 flex flex-wrap items-center justify-end gap-1.5">
        {walking ? (
          <button
            type="button"
            onClick={() => setMode("orbit")}
            className={`transition-smooth ring-focus whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white`}
          >
            ✕ Exit walk (Esc)
          </button>
        ) : (
          <>
            {/* Builder-only: freeze the live camera (zoom included) as a
                named shot the client will get. */}
            {onCapture && (
              <button
                type="button"
                onClick={() =>
                  onCapture(
                    viewRef.current,
                    zoomRef.current.k > 1 ? zoomRef.current : null,
                  )
                }
                className={`transition-smooth ring-focus whitespace-nowrap shrink-0 rounded-full bg-accent-600 ${pillCls} font-semibold text-white shadow-sm ring-1 ring-accent-500 hover:bg-accent-700`}
              >
                📌 Save this angle
              </button>
            )}
            {canOrbit && !isDefaultView && (
              <button
                type="button"
                onClick={() => {
                  const v = { yawDeg: DEFAULT_YAW_DEG, squash: DEFAULT_SQUASH };
                  setView(v);
                  setZoomCam({ k: 1, tx: 0, ty: 0 });
                  onViewChange?.(v);
                }}
                className={`transition-smooth ring-focus whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white`}
              >
                Reset view
              </button>
            )}
            {canWalk && (
              <button
                type="button"
                onClick={() => enterWalk()}
                className={`transition-smooth ring-focus whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-accent-800 shadow-sm ring-1 ring-accent-200 hover:bg-white`}
              >
                🚶 Walk the yard
              </button>
            )}
            {canOrbit && (
              <span className="inline-flex overflow-hidden rounded-full bg-white/90 shadow-sm ring-1 ring-zinc-200">
                {(
                  [
                    { id: "move" as const, label: "✋ Move" },
                    { id: "spin" as const, label: "↻ Spin" },
                  ]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={dragMode === m.id}
                    onClick={() => pickDragMode(m.id)}
                    className={cn(
                      "transition-smooth ring-focus font-semibold",
                      pillCls,
                      dragMode === m.id
                        ? "bg-accent-600 text-white"
                        : "text-zinc-600 hover:bg-zinc-100",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </span>
            )}
            {canOrbit && !compactUi ? (
              <>
                {/* Same gestures, named the way each input actually does
                    them — the phone has no scroll wheel. On a compact
                    canvas the hint is clutter, not help: gestures still
                    work, the pills were covering the fence. */}
                <span className="pointer-events-none rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200 sm:hidden">
                  {dragMode === "move"
                    ? "Drag to move · pinch to zoom · tap to walk"
                    : "Drag to spin · pinch to zoom · tap to walk"}
                </span>
                <span className="pointer-events-none hidden rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200 sm:inline">
                  {dragMode === "move"
                    ? "Drag to move · ⇧ drag to spin · scroll to zoom · double-click to zoom in · click to walk"
                    : "Drag to spin · ⇧ drag to move · scroll to zoom · double-click to zoom in · click to walk"}
                </span>
              </>
            ) : interaction === "guided" && showShots && !compactUi ? (
              <span className="pointer-events-none hidden rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200 sm:inline">
                Tap an angle below to view from that side
              </span>
            ) : null}
          </>
        )}
      </div>

      {/* Saved angles — the contractor's shot list. Tapping flies the
          camera; this is the client's way "around" the fence in guided
          mode and a set of bookmarks in free mode. */}
      {showShots && !walking && (
        <div
          className={
            compactUi
              ? "absolute inset-x-3 top-11 flex flex-nowrap gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "absolute inset-x-3 top-12 flex flex-wrap justify-end gap-1.5"
          }
        >
          {shotList.map((s) => {
            const active = s.id === activeShotId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectShot(s)}
                aria-pressed={active}
                className={cn(
                  `transition-smooth ring-focus whitespace-nowrap shrink-0 whitespace-nowrap shrink-0 rounded-full ${pillCls} font-semibold shadow-sm ring-1`,
                  active
                    ? "bg-accent-600 text-white ring-accent-500"
                    : "bg-white/90 text-zinc-700 ring-zinc-200 hover:bg-white",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* client-readable summary chips — on a compact canvas: ONE
          scrollable line, primary chips only (the scope sheet below the
          fold carries the full story now). */}
      <div
        className={
          compactUi
            ? "absolute bottom-2 left-2 right-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5"
        }
      >
        {walking ? (
          <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200`}>
            W A S D / arrows to walk · Shift to hurry · drag to look around
          </span>
        ) : (
          <>
            <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200`}>
              {label} — to scale
            </span>
            {gateCount > 0 && (
              <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-pink-700 shadow-sm ring-1 ring-pink-200`}>
                {gateCount} {gateCount === 1 ? "gate" : "gates"}
              </span>
            )}
            {steppedCount > 0 && (
              <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-accent-700 shadow-sm ring-1 ring-accent-200`}>
                ⛰ {steppedCount} sections step down the slope
              </span>
            )}
            {wallCount > 0 && !compactUi && (
              <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-stone-700 shadow-sm ring-1 ring-stone-300`}>
                🧱 {wallCount} {wallCount === 1 ? "section mounts" : "sections mount"} on the retaining wall
              </span>
            )}
            {hasSurface && contourIntervalFt > 0 && !compactUi && (
              <span className={`whitespace-nowrap shrink-0 rounded-full bg-white/90 ${pillCls} font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200`}>
                ⛰ {reliefFt}′ of rise · contour lines every {contourIntervalFt}′
                {reliefFt >= heightFt * 5 ? " · hill softened to keep the fence readable" : ""}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
