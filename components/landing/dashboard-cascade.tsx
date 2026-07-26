"use client";

import { motion } from "framer-motion";
import {
  Check,
  CreditCard,
  Lock,
  Ruler,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

/**
 * Hero showcase: four product surfaces stacked in a tilted cascade,
 * showing the full address-to-deposit journey in one glance.
 *
 *   1. Magic Roof  (back-left, deepest layer) — real aerial photo with
 *      animated neon eaves + LF tooltips
 *   2. Data Card   (middle, overlaps roof to the right) — dark glass
 *      panel with measurement breakdown + AI confidence
 *   3. Proposal    (right-back, peeks out behind the phone) — Good /
 *      Better / Best packages
 *   4. Phone       (right foreground) — iPhone mockup with the "Accept &
 *      Pay" CTA + Stripe notification
 */
export function DashboardCascade() {
  return (
    <section className="relative isolate overflow-hidden bg-ink py-24 sm:py-32">
      {/* Backdrop: subtle radial glow + scan grid */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(67,83,255,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(157,92,246,0.12),transparent_50%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(67,83,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(67,83,255,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Hyperline stripe bands at the section edges */}
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 left-0 -z-10 hidden w-14 opacity-80 lg:block xl:w-20"
      />
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 right-0 -z-10 hidden w-14 opacity-80 lg:block xl:w-20"
      />

      <div className="mx-auto max-w-7xl px-4 text-center">
        <span className="font-label inline-flex items-center gap-1.5 rounded-md border border-white/25 px-2.5 py-1 text-white">
          <Sparkles className="h-3 w-3" />
          One workflow, address to deposit
        </span>
        <h2 className="display-hero mt-6 text-balance text-4xl text-white sm:text-5xl md:text-6xl">
          From <span className="text-gradient">aerial measurement</span> to{" "}
          <span className="text-gradient">paid invoice</span> in one tab.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-zinc-400">
          The AI sizes the roof, the proposal builder packages it three ways,
          and the homeowner pays from their phone. You never leave the app.
        </p>
      </div>

      <div
        className="relative mx-auto mt-16 max-w-7xl px-4"
        style={{ perspective: "2000px" }}
      >
        <div className="relative h-[680px] sm:h-[720px]">
          <MagicRoofCard />
          <DataCard />
          <ProposalCard />
          <PhoneCard />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*               1. MAGIC ROOF — back-left, deepest layer             */
/* ------------------------------------------------------------------ */

function MagicRoofCard() {
  // Eaves traced over the stylized vector roof in StylizedRoof below.
  // Coords are in viewBox 800×500 — match exactly the panels drawn there.
  const eaves: { d: string; lf: number; labelX: number; labelY: number }[] = [
    { d: "M 230 145 H 510", lf: 42, labelX: 370, labelY: 128 },
    { d: "M 230 315 H 490", lf: 44, labelX: 360, labelY: 333 },
    { d: "M 510 175 H 660", lf: 18, labelX: 585, labelY: 158 },
    { d: "M 510 285 H 660", lf: 20, labelX: 585, labelY: 303 },
    { d: "M 280 380 H 440", lf: 24, labelX: 360, labelY: 397 },
  ];
  const downspouts = [
    { x: 230, y: 145 },
    { x: 510, y: 145 },
    { x: 230, y: 315 },
    { x: 660, y: 285 },
    { x: 440, y: 380 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: -30, rotate: -4 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="absolute left-0 top-2 w-[88%] max-w-[560px] sm:left-2 lg:w-[520px]"
      style={{
        transform: "rotateY(14deg) rotateX(2deg) rotate(-3deg)",
        transformStyle: "preserve-3d",
      }}
    >
      <div className="overflow-hidden rounded-2xl border border-accent-500/25 bg-ink shadow-[0_40px_80px_-20px_rgba(67,83,255,0.3),0_30px_60px_-20px_rgba(0,0,0,0.7)]">
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-accent-500/20 bg-ink px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] text-accent-200">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-stripe-blue shadow-[0_0_6px_rgba(67,83,255,0.95)]" />
            <span className="font-mono">live takeoff · 6232 97th Dr NE</span>
          </div>
          <span className="font-mono text-[10px] text-accent-200/70">
            schematic · 1:240
          </span>
        </div>

        {/* Stylized vector roof + neon overlay */}
        <div className="relative aspect-[16/10] overflow-hidden bg-ink">
          <StylizedRoof />

          <svg
            viewBox="0 0 800 500"
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            {/* Eaves: wide-soft halo + crisp inner stroke */}
            {eaves.map((e, i) => (
              <g key={e.d}>
                <motion.path
                  d={e.d}
                  stroke="#4353ff"
                  strokeWidth="10"
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.35}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{
                    duration: 1.0,
                    delay: 0.3 + i * 0.15,
                    ease: "easeOut",
                  }}
                />
                <motion.path
                  d={e.d}
                  stroke="#a3b1ff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{
                    duration: 1.0,
                    delay: 0.3 + i * 0.15,
                    ease: "easeOut",
                  }}
                />
                {/* LF tooltip */}
                <motion.g
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    delay: 1.0 + i * 0.15,
                    type: "spring",
                    stiffness: 220,
                    damping: 14,
                  }}
                >
                  <rect
                    x={e.labelX - 26}
                    y={e.labelY - 12}
                    width={52}
                    height={20}
                    rx={4}
                    fill="rgba(13,13,18,0.88)"
                    stroke="#4353ff"
                    strokeWidth={1}
                  />
                  <text
                    x={e.labelX}
                    y={e.labelY + 2}
                    textAnchor="middle"
                    fill="#c7d0ff"
                    fontSize="11"
                    fontWeight={600}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {e.lf} LF
                  </text>
                </motion.g>
              </g>
            ))}

            {/* Downspouts: pulsing magenta */}
            {downspouts.map((d, i) => (
              <g key={`ds-${i}`}>
                <motion.circle
                  cx={d.x}
                  cy={d.y}
                  r={14}
                  fill="#f8717e"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{
                    scale: [0.7, 1.3, 0.9],
                    opacity: [0, 0.4, 0.18],
                  }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1.4 + i * 0.12,
                  }}
                />
                <motion.g
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: 1.4 + i * 0.1,
                    type: "spring",
                    stiffness: 240,
                  }}
                >
                  <circle cx={d.x} cy={d.y} r="6" fill="#f8717e" />
                  <circle cx={d.x} cy={d.y} r="2.4" fill="#fff1f2" />
                </motion.g>
              </g>
            ))}
          </svg>

          {/* Bottom legend */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[9px] text-accent-200/80">
            <div className="flex items-center gap-2 rounded-full border border-accent-500/40 bg-ink/80 px-2 py-0.5 backdrop-blur">
              <span className="h-1.5 w-3 rounded-full bg-stripe-blue shadow-[0_0_6px_rgba(67,83,255,0.95)]" />
              <span className="font-mono">eaves</span>
              <span className="text-accent-100">148 LF</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-stripe-coral/40 bg-ink/80 px-2 py-0.5 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-stripe-coral shadow-[0_0_6px_rgba(248,113,126,0.95)]" />
              <span className="font-mono">downspouts</span>
              <span className="text-rose-100">5</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Stylized top-down vector roof. Premium architectural look — gradient
 * slate panels, crisp ridge/valley lines, no fake "grass" or cartoon
 * trees. The panel coordinates are tuned so the eave overlay above can
 * trace the actual visible edges (see eaves[] in MagicRoofCard).
 */
function StylizedRoof() {
  return (
    <svg
      viewBox="0 0 800 500"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        {/* Three subtly different slate gradients so adjacent panels
            read as distinct planes */}
        <linearGradient id="roof-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a4660" />
          <stop offset="100%" stopColor="#283044" />
        </linearGradient>
        <linearGradient id="roof-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2c3447" />
          <stop offset="100%" stopColor="#1d2330" />
        </linearGradient>
        <linearGradient id="roof-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#212838" />
          <stop offset="100%" stopColor="#141926" />
        </linearGradient>

        {/* Faint property lot tint behind the building */}
        <radialGradient id="lot-glow" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>

        {/* Hairline grid pattern for the lot */}
        <pattern
          id="lot-grid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M32 0 L0 0 0 32"
            fill="none"
            stroke="rgba(67,83,255,0.08)"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>

      {/* Lot background — grid + radial glow */}
      <rect width="800" height="500" fill="url(#lot-grid)" />
      <rect width="800" height="500" fill="url(#lot-glow)" />

      {/* Soft shadow under the building */}
      <ellipse
        cx="445"
        cy="420"
        rx="280"
        ry="36"
        fill="rgba(0,0,0,0.35)"
      />

      {/* MAIN ROOF MASS — hipped form with two slope panels meeting at a
          horizontal ridge. Defined as four trapezoids around the ridge. */}
      {/* North slope */}
      <polygon
        points="230,145 510,145 470,230 280,230"
        fill="url(#roof-light)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      {/* South slope */}
      <polygon
        points="280,230 470,230 490,315 230,315"
        fill="url(#roof-mid)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      {/* West hip */}
      <polygon
        points="230,145 280,230 230,315"
        fill="url(#roof-dark)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      {/* East hip (transitions toward the wing) */}
      <polygon
        points="510,145 510,230 470,230"
        fill="url(#roof-dark)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />

      {/* Ridge line of main mass */}
      <line
        x1="280"
        y1="230"
        x2="470"
        y2="230"
        stroke="#0f172a"
        strokeWidth="1"
      />

      {/* EAST WING / GARAGE — smaller hip attached to the east */}
      <polygon
        points="510,175 660,175 640,230 530,230"
        fill="url(#roof-light)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      <polygon
        points="530,230 640,230 660,285 510,285"
        fill="url(#roof-mid)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      {/* East wing ridge */}
      <line
        x1="530"
        y1="230"
        x2="640"
        y2="230"
        stroke="#0f172a"
        strokeWidth="1"
      />
      {/* East-most hip */}
      <polygon
        points="660,175 660,285 640,230"
        fill="url(#roof-dark)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />

      {/* FRONT PORCH — smaller gable extension at the south */}
      <polygon
        points="280,330 440,330 420,380 300,380"
        fill="url(#roof-mid)"
        stroke="rgba(67,83,255,0.1)"
        strokeWidth="0.5"
      />
      <line
        x1="300"
        y1="380"
        x2="420"
        y2="380"
        stroke="#0f172a"
        strokeWidth="0.75"
      />

      {/* Subtle architectural detail — chimney + skylight squares */}
      <rect x="358" y="218" width="14" height="24" fill="#0b1220" />
      <rect x="392" y="248" width="10" height="10" fill="#0b1220" opacity="0.85" />
      <rect x="412" y="248" width="10" height="10" fill="#0b1220" opacity="0.85" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*       2. DATA CARD — middle, overlapping the roof to the right     */
/* ------------------------------------------------------------------ */

function DataCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
      className="absolute left-[40%] top-[58%] hidden w-[300px] sm:block lg:left-[34%] lg:top-[60%]"
      style={{
        transform: "rotateY(-4deg) rotateX(2deg) rotate(2deg)",
        transformStyle: "preserve-3d",
      }}
    >
      <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-4 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-500/40 bg-ink/70 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-200">
            <Ruler className="h-3 w-3" />
            AI takeoff
          </span>
          <div className="flex items-center gap-1 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.95)]" />
            <span className="font-mono">98% confidence</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Eaves" value="148 LF" tone="blue" />
          <Stat label="D-spouts" value="5" tone="coral" />
          <Stat label="Stories" value="2" tone="blue" />
        </div>

        <div className="mt-3 space-y-1">
          {[
            { label: "North eave (main)", val: "42 LF" },
            { label: "South eave (main)", val: "44 LF" },
            { label: "East wing — N", val: "18 LF" },
            { label: "East wing — S", val: "20 LF" },
            { label: "Front porch", val: "24 LF" },
          ].map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between rounded-md border border-white/10 bg-ink/60 px-2 py-1 text-[10px]"
            >
              <span className="text-zinc-400">{r.label}</span>
              <span className="font-mono tabular-nums text-accent-200">
                {r.val}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[9px] text-zinc-500">
          <span className="font-mono">Solar · GPT-4o · SAM 2</span>
          <span className="font-mono text-accent-300/70">~12 sec</span>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "coral";
}) {
  const accent = tone === "blue" ? "text-accent-300" : "text-stripe-coral";
  return (
    <div className="rounded-lg border border-white/10 bg-ink/60 px-2 py-2 text-center">
      <div className={`font-mono text-base font-semibold tabular-nums ${accent}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*           3. PROPOSAL — right-back, peeks behind the phone         */
/* ------------------------------------------------------------------ */

function ProposalCard() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
      className="absolute right-[2%] top-[16%] hidden w-[380px] lg:block"
      style={{
        transform: "rotateY(-12deg) rotateX(2deg) rotate(3deg)",
        transformStyle: "preserve-3d",
      }}
    >
      <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Proposal builder
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-zinc-900">
              Lake Stevens, WA
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
            <Check className="h-2.5 w-2.5" />
            Ready
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <PackageCard tier="Essential" price="$3,890" />
          <PackageCard tier="Pro Shield" price="$4,572" recommended />
          <PackageCard tier="Heritage" price="$8,940" />
        </div>
        <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50/50 px-3 py-2 text-right">
          <div className="text-[9px] font-medium uppercase tracking-wider text-accent-700">
            Selected · Pro Shield
          </div>
          <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
            $4,572
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PackageCard({
  tier,
  price,
  recommended,
}: {
  tier: string;
  price: string;
  recommended?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${
        recommended
          ? "border-accent-300 bg-accent-50/50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <div className="text-[8px] font-medium uppercase tracking-wider text-zinc-500">
        {tier}
      </div>
      <div className="mt-1 text-base font-semibold tracking-tight tabular-nums text-zinc-900">
        {price}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*           4. PHONE — right foreground, in front of proposal        */
/* ------------------------------------------------------------------ */

function PhoneCard() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 40, y: 20 }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, ease: "easeOut", delay: 0.3 }}
      className="absolute right-2 top-[28%] w-[260px] sm:right-8 lg:right-[10%] lg:top-[32%]"
      style={{
        transform: "rotateY(-10deg) rotateX(3deg) rotate(4deg)",
        transformStyle: "preserve-3d",
      }}
    >
      <PhoneFrame>
        <div className="flex h-full flex-col bg-gradient-to-br from-white to-zinc-50">
          <div className="flex items-center justify-between px-5 pt-3 text-[9px] text-zinc-700">
            <span className="font-semibold">9:41</span>
            <div className="flex items-center gap-1 text-zinc-600">
              <span>●●●</span>
              <span>WiFi</span>
              <span>100%</span>
            </div>
          </div>

          <div className="flex-1 px-4 pt-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Rivera Gutterworks
            </div>
            <div className="mt-1 text-xl font-semibold leading-tight tracking-tight text-zinc-900">
              Your gutter quote
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Locked for 30 days · 6232 97th Dr NE
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>Selected · Pro Shield</span>
                <span>30% today</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
                  $4,572
                </span>
                <span className="text-[10px] text-zinc-500">total</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[9px] text-zinc-500">
              <div className="rounded-md border border-zinc-200 bg-white px-1 py-1">
                <div className="font-semibold text-zinc-900">160 LF</div>
                <div>Eaves</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-white px-1 py-1">
                <div className="font-semibold text-zinc-900">5</div>
                <div>D-spouts</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-white px-1 py-1">
                <div className="font-semibold text-zinc-900">15-yr</div>
                <div>Warranty</div>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur">
            <button
              type="button"
              className="relative w-full overflow-hidden rounded-xl bg-accent-600 px-3 py-2.5 text-xs font-semibold text-white shadow-[0_0_24px_rgba(46,64,232,0.55)]"
              tabIndex={-1}
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent [animation:cascadeShimmer_3s_ease_infinite]" />
              <span className="relative flex items-center justify-center gap-1.5">
                <Lock className="h-3 w-3" />
                Accept &amp; Pay $4,572
              </span>
            </button>
            <div className="mt-1.5 flex items-center justify-center gap-1 text-[8px] text-zinc-500">
              <ShieldCheck className="h-2.5 w-2.5 text-accent-600" />
              Secured by Stripe · Funds direct to contractor
            </div>
          </div>
        </div>
      </PhoneFrame>

      <style jsx global>{`
        @keyframes cascadeShimmer {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </motion.div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="relative h-[540px] w-[260px] rounded-[42px] bg-zinc-950 p-1.5 shadow-[0_50px_100px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.05)_inset]">
        <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-white">
          <div className="absolute left-1/2 top-1.5 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-zinc-950" />
          {children}
        </div>
      </div>

      <div
        aria-hidden
        className="absolute -bottom-8 left-1/2 -z-10 h-32 w-56 -translate-x-1/2 rounded-full bg-accent-500/30 blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.9 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-200px" }}
        transition={{ delay: 1.4, type: "spring", stiffness: 240 }}
        className="absolute -right-4 top-28 hidden rounded-xl border border-emerald-200 bg-white px-3 py-2 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.2)] xl:block"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
            <CreditCard className="h-3.5 w-3.5 text-emerald-700" />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-900">
              Stripe · Payment received
            </div>
            <div className="text-[9px] text-zinc-500">
              $1,371.60 deposit · 6 sec ago
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
