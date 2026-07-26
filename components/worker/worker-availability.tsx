"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  listMyAvailability,
  setMyAvailability,
  type AvailabilityDayStatus,
} from "@/app/actions/availability";
import { cn } from "@/lib/utils";
import { dayKey } from "@/lib/day-key";

/**
 * Tap-to-toggle month grid the crew member uses to tell their contractor(s)
 * which days they work. Tapping a day cycles: unmarked → Available →
 * Unavailable → unmarked. The contractor sees these colors live on their
 * scheduling calendar and books accordingly.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthGridStart(anchor: Date): Date {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const day = first.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-first
  first.setDate(first.getDate() + diff);
  first.setHours(0, 0, 0, 0);
  return first;
}

const NEXT_STATUS: Record<string, AvailabilityDayStatus | null> = {
  none: "AVAILABLE",
  AVAILABLE: "UNAVAILABLE",
  UNAVAILABLE: null,
};

export function WorkerAvailability() {
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [days, setDays] = useState<Map<string, AvailabilityDayStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingDay, setSavingDay] = useState<string | null>(null);

  const gridStart = useMemo(() => monthGridStart(anchor), [anchor]);
  const cells = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [gridStart],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const end = new Date(gridStart);
    end.setDate(end.getDate() + 42);
    const rows = await listMyAvailability(gridStart.toISOString(), end.toISOString());
    setDays(new Map(rows.map((r) => [r.date, r.status])));
    setLoading(false);
  }, [gridStart]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(d: Date) {
    const key = dayKey(d);
    const current = days.get(key) ?? "none";
    const next = NEXT_STATUS[current];
    // Optimistic — the tap should feel instant.
    setDays((prev) => {
      const out = new Map(prev);
      if (next === null) out.delete(key);
      else out.set(key, next);
      return out;
    });
    setSavingDay(key);
    const r = await setMyAvailability(key, next);
    setSavingDay(null);
    if (!r.ok) refresh();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = anchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="surface overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-zinc-200/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">My availability</h2>
          <p className="text-xs text-zinc-500">
            Tap a day: once = available, twice = off. Your contractor sees this
            when scheduling you.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))
            }
            aria-label="Previous month"
            className="transition-smooth ring-focus press-scale flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-32 text-center text-sm font-medium text-ink">
            {monthLabel}
          </span>
          <button
            onClick={() =>
              setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))
            }
            aria-label="Next month"
            className="transition-smooth ring-focus press-scale flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50/60">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-1 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-400"
          >
            {w}
          </div>
        ))}
      </div>

      <div className={cn("grid grid-cols-7", loading && "opacity-60")}>
        {cells.map((d) => {
          const key = dayKey(d);
          const status = days.get(key) ?? null;
          const inMonth = d.getMonth() === anchor.getMonth();
          const isPast = d < today;
          const isToday = d.getTime() === today.getTime();
          return (
            <button
              key={key}
              onClick={() => !isPast && toggle(d)}
              disabled={isPast}
              className={cn(
                "transition-smooth relative flex h-14 flex-col items-center justify-center gap-0.5 border-b border-l border-zinc-100 text-sm first:border-l-0 [&:nth-child(7n+1)]:border-l-0",
                !inMonth && "bg-zinc-50/60",
                isPast
                  ? "cursor-default text-zinc-300"
                  : "hover:bg-zinc-50 active:scale-[0.97]",
                status === "AVAILABLE" && !isPast && "bg-emerald-50 hover:bg-emerald-100",
                status === "UNAVAILABLE" && !isPast && "bg-rose-50 hover:bg-rose-100",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  isToday && "bg-accent-600 text-white",
                  !isToday && (inMonth ? "text-zinc-800" : "text-zinc-400"),
                  isPast && "text-zinc-300",
                )}
              >
                {d.getDate()}
              </span>
              {savingDay === key ? (
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
              ) : status === "AVAILABLE" ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : status === "UNAVAILABLE" ? (
                <Ban className="h-3 w-3 text-rose-500" />
              ) : (
                <span className="h-3 w-3" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 px-4 py-2.5 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Off
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" /> Not set
        </span>
      </div>
    </div>
  );
}
