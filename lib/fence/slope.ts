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
  /** STEPS the crew must build (code-sized): a section whose rise beats
   *  the racking limit contributes ceil(rise / MAX_STEP_DROP_FT) steps —
   *  big drops split into shorter panels with extra posts so no point
   *  of the fence face runs more than ~1' over nominal height. */
  steppedSections: number;
  /** Sections whose one-section rise reads as a sheer drop — a
   *  retaining wall or cut bank rather than walkable grade. Surfaced as
   *  a "mounting on a wall?" suggestion, never auto-priced. */
  wallSections: number;
  /** Steps attributable to wall-like sections (so confirming the wall
   *  can stop double-charging them as slope steps). */
  wallSteppedSections: number;
  /** Largest PER-STEP drop after splitting, ft (≤ MAX_STEP_DROP_FT for
   *  walkable grade — drives the extended-post length). */
  maxStepFt: number;
  /** Average absolute grade along the run, percent. */
  avgGradePct: number;
  maxGradePct: number;
  /** Total elevation change end-to-end, ft. */
  totalRiseFt: number;
  /** Extra FABRIC length on racked bays, ft: a bay that follows the
   *  grade is √(run² + rise²) long, not its map length. Stepped bays
   *  contribute nothing (level panels — the drop is vertical). */
  rackedExtraFt: number;
};

export type SlopeSummary = {
  runs: RunSlope[];
  avgGradePct: number;
  maxGradePct: number;
  steppedSections: number;
  /** Wall-like sections across all runs (see RunSlope.wallSections). */
  wallSections: number;
  /** Steps counted inside wall-like sections (subtract these when the
   *  contractor confirms the wall — mounts replace steps). */
  wallSteppedSections: number;
  /** LF of fence sitting over wall-like drops — seed for the estimator's
   *  "mount on the retaining wall" toggle. */
  wallLikeLf: number;
  /** Extra fabric across all racked bays, LF — real material the map
   *  length doesn't show. Small by construction (racking is angle-
   *  capped) and normally inside the waste factor; surfaced so the
   *  contractor SEES it instead of trusting it. */
  rackedExtraLf: number;
  /** Suggested labor terrain from the measured grade. */
  suggestedTerrain: Terrain;
  /** Standard post length for this fence, ft (height + burial). */
  basePostLengthFt: number;
  /** Post length needed at stepped sections, ft. */
  stepPostLengthFt: number;
};

/** One-section rise (ft) that reads as a sheer drop — a retaining wall
 *  or cut bank, not walkable grade. 2.5' over an 8' section ≈ 31% in a
 *  single step, concentrated where neighboring sections aren't. */
export const WALL_RISE_FT = 2.5;

/** Max drop a SINGLE step may take (ft). Codes measure fence height
 *  from the grade directly below — one big step would push the face
 *  over the permitted height at the downhill post (a 6' fence stepping
 *  3' reads as 9' there). Installers split big drops into shorter
 *  panels with extra posts; capping each step at 1' keeps every point
 *  of the fence within ~1' of nominal height, inside common municipal
 *  measuring tolerance. Tunable if a jurisdiction is stricter. */
export const MAX_STEP_DROP_FT = 1.0;

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
      wallSections: 0,
      wallSteppedSections: 0,
      maxStepFt: 0,
      avgGradePct: 0,
      maxGradePct: 0,
      totalRiseFt: 0,
      rackedExtraFt: 0,
    };
  }
  const rises: number[] = [];
  for (let i = 1; i < elevationsFt.length; i++) {
    rises.push(elevationsFt[i] - elevationsFt[i - 1]);
  }
  const grades = rises.map((r) => Math.abs(r / sectionLenFt) * 100);
  // A section that can't rack SPLITS into code-sized steps: shorter
  // panels + extra posts so each drop stays ≤ MAX_STEP_DROP_FT (both
  // directions — uphill and downhill use the absolute rise).
  let steps = 0;
  let wallSections = 0;
  let wallSteps = 0;
  let maxPerStep = 0;
  let rackedExtra = 0;
  for (const r of rises) {
    const rise = Math.abs(r);
    if (rise <= rackLimitFt) {
      // Racked: rails follow the ground — the true fabric length is the
      // hypotenuse of the bay.
      if (rise > 0) {
        rackedExtra += Math.hypot(sectionLenFt, rise) - sectionLenFt;
      }
      continue;
    }
    const splits = Math.max(1, Math.ceil(rise / MAX_STEP_DROP_FT));
    steps += splits;
    maxPerStep = Math.max(maxPerStep, rise / splits);
    if (rise >= WALL_RISE_FT) {
      wallSections += 1;
      wallSteps += splits;
    }
  }
  return {
    sectionRises: rises.map((r) => round2(r)),
    steppedSections: steps,
    wallSections,
    wallSteppedSections: wallSteps,
    maxStepFt: round2(maxPerStep),
    rackedExtraFt: round2(rackedExtra),
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
  const walls = all.reduce((a, r) => a + r.wallSections, 0);
  const wallSteps = all.reduce((a, r) => a + r.wallSteppedSections, 0);
  const maxStep = all.reduce((m, r) => Math.max(m, r.maxStepFt), 0);

  const suggestedTerrain: Terrain =
    avg < 5 && maxG < 10 ? "flat" : avg < 12 ? "sloped" : "steep";

  const base = heightFt + burialFt(heightFt);
  return {
    runs,
    avgGradePct: round2(avg),
    maxGradePct: round2(maxG),
    steppedSections: stepped,
    wallSections: walls,
    wallSteppedSections: wallSteps,
    wallLikeLf: round2(walls * sectionLenFt),
    rackedExtraLf: round2(all.reduce((a, r) => a + r.rackedExtraFt, 0)),
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
