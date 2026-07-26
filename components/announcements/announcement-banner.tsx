"use client";

import { useEffect, useState } from "react";
import { X, Megaphone, CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getActiveAnnouncements,
  dismissAnnouncement,
  type UserAnnouncement,
} from "@/app/actions/announcements";

const STYLE: Record<
  UserAnnouncement["level"],
  { wrap: string; icon: typeof Megaphone; iconColor: string; label: string }
> = {
  INFO: {
    wrap: "border-accent-200 bg-accent-50",
    icon: Megaphone,
    iconColor: "text-accent-600",
    label: "text-accent-800",
  },
  SUCCESS: {
    wrap: "border-emerald-200 bg-emerald-50",
    icon: CheckCircle2,
    iconColor: "text-emerald-600",
    label: "text-emerald-800",
  },
  WARNING: {
    wrap: "border-amber-200 bg-amber-50",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
    label: "text-amber-800",
  },
  CRITICAL: {
    wrap: "border-rose-200 bg-rose-50",
    icon: AlertOctagon,
    iconColor: "text-rose-600",
    label: "text-rose-800",
  },
};

/** Self-fetching banner for the signed-in user's active announcements. Drop
 *  it near the top of the app shell; renders nothing when there's nothing to
 *  show. Dismiss is optimistic + persisted per user. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<UserAnnouncement[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void getActiveAnnouncements().then((a) => {
        if (alive) setItems(a);
      });
    load();
    // The shell (and this banner) mounts once and survives client-side
    // navigation, so an announcement published mid-session would never show
    // without a refetch. Coming back to the tab is the natural moment.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (items.length === 0) return null;

  function dismiss(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
    void dismissAnnouncement(id);
  }

  return (
    <div className="space-y-2 print:hidden">
      {items.map((a) => {
        const s = STYLE[a.level];
        const Icon = s.icon;
        return (
          <div
            key={a.id}
            className={cn(
              "relative flex gap-3 rounded-xl border px-4 py-3",
              s.wrap,
            )}
          >
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", s.iconColor)} />
            <div className="min-w-0 flex-1 pr-6">
              <p className={cn("text-sm font-semibold", s.label)}>{a.title}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600">
                {a.body}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(a.id)}
              className="ring-focus absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-smooth hover:bg-white/60 hover:text-zinc-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
