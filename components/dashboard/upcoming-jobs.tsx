"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Upcoming jobs — the next scheduled installs/appointments, merged   */
/*  from job assignments + calendar entries by getOverviewData.        */
/* ------------------------------------------------------------------ */

export type UpcomingJobItem = {
  id: string;
  title: string;
  dateIso: string;
  meta: string;
};

export function UpcomingJobs({
  items,
  loading,
}: {
  items: UpcomingJobItem[];
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        Upcoming jobs
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        Next installs on the calendar
      </p>

      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="anim-enter-fade mt-4 rounded-lg border border-dashed border-zinc-300 p-6 text-center">
          <p className="text-sm text-zinc-500">Nothing scheduled yet.</p>
          <Link
            href="/dashboard/calendar"
            className="transition-smooth ring-focus group mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
          >
            Open the calendar
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>
      ) : (
        <ul className="mt-3">
          {items.map((item, i) => (
            <li
              key={item.id}
              className="anim-enter-fade flex items-center gap-3 border-t border-zinc-100 py-2.5 first:border-t-0"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              {/* Local day-of-month — matches the calendar board, which
                  buckets these same events by local day. */}
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-paper text-sm font-semibold text-zinc-900">
                {new Date(item.dateIso).getDate()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-900">
                  {item.title}
                </div>
                <div className="truncate text-xs text-zinc-500">{item.meta}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
