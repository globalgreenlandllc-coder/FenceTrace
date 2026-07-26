"use client";

import type { BusinessStats } from "@/app/actions/analytics";
import { Badge } from "@/components/ui/badge";
import { compact } from "./format";

/* All-time business snapshot: subscription pipeline, plans, product
   usage. Not range-scoped — these are "state of the business" numbers,
   labeled as such so they never get read against the range filter. */

const PROPOSAL_ORDER = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-zinc-600">{label}</span>
      <span
        className={
          strong
            ? "text-sm font-semibold tabular-nums text-zinc-900"
            : "text-sm tabular-nums text-zinc-700"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function BusinessCard({ business }: { business: BusinessStats }) {
  const proposals = [...business.proposals].sort(
    (a, b) => PROPOSAL_ORDER.indexOf(a.status) - PROPOSAL_ORDER.indexOf(b.status),
  );
  const creditsAvailable =
    business.credits.included + business.credits.bonus - business.credits.used;

  return (
    <section className="surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Business snapshot
        </h3>
        <Badge tone="neutral">All time</Badge>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="microlabel">Accounts</p>
          <div className="mt-1.5 divide-y divide-zinc-100">
            <Row label="Contractors" value={compact(business.totalUsers)} strong />
            <Row label="New in last 7 days" value={String(business.newUsers7d)} />
            <Row label="New in last 30 days" value={String(business.newUsers30d)} />
            <Row label="Crew workers invited" value={String(business.workers)} />
          </div>
        </div>

        <div>
          <p className="microlabel">Subscriptions</p>
          <div className="mt-1.5 divide-y divide-zinc-100">
            <Row label="On free trial" value={String(business.liveTrialing)} strong />
            <Row label="Paying" value={String(business.livePaying)} strong />
            <Row label="Past due" value={String(business.pastDue)} />
            <Row label="Canceled" value={String(business.canceled)} />
            <Row label="Free (never subscribed)" value={compact(business.freeUsers)} />
          </div>
          {business.plans.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {business.plans.map((p) => (
                <Badge key={p.planId} tone="accent">
                  {p.planId} · {p.count}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="microlabel">Product usage</p>
          <div className="mt-1.5 divide-y divide-zinc-100">
            <Row
              label="Satellite takeoffs"
              value={`${compact(business.estimates.inRange)} in range · ${compact(business.estimates.total)} total`}
            />
            <Row
              label="Blueprint takeoffs"
              value={`${compact(business.blueprints.inRange)} in range · ${compact(business.blueprints.total)} total`}
            />
            <Row label="Credits burned" value={compact(business.credits.used)} />
            <Row label="Credits available" value={compact(Math.max(0, creditsAvailable))} />
          </div>
          {proposals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proposals.map((p) => (
                <Badge
                  key={p.status}
                  tone={
                    p.status === "ACCEPTED"
                      ? "emerald"
                      : p.status === "DECLINED" || p.status === "EXPIRED"
                        ? "rose"
                        : "neutral"
                  }
                >
                  {p.status.toLowerCase()} · {p.count}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
