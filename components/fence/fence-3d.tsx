"use client";

import { useMemo } from "react";
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
 * Fence3D — a to-scale isometric preview of the drawn fence, hand-rolled
 * in SVG (no 3D library: deterministic, fast, prints cleanly in the
 * proposal PDF and the client portal).
 *
 * Ground: when the scan's topo lattice is available the whole yard
 * renders as a slope-shaded terrain surface and the fence stands on it;
 * without it (legacy proposals) each run gets a shallow earth ribbon.
 * Extreme lots are vertically softened past 5× the fence height so an
 * 80 ft hillside still reads as a yard with a fence, not a cliff.
 * Sections rack (tilt) up to the build kind's limit and STEP beyond it —
 * level panels cascading downhill on extended posts. Gates render at
 * their real width as framed, braced leaves with a size label.
 */

type Pt = { x: number; y: number };

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
const ROT = (-28 * Math.PI) / 180;
const SQUASH = 0.52;
const HEIGHT_EXAGGERATION = 1.3; // readability: fences are long + short
const GATE_SNAP_PX = 30; // gates farther than this from every run are ignored

/** Rotate + foreshorten a plan point, then lift by z (screen px). */
function proj(p: Pt, z: number): Pt {
  const rx = p.x * Math.cos(ROT) - p.y * Math.sin(ROT);
  const ry = p.x * Math.sin(ROT) + p.y * Math.cos(ROT);
  return { x: rx, y: ry * SQUASH - z };
}

type Face = {
  kind: "panel" | "gate" | "post" | "skirt" | "wall" | "ground";
  /** Painter depth — projected plan-y of the base midpoint (+bias). */
  depth: number;
  /** Quad corners in projected space: baseA, baseB, topB, topA. */
  quad: [Pt, Pt, Pt, Pt];
  /** Faces whose outward normal points left get the shade tone. */
  shaded: boolean;
  /** Plan-space base segment (for picket/bar spacing). */
  baseLenPx: number;
  /** Gate faces: 2 for a double gate's split leaves. */
  leaves?: 1 | 2;
  /** Posts: gate posts render heavier. */
  heavy?: boolean;
  /** Ground cells: pre-computed lawn fill from the slope shading. */
  fill?: string;
};

type GateLabel = { anchor: Pt; text: string };

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

/** Cumulative arc lengths of a polyline (same length as points). */
function cumLengths(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
}

/** Plan point at arc distance d along a polyline. */
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

/** Nearest point on a polyline: arc distance + perpendicular offset. */
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

