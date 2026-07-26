"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { fenceType, type FenceTypeId } from "@/lib/fence/catalog";

/**
 * Fence3D — a to-scale isometric preview of the drawn fence, hand-rolled
 * in SVG (no 3D library: deterministic, fast, prints cleanly in the
 * proposal PDF and the client portal).
 *
 * Model: the 2D layout (canvas space, px) is rotated and foreshortened
 * into an axonometric ground plane; posts and panels extrude upward by
 * the fence height (ft × pxPerFt). Painter's algorithm sorts faces
 * back-to-front; panels facing "away" get the shaded tone so corners
 * read. Gates render as braced lighter panels with a marker.
 */

type Pt = { x: number; y: number };

const VIEW_W = 900;
const VIEW_H = 560;
const ROT = (-28 * Math.PI) / 180;
const SQUASH = 0.52;
const HEIGHT_EXAGGERATION = 1.3; // readability: fences are long + short
const GATE_HALF_FT = 2; // walk-gate visual half-width

/** Rotate + foreshorten a plan point, then lift by z (screen px). */
function proj(p: Pt, z: number): Pt {
  const rx = p.x * Math.cos(ROT) - p.y * Math.sin(ROT);
  const ry = p.x * Math.sin(ROT) + p.y * Math.cos(ROT);
  return { x: rx, y: ry * SQUASH - z };
}

type Face = {
  kind: "panel" | "gate" | "post";
  /** Painter depth — projected plan-y of the base midpoint. */
  depth: number;
  /** Quad corners in projected space: baseA, baseB, topB, topA. */
  quad: [Pt, Pt, Pt, Pt];
  /** Faces whose outward normal points left get the shade tone. */
  shaded: boolean;
  /** Plan-space base segment (for picket/bar spacing). */
  baseLenPx: number;
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

export function Fence3D({
  runs,
  gates,
  heightFt,
  typeId = "cedar-privacy",
  pxPerFt,
  parcelRings = [],
  className,
}: {
  /** Fence runs in canvas space ({points} is all that's read). */
  runs: { points: Pt[] }[];
  /** Gate markers sitting on runs (canvas space). */
  gates: Pt[];
  heightFt: number;
  typeId?: string;
  pxPerFt?: number;
  parcelRings?: Pt[][];
  className?: string;
}) {
  const scene = useMemo(() => {
    const t = fenceType(typeId as FenceTypeId);
    const style = STYLES[t.category] ?? STYLES.wood;
    const scale = pxPerFt && pxPerFt > 0 ? pxPerFt : 2.4;
    const zTop = heightFt * scale * HEIGHT_EXAGGERATION;
    const postEvery = t.postSpacingFt * scale;
    const gateHalf = GATE_HALF_FT * scale;

    const faces: Face[] = [];
    const postBases: Pt[] = [];

    const nearGate = (p: Pt) =>
      gates.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < gateHalf);

    for (const run of runs) {
      const pts = run.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen < 1) continue;
        const ux = (b.x - a.x) / segLen;
        const uy = (b.y - a.y) / segLen;
        // Posts along the segment (always one at the start; the final
        // vertex of the run gets one from the last chunk's end).
        const chunks = Math.max(1, Math.ceil(segLen / postEvery));
        for (let c = 0; c < chunks; c++) {
          const s0 = (segLen * c) / chunks;
          const s1 = (segLen * (c + 1)) / chunks;
          const pa = { x: a.x + ux * s0, y: a.y + uy * s0 };
          const pb = { x: a.x + ux * s1, y: a.y + uy * s1 };
          postBases.push(pa);
          if (c === chunks - 1) postBases.push(pb);
          const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
          const isGate = nearGate(mid);
          const depth = proj(mid, 0).y;
          // Outward normal (plan): (-uy, ux); shade faces pointing left.
          const shaded = -uy < 0;
          faces.push({
            kind: isGate ? "gate" : "panel",
            depth,
            quad: [
              proj(pa, 0),
              proj(pb, 0),
              proj(pb, zTop),
              proj(pa, zTop),
            ],
            shaded,
            baseLenPx: Math.hypot(pb.x - pa.x, pb.y - pa.y),
          });
        }
      }
    }

    // Posts as thin quads slightly above panel tops (caps read as dots).
    const postW = Math.max(2.5, 0.45 * scale);
    for (const base of postBases) {
      const depth = proj(base, 0).y + 0.01; // draw just after coplanar panels
      faces.push({
        kind: "post",
        depth,
        quad: [
          proj({ x: base.x - postW / 2, y: base.y }, 0),
          proj({ x: base.x + postW / 2, y: base.y }, 0),
          proj({ x: base.x + postW / 2, y: base.y }, zTop + 0.4 * scale),
          proj({ x: base.x - postW / 2, y: base.y }, zTop + 0.4 * scale),
        ],
        shaded: false,
        baseLenPx: postW,
      });
    }

    faces.sort((f1, f2) => f1.depth - f2.depth);

    // Ground: parcel rings at z=0.
    const groundPaths = parcelRings.map((ring) =>
      ring.map((p) => proj(p, 0)),
    );

    // Fit everything into the viewBox.
    const all: Pt[] = [
      ...faces.flatMap((f) => f.quad),
      ...groundPaths.flat(),
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

    return {
      style,
      label: `${heightFt}' ${t.label}`,
      faces: faces.map((f) => ({ ...f, quad: f.quad.map(T) as Face["quad"] })),
      groundPaths: groundPaths.map((ring) => ring.map(T)),
      fit,
      railCount: t.railsPerSection(heightFt),
    };
  }, [runs, gates, heightFt, typeId, pxPerFt, parcelRings]);

  if (!scene) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400", className)}>
        Draw a fence run to see the 3D preview.
      </div>
    );
  }

  const { style, faces, groundPaths, label, railCount } = scene;
  const quadPath = (q: Face["quad"]) =>
    `M${q[0].x.toFixed(1)} ${q[0].y.toFixed(1)} L${q[1].x.toFixed(1)} ${q[1].y.toFixed(1)} L${q[2].x.toFixed(1)} ${q[2].y.toFixed(1)} L${q[3].x.toFixed(1)} ${q[3].y.toFixed(1)} Z`;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-zinc-200", className)}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-full w-full" role="img" aria-label={`3D preview of the ${label} fence as designed`}>
        {/* sky→lawn backdrop */}
        <defs>
          <linearGradient id="f3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F4F8F3" />
            <stop offset="58%" stopColor="#E8F0E6" />
            <stop offset="100%" stopColor="#D5E4D2" />
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

        {/* fence faces, back to front */}
        {faces.map((f, i) => {
          if (f.kind === "post") {
            return <path key={i} d={quadPath(f.quad)} fill={style.post} stroke={style.stroke} strokeWidth={0.8} />;
          }
          const fill = f.kind === "gate" ? "#EAD9BC" : f.shaded ? style.shade : style.face;
          const details: React.ReactNode[] = [];
          const [a, b, tb, ta] = f.quad;
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
              {f.kind === "gate" && (
                <>
                  <line x1={a.x} y1={a.y} x2={tb.x} y2={tb.y} stroke="rgba(0,0,0,0.22)" strokeWidth={1.4} />
                  <circle cx={(ta.x + tb.x) / 2} cy={(ta.y + tb.y) / 2 - 7} r={5.5} fill="#f472b6" stroke="#fff" strokeWidth={1.5} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200">
        {label} — to scale
      </span>
    </div>
  );
}
