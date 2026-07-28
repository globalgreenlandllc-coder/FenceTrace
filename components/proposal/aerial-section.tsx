"use client";

import { useMemo, useState } from "react";
import { Pencil, Sparkles, Image as ImageIcon, DraftingCompass, Box } from "lucide-react";
import { lineLengthFt } from "@/components/estimate/aerial-canvas";
import { AerialReadonly } from "@/components/estimate/aerial-shared";
import { GutterDiagram } from "@/components/estimate/gutter-diagram";
import { PresentationCanvas } from "./presentation-canvas";
import dynamic from "next/dynamic";
// The 3D engine sits behind a tab — lazy-load it so the client portal's
// first paint doesn't pay for it.
const Fence3D = dynamic(
  () => import("@/components/fence/fence-3d").then((m) => m.Fence3D),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-[16/10] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
    ),
  },
);
import { GutterSystemBreakdown } from "./gutter-system-breakdown";
import { ManualMeasurementsCard } from "./manual-measurements-card";
import { sampleEaves, sampleDownspouts } from "@/lib/mock-estimate";
import type { Downspout, EditableLine } from "@/lib/types";
import { countCornersAndEnds } from "@/lib/fence/geo";
import type { Proposal } from "@/lib/proposal-mock";
import { SectionHeader } from "./packages-section";

