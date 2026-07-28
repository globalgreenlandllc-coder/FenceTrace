import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  getAnalyticsOverview,
  getLiveActivity,
  getLiveNow,
} from "@/app/actions/analytics";
import { AnalyticsDashboard } from "@/components/admin/analytics/analytics-dashboard";
import { Logo } from "@/components/ui/logo";

// Live traffic + acquisition analytics. Auth is enforced by the admin
// layout (requireSuperAdmin); the data actions re-check the role on
// every call since the live strip polls them from the client.
//
// ?view=standalone renders the SAME dashboard as a chrome-free,
// full-screen overlay (no admin sidebar) — a bookmarkable URL you can
// pop out into its own tab/window and leave running on a second screen.

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const standalone = view === "standalone";

  const [overview, live, activity] = await Promise.all([
    getAnalyticsOverview(7),
    getLiveNow(),
    getLiveActivity(),
  ]);

  if (standalone) {
    // fixed inset-0 covers the admin shell underneath, so this reads as a
    // dedicated full-page monitor.
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
        <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Logo showSubtitle={false} />
              <span className="hidden text-sm text-zinc-400 sm:inline">
                / Live analytics
              </span>
            </div>
            <Link
              href="/admin/analytics"
              className="transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to admin
            </Link>
          </header>
          <AnalyticsDashboard
            initialOverview={overview}
            initialLive={live}
            initialActivity={activity}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Who&apos;s on FenceScan right now, where they came from, and how
            visitors turn into paying contractors.
          </p>
        </div>
        <Link
          href="/admin/analytics?view=standalone"
          target="_blank"
          rel="noopener"
          className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-card hover:text-zinc-900"
        >
          <ExternalLink className="h-4 w-4" />
          Pop out
        </Link>
      </header>
      <AnalyticsDashboard
        initialOverview={overview}
        initialLive={live}
        initialActivity={activity}
      />
    </div>
  );
}
