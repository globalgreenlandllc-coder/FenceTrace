/**
 * Slope analysis for fence runs — elevation samples in, build guidance
 * out. Pure math, unit-tested; the estimator feeds it Google Elevation
 * samples taken every post position along each drawn run.
 *
 * Field rules encoded here:
 *  - Panels/pickets can RACK (follow the grade) up to ~1' of rise per 8'
 *    section for stick-built wood, ~6" for prefab panels; steeper than
 *    that the section must STEP — the panel stays level and the next one
 *    drops, which needs a LONGER post at every step to keep the top of
 *    the taller side at full height.
 *  - Post length = fence height + burial (⅓ of height, min 2') + any
 *    step drop on stepped sections.
 *  - Terrain difficulty (labor multiplier) follows the average absolute
 *    grade: <5% flat · 5–12% sloped · 12–20% steep · >20% treat as steep
 *    ground with rocky-grade digging time.
 */
import type { Terrain } from "./catalog";

export type RunSlope = {
  /** Rise per section, ft (signed, one entry per section). */
  sectionRises: number[];
  /** Sections that must STEP rather than rack. */
  steppedSections: number;
  /** Largest single-section drop, ft. */
  maxStepFt: number;
  /** Average absolute grade along the run, percent. */
  avgGradePct: number;
  maxGradePct: number;
  /** Total elevation change end-to-end, ft. */
  totalRiseFt: number;
};

export type SlopeSummary = {
  runs: RunSlope[];
  avgGradePct: number;
  maxGradePct: number;
  steppedSections: number;
  /** Suggested labor terrain from the measured grade. */
  suggestedTerrain: Terrain;
  /** Standard post length for this fence, ft (height + burial). */
  basePostLengthFt: number;
  /** Post length needed at stepped sections, ft. */
  stepPostLengthFt: number;
};

/** How much rise one section can absorb by racking, by build kind. */
export function rackingLimitFt(build: "stick" | "panel" | "mesh" | "rail"): number {
  if (build === "panel") return 0.5; // prefab panels barely rack
  if (build === "mesh") return 1.5; // chain-link follows grade well
  return 1.0; // stick-built & rail
}

/** Burial depth: a third of the height, never less than 2'. */
export function burialFt(heightFt: number): number {
  return Math.max(2, heightFt / 3);
}

export function analyzeRunSlope(
  elevationsFt: number[],
  sectionLenFt: number,
  rackLimitFt: number,
): RunSlope {
  if (elevationsFt.length < 2 || sectionLenFt <= 0) {
    return {
      sectionRises: [],
      steppedSections: 0,
      maxStepFt: 0,
      avgGradePct: 0,
      maxGradePct: 0,
      totalRiseFt: 0,
    };
  }
  const rises: number[] = [];
  for (let i = 1; i < elevationsFt.length; i++) {
    rises.push(elevationsFt[i] - elevationsFt[i - 1]);
  }
  const grades = rises.map((r) => Math.abs(r / sectionLenFt) * 100);
  const stepped = rises.filter((r) => Math.abs(r) > rackLimitFt);
  return {
    sectionRises: rises.map((r) => round2(r)),
    steppedSections: stepped.length,
    maxStepFt: round2(stepped.reduce((m, r) => Math.max(m, Math.abs(r)), 0)),
    avgGradePct: round2(grades.reduce((a, b) => a + b, 0) / grades.length),
    maxGradePct: round2(Math.max(...grades)),
    totalRiseFt: round2(
      elevationsFt[elevationsFt.length - 1] - elevationsFt[0],
    ),
  };
}

export function summarizeSlopes(
  runElevations: number[][],
  sectionLenFt: number,
  heightFt: number,
  build: "stick" | "panel" | "mesh" | "rail",
): SlopeSummary {
  const limit = rackingLimitFt(build);
  const runs = runElevations
    .filter((e) => e.length >= 2)
    .map((e) => analyzeRunSlope(e, sectionLenFt, limit));
  const all = runs.filter((r) => r.sectionRises.length > 0);
  const avg =
    all.length > 0
      ? all.reduce((a, r) => a + r.avgGradePct * r.sectionRises.length, 0) /
        all.reduce((a, r) => a + r.sectionRises.length, 0)
      : 0;
  const maxG = all.reduce((m, r) => Math.max(m, r.maxGradePct), 0);
  const stepped = all.reduce((a, r) => a + r.steppedSections, 0);
  const maxStep = all.reduce((m, r) => Math.max(m, r.maxStepFt), 0);

  const suggestedTerrain: Terrain =
    avg < 5 && maxG < 10 ? "flat" : avg < 12 ? "sloped" : "steep";

  const base = heightFt + burialFt(heightFt);
  return {
    runs,
    avgGradePct: round2(avg),
    maxGradePct: round2(maxG),
    steppedSections: stepped,
    suggestedTerrain,
    basePostLengthFt: roundPost(base),
    stepPostLengthFt: roundPost(base + Math.min(2, maxStep)),
  };
}

/** Posts come in even-foot lengths — round up. */
function roundPost(ft: number): number {
  return Math.ceil(ft / 2) * 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
