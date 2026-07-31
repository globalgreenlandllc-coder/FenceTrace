/**
 * trade.ts — which trade a proposal's packages belong to.
 *
 * FenceScan packages carry `config.fence`; legacy gutter packages don't.
 * The AI price-suggestion call picks its system prompt and its
 * measurements block ONCE for the whole job, so a set that mixes the two
 * would describe a gutter package (downspout size, leaf guards)
 * underneath a fence header ("Fence length: N LF · Gates: N") and price
 * it off the fence prompt. Callers reject "mixed" rather than spend a
 * call on a brief that contradicts itself.
 *
 * Deliberately pure and dependency-free: lib/ai/price-suggestion pulls in
 * `server-only` transitively (api-keys → db), so nothing there can be
 * loaded by the plain node test runner. This can.
 */

export type Trade = "fence" | "gutter" | "mixed";

/**
 * Classify a package set by trade.
 *
 * An empty list reports "gutter" (the legacy default) — callers reject
 * empty sets before they get here, so the value is never used.
 */
export function classifyTrade(
  packages: ReadonlyArray<{ config: { fence?: unknown } }>,
): Trade {
  const fence = packages.filter((p) => !!p.config.fence).length;
  if (fence === 0) return "gutter";
  return fence === packages.length ? "fence" : "mixed";
}
