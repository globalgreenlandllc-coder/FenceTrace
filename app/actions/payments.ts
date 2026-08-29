"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailViaResend } from "@/lib/email/resend";
import {
  renderReceiptEmail,
  renderReminderEmail,
  renderChangeOrderEmail,
  renderChangeOrderDecisionEmail,
} from "@/lib/email/payment-templates";
import {
  deriveTotalCentsFromData,
  type Proposal as ProposalBlob,
} from "@/lib/proposal-mock";
import { checkUserEmailBudget, checkPortalWrite } from "@/lib/abuse/guards";
import { POLICIES } from "@/lib/abuse/policies";
import { getMe } from "./me";
import { ensureScheduleForProposal } from "@/lib/payment-schedule";
import {
  cancelInvoiceForInstallment,
  ensurePayLinkForInstallment,
  isInvoiceProvider,
  providerWord,
} from "@/lib/payments/provider-invoices";

/* ------------------------------------------------------------------ */
/*  Shared DTOs                                                        */
/* ------------------------------------------------------------------ */

export type PaymentMethodId =
  | "CARD"
  | "CASH"
  | "CHECK"
  | "BANK_TRANSFER"
  | "OTHER";

export type InstallmentDto = {
  id: string;
  label: string;
  sortOrder: number;
  amountCents: number;
  dueAt: string | null;
  status: "PENDING" | "PAID";
  overdue: boolean;
  paidAt: string | null;
  method: PaymentMethodId | null;
  note: string | null;
  receiptSentAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  changeOrderId: string | null;
  /** Provider-invoice state (Square/Stripe/Stax), when this installment
   *  was invoiced through a connected rail rather than by hand. */
  invoiceProvider: string | null;
  invoiceUrl: string | null;
  invoiceSentAt: string | null;
  invoiceCanceledAt: string | null;
};

export type ChangeOrderDto = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  amountCents: number;
  status: "DRAFT" | "SENT" | "APPROVED" | "DECLINED";
  sentAt: string | null;
  decidedAt: string | null;
  approvedName: string | null;
  declineReason: string | null;
};

export type PaymentOverview = {
  proposalId: string;
  token: string;
  address: string;
  clientName: string;
  clientEmail: string;
  status: string;
  contractCents: number;
  paidCents: number;
  remainingCents: number;
  progressPct: number;
  completedAt: string | null;
  installments: InstallmentDto[];
  changeOrders: ChangeOrderDto[];
};

export type ActionResult<T = undefined> =
  | { ok: true; overview: PaymentOverview; extra?: T }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full || "there";
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

type SnapPayments = {
  stripePaymentUrl?: string | null;
  squarePaymentUrl?: string | null;
  company?: string;
  name?: string;
  email?: string;
};

function paymentUrlsFromSnap(snap: unknown): {
  stripeUrl: string | null;
  squareUrl: string | null;
  company: string;
} {
  const s = (snap ?? {}) as SnapPayments;
  return {
    stripeUrl: s.stripePaymentUrl ?? null,
    squareUrl: s.squarePaymentUrl ?? null,
    company: s.company ?? "Your contractor",
  };
}

function toInstallmentDto(
  i: {
    id: string;
    label: string;
    sortOrder: number;
    amountCents: number;
    dueAt: Date | null;
    status: string;
    paidAt: Date | null;
    method: string | null;
    note: string | null;
    receiptSentAt: Date | null;
    remindedAt: Date | null;
    reminderCount: number;
    changeOrderId: string | null;
    invoiceProvider: string | null;
    invoiceUrl: string | null;
    invoiceSentAt: Date | null;
    invoiceCanceledAt: Date | null;
  },
  now: Date,
): InstallmentDto {
  return {
    id: i.id,
    label: i.label,
    sortOrder: i.sortOrder,
    amountCents: i.amountCents,
    dueAt: i.dueAt ? i.dueAt.toISOString() : null,
    status: i.status as "PENDING" | "PAID",
    overdue: i.status === "PENDING" && !!i.dueAt && i.dueAt.getTime() < now.getTime(),
    paidAt: i.paidAt ? i.paidAt.toISOString() : null,
    method: (i.method as PaymentMethodId | null) ?? null,
    note: i.note,
    receiptSentAt: i.receiptSentAt ? i.receiptSentAt.toISOString() : null,
    remindedAt: i.remindedAt ? i.remindedAt.toISOString() : null,
    reminderCount: i.reminderCount,
    changeOrderId: i.changeOrderId,
    invoiceProvider: i.invoiceProvider,
    invoiceUrl: i.invoiceUrl,
    invoiceSentAt: i.invoiceSentAt ? i.invoiceSentAt.toISOString() : null,
    invoiceCanceledAt: i.invoiceCanceledAt
      ? i.invoiceCanceledAt.toISOString()
      : null,
  };
}

function toChangeOrderDto(c: {
  id: string;
  number: number;
  title: string;
  description: string | null;
  amountCents: number;
  status: string;
  sentAt: Date | null;
  decidedAt: Date | null;
  approvedName: string | null;
  declineReason: string | null;
}): ChangeOrderDto {
  return {
    id: c.id,
    number: c.number,
    title: c.title,
    description: c.description,
    amountCents: c.amountCents,
    status: c.status as ChangeOrderDto["status"],
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
    approvedName: c.approvedName,
    declineReason: c.declineReason,
  };
}

/* ------------------------------------------------------------------ */
/*  Schedule bootstrap + money-state sync                              */
/*                                                                     */
/*  ensureScheduleForProposal / createDefaultSchedule live in           */
/*  lib/payment-schedule.ts — as exports of this "use server" file      */
/*  they were unauthenticated public RPC endpoints that could rewrite   */
/*  any tenant's contract money. Callers here resolve ownership first.  */
/* ------------------------------------------------------------------ */

