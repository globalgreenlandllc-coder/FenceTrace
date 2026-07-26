"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Revenue trend — hand-rolled SVG line chart (no chart lib).         */
/*                                                                     */
/*  Single series: collected payments per day. Line 2px #1479B8 with   */
/*  a 10% area wash, hairline gridlines, 4 clean $ ticks, hover        */
/*  crosshair + tooltip, and a 7d/30d/90d range picker.                */
/* ------------------------------------------------------------------ */

type DayPoint = { date: string; cents: number };
type Range = "7d" | "30d" | "90d";

const RANGES: { id: Range; days: number }[] = [
  { id: "7d", days: 7 },
  { id: "30d", days: 30 },
  { id: "90d", days: 90 },
];

const SERIES = "#1479B8";
const AREA = "rgba(20,121,184,0.10)";
const GRID = "#ECEAE4";
const CROSSHAIR = "#D6D3CC";
const AXIS_TEXT = "#a1a1aa"; // zinc-400

const H = 224; // ~h-56
const PAD_TOP = 18;
const PAD_BOTTOM = 24;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;

function parseUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Compact $ tick: $0 · $750 · $2.5k · $1.2M */
function compactMoney(dollars: number): string {
  if (dollars >= 1_000_000) {
    const v = dollars / 1_000_000;
    return `$${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}M`;
  }
  if (dollars >= 1000) {
    const v = dollars / 1000;
    return `$${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}k`;
  }
  return `$${Math.round(dollars)}`;
}

function fullMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Snap a raw step to a clean 1 / 2 / 2.5 / 5 × 10^k value. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const snapped = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return snapped * mag;
}

