import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { sendEmailViaResend } from "@/lib/email/resend";
import { renderInvoiceApologyEmail } from "@/lib/email/payment-templates";
import { appBaseUrl } from "@/lib/base-url";
import {
  cancelSquareInvoice,
  createSquareInvoice,
  squareInvoiceStatus,
} from "@/lib/payments/square";
import {
  cancelStaxInvoice,
  createStaxInvoice,
  staxInvoiceStatus,
} from "@/lib/payments/stax";
import {
  cancelStripeInvoice,
  createStripeInvoice,
  stripeInvoiceStatus,
} from "@/lib/payments/stripe-invoices";

/**
 * provider-invoices.ts — one place for "invoice this installment through
 * Square/Stripe/Stax" and "did anybody pay yet".
 *
 * Owner-scoped (no session) so both the dashboard action and the status
 * cron share it. Keys are per-contractor (payment_connections): every
 * contractor connects their own processor account, and money always
 * moves on THEIR account — the platform never touches it. Sending
 * stamps the installment with the provider's invoice id; the poller
 * asks each provider about its open invoices and, on payment, settles
 * the installment through the SAME bookkeeping a hand-recorded payment
 * gets — paid stamp, money resync, completion cascade, PAID event —
 * then emails the contractor the good news.
 */

export type InvoiceProvider = "square" | "stripe" | "stax";

/** Display order everywhere a rail list renders. */
export const INVOICE_PROVIDERS: InvoiceProvider[] = ["square", "stripe", "stax"];

export function providerWord(p: string | null | undefined): string {
  return p === "square" ? "Square" : p === "stripe" ? "Stripe" : p === "stax" ? "Stax" : "provider";
}

export function isInvoiceProvider(v: unknown): v is InvoiceProvider {
  return v === "square" || v === "stripe" || v === "stax";
}

/** The contractor's decrypted key for one rail, or null if not connected. */
export async function getRailKey(
  userId: string,
  provider: InvoiceProvider,
): Promise<string | null> {
  const row = await db.paymentConnection.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true, encryptedKey: true },
  });
  if (!row) return null;
  void db.paymentConnection
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return decrypt(row.encryptedKey);
}

/** Which rails this contractor connected — drives which buttons render. */
export async function availableInvoiceProviders(
  userId: string,
): Promise<InvoiceProvider[]> {
  const rows = await db.paymentConnection.findMany({
    where: { userId },
    select: { provider: true },
  });
  const have = new Set(rows.map((r) => r.provider));
  return INVOICE_PROVIDERS.filter((p) => have.has(p));
}

type CreateArgs = {
  apiKey: string;
  amountCents: number;
  title: string;
  clientName: string | null;
  clientEmail: string;
  dueDate?: string | null;
  quiet?: boolean;
  achOnly?: boolean;
};

function createInvoiceOn(provider: InvoiceProvider, args: CreateArgs) {
  if (provider === "square") return createSquareInvoice(args);
  if (provider === "stripe") return createStripeInvoice(args);
  return createStaxInvoice(args);
}

function invoiceStatusOn(provider: InvoiceProvider, apiKey: string, invoiceId: string) {
  if (provider === "square") return squareInvoiceStatus(apiKey, invoiceId);
  if (provider === "stripe") return stripeInvoiceStatus(apiKey, invoiceId);
  return staxInvoiceStatus(apiKey, invoiceId);
}

function cancelInvoiceOn(provider: InvoiceProvider, apiKey: string, invoiceId: string) {
  if (provider === "square") return cancelSquareInvoice(apiKey, invoiceId);
  if (provider === "stripe") return cancelStripeInvoice(apiKey, invoiceId);
  return cancelStaxInvoice(apiKey, invoiceId);
}

