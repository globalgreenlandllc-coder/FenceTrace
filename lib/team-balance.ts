import "server-only";
import { db } from "@/lib/db";
import type { WorkerKind, WorkerStatus } from "@prisma/client";

/**
 * team-balance.ts — the ONE place "what does this owner owe each crew
 * member" is computed. Both consumers must always agree on the math:
 *   - the owner's Workers page (per-worker earnings + payout recording)
 *   - each worker's own pay stub in the portal (getMyPayStubs)
 *
 * Earned means FINISHED work only: COMPLETED job assignments'
 * workerPayCents. Open jobs (OFFERED/ACCEPTED/IN_PROGRESS) count as
 * pending — promised, not owed.
 *
 * PAY POLICY: crews settle the moment the work completes (outside the
 * app), so earnings are treated as ALREADY PAID — the app never
 * accumulates an earnings debt. The only balance it tracks is approved
 * out-of-pocket expenses, which the office reimburses and marks paid by
 * hand on the expense row:
 *
 *   paid = earned (auto)   ·   owed = unreimbursed approved expenses
 *
 * Recorded payouts remain as history (extra/advance payments) but don't
 * drive the owed math.
 */

export type PayoutDTO = {
  id: string;
  amountCents: number;
  /** PaymentMethod value (CHECK/CASH/…) — null when the owner skipped
   *  the dropdown. */
  method: string | null;
  note: string | null;
  createdAt: string;
};

export type TeamMemberEarnings = {
  workerId: string;
  name: string;
  email: string;
  kind: WorkerKind;
  status: WorkerStatus;
  /** Lifetime, from completed jobs only. */
  earnedCents: number;
  /** Promised on not-yet-completed work (open jobs). */
  pendingCents: number;
  /** Approved out-of-pocket expenses not yet paid back. */
  expensesOwedCents: number;
  /** See the pay policy above: settled on completion. */
  paidCents: number;
  /** What the office still owes: unreimbursed approved expenses. */
  owedCents: number;
  earnedMtdCents: number;
  earnedYtdCents: number;
  payouts: PayoutDTO[];
};

export async function computeTeamEarnings(
  ownerId: string,
): Promise<TeamMemberEarnings[]> {
  const [workers, assignments, expenses] = await Promise.all([
    db.worker.findMany({
      where: { ownerId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: { payouts: { orderBy: { createdAt: "desc" } } },
    }),
    db.jobAssignment.findMany({
      where: {
        ownerId,
        status: { in: ["OFFERED", "ACCEPTED", "IN_PROGRESS", "COMPLETED"] },
      },
      select: { workerId: true, workerPayCents: true, status: true, completedAt: true },
    }),
    db.jobExpense.findMany({
      where: {
        ownerId,
        source: "WORKER",
        paidBy: "OUT_OF_POCKET",
        status: "APPROVED",
        reimbursedAt: null,
        workerId: { not: null },
      },
      select: { workerId: true, amountCents: true },
    }),
  ]);

  type Acc = { earned: number; pending: number; expensesOwed: number; mtd: number; ytd: number };
  const accs = new Map<string, Acc>();
  const acc = (workerId: string): Acc => {
    let a = accs.get(workerId);
    if (!a) {
      a = { earned: 0, pending: 0, expensesOwed: 0, mtd: 0, ytd: 0 };
      accs.set(workerId, a);
    }
    return a;
  };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  for (const j of assignments) {
    if (j.workerPayCents <= 0) continue;
    const a = acc(j.workerId);
    if (j.status === "COMPLETED" && j.completedAt) {
      a.earned += j.workerPayCents;
      if (j.completedAt >= monthStart) a.mtd += j.workerPayCents;
      if (j.completedAt >= yearStart) a.ytd += j.workerPayCents;
    } else if (j.status !== "COMPLETED") {
      a.pending += j.workerPayCents;
    }
  }
  for (const e of expenses) {
    if (e.workerId) acc(e.workerId).expensesOwed += e.amountCents;
  }

  return workers.map((w) => {
    const a = accs.get(w.id) ?? { earned: 0, pending: 0, expensesOwed: 0, mtd: 0, ytd: 0 };
    return {
      workerId: w.id,
      name: w.name || w.email,
      email: w.email,
      kind: w.kind,
      status: w.status,
      earnedCents: a.earned,
      pendingCents: a.pending,
      expensesOwedCents: a.expensesOwed,
      // Earnings settle on completion (pay policy above) — what's earned
      // IS what's been paid.
      paidCents: a.earned,
      owedCents: a.expensesOwed,
      earnedMtdCents: a.mtd,
      earnedYtdCents: a.ytd,
      payouts: w.payouts.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        method: p.method,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });
}
