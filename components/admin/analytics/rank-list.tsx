"use client";

import type { RankStat } from "@/app/actions/analytics";
import { compact } from "./format";

/* Generic "top N" card: label · optional sublabel · count, with a share
   meter per row (track + fill from the same accent ramp so state reads
   across the whole bar). Values are always printed — the meter is a
   redundant channel, never the only encoding. */

export function RankList({
  title,
  rows,
  emptyText,
  renderLabel,
}: {
  title: string;
  rows: RankStat[];
  emptyText: string;
  renderLabel?: (row: RankStat) => React.ReactNode;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <section className="surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r, i) => (
            <li key={`${r.label}-${i}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-zinc-700">
                  {renderLabel ? renderLabel(r) : r.label}
                  {r.sublabel && (
                    <span className="ml-1.5 text-xs text-zinc-400">
                      {r.sublabel}
                    </span>
                  )}
                </span>
                <span className="text-sm font-semibold tabular-nums text-zinc-900">
                  {compact(r.count)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent-100">
                <div
                  className="h-full rounded-full bg-accent-400"
                  style={{ width: `${max > 0 ? Math.max(2, (r.count / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
