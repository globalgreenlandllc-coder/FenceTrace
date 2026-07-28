"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Zap } from "lucide-react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { BrandProfileSection } from "@/components/dashboard/brand-profile-section";
import { PaymentsSection } from "@/components/dashboard/payments-section";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-mock";
import {
  createCreditsCheckout,
  createSubscriptionCheckout,
  getMyBilling,
  openBillingPortal,
  type MyBilling,
} from "@/app/actions/billing";
import { formatCurrency } from "@/lib/utils";
import { trackEvent } from "@/components/analytics/tracker";
import { getMyReferral, type MyReferral } from "@/app/actions/me";

export default function SettingsPage() {
  return (
    <AuthGate>
      <DashboardShell
        title="Settings"
        subtitle="Configure your brand, payments, and plan."
        contentClassName="max-w-4xl"
      >
        <div className="space-y-6">
          <BrandProfileSection />

          <PaymentsSection />

          <BillingSection />

          <ReferralSection />
        </div>
      </DashboardShell>
    </AuthGate>
  );
}

function BillingSection() {
  const { session } = useSession();
  const isAdmin = session?.user.role === "SUPER_ADMIN";

  const [billing, setBilling] = useState<MyBilling | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    getMyBilling().then(setBilling).catch(() => undefined);
    // Post-checkout return banner (?billing=success|credits|cancelled).
    const params = new URLSearchParams(window.location.search);
    const b = params.get("billing");
    if (b === "success")
      setBanner("🎉 Welcome to Pro — your plan is activating (a few seconds).");
    if (b === "credits")
      setBanner("✓ Credits purchased — they'll appear in your wallet shortly.");
    if (b === "cancelled") setBanner("Checkout cancelled — nothing was charged.");
    if (b) {
      params.delete("billing");
      const q = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (q ? `?${q}` : ""),
      );
    }
  }, []);

  async function go(
    key: string,
    fn: () => Promise<{ ok: true; url: string } | { ok: false; reason: string }>,
  ) {
    // Capture the buying intent BEFORE the redirect, so the admin live feed
    // sees the attempt even if checkout later fails. "portal" is an existing
    // subscriber managing their plan, not a purchase — skip it.
    if (key === "subscribe") trackEvent("subscribe_click");
    else if (key !== "portal") trackEvent("credit_topup_click");
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  // FenceTrace's one real limit: proposals SENT per month on the free
  // plan. Scans, takeoffs and drafts are free on every plan.
  const sent = billing?.sentThisMonth ?? 0;
  const cap = billing?.freeSendCap ?? 3;

  const plan = billing?.plan ?? null;
  const planActive = plan?.status === "ACTIVE";
  const planPastDue = plan?.status === "PAST_DUE";
  const badge = planActive
    ? { label: `${billing?.proName ?? "Pro"} · Active`, tone: "emerald" as const }
    : planPastDue
      ? { label: "Payment failed", tone: "amber" as const }
      : { label: "Free plan", tone: "accent" as const };

  const subLine = billing
    ? `Scans, measurements and takeoffs are free on every plan. Free sends ${billing.freeSendCap} proposals a month — ` +
      `${billing.proName} (${formatCurrency(billing.proPriceCents / 100)}/mo) is unlimited.`
    : "Free plan + Pro (unlimited proposals).";

  if (!billing) {
    return (
      <Section eyebrow="Billing" title="Plan & billing" sub={subLine}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
        </div>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Billing"
      title="Plan & billing"
      sub={subLine}
      badge={badge}
    >
      {banner && (
        <div className="anim-enter-fade mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {banner}
        </div>
      )}
      {error && (
        <div className="anim-enter-fade mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[26px] font-semibold tracking-tight tabular-nums text-zinc-900">
              {isAdmin || planActive ? "Unlimited" : Math.max(0, cap - sent)}
            </span>
            <span className="text-xs text-zinc-500">
              {isAdmin
                ? "admin account"
                : planActive
                  ? "proposals on Pro"
                  : `of ${cap} free proposals left this month`}
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            {/* Static width; the draw-in animates scaleX only. */}
            <div
              className="anim-grow-x h-full rounded-full bg-accent-600"
              style={{
                width: `${
                  isAdmin || planActive
                    ? 100
                    : Math.max(0, Math.round(((cap - sent) / Math.max(1, cap)) * 100))
                }%`,
              }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Stat label="Property scans" value="Free · unlimited" />
            <Stat label="Proposals sent this month" value={`${sent}`} />
            <Stat
              label="Plan"
              value={planActive ? billing?.proName ?? "Pro" : "Free"}
            />
            <Stat
              label="Renews"
              value={
                planActive && plan?.renewsAt
                  ? new Date(plan.renewsAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"
              }
            />
          </div>

          {/* Recent top-ups — receipts for purchased bonus credits */}
          {billing.recentTopups.length > 0 && (
            <div className="mt-4 border-t border-zinc-200 pt-4">
              <div className="microlabel">Recent top-ups</div>
              <ul className="mt-2 space-y-1.5">
                {billing.recentTopups.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="text-zinc-600">{t.description}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">
                      {formatCurrency(t.amountCents / 100)} ·{" "}
                      {new Date(t.at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              {billing?.proName ?? "Pro plan"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {formatCurrency((billing?.proPriceCents ?? 5000) / 100)}/month ·
              billed monthly
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-zinc-600">
              {[
                `${billing.includedCredits} plan takeoffs / month`,
                ...billing.features.slice(0, 6),
              ].map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-accent-600" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {planActive && plan?.renewsAt && (
              <p className="mt-3 text-[11px] text-zinc-500">
                {plan.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                {new Date(plan.renewsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                {plan.cancelAtPeriodEnd && " — cancellation scheduled"}
              </p>
            )}
            {planPastDue && (
              <p className="mt-3 text-[11px] font-medium text-rose-600">
                Last payment failed — update your card to keep Pro.
              </p>
            )}
          </div>
          {planActive || planPastDue ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => go("portal", openBillingPortal)}
            >
              {busy === "portal" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Manage plan
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy !== null || (billing !== null && !billing.configured)}
              onClick={() => go("subscribe", createSubscriptionCheckout)}
            >
              {busy === "subscribe" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Upgrade to Pro
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function Section({
  eyebrow,
  title,
  sub,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  badge?: { label: string; tone: "accent" | "amber" | "emerald" };
  children: React.ReactNode;
}) {
  return (
    <section className="anim-enter stagger-2 surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="microlabel">{eyebrow}</div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>
        </div>
        {badge && (
          <Badge tone={badge.tone}>
            {badge.tone !== "amber" && <CheckCircle2 className="h-3 w-3" />}
            {badge.label}
          </Badge>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
      <div className="microlabel">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-zinc-900">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Referral — share link, earn blueprint credits                      */
/* ------------------------------------------------------------------ */
function ReferralSection() {
  const [referral, setReferral] = useState<MyReferral | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMyReferral().then(setReferral).catch(() => undefined);
  }, []);

  if (!referral) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referral.url);
      setCopied(true);
      trackEvent("referral_link_copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the input below is selectable
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Refer a contractor
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Know someone still measuring off a ladder? You earn{" "}
            <span className="font-semibold text-zinc-700">
              {referral.bonusPerSignup} plan credits
            </span>{" "}
            for every contractor who signs up with your link.
          </p>
        </div>
        <Badge tone="neutral">
          {referral.credited}/{referral.cap} referred
        </Badge>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={referral.url}
          onFocus={(e) => e.currentTarget.select()}
          className="ring-focus h-10 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-mono text-xs text-zinc-700"
        />
        <Button onClick={() => void copy()} className="h-10 shrink-0">
          {copied ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Copied
            </>
          ) : (
            "Copy link"
          )}
        </Button>
      </div>
    </section>
  );
}
