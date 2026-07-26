"use client";

// ─────────────────────────────────────────────────────────────────────────
// Method A — Satellite Map Takeoff (demo)
//
// Type an address → we "pull high-res aerial + trace the roof" (mocked with a
// setTimeout) → an L-shaped house outline drops onto a procedural aerial tile.
// Because satellite imagery carries a known ground-sample distance, the scale
// (pxPerFt) is FIXED — no calibration step. The page owns all geometry state
// and feeds the controlled <GutterCanvas>; every drag / downspout edit flows
// back through the callbacks and re-prices live in the sidebar.
//
// Self-contained mock: no network, no images. Every background is procedural
// SVG rendered behind the canvas overlay.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Home,
  MousePointer2,
  Droplet,
  PenLine,
  RotateCcw,
  Search,
  Loader2,
  Satellite,
  MapPin,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  nextId,
  roundFt,
  totalEaveFeet,
  type DownspoutMark,
  type Segment,
} from "@/lib/canvas-utils";
import GutterCanvas, { type CanvasMode } from "@/components/demo/GutterCanvas";
import { GUTTER_UNIT_PRICES, DOWNSPOUT_UNIT_PRICES } from "@/lib/pricing";

// ── Fixed constants ──────────────────────────────────────────────────────

// Satellite ground-sample distance is known, so the scale is baked in and the
// same on every load. ~3.2 px per real foot at this zoom.
const PX_PER_FT = 3.2;

// 2-story home: each downspout drop runs ~20 ft of vertical pipe.
const DROP_LEN_FT = 20;

// Priced against a mid-range spec so the estimate reads like a real quote.
const GUTTER_UNIT = GUTTER_UNIT_PRICES["6-k-style-aluminum"]; // $12 / LF
const DOWNSPOUT_UNIT = DOWNSPOUT_UNIT_PRICES["3x4"]; // $9 / LF

const CANVAS_W = 900;
const CANVAS_H = 580;

// ── Sample addresses (chips) ─────────────────────────────────────────────

const SAMPLE_ADDRESSES = [
  "1442 Maple Ave, Springfield",
  "88 Birch Court, Denver",
  "217 Cedar Hollow Rd, Austin",
];

// ── Preset roof outline ──────────────────────────────────────────────────
//
// An L-shaped house: a main body (a) plus a garage wing (b) extending to the
// right, aligned to the subject rooftop drawn in the procedural background.
// Perimeter drainage edges are "eave" (glowing cyan, guttered); the two gable
// ends — where the roof slopes up to a ridge — are "rake" (dashed slate).
//
// Corner coordinates of the L (clockwise from top-left of the main body):
//   M1 (250,160) ─ M2 (560,160)         top of main body
//   M2 ─ G1 (560,300)                    step down to garage roofline
//   G1 ─ G2 (760,300)                    top of garage wing
//   G2 ─ G3 (760,470)                    right gable end of garage  → RAKE
//   G3 ─ M4 (250,470)                    bottom eave (full width)
//   M4 ─ M1                              left gable end of main     → RAKE
//
// The two shorter vertical edges of the "L" notch (M2→G1) reads as a valley/
// eave return; we keep it a guttered eave so drainage is continuous.

const M1 = { x: 250, y: 160 };
const M2 = { x: 560, y: 160 };
const G1 = { x: 560, y: 300 };
const G2 = { x: 760, y: 300 };
const G3 = { x: 760, y: 470 };
const M4 = { x: 250, y: 470 };

function presetSegments(): Segment[] {
  return [
    { id: "eave-top-main", a: M1, b: M2, kind: "eave" }, // main front eave
    { id: "eave-notch", a: M2, b: G1, kind: "eave" }, // inside return eave
    { id: "eave-top-garage", a: G1, b: G2, kind: "eave" }, // garage front eave
    { id: "rake-garage-right", a: G2, b: G3, kind: "rake" }, // garage gable end
    { id: "eave-bottom", a: G3, b: M4, kind: "eave" }, // full-width rear eave
    { id: "rake-main-left", a: M4, b: M1, kind: "rake" }, // main gable end
  ];
}

function presetDownspouts(): DownspoutMark[] {
  // Drops at the outside corners where water collects.
  return [
    { id: "ds-1", at: M1 }, // main top-left
    { id: "ds-2", at: G2 }, // garage top-right
    { id: "ds-3", at: G3 }, // garage bottom-right
    { id: "ds-4", at: M4 }, // main bottom-left
  ];
}

