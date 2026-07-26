import { NextResponse } from "next/server";
import { runLeadsSync } from "@/lib/leads/run-sync";
import { getOptionalSuperAdmin } from "@/lib/admin";
import { recordSpend } from "@/lib/abuse/spend-guard";
import { EST_COST_CENTS } from "@/lib/abuse/policies";

// Same 60s budget the cron job uses — see vercel.json + the cron route.
// Without this Vercel kills the function at the 10s default and the
// admin button shows a confusing timeout error mid-sync.
export const maxDuration = 60;

/**
 * Admin-triggered "Sync leads now" — runs the same multi-city sync the
 * nightly cron does, but gated by Clerk session + SUPER_ADMIN role
 * instead of the CRON_SECRET. Lets the operator backfill a fresh
 * production DB or recover from a missed nightly run without needing
 * terminal access or env-var lookups.
 */
export async function POST() {
  const me = await getOptionalSuperAdmin();
  if (!me) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runLeadsSync();
    await recordSpend({
      userId: me.user.id,
      kind: "LEAD_SYNC",
      provider: "openai",
      costCents: EST_COST_CENTS.LEAD_SYNC,
      meta: { trigger: "admin" },
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[Admin sync-leads-now] Error:", error);
    const message = error instanceof Error ? error.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
