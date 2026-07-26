"use client";

import { useState } from "react";
import { PencilLine, Sparkles, TrendingUp, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  EFFECTIVE_TAX_RATE,
  packageTotal,
  type Proposal,
} from "@/lib/proposal-mock";

/**
 * "What you'll make" — the contractor-only profit readout in the builder
 * sidebar. Never rendered on the client portal.
 *
 * Cost basis = the recommended tier's pre-markup BOM subtotal (the AI
 * estimate straight from the takeoff), unless the contractor types their
 * own number — that override persists in the proposal blob
 * (`jobCostManual`) and is the same knob /dashboard/financials edits.
 * Crew pay + job extras land later, on the financials page.
 */
export function ProfitPanel({
  proposal,
  onChange,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const discountPct = Math.max(0, Math.min(50, proposal.discountPct ?? 0));
  const pick =
    proposal.packages.find((p) => p.recommended) ??
    proposal.packages[1] ??
    proposal.packages[0];
  if (!pick) return null;

  let total = 0;
  let subtotal = 0;
  try {
    const t = packageTotal(pick, proposal.measurements, discountPct);
    total = t.total;
    subtotal = t.subtotal;
  } catch {
    return null;
  }

  const manual =
    typeof proposal.jobCostManual === "number" &&
    Number.isFinite(proposal.jobCostManual)
      ? proposal.jobCostManual
      : null;
  const usingManual = manual !== null;
  const cost = manual ?? subtotal;
  const revenue = total / (1 + EFFECTIVE_TAX_RATE);
  const profit = revenue - cost;
  const marginPct = revenue > 0 ? profit / revenue : 0;
  const tone =
    profit < 0 ? "rose" : marginPct < 0.15 ? "amber" : "emerald";

  function commit() {
    const v = parseFloat(draft);
    setEditing(false);
    if (!Number.isFinite(v) || v < 0) return;
    onChange({ ...proposal, jobCostManual: v });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="font-label inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <TrendingUp className="h-3.5 w-3.5" />
          What you'll make
        </div>
        <Badge tone={tone}>
          {Math.round(marginPct * 100)}% margin
        </Badge>
      </div>

      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          tone === "rose"
            ? "text-rose-600"
            : tone === "amber"
              ? "text-amber-700"
              : "text-emerald-700",
        )}
      >
        {formatCurrency(profit)}
      </div>
      <div className="mt-0.5 text-xs text-zinc-400">
        on {pick.name} · before crew pay & job extras
      </div>

      <div className="mt-4 space-y-1.5 text-xs">
        <div className="flex items-center justify-between text-zinc-600">
          <span>Price (ex-tax)</span>
          <span className="font-medium tabular-nums text-zinc-900">
            {formatCurrency(revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-zinc-600">
          <span className="inline-flex items-center gap-1.5">
            {usingManual ? (
              <PencilLine className="h-3 w-3 text-zinc-500" />
            ) : (
              <Sparkles className="h-3 w-3 text-accent-600" />
            )}
            Your cost
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-medium",
                usingManual
                  ? "bg-zinc-100 text-zinc-600"
                  : "bg-accent-50 text-accent-700",
              )}
            >
              {usingManual ? "your number" : "AI estimate"}
            </span>
          </span>
          {editing ? (
            <span className="flex items-center gap-1">
              <span className="text-zinc-400">$</span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                inputMode="decimal"
                className="w-20 rounded-md border border-accent-300 bg-white px-1.5 py-0.5 text-right text-xs font-medium tabular-nums text-zinc-900 outline-none focus:ring-2 focus:ring-accent-500/20"
              />
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraft(cost.toFixed(0));
                  setEditing(true);
                }}
                title="Type what this job really costs you"
                className="ring-focus rounded-md border-b border-dashed border-zinc-300 font-medium tabular-nums text-zinc-900 transition-smooth hover:border-accent-400 hover:text-accent-700"
              >
                {formatCurrency(cost)}
              </button>
              {usingManual && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...proposal, jobCostManual: null })
                  }
                  title="Back to the AI estimate"
                  className="ring-focus rounded-md p-0.5 text-zinc-400 transition-smooth hover:bg-accent-50 hover:text-accent-700"
                >
                  <Undo2 className="h-3 w-3" />
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {profit < 0 && (
        <p className="anim-enter-fade mt-3 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          You're below cost on this tier — raise the price or trim the spec.
        </p>
      )}
    </div>
  );
}
