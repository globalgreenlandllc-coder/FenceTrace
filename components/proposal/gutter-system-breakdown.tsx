"use client";

import { useMemo } from "react";
import {
  ArrowDownToLine,
  CornerUpRight,
  Layers,
  MoveHorizontal,
  Ruler,
} from "lucide-react";
import { lineLengthFt } from "@/components/estimate/aerial-canvas";
import { VIEWBOX_W, VIEWBOX_H } from "@/components/estimate/aerial-shared";
import type { Downspout, EditableLine, Measurements } from "@/lib/types";

/**
 * Compute the centroid of an eave segment in viewBox coords.
 * Used to label runs by their geographic position on the roof.
 */
function eaveCentroid(line: EditableLine): { x: number; y: number } {
  if (line.points.length === 0) return { x: 0, y: 0 };
  const sum = line.points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return {
    x: sum.x / line.points.length,
    y: sum.y / line.points.length,
  };
}

/**
 * Assigns a directional label (Front / Back / Left side / Right side)
 * to an eave based on its position relative to the building's centroid.
 *
 * We use canvas Y as "front (south) ↔ back (north)" and X as "left ↔
 * right" — the convention contractors use when describing a job to the
 * homeowner. Walls are biased to whichever axis has the bigger absolute
 * displacement from the building center, so a long top-edge eave reads
 * "Back" rather than "Back-right".
 */
function labelEaveByPosition(
  line: EditableLine,
  buildingCentroid: { x: number; y: number },
  index: number,
): string {
  const c = eaveCentroid(line);
  const dx = c.x - buildingCentroid.x;
  const dy = c.y - buildingCentroid.y;
  // Treat near-center segments as front by default (most common eave
  // for a small house).
  if (Math.abs(dx) < VIEWBOX_W * 0.05 && Math.abs(dy) < VIEWBOX_H * 0.05) {
    return `Run ${index + 1}`;
  }
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0 ? "Front run" : "Back run";
  }
  return dx >= 0 ? "Right side" : "Left side";
}

/**
 * Dedupes directional labels — if there are two "Front eave" runs, the
 * second becomes "Front eave (2)" so the contractor can refer to either
 * by a unique label in conversation.
 */
