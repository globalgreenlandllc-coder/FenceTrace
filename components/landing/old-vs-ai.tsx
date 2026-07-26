"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, X } from "lucide-react";

type Row = {
  area: string;
  old: string;
  oldDetail: string;
  ai: string;
  aiDetail: string;
};

const ROWS: Row[] = [
  {
    area: "Measure the roof",
    old: "Climb a ladder, tape measure, sketchpad",
    oldDetail: "30–60 min on-site, weather permitting",
    ai: "Type one address, AI traces the eaves",
    aiDetail: "12 sec, no driving, no climbing",
  },
  {
    area: "Price the job",
    old: "Look up materials, do the math by hand",
    oldDetail: "Margin guesses, missed line items",
    ai: "Auto-priced from your saved defaults",
    aiDetail: "Waste factor + tax + labor included",
  },
  {
    area: "Build the proposal",
    old: "Type into Word, attach photos manually",
    oldDetail: "1–2 hours per house, looks generic",
    ai: "Beautiful Good / Better / Best instantly",
    aiDetail: "Your branding, ready to send",
  },
  {
    area: "Get it to the homeowner",
    old: "Drop it off, mail it, or email a PDF",
    oldDetail: "Days lost waiting for a reply",
    ai: "One-click magic link via email",
    aiDetail: "Homeowner reads it on their phone",
  },
  {
    area: "Get paid",
    old: "Wait for a check, drive to the bank",
    oldDetail: "Days to weeks of float",
    ai: "Stripe / Square deposit at signing",
    aiDetail: "Funds direct to your account",
  },
];

export function OldVsAi() {
  return (
    <section className="relative overflow-hidden bg-paper py-24 sm:py-32">
      <div aria-hidden className="hl-grid absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-3xl text-center">
          <span className="font-label inline-flex items-center gap-1.5 rounded-md border border-ink/20 px-2.5 py-1 text-ink">
            Why contractors switch
          </span>
          <h2 className="display-hero mt-6 text-balance text-4xl text-ink sm:text-5xl md:text-6xl">
            The old way is{" "}
            <span className="text-stripe-coral">losing you jobs</span>.
          </h2>
          <p className="mt-5 text-balance text-base leading-relaxed text-zinc-600">
            Every step from measurement to deposit, side by side. The math is
            simple — the homeowner who gets a same-day proposal signs first.
          </p>
        </div>

        {/* Desktop table */}
        <div className="surface mt-14 hidden overflow-hidden shadow-card lg:block">
          <div className="grid grid-cols-[200px_minmax(0,1fr)_60px_minmax(0,1fr)] border-b border-zinc-200 bg-zinc-50/60">
            <div className="font-label px-5 py-4 text-[11px] text-zinc-400">
              Stage
            </div>
            <div className="px-5 py-4">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                <X className="h-3 w-3" />
                Old way
              </div>
            </div>
            <div />
            <div className="px-5 py-4">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-accent-200 bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">
                <Check className="h-3 w-3" />
                The AI way
              </div>
            </div>
          </div>

          {ROWS.map((r, i) => (
            <motion.div
              key={r.area}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className={`grid grid-cols-[200px_minmax(0,1fr)_60px_minmax(0,1fr)] items-center ${
                i !== ROWS.length - 1 ? "border-b border-zinc-100" : ""
              }`}
            >
              <div className="px-5 py-5 text-sm font-semibold text-zinc-900">
                {r.area}
              </div>
              <div className="px-5 py-5">
                <div className="text-sm text-zinc-700 line-through decoration-rose-300/70 decoration-1">
                  {r.old}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{r.oldDetail}</div>
              </div>
              <div className="flex justify-center text-zinc-400">
                <ArrowRight className="h-4 w-4" />
              </div>
              <div className="px-5 py-5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {r.ai}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {r.aiDetail}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Mobile stacked cards */}
        <div className="mt-10 space-y-4 lg:hidden">
          {ROWS.map((r, i) => (
            <motion.div
              key={r.area}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className="surface overflow-hidden shadow-card"
            >
              <div className="border-b border-zinc-100 bg-zinc-50/60 px-4 py-3">
                <div className="font-label text-[10px] text-zinc-500">
                  {r.area}
                </div>
              </div>
              <div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-4">
                  <div className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    <X className="h-2.5 w-2.5" />
                    Old way
                  </div>
                  <div className="mt-2 text-sm text-zinc-700 line-through decoration-rose-300/70 decoration-1">
                    {r.old}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {r.oldDetail}
                  </div>
                </div>
                <div className="p-4">
                  <div className="inline-flex items-center gap-1 rounded-md border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                    <Check className="h-2.5 w-2.5" />
                    AI way
                  </div>
                  <div className="mt-2 text-sm font-medium text-zinc-900">
                    {r.ai}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {r.aiDetail}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom impact stat */}
        <div className="mx-auto mt-14 max-w-3xl">
          <div className="surface p-6 text-center shadow-card sm:p-8">
            <div className="display-hero text-3xl text-ink sm:text-4xl">
              <span className="text-gradient">8 hours</span> per week back in
              your truck.
            </div>
            <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-600">
              Contractors using AI takeoff send 4× more proposals and close
              31% faster than the spreadsheet-and-clipboard crowd.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
