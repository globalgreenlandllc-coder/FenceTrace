"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ScanLine } from "lucide-react";
import { GutterDiagram } from "@/components/estimate/gutter-diagram";
import { AerialReadonly } from "@/components/estimate/aerial-shared";
import { EXAMPLE_SCAN } from "@/components/landing2/example-scan-data";
import { cn } from "@/lib/utils";

/**
 * A pre-baked, contractor-verified scan shown inline in the landing teaser —
 * full numbers, real aerial photo, priced. Zero API spend and instant, unlike a
 * live teaser scan (which stays redacted so visitors sign up to see their
 * own). Renders nothing until scripts/export-landing-example.mts has baked
 * real data into example-scan-data.ts.
 */
export function ExampleScanPanel({
  onScanYourOwn,
}: {
  /** Focus the address input so "now scan yours" is one keystroke away. */
  onScanYourOwn: () => void;
}) {
  const [view, setView] = useState<"photo" | "diagram">(
    EXAMPLE_SCAN?.aerialUrl ? "photo" : "diagram",
  );
  if (!EXAMPLE_SCAN) return null;
  const ex = EXAMPLE_SCAN;

  const money = `$${Math.round(ex.estimateTotalCents / 100).toLocaleString("en-US")}`;

  return (
    <div className="anim-enter-fade mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-600">
          <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="truncate">
            <span className="font-semibold text-zinc-900">{ex.address}</span>
            {" — "}measured from satellite imagery, fence lines verified by a
            contractor.
          </span>
        </p>
        {ex.aerialUrl && (
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
            {(
              [
                { id: "photo", label: "Aerial photo" },
                { id: "diagram", label: "Diagram" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className={cn(
                  "transition-smooth ring-focus rounded-full px-3 py-1 text-xs font-semibold",
                  view === t.id
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 aspect-[16/10] overflow-hidden rounded-2xl">
        {view === "photo" && ex.aerialUrl ? (
          <AerialReadonly
            eaves={ex.eaves}
            downspouts={ex.downspouts}
            imageDataUrl={ex.aerialUrl}
            className="h-full"
          />
        ) : (
          <GutterDiagram
            eaves={ex.eaves}
            rakes={ex.rakes}
            downspouts={ex.downspouts}
            roofStructure={ex.roofStructure}
            pxPerFt={ex.canvasPxPerFt}
            address={ex.address}
            presentation
          />
        )}
      </div>

      {/* Real numbers — the whole point of the example vs a redacted teaser. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {[
          `${ex.stats.eaveLF} LF of fence`,
          `${ex.stats.downspoutCount} gates`,
          `${ex.stats.corners} corners`,
          `${ex.stats.stories} ${ex.stats.stories === 1 ? "story" : "stories"}`,
        ].map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600"
          >
            {chip}
          </span>
        ))}
        {ex.estimateTotalCents > 0 && (
          <span className="rounded-full bg-accent-600 px-2.5 py-1 text-xs font-bold text-white">
            {money} estimate
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-sm text-zinc-600">
          Measured, priced, and proposal-ready in about a minute — this is what
          your customer sees.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onScanYourOwn}
            className="press-scale ring-focus inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-[14px] font-semibold text-zinc-800 transition-smooth hover:border-accent-400 hover:text-accent-700"
          >
            <ScanLine className="h-4 w-4" />
            Scan your own — free
          </button>
          <Link
            href="/sign-up?utm_source=example-scan"
            className="press-scale ring-focus inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-[14px] font-semibold text-white transition-smooth hover:bg-zinc-800"
          >
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
