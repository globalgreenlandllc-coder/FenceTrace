"use client";

import { useMemo } from "react";
import {
  VIEWBOX_W,
  VIEWBOX_H,
  BlueprintBackground,
} from "./aerial-shared";
import { PX_PER_FT } from "./aerial-constants";
import {
  bboxOfPoints,
  polylineLengthFt,
  reflexCorners,
  type Pt,
  type DBBox,
} from "@/lib/diagram-geom";
import {
  layoutLabels,
  polylineLabelAnchor,
  type LabelBox,
  type PlacedLabel,
} from "@/lib/diagram-labels";
import type { Downspout, EditableLine, RoofStructure } from "@/lib/types";

/**
 * GutterDiagram — a light, brand-blue "drafting sheet" rendering of a
 * satellite/address takeoff, the way pro roof reports (EagleView / Roofr)
 * present measurements: a clean 2D top-down vector diagram derived from the
 * footprint at the trace's true px/ft scale, NOT colored lines painted on
 * the photo.
 *
 * GUTTER-FIRST (the product's differentiator): eaves are the bold hero line
 * in the water-blue brand color (gutter = where the water goes), each run
 * LF-labeled; rakes are de-emphasized dashed "no gutter" gable edges;
 * downspouts are numbered drops; inside corners get a miter chevron; the
 * roof skeleton (real detected ridges/valleys) is faint and decorative.
 *
 * All geometry is already in the 900×580 canvas viewBox (COVER-fit of the
 * tile), so nothing is reprojected. Purely a render + read-only summary math
 * over the SAME eaves the pricing path sums — it never changes a priced
 * total.
 *
 * Gutter runs are tier-colored so the client can read the roof: main
 * (perimeter) runs in brand blue, upper-roof interior loops (the
 * solar engine's auto-priced `tier-eave-*` runs) in a lighter sky
 * blue, and plan-mode low-roof runs (porch / garage, tier "lower") in
 * amber-brown — with a legend whenever more than one tier is present.
 */

// Palette — the app's water-blue brand (#14688C) is the gutter.
const C = {
  eave: "#14688c",
  eaveInk: "#10475e",
  eaveUpper: "#4e9fc4",
  eaveUpperInk: "#2b6f8e",
  eaveLow: "#a8712c",
  eaveLowInk: "#7c5320",
  rake: "#a8977b",
  drop: "#e8687a",
  mass: "rgba(20,58,74,.055)",
  massEdge: "rgba(20,58,74,.35)",
  skeleton: "rgba(20,58,74,.30)",
  chipFill: "rgba(255,255,255,.94)",
  chipStroke: "rgba(30,58,138,.35)",
  chipText: "#10475e",
  paper: "#f7f4ee",
};

/** Which visual tier a priced run belongs to. Satellite upper-roof
 *  loops are tagged by id (`tier-eave-*`, solar-engine); plan-mode
 *  porch/garage runs carry `tier: "lower"`. Everything else is the
 *  main eave line. */
function runTier(line: EditableLine): "main" | "upper" | "low" {
  if (line.id.startsWith("tier-eave-") || line.id.startsWith("eave-from-tier-")) return "upper";
  if (line.tier === "lower") return "low";
  return "main";
}

const TIER_STYLE = {
  main: { stroke: C.eave, ink: C.eaveInk, label: "Fence line" },
  upper: { stroke: C.eaveUpper, ink: C.eaveUpperInk, label: "Fence run" },
  low: { stroke: C.eaveLow, ink: C.eaveLowInk, label: "Secondary run" },
} as const;

const LABEL_MIN_FT = 6;

type SimpleLine = Pick<EditableLine, "id" | "points">;

function pathD(points: Pt[]): string {
  if (points.length === 0) return "";
  return (
    `M ${points[0].x} ${points[0].y} ` +
    points
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ")
  );
}