export function AerialSection({
  proposal,
  onChange,
  readOnly,
}: {
  proposal: Proposal;
  /** Provided when the contractor is in builder mode and we want
   *  edits to the eaves/downspouts to flow back into the proposal so
   *  totals + line items recompute. Omit for client-portal preview. */
  onChange?: (p: Proposal) => void;
  readOnly?: boolean;
}) {
  const takeoff = proposal.takeoff;
  const hasRealTakeoff = !!takeoff && takeoff.eaves.length > 0;
  // Tape-measure proposals (/dashboard/measure) have real numbers but no
  // geometry to draw — show the honest field-measurement card instead of
  // the sample cartoon, editable in builder mode so a mis-typed number
  // is fixable right here. A takeoff traced later (edited eaves) wins.
  const isManual = proposal.source === "manual" && !hasRealTakeoff;
  const editable = !readOnly && !!onChange && hasRealTakeoff;
  // Satellite takeoffs get a Photo ⇄ Diagram toggle; the clean drafting
  // sheet is the default deliverable. Plan takeoffs already render as a
  // blueprint diagram inside PresentationCanvas, so no toggle there.
  const isSatellite = !!takeoff?.aerial?.imageDataUrl;
  // Fence proposals add a 3D preview tab — the fence as designed, at the
  // selected package's type/height, visible to the client in the portal.
  const fenceCfg = proposal.packages.find((p) => p.config.fence)?.config.fence;
  // Fence proposals open on the PHOTO — the client's own house with the
  // fence lines drawn on it ("that's my yard") — with Diagram/3D a tap
  // away. Gutter proposals keep the drafting-sheet default.
  const [view, setView] = useState<"diagram" | "photo" | "3d">(
    fenceCfg && isSatellite ? "photo" : "diagram",
  );
  const show3d = !!fenceCfg && hasRealTakeoff && view === "3d";
  const showDiagram = isSatellite && view === "diagram";

  // Recompute total LF from the live edited eaves so the badge stays in
  // sync as the contractor adjusts the trace. NaN-guard each line:
  // a single eave with bad coords (stale analysis predating the
  // projection NaN-safety pass) used to poison the entire sum and
  // produce "NaN LF" in the overlay. Treat bad lines as 0 — the
  // contractor edits them away rather than seeing junk.
  const safeLineLengthFt = (l: EditableLine): number => {
    // Use the satellite trace's own px-per-ft (carried in the takeoff) so
    // editing eaves here re-prices on the same scale the estimate used,
    // not the plan-mode 2.4. Undefined → lineLengthFt falls back to it.
    const v = lineLengthFt(l, takeoff?.canvasPxPerFt);
    return Number.isFinite(v) ? v : 0;
  };
  const liveEaveLF = useMemo(() => {
    if (!takeoff) return proposal.measurements.eaveLF;
    // When ALL eaves got dropped (every gutter_run had bad coords —
    // happens on stored analyses with malformed geometry), the live
    // sum is 0 and the contractor sees a misleading "0 LF" overlay
    // even though measurements.eaveLF is the real number. Fall back
    // to the stored value when nothing summable survived.
    const computed = takeoff.eaves.reduce(
      (acc, l) => acc + safeLineLengthFt(l),
      0,
    );
    return computed > 0
      ? Math.round(computed)
      : proposal.measurements.eaveLF;
  }, [takeoff, proposal.measurements.eaveLF]);

  // Wire canvas edits back into proposal state so /proposal's pricing
  // recomputes off the contractor's tweaks. measurements.eaveLF gets
  // updated so packageTotal() + buildLineItems pick up the new number.
  const handleEavesChange = (next: EditableLine[]) => {
    if (!onChange || !takeoff) return;
    const updatedLF = Math.round(
      next.reduce((acc, l) => acc + safeLineLengthFt(l), 0),
    );
    // Corners recount from the edited geometry (angle-aware — only real
    // turns), so the stat card AND every fence package's corner-post
    // pricing follow the drag, not the stale scan numbers.
    const { corners, ends } = countCornersAndEnds(next);
    onChange({
      ...proposal,
      takeoff: { ...takeoff, eaves: next },
      measurements: {
        ...proposal.measurements,
        eaveLF: updatedLF,
        outsideCorners: corners,
        endCaps: ends,
      },
      packages: proposal.packages.map((p) =>
        p.config.fence
          ? {
              ...p,
              config: {
                ...p.config,
                fence: { ...p.config.fence, corners, ends },
              },
            }
          : p,
      ),
    });
  };

  const handleBuildingsChange = (next: { x: number; y: number }[][]) => {
    if (!onChange || !takeoff) return;
    onChange({ ...proposal, takeoff: { ...takeoff, buildings: next } });
  };

  // Mixed-type stretches picked on the canvas ("this stretch is chain
  // link"): persist the geometry AND fold the footage into every fence
  // tier's config.fence.mixed so the carve-out prices on all packages.
  const handleSectionsChange = (
    next: { a: { x: number; y: number }; b: { x: number; y: number }; type: string; lfFt?: number }[],
  ) => {
    if (!onChange || !takeoff) return;
    const byType = new Map<string, number>();
    for (const sec of next) {
      const lf = Math.max(0, Math.round(sec.lfFt ?? 0));
      if (lf > 0) byType.set(sec.type, (byType.get(sec.type) ?? 0) + lf);
    }
    const mixed = [...byType.entries()].map(([type, lf]) => ({ type, lf }));
    onChange({
      ...proposal,
      takeoff: { ...takeoff, fenceSections: next },
      packages: proposal.packages.map((p) =>
        p.config.fence
          ? {
              ...p,
              config: {
                ...p.config,
                fence: {
                  ...p.config.fence,
                  mixed: mixed.length > 0 ? mixed : undefined,
                },
              },
            }
          : p,
      ),
    });
  };

  const handleDownspoutsChange = (next: Downspout[]) => {
    if (!onChange || !takeoff) return;
    onChange({
      ...proposal,
      takeoff: { ...takeoff, downspouts: next },
      measurements: {
        ...proposal.measurements,
        downspoutCount: next.length,
      },
    });
  };

  if (isManual) {
    return (
      <section data-section="aerial" className="space-y-4">
        <SectionHeader
          title="What we measured"
          sub="Measured on-site with a tape measure — these numbers drive every package price."
        />
        <ManualMeasurementsCard
          measurements={proposal.measurements}
          onChange={
            !readOnly && onChange
              ? (next) => onChange({ ...proposal, measurements: next })
              : undefined
          }
        />
      </section>
    );
  }

  return (
    <section data-section="aerial" className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="What we measured"
          sub={
            hasRealTakeoff
              ? show3d
                ? "The fence as designed, to scale — height, gates and corners exactly as priced."
                : showDiagram
                ? "Fence layout drawn from the satellite image at true scale — fence runs in blue with lengths, numbered gates."
                : editable
                  ? "Live takeoff from the satellite image. Drag any handle to refine — totals update instantly."
                  : "Fence lines and gates traced directly from this property's satellite image."
              : "Sample geometry — connect this proposal to a takeoff to render the real property."
          }
        />
        {isSatellite && hasRealTakeoff && (
          <div className="mt-1 inline-flex shrink-0 rounded-full border border-ink/10 bg-white p-0.5 text-[11px] font-semibold shadow-sm">
            <button
              type="button"
              onClick={() => setView("diagram")}
              className={
                "ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors " +
                (view === "diagram"
                  ? "bg-accent-600 text-white"
                  : "text-ink/55 hover:text-ink")
              }
            >
              <DraftingCompass className="h-3.5 w-3.5" />
              Diagram
            </button>
            <button
              type="button"
              onClick={() => setView("photo")}
              className={
                "ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors " +
                (view === "photo"
                  ? "bg-accent-600 text-white"
                  : "text-ink/55 hover:text-ink")
              }
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Photo
            </button>
            {fenceCfg && (
              <button
                type="button"
                onClick={() => setView("3d")}
                className={
                  "ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors " +
                  (view === "3d"
                    ? "bg-accent-600 text-white"
                    : "text-ink/55 hover:text-ink")
                }
              >
                <Box className="h-3.5 w-3.5" />
                3D
              </button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl">
          {hasRealTakeoff ? (
            show3d ? (
              <Fence3D
                runs={takeoff!.eaves}
                gates={takeoff!.downspouts}
                heightFt={fenceCfg!.heightFt}
                typeId={fenceCfg!.type}
                pxPerFt={takeoff!.canvasPxPerFt}
                runElevationsFt={takeoff!.runElevationsFt}
                elevationSpacingPx={takeoff!.elevationSpacingPx}
                topoGridFt={takeoff!.topoGridFt ?? null}
                buildings={takeoff!.buildings ?? null}
                sections={takeoff!.fenceSections ?? null}
                retainingWall={(fenceCfg!.wallTopLf ?? 0) > 0}
                postUpgrade={fenceCfg!.postUpgrade}
                initialView={takeoff!.view3d}
                className="aspect-[16/10]"
              />
            ) : showDiagram ? (
              <div className="aspect-[16/10]">
                <GutterDiagram
                  eaves={takeoff!.eaves}
                  downspouts={takeoff!.downspouts}
                  pxPerFt={takeoff!.canvasPxPerFt}
                  roofStructure={takeoff!.roofStructure}
                  address={proposal.address}
                  confidence={takeoff!.roofStructure?.confidence}
                  buildings={takeoff!.buildings}
                  // The proposal is the deliverable: perimeter, priced
                  // gutter runs and downspouts only. Working layers
                  // (suggestions, rakes, roof seams) live on /estimate.
                  presentation
                />
              </div>
            ) : (
              <div className="aspect-[16/10]">
                <PresentationCanvas
                  eaves={takeoff!.eaves}
                  // CLIENT-CLEAN photo: the gray-dashed rakes are a
                  // working layer ("no gutter here") for the contractor.
                  // The homeowner's deliverable shows the perimeter,
                  // priced gutter runs and downspouts only — same rule
                  // as the presentation diagram above.
                  rakes={editable ? takeoff!.rakes : []}
                  downspouts={takeoff!.downspouts}
                  roofStructure={takeoff!.roofStructure}
                  onEavesChange={editable ? handleEavesChange : undefined}
                  onDownspoutsChange={editable ? handleDownspoutsChange : undefined}
                  buildings={takeoff!.buildings}
                  onBuildingsChange={editable ? handleBuildingsChange : undefined}
                  fenceSections={fenceCfg ? takeoff!.fenceSections ?? [] : null}
                  onFenceSectionsChange={
                    editable && fenceCfg ? handleSectionsChange : undefined
                  }
                  pxPerFt={takeoff!.canvasPxPerFt}
                  aerialImageUrl={takeoff!.aerial?.imageDataUrl}
                  // Plan-based takeoffs have no satellite image. Switch
                  // the canvas into drafting-paper mode so the gutter
                  // trace reads as an architectural drawing instead of
                  // being painted on top of the cartoon yard scene.
                  planMode={!takeoff!.aerial?.imageDataUrl}
                />
              </div>
            )
          ) : (
            <AerialReadonly
              eaves={sampleEaves}
              downspouts={sampleDownspouts}
              className="aspect-[16/10]"
              theme="tactical"
            />
          )}
          {hasRealTakeoff && !showDiagram && (
            <div className="anim-enter-fade pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-accent-600/90 px-2.5 py-1 text-[10px] font-medium text-white ring-1 ring-inset ring-white/20">
              <Sparkles className="h-3 w-3" />
              Live from the takeoff
            </div>
          )}
          {editable && !showDiagram && (
            <div className="anim-enter-fade stagger-2 pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-medium text-white/85 ring-1 ring-inset ring-white/15">
              <Pencil className="h-3 w-3" />
              Hover a run to drag a corner — totals re-price live
            </div>
          )}
        </div>
        {hasRealTakeoff && (
          <GutterSystemBreakdown
            eaves={takeoff!.eaves}
            rakes={takeoff!.rakes}
            downspouts={takeoff!.downspouts}
            pxPerFt={takeoff!.canvasPxPerFt}
            measurements={{
              ...proposal.measurements,
              eaveLF: liveEaveLF,
            }}
            // Default-feature package (e.g. "Pro Shield") since the
            // proposal model doesn't yet store a selectedPackageId.
            selectedPackageName={proposal.packages[1]?.name}
          />
        )}
      </div>
    </section>
  );
}