export async function sendInvoiceForInstallment(args: {
  ownerId: string;
  installmentId: string;
  /** Omitted = first connected rail (display order). */
  provider?: InvoiceProvider;
  /** Quiet = the provider does NOT email the client; we only want the
   *  hosted pay page to put behind our own portal/reminder buttons. */
  quiet?: boolean;
  /** Bank transfer only, no card — the card fee on a five-figure fence
   *  job is worth a separate button. Square/Stripe only. */
  achOnly?: boolean;
}): Promise<{ ok: true; url: string | null } | { ok: false; reason: string }> {
  const inst = await db.paymentInstallment.findFirst({
    where: { id: args.installmentId, proposal: { userId: args.ownerId } },
    include: {
      proposal: {
        select: { id: true, clientName: true, clientEmail: true, address: true },
      },
    },
  });
  if (!inst) return { ok: false, reason: "Payment not found" };
  if (inst.status === "PAID") return { ok: false, reason: "Already paid" };
  if (inst.invoiceId)
    return {
      ok: false,
      reason: `A ${providerWord(inst.invoiceProvider)} pay link is already live for this payment — the client sees it in their portal and reminders.`,
    };
  if (!inst.proposal.clientEmail)
    return { ok: false, reason: "No client email on the proposal — add one first" };

  const provider =
    args.provider ?? (await availableInvoiceProviders(args.ownerId))[0] ?? null;
  if (!provider)
    return {
      ok: false,
      reason:
        "No payment rail connected — connect Square, Stripe, or Stax in Settings → Payments",
    };
  // Stax can't restrict a single invoice to bank-only — ACH is an
  // account-level Stax setting. Refusing beats silently sending a
  // card-enabled invoice the contractor believes is bank-only.
  if (args.achOnly && provider === "stax")
    return {
      ok: false,
      reason:
        "Stax invoices can't be limited to bank-only — ACH is a Stax account setting. Send it as card + bank instead.",
    };

  const apiKey = await getRailKey(args.ownerId, provider);
  if (!apiKey)
    return {
      ok: false,
      reason: `No ${providerWord(provider)} key — connect it in Settings → Payments`,
    };

  const title = [inst.label, inst.proposal.clientName, inst.proposal.address]
    .filter(Boolean)
    .join(" — ");

  const sent = await createInvoiceOn(provider, {
    apiKey,
    amountCents: inst.amountCents,
    title,
    clientName: inst.proposal.clientName,
    clientEmail: inst.proposal.clientEmail,
    dueDate: inst.dueAt ? inst.dueAt.toISOString().slice(0, 10) : null,
    quiet: args.quiet,
    achOnly: args.achOnly,
  });
  if (!sent.ok) return { ok: false, reason: sent.reason };

  // Conditional claim: two concurrent callers (portal view + cron, or
  // two portal tabs) can both pass the invoiceId-null check above and
  // both mint at the provider. Only one may own the row — the loser
  // cancels its just-created invoice so no orphaned, payable page is
  // left live that the poller would never watch.
  const claimed = await db.paymentInstallment.updateMany({
    where: { id: inst.id, invoiceId: null },
    data: {
      invoiceProvider: provider,
      invoiceId: sent.value.id,
      invoiceUrl: sent.value.url,
      invoiceSentAt: new Date(),
      // A deliberate re-invoice lifts the hold a past cancel left.
      invoiceCanceledAt: null,
    },
  });
  if (claimed.count === 0) {
    void cancelInvoiceOn(provider, apiKey, sent.value.id).catch(() => undefined);
    const current = await db.paymentInstallment.findUnique({
      where: { id: inst.id },
      select: { invoiceUrl: true },
    });
    return { ok: true, url: current?.invoiceUrl ?? null };
  }

  return { ok: true, url: sent.value.url };
}

/**
 * The portal/reminder helper: hand back a live hosted pay page for this
 * installment, creating one quietly (no provider email) if none exists
 * yet. Owner is derived from the installment because the callers are
 * token-scoped (the client's own portal) or cron. Returns null when
 * there is nothing to offer — no rail connected, no client email,
 * already paid — and NEVER throws: a pay button is a bonus, the page it
 * sits on must render regardless.
 */
export async function ensurePayLinkForInstallment(
  installmentId: string,
): Promise<string | null> {
  try {
    const inst = await db.paymentInstallment.findUnique({
      where: { id: installmentId },
      select: {
        status: true,
        invoiceUrl: true,
        invoiceCanceledAt: true,
        // payWith is the rail the contractor picked when they SENT this
        // proposal — the pay button the client sees must be on that
        // rail, not on whichever one happens to be connected first.
        proposal: { select: { userId: true, clientEmail: true, payWith: true } },
      },
    });
    if (!inst || inst.status === "PAID") return null;
    if (inst.invoiceUrl) return inst.invoiceUrl;
    // The contractor just told this client to DISREGARD a payment
    // request — don't quietly mint a new one. Hitting the invoice
    // button again lifts the hold.
    if (inst.invoiceCanceledAt) return null;
    if (!inst.proposal.clientEmail) return null;
    // Auto-minting is opt-in: only when the contractor picked a rail at
    // send time. payWith null means "I'll invoice later" — a portal
    // view or reminder must never create billing artifacts they chose
    // not to have. (An invoice they DID send by hand is already caught
    // by the invoiceUrl branch above.)
    if (!isInvoiceProvider(inst.proposal.payWith)) return null;
    const r = await sendInvoiceForInstallment({
      ownerId: inst.proposal.userId,
      installmentId,
      provider: inst.proposal.payWith,
      quiet: true,
    });
    return r.ok ? r.url : null;
  } catch (e) {
    console.error("[provider-invoices] ensurePayLink failed", installmentId, e);
    return null;
  }
}

