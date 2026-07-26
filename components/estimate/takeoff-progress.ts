"use client";

import { useEffect, useState } from "react";

export const AERIAL_STEPS = [
  { id: "geocode", label: "Geocoding property" },
  { id: "aerial", label: "Fetching aerial imagery" },
  { id: "segment", label: "Analyzing roof edges" },
  { id: "measure", label: "Calculating linear feet" },
  { id: "downspouts", label: "Placing downspouts" },
  { id: "price", label: "Building takeoff" },
];

// Plan-mode runs a different pipeline: classifier (Haiku) catalogs
// every sheet, picks the roof plan + harvests elevation eave counts,
// then geometry (Sonnet) traces the identified page constrained by
// those counts. Steps mirror that order so the contractor doesn't see
// "Fetching aerial imagery" while staring at their uploaded PDF.
export const PLAN_STEPS = [
  { id: "read", label: "Reading plan PDF" },
  { id: "classify", label: "Cataloging sheets" },
  { id: "elevations", label: "Counting eaves on elevations" },
  { id: "roof", label: "Tracing the roof plan" },
  { id: "downspouts", label: "Placing downspouts" },
  { id: "price", label: "Building takeoff" },
];

/**
 * Deterministic progress derived from wall-clock time since `startedAt`.
 * The upload/analyze pipeline doesn't report real progress, so this paces
 * expectations: the step cascade fills to 88%, then the long final step
 * creeps 88 → ~99 asymptotically (quick at first, always advancing, never
 * quite 100 until the real result swaps the screen out).
 *
 * Because it's a pure function of `startedAt`, the fullscreen loading
 * card and the floating mini-window show the SAME percentage, and the
 * number survives mount/unmount as the contractor navigates around.
 */
export function useTakeoffProgress(mode: "aerial" | "plan", startedAt: number) {
  const steps = mode === "plan" ? PLAN_STEPS : AERIAL_STEPS;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Aerial's cascade dwells 420ms/step — tick faster there so the
    // steps still visibly cascade instead of jumping two at a time.
    const t = setInterval(() => setNow(Date.now()), mode === "plan" ? 1000 : 250);
    return () => clearInterval(t);
  }, [mode]);

  const elapsedMs = Math.max(0, now - startedAt);
  const dwellMs = mode === "plan" ? 5000 : 420;
  const last = Math.max(1, steps.length - 1);
  const stepIndex = Math.min(Math.floor(elapsedMs / dwellMs), steps.length - 1);
  const onLastStep = stepIndex >= steps.length - 1;

  const CASCADE_CAP = 88;
  const tau = mode === "plan" ? 28 : 8;
  const finalElapsedSec = Math.max(0, (elapsedMs - dwellMs * last) / 1000);
  const pct = onLastStep
    ? Math.min(
        99,
        CASCADE_CAP + (99 - CASCADE_CAP) * (1 - Math.exp(-finalElapsedSec / tau)),
      )
    : Math.min(CASCADE_CAP, ((stepIndex + 1) / last) * CASCADE_CAP);

  return {
    steps,
    stepIndex,
    onLastStep,
    pct,
    pctInt: Math.round(pct),
    progress: pct / 100,
    elapsedSec: Math.floor(elapsedMs / 1000),
  };
}
