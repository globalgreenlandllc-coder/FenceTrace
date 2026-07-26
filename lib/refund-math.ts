// Pure refund bookkeeping math for the Stripe charge.refunded webhook.
// Kept DB-free so the safety invariants are unit-testable:
//   · booked refunds can never exceed what the charge actually paid
//   · cumulative amount_refunded makes retries idempotent (delta ≤ 0)
//   · a refunded credit pack claws back its credits proportionally

/** How many cents of refund remain to be booked for this delivery.
 *  ≤ 0 means "nothing to do" (retry of an already-booked refund, or a
 *  charge that is fully booked). */
export function computeRefundDelta(args: {
  /** Stripe charge.amount_refunded — cumulative across all refunds. */
  amountRefundedCents: number;
  /** Sum of refunds already booked in our ledger for this charge (≥ 0). */
  alreadyBookedCents: number;
  /** grossCents of the original SUCCEEDED transaction row. */
  originalGrossCents: number;
}): number {
  return Math.min(
    args.amountRefundedCents - args.alreadyBookedCents,
    args.originalGrossCents - args.alreadyBookedCents,
  );
}

/** Credits to claw back for a partially/fully refunded credit pack,
 *  prorated by the refunded fraction. 0 when the description isn't a
 *  credit-pack grant ("12 blueprint credits") or amounts are degenerate. */
export function computeCreditClawback(args: {
  description: string | null;
  deltaCents: number;
  originalGrossCents: number;
}): number {
  if (args.originalGrossCents <= 0 || args.deltaCents <= 0) return 0;
  const granted = Number.parseInt(
    args.description?.match(/^(\d+) blueprint credits/)?.[1] ?? "",
    10,
  );
  if (!Number.isFinite(granted) || granted <= 0) return 0;
  return Math.round((granted * args.deltaCents) / args.originalGrossCents);
}
