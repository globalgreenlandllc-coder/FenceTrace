"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  Hexagon,
  Maximize2,
  Loader2,
  Pencil,
  Ruler,
  Trash2,
  Undo2,
  Check,
} from "lucide-react";

import { VIEWBOX_W, VIEWBOX_H } from "./aerial-constants";
import { PdfPageImage } from "./pdf-page-image";

type Pt = { x: number; y: number };
type Sheet = { pageIndex: number; label: string };
type Tool = "pan" | "scale" | "draw" | "outline";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Shortest distance from point p to segment a-b (canvas units). */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * "Exact copy of the roof" + manual takeoff ON it. Renders the architect's
 * real PDF sheet (zoom/pan, sheet selector), then lets the contractor:
 *   1. SET SCALE — click the two ends of a known dimension, type its feet →
 *      px/ft for THIS sheet (no AI scale guessing).
 *   2. DRAW eave runs on the real drawing — each gets exact LF from the
 *      calibrated scale, shown live.
 *   3. APPLY — the drawn runs become the priced eaves (replacing the AI
 *      trace), at the calibrated scale, so the proposal prices off what the
 *      contractor traced on the actual plan.
 *
 * Scale + finished runs live in the parent (results-view) so they survive
 * tab switches; the in-progress click and the active tool are local.
 */
