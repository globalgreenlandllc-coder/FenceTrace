"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Layers, Send, SlidersHorizontal, Tag } from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import {
  markupPctForTarget,
  packageTotal,
  type Proposal,
} from "@/lib/proposal-mock";
import { AiPriceSwitch } from "./ai-price-switch";
import { EditablePrice } from "./editable-price";
import { ProfitPanel } from "./profit-panel";

export function BuilderSidebar({
  proposal,
  onChange,
  onSend,
  onEditMaterials,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  onSend: () => void;
  /** Opens the materials builder for a tier. Present in both the editor
   *  sidebar and the preview "Edit price & details" drawer, so the
   *  contractor can rebuild materials without leaving preview. */
  onEditMaterials?: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const discountPct = Math.max(0, Math.min(50, proposal.discountPct ?? 0));
  const totals = proposal.packages.map((p) => {
    const noDiscount = packageTotal(p, proposal.measurements, 0);
    const withDiscount = packageTotal(p, proposal.measurements, discountPct);
    return {
      pkg: p,
      subtotal: withDiscount.subtotal,
      undiscountedTotal: noDiscount.total,
      total: withDiscount.total,
      discount: withDiscount.discount,
    };
  });
  const recommended =
    totals.find((t) => t.pkg.recommended) ?? totals[1] ?? totals[0];

  return (
    <aside className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-card">
        <div className="font-label text-[11px] text-zinc-500">
          Most popular
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          {recommended ? (
            <EditablePrice
              total={recommended.total}
              onCommit={(target) =>
                onChange({
                  ...proposal,
                  packages: proposal.packages.map((p) =>
                    p.id === recommended.pkg.id
                      ? {
                          ...p,
                          markupPct: markupPctForTarget(
                            target,
                            recommended.subtotal,
                            discountPct,
                          ),
                        }
                      : p,
                  ),
                })
              }
              className="text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums"
            />
          ) : (
            <span className="text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              —
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {recommended?.pkg.name} · tap price to edit
        </div>

        <div className="mt-5 space-y-2">
          {totals.map(({ pkg, total, undiscountedTotal }) => (
            <div
              key={pkg.id}
              className="flex items-center justify-between text-sm"
            >
              {onEditMaterials ? (
                <button
                  type="button"
                  onClick={() => onEditMaterials(pkg.id)}
                  title="Edit this tier's materials & spec"
                  className="ring-focus group inline-flex items-center gap-1.5 rounded-md text-zinc-700 transition-smooth hover:text-accent-700"
                >
                  <SlidersHorizontal className="h-3 w-3 text-zinc-400 transition-smooth group-hover:text-accent-600" />
                  <span className="border-b border-dashed border-transparent transition-smooth group-hover:border-accent-300">
                    {pkg.name}
                  </span>
                </button>
              ) : (
                <span className="text-zinc-700">{pkg.name}</span>
              )}
              <span className="inline-flex items-baseline gap-1.5">
                {discountPct > 0 && (
                  <span className="text-xs tabular-nums text-zinc-400 line-through">
                    {formatCurrency(undiscountedTotal)}
                  </span>
                )}
                <motion.span
                  key={Math.round(total)}
                  initial={reduce ? false : { opacity: 0.4, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: DUR.base, ease: EASE }}
                  className={
                    discountPct > 0
                      ? "tabular-nums font-medium text-emerald-700"
                      : "tabular-nums text-zinc-900"
                  }
                >
                  {formatCurrency(total)}
                </motion.span>
              </span>
            </div>
          ))}
        </div>

        {/* The pricing switch — same proposal-wide toggle as the
            materials builder, surfaced here so comparing AI pricing
            against your own is one tap from the summary. */}
        <AiPriceSwitch
          packages={proposal.packages}
          measurements={proposal.measurements}
          discountPct={discountPct}
          address={proposal.address}
          onChangePackages={(packages) => onChange({ ...proposal, packages })}
          className="mt-3"
        />

        {onEditMaterials && recommended && (
          <button
            type="button"
            onClick={() => onEditMaterials(recommended.pkg.id)}
            className="ring-focus active:scale-[0.98] mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 transition-smooth hover:border-accent-400 hover:bg-accent-50/40 hover:text-accent-700"
          >
            <Layers className="h-4 w-4" />
            Edit materials & spec
          </button>
        )}

        <div className="my-4 h-px w-full bg-zinc-100" />

        <DiscountSlider
          pct={discountPct}
          label={proposal.discountLabel ?? ""}
          recommendedTotal={recommended?.total ?? 0}
          recommendedUndiscounted={recommended?.undiscountedTotal ?? 0}
          onChangePct={(v) =>
            onChange({ ...proposal, discountPct: Math.round(v) })
          }
          onChangeLabel={(v) => onChange({ ...proposal, discountLabel: v })}
        />

        <div className="mt-4 space-y-2 text-xs text-zinc-600">
          <Field
            label="Deposit %"
            value={proposal.depositPct}
            suffix="%"
            onChange={(v) => onChange({ ...proposal, depositPct: v })}
          />
          <Field
            label="Valid days"
            value={proposal.validDays}
            onChange={(v) => onChange({ ...proposal, validDays: v })}
          />
        </div>

        <Button onClick={onSend} className="mt-5 w-full">
          <Send className="h-4 w-4" />
          Send to client
        </Button>
        <div className="mt-3 flex justify-center">
          <Badge tone="neutral">Auto-saved</Badge>
        </div>
      </div>

      <ProfitPanel proposal={proposal} onChange={onChange} />

      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-card">
        <div className="font-label text-[11px] text-zinc-500">
          Recipient
        </div>
        <input
          value={proposal.client.name}
          onChange={(e) =>
            onChange({
              ...proposal,
              client: { ...proposal.client, name: e.target.value },
            })
          }
          className="mt-2 w-full bg-transparent text-base font-medium text-zinc-900 outline-none"
        />
        <input
          value={proposal.client.email}
          onChange={(e) =>
            onChange({
              ...proposal,
              client: { ...proposal.client, email: e.target.value },
            })
          }
          placeholder="client@email.com"
          className="mt-1 w-full bg-transparent text-sm text-zinc-600 outline-none placeholder:text-zinc-400"
        />
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2">
      <span>{label}</span>
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-900">
        <input
          type="number"
          step={1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-12 bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span className="text-zinc-500">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * Drag-style discount control. The contractor scrubs the slider 0-50%
 * and watches the recommended-package total drop in real time. Active
 * when pct > 0: pill goes green, label input opens for the "why"
 * (Spring promo, Repeat client, etc.). Quick presets at 5/10/15% for
 * the common cases.
 */
function DiscountSlider({
  pct,
  label,
  recommendedTotal,
  recommendedUndiscounted,
  onChangePct,
  onChangeLabel,
}: {
  pct: number;
  label: string;
  recommendedTotal: number;
  recommendedUndiscounted: number;
  onChangePct: (v: number) => void;
  onChangeLabel: (v: string) => void;
}) {
  const active = pct > 0;
  const savings = recommendedUndiscounted - recommendedTotal;
  return (
    <div
      className={
        active
          ? "rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 transition-smooth"
          : "rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 transition-smooth"
      }
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={
            "inline-flex items-center gap-1.5 font-medium uppercase tracking-wider " +
            (active ? "text-emerald-800" : "text-zinc-500")
          }
        >
          <Tag className="h-3 w-3" />
          Discount
        </span>
        <span
          className={
            "inline-flex items-center gap-1 tabular-nums " +
            (active ? "text-emerald-900" : "text-zinc-700")
          }
        >
          <input
            type="number"
            min={0}
            max={50}
            value={pct}
            onChange={(e) =>
              onChangePct(
                Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)),
              )
            }
            className="w-10 bg-transparent text-right text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-sm font-semibold">%</span>
        </span>
      </div>

      {/* Slider — native input. Tailwind webkit thumb styling pulled
          out so it looks like a real handle, not a tiny blue circle. */}
      <input
        type="range"
        min={0}
        max={50}
        step={1}
        value={pct}
        onChange={(e) => onChangePct(parseFloat(e.target.value))}
        className={
          "ring-focus mt-2.5 h-2 w-full appearance-none rounded-full outline-none " +
          (active
            ? "bg-emerald-200 [&::-webkit-slider-thumb]:bg-emerald-600 [&::-moz-range-thumb]:bg-emerald-600"
            : "bg-zinc-200 [&::-webkit-slider-thumb]:bg-zinc-600 [&::-moz-range-thumb]:bg-zinc-600") +
          " [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-white [&::-webkit-slider-thumb]:shadow-md" +
          " [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:ring-2 [&::-moz-range-thumb]:ring-white [&::-moz-range-thumb]:shadow-md"
        }
      />

      {/* Quick presets — 80% of contractors only ever use these few values. */}
      <div className="mt-2 flex gap-1.5">
        {[0, 5, 10, 15, 20].map((preset) => {
          const isActive = pct === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChangePct(preset)}
              className={
                "ring-focus active:scale-[0.98] rounded-full px-2 py-0.5 text-[10px] font-medium transition-smooth " +
                (isActive
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50")
              }
            >
              {preset === 0 ? "None" : `${preset}%`}
            </button>
          );
        })}
      </div>

      {/* Why / label — shows up next to the discount line on the
          client portal. Only visible when a discount is active. */}
      {active && (
        <>
          <input
            type="text"
            value={label}
            onChange={(e) => onChangeLabel(e.target.value)}
            placeholder="e.g. Spring promo, Repeat client, Cash discount"
            className="anim-enter-fade mt-2.5 w-full rounded-lg border border-emerald-300 bg-white/80 px-2.5 py-1.5 text-xs text-zinc-900 outline-none transition-smooth placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
          />
          <div className="anim-enter-fade mt-2 flex items-baseline justify-between text-[11px]">
            <span className="text-emerald-800">
              Saves{" "}
              <span className="font-semibold tabular-nums">
                {formatCurrency(savings)}
              </span>{" "}
              on{" "}
              <span className="font-medium">Pro Shield</span>
            </span>
            <span className="text-emerald-700/70">applied to all tiers</span>
          </div>
        </>
      )}
    </div>
  );
}
