"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { StatTile } from "@/components/dashboard/stat-tile";
import { ProposalsTable } from "@/components/dashboard/proposals-table";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { RevenueTrend } from "@/components/dashboard/revenue-trend";
import { WeekStrip } from "@/components/dashboard/week-strip";
import { UpcomingJobs } from "@/components/dashboard/upcoming-jobs";
import { OnboardingStrip } from "@/components/dashboard/onboarding-strip";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { Button } from "@/components/ui/button";
import {
  getOverviewData,
  listMyActivity,
  listMyProposals,
  type MyActivityEvent,
  type MyProposalRow,
  type OverviewData,
} from "@/app/actions/dashboard";
import {
  getNeedsAttention,
  type AttentionItem,
} from "@/app/actions/payments";
import { formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <AuthGate>
      <Inner />
    </AuthGate>
  );
}

function Inner() {
  const [proposals, setProposals] = useState<MyProposalRow[]>([]);
  const [activity, setActivity] = useState<MyActivityEvent[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listMyProposals(),
      listMyActivity(),
      getNeedsAttention(),
      // Pass the browser timezone so "This week" / "Upcoming jobs"
      // bucket by the contractor's wall-clock day, matching the
      // calendar page (revenue stays UTC-bucketed by design).
      getOverviewData(Intl.DateTimeFormat().resolvedOptions().timeZone),
    ])
      .then(([p, a, att, o]) => {
        if (cancelled) return;
        setProposals(p);
        setActivity(a);
        setAttention(att);
        setOverview(o);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recent = proposals.slice(0, 6);
  const isEmpty = !loading && proposals.length === 0;

  // KPI derivations off the overview payload.
  const revenue30dCents = overview?.revenue30dCents ?? 0;
  const revenuePrev30dCents = overview?.revenuePrev30dCents ?? 0;
  let revenueDelta: { text: string; positive: boolean } | undefined;
  if (revenuePrev30dCents > 0) {
    const pct = Math.round(
      ((revenue30dCents - revenuePrev30dCents) / revenuePrev30dCents) * 100,
    );
    revenueDelta = {
      text: `${pct >= 0 ? "+" : ""}${pct}%`,
      positive: pct >= 0,
    };
  }
  const activeProposals = overview?.activeProposals ?? 0;
  const wonMtd = overview?.wonMtd ?? 0;

  return (
    <DashboardShell
      title="Overview"
      eyebrow={eyebrowLine()}
      subtitle="Everything that needs your attention today — revenue, pipeline, and the next moves."
      actions={
        <>
          <Link href="/dashboard/proposals/new">
            <Button size="sm">
              <Sparkles className="h-4 w-4" />
              New proposal
            </Button>
          </Link>
          <Link href="/proposal?manual=1">
            <Button size="sm" variant="outline">
              Manual proposal
            </Button>
          </Link>
        </>
      }
    >
      <div className="space-y-6">
        <OnboardingStrip />

        {/* KPI row */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            index={0}
            label="Revenue · 30d"
            value={formatCurrency(revenue30dCents / 100)}
            delta={revenueDelta}
            footnote="Collected across all jobs"
            loading={loading}
          />
          <StatTile
            index={1}
            label="Pipeline value"
            value={formatCurrency((overview?.pipelineValueCents ?? 0) / 100)}
            footnote={`${activeProposals} active proposal${activeProposals === 1 ? "" : "s"}`}
            loading={loading}
          />
          <StatTile
            index={2}
            label="Open proposals"
            value={String(overview?.openProposals ?? 0)}
            delta={
              wonMtd > 0 ? { text: `${wonMtd} won`, positive: true } : undefined
            }
            footnote="awaiting a decision"
            loading={loading}
          />
          <StatTile
            index={3}
            label="AI takeoffs · 30d"
            value={String(overview?.takeoffs30d ?? 0)}
            footnote="satellite + blueprint"
            loading={loading}
          />
        </section>

        {/* Revenue trend + recent activity */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <RevenueTrend daily={overview?.revenueDaily ?? []} loading={loading} />
          <ActivityFeed events={activity} loading={loading} />
        </section>

        {/* This week + upcoming jobs */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WeekStrip days={overview?.week ?? []} />
          <UpcomingJobs items={overview?.upcoming ?? []} loading={loading} />
        </section>

        {/* Pipeline */}
        <section>
          <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Pipeline
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {loading ? (
              <div className="space-y-3 rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-10" />
                ))}
              </div>
            ) : isEmpty ? (
              <EmptyProposals />
            ) : (
              <Suspense fallback={null}>
                <ProposalsTable items={recent} compact showFilters={false} />
              </Suspense>
            )}
            <NeedsAttention items={attention} loading={loading} />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function EmptyProposals() {
  return (
    <div className="anim-enter rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
      <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-lg bg-accent-600 text-white">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">
        No proposals yet
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
        Run an AI takeoff for any address — your draft, the proposal you send,
        and the homeowner&apos;s response will all land here.
      </p>
      <Link href="/dashboard/proposals/new" className="mt-5 inline-block">
        <Button>
          <Sparkles className="h-4 w-4" />
          Start your first estimate
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

/** "GOOD EVENING · JUL 10" — greeting + short date, uppercased. */
function eyebrowLine(): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date());
  return `${greetingTime()} · ${date}`.toUpperCase();
}

function greetingTime(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}
