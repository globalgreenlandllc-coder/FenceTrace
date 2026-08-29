import "server-only";

/**
 * stripe-invoices.ts — Stripe Invoicing, the third rail.
 *
 * Same contract as square.ts / stax.ts: find-or-create the customer,
 * create + finalize the invoice, tell Stripe to email it — the client
 * gets Stripe's hosted invoice page (card, and bank/ACH when the
 * account has it enabled). The key is the contractor's OWN secret key
 * (sk_live_… or a restricted rk_live_… key with Invoices + Customers
 * write), stored encrypted per-contractor in payment_connections.
 *
 * NOT the platform's Stripe account (lib/stripe.ts — SaaS billing).
 * This bills the contractor's clients on the contractor's account.
 *
 * Raw fetch, not the stripe SDK: the SDK instance is bound to one key,
 * while this file juggles a different key per contractor per call.
 * Stripe speaks form-encoding, hence `form()`.
 */

const BASE = "https://api.stripe.com";

type StripeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Flatten {a: {b: [c]}} into Stripe's a[b][0]=c form encoding. */
function form(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          out.push(...form(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...form(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function st<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
): Promise<StripeResult<T>> {
  try {
    const method = init?.method ?? (init?.body ? "POST" : "GET");
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: init?.body ? form(init.body).join("&") : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { message?: string; code?: string } | undefined;
      return {
        ok: false,
        reason: err?.message || err?.code || `Stripe ${res.status}`,
      };
    }
    return { ok: true, value: json as T };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Stripe unreachable" };
  }
}

async function customerId(
  apiKey: string,
  client: { name: string | null; email: string },
): Promise<StripeResult<string>> {
  const found = await st<{ data?: { id: string }[] }>(
    apiKey,
    `/v1/customers?email=${encodeURIComponent(client.email)}&limit=1`,
  );
  if (found.ok && found.value.data?.[0]) {
    return { ok: true, value: found.value.data[0].id };
  }
  const created = await st<{ id?: string }>(apiKey, "/v1/customers", {
    body: {
      email: client.email,
      name: client.name?.trim() || undefined,
    },
  });
  if (!created.ok) return created;
  return created.value.id
    ? { ok: true, value: created.value.id }
    : { ok: false, reason: "Stripe didn't return the customer" };
}

export async function createStripeInvoice(args: {
  apiKey: string;
  amountCents: number;
  /** "Deposit — Jane Doe — 12 Main St" — the line the client sees. */
  title: string;
  clientName: string | null;
  clientEmail: string;
  /** YYYY-MM-DD; when absent (or in the past) the invoice is due
   *  tomorrow — "on receipt" as far as a client is concerned. */
  dueDate?: string | null;
  /** Quiet = Stripe does NOT email the client; we only want the hosted
   *  invoice page URL for our own portal/reminder buttons. */
  quiet?: boolean;
  /** Bank (ACH) only, no card. Stripe enforces it on the hosted page —
   *  requires the account to have us_bank_account payments enabled,
   *  otherwise Stripe rejects with a clear reason we pass through. */
  achOnly?: boolean;
}): Promise<StripeResult<{ id: string; url: string | null }>> {
  const cust = await customerId(args.apiKey, {
    name: args.clientName,
    email: args.clientEmail,
  });
  if (!cust.ok) return cust;

  // Due date: Stripe wants either a future unix due_date or
  // days_until_due. A past/absent date collapses to "due tomorrow".
  const dueTs = args.dueDate ? Math.floor(new Date(`${args.dueDate}T23:59:59Z`).getTime() / 1000) : NaN;
  const dueParams =
    Number.isFinite(dueTs) && dueTs * 1000 > Date.now() + 3600_000
      ? { due_date: dueTs }
      : { days_until_due: 1 };

  const inv = await st<{ id?: string }>(args.apiKey, "/v1/invoices", {
    body: {
      customer: cust.value,
      collection_method: "send_invoice",
      description: args.title.slice(0, 500),
      // Never sweep unrelated pending items into this invoice.
      pending_invoice_items_behavior: "exclude",
      auto_advance: false,
      ...(args.achOnly
        ? { payment_settings: { payment_method_types: ["us_bank_account"] } }
        : {}),
      ...dueParams,
    },
  });
  if (!inv.ok) return inv;
  if (!inv.value.id) return { ok: false, reason: "Stripe didn't return the invoice" };
  const invoiceId = inv.value.id;

  const item = await st<{ id?: string }>(args.apiKey, "/v1/invoiceitems", {
    body: {
      customer: cust.value,
      invoice: invoiceId,
      amount: Math.round(args.amountCents),
      currency: "usd",
      description: args.title.slice(0, 500),
    },
  });
  if (!item.ok) return item;

  // Finalizing mints the hosted pay page (hosted_invoice_url).
  const fin = await st<{ id?: string; hosted_invoice_url?: string }>(
    args.apiKey,
    `/v1/invoices/${invoiceId}/finalize`,
    { body: { auto_advance: false } },
  );
  if (!fin.ok) return fin;

  if (!args.quiet) {
    // Sending is what emails the client Stripe's own invoice.
    const sent = await st<Record<string, unknown>>(
      args.apiKey,
      `/v1/invoices/${invoiceId}/send`,
      { method: "POST", body: {} },
    );
    if (!sent.ok) return sent;
  }

  return {
    ok: true,
    value: { id: invoiceId, url: fin.value.hosted_invoice_url ?? null },
  };
}

/**
 * Where a sent Stripe invoice stands — collapsed to what the app acts
 * on. When it's paid, the expanded charge says HOW: "ach" for a
 * us_bank_account payment, "card" otherwise. Best-effort: method null
 * when the expansion fails, paid stays paid.
 */
export async function stripeInvoiceStatus(
  apiKey: string,
  invoiceId: string,
): Promise<
  StripeResult<{
    paid: boolean;
    canceled: boolean;
    status: string;
    method: "card" | "ach" | null;
  }>
> {
  const r = await st<{
    status?: string;
    payment_intent?: {
      latest_charge?: { payment_method_details?: { type?: string } } | string | null;
    } | null;
  }>(
    apiKey,
    `/v1/invoices/${invoiceId}?expand[]=payment_intent.latest_charge`,
  );
  if (!r.ok) return r;
  const status = r.value.status ?? "unknown";
  const paid = status === "paid";

  let method: "card" | "ach" | null = null;
  if (paid) {
    const charge = r.value.payment_intent?.latest_charge;
    const type =
      charge && typeof charge === "object"
        ? charge.payment_method_details?.type
        : undefined;
    if (type === "us_bank_account" || type === "ach_debit" || type === "ach_credit_transfer") {
      method = "ach";
    } else if (type) {
      method = "card";
    }
  }

  return {
    ok: true,
    value: {
      paid,
      canceled: status === "void",
      status: status.toUpperCase(),
      method,
    },
  };
}

/**
 * Revoke a sent invoice — voiding kills the hosted pay page. Reads
 * status first so a payment that landed in the meantime is reported as
 * alreadyPaid (the caller records the money) rather than voided out
 * from under the books; a still-draft invoice is deleted outright.
 */
export async function cancelStripeInvoice(
  apiKey: string,
  invoiceId: string,
): Promise<StripeResult<{ alreadyPaid: boolean }>> {
  const r = await st<{ status?: string }>(apiKey, `/v1/invoices/${invoiceId}`);
  if (!r.ok) return r;
  const status = r.value.status ?? "unknown";
  if (status === "paid") return { ok: true, value: { alreadyPaid: true } };
  if (status === "void" || status === "uncollectible")
    return { ok: true, value: { alreadyPaid: false } };
  if (status === "draft") {
    const del = await st<Record<string, unknown>>(apiKey, `/v1/invoices/${invoiceId}`, {
      method: "DELETE",
    });
    if (!del.ok) return del;
    return { ok: true, value: { alreadyPaid: false } };
  }
  const voided = await st<Record<string, unknown>>(
    apiKey,
    `/v1/invoices/${invoiceId}/void`,
    { method: "POST", body: {} },
  );
  if (!voided.ok) return voided;
  return { ok: true, value: { alreadyPaid: false } };
}

/** A cheap authenticated ping for the connect-key validator. */
export async function stripeKeyCheck(apiKey: string): Promise<StripeResult<string>> {
  if (!/^(sk|rk)_(live|test)_/.test(apiKey)) {
    return {
      ok: false,
      reason:
        "That's not a Stripe secret key — it should start with sk_live_ (or a restricted rk_live_ key with Invoices + Customers write access). Publishable pk_ keys can't send invoices.",
    };
  }
  const r = await st<{ id?: string; settings?: { dashboard?: { display_name?: string } } }>(
    apiKey,
    "/v1/account",
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: r.value.settings?.dashboard?.display_name || r.value.id || "authenticated",
  };
}
