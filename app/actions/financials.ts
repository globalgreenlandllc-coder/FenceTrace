"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import {
  deriveCostBasisCents,
  jobProfit,
  monthlyOverheadCents,
  overheadCoverage,
  type OverheadCoverage,
} from "@/lib/job-costing";
import {
  deriveTotalCentsFromData,
  type Proposal as ProposalData,
} from "@/lib/proposal-mock";

/**
 * financials.ts — the contractor's own P&L. Owner-tenanted: every query
 * is scoped by me.user.id. Money is cents everywhere; the UI formats.
 *
 * Profit model (see lib/job-costing.ts): per accepted job,
 *   profit = contract(ex-tax) − (manual ?? AI cost basis) − crew pay
 *            − approved extra expenses.
 * The overhead meter compares month-to-date profit from COMPLETED jobs
 * against the monthly overhead total (yearly items amortized /12).
 */

type VoidResult = { ok: true } | { ok: false; reason: string };

export type OverheadItemDto = {
  id: string;
  label: string;
  amountCents: number;
  cadence: "MONTHLY" | "YEARLY";
};

export type JobExpenseDto = {
  id: string;
  proposalId: string | null;
  label: string;
  amountCents: number;
  note: string | null;
  source: "OWNER" | "WORKER";
  status: "PENDING" | "APPROVED" | "DECLINED";
  workerName: string | null;
  createdAt: string;
};

export type FinancialJobRow = {
  proposalId: string;
  clientName: string;
  address: string;
  stage: "in_progress" | "done";
  completedAt: string | null;
  /** Contract total (post-tax), the client-facing price. */
  contractCents: number;
  paidCents: number;
  /** AI estimate of materials+labor basis from the takeoff BOM. */
  aiCostCents: number;
  /** Owner's manual override (null = using the AI estimate). */
  manualCostCents: number | null;
  workerPayCents: number;
  approvedExtraCents: number;
  expenses: JobExpenseDto[];
  /** Net profit + margin under the current (manual ?? AI) basis. */
  profitCents: number;
  marginPct: number;
  /** Contract total with tax stripped — the revenue side of the profit. */
  revenueExTaxCents: number;
};

/** Business-wide revenue split the profit planner runs on (0–100 each). */
export type FinancialSettingsDto = {
  crewPct: number;
  salesPct: number;
};

export type FinancialsOverview = {
  overhead: OverheadItemDto[];
  monthlyOverheadCents: number;
  jobs: FinancialJobRow[];
  /** Profit from jobs COMPLETED this calendar month. */
  profitMtdCents: number;
  /** Projected profit still sitting in in-progress jobs. */
  pipelineProfitCents: number;
  collectedMtdCents: number;
  /** Ex-tax revenue from jobs COMPLETED this calendar month — the
   *  default "monthly revenue" the profit planner starts from. */
  revenueMtdCents: number;
  settings: FinancialSettingsDto;
  coverage: OverheadCoverage;
  /** Worker-submitted expenses awaiting a decision, newest first. */
  pendingExpenses: (JobExpenseDto & { jobLabel: string })[];
};

