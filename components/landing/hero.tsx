"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Award,
  ShieldCheck,
  Star,
  Target,
  Timer,
} from "lucide-react";
import { AddressInput } from "./address-input";
import { MiniDemo } from "./mini-demo";
import { DemoFlow } from "./demo-flow";
import { SAMPLE_ADDRESS } from "@/lib/mock-estimate";

/**
 * Centered Hyperline-style hero:
 *   pill → giant two-tone display headline → subcopy → AddressInput
 *   → social proof → KPI strip → MiniDemo "product screenshot" card
 *   sitting on a band that fades into bg-ink with hl-stripes columns.
 *
 * Both AddressInput and MiniDemo open the same DemoFlow modal, which
 * is mounted here at the Hero level so its state can be shared.
 */
export function Hero() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoAddress, setDemoAddress] = useState("");

  function openDemo(addr: string) {
    setDemoAddress(addr || SAMPLE_ADDRESS);
    setDemoOpen(true);
  }

  return (
    <section className="relative overflow-hidden bg-paper pt-28 sm:pt-36">
      {/* Full-height vertical column lines on the paper canvas */}
      <div aria-hidden className="hl-grid absolute inset-0 -z-10" />

      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          {/* Announcement pill */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-600 px-4 py-1.5 text-sm text-white">
              Built for gutter contractors
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </motion.div>

          {/* Giant two-tone display headline */}
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="display-hero mt-6 text-balance text-[clamp(2.8rem,7.5vw,6.5rem)]"
          >
            <span className="block text-accent-600">Address in.</span>
            <span className="block text-ink">Signed proposal out.</span>
          </motion.h1>

          {/* Subcopy */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-6 max-w-2xl text-balance text-lg text-zinc-600 sm:text-xl"
          >
            Our AI measures the eaves, places downspouts, and assembles a
            branded, sign-and-pay proposal — in under{" "}
            <strong className="text-zinc-900">60 seconds</strong>.
          </motion.p>

          {/* Signature CTA — the address bar */}
          <div className="mt-8 w-full max-w-2xl">
            <AddressInput onOpenDemo={openDemo} />
          </div>

          {/* Social proof + trust line */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-7 flex flex-col items-center gap-3 text-zinc-600 sm:flex-row sm:gap-5"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-2">
                {AVATARS.map((a) => (
                  <span
                    key={a.label}
                    title={a.label}
                    style={{ background: a.bg }}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-sm"
                  >
                    {a.initials}
                  </span>
                ))}
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-ink text-[9px] font-semibold text-white shadow-sm">
                  +1k
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className="h-3 w-3 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <span className="text-xs text-zinc-600">
                  <strong className="text-zinc-900">4.9/5</strong> · 1k+
                  contractors
                </span>
              </div>
            </div>
            <span className="hidden h-4 w-px bg-zinc-300 sm:block" />
            <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
              <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
              Stripe-secured · SOC 2 in progress
            </div>
          </motion.div>

          {/* KPI strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-10 grid w-full max-w-2xl grid-cols-3 divide-x divide-zinc-200 rounded-xl border border-zinc-200 bg-white shadow-card"
          >
            <StatPill icon={Timer} value="< 60 sec" label="Address → proposal" />
            <StatPill icon={Target} value="±2%" label="LF accuracy" />
            <StatPill icon={Award} value="10,000+" label="Estimates run" />
          </motion.div>
        </div>
      </div>

      {/* Product showcase — MiniDemo on a band fading into bg-ink */}
      <div className="relative mt-14 pb-20 sm:mt-16 sm:pb-24">
        {/* Dark band behind the lower part of the screenshot card */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 top-[38%]">
          <div className="absolute inset-0 bg-ink" />
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-paper to-transparent" />
          <div className="hl-stripes absolute inset-y-0 left-0 hidden w-16 opacity-90 sm:block lg:w-24" />
          <div className="hl-stripes absolute inset-y-0 right-0 hidden w-16 opacity-90 sm:block lg:w-24" />
        </div>

        <div className="relative mx-auto max-w-5xl px-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-2 shadow-elevated sm:p-3">
            <MiniDemo onOpenFullDemo={() => openDemo("")} />
          </div>
        </div>
      </div>

      <DemoFlow
        open={demoOpen}
        address={demoAddress}
        onClose={() => setDemoOpen(false)}
      />
    </section>
  );
}

const AVATARS = [
  {
    initials: "MR",
    label: "Mike R.",
    bg: "linear-gradient(135deg,#4353ff,#2e40e8)",
  },
  {
    initials: "JT",
    label: "Jess T.",
    bg: "linear-gradient(135deg,#9d5cf6,#4353ff)",
  },
  {
    initials: "DK",
    label: "Dan K.",
    bg: "linear-gradient(135deg,#f8717e,#9d5cf6)",
  },
];

function StatPill({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Timer;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-4 text-center">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-accent-600" />
        <span className="text-lg font-semibold tracking-tight text-zinc-900 tabular-nums sm:text-xl">
          {value}
        </span>
      </div>
      <div className="font-label text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