/**
 * Recomputes paidCents + completedAt from the installment rows (the
 * source of truth) inside an existing transaction. Returns whether the
 * job just crossed into fully-paid.
 */
async function syncMoneyState(
  tx: Prisma.TransactionClient,
  proposalId: string,
): Promise<{
  contractCents: number;
  paidCents: number;
  becameCompleted: boolean;
  completed: boolean;
}> {
  const [row, paidAgg] = await Promise.all([
    tx.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { totalCents: true, completedAt: true, status: true },
    }),
    tx.paymentInstallment.aggregate({
      where: { proposalId, status: "PAID" },
      _sum: { amountCents: true },
    }),
  ]);
  const paidCents = paidAgg._sum.amountCents ?? 0;
  const contractCents = row.totalCents;
  const fullyPaid =
    row.status === "ACCEPTED" && contractCents > 0 && paidCents >= contractCents;
  const becameCompleted = fullyPaid && !row.completedAt;

  await tx.proposal.update({
    where: { id: proposalId },
    data: {
      paidCents,
      completedAt: fullyPaid ? (row.completedAt ?? new Date()) : null,
    },
  });

  return {
    contractCents,
    paidCents,
    becameCompleted,
    completed: fullyPaid,
  };
}

/* ------------------------------------------------------------------ */
/*  Owner-scoped read                                                  */
/* ------------------------------------------------------------------ */

async function loadOverview(proposalId: string): Promise<PaymentOverview> {
  const row = await db.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    select: {
      id: true,
      publicToken: true,
      address: true,
      clientName: true,
      clientEmail: true,
      status: true,
      totalCents: true,
      paidCents: true,
      completedAt: true,
      installments: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      changeOrders: { orderBy: { number: "asc" } },
    },
  });
  const now = new Date();
  const remaining = Math.max(0, row.totalCents - row.paidCents);
  return {
    proposalId: row.id,
    token: row.publicToken,
    address: row.address,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    status: row.status,
    contractCents: row.totalCents,
    paidCents: row.paidCents,
    remainingCents: remaining,
    progressPct:
      row.totalCents > 0
        ? Math.min(100, Math.round((row.paidCents / row.totalCents) * 100))
        : 0,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    installments: row.installments.map((i) => toInstallmentDto(i, now)),
    changeOrders: row.changeOrders.map(toChangeOrderDto),
  };
}

async function ownedProposalId(proposalId: string): Promise<string | null> {
  const me = await getMe();
  if (!me) return null;
  const row = await db.proposal.findFirst({
    where: { id: proposalId, userId: me.user.id },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function getPaymentOverview(
  proposalId: string,
): Promise<PaymentOverview | null> {
  const id = await ownedProposalId(proposalId);
  if (!id) return null;
  await ensureScheduleForProposal(id);
  return loadOverview(id);
}

function revalidateAfterMutation(token?: string) {
  revalidatePath("/dashboard/proposals");
  revalidatePath("/dashboard");
  if (token) revalidatePath(`/p/${token}`);
}

/* ------------------------------------------------------------------ */
/*  Record / undo a payment                                            */
/* ------------------------------------------------------------------ */

export async function recordInstallmentPayment(args: {
  installmentId: string;
  method: PaymentMethodId;
  note?: string;
}): Promise<ActionResult<{ completed: boolean; receiptSent: boolean }>> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };

    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      include: {
        proposal: {
          select: {
            id: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
          },
        },
      },
    });
    if (!inst) {
      console.warn("[recordInstallmentPayment] not found / not owned", args.installmentId);
      return { ok: false, reason: "Payment not found" };
    }
    if (inst.status === "PAID") {
      console.warn("[recordInstallmentPayment] already paid", args.installmentId);
      return { ok: false, reason: "Already marked paid" };
    }

    // A live provider invoice must die before the hand-record: its
    // hosted pay page would stay payable (the provider even emailed a
    // link) while the poller stops watching PAID rows — a double
    // collection nobody notices. No apology email: nothing went out by
    // mistake, the money just arrived another way. If the client beat
    // us to it online, that payment is recorded instead of the check.
    if (inst.invoiceId && isInvoiceProvider(inst.invoiceProvider)) {
      const canceled = await cancelInvoiceForInstallment({
        ownerId: me.user.id,
        installmentId: inst.id,
        apologize: false,
      });
      if (canceled.ok && canceled.outcome === "already_paid") {
        revalidateAfterMutation(inst.proposal.publicToken);
        const ov = await loadOverview(inst.proposalId);
        return {
          ok: true,
          overview: ov,
          extra: { completed: !!ov.completedAt, receiptSent: false },
        };
      }
      // Cancel failed (dead key, provider down): still record the money
      // the contractor is holding — the stale invoice is the lesser bug.
    }

    const now = new Date();
    const sync = await db.$transaction(async (tx) => {
      await tx.paymentInstallment.update({
        where: { id: inst.id },
        data: {
          status: "PAID",
          paidAt: now,
          method: args.method,
          note: args.note?.trim() || inst.note,
        },
      });
      const s = await syncMoneyState(tx, inst.proposalId);
      await tx.proposalEvent.create({
        data: {
          proposalId: inst.proposalId,
          kind: "PAID",
          payload: {
            installmentId: inst.id,
            label: inst.label,
            amountCents: inst.amountCents,
            method: args.method,
          } as Prisma.InputJsonValue,
        },
      });
      if (s.becameCompleted) {
        await tx.proposalEvent.create({
          data: {
            proposalId: inst.proposalId,
            kind: "COMPLETED",
            payload: {
              paidCents: s.paidCents,
              contractCents: s.contractCents,
            } as Prisma.InputJsonValue,
          },
        });
      }
      return s;
    });

    // Auto-receipt to the client (best-effort — payment stays recorded
    // even if the email bounces; the drawer shows receipt status).
    let receiptSent = false;
    if (inst.proposal.clientEmail) {
      const snap = paymentUrlsFromSnap(inst.proposal.contractorSnap);
      const receipt = renderReceiptEmail({
        clientFirstName: firstName(inst.proposal.clientName || "there"),
        companyName: snap.company || me.profile.company || "Your contractor",
        address: inst.proposal.address,
        installmentLabel: inst.label,
        amountCents: inst.amountCents,
        method: args.method,
        paidAt: now,
        contractCents: sync.contractCents,
        paidToDateCents: sync.paidCents,
        remainingCents: Math.max(0, sync.contractCents - sync.paidCents),
        paidInFull: sync.completed,
        portalUrl: `${appBaseUrl()}/p/${inst.proposal.publicToken}`,
        receiptNumber: `RCPT-${inst.id.slice(-8).toUpperCase()}`,
      });
      const res = await sendEmailViaResend({
        to: inst.proposal.clientEmail,
        fromName: snap.company || me.profile.company || "FenceScan",
        replyTo: me.profile.email || me.user.email,
        subject: receipt.subject,
        html: receipt.html,
        text: receipt.text,
      });
      receiptSent = res.ok;
      if (res.ok) {
        await db.paymentInstallment.update({
          where: { id: inst.id },
          data: { receiptSentAt: new Date() },
        });
      }
    }

    revalidateAfterMutation(inst.proposal.publicToken);
    return {
      ok: true,
      overview: await loadOverview(inst.proposalId),
      extra: { completed: sync.completed, receiptSent },
    };
  } catch (e) {
    console.error("[recordInstallmentPayment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't record the payment",
    };
  }
}