function toExpenseDto(e: {
  id: string;
  proposalId: string | null;
  label: string;
  amountCents: number;
  note: string | null;
  source: "OWNER" | "WORKER";
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: Date;
  worker?: { name: string | null; email: string } | null;
}): JobExpenseDto {
  return {
    id: e.id,
    proposalId: e.proposalId,
    label: e.label,
    amountCents: e.amountCents,
    note: e.note,
    source: e.source,
    status: e.status,
    workerName: e.worker ? e.worker.name ?? e.worker.email : null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Live crew commitments only — declined/cancelled assignments don't cost. */
const PAYING_ASSIGNMENT_STATUSES = [
  "OFFERED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

export async function getFinancialsOverview(): Promise<FinancialsOverview | null> {
  const me = await getMe();
  if (!me) return null;
  const userId = me.user.id;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [overheadRows, proposals, collected, pendingRows, settingsRow] =
    await Promise.all([
    db.overheadItem.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    db.proposal.findMany({
      where: { userId, status: "ACCEPTED" },
      orderBy: [{ completedAt: "desc" }, { acceptedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        clientName: true,
        address: true,
        totalCents: true,
        paidCents: true,
        selectedPackageId: true,
        completedAt: true,
        data: true,
        jobAssignments: {
          where: { status: { in: [...PAYING_ASSIGNMENT_STATUSES] } },
          select: { workerPayCents: true },
        },
        expenses: {
          orderBy: { createdAt: "desc" },
          include: { worker: { select: { name: true, email: true } } },
        },
      },
    }),
    db.paymentInstallment.aggregate({
      where: {
        proposal: { userId },
        status: "PAID",
        paidAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
    db.jobExpense.findMany({
      where: { ownerId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        worker: { select: { name: true, email: true } },
        proposal: { select: { clientName: true, address: true } },
        assignment: { select: { title: true } },
      },
    }),
    db.financialSettings.findUnique({
      where: { userId },
      select: { crewPct: true, salesPct: true },
    }),
  ]);

  const jobs: FinancialJobRow[] = proposals.map((p) => {
    const data = p.data as Partial<ProposalData> | null;
    const contractCents = deriveTotalCentsFromData(
      p.data,
      p.totalCents,
      p.selectedPackageId,
    );
    const aiCostCents = deriveCostBasisCents(p.data, p.selectedPackageId);
    const manualDollars = data?.jobCostManual;
    const manualCostCents =
      typeof manualDollars === "number" && Number.isFinite(manualDollars)
        ? Math.max(0, Math.round(manualDollars * 100))
        : null;
    const workerPayCents = p.jobAssignments.reduce(
      (acc, a) => acc + a.workerPayCents,
      0,
    );
    const approvedExtraCents = p.expenses
      .filter((e) => e.status === "APPROVED")
      .reduce((acc, e) => acc + e.amountCents, 0);
    const profit = jobProfit({
      contractCents,
      aiCostCents,
      manualCostCents,
      workerPayCents,
      extraExpensesCents: approvedExtraCents,
    });
    return {
      proposalId: p.id,
      clientName: p.clientName,
      address: p.address,
      stage: p.completedAt ? "done" : "in_progress",
      completedAt: p.completedAt?.toISOString() ?? null,
      contractCents,
      paidCents: p.paidCents,
      aiCostCents,
      manualCostCents,
      workerPayCents,
      approvedExtraCents,
      expenses: p.expenses.map(toExpenseDto),
      profitCents: profit.profitCents,
      marginPct: profit.marginPct,
      revenueExTaxCents: profit.revenueExTaxCents,
    };
  });

  const doneThisMonth = jobs.filter(
    (j) => j.completedAt && new Date(j.completedAt) >= monthStart,
  );
  const profitMtdCents = doneThisMonth.reduce(
    (acc, j) => acc + j.profitCents,
    0,
  );
  const revenueMtdCents = doneThisMonth.reduce(
    (acc, j) => acc + j.revenueExTaxCents,
    0,
  );
  const pipelineProfitCents = jobs
    .filter((j) => j.stage === "in_progress")
    .reduce((acc, j) => acc + j.profitCents, 0);

  const overhead: OverheadItemDto[] = overheadRows.map((o) => ({
    id: o.id,
    label: o.label,
    amountCents: o.amountCents,
    cadence: o.cadence,
  }));
  const overheadTotal = monthlyOverheadCents(overhead);

  return {
    overhead,
    monthlyOverheadCents: overheadTotal,
    jobs,
    profitMtdCents,
    pipelineProfitCents,
    collectedMtdCents: collected._sum.amountCents ?? 0,
    revenueMtdCents,
    settings: {
      crewPct: settingsRow?.crewPct ?? 0,
      salesPct: settingsRow?.salesPct ?? 0,
    },
    coverage: overheadCoverage(overheadTotal, profitMtdCents),
    pendingExpenses: pendingRows.map((e) => ({
      ...toExpenseDto(e),
      jobLabel:
        e.proposal?.clientName ??
        e.assignment?.title ??
        e.proposal?.address ??
        "Job",
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Profit-plan settings (crew % / sales % of revenue)                 */
/* ------------------------------------------------------------------ */

export async function saveFinancialSettings(patch: {
  crewPct?: number;
  salesPct?: number;
}): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const clean = (pct: number | undefined) => {
    if (pct === undefined) return undefined;
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(100, pct));
  };
  const crewPct = clean(patch.crewPct);
  const salesPct = clean(patch.salesPct);
  if (crewPct === null || salesPct === null)
    return { ok: false, reason: "Enter a percentage between 0 and 100" };
  if (crewPct === undefined && salesPct === undefined) return { ok: true };
  await db.financialSettings.upsert({
    where: { userId: me.user.id },
    create: {
      userId: me.user.id,
      crewPct: crewPct ?? 0,
      salesPct: salesPct ?? 0,
    },
    update: {
      ...(crewPct !== undefined ? { crewPct } : {}),
      ...(salesPct !== undefined ? { salesPct } : {}),
    },
  });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Overhead CRUD                                                      */
/* ------------------------------------------------------------------ */

export async function addOverheadItem(
  label: string,
  amountCents: number,
  cadence: "MONTHLY" | "YEARLY",
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const clean = (label ?? "").trim();
  const cents = Math.round(amountCents);
  if (!clean) return { ok: false, reason: "Give the cost a name" };
  if (!Number.isFinite(cents) || cents <= 0)
    return { ok: false, reason: "Enter an amount above zero" };
  await db.overheadItem.create({
    data: { userId: me.user.id, label: clean.slice(0, 80), amountCents: cents, cadence },
  });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

export async function updateOverheadItem(
  id: string,
  patch: { label?: string; amountCents?: number; cadence?: "MONTHLY" | "YEARLY" },
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const clean = patch.label.trim();
    if (!clean) return { ok: false, reason: "Give the cost a name" };
    data.label = clean.slice(0, 80);
  }
  if (patch.amountCents !== undefined) {
    const cents = Math.round(patch.amountCents);
    if (!Number.isFinite(cents) || cents <= 0)
      return { ok: false, reason: "Enter an amount above zero" };
    data.amountCents = cents;
  }
  if (patch.cadence !== undefined) data.cadence = patch.cadence;
  const res = await db.overheadItem.updateMany({
    where: { id, userId: me.user.id },
    data,
  });
  if (res.count === 0) return { ok: false, reason: "Cost not found" };
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

export async function deleteOverheadItem(id: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  await db.overheadItem.deleteMany({ where: { id, userId: me.user.id } });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Per-job cost override + owner expenses                             */
/* ------------------------------------------------------------------ */

/**
 * Set (or clear, with null) the manual cost basis for a job. Lives in
 * the proposal's data blob (`jobCostManual`, dollars) so the builder's
 * profit panel and this page always read the same knob.
 */
export async function setJobManualCost(
  proposalId: string,
  dollars: number | null,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0))
    return { ok: false, reason: "Enter a valid cost" };
  const row = await db.proposal.findFirst({
    where: { id: proposalId, userId: me.user.id },
    select: { id: true, data: true },
  });
  if (!row) return { ok: false, reason: "Job not found" };
  const data = { ...(row.data as object), jobCostManual: dollars };
  await db.proposal.update({ where: { id: row.id }, data: { data } });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

export async function addJobExpense(
  proposalId: string,
  label: string,
  amountCents: number,
  note?: string,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const clean = (label ?? "").trim();
  const cents = Math.round(amountCents);
  if (!clean) return { ok: false, reason: "Give the expense a name" };
  if (!Number.isFinite(cents) || cents <= 0)
    return { ok: false, reason: "Enter an amount above zero" };
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, userId: me.user.id },
    select: { id: true },
  });
  if (!proposal) return { ok: false, reason: "Job not found" };
  await db.jobExpense.create({
    data: {
      ownerId: me.user.id,
      proposalId: proposal.id,
      source: "OWNER",
      status: "APPROVED",
      label: clean.slice(0, 80),
      amountCents: cents,
      note: note?.trim().slice(0, 500) || null,
    },
  });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

export async function deleteJobExpense(id: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  await db.jobExpense.deleteMany({ where: { id, ownerId: me.user.id } });
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

/** Approve or decline a worker-submitted expense. Only PENDING rows move. */
export async function decideJobExpense(
  id: string,
  decision: "approve" | "decline",
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const res = await db.jobExpense.updateMany({
    where: { id, ownerId: me.user.id, status: "PENDING" },
    data: {
      status: decision === "approve" ? "APPROVED" : "DECLINED",
      decidedAt: new Date(),
    },
  });
  if (res.count === 0)
    return { ok: false, reason: "This expense was already decided" };
  revalidatePath("/dashboard/financials");
  return { ok: true };
}
