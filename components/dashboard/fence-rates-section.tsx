"use client";

/**
 * The contractor's fence price book, in Settings.
 *
 * Every fence type starts on the platform's standard rate, so a new
 * account can quote immediately without touching this screen. Editing a
 * number here is an override; clearing it back to standard deletes the
 * override, which means that type resumes tracking the platform rate
 * (see lib/fence/rates.ts).
 *
 * Rates are FROZEN onto a quote when it's built, so changing a price
 * here never re-prices a proposal that's already out with a client.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getMyFenceRateRows,
  saveMyFenceRates,
} from "@/app/actions/fence-rates";
import {
  RATE_FIELDS,
  RATE_LABEL,
  RATE_LIMITS,
  type FenceRate,
  type RateBook,
  type RateField,
  type RateRow,
} from "@/lib/fence/rates";

const CATEGORY_LABEL: Record<string, string> = {
  wood: "Wood",
  vinyl: "Vinyl",
  "chain-link": "Chain link",
  aluminum: "Aluminum",
  steel: "Steel",
  "split-rail": "Split rail & ranch",
};

/** Anything past this far from standard gets a second look before it
 *  goes out on a quote — it's usually a typo, not a business decision. */
const DRIFT_WARN = 0.6;

type Draft = Record<string, Partial<Record<RateField, string>>>;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function draftFromRows(rows: RateRow[]): Draft {
  const d: Draft = {};
  for (const r of rows) {
    d[r.id] = {
      materialPerLf: fmt(r.effective.materialPerLf),
      laborPerLf: fmt(r.effective.laborPerLf),
      gateSingle: fmt(r.effective.gateSingle),
    };
  }
  return d;
}

