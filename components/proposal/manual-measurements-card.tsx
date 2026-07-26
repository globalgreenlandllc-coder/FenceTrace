"use client";

import { Ruler } from "lucide-react";
import type { Measurements, Stories } from "@/lib/types";

/**
 * "What we measured" body for manually-measured proposals (source:
 * "manual"). There is no takeoff geometry to draw — the contractor
 * walked the site with a tape measure — so instead of the sample
 * scene we show the real field numbers as a stat grid.
 *
 * In builder mode (onChange provided) every stat is directly editable
 * so the contractor can correct a number without leaving the proposal;
 * pricing recomputes live because measurements feed packageTotal. The
 * client portal renders the same grid read-only.
 */
export function ManualMeasurementsCard({
  measurements,
  onChange,
}: {
  measurements: Measurements;
  /** Present in builder mode; omit for the client portal / preview. */
  onChange?: (next: Measurements) => void;
}) {
  const set = (patch: Partial<Measurements>) =>
    onChange?.({ ...measurements, ...patch });

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-card">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-600/90 px-2.5 py-1 text-[10px] font-medium text-white ring-1 ring-inset ring-white/20">
          <Ruler className="h-3 w-3" />
          Measured on-site
        </span>
        <span className="text-xs text-zinc-400">
          Field measurements taken at the property
          {onChange ? " — tap any number to adjust, pricing follows" : ""}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Fence"
          unit="LF"
          value={measurements.eaveLF}
          onChange={onChange && ((v) => set({ eaveLF: v }))}
        />
        <Stat
          label="Gates"
          unit="ea"
          value={measurements.downspoutCount}
          onChange={onChange && ((v) => set({ downspoutCount: v }))}
        />
        <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Stories
          </div>
          {onChange ? (
            <div className="mt-1.5 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
              {([1, 2, 3] as Stories[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set({ stories: s })}
                  className={
                    "transition-smooth ring-focus rounded-md px-2 py-0.5 text-xs font-semibold " +
                    (measurements.stories === s
                      ? "bg-accent-50 text-accent-800"
                      : "text-zinc-500 hover:text-zinc-900")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-zinc-900">
              {measurements.stories}
            </div>
          )}
        </div>
        <Stat
          label="Outside corners"
          unit="ea"
          value={measurements.outsideCorners}
          onChange={onChange && ((v) => set({ outsideCorners: v }))}
        />
        <Stat
          label="Inside corners"
          unit="ea"
          value={measurements.insideCorners}
          onChange={onChange && ((v) => set({ insideCorners: v }))}
        />
        <Stat
          label="End posts"
          unit="ea"
          value={measurements.endCaps}
          onChange={onChange && ((v) => set({ endCaps: v }))}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange?: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        {onChange ? (
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) =>
              onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))
            }
            aria-label={label}
            className="transition-smooth w-16 rounded-md border border-transparent bg-transparent text-xl font-semibold tabular-nums tracking-tight text-zinc-900 outline-none hover:border-zinc-200 focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/15"
          />
        ) : (
          <span className="text-xl font-semibold tabular-nums tracking-tight text-zinc-900">
            {value}
          </span>
        )}
        <span className="text-xs font-medium text-zinc-400">{unit}</span>
      </div>
    </div>
  );
}
