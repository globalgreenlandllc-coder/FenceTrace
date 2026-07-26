"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import type { DayStat } from "@/app/actions/analytics";

/* ------------------------------------------------------------------ */
/*  Sign-ups — single-series column chart (one hue, slot-1 blue).      */
/*  Columns ≤24px, 4px rounded data-end, square at the baseline, per-  */
/*  mark hover tooltip, integer ticks, and a table view twin.          */
/* ------------------------------------------------------------------ */

const SERIES = "#1479B8";
const GRID = "#ECEAE4";
const AXIS_TEXT = "#a1a1aa";

const H = 224;
const PAD_TOP = 18;
const PAD_BOTTOM = 24;
const PAD_LEFT = 34;
const PAD_RIGHT = 14;

function bucketLabel(iso: string, hourly: boolean): string {
  if (hourly) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Column with a 4px rounded top and a square baseline. */
function columnPath(cx: number, w: number, top: number, bottom: number): string {
  const r = Math.min(4, w / 2, Math.max(0, bottom - top));
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  return [
    `M${x0},${bottom}`,
    `L${x0},${top + r}`,
    `Q${x0},${top} ${x0 + r},${top}`,
    `L${x1 - r},${top}`,
    `Q${x1},${top} ${x1},${top + r}`,
    `L${x1},${bottom}`,
    "Z",
  ].join("");
}

export function SignupsChart({
  series,
  hourly,
}: {
  series: DayStat[];
  hourly: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = series;
  const total = data.reduce((s, d) => s + d.signups, 0);
  const isEmpty = data.length === 0 || total === 0;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const maxVal = Math.max(...data.map((d) => d.signups), 0);
  // Integer ticks: 3 divisions of a whole-number step.
  const step = Math.max(1, Math.ceil(maxVal / 3));
  const yMax = step * 3;
  const ticks = [0, step, step * 2, step * 3];

  const slot = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.min(24, Math.max(3, slot - 2)); // 2px surface gap between neighbors
  const cx = (i: number) => PAD_LEFT + slot * i + slot / 2;
  const y = (v: number) => PAD_TOP + plotH - (yMax > 0 ? (v / yMax) * plotH : 0);
  const baseline = PAD_TOP + plotH;

  const hovered = hover != null ? data[hover] : null;
  const drawKey = `${hourly}:${data.length}:${data[0]?.date ?? ""}`;
  const tipLeft =
    hover != null && width > 0
      ? Math.min(Math.max(cx(hover), PAD_LEFT + 54), width - PAD_RIGHT - 54)
      : 0;

  const xLabels = (() => {
    if (data.length === 0) return [] as { i: number; text: string }[];
    const idx = new Set<number>();
    const slots = Math.min(data.length - 1, 5);
    for (let k = 0; k <= slots; k++) {
      idx.add(Math.round((k * (data.length - 1)) / Math.max(1, slots)));
    }
    return [...idx]
      .sort((a, b) => a - b)
      .map((i) => ({ i, text: bucketLabel(data[i].date, hourly) }));
  })();

  return (
    <section className="surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Sign-ups
        </h3>
        <p className="text-xs text-zinc-500">
          <span className="font-semibold tabular-nums text-zinc-900">{total}</span>{" "}
          in this range
        </p>
      </div>

      <div ref={wrapRef} className="relative mt-4 h-56 w-full">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label="Sign-ups per period"
            className="block"
            style={{ touchAction: "pan-y" }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setHover(null);
            }}
          >
            {ticks.map((t, k) => {
              const gy = PAD_TOP + plotH - (yMax > 0 ? (t / yMax) * plotH : (k / 3) * plotH);
              return (
                <g key={k}>
                  <line
                    x1={PAD_LEFT}
                    x2={width - PAD_RIGHT}
                    y1={gy}
                    y2={gy}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                  {!isEmpty && (
                    <text x={PAD_LEFT - 8} y={gy + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                      {t}
                    </text>
                  )}
                </g>
              );
            })}

            {!isEmpty && (
              <>
                {xLabels.map(({ i, text }) => (
                  <text
                    key={i}
                    x={cx(i)}
                    y={H - 8}
                    textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                    fontSize={10}
                    fill={AXIS_TEXT}
                  >
                    {text}
                  </text>
                ))}

                <motion.g
                  key={`cols:${drawKey}`}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: DUR.entrance, ease: EASE }}
                >
                  {data.map((d, i) =>
                    d.signups > 0 ? (
                      <path
                        key={d.date}
                        d={columnPath(cx(i), barW, y(d.signups), baseline)}
                        fill={SERIES}
                        opacity={hover === null || hover === i ? 1 : 0.45}
                      />
                    ) : null,
                  )}
                </motion.g>

                {/* Full-height hit rects — the hit target is bigger than the mark */}
                {data.map((_, i) => (
                  <rect
                    key={i}
                    x={PAD_LEFT + slot * i}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                    onPointerMove={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                  />
                ))}
              </>
            )}
          </svg>
        )}

        {hovered && !isEmpty && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: tipLeft, top: 4 }}
          >
            <span className="font-semibold text-zinc-900">{hovered.signups}</span>
            <span className="ml-1.5 text-zinc-500">
              {hovered.signups === 1 ? "sign-up" : "sign-ups"} ·{" "}
              {bucketLabel(hovered.date, hourly)}
            </span>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-zinc-400">
              No sign-ups in this range yet.
            </p>
          </div>
        )}
      </div>

      {!isEmpty && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-400 transition-smooth hover:text-zinc-600">
            View data
          </summary>
          <div className="mt-2 max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1 pr-2 font-medium">{hourly ? "Hour" : "Date"}</th>
                  <th className="py-1 text-right font-medium">Sign-ups</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.date} className="border-t border-zinc-100 text-zinc-600">
                    <td className="py-1 pr-2">{bucketLabel(d.date, hourly)}</td>
                    <td className="py-1 text-right tabular-nums">{d.signups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