function uniquifyLabels(labels: string[]): string[] {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return labels.map((l) => {
    const total = counts.get(l)!;
    if (total === 1) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l} (${n})`;
  });
}

/**
 * Heuristic: count downspouts whose footprint sits on a given eave run.
 * "On" means within ~12 viewBox units of the segment polyline. We don't
 * have explicit run→downspout linkage in the takeoff schema, so this is
 * a positional best-effort — wrong matches are visually obvious to the
 * contractor and can be edited in the canvas above.
 */
function downspoutsOnEave(
  eave: EditableLine,
  downspouts: Downspout[],
): number {
  const NEAR = 14;
  let count = 0;
  for (const d of downspouts) {
    for (let i = 0; i < eave.points.length - 1; i++) {
      const a = eave.points[i];
      const b = eave.points[i + 1];
      if (pointToSegmentDist(d.x, d.y, a.x, a.y, b.x, b.y) <= NEAR) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function GutterSystemBreakdown({
  eaves,
  rakes,
  downspouts,
  measurements,
  selectedPackageName,
  pxPerFt,
}: {
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Downspout[];
  measurements: Measurements;
  selectedPackageName?: string;
  /** Satellite trace's canvas-px-per-foot. Omit for plan takeoffs
   *  (lineLengthFt falls back to PX_PER_FT). */
  pxPerFt?: number;
}) {
  const totalLF = useMemo(
    () =>
      Math.round(
        eaves.reduce((acc, l) => acc + lineLengthFt(l, pxPerFt), 0),
      ),
    [eaves, pxPerFt],
  );

  // Centroid of the building = centroid of all eave centroids. Used to
  // assign Front/Back/Left/Right labels to individual runs.
  const buildingCentroid = useMemo(() => {
    if (eaves.length === 0) return { x: VIEWBOX_W / 2, y: VIEWBOX_H / 2 };
    const centroids = eaves.map(eaveCentroid);
    const s = centroids.reduce(
      (acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }),
      { x: 0, y: 0 },
    );
    return { x: s.x / centroids.length, y: s.y / centroids.length };
  }, [eaves]);

  const runs = useMemo(() => {
    const rawLabels = eaves.map((e, i) =>
      labelEaveByPosition(e, buildingCentroid, i),
    );
    const labels = uniquifyLabels(rawLabels);
    return eaves
      .map((e, i) => ({
        id: e.id,
        label: labels[i],
        lengthFt: Math.round(lineLengthFt(e, pxPerFt)),
        downspoutCount: downspoutsOnEave(e, downspouts),
      }))
      .sort((a, b) => b.lengthFt - a.lengthFt);
  }, [eaves, buildingCentroid, downspouts, pxPerFt]);

  const rakeLF = useMemo(
    () =>
      Math.round(rakes.reduce((acc, l) => acc + lineLengthFt(l, pxPerFt), 0)),
    [rakes, pxPerFt],
  );

  const cornerTotal =
    measurements.outsideCorners + measurements.insideCorners;
  const longestRunFt = runs.length > 0 ? runs[0].lengthFt : 0;
  const avgRunFt = runs.length > 0 ? Math.round(totalLF / runs.length) : 0;
  const downspoutsPerLF = downspouts.length > 0
    ? Math.round(totalLF / downspouts.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          icon={Ruler}
          label="Fence total"
          value={`${totalLF} LF`}
          sub={`across ${runs.length} run${runs.length === 1 ? "" : "s"}`}
        />
        <Stat
          icon={ArrowDownToLine}
          label="Gates"
          value={`${downspouts.length}`}
          sub={
            downspoutsPerLF > 0
              ? `one per ${downspoutsPerLF} LF`
              : "no gates placed yet"
          }
        />
        {/* Fence corners (run-meets-run), not outline corners — unfenced
            edges suppress theirs, so the count reads lower than the drawn
            outline's corner count on purpose. */}
        <Stat
          icon={CornerUpRight}
          label="Corners"
          value={`${cornerTotal}`}
          sub={`${measurements.outsideCorners} outside · ${measurements.insideCorners} inside`}
        />
        <Stat
          icon={MoveHorizontal}
          label="Longest run"
          value={`${longestRunFt} ft`}
          sub={avgRunFt > 0 ? `avg ${avgRunFt} ft per run` : "no runs yet"}
        />
      </div>

      {runs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
            <div className="font-label flex items-center gap-2 text-[11px] text-zinc-500">
              <Layers className="h-3.5 w-3.5 text-zinc-400" />
              Fence runs
            </div>
            {selectedPackageName && (
              <div className="text-[11px] text-zinc-500">
                Spec: <span className="font-medium text-zinc-700">{selectedPackageName}</span>
              </div>
            )}
          </div>
          <ul className="divide-y divide-zinc-100">
            {runs.map((r, i) => {
              const pct = totalLF > 0 ? (r.lengthFt / totalLF) * 100 : 0;
              return (
                <li
                  key={r.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-sm transition-smooth hover:bg-zinc-50/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-zinc-900">
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-zinc-100 px-1 text-[10px] font-semibold tabular-nums text-zinc-600">
                        {i + 1}
                      </span>
                      {r.label}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="anim-grow-x h-full rounded-full bg-accent-500"
                        style={{
                          width: `${pct}%`,
                          animationDelay: `${Math.min(i, 8) * 50}ms`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-zinc-900">
                    {r.lengthFt} ft
                  </div>
                  <div
                    className={
                      "shrink-0 text-[11px] " +
                      (r.downspoutCount > 0
                        ? "text-emerald-700"
                        : "text-zinc-400")
                    }
                  >
                    {r.downspoutCount > 0 ? (
                      <span className="inline-flex items-center gap-0.5">
                        <ArrowDownToLine className="h-3 w-3" />
                        {r.downspoutCount}
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/40 px-4 py-2 text-xs">
            <div className="text-zinc-500">
              <span className="font-medium text-zinc-700">{measurements.stories}-story</span>
              {" · "}
              <span>{measurements.wasteFactorPct}% waste factor</span>
              {rakeLF > 0 && (
                <>
                  {" · "}
                  <span>{rakeLF} LF unfenced</span>
                </>
              )}
              {avgRunFt > 0 && (
                <>
                  {" · "}
                  <span>avg {avgRunFt} ft/run</span>
                </>
              )}
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
              Total {totalLF} ft
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Ruler;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 transition-smooth hover:border-accent-300 hover:shadow-sm">
      <div className="font-label flex items-center gap-1.5 text-[10px] text-zinc-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-zinc-900">
        {value}
      </div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

