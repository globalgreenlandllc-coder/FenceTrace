/**
 * takeoff-calibration.ts — pure math for the learned-calibration loop.
 *
 * The learning loop: every time a contractor saves an estimate that came from
 * a plan upload, the corrected takeoff is written to PlanAnalysis.editedJson
 * (the AI's original stays untouched in analysisJson). This module turns those
 * (AI, corrected) pairs into a soft prior — "this contractor's takeoffs run
 * ~12% high" — that the next Stage-2 read receives as guidance.
 *
 * Deliberately a SOFT prior, never a multiplier: the prompt block tells the
 * model where its bias has been, and that printed dimensions on the current
 * plan always win. Nothing here touches priced geometry.
 *
 * NO server-only, NO "@/" imports — node-testable like blueprint-trace-quality.
 */

export type CorrectionPair = {
  /** Sum of the AI's priced gutter_runs length_ft at analysis time. */
  aiEaveLf: number;
  /** The contractor's saved eave LF (measurements.eaveLF). */
  editedEaveLf: number;
  aiDownspouts: number;
  editedDownspouts: number;
};

export type LearnedCalibration = {
  sampleCount: number;
  /** Signed median of (edited − ai) / ai. Positive = the AI read LOW. */
  medianLfDeltaPct: number;
  /** Signed median of (edited − ai) downspout count. Positive = AI read low. */
  medianDownspoutDelta: number;
  /** Prompt block for the Stage-2 user message, or null when the history
   *  shows no actionable bias (nothing worth telling the model). */
  promptBlock: string | null;
};

/** Minimum corrected takeoffs before the prior is trusted at all. */
export const MIN_CALIBRATION_SAMPLES = 3;
/** LF bias below this (median, absolute %) is noise — say nothing. */
export const MIN_ACTIONABLE_LF_PCT = 5;
/** A pair whose LF delta exceeds this is a redraw, not a correction — drop it
 *  so one blown trace can't swing the median. */
export const MAX_PLAUSIBLE_LF_DELTA = 0.6;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Extract a comparable pair from a stored (analysisJson, editedJson) row.
 *  Null when either side lacks a usable LF total. */
export function correctionPairFromRow(row: {
  analysisJson: unknown;
  editedJson: unknown;
}): CorrectionPair | null {
  try {
    const ai = row.analysisJson as {
      gutter_runs?: { length_ft?: number | null }[];
      downspouts?: unknown[];
    } | null;
    const ed = row.editedJson as {
      measurements?: { eaveLF?: number; downspoutCount?: number };
    } | null;
    if (!ai || !ed?.measurements) return null;
    const aiEaveLf = (ai.gutter_runs ?? []).reduce(
      (t, r) => t + (typeof r.length_ft === "number" && r.length_ft > 0 ? r.length_ft : 0),
      0,
    );
    const editedEaveLf = ed.measurements.eaveLF ?? 0;
    if (!(aiEaveLf > 0) || !(editedEaveLf > 0)) return null;
    return {
      aiEaveLf,
      editedEaveLf,
      aiDownspouts: Array.isArray(ai.downspouts) ? ai.downspouts.length : 0,
      editedDownspouts: ed.measurements.downspoutCount ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Summarize correction history into a learned calibration. Returns null when
 * there aren't enough plausible samples to say anything.
 */
export function summarizeCorrections(
  pairs: CorrectionPair[],
): LearnedCalibration | null {
  const usable = pairs.filter((p) => {
    if (!(p.aiEaveLf > 0) || !(p.editedEaveLf > 0)) return false;
    const delta = Math.abs(p.editedEaveLf - p.aiEaveLf) / p.aiEaveLf;
    return delta <= MAX_PLAUSIBLE_LF_DELTA;
  });
  if (usable.length < MIN_CALIBRATION_SAMPLES) return null;

  const lfDeltas = usable.map((p) => (p.editedEaveLf - p.aiEaveLf) / p.aiEaveLf);
  const dsDeltas = usable.map((p) => p.editedDownspouts - p.aiDownspouts);
  const medianLfDeltaPct = median(lfDeltas) * 100;
  const medianDownspoutDelta = median(dsDeltas);

  const lines: string[] = [];
  if (Math.abs(medianLfDeltaPct) >= MIN_ACTIONABLE_LF_PCT) {
    const dir = medianLfDeltaPct > 0 ? "LOW" : "HIGH";
    const fix =
      medianLfDeltaPct > 0
        ? "re-check for missed eaves (porches, between-gable drops, projecting garage/porch roofs) before finalizing"
        : "re-check the scale anchor and for double-traced or invented runs before finalizing";
    lines.push(
      `- Eave totals have read ~${Math.abs(medianLfDeltaPct).toFixed(0)}% ${dir} ` +
        `versus this contractor's verified takeoffs (median). Do NOT blindly scale ` +
        `your numbers; ${fix}.`,
    );
  }
  if (Math.abs(medianDownspoutDelta) >= 1) {
    const dir = medianDownspoutDelta > 0 ? "low" : "high";
    lines.push(
      `- Downspout counts have run ~${Math.abs(medianDownspoutDelta).toFixed(0)} ${dir} ` +
        `(median). Re-count the D.S. marks on the roof plan with that in mind.`,
    );
  }

  const promptBlock =
    lines.length === 0
      ? null
      : `LEARNED CALIBRATION — history of ${usable.length} contractor-corrected takeoffs ` +
        `from this account:\n${lines.join("\n")}\n` +
        `This is a soft prior from PAST plans, not ground truth for THIS plan — ` +
        `printed dimensions and linework on this plan always win.\n\n`;

  return {
    sampleCount: usable.length,
    medianLfDeltaPct,
    medianDownspoutDelta,
    promptBlock,
  };
}
