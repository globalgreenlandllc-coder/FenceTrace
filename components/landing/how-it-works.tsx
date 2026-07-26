"use client";

import { motion } from "framer-motion";

const STEPS = [
  {
    n: "01",
    title: "Geocode & fetch aerial",
    body: "We resolve the address and pull high-resolution aerial imagery + roof pitch data.",
  },
  {
    n: "02",
    title: "Segment the eaves",
    body: "Vision AI traces gutter-bearing edges and reports total linear feet with corner counts.",
  },
  {
    n: "03",
    title: "Place the downspouts",
    body: "Heuristic engine drops 1 downspout per ~35 LF, preferring outside corners + low elevations.",
  },
  {
    n: "04",
    title: "Send & get paid",
    body: "Adjust scope, send the proposal, the homeowner accepts and pays — funds land in your Stripe.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden bg-white py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-12 max-w-2xl">
          <span className="font-label inline-flex items-center rounded-md border border-ink/20 px-2.5 py-1 text-ink">
            How it works
          </span>
          <h2 className="display-hero mt-6 text-balance text-3xl text-ink sm:text-4xl md:text-5xl">
            From <span className="text-accent-600">address</span> to accepted
            in four steps.
          </h2>
          <p className="mt-4 text-zinc-600">
            The pipeline runs in parallel server-side, so the contractor sees an
            editable estimate seconds after typing the address.
          </p>
        </div>

        <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="surface group relative p-6 shadow-card transition hover:border-accent-300"
            >
              <span className="font-label inline-flex rounded-md border border-accent-200 bg-accent-50 px-2 py-0.5 text-accent-700">
                {s.n}
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                {s.body}
              </p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
