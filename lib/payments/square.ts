import "server-only";

/**
 * square.ts — Square Invoices, the contractor's card+ACH rail.
 *
 * The full Invoices API rather than a bare payment link, because "send
 * invoices from Square" means Square's own machinery: the client gets a
 * real Square invoice email with a hosted pay page (card or bank), and
 * Square handles receipt + reminders on their side. Four calls:
 * find-or-create the customer, create an order for the amount, create
 * the invoice against both, publish it (publishing is what emails it).
 *
 * The api key is the contractor's own production access token from the
 * Square Developer dashboard (stored encrypted per-contractor in
 * payment_connections). Sandbox tokens work by pointing at the sandbox
 * host — chosen by an explicit env override only; default is production.
 */

const BASE =
  process.env.SQUARE_ENV === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
const V = "2024-08-21"; // Square-Version header — pin so shapes don't drift.

type SquareResult<T> = { ok: true; value: T } | { ok: false; reason: string };

async function sq<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<SquareResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Square-Version": V,
        "Content-Type": "application/json",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errs = json.errors as { detail?: string; code?: string }[] | undefined;
      return {
        ok: false,
        reason: errs?.[0]?.detail || errs?.[0]?.code || `Square ${res.status}`,
      };
    }
    return { ok: true, value: json as T };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Square unreachable" };
  }
}

const rnd = () => crypto.randomUUID();

/** The account's first active location — invoices must name one. */
async function locationId(apiKey: string): Promise<SquareResult<string>> {
  const r = await sq<{ locations?: { id: string; status: string }[] }>(
    apiKey,
    "/v2/locations",
  );
  if (!r.ok) return r;
  const loc =
    r.value.locations?.find((l) => l.status === "ACTIVE") ?? r.value.locations?.[0];
  return loc
    ? { ok: true, value: loc.id }
    : { ok: false, reason: "No location on the Square account" };
}

async function customerId(
  apiKey: string,
  client: { name: string | null; email: string },
): Promise<SquareResult<string>> {
  const found = await sq<{ customers?: { id: string }[] }>(
    apiKey,
    "/v2/customers/search",
    {
      body: {
        query: { filter: { email_address: { exact: client.email } } },
        limit: 1,
      },
    },
  );
  if (found.ok && found.value.customers?.[0]) {
    return { ok: true, value: found.value.customers[0].id };
  }
  const parts = (client.name ?? "").trim().split(/\s+/);
  const created = await sq<{ customer?: { id: string } }>(apiKey, "/v2/customers", {
    body: {
      idempotency_key: rnd(),
      email_address: client.email,
      given_name: parts[0] || undefined,
      family_name: parts.slice(1).join(" ") || undefined,
    },
  });
  if (!created.ok) return created;
  return created.value.customer
    ? { ok: true, value: created.value.customer.id }
    : { ok: false, reason: "Square didn't return the customer" };
}

export async function createSquareInvoice(args: {
  apiKey: string;
  amountCents: number;
  /** "Deposit — Jane Doe — 12 Main St" — the line the client sees. */
  title: string;
  clientName: string | null;
  clientEmail: string;
  /** YYYY-MM-DD; omitted = due on receipt (today). */
  dueDate?: string | null;
  /** Quiet = Square does NOT email the client — we just want the hosted
   *  pay page (public_url) to put behind our own buttons: the client
   *  portal's "Pay now" and the reminder emails. SHARE_MANUALLY is
   *  Square's name for exactly that. */
  quiet?: boolean;
  /** Bank transfer only — no card. On a big install the card fee is a
   *  real number (a few percent of five figures), so the contractor
   *  wants the option to take ACH and nothing else. Square enforces it
   *  on the hosted page; the client is never offered a card to click. */
  achOnly?: boolean;
}): Promise<SquareResult<{ id: string; url: string | null }>> {
  const loc = await locationId(args.apiKey);
  if (!loc.ok) return loc;
  const cust = await customerId(args.apiKey, {
    name: args.clientName,
    email: args.clientEmail,
  });
  if (!cust.ok) return cust;

  const order = await sq<{ order?: { id: string } }>(args.apiKey, "/v2/orders", {
    body: {
      idempotency_key: rnd(),
      order: {
        location_id: loc.value,
        line_items: [
          {
            name: args.title.slice(0, 500),
            quantity: "1",
            base_price_money: { amount: args.amountCents, currency: "USD" },
          },
        ],
      },
    },
  });
  if (!order.ok) return order;
  if (!order.value.order) return { ok: false, reason: "Square didn't return the order" };

  const inv = await sq<{ invoice?: { id: string; version: number } }>(
    args.apiKey,
    "/v2/invoices",
    {
      body: {
        idempotency_key: rnd(),
        invoice: {
          location_id: loc.value,
          order_id: order.value.order.id,
          primary_recipient: { customer_id: cust.value },
          delivery_method: args.quiet ? "SHARE_MANUALLY" : "EMAIL",
          accepted_payment_methods: {
            card: !args.achOnly,
            bank_account: true,
            square_gift_card: false,
          },
          payment_requests: [
            {
              request_type: "BALANCE",
              // Square rejects a past due_date, and the overdue-reminder
              // path passes exactly that — clamp to today ("due on receipt").
              due_date: (() => {
                const today = new Date().toISOString().slice(0, 10);
                return args.dueDate && args.dueDate > today ? args.dueDate : today;
              })(),
            },
          ],
        },
      },
    },
  );
  if (!inv.ok) return inv;
  if (!inv.value.invoice) return { ok: false, reason: "Square didn't return the invoice" };

  // Publishing is the send: Square emails the client its own invoice.
  const pub = await sq<{ invoice?: { id: string; public_url?: string } }>(
    args.apiKey,
    `/v2/invoices/${inv.value.invoice.id}/publish`,
    { body: { idempotency_key: rnd(), version: inv.value.invoice.version } },
  );
  if (!pub.ok) return pub;
  return {
    ok: true,
    value: {
      id: inv.value.invoice.id,
      url: pub.value.invoice?.public_url ?? null,
    },
  };
}

