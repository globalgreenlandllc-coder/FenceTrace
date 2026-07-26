"use client";

import { AerialReadonly } from "@/components/estimate/aerial-shared";
import { cn } from "@/lib/utils";
import type { WorkerRoofSnapshot } from "@/lib/worker-dto";

/** Read-only fence layout for a worker — runs + gates traced for the job.
 *  Never editable, never shows price. */
export function WorkerRoof({ roof, className }: { roof: WorkerRoofSnapshot | null; className?: string }) {
  const t = roof?.takeoff;
  const hasRoof = !!t && Array.isArray(t.eaves) && t.eaves.length > 0;
  if (!hasRoof) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-400",
          className,
        )}
      >
        No fence layout attached to this job
      </div>
    );
  }
  return (
    <AerialReadonly
      eaves={t!.eaves}
      downspouts={t!.downspouts ?? []}
      imageDataUrl={t!.aerial?.imageDataUrl}
      theme="tactical"
      className={className}
    />
  );
}
