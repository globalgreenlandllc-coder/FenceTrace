"use client";

import { useMemo } from "react";
import { Info, PencilRuler, Ruler, Layers } from "lucide-react";

import { PdfPageImage } from "./pdf-page-image";
import { lineLengthFt } from "./aerial-shared";
import { VIEWBOX_W, VIEWBOX_H } from "./aerial-constants";
import type { EditableLine, EaveSide } from "@/lib/types";

/**
 * "Elevations" view — the contractor's request: show the roof from the SIDE
 * (the architect's real elevation drawings) instead of only the derived
 * top-down schematic, and read the gutters off each side.
 *
 * On an elevation the gutter call is unambiguous to the eye: a HORIZONTAL
 * roof edge is an eave (a gutter hangs there); a SLOPED edge or a "^" gable
 * peak sheds water (no gutter). So this view pairs the REAL side drawings
 * (auto-found from the classifier's elevation sheets) with a PER-SIDE gutter
 * breakdown computed from the current takeoff — so a side that's drawn as a
 * gable end but still shows gutter LF (the classic East/West mis-read) jumps
 * out, and the contractor fixes it on the Roof plan in two clicks
 * ("No gutter (gable)") or traces it exactly via the Plan-sheet jump.
 *
 * Deliberately does NOT auto-extract eave/rake geometry from the elevation
 * vector layer: an elevation is full of OTHER horizontal lines (dimension
 * lines, "UPPER PLATE"/"MAIN SUBFLOOR" datums, siding courses, window heads,
 * the grade line) that a naive "topmost flat edge = gutter" reader would
 * gutter by mistake. So we show the real drawing + the data we trust, and let
 * the human read the roofline — which is exactly what an elevation is for.
 */

type Sheet = {
  pageIndex: number;
  label: string;
  sheetType?: string;
  elevationSide?: string;
};

type Side = "front" | "back" | "left" | "right";

const SIDES: { side: Side; label: string }[] = [
  { side: "front", label: "Front" },
  { side: "back", label: "Back" },
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
];

// The classifier tags each elevation by COMPASS face; the drawings title
// them FRONT/NORTH, REAR/SOUTH, LEFT/EAST, RIGHT/WEST — so map accordingly.
const COMPASS_TO_SIDE: Record<string, Side> = {
  north: "front",
  south: "back",
  east: "left",
  west: "right",
};
const SIDE_LABEL: Record<Side, string> = {
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
};

function sideOfSheet(s: Sheet): Side | null {
  const c = (s.elevationSide ?? "").toLowerCase();
  if (c in COMPASS_TO_SIDE) return COMPASS_TO_SIDE[c];
  // Fall back to words in the label ("Elevation (FRONT/NORTH ...)").
  const L = s.label.toUpperCase();
  if (/\b(FRONT|NORTH)\b/.test(L)) return "front";
  if (/\b(REAR|BACK|SOUTH)\b/.test(L)) return "back";
  if (/\b(LEFT|EAST)\b/.test(L)) return "left";
  if (/\b(RIGHT|WEST)\b/.test(L)) return "right";
  return null;
}