export function FenceRatesSection() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMyFenceRateRows()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setDraft(draftFromRows(r));
      })
      .catch(() =>
        alive ? setError("Couldn't load your price book.") : undefined,
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    return () => {
      alive = false;
    };
  }, []);

  const baseline = useMemo(() => draftFromRows(rows), [rows]);

  const dirty = useMemo(
    () =>
      rows.some((r) =>
        RATE_FIELDS.some((f) => draft[r.id]?.[f] !== baseline[r.id]?.[f]),
      ),
    [rows, draft, baseline],
  );

  /** Out-of-range or unparseable entries — save is blocked on these so a
   *  bad number can't silently fall back to standard. */
  const invalid = useMemo(() => {
    const bad: { id: string; field: RateField; label: string }[] = [];
    for (const r of rows) {
      for (const f of RATE_FIELDS) {
        const raw = (draft[r.id]?.[f] ?? "").trim();
        const n = Number(raw);
        const { min, max } = RATE_LIMITS[f];
        if (raw === "" || !Number.isFinite(n) || n < min || n > max) {
          bad.push({ id: r.id, field: f, label: r.label });
        }
      }
    }
    return bad;
  }, [rows, draft]);

  const isBad = (id: string, f: RateField) =>
    invalid.some((b) => b.id === id && b.field === f);

  const customCount = useMemo(
    () =>
      rows.filter((r) =>
        RATE_FIELDS.some(
          (f) => Number(draft[r.id]?.[f]) !== r.standard[f],
        ),
      ).length,
    [rows, draft],
  );

  function setField(id: string, f: RateField, v: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [f]: v } }));
  }

  function resetOne(r: RateRow) {
    setDraft((d) => ({
      ...d,
      [r.id]: {
        materialPerLf: fmt(r.standard.materialPerLf),
        laborPerLf: fmt(r.standard.laborPerLf),
        gateSingle: fmt(r.standard.gateSingle),
      },
    }));
  }

  function resetAll() {
    setDraft(
      Object.fromEntries(
        rows.map((r) => [
          r.id,
          {
            materialPerLf: fmt(r.standard.materialPerLf),
            laborPerLf: fmt(r.standard.laborPerLf),
            gateSingle: fmt(r.standard.gateSingle),
          },
        ]),
      ),
    );
  }

  async function save() {
    if (invalid.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      // Send the full desired state. The server drops anything equal to
      // the platform rate, so "back to standard" persists as a delete.
      const book: RateBook = {};
      for (const r of rows) {
        const rate: FenceRate = {};
        for (const f of RATE_FIELDS) rate[f] = Number(draft[r.id]?.[f]);
        book[r.id] = rate;
      }
      const res = await saveMyFenceRates(book);
      if (!res.ok) throw new Error(res.error ?? "Couldn't save your prices.");
      setRows(res.rows);
      setDraft(draftFromRows(res.rows));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your prices.");
    } finally {
      setSaving(false);
    }
  }

  const groups = useMemo(() => {
    const by = new Map<string, RateRow[]>();
    for (const r of rows) {
      const list = by.get(r.category) ?? [];
      list.push(r);
      by.set(r.category, list);
    }
    return [...by.entries()];
  }, [rows]);

  return (
    <section className="anim-enter stagger-3 surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="microlabel">Pricing</div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
            Your fence prices
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            What you charge per fence type. Every type starts on our
            standard rate — change only the ones you price differently.
          </p>
        </div>
        {!loading && (
          <Badge tone={customCount > 0 ? "accent" : "emerald"}>
            {customCount > 0 && <Check className="h-3 w-3" />}
            {customCount > 0
              ? `${customCount} of ${rows.length} priced your way`
              : "All standard rates"}
          </Badge>
        )}
      </div>

      <div className="mt-5">
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
          These are your base rates. A job still adjusts them for local
          market, fence height, terrain and slope. Quotes freeze your
          prices when they&apos;re built, so editing here never changes a
          proposal a client already has.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-400">Loading your prices…</p>
        ) : (
          <>
            {groups.map(([cat, list]) => (
              <div key={cat} className="mt-5">
                <div className="microlabel mb-2">
                  {CATEGORY_LABEL[cat] ?? cat}
                </div>
                <div className="overflow-x-auto rounded-xl border border-zinc-200">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left">
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                          Fence
                        </th>
                        {RATE_FIELDS.map((f) => (
                          <th
                            key={f}
                            className="w-32 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                          >
                            {RATE_LABEL[f]}
                          </th>
                        ))}
                        <th className="w-10 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const changed = RATE_FIELDS.some(
                          (f) => Number(draft[r.id]?.[f]) !== r.standard[f],
                        );
                        return (
                          <tr
                            key={r.id}
                            className="border-t border-zinc-100 align-middle"
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium text-zinc-900">
                                {r.label}
                              </div>
                              <div className="text-[11px] text-zinc-400">
                                {r.defaultHeightFt}′ standard
                              </div>
                            </td>
                            {RATE_FIELDS.map((f) => {
                              const val = draft[r.id]?.[f] ?? "";
                              const std = r.standard[f];
                              const n = Number(val);
                              const off =
                                Number.isFinite(n) && std > 0
                                  ? Math.abs(n / std - 1)
                                  : 0;
                              const bad = isBad(r.id, f);
                              return (
                                <td key={f} className="px-3 py-2">
                                  <div className="relative">
                                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-zinc-400">
                                      $
                                    </span>
                                    <input
                                      inputMode="decimal"
                                      value={val}
                                      onChange={(e) =>
                                        setField(r.id, f, e.target.value)
                                      }
                                      aria-label={`${r.label} ${RATE_LABEL[f]}`}
                                      aria-invalid={bad || undefined}
                                      className={`ring-focus w-full rounded-lg border py-1.5 pl-5 pr-2 text-sm tabular-nums ${
                                        bad
                                          ? "border-red-300 bg-red-50 text-red-700"
                                          : Number(val) !== std
                                            ? "border-accent-300 bg-accent-50/40 text-zinc-900"
                                            : "border-zinc-200 text-zinc-900"
                                      }`}
                                    />
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-zinc-400">
                                    {bad ? (
                                      <span className="text-red-600">
                                        ${RATE_LIMITS[f].min}–$
                                        {RATE_LIMITS[f].max}
                                      </span>
                                    ) : (
                                      <>
                                        <span>standard ${fmt(std)}</span>
                                        {off >= DRIFT_WARN && (
                                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                                        )}
                                      </>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-right">
                              {changed && (
                                <button
                                  type="button"
                                  onClick={() => resetOne(r)}
                                  title={`Reset ${r.label} to the standard rate`}
                                  aria-label={`Reset ${r.label} to the standard rate`}
                                  className="ring-focus rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {error && (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {invalid.length > 0 && (
              <p className="mt-4 text-sm text-amber-700" role="alert">
                {invalid.length} price
                {invalid.length === 1 ? " is" : "s are"} outside the allowed
                range — fix {invalid.length === 1 ? "it" : "them"} to save.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                onClick={save}
                disabled={!dirty || saving || invalid.length > 0}
              >
                {saved ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saved ? "Saved" : saving ? "Saving…" : "Save prices"}
              </Button>
              {customCount > 0 && (
                <Button variant="ghost" onClick={resetAll} disabled={saving}>
                  <RotateCcw className="h-4 w-4" />
                  Reset all to standard
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
