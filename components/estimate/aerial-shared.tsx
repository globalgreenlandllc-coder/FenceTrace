"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import type {
  Downspout,
  EaveSide,
  EditableLine,
  RoofStructure,
} from "@/lib/types";
import {
  deriveRoofSkeleton,
  extraGablesFromRakes,
  gableWingFaces,
  type Pt,
  type Dormer,
} from "@/lib/roof-skeleton";
import { engineDrawnGeometry } from "@/lib/roof-structure-view";
import { dropDanglingLines } from "@/lib/diagram-labels";
import {
  perimBBox,
  anchorForSide,
  sideSplit,
  type OrientSide,
} from "@/lib/orientation-anchor";

// Geometry constants live in a directive-free module so the SERVER-ONLY
// plan→estimate converter can import the real numbers. Importing them
// from this "use client" file server-side turns them into RSC client
// references (PX_PER_FT reads as an object → NaN). Imported here for this
// module's own use AND re-exported so existing client imports
// `from "@/components/estimate/aerial-shared"` keep working unchanged.
import { VIEWBOX_W, VIEWBOX_H, PX_PER_FT } from "./aerial-constants";
export { VIEWBOX_W, VIEWBOX_H, PX_PER_FT };

export type CanvasTheme = "tactical" | "schematic";

export const THEMES: Record<
  CanvasTheme,
  {
    eave: string;
    eaveSelected: string;
    eaveGlowFilter: string | null;
    downspout: string;
    downspoutCore: string;
    downspoutGlowFilter: string | null;
    overlay: string | null;
    handleStroke: string;
    handleFill: string;
    label: string;
  }
> = {
  tactical: {
    // Softer teal — was too bright and competed with the satellite
    // image for attention. New tone reads as a clear trace but lets
    // the roof show through clearly.
    eave: "#2dd4bf",
    eaveSelected: "#5eead4",
    eaveGlowFilter: "url(#neonCyanGlow)",
    downspout: "#e879f9",
    downspoutCore: "#fdf4ff",
    downspoutGlowFilter: "url(#neonMagentaGlow)",
    overlay: "rgba(2, 6, 23, 0.35)",
    handleStroke: "#5eead4",
    handleFill: "#0b1220",
    label: "#5eead4",
  },
  schematic: {
    eave: "#1479B8",
    eaveSelected: "#14688C",
    eaveGlowFilter: null,
    downspout: "#f8717e",
    downspoutCore: "#f8717e",
    downspoutGlowFilter: null,
    overlay: null,
    handleStroke: "#14688C",
    handleFill: "white",
    label: "#14688C",
  },
};

/**
 * SVG filter defs used for the Tactical theme. Drop this once anywhere
 * inside the SVG tree and the filters become referenceable as
 * `url(#neonCyanGlow)` / `url(#neonMagentaGlow)`.
 */
