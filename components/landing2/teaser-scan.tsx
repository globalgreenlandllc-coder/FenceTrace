"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  Lock,
  MapPin,
  ScanLine,
} from "lucide-react";
import { ExampleScanPanel } from "@/components/landing2/example-scan";
import { EXAMPLE_SCAN } from "@/components/landing2/example-scan-data";
import { walkPostPositions, type Pt } from "@/lib/fence/geo";
import type { TeaserFenceRun, TeaserPayload } from "@/lib/fence/teaser";

/**
 * The landing page's acquisition hook: scan a real address BEFORE
 * signing up. Runs the actual fence engine via /api/teaser (2/day per
 * IP, fail-closed) and plays a takeoff on the visitor's own satellite
 * photo in three beats:
 *   1. a scan comet sweeps the parcel and settles into the thin white
 *      property line (the app's cadastral style);
 *   2. the suggested fence builds in green — posts popping along the
 *      property line, returns tying into the house footprint;
 *   3. every run gets a measurement tag, blurred behind a lock — the
 *      footage is what the free signup opens.
 *
 * The typed address is stashed in localStorage so the post-signup
 * dashboard can offer to finish exactly this scan.
 */

export const PENDING_SCAN_KEY = "fencescan.pendingAddress";

const SCAN_STEPS = [
  "Locating the property…",
  "Pulling the satellite view…",
  "Reading the property lines…",
  "Finding the house…",
  "Laying out the fence…",
  "Squaring the corners…",
];

function pathD(points: Pt[]): string {
  if (points.length === 0) return "";
  return (
    `M ${points[0].x} ${points[0].y} ` +
    points
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ")
  );
}

/** Distinct corner posts of a run (closing duplicate skipped). */
function cornerPoints(points: Pt[]): Pt[] {
  if (points.length < 2) return [];
  const closed =
    points.length >= 3 &&
    Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 1;
  return closed ? points.slice(0, -1) : points;
}

type SegTag = { key: string; x: number; y: number; ft: number; len: number };

/** Midpoint tags for the longest fence segments — the locked teasers.
 *  The footage shown is a plausible px-derived stand-in; it renders
 *  blurred, the real number is exactly what signup unlocks. */
function lockedSegTags(fence: TeaserFenceRun[]): SegTag[] {
  const all: SegTag[] = [];
  for (const run of fence) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 60) continue;
      all.push({
        key: `${run.id}-${i}`,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        ft: Math.max(12, Math.round(len / 2.7)),
        len,
      });
    }
  }
  return all.sort((p, q) => q.len - p.len).slice(0, 6);
}

