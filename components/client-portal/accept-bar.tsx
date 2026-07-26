"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { DUR, EASE } from "@/lib/motion";

export function AcceptBar({
  packageName,
  total,
  listTotal,
  depositPct,
  paymentChoice,
  onPaymentChoice,
  canAccept,
  reason,
  onAccept,
}: {
  packageName: string;
  total: number;
  /** Pre-discount list total. When present and above `total`, the bar
   *  shows it struck through — a negotiated win, visible at commit time. */
  listTotal?: number;
  depositPct: number;
  paymentChoice: "deposit" | "full";
  onPaymentChoice: (c: "deposit" | "full") => void;
  canAccept: boolean;
  reason?: string;
  onAccept: () => void;
}) {
  const deposit = total * (depositPct / 100);
  const due = paymentChoice === "deposit" ? deposit : total;
  const discounted = typeof listTotal === "number" && listTotal > total + 0.5;
  const saved = discounted ? listTotal! - total : 0;
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: DUR.slow, ease: EASE }}
      className="sticky bottom-0 z-30 border-t border-zinc-200 bg-white print:hidden"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] text-zinc-500">
              Selected · {packageName}
            </div>
            {discounted && (
              <Badge tone="emerald" className="anim-enter-fade">
                You saved {formatCurrency(saved)}
              </Badge>
            )}
          </div>
          <div className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
            {formatCurrency(due)}
            {discounted && (
              <span className="text-sm font-normal text-zinc-400 line-through">
                {formatCurrency(
                  paymentChoice === "deposit"
                    ? listTotal! * (depositPct / 100)
                    : listTotal!,
                )}
              </span>
            )}
            <span className="text-xs font-normal text-zinc-500">
              {paymentChoice === "deposit"
                ? `due today · ${formatCurrency(total - deposit)} on completion`
                : "due today"}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-xl border border-zinc-200 bg-white p-1 text-xs">
            <button
              onClick={() => onPaymentChoice("deposit")}
              className={
                "transition-smooth press-scale ring-focus rounded-lg px-3 py-1.5 " +
                (paymentChoice === "deposit"
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900")
              }
            >
              {depositPct}% deposit
            </button>
            <button
              onClick={() => onPaymentChoice("full")}
              className={
                "transition-smooth press-scale ring-focus rounded-lg px-3 py-1.5 " +
                (paymentChoice === "full"
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900")
              }
            >
              Pay in full
            </button>
          </div>

          <div className="flex flex-col gap-1 sm:items-end">
            <Button
              size="lg"
              onClick={onAccept}
              disabled={!canAccept}
              className="w-full sm:w-auto"
            >
              <Lock className="h-4 w-4" />
              Accept & pay {formatCurrency(due)}
            </Button>
            {!canAccept && reason && (
              <span className="anim-enter-fade text-xs text-zinc-500">
                {reason}
              </span>
            )}
            {canAccept && (
              <Badge
                tone="neutral"
                className="anim-enter-fade self-stretch sm:self-end"
              >
                <ShieldCheck className="h-3 w-3" />
                Secured by Stripe
              </Badge>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
