"use client";

import type { FunnelStage } from "@/app/actions/analytics";
import { compact } from "./format";

/* ------------------------------------------------------------------ */
/*  Acquisition funnel — visitor → sign-up → first takeoff → paying.   */
/*  Ordinal ramp of the brand hue (accent 400→700), validated with     */
/*  the dataviz checker (--ordinal): monotone lightness, visible step  */
/*  gaps, light end clears the surface. Counts are printed beside      */
/*  every bar, so color never carries the value alone.                 */
/* ------------------------------------------------------------------ */

const RAMP = ["#5AA6C6", "#2E86AD", "#14688C", "#115673"];

export function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const empty = funnel.every((s) => s.count === 0);
  return (
    <section className="surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        Acquisition funnel
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        From first visit to paying customer, within this range
      </p>

      {empty ? (
        <p className="mt-5 text-sm text-zinc-400">
          The funnel fills in as visitors arrive and sign up.
        </p>
      ) : (
        <ol className="mt-5 space-y-4">
          {funnel.map((stage, i) => (
            <li key={stage.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-zinc-700">
                  {stage.label}
                </span>
                <span className="text-sm tabular-nums text-zinc-500">
                  <span className="font-semibold text-zinc-900">
                    {compact(stage.count)}
                  </span>
                  {stage.pctOfPrev != null && (
                    <span className="ml-2 text-xs">
                      {stage.pctOfPrev}% of previous
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-4 overflow-hidden rounded bg-zinc-50">
                <div
                  className="h-full rounded transition-smooth"
                  style={{
                    width: `${Math.max(stage.count > 0 ? 2 : 0, stage.pctOfTop)}%`,
                    background: RAMP[i] ?? RAMP[RAMP.length - 1],
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-400">{stage.hint}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
