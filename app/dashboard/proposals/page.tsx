"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { ProposalsTable } from "@/components/dashboard/proposals-table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { formatCurrency } from "@/lib/utils";
import {
  listMyProposals,
  type MyProposalRow,
} from "@/app/actions/dashboard";
import {
  getPaymentStats,
  type PaymentStats,
} from "@/app/actions/payments";

export default function ProposalsListPage() {
  return (
    <AuthGate>
      {/* Suspense: ProposalsTable reads useSearchParams (?filter, ?pay). */}
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </AuthGate>
  );
}

function Inner() {
  const [rows, setRows] = useState<MyProposalRow[]>([]);
  const [money, setMoney] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyProposals(), getPaymentStats()])
      .then(([r, m]) => {
        if (cancelled) return;
        setRows(r);
        setMoney(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const noAcceptedYet =
    !!money &&
    money.jobsInProgress === 0 &&
    money.jobsDone === 0 &&
    money.collectedMtdCents === 0;

  return (
    <DashboardShell
      title="Proposals"
      subtitle="Every estimate and proposal you've drafted, sent, or closed — with the money state of each job."
      actions={
        <Link
          href="/dashboard/proposals/new"
          className="ring-focus active:scale-[0.98] inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-smooth hover:bg-accent-700"
        >
          <Plus className="h-4 w-4" />
          New proposal
        </Link>
      }
    >
      {!loading && rows.length === 0 ? (
        <div className="anim-enter rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">
            No proposals yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            Run an AI takeoff for any address. Your drafts, sent proposals,
            and accepted jobs will show up here with status filters and
            search.
          </p>
          <Link
            href="/dashboard/proposals/new"
            className="ring-focus active:scale-[0.98] mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-smooth hover:bg-accent-700"
          >
            <Sparkles className="h-4 w-4" />
            Start your first estimate
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              index={0}
              loading={loading}
              label="Collected · this month"
              value={formatCurrency((money?.collectedMtdCents ?? 0) / 100)}
              footnote={
                noAcceptedYet
                  ? "fills in once a client accepts"
                  : "across all accepted jobs"
              }
            />
            <StatTile
              index={1}
              loading={loading}
              label="Outstanding"
              value={formatCurrency((money?.outstandingCents ?? 0) / 100)}
              footnote={
                (money?.jobsInProgress ?? 0) > 0
                  ? `${money!.jobsInProgress} job${money!.jobsInProgress === 1 ? "" : "s"} in progress`
                  : "no open balances yet"
              }
            />
            <StatTile
              index={2}
              loading={loading}
              label="Overdue"
              value={formatCurrency((money?.overdueCents ?? 0) / 100)}
              delta={
                (money?.overdueCount ?? 0) > 0
                  ? {
                      text: `${money!.overdueCount} payment${money!.overdueCount === 1 ? "" : "s"} late`,
                      positive: false,
                    }
                  : undefined
              }
              footnote={
                (money?.overdueCount ?? 0) === 0
                  ? "nothing late"
                  : "filter the list below"
              }
            />
            <StatTile
              index={3}
              loading={loading}
              label="Awaiting client"
              value={String(money?.pendingChangeOrders ?? 0)}
              footnote="change orders pending approval"
            />
          </section>
          <ProposalsTable items={rows} loading={loading} />
        </div>
      )}
    </DashboardShell>
  );
}
