"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FileSignature,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Receipt,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sampleDownspouts, sampleEaves, sampleMeasurements } from "@/lib/mock-estimate";
import { sampleProposal } from "@/lib/proposal-mock";
import { ClientPortalView } from "@/components/client-portal/client-portal-view";

/**
 * Cinematic demo reel for the landing page. Walks the visitor through
 * the AI takeoff pipeline, then drops them straight into a working
 * preview of the client-portal proposal so they see EXACTLY what the
 * homeowner sees when a finished proposal is sent. No sign-up, no
 * API quota burned — the aerial is a styled SVG mock and the
 * proposal is the in-repo `sampleProposal` rendered through the real
 * `<ClientPortalView previewMode />` component.
 *
 * Phases:
 *   0  geocode    — 1.4s — locating the property
 *   1  aerial     — 1.6s — satellite fades in
 *   2  detect     — 3.2s — vision scan + eave LF labels draw on
 *   3  downspouts — 2.0s — markers drop into place
 *   4  estimate   — 2.0s — measurements + price count up
 *   5  compile    — 1.6s — proposal sections assemble
 *   6  proposal   — persistent — embedded ClientPortalView
 */

type Phase =
  | "geocode"
  | "aerial"
  | "detect"
  | "downspouts"
  | "estimate"
  | "compile"
  | "proposal";

const PHASE_ORDER: Phase[] = [
  "geocode",
  "aerial",
  "detect",
  "downspouts",
  "estimate",
  "compile",
  "proposal",
];

const PHASE_MS: Partial<Record<Phase, number>> = {
  geocode: 1400,
  aerial: 1600,
  detect: 3200,
  downspouts: 2000,
  estimate: 2000,
  compile: 1600,
};

