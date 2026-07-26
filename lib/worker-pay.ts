/**
 * worker-pay.ts — pure math for "worker gets X% of the job" pay.
 *
 * A crew member's pay is a percentage of a BASE amount. The base is resolved
 * smartly by source:
 *   - the job came from an in-app estimate (satellite / manual / blueprint
 *     takeoff) → base = the proposal's contract total, no upload needed;
 *   - the owner uploaded an invoice/file → base = the AI-read invoice total.
 * An explicit upload always wins over the proposal estimate (uploading is a
 * deliberate override — "if it's just a file, read the file").
 *
 * No server imports — safe to use from both the server action and the client
 * assign modal so the two never drift.
 */

/** How the estimate a proposal is priced on was produced (for copy only). */
export type EstimateSource = "satellite" | "manual" | "blueprint" | "estimate";

/** Which base the pay % was applied to. Stored on the assignment (audit). */
export type PayBasis = "estimate" | "invoice";

/**
 * Tag which estimate produced a proposal's price, for friendlier assign copy.
 * Returns null when there's no priced estimate to base pay on.
 *
 * `estimateTotalCents` is the already-derived contract total; we only inspect
 * `data` to pick the source label.
 */
export function deriveEstimateSource(
  data: unknown,
  estimateTotalCents: number,
): EstimateSource | null {
  if (!(estimateTotalCents > 0)) return null;
  const d = (data ?? {}) as Record<string, unknown>;
  const takeoff = d.takeoff as Record<string, unknown> | undefined;
  if (d.source === "manual") return "manual";
  // Top-level planId ⇒ came from an uploaded blueprint (the only place
  // saveDraftFromEstimate writes it); aerial imagery ⇒ satellite.
  if (d.planId != null) return "blueprint";
  if (takeoff && takeoff.aerial != null) return "satellite";
  return "estimate";
}

/**
 * The base a worker's pay % applies to. An uploaded invoice total wins over
 * the proposal estimate. Returns a null base when neither exists (the owner
 * hand-types the pay).
 */
export function resolvePayBase(input: {
  invoiceTotalCents?: number | null;
  proposalBaseCents?: number | null;
}): { baseCents: number | null; baseSource: PayBasis | null } {
  if (input.invoiceTotalCents != null && input.invoiceTotalCents > 0)
    return { baseCents: input.invoiceTotalCents, baseSource: "invoice" };
  if (input.proposalBaseCents != null && input.proposalBaseCents > 0)
    return { baseCents: input.proposalBaseCents, baseSource: "estimate" };
  return { baseCents: null, baseSource: null };
}

/**
 * Worker pay in cents = pct% of the base. The percent is capped at 100 —
 * same clamp semantics as the financial planner's crew% (lib/job-costing.ts
 * clampPct), so a fat-fingered "250" can never auto-fill 2.5× the contract.
 * Returns null when the inputs don't drive a pay (no base, or a non-positive
 * percent) so the caller can leave the owner's hand-typed value untouched.
 */
export function computePayCents(
  baseCents: number | null,
  pct: number,
): number | null {
  if (baseCents == null || baseCents <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.round((baseCents * Math.min(pct, 100)) / 100);
}
