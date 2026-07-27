"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import { rackingLimitFt, WALL_RISE_FT } from "@/lib/fence/slope";
import { runDistanceModel, type RunElevationModel } from "@/lib/fence/geo";

/**
 * Fence3D — a to-scale isometric preview of the drawn fence, hand-rolled
 * in SVG (no 3D library: deterministic, fast, prints cleanly in the
 * proposal PDF and the client portal).
 *
 * Model: the 2D layout (canvas space, px) is rotated and foreshortened
 * into an axonometric ground plane; posts and panels extrude upward by
 * the fence height (ft × pxPerFt). When measured ground elevations are
 * supplied the fence follows the real terrain: sections rack (tilt) up
 * to the build kind's limit and STEP beyond it — level panels cascading
 * down the slope on extended posts — with an earth skirt under each run
 * so the hillside itself is visible. Painter's algorithm sorts faces
 * back-to-front. Gates render at their real width as framed, braced
 * leaves with a size label the client can read.
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
  kind: "panel" | "gate" | "post" | "skirt" | "wall";
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

export function Fence3D({
  runs,
  gates,
  heightFt,
  typeId = "cedar-privacy",
  pxPerFt,
  parcelRings = [],
  runElevationsFt,
  elevationSpacingPx,
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

    // Terrain: one elevation model per run, all sharing one datum (the
    // lowest sample across the layout) so the scene stays coherent.
    const sampleSpacing =
      elevationSpacingPx && elevationSpacingPx > 0 ? elevationSpacingPx : spacingPx;
    const models: (RunElevationModel | null)[] = runs.map((r, i) =>
      runDistanceModel(r.points, sampleSpacing, runElevationsFt?.[i] ?? []),
    );
    let minElev = Infinity;
    models.forEach((m, i) => {
      if (m) for (const v of runElevationsFt![i]) minElev = Math.min(minElev, v);
    });
    if (!Number.isFinite(minElev)) minElev = 0;

    const geo = runs.map((r) => ({ pts: r.points, cum: cumLengths(r.points) }));
    const zOf = (ri: number, d: number) => {
      const m = models[ri];
      return m ? (m.atDistPx(d) - minElev) * scale * HEIGHT_EXAGGERATION : 0;
    };

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
        const ux = (B0.x - A0.x) / Math.max(1e-6, Math.hypot(B0.x - A0.x, B0.y - A0.y));
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
          if (models[ri] && (zA > 0.5 || zB > 0.5)) {
            faces.push({
              kind: "skirt",
              depth: depth - 0.02,
              quad: [proj(A0, zA), proj(B0, zB), proj(B0, 0), proj(A0, 0)],
              shaded,
              baseLenPx: len,
            });
          }
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
          const riseFt = (zB - zA) / (scale * HEIGHT_EXAGGERATION);
          // A sheer drop under a confirmed retaining wall renders as a
          // masonry face with the fence anchored level on the cap; other
          // over-limit rises step down the slope as terrain.
          const wallish =
            retainingWall && !!models[ri] && Math.abs(riseFt) >= WALL_RISE_FT;
          const stepped = !wallish && !!models[ri] && Math.abs(riseFt) > rackFt;
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
            if (zLo > 0.5) {
              faces.push({
                kind: "skirt",
                depth: depth - 0.03,
                quad: [proj(A, zLo), proj(B, zLo), proj(B, 0), proj(A, 0)],
                shaded,
                baseLenPx: Math.hypot(B.x - A.x, B.y - A.y),
              });
            }
          } else if (models[ri] && (zA > 0.5 || zB > 0.5)) {
            faces.push({
              kind: "skirt",
              depth: depth - 0.02,
              quad: [proj(A, zA), proj(B, zB), proj(B, 0), proj(A, 0)],
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

    // Posts as thin quads: ground → tallest adjacent panel (+cap).
    const postW = Math.max(2.5, 0.45 * scale);
    for (const p of posts.values()) {
      const w = p.heavy ? postW * 1.6 : postW;
      faces.push({
        kind: "post",
        depth: proj(p.plan, 0).y + 0.01, // draw just after coplanar panels
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
    }

    faces.sort((f1, f2) => f1.depth - f2.depth);

    // Ground: parcel rings at z=0.
    const groundPaths = parcelRings.map((ring) => ring.map((p) => proj(p, 0)));

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
    const margin = 46;
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
      hasTerrain: models.some(Boolean),
    };
  }, [runs, gates, heightFt, typeId, pxPerFt, parcelRings, runElevationsFt, elevationSpacingPx, retainingWall]);

  if (!scene) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400", className)}>
        Draw a fence run to see the 3D preview.
      </div>
    );
  }

  const { style, faces, labels, groundPaths, marker, label, railCount, capRail, gateCount, steppedCount, wallCount } = scene;
  const quadPath = (q: Face["quad"]) =>
    `M${q[0].x.toFixed(1)} ${q[0].y.toFixed(1)} L${q[1].x.toFixed(1)} ${q[1].y.toFixed(1)} L${q[2].x.toFixed(1)} ${q[2].y.toFixed(1)} L${q[3].x.toFixed(1)} ${q[3].y.toFixed(1)} Z`;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-zinc-200", className)}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-full w-full" role="img" aria-label={`3D preview of the ${label} fence as designed`}>
        {/* sky→lawn backdrop */}
        <defs>
          <linearGradient id="f3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EAF3FA" />
            <stop offset="52%" stopColor="#F1F6EC" />
            <stop offset="100%" stopColor="#D5E4D2" />
          </linearGradient>
          <linearGradient id="f3d-earth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C7DBBD" />
            <stop offset="100%" stopColor="#A9C29B" />
          </linearGradient>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#f3d-bg)" />

        {/* property line on the ground */}
        {groundPaths.map((ring, i) => (
          <polygon
            key={i}
            points={ring.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="rgba(63,166,91,0.05)"
            stroke="#3FA65B"
            strokeWidth={1.5}
            strokeDasharray="7 5"
          />
        ))}

        {/* faces, back to front (earth skirts sort with their sections) */}
        {faces.map((f, i) => {
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
              // hinge at the outer edge of each leaf; brace runs hinge-bottom → latch-top
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
      </div>
    </div>
  );
}
