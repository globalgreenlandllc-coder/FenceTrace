"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE, fadeInUp, staggerContainer } from "@/lib/motion";
import {
  AlertTriangle,
  Building2,
  PencilRuler,
  RefreshCcw,
  Ruler,
  Sparkles,
} from "lucide-react";
import { TopBar } from "./top-bar";
import { AerialCanvas, lineLengthFt } from "./aerial-canvas";
import { GutterDiagram } from "./gutter-diagram";
import { Massing3D } from "./massing-3d";
import { PdfPlanView } from "./pdf-plan-view";
import { ElevationsView } from "./elevations-view";
import { PricingPanel } from "./pricing-panel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EditableLine, Measurements } from "@/lib/types";
import type { EstimateResult } from "@/lib/ai";
import type { EstimateHandoff } from "@/lib/estimate-handoff";

export function ResultsView({
  address,
  initial,
  reused,
  jobType = "replacement",
  planId,
}: {
  address: string;
  initial: EstimateResult;
  reused: boolean;
  /** New construction vs replacement. Affects the proposal scope-of-work
   *  language downstream; here we surface it as a chip in the top bar so
   *  the contractor sees what mode they're in. */
  jobType?: "new" | "replacement";
  /** When this estimate came from a plan upload, the PlanAnalysis id.
   *  Passed through to TopBar so the "Re-analyze" button can target
   *  the right row. */
  planId?: string;
}) {
  const reduce = useReducedMotion();
  const [eaves, setEaves] = useState(initial.eaves);
  const [downspouts, setDownspouts] = useState(initial.downspouts);
  // Satellite (address) estimates open on "Photo & edit" — the trace ON
  // the real photo — so the contractor verifies/adjusts runs against the
  // actual roof FIRST; the clean "Diagram" drafting sheet is the second
  // tab (the deliverable, once the trace is right). Plan estimates keep
  // the roof plan / sheet / elevations flow.
  const isSatelliteEstimate =
    !!initial.aerial?.imageDataUrl && !initial.planSource;
  const [viewMode, setViewMode] = useState<
    "diagram" | "plan" | "sheet" | "elevations" | "3d"
  >("plan");
  // When the Elevations view hands off to the trace tool, it carries the
  // page to open the Plan-sheet on.
  const [sheetInitialPage, setSheetInitialPage] = useState<number | null>(null);
  // The real PDF sheet view is only meaningful for plan-based estimates.
  const hasSheet = !!initial.planSource;
  // Px-per-foot driving LF math. Lifted to state so the "Plan sheet" manual
  // takeoff can re-anchor it to the contractor's click-calibrated scale.
  const [canvasPxPerFt, setCanvasPxPerFt] = useState(initial.canvasPxPerFt);
  // "Plan sheet" working state — calibrated scale (px/ft in canvas space)
  // and the runs traced on the real page. Lifted so they survive tab
  // switches; committed to the priced eaves via applyPlanTrace().
  const [planScale, setPlanScale] = useState<number | null>(null);
  const [planRuns, setPlanRuns] = useState<{ x: number; y: number }[][]>([]);
  // Building outline traced on the Plan sheet → the footprint (roof shape).
  const [planOutline, setPlanOutline] = useState<{ x: number; y: number }[]>([]);
  // Roof outline/skeleton, lifted to state so a traced outline can replace
  // the AI's box footprint and the Roof plan re-derives an accurate roof.
  const [roofStructure, setRoofStructure] = useState(initial.roofStructure);
  // Rakes (gable edges) lifted too — a traced outline clears the AI's rakes
  // (they're in the old projected space and would misalign); per-edge gable
  // marking on the outline repopulates them.
  const [rakes, setRakes] = useState(initial.rakes);
  // Suggested interior gutter runs (un-priced tier-break hints). Kept in
  // their own state so they NEVER enter the priced `eaves` sum. Accepting
  // one (tap-to-add) moves it out of here and into `eaves`.
  const [suggestedEaves, setSuggestedEaves] = useState(
    initial.suggestedEaves ?? [],
  );
  // Gable flags per traced-outline edge (true = rake/gable, no gutter).
  const [planOutlineGables, setPlanOutlineGables] = useState<boolean[]>([]);
  const setOutline = (o: { x: number; y: number }[]) => {
    setPlanOutline(o);
    setPlanOutlineGables((g) =>
      o.length === g.length ? g : o.map(() => false),
    );
  };
  const toggleGableEdge = (i: number) =>
    setPlanOutlineGables((g) => {
      const next = g.length === planOutline.length ? [...g] : planOutline.map(() => false);
      next[i] = !next[i];
      return next;
    });

  const applyPlanTrace = () => {
    if (!planScale || planRuns.length === 0) return;
    const lines: EditableLine[] = planRuns.map((r, i) => ({
      id: `plan-trace-${i}`,
      kind: "eave",
      points: r,
    }));
    setEaves(lines);
    setCanvasPxPerFt(planScale);
    setViewMode("plan");
  };

  const applyOutline = () => {
    if (!planScale || planOutline.length < 3) return;
    // The traced polygon becomes the footprint (roof shape). Each edge is an
    // EAVE (gutter) unless marked a GABLE — gable edges become rakes (no
    // gutter, and the roof draws a gable end there). When the contractor
    // traced eave runs separately, those price; otherwise the non-gable
    // outline edges do. All in the same Plan-sheet space, so they stay aligned.
    const n = planOutline.length;
    const gable = (i: number) => planOutlineGables[i] === true;
    const outlineEaves: EditableLine[] = planOutline
      .map((p, i) =>
        gable(i)
          ? null
          : ({
              id: `outline-eave-${i}`,
              kind: "eave",
              points: [p, planOutline[(i + 1) % n]],
            } as EditableLine),
      )
      .filter((l): l is EditableLine => l !== null);
    const lines: EditableLine[] =
      planRuns.length > 0
        ? planRuns.map((r, i) => ({
            id: `plan-trace-${i}`,
            kind: "eave",
            points: r,
          }))
        : outlineEaves;
    const rakeLines: EditableLine[] = planOutline
      .map((p, i) =>
        gable(i)
          ? ({
              id: `outline-rake-${i}`,
              kind: "rake",
              points: [p, planOutline[(i + 1) % n]],
            } as EditableLine)
          : null,
      )
      .filter((l): l is EditableLine => l !== null);
    setEaves(lines);
    setRakes(rakeLines);
    setCanvasPxPerFt(planScale);
    setRoofStructure({
      perimeter: planOutline,
      ridges: [],
      valleys: [],
      hips: [],
      confidence: 1,
    });
    // Re-seat downspouts on the traced corners — the AI's were in the old
    // projected space and would float off the new roof (and skew the canvas
    // auto-fit). One per corner is a sensible starting point; delete extras.
    setDownspouts(
      planOutline.map((p, i) => ({
        id: `outline-ds-${i}`,
        x: p.x,
        y: p.y,
        heightFt: 20,
      })),
    );
    setViewMode("plan");
  };
  const can3d =
    (roofStructure?.perimeter?.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ).length ?? 0) >= 3;
  // Story count is editable from the property header — homeowners
  // sometimes second-guess a 2-story call when an attached garage
  // looks 1-story on satellite. Default seeded from the AI estimate;
  // contractor overrides with one click.
  const [stories, setStories] = useState(initial.measurements.stories);
  // Bumped by the "bad satellite pic — draw it yourself" banner to arm the
  // canvas's eave-drawing tool.
  const [drawNonce, setDrawNonce] = useState(0);
  const traceQuality = initial.traceQuality;

  const liveEaveLF = Math.round(
    eaves.reduce((acc, l) => {
      // Satellite eaves are COVER-fit onto the canvas, so convert px→ft
      // with the per-estimate scale (not the plan-mode 2.4) — otherwise
      // editing an eave re-prices the job on the wrong scale.
      const v = lineLengthFt(l, canvasPxPerFt);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0),
  );

  const measurements: Measurements = {
    ...initial.measurements,
    // Fall back to stored eaveLF when the live sum is 0 — happens
    // when all eaves were dropped at projection time (bad coords on
    // every gutter_run). Without this, the contractor sees "0 LF"
    // even though the stored takeoff has a real LF total.
    eaveLF: liveEaveLF > 0 ? liveEaveLF : initial.measurements.eaveLF,
    downspoutCount: downspouts.length,
    stories,
  };

  // Single handoff payload — captured at click-time by either button.
  // Recomputed each render so live edits to eaves / downspouts are
  // included in whatever the contractor sends to /proposal.
  const handoff: Omit<EstimateHandoff, "capturedAt"> = {
    address,
    measurements,
    eaves,
    rakes,
    downspouts,
    suggestedEaves,
    roofStructure,
    aerial: initial.aerial,
    canvasPxPerFt,
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <TopBar
        address={address}
        handoff={handoff}
        jobType={jobType}
        planId={planId}
      />

      {/* The payoff moment after a 30-90s wait: header → canvas → pricing
          rail rise in with a short stagger instead of one flat fade. */}
      <motion.div
        initial={reduce ? false : "hidden"}
        animate="visible"
        variants={staggerContainer(0.06)}
        className="flex-1"
      >
        <div className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex flex-col gap-4">
            <motion.div variants={fadeInUp}>
              <PropertyHeader
                address={address}
                measurements={measurements}
                source={initial.source}
                reused={reused}
                durationMs={initial.durationMs}
                notes={initial.notes}
                onStoriesChange={setStories}
              />
            </motion.div>
            {traceQuality && traceQuality.status !== "ok" && (
              <BadTraceBanner
                quality={traceQuality}
                hasLines={eaves.length > 0}
                onDrawFresh={() => {
                  // Drop the user onto the editable canvas — the drawing
                  // tool lives in AerialCanvas ("Photo & edit"), which is
                  // NOT mounted on the default satellite Diagram view, so
                  // arming drawNonce alone would do nothing there.
                  //
                  // Clear EVERYTHING the AI derived, not just the eaves: the
                  // downspouts, rakes, and suggested tier-drops were all
                  // placed FROM those eaves, so wiping eaves alone orphans
                  // them — that's how a "bad pic" redraw left 9 downspouts
                  // floating over 0 LF of gutter.
                  setEaves([]);
                  setDownspouts([]);
                  setRakes([]);
                  setSuggestedEaves([]);
                  setViewMode("plan");
                  setDrawNonce((n) => n + 1);
                }}
                onKeepAndEdit={() => {
                  setViewMode("plan");
                  setDrawNonce((n) => n + 1);
                }}
              />
            )}
            <motion.div variants={fadeInUp} className="min-h-[520px] flex-1">
              {/* Roof plan ⇄ 3D view toggle. 3D is a read-only, decorative
                  massing — pricing/LF comes from the same live eaves either
                  way. Disabled without a real roof outline. */}
              <div className="mb-2 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
                {(
                  [
                    "plan",
                    isSatelliteEstimate ? "diagram" : null,
                    hasSheet ? "sheet" : null,
                    hasSheet ? "elevations" : null,
                    "3d",
                  ].filter(Boolean) as Array<
                    "diagram" | "plan" | "sheet" | "elevations" | "3d"
                  >
                ).map((m) => {
                  const active = viewMode === m;
                  const disabled = m === "3d" && !can3d;
                  const label =
                    m === "diagram"
                      ? "Diagram"
                      : m === "plan"
                        ? isSatelliteEstimate
                          ? "Photo & edit"
                          : "Roof plan"
                        : m === "sheet"
                          ? "Plan sheet"
                          : m === "elevations"
                            ? "Elevations"
                            : "3D";
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setViewMode(m)}
                      title={
                        m === "sheet"
                          ? "The actual roof-plan sheet from your PDF"
                          : m === "elevations"
                            ? "Your roof from the side — the architect's elevation drawings + per-side gutters"
                            : disabled
                              ? "Needs a roof outline (run a plan takeoff)"
                              : undefined
                      }
                      className={
                        "ring-focus relative rounded-md px-2.5 py-1 text-xs font-medium transition-smooth " +
                        (active
                          ? "text-zinc-900"
                          : disabled
                            ? "cursor-not-allowed text-zinc-300"
                            : "text-zinc-500 hover:text-zinc-900")
                      }
                    >
                      {/* Sliding highlight — same treatment as the pricing
                          rail tabs so the two switchers read as one system. */}
                      {active && (
                        <motion.span
                          layoutId="view-mode-pill"
                          className="absolute inset-0 rounded-md bg-zinc-100"
                          transition={{
                            duration: reduce ? 0 : DUR.base,
                            ease: EASE,
                          }}
                        />
                      )}
                      <span className="relative">{label}</span>
                    </button>
                  );
                })}
              </div>
              {viewMode === "sheet" && initial.planSource ? (
                <PdfPlanView
                  planSource={initial.planSource}
                  initialPage={sheetInitialPage}
                  scalePxPerFt={planScale}
                  onScaleChange={setPlanScale}
                  runs={planRuns}
                  onRunsChange={setPlanRuns}
                  onApply={applyPlanTrace}
                  outline={planOutline}
                  onOutlineChange={setOutline}
                  onApplyOutline={applyOutline}
                  gableEdges={planOutlineGables}
                  onToggleGableEdge={toggleGableEdge}
                />
              ) : viewMode === "elevations" && initial.planSource ? (
                <ElevationsView
                  planSource={initial.planSource}
                  eaves={eaves}
                  rakes={rakes}
                  pxPerFt={canvasPxPerFt}
                  onTraceSheet={(p) => {
                    setSheetInitialPage(p);
                    setViewMode("sheet");
                  }}
                />
              ) : viewMode === "3d" && can3d ? (
                <Massing3D
                  eaves={eaves}
                  rakes={rakes}
                  downspouts={downspouts}
                  roofStructure={roofStructure}
                  planSource={initial.planSource}
                  stories={stories}
                />
              ) : viewMode === "diagram" ? (
                <div className="aspect-[16/10] w-full overflow-hidden rounded-xl">
                  <GutterDiagram
                    eaves={eaves}
                    rakes={rakes}
                    downspouts={downspouts}
                    roofStructure={roofStructure}
                    pxPerFt={canvasPxPerFt}
                    address={address}
                    confidence={roofStructure?.confidence}
                  />
                </div>
              ) : (
                <AerialCanvas
                  eaves={eaves}
                  rakes={rakes}
                  downspouts={downspouts}
                  suggestedEaves={suggestedEaves}
                  onAcceptSuggested={(line) => {
                    // Move the tapped suggestion OUT of the un-priced pool
                    // and INTO the priced eaves — from here on it's a normal
                    // editable run (drag/delete/re-tier like any other).
                    setSuggestedEaves((prev) =>
                      prev.filter((l) => l.id !== line.id),
                    );
                    setEaves((prev) => [...prev, { ...line, kind: "eave" }]);
                  }}
                  onEavesChange={setEaves}
                  onRakesChange={setRakes}
                  onDownspoutsChange={setDownspouts}
                  aerialImageUrl={initial.aerial?.imageDataUrl}
                  planSource={initial.planSource}
                  roofStructure={roofStructure}
                  pxPerFt={canvasPxPerFt}
                  armDrawNonce={drawNonce}
                  magnetPath={initial.magnetPath}
                  magnetRingCount={initial.magnetRingCount}
                />
              )}
            </motion.div>
          </div>

          <motion.div
            variants={fadeInUp}
            className="lg:sticky lg:top-[72px] lg:self-start"
          >
            <div className="rounded-2xl border border-zinc-200/70 bg-white shadow-card">
              {/* Desktop: viewport-tall sticky rail with its own inner scroll.
                  Mobile (stacked): natural height so the page scrolls as one —
                  a fixed 100vh box here trapped phone users in nested scroll. */}
              <div className="lg:h-[calc(100vh-7rem)] lg:max-h-[calc(100vh-7rem)] lg:overflow-hidden">
                <PricingPanel
                  measurements={measurements}
                  handoff={handoff}
                  jobType={jobType}
                />
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function PropertyHeader({
  address,
  measurements,
  source,
  reused,
  durationMs,
  notes,
  onStoriesChange,
}: {
  address: string;
  measurements: Measurements;
  source: EstimateResult["source"];
  reused: boolean;
  durationMs: number;
  notes: string[];
  /** Optional callback to override the AI's story-count guess. When
   *  provided, renders the story segment as a clickable picker so the
   *  contractor can confirm or correct the AI's call in one tap. */
  onStoriesChange?: (n: 1 | 2 | 3) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zinc-400" />
            <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900">
              {address}
            </h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {onStoriesChange ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="microlabel">Stories</span>
                <span className="inline-flex overflow-hidden rounded-full border border-zinc-200 bg-zinc-50/50">
                  {([1, 2, 3] as const).map((n) => {
                    const active = measurements.stories === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onStoriesChange(n)}
                        className={
                          // Inset focus ring — the parent pill clips
                          // outset rings with overflow-hidden.
                          "px-2 py-0.5 text-xs font-semibold tabular-nums transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 " +
                          (active
                            ? "bg-accent-600 text-white"
                            : "text-zinc-600 hover:bg-white hover:text-zinc-900")
                        }
                        title={`Set to ${n}-story`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </span>
              </span>
            ) : (
              <span>
                <span className="text-zinc-700">
                  {measurements.stories}-story
                </span>{" "}
                single-family
              </span>
            )}
            <span>·</span>
            {/* Gutter MITERS (eave-meets-eave corners), not outline corners —
                rake/unknown edges suppress theirs, so a 16-corner outline can
                legitimately read "6". Label it what it is. */}
            <span
              title={`${measurements.outsideCorners} outside · ${measurements.insideCorners} inside`}
            >
              <span className="text-zinc-700">
                {measurements.outsideCorners + measurements.insideCorners}
              </span>{" "}
              gutter miters
            </span>
            <span>·</span>
            <span>
              <span className="text-zinc-700">
                {measurements.wasteFactorPct}%
              </span>{" "}
              waste factor
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            <Ruler className="h-3 w-3" />
            {measurements.eaveLF} LF eaves
          </Badge>
          <Badge tone="neutral">
            {measurements.downspoutCount} downspouts
          </Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <SourceBadge source={source} />
        {reused && (
          <Badge tone="neutral">
            <RefreshCcw className="h-3 w-3" />
            Reused (no credit)
          </Badge>
        )}
        {/* Notes arrive empty for non-admin users (stripped server-side
            in runEstimate/runEstimateFromPlan) — the ms timing is the
            same diagnostic class, so it rides along with them. */}
        {notes.length > 0 && <span>· {durationMs} ms</span>}
        {notes.map((n) => (
          <span key={n} className="rounded-full bg-zinc-100 px-2 py-0.5">
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: EstimateResult["source"] }) {
  if (source === "ai") {
    return (
      <Badge tone="accent">
        <Sparkles className="h-3 w-3" />
        AI takeoff
      </Badge>
    );
  }
  if (source === "partial") {
    return (
      <Badge tone="amber">
        <Sparkles className="h-3 w-3" />
        Partial AI · geometry pending
      </Badge>
    );
  }
  return (
    <Badge tone="violet">
      <Sparkles className="h-3 w-3" />
      Mock data
    </Badge>
  );
}

/**
 * "Bad satellite pic — draw it yourself" banner. Shown above the canvas
 * when the server flags the auto-trace as low/unusable (blurry tile, lines
 * off the roof, length that can't be this roof). The CTA arms the canvas's
 * eave-drawing tool; for an unusable trace it can also clear the junk lines
 * so the contractor starts from a clean roof.
 */
function BadTraceBanner({
  quality,
  hasLines,
  onDrawFresh,
  onKeepAndEdit,
}: {
  quality: NonNullable<EstimateResult["traceQuality"]>;
  hasLines: boolean;
  onDrawFresh: () => void;
  onKeepAndEdit: () => void;
}) {
  const unusable = quality.status === "unusable";
  return (
    // variants only — joins the results-reveal stagger driven by the
    // parent container in ResultsView, so the warning rises in with the
    // rest of the page instead of popping.
    <motion.div
      variants={fadeInUp}
      className={cn(
        "rounded-2xl border p-4 shadow-card",
        unusable ? "border-amber-300 bg-amber-50" : "border-zinc-200/70 bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            unusable ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600",
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-900">
            {unusable
              ? "Sorry — this satellite image was too unclear to measure"
              : "Heads up — double-check this trace"}
          </div>
          <p className="mt-0.5 text-sm text-zinc-600">
            {unusable
              ? "We couldn't reliably trace the gutters from this aerial. Switch to the drawing tool and click along each roof edge to measure them yourself."
              : "Part of the auto-trace looks off the roof. Verify it, or redraw it with the drawing tool."}
            {quality.reasons[0] ? (
              <span className="text-zinc-400"> — {quality.reasons[0]}</span>
            ) : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDrawFresh}
              className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-smooth hover:bg-accent-700 active:scale-[0.98]"
            >
              <PencilRuler className="h-4 w-4" />
              {unusable && hasLines
                ? "Clear & draw gutters"
                : "Draw gutters myself"}
            </button>
            {unusable && hasLines && (
              <button
                type="button"
                onClick={onKeepAndEdit}
                className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-[13px] font-medium text-zinc-700 transition-smooth hover:bg-zinc-50 hover:border-zinc-300 active:scale-[0.98]"
              >
                Keep AI lines & edit
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
