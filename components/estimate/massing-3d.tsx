"use client";

import { useMemo, useState } from "react";
import { deriveRoofSkeleton, segmentsOverlap } from "@/lib/roof-skeleton";
import type {
  Downspout,
  EditableLine,
  RoofStructure,
  Stories,
} from "@/lib/types";
import {
  buildMassing,
  centerOf,
  bboxOf,
  modelRadius,
  project,
  sortFacesByDepth,
  wallHeightFt,
  type Edge3,
  type Face,
  type P3,
  type Proj,
} from "@/lib/massing-3d";
import { PX_PER_FT, VIEWBOX_W, VIEWBOX_H } from "./aerial-constants";
import { THEMES, NeonDefs } from "./aerial-shared";

const TILT = Math.PI / 6; // fixed camera pitch
const t = THEMES.tactical;

/**
 * Rotatable axonometric "3D" massing of the takeoff — an alternative to the
 * top-down roof plan. Extrudes the footprint to wall height, caps it with the
 * derived roof skeleton, and lifts each gutter (eave) + downspout onto the
 * correct wall so the contractor can spin the building and read which side
 * each runs on (mirrors the elevation sheets). READ-ONLY + decorative — it
 * takes no setters and never affects LF / pricing.
 */
export function Massing3D({
  eaves,
  rakes = [],
  downspouts,
  roofStructure,
  planSource,
  stories,
}: {
  eaves: EditableLine[];
  rakes?: EditableLine[];
  downspouts: Downspout[];
  roofStructure?: RoofStructure;
  planSource?: { pdfUrl: string; pageIndex: number };
  stories?: Stories;
}) {
  const [yawDeg, setYawDeg] = useState(35);
  const yaw = (yawDeg * Math.PI) / 180;

  const model = useMemo(() => {
    const toSegs = (ls: { points: { x: number; y: number }[] }[]) =>
      ls
        .filter((e) => e.points.length >= 2)
        .map(
          (e) =>
            [e.points[0], e.points[e.points.length - 1]] as [
              { x: number; y: number },
              { x: number; y: number },
            ],
        );
    const wallFt = wallHeightFt(stories);

    // Footprint: the AI/derived perimeter when present, else the bbox of the
    // eave points so a satellite/manual takeoff still gets a box.
    let perimeter = (roofStructure?.perimeter ?? []).filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    if (perimeter.length < 3) {
      const bb = bboxOf(eaves.flatMap((e) => e.points));
      perimeter = bb
        ? [
            { x: bb.minX, y: bb.minY },
            { x: bb.maxX, y: bb.minY },
            { x: bb.maxX, y: bb.maxY },
            { x: bb.minX, y: bb.maxY },
          ]
        : [];
    }
    const center = centerOf(perimeter);
    if (!center || perimeter.length < 3) return null;

    const derive = !!planSource;
    const skeleton = derive
      ? deriveRoofSkeleton(perimeter, {
          eaveSegments: toSegs(eaves),
          rakeSegments: toSegs(rakes),
        })
      : { ridges: [], hips: [], valleys: [], gables: [] };

    const r = modelRadius(perimeter, center);
    const bb = bboxOf(perimeter)!;
    const shortSpanPx = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
    const ridgeRiseFt = (0.22 * shortSpanPx) / PX_PER_FT; // gentle decorative pitch

    // Per-edge wall height: a wall that a LOWER-tier eave runs along (covered
    // porch / patio / garage) steps DOWN below the 2-story body, so the massing
    // reads as real tiers instead of one flat-topped box.
    const lowerFt = Math.min(wallHeightFt(1), wallFt);
    const eaveTol = Math.max(8, Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.06);
    const lowerSegs = eaves
      .filter((e) => e.tier === "lower" && e.points.length >= 2)
      .map(
        (e) =>
          [e.points[0], e.points[e.points.length - 1]] as [
            { x: number; y: number },
            { x: number; y: number },
          ],
      );
    const wallFtFor = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      lowerSegs.some((s) => segmentsOverlap([a, b], s, eaveTol)) ? lowerFt : wallFt;

    const { faces, edges } = buildMassing(
      perimeter,
      wallFtFor,
      skeleton,
      ridgeRiseFt,
      wallFt,
    );

    return { center, wallFt, ridgeRiseFt, faces, edges, r };
  }, [eaves, rakes, roofStructure, planSource, stories]);

  if (!model) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-white/10 bg-slate-950 text-sm text-slate-400">
        3D view needs a roof outline — run a plan takeoff first.
      </div>
    );
  }

  const { center, wallFt, ridgeRiseFt, faces, edges, r } = model;
  const heightPx = (wallFt + Math.max(0, ridgeRiseFt)) * PX_PER_FT;

  // Stable scale + vertical centering — computed from yaw-INVARIANT extents so
  // the model doesn't "breathe" while rotating.
  const safeR = Math.max(r, 1);
  const scale = Math.min(
    (VIEWBOX_W * 0.42) / safeR,
    (VIEWBOX_H * 0.42) / (safeR * Math.sin(TILT) + heightPx * Math.cos(TILT)),
    4,
  );
  const cx0 = VIEWBOX_W / 2;
  const topExtent = heightPx * Math.cos(TILT) * scale;
  const botExtent = safeR * Math.sin(TILT) * scale;
  const cy0 = VIEWBOX_H / 2 + (topExtent - botExtent) / 2;

  const proj = (p: P3): Proj => project(p, yaw, TILT, center);
  const screen = (p: P3) => {
    const q = proj(p);
    return { x: cx0 + q.x * scale, y: cy0 + q.y * scale };
  };
  const polyD = (pts: P3[], close = false) => {
    if (pts.length === 0) return "";
    const s = pts.map(screen);
    return (
      `M ${s[0].x} ${s[0].y} ` +
      s.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") +
      (close ? " Z" : "")
    );
  };

  const orderedFaces = sortFacesByDepth(faces, proj);
  const edgeStyle: Record<Edge3["kind"], { c: string; w: number; dash?: string }> = {
    ridge: { c: "rgba(203,213,225,0.9)", w: 1.6 },
    hip: { c: "rgba(125,211,252,0.85)", w: 1.6 },
    valley: { c: "rgba(196,181,253,0.9)", w: 1.5, dash: "5 4" },
    gable: { c: "rgba(148,163,184,0.95)", w: 1.8 },
  };

  // Gutter (eave) tier height in feet: lower porch ~10 (or the wall if shorter),
  // upper/unknown sit at the wall top.
  const tierFt = (tier?: string) =>
    tier === "lower" ? Math.min(10, wallFt) : wallFt;

  // Downspout top z = the tier height of the nearest eave endpoint (so it
  // hangs off a real gutter), else its own stored height, clamped to the body.
  const dsTopFt = (d: Downspout) => {
    let best: { dist: number; ft: number } | null = null;
    for (const e of eaves) {
      for (const p of e.points) {
        const dd = Math.hypot(p.x - d.x, p.y - d.y);
        if (!best || dd < best.dist) best = { dist: dd, ft: tierFt(e.tier) };
      }
    }
    if (best && best.dist < 40) return best.ft;
    return Math.min(Math.max(0, d.heightFt) || wallFt, wallFt);
  };

  // Occlusion: a line is "back" when its mean projected depth sits well behind
  // center — cull it so the near side reads cleanly instead of x-raying through.
  const meanDepth = (...ps: P3[]) =>
    ps.reduce((s, p) => s + proj(p).depth, 0) / Math.max(1, ps.length);
  const cullThresh = safeR * 0.15;
  const isBack = (...ps: P3[]) => meanDepth(...ps) > cullThresh;
  // Solid wall shading: near faces lighter, far faces darker → reads as a 3D
  // mass (opaque, so painter order hides whatever is behind it).
  const faceFill = (f: Face) => {
    const tt = Math.min(1, Math.max(0, (meanDepth(...f.verts) + safeR) / (2 * safeR)));
    const v = Math.round(76 - 46 * tt);
    return `rgb(${v}, ${v + 12}, ${v + 26})`;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        style={{ minHeight: 520 }}
      >
        <NeonDefs />
        {/* ground shadow */}
        <ellipse
          cx={cx0}
          cy={cy0 + botExtent * 0.4}
          rx={safeR * scale * 1.05}
          ry={safeR * scale * Math.sin(TILT) * 1.05}
          fill="rgba(0,0,0,0.25)"
        />
        {/* walls — far faces first (painter's algorithm), OPAQUE + depth-shaded
            so the near mass occludes everything behind it (no x-ray tangle) */}
        {orderedFaces.map((f: Face, i) => (
          <path
            key={`wall-${i}`}
            d={polyD(f.verts, true)}
            fill={faceFill(f)}
            stroke="rgba(226,232,240,0.45)"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ))}
        {/* roof skeleton — FRONT-facing lines only (back lines culled) */}
        {edges.map((e: Edge3, i) => {
          if (isBack(e.a, e.b)) return null;
          const st = edgeStyle[e.kind];
          return (
            <path
              key={`edge-${i}`}
              d={polyD([e.a, e.b])}
              fill="none"
              stroke={st.c}
              strokeWidth={st.w}
              strokeDasharray={st.dash}
              strokeLinecap="round"
            />
          );
        })}
        {/* GUTTERS — each eave lifted onto its wall top; front-facing only */}
        {eaves.map((e) => {
          if (e.points.length < 2) return null;
          const z = tierFt(e.tier);
          const lifted: P3[] = e.points.map((p) => ({ x: p.x, y: p.y, z }));
          if (isBack(lifted[0], lifted[lifted.length - 1])) return null;
          const lower = e.tier === "lower";
          return (
            <path
              key={`gutter-${e.id}`}
              d={polyD(lifted)}
              fill="none"
              stroke={lower ? "#fbbf24" : t.eave}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 5px rgba(0,229,255,0.6))" }}
            />
          );
        })}
        {/* DOWNSPOUTS — vertical from the gutter to grade; front-facing only */}
        {downspouts.map((d) => {
          const top: P3 = { x: d.x, y: d.y, z: dsTopFt(d) };
          const bot: P3 = { x: d.x, y: d.y, z: 0 };
          if (isBack(top, bot)) return null;
          const s = screen(top);
          return (
            <g key={`ds-${d.id}`}>
              <path
                d={polyD([top, bot])}
                fill="none"
                stroke={t.downspout}
                strokeWidth={2.6}
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 4px rgba(232,121,249,0.7))" }}
              />
              <circle cx={s.x} cy={s.y} r={3} fill={t.downspoutCore} />
            </g>
          );
        })}
      </svg>

      {/* Rotation controls */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-slate-950/90 to-transparent px-4 py-3">
        <span className="font-label text-[11px] text-accent-300">
          Rotate
        </span>
        <input
          type="range"
          min={0}
          max={360}
          value={yawDeg}
          onChange={(ev) => setYawDeg(Number(ev.target.value))}
          className="h-1 flex-1 cursor-pointer accent-accent-400"
          aria-label="Rotate building"
        />
        <div className="flex gap-1">
          {([
            ["Front", 35],
            ["Right", 125],
            ["Back", 215],
            ["Left", 305],
          ] as [string, number][]).map(([label, deg]) => (
            <button
              key={label}
              type="button"
              onClick={() => setYawDeg(deg)}
              className={
                "rounded-md px-2 py-1 text-[11px] font-medium transition " +
                (Math.abs(((yawDeg - deg) % 360 + 360) % 360) < 8
                  ? "bg-accent-500 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute left-4 top-3 text-[11px] font-medium text-slate-400">
        3D massing · schematic — verify
      </div>
    </div>
  );
}
