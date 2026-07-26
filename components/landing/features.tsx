"use client";

import { motion } from "framer-motion";
import {
  Zap,
  Layers,
  PencilRuler,
  FileSignature,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

const ITEMS = [
  {
    icon: Zap,
    title: "One-address takeoff",
    body: "Geocode + aerial fetch + roof segmentation runs server-side in under 60 seconds.",
  },
  {
    icon: Layers,
    title: "Editable AI overlay",
    body: "Drag, add, or delete eaves and downspouts directly on the aerial canvas.",
  },
  {
    icon: PencilRuler,
    title: "Live pricing engine",
    body: "Reactive table with overrides, markup, labor, taxes, and Good/Better/Best packages.",
  },
  {
    icon: FileSignature,
    title: "Proposals + e-sign",
    body: "Send a beautiful client portal. Homeowner reviews, signs, and pays in one flow.",
  },
  {
    icon: CreditCard,
    title: "Stripe Connect payouts",
    body: "Funds route directly to the contractor. Platform fee deducted on the way through.",
  },
  {
    icon: ShieldCheck,
    title: "Built for the field",
    body: "Mobile-first interactions, large tap targets, offline-tolerant edits.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-paper py-24">
      <div aria-hidden className="hl-grid absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-4">
        <div className="mb-12 flex flex-col items-center text-center">
          <span className="font-label inline-flex items-center rounded-md border border-ink/20 px-2.5 py-1 text-ink">
            Features
          </span>
          <h2 className="display-hero mt-6 text-balance text-3xl text-ink sm:text-4xl md:text-5xl">
            The fastest path from{" "}
            <span className="text-gradient">address to accepted job.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-zinc-600">
            A premium SaaS platform purpose-built for gutter contractors who
            close jobs from the truck.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className="surface group h-full p-6 shadow-card transition-colors hover:border-accent-300"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-600 text-white">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-zinc-900">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                {item.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
