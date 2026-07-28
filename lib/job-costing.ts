import { EFFECTIVE_TAX_RATE, packageTotal, type Proposal } from "./proposal-mock";

/**
 * job-costing.ts — pure profit math for the contractor money OS.
 *
 * A job's economics, in one place so the proposal builder, the
 * /dashboard/financials page and the CRM all agree:
 *
 *   revenue (ex-tax) = contract total ÷ (1 + EFFECTIVE_TAX_RATE)
 *   base cost        = manual override ?? AI estimate (the package's
 *                      pre-markup BOM subtotal — materials + labor at the
 *                      contractor's own price book, straight from the
 *                      takeoff engine)
 *   total cost       = base cost + crew pay + approved extra expenses
 *   profit           = revenue − total cost
 *
 * Everything is cents-in / cents-out; no rounding surprises in the UI.
 * No server imports — safe for both client components and actions.
 */

/**
 * The "AI estimate" of what a job costs the contractor: the selected
 * package's pre-markup BOM subtotal (incl. included add-ons), i.e. the
 * same cost basis the discount margin coach already snapshots. Package
 * pick priority mirrors `deriveTotalCentsFromData` so cost and revenue
 * always describe the same tier. Returns 0 when the blob is malformed.
 */
function pickPackage(data: unknown, preferPackageId?: string | null) {
  const proposal = data as Partial<Proposal> | null;
  if (
    !proposal ||
    !Array.isArray(proposal.packages) ||
    proposal.packages.length === 0 ||
    !proposal.measurements
  ) {
    return null;
  }
  const packages = proposal.packages;
  const selectedId =
    preferPackageId ??
    (proposal as { selectedPackageId?: string }).selectedPackageId;
  const pick =
    (selectedId ? packages.find((p) => p.id === selectedId) : null) ??
    packages.find((p) => p.recommended) ??
    packages[1] ??
    packages[0];
  return pick ? { pick, proposal } : null;
}

export function deriveCostBasisCents(
  data: unknown,
  preferPackageId?: string | null,
): number {
  const found = pickPackage(data, preferPackageId);
  if (!found) return 0;
  try {
    const { subtotal } = packageTotal(found.pick, found.proposal.measurements!, 0);
    return Math.max(0, Math.round(subtotal * 100));
  } catch {
    return 0;
  }
}

/**
 * The tax rate actually embedded in this job's contract. Fence packages
 * tax only the taxable share of the bill (materials/gates/stain — labor
 * and tear-out untaxed), so their effective rate is well below the flat
 * legacy gutter rate; stripping the wrong rate misstates every fence
 * job's ex-tax revenue and profit by ~2-3% of the contract. Falls back
 * to the legacy flat rate when the blob can't be priced.
 */
export function deriveEffectiveTaxRate(
  data: unknown,
  preferPackageId?: string | null,
): number {
  const found = pickPackage(data, preferPackageId);
  if (!found) return EFFECTIVE_TAX_RATE;
  try {
    const discountPct =
      typeof (found.proposal as { discountPct?: number }).discountPct === "number"
        ? (found.proposal as { discountPct: number }).discountPct
        : 0;
    const { tax, total } = packageTotal(
      found.pick,
      found.proposal.measurements!,
      discountPct,
    );
    if (!(total > 0) || !Number.isFinite(tax)) return EFFECTIVE_TAX_RATE;
    // total = preTax + tax  ⇒  the divisor that strips tax is
    // (1 + tax/preTax); express as a rate on the pre-tax base.
    const preTax = total - tax;
    return preTax > 0 ? tax / preTax : EFFECTIVE_TAX_RATE;
  } catch {
    return EFFECTIVE_TAX_RATE;
  }
}

export type JobProfitInputs = {
  /** Contract total the client pays (post-tax), in cents. */
  contractCents: number;
  /** AI-estimated materials+labor basis (see deriveCostBasisCents). */
  aiCostCents: number;
  /** Contractor's manual override of the base cost; null = trust the AI. */
  manualCostCents: number | null;
  /** Crew pay committed on this job (sum of live assignment workerPayCents). */
  workerPayCents: number;
  /** Approved extra expenses (owner-logged + approved worker receipts). */
  extraExpensesCents: number;
  /** The tax rate embedded in the contract (deriveEffectiveTaxRate).
   *  Defaults to the legacy flat rate for old callers. */
  taxRate?: number;
};

export type JobProfitBreakdown = {
  /** Contract total with tax stripped — what actually lands in the pocket. */
  revenueExTaxCents: number;
  /** manual ?? AI base cost that was used. */
  baseCostCents: number;
  usingManual: boolean;
  totalCostCents: number;
  profitCents: number;
  /** profit / ex-tax revenue, 0..1 (0 when revenue is non-positive). */
  marginPct: number;
};

