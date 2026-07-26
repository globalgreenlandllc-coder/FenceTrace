"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  GripHorizontal,
  Loader2,
  Maximize2,
  X,
} from "lucide-react";
import { runEstimate, runEstimateFromPlan } from "@/app/actions/estimate";
import { useTakeoffProgress } from "@/components/estimate/takeoff-progress";
import type { EstimateResult } from "@/lib/ai";

/**
 * Global owner of the (long) takeoff analysis. Historically the
 * /estimate page ran the server action + poll loop in its own effect,
 * which meant the fullscreen loading screen held the contractor hostage
 * for the 1-2 minutes a plan analysis takes — navigating away killed
 * the client-side polling.
 *
 * This provider lifts the job above routing (mounted in the root
 * layout), so the contractor can minimize the loading screen, keep
 * working anywhere in the app while a draggable mini-window tracks
 * progress, and get bounced back to the full estimate the moment the
 * takeoff is ready.
 */

const MIN_LOADING_MS = 2400;
const WATCHDOG_MESSAGE =
  "The estimate is taking longer than usual to come back. An upstream service " +
  "(Solar API, satellite imagery, or AI vision) may be slow right now. Try again.";

export type TakeoffJobParams = {
  planId?: string | null;
  address?: string | null;
  jobType: "new" | "replacement";
};

export type TakeoffJob = {
  key: string;
  planId: string | null;
  address: string | null;
  jobType: "new" | "replacement";
  mode: "plan" | "aerial";
  startedAt: number;
  phase: "running" | "ready" | "error";
  result: EstimateResult | null;
  reused: boolean;
  error: string | null;
};

export function takeoffJobKey(p: TakeoffJobParams): string | null {
  if (p.planId) return `plan:${p.planId}`;
  if (p.address) return `addr:${p.address.trim()}`;
  return null;
}

export function estimateUrl(job: TakeoffJob): string {
  const target = job.planId
    ? `planId=${encodeURIComponent(job.planId)}`
    : `address=${encodeURIComponent(job.address ?? "")}`;
  return `/estimate?${target}&jobType=${job.jobType}`;
}

type EstimateJobContextValue = {
  job: TakeoffJob | null;
  /** Idempotent: a job already running (or ready) for the same
   *  plan/address is left alone unless `force` is set. */
  startJob: (params: TakeoffJobParams, opts?: { force?: boolean }) => void;
  /** Hide the mini-window and stop watching. Server-side work (and its
   *  cached result) is unaffected — revisiting /estimate re-attaches. */
  dismissJob: () => void;
};

const EstimateJobContext = createContext<EstimateJobContextValue | null>(null);

