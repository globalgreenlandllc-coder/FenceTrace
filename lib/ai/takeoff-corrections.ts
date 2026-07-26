import "server-only";

/**
 * takeoff-corrections.ts — the write/read halves of the learning loop.
 *
 * WRITE: when a contractor saves an estimate that originated from a plan
 * upload, snapshot their (possibly edited) takeoff into
 * PlanAnalysis.editedJson — the slot the schema reserved for exactly this
 * ("keeping the original AI output untouched lets us A/B test prompt changes
 * against real ground-truth contractor corrections"). analysisJson is never
 * touched.
 *
 * READ: before the next Stage-2 geometry read, summarize this user's past
 * (AI, corrected) pairs into a soft calibration prior (takeoff-calibration.ts)
 * that is injected into the read's user message. Fail-safe on both halves:
 * any error is swallowed with a console.warn — learning must never break a
 * save or an analysis.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  correctionPairFromRow,
  summarizeCorrections,
  type LearnedCalibration,
} from "./takeoff-calibration";

/** How many recent corrected takeoffs feed the prior. Recency-bounded so the
 *  prior tracks the CURRENT prompt/engine, not mistakes fixed months ago. */
const CALIBRATION_WINDOW = 40;

export async function captureTakeoffCorrection(args: {
  userId: string;
  planId: string;
  takeoff: {
    eaves: unknown[];
    rakes: unknown[];
    downspouts: unknown[];
    measurements: { eaveLF: number; downspoutCount: number } & Record<string, unknown>;
  };
  /** Where the save came from, for later analysis ("estimate-draft-save"). */
  source: string;
}): Promise<void> {
  try {
    if (!(args.takeoff.measurements?.eaveLF > 0)) return; // nothing measurable
    // Tenancy: only the owner's plan row may receive the correction.
    const row = await db.planAnalysis.findFirst({
      where: { id: args.planId, userId: args.userId },
      select: { id: true },
    });
    if (!row) return;
    await db.planAnalysis.update({
      where: { id: row.id },
      data: {
        editedJson: {
          eaves: args.takeoff.eaves,
          rakes: args.takeoff.rakes,
          downspouts: args.takeoff.downspouts,
          measurements: args.takeoff.measurements,
          source: args.source,
          editedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.warn(
      "[takeoff-corrections] capture failed (save unaffected):",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Learned calibration for this user, or null when there isn't enough
 *  correction history (or it shows no actionable bias). */
export async function getLearnedCalibration(
  userId: string,
): Promise<LearnedCalibration | null> {
  try {
    const rows = await db.planAnalysis.findMany({
      where: {
        userId,
        status: "SUCCEEDED",
        NOT: { editedJson: { equals: Prisma.AnyNull } },
      },
      orderBy: { updatedAt: "desc" },
      take: CALIBRATION_WINDOW,
      select: { analysisJson: true, editedJson: true },
    });
    const pairs = rows
      .map((r) => correctionPairFromRow(r))
      .filter((p): p is NonNullable<typeof p> => p != null);
    return summarizeCorrections(pairs);
  } catch (e) {
    console.warn(
      "[takeoff-corrections] calibration read failed (analysis unaffected):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
