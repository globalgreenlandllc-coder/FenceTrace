"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Loader2,
  MapPin,
  Play,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sampleDownspouts,
  sampleEaves,
  sampleMeasurements,
} from "@/lib/mock-estimate";

/**
 * Compact, always-on aerial preview that lives in the hero. Loops
 * continuously through the AI takeoff pipeline so the visitor sees
 * the product working before they decide to click Estimate. Clicking
 * the panel opens the full DemoFlow modal.
 *
 * The animation is one tight cycle:
 *   1.0s  locating       — dark + radar pulse
 *   1.8s  aerial         — fades in
 *   3.0s  detect         — scan sweep + eave lines draw on
 *   2.2s  downspouts     — markers drop into place
 *   3.0s  estimate       — totals card slides up, holds
 *   1.0s  fade           — soft reset
 * = 12 seconds per cycle.
 */
const CYCLE_MS = 12000;

type Phase = "load" | "aerial" | "detect" | "ds" | "estimate";

function phaseAt(elapsed: number): Phase {
  if (elapsed < 1000) return "load";
  if (elapsed < 2800) return "aerial";
  if (elapsed < 5800) return "detect";
  if (elapsed < 8000) return "ds";
  return "estimate";
}

export function MiniDemo({ onOpenFullDemo }: { onOpenFullDemo: () => void }) {
  // We tick once per frame and derive the phase from elapsed time,
  // not from a setInterval counter, so the animation reads smoothly
  // even if the tab was backgrounded.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    function tick(ts: number) {
      const dt = ts - start;
      setElapsed(dt % CYCLE_MS);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = phaseAt(elapsed);
  const aerialOn = phase !== "load";
  const detectOn = phase === "detect" || phase === "ds" || phase === "estimate";
  const dsOn = phase === "ds" || phase === "estimate";
  const totalsOn = phase === "estimate";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
      className="relative"
    >
      <button
        type="button"
        onClick={onOpenFullDemo}
        aria-label="Open full demo"
        className="group relative block w-full overflow-hidden rounded-xl bg-ink text-left ring-1 ring-black/10 transition hover:ring-accent-500/40"
      >
        {/* Chrome bar — feels like a real app window */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-ink px-4 py-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-600 text-white">
              <Sparkles className="h-3 w-3" />
            </span>
            <span className="font-label text-[11px] text-white/80">
              Live AI takeoff
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
              REC
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
          </div>
        </div>

        {/* Aerial canvas */}
        <div className="relative aspect-[16/11] w-full bg-[#0b1220]">
          <AerialSvg
            phase={phase}
            aerialOn={aerialOn}
            detectOn={detectOn}
            dsOn={dsOn}
            elapsed={elapsed}
          />

          {/* Status pill overlay (top-left) */}
          <div className="pointer-events-none absolute left-3 top-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent-200 ring-1 ring-inset ring-accent-500/40 backdrop-blur"
              >
                {phase === "load" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Geocoding
                  </>
                )}
                {phase === "aerial" && (
                  <>
                    <MapPin className="h-3 w-3" />
                    Fetching aerial
                  </>
                )}
                {phase === "detect" && (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stripe-blue" />
                    Detecting roof · 98%
                  </>
                )}
                {phase === "ds" && (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stripe-coral" />
                    Placing downspouts
                  </>
                )}
                {phase === "estimate" && (
                  <>
                    <Check className="h-3 w-3" />
                    Takeoff complete
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* North arrow */}
          <div className="pointer-events-none absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/70 text-[9px] font-bold text-white ring-1 ring-white/15">
            N↑
          </div>

          {/* Scale bar */}
          {aerialOn && (
            <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-zinc-900/75 px-1.5 py-0.5 text-[9px] font-semibold text-white ring-1 ring-white/15 backdrop-blur">
              <div className="h-0.5 w-7 bg-white" />
              20 ft
            </div>
          )}

          {/* Totals overlay (bottom-right) */}
          <AnimatePresence>
            {totalsOn && (
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute bottom-3 right-3 w-[220px] rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-elevated backdrop-blur"
              >
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
                  <span className="text-zinc-500">Estimate</span>
                  <span className="inline-flex items-center gap-1 text-accent-700">
                    <TrendingUp className="h-3 w-3" />
                    Pro Shield
                  </span>
                </div>
                <div className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">
                  $4,280
                </div>
                <dl className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
                  <Stat label="Eave" value={`${sampleMeasurements.eaveLF}′`} />
                  <Stat label="Rake" value={`${sampleMeasurements.rakeLF}′`} />
                  <Stat
                    label="Down"
                    value={`${sampleMeasurements.downspoutCount}`}
                  />
                </dl>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Click-to-play affordance */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/0 transition group-hover:bg-zinc-950/30">
            <span className="flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-xs font-semibold text-zinc-900 opacity-0 shadow-lg transition group-hover:opacity-100">
              <Play className="h-3.5 w-3.5 fill-current" />
              Open full demo
            </span>
          </div>
        </div>

        {/* Footer caption */}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-ink px-4 py-2 text-[11px] text-white/60">
          <span>
            Sample property ·{" "}
            <span className="text-white/85">1247 Maple Ridge Dr</span>
          </span>
          <span className="hidden sm:inline">Looping live · click to play</span>
        </div>
      </button>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-zinc-100 px-1.5 py-1 text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="text-[11px] font-semibold tabular-nums text-zinc-900">
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Aerial scene — same shapes as the big DemoFlow aerial, scaled to
// fit the mini-demo viewport. Drawn once, with motion overlays for
// the scan sweep, eave detection, and downspout placement.
// ─────────────────────────────────────────────────────────────────────
function AerialSvg({
  phase,
  aerialOn,
  detectOn,
  dsOn,
  elapsed,
}: {
  phase: Phase;
  aerialOn: boolean;
  detectOn: boolean;
  dsOn: boolean;
  elapsed: number;
}) {
  const VW = 900;
  const VH = 620;
  const ftPerPx = sampleMeasurements.eaveLF / sumPixelLength();

  // Detect-phase progress drives the scan sweep position so the
  // line moves smoothly with elapsed time.
  const detectStart = 2800;
  const detectEnd = 5800;
  const detectT = Math.max(
    0,
    Math.min(1, (elapsed - detectStart) / (detectEnd - detectStart)),
  );

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="md-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f7a52" />
          <stop offset="100%" stopColor="#2e4a31" />
        </linearGradient>
        <pattern id="md-lawn" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" fill="rgba(255,255,255,0.05)" />
          <circle cx="4" cy="4" r="0.5" fill="rgba(0,0,0,0.06)" />
        </pattern>
        <linearGradient id="md-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1f2937" />
        </linearGradient>
        <linearGradient id="md-garage" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#525252" />
          <stop offset="100%" stopColor="#262626" />
        </linearGradient>
        <linearGradient id="md-porch" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b7280" />
          <stop offset="100%" stopColor="#374151" />
        </linearGradient>
        <linearGradient id="md-drive" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8a29e" />
          <stop offset="100%" stopColor="#57534e" />
        </linearGradient>
        <radialGradient id="md-tree" cx="0.4" cy="0.4">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#14532d" />
        </radialGradient>
        <linearGradient id="md-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(67,83,255,0)" />
          <stop offset="100%" stopColor="rgba(67,83,255,0.45)" />
        </linearGradient>
        <filter id="md-shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dx="0" dy="5" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={VW} height={VH} fill="#0b1220" />

      {/* Loading state — pulsing radar */}
      {!aerialOn && (
        <>
          <g opacity="0.22">
            {Array.from({ length: 20 }, (_, i) => (
              <line
                key={`gx-${i}`}
                x1={i * 50}
                y1={0}
                x2={i * 50}
                y2={VH}
                stroke="rgba(67,83,255,0.25)"
                strokeWidth="0.5"
              />
            ))}
            {Array.from({ length: 14 }, (_, i) => (
              <line
                key={`gy-${i}`}
                x1={0}
                y1={i * 50}
                x2={VW}
                y2={i * 50}
                stroke="rgba(67,83,255,0.25)"
                strokeWidth="0.5"
              />
            ))}
          </g>
          <motion.g
            animate={{ scale: [1, 1.15, 1] }}
            transition={{
              duration: 1.0,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <circle
              cx={VW / 2}
              cy={VH / 2}
              r="40"
              fill="none"
              stroke="rgba(67,83,255,0.55)"
              strokeWidth="1.5"
            />
            <circle cx={VW / 2} cy={VH / 2} r="5" fill="#4353ff" />
          </motion.g>
        </>
      )}

      {/* Aerial */}
      <motion.g
        animate={{ opacity: aerialOn ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      >
        <rect width={VW} height={VH} fill="url(#md-bg)" />
        <rect width={VW} height={VH} fill="url(#md-lawn)" />

        {/* Driveway */}
        <polygon
          points={`130,${VH} 230,${VH} 320,290 250,290`}
          fill="url(#md-drive)"
        />
        <line
          x1="180"
          y1={VH}
          x2="285"
          y2="295"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          strokeDasharray="6 8"
        />

        {/* Sidewalk */}
        <rect
          x="0"
          y={VH - 38}
          width={VW}
          height="10"
          fill="#9ca3af"
          opacity="0.5"
        />

        {/* House */}
        <g filter="url(#md-shadow)">
          <rect x="220" y="240" width="360" height="140" fill="url(#md-roof)" />
          <line
            x1="220"
            y1="310"
            x2="580"
            y2="310"
            stroke="rgba(0,0,0,0.5)"
            strokeWidth="1.2"
          />
          {Array.from({ length: 14 }, (_, i) => (
            <line
              key={`md-sh-${i}`}
              x1="222"
              y1={244 + i * 10}
              x2="578"
              y2={244 + i * 10}
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="0.5"
            />
          ))}
        </g>

        {/* Garage */}
        <g filter="url(#md-shadow)">
          <rect x="580" y="280" width="140" height="80" fill="url(#md-garage)" />
          <line
            x1="580"
            y1="320"
            x2="720"
            y2="320"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth="1"
          />
        </g>

        {/* Porch */}
        <g filter="url(#md-shadow)">
          <rect x="320" y="200" width="160" height="40" fill="url(#md-porch)" />
        </g>

        {/* Trees */}
        {[
          { cx: 95, cy: 120, r: 50 },
          { cx: 770, cy: 150, r: 40 },
          { cx: 820, cy: 500, r: 56 },
          { cx: 80, cy: 470, r: 38 },
        ].map((t, i) => (
          <g key={`md-tree-${i}`}>
            <circle cx={t.cx + 3} cy={t.cy + 5} r={t.r} fill="rgba(0,0,0,0.35)" />
            <circle cx={t.cx} cy={t.cy} r={t.r} fill="url(#md-tree)" opacity="0.95" />
          </g>
        ))}

        {/* Pool */}
        <rect x="640" y="430" width="90" height="60" rx="6" fill="#0ea5e9" opacity="0.85" />
        <rect
          x="640"
          y="430"
          width="90"
          height="60"
          rx="6"
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1"
        />
      </motion.g>

      {/* Bounding box (detect+) */}
      {detectOn && (
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        >
          <rect
            x="208"
            y="188"
            width="524"
            height="204"
            fill="none"
            stroke="rgba(67,83,255,0.8)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            rx="4"
          />
        </motion.g>
      )}

      {/* Scan sweep — time-driven so the line tracks elapsed */}
      {phase === "detect" && (
        <>
          <rect
            x="0"
            width={VW}
            height="3"
            fill="rgba(67,83,255,0.9)"
            y={100 + (VH - 200) * detectT}
          />
          <rect
            x="0"
            width={VW}
            height="60"
            fill="url(#md-scan)"
            y={60 + (VH - 220) * detectT}
            opacity={Math.max(0, 0.7 * (1 - detectT))}
          />
        </>
      )}

      {/* Eave segments — drawn during detect+ */}
      {detectOn &&
        sampleEaves.map((eave, i) => {
          const [a, b] = eave.points;
          const lengthPx = Math.hypot(b.x - a.x, b.y - a.y);
          const lengthFt = Math.round(lengthPx * ftPerPx);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          // Stagger: each eave starts at progressive moments during the
          // detect-phase window so they trace in sequentially.
          const delaySec = 0.2 + i * 0.32;
          return (
            <g key={`md-${eave.id}`}>
              <motion.line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#4353ff"
                strokeWidth="9"
                strokeLinecap="round"
                opacity="0.25"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: delaySec }}
              />
              <motion.line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#4353ff"
                strokeWidth="3.5"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  pathLength: { duration: 0.5, delay: delaySec },
                  opacity: { duration: 0.15, delay: delaySec },
                }}
              />
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: delaySec + 0.2 }}
              >
                <rect
                  x={midX - 22}
                  y={midY - 10}
                  width="44"
                  height="18"
                  rx="9"
                  fill="rgba(15,23,42,0.94)"
                  stroke="#4353ff"
                  strokeWidth="1"
                />
                <text
                  x={midX}
                  y={midY + 3}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#c7d0ff"
                  fontFamily="ui-sans-serif, system-ui"
                >
                  {lengthFt} LF
                </text>
              </motion.g>
            </g>
          );
        })}

      {/* Downspouts */}
      {dsOn &&
        sampleDownspouts.map((ds, i) => (
          <motion.g
            key={`md-${ds.id}`}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: i * 0.13,
              duration: 0.4,
              type: "spring",
              stiffness: 240,
              damping: 17,
            }}
          >
            <circle cx={ds.x} cy={ds.y} r="16" fill="rgba(248,113,126,0.3)" />
            <circle
              cx={ds.x}
              cy={ds.y}
              r="10"
              fill="#f8717e"
              stroke="white"
              strokeWidth="2.5"
            />
            <text
              x={ds.x}
              y={ds.y + 3.5}
              textAnchor="middle"
              fontSize="10"
              fontWeight="800"
              fill="white"
              fontFamily="ui-sans-serif, system-ui"
            >
              {i + 1}
            </text>
          </motion.g>
        ))}
    </svg>
  );
}

function sumPixelLength(): number {
  let total = 0;
  for (const l of sampleEaves) {
    const [a, b] = l.points;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