export function NeonDefs() {
  return (
    <defs>
      <filter id="neonCyanGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter
        id="neonMagentaGlow"
        x="-100%"
        y="-100%"
        width="300%"
        height="300%"
      >
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

export function AerialImage({ imageDataUrl }: { imageDataUrl: string }) {
  return (
    <image
      href={imageDataUrl}
      x={0}
      y={0}
      width={VIEWBOX_W}
      height={VIEWBOX_H}
      preserveAspectRatio="xMidYMid slice"
    />
  );
}

/**
 * Drafting-paper background for plan-based takeoffs. Replaces the
 * cartoon yard scene (and the unreliable "rasterize the source PDF
 * page" approach — Claude consistently picks the site plan page,
 * not the roof plan, because the schema has no robust way to tell
 * them apart).
 *
 * Visual: warm off-white paper with a faint engineering grid, corner
 * registration marks, and a subtle title-block-style trim along the
 * right edge. Looks like an architectural drawing the contractor
 * could fold and hand to a customer.
 */
export function BlueprintBackground() {
  return (
    <g aria-hidden>
      <defs>
        <pattern
          id="blueprint-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 24 0 L 0 0 0 24"
            fill="none"
            stroke="rgba(30, 58, 138, 0.06)"
            strokeWidth="0.6"
          />
        </pattern>
        <pattern
          id="blueprint-grid-major"
          width="120"
          height="120"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 120 0 L 0 0 0 120"
            fill="none"
            stroke="rgba(30, 58, 138, 0.12)"
            strokeWidth="0.9"
          />
        </pattern>
      </defs>
      {/* Warm paper tone */}
      <rect width={VIEWBOX_W} height={VIEWBOX_H} fill="#f7f4ee" />
      {/* Vignette toward edges for a printed-paper feel */}
      <radialGradient id="blueprint-vignette" cx="50%" cy="50%" r="65%">
        <stop offset="50%" stopColor="rgba(247, 244, 238, 0)" />
        <stop offset="100%" stopColor="rgba(120, 95, 60, 0.10)" />
      </radialGradient>
      <rect
        width={VIEWBOX_W}
        height={VIEWBOX_H}
        fill="url(#blueprint-vignette)"
      />
      <rect width={VIEWBOX_W} height={VIEWBOX_H} fill="url(#blueprint-grid)" />
      <rect
        width={VIEWBOX_W}
        height={VIEWBOX_H}
        fill="url(#blueprint-grid-major)"
      />
      {/* Border frame */}
      <rect
        x={20}
        y={20}
        width={VIEWBOX_W - 40}
        height={VIEWBOX_H - 40}
        fill="none"
        stroke="rgba(30, 58, 138, 0.45)"
        strokeWidth="1.2"
      />
      <rect
        x={28}
        y={28}
        width={VIEWBOX_W - 56}
        height={VIEWBOX_H - 56}
        fill="none"
        stroke="rgba(30, 58, 138, 0.18)"
        strokeWidth="0.6"
      />
      {/* Corner registration marks */}
      {[
        { x: 28, y: 28 },
        { x: VIEWBOX_W - 28, y: 28 },
        { x: 28, y: VIEWBOX_H - 28 },
        { x: VIEWBOX_W - 28, y: VIEWBOX_H - 28 },
      ].map((c, i) => (
        <g key={i}>
          <circle
            cx={c.x}
            cy={c.y}
            r={5}
            fill="none"
            stroke="rgba(30, 58, 138, 0.55)"
            strokeWidth="0.8"
          />
          <line
            x1={c.x - 8}
            y1={c.y}
            x2={c.x + 8}
            y2={c.y}
            stroke="rgba(30, 58, 138, 0.55)"
            strokeWidth="0.8"
          />
          <line
            x1={c.x}
            y1={c.y - 8}
            x2={c.x}
            y2={c.y + 8}
            stroke="rgba(30, 58, 138, 0.55)"
            strokeWidth="0.8"
          />
        </g>
      ))}
      {/* Title-block strip along the right edge */}
      <g transform={`translate(${VIEWBOX_W - 56}, 40)`}>
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={VIEWBOX_H - 80}
          stroke="rgba(30, 58, 138, 0.35)"
          strokeWidth="0.8"
        />
        {[0.2, 0.4, 0.6, 0.8].map((p, i) => (
          <line
            key={i}
            x1={0}
            y1={p * (VIEWBOX_H - 80)}
            x2={24}
            y2={p * (VIEWBOX_H - 80)}
            stroke="rgba(30, 58, 138, 0.2)"
            strokeWidth="0.5"
          />
        ))}
      </g>
      {/* "FENCE LAYOUT" stencil-style label in the lower-right title block */}
      <g transform={`translate(${VIEWBOX_W - 200}, ${VIEWBOX_H - 64})`}>
        <text
          x={0}
          y={0}
          fill="rgba(30, 58, 138, 0.55)"
          fontSize="9"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          letterSpacing="0.18em"
        >
          FENCE LAYOUT
        </text>
        <line
          x1={0}
          y1={4}
          x2={130}
          y2={4}
          stroke="rgba(30, 58, 138, 0.3)"
          strokeWidth="0.6"
        />
        <text
          x={0}
          y={16}
          fill="rgba(30, 58, 138, 0.4)"
          fontSize="7"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          letterSpacing="0.12em"
        >
          MEASURED · CONTRACTOR VERIFIED
        </text>
      </g>
    </g>
  );
}

export function AerialBackground() {
  return (
    <g aria-hidden>
      <defs>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bdcfa9" />
          <stop offset="100%" stopColor="#9bb086" />
        </linearGradient>
        <linearGradient id="roof-main" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9c8b7d" />
          <stop offset="100%" stopColor="#7a6c5f" />
        </linearGradient>
        <linearGradient id="roof-garage" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#988779" />
          <stop offset="100%" stopColor="#736556" />
        </linearGradient>
        <linearGradient id="driveway" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfcdc8" />
          <stop offset="100%" stopColor="#b8b6b1" />
        </linearGradient>
        <pattern id="shingle" width="14" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6 L14 6" stroke="rgba(0,0,0,0.18)" />
        </pattern>
      </defs>

      <rect width={VIEWBOX_W} height={VIEWBOX_H} fill="url(#grass)" />

      {Array.from({ length: 32 }).map((_, i) => {
        const x = (i % 8) * 120 + (Math.floor(i / 8) % 2) * 60;
        const y = Math.floor(i / 8) * 150 + 20;
        return (
          <circle
            key={`bush-${i}`}
            cx={x + 30}
            cy={y + 30}
            r={6 + (i % 4) * 2}
            fill="#83a368"
            opacity={0.55}
          />
        );
      })}

      <g opacity={0.75}>
        <ellipse cx={120} cy={80} rx={28} ry={24} fill="#7ea264" />
        <ellipse cx={780} cy={120} rx={36} ry={30} fill="#82a866" />
        <ellipse cx={830} cy={500} rx={42} ry={36} fill="#75985b" />
        <ellipse cx={70} cy={520} rx={32} ry={28} fill="#7ca263" />
      </g>

      <rect x={620} y={420} width={170} height={80} rx={2} fill="url(#driveway)" />
      <line
        x1={620}
        y1={460}
        x2={790}
        y2={460}
        stroke="rgba(255,255,255,0.45)"
        strokeDasharray="6 8"
      />

      <rect
        x={220}
        y={240}
        width={360}
        height={140}
        fill="url(#roof-main)"
        stroke="#5b4f44"
        strokeWidth={1}
      />
      <rect x={220} y={240} width={360} height={140} fill="url(#shingle)" />
      <line
        x1={400}
        y1={240}
        x2={400}
        y2={380}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={1.5}
      />

      <rect
        x={580}
        y={280}
        width={140}
        height={80}
        fill="url(#roof-garage)"
        stroke="#5b4f44"
        strokeWidth={1}
      />
      <rect x={580} y={280} width={140} height={80} fill="url(#shingle)" />
      <line
        x1={650}
        y1={280}
        x2={650}
        y2={360}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={1.5}
      />

      <rect
        x={320}
        y={200}
        width={160}
        height={42}
        fill="url(#roof-main)"
        stroke="#5b4f44"
        strokeWidth={1}
      />
      <rect x={320} y={200} width={160} height={42} fill="url(#shingle)" />

      <rect x={355} y={300} width={20} height={26} fill="#3d342c" stroke="rgba(0,0,0,0.4)" />
      <rect x={425} y={300} width={20} height={26} fill="#3d342c" stroke="rgba(0,0,0,0.4)" />
      <circle cx={400} cy={355} r={6} fill="#5a4d40" stroke="rgba(0,0,0,0.4)" />

      <rect x={150} y={400} width={70} height={50} rx={3} fill="#a59c8e" opacity={0.85} />
    </g>
  );
}

export function AerialReadonly({
  eaves,
  downspouts,
  className,
  theme = "tactical",
  imageDataUrl,
}: {
  eaves: EditableLine[];
  downspouts: Downspout[];
  className?: string;
  theme?: CanvasTheme;
  imageDataUrl?: string;
}) {
  const t = THEMES[theme];
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border " +
        (theme === "tactical"
          ? "border-cyan-900/40 bg-slate-950 "
          : "border-zinc-200 bg-zinc-100 ") +
        (className ?? "")
      }
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        style={{ minHeight: 280 }}
      >
        <NeonDefs />
        {imageDataUrl ? (
          <AerialImage imageDataUrl={imageDataUrl} />
        ) : (
          <AerialBackground />
        )}
        {t.overlay && (
          <rect
            x={0}
            y={0}
            width={VIEWBOX_W}
            height={VIEWBOX_H}
            fill={t.overlay}
            pointerEvents="none"
          />
        )}
        {eaves.map((line, i) => (
          <motion.path
            key={line.id}
            d={pathFor(line)}
            stroke={t.eave}
            strokeWidth={theme === "tactical" ? 3 : 4}
            strokeLinecap="round"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: i * 0.06 }}
            style={{
              filter:
                theme === "tactical"
                  ? "drop-shadow(0 0 6px rgba(0,229,255,0.95))"
                  : "drop-shadow(0 1px 4px rgba(20,121,184,0.45))",
            }}
          />
        ))}
        {downspouts.map((d, i) => (
          <g key={d.id}>
            {theme === "tactical" ? (
              <>
                <motion.circle
                  cx={d.x}
                  cy={d.y}
                  r={14}
                  fill={t.downspout}
                  opacity={0.18}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: [0.7, 1.25, 0.9], opacity: [0, 0.35, 0.18] }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.15,
                  }}
                />
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={6}
                  fill={t.downspout}
                  filter={t.downspoutGlowFilter ?? undefined}
                />
                <circle cx={d.x} cy={d.y} r={2.2} fill={t.downspoutCore} />
              </>
            ) : (
              <>
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={9}
                  fill="white"
                  stroke={t.downspout}
                  strokeWidth={2}
                />
                <circle cx={d.x} cy={d.y} r={3.5} fill={t.downspoutCore} />
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function pathFor(line: EditableLine) {
  if (line.points.length === 0) return "";
  const [first, ...rest] = line.points;
  return (
    `M ${first.x} ${first.y} ` +
    rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
  );
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Canvas-pixel length of a polyline in feet. `pxPerFt` defaults to the
 * plan-takeoff scale (PX_PER_FT = 2.4); SATELLITE estimates must pass the
 * per-estimate `canvasPxPerFt` stamped on EstimateResult, because their
 * eaves are COVER-fit onto the viewBox where 1 ft ≠ 2.4 px. Passing
 * undefined falls back to PX_PER_FT, preserving plan behavior + old data.
 */
export function lineLengthFt(line: EditableLine, pxPerFt: number = PX_PER_FT) {
  const scale = Number.isFinite(pxPerFt) && pxPerFt > 0 ? pxPerFt : PX_PER_FT;
  let total = 0;
  for (let i = 1; i < line.points.length; i++) {
    const d = dist(line.points[i - 1], line.points[i]);
    // Skip non-finite segments so a single bad point (NaN/undefined coord
    // from a stale stored takeoff) contributes 0 instead of poisoning the
    // whole legend with "NaN LF".
    if (Number.isFinite(d)) total += d;
  }
  return total / scale;
}

/**
 * Frame the takeoff so it fills the canvas.
 *
 * The plan→estimate projection lays geometry out at a FIXED scale
 * (canvas-px = feet × PX_PER_FT) so the live LF recompute round-trips.
 * The side effect: a correctly-sized small building — a 64 ft house is
 * only 64 × 2.4 ≈ 154 px — renders as a tiny trace marooned in the
 * 900×580 frame. (The bug only surfaced once the LF numbers were fixed;
 * the earlier inflated ~200-ft traces happened to fill the frame.)
 *
 * Rather than rescale the geometry (which would desync px↔ft and break
 * both the LF math and drag-to-reprice), we move the CAMERA: compute a
 * viewBox window tight around the trace, matched to the canvas aspect
 * ratio so preserveAspectRatio="slice" doesn't crop it. Pointer math in
 * both canvases already goes through getScreenCTM().inverse(), so
 * dragging is unaffected by the zoomed window.
 *
 * Returns null when there's nothing to frame, or when the trace already
 * fills most of the frame — callers fall back to the full 0 0 900 580
 * view so an already-large (or satellite-calibrated) trace is untouched.
 */
export function fitViewBox(
  points: readonly { x: number; y: number }[],
  opts?: { padPct?: number },
): { x: number; y: number; width: number; height: number } | null {
  const pad = opts?.padPct ?? 0.08;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  if (n < 2) return null;
  let cw = (maxX - minX) * (1 + 2 * pad);
  let ch = (maxY - minY) * (1 + 2 * pad);
  if (cw <= 1 && ch <= 1) return null;
  cw = Math.max(cw, 1);
  ch = Math.max(ch, 1);
  // Expand the short axis so the window matches the canvas aspect —
  // otherwise "slice" crops the long axis of the trace.
  const aspect = VIEWBOX_W / VIEWBOX_H;
  if (cw / ch < aspect) cw = ch * aspect;
  else ch = cw / aspect;
  // Cap the zoom (~3.5×) so a very small trace doesn't fill the frame at
  // a disorienting magnification — the contractor can still zoom in
  // further by hand.
  const minW = VIEWBOX_W / 3.5;
  if (cw < minW) {
    ch = (ch * minW) / cw;
    cw = minW;
  }
  // Already fills ~the whole frame → zooming buys nothing; let the
  // caller use the default viewBox.
  if (cw >= VIEWBOX_W * 0.9) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - cw / 2, y: cy - ch / 2, width: cw, height: ch };
}

function segLen(a: Pt, b: Pt) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Off-edge anchor for a side's orientation chip. Snaps the chip to the
 * building bounding-box EDGE (length-weighted, axis-restricted) so it can
 * never float in the roof interior — see lib/orientation-anchor.ts for the
 * geometry + why this replaced the old "average-of-midpoints + 26px" approach.
 * Builds a fresh midpoint/length array (never sorts/mutates the shared `eaves`
 * — that array also feeds the priced LF). Decorative only.
 */
function sideAnchor(
  eaves: { points: { x: number; y: number }[]; side?: EaveSide }[],
  side: OrientSide,
  bbox: ReturnType<typeof perimBBox>,
  scale: number,
): Pt | null {
  const matches = eaves.filter((l) => l.side === side && l.points.length >= 2);
  if (matches.length === 0) return null;
  const mids = matches.map((l) => {
    const a = l.points[0];
    const b = l.points[l.points.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, len: segLen(a, b) };
  });
  if (process.env.NODE_ENV !== "production") {
    const s = sideSplit(mids, side, bbox);
    if (s.split && s.minorityFrac >= 0.35) {
      const edges = side === "front" || side === "back" ? "top/bottom" : "left/right";
      // eslint-disable-next-line no-console
      console.warn(
        `[orientation] "${side}" eaves split across both ${edges} edges ` +
          `(minority ${Math.round(s.minorityFrac * 100)}%) — likely a mis-tagged ` +
          `side upstream (blueprint-from-plans <orientation>).`,
      );
    }
  }
  return anchorForSide(mids, side, bbox, scale);
}

/**
 * FRONT / BACK / LEFT / RIGHT orientation chip positions + pill boxes.
 * Exported so the canvases can feed the chips into the label-layout solver
 * as fixed obstacles (an LF pill must slide around a chip, not under it) —
 * the SAME numbers the overlay renders, so obstacle and drawing agree.
 */
export type OrientationChipBox = {
  side: OrientSide;
  label: string;
  at: Pt;
  w: number;
  h: number;
};

export function orientationChipBoxes(
  eaves: { points: { x: number; y: number }[]; side?: EaveSide }[],
  perimeter: readonly Pt[],
  scale: number,
): OrientationChipBox[] {
  const bbox = perimBBox(perimeter);
  return (
    [
      ["front", "FRONT"],
      ["back", "BACK"],
      ["left", "LEFT"],
      ["right", "RIGHT"],
    ] as [OrientSide, string][]
  )
    .map(([side, label]) => {
      const at = sideAnchor(eaves, side, bbox, scale);
      return at
        ? {
            side,
            label,
            at,
            w: (label.length * 6.2 + 12) * scale,
            h: 14 * scale,
          }
        : null;
    })
    .filter((c): c is OrientationChipBox => c !== null);
}

/**
 * Roof-structure overlay — renders the roof like an architect's roof plan
 * sitting under the gutter trace: the filled building SHAPE, the interior
 * roof planes (ridges / hips / valleys), the perimeter (roof edge), and
 * FRONT / BACK / LEFT / RIGHT orientation chips so the contractor instantly
 * recognizes the house, its shape, and which way it faces — then can judge
 * whether the gutters (the bold eaves drawn on top) sit on the right edges.
 *
 * The interior roof lines are DERIVED from the footprint (`derive`) rather
 * than traced — a hip roof's ridges/hips/valleys are almost fully determined
 * by the outline, and deriving them gives a complete, connected, clean roof
 * every time instead of the sparse floating dashes the AI returns off a
 * dense truss sheet. Purely decorative: never affects LF / totals / price.
 */
export function RoofStructureOverlay({
  structure,
  tone = "onDark",
  scale = 1,
  derive = false,
  perimeterOnly = false,
  eaves = [],
  rakes = [],
}: {
  structure: RoofStructure;
  /** "onDark" = light strokes for the dark tactical canvas; "onLight" =
   *  dark strokes for the cream drafting-paper proposal. */
  tone?: "onDark" | "onLight";
  /** Inverse-zoom factor (view.width / VIEWBOX_W) so stroke weights stay
   *  visually constant when the camera is zoomed in to frame the trace. */
  scale?: number;
  /** Derive a complete ridge/hip/valley skeleton from the footprint
   *  instead of using the (sparse, unreliable) AI-traced lines. On for
   *  plan takeoffs; off for satellite (which has real ridge detection). */
  derive?: boolean;
  /** OWNER DOCTRINE (plan takeoffs): the takeoff canvas is a GUTTER
   *  PERIMETER diagram, not a reconstructed roof. When true, the overlay
   *  draws ONLY the roof outline + orientation chips — no ridges, hips,
   *  valleys, tier-step lines, plane shading or gable wings. The solid
   *  (gutter) and dashed (gable, no gutter) perimeter edges drawn by the
   *  canvas on top complete the diagram. */
  perimeterOnly?: boolean;
  /** Eaves carry building side (front/back/left/right) — used to place the
   *  orientation chips. Optional; chips are skipped when absent. */
  eaves?: { points: { x: number; y: number }[]; side?: EaveSide }[];
  /** Rakes (gable edges). In derive mode they tell the skeleton which sides
   *  are gable ends so it draws a connected gable (ridge to the wall). A rake
   *  whose `id` starts with "gable-" was placed by the contractor with the
   *  Add-gable tool — those are trusted explicitly (rendered as a gable wing
   *  even when they sit on an eave wall, where a cross-gable legitimately
   *  rises above the gutter). */
  rakes?: { id?: string; points: { x: number; y: number }[] }[];
}) {
  // Derived (or structure-provided) roof skeleton. useMemo so the per-frame
  // re-renders during eave drag don't recompute the grid decomposition.
  // Hook must run before any early return.
  const skel = useMemo(() => {
    if (perimeterOnly) {
      // Gutter-perimeter mode: no interior geometry at all (see prop doc).
      return {
        ridges: [] as { points: { x: number; y: number }[] }[],
        hips: [] as { points: { x: number; y: number }[] }[],
        valleys: [] as { points: { x: number; y: number }[] }[],
        gables: [] as { points: { x: number; y: number }[] }[],
        dormers: [] as Dormer[],
        faces: [] as { polygon: { x: number; y: number }[]; downhill: { x: number; y: number } }[],
        steps: [] as { points: { x: number; y: number }[] }[],
      };
    }
    if (!derive) {
      return {
        ridges: structure.ridges.map((l) => ({ points: l.points })),
        hips: (structure.hips ?? []).map((l) => ({ points: l.points })),
        valleys: structure.valleys.map((l) => ({ points: l.points })),
        gables: [] as { points: { x: number; y: number }[] }[],
        dormers: [] as Dormer[],
        // Engine-computed roof PLANES travel with the takeoff — shade them
        // (full-footprint coverage) instead of nothing. Empty on satellite
        // and older stored takeoffs, where shading stays off as before.
        faces: (structure.faces ?? []) as { polygon: { x: number; y: number }[]; downhill: { x: number; y: number } }[],
        // Tier STEP edges (interior mass boundaries) — verbatim; empty on
        // satellite and pre-steps stored takeoffs.
        steps: (structure.steps ?? []).map((l) => ({ points: l.points })),
      };
    }
    // Feed the skeleton both the eaves (gutter runs) AND the rakes (gable
    // edges). A side draws a HIP only where a gutter runs; a side with a
    // rake — or no gutter — draws a flush GABLE end (ridge to the wall), so
    // the gable connects to the roof instead of floating as a separate stub.
    // Explode each polyline into its constituent segments — NOT first+last.
    // An eave that follows a wall jog (an L-shaped run) collapsed to a single
    // diagonal chord that aligned with NO footprint side, so the skeleton's
    // "this side is guttered → never a gable" veto missed the wall and the
    // proposal diagram drew a phantom GABLE on a fully guttered hip side.
    // Per-segment, each straight leg lands on its own wall and the veto holds.
    const toSegs = (ls: { points: { x: number; y: number }[] }[]) =>
      ls
        .filter((e) => e.points.length >= 2)
        .flatMap((e) =>
          e.points.slice(1).map((p, i) => [e.points[i], p] as [Pt, Pt]),
        );
    const isUserGable = (l: { id?: string }) =>
      typeof l.id === "string" && l.id.startsWith("gable-");
    // v2/engine rows: the stored structure IS the drawing — render it
    // verbatim (one source of truth; labels and wedges can't disagree, and
    // no client-side skeleton re-invents lines the sheet never evidenced).
    // Contractor-placed gables (Add-gable tool) are explicit and still
    // surface as dormer wings on top. Legacy rows fall through to the
    // grid derivation below, satellite stays on the non-derive branch.
    const engineView = engineDrawnGeometry(structure);
    if (engineView) {
      const userDormers = extraGablesFromRakes(
        toSegs(rakes.filter(isUserGable)),
        [],
        structure.perimeter,
        [], // no eave veto — the contractor placed these on purpose
      );
      return { ...engineView, dormers: userDormers };
    }
    const eaveSegs = toSegs(eaves);
    // v2 gable ENDS travel with the takeoff (structure.gables). Feed them to
    // the skeleton as rake walls so the derived FACES flip hip→gable on those
    // sides — without this the left/right wings of a cross-gabled house shade
    // as hip corner planes that contradict the engine's drawn ridge/valley
    // lines. They also replace the grid-derived gable list below (labels).
    const structGables = (structure.gables ?? []).filter(
      (l) => l.points.length >= 2,
    );
    const rakeSegs = [
      ...toSegs(rakes),
      ...structGables.map(
        (l) => [l.points[0], l.points[l.points.length - 1]] as [Pt, Pt],
      ),
    ];
    const base = deriveRoofSkeleton(structure.perimeter, {
      eaveSegments: eaveSegs,
      rakeSegments: rakeSegs,
    });
    // Gables that AREN'T whole-side ends — dormers / cross-gables that sit on
    // or above a continuous eave. The skeleton can't derive these (no footprint
    // side), so surface them from the rakes. AI rakes are deduped against the
    // skeleton gables AND vetoed where they lie on an eave (a mis-read). A
    // CONTRACTOR-placed gable (Add-gable tool, id "gable-…") is explicit, so it
    // skips the eave veto — a real cross-gable rises above its gutter.
    const aiDormers = extraGablesFromRakes(
      toSegs(rakes.filter((l) => !isUserGable(l))),
      base.gables,
      structure.perimeter,
      eaveSegs,
    );
    const userDormers = extraGablesFromRakes(
      toSegs(rakes.filter(isUserGable)),
      base.gables,
      structure.perimeter,
      [], // no eave veto — the contractor placed these on purpose
    );
    // Engine interior lines come in two flavors, drawn differently:
    //  - SKELETON (ids "engine-…", NOT "engine-gable-…") is the exact straight-
    //    skeleton — clean converging hips/ridges/valleys. When present it
    //    REPLACES the grid skeleton's roof lines (so we don't draw the grid fan
    //    underneath), while KEEPING the grid's gable wings + faces.
    //  - GABLE (ids "engine-gable-…") is each cross-gable's ridge-back + valleys.
    //    Valid regardless of the main skeleton, so it's ALWAYS appended — this is
    //    what draws a FLUSH cross-gable when the engine rejected its main
    //    skeleton (only the grid hip is drawn then) and the on-eave gable rakes
    //    got vetoed. Freehand "plan-…" lines are left to the grid derivation.
    const isEngine = (l: { id?: string }) =>
      typeof l.id === "string" && l.id.startsWith("engine-");
    const isGable = (l: { id?: string }) =>
      typeof l.id === "string" && l.id.startsWith("engine-gable-");
    const skelEngine = (ls: { id?: string; points: Pt[] }[]) =>
      ls.filter((l) => isEngine(l) && !isGable(l)).map((l) => ({ points: l.points }));
    const gableEngine = (ls: { id?: string; points: Pt[] }[]) =>
      ls.filter(isGable).map((l) => ({ points: l.points }));
    const eHips = skelEngine(structure.hips ?? []);
    const eRidges = skelEngine(structure.ridges);
    const eValleys = skelEngine(structure.valleys);
    const gRidges = gableEngine(structure.ridges);
    const gValleys = gableEngine(structure.valleys);
    const hasEngineSkeleton = eHips.length + eRidges.length + eValleys.length > 0;
    return {
      ...base,
      hips: hasEngineSkeleton ? eHips : base.hips,
      ridges: [...(hasEngineSkeleton ? eRidges : base.ridges), ...gRidges],
      valleys: [...(hasEngineSkeleton ? eValleys : base.valleys), ...gValleys],
      // The takeoff's own gable ends outrank the grid re-derivation — one
      // source of truth for the GABLE labels (fixes phantom/missing labels
      // when the two engines disagree).
      gables:
        structGables.length > 0
          ? structGables.map((l) => ({
              points: [l.points[0], l.points[l.points.length - 1]],
            }))
          : base.gables,
      dormers: [...aiDormers, ...userDormers],
      // Stored tier steps pass through verbatim on the legacy-derive path
      // too — the grid never re-derives them (empty on rows without them).
      steps: (structure.steps ?? []).map((l) => ({ points: l.points })),
    };
  }, [
    derive,
    perimeterOnly,
    eaves,
    rakes,
    structure.perimeter,
    structure.ridges,
    structure.hips,
    structure.valleys,
    structure.gables,
    structure.faces,
    structure.steps,
  ]);
  if (structure.perimeter.length < 3) return null;
  const onDark = tone === "onDark";
  const perim = onDark ? "rgba(226,232,240,0.95)" : "rgba(30,58,138,0.85)";
  const fill = onDark ? "rgba(148,163,184,0.10)" : "rgba(120,113,90,0.07)";
  // Distinct roof-plane line colors so the overlay reads like a real roof
  // plan. Ridges run along the peaks, hips up from the outside corners,
  // valleys drop in at the inside corners (dashed, like a drainage line).
  const ridgeC = onDark ? "rgba(203,213,225,0.85)" : "rgba(51,65,85,0.78)";
  const hipC = onDark ? "rgba(125,211,252,0.85)" : "rgba(14,116,144,0.78)";
  const valleyC = onDark ? "rgba(196,181,253,0.9)" : "rgba(109,40,217,0.75)";
  // Tier STEPS: thin SOLID, warm and subtle — visibly different from the
  // ridge/hip solids and the dashed valleys, and thinner than everything
  // else so a step reads as "the roof level changes here", not a priced run.
  const stepC = onDark ? "rgba(253,186,116,0.75)" : "rgba(180,83,9,0.55)";
  const gableC = onDark ? "rgba(148,163,184,0.95)" : "rgba(71,85,105,0.85)";
  const gableText = onDark ? "#cbd5e1" : "#475569";

  // Interior roof lines (skel derived above). Map to render descriptors.
  const rawLines: { points: { x: number; y: number }[]; c: string; w: number; dash: boolean }[] = [
    ...skel.ridges.map((l) => ({ points: l.points, c: ridgeC, w: 1.5, dash: false })),
    ...skel.hips.map((l) => ({ points: l.points, c: hipC, w: 1.6, dash: false })),
    ...skel.valleys.map((l) => ({ points: l.points, c: valleyC, w: 1.6, dash: true })),
  ].filter(
    (l) => l.points.length >= 2 && segLen(l.points[0], l.points[l.points.length - 1]) > 1.5,
  );
  // Drop DANGLING interior lines — a ridge/hip/valley that connects to
  // nothing at one end (e.g. a porch-cover ridge stub the engine emitted
  // without its cover outline) reads as a random pen stroke, worst on the
  // client proposal. A well-formed skeleton line touches the perimeter, a
  // gable end, an eave/rake, or another interior line at BOTH ends.
  // Display-only: never affects LF / pricing.
  const anchorSegs: [Pt, Pt][] = [];
  for (let i = 0; i < structure.perimeter.length; i++) {
    anchorSegs.push([
      structure.perimeter[i],
      structure.perimeter[(i + 1) % structure.perimeter.length],
    ]);
  }
  for (const g of skel.gables) {
    if (g.points.length >= 2) anchorSegs.push([g.points[0], g.points[g.points.length - 1]]);
  }
  for (const dm of skel.dormers ?? []) {
    if (dm.points.length >= 2) anchorSegs.push([dm.points[0], dm.points[1]]);
  }
  for (const src of [eaves, rakes] as { points: { x: number; y: number }[] }[][]) {
    for (const l of src) {
      for (let i = 1; i < l.points.length; i++) {
        anchorSegs.push([l.points[i - 1], l.points[i]]);
      }
    }
  }
  // Tier steps are real drawn geometry — an interior ridge legitimately
  // terminates ON a step boundary (a clerestory ridge dying into its own
  // box), so steps count as anchors. Steps themselves are drawn directly
  // below (exact mass-decomposition edges, never dangling artifacts).
  for (const s of skel.steps ?? []) {
    for (let i = 1; i < s.points.length; i++) {
      anchorSegs.push([s.points[i - 1], s.points[i]]);
    }
  }
  const lines = dropDanglingLines(rawLines, anchorSegs, 6);

  // Roof centroid (perimeter average) — used to nudge the GABLE labels just
  // inside their edge.
  let cx = 0;
  let cy = 0;
  for (const p of structure.perimeter) {
    cx += p.x;
    cy += p.y;
  }
  cx /= structure.perimeter.length;
  cy /= structure.perimeter.length;
  const centroid = { x: cx, y: cy };
  // Orientation chips snap to the building bounding-box edge (off-edge by
  // construction), so FRONT/BACK/LEFT/RIGHT never float in the roof interior.
  // Shared with the canvases (label-layout obstacles) via orientationChipBoxes.
  const chips = orientationChipBoxes(eaves, structure.perimeter, scale);

  const chipText = onDark ? "#e2e8f0" : "#1e3a8a";
  const chipFill = onDark ? "rgba(2,6,23,0.78)" : "rgba(255,255,255,0.92)";
  const chipStroke = onDark ? "rgba(148,163,184,0.45)" : "rgba(30,58,138,0.35)";

  // Shade each roof PLANE by how much its slope faces the light (top-left),
  // so the roof reads as a solid 3D mass — the look of a real roof report,
  // not a flat outline with a few dashes. A face sloping down toward the
  // light is brighter; the far slopes go darker.
  const LX = -0.45;
  const LY = -1;
  const Lmag = Math.hypot(LX, LY);
  const faceFill = (d: { x: number; y: number }): string => {
    const m = Math.hypot(d.x, d.y) || 1;
    const b = (d.x * LX + d.y * LY) / (m * Lmag); // -1..1
    if (onDark) {
      const g = Math.round(74 + 34 * b);
      return `rgb(${g},${g + 6},${g + 13})`;
    }
    const g = Math.round(225 + 24 * b);
    return `rgb(${g},${g - 3},${g - 9})`;
  };
  const faceEdge = onDark ? "rgba(15,23,42,0.55)" : "rgba(90,90,90,0.28)";

  return (
    <g pointerEvents="none">
      {/* Filled roof shape so the building reads as a solid mass */}
      <path d={closedPathD(structure.perimeter)} fill={fill} stroke="none" />
      {/* Shaded roof PLANES (the surfaces between ridges/hips and the eaves) */}
      {skel.faces.map((f, i) =>
        f.polygon.length >= 3 ? (
          <polygon
            key={`face-${i}`}
            points={f.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={faceFill(f.downhill)}
            stroke={faceEdge}
            strokeWidth={0.5 * scale}
            strokeLinejoin="round"
          />
        ) : null,
      )}
      {/* Tier STEP edges — thin SOLID interior mass boundaries where one
          roof level drops to another. Drawn verbatim from the stored takeoff
          (exact tier decomposition, no dangling-line pass needed) so a
          multi-tier plan reads as tiers. Display-only, never priced. */}
      {(skel.steps ?? []).map((l, i) =>
        l.points.length >= 2 &&
        segLen(l.points[0], l.points[l.points.length - 1]) > 1.5 ? (
          <path
            key={`step-${i}`}
            d={linePathD(l.points)}
            fill="none"
            stroke={stepC}
            strokeWidth={1.1 * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
      )}
      {/* Interior roof-plane lines, under the perimeter + the trace */}
      {lines.map((l, i) => (
        <path
          key={`rl-${i}`}
          d={linePathD(l.points)}
          fill="none"
          stroke={l.c}
          strokeWidth={l.w * scale}
          strokeDasharray={l.dash ? `${5 * scale} ${3.5 * scale}` : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Building outline — the roof edge */}
      <motion.path
        d={closedPathD(structure.perimeter)}
        fill="none"
        stroke={perim}
        strokeWidth={2.2 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
        style={{
          filter: onDark ? "drop-shadow(0 0 4px rgba(0,0,0,0.55))" : "none",
        }}
      />
      {/* Gable ends — emphasize the rake edge on the outline + label it, so
          a gable reads as a CONNECTED part of the roof (the ridge already
          runs flush to this wall) rather than a floating stub. */}
      {(() => {
        // Lay the GABLE labels out with de-collision — a multi-gable front
        // otherwise piles 4 pills on top of each other (unreadable). Each
        // label starts nudged inward from its gable edge, then we relax
        // overlapping labels apart and draw a thin leader back to the edge
        // so you can still tell which gable each label belongs to.
        const w = 42 * scale;
        const h = 13 * scale;
        const items: {
          a: { x: number; y: number };
          b: { x: number; y: number };
          mx: number;
          my: number;
          lx: number;
          ly: number;
        }[] = [];
        for (const g of skel.gables) {
          const a = g.points[0];
          const b = g.points[1];
          if (!a || !b) continue;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = centroid.x - mx;
          const dy = centroid.y - my;
          const d = Math.hypot(dx, dy) || 1;
          items.push({
            a,
            b,
            mx,
            my,
            lx: mx + (dx / d) * 16 * scale,
            ly: my + (dy / d) * 16 * scale,
          });
        }
        for (let it = 0; it < 18; it++) {
          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              const A = items[i];
              const B = items[j];
              const ddx = B.lx - A.lx;
              const ddy = B.ly - A.ly;
              const ox = w * 1.08 - Math.abs(ddx);
              const oy = h * 1.35 - Math.abs(ddy);
              if (ox > 0 && oy > 0) {
                if (ox < oy) {
                  const p = (ox / 2 + 0.5) * (ddx >= 0 ? 1 : -1);
                  A.lx -= p;
                  B.lx += p;
                } else {
                  const p = (oy / 2 + 0.5) * (ddy >= 0 ? 1 : -1);
                  A.ly -= p;
                  B.ly += p;
                }
              }
            }
          }
        }
        return items.map((g, i) => {
          const moved = Math.hypot(g.lx - g.mx, g.ly - g.my) > 20 * scale;
          return (
            <g key={`gable-${i}`}>
              <path
                d={linePathD([g.a, g.b])}
                fill="none"
                stroke={gableC}
                strokeWidth={2.6 * scale}
                strokeDasharray={`${5 * scale} ${4 * scale}`}
                strokeLinecap="round"
              />
              {moved && (
                <line
                  x1={g.mx}
                  y1={g.my}
                  x2={g.lx}
                  y2={g.ly}
                  stroke={chipStroke}
                  strokeWidth={0.8 * scale}
                  opacity={0.45}
                />
              )}
              <rect
                x={g.lx - w / 2}
                y={g.ly - h / 2}
                width={w}
                height={h}
                rx={3 * scale}
                fill={chipFill}
                stroke={chipStroke}
                strokeWidth={scale}
              />
              <text
                x={g.lx}
                y={g.ly + 3.2 * scale}
                textAnchor="middle"
                fill={gableText}
                fontSize={7.5 * scale}
                fontWeight={700}
                fontFamily="ui-sans-serif, system-ui"
                letterSpacing={0.8 * scale}
              >
                GABLE
              </text>
            </g>
          );
        });
      })()}
      {/* Dormers / cross-gables the AI traced that aren't whole-side ends — a
          gable PROJECTING from a wall (the front garage/entry gables, a side
          cross-gable). Drawn as a real gable WING — two shaded roof planes
          meeting at a ridge that runs inward from the gable end — so every
          gable on the layout reads as an actual gable shape, not a faint dash. */}
      {(skel.dormers ?? []).map((dm, i) => {
        const a = dm.points[0];
        const b = dm.points[1];
        if (!a || !b) return null;
        const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
        const toC = Math.hypot(centroid.x - dm.mid.x, centroid.y - dm.mid.y);
        // Wing depth ≈ its width (a ~45° gable), capped so it doesn't shoot
        // past the roof centre.
        const depth = Math.max(
          8 * scale,
          Math.min(edgeLen * 0.9, toC * 0.85),
        );
        const wing = gableWingFaces(a, b, dm.dir, depth);
        return (
          <g key={`dormer-${i}`}>
            {/* The two sloped planes of the gable wing, shaded like the roof */}
            {wing.faces.map((f, j) =>
              f.polygon.length >= 3 ? (
                <polygon
                  key={`dwf-${j}`}
                  points={f.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={faceFill(f.downhill)}
                  stroke={faceEdge}
                  strokeWidth={0.5 * scale}
                  strokeLinejoin="round"
                />
              ) : null,
            )}
            {/* Ridge of the wing */}
            <path
              d={linePathD(wing.ridge.points)}
              fill="none"
              stroke={ridgeC}
              strokeWidth={1.4 * scale}
              strokeLinecap="round"
            />
            {/* The gable END (the wide base on the wall) — bold so the gable
                shape is unmistakable. */}
            <path
              d={linePathD([a, b])}
              fill="none"
              stroke={gableC}
              strokeWidth={2.6 * scale}
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {/* Orientation chips — FRONT / BACK / LEFT / RIGHT off each edge */}
      {chips.map(({ side, label, at, w, h }) => {
        return (
          <g key={side}>
            <rect
              x={at.x - w / 2}
              y={at.y - h / 2}
              width={w}
              height={h}
              rx={3 * scale}
              fill={chipFill}
              stroke={chipStroke}
              strokeWidth={scale}
            />
            <text
              x={at.x}
              y={at.y + 3.4 * scale}
              textAnchor="middle"
              fill={chipText}
              fontSize={8 * scale}
              fontWeight={700}
              fontFamily="ui-sans-serif, system-ui"
              letterSpacing={1 * scale}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function linePathD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
}

function closedPathD(points: { x: number; y: number }[]): string {
  return points.length === 0 ? "" : linePathD(points) + " Z";
}