// ── Procedural aerial background ─────────────────────────────────────────
//
// A convincing top-down tile inside the 900×580 viewBox: earth gradient, lawn
// blocks, a driveway + street strip, two muted neighbor rooftops, and the
// SUBJECT house rendered as muted gray/brown planes so the cyan eave overlay
// reads clearly on top. All procedural — no raster, no external URLs.

function SatelliteBackground() {
  return (
    <g>
      <defs>
        {/* base earth / greenscale */}
        <linearGradient id="sat-earth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2f3a2b" />
          <stop offset="45%" stopColor="#33402d" />
          <stop offset="100%" stopColor="#28331f" />
        </linearGradient>
        {/* lawn patch gradient */}
        <linearGradient id="sat-lawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d5232" />
          <stop offset="100%" stopColor="#33482a" />
        </linearGradient>
        {/* roof plane shading — subject house */}
        <linearGradient id="sat-roof" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#6b6257" />
          <stop offset="100%" stopColor="#544c43" />
        </linearGradient>
        <linearGradient id="sat-roof-dk" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#544c43" />
          <stop offset="100%" stopColor="#443d36" />
        </linearGradient>
        {/* faint vegetation speckle */}
        <pattern
          id="sat-speckle"
          width="26"
          height="26"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(18)"
        >
          <rect width="26" height="26" fill="none" />
          <circle cx="4" cy="6" r="2.2" fill="rgba(60,84,44,0.55)" />
          <circle cx="17" cy="15" r="1.6" fill="rgba(74,98,52,0.5)" />
          <circle cx="10" cy="21" r="1.2" fill="rgba(52,72,40,0.5)" />
        </pattern>
      </defs>

      {/* base earth */}
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#sat-earth)" />
      <rect
        x={0}
        y={0}
        width={CANVAS_W}
        height={CANVAS_H}
        fill="url(#sat-speckle)"
        opacity={0.6}
      />

      {/* lawn / vegetation blocks */}
      <rect x={40} y={40} width={230} height={200} rx={6} fill="url(#sat-lawn)" opacity={0.85} />
      <rect x={600} y={430} width={260} height={110} rx={6} fill="url(#sat-lawn)" opacity={0.8} />
      <rect x={40} y={470} width={180} height={70} rx={6} fill="url(#sat-lawn)" opacity={0.75} />

      {/* tree canopies (dark green blobs) */}
      {[
        { x: 110, y: 90, r: 26 },
        { x: 160, y: 130, r: 20 },
        { x: 700, y: 500, r: 24 },
        { x: 760, y: 485, r: 18 },
        { x: 90, y: 505, r: 16 },
      ].map((t, i) => (
        <g key={`tree-${i}`}>
          <circle cx={t.x + 3} cy={t.y + 4} r={t.r} fill="rgba(0,0,0,0.35)" />
          <circle cx={t.x} cy={t.y} r={t.r} fill="#2c3f21" />
          <circle cx={t.x - t.r * 0.3} cy={t.y - t.r * 0.3} r={t.r * 0.5} fill="#3a5230" />
        </g>
      ))}

      {/* street strip along the top edge */}
      <rect x={0} y={0} width={CANVAS_W} height={62} fill="#3b3f45" />
      <rect x={0} y={0} width={CANVAS_W} height={62} fill="rgba(0,0,0,0.12)" />
      {/* lane dashes */}
      {Array.from({ length: 15 }).map((_, i) => (
        <rect
          key={`lane-${i}`}
          x={20 + i * 62}
          y={29}
          width={34}
          height={4}
          rx={2}
          fill="rgba(226,232,240,0.35)"
        />
      ))}

      {/* driveway from the street to the garage */}
      <polygon
        points="620,62 720,62 745,300 655,300"
        fill="#5a5e64"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth={1}
      />
      <polygon points="620,62 720,62 745,300 655,300" fill="url(#sat-speckle)" opacity={0.15} />

      {/* neighbor rooftop — left */}
      <g opacity={0.9}>
        <polygon points="60,300 210,300 210,410 60,410" fill="#5f5750" />
        <line x1={135} y1={300} x2={135} y2={410} stroke="rgba(0,0,0,0.25)" strokeWidth={2} />
      </g>
      {/* neighbor rooftop — top right (partial, above the street) */}
      <g opacity={0.85}>
        <polygon points="790,70 860,70 860,190 790,190" fill="#655c53" />
        <line x1={790} y1={130} x2={860} y2={130} stroke="rgba(0,0,0,0.25)" strokeWidth={2} />
      </g>

      {/* ── SUBJECT HOUSE — muted roof planes matching the outline ── */}
      {/* soft cast shadow under the whole footprint */}
      <polygon
        points="256,166 566,166 566,306 766,306 766,476 256,476"
        fill="rgba(0,0,0,0.4)"
        transform="translate(8,10)"
      />

      {/* main body — two roof planes meeting at a horizontal ridge */}
      <polygon points="250,160 560,160 560,315 250,315" fill="url(#sat-roof)" />
      <polygon points="250,315 560,315 560,470 250,470" fill="url(#sat-roof-dk)" />
      {/* main ridge line */}
      <line x1={250} y1={315} x2={560} y2={315} stroke="rgba(30,25,20,0.55)" strokeWidth={2.5} />

      {/* garage wing — two planes meeting at a ridge */}
      <polygon points="560,300 760,300 760,385 560,385" fill="url(#sat-roof)" />
      <polygon points="560,385 760,385 760,470 560,470" fill="url(#sat-roof-dk)" />
      <line x1={560} y1={385} x2={760} y2={385} stroke="rgba(30,25,20,0.55)" strokeWidth={2.5} />

      {/* hip/valley crease where the wings meet + roof texture streaks */}
      <line x1={560} y1={160} x2={560} y2={470} stroke="rgba(30,25,20,0.35)" strokeWidth={1.5} />
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={`shingle-${i}`}
          x1={250}
          y1={185 + i * 22}
          x2={560}
          y2={185 + i * 22}
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={1}
        />
      ))}

      {/* subtle vignette so edges feel like a cropped tile */}
      <rect
        x={0}
        y={0}
        width={CANVAS_W}
        height={CANVAS_H}
        fill="none"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={26}
        opacity={0.35}
      />
    </g>
  );
}