export type CancelInvoiceResult =
  | { ok: true; outcome: "canceled"; apologySent: boolean }
  | { ok: true; outcome: "already_paid" }
  | { ok: false; reason: string };

/**
 * "I sent that by accident" — revoke the invoice at the provider, wipe
 * it off the installment so a corrected one can go out, and apologize
 * to the client by email (with the contractor's optional note). The one
 * race that matters is handled the honest way: if the client paid
 * before the cancel landed, the money is RECORDED (same settle as the
 * poller) instead of canceled — you can't un-ring a paid bell, and
 * pretending otherwise breaks the books.
 */
export async function cancelInvoiceForInstallment(args: {
  ownerId: string;
  installmentId: string;
  /** Contractor-written line for the apology email ("wrong amount —
   *  corrected invoice on the way"). Optional. */
  note?: string | null;
  /** False = skip the client apology email — for cancels that aren't a
   *  mistake, like killing the pay page after a check arrived. */
  apologize?: boolean;
}): Promise<CancelInvoiceResult> {
  const inst = await db.paymentInstallment.findFirst({
    where: { id: args.installmentId, proposal: { userId: args.ownerId } },
    include: {
      proposal: {
        select: {
          id: true,
          clientName: true,
          clientEmail: true,
          address: true,
          user: {
            select: {
              email: true,
              contractorProfile: { select: { company: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!inst) return { ok: false, reason: "Payment not found" };
  if (!inst.invoiceId || !isInvoiceProvider(inst.invoiceProvider))
    return { ok: false, reason: "No invoice on this payment to cancel" };
  if (inst.status === "PAID")
    return {
      ok: false,
      reason:
        "This payment is already recorded as paid — undo the payment first if that's wrong.",
    };

  const provider = inst.invoiceProvider;
  const apiKey = await getRailKey(args.ownerId, provider);
  if (!apiKey)
    return {
      ok: false,
      reason: `No ${providerWord(provider)} key — reconnect it in Settings → Payments`,
    };

  const canceled = await cancelInvoiceOn(provider, apiKey, inst.invoiceId);
  if (!canceled.ok) return { ok: false, reason: canceled.reason };

  if (canceled.value.alreadyPaid) {
    // They beat the cancel to it. Record the money exactly like the
    // poller would have — paid stamp, resync, cascade, contractor email
    // — including HOW they paid (bank vs card), best-effort.
    const paidStatus = await invoiceStatusOn(provider, apiKey, inst.invoiceId);
    const paidBy =
      paidStatus.ok && paidStatus.value.method === "ach"
        ? ("BANK_TRANSFER" as const)
        : ("CARD" as const);
    const res = await settleProviderPaid(
      {
        id: inst.id,
        proposalId: inst.proposalId,
        label: inst.label,
        amountCents: inst.amountCents,
        invoiceProvider: provider,
      },
      paidBy,
    );
    if (res) {
      void emailOwnerPaymentReceived({
        ownerId: res.ownerId,
        clientName: res.clientName,
        label: inst.label,
        amountCents: inst.amountCents,
        provider,
        method: paidBy,
        completed: res.completed,
      });
    }
    return { ok: true, outcome: "already_paid" };
  }

  // Clear the invoice off the installment: the pay page is dead, and a
  // fresh (corrected) invoice or portal pay link can now replace it.
  await db.paymentInstallment.update({
    where: { id: inst.id },
    data: {
      invoiceProvider: null,
      invoiceId: null,
      invoiceUrl: null,
      invoiceSentAt: null,
      // Holds the portal/reminders back from quietly minting a fresh
      // pay link right after we told the client to disregard one.
      invoiceCanceledAt: new Date(),
    },
  });

  // Say sorry — the client either got a provider email or saw a pay
  // button somewhere, and silence after a canceled charge reads badly.
  const company =
    inst.proposal.user.contractorProfile?.company || "Your contractor";
  let apologySent = false;
  if (inst.proposal.clientEmail && args.apologize !== false) {
    try {
      const apology = renderInvoiceApologyEmail({
        clientFirstName:
          (inst.proposal.clientName || "there").trim().split(/\s+/)[0] || "there",
        companyName: company,
        address: inst.proposal.address,
        installmentLabel: inst.label,
        amountCents: inst.amountCents,
        note: args.note?.trim() || null,
      });
      const res = await sendEmailViaResend({
        to: inst.proposal.clientEmail,
        fromName: company,
        replyTo:
          inst.proposal.user.contractorProfile?.email || inst.proposal.user.email,
        subject: apology.subject,
        html: apology.html,
        text: apology.text,
      });
      apologySent = res.ok;
      if (!res.ok) console.warn("[provider-invoices] apology send failed:", res.reason);
    } catch (e) {
      console.error("[provider-invoices] apology threw", e);
    }
  }

  return { ok: true, outcome: "canceled", apologySent };
}

/**
 * The paid-side bookkeeping, IDENTICAL in effect to a hand-recorded
 * payment (app/actions/payments.ts recordInstallmentPayment): PAID
 * stamp with the real method, money resync onto the proposal,
 * completion cascade, PAID/COMPLETED events. Kept owner-scoped so the
 * cron can run it. No app receipt email on purpose — the provider
 * already sends its own receipt for an online payment.
 *
 * Returns null when someone else settled it first: the 2-minute cron
 * and the drawer's "Check now" can race, and the status-guarded claim
 * makes exactly one of them book the money (and email the contractor).
 */
async function settleProviderPaid(
  inst: {
    id: string;
    proposalId: string;
    label: string;
    amountCents: number;
    invoiceProvider: string | null;
  },
  /** How they actually paid — a bank (ACH) payment is booked as a bank
   *  transfer, not laundered into "card". */
  method: "CARD" | "BANK_TRANSFER" = "CARD",
): Promise<{ ownerId: string; clientName: string | null; completed: boolean } | null> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const claim = await tx.paymentInstallment.updateMany({
      where: { id: inst.id, status: "PENDING" },
      data: {
        status: "PAID",
        paidAt: now,
        method,
        note: `Paid online via ${providerWord(inst.invoiceProvider)} invoice${
          method === "BANK_TRANSFER" ? " (bank transfer / ACH)" : ""
        }`,
      },
    });
    if (claim.count === 0) return null;
    const [row, paidAgg] = await Promise.all([
      tx.proposal.findUniqueOrThrow({
        where: { id: inst.proposalId },
        select: {
          userId: true,
          clientName: true,
          totalCents: true,
          completedAt: true,
          status: true,
        },
      }),
      tx.paymentInstallment.aggregate({
        where: { proposalId: inst.proposalId, status: "PAID" },
        _sum: { amountCents: true },
      }),
    ]);
    const paidCents = paidAgg._sum.amountCents ?? 0;
    const fullyPaid =
      row.status === "ACCEPTED" && row.totalCents > 0 && paidCents >= row.totalCents;
    await tx.proposal.update({
      where: { id: inst.proposalId },
      data: {
        paidCents,
        completedAt: fullyPaid ? (row.completedAt ?? now) : row.completedAt,
      },
    });
    await tx.proposalEvent.create({
      data: {
        proposalId: inst.proposalId,
        kind: "PAID",
        payload: {
          installmentId: inst.id,
          label: inst.label,
          amountCents: inst.amountCents,
          method,
          via: inst.invoiceProvider,
        } as Prisma.InputJsonValue,
      },
    });
    if (fullyPaid && !row.completedAt) {
      await tx.proposalEvent.create({
        data: {
          proposalId: inst.proposalId,
          kind: "COMPLETED",
          payload: {
            paidCents,
            contractCents: row.totalCents,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return {
      ownerId: row.userId,
      clientName: row.clientName,
      completed: fullyPaid,
    };
  });
}

/**
 * "💰 You got paid" — email to the contractor when the poller (or the
 * cancel race) books an online payment. FenceScan's notification
 * channel is email; best-effort and silent on failure: the money is
 * already recorded, and a missing email must never look like a missing
 * payment.
 */
async function emailOwnerPaymentReceived(args: {
  ownerId: string;
  clientName: string | null;
  label: string;
  amountCents: number;
  provider: InvoiceProvider;
  method: "CARD" | "BANK_TRANSFER";
  completed: boolean;
}): Promise<void> {
  try {
    const owner = await db.user.findUnique({
      where: { id: args.ownerId },
      select: {
        email: true,
        contractorProfile: { select: { email: true, contractorName: true } },
      },
    });
    const to = owner?.contractorProfile?.email || owner?.email;
    if (!to) return;
    const amount = `$${(args.amountCents / 100).toLocaleString("en-US")}`;
    const who = args.clientName || "A client";
    const how =
      args.method === "BANK_TRANSFER" ? "bank transfer (ACH)" : "card";
    const dashUrl = `${appBaseUrl()}/dashboard/financials`;
    const subject = `💰 ${who} paid ${amount} — ${providerWord(args.provider)} invoice`;
    const line = `${who} paid ${amount} (${args.label}) by ${how} through your ${providerWord(args.provider)} invoice.${args.completed ? " The job is now fully paid 🎉" : ""}`;
    const html =
      `<div style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5;max-width:560px">` +
      `<h2 style="margin:0 0 8px;color:#14688C">Payment received ✓</h2>` +
      `<p>${line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</p>` +
      `<p style="margin-top:20px"><a href="${dashUrl}" style="background:#14688C;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open financials</a></p>` +
      `</div>`;
    await sendEmailViaResend({
      to,
      fromName: "FenceScan",
      subject,
      html,
      text: `${line}\n\nFinancials: ${dashUrl}`,
    });
  } catch (e) {
    console.warn("[provider-invoices] paid email failed", e);
  }
}

/**
 * Ask each provider about every open invoice; settle the paid ones.
 * Returns how many settled. Keys are per-contractor, so they're
 * resolved per owner and cached across the loop. Failures are
 * per-invoice — one dead key or flaky call never blocks the rest.
 */
export async function refreshProviderInvoices(ownerId?: string): Promise<number> {
  const open = await db.paymentInstallment.findMany({
    where: {
      status: "PENDING",
      invoiceId: { not: null },
      ...(ownerId ? { proposal: { userId: ownerId } } : {}),
    },
    take: 100,
    select: {
      id: true,
      proposalId: true,
      label: true,
      amountCents: true,
      invoiceId: true,
      invoiceProvider: true,
      proposal: { select: { userId: true } },
    },
  });
  if (open.length === 0) return 0;

  const keyCache = new Map<string, string | null>();
  const keyFor = async (userId: string, provider: InvoiceProvider) => {
    const cacheKey = `${userId}:${provider}`;
    if (!keyCache.has(cacheKey)) {
      keyCache.set(cacheKey, await getRailKey(userId, provider).catch(() => null));
    }
    return keyCache.get(cacheKey) ?? null;
  };

  let settled = 0;
  for (const inst of open) {
    try {
      if (!inst.invoiceId || !isInvoiceProvider(inst.invoiceProvider)) continue;
      const key = await keyFor(inst.proposal.userId, inst.invoiceProvider);
      if (!key) continue;
      const status = await invoiceStatusOn(inst.invoiceProvider, key, inst.invoiceId);
      if (!status.ok) continue;
      // Canceled at the provider's own dashboard: stop offering the
      // dead pay page, and hold auto-re-minting — the contractor
      // canceled it deliberately, just not through the app.
      if (status.value.canceled) {
        await db.paymentInstallment
          .update({
            where: { id: inst.id },
            data: {
              invoiceProvider: null,
              invoiceId: null,
              invoiceUrl: null,
              invoiceSentAt: null,
              invoiceCanceledAt: new Date(),
            },
          })
          .catch(() => undefined);
        continue;
      }
      if (!status.value.paid) continue;

      const paidBy = status.value.method === "ach" ? "BANK_TRANSFER" : "CARD";
      const res = await settleProviderPaid(inst, paidBy);
      if (!res) continue;
      settled++;
      void emailOwnerPaymentReceived({
        ownerId: res.ownerId,
        clientName: res.clientName,
        label: inst.label,
        amountCents: inst.amountCents,
        provider: inst.invoiceProvider,
        method: paidBy,
        completed: res.completed,
      });
    } catch (e) {
      console.error("[provider-invoices] refresh failed for", inst.id, e);
    }
  }
  return settled;
}
