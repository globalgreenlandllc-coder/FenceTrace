"use client";

import { motion } from "framer-motion";
import { AddressInput } from "./address-input";

export function CTA() {
  return (
    <section className="relative isolate overflow-hidden bg-ink py-24 sm:py-32">
      {/* Hyperline stripe bands at the section edges */}
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 left-0 -z-10 hidden w-14 opacity-90 sm:block lg:w-24"
      />
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 right-0 -z-10 hidden w-14 opacity-90 sm:block lg:w-24"
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-3xl px-4 text-center"
      >
        <span className="font-label inline-flex items-center rounded-md border border-white/25 px-2.5 py-1 text-white">
          Ready when you are
        </span>
        <h2 className="display-hero mt-6 text-balance text-3xl text-white sm:text-4xl md:text-5xl">
          Type an address. Watch the estimate{" "}
          <span className="text-gradient">build itself.</span>
        </h2>
        <div className="mt-9">
          {/* AddressInput manages its own DemoFlow fallback here — no
              onOpenDemo prop, so the local modal wiring kicks in. */}
          <AddressInput />
        </div>
      </motion.div>
    </section>
  );
}