export async function undoInstallmentPayment(args: {
  installmentId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      select: {
        id: true,
        status: true,
        proposalId: true,
        invoiceId: true,
        proposal: { select: { publicToken: true } },
      },
    });
    if (!inst) return { ok: false, reason: "Payment not found" };
    if (inst.status !== "PAID") return { ok: false, reason: "Not marked paid" };

    await db.$transaction(async (tx) => {
      await tx.paymentInstallment.update({
        where: { id: inst.id },
        data: {
          status: "PENDING",
          paidAt: null,
          method: null,
          receiptSentAt: null,
          // A provider-paid installment must also shed its invoice —
          // otherwise the 2-minute poller sees PENDING + a paid invoice
          // and re-settles the undo within a cron tick, forever. The
          // cancel hold keeps the portal from quietly re-minting; an
          // explicit re-invoice lifts it.
          ...(inst.invoiceId
            ? {
                invoiceProvider: null,
                invoiceId: null,
                invoiceUrl: null,
                invoiceSentAt: null,
                invoiceCanceledAt: new Date(),
              }
            : {}),
        },
      });
      await syncMoneyState(tx, inst.proposalId);
    });

    revalidateAfterMutation(inst.proposal.publicToken);
    return { ok: true, overview: await loadOverview(inst.proposalId) };
  } catch (e) {
    console.error("[undoInstallmentPayment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't undo the payment",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Edit the schedule                                                  */
/* ------------------------------------------------------------------ */

export async function addInstallment(args: {
  proposalId: string;
  label: string;
  amountCents: number;
  dueAt?: string | null;
}): Promise<ActionResult> {
  try {
    const id = await ownedProposalId(args.proposalId);
    if (!id) return { ok: false, reason: "Proposal not found" };
    const label = args.label.trim();
    if (!label) return { ok: false, reason: "Give the payment a label" };
    if (!Number.isFinite(args.amountCents) || args.amountCents <= 0) {
      return { ok: false, reason: "Amount must be greater than zero" };
    }
    const max = await db.paymentInstallment.aggregate({
      where: { proposalId: id },
      _max: { sortOrder: true },
    });
    await db.paymentInstallment.create({
      data: {
        proposalId: id,
        label,
        amountCents: Math.round(args.amountCents),
        dueAt: args.dueAt ? new Date(args.dueAt) : null,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    revalidateAfterMutation();
    return { ok: true, overview: await loadOverview(id) };
  } catch (e) {
    console.error("[addInstallment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't add the payment",
    };
  }
}

export async function updateInstallment(args: {
  installmentId: string;
  label?: string;
  amountCents?: number;
  dueAt?: string | null;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      select: {
        id: true,
        status: true,
        proposalId: true,
        changeOrderId: true,
        invoiceId: true,
        invoiceProvider: true,
      },
    });
    if (!inst) return { ok: false, reason: "Payment not found" };
    if (inst.status === "PAID") {
      return { ok: false, reason: "Undo the payment before editing it" };
    }
    if (
      args.amountCents !== undefined &&
      (!Number.isFinite(args.amountCents) || args.amountCents <= 0)
    ) {
      return { ok: false, reason: "Amount must be greater than zero" };
    }
    if (inst.changeOrderId && args.amountCents !== undefined) {
      return {
        ok: false,
        reason: "Change-order amounts are set by the approved change order",
      };
    }
    // A live provider invoice bills the OLD amount and due date —
    // changing either under it means the client is billed one thing and
    // shown another. Cancel first, then edit. (Label edits are free.)
    if (
      inst.invoiceId &&
      (args.amountCents !== undefined || args.dueAt !== undefined)
    ) {
      return {
        ok: false,
        reason: `A ${providerWord(inst.invoiceProvider)} invoice for this payment is already out — cancel it first, then edit.`,
      };
    }
    await db.paymentInstallment.update({
      where: { id: inst.id },
      data: {
        label: args.label?.trim() || undefined,
        amountCents:
          args.amountCents !== undefined
            ? Math.round(args.amountCents)
            : undefined,
        dueAt:
          args.dueAt === undefined
            ? undefined
            : args.dueAt
              ? new Date(args.dueAt)
              : null,
        // Note: a past invoice-cancel's hold (invoiceCanceledAt) is NOT
        // lifted by edits — the client was told to disregard a payment
        // request, so only an explicit "Send invoice" re-arms links.
      },
    });
    revalidateAfterMutation();
    return { ok: true, overview: await loadOverview(inst.proposalId) };
  } catch (e) {
    console.error("[updateInstallment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't update the payment",
    };
  }
}

export async function deleteInstallment(args: {
  installmentId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      select: {
        id: true,
        status: true,
        proposalId: true,
        changeOrderId: true,
        invoiceId: true,
        invoiceProvider: true,
      },
    });
    if (!inst) return { ok: false, reason: "Payment not found" };
    if (inst.status === "PAID") {
      return { ok: false, reason: "Undo the payment before removing it" };
    }
    if (inst.changeOrderId) {
      return {
        ok: false,
        reason: "This payment is tied to an approved change order",
      };
    }
    // Deleting the row would orphan a live pay page the client can still
    // pay — money with nowhere to land. Cancel the invoice first.
    if (inst.invoiceId) {
      return {
        ok: false,
        reason: `A ${providerWord(inst.invoiceProvider)} invoice is out for this payment — cancel it first, then remove.`,
      };
    }
    await db.paymentInstallment.delete({ where: { id: inst.id } });
    revalidateAfterMutation();
    return { ok: true, overview: await loadOverview(inst.proposalId) };
  } catch (e) {
    console.error("[deleteInstallment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't remove the payment",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Reminders + receipts                                               */
/* ------------------------------------------------------------------ */

export async function sendInstallmentReminder(args: {
  installmentId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const emailBudget = await checkUserEmailBudget(me.user.id, "sendInstallmentReminder");
    if (!emailBudget.ok) {
      console.warn("[sendInstallmentReminder] email budget blocked:", emailBudget.reason);
      return { ok: false, reason: emailBudget.reason };
    }
    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      include: {
        proposal: {
          select: {
            id: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
          },
        },
      },
    });
    if (!inst) return { ok: false, reason: "Payment not found" };
    if (inst.status === "PAID") return { ok: false, reason: "Already paid" };
    if (!inst.proposal.clientEmail) {
      return { ok: false, reason: "No client email on this proposal" };
    }

    const snap = paymentUrlsFromSnap(inst.proposal.contractorSnap);
    const now = new Date();
    // Give the nudge a real pay button: a hosted invoice page for this
    // exact amount on the connected rail, minted quietly if none exists
    // yet. Null (no rail, canceled invoice) falls back to the generic
    // pasted links below.
    const payUrl = await ensurePayLinkForInstallment(inst.id);
    const reminder = renderReminderEmail({
      clientFirstName: firstName(inst.proposal.clientName || "there"),
      companyName: snap.company || me.profile.company || "Your contractor",
      address: inst.proposal.address,
      installmentLabel: inst.label,
      amountCents: inst.amountCents,
      dueAt: inst.dueAt,
      overdue: !!inst.dueAt && inst.dueAt.getTime() < now.getTime(),
      payUrl,
      // Snapshot first, live profile as fallback — links connected after
      // the proposal was sent still reach the client.
      stripeUrl: snap.stripeUrl ?? me.profile.payments.stripeUrl,
      squareUrl: snap.squareUrl ?? me.profile.payments.squareUrl,
      portalUrl: `${appBaseUrl()}/p/${inst.proposal.publicToken}`,
    });
    const res = await sendEmailViaResend({
      to: inst.proposal.clientEmail,
      fromName: snap.company || me.profile.company || "FenceScan",
      replyTo: me.profile.email || me.user.email,
      subject: reminder.subject,
      html: reminder.html,
      text: reminder.text,
    });
    if (!res.ok) {
      console.warn("[sendInstallmentReminder] send failed:", res.reason);
      return { ok: false, reason: res.reason };
    }

    await db.paymentInstallment.update({
      where: { id: inst.id },
      data: { remindedAt: now, reminderCount: { increment: 1 } },
    });
    return { ok: true, overview: await loadOverview(inst.proposalId) };
  } catch (e) {
    console.error("[sendInstallmentReminder] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't send the reminder",
    };
  }
}

export async function resendReceipt(args: {
  installmentId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const emailBudget = await checkUserEmailBudget(me.user.id, "resendReceipt");
    if (!emailBudget.ok) return { ok: false, reason: emailBudget.reason };
    const inst = await db.paymentInstallment.findFirst({
      where: { id: args.installmentId, proposal: { userId: me.user.id } },
      include: {
        proposal: {
          select: {
            id: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
            totalCents: true,
            paidCents: true,
            completedAt: true,
          },
        },
      },
    });
    if (!inst) return { ok: false, reason: "Payment not found" };
    if (inst.status !== "PAID" || !inst.paidAt) {
      return { ok: false, reason: "Only paid installments have receipts" };
    }
    if (!inst.proposal.clientEmail) {
      return { ok: false, reason: "No client email on this proposal" };
    }

    const snap = paymentUrlsFromSnap(inst.proposal.contractorSnap);
    const receipt = renderReceiptEmail({
      clientFirstName: firstName(inst.proposal.clientName || "there"),
      companyName: snap.company || me.profile.company || "Your contractor",
      address: inst.proposal.address,
      installmentLabel: inst.label,
      amountCents: inst.amountCents,
      method: inst.method ?? "OTHER",
      paidAt: inst.paidAt,
      contractCents: inst.proposal.totalCents,
      paidToDateCents: inst.proposal.paidCents,
      remainingCents: Math.max(
        0,
        inst.proposal.totalCents - inst.proposal.paidCents,
      ),
      paidInFull: !!inst.proposal.completedAt,
      portalUrl: `${appBaseUrl()}/p/${inst.proposal.publicToken}`,
      receiptNumber: `RCPT-${inst.id.slice(-8).toUpperCase()}`,
    });
    const res = await sendEmailViaResend({
      to: inst.proposal.clientEmail,
      fromName: snap.company || me.profile.company || "FenceScan",
      replyTo: me.profile.email || me.user.email,
      subject: receipt.subject,
      html: receipt.html,
      text: receipt.text,
    });
    if (!res.ok) return { ok: false, reason: res.reason };

    await db.paymentInstallment.update({
      where: { id: inst.id },
      data: { receiptSentAt: new Date() },
    });
    return { ok: true, overview: await loadOverview(inst.proposalId) };
  } catch (e) {
    console.error("[resendReceipt] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't send the receipt",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Change orders (contractor side)                                    */
/* ------------------------------------------------------------------ */

export async function createChangeOrder(args: {
  proposalId: string;
  title: string;
  description?: string;
  amountCents: number;
}): Promise<ActionResult> {
  try {
    const id = await ownedProposalId(args.proposalId);
    if (!id) return { ok: false, reason: "Proposal not found" };
    const title = args.title.trim();
    if (!title) return { ok: false, reason: "Give the change order a title" };
    if (!Number.isFinite(args.amountCents) || args.amountCents <= 0) {
      return { ok: false, reason: "Amount must be greater than zero" };
    }
    const max = await db.changeOrder.aggregate({
      where: { proposalId: id },
      _max: { number: true },
    });
    await db.changeOrder.create({
      data: {
        proposalId: id,
        number: (max._max.number ?? 0) + 1,
        title,
        description: args.description?.trim() || null,
        amountCents: Math.round(args.amountCents),
      },
    });
    revalidateAfterMutation();
    return { ok: true, overview: await loadOverview(id) };
  } catch (e) {
    console.error("[createChangeOrder] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't create the change order",
    };
  }
}

export async function deleteChangeOrder(args: {
  changeOrderId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const co = await db.changeOrder.findFirst({
      where: { id: args.changeOrderId, proposal: { userId: me.user.id } },
      select: { id: true, status: true, proposalId: true },
    });
    if (!co) return { ok: false, reason: "Change order not found" };
    if (co.status === "APPROVED") {
      return { ok: false, reason: "Approved change orders can't be deleted" };
    }
    await db.changeOrder.delete({ where: { id: co.id } });
    revalidateAfterMutation();
    return { ok: true, overview: await loadOverview(co.proposalId) };
  } catch (e) {
    console.error("[deleteChangeOrder] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't delete the change order",
    };
  }
}

export async function sendChangeOrder(args: {
  changeOrderId: string;
}): Promise<ActionResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const emailBudget = await checkUserEmailBudget(me.user.id, "sendChangeOrder");
    if (!emailBudget.ok) return { ok: false, reason: emailBudget.reason };
    const co = await db.changeOrder.findFirst({
      where: { id: args.changeOrderId, proposal: { userId: me.user.id } },
      include: {
        proposal: {
          select: {
            id: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
            totalCents: true,
          },
        },
      },
    });
    if (!co) return { ok: false, reason: "Change order not found" };
    if (co.status === "APPROVED" || co.status === "DECLINED") {
      return { ok: false, reason: `Already ${co.status.toLowerCase()}` };
    }
    if (!co.proposal.clientEmail) {
      return { ok: false, reason: "No client email on this proposal" };
    }

    const snap = paymentUrlsFromSnap(co.proposal.contractorSnap);
    const email = renderChangeOrderEmail({
      clientFirstName: firstName(co.proposal.clientName || "there"),
      companyName: snap.company || me.profile.company || "Your contractor",
      address: co.proposal.address,
      number: co.number,
      title: co.title,
      description: co.description,
      amountCents: co.amountCents,
      newContractCents: co.proposal.totalCents + co.amountCents,
      portalUrl: `${appBaseUrl()}/p/${co.proposal.publicToken}#change-orders`,
    });
    const res = await sendEmailViaResend({
      to: co.proposal.clientEmail,
      fromName: snap.company || me.profile.company || "FenceScan",
      replyTo: me.profile.email || me.user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (!res.ok) return { ok: false, reason: res.reason };

    await db.$transaction(async (tx) => {
      await tx.changeOrder.update({
        where: { id: co.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      await tx.proposalEvent.create({
        data: {
          proposalId: co.proposalId,
          kind: "CHANGE_ORDER_SENT",
          payload: {
            changeOrderId: co.id,
            number: co.number,
            title: co.title,
            amountCents: co.amountCents,
          } as Prisma.InputJsonValue,
        },
      });
    });

    revalidateAfterMutation(co.proposal.publicToken);
    return { ok: true, overview: await loadOverview(co.proposalId) };
  } catch (e) {
    console.error("[sendChangeOrder] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't send the change order",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Public (token-gated) portal state + change-order decision          */
/* ------------------------------------------------------------------ */

export type PortalPaymentState = {
  status: string;
  completedAt: string | null;
  contractCents: number;
  paidCents: number;
  remainingCents: number;
  progressPct: number;
  clientName: string;
  /** Hosted Square/Stripe/Stax invoice page for the next payment due —
   *  the exact amount, card or bank. When present it IS the pay button;
   *  the generic payLinks below are only a fallback. */
  payNowUrl: string | null;
  /** Pay-online links: proposal snapshot with a live-profile fallback,
   *  so links connected AFTER a proposal was sent still show up. */
  payLinks: { stripeUrl: string | null; squareUrl: string | null };
  installments: Array<{
    id: string;
    label: string;
    amountCents: number;
    dueAt: string | null;
    status: "PENDING" | "PAID";
    overdue: boolean;
    paidAt: string | null;
    method: PaymentMethodId | null;
  }>;
  changeOrders: Array<{
    id: string;
    number: number;
    title: string;
    description: string | null;
    amountCents: number;
    status: "DRAFT" | "SENT" | "APPROVED" | "DECLINED";
    decidedAt: string | null;
  }>;
};

/**
 * Portal-side payment state, keyed only by the public token. Returns
 * null for tokens without a real proposal (demo mode) and for
 * proposals that haven't been accepted yet — the portal only shows the
 * payment hub after acceptance.
 */
export async function getPortalStateByToken(
  token: string,
): Promise<PortalPaymentState | null> {
  if (!token) return null;
  const found = await db.proposal.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true },
  });
  if (!found || found.status !== "ACCEPTED") return null;

  await ensureScheduleForProposal(found.id);

  const row = await db.proposal.findUniqueOrThrow({
    where: { id: found.id },
    select: {
      status: true,
      completedAt: true,
      totalCents: true,
      paidCents: true,
      clientName: true,
      contractorSnap: true,
      user: {
        select: {
          contractorProfile: {
            select: { stripePaymentUrl: true, squarePaymentUrl: true },
          },
        },
      },
      installments: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      changeOrders: {
        where: { status: { in: ["SENT", "APPROVED", "DECLINED"] } },
        orderBy: { number: "asc" },
      },
    },
  });
  const now = new Date();
  const snap = paymentUrlsFromSnap(row.contractorSnap);
  const liveProfile = row.user?.contractorProfile;
  // A live hosted invoice for the next unpaid installment. The already-
  // loaded row answers the common case for free; the helper only runs
  // when a link might need minting (payWith rail chosen at send time).
  // Never throws; null just means the portal falls back to the generic
  // pasted links.
  const nextDue = row.installments.find((i) => i.status === "PENDING");
  const payNowUrl = nextDue
    ? (nextDue.invoiceUrl ??
      (nextDue.invoiceCanceledAt
        ? null
        : await ensurePayLinkForInstallment(nextDue.id)))
    : null;
  return {
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    contractCents: row.totalCents,
    paidCents: row.paidCents,
    remainingCents: Math.max(0, row.totalCents - row.paidCents),
    progressPct:
      row.totalCents > 0
        ? Math.min(100, Math.round((row.paidCents / row.totalCents) * 100))
        : 0,
    clientName: row.clientName,
    payNowUrl,
    payLinks: {
      stripeUrl: snap.stripeUrl ?? liveProfile?.stripePaymentUrl ?? null,
      squareUrl: snap.squareUrl ?? liveProfile?.squarePaymentUrl ?? null,
    },
    installments: row.installments.map((i) => ({
      id: i.id,
      label: i.label,
      amountCents: i.amountCents,
      dueAt: i.dueAt ? i.dueAt.toISOString() : null,
      status: i.status as "PENDING" | "PAID",
      overdue:
        i.status === "PENDING" && !!i.dueAt && i.dueAt.getTime() < now.getTime(),
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
      method: (i.method as PaymentMethodId | null) ?? null,
    })),
    changeOrders: row.changeOrders.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      description: c.description,
      amountCents: c.amountCents,
      status: c.status as "DRAFT" | "SENT" | "APPROVED" | "DECLINED",
      decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
    })),
  };
}

export type RespondToChangeOrderResult =
  | { ok: true; state: PortalPaymentState }
  | { ok: false; reason: string };

/**
 * Homeowner-side change-order decision from /p/[token]. Token-gated —
 * the change order must belong to the proposal behind the token and be
 * in SENT state. Approval appends an installment and bumps the contract
 * total in one transaction; if the job was already marked done, the new
 * balance reopens it.
 */
export async function respondToChangeOrder(args: {
  token: string;
  changeOrderId: string;
  decision: "approve" | "decline";
  name: string;
  declineReason?: string;
}): Promise<RespondToChangeOrderResult> {
  try {
    // Unauthenticated write that can bump the contract total and email
    // the contractor — per-token + per-IP limited. Decided COs are
    // already idempotent, so the cap only ever bites a loop.
    const guard = await checkPortalWrite(
      POLICIES.portalChangeOrder,
      args.token,
      "respondToChangeOrder",
    );
    if (!guard.ok) {
      return { ok: false, reason: guard.reason };
    }

    const name = args.name.trim();
    if (args.decision === "approve" && name.length < 2) {
      return { ok: false, reason: "Type your full name to approve" };
    }

    const co = await db.changeOrder.findFirst({
      where: {
        id: args.changeOrderId,
        proposal: { publicToken: args.token },
      },
      include: {
        proposal: {
          select: {
            id: true,
            publicToken: true,
            address: true,
            clientName: true,
            totalCents: true,
            user: {
              select: {
                email: true,
                name: true,
                contractorProfile: { select: { email: true, contractorName: true } },
              },
            },
          },
        },
      },
    });
    if (!co) return { ok: false, reason: "Change order not found" };
    if (co.status === "APPROVED" || co.status === "DECLINED") {
      // Idempotent: re-submitting a decided CO just returns fresh state.
      const state = await getPortalStateByToken(args.token);
      if (state) return { ok: true, state };
      return { ok: false, reason: `Already ${co.status.toLowerCase()}` };
    }
    if (co.status !== "SENT") {
      return { ok: false, reason: "This change order isn't awaiting approval" };
    }

    const now = new Date();
    if (args.decision === "approve") {
      await db.$transaction(async (tx) => {
        await tx.changeOrder.update({
          where: { id: co.id },
          data: { status: "APPROVED", decidedAt: now, approvedName: name },
        });
        const maxSort = await tx.paymentInstallment.aggregate({
          where: { proposalId: co.proposalId },
          _max: { sortOrder: true },
        });
        await tx.paymentInstallment.create({
          data: {
            proposalId: co.proposalId,
            label: `Change order #${co.number} — ${co.title}`,
            amountCents: co.amountCents,
            dueAt: null,
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
            changeOrderId: co.id,
          },
        });
        await tx.proposal.update({
          where: { id: co.proposalId },
          data: { totalCents: { increment: co.amountCents } },
        });
        // Recompute paid/completed against the new, larger contract.
        await syncMoneyState(tx, co.proposalId);
        await tx.proposalEvent.create({
          data: {
            proposalId: co.proposalId,
            kind: "CHANGE_ORDER_APPROVED",
            payload: {
              changeOrderId: co.id,
              number: co.number,
              title: co.title,
              amountCents: co.amountCents,
              approvedName: name,
            } as Prisma.InputJsonValue,
          },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.changeOrder.update({
          where: { id: co.id },
          data: {
            status: "DECLINED",
            decidedAt: now,
            declineReason: args.declineReason?.trim() || null,
          },
        });
        await tx.proposalEvent.create({
          data: {
            proposalId: co.proposalId,
            kind: "CHANGE_ORDER_DECLINED",
            payload: {
              changeOrderId: co.id,
              number: co.number,
              title: co.title,
              amountCents: co.amountCents,
              reason: args.declineReason?.trim() || null,
            } as Prisma.InputJsonValue,
          },
        });
      });
    }

    // Best-effort contractor notification.
    const contractorEmail =
      co.proposal.user?.contractorProfile?.email ?? co.proposal.user?.email;
    if (contractorEmail) {
      try {
        const email = renderChangeOrderDecisionEmail({
          contractorName:
            co.proposal.user?.contractorProfile?.contractorName ??
            co.proposal.user?.name ??
            "there",
          clientName: name || co.proposal.clientName || "Your client",
          address: co.proposal.address,
          number: co.number,
          title: co.title,
          amountCents: co.amountCents,
          approved: args.decision === "approve",
          declineReason: args.declineReason ?? null,
          dashUrl: `${appBaseUrl()}/dashboard/proposals`,
        });
        await sendEmailViaResend({
          to: contractorEmail,
          fromName: "FenceScan",
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
      } catch (e) {
        console.warn("[respondToChangeOrder] contractor email threw", e);
      }
    }

    revalidateAfterMutation(co.proposal.publicToken);
    const state = await getPortalStateByToken(args.token);
    if (!state) return { ok: false, reason: "Couldn't reload the project" };
    return { ok: true, state };
  } catch (e) {
    console.error("[respondToChangeOrder] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't record your decision",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Smart dashboard: money stats + needs-attention feed                */
/* ------------------------------------------------------------------ */

export type PaymentStats = {
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  collectedMtdCents: number;
  jobsInProgress: number;
  jobsDone: number;
  pendingChangeOrders: number;
};

export async function getPaymentStats(): Promise<PaymentStats> {
  const me = await getMe();
  if (!me) {
    return {
      outstandingCents: 0,
      overdueCents: 0,
      overdueCount: 0,
      collectedMtdCents: 0,
      jobsInProgress: 0,
      jobsDone: 0,
      pendingChangeOrders: 0,
    };
  }
  const userId = me.user.id;
  const now = new Date();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [inProgress, done, overdue, collected, pendingCOs] = await Promise.all([
    db.proposal.findMany({
      where: { userId, status: "ACCEPTED", completedAt: null },
      select: { totalCents: true, paidCents: true },
    }),
    db.proposal.count({
      where: { userId, status: "ACCEPTED", completedAt: { not: null } },
    }),
    db.paymentInstallment.findMany({
      where: {
        proposal: { userId },
        status: "PENDING",
        dueAt: { lt: now },
      },
      select: { amountCents: true },
    }),
    db.paymentInstallment.aggregate({
      where: {
        proposal: { userId },
        status: "PAID",
        paidAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
    db.changeOrder.count({
      where: { proposal: { userId }, status: "SENT" },
    }),
  ]);

  return {
    outstandingCents: inProgress.reduce(
      (sum, p) => sum + Math.max(0, p.totalCents - p.paidCents),
      0,
    ),
    overdueCents: overdue.reduce((sum, i) => sum + i.amountCents, 0),
    overdueCount: overdue.length,
    collectedMtdCents: collected._sum.amountCents ?? 0,
    jobsInProgress: inProgress.length,
    jobsDone: done,
    pendingChangeOrders: pendingCOs,
  };
}

export type AttentionItem = {
  id: string;
  kind:
    | "overdue_payment"
    | "awaiting_deposit"
    | "pending_change_order"
    | "price_request"
    | "expiring_proposal"
    | "stale_draft"
    | "unopened_proposal";
  title: string;
  detail: string;
  href: string;
  urgency: "high" | "medium" | "low";
  proposalId: string;
};

/**
 * The "smart" to-do feed: everything across the pipeline that needs a
 * human nudge, ranked by urgency. Powers the Overview attention card.
 */
export async function getNeedsAttention(): Promise<AttentionItem[]> {
  const me = await getMe();
  if (!me) return [];
  const userId = me.user.id;
  const now = new Date();
  const days = (n: number) => new Date(now.getTime() - n * 86400_000);
  const ahead = (n: number) => new Date(now.getTime() + n * 86400_000);

  const [overdueInstallments, pendingCOs, openDiscounts, expiring, staleDrafts, unopened] =
    await Promise.all([
      db.paymentInstallment.findMany({
        where: {
          proposal: { userId },
          status: "PENDING",
          dueAt: { lt: now },
        },
        include: {
          proposal: { select: { id: true, address: true, clientName: true } },
        },
        orderBy: { dueAt: "asc" },
        take: 12,
      }),
      db.changeOrder.findMany({
        where: { proposal: { userId }, status: "SENT" },
        include: {
          proposal: { select: { id: true, address: true, clientName: true } },
        },
        orderBy: { sentAt: "asc" },
        take: 8,
      }),
      db.discountRequest.findMany({
        where: { proposal: { userId }, status: "OPEN", turn: "CONTRACTOR" },
        include: {
          proposal: { select: { id: true, address: true, clientName: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      db.proposal.findMany({
        where: {
          userId,
          status: { in: ["SENT", "VIEWED"] },
          expiresAt: { gte: now, lte: ahead(5) },
        },
        select: { id: true, address: true, clientName: true, expiresAt: true },
        take: 8,
      }),
      db.proposal.findMany({
        where: {
          userId,
          status: "DRAFT",
          updatedAt: { lt: days(7) },
        },
        select: { id: true, address: true, updatedAt: true },
        orderBy: { updatedAt: "asc" },
        take: 5,
      }),
      db.proposal.findMany({
        where: {
          userId,
          status: "SENT",
          sentAt: { lt: days(4) },
          events: { none: { kind: "VIEWED" } },
        },
        select: { id: true, address: true, clientName: true, sentAt: true },
        take: 5,
      }),
    ]);

  const items: AttentionItem[] = [];

  for (const i of overdueInstallments) {
    const daysLate = Math.max(
      1,
      Math.floor((now.getTime() - (i.dueAt?.getTime() ?? 0)) / 86400_000),
    );
    const isDeposit = i.label.toLowerCase().startsWith("deposit");
    items.push({
      id: `inst-${i.id}`,
      kind: isDeposit ? "awaiting_deposit" : "overdue_payment",
      title: `${money(i.amountCents)} ${isDeposit ? "deposit" : "payment"} overdue`,
      detail: `${i.proposal.clientName || i.proposal.address} · ${daysLate}d late · ${i.label}`,
      href: `/dashboard/proposals?pay=${i.proposal.id}`,
      urgency: daysLate >= 7 ? "high" : "medium",
      proposalId: i.proposal.id,
    });
  }

  for (const c of pendingCOs) {
    const daysOut = c.sentAt
      ? Math.floor((now.getTime() - c.sentAt.getTime()) / 86400_000)
      : 0;
    items.push({
      id: `co-${c.id}`,
      kind: "pending_change_order",
      title: `Change order #${c.number} awaiting client`,
      detail: `${c.proposal.clientName || c.proposal.address} · ${money(c.amountCents)} · sent ${daysOut}d ago`,
      href: `/dashboard/proposals?pay=${c.proposal.id}`,
      urgency: daysOut >= 3 ? "medium" : "low",
      proposalId: c.proposal.id,
    });
  }

  for (const d of openDiscounts) {
    const daysOut = Math.floor(
      (now.getTime() - d.createdAt.getTime()) / 86400_000,
    );
    items.push({
      id: `disc-${d.id}`,
      kind: "price_request",
      title: `Price request — ${money(d.currentCents)} asked`,
      detail: `${d.proposal.clientName || d.proposal.address} · was ${money(d.listedCents)} · ${daysOut === 0 ? "today" : `${daysOut}d ago`}`,
      href: `/dashboard/proposals?deal=${d.proposal.id}`,
      urgency: daysOut >= 2 ? "high" : "medium",
      proposalId: d.proposal.id,
    });
  }

  for (const p of expiring) {
    const daysLeft = Math.max(
      0,
      Math.ceil(((p.expiresAt?.getTime() ?? 0) - now.getTime()) / 86400_000),
    );
    items.push({
      id: `exp-${p.id}`,
      kind: "expiring_proposal",
      title: `Proposal expires in ${daysLeft}d`,
      detail: `${p.clientName || p.address} — nudge before pricing unlocks`,
      href: `/proposal?id=${p.id}`,
      urgency: daysLeft <= 2 ? "high" : "medium",
      proposalId: p.id,
    });
  }

  for (const p of unopened) {
    items.push({
      id: `open-${p.id}`,
      kind: "unopened_proposal",
      title: "Sent but never opened",
      detail: `${p.clientName || p.address} — consider a follow-up call`,
      href: `/proposal?id=${p.id}`,
      urgency: "low",
      proposalId: p.id,
    });
  }

  for (const p of staleDrafts) {
    items.push({
      id: `draft-${p.id}`,
      kind: "stale_draft",
      title: "Draft going stale",
      detail: `${p.address || "Untitled"} — untouched for a week`,
      href: `/proposal?id=${p.id}`,
      urgency: "low",
      proposalId: p.id,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency]).slice(0, 10);
}
