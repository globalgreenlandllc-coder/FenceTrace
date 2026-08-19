"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Send, Zap } from "lucide-react";
import { useSession } from "@/lib/auth-mock";
import { getMyBilling, type MyBilling } from "@/app/actions/billing";
import { cn } from "@/lib/utils";

/**
 * PlanChip — the topbar allowance pill.
 *
 * Shows the ONE limit FenceScan actually enforces: proposals SENT per
 * calendar month on the free plan (app/actions/proposals.ts refuses the
 * send past the cap). It replaced a "takeoff credits" wallet that no
 * code path ever debited and no checkout could refill — a counter that
 * told contractors they were nearly out of something that was, in fact,
 * unlimited.
 *
 * Scans, takeoffs and drafts are free and unmetered on every plan; the
 * popover says so out loud so nobody rations them.
 */
export function PlanChip() {
  const { session } = useSession();
  const [billing, setBilling] = useState<MyBilling | null>(null);
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    getMyBilling().then(setBilling).catch(() => undefined);
  }, []);

  if (!session) return null;

  const isAdmin = session.user.role === "SUPER_ADMIN";
  const isPro = billing?.plan?.status === "ACTIVE";
  const unlimited = isAdmin || isPro;

  const cap = billing?.freeSendCap ?? 3;
  const sent = billing?.sentThisMonth ?? 0;
  const left = Math.max(0, cap - sent);
  const out = !unlimited && left === 0;
  const low = !unlimited && left === 1;

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
        <Send
          className={cn(
            "h-3.5 w-3.5",
            out ? "text-rose-600" : low ? "text-amber-600" : "text-accent-600",
          )}
        />
        <span className="text-[12px] font-semibold tabular-nums">
          {unlimited ? "Unlimited" : `${left} / ${cap}`}
        </span>
        <span className="hidden text-zinc-400 sm:inline">
          {isAdmin ? "admin" : isPro ? "proposals" : "sends left"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-20 mt-2 w-72 origin-top-right rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-elevated"
            >
              <div className="microlabel">
                {unlimited ? "Your plan" : "Proposal sends this month"}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
                  {unlimited ? "Unlimited" : left}
                </span>
                <span className="text-xs text-zinc-500">
                  {isAdmin
                    ? "admin account"
                    : isPro
                      ? billing?.proName ?? "Pro"
                      : `of ${cap} left · ${sent} sent`}
                </span>
              </div>
              {!unlimited && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn(
                      "anim-grow-x h-full rounded-full",
                      out ? "bg-rose-500" : low ? "bg-amber-500" : "bg-accent-600",
                    )}
                    style={{ width: `${Math.round((left / Math.max(1, cap)) * 100)}%` }}
                  />
                </div>
              )}

              <div className="mt-3 space-y-1.5 text-xs">
                <Row label="Property scans" value="Free · unlimited" />
                <Row label="Takeoffs & drafts" value="Free · unlimited" />
                <Row
                  label={unlimited ? "Renews" : "Cap resets"}
                  value={
                    isPro && billing?.plan?.renewsAt
                      ? new Date(billing.plan.renewsAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : isAdmin
                        ? "—"
                        : "1st of the month"
                  }
                />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Link
                  href="/dashboard/settings"
                  onClick={() => setOpen(false)}
                  className="transition-smooth ring-focus press-scale inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-accent-700"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {unlimited ? "Manage plan" : "Upgrade to unlimited"}
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
