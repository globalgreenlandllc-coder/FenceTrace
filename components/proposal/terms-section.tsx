"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { DUR, EASE } from "@/lib/motion";
import type { Proposal } from "@/lib/proposal-mock";
import { SectionHeader } from "./packages-section";

export function TermsSection({
  proposal,
  onChange,
  readOnly,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  readOnly?: boolean;
}) {
  const reduce = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);

  function update(id: string, patch: Partial<Proposal["terms"][number]>) {
    onChange({
      ...proposal,
      terms: proposal.terms.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    });
  }

  const visible = readOnly
    ? proposal.terms.filter((t) => t.enabled)
    : proposal.terms;

  return (
    <section data-section="terms" className="space-y-4">
      <SectionHeader
        title="Terms & warranty"
        sub={
          readOnly
            ? "Please review before signing."
            : "Toggle which boilerplates apply. Click to expand and edit."
        }
        readOnly={readOnly}
      />

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <ul>
          {visible.map((t) => {
            const open = openId === t.id;
            return (
              <li
                key={t.id}
                className={cn(
                  "border-b border-zinc-100 last:border-0",
                  !t.enabled && !readOnly && "opacity-50",
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3 transition-smooth hover:bg-zinc-50/60">
                  {!readOnly && (
                    <GripVertical className="h-4 w-4 shrink-0 text-zinc-300" />
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : t.id)}
                    className="ring-focus flex flex-1 items-center justify-between gap-2 rounded-md text-left"
                  >
                    <span className="font-medium text-zinc-900">{t.title}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-zinc-400 transition-transform motion-reduce:transition-none",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  {!readOnly && (
                    <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) =>
                          update(t.id, { enabled: e.target.checked })
                        }
                        className="h-3.5 w-3.5 rounded border-zinc-300 accent-accent-600"
                      />
                      Include
                    </label>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reduce ? 0 : DUR.base, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        {readOnly ? (
                          <p className="text-sm leading-relaxed text-zinc-600">
                            {t.body}
                          </p>
                        ) : (
                          <textarea
                            value={t.body}
                            onChange={(e) =>
                              update(t.id, { body: e.target.value })
                            }
                            rows={3}
                            className="w-full resize-none rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-700 outline-none transition-smooth focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                          />
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
