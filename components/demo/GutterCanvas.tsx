"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import {
  getDistance,
  midpoint,
  nextId,
  projectOntoSegment,
  roundFt,
  segmentLengthFt,
  type DownspoutMark,
  type Point,
  type Segment,
  type SegmentKind,
} from "@/lib/canvas-utils";

export type CanvasMode = "select" | "trace" | "calibrate" | "downspout";

export interface GutterCanvasProps {
  /** viewBox width in world units (matches the app's 900×580 canvas). */
  width?: number;
  /** viewBox height in world units. */
  height?: number;
  /** SVG nodes rendered behind the overlay — the procedural satellite tile
   *  or blueprint sheet. Rendered inside the same viewBox so it scales with
   *  the geometry. */
  background?: ReactNode;
  segments: Segment[];
  downspouts: DownspoutMark[];
  /** Pixels-per-foot. When undefined (e.g. an un-calibrated blueprint),
   *  length labels are hidden and only the raw shape shows. */
  pxPerFt?: number;
  /** Interaction mode. The parent owns geometry state; the canvas emits
   *  changes back through the callbacks below. */
  mode?: CanvasMode;
  onSegmentsChange?: (next: Segment[]) => void;
  onDownspoutsChange?: (next: DownspoutMark[]) => void;
  /** In calibrate mode: the two points the user has picked so far. The page
   *  reads these to draw the "known length?" prompt. */
  calibration?: { a: Point | null; b: Point | null };
  onCalibrationPick?: (p: Point) => void;
  /** Kind applied to segments drawn in trace mode (default "eave"). */
  traceKind?: SegmentKind;
  /** Show the faint measurement grid behind the overlay. */
  grid?: boolean;
  className?: string;
}

const EAVE = "#4353ff"; // royal blue — guttered runs
const RAKE = "#64748b"; // slate — rakes / ridges / valleys (context)
const HANDLE = "#7d8bfc";
const DOWNSPOUT = "#f8717e"; // coral — downspout drops
const CALIBRATE = "#f59e0b"; // amber — calibration line

const HIT_RADIUS = 14; // px (world units) — click tolerance for handles/downspouts

/** Convert a browser pointer event to viewBox coordinates. */
function toCanvas(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = pt.matrixTransform(ctm.inverse());
  return { x: inv.x, y: inv.y };
}

function strokeFor(kind: SegmentKind): string {
  return kind === "eave" ? EAVE : RAKE;
}

/**
 * The shared blueprint-style takeoff canvas.
 *
 * Layer order (back → front): background · grid · segments · length labels ·
 * calibration overlay · vertex handles · downspouts · trace rubber-band.
 *
 * Interactions by mode:
 *   • select     — drag any vertex; coincident corners move together so the
 *                  outline stays connected. Labels update live.
 *   • trace      — click to drop points; each new point extends a polyline of
 *                  `traceKind` segments. Double-click / Esc ends the chain.
 *   • calibrate  — click two points; each fires onCalibrationPick.
 *   • downspout  — click near a run to drop a downspout (snaps onto the edge);
 *                  click an existing downspout to remove it.
 */
