import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCostBasisCents,
  jobProfit,
  monthlyOverheadCents,
  overheadCoverage,
  profitPlan,
} from "./job-costing";
import {
  EFFECTIVE_TAX_RATE,
  packageTotal,
  sampleProposal,
} from "./proposal-mock";
import { suggestNextAction } from "./crm-insights";

test("deriveCostBasisCents matches the picked package's BOM subtotal", () => {
  const pick =
    sampleProposal.packages.find((p) => p.recommended) ??
    sampleProposal.packages[1];
  const { subtotal } = packageTotal(pick, sampleProposal.measurements, 0);
  assert.equal(
    deriveCostBasisCents(sampleProposal),
    Math.round(subtotal * 100),
  );
});

test("deriveCostBasisCents honors an explicit package pick and survives junk", () => {
  const good = sampleProposal.packages[0];
  const { subtotal } = packageTotal(good, sampleProposal.measurements, 0);
  assert.equal(
    deriveCostBasisCents(sampleProposal, "good"),
    Math.round(subtotal * 100),
  );
  assert.equal(deriveCostBasisCents(null), 0);
  assert.equal(deriveCostBasisCents({ packages: [] }), 0);
});

test("jobProfit: AI basis by default, manual override wins, tax stripped", () => {
  const contractCents = 500_000;
  const ai = jobProfit({
    contractCents,
    aiCostCents: 200_000,
    manualCostCents: null,
    workerPayCents: 80_000,
    extraExpensesCents: 10_000,
  });
  const revenue = Math.round(contractCents / (1 + EFFECTIVE_TAX_RATE));
  assert.equal(ai.revenueExTaxCents, revenue);
  assert.equal(ai.usingManual, false);
  assert.equal(ai.totalCostCents, 290_000);
  assert.equal(ai.profitCents, revenue - 290_000);

  const manual = jobProfit({
    contractCents,
    aiCostCents: 200_000,
    manualCostCents: 250_000,
    workerPayCents: 0,
    extraExpensesCents: 0,
  });
  assert.equal(manual.usingManual, true);
  assert.equal(manual.baseCostCents, 250_000);
  assert.equal(manual.profitCents, revenue - 250_000);
});

test("jobProfit margin can go negative and marginPct guards zero revenue", () => {
  const under = jobProfit({
    contractCents: 100_000,
    aiCostCents: 200_000,
    manualCostCents: null,
    workerPayCents: 0,
    extraExpensesCents: 0,
  });
  assert.ok(under.profitCents < 0);
  assert.ok(under.marginPct < 0);
  const zero = jobProfit({
    contractCents: 0,
    aiCostCents: 100,
    manualCostCents: null,
    workerPayCents: 0,
    extraExpensesCents: 0,
  });
  assert.equal(zero.marginPct, 0);
});

test("monthlyOverheadCents amortizes yearly items", () => {
  assert.equal(
    monthlyOverheadCents([
      { amountCents: 100_000, cadence: "MONTHLY" },
      { amountCents: 120_000, cadence: "YEARLY" },
    ]),
    110_000,
  );
  assert.equal(monthlyOverheadCents([]), 0);
});

test("overheadCoverage: gap before break-even, surplus after", () => {
  const before = overheadCoverage(200_000, 150_000);
  assert.equal(before.covered, false);
  assert.equal(before.gapCents, 50_000);
  assert.equal(before.surplusCents, 0);
  assert.ok(Math.abs(before.pct - 0.75) < 1e-9);

  const after = overheadCoverage(200_000, 260_000);
  assert.equal(after.covered, true);
  assert.equal(after.gapCents, 0);
  assert.equal(after.surplusCents, 60_000);
  assert.equal(after.pct, 1);

  // No overhead configured = trivially covered, full meter.
  const none = overheadCoverage(0, 0);
  assert.equal(none.covered, true);
  assert.equal(none.pct, 1);
});

test("profitPlan splits revenue into crew / sales / overhead / profit", () => {
  const plan = profitPlan({
    revenueCents: 2_000_000, // $20k month
    monthlyOverheadCents: 300_000, // $3k bills
    crewPct: 30,
    salesPct: 10,
  });
  assert.equal(plan.crewCents, 600_000);
  assert.equal(plan.salesCents, 200_000);
  assert.equal(plan.overheadCents, 300_000);
  assert.equal(plan.profitCents, 900_000);
  assert.ok(Math.abs(plan.profitPct - 0.45) < 1e-9);
  // Break-even: overhead / (1 − 0.4) = $5,000.
  assert.equal(plan.breakEvenRevenueCents, 500_000);
});

test("profitPlan guards the edges: zero revenue, 100% shares, junk pcts", () => {
  const zero = profitPlan({
    revenueCents: 0,
    monthlyOverheadCents: 100_000,
    crewPct: 30,
    salesPct: 10,
  });
  assert.equal(zero.profitCents, -100_000);
  assert.equal(zero.profitPct, 0);

  // Crew + sales eat every dollar → no revenue can break even.
  const eaten = profitPlan({
    revenueCents: 1_000_000,
    monthlyOverheadCents: 100_000,
    crewPct: 60,
    salesPct: 40,
  });
  assert.equal(eaten.breakEvenRevenueCents, null);
  assert.equal(eaten.profitCents, -100_000);

  // NaN / negative percentages clamp to 0 instead of poisoning the math.
  const junk = profitPlan({
    revenueCents: 1_000_000,
    monthlyOverheadCents: 0,
    crewPct: Number.NaN,
    salesPct: -5,
  });
  assert.equal(junk.crewCents, 0);
  assert.equal(junk.salesCents, 0);
  assert.equal(junk.profitCents, 1_000_000);
  assert.equal(junk.breakEvenRevenueCents, 0);
});

test("suggestNextAction ladder hits the key rungs", () => {
  const now = new Date("2026-07-18T12:00:00Z");
  const base = {
    sentAt: null as string | null,
    acceptedAt: null as string | null,
    completedAt: null as string | null,
    updatedAt: "2026-07-18T00:00:00Z",
  };
  assert.equal(
    suggestNextAction({ ...base, status: "DRAFT" }, now).kind,
    "finish_draft",
  );
  assert.equal(
    suggestNextAction(
      { ...base, status: "SENT", sentAt: "2026-07-10T00:00:00Z" },
      now,
    ).kind,
    "follow_up",
  );
  assert.equal(
    suggestNextAction(
      { ...base, status: "SENT", sentAt: "2026-07-17T00:00:00Z" },
      now,
    ).kind,
    "wait",
  );
  assert.equal(
    suggestNextAction(
      { ...base, status: "VIEWED", updatedAt: "2026-07-14T00:00:00Z" },
      now,
    ).kind,
    "nudge",
  );
  assert.equal(
    suggestNextAction({ ...base, status: "ACCEPTED" }, now).kind,
    "job_running",
  );
  assert.equal(
    suggestNextAction(
      { ...base, status: "ACCEPTED", completedAt: "2026-07-15T00:00:00Z" },
      now,
    ).kind,
    "ask_review",
  );
  assert.equal(
    suggestNextAction({ ...base, status: "DECLINED" }, now).kind,
    "win_back",
  );
  assert.equal(
    suggestNextAction({ ...base, status: "EXPIRED" }, now).kind,
    "requote",
  );
});
