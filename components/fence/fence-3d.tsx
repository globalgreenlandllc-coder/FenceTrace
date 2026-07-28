"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import { rackingLimitFt, WALL_RISE_FT } from "@/lib/fence/slope";
import {
  CANVAS_H,
  CANVAS_W,
  runDistanceModel,
  type RunElevationModel,
} from "@/lib/fence/geo";

/**
 * Fence3D — a to-scale preview of the drawn fence, hand-rolled in SVG
 * (no 3D library: deterministic, fast, prints cleanly in the proposal
 * PDF and the client portal).
 *
 * One WORLD model (fence faces, terrain cells, trees — all in plan px +
 * height px), two cameras:
 *  - ORBIT: axonometric bird's-eye. Drag spins/tilts, wheel zooms
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
const DEFAULT_YAW_DEG = -28;
const DEFAULT_SQUASH = 0.52;
const HEIGHT_EXAGGERATION = 1.3; // readability: fences are long + short
const GATE_SNAP_PX = 30; // gates farther than this from every run are ignored
const EYE_FT = 5.5; // walk-mode eye height
const WALK_FT_PER_S = 16;
const TURN_RAD_PER_S = 2.0;
const FOCAL = 640; // walk-mode focal length, screen px
const NEAR_PX = 4; // walk-mode near plane, plan px

export type Fence3DView = { yawDeg: number; squash: number };

type WFace = {
  kind: "panel" | "gate" | "post" | "skirt" | "wall" | "ground" | "tree" | "bwall" | "roof";
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
  alt?: { cat: string; rails: number; cap: boolean };
};

type WLabel = { anchor: V3; text: string };

type ProjFace = {
  face: WFace;
  poly: Pt[];
  /** True when the projection kept the original 4 corners (details safe). */
  isQuad: boolean;
  depth: number;
};

const STYLES: Record<
  string,
  { face: string; shade: string; post: string; stroke: string; lines?: "pickets" | "bars" | "mesh" | "rails" }
> = {
  wood: { face: "#BC8A52", shade: "#9A6C3C", post: "#7E5730", stroke: "#5F421F", lines: "pickets" },
  vinyl: { face: "#F4F4EE", shade: "#DDDDD4", post: "#E9E9E2", stroke: "#9C9C92" },
  "chain-link": { face: "rgba(148,158,166,0.28)", shade: "rgba(120,130,138,0.34)", post: "#8B9298", stroke: "#6E767D", lines: "mesh" },
  aluminum: { face: "#33373D", shade: "#26292E", post: "#1E2126", stroke: "#101215", lines: "bars" },
  steel: { face: "#2E3237", shade: "#222528", post: "#1A1D21", stroke: "#0E1013", lines: "bars" },
  "split-rail": { face: "#B98F5C", shade: "#9A7344", post: "#7E5730", stroke: "#5F421F", lines: "rails" },
};

