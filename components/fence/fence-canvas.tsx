"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DoorOpen, Home, MousePointer2, PenLine, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CANVAS_H,
  CANVAS_W,
  canvasPolylineFt,
  type Pt,
} from "@/lib/fence/geo";
import type { FenceScanResult } from "@/app/actions/fence-scan";
import type { ContourLine } from "@/lib/fence/contours";

/** Keep the camera inside the aerial: zoom 1–5×, center clamped so the
 *  view never shows past the image edge. */
function clampCam(c: { cx: number; cy: number; k: number }) {
  const k = Math.min(5, Math.max(1, c.k));
  const vw = CANVAS_W / k;
  const vh = CANVAS_H / k;
  return {
    k,
    cx: Math.min(CANVAS_W - vw / 2, Math.max(vw / 2, c.cx)),
    cy: Math.min(CANVAS_H - vh / 2, Math.max(vh / 2, c.cy)),
  };
}

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
export type FenceGate = {
  id: string;
  x: number;
  y: number;
  kind: "single" | "double" | "custom";
  /** Opening width in feet (4 walk · 10 drive · custom = user-typed). */
  widthFt: number;
};

export type FenceLayout = { runs: FenceRun[]; gates: FenceGate[] };

type Tool = "select" | "draw" | "gate" | "house";

/** Ray-cast point-in-polygon (house selection). */
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

