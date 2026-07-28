"use client";

import type { CampaignStat, ChannelStat } from "@/app/actions/analytics";
import { compact } from "./format";

/* Where sessions come from (first-touch channel) and how each channel
   converts to sign-ups — the table to watch when ads go live. */

export function ChannelsCard({ channels }: { channels: ChannelStat[] }) {
  return (
    <section className="surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        Channels
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        First-touch source of each session · sign-ups attributed to the
        visitor&apos;s first session
      </p>
      {channels.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">
          Channel data appears with the first tracked visit.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="font-label text-left text-[11px] text-zinc-400">
                <th className="py-2 pr-3 font-medium">Channel</th>
                <th className="py-2 pr-3 text-right font-medium">Sessions</th>
                <th className="py-2 pr-3 text-right font-medium">Visitors</th>
                <th className="py-2 pr-3 text-right font-medium">Sign-ups</th>
                <th className="py-2 text-right font-medium">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel} className="border-t border-zinc-100">
                  <td className="py-2 pr-3 font-medium text-zinc-800">{c.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">
                    {compact(c.sessions)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">
                    {compact(c.visitors)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold text-zinc-900">
                    {c.signups}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-600">
                    {c.visitors > 0
                      ? `${Math.round((c.signups / c.visitors) * 1000) / 10}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CampaignsCard({ campaigns }: { campaigns: CampaignStat[] }) {
  return (
    <section className="surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        Ad campaigns (UTM)
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        Sessions from links tagged with UTM parameters
      </p>
      {campaigns.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4">
          <p className="text-sm text-zinc-600">
            No tagged traffic yet. When you run ads, tag the destination link
            and every campaign shows up here with its own sign-up count:
          </p>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 font-mono text-xs text-accent-700">
            https://fencescan.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring-launch
          </code>
          <p className="mt-2 text-xs text-zinc-400">
            Google Ads (gclid) and Facebook Ads (fbclid) clicks are also
            detected automatically as paid traffic.
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="font-label text-left text-[11px] text-zinc-400">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 font-medium">Source / medium</th>
                <th className="py-2 pr-3 text-right font-medium">Sessions</th>
                <th className="py-2 pr-3 text-right font-medium">Visitors</th>
                <th className="py-2 text-right font-medium">Sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={`${c.source}|${c.medium}|${c.campaign}|${i}`} className="border-t border-zinc-100">
                  <td className="max-w-[180px] truncate py-2 pr-3 font-medium text-zinc-800">
                    {c.campaign}
                  </td>
                  <td className="max-w-[160px] truncate py-2 pr-3 text-zinc-600">
                    {c.source} / {c.medium}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">
                    {compact(c.sessions)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">
                    {compact(c.visitors)}
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-zinc-900">
                    {c.signups}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