export function TeaserScan() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [signupNudge, setSignupNudge] = useState(false);
  const [teaser, setTeaser] = useState<TeaserPayload | null>(null);
  const [step, setStep] = useState(0);
  // Pre-baked contractor-verified example (see example-scan-data.ts). Hidden
  // again the moment a real scan result lands — the visitor's own property wins.
  const [showExample, setShowExample] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  async function scan() {
    const addr = address.trim();
    if (addr.length < 8 || status === "loading") return;
    setStatus("loading");
    setError(null);
    setSignupNudge(false);
    setStep(0);
    stepTimer.current = setInterval(
      () => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)),
      1400,
    );
    try {
      localStorage.setItem(PENDING_SCAN_KEY, addr);
    } catch {
      // private mode — the signup link still carries the address
    }
    try {
      const res = await fetch("/api/teaser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; teaser?: TeaserPayload; reason?: string; signup?: boolean }
        | null;
      if (!res.ok || !body?.ok || !body.teaser) {
        setSignupNudge(!!body?.signup);
        throw new Error(body?.reason || "Couldn't scan that address — please try again.");
      }
      setTeaser(body.teaser);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Couldn't scan that address.");
    } finally {
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
    }
  }

  const signupHref = `/sign-up?utm_source=teaser${
    address.trim() ? `&address=${encodeURIComponent(address.trim())}` : ""
  }`;

  const corners = teaser ? teaser.runs.flatMap((r) => cornerPoints(r.points)) : [];
  const fenceRuns = teaser?.fence ?? [];
  const segTags = teaser ? lockedSegTags(fenceRuns) : [];

  // Choreography clock (seconds after the result mounts). Reduced motion
  // renders everything settled.
  const T = {
    boundary: reduceMotion ? 0 : 0.35,
    boundaryDur: reduceMotion ? 0 : 1.15,
    corners: reduceMotion ? 0 : 1.4,
    house: reduceMotion ? 0 : 1.55,
    fenceStart: reduceMotion ? 0 : 1.8,
    fenceEach: reduceMotion ? 0 : 0.5,
    fenceDur: reduceMotion ? 0 : 0.45,
  };
  const tagsAt = reduceMotion ? 0 : T.fenceStart + fenceRuns.length * T.fenceEach + 0.15;

  return (
    <div className="mt-10 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void scan();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="relative flex-1">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Type any US address — watch the fence line appear"
            autoComplete="street-address"
            className="ring-focus h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-accent-400 focus:bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading" || address.trim().length < 8}
          className="press-scale ring-focus inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-600 px-5 text-[14px] font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-60"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="h-4 w-4" />
          )}
          {status === "loading" ? SCAN_STEPS[step] : "Scan my property — free"}
        </button>
      </form>

      {status === "error" && (
        <p className="mt-3 text-sm text-red-600">
          {error}
          {signupNudge && (
            <>
              {" "}
              <Link href={signupHref} className="font-semibold text-accent-700 underline">
                Create a free account →
              </Link>
            </>
          )}
        </p>
      )}

      {status === "ready" && teaser && (
        <div className="anim-enter-fade mt-4">
          <div className="relative overflow-hidden rounded-2xl bg-zinc-900">
            <svg
              viewBox="0 0 900 580"
              className="block w-full"
              role="img"
              aria-label={`Satellite view of ${teaser.address} with the property line traced and a suggested fence layout`}
            >
              <defs>
                <filter id="teaser-glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="2.4" />
                </filter>
              </defs>
              <image
                href={teaser.image.dataUrl}
                x={0}
                y={0}
                width={900}
                height={580}
                preserveAspectRatio="xMidYMid slice"
              />

              {/* House footprint — the fence has something to tie into. */}
              {teaser.house && teaser.house.length >= 3 && (
                <motion.path
                  d={`${pathD(teaser.house)} Z`}
                  fill="rgba(255,255,255,0.07)"
                  stroke="#E4E4E7"
                  strokeWidth={1.4}
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                  initial={{ opacity: reduceMotion ? 0.85 : 0 }}
                  animate={{ opacity: 0.85 }}
                  transition={{ duration: 0.5, delay: T.house }}
                />
              )}

              {/* Property line — thin white cadastral line, cased so it
                  reads on any imagery (the app's boundary style). */}
              {teaser.runs.map((r) => {
                const d = pathD(r.points);
                return (
                  <g key={r.id}>
                    <motion.path
                      d={d}
                      fill="none"
                      stroke="#0B1220"
                      strokeOpacity={0.5}
                      strokeWidth={3.25}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      initial={{ pathLength: reduceMotion ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: T.boundaryDur, delay: T.boundary, ease: "easeInOut" }}
                    />
                    <motion.path
                      d={d}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeOpacity={0.95}
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      initial={{ pathLength: reduceMotion ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: T.boundaryDur, delay: T.boundary, ease: "easeInOut" }}
                    />
                  </g>
                );
              })}

              {/* Property corner pins. */}
              {corners.map((p, i) => (
                <motion.circle
                  key={`${p.x}-${p.y}-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={3.25}
                  fill="#fff"
                  stroke="#334155"
                  strokeWidth={1.5}
                  initial={{ opacity: reduceMotion ? 1 : 0, scale: reduceMotion ? 1 : 0.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.25, delay: T.corners + i * 0.03 }}
                />
              ))}

              {/* Fence build: green runs with posts popping along them —
                  boundary runs ride the property line, returns tie the
                  house in. */}
              {fenceRuns.map((run, i) => {
                const d = pathD(run.points);
                const start = T.fenceStart + i * T.fenceEach;
                const posts = walkPostPositions(run.points, 26);
                return (
                  <g key={run.id}>
                    <motion.path
                      d={d}
                      fill="none"
                      stroke="#052E16"
                      strokeOpacity={0.5}
                      strokeWidth={4.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      initial={{ pathLength: reduceMotion ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: T.fenceDur, delay: start, ease: "easeInOut" }}
                    />
                    <motion.path
                      d={d}
                      fill="none"
                      stroke="#4ADE80"
                      strokeWidth={2.25}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      initial={{ pathLength: reduceMotion ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: T.fenceDur, delay: start, ease: "easeInOut" }}
                    />
                    {posts.map((p, j) => (
                      <motion.circle
                        key={`${run.id}-post-${j}`}
                        cx={p.x}
                        cy={p.y}
                        r={2.4}
                        fill="#DCFCE7"
                        stroke="#15803D"
                        strokeWidth={1.4}
                        initial={{ opacity: reduceMotion ? 1 : 0, scale: reduceMotion ? 1 : 0.4 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: 0.2,
                          delay: start + (posts.length > 1 ? (j / (posts.length - 1)) * T.fenceDur : 0),
                        }}
                      />
                    ))}
                  </g>
                );
              })}

              {/* Scan comet riding the boundary as it draws. */}
              {!reduceMotion && teaser.runs[0] && (
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 1, 0] }}
                  transition={{
                    delay: T.boundary,
                    duration: T.boundaryDur + 0.2,
                    times: [0, 0.06, 0.88, 1],
                  }}
                >
                  <circle r={7.5} fill="#4ADE80" opacity={0.5} filter="url(#teaser-glow)" />
                  <circle r={2.75} fill="#F0FDF4" />
                  <animateMotion
                    dur={`${T.boundaryDur}s`}
                    begin={`${T.boundary}s`}
                    fill="freeze"
                    path={pathD(teaser.runs[0].points)}
                    calcMode="spline"
                    keyTimes="0;1"
                    keyPoints="0;1"
                    keySplines="0.42 0 0.58 1"
                  />
                </motion.g>
              )}
            </svg>

            {/* Locked measurement tags — the tease. Blurred stand-in
                footage; the real numbers are behind the free account. */}
            <div className="pointer-events-none absolute inset-0">
              {segTags.map((t, i) => (
                <div
                  key={t.key}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(t.x / 900) * 100}%`, top: `${(t.y / 580) * 100}%` }}
                >
                  <motion.div
                    className="flex items-center gap-1 rounded-full bg-zinc-950/80 py-1 pl-1.5 pr-2 shadow-sm backdrop-blur"
                    initial={{ opacity: reduceMotion ? 1 : 0, scale: reduceMotion ? 1 : 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: tagsAt + i * 0.09, ease: "easeOut" }}
                  >
                    <Lock className="h-3 w-3 text-emerald-300" aria-hidden />
                    <span
                      aria-hidden
                      className="select-none text-[11px] font-bold leading-none text-white"
                    >
                      <span className="inline-block blur-[3px]">{t.ft}</span> ft
                    </span>
                  </motion.div>
                </div>
              ))}
            </div>

            <div className="pointer-events-none absolute left-3 top-3 max-w-[85%] truncate rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-zinc-900 shadow-sm backdrop-blur">
              {teaser.address}
            </div>
            {teaser.parcelFound ? (
              <>
                <div className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-3 rounded-full bg-zinc-950/75 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm backdrop-blur sm:flex">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full bg-white" />
                    Property line
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full bg-[#4ADE80]" />
                    Fence
                  </span>
                  {teaser.house && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-0 w-4 border-t border-dashed border-zinc-300" />
                      House
                    </span>
                  )}
                </div>
                <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-zinc-950/75 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm backdrop-blur">
                  {teaser.sides} fence lines · {teaser.corners} corners
                  {teaser.acres != null ? ` · ${teaser.acres} acres` : ""}
                </div>
              </>
            ) : (
              <div className="absolute inset-x-3 bottom-3 rounded-xl bg-zinc-950/80 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-white shadow-sm backdrop-blur">
                Found the property — its boundary isn&apos;t published in the
                parcel database. Draw the line yourself in about 30 seconds
                with a free account.
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-zinc-600">
              {teaser.parcelFound ? (
                <>
                  That&apos;s your actual property line, with a suggested
                  fence layout —{" "}
                  <span className="font-semibold text-zinc-900">
                    {teaser.sides} runs, already measured
                  </span>
                  . Footage, materials and a send-ready proposal unlock with
                  a free account.
                </>
              ) : (
                <>
                  Your satellite photo is ready. Trace the fence on it, and
                  footage, materials and a send-ready proposal price
                  themselves.
                </>
              )}
            </p>
            <Link
              href={signupHref}
              className="press-scale ring-focus inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-zinc-900 px-5 text-[14px] font-semibold text-white transition-smooth hover:bg-zinc-800"
            >
              See my measurements
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Pre-baked example — a finished, contractor-verified scan the visitor
          can open without spending a teaser credit. A live result replaces it. */}
      {EXAMPLE_SCAN && status !== "ready" && !showExample && (
        <button
          type="button"
          onClick={() => setShowExample(true)}
          className="transition-smooth ring-focus group mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-accent-700 hover:text-accent-800"
        >
          <MapPin className="h-3.5 w-3.5" />
          No address handy? See a finished example — {EXAMPLE_SCAN.address}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
      )}
      {EXAMPLE_SCAN && status !== "ready" && showExample && (
        <ExampleScanPanel
          onScanYourOwn={() => inputRef.current?.focus()}
        />
      )}

      {status !== "ready" && (
        <p className="mt-3 text-xs text-zinc-400">
          Free · no card, no account needed for the preview · 2 scans a day
        </p>
      )}
    </div>
  );
}
