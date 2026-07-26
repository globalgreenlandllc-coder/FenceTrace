"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowRight, Layers, Receipt, Wallet } from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import type { EstimateConfig, LineItem, Measurements } from "@/lib/types";
import { buildLineItems } from "@/lib/pricing";
import {
  computeEstimateTotals,
  formatDelta,
  markupForEstimateTarget,
  type Adjustments,
} from "@/lib/estimate-totals";
import { getAiPriceQuotes } from "@/app/actions/ai-pricing";
import { aiPriceInputKey } from "@/components/proposal/ai-price-switch";
import type { AiPriceQuote } from "@/lib/proposal-mock";
import type { EstimateHandoff } from "@/lib/estimate-handoff";
import { MaterialSelector } from "./material-selector";
import { PricingTable } from "./pricing-table";
import { Summary } from "./summary";
import { cn, formatCurrency } from "@/lib/utils";

type Tab = "materials" | "pricing" | "summary";

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: "materials", label: "Materials", icon: Layers },
  { id: "pricing", label: "Pricing", icon: Receipt },
  { id: "summary", label: "Summary", icon: Wallet },
];

export function PricingPanel({
  measurements,
  handoff,
  jobType = "replacement",
}: {
  measurements: Measurements;
  /** Threaded through to Summary so its "Send to client" button can
   *  hand the live takeoff (address + measurements + eaves + image)
   *  off to /proposal. */
  handoff?: Omit<EstimateHandoff, "capturedAt">;
  /** Replacement jobs default to the FREE old-gutter-removal line (the
   *  client-attracting move); new construction has nothing to remove. */
  jobType?: "new" | "replacement";
}) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>("materials");
  const [config, setConfig] = useState<EstimateConfig>({
    size: "6",
    style: "k-style",
    material: "aluminum",
    color: "white",
    downspoutSize: "3x4",
    oldGutterRemoval: jobType === "new" ? "none" : "free",
  });

  const auto = useMemo(
    () => buildLineItems(measurements, config),
    [measurements, config],
  );
  const [items, setItems] = useState<LineItem[]>(auto);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setItems((prev) => {
      const autoIds = new Set(auto.map((i) => i.id));
      const custom = prev.filter((i) => !autoIds.has(i.id));
      return [...auto, ...custom];
    });
  }, [auto]);

  const [adjustments, setAdjustments] = useState<Adjustments>({
    markupPct: 15,
    discountPct: 0,
    taxPct: 8.25,
  });

  const totals = useMemo(
    () => computeEstimateTotals(items, adjustments),
    [items, adjustments],
  );

  // ── AI market price switch (same proposal-wide feature, applied to the
  //    single estimate): fetch a location quote and back-solve the markup so
  //    the estimate total lands on the AI number; flipping back restores the
  //    contractor's own markup. Per-line AI prices ride on the quote and
  //    surface in the pricing table. Address comes from the takeoff handoff. ─
  const aiAddress = (handoff?.address ?? "").trim();
  const [ai, setAi] = useState<{
    mode: "manual" | "ai";
    quote: AiPriceQuote | null;
    stashedMarkup: number | null;
    busy: boolean;
    error: string | null;
  }>({ mode: "manual", quote: null, stashedMarkup: null, busy: false, error: null });

  const aiKey = useMemo(
    () => aiPriceInputKey(aiAddress, config, measurements),
    [aiAddress, config, measurements],
  );
  const aiStale = ai.mode === "ai" && !!ai.quote && ai.quote.inputKey !== aiKey;

  const applyAiQuote = useCallback(
    (q: AiPriceQuote, leavingManual: boolean) => {
      const m = markupForEstimateTarget(
        q.recommendedTotal,
        items,
        adjustments.discountPct,
        adjustments.taxPct,
      );
      setAdjustments((a) => ({ ...a, markupPct: Math.round(m * 10) / 10 }));
      setAi((s) => ({
        mode: "ai",
        quote: q,
        stashedMarkup: leavingManual ? adjustments.markupPct : s.stashedMarkup,
        busy: false,
        error: null,
      }));
    },
    [items, adjustments.discountPct, adjustments.taxPct, adjustments.markupPct],
  );

  const switchAiMode = useCallback(
    async (next: "manual" | "ai") => {
      if (next === "manual") {
        setAdjustments((a) => ({
          ...a,
          markupPct: ai.stashedMarkup ?? a.markupPct,
        }));
        setAi((s) => ({ ...s, mode: "manual", error: null }));
        return;
      }
      if (ai.busy) return;
      if (ai.quote && ai.quote.inputKey === aiKey) {
        applyAiQuote(ai.quote, ai.mode !== "ai");
        return;
      }
      if (!aiAddress) {
        setAi((s) => ({
          ...s,
          error: "Add the property address first — the AI prices by location.",
        }));
        return;
      }
      setAi((s) => ({ ...s, busy: true, error: null }));
      const r = await getAiPriceQuotes({
        address: aiAddress,
        measurements,
        packages: [
          { id: "estimate", name: "Estimate", config, inputKey: aiKey },
        ],
      });
      if (!r.ok) {
        setAi((s) => ({ ...s, busy: false, error: r.reason }));
        return;
      }
      const q = r.quotes["estimate"];
      if (!q) {
        setAi((s) => ({ ...s, busy: false, error: "No quote returned" }));
        return;
      }
      applyAiQuote(q, ai.mode !== "ai");
    },
    [ai, aiKey, aiAddress, measurements, config, applyAiQuote],
  );

  const refreshAi = useCallback(async () => {
    if (!aiAddress || ai.busy) return;
    setAi((s) => ({ ...s, busy: true, error: null }));
    const r = await getAiPriceQuotes({
      address: aiAddress,
      measurements,
      packages: [{ id: "estimate", name: "Estimate", config, inputKey: aiKey }],
    });
    if (!r.ok) {
      setAi((s) => ({ ...s, busy: false, error: r.reason }));
      return;
    }
    const q = r.quotes["estimate"];
    if (q) applyAiQuote(q, false);
    else setAi((s) => ({ ...s, busy: false }));
  }, [aiAddress, ai.busy, measurements, config, aiKey, applyAiQuote]);

  /**
   * Client-total impact of a hypothetical config change — powers the
   * price pills on the material chips. Mirrors exactly what clicking
   * the chip does: auto items regenerate for the new config, custom
   * rows carry over, adjustments apply on top.
   */
  const deltaFor = useCallback(
    (patch: Partial<EstimateConfig>) => {
      const autoIds = new Set(auto.map((i) => i.id));
      const custom = items.filter((i) => !autoIds.has(i.id));
      const nextItems = [
        ...buildLineItems(measurements, { ...config, ...patch }),
        ...custom,
      ];
      return (
        computeEstimateTotals(nextItems, adjustments).total - totals.total
      );
    },
    [auto, items, measurements, config, adjustments, totals.total],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200/70 px-4 pb-4 pt-4">
        <h2 className="microlabel text-accent-600">Estimate builder</h2>
        <p className="mt-1 text-xs text-zinc-500">
          AI scope auto-applies. Override anything below.
        </p>
        <div className="mt-3 flex rounded-lg border border-zinc-200 bg-white p-0.5">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "ring-focus relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-smooth",
                  active ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                {/* Sliding active-tab pill — one shared layoutId so the
                    highlight glides between tabs instead of snapping. */}
                {active && (
                  <motion.span
                    layoutId="estimate-tab-pill"
                    className="absolute inset-0 rounded-md bg-zinc-100"
                    transition={{ duration: reduce ? 0 : DUR.base, ease: EASE }}
                  />
                )}
                <t.icon className="relative h-3.5 w-3.5" />
                <span className="relative">{t.label}</span>
                {t.id === "pricing" && (
                  <motion.span
                    key={items.length}
                    initial={reduce ? false : { scale: 0.8, opacity: 0.5 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: DUR.fast, ease: EASE }}
                    className={cn(
                      "relative rounded-full px-1.5 text-[10px] font-semibold tabular-nums transition-smooth",
                      active
                        ? "bg-accent-100 text-accent-700"
                        : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {items.length}
                  </motion.span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE }}
          >
            {tab === "materials" && (
              <MaterialSelector
                config={config}
                onChange={setConfig}
                deltaFor={deltaFor}
                measurements={measurements}
              />
            )}
            {tab === "pricing" && (
              <PricingTable items={items} onChange={setItems} baseline={auto} />
            )}
            {tab === "summary" && (
              <Summary
                items={items}
                adjustments={adjustments}
                onAdjust={setAdjustments}
                handoff={handoff}
                measurements={measurements}
                ai={{
                  mode: ai.mode,
                  busy: ai.busy,
                  error: ai.error,
                  stale: aiStale,
                  quote: ai.quote,
                  onSwitch: switchAiMode,
                  onRefresh: refreshAi,
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <LiveTotalBar
        total={totals.total}
        itemCount={items.length}
        perLF={
          measurements.eaveLF > 0 ? totals.total / measurements.eaveLF : null
        }
        onReview={() => setTab("summary")}
        showReview={tab !== "summary"}
      />
    </div>
  );
}

/**
 * Sticky footer visible on every tab: the client total reacts live to
 * material picks and line-item edits, with a delta flash so the cost of
 * a change is legible without leaving the tab.
 */
function LiveTotalBar({
  total,
  itemCount,
  perLF,
  onReview,
  showReview,
}: {
  total: number;
  itemCount: number;
  perLF: number | null;
  onReview: () => void;
  showReview: boolean;
}) {
  const reduce = useReducedMotion();
  const prev = useRef(total);
  const [flash, setFlash] = useState<{ delta: number; key: number } | null>(
    null,
  );

  useEffect(() => {
    const delta = total - prev.current;
    prev.current = total;
    if (Math.abs(delta) >= 0.5) {
      setFlash({ delta, key: Date.now() });
      const t = setTimeout(() => setFlash(null), 1600);
      return () => clearTimeout(t);
    }
  }, [total]);

  return (
    <div className="border-t border-zinc-200/70 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="microlabel">Client total</span>
            <AnimatePresence>
              {flash && (
                <motion.span
                  key={flash.key}
                  initial={reduce ? false : { opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    flash.delta > 0
                      ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {formatDelta(flash.delta)}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-baseline gap-2.5">
            <motion.span
              key={Math.round(total)}
              initial={reduce ? false : { opacity: 0.5, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.base, ease: EASE }}
              className="text-xl font-semibold tracking-tight tabular-nums text-zinc-900"
            >
              {formatCurrency(total)}
            </motion.span>
            <span className="truncate text-[11px] text-zinc-400">
              {itemCount} items
              {perLF !== null && ` · ${formatCurrency(perLF)}/LF`}
            </span>
          </div>
        </div>
        {showReview && (
          <button
            onClick={onReview}
            className="group ring-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-xs font-semibold text-white shadow-sm transition-smooth hover:bg-accent-700 active:scale-[0.98]"
          >
            Review & send
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </button>
        )}
      </div>
    </div>
  );
}
