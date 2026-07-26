"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import type { DayStat } from "@/app/actions/analytics";
import { compact } from "./format";

/* ------------------------------------------------------------------ */
/*  Traffic trend — sessions (the point, brand chart blue) with        */
/*  pageviews as context in the de-emphasis gray. One shared count     */
/*  axis, hairline grid, crosshair tooltip reading both series, and a  */
/*  table view twin so no value is gated behind hover.                 */
/*  Palette validated: #1479B8 passes all categorical checks on white. */
/* ------------------------------------------------------------------ */

const SESSIONS = "#1479B8";
const SESSIONS_AREA = "rgba(20,121,184,0.10)";
const PAGEVIEWS = "#a1a1aa"; // context series — de-emphasis gray
const GRID = "#ECEAE4";
const CROSSHAIR = "#D6D3CC";
const AXIS_TEXT = "#a1a1aa";

const H = 224;
const PAD_TOP = 18;
const PAD_BOTTOM = 24;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const snapped = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.max(1, snapped * mag);
}

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

export function TrafficChart({
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

  useEffect(() => {
    if (hover == null) return;
    const onDocDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [hover]);

  const data = series;
  const isEmpty = data.length === 0 || data.every((d) => d.pageviews === 0 && d.sessions === 0);

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const maxVal = Math.max(...data.map((d) => Math.max(d.sessions, d.pageviews)), 0);
  const step = niceStep(maxVal / 3);
  const yMax = step * 3;
  const ticks = [0, step, step * 2, step * 3];

  const x = (i: number) =>
    PAD_LEFT + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD_TOP + plotH - (yMax > 0 ? (v / yMax) * plotH : 0);

  const pathFor = (pick: (d: DayStat) => number) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`)
      .join("");
  const sessionsPath = pathFor((d) => d.sessions);
  const pageviewsPath = pathFor((d) => d.pageviews);
  const areaPath =
    data.length > 1
      ? `${sessionsPath}L${x(data.length - 1).toFixed(1)},${PAD_TOP + plotH}L${x(0).toFixed(1)},${PAD_TOP + plotH}Z`
      : "";

  const xLabels = useMemo(() => {
    if (data.length === 0) return [] as { i: number; text: string }[];
    const idx = new Set<number>();
    const slots = Math.min(data.length - 1, 5);
    for (let k = 0; k <= slots; k++) {
      idx.add(Math.round((k * (data.length - 1)) / Math.max(1, slots)));
    }
    return [...idx]
      .sort((a, b) => a - b)
      .map((i) => ({ i, text: bucketLabel(data[i].date, hourly) }));
  }, [data, hourly]);

  const hovered = hover != null ? data[hover] : null;
  const hoverX = hover != null ? x(hover) : 0;
  const lastIdx = data.length - 1;
  const drawKey = `${hourly}:${data.length}:${data[0]?.date ?? ""}`;

  const tipLeft =
    width > 0 ? Math.min(Math.max(hoverX, PAD_LEFT + 70), width - PAD_RIGHT - 70) : hoverX;

  return (
    <section className="surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Traffic
        </h3>
        {/* Legend — two series, always present */}
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: SESSIONS }} />
            Sessions
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: PAGEVIEWS }} />
            Pageviews
          </span>
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-4 h-56 w-full">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label="Sessions and pageviews per period"
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
                      {compact(t)}
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
                    x={x(i)}
                    y={H - 8}
                    textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
                    fontSize={10}
                    fill={AXIS_TEXT}
                  >
                    {text}
                  </text>
                ))}

                {areaPath && (
                  <motion.path
                    key={`area:${drawKey}`}
                    d={areaPath}
                    fill={SESSIONS_AREA}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DUR.slow, ease: EASE, delay: 0.25 }}
                  />
                )}
                <motion.path
                  key={`pv:${drawKey}`}
                  d={pageviewsPath}
                  fill="none"
                  stroke={PAGEVIEWS}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={reduceMotion ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />
                <motion.path
                  key={`sess:${drawKey}`}
                  d={sessionsPath}
                  fill="none"
                  stroke={SESSIONS}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={reduceMotion ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />

                {hovered && (
                  <>
                    <line
                      x1={hoverX}
                      x2={hoverX}
                      y1={PAD_TOP}
                      y2={PAD_TOP + plotH}
                      stroke={CROSSHAIR}
                      strokeWidth={1}
                    />
                    <circle cx={hoverX} cy={y(hovered.pageviews)} r={4} fill={PAGEVIEWS} stroke="#fff" strokeWidth={2} />
                    <circle cx={hoverX} cy={y(hovered.sessions)} r={4} fill={SESSIONS} stroke="#fff" strokeWidth={2} />
                  </>
                )}

                {data.map((_, i) => {
                  const x0 = i === 0 ? PAD_LEFT : (x(i - 1) + x(i)) / 2;
                  const x1 = i === lastIdx ? width - PAD_RIGHT : (x(i) + x(i + 1)) / 2;
                  return (
                    <rect
                      key={i}
                      x={x0}
                      y={0}
                      width={Math.max(0, x1 - x0)}
                      height={H}
                      fill="transparent"
                      onPointerEnter={() => setHover(i)}
                      onPointerMove={() => setHover(i)}
                      onPointerDown={() => setHover(i)}
                    />
                  );
                })}
              </>
            )}
          </svg>
        )}

        {hovered && !isEmpty && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: tipLeft, top: 4 }}
          >
            <p className="text-zinc-500">{bucketLabel(hovered.date, hourly)}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: SESSIONS }} />
              <span className="font-semibold text-zinc-900">{hovered.sessions}</span>
              <span className="text-zinc-500">sessions</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: PAGEVIEWS }} />
              <span className="font-semibold text-zinc-900">{hovered.pageviews}</span>
              <span className="text-zinc-500">pageviews</span>
            </p>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-zinc-400">
              Visits will chart here as people open FenceTrace.
            </p>
          </div>
        )}
      </div>

      {/* Table view twin — every charted value, reachable without hover */}
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
                  <th className="py-1 pr-2 text-right font-medium">Sessions</th>
                  <th className="py-1 pr-2 text-right font-medium">Pageviews</th>
                  <th className="py-1 text-right font-medium">Sign-ups</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.date} className="border-t border-zinc-100 text-zinc-600">
                    <td className="py-1 pr-2">{bucketLabel(d.date, hourly)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{d.sessions}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{d.pageviews}</td>
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
