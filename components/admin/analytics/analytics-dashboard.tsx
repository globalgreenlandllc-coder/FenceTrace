"use client";

import { useEffect, useState } from "react";
import {
  getAnalyticsOverview,
  getLiveActivity,
  getLiveNow,
  type AnalyticsOverview,
  type LiveActivity,
  type LiveNow,
} from "@/app/actions/analytics";
import { StatTile } from "@/components/dashboard/stat-tile";
import { cn } from "@/lib/utils";
import { BusinessCard } from "./business-card";
import { CampaignsCard, ChannelsCard } from "./channels-card";
import { compact, countryFlag, countryName, duration } from "./format";
import { FunnelCard } from "./funnel-card";
import { LiveActivityFeed } from "./live-activity";
import { LiveNowCard } from "./live-now";
import { RankList } from "./rank-list";
import { SignupsChart } from "./signups-chart";
import { TrafficChart } from "./traffic-chart";

/* ------------------------------------------------------------------ */
/*  /admin/analytics orchestrator.                                     */
/*                                                                     */
/*  Live strip polls every 12s (visible tabs only). The range filter   */
/*  is ONE row that scopes everything below it; on refetch the         */
/*  previous render holds at reduced opacity — no skeleton flash.      */
/* ------------------------------------------------------------------ */

const LIVE_POLL_MS = 12_000;

const RANGES: { days: number; label: string }[] = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export function AnalyticsDashboard({
  initialOverview,
  initialLive,
  initialActivity,
}: {
  initialOverview: AnalyticsOverview;
  initialLive: LiveNow;
  initialActivity: LiveActivity;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [live, setLive] = useState(initialLive);
  const [activity, setActivity] = useState(initialActivity);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        // Live presence + activity refresh together on each tick.
        const [nextLive, nextActivity] = await Promise.all([
          getLiveNow(),
          getLiveActivity(),
        ]);
        if (!cancelled) {
          setLive(nextLive);
          setActivity(nextActivity);
          setNowMs(Date.now());
        }
      } catch {
        // Keep the previous snapshot; the next tick retries.
      }
    };
    const interval = window.setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function changeRange(days: number) {
    if (days === overview.rangeDays || pending) return;
    setPending(true);
    try {
      setOverview(await getAnalyticsOverview(days));
    } catch {
      // Range switch failed — keep showing the current slice.
    } finally {
      setPending(false);
    }
  }

  const t = overview.totals;
  const hourly = overview.rangeDays === 1;

  return (
    <div className="space-y-6">
      <LiveNowCard live={live} nowMs={nowMs} />

      <LiveActivityFeed activity={activity} nowMs={nowMs} />

      {/* One filter row — scopes every card below it */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5"
          role="tablist"
          aria-label="Analytics range"
        >
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="tab"
              aria-selected={overview.rangeDays === r.days}
              onClick={() => changeRange(r.days)}
              className={cn(
                "transition-smooth ring-focus rounded-md px-3 py-1 text-xs font-medium",
                overview.rangeDays === r.days
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-400">
          Traffic excludes admin visits · times in UTC
        </p>
      </div>

      <div
        className={cn(
          "space-y-6 transition-smooth",
          pending && "pointer-events-none opacity-60",
        )}
        aria-busy={pending}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            index={0}
            label="Unique visitors"
            value={compact(t.visitors)}
            footnote={`${compact(t.marketingVisitors)} on the marketing site`}
          />
          <StatTile
            index={1}
            label="Pageviews"
            value={compact(t.pageviews)}
            footnote={`${t.avgPageviews} pages per session`}
          />
          <StatTile
            index={2}
            label="Sign-ups"
            value={String(t.signups)}
            footnote="Accounts created in range"
          />
          <StatTile
            index={3}
            label="Visitor → sign-up"
            value={t.conversionPct != null ? `${t.conversionPct}%` : "—"}
            footnote="Of unique marketing visitors"
          />
          <StatTile
            index={4}
            label="Sessions"
            value={compact(t.sessions)}
            footnote="Rolls after 30 min idle"
          />
          <StatTile
            index={5}
            label="Avg session"
            value={duration(t.avgSessionSecs)}
            footnote="Time from first to last beat"
          />
          <StatTile
            index={6}
            label="Bounce rate"
            value={t.bounceRatePct != null ? `${t.bounceRatePct}%` : "—"}
            footnote="Single-page sessions"
          />
          <StatTile
            index={7}
            label="Takeoffs run"
            value={compact(
              overview.business.estimates.inRange +
                overview.business.blueprints.inRange,
            )}
            footnote="Satellite + blueprint, in range"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <TrafficChart series={overview.series} hourly={hourly} />
          <SignupsChart series={overview.series} hourly={hourly} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <FunnelCard funnel={overview.funnel} />
          <ChannelsCard channels={overview.channels} />
        </div>

        <CampaignsCard campaigns={overview.campaigns} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <RankList
            title="Top sources"
            rows={overview.sources}
            emptyText="Referrers appear with the first tracked visit."
          />
          <RankList
            title="Top pages"
            rows={overview.topPages}
            emptyText="Pageviews appear with the first tracked visit."
          />
          <RankList
            title="Entry pages"
            rows={overview.entryPages}
            emptyText="Landing pages appear with the first tracked session."
          />
          <RankList
            title="Countries"
            rows={overview.countries}
            emptyText="Locations appear once the site runs on Vercel (geo headers)."
            renderLabel={(r) => (
              <>
                <span className="mr-1.5" aria-hidden>
                  {countryFlag(r.label)}
                </span>
                {countryName(r.label)}
              </>
            )}
          />
          <RankList
            title="Devices"
            rows={overview.devices.map((d) => ({
              ...d,
              label: d.label[0]?.toUpperCase() + d.label.slice(1),
            }))}
            emptyText="Device mix appears with the first tracked visit."
          />
          <RankList
            title="Browsers"
            rows={overview.browsers}
            emptyText="Browser mix appears with the first tracked visit."
          />
        </div>

        <BusinessCard business={overview.business} />
      </div>
    </div>
  );
}
