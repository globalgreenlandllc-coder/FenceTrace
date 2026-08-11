import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  deriveTotalCentsFromData,
  type Proposal as ProposalBlob,
} from "@/lib/proposal-mock";

/**
 * payment-schedule.ts — installment-schedule bootstrap.
 *
 * SECURITY: this module must stay a PLAIN import (no "use server").
 * These functions write contract money (totalCents/paidCents/
 * completedAt) from a caller-supplied row with no auth of their own —
 * every caller is responsible for resolving ownership (owner session or
 * portal token) BEFORE calling. When they lived as exports of a
 * "use server" file they were public RPC endpoints anyone could POST.
 */

export type ProposalRowForSchedule = {
  id: string;
  status: string;
  totalCents: number;
  paidCents: number;
  selectedPackageId: string | null;
  acceptedAt: Date | null;
  updatedAt: Date;
  data: unknown;
};

/**
 * Creates the default installment schedule for an ACCEPTED proposal that
 * doesn't have one yet (accepted before this feature shipped, or created
 * through a path that skipped it). Honors the homeowner's recorded
 * payment choice (deposit vs full) and preserves any legacy paidCents by
 * booking it as an already-PAID "Previously collected" installment.
 *
 * Caller contract: verify the proposal belongs to the authenticated
 * owner or the presented portal token before calling.
 */
export async function ensureScheduleForProposal(
  proposalId: string,
): Promise<void> {
  const row = await db.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      status: true,
      totalCents: true,
      paidCents: true,
      selectedPackageId: true,
      acceptedAt: true,
      updatedAt: true,
      data: true,
      _count: { select: { installments: true } },
    },
  });
  if (!row || row.status !== "ACCEPTED" || row._count.installments > 0) return;

  const acceptEvent = await db.proposalEvent.findFirst({
    where: { proposalId: row.id, kind: "ACCEPTED" },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const paymentChoice =
    ((acceptEvent?.payload as { paymentChoice?: string } | null)
      ?.paymentChoice as "deposit" | "full" | undefined) ?? "deposit";

  await createDefaultSchedule({
    row,
    paymentChoice,
  });
}

/**
 * Shared with acceptProposalByToken: builds the installment rows for a
 * freshly accepted proposal and stamps the contract total.
 *
 * Caller contract: `row` must be a server-fetched proposal the caller
 * has already authorized — never client input.
 */
export async function createDefaultSchedule(args: {
  row: ProposalRowForSchedule;
  paymentChoice: "deposit" | "full";
}): Promise<void> {
  const { row, paymentChoice } = args;

  // Guard against double-creation (e.g. accept retries).
  const existingCount = await db.paymentInstallment.count({
    where: { proposalId: row.id },
  });
  if (existingCount > 0) return;

  const blob = row.data as Partial<ProposalBlob> | null;
  const contract = deriveTotalCentsFromData(
    row.data,
    row.totalCents,
    row.selectedPackageId,
  );
  if (contract <= 0) return;

  const depositPct = Math.max(
    0,
    Math.min(100, Math.round(blob?.depositPct ?? 30)),
  );
  const acceptedAt = row.acceptedAt ?? new Date();

  const rows: Prisma.PaymentInstallmentCreateManyInput[] = [];

  // Legacy rows may already carry collected money — preserve it.
  const legacyPaid = Math.min(row.paidCents, contract);
  if (legacyPaid > 0) {
    rows.push({
      proposalId: row.id,
      label: "Previously collected",
      sortOrder: 0,
      amountCents: legacyPaid,
      dueAt: acceptedAt,
      status: "PAID",
      paidAt: row.updatedAt,
      method: "OTHER",
      note: "Recorded before payment tracking was enabled",
    });
  }

  const remainingContract = contract - legacyPaid;
  if (remainingContract > 0) {
    if (paymentChoice === "full") {
      rows.push({
        proposalId: row.id,
        label: "Full payment",
        sortOrder: 1,
        amountCents: remainingContract,
        dueAt: acceptedAt,
        status: "PENDING",
      });
    } else {
      const depositTarget = Math.round((contract * depositPct) / 100);
      const deposit = Math.max(0, Math.min(depositTarget - legacyPaid, remainingContract));
      const final = remainingContract - deposit;
      if (deposit > 0) {
        rows.push({
          proposalId: row.id,
          label: `Deposit (${depositPct}%)`,
          sortOrder: 1,
          amountCents: deposit,
          dueAt: acceptedAt,
          status: "PENDING",
        });
      }
      if (final > 0) {
        rows.push({
          proposalId: row.id,
          label: "Final payment",
          sortOrder: 2,
          amountCents: final,
          dueAt: null, // due on completion
          status: "PENDING",
        });
      }
    }
  }

  await db.$transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.paymentInstallment.createMany({ data: rows });
    }
    await tx.proposal.update({
      where: { id: row.id },
      data: {
        totalCents: contract,
        paidCents: legacyPaid,
        completedAt: legacyPaid >= contract ? new Date() : null,
      },
    });
  });
}
