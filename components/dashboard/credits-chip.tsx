"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, Zap } from "lucide-react";
import { useSession } from "@/lib/auth-mock";
import { cn } from "@/lib/utils";

export function CreditsChip() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  if (!session) return null;

  // SUPER_ADMIN has no wallet — render an "Unlimited" pill instead of
  // the numeric counter so they don't see a misleading 12/12 that
  // never decrements.
  const isAdmin = session.user.role === "SUPER_ADMIN";
  const total = session.credits.included + session.credits.bonus;
  const remaining = Math.max(total - session.credits.used, 0);
  const pct = isAdmin ? 100 : total > 0 ? Math.round((remaining / total) * 100) : 0;
  // "Low" only makes sense when some credits have actually been burned —
  // a free plan sitting at its full 1/1 shouldn't glow amber.
  const low = !isAdmin && remaining <= 3 && remaining < total;
  const out = !isAdmin && remaining === 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "transition-smooth ring-focus inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium",
          out
            ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300"
            : low
            ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300"
            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
        )}
      >
        <Sparkles
          className={cn(
            "h-3.5 w-3.5",
            out
              ? "text-rose-600"
              : low
              ? "text-amber-600"
              : "text-accent-600",
          )}
        />
        <span className="text-[12px] font-semibold tabular-nums">
          {isAdmin ? "∞" : `${remaining} / ${total}`}
        </span>
        <span className="hidden sm:inline text-zinc-400">
          {isAdmin ? "admin" : "credits"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-20 mt-2 w-72 origin-top-right rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-elevated"
            >
              <div className="microlabel">Plan credits</div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
                  {isAdmin ? "Unlimited" : remaining}
                </span>
                <span className="text-xs text-zinc-500">
                  {isAdmin ? "admin account" : `of ${total} remaining`}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                {/* Width stays static; the draw-in is scaleX only. */}
                <div
                  className={cn(
                    "anim-grow-x h-full rounded-full",
                    out
                      ? "bg-rose-500"
                      : low
                      ? "bg-amber-500"
                      : "bg-accent-600",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="mt-3 space-y-1.5 text-xs">
                <Row label="Property scans" value="Free · don't use credits" />
                <Row
                  label="Renews"
                  value={
                    session.credits.renews
                      ? new Date(session.credits.resetsAt).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )
                      : "Pro renews monthly"
                  }
                />
                <Row
                  label="Bonus credits"
                  value={String(session.credits.bonus)}
                />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Link
                  href="/dashboard/settings"
                  onClick={() => setOpen(false)}
                  className="transition-smooth ring-focus press-scale inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-accent-700"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Manage plan
                </Link>
                <Link
                  href="/dashboard/proposals/new"
                  onClick={() => setOpen(false)}
                  className="transition-smooth ring-focus press-scale inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                >
                  New proposal
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-zinc-500">
      <span>{label}</span>
      <span className="font-medium text-zinc-900">{value}</span>
    </div>
  );
}
