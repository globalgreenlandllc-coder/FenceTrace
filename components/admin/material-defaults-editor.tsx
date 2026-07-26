"use client";

import { useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  upsertMaterialDefaults,
  deleteMaterialDefault,
  resetMaterialDefaultsToCanonical,
  type MaterialDefaultRow,
} from "@/app/actions/material-defaults";

type Cat = MaterialDefaultRow["category"];
type Unit = MaterialDefaultRow["unit"];

const CATEGORY_META: Record<
  Cat,
  { label: string; sub: string; tone: Parameters<typeof Badge>[0]["tone"] }
> = {
  gutter: {
    label: "Gutters",
    sub: "Per linear foot",
    tone: "accent",
  },
  downspout: {
    label: "Downspouts",
    sub: "Per linear foot",
    tone: "sky",
  },
  accessory: {
    label: "Accessories",
    sub: "Hangers, corners, end caps, guards",
    tone: "violet",
  },
  labor: {
    label: "Labor",
    sub: "Mobilization, removal, install",
    tone: "amber",
  },
};

const CATEGORIES: Cat[] = ["gutter", "downspout", "accessory", "labor"];
const UNITS: Unit[] = ["LF", "ea", "lot"];

type DraftRow = MaterialDefaultRow & {
  _dirty?: boolean;
  _new?: boolean;
};