export function useEstimateJob(): EstimateJobContextValue {
  const ctx = useContext(EstimateJobContext);
  if (!ctx) {
    throw new Error("useEstimateJob must be used within EstimateJobProvider");
  }
  return ctx;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function EstimateJobProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [job, setJob] = useState<TakeoffJob | null>(null);
  // Mirror for synchronous reads inside callbacks (startJob decisions,
  // patch merges) without stale-closure hazards.
  const jobRef = useRef<TakeoffJob | null>(null);
  // Run sequence — bumping it orphans any in-flight promise chain, so a
  // dismissed or superseded run can never write into the new job.
  const seqRef = useRef(0);

  const commit = useCallback((next: TakeoffJob | null) => {
    jobRef.current = next;
    setJob(next);
  }, []);

  const execute = useCallback(
    async (seq: number, j: TakeoffJob) => {
      const isMine = () => seqRef.current === seq;
      const patch = (p: Partial<TakeoffJob>) => {
        if (!isMine() || !jobRef.current) return;
        commit({ ...jobRef.current, ...p });
      };

      // Client-side watchdog. Address mode finishes in 25-50s typically
      // — 95s is the bail-out. Plan mode runs Claude vision on a large
      // PDF which can take 60-120s; bump to 240s (just under the 300s
      // maxDuration on the route). Each pending re-poll re-arms the
      // timer, mirroring the old page effect that re-mounted per tick.
      const WATCHDOG_MS = j.planId ? 240_000 : 95_000;

      for (;;) {
        if (!isMine()) return;
        let timedOut = false;
        const watchdog = setTimeout(() => {
          timedOut = true;
          patch({ phase: "error", error: WATCHDOG_MESSAGE });
        }, WATCHDOG_MS);

        let r: Awaited<ReturnType<typeof runEstimateFromPlan>>;
        try {
          r = await (j.planId
            ? runEstimateFromPlan(j.planId)
            : runEstimate(j.address ?? ""));
        } catch (e) {
          clearTimeout(watchdog);
          if (!isMine() || timedOut) return;
          // Server action threw rather than returning {ok:false}.
          console.error("[estimate-job] server action threw", e);
          patch({
            phase: "error",
            error:
              e instanceof Error && e.message
                ? e.message
                : "The estimate service is temporarily unavailable. Try again in a few seconds.",
          });
          return;
        }
        clearTimeout(watchdog);
        if (!isMine() || timedOut) return;

        if (r.ok) {
          // Hold the loading treatment for a beat on instant (reused)
          // results so the screen doesn't flash.
          const elapsed = Date.now() - j.startedAt;
          if (elapsed < MIN_LOADING_MS) await sleep(MIN_LOADING_MS - elapsed);
          if (!isMine()) return;
          patch({ phase: "ready", result: r.result, reused: r.reused });
          return;
        }
        if ("pending" in r && r.pending) {
          // QUEUED — analysis still running in the after() callback.
          // Re-poll every 3s until the watchdog gives up.
          await sleep(3000);
          continue;
        }
        patch({ phase: "error", error: r.reason });
        return;
      }
    },
    [commit],
  );

  const startJob = useCallback(
    (params: TakeoffJobParams, opts?: { force?: boolean }) => {
      const key = takeoffJobKey(params);
      if (!key) return;
      const prev = jobRef.current;
      // Same job already running or finished cleanly → attach, don't
      // restart (also makes React strict-mode double-effects a no-op).
      if (!opts?.force && prev?.key === key && prev.phase !== "error") return;

      const seq = ++seqRef.current;
      const next: TakeoffJob = {
        key,
        planId: params.planId ?? null,
        address: params.address ?? null,
        jobType: params.jobType,
        mode: params.planId ? "plan" : "aerial",
        startedAt: Date.now(),
        phase: "running",
        result: null,
        reused: false,
        error: null,
      };
      commit(next);
      void execute(seq, next);
    },
    [commit, execute],
  );

  const dismissJob = useCallback(() => {
    seqRef.current++;
    commit(null);
  }, [commit]);

  return (
    <EstimateJobContext.Provider value={{ job, startJob, dismissJob }}>
      {children}
      <EstimateMiniWindow />
    </EstimateJobContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Floating mini-window                                                */
/* ------------------------------------------------------------------ */

/**
 * Draggable picture-in-picture card that tracks the running takeoff
 * anywhere in the app. Hidden (but kept mounted, so its drag position
 * survives) while the contractor is on /estimate itself — the
 * fullscreen loading/result view owns that page. When the takeoff
 * lands while minimized, it flashes "ready" and bounces the contractor
 * back to the full estimate screen.
 */
function EstimateMiniWindow() {
  const { job, dismissJob } = useEstimateJob();
  const pathname = usePathname();
  const router = useRouter();
  const boundsRef = useRef<HTMLDivElement>(null);
  const onEstimatePage = pathname === "/estimate";

  // Auto-return, once per job, ~a second after the ready flash lands.
  const openedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.phase !== "ready" || onEstimatePage) return;
    if (openedKeyRef.current === job.key) return;
    openedKeyRef.current = job.key;
    const t = setTimeout(() => router.push(estimateUrl(job)), 900);
    return () => clearTimeout(t);
  }, [job, onEstimatePage, router]);

  if (!job) return null;

  return (
    <div
      ref={boundsRef}
      className={`pointer-events-none fixed inset-0 z-[95] ${
        onEstimatePage ? "invisible" : ""
      }`}
      aria-hidden={onEstimatePage}
    >
      <motion.div
        drag
        dragConstraints={boundsRef}
        dragMomentum={false}
        dragElastic={0.08}
        style={{ touchAction: "none" }}
        className="pointer-events-auto absolute bottom-5 right-5 w-72 cursor-grab rounded-xl border border-zinc-200 bg-white shadow-xl active:cursor-grabbing"
      >
        <MiniWindowBody
          job={job}
          onExpand={() => router.push(estimateUrl(job))}
          onDismiss={dismissJob}
        />
      </motion.div>
    </div>
  );
}

function MiniWindowBody({
  job,
  onExpand,
  onDismiss,
}: {
  job: TakeoffJob;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const reduce = useReducedMotion();
  const { steps, stepIndex, pctInt, progress, elapsedSec } = useTakeoffProgress(
    job.mode,
    job.startedAt,
  );
  const label = job.planId ? "Analyzing plan" : "Running takeoff";
  // Keep clicks on the controls from initiating a drag on the card.
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
        <span className="microlabel flex-1 truncate text-accent-700">
          {job.phase === "error"
            ? "Analysis failed"
            : job.phase === "ready"
              ? "Takeoff ready"
              : label}
        </span>
        <button
          onPointerDown={stopDrag}
          onClick={onExpand}
          className="ring-focus press-scale rounded-md p-1 text-zinc-400 transition-smooth hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Open full screen"
          title="Open full screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          onPointerDown={stopDrag}
          onClick={onDismiss}
          className="ring-focus press-scale rounded-md p-1 text-zinc-400 transition-smooth hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Hide — analysis keeps running"
          title="Hide — analysis keeps running"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {job.phase === "running" && (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-600" />
              <span className="truncate">{steps[stepIndex].label}…</span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-accent-700">
              {pctInt}%
            </span>
          </div>
          <div className="skeleton mt-2 h-1.5 w-full rounded-full">
            <motion.div
              className="h-full w-full rounded-full bg-accent-600"
              style={{ originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: 0.9 }}
            />
          </div>
          <div className="mt-1.5 text-right text-[10px] tabular-nums text-zinc-400">
            {elapsedSec}s elapsed · opens when ready
          </div>
        </>
      )}

      {job.phase === "ready" && (
        <div className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-200">
            <Check className="h-3 w-3" />
          </span>
          Opening your takeoff…
        </div>
      )}

      {job.phase === "error" && (
        <div className="mt-2 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-xs leading-relaxed text-zinc-600">
              {job.error ?? "Unknown error"}
            </p>
            <button
              onPointerDown={stopDrag}
              onClick={onExpand}
              className="transition-smooth ring-focus mt-1.5 text-xs font-semibold text-accent-700 hover:text-accent-900"
            >
              View details &amp; retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
