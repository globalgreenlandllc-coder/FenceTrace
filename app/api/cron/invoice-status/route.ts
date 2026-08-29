import { NextResponse } from "next/server";
import { refreshProviderInvoices } from "@/lib/payments/provider-invoices";

/**
 * GET /api/cron/invoice-status — did anybody pay?
 *
 * Every 2 minutes, ask Square, Stripe, and Stax about every invoice
 * still open (across all contractors, each on their own key). A paid
 * one settles through the same bookkeeping as a hand-recorded payment
 * and emails the contractor. Polling instead of webhooks on purpose:
 * no webhook secrets to configure per contractor per provider, nothing
 * to misconfigure, and nothing that breaks silently when a provider
 * rotates a signing key. The drawer's "Check now" button calls the
 * same refresh for instant gratification.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settled = await refreshProviderInvoices();
    return NextResponse.json({ ok: true, settled });
  } catch (e) {
    console.error("[cron/invoice-status] failed", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