export function MaterialDefaultsEditor({
  rows: initial,
}: {
  rows: MaterialDefaultRow[];
}) {
  const [rows, setRows] = useState<DraftRow[]>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState<DraftRow | null>(null);
  const reduce = useReducedMotion();

  const dirtyRows = useMemo(
    () => rows.filter((r) => r._dirty || r._new),
    [rows],
  );

  function update(id: string, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)),
    );
  }

  function addRow(category: Cat) {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sortOrder =
      Math.max(
        0,
        ...rows.filter((r) => r.category === category).map((r) => r.sortOrder),
      ) + 10;
    setRows((prev) => [
      ...prev,
      {
        id,
        key: `custom-${Date.now()}`,
        label: "New material",
        category,
        unit: category === "labor" ? "lot" : category === "downspout" ? "LF" : "ea",
        priceCents: 0,
        description: null,
        sortOrder,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        _new: true,
        _dirty: true,
      },
    ]);
  }

  function saveAll() {
    if (dirtyRows.length === 0) return;
    startTransition(async () => {
      const payload = dirtyRows.map((r) => ({
        id: r._new ? undefined : r.id,
        key: r.key,
        label: r.label,
        category: r.category,
        unit: r.unit,
        priceCents: r.priceCents,
        description: r.description,
        sortOrder: r.sortOrder,
      }));
      try {
        await upsertMaterialDefaults(payload);
        setRows((prev) =>
          prev.map((r) => ({ ...r, _dirty: false, _new: false })),
        );
        setSavedAt(new Date());
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function performDelete(row: DraftRow) {
    if (row._new) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setDeleting(null);
      return;
    }
    startTransition(async () => {
      await deleteMaterialDefault(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setDeleting(null);
    });
  }

  function reset() {
    setResetting(true);
    startTransition(async () => {
      try {
        await resetMaterialDefaultsToCanonical();
        window.location.reload();
      } finally {
        setResetting(false);
      }
    });
  }

  return (
    <>
      <div className="sticky top-16 z-10 -mx-4 mb-6 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
          <div className="flex-1">
            {dirtyRows.length > 0 ? (
              <div className="anim-enter-fade flex items-center gap-2 text-sm text-zinc-700">
                <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
                <span className="font-medium tabular-nums">
                  {dirtyRows.length}{" "}
                  {dirtyRows.length === 1 ? "change" : "changes"}
                </span>
                <span className="text-zinc-500">unsaved</span>
              </div>
            ) : savedAt ? (
              <div className="anim-enter-fade flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>Saved at {savedAt.toLocaleTimeString()}</span>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">
                Edit any row to start. Changes save on demand.
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={reset}
            disabled={pending || resetting}
          >
            <RotateCcw className="h-4 w-4" />
            Reset to canonical
          </Button>
          <Button
            size="sm"
            onClick={saveAll}
            disabled={dirtyRows.length === 0 || pending}
          >
            <Save className="h-4 w-4" />
            {pending && dirtyRows.length > 0
              ? "Saving…"
              : `Save ${dirtyRows.length || ""} change${
                  dirtyRows.length === 1 ? "" : "s"
                }`.trim()}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-8">
        {CATEGORIES.map((cat) => {
          const meta = CATEGORY_META[cat];
          const items = rows
            .filter((r) => r.category === cat)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return (
            <section key={cat}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
                      {meta.label}
                    </h2>
                    <Badge tone={meta.tone}>{items.length}</Badge>
                  </div>
                  <p className="text-xs text-zinc-500">{meta.sub}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addRow(cat)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add row
                </Button>
              </div>

              <div className="surface overflow-hidden shadow-card">
                <div className="font-label hidden grid-cols-[minmax(0,1fr)_88px_140px_minmax(0,1fr)_44px] gap-3 border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 sm:grid">
                  <div>Label</div>
                  <div>Unit</div>
                  <div className="text-right">Price</div>
                  <div>Description</div>
                  <div />
                </div>

                {items.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">
                    No rows in this category. Use{" "}
                    <span className="font-medium text-zinc-700">Add row</span>{" "}
                    above.
                  </div>
                ) : (
                  <ul>
                    <AnimatePresence initial={false}>
                      {items.map((row) => (
                        <motion.li
                          key={row.id}
                          layout
                          initial={reduce ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, height: 0 }}
                          className={cn(
                            "transition-smooth border-b border-zinc-100 last:border-0",
                            row._dirty && "bg-amber-50/40",
                            row._new && "bg-accent-50/30",
                            !row._dirty && !row._new && "hover:bg-zinc-50/60",
                          )}
                        >
                          <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_88px_140px_minmax(0,1fr)_44px] sm:items-center sm:gap-3">
                            <input
                              value={row.label}
                              onChange={(e) =>
                                update(row.id, { label: e.target.value })
                              }
                              className="transition-smooth h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-zinc-900 outline-none focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/15"
                            />

                            <select
                              value={row.unit}
                              onChange={(e) =>
                                update(row.id, { unit: e.target.value as Unit })
                              }
                              className="transition-smooth h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-700 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                            >
                              {UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>

                            <PriceInput
                              cents={row.priceCents}
                              onChange={(cents) =>
                                update(row.id, { priceCents: cents })
                              }
                            />

                            <input
                              value={row.description ?? ""}
                              onChange={(e) =>
                                update(row.id, {
                                  description: e.target.value || null,
                                })
                              }
                              placeholder="Optional note shown on the takeoff"
                              className="transition-smooth h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-zinc-600 outline-none focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/15"
                            />

                            <button
                              onClick={() => setDeleting(row)}
                              className="transition-smooth ring-focus ml-auto flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </section>
          );
        })}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 text-xs text-zinc-500">
          New contractors get a copy of these defaults at signup. Existing
          contractors keep their own overrides — changes here only flow to
          accounts created after you save.
        </div>
      </div>

      <DeleteDialog
        row={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={performDelete}
        pending={pending}
      />
    </>
  );
}

function PriceInput({
  cents,
  onChange,
}: {
  cents: number;
  onChange: (cents: number) => void;
}) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  return (
    <div className="transition-smooth flex h-9 items-center rounded-md border border-zinc-200 bg-white px-2 text-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15">
      <span className="mr-1 text-zinc-400">$</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) {
            onChange(Math.round(parsed * 100));
          }
        }}
        onBlur={() => setText(((cents || 0) / 100).toFixed(2))}
        className="num-input w-full bg-transparent text-right tabular-nums outline-none"
      />
    </div>
  );
}

function DeleteDialog({
  row,
  onClose,
  onConfirm,
  pending,
}: {
  row: DraftRow | null;
  onClose: () => void;
  onConfirm: (r: DraftRow) => void;
  pending: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {row && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" />
          <motion.div
            initial={reduce ? false : { scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-elevated"
          >
            <button
              onClick={onClose}
              className="transition-smooth ring-focus absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Remove {row.label}?
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              {row._new
                ? "Discards this unsaved row."
                : "Existing contractors keep their own row even if you delete the platform default. Only new contractors signing up after this change won't get this material."}
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onConfirm(row)}
                disabled={pending}
              >
                {pending ? "Working…" : "Delete row"}
              </Button>
            </div>
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2 text-xs text-zinc-500">
              Current value: {formatCurrency(row.priceCents / 100)} / {row.unit}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
