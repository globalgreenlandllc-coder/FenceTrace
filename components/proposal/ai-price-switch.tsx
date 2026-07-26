"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { getAiPriceQuotes } from "@/app/actions/ai-pricing";
import {
  markupPctForTarget,
  packageTotal,
  type AiPriceQuote,
  type Package,
} from "@/lib/proposal-mock";
import type { EstimateConfig, Measurements } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Fingerprint of everything the AI price depends on — a changed spec,
 *  footage, or address makes the cached quote read as stale. */
export function aiPriceInputKey(
  address: string,
  config: EstimateConfig,
  m: Measurements,
): string {
  return JSON.stringify([
    address.trim().toLowerCase(),
    config.size,
    config.style,
    config.material,
    config.downspoutSize,
    config.oldGutterRemoval ?? "none",
    config.accessories ?? null,
    Math.round(m.eaveLF),
    m.downspoutCount,
    m.stories,
  ]);
}

/**
 * Proposal-wide "Your price ⇄ AI market price" switch logic, shared by
 * every surface that hosts the toggle (materials builder, builder
 * sidebar, packages section). One AI call prices ALL tiers together so
 * the good/better/best ladder stays coherent; applying back-solves each
 * tier's markup to land its total on the AI number, and switching back
 * restores each tier's stashed markup exactly.
 */
export function useAiPricing({
  packages,
  measurements,
  discountPct,
  address,
  onChangePackages,
}: {
  packages: Package[];
  measurements: Measurements;
  discountPct: number;
  address: string;
  onChangePackages: (next: Package[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyFor = (p: Package) =>
    aiPriceInputKey(address, p.config, measurements);
  const mode: "manual" | "ai" = packages.some((p) => p.pricingMode === "ai")
    ? "ai"
    : "manual";
  const isStale = packages.some(
    (p) => p.aiQuote && p.aiQuote.inputKey !== keyFor(p),
  );

  /** Land every quoted tier's total on its AI number by back-solving
   *  that tier's own markup — markup stays the single stored price
   *  knob, same as EditablePrice. Tiers the AI skipped are untouched. */
  const applyQuotes = (
    quotes: Record<string, AiPriceQuote>,
    stashMarkup: boolean,
  ) =>
    onChangePackages(
      packages.map((p) => {
        const q = quotes[p.id];
        if (!q) return p;
        const { subtotal } = packageTotal(p, measurements, discountPct);
        return {
          ...p,
          pricingMode: "ai" as const,
          // Stash only when this tier is leaving manual mode — a refresh
          // while already on AI must not overwrite the saved markup.
          myMarkupPct:
            stashMarkup && p.pricingMode !== "ai"
              ? p.markupPct
              : p.myMarkupPct,
          aiQuote: q,
          markupPct: markupPctForTarget(
            q.recommendedTotal,
            subtotal,
            discountPct,
          ),
        };
      }),
    );

  async function fetchQuotes(stashMarkup: boolean) {
    if (busy) return;
    setError(null);
    if (!address.trim()) {
      setError("Add the property address first — the AI prices by location.");
      return;
    }
    setBusy(true);
    const r = await getAiPriceQuotes({
      address,
      measurements,
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        config: p.config,
        inputKey: keyFor(p),
      })),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    applyQuotes(r.quotes, stashMarkup);
  }

  // No self-guard on `mode` here: with a mixed ladder (one tier hand-
  // edited back to manual while others sit on AI) re-applying is the
  // correct way to pull the whole ladder onto one mode, and both
  // branches are idempotent. Callers guard the no-op click.
  function switchMode(next: "manual" | "ai") {
    if (next === "manual") {
      setError(null);
      // Restore each tier's own pre-AI markup — the whole ladder goes
      // back to exactly what the contractor had.
      onChangePackages(
        packages.map((p) =>
          p.pricingMode === "ai"
            ? {
                ...p,
                pricingMode: "manual" as const,
                markupPct: p.myMarkupPct ?? p.markupPct,
              }
            : p,
        ),
      );
      return;
    }
    // Every tier already holds a fresh quote → re-apply without a new
    // AI call; otherwise fetch the full ladder again.
    const allFresh = packages.every(
      (p) => p.aiQuote && p.aiQuote.inputKey === keyFor(p),
    );
    if (allFresh) {
      applyQuotes(
        Object.fromEntries(
          packages.map((p) => [p.id, p.aiQuote as AiPriceQuote]),
        ),
        true,
      );
      return;
    }
    void fetchQuotes(true);
  }

  return {
    mode,
    busy,
    error,
    isStale,
    switchMode,
    refresh: () => void fetchQuotes(false),
  };
}

/**
 * Compact segmented "Your price / AI market price" control — the same
 * proposal-wide switch that lives in the materials builder, surfaced on
 * the summary sidebar and the packages section so the two pricings are
 * one tap apart everywhere the totals show.
 */
export function AiPriceSwitch({
  packages,
  measurements,
  discountPct,
  address,
  onChangePackages,
  className,
}: {
  packages: Package[];
  measurements: Measurements;
  discountPct: number;
  address: string;
  onChangePackages: (next: Package[]) => void;
  className?: string;
}) {
  const ai = useAiPricing({
    packages,
    measurements,
    discountPct,
    address,
    onChangePackages,
  });

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        <button
          type="button"
          onClick={() => ai.mode !== "manual" && ai.switchMode("manual")}
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
          onClick={() => ai.mode !== "ai" && ai.switchMode("ai")}
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
      {ai.mode === "ai" && ai.isStale && !ai.busy && (
        <button
          type="button"
          onClick={ai.refresh}
          className="ring-focus mt-1.5 text-[11px] font-medium text-amber-700 transition-smooth hover:text-amber-800"
        >
          Spec or footage changed — tap to re-price every tier
        </button>
      )}
    </div>
  );
}
