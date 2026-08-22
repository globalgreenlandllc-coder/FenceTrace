"use server";

import { getMe } from "@/app/actions/me";
import { db } from "@/lib/db";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import {
  fenceScanCore,
  reframeScanCore,
  type FenceRunSeed,
  type FenceScanError,
  type FenceScanResult,
  type ReframeParcelArgs,
} from "@/lib/fence/scan-core";

/**
 * fence-scan.ts — the authed estimator entry into the measuring engine.
 * The pipeline itself lives in lib/fence/scan-core.ts (shared with the
 * anonymous landing teaser); this wrapper adds auth, the per-user rate
 * limit, and the recents row.
 */

export type { FenceRunSeed, FenceScanError, FenceScanResult };

export async function runFenceScan(
  addressRaw: string,
): Promise<FenceScanResult | FenceScanError> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const address = addressRaw.trim().slice(0, 200);
  if (address.length < 8) return { ok: false, reason: "Enter a full street address" };

  // Every scan spends real Google + Regrid money — same hourly budget as
  // the old satellite pipeline.
  const rl = await consumeLimit({
    policy: POLICIES.estimateRun,
    key: `fence-scan:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-scan" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };

  const result = await fenceScanCore(address);

  if (result.ok) {
    // Recents (best-effort; shares the platform's estimate_runs table).
    try {
      await db.estimateRun.create({
        data: {
          userId: me.user.id,
          address: result.address,
          addressNormalized: result.address.toLowerCase(),
          status: "SUCCEEDED",
          measurements: { fenceScan: true },
        },
      });
    } catch {
      // recents are cosmetic — never fail the scan over them
    }
  }

  return result;
}

/**
 * Switch the scan to a parcel the contractor clicked on the canvas —
 * the recovery path for a wrong-lot geocode and the way onto the lot
 * next door. Costs an aerial fetch + a neighbour box, so it shares the
 * scan rate limit.
 */
export async function reframeFenceScan(
  args: ReframeParcelArgs,
): Promise<FenceScanResult | FenceScanError> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const rl = await consumeLimit({
    policy: POLICIES.estimateRun,
    key: `fence-scan:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-scan-reframe" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };
  return reframeScanCore(args);
}