const SNAP_PX = 12;

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${idSeq++}`;

/** Unit direction of the nearest run segment at a point (for drawing a
 *  gate's opening along the fence). */
function runDirectionAt(p: Pt, runs: FenceRun[]): Pt {
  let best = { x: 1, y: 0 };
  let bestD = Infinity;
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len = Math.hypot(abx, aby) || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (len * len)));
      const d = Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x: abx / len, y: aby / len };
      }
    }
  }
  return best;
}

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
  topo = null,
  buildings = [],
  onBuildingsChange,
  className,
}: {
  scan: FenceScanResult;
  layout: FenceLayout;
  onChange: (next: FenceLayout) => void;
  /** Measured elevation contours to overlay (levels are ft above the
   *  lot's low point). Null hides the layer. */
  topo?: { lines: ContourLine[]; intervalFt: number } | null;
  /** Building footprints (house/garage) — rendered as traced outlines
   *  and editable via the House tool when onBuildingsChange is given. */
  buildings?: Pt[][];
  onBuildingsChange?: (next: Pt[][]) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>(
    scan.suggestedRuns.length > 0 ? "select" : "draw",
  );
  const [gateKind, setGateKind] = useState<"single" | "double" | "custom">("single");
  const [customGateFt, setCustomGateFt] = useState(6);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [houseDraft, setHouseDraft] = useState<Pt[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<number | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  // Ghost gate under the cursor in gate mode; transient helper notices.
  const [gateGhost, setGateGhost] = useState<Pt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const say = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400);
  };

  const pxPerFt = scan.canvasPxPerFt;

  /* ---- camera: pan + zoom over the aerial ---- */
  const [cam, setCam] = useState({ cx: CANVAS_W / 2, cy: CANVAS_H / 2, k: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setCam((c0) => {
      const k = Math.min(5, Math.max(1, c0.k * factor));
      if (k === c0.k) return c0;
      const vw0 = CANVAS_W / c0.k;
      const vh0 = CANVAS_H / c0.k;
      // world point under the cursor stays fixed while zooming
      const wx = c0.cx - vw0 / 2 + ((clientX - r.left) / r.width) * vw0;
      const wy = c0.cy - vh0 / 2 + ((clientY - r.top) / r.height) * vh0;
      return clampCam({
        k,
        cx: wx - (wx - c0.cx) * (c0.k / k),
        cy: wy - (wy - c0.cy) * (c0.k / k),
      });
    });
  }, []);

  // Wheel must be a NATIVE non-passive listener (React root wheel
  // handlers are passive, so preventDefault would be ignored and the
  // page would scroll). Pinch/ctrl+wheel zooms; plain wheel pans.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
      } else {
        const r = svg.getBoundingClientRect();
        setCam((c0) => {
          const s = CANVAS_W / c0.k / r.width;
          return clampCam({
            k: c0.k,
            cx: c0.cx + e.deltaX * s,
            cy: c0.cy + e.deltaY * s,
          });
        });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ---- coordinate + snapping helpers ---- */

  const toCanvas = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const c = camRef.current;
    const vw = CANVAS_W / c.k;
    const vh = CANVAS_H / c.k;
    return {
      x: c.cx - vw / 2 + ((e.clientX - r.left) / r.width) * vw,
      y: c.cy - vh / 2 + ((e.clientY - r.top) / r.height) * vh,
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

  const finishHouse = useCallback(() => {
    setHouseDraft((d) => {
      const pts = d.filter(
        (p, i) => i === 0 || Math.hypot(p.x - d[i - 1].x, p.y - d[i - 1].y) > 1,
      );
      if (pts.length >= 3 && onBuildingsChange) {
        onBuildingsChange([...buildings, pts]);
      }
      return [];
    });
  }, [buildings, onBuildingsChange]);

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
      if (e.key === "Escape") {
        setDraft([]);
        setHouseDraft([]);
      }
      if (e.key === "Enter") {
        if (draft.length >= 2) finishDraft();
        else if (houseDraft.length >= 3) finishHouse();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // While drawing, Backspace steps back one post; only with no
        // draft does it delete the selected run/house.
        if (draft.length > 0) {
          e.preventDefault();
          setDraft((d) => d.slice(0, -1));
        } else if (houseDraft.length > 0) {
          e.preventDefault();
          setHouseDraft((d) => d.slice(0, -1));
        } else if (selectedRun) {
          removeRun(selectedRun);
        } else if (selectedHouse !== null && onBuildingsChange) {
          onBuildingsChange(buildings.filter((_, i) => i !== selectedHouse));
          setSelectedHouse(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.length, houseDraft.length, finishDraft, finishHouse, selectedRun, removeRun, selectedHouse, buildings, onBuildingsChange]);

  /* ---- gate tool: nearest point on any run segment ---- */

  function nearestOnRuns(p: Pt, tolerance = 34): Pt | null {
    let best: Pt | null = null;
    let bestD = tolerance;
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
    if (tool === "house") {
      if (e.detail > 1) return;
      // clicking back on the first corner closes the outline
      if (
        houseDraft.length >= 3 &&
        Math.hypot(raw.x - houseDraft[0].x, raw.y - houseDraft[0].y) < 12
      ) {
        finishHouse();
        return;
      }
      setHouseDraft((d) => [...d, raw]);
      return;
    }
    if (tool === "gate") {
      if (layout.runs.length === 0) {
        say("Draw a fence line first — gates hang on the fence.");
        return;
      }
      const q = nearestOnRuns(raw);
      if (q) {
        const widthFt =
          gateKind === "single" ? 4 : gateKind === "double" ? 10 : Math.min(24, Math.max(3, customGateFt));
        onChange({
          ...layout,
          gates: [...layout.gates, { id: nextId("gate"), ...q, kind: gateKind, widthFt }],
        });
      } else {
        say("Tap on (or near) a fence line to place the gate.");
      }
      return;
    }
    // select tool: houses are selectable at the svg level (their layer
    // never intercepts clicks); runs handle their own clicks and stop
    // propagation before we get here.
    const hitHouse = buildings.findIndex((ring) => pointInPoly(raw, ring));
    setSelectedHouse(hitHouse >= 0 ? hitHouse : null);
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
              ...(onBuildingsChange
                ? [{ id: "house" as Tool, label: "House", Icon: Home }]
                : []),
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
          <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 p-0.5">
            {(["single", "double", "custom"] as const).map((k) => (
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
                {k === "single" ? "Walk 4'" : k === "double" ? "Drive 10'" : "Custom"}
              </button>
            ))}
            {gateKind === "custom" && (
              <span className="flex items-center gap-1 pr-1.5 text-[11px] font-semibold text-zinc-600">
                <input
                  type="number"
                  min={3}
                  max={24}
                  step={1}
                  value={customGateFt}
                  onChange={(e) => setCustomGateFt(Number(e.target.value) || 6)}
                  className="h-6 w-12 rounded-md border border-zinc-200 bg-white px-1.5 text-center text-[11px] tabular-nums outline-none focus:border-accent-400"
                />
                ft
              </span>
            )}
          </div>
        )}
        {draft.length > 0 && (
          <>
            <button
              type="button"
              onClick={finishDraft}
              disabled={draft.length < 2}
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-50"
            >
              ✓ Finish run
            </button>
            <button
              type="button"
              onClick={() => setDraft([])}
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
            >
              ✕ Cancel
            </button>
          </>
        )}
        {houseDraft.length > 0 && (
          <>
            <button
              type="button"
              onClick={finishHouse}
              disabled={houseDraft.length < 3}
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-50"
            >
              ✓ Close outline
            </button>
            <button
              type="button"
              onClick={() => setHouseDraft([])}
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
            >
              ✕ Cancel
            </button>
          </>
        )}
        {scan.suggestedRuns.length > 0 && draft.length === 0 && (
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
        {selectedHouse !== null && onBuildingsChange && (
          <button
            type="button"
            onClick={() => {
              onBuildingsChange(buildings.filter((_, i) => i !== selectedHouse));
              setSelectedHouse(null);
            }}
            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete house
          </button>
        )}
        <span className="ml-auto rounded-full bg-accent-600 px-3 py-1 text-xs font-bold text-white">
          {totalLf} LF · {layout.gates.length}{" "}
          {layout.gates.length === 1 ? "gate" : "gates"}
        </span>
      </div>

      {/* Canvas */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950">
        <svg
          ref={svgRef}
          viewBox={`${cam.cx - CANVAS_W / 2 / cam.k} ${cam.cy - CANVAS_H / 2 / cam.k} ${CANVAS_W / cam.k} ${CANVAS_H / cam.k}`}
          className={cn(
            "block h-auto w-full select-none",
            tool === "draw" || tool === "gate" || tool === "house"
              ? "cursor-crosshair"
              : "cursor-default",
          )}
          onClick={onCanvasClick}
          onDoubleClick={(e) => {
            e.preventDefault();
            if (tool === "draw") finishDraft();
            else if (tool === "house") finishHouse();
            else zoomAt(e.clientX, e.clientY, 1.6);
          }}
          onPointerDown={(e) => {
            // middle-button drag pans in any tool
            if (e.button === 1) {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              panRef.current = { sx: e.clientX, sy: e.clientY, cx: cam.cx, cy: cam.cy };
            }
          }}
          onPointerMove={(e) => {
            const pan = panRef.current;
            if (!pan) return;
            const r = svgRef.current!.getBoundingClientRect();
            const s = CANVAS_W / camRef.current.k / r.width;
            setCam(
              clampCam({
                k: camRef.current.k,
                cx: pan.cx - (e.clientX - pan.sx) * s,
                cy: pan.cy - (e.clientY - pan.sy) * s,
              }),
            );
          }}
          onPointerUp={() => {
            panRef.current = null;
          }}
          onMouseMove={(e) => {
            if (tool === "draw") setHover(snap(toCanvas(e)));
            else if (tool === "house") setHover(toCanvas(e));
            else if (tool === "gate") setGateGhost(nearestOnRuns(toCanvas(e)));
          }}
          onMouseLeave={() => {
            setHover(null);
            setGateGhost(null);
          }}
          onContextMenu={(e) => {
            // Right-click = finish (or cancel an empty draft) — the "let
            // go of the line" gesture.
            if (tool === "draw") {
              e.preventDefault();
              if (draft.length >= 2) finishDraft();
              else setDraft([]);
            } else if (tool === "house") {
              e.preventDefault();
              if (houseDraft.length >= 3) finishHouse();
              else setHouseDraft([]);
            }
          }}
        >
          <image
            href={scan.aerial.imageDataUrl}
            x={0}
            y={0}
            width={CANVAS_W}
            height={CANVAS_H}
            preserveAspectRatio="xMidYMid slice"
          />

          {/* Topo overlay — measured elevation contours with ft labels.
              Purely informational: never intercepts pointer events. */}
          {topo && topo.lines.length > 0 && (
            <g pointerEvents="none">
              {topo.lines.map((line) =>
                line.chains.map((ch, i) => (
                  <polyline
                    key={`c-${line.levelFt}-${i}`}
                    points={ch.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                    fill="none"
                    stroke="#FCD34D"
                    strokeWidth={1.3}
                    strokeOpacity={0.85}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )),
              )}
              {topo.lines.map((line) =>
                line.chains.slice(0, 3).map((ch, i) => {
                  let len = 0;
                  for (let k = 1; k < ch.length; k++) {
                    len += Math.hypot(ch[k].x - ch[k - 1].x, ch[k].y - ch[k - 1].y);
                  }
                  if (len < 70) return null;
                  const mid = ch[Math.floor(ch.length / 2)];
                  // keep labels clear of the canvas border so they never clip
                  if (
                    mid.x < 26 ||
                    mid.x > CANVAS_W - 26 ||
                    mid.y < 16 ||
                    mid.y > CANVAS_H - 16
                  )
                    return null;
                  return (
                    <text
                      key={`cl-${line.levelFt}-${i}`}
                      x={mid.x}
                      y={mid.y - 3}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill="#FDE68A"
                      stroke="#1C1917"
                      strokeWidth={2.6}
                      style={{ paintOrder: "stroke" }}
                    >
                      +{line.levelFt}′
                    </text>
                  );
                }),
              )}
              <text
                x={CANVAS_W - 10}
                y={20}
                textAnchor="end"
                fontSize={10.5}
                fontWeight={600}
                fill="#FDE68A"
                stroke="#1C1917"
                strokeWidth={2.6}
                style={{ paintOrder: "stroke" }}
              >
                Topo lines every {topo.intervalFt}′ — feet above the low point
              </text>
            </g>
          )}

          {/* Building footprints — the house the fence ties into */}
          {buildings.map((ring, i) => (
            <polygon
              key={`bldg-${i}`}
              pointerEvents="none"
              points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill={
                i === selectedHouse
                  ? "rgba(228,228,231,0.35)"
                  : "rgba(24,24,27,0.26)"
              }
              stroke={i === selectedHouse ? "#FDA4AF" : "rgba(244,244,245,0.9)"}
              strokeWidth={i === selectedHouse ? 2.2 : 1.4}
              strokeLinejoin="round"
            />
          ))}

          {/* House outline being traced */}
          {houseDraft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={[...houseDraft, ...(hover && tool === "house" ? [hover] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="rgba(244,244,245,0.12)"
                stroke="#F4F4F5"
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeLinejoin="round"
              />
              {houseDraft.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={i === 0 && houseDraft.length >= 3 ? 6 : 3.5}
                  fill={i === 0 && houseDraft.length >= 3 ? "#22C55E" : "#F4F4F5"}
                  stroke="#18181B"
                  strokeWidth={1.2}
                />
              ))}
            </g>
          )}

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

          {/* Draft run being drawn — live numbers at the cursor */}
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
              {hover && (() => {
                const last = draft[draft.length - 1];
                const segFt = Math.round(
                  Math.hypot(hover.x - last.x, hover.y - last.y) / pxPerFt,
                );
                const totalFt = Math.round(
                  canvasPolylineFt([...draft, hover], pxPerFt),
                );
                const label =
                  draft.length > 1 ? `+${segFt} ft · ${totalFt} ft total` : `${segFt} ft`;
                const w = label.length * 6.6 + 16;
                return (
                  <g transform={`translate(${hover.x + 14}, ${hover.y - 16})`}>
                    <rect x={0} y={-12} width={w} height={20} rx={6} fill="rgba(9,20,12,0.9)" />
                    <text x={w / 2} y={2} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fde68a">
                      {label}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          {/* Ghost gate preview in gate mode */}
          {tool === "gate" && gateGhost && (
            <circle
              cx={gateGhost.x}
              cy={gateGhost.y}
              r={9}
              fill="rgba(244,114,182,0.35)"
              stroke="#f472b6"
              strokeWidth={2}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}

          {/* Gates — drawn at their real width along the run */}
          {layout.gates.map((g) => {
            const widthFt = g.widthFt ?? (g.kind === "double" ? 10 : 4);
            const dir = runDirectionAt(g, layout.runs);
            const half = (widthFt * pxPerFt) / 2;
            const a = { x: g.x - dir.x * half, y: g.y - dir.y * half };
            const b = { x: g.x + dir.x * half, y: g.y + dir.y * half };
            return (
              <g
                key={g.id}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({
                    ...layout,
                    gates: layout.gates.filter((x) => x.id !== g.id),
                  });
                }}
              >
                {/* the opening: interrupt the run visually */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0b1210" strokeWidth={7} strokeLinecap="round" opacity={0.55} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f472b6" strokeWidth={4} strokeLinecap="round" strokeDasharray="6 4" />
                <circle cx={a.x} cy={a.y} r={3.5} fill="#fff" stroke="#f472b6" strokeWidth={2} />
                <circle cx={b.x} cy={b.y} r={3.5} fill="#fff" stroke="#f472b6" strokeWidth={2} />
                <g transform={`translate(${g.x}, ${g.y - 14})`} pointerEvents="none">
                  <rect x={-17} y={-10} width={34} height={16} rx={8} fill="#f472b6" />
                  <text y={2.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff">
                    {widthFt}&apos;
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* zoom controls — pinch / ctrl+scroll zooms, scroll pans,
            middle-drag pans, double-click (select tool) zooms in */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              const r = svgRef.current?.getBoundingClientRect();
              if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.45);
            }}
            className="transition-smooth ring-focus h-7 w-7 rounded-full bg-white/90 text-sm font-bold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white"
          >
            −
          </button>
          <button
            type="button"
            title="Reset view"
            onClick={() => setCam({ cx: CANVAS_W / 2, cy: CANVAS_H / 2, k: 1 })}
            className="transition-smooth ring-focus h-7 rounded-full bg-white/90 px-2 text-[11px] font-bold tabular-nums text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white"
          >
            {cam.k === 1 ? "100%" : `${Math.round(cam.k * 100)}% ⤺`}
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              const r = svgRef.current?.getBoundingClientRect();
              if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.45);
            }}
            className="transition-smooth ring-focus h-7 w-7 rounded-full bg-white/90 text-sm font-bold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white"
          >
            +
          </button>
        </div>
      </div>

      {notice && (
        <p className="anim-enter-fade rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          {notice}
        </p>
      )}
      <p className="text-xs text-zinc-400">
        {tool === "draw"
          ? draft.length > 0
            ? "Click to keep adding posts — ✓ Finish (or double-click / right-click / Enter) ends the run · Backspace steps back · Esc cancels."
            : "Click to start a fence line. Points snap to the property corners and to your other runs."
          : tool === "house"
            ? houseDraft.length > 0
              ? "Click corner to corner around the house — click the green first dot (or Enter / double-click) to close the outline."
              : "Trace the house: click its corners on the photo. The outline shows in the client's diagram and 3D."
            : tool === "gate"
              ? "Click anywhere on a fence line to place the gate. Click a gate to remove it."
              : "Click a fence run to select it — Delete removes it. Click the house outline to select or delete it. The dashed green line is the recorded property boundary."}
      </p>
    </div>
  );
}
