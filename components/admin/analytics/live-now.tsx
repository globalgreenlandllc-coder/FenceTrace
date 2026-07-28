"use client";

import Link from "next/link";
import { Globe, MonitorSmartphone, Radio } from "lucide-react";
import type { LiveNow } from "@/app/actions/analytics";
import { Badge } from "@/components/ui/badge";
import { countryFlag, countryName, timeAgo } from "./format";

/* ------------------------------------------------------------------ */
/*  Live strip — who is on FenceScan right now.                       */
/*                                                                     */
/*  Hero figure = sessions active in the last 60s (heartbeat window),  */
/*  split by segment: marketing visitors (prospects), signed-in app    */
/*  users, homeowners in the proposal portal, and admins (us).         */
/* ------------------------------------------------------------------ */

const SEGMENT_META: Record<
  string,
  { label: string; tone: "sky" | "accent" | "amber" | "neutral" }
> = {
  marketing: { label: "Visitors", tone: "sky" },
  app: { label: "In the app", tone: "accent" },
  portal: { label: "Homeowners", tone: "amber" },
  admin: { label: "Admins", tone: "neutral" },
};

const INTENT_BADGE: Record<
  string,
  { label: string; tone: "emerald" | "sky" | "accent" } | null
> = {
  subscribe: { label: "Subscribing", tone: "emerald" },
  signup: { label: "Signing up", tone: "sky" },
  trial: { label: "Trialing", tone: "accent" },
  normal: null,
};

const MAX_ROWS = 12;

export function LiveNowCard({ live, nowMs }: { live: LiveNow; nowMs: number }) {
  const rows = live.sessions.slice(0, MAX_ROWS);
  const overflow = live.total - rows.length;

  return (
    <section className="surface overflow-hidden shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden
              />
              <span className="microlabel">Online now</span>
            </div>
            <p className="mt-1 text-5xl font-semibold tracking-tight text-zinc-900">
              {live.total}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(SEGMENT_META) as (keyof typeof SEGMENT_META)[]).map(
              (seg) => {
                const count = live.bySegment[seg as keyof typeof live.bySegment];
                if (!count) return null;
                const meta = SEGMENT_META[seg];
                return (
                  <Badge key={seg} tone={meta.tone}>
                    {count} {meta.label.toLowerCase()}
                  </Badge>
                );
              },
            )}
          </div>
        </div>
        <p className="text-xs text-zinc-400">
          Updates every 12s · last{" "}
          {new Date(live.generatedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="border-t border-zinc-100 px-5 py-8 text-center sm:px-6">
          <Radio className="mx-auto h-5 w-5 text-zinc-300" aria-hidden />
          <p className="mt-2 text-sm text-zinc-400">
            No one is on FenceScan right now. This lights up the moment a
            visitor opens any page.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-zinc-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="font-label text-left text-[11px] text-zinc-400">
                <th className="px-5 py-2.5 font-medium sm:px-6">
                  Journey · where they&apos;re clicking
                </th>
                <th className="px-3 py-2.5 font-medium">Who</th>
                <th className="px-3 py-2.5 font-medium">Segment</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 font-medium">Device</th>
                <th className="px-3 py-2.5 pr-5 text-right font-medium sm:pr-6">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const meta = SEGMENT_META[s.segment] ?? SEGMENT_META.marketing;
                return (
                  <tr
                    key={s.id}
                    className="border-t border-zinc-100 transition-smooth hover:bg-zinc-50/60"
                  >
                    <td className="max-w-[300px] px-5 py-2.5 sm:px-6">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-zinc-500">
                          {s.journey.map((page, i) => {
                            const last = i === s.journey.length - 1;
                            return (
                              <span key={i}>
                                {i > 0 && (
                                  <span className="mx-1 text-zinc-300">›</span>
                                )}
                                <span
                                  className={
                                    last ? "font-medium text-zinc-900" : undefined
                                  }
                                >
                                  {page}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                        {INTENT_BADGE[s.intent] && (
                          <Badge
                            tone={INTENT_BADGE[s.intent]!.tone}
                            className="shrink-0"
                          >
                            {INTENT_BADGE[s.intent]!.label}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-zinc-600">
                      {s.userEmail ? (
                        <Link
                          href={`/admin/users?q=${encodeURIComponent(s.userEmail)}`}
                          className="transition-smooth ring-focus text-accent-700 hover:underline"
                          title="Manage this user"
                        >
                          {s.userEmail}
                        </Link>
                      ) : (
                        "Anonymous"
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-zinc-600">
                      {s.source}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600">
                      {s.country ? (
                        <>
                          <span className="mr-1" aria-hidden>
                            {countryFlag(s.country)}
                          </span>
                          {countryName(s.country)}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <Globe className="h-3.5 w-3.5" aria-hidden />
                          Unknown
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-zinc-600">
                      {s.device ?? (
                        <MonitorSmartphone
                          className="h-3.5 w-3.5 text-zinc-400"
                          aria-label="Unknown device"
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 pr-5 text-right tabular-nums text-zinc-500 sm:pr-6">
                      {timeAgo(s.startedAt, nowMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {overflow > 0 && (
            <p className="border-t border-zinc-100 px-5 py-2.5 text-xs text-zinc-400 sm:px-6">
              +{overflow} more active {overflow === 1 ? "session" : "sessions"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
