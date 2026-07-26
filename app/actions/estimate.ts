"use server";

// TODO(fence): the satellite/blueprint roof measuring engine that powered
// runEstimate / runEstimateFromPlan was removed in the FenceTrace demolition
// phase. The exported names, signatures, and response shapes are preserved so
// the estimate-job provider, /estimate page, and start page keep compiling —
// the pipeline functions now return a friendly "engine being installed"
// failure instead of running a takeoff. getRecentAddresses (a plain DB query)
// still works. The fence measuring engine will re-implement the pipeline here.

import { db } from "@/lib/db";
import type { EstimateResult } from "@/lib/ai";
import { getMe } from "./me";

/**
 * Most recent unique addresses this contractor has run estimates on.
 * Powers the autocomplete dropdown on the dashboard's address input —
 * the same address rarely needs a full retype.
 *
 * Returns the *display* form (`row.address`, which is whatever the user
 * entered, after geocode normalization on success) rather than the
 * normalized lowercase key, so the dropdown reads the way the user
 * originally typed it.
 */
export async function getRecentAddresses(): Promise<string[]> {
  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe();
  } catch {
    return [];
  }
  if (!me) return [];

  const rows = await db.estimateRun.findMany({
    where: { userId: me.user.id, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    select: { address: true, addressNormalized: true },
    take: 50,
  });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = r.addressNormalized || r.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.address);
    if (out.length >= 8) break;
  }
  return out;
}

export type RunEstimateResponse =
  | {
      ok: true;
      result: EstimateResult;
      reused: boolean;
      remaining: number;
      runId: string;
    }
  | {
      // Analysis is queued / still running in a background callback. The
      // caller should poll, NOT surface this as an error.
      ok: false;
      pending: true;
      reason: string;
      remaining: number;
    }
  | {
      ok: false;
      pending?: false;
      reason: string;
      remaining: number;
    };

const ENGINE_OFFLINE_REASON =
  "The fence measuring engine is being installed — use Manual measure for now.";

// TODO(fence): re-implement with the fence measuring pipeline.
export async function runEstimate(
  address: string,
): Promise<RunEstimateResponse> {
  void address;
  return { ok: false, reason: ENGINE_OFFLINE_REASON, remaining: 0 };
}

// TODO(fence): plan-based takeoffs belonged to the removed blueprint engine.
// The signature (and pending-capable response shape) is preserved for the
// estimate-job provider's poll loop.
export async function runEstimateFromPlan(
  planId: string,
): Promise<RunEstimateResponse> {
  void planId;
  return { ok: false, reason: ENGINE_OFFLINE_REASON, remaining: 0 };
}