export function RevenueTrend({
  daily,
  loading,
}: {
  daily: DayPoint[];
  loading?: boolean;
}) {
  const [range, setRange] = useState<Range>("30d");
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

  // Touch: hover is set on tap and survives the finger lifting (the
  // pointerleave handler below ignores touch pointers), so dismiss the
  // tooltip when the user taps anywhere outside the chart instead.
  useEffect(() => {
    if (hover == null) return;
    const onDocDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [hover]);

  const days = RANGES.find((r) => r.id === range)?.days ?? 30;
  const data = useMemo(() => daily.slice(-days), [daily, days]);
  const isEmpty = data.length === 0 || data.every((d) => d.cents === 0);

  // --- Scales --------------------------------------------------------
  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const maxDollars = Math.max(...data.map((d) => d.cents / 100), 0);
  const step = niceStep(maxDollars / 3);
  const yMax = step * 3;
  const ticks = [0, step, step * 2, step * 3];

  const x = (i: number) =>
    PAD_LEFT + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (cents: number) =>
    PAD_TOP + plotH - (yMax > 0 ? (cents / 100 / yMax) * plotH : 0);

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cents).toFixed(1)}`)
    .join("");
  const areaPath =
    data.length > 1
      ? `${linePath}L${x(data.length - 1).toFixed(1)},${PAD_TOP + plotH}L${x(0).toFixed(1)},${PAD_TOP + plotH}Z`
      : "";

  // --- X labels ------------------------------------------------------
  const xLabels = useMemo(() => {
    if (data.length === 0) return [] as { i: number; text: string }[];
    if (range === "7d") {
      const fmt = new Intl.DateTimeFormat("en-US", {
        weekday: "narrow",
        timeZone: "UTC",
      });
      return data.map((d, i) => ({ i, text: fmt.format(parseUtc(d.date)) }));
    }
    const fmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const idx = new Set<number>();
    for (let k = 0; k <= 5; k++) {
      idx.add(Math.round((k * (data.length - 1)) / 5));
    }
    return [...idx]
      .sort((a, b) => a - b)
      .map((i) => ({ i, text: fmt.format(parseUtc(data[i].date)) }));
  }, [data, range]);

  const tooltipFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [],
  );

  const hovered = hover != null ? data[hover] : null;
  const hoverX = hover != null ? x(hover) : 0;
  const hoverY = hovered ? y(hovered.cents) : 0;
  const lastIdx = data.length - 1;

  // Draw-in replays only when the data window changes (range switch or a
  // fresh payload) — never on hover re-renders, which re-render this SVG.
  const drawKey = `${range}:${data.length}`;

  // Clamp the tooltip inside the plot bounds (est. half-width 58px).
  const tipLeft =
    width > 0
      ? Math.min(Math.max(hoverX, PAD_LEFT + 58), width - PAD_RIGHT - 58)
      : hoverX;
  const tipTop = Math.max(4, hoverY - 52);

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Revenue trend
        </h3>
        <div
          className="inline-flex rounded-lg border border-zinc-200 p-0.5"
          role="tablist"
          aria-label="Chart range"
        >
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={range === r.id}
              onClick={() => {
                setRange(r.id);
                setHover(null);
              }}
              className={cn(
                "transition-smooth ring-focus rounded-md px-2.5 py-1 text-xs font-medium",
                range === r.id
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-4 h-56 w-full">
        {/* Pulse block while the overview data is in flight — the
            "Payments you collect will chart here." copy is reserved for
            the genuinely-empty post-load case. */}
        {loading && <div className="skeleton h-full" />}
        {!loading && width > 0 && (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label="Revenue collected per day"
            className="block"
            // pan-y keeps vertical page scroll working while horizontal
            // scrubbing across the buckets stays with the chart.
            style={{ touchAction: "pan-y" }}
            // Touch pointers are transient — they fire pointerleave the
            // instant the finger lifts, which would kill the tooltip
            // before it can be read. Only mice clear hover on leave.
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setHover(null);
            }}
          >
            {/* Horizontal gridlines only */}
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
                    <text
                      x={PAD_LEFT - 8}
                      y={gy + 3}
                      textAnchor="end"
                      fontSize={10}
                      fill={AXIS_TEXT}
                    >
                      {compactMoney(t)}
                    </text>
                  )}
                </g>
              );
            })}

            {!isEmpty && (
              <>
                {/* X labels */}
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

                {/* Area wash + line — the line hand-draws left→right on
                    load / range change, then the wash fades in under it. */}
                {areaPath && (
                  <motion.path
                    key={`area:${drawKey}`}
                    d={areaPath}
                    fill={AREA}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DUR.slow, ease: EASE, delay: 0.25 }}
                  />
                )}
                <motion.path
                  key={`line:${drawKey}`}
                  d={linePath}
                  fill="none"
                  stroke={SERIES}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={reduceMotion ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />

                {/* Crosshair + hover point */}
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
                    <circle
                      cx={hoverX}
                      cy={hoverY}
                      r={4}
                      fill={SERIES}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  </>
                )}

                {/* Last point: dot + direct label — lands as the line
                    finishes drawing. */}
                <motion.g
                  key={`end:${drawKey}`}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: DUR.slow, ease: EASE, delay: 0.35 }}
                >
                  <circle
                    cx={x(lastIdx)}
                    cy={y(data[lastIdx].cents)}
                    r={4}
                    fill={SERIES}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  <text
                    x={Math.min(x(lastIdx) + 2, width - PAD_RIGHT)}
                    y={Math.max(y(data[lastIdx].cents) - 10, 12)}
                    textAnchor="end"
                    fontSize={11}
                    fontWeight={600}
                    fill="#18181b"
                  >
                    {fullMoney(data[lastIdx].cents)}
                  </text>
                </motion.g>

                {/* Full-height hit rects per x bucket (hover + tap) */}
                {data.map((_, i) => {
                  const x0 = i === 0 ? PAD_LEFT : (x(i - 1) + x(i)) / 2;
                  const x1 =
                    i === lastIdx ? width - PAD_RIGHT : (x(i) + x(i + 1)) / 2;
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

        {/* Tooltip (HTML overlay, clamped to the plot) */}
        {!loading && !isEmpty && hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: tipLeft, top: tipTop }}
          >
            <span className="font-semibold text-zinc-900">
              {fullMoney(hovered.cents)}
            </span>
            <span className="ml-1.5 text-zinc-500">
              {tooltipFmt.format(parseUtc(hovered.date))}
            </span>
          </div>
        )}

        {isEmpty && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-zinc-400">
              Payments you collect will chart here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