export function PdfPlanView({
  planSource,
  initialPage,
  scalePxPerFt,
  onScaleChange,
  runs,
  onRunsChange,
  onApply,
  outline,
  onOutlineChange,
  onApplyOutline,
  gableEdges,
  onToggleGableEdge,
}: {
  planSource: {
    pdfUrl: string;
    pageIndex: number;
    pageCount?: number;
    sheets?: Sheet[];
  };
  /** When the Elevations view hands off "trace gutters here", the page to
   *  open on. Changing it navigates the viewer to that sheet. */
  initialPage?: number | null;
  /** Calibrated px-per-foot in the 900×580 canvas space, or null. */
  scalePxPerFt: number | null;
  onScaleChange: (pxPerFt: number) => void;
  /** Finished eave runs (each a 2-point segment) in canvas space. */
  runs: Pt[][];
  onRunsChange: (runs: Pt[][]) => void;
  /** Commit the drawn runs as the priced takeoff. */
  onApply: () => void;
  /** Traced building-outline polygon (closed) in canvas space, or []. */
  outline: Pt[];
  onOutlineChange: (outline: Pt[]) => void;
  /** Commit the traced outline as the footprint (re-derives the roof). */
  onApplyOutline: () => void;
  /** Per-edge gable flag (true = rake/gable end, no gutter). */
  gableEdges: boolean[];
  onToggleGableEdge: (i: number) => void;
}) {
  const sheets = planSource.sheets ?? [];
  const pageCount =
    planSource.pageCount ??
    (sheets.length ? Math.max(...sheets.map((s) => s.pageIndex)) : undefined);

  const [page, setPage] = useState(planSource.pageIndex || 1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState({ x: 0, y: 0, w: VIEWBOX_W, h: VIEWBOX_H });
  const [tool, setTool] = useState<Tool>("pan");

  // In-progress interaction (ephemeral).
  const [scalePts, setScalePts] = useState<Pt[]>([]);
  const [feetInput, setFeetInput] = useState("");
  const [pendingStart, setPendingStart] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // In-progress building outline (vertices, not yet closed).
  const [draftOutline, setDraftOutline] = useState<Pt[]>([]);

  const svgRef = useRef<SVGSVGElement>(null);
  const down = useRef<{
    px: number;
    py: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const resetView = () => setView({ x: 0, y: 0, w: VIEWBOX_W, h: VIEWBOX_H });
  const goPage = (p: number) => {
    setPage(p);
    resetView();
  };

  // Honor a "trace gutters here" handoff from the Elevations view: when the
  // requested page changes, navigate to it (reset zoom so the sheet fits).
  useEffect(() => {
    if (initialPage != null && initialPage >= 1) {
      setPage(initialPage);
      setView({ x: 0, y: 0, w: VIEWBOX_W, h: VIEWBOX_H });
    }
  }, [initialPage]);

  // Esc cancels the in-progress click; Backspace deletes a selected run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingStart(null);
        setScalePts([]);
        setCursor(null);
        setDraftOutline([]);
      } else if (e.key === "Enter" && draftOutline.length >= 3) {
        onOutlineChange(draftOutline);
        setDraftOutline([]);
        setCursor(null);
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        draftOutline.length > 0
      ) {
        setDraftOutline((d) => d.slice(0, -1));
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selected != null
      ) {
        onRunsChange(runs.filter((_, i) => i !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, runs, onRunsChange, draftOutline, onOutlineChange]);

  const toVB = (clientX: number, clientY: number): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * view.h,
    };
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const cvx = view.x + fx * view.w;
    const cvy = view.y + fy * view.h;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const nextW = Math.max(VIEWBOX_W / 12, Math.min(VIEWBOX_W * 8, view.w * factor));
    const nextH = nextW * (view.h / view.w);
    setView({ x: cvx - fx * nextW, y: cvy - fy * nextH, w: nextW, h: nextH });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    down.current = {
      px: e.clientX,
      py: e.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Live rubber-band for scale/draw/outline, regardless of drag state.
    if (
      (tool === "draw" && pendingStart) ||
      (tool === "scale" && scalePts.length === 1) ||
      (tool === "outline" && draftOutline.length > 0)
    ) {
      setCursor(toVB(e.clientX, e.clientY));
    }
    if (!down.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dxPx = e.clientX - down.current.px;
    const dyPx = e.clientY - down.current.py;
    if (Math.hypot(dxPx, dyPx) > 4) down.current.moved = true;
    // Drag pans in every tool (so you can draw AND navigate).
    const dx = (dxPx / rect.width) * view.w;
    const dy = (dyPx / rect.height) * view.h;
    setView((v) => ({ ...v, x: down.current!.vx - dx, y: down.current!.vy - dy }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const moved = down.current?.moved ?? false;
    down.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId))
      svgRef.current.releasePointerCapture(e.pointerId);
    if (moved) return; // it was a pan, not a click
    const p = toVB(e.clientX, e.clientY);

    if (tool === "scale") {
      setScalePts((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
      return;
    }
    if (tool === "draw") {
      if (!scalePxPerFt) return; // must calibrate first
      if (!pendingStart) {
        setPendingStart(p);
      } else {
        onRunsChange([...runs, [pendingStart, p]]);
        setPendingStart(null);
        setCursor(null);
      }
      return;
    }
    if (tool === "outline") {
      // After the polygon is closed, a click toggles the nearest edge
      // between EAVE (gutter) and GABLE (rake).
      if (outline.length >= 3 && draftOutline.length === 0) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < outline.length; i++) {
          const d = distToSeg(p, outline[i], outline[(i + 1) % outline.length]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best >= 0 && bestD < view.w / 40) onToggleGableEdge(best);
        return;
      }
      // Otherwise we're still tracing — click near the first vertex closes it.
      if (draftOutline.length >= 3 && dist(p, draftOutline[0]) < view.w / 40) {
        onOutlineChange(draftOutline);
        setDraftOutline([]);
        setCursor(null);
      } else {
        setDraftOutline((d) => [...d, p]);
      }
      return;
    }
    // pan tool → select the nearest run for deletion
    let best = -1;
    let bestD = Infinity;
    runs.forEach((r, i) => {
      const d = distToSeg(p, r[0], r[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setSelected(bestD < view.w / 40 ? best : null);
  };

  const commitScale = () => {
    const feet = parseFloat(feetInput);
    if (scalePts.length === 2 && Number.isFinite(feet) && feet > 0) {
      const px = dist(scalePts[0], scalePts[1]);
      if (px > 0) {
        onScaleChange(px / feet);
        setScalePts([]);
        setFeetInput("");
        setTool("draw");
      }
    }
  };

  const runLF = (r: Pt[]) =>
    scalePxPerFt ? dist(r[0], r[1]) / scalePxPerFt : null;
  const totalLF = scalePxPerFt
    ? runs.reduce((a, r) => a + dist(r[0], r[1]) / scalePxPerFt, 0)
    : 0;

  // Zoom-stable sizes (constant on screen regardless of zoom).
  const sw = view.w / 320;
  const dot = view.w / 90;

  const toolBtn = (active: boolean) =>
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition " +
    (active
      ? "border-accent-600 bg-accent-600 text-white"
      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800");
  const plainBtn =
    "inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-2">
      {/* Sheet + view controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {sheets.length > 0 ? (
          <select
            value={page}
            onChange={(e) => goPage(Number(e.target.value))}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {sheets.map((s) => (
              <option key={s.pageIndex} value={s.pageIndex}>
                Page {s.pageIndex} · {s.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              className={plainBtn}
              disabled={page <= 1}
              onClick={() => goPage(Math.max(1, page - 1))}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="px-1 font-medium text-zinc-600 dark:text-zinc-300">
              Page {page}
              {pageCount ? ` / ${pageCount}` : ""}
            </span>
            <button
              type="button"
              className={plainBtn}
              disabled={pageCount != null && page >= pageCount}
              onClick={() =>
                goPage(pageCount ? Math.min(pageCount, page + 1) : page + 1)
              }
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
        <button type="button" className={plainBtn} onClick={resetView}>
          <Maximize2 size={13} /> Fit
        </button>
      </div>

      {/* Takeoff tools */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className={toolBtn(tool === "pan")}
          onClick={() => {
            setTool("pan");
            setPendingStart(null);
          }}
        >
          <Hand size={13} /> Pan
        </button>
        <button
          type="button"
          className={toolBtn(tool === "scale")}
          onClick={() => {
            setTool("scale");
            setScalePts([]);
            setPendingStart(null);
          }}
        >
          <Ruler size={13} /> Set scale
        </button>
        <button
          type="button"
          className={toolBtn(tool === "draw")}
          disabled={!scalePxPerFt}
          title={!scalePxPerFt ? "Set the scale first" : "Draw eave runs"}
          onClick={() => {
            if (scalePxPerFt) setTool("draw");
          }}
        >
          <Pencil size={13} /> Draw eaves
        </button>
        <button
          type="button"
          className={toolBtn(tool === "outline")}
          title="Trace the building outline → the roof shape"
          onClick={() => {
            setTool("outline");
            setPendingStart(null);
            setSelected(null);
          }}
        >
          <Hexagon size={13} /> Trace outline
        </button>

        <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

        {scalePxPerFt ? (
          <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            Scale set · {runs.length} run{runs.length === 1 ? "" : "s"} ·{" "}
            {totalLF.toFixed(1)} LF
          </span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">
            Set the scale to start (click a known dimension, enter its feet).
          </span>
        )}

        {selected != null && (
          <button
            type="button"
            className={plainBtn}
            onClick={() => {
              onRunsChange(runs.filter((_, i) => i !== selected));
              setSelected(null);
            }}
          >
            <Trash2 size={13} /> Delete run
          </button>
        )}
        {runs.length > 0 && (
          <button
            type="button"
            className={plainBtn}
            onClick={() => {
              onRunsChange(runs.slice(0, -1));
              setSelected(null);
            }}
          >
            <Undo2 size={13} /> Undo run
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1 font-semibold text-white transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!scalePxPerFt || runs.length === 0}
          title={
            !scalePxPerFt || runs.length === 0
              ? "Set scale and draw at least one run"
              : "Use the drawn runs as the priced takeoff"
          }
          onClick={onApply}
        >
          <Check size={13} /> Apply to estimate
        </button>
      </div>

      {/* Outline status + apply (shown while tracing the building outline) */}
      {(tool === "outline" || outline.length > 0 || draftOutline.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-xs dark:border-accent-800 dark:bg-accent-900/40">
          <Hexagon size={13} className="text-accent-600 dark:text-accent-300" />
          <span className="font-medium text-accent-800 dark:text-accent-200">
            {draftOutline.length > 0
              ? `Outline: ${draftOutline.length} corner${draftOutline.length === 1 ? "" : "s"} — click the first dot (or Enter) to close`
              : outline.length > 0
                ? `Outline traced (${outline.length} corners). Click any edge to mark it a GABLE (no gutter) — gable edges turn amber.`
                : "Click each corner of the building outline; close the loop to finish."}
          </span>
          {draftOutline.length >= 3 && (
            <button
              type="button"
              className="rounded-md bg-accent-600 px-2.5 py-1 font-semibold text-white hover:bg-accent-700"
              onClick={() => {
                onOutlineChange(draftOutline);
                setDraftOutline([]);
                setCursor(null);
              }}
            >
              Close outline
            </button>
          )}
          {draftOutline.length > 0 && (
            <button
              type="button"
              className={plainBtn}
              onClick={() => setDraftOutline((d) => d.slice(0, -1))}
            >
              <Undo2 size={13} /> Undo corner
            </button>
          )}
          {outline.length > 0 && draftOutline.length === 0 && (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1 font-semibold text-white transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!scalePxPerFt}
                onClick={onApplyOutline}
                title={
                  !scalePxPerFt
                    ? "Set the scale first (the outline edges become priced eaves)"
                    : "Use this outline as the building footprint (rebuilds the roof)"
                }
              >
                <Check size={13} /> Apply as footprint
              </button>
              <button
                type="button"
                className={plainBtn}
                onClick={() => onOutlineChange([])}
              >
                <Trash2 size={13} /> Clear outline
              </button>
            </>
          )}
        </div>
      )}

      {/* Calibration feet input */}
      {tool === "scale" && scalePts.length === 2 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-xs dark:border-accent-800 dark:bg-accent-900/40">
          <span className="font-medium text-accent-800 dark:text-accent-200">
            That line is how many feet?
          </span>
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={feetInput}
            onChange={(e) => setFeetInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitScale()}
            placeholder="e.g. 64"
            className="w-24 rounded-md border border-accent-300 bg-white px-2 py-1 text-zinc-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15 dark:border-accent-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <span className="text-accent-700 dark:text-accent-300">ft</span>
          <button
            type="button"
            className="rounded-md bg-accent-600 px-2.5 py-1 font-semibold text-white hover:bg-accent-700"
            onClick={commitScale}
          >
            Set scale
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 font-medium text-accent-700 hover:underline dark:text-accent-300"
            onClick={() => {
              setScalePts([]);
              setFeetInput("");
            }}
          >
            Clear
          </button>
        </div>
      )}

      <div className="relative min-h-[520px] overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="h-full w-full touch-none select-none"
          style={{
            minHeight: 520,
            cursor:
              tool === "pan"
                ? down.current
                  ? "grabbing"
                  : "grab"
                : "crosshair",
          }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <rect x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H} fill="#ffffff" />
          <PdfPageImage
            pdfUrl={planSource.pdfUrl}
            pageIndex={page}
            onState={setState}
          />

          {/* Committed building outline (closed footprint polygon). Each edge
              is colored EAVE (sky, gutter) or GABLE (amber dashed, rake) so
              the contractor sets which faces get a gutter before applying. */}
          {outline.length >= 2 && (
            <g>
              <polygon
                points={outline.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(20,121,184,0.08)"
                stroke="none"
              />
              {outline.map((p, i) => {
                const q = outline[(i + 1) % outline.length];
                const isGable = gableEdges[i] === true;
                return (
                  <line
                    key={`oe-${i}`}
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    stroke={isGable ? "#f59e0b" : "#1479B8"}
                    strokeWidth={sw * 1.5}
                    strokeDasharray={isGable ? `${sw * 2.5} ${sw * 2}` : undefined}
                    strokeLinecap="round"
                  />
                );
              })}
              {outline.map((p, i) => (
                <circle key={`ov-${i}`} cx={p.x} cy={p.y} r={dot * 0.55} fill="#1479B8" />
              ))}
            </g>
          )}

          {/* In-progress outline trace */}
          {tool === "outline" && draftOutline.length > 0 && (
            <g>
              <polyline
                points={[...draftOutline, ...(cursor ? [cursor] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="none"
                stroke="#1479B8"
                strokeWidth={sw * 1.3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* close-preview back to the first corner */}
              {draftOutline.length >= 2 && cursor && (
                <line
                  x1={cursor.x}
                  y1={cursor.y}
                  x2={draftOutline[0].x}
                  y2={draftOutline[0].y}
                  stroke="#1479B8"
                  strokeWidth={sw}
                  strokeDasharray={`${sw * 2} ${sw * 2}`}
                  opacity={0.5}
                />
              )}
              {draftOutline.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={dot * (i === 0 ? 0.85 : 0.55)}
                  fill={i === 0 ? "#5AA6C6" : "#1479B8"}
                  stroke={i === 0 ? "#ffffff" : undefined}
                  strokeWidth={i === 0 ? dot * 0.2 : 0}
                />
              ))}
            </g>
          )}

          {/* Finished eave runs */}
          {runs.map((r, i) => (
            <g key={i}>
              <line
                x1={r[0].x}
                y1={r[0].y}
                x2={r[1].x}
                y2={r[1].y}
                stroke={i === selected ? "#f43f5e" : "#1479B8"}
                strokeWidth={sw * (i === selected ? 1.6 : 1.2)}
                strokeLinecap="round"
              />
              {scalePxPerFt && (
                <text
                  x={mid(r[0], r[1]).x}
                  y={mid(r[0], r[1]).y - dot * 0.8}
                  fontSize={dot * 1.5}
                  textAnchor="middle"
                  fill="#14688C"
                  stroke="#ffffff"
                  strokeWidth={dot * 0.18}
                  paintOrder="stroke"
                  style={{ fontWeight: 700 }}
                >
                  {runLF(r)!.toFixed(1)} ft
                </text>
              )}
            </g>
          ))}

          {/* In-progress eave (start → cursor) */}
          {tool === "draw" && pendingStart && cursor && (
            <g>
              <line
                x1={pendingStart.x}
                y1={pendingStart.y}
                x2={cursor.x}
                y2={cursor.y}
                stroke="#1479B8"
                strokeWidth={sw * 1.2}
                strokeDasharray={`${sw * 2} ${sw * 2}`}
                strokeLinecap="round"
              />
              <circle cx={pendingStart.x} cy={pendingStart.y} r={dot * 0.6} fill="#1479B8" />
              {scalePxPerFt && (
                <text
                  x={cursor.x + dot}
                  y={cursor.y - dot}
                  fontSize={dot * 1.6}
                  fill="#14688C"
                  stroke="#ffffff"
                  strokeWidth={dot * 0.18}
                  paintOrder="stroke"
                  style={{ fontWeight: 700 }}
                >
                  {(dist(pendingStart, cursor) / scalePxPerFt).toFixed(1)} ft
                </text>
              )}
            </g>
          )}

          {/* Scale calibration markers */}
          {scalePts.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={dot * 0.7}
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth={dot * 0.2}
            />
          ))}
          {tool === "scale" && scalePts.length === 1 && cursor && (
            <line
              x1={scalePts[0].x}
              y1={scalePts[0].y}
              x2={cursor.x}
              y2={cursor.y}
              stroke="#f59e0b"
              strokeWidth={sw}
              strokeDasharray={`${sw * 2} ${sw * 2}`}
            />
          )}
          {scalePts.length === 2 && (
            <line
              x1={scalePts[0].x}
              y1={scalePts[0].y}
              x2={scalePts[1].x}
              y2={scalePts[1].y}
              stroke="#f59e0b"
              strokeWidth={sw}
            />
          )}
        </svg>

        {/* Tool hint */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-100">
          {tool === "scale"
            ? scalePts.length === 0
              ? "Click one end of a known dimension (e.g. the 64'-0\" line)"
              : scalePts.length === 1
                ? "Click the other end"
                : "Enter the length above"
            : tool === "draw"
              ? pendingStart
                ? "Click the eave's end · Esc to cancel"
                : "Click the start of an eave run"
              : tool === "outline"
                ? draftOutline.length > 0
                  ? "Click the next corner · click the first dot (or Enter) to close · Backspace undo"
                  : outline.length > 0
                    ? "Click an edge to toggle EAVE ⇄ GABLE · then Apply as footprint"
                    : "Click each corner of the building outline"
                : "Drag to pan · scroll to zoom · click a run to select"}
        </div>

        {state === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 size={16} className="animate-spin" /> Rendering sheet…
            </span>
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <p className="max-w-sm text-sm text-zinc-500">
              Couldn&apos;t render this sheet. It may be a scanned/raster PDF
              with no rendering layer — try another sheet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
