import type { LineItem } from "@/lib/types";

// One totals pipeline for the whole estimate builder — the Summary tab,
// the live footer, and the material-chip price deltas must all agree to
// the cent, so they all call this.

export type Adjustments = {
  markupPct: number;
  discountPct: number;
  taxPct: number;
};

export type EstimateTotals = {
  subtotal: number;
  markup: number;
  discount: number;
  tax: number;
  total: number;
};

export function computeEstimateTotals(
  items: LineItem[],
  adj: Adjustments,
): EstimateTotals {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const markup = subtotal * (adj.markupPct / 100);
  const afterMarkup = subtotal + markup;
  const discount = afterMarkup * (adj.discountPct / 100);
  const taxableBase = items
    .filter((i) => i.taxable)
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxableAfterAdj =
    taxableBase * (1 + adj.markupPct / 100) * (1 - adj.discountPct / 100);
  const tax = taxableAfterAdj * (adj.taxPct / 100);
  const total = afterMarkup - discount + tax;
  return { subtotal, markup, discount, tax, total };
}

/**
 * Back-solve the markup % so computeEstimateTotals(items, {...}).total lands
 * exactly on `target` — the AI market price applied through the estimate's
 * OWN total formula (the "AI market price" switch). Inverse of
 * computeEstimateTotals: total = (1+m)(1−d)(subtotal + taxableBase·t), so
 * m = target / [(1−d)(subtotal + taxableBase·t)] − 1. Returns 0 when the
 * base is non-positive (nothing to mark up).
 */
export function markupForEstimateTarget(
  target: number,
  items: LineItem[],
  discountPct: number,
  taxPct: number,
): number {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxableBase = items
    .filter((i) => i.taxable)
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const d = Math.max(0, Math.min(100, discountPct)) / 100;
  const t = Math.max(0, taxPct) / 100;
  const denom = (1 - d) * (subtotal + taxableBase * t);
  if (!(denom > 0) || !(target > 0)) return 0;
  return (target / denom - 1) * 100;
}

/** Compact signed currency for chip deltas: +$248, −$1.2k. Null when ~0. */
export function formatDelta(n: number): string | null {
  const abs = Math.abs(n);
  if (abs < 0.5) return null;
  const sign = n > 0 ? "+" : "−";
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}