export function GutterDiagram({
  eaves,
  rakes = [],
  downspouts,
  roofStructure,
  pxPerFt,
  address,
  confidence,
  presentation,
  redactNumbers,
  className,
}: {
  eaves: EditableLine[];
  rakes?: EditableLine[];
  downspouts: Downspout[];
  roofStructure?: RoofStructure;
  /** Satellite trace's canvas-px-per-foot. Falls back to the plan constant
   *  only so labels never divide by undefined; satellite always passes it. */
  pxPerFt?: number;
  address?: string;
  /** 0–1 trace confidence → drives the header badge. */
  confidence?: number;
  /** Client-deliverable mode (proposal preview + portal): only the
   *  perimeter, priced gutter runs and downspouts render — no dashed
   *  rakes, no dotted roof seams. */
  presentation?: boolean;
  /** Anonymous teaser mode (landing page): the trace renders, the
   *  numbers don't — no LF pills, and the totals chip becomes a locked
   *  "sign up to reveal" pill. The API already withholds the scale, so
   *  this is presentation-layer consistency, not the security boundary. */
  redactNumbers?: boolean;
  className?: string;
}) {
  const rawScale = Number.isFinite(pxPerFt) && (pxPerFt ?? 0) > 0 ? pxPerFt! : PX_PER_FT;

  const rawPerimeter = roofStructure?.perimeter ?? [];

  // CONTAIN-FIT the content onto the sheet when it overflows. Geometry
  // arrives in the 900×580 canvas space, but a COVER-fit source image
  // whose aspect isn't 900:580 (tight solar crops, older saved
  // proposals) legally places points outside the viewBox — without this
  // the roof clips at the sheet edge. Identity when everything already
  // fits, so plan-mode diagrams render exactly as before. pxPerFt is
  // scaled by the same factor, so every LF label and the scale bar stay
  // true.
  const fit = useMemo(() => {
    const pts: Pt[] = [
      ...rawPerimeter,
      ...eaves.flatMap((e) => e.points),
      // Rakes are hidden in presentation mode, so they must not
      // influence its fit either.
      ...(presentation ? [] : rakes.flatMap((e) => e.points)),
      ...downspouts.map((d) => ({ x: d.x, y: d.y })),
    ].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const bb = bboxOfPoints(pts);
    if (!bb) return { s: 1, tx: 0, ty: 0 };
    const inside =
      bb.minX >= 0 &&
      bb.minY >= 0 &&
      bb.maxX <= VIEWBOX_W &&
      bb.maxY <= VIEWBOX_H;
    if (inside) return { s: 1, tx: 0, ty: 0 };
    const M = 56; // clear the sheet frame + HTML overlay chips
    const w = Math.max(1, bb.maxX - bb.minX);
    const h = Math.max(1, bb.maxY - bb.minY);
    const s = Math.min((VIEWBOX_W - 2 * M) / w, (VIEWBOX_H - 2 * M) / h, 1);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    return { s, tx: VIEWBOX_W / 2 - cx * s, ty: VIEWBOX_H / 2 - cy * s };
  }, [rawPerimeter, eaves, rakes, downspouts, presentation]);

  const tp = useMemo(() => {
    const { s, tx, ty } = fit;
    return (p: Pt): Pt => ({ x: p.x * s + tx, y: p.y * s + ty });
  }, [fit]);
  const scale = rawScale * fit.s;

  const nEaves = useMemo(
    () => eaves.map((e) => ({ ...e, points: e.points.map(tp) })),
    [eaves, tp],
  );
  const nRakes = useMemo(
    () => rakes.map((e) => ({ ...e, points: e.points.map(tp) })),
    [rakes, tp],
  );
  const nDownspouts = useMemo(
    () => downspouts.map((d) => ({ ...d, ...tp({ x: d.x, y: d.y }) })),
    [downspouts, tp],
  );
  const perimeter = useMemo(() => rawPerimeter.map(tp), [rawPerimeter, tp]);
  const hasPerimeter = perimeter.length >= 3;

  const bbox: DBBox | null = useMemo(() => {
    if (hasPerimeter) return bboxOfPoints(perimeter);
    const pts = nEaves.flatMap((e) => e.points);
    return bboxOfPoints(pts);
  }, [hasPerimeter, perimeter, nEaves]);

  const centroid: Pt = useMemo(() => {
    if (bbox) return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
    return { x: VIEWBOX_W / 2, y: VIEWBOX_H / 2 };
  }, [bbox]);

  const insideCorners = useMemo(
    () => (hasPerimeter ? reflexCorners(perimeter) : []),
    [hasPerimeter, perimeter],
  );

  const totalEaveLF = useMemo(
    () => Math.round(nEaves.reduce((s, e) => s + polylineLengthFt(e.points, scale), 0)),
    [nEaves, scale],
  );

  // Which tiers are actually present — drives the legend (only shown
  // when there's more than the plain main run to explain).
  const tiersPresent = useMemo(() => {
    const set = new Set(nEaves.map((e) => runTier(e)));
    return (["main", "upper", "low"] as const).filter((t) => set.has(t));
  }, [nEaves]);

  // Scale bar: a 10 ft segment at the trace's px/ft (clamped so it never
  // dominates a tiny-scale plan fallback).
  const scaleBarPx = Math.max(24, Math.min(180, 10 * scale));

  // Real detected roof seams (decorative, faint). Satellite has no hips.
  const skeleton: { pts: Pt[]; dash: boolean }[] = presentation
    ? []
    : [
        ...(roofStructure?.ridges ?? []).map((l) => ({ pts: l.points.map(tp), dash: false })),
        ...(roofStructure?.valleys ?? []).map((l) => ({ pts: l.points.map(tp), dash: true })),
      ].filter((l) => l.pts.length >= 2);

  // Offsets clear the eave LF pills (which kick ~12px outward from the
  // runs) so a side label never sits on top of a measurement.
  const orientationChips: { label: string; at: Pt }[] = bbox
    ? [
        { label: "BACK", at: { x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY - 26 } },
        { label: "FRONT", at: { x: (bbox.minX + bbox.maxX) / 2, y: bbox.maxY + 26 } },
        { label: "LEFT", at: { x: bbox.minX - 42, y: (bbox.minY + bbox.maxY) / 2 } },
        { label: "RIGHT", at: { x: bbox.maxX + 42, y: (bbox.minY + bbox.maxY) / 2 } },
      ].filter(
        (c) => c.at.x > 8 && c.at.x < VIEWBOX_W - 8 && c.at.y > 8 && c.at.y < VIEWBOX_H - 8,
      )
    : [];

  const confPct = confidence != null ? Math.round(confidence * 100) : null;

  // Clockwise walk-around numbering (from top-left) so the drop numbers
  // read as an ordered tour of the house, matching the proposal preview.
  const dropOrder = useMemo(() => {
    if (nDownspouts.length === 0) return new Map<string, number>();
    let cx = 0;
    let cy = 0;
    for (const d of nDownspouts) {
      cx += d.x;
      cy += d.y;
    }
    cx /= nDownspouts.length;
    cy /= nDownspouts.length;
    const start = (-Math.PI * 3) / 4;
    const key = (d: { x: number; y: number }) =>
      (Math.atan2(d.y - cy, d.x - cx) - start + Math.PI * 2) % (Math.PI * 2);
    const sorted = [...nDownspouts].sort((a, b) => key(a) - key(b));
    return new Map(sorted.map((d, i) => [d.id, i + 1]));
  }, [nDownspouts]);

  // Global LF-pill layout: each label starts perpendicular off its run
  // (away from the roof center) and the solver relaxes it clear of the
  // other pills, the numbered drops, the orientation chips and every
  // run — so a label can never cover a downspout number or cross a line.
  // Labels that had to travel draw a thin leader back to their run.
  const labelPlaced = useMemo(() => {
    if (redactNumbers) return new Map<string, PlacedLabel>();
    const items: LabelBox[] = [];
    for (const line of nEaves) {
      if (line.points.length < 2) continue;
      const len = Math.round(polylineLengthFt(line.points, scale));
      if (len < LABEL_MIN_FT) continue;
      const anchor = polylineLabelAnchor(line.points);
      if (!anchor) continue;
      let { nx, ny } = anchor;
      const { mid } = anchor;
      if ((mid.x - centroid.x) * nx + (mid.y - centroid.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      items.push({
        id: line.id,
        cx: mid.x + nx * 13,
        cy: mid.y + ny * 13,
        w: 44,
        h: 17,
      });
    }
    if (items.length === 0) return new Map<string, PlacedLabel>();
    const polys = [...nEaves, ...(presentation ? [] : nRakes)];
    const segments = polys.flatMap((l) =>
      l.points.slice(1).map((p, i) => ({ a: l.points[i], b: p, pad: 3 })),
    );
    if (hasPerimeter) {
      for (let i = 0; i < perimeter.length; i++) {
        segments.push({
          a: perimeter[i],
          b: perimeter[(i + 1) % perimeter.length],
          pad: 2,
        });
      }
    }
    const discs = nDownspouts.map((d) => ({ x: d.x, y: d.y, r: 11 }));
    const rects = orientationChips.map((c) => ({
      cx: c.at.x,
      cy: c.at.y,
      w: c.label.length * 6.2 + 12,
      h: 14,
    }));
    return layoutLabels(
      items,
      { segments, discs, rects },
      {
        // Top inset clears the HTML overlay chips (address / totals).
        bounds: { minX: 12, minY: 36, maxX: VIEWBOX_W - 12, maxY: VIEWBOX_H - 14 },
        gap: 3,
      },
    );
  }, [
    redactNumbers,
    nEaves,
    nRakes,
    presentation,
    hasPerimeter,
    perimeter,
    nDownspouts,
    orientationChips,
    scale,
    centroid,
  ]);

  return (
    <div
      className={
        "relative h-full w-full overflow-hidden rounded-2xl ring-1 ring-indigo-200/40 " +
        (className ?? "")
      }
      style={{ background: C.paper }}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        style={{ minHeight: 320 }}
        role="img"
        aria-label="Fence measurement diagram"
      >
        <BlueprintBackground />

        {/* Filled roof mass so the building reads as a solid shape. In
            presentation mode the perimeter is the only outline left, so
            it gets a slightly firmer stroke. */}
        {hasPerimeter && (
          <path
            d={pathD(perimeter) + " Z"}
            fill={C.mass}
            stroke={presentation ? "rgba(20,58,74,.5)" : C.massEdge}
            strokeWidth={presentation ? 1.8 : 1.4}
            strokeLinejoin="round"
          />
        )}

        {/* Faint real roof seams (ridges solid, valleys dashed) */}
        {skeleton.map((l, i) => (
          <path
            key={`sk-${i}`}
            d={pathD(l.pts)}
            fill="none"
            stroke={C.skeleton}
            strokeWidth={1.1}
            strokeDasharray={l.dash ? "5 4" : "1 5"}
            strokeLinecap="round"
          />
        ))}

        {/* Rakes — de-emphasized dashed "no gutter" gable edges */}
        {!presentation && nRakes.map((line) => (
          <path
            key={line.id}
            d={pathD(line.points)}
            fill="none"
            stroke={C.rake}
            strokeWidth={2.4}
            strokeDasharray="6 4"
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}

        {/* Eaves — the hero. Bold, tier-colored, LF-labeled. */}
        {nEaves.map((line) => (
          <path
            key={line.id}
            d={pathD(line.points)}
            fill="none"
            stroke={TIER_STYLE[runTier(line)].stroke}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {!redactNumbers &&
          nEaves.map((line) => (
            <EaveLabel
              key={`lbl-${line.id}`}
              line={line}
              pxPerFt={scale}
              centroid={centroid}
              tier={runTier(line)}
              at={labelPlaced.get(line.id)}
            />
          ))}

        {/* Inside-corner miter chevrons */}
        {insideCorners.map((p, i) => (
          <circle
            key={`ic-${i}`}
            cx={p.x}
            cy={p.y}
            r={4.5}
            fill="none"
            stroke={C.eave}
            strokeWidth={1.6}
            opacity={0.9}
          />
        ))}

        {/* Downspouts — numbered coral drops (clockwise walk-around) */}
        {nDownspouts.map((d, i) => {
          const num = dropOrder.get(d.id) ?? i + 1;
          return (
            <g key={d.id}>
              <circle cx={d.x} cy={d.y} r={8} fill={C.drop} stroke="#fff" strokeWidth={1.8} />
              <text
                x={d.x}
                y={d.y + 3}
                textAnchor="middle"
                fontSize={num >= 10 ? 8 : 9}
                fontWeight={700}
                fill="#fff"
                fontFamily="ui-sans-serif, system-ui"
              >
                {num}
              </text>
            </g>
          );
        })}

        {/* Orientation chips (paired with the north arrow for true bearing) */}
        {orientationChips.map((c) => {
          const w = c.label.length * 6.2 + 12;
          return (
            <g key={c.label}>
              <rect
                x={c.at.x - w / 2}
                y={c.at.y - 7}
                width={w}
                height={14}
                rx={3}
                fill={C.chipFill}
                stroke={C.chipStroke}
                strokeWidth={0.8}
              />
              <text
                x={c.at.x}
                y={c.at.y + 3.4}
                textAnchor="middle"
                fontSize={8}
                fontWeight={700}
                letterSpacing="1"
                fill={C.chipText}
                fontFamily="ui-sans-serif, system-ui"
              >
                {c.label}
              </text>
            </g>
          );
        })}

        {/* North arrow (tile is north-up) */}
        <g transform={`translate(${VIEWBOX_W - 44}, 40)`}>
          <line x1={0} y1={26} x2={0} y2={2} stroke={C.eave} strokeWidth={2} />
          <path d={`M -4 8 L 0 0 L 4 8`} fill="none" stroke={C.eave} strokeWidth={2} strokeLinejoin="round" />
          <text x={0} y={40} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.eaveInk} fontFamily="ui-sans-serif, system-ui">
            N
          </text>
        </g>

        {/* Scale bar */}
        <g transform={`translate(40, ${VIEWBOX_H - 40})`} fontFamily="ui-monospace, monospace" fontSize={9} fill="#5a7583">
          <line x1={0} y1={0} x2={scaleBarPx} y2={0} stroke="#5a7583" strokeWidth={1.4} />
          <line x1={0} y1={-4} x2={0} y2={4} stroke="#5a7583" strokeWidth={1.4} />
          <line x1={scaleBarPx} y1={-4} x2={scaleBarPx} y2={4} stroke="#5a7583" strokeWidth={1.4} />
          <text x={0} y={14}>0</text>
          <text x={scaleBarPx} y={14} textAnchor="end">10 ft</text>
        </g>
      </svg>

      {/* HTML overlays — crisp text that scales with the container */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-[45%] sm:max-w-[60%]">
        {address && (
          <div
            className="truncate rounded-md bg-white/85 px-2.5 py-1 font-mono text-[11px] font-medium text-[#10475e] ring-1 ring-[#14688c]/20"
            title={address}
          >
            {address}
          </div>
        )}
      </div>
      {/* Wraps to a right-aligned stack on phones so it never runs into
          the address chip pinned at the opposite corner. */}
      <div className="pointer-events-none absolute right-3 top-3 flex max-w-[52%] flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        {confPct != null && (
          <span
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold " +
              (confPct >= 70
                ? "bg-emerald-500/12 text-emerald-700"
                : "bg-amber-500/14 text-amber-700")
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {confPct >= 70 ? "High confidence" : `${confPct}% confidence`}
          </span>
        )}
        {redactNumbers ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#14688c] px-2.5 py-1 text-[11px] font-semibold text-white">
            🔒 Measurements ready — free account to reveal
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#14688c] px-2.5 py-1 text-[11px] font-semibold text-white tabular-nums">
            {totalEaveLF} LF fence
            <span className="opacity-60">·</span>
            {downspouts.length} {downspouts.length === 1 ? "gate" : "gates"}
          </span>
        )}
      </div>
      {/* Legend — explains the colors whenever the roof has more than
          the plain main run (upper loops / low porch roofs). */}
      {tiersPresent.length > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-white/92 px-3 py-1.5 ring-1 ring-[#14688c]/15">
          {tiersPresent.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: TIER_STYLE[t].ink }}>
              <span className="h-[3px] w-4 rounded-full" style={{ background: TIER_STYLE[t].stroke }} />
              {TIER_STYLE[t].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: "#b34557" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: C.drop }} />
            Gate
          </span>
        </div>
      )}
    </div>
  );
}

/** Compact LF pill, offset perpendicular to the run and away from the roof
 *  centroid so labels sit outside the outline instead of crossing it. */
function EaveLabel({
  line,
  pxPerFt,
  centroid,
  tier = "main",
  at,
}: {
  line: SimpleLine;
  pxPerFt: number;
  centroid: Pt;
  tier?: keyof typeof TIER_STYLE;
  /** Solver-resolved pill center (de-collided from other pills, drops,
   *  chips and runs). When it traveled, a thin leader ties it back. */
  at?: PlacedLabel;
}) {
  if (line.points.length < 2) return null;
  const len = Math.round(polylineLengthFt(line.points, pxPerFt));
  if (len < LABEL_MIN_FT) return null;
  // Hang the label (and its leader) off the run's longest straight leg —
  // the first→last chord breaks on jogging runs and closed tier loops.
  const anchor = polylineLabelAnchor(line.points);
  if (!anchor) return null;
  let nx = anchor.nx * 12;
  let ny = anchor.ny * 12;
  const cx = anchor.mid.x;
  const cy = anchor.mid.y;
  // Kick the label to the side away from the centroid.
  if ((cx - centroid.x) * nx + (cy - centroid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const lx = at ? at.cx : cx + nx;
  const ly = at ? at.cy : cy + ny;
  const showLeader = !!at && at.moved > 16;
  const w = 42;
  return (
    <g pointerEvents="none">
      {showLeader && (
        <line
          x1={cx}
          y1={cy}
          x2={lx}
          y2={ly}
          stroke={TIER_STYLE[tier].stroke}
          strokeWidth={0.8}
          opacity={0.5}
        />
      )}
      <rect x={lx - w / 2} y={ly - 8} width={w} height={16} rx={3.5} fill={C.paper} stroke={TIER_STYLE[tier].stroke} strokeWidth={0.8} />
      <text
        x={lx}
        y={ly + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill={TIER_STYLE[tier].ink}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {len} ft
      </text>
    </g>
  );
}
