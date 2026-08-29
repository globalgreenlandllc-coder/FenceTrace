"use client";

/**
 * Proposal boilerplate, in Settings — written once, sent always.
 *
 * Scope of work, warranty, payment terms, scheduling, exclusions: the
 * blocks every proposal carries. A new account starts on the platform's
 * sample language and can quote immediately; anything edited here goes
 * out on EVERY new estimate automatically (and stays editable per
 * proposal in the builder). Also holds the default for how pricing
 * presents to the client — totals only, materials + labor, or every
 * line priced.
 */

import { useEffect, useState } from "react";
import { Check, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMyProposalDefaults,
  resetMyProposalDefaults,
  saveMyProposalDefaults,
} from "@/app/actions/proposal-defaults";
import type { PriceDisplay, TermBlock } from "@/lib/proposal-defaults";
import { cn } from "@/lib/utils";

const PRICE_MODES: { id: PriceDisplay; label: string; hint: string }[] = [
  {
    id: "totals",
    label: "Totals only",
    hint: "Scope listed, one confident price — protects margin.",
  },
  {
    id: "split",
    label: "Materials + labor",
    hint: "Adds materials & parts vs labor & installation subtotals.",
  },
  {
    id: "itemized",
    label: "Every line priced",
    hint: "Full itemization — commercial / insurance work.",
  },
];

export function ProposalDefaultsSection() {
  const [terms, setTerms] = useState<TermBlock[] | null>(null);
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplay>("totals");
  const [customized, setCustomized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyProposalDefaults().then((d) => {
      if (cancelled) return;
      setTerms(d.terms);
      setPriceDisplay(d.priceDisplay);
      setCustomized(d.customized);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const edit = (i: number, patch: Partial<TermBlock>) => {
    setTerms((t) =>
      t ? t.map((b, j) => (j === i ? { ...b, ...patch } : b)) : t,
    );
    setDirty(true);
  };

  async function save() {
    if (!terms || saving) return;
    setSaving(true);
    setError(null);
    const res = await saveMyProposalDefaults({ terms, priceDisplay });
    setSaving(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setDirty(false);
    setCustomized(true);
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 2500);
  }

  async function reset() {
    setSaving(true);
    await resetMyProposalDefaults();
    const d = await getMyProposalDefaults();
    setTerms(d.terms);
    setPriceDisplay(d.priceDisplay);
    setCustomized(d.customized);
    setDirty(false);
    setSaving(false);
  }

  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <FileText className="h-4 w-4 text-accent-600" />
            Proposal terms & policies
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Scope of work, warranty, payment and exclusions — write them
            once here and every new estimate carries them automatically.
            You can still tweak any single proposal in the builder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {customized && (
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              disabled={saving}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Use platform samples
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5">
            {savedTick ? <Check className="h-3.5 w-3.5" /> : null}
            {savedTick ? "Saved" : saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {/* Client price display default */}
      <div className="mt-4">
        <span className="font-label text-zinc-500">
          Clients see pricing as
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PRICE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setPriceDisplay(m.id);
                setDirty(true);
              }}
              className={cn(
                "transition-smooth ring-focus rounded-full border px-2.5 py-1.5 text-xs font-medium",
                priceDisplay === m.id
                  ? "border-accent-500 bg-accent-50 text-accent-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          {PRICE_MODES.find((m) => m.id === priceDisplay)?.hint} You can
          switch it per estimate before sending.
        </p>
      </div>

      {/* Term blocks */}
      {terms === null ? (
        <p className="mt-4 text-sm text-zinc-400">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {terms.map((t, i) => (
            <div
              key={t.id}
              className={cn(
                "rounded-xl border p-3",
                t.enabled ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-70",
              )}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => edit(i, { enabled: e.target.checked })}
                  className="h-4 w-4 shrink-0 accent-[#1E7340]"
                  aria-label={`Include "${t.title}" on proposals`}
                />
                <input
                  value={t.title}
                  onChange={(e) => edit(i, { title: e.target.value })}
                  className="input w-full py-1 text-sm font-semibold"
                  placeholder="Section title"
                  maxLength={120}
                />
                <button
                  type="button"
                  onClick={() => {
                    setTerms((cur) => (cur ? cur.filter((_, j) => j !== i) : cur));
                    setDirty(true);
                  }}
                  className="transition-smooth ring-focus shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Remove "${t.title}"`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <textarea
                value={t.body}
                onChange={(e) => edit(i, { body: e.target.value })}
                rows={3}
                maxLength={4000}
                className="input mt-2 w-full resize-y py-1.5 text-[13px] leading-relaxed"
                placeholder="The language your clients will read…"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setTerms((cur) => [
                ...(cur ?? []),
                {
                  id: `term-${Date.now().toString(36)}`,
                  title: "",
                  body: "",
                  enabled: true,
                },
              ]);
              setDirty(true);
            }}
            className="transition-smooth ring-focus flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 py-2.5 text-sm font-medium text-zinc-500 hover:border-accent-400 hover:text-accent-700"
          >
            <Plus className="h-4 w-4" />
            Add a section (permits, HOA, gate warranty…)
          </button>
        </div>
      )}
    </section>
  );
}
