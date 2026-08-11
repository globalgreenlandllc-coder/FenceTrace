"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  X,
  CheckCircle2,
  HardHat,
  LifeBuoy,
  Megaphone,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkerActivityDTO } from "@/app/actions/workers";
import type { BellCounts } from "@/app/actions/notifications";
import { shellDataCached, dropAnnouncementFromCache } from "./shell-data";
import {
  dismissAnnouncement,
  type UserAnnouncement,
} from "@/app/actions/announcements";

const SEEN_KEY = "fencescan:worker-activity-seen";

/* Compact per-level styling for announcements read inside the dropdown. */
const ANN_STYLE: Record<
  UserAnnouncement["level"],
  { icon: typeof Megaphone; color: string }
> = {
  INFO: { icon: Megaphone, color: "text-accent-600" },
  SUCCESS: { icon: CheckCircle2, color: "text-emerald-600" },
  WARNING: { icon: AlertTriangle, color: "text-amber-600" },
  CRITICAL: { icon: AlertOctagon, color: "text-rose-600" },
};

/** Notifications bell: recent worker job responses (accepted / declined /
 *  completed) PLUS support replies and new announcements. Announcements open
 *  and dismiss right inside the dropdown — no navigation needed. The worker
 *  dot uses a localStorage watermark; support/announcement counts are derived
 *  (PENDING tickets / undismissed announcements) so they clear on action. */
export function NotificationsBell() {
  const [items, setItems] = useState<WorkerActivityDTO[]>([]);
  const [counts, setCounts] = useState<BellCounts>({
    support: 0,
    announcements: 0,
    adminTickets: 0,
  });
  const [announcements, setAnnouncements] = useState<UserAnnouncement[]>([]);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>(() => {
    if (typeof window === "undefined") return new Date(0).toISOString();
    return localStorage.getItem(SEEN_KEY) ?? new Date(0).toISOString();
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // One shared, cached round trip with the announcement banner — a
    // page switch inside the freshness window paints from memory and
    // fires nothing. The interval forces a real refresh.
    const load = (maxAgeMs: number) =>
      shellDataCached(maxAgeMs)
        .then((d) => {
          if (!alive) return;
          setItems(d.activity);
          setCounts(d.counts);
          setAnnouncements(d.announcements);
        })
        .catch(() => undefined);
    load(30_000);
    const t = setInterval(() => load(0), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // The announcement count comes from the live list (not the polled counter)
  // so dismissing one inside the dropdown updates the badge instantly.
  const annCount = announcements.length;
  const unseen =
    items.filter((i) => i.at > seenAt).length + counts.support + annCount;
  const hasComms = counts.support > 0 || annCount > 0;

  function onDismissAnnouncement(id: string) {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    dropAnnouncementFromCache(id);
    void dismissAnnouncement(id);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      setSeenAt(now);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="transition-smooth ring-focus relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unseen > 0 && (
          <span className="anim-pop absolute right-1.5 top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent-600 px-0.5 text-[9px] font-bold leading-none text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="anim-pop origin-top-right absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-elevated">
          {hasComms && (
            <div className="border-b border-zinc-100 py-1">
              {counts.support > 0 && (
                <Link
                  href="/dashboard/support"
                  onClick={() => setOpen(false)}
                  className="transition-smooth ring-focus flex items-center gap-2.5 px-4 py-2.5 hover:bg-zinc-50"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-700">
                    <LifeBuoy className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-zinc-700">
                    {counts.support === 1
                      ? "A support reply is waiting"
                      : `${counts.support} support replies waiting`}
                  </span>
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {counts.support}
                  </span>
                </Link>
              )}
              {annCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowAnnouncements((v) => !v)}
                    className="transition-smooth ring-focus flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-zinc-50"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-700">
                      <Megaphone className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-zinc-700">
                      {annCount === 1
                        ? "New announcement"
                        : `${annCount} new announcements`}
                    </span>
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {annCount}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 text-zinc-400 transition-transform",
                        showAnnouncements && "rotate-180",
                      )}
                    />
                  </button>
                  {showAnnouncements && (
                    <ul className="max-h-64 space-y-2 overflow-y-auto px-4 pb-3 pt-1">
                      {announcements.map((a) => {
                        const s = ANN_STYLE[a.level];
                        const Icon = s.icon;
                        return (
                          <li
                            key={a.id}
                            className="anim-enter-fade rounded-xl border border-zinc-200 bg-zinc-50/60 p-3"
                          >
                            <div className="flex items-start gap-2">
                              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.color)} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-zinc-900">
                                  {a.title}
                                </p>
                                <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600">
                                  {a.body}
                                </p>
                                <div className="mt-1.5 flex items-center justify-between">
                                  <span className="text-[10px] text-zinc-400">
                                    {new Date(a.publishedAt).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onDismissAnnouncement(a.id)}
                                    className="transition-smooth ring-focus rounded-md px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          <div className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold tracking-tight text-zinc-900">
            Worker activity
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              No recent responses from your crew.
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-zinc-50 overflow-y-auto">
              {items.map((i) => (
                <li key={i.id}>
                  <Link
                    href="/dashboard/workers"
                    onClick={() => setOpen(false)}
                    className="transition-smooth ring-focus flex items-start gap-2.5 px-4 py-2.5 hover:bg-zinc-50"
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                        i.event === "ACCEPTED" && "bg-emerald-50 text-emerald-600",
                        i.event === "DECLINED" && "bg-rose-50 text-rose-600",
                        i.event === "STARTED" && "bg-sky-50 text-sky-600",
                        i.event === "COMPLETED" && "bg-accent-50 text-accent-700",
                      )}
                    >
                      {i.event === "ACCEPTED" && <Check className="h-3.5 w-3.5" />}
                      {i.event === "DECLINED" && <X className="h-3.5 w-3.5" />}
                      {i.event === "STARTED" && <Play className="h-3.5 w-3.5" />}
                      {i.event === "COMPLETED" && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 text-sm text-zinc-700">
                      <strong className="font-medium text-ink">{i.workerName}</strong>{" "}
                      {i.event === "ACCEPTED"
                        ? "accepted"
                        : i.event === "DECLINED"
                          ? "declined"
                          : i.event === "STARTED"
                            ? "started"
                            : "completed"}{" "}
                      <span className="text-zinc-500">“{i.jobTitle}”</span>
                      {i.declineReason && (
                        <span className="mt-0.5 block truncate text-xs text-rose-600">
                          {i.declineReason}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-zinc-400">
                        {new Date(i.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/workers"
            onClick={() => setOpen(false)}
            className="transition-smooth ring-focus flex items-center justify-center gap-1.5 border-t border-zinc-100 px-4 py-2 text-xs font-medium text-accent-700 hover:bg-zinc-50"
          >
            <HardHat className="h-3.5 w-3.5" /> Manage workers
          </Link>
        </div>
      )}
    </div>
  );
}
