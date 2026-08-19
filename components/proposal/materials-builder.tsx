"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Layers,
  ListChecks,
  Loader2,
  MapPin,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Tag,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { buildLineItems } from "@/lib/pricing";
import {
  markupPctForTarget,
  packageTotal,
  type AddOn,
  type Package,
} from "@/lib/proposal-mock";
import { useAiPricing, AiPriceSwitch } from "./ai-price-switch";
import { fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import type { EstimateConfig, LineItem, Measurements } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

const NUM_INPUT =
  "w-14 shrink-0 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-right text-xs tabular-nums outline-none transition-smooth focus:border-accent-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
import { MaterialSelector } from "@/components/estimate/material-selector";
import { EditablePrice } from "./editable-price";

const STYLE_LABEL: Record<EstimateConfig["style"], string> = {
  "k-style": "K-style",
  "half-round": "half-round",
};
const MATERIAL_LABEL: Record<EstimateConfig["material"], string> = {
  aluminum: "aluminum",
  steel: "steel",
  copper: "copper",
};
const DOWNSPOUT_LABEL: Record<EstimateConfig["downspoutSize"], string> = {
  "2x3": '2"×3"',
  "3x4": '3"×4"',
  "round-3": '3" round',
  "round-4": '4" round',
};

/**
 * Suggested client-facing spec bullets derived from the live material
 * config — surfaced as one-tap chips so the contractor can keep the
 * "what's included" list in sync with what they actually picked without
 * blowing away hand-written lines (warranty, inspections, etc.).
 */
function specChipsFromConfig(config: EstimateConfig): string[] {
  // Fence packages describe themselves from the fence config — gutter
  // bullets would be nonsense on a fence proposal.
  if (config.fence) {
    const f = config.fence;
    const t = fenceType(f.type as FenceTypeId);
    const chips = [
      `${f.heightFt}' ${t.label.toLowerCase()}`,
      `Posts set in concrete, ${t.postSpacingFt}' on center`,
    ];
    if (f.gatesSingle + f.gatesDouble > 0)
      chips.push(
        `${f.gatesSingle + f.gatesDouble} ${f.gatesSingle + f.gatesDouble === 1 ? "gate" : "gates"} — hung & latched`,
      );
    if (f.stain) chips.push("Stain & seal, both faces");
    if (f.removalLf > 0) chips.push(`Old-fence tear-out (${f.removalLf} LF)`);
    return chips;
  }
  const chips = [
    `${config.size}" ${STYLE_LABEL[config.style]} ${MATERIAL_LABEL[config.material]} gutters`,
    `${DOWNSPOUT_LABEL[config.downspoutSize]} downspouts`,
  ];
  const acc = config.accessories;
  if (acc) {
    if (acc.guard !== "none") {
      chips.push(
        acc.guard === "screen"
          ? "Screen leaf guards"
          : acc.guard === "mesh"
            ? "Mesh leaf guards"
            : "Micro-mesh leaf guards",
      );
    }
    if (acc.dripEdge) chips.push("Aluminum drip-edge flashing");
    if (acc.rainChain) chips.push("Decorative copper rain chain");
    if (acc.iceGuard) chips.push("Snow / ice guards");
    if (acc.heatTape) chips.push("Heat-tape ice-dam kit");
  }
  return chips;
}

/**
 * Full "go back to the builder" materials editor for a single proposal
 * package — the same Materials experience as the post-analyze estimate
 * builder ([PricingPanel]) reused here, plus the client-facing spec
 * bullets, add-ons, a live bill of materials, and price. Renders as a
 * right slide-over so it can be launched from either the editor or the
 * preview's edit drawer; the parent owns the package and patches it
 * through `onChange`.
 */
export function MaterialsBuilder({
  pkg,
  allPackages,
  measurements,
  discountPct,
  address,
  onChange,
  onChangeAll,
  priceDisplay,
  onPriceDisplayChange,
  onClose,
}: {
  pkg: Package;
  /** Every package on the proposal — the AI pricing switch works on all
   *  of them at once, since the client sees every tier. */
  allPackages: Package[];
  measurements: Measurements;
  discountPct: number;
  /** Property address — where the AI market price is read from. */
  address: string;
  onChange: (next: Package) => void;
  /** Replace the whole package list (AI pricing applies/restores all tiers). */
  onChangeAll: (next: Package[]) => void;
  /** What the CLIENT sees on the portal: one total, or materials +
   *  labor totals side by side. Proposal-wide (all tiers). */
  priceDisplay: "totals" | "split" | "itemized";
  onPriceDisplayChange: (mode: "totals" | "split" | "itemized") => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const totals = useMemo(
    () => packageTotal(pkg, measurements, discountPct),
    [pkg, measurements, discountPct],
  );
  const autoBase = useMemo(
    () => buildLineItems(measurements, pkg.config),
    [measurements, pkg.config],
  );
  const overrides = pkg.lineItemOverrides ?? {};
  const custom = pkg.customLineItems ?? [];

  // Sell-side multiplier: line totals display at CLIENT price (unit cost
  // × markup), so flipping Your price ⇄ AI market price visibly
  // re-prices every line, not just the package total — the markup the
  // switch back-solves is what moves each line.
  const markupFactor = 1 + pkg.markupPct / 100;

  const set = (patch: Partial<Package>) => onChange({ ...pkg, ...patch });
  const setHighlights = (highlights: string[]) => set({ highlights });
  const setAddOns = (addOns: AddOn[]) => set({ addOns });
  const setCustom = (items: LineItem[]) => set({ customLineItems: items });

  const setOverride = (
    id: string,
    patch: { quantity?: number; unitPrice?: number },
  ) => {
    const next = { ...(pkg.lineItemOverrides ?? {}) };
    next[id] = { ...(next[id] ?? {}), ...patch };
    set({ lineItemOverrides: next });
  };
  const clearOverride = (id: string) => {
    if (!pkg.lineItemOverrides?.[id]) return;
    const next = { ...pkg.lineItemOverrides };
    delete next[id];
    set({
      lineItemOverrides: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  /* ----- AI recommended price (the pricing switch) -----
   * Shared proposal-wide logic (useAiPricing): every tier goes to the
   * client, so one AI call prices ALL packages together and
   * applying/restoring walks the whole list. */
  const ai = useAiPricing({
    packages: allPackages,
    measurements,
    discountPct,
    address,
    onChangePackages: onChangeAll,
  });
  const aiBusy = ai.busy;
  const aiErr = ai.error;
  // The switch reflects the tier being edited (proposal-wide actions
  // still pull the whole ladder onto one mode).
  const pricingMode: "manual" | "ai" =
    pkg.pricingMode === "ai" ? "ai" : "manual";
  const quote = pkg.aiQuote;
  const quoteStale = ai.isStale;

  // PER-ITEM AI PRICING: in AI mode the AI returns a market SELLING price per
  // BOM line (quote.lineItems). Use those as WEIGHTS to re-slice the same
  // marked-up subtotal, so every line shows the AI's own independent price
  // (premium parts richer, commodity leaner) — NOT one flat markup — while
  // the package total stays exactly what markupPct governs (the itemization
  // still reconciles to the quote everywhere else in the app). Lines the AI
  // didn't price (custom adds, or an old quote) keep the uniform markup, and
  // the weighted lines absorb the remainder so the grand total is unchanged.
  const aiLineNorm = useMemo(() => {
    if (pricingMode !== "ai") return null;
    const map = pkg.aiQuote?.lineItems;
    if (!map || Object.keys(map).length === 0) return null;
    const lines = [
      ...autoBase.map((it) => {
        const ov = overrides[it.id];
        return {
          id: it.id,
          qty: ov?.quantity ?? it.quantity,
          unit: ov?.unitPrice ?? it.unitPrice,
        };
      }),
      ...custom.map((it) => ({ id: it.id, qty: it.quantity, unit: it.unitPrice })),
    ];
    let weightSum = 0;
    let unweightedMarked = 0;
    let subtotalMarked = 0;
    for (const l of lines) {
      const marked = l.qty * l.unit * markupFactor;
      subtotalMarked += marked;
      const w = map[l.id];
      if (typeof w === "number" && w > 0) weightSum += w;
      else unweightedMarked += marked;
    }
    if (weightSum <= 0) return null;
    const perWeight = Math.max(0, subtotalMarked - unweightedMarked) / weightSum;
    return { map, perWeight };
  }, [pricingMode, pkg.aiQuote, autoBase, overrides, custom, markupFactor]);

  /** A line's displayed CLIENT price: the AI's per-item price (weight ×
   *  normalizer) in AI mode when the AI priced this line, else the uniform
   *  marked-up cost. */
  const lineSell = (id: string, qty: number, unit: number): number => {
    if (aiLineNorm) {
      const w = aiLineNorm.map[id];
      if (typeof w === "number" && w > 0) return w * aiLineNorm.perWeight;
    }
    return qty * unit * markupFactor;
  };

  /** True when the AI set this line's own price (so the unit cell shows the
   *  AI per-unit SELL price and is read-only — edit in Your price mode). */
  const isAiPricedLine = (id: string): boolean =>
    !!aiLineNorm && typeof aiLineNorm.map[id] === "number" && aiLineNorm.map[id] > 0;

  /** The unit-column value: the AI per-unit SELL price (line total ÷ qty) in
   *  AI mode, else the contractor's unit COST. */
  const lineUnit = (id: string, qty: number, cost: number): number =>
    isAiPricedLine(id) && qty > 0
      ? Math.round((lineSell(id, qty, cost) / qty) * 100) / 100
      : cost;

  function switchPricingMode(next: "manual" | "ai") {
    if (next === pricingMode) return;
    ai.switchMode(next);
  }

  const suggestions = specChipsFromConfig(pkg.config).filter(
    (s) => !pkg.highlights.includes(s),
  );

  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <motion.button
        type="button"
        aria-label="Close materials builder"
        onClick={onClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR.base, ease: EASE }}
        className="absolute inset-0 bg-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40"
      />
      <motion.aside
        initial={reduce ? false : { x: "100%" }}
        animate={{ x: 0 }}
        transition={SPRING}
        className="absolute right-0 top-0 flex h-full w-[600px] max-w-[96vw] flex-col border-l border-zinc-200 bg-zinc-50 shadow-elevated"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-label text-[10px] text-accent-700">
              Materials builder
            </div>
            <input
              value={pkg.name}
              onChange={(e) => set({ name: e.target.value })}
              aria-label="Package name"
              className="w-full bg-transparent text-lg font-semibold tracking-tight text-zinc-900 outline-none"
            />
          </div>
          <div className="text-right">
            <motion.div
              key={Math.round(totals.total)}
              initial={reduce ? false : { opacity: 0.4, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.base, ease: EASE }}
              className="text-xl font-semibold tracking-tight tabular-nums text-zinc-900"
            >
              {formatCurrency(totals.total)}
            </motion.div>
            <div className="text-[11px] text-zinc-500">
              {pricingMode === "ai" ? (
                <span className="inline-flex items-center gap-1 font-medium text-accent-700">
                  <TrendingUp className="h-3 w-3" /> Market price
                </span>
              ) : (
                `${pkg.markupPct.toFixed(1)}% markup`
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ring-focus active:scale-[0.98] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-smooth hover:bg-zinc-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* AI price switch at the TOP too (owner: visible the moment the
            summary/pricing opens, not just at the bottom of the panel). The
            same proposal-wide toggle also lives near the bottom BOM total. */}
        <div className="border-b border-zinc-100 px-5 pb-3 pt-1">
          <AiPriceSwitch
            packages={allPackages}
            measurements={measurements}
            discountPct={discountPct}
            address={address}
            onChangePackages={onChangeAll}
          />
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <Section
            icon={Layers}
            title="Materials & spec"
            sub="Pick the fence system. Price, preview, and bill of materials update live."
          >
            <MaterialSelector
              config={pkg.config}
              onChange={(config) => set({ config })}
              measurements={measurements}
            />
            {pkg.config.fence && (
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-800">
                    Tear out &amp; haul away the existing fence
                  </span>
                  <span className="block text-[11px] leading-snug text-zinc-500">
                    {(pkg.config.fence.removalLf ?? 0) > 0
                      ? `${Math.round(pkg.config.fence.removalLf)} LF of removal is priced on every tier.`
                      : "No tear-out — removal is excluded from every tier's price."}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={(pkg.config.fence.removalLf ?? 0) > 0}
                  onChange={(e) => {
                    // Tear-out is a JOB fact, not a tier upgrade — flip it
                    // on every fence package so no tier quietly keeps the
                    // removal charge.
                    const lf = e.target.checked
                      ? Math.max(1, Math.round(measurements.eaveLF))
                      : 0;
                    onChangeAll(
                      allPackages.map((px) =>
                        px.config.fence
                          ? {
                              ...px,
                              config: {
                                ...px.config,
                                fence: { ...px.config.fence, removalLf: lf },
                              },
                            }
                          : px,
                      ),
                    );
                  }}
                  className="h-4 w-4 shrink-0 rounded border-zinc-300 accent-accent-600"
                />
              </label>
            )}
          </Section>

          <Section
            icon={ListChecks}
            title="What's included"
            sub="The bullet list the client reads under this package."
          >
            <ul className="space-y-1.5">
              {pkg.highlights.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={h}
                    onChange={(e) =>
                      setHighlights(
                        pkg.highlights.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      )
                    }
                    className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none transition-smooth focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                  />
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={() =>
                      setHighlights(pkg.highlights.filter((_, j) => j !== i))
                    }
                    className="ring-focus active:scale-[0.98] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-smooth hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setHighlights([...pkg.highlights, ""])}
              className="ring-focus mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 transition-smooth hover:text-accent-900"
            >
              <Plus className="h-3.5 w-3.5" />
              Add line
            </button>
            {suggestions.length > 0 && (
              <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-white/60 p-3">
                <div className="font-label text-[10px] text-zinc-500">
                  From your materials — tap to add
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setHighlights([...pkg.highlights, s])}
                      className="ring-focus active:scale-[0.98] rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 transition-smooth hover:border-accent-400 hover:text-accent-700"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section icon={Tag} title="Add-ons" sub="Optional upgrades on this tier.">
            <ul className="space-y-1.5">
              {pkg.addOns.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={a.included}
                    onChange={(e) =>
                      setAddOns(
                        pkg.addOns.map((x) =>
                          x.id === a.id
                            ? { ...x, included: e.target.checked }
                            : x,
                        ),
                      )
                    }
                    className="h-4 w-4 rounded border-zinc-300 accent-accent-600"
                  />
                  <input
                    value={a.name}
                    onChange={(e) =>
                      setAddOns(
                        pkg.addOns.map((x) =>
                          x.id === a.id ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none transition-smooth focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                  />
                  <div className="flex items-center gap-1 text-sm text-zinc-600">
                    <span className="text-zinc-400">$</span>
                    <input
                      type="number"
                      step={5}
                      value={a.price}
                      onChange={(e) =>
                        setAddOns(
                          pkg.addOns.map((x) =>
                            x.id === a.id
                              ? { ...x, price: parseFloat(e.target.value) || 0 }
                              : x,
                          ),
                        )
                      }
                      className="w-16 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-right text-sm tabular-nums outline-none transition-smooth focus:border-accent-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Remove add-on"
                    onClick={() =>
                      setAddOns(pkg.addOns.filter((x) => x.id !== a.id))
                    }
                    className="ring-focus active:scale-[0.98] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-smooth hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                setAddOns([
                  ...pkg.addOns,
                  {
                    id: `addon-${pkg.addOns.length + 1}-${pkg.id}`,
                    name: "New add-on",
                    price: 0,
                    included: false,
                  },
                ])
              }
              className="ring-focus mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 transition-smooth hover:text-accent-900"
            >
              <Plus className="h-3.5 w-3.5" />
              Add add-on
            </button>
          </Section>

          <Section
            icon={Receipt}
            title="Bill of materials"
            sub="Auto-generated from the spec — override a quantity or unit cost, or add your own line. The right column is the client price at the current markup."
          >
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                <span className="min-w-0 flex-1">Item</span>
                <span className="w-14 shrink-0 text-right">Qty</span>
                <span className="w-6 shrink-0" />
                <span className="w-[4.5rem] shrink-0 text-right">
                  {pricingMode === "ai" ? "Market unit" : "Unit cost"}
                </span>
                <span className="w-16 shrink-0 text-right">
                  {pricingMode === "ai" ? "Market price" : "Client price"}
                </span>
                <span className="w-6 shrink-0" />
              </div>
              {/* Grouped: MATERIALS then LABOR — each with its own
                  client-price subtotal, so the split the client can see
                  is the split the contractor builds. */}
              {([
                { key: "materials", label: "Materials", items: autoBase.filter((x) => x.taxable !== false) },
                { key: "labor", label: "Labor & services", items: autoBase.filter((x) => x.taxable === false) },
              ] as const).map((grp) => {
                const grpCustom = custom.filter(
                  (c) => (c.taxable !== false) === (grp.key === "materials"),
                );
                if (grp.items.length === 0 && grpCustom.length === 0) return null;
                const grpSell =
                  grp.items.reduce(
                    (a, x) =>
                      a +
                      lineSell(
                        x.id,
                        overrides[x.id]?.quantity ?? x.quantity,
                        overrides[x.id]?.unitPrice ?? x.unitPrice,
                      ),
                    0,
                  ) +
                  grpCustom.reduce(
                    (a, x) => a + lineSell(x.id, x.quantity, x.unitPrice),
                    0,
                  );
                return (
                  <div key={grp.key}>
                    <div className="flex items-center justify-between border-b border-zinc-100 bg-accent-50/50 px-3 py-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-accent-800">
                        {grp.label}
                      </span>
                      <span className="text-[11px] font-semibold tabular-nums text-accent-800">
                        {formatCurrency(grpSell)}
                      </span>
                    </div>
                    {grp.items.map((it) => {
                const ov = overrides[it.id];
                const qty = ov?.quantity ?? it.quantity;
                const price = ov?.unitPrice ?? it.unitPrice;
                const overridden =
                  ov?.quantity !== undefined || ov?.unitPrice !== undefined;
                return (
                  <div
                    key={it.id}
                    className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2 text-xs last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-zinc-800">
                        {it.name}
                        {overridden && (
                          <span className="ml-1 text-[10px] font-normal text-accent-600">
                            edited
                          </span>
                        )}
                      </div>
                      {it.description && (
                        <div className="truncate text-[11px] text-zinc-500">
                          {it.description}
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      aria-label={`${it.name} quantity`}
                      value={qty}
                      onChange={(e) =>
                        setOverride(it.id, {
                          quantity: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className={NUM_INPUT}
                    />
                    <span className="w-6 shrink-0 text-[11px] text-zinc-400">
                      {it.unit}
                    </span>
                    <span className="text-zinc-400">$</span>
                    <input
                      type="number"
                      step={0.25}
                      aria-label={`${it.name} unit price`}
                      value={lineUnit(it.id, qty, price)}
                      readOnly={isAiPricedLine(it.id)}
                      title={
                        isAiPricedLine(it.id)
                          ? "Market unit price — switch to Your price to edit"
                          : undefined
                      }
                      onChange={(e) =>
                        setOverride(it.id, {
                          unitPrice: Math.max(
                            0,
                            parseFloat(e.target.value) || 0,
                          ),
                        })
                      }
                      className={cn(
                        NUM_INPUT,
                        isAiPricedLine(it.id) &&
                          "cursor-default bg-accent-50/60 text-accent-700",
                      )}
                    />
                    <motion.span
                      key={Math.round(lineSell(it.id, qty, price))}
                      initial={reduce ? false : { opacity: 0.4 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: DUR.base, ease: EASE }}
                      className={cn(
                        "w-16 shrink-0 text-right font-semibold tabular-nums",
                        pricingMode === "ai"
                          ? "text-accent-700"
                          : "text-zinc-900",
                      )}
                    >
                      {formatCurrency(lineSell(it.id, qty, price))}
                    </motion.span>
                    <button
                      type="button"
                      aria-label="Reset to auto"
                      title="Reset to auto value"
                      disabled={!overridden}
                      onClick={() => clearOverride(it.id)}
                      className={cn(
                        "ring-focus inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-300 transition-smooth",
                        overridden
                          ? "hover:bg-zinc-100 hover:text-zinc-600"
                          : "opacity-30",
                      )}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </div>
                );
                    })}
                    {grpCustom.map((it) => (
                      <div
                        key={it.id}
                        className="flex items-center gap-1.5 border-b border-zinc-100 bg-amber-50/30 px-3 py-2 text-xs last:border-0"
                      >
                        <button
                          type="button"
                          title={
                            it.taxable !== false
                              ? "Counted as materials — tap to move it to labor"
                              : "Counted as labor — tap to move it to materials"
                          }
                          onClick={() =>
                            setCustom(
                              custom.map((x) =>
                                x.id === it.id
                                  ? { ...x, taxable: x.taxable === false }
                                  : x,
                              ),
                            )
                          }
                          className="ring-focus inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-white text-[10px] font-bold text-amber-700 transition-smooth hover:bg-amber-100"
                        >
                          {it.taxable !== false ? "M" : "L"}
                        </button>
                        <input
                          aria-label="Custom line name"
                          value={it.name}
                          onChange={(e) =>
                            setCustom(
                              custom.map((x) =>
                                x.id === it.id ? { ...x, name: e.target.value } : x,
                              ),
                            )
                          }
                          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none transition-smooth focus:border-accent-500"
                        />
                        <input
                          type="number"
                          aria-label="Custom line quantity"
                          value={it.quantity}
                          onChange={(e) =>
                            setCustom(
                              custom.map((x) =>
                                x.id === it.id
                                  ? { ...x, quantity: Math.max(0, parseFloat(e.target.value) || 0) }
                                  : x,
                              ),
                            )
                          }
                          className={NUM_INPUT}
                        />
                        <input
                          aria-label="Custom line unit"
                          value={it.unit}
                          onChange={(e) =>
                            setCustom(
                              custom.map((x) =>
                                x.id === it.id ? { ...x, unit: e.target.value } : x,
                              ),
                            )
                          }
                          className="w-8 shrink-0 rounded-md border border-zinc-200 bg-white px-1 py-1 text-center text-[11px] outline-none transition-smooth focus:border-accent-500"
                        />
                        <span className="text-zinc-400">$</span>
                        <input
                          type="number"
                          step={0.25}
                          aria-label="Custom line unit price"
                          value={lineUnit(it.id, it.quantity, it.unitPrice)}
                          readOnly={isAiPricedLine(it.id)}
                          title={
                            isAiPricedLine(it.id)
                              ? "Market unit price — switch to Your price to edit"
                              : undefined
                          }
                          onChange={(e) =>
                            setCustom(
                              custom.map((x) =>
                                x.id === it.id
                                  ? { ...x, unitPrice: Math.max(0, parseFloat(e.target.value) || 0) }
                                  : x,
                              ),
                            )
                          }
                          className={cn(
                            NUM_INPUT,
                            isAiPricedLine(it.id) &&
                              "cursor-default bg-accent-50/60 text-accent-700",
                          )}
                        />
                        <motion.span
                          key={Math.round(lineSell(it.id, it.quantity, it.unitPrice))}
                          initial={reduce ? false : { opacity: 0.4 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: DUR.base, ease: EASE }}
                          className={cn(
                            "w-16 shrink-0 text-right font-semibold tabular-nums",
                            pricingMode === "ai" ? "text-accent-700" : "text-zinc-900",
                          )}
                        >
                          {formatCurrency(lineSell(it.id, it.quantity, it.unitPrice))}
                        </motion.span>
                        <button
                          type="button"
                          aria-label="Remove custom line"
                          onClick={() => setCustom(custom.filter((x) => x.id !== it.id))}
                          className="ring-focus inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-smooth hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs">
                <span className="text-zinc-500">
                  Your cost (materials + labor + add-ons)
                </span>
                <span className="tabular-nums text-zinc-700">
                  {formatCurrency(totals.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-zinc-50/60 px-3 py-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5 text-zinc-700">
                  {pricingMode === "ai" && (
                    <TrendingUp className="h-3 w-3 text-accent-600" />
                  )}
                  Client price before discount &amp; tax
                </span>
                <motion.span
                  key={Math.round(totals.subtotal * markupFactor)}
                  initial={reduce ? false : { opacity: 0.4 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: DUR.base, ease: EASE }}
                  className={cn(
                    "tabular-nums",
                    pricingMode === "ai" ? "text-accent-700" : "text-zinc-900",
                  )}
                >
                  {formatCurrency(totals.subtotal * markupFactor)}
                </motion.span>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setCustom([
                  ...custom,
                  {
                    id: `custom-${custom.length + 1}-${pkg.id}`,
                    name: "Custom line",
                    description: "",
                    quantity: 1,
                    unit: "ea",
                    unitPrice: 0,
                    taxable: true,
                  },
                ])
              }
              className="ring-focus mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 transition-smooth hover:text-accent-900"
            >
              <Plus className="h-3.5 w-3.5" />
              Add custom line
            </button>

            {/* What the CLIENT sees on the portal — proposal-wide. The
                internal boxes above always show the split; this decides
                how much of it the client gets. */}
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-800">
                    What the client sees
                  </div>
                  <div className="text-[11px] leading-snug text-zinc-500">
                    {priceDisplay === "totals"
                      ? "One package price — your materials/labor split stays internal."
                      : priceDisplay === "split"
                        ? "Materials total and labor total, shown side by side."
                        : "The full line-by-line breakdown."}{" "}
                    Applies to every tier.
                  </div>
                </div>
                <div className="inline-flex shrink-0 rounded-full border border-zinc-200 bg-zinc-50 p-0.5 text-[11px] font-semibold">
                  {(
                    [
                      { id: "totals", label: "One total" },
                      { id: "split", label: "Materials + labor" },
                      { id: "itemized", label: "Every line" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onPriceDisplayChange(m.id)}
                      className={cn(
                        "ring-focus rounded-full px-2.5 py-1 transition-colors",
                        priceDisplay === m.id
                          ? "bg-accent-600 text-white shadow-sm"
                          : "text-zinc-500 hover:text-zinc-800",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Price"
            sub="Price it yourself, or apply the going market rate for your area to every package — the client sees all tiers, so the switch re-prices all of them together."
          >
            <div className="space-y-3">
              {/* The pricing switch — the quote engine speaks fence and
                  gutter; one call prices the whole ladder. */}
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => switchPricingMode("manual")}
                  className={cn(
                    "ring-focus rounded-lg px-3 py-1.5 text-xs font-semibold transition-smooth",
                    pricingMode === "manual"
                      ? "bg-accent-600 text-white shadow-sm"
                      : "text-zinc-600 hover:bg-zinc-50",
                  )}
                >
                  Your price
                </button>
                <button
                  type="button"
                  onClick={() => switchPricingMode("ai")}
                  disabled={aiBusy}
                  className={cn(
                    "ring-focus inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-smooth",
                    pricingMode === "ai"
                      ? "bg-accent-600 text-white shadow-sm"
                      : "text-zinc-600 hover:bg-zinc-50",
                  )}
                >
                  {aiBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5" />
                  )}
                  Market price
                </button>
              </div>
              {aiErr && <p className="text-xs text-rose-600">{aiErr}</p>}

              {/* AI panel — the quote that's applied right now */}
              {pricingMode === "ai" && quote && (
                <div className="space-y-2 rounded-xl border border-accent-200 bg-accent-50/50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-800">
                      <MapPin className="h-3.5 w-3.5" />
                      {quote.location}
                    </span>
                    <span className="text-xs text-zinc-500">
                      Local range{" "}
                      <span className="font-medium tabular-nums text-zinc-800">
                        {formatCurrency(quote.lowTotal)}–
                        {formatCurrency(quote.highTotal)}
                      </span>
                      {quote.perLfInstalled != null && (
                        <>
                          {" "}
                          · ~{formatCurrency(quote.perLfInstalled)}/LF installed
                        </>
                      )}
                    </span>
                  </div>
                  {/* The whole ladder — every tier got its own market price */}
                  <div className="overflow-hidden rounded-lg border border-accent-200/70 bg-white">
                    {allPackages.map(
                      (p) =>
                        p.aiQuote && (
                          <div
                            key={p.id}
                            className={cn(
                              "flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5 text-xs last:border-0",
                              p.id === pkg.id && "bg-accent-50/60",
                            )}
                          >
                            <span
                              className={cn(
                                "text-zinc-600",
                                p.id === pkg.id && "font-medium text-zinc-900",
                              )}
                            >
                              {p.name}
                              {p.id === pkg.id && (
                                <span className="ml-1 text-[10px] text-accent-600">
                                  editing
                                </span>
                              )}
                            </span>
                            <span className="font-semibold tabular-nums text-zinc-900">
                              {formatCurrency(p.aiQuote.recommendedTotal)}
                            </span>
                          </div>
                        ),
                    )}
                  </div>
                  {quote.reasoning.length > 0 && (
                    <ul className="space-y-0.5 text-[11px] text-zinc-600">
                      {quote.reasoning.map((r, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-accent-500">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                  {quoteStale && (
                    <p className="text-[11px] font-medium text-amber-700">
                      Materials or footage changed since this quote — refresh
                      to re-price every tier.
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">
                      Suggested {new Date(quote.fetchedAt).toLocaleDateString()}
                      {" "}· all tiers · never shown to the client
                    </span>
                    <button
                      type="button"
                      onClick={ai.refresh}
                      disabled={aiBusy}
                      className="ring-focus inline-flex items-center gap-1 rounded-md text-[11px] font-medium text-accent-700 transition-smooth hover:text-accent-900"
                    >
                      {aiBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Refresh
                    </button>
                  </div>
                </div>
              )}

              {/* Comparison nudge while on your own price */}
              {pricingMode === "manual" && quote && !quoteStale && (
                <button
                  type="button"
                  onClick={() => switchPricingMode("ai")}
                  className="ring-focus flex w-full items-center justify-between rounded-xl border border-dashed border-accent-300 bg-accent-50/40 px-3 py-2 text-left text-xs transition-smooth hover:border-accent-400"
                >
                  <span className="inline-flex items-center gap-1.5 text-zinc-600">
                    <TrendingUp className="h-3.5 w-3.5 text-accent-600" />
                    Market price for {quote.location}
                  </span>
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(quote.recommendedTotal)}
                    {totals.total > 0 && (
                      <span
                        className={cn(
                          "ml-1.5 text-[11px] font-medium",
                          quote.recommendedTotal >= totals.total
                            ? "text-emerald-700"
                            : "text-amber-700",
                        )}
                      >
                        {quote.recommendedTotal >= totals.total ? "+" : ""}
                        {Math.round(
                          ((quote.recommendedTotal - totals.total) /
                            totals.total) *
                            100,
                        )}
                        % vs yours
                      </span>
                    )}
                  </span>
                </button>
              )}

              {/* Markup + typed total — editing either takes back control */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                <label className="flex items-center gap-1.5 text-zinc-600">
                  Markup
                  <input
                    type="number"
                    step={0.5}
                    value={Math.round(pkg.markupPct * 10) / 10}
                    onChange={(e) =>
                      set({
                        markupPct: parseFloat(e.target.value) || 0,
                        ...(pricingMode === "ai"
                          ? { pricingMode: "manual" as const }
                          : {}),
                      })
                    }
                    className="w-16 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-right text-sm tabular-nums outline-none transition-smooth focus:border-accent-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  %
                </label>
                <div className="ml-auto flex items-baseline gap-1.5 text-zinc-600">
                  <span>Total</span>
                  <EditablePrice
                    total={totals.total}
                    onCommit={(target) =>
                      set({
                        markupPct: markupPctForTarget(
                          target,
                          totals.subtotal,
                          discountPct,
                        ),
                        ...(pricingMode === "ai"
                          ? { pricingMode: "manual" as const }
                          : {}),
                      })
                    }
                    className="text-lg font-semibold tracking-tight tabular-nums text-zinc-900"
                  />
                </div>
              </div>
            </div>
          </Section>
        </div>

        <div className="border-t border-zinc-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="ring-focus active:scale-[0.98] w-full rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-smooth hover:bg-accent-500"
          >
            Done
          </button>
        </div>
      </motion.aside>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon?: typeof Layers;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
        {Icon && <Icon className="h-4 w-4 text-accent-600" />}
        {title}
      </div>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
