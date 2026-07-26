"use client";

import { Check, CreditCard, Palette, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    id: "stripe",
    icon: CreditCard,
    label: "Connect Stripe",
    sub: "Receive payments",
    done: false,
    href: "/dashboard/settings",
  },
  {
    id: "pricing",
    icon: Palette,
    label: "Set baseline pricing",
    sub: "$/LF, labor min, tax",
    done: true,
    href: "/dashboard/settings",
  },
  {
    id: "brand",
    icon: ShieldCheck,
    label: "License & warranty",
    sub: "Add your boilerplates",
    done: true,
    href: "/dashboard/settings",
  },
];

export function OnboardingStrip() {
  const reduceMotion = useReducedMotion();
  const total = STEPS.length;
  const done = STEPS.filter((s) => s.done).length;
  if (done === total) return null;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-card"
    >
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <svg className="absolute h-10 w-10 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="rgb(228 228 231)"
              strokeWidth="3"
            />
            {/* Progress arc sweeps from 0 to done/total on mount. */}
            <motion.circle
              cx="18"
              cy="18"
              r="15"
              fill="rgba(20,104,140,0.10)"
              stroke="#14688C"
              strokeWidth="3"
              strokeLinecap="round"
              initial={
                reduceMotion ? false : { strokeDasharray: "0 94.2" }
              }
              animate={{
                strokeDasharray: `${(done / total) * 94.2} 94.2`,
              }}
              transition={{ duration: 0.6, ease: EASE, delay: DUR.fast }}
            />
          </svg>
          <span className="text-xs font-semibold text-zinc-900">
            {done}/{total}
          </span>
        </div>
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Finish setup
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            One step left to start collecting payments.
          </div>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className={cn(
              "transition-smooth ring-focus press-scale flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              s.done
                ? "border-accent-200 bg-accent-50/40 text-accent-700"
                : "border-zinc-200 text-zinc-700 hover:border-accent-400 hover:bg-accent-50/40",
            )}
          >
            {s.done ? (
              <Check className="h-3.5 w-3.5 text-accent-600" />
            ) : (
              <s.icon className="h-3.5 w-3.5 text-zinc-500" />
            )}
            <span className="font-medium">{s.label}</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              · {s.sub}
            </span>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