// Empty state background: same tile, dimmed, with a centered hint. Shown
// before the first "Analyze roof".
function EmptyBackground() {
  return (
    <g>
      <SatelliteBackground />
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="rgba(13,13,18,0.6)" />
      <text
        x={CANVAS_W / 2}
        y={CANVAS_H / 2 - 6}
        textAnchor="middle"
        fontSize={22}
        fontWeight={600}
        fill="rgba(255,255,255,0.75)"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Enter an address to begin
      </text>
      <text
        x={CANVAS_W / 2}
        y={CANVAS_H / 2 + 22}
        textAnchor="middle"
        fontSize={14}
        fill="rgba(255,255,255,0.5)"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        We&apos;ll pull the aerial and trace the roof automatically.
      </text>
    </g>
  );
}

// ── Mode metadata for the toolbar ────────────────────────────────────────

const MODES: {
  id: CanvasMode;
  label: string;
  icon: typeof MousePointer2;
  hint: string;
}[] = [
  {
    id: "select",
    label: "Adjust runs",
    icon: MousePointer2,
    hint: "Drag any corner handle to fine-tune the traced outline — lengths update live.",
  },
  {
    id: "downspout",
    label: "Gates",
    icon: Droplet,
    hint: "Click near a run to place a gate; click an existing one to remove it.",
  },
  {
    id: "trace",
    label: "Add run",
    icon: PenLine,
    hint: "Click to drop points and draw a new fence run. Double-click or Esc to finish.",
  },
];

// ─────────────────────────────────────────────────────────────────────────

