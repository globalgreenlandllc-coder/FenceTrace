"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, Loader2, MapPin, PictureInPicture2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { DUR, EASE } from "@/lib/motion";
import { useTakeoffProgress } from "@/components/estimate/takeoff-progress";

export function LoadingState({
  address,
  mode = "aerial",
  startedAt,
  onMinimize,
}: {
  address: string;
  mode?: "aerial" | "plan";
  /** Wall-clock start of the underlying job. Passing it keeps the
   *  percentage continuous when this screen unmounts/remounts (e.g.
   *  minimize → mini-window → back). Defaults to first render. */
  startedAt?: number;
  /** When provided, shows the "keep working" affordance that shrinks
   *  this screen into the floating mini-window. */
  onMinimize?: () => void;
}) {
  const reduce = useReducedMotion();
  const [fallbackStart] = useState(() => Date.now());
  // Progress is a pure function of wall-clock — shared with the
  // mini-window so both surfaces show the same number.
  const { steps, stepIndex, onLastStep, pctInt, progress, elapsedSec } =
    useTakeoffProgress(mode, startedAt ?? fallbackStart);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-paper px-4">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.entrance, ease: EASE }}
        className="relative w-full max-w-xl"
      >
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-zinc-200/70 bg-white p-8 shadow-card">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 text-accent-600" />
            <div className="min-w-0 flex-1">
              <div className="microlabel">Running takeoff</div>
              <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-zinc-900">
                {address}
              </div>
            </div>
          </div>

          {/* Percent + bar. The number ticks every second on the long
              final step (asymptotic creep), so the screen visibly advances
              instead of reading as frozen. */}
          <div className="mt-6 flex items-baseline justify-between">
            <span className="microlabel">
              {onLastStep ? "Finishing up" : "Working"}
            </span>
            <span className="text-sm font-semibold tabular-nums text-accent-700">
              {pctInt}%
            </span>
          </div>
          {/* Track carries the skeleton shimmer (the one permitted infinite
              animation) so the bar still reads "working" while the fill
              creeps on the long final step. Fill animates scaleX — never
              width. */}
          <div className="skeleton mt-2 h-1.5 w-full rounded-full">
            <motion.div
              className="h-full w-full rounded-full bg-accent-600"
              style={{ originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: 0.9, ease: EASE }}
            />
          </div>

          <ul className="mt-6 space-y-2.5">
            {steps.map((s, i) => {
              const state =
                i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <motion.li
                  key={s.id}
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: DUR.slow, ease: EASE, delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                >
                  <span className="flex h-6 w-6 items-center justify-center">
                    <AnimatePresence mode="wait">
                      {state === "done" && (
                        <motion.span
                          key="done"
                          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: DUR.fast, ease: EASE }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-200"
                        >
                          <Check className="h-3 w-3" />
                        </motion.span>
                      )}
                      {state === "active" && (
                        <motion.span
                          key="active"
                          initial={reduce ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: DUR.fast, ease: EASE }}
                          className="text-accent-600"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </motion.span>
                      )}
                      {state === "pending" && (
                        <motion.span
                          key="pending"
                          initial={reduce ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: DUR.fast, ease: EASE }}
                          className="h-2 w-2 rounded-full bg-zinc-300"
                        />
                      )}
                    </AnimatePresence>
                  </span>
                  <span
                    className={
                      "transition-smooth " +
                      (state === "done"
                        ? "text-zinc-700"
                        : state === "active"
                        ? "font-medium text-zinc-900"
                        : "text-zinc-400")
                    }
                  >
                    {s.label}
                    {state === "active" && (
                      <span className="ml-1 animate-pulse motion-reduce:animate-none">
                        …
                      </span>
                    )}
                  </span>
                </motion.li>
              );
            })}
          </ul>

          {/* Escape hatch: the analysis runs above routing (estimate-job
              provider), so the contractor doesn't have to babysit this
              screen — shrink it to the floating mini-window and keep
              working. It pops back to full screen when the takeoff lands. */}
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="transition-smooth ring-focus press-scale mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-[13px] font-medium text-zinc-700 hover:border-accent-300 hover:text-accent-800"
            >
              <PictureInPicture2 className="h-4 w-4 text-accent-600" />
              Minimize &amp; keep working — we&rsquo;ll bring you back when
              it&rsquo;s ready
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500">
          {mode === "plan"
            ? "Two-stage AI: Haiku sheet inventory · Sonnet roof-plan geometry"
            : "Running in parallel: Solar API · Vision segmentation · Turf.js geometry"}
        </p>

        {/* Wall-clock elapsed + reassurance copy on plan mode where
            the final Sonnet call can sit for 30-60s after the cascade
            finishes. Without this the contractor sees "Building
            takeoff…" with no feedback and assumes the app is stuck. */}
        <div className="mt-3 flex items-center justify-center gap-2 text-center text-[11px] text-zinc-400">
          <span className="tabular-nums">{elapsedSec}s elapsed</span>
          {mode === "plan" && onLastStep && (
            <span className="anim-enter-fade text-zinc-500">
              · Sonnet is tracing — typically 30-60s on the final step
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