/**
 * Where a sent Square invoice stands — collapsed to what the app acts
 * on. When it's paid, one extra read of the order's tenders says HOW:
 * "ach" for a bank payment, "card" otherwise — so the books can record
 * a bank transfer as a bank transfer. Best-effort: method null when the
 * tender read fails, paid stays paid.
 */
export async function squareInvoiceStatus(
  apiKey: string,
  invoiceId: string,
): Promise<
  SquareResult<{
    paid: boolean;
    canceled: boolean;
    status: string;
    method: "card" | "ach" | null;
  }>
> {
  const r = await sq<{ invoice?: { status?: string; order_id?: string } }>(
    apiKey,
    `/v2/invoices/${invoiceId}`,
  );
  if (!r.ok) return r;
  const status = r.value.invoice?.status ?? "UNKNOWN";
  const paid = status === "PAID";

  let method: "card" | "ach" | null = null;
  if (paid && r.value.invoice?.order_id) {
    const order = await sq<{ order?: { tenders?: { type?: string }[] } }>(
      apiKey,
      `/v2/orders/${r.value.invoice.order_id}`,
    );
    if (order.ok) {
      const types = (order.value.order?.tenders ?? [])
        .map((t) => t.type)
        .filter(Boolean);
      if (types.includes("BANK_ACCOUNT")) method = "ach";
      else if (types.length > 0) method = "card";
    }
  }

  return {
    ok: true,
    value: {
      paid,
      canceled: status === "CANCELED" || status === "FAILED",
      status,
      method,
    },
  };
}

/**
 * Revoke a sent invoice — the pay page dies with it. Cancel needs the
 * invoice's current version, so this reads it first; that read also
 * catches the race where the client paid between the contractor
 * noticing the mistake and clicking cancel — reported as alreadyPaid so
 * the caller records the money instead of pretending it isn't there.
 */
export async function cancelSquareInvoice(
  apiKey: string,
  invoiceId: string,
): Promise<SquareResult<{ alreadyPaid: boolean }>> {
  const r = await sq<{ invoice?: { status?: string; version?: number } }>(
    apiKey,
    `/v2/invoices/${invoiceId}`,
  );
  if (!r.ok) return r;
  const status = r.value.invoice?.status ?? "UNKNOWN";
  if (status === "PAID") return { ok: true, value: { alreadyPaid: true } };
  if (status === "CANCELED" || status === "FAILED")
    return { ok: true, value: { alreadyPaid: false } };
  const cancel = await sq<Record<string, unknown>>(
    apiKey,
    `/v2/invoices/${invoiceId}/cancel`,
    { body: { version: r.value.invoice?.version ?? 0 } },
  );
  if (!cancel.ok) return cancel;
  return { ok: true, value: { alreadyPaid: false } };
}

/** A cheap authenticated ping for the connect-key validator. */
export async function squareKeyCheck(apiKey: string): Promise<SquareResult<string>> {
  const loc = await locationId(apiKey);
  return loc.ok ? { ok: true, value: `location ${loc.value}` } : loc;
}
