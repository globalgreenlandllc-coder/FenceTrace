"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Loader2, Send, Sparkles } from "lucide-react";
import { DUR, EASE, fadeInUp, staggerContainer } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { LineItem, Measurements } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  computeEstimateTotals,
  type Adjustments,
} from "@/lib/estimate-totals";
import {
  writeEstimateHandoff,
  type EstimateHandoff,
} from "@/lib/estimate-handoff";
import type { AiPriceQuote } from "@/lib/proposal-mock";

export type { Adjustments };

/** The estimate's "Your price ⇄ AI market price" switch, wired by
 *  PricingPanel (single-estimate AI pricing back-solved into the markup). */
export type EstimateAiPricing = {
  mode: "manual" | "ai";
  busy: boolean;
  error: string | null;
  stale: boolean;
  quote: AiPriceQuote | null;
  onSwitch: (next: "manual" | "ai") => void;
  onRefresh: () => void;
};

export function Summary({
  items,
  adjustments,
  onAdjust,
  handoff,
  measurements,
  ai,
}: {
  items: LineItem[];
  adjustments: Adjustments;
  onAdjust: (a: Adjustments) => void;
  /** Hand off to /proposal so the proposal flow boots from the real
   *  takeoff (and renders the satellite image) instead of the stock
   *  sample. */
  handoff?: Omit<EstimateHandoff, "capturedAt">;
  /** Powers the $/LF stat — the number contractors sanity-check first. */
  measurements?: Measurements;
  /** AI market-price switch state (optional — omit to hide the toggle). */
  ai?: EstimateAiPricing;
}) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const handoffAndGo = () => {
    if (handoff) writeEstimateHandoff(handoff);
    router.push("/proposal");
  };
  const { subtotal, markup, discount, tax, total } = computeEstimateTotals(
    items,
    adjustments,
  );
  // What the contractor keeps on top of cost basis: markup minus the
  // discount they gave back.
  const margin = markup - discount;
  const perLF =
    measurements && measurements.eaveLF > 0
      ? total / measurements.eaveLF
      : null;

  return (
    // Light stagger so the tab assembles top-down: insights → dials →
    // totals → actions. Children carry variants only.
    <motion.div
      initial={reduce ? false : "hidden"}
      animate="visible"
      variants={staggerContainer(0.04)}
      className="space-y-4"
    >
      {/* AI market-price switch — Your price ⇄ AI, up top by the numbers so
          the two pricings are one tap apart before sending. */}
      {ai && (
        <motion.div variants={fadeInUp}>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-1">
            <button
              type="button"
              onClick={() => ai.mode !== "manual" && ai.onSwitch("manual")}
              className={cn(
                "ring-focus rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-smooth",
                ai.mode === "manual"
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-50",
              )}
            >
              Your price
            </button>
            <button
              type="button"
              onClick={() => ai.mode !== "ai" && ai.onSwitch("ai")}
              disabled={ai.busy}
              className={cn(
                "ring-focus inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-smooth",
                ai.mode === "ai"
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {ai.busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI market price
            </button>
          </div>
          {ai.error && <p className="mt-1.5 text-xs text-rose-600">{ai.error}</p>}
          {ai.mode === "ai" && ai.stale && !ai.busy && (
            <button
              type="button"
              onClick={ai.onRefresh}
              className="ring-focus mt-1.5 text-[11px] font-medium text-amber-700 transition-smooth hover:text-amber-800"
            >
              Spec or footage changed — tap to re-price
            </button>
          )}
        </motion.div>
      )}

      {/* The two numbers a contractor sanity-checks before sending */}
      <motion.div variants={fadeInUp} className="grid grid-cols-2 gap-2">
        <Insight
          label="Your margin"
          value={formatCurrency(margin)}
          sub={
            subtotal > 0
              ? `${Math.round((margin / subtotal) * 100)}% over cost basis`
              : "—"
          }
          tone="emerald"
        />
        <Insight
          label="Bid rate"
          value={perLF !== null ? `${formatCurrency(perLF)}/LF` : "—"}
          sub={
            measurements
              ? `${Math.round(measurements.eaveLF)} LF of eave`
              : "no takeoff"
          }
        />
      </motion.div>

      <motion.div variants={fadeInUp} className="grid grid-cols-3 gap-2">
        <Adj
          label="Markup"
          suffix="%"
          value={adjustments.markupPct}
          onChange={(v) => onAdjust({ ...adjustments, markupPct: v })}
        />
        <Adj
          label="Discount"
          suffix="%"
          value={adjustments.discountPct}
          onChange={(v) => onAdjust({ ...adjustments, discountPct: v })}
        />
        <Adj
          label="Tax"
          suffix="%"
          value={adjustments.taxPct}
          onChange={(v) => onAdjust({ ...adjustments, taxPct: v })}
        />
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4"
      >
        <Row label="Subtotal" value={subtotal} muted />
        <Row label={`Markup (${adjustments.markupPct}%)`} value={markup} muted />
        {adjustments.discountPct > 0 && (
          <Row
            label={`Discount (${adjustments.discountPct}%)`}
            value={-discount}
            muted
            tone="discount"
          />
        )}
        <Row label={`Tax (${adjustments.taxPct}%)`} value={tax} muted />
        <div className="my-3 h-px w-full bg-zinc-200" />
        <motion.div
          key={Math.round(total)}
          initial={reduce ? false : { opacity: 0.4, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.base, ease: EASE }}
          className="flex items-baseline justify-between"
        >
          <span className="microlabel">Client total</span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900">
            {formatCurrency(total)}
          </span>
        </motion.div>
      </motion.div>

      <motion.div variants={fadeInUp} className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={handoffAndGo}>
          <Send className="h-4 w-4" />
          Send to client
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={handoffAndGo}
        >
          <FileText className="h-4 w-4" />
          Preview proposal
        </Button>
      </motion.div>

      <motion.ul
        variants={fadeInUp}
        className="space-y-1.5 text-xs text-zinc-500"
      >
        <li className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-accent-600" />
          Builds a Good · Better · Best proposal from this takeoff
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-accent-600" />
          Homeowner e-signs & picks deposit in the client portal
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-accent-600" />
          Payment schedule, receipts & reminders after acceptance
        </li>
      </motion.ul>
    </motion.div>
  );
}

function Insight({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "emerald";
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5">
      <div className="microlabel">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums tracking-tight",
          tone === "emerald" ? "text-emerald-700" : "text-zinc-900",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-zinc-400">{sub}</div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: number;
  muted?: boolean;
  tone?: "discount";
}) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={muted ? "text-zinc-500" : "text-zinc-700"}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "discount" ? "text-emerald-700" : "text-zinc-900",
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function Adj({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-white p-2.5 transition-smooth focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15">
      <span className="microlabel">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={0.5}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent text-base font-semibold tabular-nums text-zinc-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-sm text-zinc-400">{suffix}</span>
      </div>
    </label>
  );
}
