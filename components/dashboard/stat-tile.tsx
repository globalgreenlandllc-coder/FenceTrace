"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Interpolate the first number inside a formatted value ("$1,234", "3")
 *  toward its final magnitude, preserving prefix/suffix/decimals. */
function countedValue(value: string, progress: number): string {
  if (progress >= 1) return value;
  const m = value.match(/-?[\d,]+(?:\.\d+)?/);
  if (!m || m.index === undefined) return value;
  const raw = m[0];
  const target = parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(target)) return value;
  const decimals = (raw.split(".")[1] ?? "").length;
  const counted = (target * progress).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value.slice(0, m.index) + counted + value.slice(m.index + raw.length);
}

/**
 * KPI tile — each tile is its own white card. Pages compose them in a
 * `grid gap-4 sm:grid-cols-2 xl:grid-cols-4` row (see the Overview page).
 */
export function StatTile({
  label,
  value,
  footnote,
  delta,
  index = 0,
  loading = false,
}: {
  label: string;
  value: string;
  footnote?: string;
  delta?: { text: string; positive: boolean };
  index?: number;
  /** Pulse-skeleton state while the overview data is in flight. */
  loading?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // Count-up runs ONLY when the tile mounted as a skeleton and the value
  // then arrived client-side — never from a hydration-rendered number.
  const sawLoading = useRef(loading);
  const started = useRef(false);
  const [progress, setProgress] = useState(loading ? 0 : 1);
  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    if (!sawLoading.current || reduceMotion) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 600, 1);
      setProgress(1 - Math.pow(1 - p, 3)); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loading, reduceMotion]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton mt-2 h-8 w-28" />
      </div>
    );
  }
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="transition-smooth rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card hover:shadow-elevated"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          {label}
        </div>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold",
              delta.positive ? "text-emerald-700" : "text-rose-600",
            )}
          >
            {delta.positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-2 text-[30px] font-semibold tracking-tight tabular-nums text-zinc-900">
        {countedValue(value, progress)}
      </div>
      {footnote && <div className="mt-1 text-xs text-zinc-400">{footnote}</div>}
    </motion.div>
  );
}