const TREE_TONES = [
  ["#4C7A45", "#3B6136"],
  ["#557F42", "#436639"],
  ["#47714B", "#38593B"],
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

/** Lawn color for a ground cell from its slope (light from the NW) with
 *  smooth, large-scale tone variation — never per-tile noise. */
function lawnFill(gxFt: number, gyFt: number, jitter: number): string {
  const b =
    Math.max(0.66, Math.min(1.06, 0.9 - gxFt * 2.0 + gyFt * 1.0)) *
    (0.98 + jitter * 0.045);
  const r = Math.round(172 * b);
  const g = Math.round(206 * b);
  const bl = Math.round(152 * b);
  return `rgb(${r},${g},${bl})`;
}

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
  initialView,
  onViewChange,
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
  /** Starting camera (yaw + tilt). The contractor's saved angle becomes
   *  the client's opening view; both can drag to orbit from there. */
  initialView?: Fence3DView;
  /** Fires when the user releases a drag — the estimator stores the
   *  angle so "Build the proposal" freezes it as the client's view. */
  onViewChange?: (v: Fence3DView) => void;
  className?: string;
}) {
  const [view, setView] = useState<Fence3DView>({
    yawDeg: initialView?.yawDeg ?? DEFAULT_YAW_DEG,
    squash: Math.min(0.8, Math.max(0.3, initialView?.squash ?? DEFAULT_SQUASH)),
  });
  // Screen zoom over the orbit view: screen = world*k + t (an SVG group
  // transform, so zooming never rebuilds the scene).
  const [zoomCam, setZoomCam] = useState({ k: 1, tx: 0, ty: 0 });
  const [mode, setMode] = useState<"orbit" | "walk">("orbit");
  const [walkCam, setWalkCam] = useState({ x: 450, y: 300, heading: 0, pitch: 0 });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; yaw0: number; sq0: number; h0: number; p0: number; moved: boolean } | null>(null);
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
    const style = STYLES[t.category] ?? STYLES.wood;
    const scale = pxPerFt && pxPerFt > 0 ? pxPerFt : 2.4;
    const zTop = heightFt * scale * HEIGHT_EXAGGERATION;
    const spacingPx = t.postSpacingFt * scale;
    const rackFt = rackingLimitFt(t.build);

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
    const softCap = heightFt * 5;
    const soften = (ft: number) =>
      ft <= softCap ? ft : softCap + (ft - softCap) * 0.35;

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
    const zAtPlan = (x: number, y: number): number =>
      soften(bilinear(x, y) - minElev) * scale * HEIGHT_EXAGGERATION;

    const geo = runs.map((r) => ({ pts: r.points, cum: cumLengths(r.points) }));
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

    // Terrain surface at 2× lattice density (smooth rolling lawn).
    if (grid) {
      const SUB = 2;
      const stepX = cellW / SUB;
      const stepY = cellH / SUB;
      const nx = (gridCols - 1) * SUB;
      const ny = (gridRows - 1) * SUB;
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          const x0 = c * stepX;
          const y0 = r * stepY;
          const x1 = x0 + stepX;
          const y1 = y0 + stepY;
          const mx = x0 + stepX / 2;
          const my = y0 + stepY / 2;
          const gx = (bilinear(x1, my) - bilinear(x0, my)) / stepX;
          const gy = (bilinear(mx, y1) - bilinear(mx, y0)) / stepY;
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
            fill: lawnFill(gx, gy, smoothNoise(mx, my)),
          });
        }
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
        faces.push({
          kind: "roof",
          bias: 0.005,
          pts: [
            { ...A, z: wallTop },
            { ...B, z: wallTop },
            { ...B, z: roofTop },
            { ...A, z: roofTop },
          ],
          shaded: -uy < 0,
          baseLenPx: segLen,
        });
      }
      faces.push({
        kind: "roof",
        bias: 0.01,
        pts: ring.map((p) => ({ ...p, z: roofTop })),
        shaded: false,
        baseLenPx: 0,
      });
    }

    // Posts merge by (run, rounded distance).
    const posts = new Map<string, { plan: Pt; zGround: number; zPostTop: number; heavy: boolean }>();
    const notePost = (ri: number, d: number, panelTopZ: number, heavy = false, zBase?: number) => {
      const key = `${ri}:${Math.round(d)}`;
      const plan = pointAt(geo[ri].pts, geo[ri].cum, d);
      const zGround = zBase ?? zOf(ri, d);
      const prev = posts.get(key);
      posts.set(key, {
        plan,
        zGround: prev ? Math.min(prev.zGround, zGround) : zGround,
        zPostTop: Math.max(prev?.zPostTop ?? 0, panelTopZ),
        heavy: (prev?.heavy ?? false) || heavy,
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
          notePost(ri, iv.s, top + 0.55 * scale, true);
          notePost(ri, iv.e, top + 0.55 * scale, true);
          labels.push({
            anchor: { x: mid.x, y: mid.y, z: top + 2.6 * scale },
            text: `${fmtFt(iv.gate.w / scale)}′ gate`,
          });
          continue;
        }

        const sections = Math.max(1, Math.ceil(len / spacingPx));
        for (let c = 0; c < sections; c++) {
          const d0 = iv.s + (len * c) / sections;
          const d1 = iv.s + (len * (c + 1)) / sections;
          const A = pointAt(rg.pts, rg.cum, d0);
          const B = pointAt(rg.pts, rg.cum, d1);
          const zA = zOf(ri, d0);
          const zB = zOf(ri, d1);
          const riseFt = hasGroundFor(ri) ? elevAt(ri, d1) - elevAt(ri, d0) : 0;
          const wallish =
            retainingWall && hasGroundFor(ri) && Math.abs(riseFt) >= WALL_RISE_FT;
          const stepped = !wallish && hasGroundFor(ri) && Math.abs(riseFt) > rackFt;
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
          });
          notePost(ri, d0, bzA + zTopLocal + 0.4 * scale, false, wallish ? bzA : undefined);
          notePost(ri, d1, bzB + zTopLocal + 0.4 * scale, false, wallish ? bzB : undefined);
        }
      }
    });

    const postW = Math.max(3, 0.55 * scale) * (postUpgrade === "6x6" ? 1.4 : 1);
    for (const p of posts.values()) {
      const w = p.heavy ? postW * 1.6 : postW;
      faces.push({
        kind: "post",
        bias: 0.01,
        pts: [
          { x: p.plan.x - w / 2, y: p.plan.y, z: p.zGround },
          { x: p.plan.x + w / 2, y: p.plan.y, z: p.zGround },
          { x: p.plan.x + w / 2, y: p.plan.y, z: p.zPostTop },
          { x: p.plan.x - w / 2, y: p.plan.y, z: p.zPostTop },
        ],
        shaded: false,
        baseLenPx: w,
        heavy: p.heavy,
      });
      faces.push({
        kind: "post",
        bias: 0.015,
        pts: [
          { x: p.plan.x - w * 0.75, y: p.plan.y, z: p.zPostTop },
          { x: p.plan.x + w * 0.75, y: p.plan.y, z: p.zPostTop },
          { x: p.plan.x + w * 0.75, y: p.plan.y, z: p.zPostTop + 0.16 * scale },
          { x: p.plan.x - w * 0.75, y: p.plan.y, z: p.zPostTop + 0.16 * scale },
        ],
        shaded: false,
        baseLenPx: w,
        heavy: p.heavy,
      });
    }

    const rings: V3[][] = parcelRings.map((ring) =>
      ring.map((p) => ({ x: p.x, y: p.y, z: (grid ? zAtPlan(p.x, p.y) : 0) + 1 })),
    );

    // Where a walk should start: centroid of the drawn fence.
    const runPts = runs.flatMap((r) => r.points);
    const centroid =
      runPts.length > 0
        ? {
            x: runPts.reduce((a, p) => a + p.x, 0) / runPts.length,
            y: runPts.reduce((a, p) => a + p.y, 0) / runPts.length,
          }
        : { x: CANVAS_W / 2, y: CANVAS_H / 2 };

    return {
      style,
      scale,
      label: `${heightFt}' ${t.label}`,
      faces,
      labels,
      rings,
      zAtPlan,
      centroid,
      railCount: t.railsPerSection(heightFt),
      capRail: t.category === "wood" || t.category === "vinyl",
      gateCount,
      steppedCount,
      wallCount,
      hasSurface: !!grid,
      reliefFt: Math.round(relief),
    };
  }, [runs, gates, heightFt, typeId, pxPerFt, parcelRings, runElevationsFt, elevationSpacingPx, topoGridFt, buildings, sections, retainingWall, postUpgrade]);

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
    return {
      faces,
      labels: plabels.map((l) => ({ ...l, at: T(l.at) })),
      rings: prings.map((r) => r.map(T)),
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

    return { faces, labels, horizon };
  }, [mode, walkCam, world]);

  /* ======================= interactions ============================= */

  // Native wheel: zoom the orbit view toward the cursor (React root
  // wheel handlers are passive — preventDefault needs a native listener).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "orbit") return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * VIEW_W;
      const sy = ((e.clientY - r.top) / r.height) * VIEW_H;
      const factor = Math.exp(-e.deltaY * 0.0022);
      setZoomCam((z0) => {
        const k = Math.min(8, Math.max(1, z0.k * factor));
        if (k === z0.k) return z0;
        // keep the world point under the cursor fixed
        const wx = (sx - z0.tx) / z0.k;
        const wy = (sy - z0.ty) / z0.k;
        return { k, tx: sx - wx * k, ty: sy - wy * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

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
      const pos = at ?? { x: world.centroid.x, y: world.centroid.y + 40 };
      const heading = Math.atan2(world.centroid.y - pos.y, world.centroid.x - pos.x);
      setWalkCam({ x: pos.x, y: pos.y, heading, pitch: 0 });
      setMode("walk");
    },
    [world],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const v = viewRef.current;
      const w = walkCamRef.current;
      dragRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        yaw0: v.yawDeg,
        sq0: v.squash,
        h0: w.heading,
        p0: w.pitch,
        moved: false,
      };
    },
    [],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
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
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.moved) {
        if (modeRef.current === "orbit") onViewChange?.(viewRef.current);
        return;
      }
      // clean click: in orbit mode, step into the yard at that spot
      if (modeRef.current === "orbit") {
        const at = pickGround(e.clientX, e.clientY);
        if (at) enterWalk(at);
      }
    },
    [onViewChange, pickGround, enterWalk],
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

  const { style, label, railCount, capRail, gateCount, steppedCount, wallCount, hasSurface, reliefFt } = world;
  const polyPath = (pts: Pt[]) =>
    `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")} Z`;

  const renderFace = (f: ProjFace, i: number) => {
    const kind = f.face.kind;
    if (kind === "ground") {
      return (
        <path key={i} d={polyPath(f.poly)} fill={f.face.fill} stroke={f.face.fill} strokeWidth={0.6} />
      );
    }
    if (kind === "tree") {
      const [base, top] = f.poly;
      const hPx = Math.max(4, base.y - top.y);
      const r = hPx * 0.34;
      const tones = TREE_TONES[f.face.tone ?? 0];
      return (
        <g key={i}>
          <ellipse cx={base.x} cy={base.y + 1.5} rx={r * 0.9} ry={r * 0.22} fill="rgba(30,50,28,0.18)" />
          <line x1={base.x} y1={base.y} x2={base.x} y2={base.y - hPx * 0.55} stroke="#6B4E2E" strokeWidth={Math.max(1, hPx * 0.05)} />
          <circle cx={base.x - r * 0.35} cy={base.y - hPx * 0.62} r={r * 0.72} fill={tones[1]} />
          <circle cx={base.x + r * 0.3} cy={base.y - hPx * 0.58} r={r * 0.66} fill={tones[1]} />
          <circle cx={base.x} cy={base.y - hPx * 0.74} r={r} fill={tones[0]} />
        </g>
      );
    }
    if (kind === "bwall") {
      return (
        <path
          key={i}
          d={polyPath(f.poly)}
          fill={f.face.shaded ? "#D8D2C6" : "#EBE6DC"}
          stroke="#A69E8F"
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
      );
    }
    if (kind === "roof") {
      return (
        <path
          key={i}
          d={polyPath(f.poly)}
          fill={f.face.shaded ? "#5D6470" : "#6E7480"}
          stroke="#4C525C"
          strokeWidth={0.9}
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
      return (
        <path
          key={i}
          d={polyPath(f.poly)}
          fill={postUpgrade === "steel" ? "#8B9298" : style.post}
          stroke={postUpgrade === "steel" ? "#666D74" : style.stroke}
          strokeWidth={f.face.heavy ? 1.2 : 0.8}
        />
      );
    }
    if (kind === "gate") {
      if (!f.isQuad) {
        return <path key={i} d={polyPath(f.poly)} fill="#EAD9BC" stroke={style.stroke} strokeWidth={1.4} strokeLinejoin="round" />;
      }
      const [a, b, tb, ta] = f.poly;
      const leaves = f.face.leaves ?? 1;
      const leafEls: React.ReactNode[] = [];
      for (let k = 0; k < leaves; k++) {
        const s0 = k / leaves;
        const s1 = (k + 1) / leaves;
        const la = { x: a.x + (b.x - a.x) * s0, y: a.y + (b.y - a.y) * s0 };
        const lb = { x: a.x + (b.x - a.x) * s1, y: a.y + (b.y - a.y) * s1 };
        const lta = { x: ta.x + (tb.x - ta.x) * s0, y: ta.y + (tb.y - ta.y) * s0 };
        const ltb = { x: ta.x + (tb.x - ta.x) * s1, y: ta.y + (tb.y - ta.y) * s1 };
        const hingeBottom = k === 0 ? la : lb;
        const latchTop = k === 0 ? ltb : lta;
        leafEls.push(
          <g key={k}>
            <path d={`M${la.x} ${la.y} L${lb.x} ${lb.y} L${ltb.x} ${ltb.y} L${lta.x} ${lta.y} Z`} fill="#EAD9BC" stroke={style.stroke} strokeWidth={1.4} strokeLinejoin="round" />
            <line x1={hingeBottom.x} y1={hingeBottom.y} x2={latchTop.x} y2={latchTop.y} stroke="rgba(0,0,0,0.25)" strokeWidth={1.6} />
          </g>,
        );
      }
      return (
        <g key={i}>
          {leafEls}
          {leaves === 2 && (
            <line x1={(a.x + b.x) / 2} y1={(a.y + b.y) / 2} x2={(ta.x + tb.x) / 2} y2={(ta.y + tb.y) / 2} stroke={style.stroke} strokeWidth={1.4} />
          )}
          <circle cx={(a.x + b.x + ta.x + tb.x) / 4} cy={(a.y + b.y + ta.y + tb.y) / 4} r={2.4} fill="#3f3f46" />
        </g>
      );
    }
    // panel — mixed-type sections swap in THAT fence's style
    const st = f.face.alt ? (STYLES[f.face.alt.cat] ?? style) : style;
    const rc = f.face.alt?.rails ?? railCount;
    const cap = f.face.alt ? f.face.alt.cap : capRail;
    const fill = f.face.shaded ? st.shade : st.face;
    if (!f.isQuad) {
      return <path key={i} d={polyPath(f.poly)} fill={fill} stroke={st.stroke} strokeWidth={0.9} strokeLinejoin="round" />;
    }
    const [a, b, tb, ta] = f.poly;
    const details: React.ReactNode[] = [];
    if (st.lines === "pickets" || st.lines === "bars") {
      const n = Math.max(2, Math.floor(f.face.baseLenPx / (st.lines === "bars" ? 10 : 7)));
      for (let k = 1; k < n; k++) {
        const s = k / n;
        details.push(
          <line
            key={k}
            x1={a.x + (b.x - a.x) * s}
            y1={a.y + (b.y - a.y) * s}
            x2={ta.x + (tb.x - ta.x) * s}
            y2={ta.y + (tb.y - ta.y) * s}
            stroke={st.lines === "bars" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"}
            strokeWidth={st.lines === "bars" ? 2 : 1}
          />,
        );
      }
    } else if (st.lines === "mesh") {
      const n = Math.max(2, Math.floor(f.face.baseLenPx / 9));
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        details.push(
          <line key={`m1-${k}`} x1={a.x + (b.x - a.x) * s} y1={a.y + (b.y - a.y) * s} x2={ta.x + (tb.x - ta.x) * Math.min(1, s + 0.18)} y2={ta.y + (tb.y - ta.y) * Math.min(1, s + 0.18)} stroke="rgba(90,100,108,0.4)" strokeWidth={0.8} />,
          <line key={`m2-${k}`} x1={a.x + (b.x - a.x) * s} y1={a.y + (b.y - a.y) * s} x2={ta.x + (tb.x - ta.x) * Math.max(0, s - 0.18)} y2={ta.y + (tb.y - ta.y) * Math.max(0, s - 0.18)} stroke="rgba(90,100,108,0.4)" strokeWidth={0.8} />,
        );
      }
    }
    if (st.lines === "rails") {
      const rails: React.ReactNode[] = [];
      for (let r = 1; r <= rc; r++) {
        const s = r / (rc + 1);
        rails.push(
          <line
            key={r}
            x1={a.x + (ta.x - a.x) * s}
            y1={a.y + (ta.y - a.y) * s}
            x2={b.x + (tb.x - b.x) * s}
            y2={b.y + (tb.y - b.y) * s}
            stroke={fill}
            strokeWidth={4}
            strokeLinecap="round"
          />,
        );
      }
      return <g key={i}>{rails}</g>;
    }
    if (st.lines === "pickets") {
      for (const s of [0.22, 0.78]) {
        details.push(
          <line
            key={`rail-${s}`}
            x1={a.x + (ta.x - a.x) * s}
            y1={a.y + (ta.y - a.y) * s}
            x2={b.x + (tb.x - b.x) * s}
            y2={b.y + (tb.y - b.y) * s}
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={2}
          />,
        );
      }
    }
    return (
      <g key={i}>
        <path d={polyPath(f.poly)} fill={fill} stroke={st.stroke} strokeWidth={0.9} strokeLinejoin="round" />
        {details}
        {cap && (
          <line x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke={st.post} strokeWidth={2.2} strokeLinecap="round" />
        )}
      </g>
    );
  };

  const labelChip = (l: { text: string; at: Pt }, i: number) => {
    const w = l.text.length * 6.4 + 16;
    return (
      <g key={i}>
        <line x1={l.at.x} y1={l.at.y} x2={l.at.x} y2={l.at.y + 9} stroke="#DB2777" strokeWidth={1.2} />
        <rect x={l.at.x - w / 2} y={l.at.y - 20} width={w} height={20} rx={10} fill="rgba(255,255,255,0.95)" stroke="#DB2777" strokeWidth={1.2} />
        <text x={l.at.x} y={l.at.y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#9D174D">
          {l.text}
        </text>
      </g>
    );
  };

  const walking = mode === "walk" && walkScene;
  const isDefaultView =
    Math.abs(view.yawDeg - DEFAULT_YAW_DEG) < 0.5 &&
    Math.abs(view.squash - DEFAULT_SQUASH) < 0.005 &&
    zoomCam.k === 1;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-zinc-200", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={cn("block h-full w-full", walking ? "cursor-move" : "cursor-grab active:cursor-grabbing")}
        style={{ touchAction: "none" }}
        role="img"
        aria-label={`3D preview of the ${label} fence as designed — drag to orbit, click a spot to walk`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <linearGradient id="f3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DDEDF9" />
            <stop offset="52%" stopColor="#EFF5E9" />
            <stop offset="100%" stopColor="#DCE8D4" />
          </linearGradient>
          <linearGradient id="f3d-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#BFDCF2" />
            <stop offset="100%" stopColor="#EAF3EA" />
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
        </defs>

        {walking ? (
          <>
            {/* sky above the horizon, warm ground tone below */}
            <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-sky)" />
            <circle cx={VIEW_W * 0.78} cy={Math.min(walkScene!.horizon - 60, 120)} r={90} fill="url(#f3d-sun)" />
            <rect x={0} y={Math.max(0, walkScene!.horizon)} width={VIEW_W} height={Math.max(0, VIEW_H - walkScene!.horizon)} fill="#A9C29B" />
            {walkScene!.faces.map(renderFace)}
            {walkScene!.labels.map(labelChip)}
          </>
        ) : (
          <>
            <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-bg)" />
            <circle cx={VIEW_W * 0.8} cy={70} r={110} fill="url(#f3d-sun)" />
            <g transform={`translate(${zoomCam.tx} ${zoomCam.ty}) scale(${zoomCam.k})`}>
              {orbitScene.faces.map(renderFace)}
              {orbitScene.rings.map((ring, i) => (
                <polygon
                  key={i}
                  points={ring.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#3FA65B"
                  strokeWidth={1.5}
                  strokeDasharray="7 5"
                  opacity={0.85}
                />
              ))}
              {orbitScene.labels.map(labelChip)}
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
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        {walking ? (
          <button
            type="button"
            onClick={() => setMode("orbit")}
            className="transition-smooth ring-focus rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white"
          >
            ✕ Exit walk (Esc)
          </button>
        ) : (
          <>
            {!isDefaultView && (
              <button
                type="button"
                onClick={() => {
                  const v = { yawDeg: DEFAULT_YAW_DEG, squash: DEFAULT_SQUASH };
                  setView(v);
                  setZoomCam({ k: 1, tx: 0, ty: 0 });
                  onViewChange?.(v);
                }}
                className="transition-smooth ring-focus rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white"
              >
                Reset view
              </button>
            )}
            <button
              type="button"
              onClick={() => enterWalk()}
              className="transition-smooth ring-focus rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-accent-800 shadow-sm ring-1 ring-accent-200 hover:bg-white"
            >
              🚶 Walk the yard
            </button>
            <span className="pointer-events-none hidden rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200 sm:inline">
              ↻ Drag to spin · scroll to zoom · click a spot to walk
            </span>
          </>
        )}
      </div>

      {/* client-readable summary chips */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
        {walking ? (
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200">
            W A S D / arrows to walk · Shift to hurry · drag to look around
          </span>
        ) : (
          <>
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200">
              {label} — to scale
            </span>
            {gateCount > 0 && (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-pink-700 shadow-sm ring-1 ring-pink-200">
                {gateCount} {gateCount === 1 ? "gate" : "gates"}
              </span>
            )}
            {steppedCount > 0 && (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-accent-700 shadow-sm ring-1 ring-accent-200">
                ⛰ {steppedCount} sections step down the slope
              </span>
            )}
            {wallCount > 0 && (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-stone-700 shadow-sm ring-1 ring-stone-300">
                🧱 {wallCount} {wallCount === 1 ? "section mounts" : "sections mount"} on the retaining wall
              </span>
            )}
            {hasSurface && reliefFt >= heightFt * 5 && (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200">
                {reliefFt}′ of total rise — hill softened to keep the fence readable
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
