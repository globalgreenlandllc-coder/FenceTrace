"use client";

import { useEffect, useRef } from "react";
import {
  ArrowDownToLine,
  RotateCcw,
  CornerDownRight,
  CornerUpRight,
  Hammer,
  HardHat,
  Layers,
  Pencil,
  Plus,
  Shield,
  Slash,
  Trash2,
  Waves,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { LineItem } from "@/lib/types";
import { DUR, EASE } from "@/lib/motion";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Decorate each line item with a category icon + accent color so the
 * "Pricing" tab reads as a real BOM rather than a sea of numbers.
 * Match by canonical id first (set in lib/pricing.ts) and fall back to
 * a keyword match on the human-readable name for custom line items.
 */
function decorate(item: LineItem): {
  Icon: typeof Layers;
  tone: { ring: string; bg: string; text: string };
} {
  const id = item.id;
  const name = item.name.toLowerCase();
  const t = {
    accent: {
      ring: "ring-accent-200",
      bg: "bg-accent-50",
      text: "text-accent-700",
    },
    sky: { ring: "ring-sky-200", bg: "bg-sky-50", text: "text-sky-700" },
    violet: {
      ring: "ring-violet-200",
      bg: "bg-violet-50",
      text: "text-violet-700",
    },
    amber: {
      ring: "ring-amber-200",
      bg: "bg-amber-50",
      text: "text-amber-700",
    },
    zinc: { ring: "ring-zinc-200", bg: "bg-zinc-100", text: "text-zinc-700" },
    rose: { ring: "ring-rose-200", bg: "bg-rose-50", text: "text-rose-700" },
  };
  if (id === "gutter" || /gutter/.test(name))
    return { Icon: Waves, tone: t.accent };
  if (id === "downspouts" || /downspout/.test(name))
    return { Icon: ArrowDownToLine, tone: t.rose };
  if (id === "outside-corners" || /outside.*corner/.test(name))
    return { Icon: CornerUpRight, tone: t.violet };
  if (id === "inside-corners" || /inside.*corner/.test(name))
    return { Icon: CornerDownRight, tone: t.violet };
  if (id === "end-caps" || /end.?cap/.test(name))
    return { Icon: Slash, tone: t.amber };
  if (id === "hangers" || /hanger/.test(name))
    return { Icon: Layers, tone: t.zinc };
  if (id === "elbows" || /elbow/.test(name))
    return { Icon: Zap, tone: t.sky };
  if (id === "labor" || /labor|install/.test(name))
    return { Icon: HardHat, tone: t.amber };
  if (/guard|leaf|mesh/.test(name)) return { Icon: Shield, tone: t.sky };
  if (/repair|fascia|paint/.test(name))
    return { Icon: Hammer, tone: t.rose };
  return { Icon: Pencil, tone: t.zinc };
}

type ItemOrigin = "ai" | "edited" | "custom";

export function PricingTable({
  items,
  onChange,
  baseline,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  /** The untouched AI scope for the current config — used to badge each
   *  row's origin and power "Reset to AI scope". */
  baseline?: LineItem[];
}) {
  const reduce = useReducedMotion();
  // Stagger row entrances only on first mount (the "AI built your scope"
  // reveal when the Pricing tab opens). Rows added later animate in
  // immediately — no inherited stagger delay.
  const entered = useRef(false);
  useEffect(() => {
    entered.current = true;
  }, []);

  const baseById = new Map((baseline ?? []).map((b) => [b.id, b]));
  function originOf(item: LineItem): ItemOrigin {
    const base = baseById.get(item.id);
    if (!base) return "custom";
    const pristine =
      base.name === item.name &&
      base.quantity === item.quantity &&
      base.unitPrice === item.unitPrice &&
      base.unit === item.unit;
    return pristine ? "ai" : "edited";
  }
  const dirty =
    !!baseline &&
    (items.length !== baseline.length ||
      items.some((i) => originOf(i) !== "ai"));

  function update(id: string, patch: Partial<LineItem>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }
  function addRow() {
    onChange([
      ...items,
      {
        id: `custom-${Date.now()}`,
        name: "Custom line item",
        quantity: 1,
        unit: "ea",
        unitPrice: 0,
        taxable: true,
      },
    ]);
  }

  const subtotal = items.reduce(
    (acc, i) => acc + i.quantity * i.unitPrice,
    0,
  );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/50 px-3 py-2">
        <span className="microlabel flex items-center gap-2">
          {items.length} line {items.length === 1 ? "item" : "items"}
          {dirty && baseline && (
            <button
              onClick={() => onChange(baseline)}
              className="ring-focus inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-medium normal-case tracking-normal text-zinc-500 transition-smooth hover:border-accent-300 hover:text-accent-700 active:scale-[0.98]"
              title="Discard edits and custom rows; restore the AI scope"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset to AI scope
            </button>
          )}
        </span>
        <span className="font-mono text-xs tabular-nums text-zinc-700">
          {formatCurrency(subtotal)}{" "}
          <span className="font-medium text-zinc-400">subtotal</span>
        </span>
      </div>

      <ul>
        <AnimatePresence>
          {items.map((item, idx) => {
            const total = item.quantity * item.unitPrice;
            const { Icon, tone } = decorate(item);
            return (
              <motion.li
                key={item.id}
                layout
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                // Opacity-only exit (GPU-safe); the `layout` prop slides the
                // remaining rows up — never animate height.
                exit={{
                  opacity: 0,
                  transition: { duration: DUR.fast, ease: EASE },
                }}
                transition={{
                  duration: DUR.base,
                  ease: EASE,
                  delay: entered.current ? 0 : Math.min(idx, 8) * 0.04,
                }}
                className="group border-b border-zinc-100 last:border-0 transition-colors hover:bg-zinc-50/40 motion-reduce:transition-none"
              >
                <div className="flex items-start gap-2.5 px-3 py-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                      tone.bg,
                      tone.ring,
                      tone.text,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={item.name}
                        onChange={(e) =>
                          update(item.id, { name: e.target.value })
                        }
                        placeholder="Line item name"
                        className="w-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-zinc-900 outline-none placeholder:text-zinc-400 focus:placeholder:text-zinc-300"
                      />
                      <OriginBadge origin={originOf(item)} />
                    </div>
                    {item.description && (
                      <div className="truncate text-[11px] text-zinc-500">
                        {item.description}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <NumInput
                        value={item.quantity}
                        onChange={(v) => update(item.id, { quantity: v })}
                        align="right"
                        decimals={item.unit === "lot" ? 2 : 0}
                        widthClass="w-16"
                      />
                      <input
                        value={item.unit}
                        onChange={(e) =>
                          update(item.id, { unit: e.target.value })
                        }
                        className="h-7 w-12 rounded-md border border-zinc-200 bg-white px-1.5 text-center text-xs text-zinc-700 outline-none transition-smooth focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                      />
                      <span className="text-xs text-zinc-300">×</span>
                      <NumInput
                        value={item.unitPrice}
                        onChange={(v) => update(item.id, { unitPrice: v })}
                        prefix="$"
                        align="right"
                        decimals={2}
                        widthClass="w-20"
                      />
                      <span className="ml-auto inline-flex items-center gap-1.5">
                        <span className="microlabel">Total</span>
                        <span className="text-sm font-semibold tabular-nums text-zinc-900">
                          {formatCurrency(total)}
                        </span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => remove(item.id)}
                    className="ring-focus mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-300 opacity-0 transition-smooth group-hover:opacity-100 focus-visible:opacity-100 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
                    aria-label="Remove line item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <button
        onClick={addRow}
        className="ring-focus flex w-full items-center justify-center gap-2 border-t border-dashed border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-500 transition-smooth hover:bg-accent-50/50 hover:text-accent-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Add line item
      </button>
    </div>
  );
}

function OriginBadge({ origin }: { origin: ItemOrigin }) {
  if (origin === "ai") {
    return (
      <span
        className="shrink-0 rounded-full bg-accent-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-accent-600"
        title="Priced automatically from the AI takeoff"
      >
        AI
      </span>
    );
  }
  if (origin === "edited") {
    return (
      <span
        className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-amber-600"
        title="AI line item you've overridden"
      >
        Edited
      </span>
    );
  }
  return (
    <span
      className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500"
      title="Added by you"
    >
      Custom
    </span>
  );
}

function NumInput({
  value,
  onChange,
  prefix,
  align = "left",
  decimals = 0,
  widthClass,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  align?: "left" | "right";
  decimals?: number;
  widthClass?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center rounded-md border border-zinc-200 bg-white px-1.5 text-xs text-zinc-900 transition-smooth focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15",
        align === "right" && "justify-end",
        widthClass,
      )}
    >
      {prefix && <span className="mr-0.5 text-zinc-400">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        step={decimals > 0 ? 0.01 : 1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={cn(
          "w-full bg-transparent tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          align === "right" && "text-right",
        )}
      />
    </div>
  );
}
