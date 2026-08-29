import "server-only";

/**
 * stax.ts — Stax (Fattmerchant) invoicing rail.
 *
 * Same contract as square.ts: find-or-create the customer, create the
 * invoice, tell Stax to email it — the client gets Stax's hosted pay
 * page. The key is the contractor's own API key from Stax Apps → API
 * Keys (stored encrypted per-contractor in payment_connections), sent
 * as a bearer token against the production API.
 *
 * Stax's shapes are looser than Square's (dollars as numbers, meta as a
 * free-form document the dashboard renders), so this file is deliberately
 * defensive about what it reads back.
 */

const BASE = "https://apiprod.fattlabs.com";

type StaxResult<T> = { ok: true; value: T } | { ok: false; reason: string };

async function stax<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<StaxResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // Stax errors arrive as {field: ["message"]} or {error: "..."}.
      const flat =
        typeof json.error === "string"
          ? json.error
          : Object.values(json)
              .flat()
              .filter((v): v is string => typeof v === "string")
              .join("; ");
      return { ok: false, reason: flat || `Stax ${res.status}` };
    }
    return { ok: true, value: json as T };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Stax unreachable" };
  }
}

async function customerId(
  apiKey: string,
  client: { name: string | null; email: string },
): Promise<StaxResult<string>> {
  const found = await stax<{ data?: { id: string; email?: string }[] }>(
    apiKey,
    `/customer?filter[email]=${encodeURIComponent(client.email)}&per_page=1`,
  );
  const hit = found.ok
    ? found.value.data?.find(
        (c) => c.email?.toLowerCase() === client.email.toLowerCase(),
      )
    : null;
  if (hit) return { ok: true, value: hit.id };

  const parts = (client.name ?? "").trim().split(/\s+/);
  const created = await stax<{ id?: string }>(apiKey, "/customer", {
    body: {
      firstname: parts[0] || "Client",
      lastname: parts.slice(1).join(" ") || "-",
      email: client.email,
    },
  });
  if (!created.ok) return created;
  return created.value.id
    ? { ok: true, value: created.value.id }
    : { ok: false, reason: "Stax didn't return the customer" };
}

export async function createStaxInvoice(args: {
  apiKey: string;
  amountCents: number;
  title: string;
  clientName: string | null;
  clientEmail: string;
  /** Quiet = skip Stax's own email; the hosted bill URL still works and
   *  goes behind the portal/reminder pay buttons instead. */
  quiet?: boolean;
}): Promise<StaxResult<{ id: string; url: string | null }>> {
  const cust = await customerId(args.apiKey, {
    name: args.clientName,
    email: args.clientEmail,
  });
  if (!cust.ok) return cust;

  const dollars = Math.round(args.amountCents) / 100;
  const created = await stax<{ id?: string; url?: string }>(args.apiKey, "/invoice", {
    body: {
      customer_id: cust.value,
      total: dollars,
      // The hosted bill page Stax links from its email.
      url: "https://app.staxpayments.com/#/bill/",
      meta: {
        subtotal: dollars,
        tax: 0,
        lineItems: [
          { id: "1", item: args.title.slice(0, 250), details: "", quantity: 1, price: dollars },
        ],
      },
      send_now: false,
    },
  });
  if (!created.ok) return created;
  if (!created.value.id) return { ok: false, reason: "Stax didn't return the invoice" };

  if (!args.quiet) {
    const sent = await stax<Record<string, unknown>>(
      args.apiKey,
      `/invoice/${created.value.id}/send/email`,
      { method: "PUT", body: {} },
    );
    if (!sent.ok) return sent;
  }

  return {
    ok: true,
    value: {
      id: created.value.id,
      url: created.value.url ? `${created.value.url}${created.value.id}` : null,
    },
  };
}

export async function staxInvoiceStatus(
  apiKey: string,
  invoiceId: string,
): Promise<
  StaxResult<{
    paid: boolean;
    canceled: boolean;
    status: string;
    method: "card" | "ach" | null;
  }>
> {
  const r = await stax<{
    status?: string;
    paid_at?: string | null;
    deleted_at?: string | null;
    // The payments that settled this invoice; their method says HOW —
    // "bank"/"ach" for a bank payment, "card" for a card. Read
    // defensively: Stax shapes drift and method is a bonus, not a gate.
    child_transactions?: { method?: string; success?: boolean }[];
  }>(apiKey, `/invoice/${invoiceId}`);
  if (!r.ok) return r;
  const status = (r.value.status ?? "UNKNOWN").toUpperCase();
  const raw = (r.value.child_transactions ?? [])
    .filter((t) => t.success !== false)
    .map((t) => (t.method ?? "").toLowerCase())
    .find((m) => m.length > 0);
  const method: "card" | "ach" | null =
    raw === "bank" || raw === "ach" ? "ach" : raw ? "card" : null;
  return {
    ok: true,
    value: {
      paid: status === "PAID" || Boolean(r.value.paid_at),
      canceled: status === "DELETED" || Boolean(r.value.deleted_at),
      status,
      method,
    },
  };
}

/**
 * What the connected Stax account can actually take. ACH is a merchant
 * setting on Stax's side (their pay page verifies the client's bank via
 * Plaid) — this reads whether it's on and the per-payment ACH limit, so
 * Settings can show it instead of the contractor guessing.
 */
export async function staxAccountStatus(apiKey: string): Promise<
  StaxResult<{ name: string; allowAch: boolean; achLimitCents: number | null }>
> {
  const r = await stax<{
    company?: { name?: string };
    merchant?: {
      company_name?: string;
      allow_ach?: boolean;
      options?: { allow_ach?: boolean; ach_transaction_limit?: number };
    };
  }>(apiKey, "/self");
  if (!r.ok) return r;
  const m = r.value.merchant;
  const allowAch = Boolean(m?.allow_ach ?? m?.options?.allow_ach);
  const limitDollars = m?.options?.ach_transaction_limit;
  return {
    ok: true,
    value: {
      name: m?.company_name || r.value.company?.name || "authenticated",
      allowAch,
      achLimitCents:
        typeof limitDollars === "number" && Number.isFinite(limitDollars)
          ? Math.round(limitDollars * 100)
          : null,
    },
  };
}

/**
 * Revoke a sent invoice. Reads status first so a payment that landed in
 * the meantime is reported as alreadyPaid (the caller records it) rather
 * than deleted out from under the books; otherwise DELETE soft-removes
 * the invoice and its hosted bill page.
 */
export async function cancelStaxInvoice(
  apiKey: string,
  invoiceId: string,
): Promise<StaxResult<{ alreadyPaid: boolean }>> {
  const cur = await staxInvoiceStatus(apiKey, invoiceId);
  if (!cur.ok) return cur;
  if (cur.value.paid) return { ok: true, value: { alreadyPaid: true } };
  if (cur.value.canceled) return { ok: true, value: { alreadyPaid: false } };
  const del = await stax<Record<string, unknown>>(apiKey, `/invoice/${invoiceId}`, {
    method: "DELETE",
  });
  if (!del.ok) return del;
  return { ok: true, value: { alreadyPaid: false } };
}

/** Cheap authenticated ping for the connect-key validator. */
export async function staxKeyCheck(apiKey: string): Promise<StaxResult<string>> {
  const r = await stax<{ id?: string; company?: { name?: string } }>(apiKey, "/self");
  if (!r.ok) return r;
  return { ok: true, value: r.value.company?.name || "authenticated" };
}