export default function GutterCanvas({
  width = 900,
  height = 580,
  background,
  segments,
  downspouts,
  pxPerFt,
  mode = "select",
  onSegmentsChange,
  onDownspoutsChange,
  calibration,
  onCalibrationPick,
  traceKind = "eave",
  grid = true,
  className,
}: GutterCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Active vertex drag: which segment endpoint is grabbed.
  const dragRef = useRef<{ segId: string; end: "a" | "b"; origin: Point } | null>(
    null,
  );
  // Trace mode: the last committed point we extend from.
  const [traceAnchor, setTraceAnchor] = useState<Point | null>(null);
  // Live cursor position (world units) for rubber-band + hover feedback.
  const [cursor, setCursor] = useState<Point | null>(null);

  const showLabels = typeof pxPerFt === "number" && pxPerFt > 0;

  // End the trace chain on Escape or when leaving trace mode.
  useEffect(() => {
    if (mode !== "trace") setTraceAnchor(null);
  }, [mode]);
  useEffect(() => {
    if (mode !== "trace") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTraceAnchor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const pointFromEvent = useCallback(
    (e: ReactPointerEvent<SVGSVGElement | SVGElement>): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      return toCanvas(svg, e.clientX, e.clientY);
    },
    [],
  );

  // ─── drag (select mode) ──────────────────────────────────────────────
  const beginDrag = (segId: string, end: "a" | "b", origin: Point) => {
    dragRef.current = { segId, end, origin };
  };

  const applyDrag = useCallback(
    (to: Point) => {
      const drag = dragRef.current;
      if (!drag || !onSegmentsChange) return;
      const grabbed = drag.origin;
      // Move every endpoint that was coincident with the grabbed corner so
      // adjacent runs stay welded at the corner.
      const next = segments.map((s) => {
        const na = getDistance(s.a, grabbed) < 0.01 ? to : s.a;
        const nb = getDistance(s.b, grabbed) < 0.01 ? to : s.b;
        if (na === s.a && nb === s.b) return s;
        return { ...s, a: na, b: nb };
      });
      dragRef.current = { ...drag, origin: to };
      onSegmentsChange(next);
    },
    [segments, onSegmentsChange],
  );

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = pointFromEvent(e);
    if (!p) return;
    setCursor(p);
    if (dragRef.current) applyDrag(p);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
  };

  // ─── click routing by mode ───────────────────────────────────────────
  const onCanvasClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = pointFromEvent(e);
    if (!p) return;

    if (mode === "calibrate") {
      onCalibrationPick?.(p);
      return;
    }

    if (mode === "trace") {
      if (!onSegmentsChange) return;
      if (traceAnchor) {
        onSegmentsChange([
          ...segments,
          { id: nextId("seg"), a: traceAnchor, b: p, kind: traceKind },
        ]);
      }
      setTraceAnchor(p);
      return;
    }

    if (mode === "downspout") {
      if (!onDownspoutsChange) return;
      // Remove if the click landed on an existing downspout.
      const hit = downspouts.find((d) => getDistance(d.at, p) < HIT_RADIUS);
      if (hit) {
        onDownspoutsChange(downspouts.filter((d) => d.id !== hit.id));
        return;
      }
      // Otherwise snap onto the nearest run and drop a new one.
      let best: { point: Point; distance: number } | null = null;
      for (const s of segments) {
        const proj = projectOntoSegment(p, s.a, s.b);
        if (!best || proj.distance < best.distance) best = proj;
      }
      const at = best && best.distance < 40 ? best.point : p;
      onDownspoutsChange([...downspouts, { id: nextId("ds"), at }]);
    }
  };

  const endTrace = () => setTraceAnchor(null);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]",
        className,
      )}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={cn(
          "block h-auto w-full touch-none select-none",
          mode === "trace" || mode === "calibrate"
            ? "cursor-crosshair"
            : mode === "downspout"
              ? "cursor-copy"
              : "cursor-default",
        )}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onClick={onCanvasClick}
        onDoubleClick={endTrace}
      >
        <defs>
          <filter id="gc-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern
            id="gc-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(148,163,184,0.10)"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* 1 — background (satellite tile / blueprint sheet) */}
        {background}

        {/* 2 — measurement grid */}
        {grid && (
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="url(#gc-grid)"
            pointerEvents="none"
          />
        )}

        {/* 3 — segments */}
        {segments.map((s) => {
          const isEave = s.kind === "eave";
          return (
            <line
              key={s.id}
              x1={s.a.x}
              y1={s.a.y}
              x2={s.b.x}
              y2={s.b.y}
              stroke={strokeFor(s.kind)}
              strokeWidth={isEave ? 4 : 2}
              strokeLinecap="round"
              strokeDasharray={isEave ? undefined : "8 6"}
              filter={isEave ? "url(#gc-glow)" : undefined}
              opacity={isEave ? 1 : 0.7}
            />
          );
        })}

        {/* 4 — length labels */}
        {showLabels &&
          segments.map((s) => {
            const m = midpoint(s.a, s.b);
            const ft = roundFt(segmentLengthFt(s.a, s.b, pxPerFt as number));
            if (ft <= 0) return null;
            const label = `${ft.toFixed(1)}′`;
            const w = label.length * 8 + 12;
            return (
              <g key={`lbl-${s.id}`} pointerEvents="none">
                <rect
                  x={m.x - w / 2}
                  y={m.y - 11}
                  width={w}
                  height={20}
                  rx={5}
                  fill="rgba(2,6,23,0.82)"
                  stroke={s.kind === "eave" ? EAVE : "rgba(148,163,184,0.4)"}
                  strokeWidth={1}
                />
                <text
                  x={m.x}
                  y={m.y + 4}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={600}
                  fill={s.kind === "eave" ? "#c7d0ff" : "#cbd5e1"}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {label}
                </text>
              </g>
            );
          })}

        {/* 5 — calibration overlay */}
        {mode === "calibrate" && calibration && (
          <g pointerEvents="none">
            {calibration.a && calibration.b && (
              <line
                x1={calibration.a.x}
                y1={calibration.a.y}
                x2={calibration.b.x}
                y2={calibration.b.y}
                stroke={CALIBRATE}
                strokeWidth={2}
                strokeDasharray="6 5"
              />
            )}
            {[calibration.a, calibration.b].map((p, i) =>
              p ? (
                <g key={`cal-${i}`}>
                  <circle cx={p.x} cy={p.y} r={6} fill={CALIBRATE} />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={11}
                    fill="none"
                    stroke={CALIBRATE}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                </g>
              ) : null,
            )}
            {/* rubber-band from first pick to cursor */}
            {calibration.a && !calibration.b && cursor && (
              <line
                x1={calibration.a.x}
                y1={calibration.a.y}
                x2={cursor.x}
                y2={cursor.y}
                stroke={CALIBRATE}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.6}
              />
            )}
          </g>
        )}

        {/* 6 — vertex handles (draggable in select mode) */}
        {mode === "select" &&
          segments.flatMap((s) =>
            (["a", "b"] as const).map((end) => {
              const p = s[end];
              return (
                <circle
                  key={`h-${s.id}-${end}`}
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill="#0f172a"
                  stroke={HANDLE}
                  strokeWidth={2}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    const pt = pointFromEvent(e);
                    beginDrag(s.id, end, pt ?? p);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              );
            }),
          )}

        {/* 7 — downspouts */}
        {downspouts.map((d) => (
          <g key={d.id} className={mode === "downspout" ? "cursor-pointer" : ""}>
            <circle cx={d.at.x} cy={d.at.y} r={9} fill={DOWNSPOUT} opacity={0.25} />
            <circle
              cx={d.at.x}
              cy={d.at.y}
              r={5}
              fill={DOWNSPOUT}
              stroke="#fff1f2"
              strokeWidth={1.5}
            />
          </g>
        ))}

        {/* 8 — trace rubber-band */}
        {mode === "trace" && traceAnchor && cursor && (
          <g pointerEvents="none">
            <line
              x1={traceAnchor.x}
              y1={traceAnchor.y}
              x2={cursor.x}
              y2={cursor.y}
              stroke={traceKind === "eave" ? EAVE : RAKE}
              strokeWidth={2}
              strokeDasharray="6 5"
              opacity={0.7}
            />
            <circle cx={traceAnchor.x} cy={traceAnchor.y} r={5} fill={EAVE} />
          </g>
        )}
      </svg>
    </div>
  );
}
