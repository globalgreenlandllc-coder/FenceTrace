"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  CreditCard,
  Eye,
  FileText,
  Mail,
  XCircle,
  Clock,
} from "lucide-react";
import { timeAgo, type ActivityEvent } from "@/lib/dashboard-mock";

const ICONS: Record<
  ActivityEvent["kind"],
  { icon: React.ComponentType<{ className?: string }>; bg: string; fg: string }
> = {
  paid: { icon: CreditCard, bg: "bg-emerald-50", fg: "text-emerald-600" },
  accepted: { icon: Check, bg: "bg-emerald-50", fg: "text-emerald-600" },
  viewed: { icon: Eye, bg: "bg-accent-50", fg: "text-accent-700" },
  sent: { icon: Mail, bg: "bg-sky-50", fg: "text-sky-600" },
  drafted: { icon: FileText, bg: "bg-zinc-100", fg: "text-zinc-500" },
  declined: { icon: XCircle, bg: "bg-rose-50", fg: "text-rose-600" },
  expired: { icon: Clock, bg: "bg-amber-50", fg: "text-amber-600" },
};

const VISIBLE = 5;

export function ActivityFeed({
  events,
  loading,
}: {
  events: ActivityEvent[];
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const shown = expanded ? events : events.slice(0, VISIBLE);
  const hidden = events.length - VISIBLE;

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
        Recent activity
      </h3>
      <div className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
        Who did what, just now
      </div>
      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
          Once a homeowner views, signs, or pays a proposal, you&apos;ll see it
          here in real time.
        </div>
      ) : null}
      <ul className="mt-2">
        {shown.map((e, i) => {
          const meta = ICONS[e.kind];
          return (
            <motion.li
              key={e.id}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, VISIBLE) * 0.03 }}
              className="flex gap-3 border-t border-zinc-100 py-3 first:border-t-0"
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.bg} ${meta.fg}`}
              >
                <meta.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-900">
                  {e.client}
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {e.message}
                </div>
              </div>
              <div className="shrink-0 text-xs text-zinc-400">
                {timeAgo(e.at)}
              </div>
            </motion.li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <div className="border-t border-zinc-100 pt-3 text-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="transition-smooth ring-focus rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
          >
            {expanded ? "Show less" : `Show ${hidden} more`}
          </button>
        </div>
      )}
    </div>
  );
}
