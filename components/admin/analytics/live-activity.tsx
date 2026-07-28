"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Coins, MousePointerClick, Rocket, Sparkles, TrendingUp } from "lucide-react";
import type { LiveActivity, LiveActivityItem } from "@/app/actions/analytics";
import type { Intent } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { countryFlag, timeAgo } from "./format";

/* ------------------------------------------------------------------ */
/*  Live activity feed — what online visitors are doing right now, with */
/*  intent flagged. Subscribe attempts light up green (the "smart"      */
/*  alert). Newest first; items animate in as the dashboard polls.      */
/* ------------------------------------------------------------------ */

const INTENT_META: Record<
  Intent,
  {
    tone: "emerald" | "sky" | "accent" | "neutral";
    dot: string;
    badge: string | null;
    icon: typeof Rocket;
  }
> = {
  subscribe: {
    tone: "emerald",
    dot: "bg-emerald-500",
    badge: "Trying to subscribe",
    icon: Rocket,
  },
  purchase: {
    tone: "accent",
    dot: "bg-accent-500",
    badge: "Buying credits",
    icon: Coins,
  },
  signup: { tone: "sky", dot: "bg-sky-500", badge: "Signing up", icon: TrendingUp },
  trial: {
    tone: "accent",
    dot: "bg-accent-500",
    badge: "Trying product",
    icon: Sparkles,
  },
  normal: {
    tone: "neutral",
    dot: "bg-zinc-300",
    badge: null,
    icon: MousePointerClick,
  },
};

const MAX_ROWS = 18;

export function LiveActivityFeed({
  activity,
  nowMs,
}: {
  activity: LiveActivity;
  nowMs: number;
}) {
  const reduce = useReducedMotion();
  const items = activity.items.slice(0, MAX_ROWS);

  return (
    <section className="surface flex flex-col overflow-hidden shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
            </span>
            <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
              Live activity
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Every page and click across visitors on the site right now
          </p>
        </div>
        {activity.subscribeAttempts > 0 && (
          <Link
            href="/admin/users"
            className="anim-pop inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800"
          >
            <Rocket className="h-4 w-4" />
            {activity.subscribeAttempts} trying to subscribe
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="border-t border-zinc-100 px-5 py-10 text-center sm:px-6">
          <MousePointerClick className="mx-auto h-5 w-5 text-zinc-300" aria-hidden />
          <p className="mt-2 text-sm text-zinc-400">
            Clicks and page views stream in here the moment someone browses
            FenceTrace.
          </p>
        </div>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto border-t border-zinc-100">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ActivityRow item={item} nowMs={nowMs} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ item, nowMs }: { item: LiveActivityItem; nowMs: number }) {
  const meta = INTENT_META[item.intent];
  const Icon = meta.icon;
  const isSubscribe = item.intent === "subscribe";
  const who = item.userEmail ?? "Anonymous visitor";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-2.5 sm:px-6",
        isSubscribe && "bg-emerald-50/50",
      )}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)}
        aria-hidden
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          isSubscribe ? "text-emerald-600" : "text-zinc-400",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              isSubscribe ? "font-semibold text-emerald-900" : "text-zinc-800",
            )}
          >
            {item.label}
          </span>
          {meta.badge && (
            <Badge tone={meta.tone} className="shrink-0">
              {meta.badge}
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-zinc-500">
          {item.userEmail ? (
            <Link
              href={`/admin/users?q=${encodeURIComponent(item.userEmail)}`}
              className="ring-focus text-accent-700 hover:underline"
            >
              {who}
            </Link>
          ) : (
            who
          )}
          {item.country && (
            <span className="ml-1.5" aria-hidden>
              {countryFlag(item.country)}
            </span>
          )}
          {item.device && (
            <span className="ml-1.5 capitalize text-zinc-400">{item.device}</span>
          )}
        </div>
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400">
        {timeAgo(item.at, nowMs)}
      </span>
    </div>
  );
}
