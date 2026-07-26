"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  resetPlanPricing,
  savePlanPricing,
  type PlanPricingAdmin,
} from "@/app/actions/plan-pricing";
import type { PlanPricing } from "@/lib/plan-pricing";

// Everything the contractor-facing surfaces show is driven by this
// config: the landing #pricing card, the Settings billing section, AND
// the actual Stripe charge (checkout uses inline price_data — there is
// no separate Stripe price to keep in sync).

export function PlanPricingEditor({ initial }: { initial: PlanPricingAdmin }) {
  const [draft, setDraft] = useState<PlanPricing>(initial.current);
  const [overridden, setOverridden] = useState(initial.overridden);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initial.current) || savedAt !== null,
    [draft, initial.current, savedAt],
  );

  function patchPro(patch: Partial<PlanPricing["pro"]>) {
    setSavedAt(null);
    setDraft((d) => ({ ...d, pro: { ...d.pro, ...patch } }));
  }

  function patchFree(patch: Partial<PlanPricing["free"]>) {
    setSavedAt(null);
    setDraft((d) => ({ ...d, free: { ...d.free, ...patch } }));
  }

  function save() {
    setErrors([]);
    startTransition(async () => {
      const result = await savePlanPricing(draft);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setDraft(result.saved);
      setOverridden(true);
      setSavedAt(new Date());
    });
  }

  function reset() {
    if (
      !window.confirm(
        "Reset pricing to the code defaults? The landing page, settings page, and new checkouts all revert immediately.",
      )
    )
      return;
    setErrors([]);
    startTransition(async () => {
      const result = await resetPlanPricing();
      setDraft(result.defaults);
      setOverridden(false);
      setSavedAt(new Date());
    });
  }

  return (
    <div className="space-y-6">
      {/* Header / actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {overridden ? (
            <Badge tone="accent">Custom pricing active</Badge>
          ) : (
            <Badge tone="emerald">
              <CheckCircle2 className="h-3 w-3" /> Code defaults
            </Badge>
          )}
          {savedAt && (
            <span className="anim-enter-fade inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <Button size="sm" disabled={pending || !dirty} onClick={save}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save & publish
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p className="font-semibold">Fix before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Plan */}
          <section className="surface p-6 shadow-card">
            <div className="microlabel">Subscription plan</div>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
              Pro plan
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              New subscribers are charged exactly this at checkout. Existing
              subscribers keep the price they signed up at (Stripe bills their
              original amount) — but the included takeoffs below apply to{" "}
              <em>everyone</em> at their next renewal.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Plan name">
                <input
                  className={inputCls}
                  value={draft.pro.name}
                  onChange={(e) => patchPro({ name: e.target.value })}
                />
              </Field>
              <Field label="Badge on landing card (empty = hidden)">
                <input
                  className={inputCls}
                  value={draft.pro.badge}
                  onChange={(e) => patchPro({ badge: e.target.value })}
                  placeholder="Free to start"
                />
              </Field>
              <Field label="Monthly price (USD)">
                <DollarInput
                  cents={draft.pro.priceCents}
                  onCents={(priceCents) => patchPro({ priceCents })}
                />
              </Field>
              <Field label="Included blueprint takeoffs / month">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  className={inputCls}
                  value={draft.pro.includedCredits}
                  onChange={(e) =>
                    patchPro({ includedCredits: Math.round(Number(e.target.value) || 0) })
                  }
                />
              </Field>
            </div>
          </section>

          {/* Free plan */}
          <section className="surface p-6 shadow-card">
            <div className="microlabel">Free plan</div>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
              Free allowance
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Satellite address estimates are always free (bounded by the abuse
              rate limits, not credits). This sets the <em>one-time</em>{" "}
              blueprint-takeoff allowance new accounts get to try the feature —
              it does not renew monthly. Existing free accounts pick up an edit
              on their next visit.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Free blueprint takeoffs (one-time, 0–100)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  value={draft.free.blueprintCredits}
                  onChange={(e) =>
                    patchFree({
                      blueprintCredits: Math.round(Number(e.target.value) || 0),
                    })
                  }
                />
              </Field>
            </div>
          </section>

          {/* Features */}
          <section className="surface p-6 shadow-card">
            <div className="microlabel">Marketing bullets</div>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
              Plan features
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Shown on the landing pricing card and the in-app billing page.
              The first bullet — &ldquo;{draft.pro.includedCredits} blueprint
              takeoffs every month&rdquo; — is generated from the takeoff
              count and can&rsquo;t drift.
            </p>
            <ul className="mt-4 space-y-2">
              {draft.pro.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    className={inputCls}
                    value={f}
                    onChange={(e) => {
                      const features = [...draft.pro.features];
                      features[i] = e.target.value;
                      patchPro({ features });
                    }}
                  />
                  <IconBtn
                    label="Move up"
                    disabled={i === 0}
                    onClick={() => {
                      const features = [...draft.pro.features];
                      [features[i - 1], features[i]] = [features[i]!, features[i - 1]!];
                      patchPro({ features });
                    }}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    disabled={i === draft.pro.features.length - 1}
                    onClick={() => {
                      const features = [...draft.pro.features];
                      [features[i], features[i + 1]] = [features[i + 1]!, features[i]!];
                      patchPro({ features });
                    }}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Remove"
                    onClick={() =>
                      patchPro({ features: draft.pro.features.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </IconBtn>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={draft.pro.features.length >= 12}
              onClick={() => patchPro({ features: [...draft.pro.features, ""] })}
            >
              <Plus className="h-3.5 w-3.5" /> Add feature
            </Button>
          </section>

          {/* Credit packs */}
          <section className="surface p-6 shadow-card">
            <div className="microlabel">Top-ups</div>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
              Credit packs
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              One-time purchases; credits never expire. The per-takeoff rate is
              computed automatically everywhere it&rsquo;s shown.
            </p>
            <ul className="mt-4 space-y-2">
              {draft.packs.map((p, i) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50/40 p-3"
                >
                  <Field label="Takeoffs" className="w-28">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className={inputCls}
                      value={p.credits}
                      onChange={(e) => {
                        const packs = [...draft.packs];
                        packs[i] = { ...p, credits: Math.round(Number(e.target.value) || 0) };
                        setSavedAt(null);
                        setDraft((d) => ({ ...d, packs }));
                      }}
                    />
                  </Field>
                  <Field label="Price (USD)" className="w-32">
                    <DollarInput
                      cents={p.amountCents}
                      onCents={(amountCents) => {
                        const packs = [...draft.packs];
                        packs[i] = { ...p, amountCents };
                        setSavedAt(null);
                        setDraft((d) => ({ ...d, packs }));
                      }}
                    />
                  </Field>
                  <span className="pb-2 text-xs text-zinc-500">
                    {p.credits > 0
                      ? `$${(p.amountCents / p.credits / 100).toFixed(2)} / takeoff`
                      : "—"}
                  </span>
                  <IconBtn
                    label="Remove pack"
                    onClick={() => {
                      setSavedAt(null);
                      setDraft((d) => ({ ...d, packs: d.packs.filter((_, j) => j !== i) }));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </IconBtn>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={draft.packs.length >= 6}
              onClick={() => {
                setSavedAt(null);
                setDraft((d) => ({
                  ...d,
                  packs: [
                    ...d.packs,
                    {
                      id: `pack-${Date.now().toString(36)}`,
                      credits: 10,
                      amountCents: 4500,
                    },
                  ],
                }));
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add pack
            </Button>
          </section>
        </div>

        {/* Live preview */}
        <div className="space-y-4">
          <div className="sticky top-6">
            <div className="microlabel mb-2">Landing-card preview</div>
            <div className="rounded-3xl border border-zinc-200/70 bg-white p-6 shadow-card">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-600">
                {draft.pro.name || "Plan name"}
              </p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-2">
                <span className="text-[34px] font-semibold leading-none tracking-tight text-zinc-900">
                  ${Math.round(draft.pro.priceCents / 100)}
                </span>
                <span className="text-[13px] text-zinc-500">/ month</span>
                {draft.pro.badge.trim() && (
                  <span className="ml-1 self-center rounded-full bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-accent-700">
                    {draft.pro.badge}
                  </span>
                )}
              </div>
              <ul className="mt-4 space-y-1.5">
                {[
                  `${draft.pro.includedCredits} blueprint takeoffs every month`,
                  ...draft.pro.features.filter((f) => f.trim()),
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-zinc-700">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {draft.packs.length > 0 && (
                <div className="mt-4 border-t border-zinc-200/70 pt-3">
                  <p className="microlabel">Top-ups</p>
                  <ul className="mt-1.5 space-y-1">
                    {draft.packs.map((p) => (
                      <li
                        key={p.id}
                        className="flex justify-between text-[12.5px] text-zinc-600"
                      >
                        <span>{p.credits} takeoffs</span>
                        <span className="tabular-nums">
                          ${(p.amountCents / 100).toLocaleString("en-US")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-3 border-t border-zinc-200/70 pt-3 text-[11px] text-zinc-500">
                Free plan: unlimited address estimates
                {draft.free.blueprintCredits > 0
                  ? ` + ${draft.free.blueprintCredits} blueprint takeoff${draft.free.blueprintCredits === 1 ? "" : "s"} to try`
                  : ""}
                .
              </p>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
              Publishing updates the landing page, the in-app billing page, and
              what new checkouts charge — all at once. Active subscribers keep
              their original monthly amount.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "transition-smooth w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="microlabel">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="transition-smooth ring-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Dollar text input backed by integer cents. Local text while typing;
 *  re-syncs from the cents prop on blur and on external replacement
 *  (save/reset) via the focus flag. */
function DollarInput({
  cents,
  onCents,
}: {
  cents: number;
  onCents: (cents: number) => void;
}) {
  const [text, setText] = useState((cents / 100).toString());
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText((cents / 100).toString());
  }, [cents, focused]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
        $
      </span>
      <input
        inputMode="decimal"
        className={`${inputCls} pl-7`}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Math.round(Number.parseFloat(e.target.value) * 100);
          if (Number.isFinite(v) && v >= 0) onCents(v);
        }}
        onBlur={() => {
          setFocused(false);
          setText((cents / 100).toString());
        }}
      />
    </div>
  );
}
