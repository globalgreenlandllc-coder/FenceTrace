"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { encrypt, fingerprint } from "@/lib/crypto";
import { getMe } from "./me";
import { squareKeyCheck } from "@/lib/payments/square";
import { staxAccountStatus, staxKeyCheck } from "@/lib/payments/stax";
import { stripeKeyCheck } from "@/lib/payments/stripe-invoices";
import {
  availableInvoiceProviders,
  cancelInvoiceForInstallment,
  getRailKey,
  isInvoiceProvider,
  providerWord,
  refreshProviderInvoices,
  sendInvoiceForInstallment,
  type CancelInvoiceResult,
  type InvoiceProvider,
} from "@/lib/payments/provider-invoices";

/**
 * provider-invoices.ts (actions) — the contractor side of Square/Stripe/
 * Stax invoicing. Thin: the machinery lives in lib/payments/
 * provider-invoices so the status cron shares it verbatim. Every action
 * is scoped to the signed-in contractor — keys and invoices are
 * per-tenant, never global.
 */

/** Which rails this contractor connected — a button per rail. */
export async function listInvoiceProviders(): Promise<InvoiceProvider[]> {
  const me = await getMe();
  if (!me) return [];
  return availableInvoiceProviders(me.user.id);
}

export async function sendProviderInvoice(
  installmentId: string,
  provider: InvoiceProvider,
  /** Bank transfer only — no card option on the client's pay page. */
  achOnly?: boolean,
): Promise<{ ok: true; url: string | null } | { ok: false; reason: string }> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const r = await sendInvoiceForInstallment({
    ownerId: me.user.id,
    installmentId,
    provider,
    achOnly,
  });
  if (r.ok) {
    revalidatePath("/dashboard/financials");
    revalidatePath("/dashboard/proposals");
  }
  return r;
}

/**
 * "I sent that by accident" — revoke at the provider, apologize to the
 * client by email (with the contractor's optional note). If the client
 * paid before the cancel landed, the payment is recorded instead — the
 * drawer tells the contractor which of the two happened.
 */
export async function cancelProviderInvoice(
  installmentId: string,
  note?: string,
): Promise<CancelInvoiceResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const r = await cancelInvoiceForInstallment({
    ownerId: me.user.id,
    installmentId,
    note: note ?? null,
  });
  if (r.ok) {
    revalidatePath("/dashboard/financials");
    revalidatePath("/dashboard/proposals");
  }
  return r;
}

/** "Check now" — the drawer's manual poke between cron ticks. */
export async function refreshMyProviderInvoices(): Promise<{
  ok: boolean;
  settled: number;
}> {
  const me = await getMe();
  if (!me) return { ok: false, settled: 0 };
  const settled = await refreshProviderInvoices(me.user.id).catch(() => 0);
  if (settled > 0) {
    revalidatePath("/dashboard/financials");
    revalidatePath("/dashboard/proposals");
  }
  return { ok: true, settled };
}

/* ------------------------------------------------------------------ */
/*  Key management (Settings → Payments)                               */
/* ------------------------------------------------------------------ */

export type InvoiceRailStatus = {
  square: { connected: boolean };
  stripe: { connected: boolean };
  stax: {
    connected: boolean;
    /** Whether the Stax ACCOUNT takes bank payments (ACH) — a Stax-side
     *  merchant setting, verified via Plaid on their pay page. Null =
     *  connected but the probe failed; unknown, not off. */
    ach: boolean | null;
    /** Stax's per-payment ACH cap, when it reports one. */
    achLimitCents: number | null;
  };
};

export async function getInvoiceRailStatus(): Promise<InvoiceRailStatus> {
  const empty: InvoiceRailStatus = {
    square: { connected: false },
    stripe: { connected: false },
    stax: { connected: false, ach: null, achLimitCents: null },
  };
  const me = await getMe();
  if (!me) return empty;
  const rails = await availableInvoiceProviders(me.user.id);
  const out: InvoiceRailStatus = {
    // Square invoices always go out accepting card + bank — ACH is on
    // the invoice itself, nothing to probe.
    square: { connected: rails.includes("square") },
    stripe: { connected: rails.includes("stripe") },
    stax: { connected: rails.includes("stax"), ach: null, achLimitCents: null },
  };
  if (out.stax.connected) {
    try {
      const key = await getRailKey(me.user.id, "stax");
      if (key) {
        const acct = await staxAccountStatus(key);
        if (acct.ok) {
          out.stax.ach = acct.value.allowAch;
          out.stax.achLimitCents = acct.value.achLimitCents;
        }
      }
    } catch {
      /* status is a courtesy — the card stays useful without it */
    }
  }
  return out;
}

export async function saveInvoiceRailKey(
  provider: InvoiceProvider,
  key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  if (me.user.role === "WORKER")
    return { ok: false, reason: "Only the account owner manages payment keys" };
  if (!isInvoiceProvider(provider))
    return { ok: false, reason: "Unknown payment provider" };
  const value = key.trim();
  if (value.length < 10) return { ok: false, reason: "That doesn't look like a key" };

  // Validate BEFORE storing — a key that can't authenticate can't
  // invoice anyone, and finding that out at send time helps nobody.
  const check =
    provider === "square"
      ? await squareKeyCheck(value)
      : provider === "stripe"
        ? await stripeKeyCheck(value)
        : await staxKeyCheck(value);
  if (!check.ok) {
    return {
      ok: false,
      reason: `${providerWord(provider)} rejected the key: ${check.reason}`,
    };
  }

  // One live key per rail per contractor: the new one replaces.
  await db.paymentConnection.upsert({
    where: { userId_provider: { userId: me.user.id, provider } },
    create: {
      userId: me.user.id,
      provider,
      encryptedKey: encrypt(value),
      fingerprint: fingerprint(value),
    },
    update: {
      encryptedKey: encrypt(value),
      fingerprint: fingerprint(value),
    },
  });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function removeInvoiceRailKey(
  provider: InvoiceProvider,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  if (me.user.role === "WORKER")
    return { ok: false, reason: "Only the account owner manages payment keys" };
  if (!isInvoiceProvider(provider))
    return { ok: false, reason: "Unknown payment provider" };
  await db.paymentConnection
    .deleteMany({ where: { userId: me.user.id, provider } })
    .catch(() => undefined);
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
