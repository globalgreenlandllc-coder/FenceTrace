import {
  ArrowUpRight,
  CreditCard,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users as UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { getAdminKpis, recentAdminActivity } from "@/app/actions/admin";
import { Badge } from "@/components/ui/badge";
import { SyncLeadsButton } from "@/components/admin/sync-leads-button";
import { formatCurrency } from "@/lib/utils";

export default async function AdminOverviewPage() {
  const [kpis, activity] = await Promise.all([
    getAdminKpis(),
    recentAdminActivity(),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Platform overview
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Live counts and money flowing through FenceScan right now.
          </p>
        </div>
        <Badge tone="emerald">
          <ShieldCheck className="h-3 w-3" />
          All checks healthy
        </Badge>
      </header>

      <section className="surface grid grid-cols-1 divide-y divide-zinc-100 shadow-card sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        <Kpi
          icon={UsersIcon}
          label="Active contractors"
          value={String(kpis.contractorsActive)}
          sub={`${kpis.contractorsSuspended} suspended`}
        />
        <Kpi
          icon={Sparkles}
          label="Estimates this month"
          value={String(kpis.estimatesThisMonth)}
          sub={`${kpis.estimatesAllTime} all time`}
        />
        <Kpi
          icon={TrendingUp}
          label="MRR"
          value={formatCurrency(kpis.mrrCents / 100)}
          sub="Active SaaS subs × current price"
        />
        <Kpi
          icon={Receipt}
          label="Platform fees collected"
          value={formatCurrency(kpis.platformFeesCents / 100)}
          sub={`${formatCurrency(kpis.revenueProcessedCents / 100)} processed`}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="surface p-6 shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                Quick actions
              </h2>
              <span className="text-xs text-zinc-500">
                Most-used admin surfaces
              </span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ActionLink
                href="/admin/users"
                title="Manage contractors"
                body="Adjust credits, suspend, impersonate."
              />
              <ActionLink
                href="/admin/financials"
                title="Open the ledger"
                body="Subscriptions + proposal payments + refunds."
              />
              <ActionLink
                href="/admin/api-keys"
                title="API key vault"
                body="Rotate Google, OpenAI, Stripe, Resend keys."
              />
              <ActionLink
                href="/admin/pricing"
                title="Pricing CMS"
                body="Edit plans + sync to Stripe."
              />
            </div>
            <div className="mt-3">
              <SyncLeadsButton />
            </div>
          </div>

          <div className="surface p-6 shadow-card">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Conversion this month
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Proposals accepted vs. estimates run.
            </p>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="text-4xl font-semibold tracking-tight tabular-nums text-zinc-900">
                  {kpis.estimatesThisMonth === 0
                    ? "0%"
                    : Math.round(
                        (kpis.proposalsAccepted /
                          Math.max(kpis.estimatesThisMonth, 1)) *
                          100,
                      ) + "%"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {kpis.proposalsAccepted} accepted ·{" "}
                  {kpis.estimatesThisMonth} estimates
                </div>
              </div>
              <Badge tone="neutral">
                <CreditCard className="h-3 w-3" />
                Updated live
              </Badge>
            </div>
          </div>
        </div>

        <div className="surface p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">
              Recent activity
            </h2>
            <span className="text-xs text-zinc-500">Across all contractors</span>
          </div>
          {activity.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              No proposal activity yet. Once contractors send proposals,
              homeowner views and acceptances will land here.
            </div>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 py-2 text-sm"
                >
                  <div className="text-zinc-800">{a.message}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {new Date(a.at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Icon className="h-4 w-4 text-zinc-400" />
        {label}
      </div>
      <div className="mt-2 text-[26px] font-semibold tracking-tight tabular-nums text-zinc-900">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function ActionLink({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group transition-smooth hover-lift press-scale ring-focus flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 hover:border-accent-300 hover:bg-zinc-50/60"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-900">{title}</span>
        <ArrowUpRight className="transition-smooth h-3.5 w-3.5 text-zinc-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-700 motion-reduce:transition-none" />
      </div>
      <span className="text-xs text-zinc-500">{body}</span>
    </Link>
  );
}