export function DemoFlow({
  open,
  address,
  onClose,
}: {
  open: boolean;
  address: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase = PHASE_ORDER[phaseIndex];
  const inProposal = phase === "proposal";

  // Reset to first phase whenever opened.
  useEffect(() => {
    if (open) setPhaseIndex(0);
  }, [open]);

  // ESC + body lock.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Auto-advance.
  useEffect(() => {
    if (!open) return;
    if (phaseIndex >= PHASE_ORDER.length - 1) return;
    const ms = PHASE_MS[phase] ?? 1500;
    const t = setTimeout(() => setPhaseIndex((p) => p + 1), ms);
    return () => clearTimeout(t);
  }, [open, phaseIndex, phase]);

  // Customize the embedded proposal to use the visitor's typed
  // address so the demo feels personal, but keep everything else
  // (packages, totals, branding) from sampleProposal.
  const previewProposal = useMemo(
    () => ({
      ...sampleProposal,
      address: address || sampleProposal.address,
    }),
    [address],
  );

  function goSignUp() {
    const dest = `/estimate?address=${encodeURIComponent(address)}`;
    router.push(`/sign-in?next=${encodeURIComponent(dest)}`);
  }

  function skipToProposal() {
    setPhaseIndex(PHASE_ORDER.length - 1);
  }

  if (!open) return null;

  const pipelineProgress = Math.min(
    (phaseIndex + 1) / (PHASE_ORDER.length - 1),
    1,
  );

  return (
    <AnimatePresence>
      <motion.div
        key="demo-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/70 p-2 backdrop-blur-md sm:p-6"
        onClick={onClose}
      >
        <motion.div
          key="demo-card"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_25px_90px_-15px_rgba(0,0,0,0.55)] ring-1 ring-black/10 transition-[max-width,max-height,width,height] duration-500 ease-out",
            inProposal
              ? "h-[92vh] max-h-[860px] w-[95vw] max-w-[1200px]"
              : "h-[90vh] max-h-[640px] w-[92vw] max-w-[1080px]",
          )}
        >
          {/* Top bar */}
          <DemoTopBar
            address={address}
            phase={phase}
            phaseIndex={phaseIndex}
            inProposal={inProposal}
            onClose={onClose}
            onSkip={!inProposal ? skipToProposal : undefined}
          />

          {/* Progress hairline — full bar while pipelining, full
              accent bar while viewing proposal. */}
          <div className="relative h-0.5 w-full overflow-hidden bg-zinc-100">
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-stripe-blue via-stripe-violet to-stripe-coral"
              animate={{ width: `${(inProposal ? 1 : pipelineProgress) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>

          {/* Body — pipeline UI OR embedded proposal */}
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              {inProposal ? (
                <motion.div
                  key="proposal-stage"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45 }}
                  className="absolute inset-0 flex flex-col"
                >
                  <ProposalStage
                    proposal={previewProposal}
                    onSignUp={goSignUp}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="pipeline-stage"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 grid lg:grid-cols-[minmax(0,1fr)_340px]"
                >
                  <AerialStage phase={phase} />
                  <StatusPanel phase={phase} onSkip={skipToProposal} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top bar — small, premium-feeling header with "live" recording dot
// and either a "Skip to proposal" shortcut or a "Demo proposal" badge.
// ─────────────────────────────────────────────────────────────────────
function DemoTopBar({
  address,
  phase,
  phaseIndex,
  inProposal,
  onClose,
  onSkip,
}: {
  address: string;
  phase: Phase;
  phaseIndex: number;
  inProposal: boolean;
  onClose: () => void;
  onSkip?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-white/95 px-5 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-accent-600 text-white shadow-sm ring-1 ring-inset ring-accent-700">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {inProposal ? "Live proposal preview" : "Live AI takeoff"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-inset ring-rose-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
              Demo
            </span>
          </div>
          <div className="truncate text-sm font-medium text-zinc-900">
            {address}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {!inProposal && (
          <span className="hidden text-[11px] tabular-nums text-zinc-500 sm:inline">
            Step {Math.min(phaseIndex + 1, 5)} / 5 · {phaseLabel(phase)}
          </span>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="hidden rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 sm:inline-flex"
          >
            Skip to proposal
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close demo"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "geocode":
      return "Geocoding";
    case "aerial":
      return "Aerial";
    case "detect":
      return "Roof detection";
    case "downspouts":
      return "Downspouts";
    case "estimate":
      return "Pricing";
    case "compile":
      return "Compiling proposal";
    case "proposal":
      return "Proposal ready";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Aerial stage — styled satellite view + scan animation + house
// outline + eave LF pills + downspout markers + property summary.
// ─────────────────────────────────────────────────────────────────────
function AerialStage({ phase }: { phase: Phase }) {
  const VW = 900;
  const VH = 580;
  const ftPerPx = sampleMeasurements.eaveLF / sumPixelLength(sampleEaves);

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const aerialOn = phaseIdx >= PHASE_ORDER.indexOf("aerial");
  const detectOn = phaseIdx >= PHASE_ORDER.indexOf("detect");
  const dsOn = phaseIdx >= PHASE_ORDER.indexOf("downspouts");

  return (
    <div className="relative aspect-[900/580] w-full overflow-hidden bg-[#0b1220]">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="aerial-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f7a52" />
            <stop offset="100%" stopColor="#2e4a31" />
          </linearGradient>
          <pattern id="lawn-tex" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="rgba(0,0,0,0)" />
            <circle cx="1" cy="1" r="0.5" fill="rgba(255,255,255,0.05)" />
            <circle cx="4" cy="4" r="0.5" fill="rgba(0,0,0,0.06)" />
          </pattern>
          <linearGradient id="roof-shingles" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1f2937" />
          </linearGradient>
          <linearGradient id="garage-roof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#525252" />
            <stop offset="100%" stopColor="#262626" />
          </linearGradient>
          <linearGradient id="porch-roof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6b7280" />
            <stop offset="100%" stopColor="#374151" />
          </linearGradient>
          <linearGradient id="driveway" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a8a29e" />
            <stop offset="100%" stopColor="#57534e" />
          </linearGradient>
          <radialGradient id="tree-canopy" cx="0.4" cy="0.4">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#14532d" />
          </radialGradient>
          <linearGradient id="scan-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(67,83,255,0)" />
            <stop offset="100%" stopColor="rgba(67,83,255,0.4)" />
          </linearGradient>
          <filter id="aerial-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
            <feOffset dx="0" dy="6" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.5" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Loading base */}
        <rect width={VW} height={VH} fill="#0b1220" />
        {!aerialOn && (
          <>
            {/* Faint grid + crosshair as "locating" backdrop */}
            <g opacity="0.25">
              {Array.from({ length: 20 }, (_, i) => (
                <line
                  key={`gx-${i}`}
                  x1={i * 50}
                  y1={0}
                  x2={i * 50}
                  y2={VH}
                  stroke="rgba(67,83,255,0.22)"
                  strokeWidth="0.5"
                />
              ))}
              {Array.from({ length: 13 }, (_, i) => (
                <line
                  key={`gy-${i}`}
                  x1={0}
                  y1={i * 50}
                  x2={VW}
                  y2={i * 50}
                  stroke="rgba(67,83,255,0.22)"
                  strokeWidth="0.5"
                />
              ))}
            </g>
            <motion.g
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            >
              <circle
                cx={VW / 2}
                cy={VH / 2}
                r="48"
                fill="none"
                stroke="rgba(67,83,255,0.5)"
                strokeWidth="1.5"
              />
              <circle cx={VW / 2} cy={VH / 2} r="6" fill="#4353ff" />
            </motion.g>
            <text
              x={VW / 2}
              y={VH / 2 + 90}
              textAnchor="middle"
              fontSize="16"
              fontFamily="ui-sans-serif, system-ui"
              fill="rgba(255,255,255,0.7)"
              letterSpacing="2"
            >
              LOCATING PROPERTY
            </text>
          </>
        )}

        {/* Aerial fade-in */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: aerialOn ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          <rect width={VW} height={VH} fill="url(#aerial-bg)" />
          <rect width={VW} height={VH} fill="url(#lawn-tex)" />

          {/* Driveway */}
          <polygon
            points={`130,${VH} 230,${VH} 320,290 250,290`}
            fill="url(#driveway)"
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
          <rect x="0" y={VH - 38} width={VW} height="10" fill="#9ca3af" opacity="0.55" />

          {/* House — main roof */}
          <g filter="url(#aerial-shadow)">
            <rect x="220" y="240" width="360" height="140" fill="url(#roof-shingles)" />
            <line x1="220" y1="310" x2="580" y2="310" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" />
            {Array.from({ length: 14 }, (_, i) => (
              <line
                key={`shingle-row-${i}`}
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
          <g filter="url(#aerial-shadow)">
            <rect x="580" y="280" width="140" height="80" fill="url(#garage-roof)" />
            <line x1="580" y1="320" x2="720" y2="320" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
            {Array.from({ length: 8 }, (_, i) => (
              <line
                key={`garage-row-${i}`}
                x1="582"
                y1={284 + i * 10}
                x2="718"
                y2={284 + i * 10}
                stroke="rgba(0,0,0,0.18)"
                strokeWidth="0.4"
              />
            ))}
          </g>

          {/* Porch */}
          <g filter="url(#aerial-shadow)">
            <rect x="320" y="200" width="160" height="40" fill="url(#porch-roof)" />
            {Array.from({ length: 4 }, (_, i) => (
              <line
                key={`porch-row-${i}`}
                x1="322"
                y1={204 + i * 10}
                x2="478"
                y2={204 + i * 10}
                stroke="rgba(0,0,0,0.2)"
                strokeWidth="0.4"
              />
            ))}
          </g>

          {/* Trees */}
          {[
            { cx: 95, cy: 120, r: 50 },
            { cx: 760, cy: 150, r: 42 },
            { cx: 820, cy: 480, r: 56 },
            { cx: 80, cy: 460, r: 38 },
            { cx: 770, cy: 60, r: 28 },
          ].map((t, i) => (
            <g key={`tree-${i}`}>
              <circle cx={t.cx + 3} cy={t.cy + 5} r={t.r} fill="rgba(0,0,0,0.35)" />
              <circle cx={t.cx} cy={t.cy} r={t.r} fill="url(#tree-canopy)" opacity="0.95" />
            </g>
          ))}

          {/* Pool */}
          <rect x="640" y="430" width="90" height="60" rx="6" fill="#0ea5e9" opacity="0.85" />
          <rect x="640" y="430" width="90" height="60" rx="6" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
        </motion.g>

        {/* Bounding box around the property — appears at detect phase */}
        {detectOn && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <rect
              x="208"
              y="188"
              width="524"
              height="204"
              fill="none"
              stroke="rgba(67,83,255,0.8)"
              strokeWidth="1.4"
              strokeDasharray="6 6"
              rx="4"
            />
            <rect
              x="208"
              y="170"
              width="160"
              height="18"
              fill="rgba(67,83,255,0.95)"
              rx="2"
            />
            <text
              x="216"
              y="184"
              fontSize="11"
              fontWeight="700"
              fill="#ffffff"
              fontFamily="ui-sans-serif, system-ui"
            >
              ROOF DETECTED · 98%
            </text>
          </motion.g>
        )}

        {/* Scan-line sweep */}
        {phase === "detect" && (
          <>
            <motion.rect
              x="0"
              width={VW}
              height="3"
              fill="rgba(67,83,255,0.9)"
              initial={{ y: 100 }}
              animate={{ y: VH - 100 }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
            <motion.rect
              x="0"
              width={VW}
              height="60"
              fill="url(#scan-glow)"
              initial={{ y: 60, opacity: 0.7 }}
              animate={{ y: VH - 160, opacity: 0 }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
          </>
        )}

        {/* Detected eaves draw on */}
        {detectOn &&
          sampleEaves.map((eave, i) => {
            const [a, b] = eave.points;
            const lengthPx = Math.hypot(b.x - a.x, b.y - a.y);
            const lengthFt = Math.round(lengthPx * ftPerPx);
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            return (
              <g key={eave.id}>
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
                  transition={{ duration: 0.5, delay: 0.4 + i * 0.28 }}
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
                    pathLength: { duration: 0.5, delay: 0.4 + i * 0.28 },
                    opacity: { duration: 0.15, delay: 0.4 + i * 0.28 },
                  }}
                />
                <motion.g
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 + i * 0.28, duration: 0.3 }}
                >
                  <rect
                    x={midX - 24}
                    y={midY - 11}
                    width="48"
                    height="20"
                    rx="10"
                    fill="rgba(15,23,42,0.94)"
                    stroke="#4353ff"
                    strokeWidth="1"
                  />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    fontSize="11"
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

        {/* Downspout markers */}
        {dsOn &&
          sampleDownspouts.map((ds, i) => (
            <motion.g
              key={ds.id}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: i * 0.18,
                duration: 0.45,
                type: "spring",
                stiffness: 240,
                damping: 17,
              }}
            >
              <circle cx={ds.x} cy={ds.y} r="18" fill="rgba(248,113,126,0.28)" />
              <circle
                cx={ds.x}
                cy={ds.y}
                r="11"
                fill="#f8717e"
                stroke="white"
                strokeWidth="2.5"
              />
              <text
                x={ds.x}
                y={ds.y + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight="800"
                fill="white"
                fontFamily="ui-sans-serif, system-ui"
              >
                {i + 1}
              </text>
            </motion.g>
          ))}
      </svg>

      {/* Floating UI overlay — feels like a real internal tool */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        {detectOn && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-semibold text-accent-200 ring-1 ring-inset ring-accent-500/40 backdrop-blur"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stripe-blue" />
            AI vision · 98% confidence
          </motion.div>
        )}
        <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900/70 text-[10px] font-bold text-white ring-1 ring-white/20">
          N↑
        </div>
      </div>

      {/* Scale bar */}
      {aerialOn && (
        <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-md bg-zinc-900/75 px-2 py-1 text-[10px] font-semibold text-white ring-1 ring-white/15 backdrop-blur">
          <div className="h-0.5 w-10 bg-white" />
          20 ft
        </div>
      )}

      {/* "Aerial source" tag */}
      {aerialOn && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-zinc-900/75 px-2 py-1 text-[10px] font-medium text-white/80 ring-1 ring-white/15 backdrop-blur">
          Imagery · Google Solar API
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Status panel — pipeline checklist + computed measurements + total.
// ─────────────────────────────────────────────────────────────────────
function StatusPanel({
  phase,
  onSkip,
}: {
  phase: Phase;
  onSkip: () => void;
}) {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const steps = useMemo(
    () => [
      { id: "geocode" as Phase, label: "Geocoding address", detail: "Resolving lat/lng" },
      { id: "aerial" as Phase, label: "Pulling aerial imagery", detail: "High-res satellite" },
      { id: "detect" as Phase, label: "Detecting roof edges", detail: "Vision segmentation" },
      { id: "downspouts" as Phase, label: "Placing downspouts", detail: "Drainage optimization" },
      { id: "estimate" as Phase, label: "Pricing the takeoff", detail: "Materials + labor + waste" },
      { id: "compile" as Phase, label: "Compiling proposal", detail: "Cover + packages + terms" },
    ],
    [],
  );

  const showEstimate = phaseIdx >= PHASE_ORDER.indexOf("estimate");
  const showCompile = phaseIdx >= PHASE_ORDER.indexOf("compile");

  return (
    <aside className="flex flex-col gap-3 overflow-y-auto border-t border-zinc-100 bg-zinc-50/70 p-5 lg:border-l lg:border-t-0">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          AI pipeline
        </div>
        <ul className="mt-3 space-y-1.5">
          {steps.map((s) => {
            const idx = PHASE_ORDER.indexOf(s.id);
            const state =
              phaseIdx > idx ? "done" : phaseIdx === idx ? "active" : "pending";
            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
                  state === "active" && "bg-white shadow-sm ring-1 ring-zinc-200",
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  {state === "done" && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-200">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  {state === "active" && (
                    <Loader2 className="h-4 w-4 animate-spin text-accent-600" />
                  )}
                  {state === "pending" && (
                    <span className="h-2 w-2 rounded-full bg-zinc-300" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm",
                      state === "active"
                        ? "font-semibold text-zinc-900"
                        : state === "done"
                          ? "text-zinc-700"
                          : "text-zinc-400",
                    )}
                  >
                    {s.label}
                  </div>
                  <div
                    className={cn(
                      "text-[11px]",
                      state === "pending" ? "text-zinc-300" : "text-zinc-500",
                    )}
                  >
                    {s.detail}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <AnimatePresence>
        {showEstimate && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Takeoff measurements
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <Row label="Eave LF" value={`${sampleMeasurements.eaveLF}′`} />
              <Row label="Rake LF" value={`${sampleMeasurements.rakeLF}′`} />
              <Row label="Downspouts" value={`${sampleMeasurements.downspoutCount}`} />
              <Row
                label="Corners"
                value={`${sampleMeasurements.outsideCorners + sampleMeasurements.insideCorners}`}
              />
              <Row label="Stories" value={`${sampleMeasurements.stories}`} />
              <Row label="Waste" value={`${sampleMeasurements.wasteFactorPct}%`} />
            </dl>
            <div className="mt-3 rounded-lg bg-accent-50 p-3 ring-1 ring-inset ring-accent-200">
              <div className="font-label text-[10px] text-accent-700">
                Pro Shield total
              </div>
              <CountUp
                from={0}
                to={4280}
                durationMs={1100}
                className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900"
                prefix="$"
              />
              <div className="text-[11px] text-zinc-500">
                Materials + labor + 8% waste · 30-day lock
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Compiling" sub-checklist — only visible during the compile
          phase so the visitor sees the proposal coming together. */}
      <AnimatePresence>
        {showCompile && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Assembling proposal
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
              {[
                { icon: FileSignature, label: "Cover" },
                { icon: ImageIcon, label: "Aerial" },
                { icon: Layers, label: "Packages" },
                { icon: Receipt, label: "Pricing" },
                { icon: Wallet, label: "Deposit" },
                { icon: Check, label: "Terms" },
              ].map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + i * 0.12 }}
                  className="flex items-center gap-1.5 rounded-md bg-accent-50 px-2 py-1 text-accent-700 ring-1 ring-inset ring-accent-200"
                >
                  <s.icon className="h-3 w-3" />
                  {s.label}
                </motion.div>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Skip to finished proposal
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums text-zinc-900">{value}</span>
    </div>
  );
}

/**
 * Final phase — actual ClientPortalView rendered as the homeowner
 * would see it, in a scrollable container. The sticky bottom bar
 * carries the conversion CTAs.
 */
function ProposalStage({
  proposal,
  onSignUp,
}: {
  proposal: typeof sampleProposal;
  onSignUp: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      {/* Document banner */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <Check className="h-3 w-3" />
            Proposal ready
          </span>
          <span className="hidden sm:inline">
            This is exactly what the homeowner sees when you click Send.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50"
        >
          {fullscreen ? (
            <>
              <Minimize2 className="h-3 w-3" /> Exit fullscreen
            </>
          ) : (
            <>
              <Maximize2 className="h-3 w-3" /> Expand
            </>
          )}
        </button>
      </div>

      {/* Scrollable proposal — uses the real ClientPortalView with
          previewMode so accept flow is neutralized. */}
      <div
        className={cn(
          "relative flex-1 overflow-y-auto bg-zinc-100",
          fullscreen && "absolute inset-0 z-[70]",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-zinc-100 to-transparent" />
        <ClientPortalView proposal={proposal} previewMode />
      </div>

      {/* Sticky conversion CTA */}
      <div className="border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-zinc-600">
            Like what you see?{" "}
            <span className="font-semibold text-zinc-900">
              Generate one for YOUR address —
            </span>{" "}
            ready to send in 60 seconds.
          </div>
          <button
            type="button"
            onClick={onSignUp}
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700"
          >
            <Sparkles className="h-4 w-4" />
            Start free — no credit card
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CountUp({
  from,
  to,
  durationMs,
  className,
  prefix = "",
}: {
  from: number;
  to: number;
  durationMs: number;
  className?: string;
  prefix?: string;
}) {
  const [val, setVal] = useState(from);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    function tick(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, durationMs]);
  return (
    <div className={className}>
      {prefix}
      {val.toLocaleString()}
    </div>
  );
}

function sumPixelLength(lines: typeof sampleEaves): number {
  let total = 0;
  for (const l of lines) {
    const [a, b] = l.points;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