export default function Page() {
  // Address bar (prefilled with the first sample).
  const [address, setAddress] = useState(SAMPLE_ADDRESSES[0]);
  // The address that was actually analyzed (drives the sidebar readout).
  const [analyzedAddress, setAnalyzedAddress] = useState<string | null>(null);

  // Flow state: has the roof been revealed, and are we mid-"analysis"?
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Geometry — the page owns all of it; GutterCanvas is controlled.
  const [segments, setSegments] = useState<Segment[]>(presetSegments);
  const [downspouts, setDownspouts] = useState<DownspoutMark[]>(presetDownspouts);
  const [mode, setMode] = useState<CanvasMode>("select");

  // Static pitch for this demo (used for the readout copy only).
  const [pitch, setPitch] = useState("6");

  // Scale is only "live" (labels shown) once analyzed.
  const pxPerFt = analyzed ? PX_PER_FT : undefined;

  // ── Live measurement + cost (recompute whenever geometry changes) ──
  const gutterLF = useMemo(
    () => roundFt(totalEaveFeet(segments, PX_PER_FT)),
    [segments],
  );
  const downspoutCount = downspouts.length;
  const estimate = useMemo(() => {
    const gutterCost = gutterLF * GUTTER_UNIT;
    const downspoutCost = downspoutCount * DROP_LEN_FT * DOWNSPOUT_UNIT;
    return gutterCost + downspoutCost;
  }, [gutterLF, downspoutCount]);

  // ── Handlers ──
  const handleAnalyze = () => {
    if (analyzing || !address.trim()) return;
    setAnalyzing(true);
    // Mock "pulling aerial + tracing" — no real network.
    window.setTimeout(() => {
      setAnalyzedAddress(address.trim());
      setSegments(presetSegments());
      setDownspouts(presetDownspouts());
      setMode("select");
      setAnalyzed(true);
      setAnalyzing(false);
    }, 1200);
  };

  const resetOutline = () => {
    setSegments(presetSegments());
    setDownspouts(presetDownspouts());
    setMode("select");
  };

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <main className="min-h-screen bg-ink text-white">
      {/* ── Top bar ── */}
      <div className="border-b border-white/10 bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/demo"
            className="group ring-focus-dark inline-flex items-center gap-2 rounded-md text-sm text-white/60 transition-smooth hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />{" "}
            Takeoff demos
          </Link>
          <div className="font-label inline-flex items-center gap-2 rounded-md border border-white/25 px-2.5 py-1 text-white">
            <Satellite className="h-4 w-4" />
            Method A · Satellite
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <header className="anim-enter mb-5">
          <h1 className="display-hero text-3xl text-white sm:text-4xl">
            Property Scan Takeoff
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Type an address, pull the aerial, and get an auto-traced
            outline. Drag the runs, drop gates, and read live footage and
            cost — all at a known satellite scale.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Main column: address bar + canvas ── */}
          <div className="lg:col-span-2">
            {/* Address bar */}
            <div className="anim-enter stagger-1 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAnalyze();
                    }}
                    placeholder="Enter a property address…"
                    className="w-full rounded-lg border border-white/15 bg-ink py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none transition-smooth focus:border-stripe-blue focus:ring-1 focus:ring-stripe-blue"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !address.trim()}
                  className={cn(
                    "press-scale ring-focus-dark inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-smooth",
                    analyzing || !address.trim()
                      ? "cursor-not-allowed bg-white/10 text-white/40"
                      : "bg-accent-600 text-white hover:bg-accent-500",
                  )}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{" "}
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" /> Analyze property
                    </>
                  )}
                </button>
              </div>

              {/* Sample-address chips */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/50">Try:</span>
                {SAMPLE_ADDRESSES.map((addr) => (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => setAddress(addr)}
                    className={cn(
                      "press-scale ring-focus-dark rounded-md border px-3 py-1 text-xs transition-smooth",
                      address === addr
                        ? "border-stripe-blue/60 bg-stripe-blue/15 text-white"
                        : "border-white/15 bg-ink text-white/60 hover:border-white/30 hover:text-white",
                    )}
                  >
                    {addr}
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas */}
            <div className="anim-enter stagger-2 relative mt-4">
              <GutterCanvas
                width={CANVAS_W}
                height={CANVAS_H}
                background={analyzed ? <SatelliteBackground /> : <EmptyBackground />}
                segments={analyzed ? segments : []}
                downspouts={analyzed ? downspouts : []}
                pxPerFt={pxPerFt}
                mode={mode}
                onSegmentsChange={setSegments}
                onDownspoutsChange={setDownspouts}
                traceKind="eave"
                grid
              />

              {/* Analyzing overlay */}
              {analyzing && (
                <div className="anim-enter-fade absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-ink/80">
                  <Loader2 className="h-9 w-9 animate-spin text-stripe-blue motion-reduce:animate-none" />
                  <p className="text-sm font-medium text-white/90">
                    Pulling high-res aerial + tracing roof…
                  </p>
                  <p className="max-w-xs text-center text-xs text-white/50">
                    {address.trim()}
                  </p>
                </div>
              )}

              {/* Mode toolbar — only meaningful once a roof is on screen */}
              {analyzed && (
                <div className="anim-enter mt-4 flex flex-wrap items-center gap-2">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = mode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        className={cn(
                          "press-scale ring-focus-dark inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-smooth",
                          active
                            ? "border-stripe-blue/60 bg-stripe-blue/15 text-white"
                            : "border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:text-white",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {m.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={resetOutline}
                    className="press-scale ring-focus-dark ml-auto inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/70 transition-smooth hover:border-white/30 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" /> Reset outline
                  </button>
                </div>
              )}

              {/* Active-mode hint */}
              {analyzed && (
                <p className="anim-enter-fade stagger-2 mt-2 text-xs text-white/50">
                  <span className="font-semibold text-white/70">
                    {activeMode.label}:
                  </span>{" "}
                  {activeMode.hint}
                </p>
              )}
            </div>
          </div>

          {/* ── Sidebar: readout ── */}
          <aside className="anim-enter-fade stagger-3 lg:col-span-1">
            <div className="space-y-4 lg:sticky lg:top-6">
              {/* Detected property */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="font-label flex items-center gap-2 text-[11px] text-white/40">
                  <Home className="h-4 w-4" /> Detected property
                </div>
                <p className="mt-2 text-sm font-medium text-white">
                  {analyzedAddress ?? "— no address analyzed yet —"}
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Aerial scale</span>
                    <span className="font-mono text-white/80">
                      ~{PX_PER_FT} px/ft
                    </span>
                  </div>
                  <p className="text-xs text-white/50">
                    Fixed ground-sample distance — no calibration needed.
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-white/60">Terrain slope</span>
                    <select
                      value={pitch}
                      onChange={(e) => setPitch(e.target.value)}
                      className="ring-focus-dark rounded-md border border-white/15 bg-ink px-2 py-1 text-xs text-white/80 outline-none transition-smooth focus:border-stripe-blue"
                    >
                      {["4", "6", "8", "10", "12"].map((p) => (
                        <option key={p} value={p}>
                          {p} / 12
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Live measurements */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="font-label text-[11px] text-white/40">
                  Live measurement
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-sm text-white/60">Total fence run</span>
                  <span className="font-mono text-2xl font-bold tabular-nums text-stripe-blue">
                    {analyzed ? gutterLF.toFixed(1) : "—"}
                    <span className="ml-1 text-sm font-medium text-white/50">LF</span>
                  </span>
                </div>

                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-sm text-white/60">Gates</span>
                  <span className="font-mono text-lg font-semibold tabular-nums text-white">
                    {analyzed ? downspoutCount : "—"}
                  </span>
                </div>

                <hr className="my-4 border-white/10" />

                <div className="font-label text-[11px] text-white/40">
                  Estimated materials
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-sm text-white/60">Rough estimate</span>
                  <span className="font-mono text-2xl font-bold tabular-nums text-white">
                    {analyzed ? formatCurrency(estimate) : "—"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  {analyzed ? (
                    <>
                      {gutterLF.toFixed(1)} LF × {formatCurrency(GUTTER_UNIT)}/LF
                      fence + {downspoutCount} gates × {DROP_LEN_FT} ft ×{" "}
                      {formatCurrency(DOWNSPOUT_UNIT)}/LF hardware (demo
                      rates). Materials only — not a final quote.
                    </>
                  ) : (
                    <>Analyze an address to price the property.</>
                  )}
                </p>
              </div>

              {/* Legend */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="font-label text-[11px] text-white/40">
                  Legend
                </div>
                <ul className="mt-3 space-y-2.5 text-sm text-white/80">
                  <li className="flex items-center gap-3">
                    <span className="h-1 w-8 rounded-full bg-stripe-blue shadow-[0_0_8px_rgba(67,83,255,0.7)]" />
                    Fence run
                  </li>
                  <li className="flex items-center gap-3">
                    <svg width="32" height="6" className="shrink-0">
                      <line
                        x1="0"
                        y1="3"
                        x2="32"
                        y2="3"
                        stroke="rgba(255,255,255,0.45)"
                        strokeWidth="2"
                        strokeDasharray="6 4"
                      />
                    </svg>
                    Unfenced edge
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="flex h-4 w-8 items-center justify-center">
                      <span className="h-3 w-3 rounded-full border border-white bg-stripe-blue" />
                    </span>
                    Gate
                  </li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
