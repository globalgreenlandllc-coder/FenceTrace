"use client";

import { Check, ChevronDown, Layers, Sparkles, Star } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import { cn, formatCurrency } from "@/lib/utils";
import {
  markupPctForTarget,
  packageClientBreakdown,
  packageTotal,
  type Package,
  type Proposal,
} from "@/lib/proposal-mock";
import type { Measurements } from "@/lib/types";
import { AiPriceSwitch } from "./ai-price-switch";
import { EditablePrice } from "./editable-price";

export function PackagesSection({
  proposal,
  onChange,
  readOnly,
  selectedPackageId,
  onSelectPackage,
  onEditMaterials,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  readOnly?: boolean;
  selectedPackageId?: string | null;
  onSelectPackage?: (id: string) => void;
  /** Opens the full materials builder for a package. Only wired up in
   *  the contractor's editor — omitted on the read-only client portal. */
  onEditMaterials?: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  function update(id: string, patch: Partial<Package>) {
    onChange({
      ...proposal,
      packages: proposal.packages.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  }

  return (
    <section data-section="packages" className="space-y-4">
      <SectionHeader
        title="Choose your package"
        sub="Each tier is sized to your property. The middle option is most popular."
        readOnly={readOnly}
        action={
          // Contractor editor only — the homeowner never sees the switch.
          !readOnly ? (
            <AiPriceSwitch
              packages={proposal.packages}
              measurements={proposal.measurements}
              discountPct={proposal.discountPct ?? 0}
              address={proposal.address}
              onChangePackages={(packages) =>
                onChange({ ...proposal, packages })
              }
              className="w-64 shrink-0 max-sm:hidden"
            />
          ) : undefined
        }
      />

      {/* How pricing presents to the CLIENT — contractor editor only.
          "Totals" protects margin; "split" adds materials/labor
          subtotals; "itemized" prices every line. */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-label text-zinc-500">Client sees</span>
          {(
            [
              { id: "totals", label: "Totals only" },
              { id: "split", label: "Materials + labor" },
              { id: "itemized", label: "Every line priced" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...proposal, priceDisplay: m.id })}
              className={cn(
                "transition-smooth ring-focus rounded-full border px-2.5 py-1 font-medium",
                (proposal.priceDisplay ?? "totals") === m.id
                  ? "border-accent-500 bg-accent-50 text-accent-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {m.label}
            </button>
          ))}
          <span className="text-zinc-400">
            {(proposal.priceDisplay ?? "totals") === "totals"
              ? "Scope listed, one confident price — recommended."
              : (proposal.priceDisplay ?? "totals") === "split"
                ? "Adds Materials & parts vs Labor & installation subtotals."
                : "Full itemization — for commercial / insurance work."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {proposal.packages.map((p) => {
          const totals = packageTotal(
            p,
            proposal.measurements,
            proposal.discountPct ?? 0,
          );
          const selected = selectedPackageId === p.id;
          const interactive = !!onSelectPackage;
          return (
            <motion.div
              key={p.id}
              whileHover={interactive ? { y: -2 } : undefined}
              whileTap={interactive ? { scale: 0.99 } : undefined}
              transition={{ duration: DUR.base, ease: EASE }}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-white p-6 shadow-card transition-smooth",
                selected
                  ? "border-accent-500 ring-2 ring-accent-500/15"
                  : p.recommended
                  ? "border-accent-300"
                  : "border-zinc-200",
                interactive &&
                  !selected &&
                  "cursor-pointer hover:border-accent-300 hover:shadow-elevated",
              )}
              onClick={interactive ? () => onSelectPackage(p.id) : undefined}
            >
              {p.recommended && (
                <div className="font-label absolute right-4 top-4 inline-flex items-center gap-1 rounded-md border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] text-accent-700">
                  <Star className="h-2.5 w-2.5" />
                  Most popular
                </div>
              )}

              {readOnly ? (
                <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
                  {p.name}
                </h3>
              ) : (
                <input
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                  className="w-full bg-transparent text-xl font-semibold tracking-tight text-zinc-900 outline-none"
                />
              )}

              {readOnly ? (
                <p className="mt-1 text-sm text-zinc-600">{p.tagline}</p>
              ) : (
                <input
                  value={p.tagline}
                  onChange={(e) => update(p.id, { tagline: e.target.value })}
                  className="mt-1 w-full bg-transparent text-sm text-zinc-600 outline-none"
                />
              )}

              <div className="mt-5 flex items-baseline gap-2">
                {readOnly ? (
                  <motion.span
                    key={Math.round(totals.total)}
                    initial={reduce ? false : { opacity: 0.5, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DUR.base, ease: EASE }}
                    className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900"
                  >
                    {formatCurrency(totals.total)}
                  </motion.span>
                ) : (
                  <EditablePrice
                    total={totals.total}
                    onCommit={(target) =>
                      update(p.id, {
                        markupPct: markupPctForTarget(
                          target,
                          totals.subtotal,
                          proposal.discountPct ?? 0,
                        ),
                      })
                    }
                    className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900"
                  />
                )}
                <span className="text-xs text-zinc-500">total</span>
                {!readOnly && p.pricingMode === "ai" && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-accent-200 bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">
                    <Sparkles className="h-2.5 w-2.5" />
                    Market price
                  </span>
                )}
              </div>
              {!readOnly && !interactive && (
                <div className="mt-1 text-xs text-zinc-400">
                  Tap the price to set your number
                </div>
              )}

              <ul className="mt-5 space-y-2">
                {p.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {p.addOns.length > 0 && (
                <div className="mt-5 border-t border-zinc-100 pt-4">
                  <div className="font-label text-[10px] text-zinc-500">
                    Add-ons
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {p.addOns.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <label className="flex flex-1 items-center gap-2 text-zinc-700">
                          <input
                            type="checkbox"
                            checked={a.included}
                            disabled={readOnly && !interactive}
                            onChange={(e) =>
                              update(p.id, {
                                addOns: p.addOns.map((x) =>
                                  x.id === a.id
                                    ? { ...x, included: e.target.checked }
                                    : x,
                                ),
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-zinc-300 accent-accent-600"
                          />
                          <span>{a.name}</span>
                        </label>
                        <span
                          className={cn(
                            "tabular-nums",
                            a.included ? "text-accent-700" : "text-zinc-400",
                          )}
                        >
                          {a.price === 0 ? "Included" : formatCurrency(a.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <IncludedBreakdown
                pkg={p}
                measurements={proposal.measurements}
                discountPct={proposal.discountPct ?? 0}
                mode={proposal.priceDisplay ?? "totals"}
              />

              {interactive && (
                <button
                  type="button"
                  className={cn(
                    "ring-focus active:scale-[0.98] mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-smooth",
                    selected
                      ? "bg-accent-600 text-white shadow-card"
                      : "border border-zinc-200 text-zinc-700 hover:border-accent-400 hover:text-accent-700",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPackage(p.id);
                  }}
                >
                  {selected ? (
                    <>
                      <Check className="h-4 w-4" />
                      Selected
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Choose {p.name}
                    </>
                  )}
                </button>
              )}

              {onEditMaterials && !readOnly && (
                <button
                  type="button"
                  onClick={() => onEditMaterials(p.id)}
                  className="ring-focus active:scale-[0.98] mt-5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 transition-smooth hover:border-accent-400 hover:bg-accent-50/40 hover:text-accent-700"
                >
                  <Layers className="h-4 w-4" />
                  Edit materials & spec
                </button>
              )}

              {!readOnly && !interactive && (
                <div className="mt-4 flex items-center justify-end border-t border-zinc-100 pt-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      update(p.id, { recommended: !p.recommended })
                    }
                    className="ring-focus rounded-md px-2 py-1 font-medium text-zinc-500 transition-smooth hover:text-accent-700"
                  >
                    {p.recommended ? "Unmark popular" : "Mark popular"}
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

export function SectionHeader({
  title,
  sub,
  readOnly,
  action,
}: {
  title: string;
  sub?: string;
  readOnly?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
          {title}
        </h2>
        {sub && <p className="mt-1 text-sm text-zinc-600">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** "Everything included" — the client-facing breakdown, presented per
 *  the proposal's priceDisplay mode. Collapsed by default so package
 *  cards stay scannable; the click is the client leaning in. */
function IncludedBreakdown({
  pkg,
  measurements,
  discountPct,
  mode,
}: {
  pkg: Package;
  measurements: Measurements;
  discountPct: number;
  mode: "totals" | "split" | "itemized";
}) {
  const b = packageClientBreakdown(pkg, measurements, discountPct);
  if (b.lines.length === 0) return null;
  const qty = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(1);
  return (
    <details
      className="group mt-5 border-t border-zinc-100 pt-3"
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-zinc-500 transition-smooth hover:text-accent-700 [&::-webkit-details-marker]:hidden">
        Everything included
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2.5 space-y-1.5">
        {b.lines.map((l) => (
          <li
            key={l.id}
            className="flex items-baseline justify-between gap-3 text-xs text-zinc-600"
          >
            <span className="min-w-0">
              {l.name}
              <span className="text-zinc-400">
                {" "}
                · {qty(l.quantity)} {l.unit}
              </span>
            </span>
            {mode === "itemized" && (
              <span className="shrink-0 tabular-nums text-zinc-700">
                {l.clientPrice === 0 ? "Included" : formatCurrency(l.clientPrice)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {mode !== "totals" && (
        <div className="mt-3 space-y-1 border-t border-zinc-100 pt-2.5 text-xs">
          <div className="flex items-center justify-between text-zinc-600">
            <span>Materials &amp; parts</span>
            <span className="tabular-nums">{formatCurrency(b.materials)}</span>
          </div>
          <div className="flex items-center justify-between text-zinc-600">
            <span>Labor &amp; installation</span>
            <span className="tabular-nums">{formatCurrency(b.labor)}</span>
          </div>
          <div className="flex items-center justify-between text-zinc-600">
            <span>Sales tax</span>
            <span className="tabular-nums">{formatCurrency(b.tax)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 font-semibold text-zinc-900">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(b.total)}</span>
          </div>
        </div>
      )}
    </details>
  );
}
