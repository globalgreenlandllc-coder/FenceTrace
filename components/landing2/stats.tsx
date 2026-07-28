"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Container } from "./ui";
import { Reveal } from "./reveal";

const STATS = [
  { label: "Seconds to a priced proposal", value: "60" },
  { label: "Tiers in every quote", value: "3" },
  { label: "Tape measures required", value: "0" },
];

/**
 * Counts up from 0 to the numeric part of `value` on first view.
 * Shared client island — also used by the dashboard KPI tiles, which pass
 * their own className. Grouped values ("$96,330") keep their commas.
 */
export function CountUp({
  value,
  className = "text-[42px] font-semibold leading-none tracking-tight text-zinc-900",
}: {
  value: string;
  className?: string;
}) {
  const match = value.match(/^([^0-9]*)([\d,]+)(.*)$/);
  const prefix = match?.[1] ?? "";
  const digits = match?.[2] ?? "0";
  const grouped = digits.includes(",");
  const target = Number(digits.replace(/,/g, ""));
  const suffix = match?.[3] ?? "";

  const ref = useRef<HTMLParagraphElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  // Starts at the final value (static SSR + reduced-motion render); the
  // count-up only runs once the tile scrolls into view.
  const [n, setN] = useState(target);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1200;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduceMotion, target]);

  return (
    <p ref={ref} className={className}>
      {prefix}
      {grouped ? n.toLocaleString("en-US") : n}
      {suffix}
    </p>
  );
}

export function Stats() {
  return (
    <section className="pb-16 pt-6 md:pb-24">
      <Container>
        <div className="grid gap-3 md:grid-cols-4">
          <Reveal>
            <div className="flex h-full min-h-[168px] flex-col justify-between rounded-2xl bg-accent-950 p-6">
              <span className="inline-block h-[7px] w-[7px] rounded-[2px] bg-accent-400" />
              <p className="text-[15px] leading-snug text-white">
                Trusted by contractors
                <br />
                estimating from the sky
                <br />
                at scale
              </p>
            </div>
          </Reveal>
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={(i + 1) * 0.05}>
              <div className="flex h-full min-h-[168px] flex-col justify-between rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-card">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                  {s.label}
                </p>
                <CountUp value={s.value} />
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