export function jobProfit(i: JobProfitInputs): JobProfitBreakdown {
  const rate = Number.isFinite(i.taxRate) ? Math.max(0, i.taxRate!) : EFFECTIVE_TAX_RATE;
  const revenueExTaxCents = Math.round(
    Math.max(0, i.contractCents) / (1 + rate),
  );
  const usingManual = i.manualCostCents != null;
  const baseCostCents = Math.max(0, i.manualCostCents ?? i.aiCostCents);
  const totalCostCents =
    baseCostCents +
    Math.max(0, i.workerPayCents) +
    Math.max(0, i.extraExpensesCents);
  const profitCents = revenueExTaxCents - totalCostCents;
  return {
    revenueExTaxCents,
    baseCostCents,
    usingManual,
    totalCostCents,
    profitCents,
    marginPct: revenueExTaxCents > 0 ? profitCents / revenueExTaxCents : 0,
  };
}

export type OverheadCadence = "MONTHLY" | "YEARLY";

/** Yearly items amortize to amount/12; the meter always thinks monthly. */
export function monthlyOverheadCents(
  items: ReadonlyArray<{ amountCents: number; cadence: OverheadCadence }>,
): number {
  return items.reduce(
    (acc, it) =>
      acc +
      (it.cadence === "YEARLY"
        ? Math.round(Math.max(0, it.amountCents) / 12)
        : Math.max(0, it.amountCents)),
    0,
  );
}

export type OverheadCoverage = {
  overheadCents: number;
  profitCents: number;
  /** 0..1, clamped — drives the meter fill. */
  pct: number;
  /** true once this month's job profit has paid the bills. */
  covered: boolean;
  /** Still to earn before break-even (0 once covered). */
  gapCents: number;
  /** Profit beyond overhead (0 until covered). */
  surplusCents: number;
};

export type ProfitPlanInputs = {
  /** Monthly revenue (ex-tax) the plan runs against, in cents. */
  revenueCents: number;
  monthlyOverheadCents: number;
  /** Share of revenue paid to the crew, 0–100. */
  crewPct: number;
  /** Share of revenue paid to the salesperson, 0–100. */
  salesPct: number;
};

export type ProfitPlan = {
  revenueCents: number;
  crewCents: number;
  salesCents: number;
  overheadCents: number;
  /** What's left for the owner. Can go negative below break-even. */
  profitCents: number;
  /** profit / revenue (0 when revenue is 0). */
  profitPct: number;
  /** Revenue at which profit hits zero at these percentages; null when
   *  crew + sales already take 100%+ of every dollar. */
  breakEvenRevenueCents: number | null;
};

const clampPct = (pct: number) =>
  Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;

/**
 * The business-wide split of a month's revenue: crew and sales are paid
 * as a percentage of every dollar, overhead is fixed, and the remainder
 * is the owner's profit. Purely a planning view — actual per-job profit
 * stays on `jobProfit` (real crew pay + real expenses).
 */
export function profitPlan(i: ProfitPlanInputs): ProfitPlan {
  const revenue = Math.max(0, Math.round(i.revenueCents));
  const overhead = Math.max(0, Math.round(i.monthlyOverheadCents));
  const crewShare = clampPct(i.crewPct) / 100;
  const salesShare = clampPct(i.salesPct) / 100;
  const crewCents = Math.round(revenue * crewShare);
  const salesCents = Math.round(revenue * salesShare);
  const profitCents = revenue - crewCents - salesCents - overhead;
  const variableShare = crewShare + salesShare;
  return {
    revenueCents: revenue,
    crewCents,
    salesCents,
    overheadCents: overhead,
    profitCents,
    profitPct: revenue > 0 ? profitCents / revenue : 0,
    breakEvenRevenueCents:
      variableShare >= 1 ? null : Math.ceil(overhead / (1 - variableShare)),
  };
}

export function overheadCoverage(
  overheadCents: number,
  profitCents: number,
): OverheadCoverage {
  const overhead = Math.max(0, overheadCents);
  const profit = Math.max(0, profitCents);
  const covered = overhead === 0 ? profit > 0 || overhead === 0 : profit >= overhead;
  return {
    overheadCents: overhead,
    profitCents,
    pct: overhead > 0 ? Math.min(1, profit / overhead) : 1,
    covered,
    gapCents: covered ? 0 : overhead - profit,
    surplusCents: covered ? profit - overhead : 0,
  };
}
