"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  This week — Sun→Sat strip of the current week with event chips.    */
/*  Day buckets arrive from getOverviewData keyed by the viewer's      */
/*  LOCAL calendar day (the page passes the browser timezone through). */
/* ------------------------------------------------------------------ */

export type WeekDay = {
  date: string; // yyyy-mm-dd (viewer-local calendar day)
  count: number;
  firstTitle: string | null;
};

function parseUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** yyyy-mm-dd of a Date's LOCAL calendar day (never UTC — the strip
 *  must agree with the local-time eyebrow above it). */
function localDayKey(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Sun..Sat of the current LOCAL week with no events — pre-load fallback. */
function emptyWeek(): WeekDay[] {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => ({
    date: localDayKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + i),
    ),
    count: 0,
    firstTitle: null,
  }));
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});
const MONTH_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function WeekStrip({ days }: { days: WeekDay[] }) {
  const week = days.length === 7 ? days : emptyWeek();
  // Local calendar day, NOT toISOString (UTC) — otherwise every US
  // evening the "today" ring circles tomorrow's number.
  const todayKey = localDayKey(new Date());

  const first = parseUtc(week[0].date);
  const last = parseUtc(week[6].date);
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();
  const rangeLabel = sameMonth
    ? `${MONTH_DAY_FMT.format(first)} – ${last.getUTCDate()}`
    : `${MONTH_DAY_FMT.format(first)} – ${MONTH_DAY_FMT.format(last)}`;

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            This week
          </h3>
          <span className="text-xs text-zinc-400">{rangeLabel}</span>
        </div>
        <Link
          href="/dashboard/calendar"
          className="transition-smooth ring-focus group inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
        >
          Calendar
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {week.map((d, i) => {
          const date = parseUtc(d.date);
          const isToday = d.date === todayKey;
          return (
            <div key={d.date} className="min-w-0 text-center">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                {WEEKDAY_FMT.format(date).slice(0, 3)}
              </div>
              <div className="mt-1.5 flex justify-center">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center text-sm font-medium",
                    isToday
                      ? "anim-pop rounded-full bg-accent-700 text-white"
                      : "text-zinc-700",
                  )}
                >
                  {date.getUTCDate()}
                </span>
              </div>
              <div className="mt-1.5 h-5">
                {d.count > 0 && (
                  <span
                    className="anim-enter-fade block truncate rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-800"
                    style={{ animationDelay: `${i * 40}ms` }}
                    title={d.firstTitle ?? undefined}
                  >
                    {d.count > 1 ? `+${d.count}` : d.firstTitle}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
