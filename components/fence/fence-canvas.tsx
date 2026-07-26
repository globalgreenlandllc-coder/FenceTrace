"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DoorOpen, MousePointer2, PenLine, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CANVAS_H,
  CANVAS_W,
  canvasPolylineFt,
  type Pt,
} from "@/lib/fence/geo";
import type { FenceScanResult } from "@/app/actions/fence-scan";

/**
 * FenceCanvas — draw fence runs over the satellite tile with the Regrid
 * parcel boundary as a guide. Controlled component: the page owns
 * runs/gates and feeds live LF into the takeoff + pricing panels.
 *
 * Tools: select (click a run, Delete removes) · draw (click vertices,
 * double-click or Enter finishes, Esc cancels, snaps to parcel corners
 * and run endpoints) · gate (click a run to drop a gate; button toggles
 * walk vs drive). "Use property line" seeds runs from the parcel ring.
 */

export type FenceRun = { id: string; points: Pt[] };
export type FenceGate = { id: string; x: number; y: number; kind: "single" | "double" };

export type FenceLayout = { runs: FenceRun[]; gates: FenceGate[] };

type Tool = "select" | "draw" | "gate";

const SNAP_PX = 12;

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${idSeq++}`;

/** Distance from a point to the nearest spot on a run's segments. */
function distToRun(p: Pt, run: FenceRun): number {
  let best = Infinity;
  for (let i = 1; i < run.points.length; i++) {
    const a = run.points[i - 1];
    const b = run.points[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    best = Math.min(best, Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y));
  }
  return best;
}

export function FenceCanvas({
  scan,
  layout,
  onChange,
  className,
}: {
  scan: FenceScanResult;
  layout: FenceLayout;
  onChange: (next: FenceLayout) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>(
    scan.suggestedRuns.length > 0 ? "select" : "draw",
  );
  const [gateKind, setGateKind] = useState<"single" | "double">("single");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);

  const pxPerFt = scan.canvasPxPerFt;

  /* ---- coordinate + snapping helpers ---- */

  const toCanvas = useCallback((e: React.MouseEvent): Pt => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS_W,
      y: ((e.clientY - r.top) / r.height) * CANVAS_H,
    };
  }, []);

  const snapTargets = useMemo(() => {
    const pts: Pt[] = [];
    for (const ring of scan.parcelRings) pts.push(...ring);
    for (const run of layout.runs) {
      if (run.points.length > 0) {
        pts.push(run.points[0], run.points[run.points.length - 1]);
      }
    }
    return pts;
  }, [scan.parcelRings, layout.runs]);

  const snap = useCallback(
    (p: Pt): Pt => {
      let best: Pt | null = null;
      let bestD = SNAP_PX;
      for (const t of snapTargets) {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      return best ?? p;
    },
    [snapTargets],
  );

  /* ---- draw tool ---- */

  const finishDraft = useCallback(() => {
    setDraft((d) => {
      // Double-click fires click twice before dblclick — collapse any
      // consecutive duplicate vertices so they can't inflate the corner
      // count or leave zero-length segments.
      const pts = d.filter(
        (p, i) => i === 0 || Math.hypot(p.x - d[i - 1].x, p.y - d[i - 1].y) > 1,
      );
      if (pts.length >= 2) {
        onChange({
          ...layout,
          runs: [...layout.runs, { id: nextId("run"), points: pts }],
        });
      }
      return [];
    });
  }, [layout, onChange]);

  // Deleting a run takes its gates with it — an orphan gate would keep
  // billing a gate AND keep shrinking the net fence footage.
  const removeRun = useCallback(
    (runId: string) => {
      const run = layout.runs.find((r) => r.id === runId);
      onChange({
        runs: layout.runs.filter((r) => r.id !== runId),
        gates: run
          ? layout.gates.filter((g) => distToRun(g, run) > 14)
          : layout.gates,
      });
      setSelectedRun(null);
    },
    [layout, onChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Enter" && draft.length >= 2) finishDraft();
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRun) {
        removeRun(selectedRun);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.length, finishDraft, selectedRun, removeRun]);

  /* ---- gate tool: nearest point on any run segment ---- */

  function nearestOnRuns(p: Pt): Pt | null {
    let best: Pt | null = null;
    let bestD = 18;
    for (const run of layout.runs) {
      for (let i = 1; i < run.points.length; i++) {
        const a = run.points[i - 1];
        const b = run.points[i];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const q = { x: a.x + t * abx, y: a.y + t * aby };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    return best;
  }

  function onCanvasClick(e: React.MouseEvent) {
    const raw = toCanvas(e);
    if (tool === "draw") {
      if (e.detail > 1) return; // second click of a dbl-click — finish handles it
      const p = snap(raw);
      setDraft((d) => [...d, p]);
      return;
    }
    if (tool === "gate") {
      const q = nearestOnRuns(raw);
      if (q) {
        onChange({
          ...layout,
          gates: [...layout.gates, { id: nextId("gate"), ...q, kind: gateKind }],
        });
      }
      return;
    }
    setSelectedRun(null);
  }

  /* ---- derived ---- */

  const totalLf = useMemo(
    () =>
      Math.round(
        layout.runs.reduce((a, r) => a + canvasPolylineFt(r.points, pxPerFt), 0),
      ),
    [layout.runs, pxPerFt],
  );

  const usePropertyLine = () => {
    onChange({
      ...layout,
      runs: [
        ...layout.runs,
        ...scan.suggestedRuns.map((s) => ({ id: nextId("run"), points: s.points })),
      ],
    });
    setTool("select");
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
          {(
            [
              { id: "select", label: "Select", Icon: MousePointer2 },
              { id: "draw", label: "Draw fence", Icon: PenLine },
              { id: "gate", label: "Add gate", Icon: DoorOpen },
            ] as { id: Tool; label: string; Icon: typeof PenLine }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={cn(
                "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                tool === t.id
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              <t.Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        {tool === "gate" && (
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
            {(["single", "double"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setGateKind(k)}
                className={cn(
                  "transition-smooth ring-focus rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  gateKind === k
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {k === "single" ? "Walk 4'" : "Drive 10'"}
              </button>
            ))}
          </div>
        )}
        {scan.suggestedRuns.length > 0 && (
          <button
            type="button"
            onClick={usePropertyLine}
            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border border-accent-300 bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-800 hover:bg-accent-100"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Use property line
          </button>
        )}
        {selectedRun && (
          <button
            type="button"
            onClick={() => removeRun(selectedRun)}
            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete run
          </button>
        )}
        <span className="ml-auto rounded-full bg-accent-600 px-3 py-1 text-xs font-bold text-white">
          {totalLf} LF · {layout.gates.length}{" "}
          {layout.gates.length === 1 ? "gate" : "gates"}
        </span>
      </div>

      {/* Canvas */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className={cn(
            "block h-auto w-full select-none",
            tool === "draw" || tool === "gate" ? "cursor-crosshair" : "cursor-default",
          )}
          onClick={onCanvasClick}
          onDoubleClick={(e) => {
            e.preventDefault();
            if (tool === "draw") finishDraft();
          }}
          onMouseMove={(e) => {
            if (tool === "draw") setHover(snap(toCanvas(e)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <image
            href={scan.aerial.imageDataUrl}
            x={0}
            y={0}
            width={CANVAS_W}
            height={CANVAS_H}
            preserveAspectRatio="xMidYMid slice"
          />

          {/* Parcel boundary — the Regrid property line */}
          {scan.parcelRings.map((ring, i) => (
            <polygon
              key={`parcel-${i}`}
              points={ring.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(74,222,128,0.06)"
              stroke="#4ade80"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          ))}

          {/* Fence runs */}
          {layout.runs.map((run) => {
            const ft = Math.round(canvasPolylineFt(run.points, pxPerFt));
            const mid = run.points[Math.floor(run.points.length / 2)];
            const selected = run.id === selectedRun;
            return (
              <g key={run.id}>
                <polyline
                  points={run.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={selected ? "#fbbf24" : "#22d3ee"}
                  strokeWidth={selected ? 5 : 3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer", filter: "drop-shadow(0 0 4px rgba(34,211,238,0.6))" }}
                  onClick={(e) => {
                    if (tool !== "gate") {
                      e.stopPropagation();
                      setSelectedRun(run.id);
                      setTool("select");
                    }
                  }}
                />
                {run.points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#0891b2" />
                ))}
                {mid && ft > 4 && (
                  <g transform={`translate(${mid.x}, ${mid.y - 12})`} pointerEvents="none">
                    <rect x={-24} y={-11} width={48} height={18} rx={5} fill="rgba(9,20,12,0.85)" />
                    <text x={0} y={3} textAnchor="middle" fontSize={11} fontWeight={700} fill="#a7f3d0">
                      {ft} ft
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Draft run being drawn */}
          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={[...draft, ...(hover ? [hover] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={3}
                strokeDasharray="7 5"
                strokeLinecap="round"
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#fbbf24" />
              ))}
            </g>
          )}

          {/* Gates */}
          {layout.gates.map((g) => (
            <g
              key={g.id}
              transform={`translate(${g.x}, ${g.y})`}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onChange({
                  ...layout,
                  gates: layout.gates.filter((x) => x.id !== g.id),
                });
              }}
            >
              <circle r={9} fill="#f472b6" stroke="#fff" strokeWidth={2} />
              <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">
                {g.kind === "single" ? "G" : "GG"}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <p className="text-xs text-zinc-400">
        {tool === "draw"
          ? "Click to place fence posts along the line — double-click or press Enter to finish a run, Esc to cancel. Points snap to the property corners."
          : tool === "gate"
            ? "Click anywhere on a fence line to place the gate. Click a gate to remove it."
            : "Click a fence run to select it — Delete removes it. The dashed green line is the recorded property boundary."}
      </p>
    </div>
  );
}