export function ElevationsView({
  planSource,
  eaves,
  rakes,
  pxPerFt,
  onTraceSheet,
}: {
  planSource: {
    pdfUrl: string;
    pageIndex: number;
    pageCount?: number;
    sheets?: Sheet[];
  };
  eaves: EditableLine[];
  rakes: EditableLine[];
  /** Canvas px-per-foot, for the per-side LF readout (same basis the
   *  Roof plan + pricing use, so the numbers match). Optional — falls back
   *  to the default scale inside lineLengthFt. */
  pxPerFt?: number;
  /** Jump to the Plan-sheet trace tool on a given page (exact takeoff). */
  onTraceSheet: (pageIndex: number) => void;
}) {
  const elevationSheets = useMemo(
    () => (planSource.sheets ?? []).filter((s) => s.sheetType === "elevation"),
    [planSource.sheets],
  );

  // Per-side gutter breakdown from the current takeoff. This is the part the
  // user is verifying against the drawings: does each side's gutter call
  // match what the elevation actually shows?
  const perSide = useMemo(() => {
    const has = (arr: EditableLine[], side: Side) =>
      arr.some((l) => l.side === side);
    return SIDES.map(({ side, label }) => {
      const e = eaves.filter((l) => l.side === side);
      const lf = Math.round(
        e.reduce((a, l) => a + (lineLengthFt(l, pxPerFt) || 0), 0),
      );
      return {
        side,
        label,
        runs: e.length,
        lf,
        hasGutter: lf > 0,
        hasGable: has(rakes, side),
      };
    });
  }, [eaves, rakes, pxPerFt]);

  const anySideData = perSide.some((p) => p.hasGutter || p.hasGable);

  return (
    <div className="space-y-3">
      {/* How-to + per-side gutter breakdown */}
      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            Read the gutters straight off each side: a{" "}
            <span className="font-semibold text-accent-600 dark:text-accent-300">
              flat (horizontal) roof edge
            </span>{" "}
            carries a gutter; a{" "}
            <span className="font-semibold text-zinc-500">
              sloped edge or a gable peak
            </span>{" "}
            does not. Compare each side&apos;s drawing below to its gutter
            count. If a side is drawn as a gable end but still shows gutter LF,
            open <span className="font-medium">Roof plan</span>, select that eave
            and hit <span className="font-medium">&ldquo;No gutter
            (gable)&rdquo;</span> — or trace it exactly from its sheet.
          </p>
        </div>

        {anySideData && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {perSide.map((p, i) => {
              // A side that the takeoff marks as a gable (rake) and gutters
              // is the suspicious case — flag it so the eye lands there.
              const conflicted = p.hasGutter && p.hasGable;
              return (
                <div
                  key={p.side}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={
                    "anim-enter-fade rounded-lg border p-2 " +
                    (conflicted
                      ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
                      : p.hasGutter
                        ? "border-accent-200 bg-accent-50/60 dark:border-accent-800/50 dark:bg-accent-900/20"
                        : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40")
                  }
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {p.label}
                  </div>
                  {p.hasGutter ? (
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-accent-700 dark:text-accent-300">
                      {p.lf} LF
                      <span className="ml-1 text-[10px] font-normal text-zinc-500">
                        {p.runs} run{p.runs === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : p.hasGable ? (
                    <div className="mt-0.5 text-xs font-medium text-zinc-500">
                      Gable end · no gutter
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-zinc-400">—</div>
                  )}
                  {conflicted && (
                    <div className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      gutter + gable — verify
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The real side-elevation drawings */}
      {elevationSheets.length === 0 ? (
        <div className="anim-enter-fade rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          <Layers className="mx-auto mb-2 h-5 w-5 text-zinc-400" />
          No elevation sheets were identified in this plan set. Open the{" "}
          <span className="font-medium">Plan sheet</span> tab and pick the
          elevation pages from the sheet selector to read the rooflines.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {elevationSheets.map((s, i) => {
            const side = sideOfSheet(s);
            return (
              <div
                key={s.pageIndex}
                style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                className="anim-enter overflow-hidden rounded-xl border border-zinc-200 bg-white transition-smooth hover:border-zinc-300 hover:shadow-card dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <div className="flex items-center gap-2 text-xs">
                    <Ruler className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {side ? SIDE_LABEL[side] : "Elevation"} · page{" "}
                      {s.pageIndex}
                    </span>
                    <span className="text-zinc-400">{s.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTraceSheet(s.pageIndex)}
                    className="ring-focus inline-flex items-center gap-1 rounded-md border border-accent-300 bg-accent-50 px-2 py-1 text-[11px] font-semibold text-accent-700 transition-smooth hover:border-accent-400 hover:bg-accent-100 active:scale-[0.98] dark:border-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
                    title="Open this elevation in the trace tool — set scale, then draw the gutter eaves on the real drawing"
                  >
                    <PencilRuler className="h-3 w-3" />
                    Trace gutters here
                  </button>
                </div>
                <svg
                  viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
                  className="block w-full bg-white"
                  style={{ aspectRatio: `${VIEWBOX_W} / ${VIEWBOX_H}` }}
                >
                  <rect
                    x={0}
                    y={0}
                    width={VIEWBOX_W}
                    height={VIEWBOX_H}
                    fill="#ffffff"
                  />
                  <PdfPageImage pdfUrl={planSource.pdfUrl} pageIndex={s.pageIndex} />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