/** Lawn color for a ground cell from its slope (light from the NW). */
function lawnFill(gxFt: number, gyFt: number): string {
  // gx: ft rise per plan px eastward; gy: ft rise per plan px southward.
  const b = Math.max(0.66, Math.min(1.06, 0.88 - gxFt * 2.4 + gyFt * 1.2));
  const r = Math.round(178 * b);
  const g = Math.round(208 * b);
  const bl = Math.round(160 * b);
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
  retainingWall = false,
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
  /** Contractor confirmed the fence mounts on a retaining wall: sheer
   *  drops render as a masonry wall face with the fence anchored on top
   *  (instead of an earth bank), and get a summary chip. */
  retainingWall?: boolean;
  className?: string;
}) {
  const scene = useMemo(() => {
    const t = fenceType(typeId as FenceTypeId);
    const style = STYLES[t.category] ?? STYLES.wood;
    const scale = pxPerFt && pxPerFt > 0 ? pxPerFt : 2.4;
    const zTop = heightFt * scale * HEIGHT_EXAGGERATION;
    const spacingPx = t.postSpacingFt * scale;
    const rackFt = rackingLimitFt(t.build);

    // ---- ground sources ----------------------------------------------
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

    // Shared datum + relief softening: past 5× the fence height, extra
    // relief renders at 35% so big hillsides stay readable.
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
      const v00 = grid[r0][c0];
      const v01 = grid[r0][c0 + 1];
      const v10 = grid[r0 + 1][c0];
      const v11 = grid[r0 + 1][c0 + 1];
      return (
        v00 * (1 - sx) * (1 - sy) +
        v01 * sx * (1 - sy) +
        v10 * (1 - sx) * sy +
        v11 * sx * sy
      );
    };

    const geo = runs.map((r) => ({ pts: r.points, cum: cumLengths(r.points) }));
    const hasGroundFor = (ri: number) => !!grid || !!models[ri];
    /** Raw ground elevation (ft, absolute) under a run point. */
    const elevAt = (ri: number, d: number): number => {
      if (grid) {
        const p = pointAt(geo[ri].pts, geo[ri].cum, d);
        return bilinear(p.x, p.y);
      }
      const m = models[ri];
      return m ? m.atDistPx(d) : minElev;
    };
    /** Screen-z of the ground under a run point (softened + scaled). */
    const zOf = (ri: number, d: number): number =>
      soften(elevAt(ri, d) - minElev) * scale * HEIGHT_EXAGGERATION;
    const zOfPlan = (x: number, y: number): number =>
      soften(bilinear(x, y) - minElev) * scale * HEIGHT_EXAGGERATION;

    // Assign each gate to its nearest run as a span of arc distance.
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
      if (total <= wPx + 2) continue; // run shorter than the gate
      spansByRun[bestRun].push({
        c: Math.max(wPx / 2, Math.min(total - wPx / 2, best.dist)),
        w: wPx,
        kind,
      });
      gateCount++;
    }

    const faces: Face[] = [];
    const labels: GateLabel[] = [];
    let steppedCount = 0;
    let wallCount = 0;

    // ---- terrain surface (topo lattice) ------------------------------
    // Rendered at 2× the lattice density via bilinear interpolation so
    // the lawn reads as rolling ground, not a patchwork of flat tiles.
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
          const mid = { x: x0 + stepX / 2, y: y0 + stepY / 2 };
          const gx = (bilinear(x1, mid.y) - bilinear(x0, mid.y)) / stepX;
          const gy = (bilinear(mid.x, y1) - bilinear(mid.x, y0)) / stepY;
          faces.push({
            kind: "ground",
            depth: proj(mid, 0).y - 0.5, // before any co-located fence
            quad: [
              proj({ x: x0, y: y0 }, zOfPlan(x0, y0)),
              proj({ x: x1, y: y0 }, zOfPlan(x1, y0)),
              proj({ x: x1, y: y1 }, zOfPlan(x1, y1)),
              proj({ x: x0, y: y1 }, zOfPlan(x0, y1)),
            ],
            shaded: false,
            baseLenPx: stepX,
            fill: lawnFill(gx, gy),
          });
        }
      }
    }

    // Posts merge by (run, rounded distance): ground at the lowest read,
    // top at the tallest adjacent panel — extended posts fall out free.
    // Wall-mounted sections override the base to the wall cap.
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

      // Cut the run into fence intervals and gate intervals.
      const spans = spansByRun[ri].sort((a, b) => a.c - b.c);
      type Interval = { s: number; e: number; gate?: { kind: "single" | "double" | "custom"; w: number } };
      const intervals: Interval[] = [];
      let cursor = 0;
      for (const sp of spans) {
        let s = sp.c - sp.w / 2;
        const e = Math.min(total, sp.c + sp.w / 2);
        if (s < cursor) s = cursor; // overlapping gates shrink, never overlap
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
          // ---- gate: level leaf(s) with ground clearance + a label ----
          const zA = zOf(ri, iv.s);
          const zB = zOf(ri, iv.e);
          const base = Math.max(zA, zB) + 0.12 * scale;
          const top = base + zTop - 0.12 * scale;
          const mid = { x: (A0.x + B0.x) / 2, y: (A0.y + B0.y) / 2 };
          const depth = proj(mid, 0).y;
          faces.push({
            kind: "gate",
            depth,
            quad: [proj(A0, base), proj(B0, base), proj(B0, top), proj(A0, top)],
            shaded,
            baseLenPx: len,
            leaves: iv.gate.kind === "double" ? 2 : 1,
          });
          notePost(ri, iv.s, top + 0.55 * scale, true);
          notePost(ri, iv.e, top + 0.55 * scale, true);
          labels.push({
            anchor: proj(mid, top + 2.6 * scale),
            text: `${fmtFt(iv.gate.w / scale)}′ gate`,
          });
          continue;
        }

        // ---- fence: post-spaced sections, racked or stepped ----
        const sections = Math.max(1, Math.ceil(len / spacingPx));
        for (let c = 0; c < sections; c++) {
          const d0 = iv.s + (len * c) / sections;
          const d1 = iv.s + (len * (c + 1)) / sections;
          const A = pointAt(rg.pts, rg.cum, d0);
          const B = pointAt(rg.pts, rg.cum, d1);
          const zA = zOf(ri, d0);
          const zB = zOf(ri, d1);
          // Rack/step decisions use REAL feet (not the softened screen z).
          const riseFt = hasGroundFor(ri) ? elevAt(ri, d1) - elevAt(ri, d0) : 0;
          const wallish =
            retainingWall && hasGroundFor(ri) && Math.abs(riseFt) >= WALL_RISE_FT;
          const stepped = !wallish && hasGroundFor(ri) && Math.abs(riseFt) > rackFt;
          const level = stepped || wallish;
          const bzA = level ? Math.max(zA, zB) : zA;
          const bzB = level ? Math.max(zA, zB) : zB;
          if (stepped) steppedCount++;
          if (wallish) wallCount++;
          const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
          const depth = proj(mid, 0).y;
          if (wallish) {
            const zLo = Math.min(zA, zB);
            faces.push({
              kind: "wall",
              depth: depth - 0.02,
              quad: [proj(A, bzA), proj(B, bzB), proj(B, zLo), proj(A, zLo)],
              shaded,
              baseLenPx: Math.hypot(B.x - A.x, B.y - A.y),
            });
          } else if (!grid && models[ri] && (zA > 0.5 || zB > 0.5)) {
            // Legacy ground (no lattice): a shallow earth ribbon under
            // the run — bounded, so big lots never become green cliffs.
            const ribbon = 4 * scale * HEIGHT_EXAGGERATION;
            faces.push({
              kind: "skirt",
              depth: depth - 0.02,
              quad: [
                proj(A, zA),
                proj(B, zB),
                proj(B, Math.max(0, zB - ribbon)),
                proj(A, Math.max(0, zA - ribbon)),
              ],
              shaded,
              baseLenPx: Math.hypot(B.x - A.x, B.y - A.y),
            });
          }
          faces.push({
            kind: "panel",
            depth,
            quad: [proj(A, bzA), proj(B, bzB), proj(B, bzB + zTop), proj(A, bzA + zTop)],
            shaded,
            baseLenPx: Math.hypot(B.x - A.x, B.y - A.y),
          });
          notePost(ri, d0, bzA + zTop + 0.4 * scale, false, wallish ? bzA : undefined);
          notePost(ri, d1, bzB + zTop + 0.4 * scale, false, wallish ? bzB : undefined);
        }
      }
    });

    // Posts as thin quads: ground → tallest adjacent panel, with a cap.
    const postW = Math.max(3, 0.55 * scale);
    for (const p of posts.values()) {
      const w = p.heavy ? postW * 1.6 : postW;
      const depth = proj(p.plan, 0).y + 0.01; // draw just after coplanar panels
      faces.push({
        kind: "post",
        depth,
        quad: [
          proj({ x: p.plan.x - w / 2, y: p.plan.y }, p.zGround),
          proj({ x: p.plan.x + w / 2, y: p.plan.y }, p.zGround),
          proj({ x: p.plan.x + w / 2, y: p.plan.y }, p.zPostTop),
          proj({ x: p.plan.x - w / 2, y: p.plan.y }, p.zPostTop),
        ],
        shaded: false,
        baseLenPx: w,
        heavy: p.heavy,
      });
      // cap: a slightly wider sliver on top of the post
      faces.push({
        kind: "post",
        depth: depth + 0.005,
        quad: [
          proj({ x: p.plan.x - w * 0.75, y: p.plan.y }, p.zPostTop),
          proj({ x: p.plan.x + w * 0.75, y: p.plan.y }, p.zPostTop),
          proj({ x: p.plan.x + w * 0.75, y: p.plan.y }, p.zPostTop + 0.16 * scale),
          proj({ x: p.plan.x - w * 0.75, y: p.plan.y }, p.zPostTop + 0.16 * scale),
        ],
        shaded: false,
        baseLenPx: w,
        heavy: p.heavy,
      });
    }

    faces.sort((f1, f2) => f1.depth - f2.depth);

    // Property line, draped on the terrain when we have it.
    const groundPaths = parcelRings.map((ring) =>
      ring.map((p) => proj(p, grid ? zOfPlan(p.x, p.y) + 1 : 0)),
    );

    // Fit everything into the viewBox (labels get chip-sized headroom).
    const all: Pt[] = [
      ...faces.flatMap((f) => f.quad),
      ...groundPaths.flat(),
      ...labels.flatMap((l) => [
        { x: l.anchor.x - l.text.length * 3.4 - 10, y: l.anchor.y - 24 },
        { x: l.anchor.x + l.text.length * 3.4 + 10, y: l.anchor.y },
      ]),
    ];
    if (all.length === 0) {
      return null;
    }
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

    const fitFaces = faces.map((f) => ({ ...f, quad: f.quad.map(T) as Face["quad"] }));

    // Height marker beside the leftmost post.
    let marker: { base: Pt; top: Pt } | null = null;
    for (const f of fitFaces) {
      if (f.kind !== "post") continue;
      const base = { x: (f.quad[0].x + f.quad[1].x) / 2, y: (f.quad[0].y + f.quad[1].y) / 2 };
      const top = { x: (f.quad[2].x + f.quad[3].x) / 2, y: (f.quad[2].y + f.quad[3].y) / 2 };
      if (Math.abs(base.y - top.y) < 6) continue; // caps, not posts
      if (!marker || base.x < marker.base.x) marker = { base, top };
    }

    return {
      style,
      label: `${heightFt}' ${t.label}`,
      faces: fitFaces,
      labels: labels.map((l) => ({ ...l, anchor: T(l.anchor) })),
      groundPaths: groundPaths.map((ring) => ring.map(T)),
      marker,
      railCount: t.railsPerSection(heightFt),
      capRail: t.category === "wood" || t.category === "vinyl",
      gateCount,
      steppedCount,
      wallCount,
      hasSurface: !!grid,
      reliefFt: Math.round(relief),
    };
  }, [runs, gates, heightFt, typeId, pxPerFt, parcelRings, runElevationsFt, elevationSpacingPx, topoGridFt, retainingWall]);

  if (!scene) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400", className)}>
        Draw a fence run to see the 3D preview.
      </div>
    );
  }

  const { style, faces, labels, groundPaths, marker, label, railCount, capRail, gateCount, steppedCount, wallCount, hasSurface, reliefFt } = scene;
  const quadPath = (q: Face["quad"]) =>
    `M${q[0].x.toFixed(1)} ${q[0].y.toFixed(1)} L${q[1].x.toFixed(1)} ${q[1].y.toFixed(1)} L${q[2].x.toFixed(1)} ${q[2].y.toFixed(1)} L${q[3].x.toFixed(1)} ${q[3].y.toFixed(1)} Z`;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-zinc-200", className)}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-full w-full" role="img" aria-label={`3D preview of the ${label} fence as designed`}>
        {/* sky→lawn backdrop */}
        <defs>
          <linearGradient id="f3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E6F1F9" />
            <stop offset="52%" stopColor="#F0F5EA" />
            <stop offset="100%" stopColor="#DCE8D4" />
          </linearGradient>
          <linearGradient id="f3d-earth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C7DBBD" />
            <stop offset="100%" stopColor="#A9C29B" />
          </linearGradient>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-bg)" />

        {/* faces, back to front (terrain cells sort with everything else) */}
        {faces.map((f, i) => {
          if (f.kind === "ground") {
            return (
              <path
                key={i}
                d={quadPath(f.quad)}
                fill={f.fill}
                stroke={f.fill}
                strokeWidth={0.6}
              />
            );
          }
          if (f.kind === "skirt") {
            return (
              <path
                key={i}
                d={quadPath(f.quad)}
                fill="url(#f3d-earth)"
                stroke="rgba(46,72,42,0.14)"
                strokeWidth={0.7}
                strokeLinejoin="round"
              />
            );
          }
          if (f.kind === "wall") {
            // Masonry retaining-wall face: cap line + block courses.
            const [wa, wb, wlb, wla] = f.quad;
            const courses: React.ReactNode[] = [];
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
            return (
              <g key={i}>
                <path
                  d={quadPath(f.quad)}
                  fill={f.shaded ? "#B6AFA2" : "#CBC4B7"}
                  stroke="#8E8778"
                  strokeWidth={0.9}
                  strokeLinejoin="round"
                />
                {courses}
                <line x1={wa.x} y1={wa.y} x2={wb.x} y2={wb.y} stroke="#7A7365" strokeWidth={2.2} strokeLinecap="round" />
              </g>
            );
          }
          if (f.kind === "post") {
            return (
              <path
                key={i}
                d={quadPath(f.quad)}
                fill={style.post}
                stroke={style.stroke}
                strokeWidth={f.heavy ? 1.2 : 0.8}
              />
            );
          }
          const [a, b, tb, ta] = f.quad;
          if (f.kind === "gate") {
            // Framed, braced leaf(s) — lighter than the fence so it reads.
            const leaves = f.leaves ?? 1;
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
                  <path
                    d={`M${la.x} ${la.y} L${lb.x} ${lb.y} L${ltb.x} ${ltb.y} L${lta.x} ${lta.y} Z`}
                    fill="#EAD9BC"
                    stroke={style.stroke}
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                  />
                  <line x1={hingeBottom.x} y1={hingeBottom.y} x2={latchTop.x} y2={latchTop.y} stroke="rgba(0,0,0,0.25)" strokeWidth={1.6} />
                </g>,
              );
            }
            return (
              <g key={i}>
                {leafEls}
                {leaves === 2 && (
                  <line
                    x1={(a.x + b.x) / 2}
                    y1={(a.y + b.y) / 2}
                    x2={(ta.x + tb.x) / 2}
                    y2={(ta.y + tb.y) / 2}
                    stroke={style.stroke}
                    strokeWidth={1.4}
                  />
                )}
                <circle
                  cx={(a.x + b.x + ta.x + tb.x) / 4}
                  cy={(a.y + b.y + ta.y + tb.y) / 4}
                  r={2.4}
                  fill="#3f3f46"
                />
              </g>
            );
          }
          // panel
          const fill = f.shaded ? style.shade : style.face;
          const details: React.ReactNode[] = [];
          if (style.lines === "pickets" || style.lines === "bars") {
            const n = Math.max(2, Math.floor(f.baseLenPx / (style.lines === "bars" ? 10 : 7)));
            for (let k = 1; k < n; k++) {
              const s = k / n;
              details.push(
                <line
                  key={k}
                  x1={a.x + (b.x - a.x) * s}
                  y1={a.y + (b.y - a.y) * s}
                  x2={ta.x + (tb.x - ta.x) * s}
                  y2={ta.y + (tb.y - ta.y) * s}
                  stroke={style.lines === "bars" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"}
                  strokeWidth={style.lines === "bars" ? 2 : 1}
                />,
              );
            }
          } else if (style.lines === "mesh") {
            const n = Math.max(2, Math.floor(f.baseLenPx / 9));
            for (let k = 0; k <= n; k++) {
              const s = k / n;
              details.push(
                <line key={`m1-${k}`} x1={a.x + (b.x - a.x) * s} y1={a.y + (b.y - a.y) * s} x2={ta.x + (tb.x - ta.x) * Math.min(1, s + 0.18)} y2={ta.y + (tb.y - ta.y) * Math.min(1, s + 0.18)} stroke="rgba(90,100,108,0.4)" strokeWidth={0.8} />,
                <line key={`m2-${k}`} x1={a.x + (b.x - a.x) * s} y1={a.y + (b.y - a.y) * s} x2={ta.x + (tb.x - ta.x) * Math.max(0, s - 0.18)} y2={ta.y + (tb.y - ta.y) * Math.max(0, s - 0.18)} stroke="rgba(90,100,108,0.4)" strokeWidth={0.8} />,
              );
            }
          }
          if (style.lines === "rails") {
            // split/ranch rail: open panel, draw only the rails
            const rails: React.ReactNode[] = [];
            for (let r = 1; r <= railCount; r++) {
              const s = r / (railCount + 1);
              rails.push(
                <line
                  key={r}
                  x1={a.x + (ta.x - a.x) * s}
                  y1={a.y + (ta.y - a.y) * s}
                  x2={b.x + (tb.x - b.x) * s}
                  y2={b.y + (tb.y - b.y) * s}
                  stroke={f.shaded ? style.shade : style.face}
                  strokeWidth={4}
                  strokeLinecap="round"
                />,
              );
            }
            return <g key={i}>{rails}</g>;
          }
          // horizontal rails read through the boards on wood builds
          if (style.lines === "pickets") {
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
              <path d={quadPath(f.quad)} fill={fill} stroke={style.stroke} strokeWidth={0.9} strokeLinejoin="round" />
              {details}
              {capRail && (
                <line x1={ta.x} y1={ta.y} x2={tb.x} y2={tb.y} stroke={style.post} strokeWidth={2.2} strokeLinecap="round" />
              )}
            </g>
          );
        })}

        {/* property line over the terrain */}
        {groundPaths.map((ring, i) => (
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

        {/* gate size labels — drawn last, always readable */}
        {labels.map((l, i) => {
          const w = l.text.length * 6.4 + 16;
          return (
            <g key={i}>
              <line x1={l.anchor.x} y1={l.anchor.y} x2={l.anchor.x} y2={l.anchor.y + 9} stroke="#DB2777" strokeWidth={1.2} />
              <rect x={l.anchor.x - w / 2} y={l.anchor.y - 20} width={w} height={20} rx={10} fill="rgba(255,255,255,0.95)" stroke="#DB2777" strokeWidth={1.2} />
              <text x={l.anchor.x} y={l.anchor.y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#9D174D">
                {l.text}
              </text>
            </g>
          );
        })}

        {/* fence height dimension beside the leftmost post */}
        {marker && (
          <g stroke="#52525B" strokeWidth={1.2} fill="none">
            <line x1={marker.base.x - 14} y1={marker.base.y} x2={marker.base.x - 14} y2={marker.top.y} />
            <line x1={marker.base.x - 18} y1={marker.base.y} x2={marker.base.x - 10} y2={marker.base.y} />
            <line x1={marker.base.x - 18} y1={marker.top.y} x2={marker.base.x - 10} y2={marker.top.y} />
            <g stroke="none" fill="#3F3F46">
              <text
                x={marker.base.x - 22}
                y={(marker.base.y + marker.top.y) / 2 + 4}
                textAnchor="end"
                fontSize={12}
                fontWeight={700}
              >
                {heightFt}′
              </text>
            </g>
          </g>
        )}
      </svg>

      {/* client-readable summary chips */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
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
      </div>
    </div>
  );
}
