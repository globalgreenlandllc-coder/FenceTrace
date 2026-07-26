"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_OPTIONS } from "@/lib/pricing";
import type { EstimateConfig } from "@/lib/types";

const ROTATE_STEP = 22; // degrees per arrow click
const SPIN_DPS = 36; // degrees per second when auto-spinning

const MATERIAL_BADGE: Record<
  EstimateConfig["material"],
  { label: string; ring: string; bg: string; text: string }
> = {
  aluminum: {
    label: "Aluminum",
    ring: "ring-zinc-300",
    bg: "bg-zinc-100",
    text: "text-zinc-700",
  },
  steel: {
    label: "Steel",
    ring: "ring-sky-300",
    bg: "bg-sky-50",
    text: "text-sky-700",
  },
  copper: {
    label: "Copper",
    ring: "ring-amber-300",
    bg: "bg-amber-50",
    text: "text-amber-800",
  },
};

/** Projection: the gutter run goes along screen-X; "depth" (toward the
 *  house wall) recedes up-and-right. One shared axis pair keeps the
 *  gutter, roof, downspout and accessories in the same 3/4 space. */
const UX = 0.58;
const UY = -0.4;

type MapFn = (d: number, y: number) => string;

/** True K-style (ogee) cross-section, traced from the real profile:
 *  flat back against the fascia, narrow flat bottom, then up the front —
 *  outward belly, concave cavetto, flare to the squared top lip. `m`
 *  maps profile-space (d = depth from the front face, y = down from the
 *  rim) into screen space, so the same shape draws the skewed cut-end,
 *  the flat left end cap, and the badge thumbnail. */
function kSection(m: MapFn, dd: number, hh: number): string {
  return `M ${m(dd, 0)}
    L ${m(dd, hh)}
    L ${m(dd * 0.34, hh)}
    C ${m(dd * 0.14, hh * 0.97)} ${m(0, hh * 0.86)} ${m(dd * 0.05, hh * 0.7)}
    C ${m(dd * 0.09, hh * 0.57)} ${m(dd * 0.24, hh * 0.5)} ${m(dd * 0.26, hh * 0.4)}
    C ${m(dd * 0.28, hh * 0.28)} ${m(dd * 0.06, hh * 0.2)} ${m(0, hh * 0.1)}
    L ${m(0, hh * 0.02)}
    L ${m(dd * 0.12, 0)}
    Z`;
}

/** Half-round cross-section: a true semicircle hanging from the rim
 *  (cubic circle approximation so it survives the skewed mapping). */
function hrSection(m: MapFn, dd: number): string {
  const r = dd / 2;
  const k = 0.5523 * r;
  return `M ${m(0, 0)}
    C ${m(0, k)} ${m(r - k, r)} ${m(r, r)}
    C ${m(r + k, r)} ${m(dd, k)} ${m(dd, 0)}
    Z`;
}

function hrCavity(m: MapFn, dd: number): string {
  const c = dd / 2;
  const r = c - 4;
  const k = 0.5523 * r;
  return `M ${m(c - r, 0.8)}
    C ${m(c - r, 0.8 + k)} ${m(c - k, 0.8 + r)} ${m(c, 0.8 + r)}
    C ${m(c + k, 0.8 + r)} ${m(c + r, 0.8 + k)} ${m(c + r, 0.8)}
    Z`;
}

/**
 * 3/4-perspective cutaway of the full system on a house corner, drawn
 * so every priced choice is visible AS THE REAL PART:
 *
 *   • Roof plane with shingle courses ending at the eave — the gutter
 *     hangs from the fascia directly under it, so "roof-attached" is
 *     explicit. Animated water-flow arrows trace roof → gutter →
 *     downspout → splash block.
 *   • The cut end of the run shows the TRUE profile: K-style ogee
 *     (belly + cavetto + squared lip) or half-round (semicircle),
 *     open, with the dark trough cavity and metal rim.
 *   • Hangers: hidden-hanger straps across a K-style trough, external
 *     ring brackets + rods on half-round.
 *   • Downspout as a real assembly: outlet drop, crimped offset
 *     elbows, wall straps, kick-out elbow, open mouth showing the
 *     rectangular vs round bore, splash block on the grass.
 *   • Accessories render as the actual product with a labeled chip:
 *     leaf guard covers most of the opening (coarse screen / mesh /
 *     micro-mesh patterns), drip edge (eave metal) shows both the
 *     on-roof flange and the lip over the gutter back, heat cable
 *     zigzags the eave and runs the trough, snow guards pad the roof,
 *     rain chain replaces the downspout.
 *   • Corner badge draws both cross-sections (gutter profile +
 *     downspout bore) at a glance.
 */
export function GutterPreview({ config }: { config: EstimateConfig }) {
  const color = COLOR_OPTIONS.find((c) => c.id === config.color);
  const hex = color?.hex ?? "#f4f4f5";
  const mat = MATERIAL_BADGE[config.material];
  const acc = config.accessories;
  const halfRound = config.style === "half-round";

  // ─── ROTATION (Y-axis "turn around") ──────────────────────────
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const angleRef = useRef(angle);
  useEffect(() => {
    angleRef.current = angle;
  }, [angle]);
  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = (angleRef.current + dt * SPIN_DPS) % 360;
      angleRef.current = next;
      setAngle(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const turnLeft = () => {
    setSpinning(false);
    setAngle((a) => a - ROTATE_STEP);
  };
  const turnRight = () => {
    setSpinning(false);
    setAngle((a) => a + ROTATE_STEP);
  };
  const resetAngle = () => {
    setSpinning(false);
    setAngle(0);
  };
  const toggleSpin = () => setSpinning((s) => !s);

  // ─── GUTTER GEOMETRY ──────────────────────────────────────────
  const gutterLeft = 78;
  const gutterLen = 222;
  const gutterRightX = gutterLeft + gutterLen;
  const gutterTop = 148; // top rim (front) in screen Y
  // Top-opening width scales with size so 5/6/7 is clearly perceived.
  const D = config.size === "5" ? 36 : config.size === "6" ? 44 : 52;
  // Real proportions: K-style is ~0.72× as tall as it is wide; a
  // half-round is exactly half (radius) plus the rolled bead.
  const H = halfRound ? Math.round(D / 2) + 3 : Math.round(D * 0.72);
  const perspX = D * UX;
  const perspY = D * UY;

  // Profile-space → screen mappers.
  const projAt =
    (ox: number, oy: number): MapFn =>
    (d, y) =>
      `${(ox + d * UX).toFixed(1)} ${(oy + d * UY + y).toFixed(1)}`;
  const flatAt =
    (cx: number, cy: number, s: number): MapFn =>
    (d, y) =>
      `${(cx + (d - D / 2) * s).toFixed(1)} ${(cy + (y - H / 2) * s).toFixed(1)}`;
  // Inset remap for the dark trough cavity at the open cut end.
  const inset =
    (m: MapFn): MapFn =>
    (d, y) =>
      m(D * 0.07 + d * 0.84, 1.6 + y * 0.85);

  const mEnd = projAt(gutterRightX, gutterTop);
  const mCap = projAt(gutterLeft, gutterTop);

  // ─── ROOF PLANE ───────────────────────────────────────────────
  const eaveY = gutterTop + perspY - 2; // roof edge sits on the gutter back rim
  const eaveAx = gutterLeft + perspX - 8;
  const eaveBx = gutterRightX + perspX + 10;
  const SLX = -95; // up-slope vector (to the ridge)
  const SLY = -86;
  const roofPt = (u: number, f: number) => ({
    x: eaveAx + (eaveBx - eaveAx) * u + SLX * f,
    y: eaveY + SLY * f,
  });

  // ─── HOUSE ────────────────────────────────────────────────────
  const fasciaBot = gutterTop + H + 16;
  const cornerX = gutterRightX + 14;
  const groundY = 338;

  // ─── DOWNSPOUT ────────────────────────────────────────────────
  const ds = config.downspoutSize;
  const dsRound = ds === "round-3" || ds === "round-4";
  const dsW = ds === "2x3" ? 26 : ds === "3x4" ? 34 : ds === "round-3" ? 28 : 36;
  // Real bore ratios: 2×3 and 3×4 are 2:3 / 3:4 side profiles.
  const dsDepth = dsRound ? 0 : ds === "2x3" ? dsW * 0.66 : dsW * 0.75;
  const dpx = dsDepth * UX;
  const dpy = dsDepth * UY;

  const outletCenterX = gutterLeft + gutterLen * 0.8;
  const outletY = gutterTop + H;
  const dropTop = outletY - 3;
  const dropBot = outletY + 16;
  const jogX = 12;
  const runLeft = outletCenterX - dsW / 2 + jogX;
  const runTop = dropBot + 13;
  const runBot = 302;
  const kickBot = 318;
  const mouthX = runLeft + 14 + dsW / 2;

  const useRainChain = acc?.rainChain;
  // Splash block sits under whichever water exit is active.
  const splashX = useRainChain ? outletCenterX : mouthX;
  const guardTier = acc?.guard ?? "none";
  const guardOn = guardTier !== "none";
  // Guard covers most of the run but leaves the outlet end open so the
  // trough, hangers and outlet stay visible underneath.
  const coverX = gutterLeft + gutterLen * 0.62;

  const GUARD_LABEL: Record<string, string> = {
    screen: "Screen guard",
    mesh: "Mesh guard",
    "micro-mesh": "Micro-mesh guard",
  };

  // Accessory chips (label + leader-line target), stacked top-left.
  const chips: Array<{ label: string; tx: number; ty: number }> = [];
  if (acc?.dripEdge)
    chips.push({
      label: "Drip edge (eave metal)",
      tx: gutterLeft + gutterLen * 0.16 + perspX,
      ty: eaveY + 1,
    });
  if (guardOn)
    chips.push({
      label: GUARD_LABEL[guardTier] ?? "Leaf guard",
      tx: gutterLeft + gutterLen * 0.32 + perspX * 0.5,
      ty: gutterTop + perspY * 0.5 + 1,
    });
  if (acc?.heatTape) {
    const p = roofPt(0.3, 0.075);
    chips.push({ label: "Heat cable", tx: p.x, ty: p.y });
  }
  if (acc?.iceGuard) {
    const p = roofPt(0.3, 0.38);
    chips.push({ label: "Snow guards", tx: p.x, ty: p.y });
  }

  // Vertical pipe section: isometric depth on box pipes, cylindrical
  // shading on round pipes.
  const renderPipe = (x: number, y: number, w: number, h: number) => {
    if (dsRound) {
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill={hex} />
          <rect x={x} y={y} width={w * 0.2} height={h} fill="rgba(255,255,255,0.34)" />
          <rect x={x + w * 0.74} y={y} width={w * 0.26} height={h} fill="rgba(0,0,0,0.28)" />
          <rect x={x} y={y} width={w} height={h} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
        </g>
      );
    }
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={hex} />
        <rect x={x} y={y} width={w * 0.28} height={h} fill="rgba(255,255,255,0.2)" />
        {/* Receding side face, skewed along the shared depth axis */}
        <polygon
          points={`${x + w},${y} ${x + w + dpx},${y + dpy} ${x + w + dpx},${y + h + dpy} ${x + w},${y + h}`}
          fill={hex}
        />
        <polygon
          points={`${x + w},${y} ${x + w + dpx},${y + dpy} ${x + w + dpx},${y + h + dpy} ${x + w},${y + h}`}
          fill="rgba(0,0,0,0.34)"
        />
        <rect x={x} y={y} width={w} height={h} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
        <line x1={x + w} y1={y} x2={x + w} y2={y + h} stroke="rgba(0,0,0,0.45)" strokeWidth="0.7" />
      </g>
    );
  };

  // Crimp bands where downspout sections join — the signature detail
  // that says "real elbow", not a drawn tube.
  const crimp = (x: number, y: number, w: number) => (
    <g>
      <line x1={x + 1} y1={y} x2={x + w - 1} y2={y} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      <line x1={x + 1} y1={y + 2.2} x2={x + w - 1} y2={y + 2.2} stroke="rgba(0,0,0,0.2)" strokeWidth="0.8" />
    </g>
  );

  const dsLabel =
    ds === "2x3" ? "2×3″" : ds === "3x4" ? "3×4″" : ds === "round-3" ? "3″ round" : "4″ round";

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-white/70 px-3 py-2 backdrop-blur">
        <div className="font-label text-[10px] text-zinc-500">
          Live preview
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={turnLeft}
              title="Turn left"
              aria-label="Turn left"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleSpin}
              onDoubleClick={resetAngle}
              title={spinning ? "Stop spin (dbl-click to reset)" : "Auto-spin (dbl-click to reset)"}
              aria-label={spinning ? "Stop spin" : "Auto-spin"}
              aria-pressed={spinning}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full transition",
                spinning
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              <RotateCw
                className={cn("h-3.5 w-3.5", spinning && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={turnRight}
              title="Turn right"
              aria-label="Turn right"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${mat.bg} ${mat.text} ${mat.ring}`}
          >
            <span
              className="h-2 w-2 rounded-full ring-1 ring-inset ring-white/40"
              style={{ background: hex }}
            />
            {config.size}″ {halfRound ? "Half-Round" : "K-Style"} · {mat.label}
          </div>
        </div>
      </div>

      <div className="relative w-full" style={{ perspective: "1400px" }}>
        <motion.svg
          key={`${config.size}-${config.style}-${config.color}-${config.material}-${ds}-${guardTier}-${acc?.dripEdge}-${acc?.heatTape}-${acc?.iceGuard}-${useRainChain}`}
          viewBox="0 0 500 360"
          className="block h-72 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, rotateY: angle }}
          transition={{
            opacity: { duration: 0.25 },
            rotateY: spinning
              ? { duration: 0 }
              : { type: "spring", damping: 22, stiffness: 160 },
          }}
          style={{
            transformStyle: "preserve-3d",
            transformOrigin: "50% 60%",
            willChange: "transform",
          }}
          aria-hidden
        >
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#f1f5f9" />
            </linearGradient>
            <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#475569" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
            <linearGradient id="fascia" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fafafa" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </linearGradient>
            <linearGradient id="siding" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e7e5e4" />
              <stop offset="100%" stopColor="#a8a29e" />
            </linearGradient>
            <linearGradient id="gutter-top" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(0,0,0,0.62)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
            </linearGradient>
            {/* K-style front face: light/shadow bands that follow the
                real ogee — bright squared lip, shadowed cavetto, lit
                belly, dark tuck under the bottom. */}
            <linearGradient id="k-face" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
              <stop offset="10%" stopColor="rgba(255,255,255,0.12)" />
              <stop offset="30%" stopColor="rgba(0,0,0,0.26)" />
              <stop offset="56%" stopColor="rgba(255,255,255,0.28)" />
              <stop offset="78%" stopColor="rgba(0,0,0,0.08)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.38)" />
            </linearGradient>
            {/* Half-round front face: half-cylinder lit from above. */}
            <linearGradient id="hr-face" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
              <stop offset="18%" stopColor="rgba(255,255,255,0.22)" />
              <stop offset="48%" stopColor="rgba(255,255,255,0)" />
              <stop offset="82%" stopColor="rgba(0,0,0,0.24)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.42)" />
            </linearGradient>
            <linearGradient id="metal-strip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
            <pattern id="guard-screen" width="5.5" height="5.5" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="5.5" y2="0" stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />
              <line x1="0" y1="0" x2="0" y2="5.5" stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />
            </pattern>
            <pattern id="guard-mesh" width="3" height="3" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="3" y2="0" stroke="rgba(0,0,0,0.55)" strokeWidth="0.45" />
              <line x1="0" y1="0" x2="0" y2="3" stroke="rgba(0,0,0,0.55)" strokeWidth="0.45" />
            </pattern>
            <pattern id="guard-micro" width="1.8" height="1.8" patternUnits="userSpaceOnUse">
              <circle cx="0.9" cy="0.9" r="0.4" fill="rgba(0,0,0,0.6)" />
            </pattern>
            <marker
              id="gp-arrow"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 Z" fill="#0284c7" />
            </marker>
            <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
              <feOffset dx="0" dy="3" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.34" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <style>{`@media (prefers-reduced-motion: no-preference){.gp-flow{animation:gp-flowdash 1.5s linear infinite}@keyframes gp-flowdash{to{stroke-dashoffset:-22}}}`}</style>
          </defs>

          {/* Sky + sun peeking over the ridge */}
          <rect x="0" y="0" width="500" height="360" fill="url(#sky)" />
          <circle cx="150" cy="34" r="26" fill="rgba(254,243,199,0.6)" />
          <circle cx="150" cy="34" r="14" fill="rgba(253,224,71,0.6)" />

          {/* ───── ROOF PLANE ───── */}
          <g>
            <polygon
              points={`${eaveAx},${eaveY} ${eaveBx},${eaveY} ${eaveBx + SLX},${eaveY + SLY} ${eaveAx + SLX},${eaveY + SLY}`}
              fill="url(#roof)"
            />
            {/* Shingle courses parallel to the eave, staggered tabs */}
            {[0.14, 0.3, 0.46, 0.62, 0.78].map((f, ci) => (
              <g key={`course-${ci}`}>
                <line
                  x1={eaveAx + SLX * f}
                  y1={eaveY + SLY * f}
                  x2={eaveBx + SLX * f}
                  y2={eaveY + SLY * f}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth="0.9"
                />
                {Array.from({ length: 8 }, (_, ti) => {
                  const u = 0.06 + ti * 0.115 + (ci % 2) * 0.055;
                  if (u > 0.96) return null;
                  const a = roofPt(u, f);
                  const b = roofPt(u, f + 0.05);
                  return (
                    <line
                      key={`tab-${ci}-${ti}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgba(0,0,0,0.3)"
                      strokeWidth="0.7"
                    />
                  );
                })}
              </g>
            ))}
            {/* Ridge highlight */}
            <line
              x1={eaveAx + SLX}
              y1={eaveY + SLY}
              x2={eaveBx + SLX}
              y2={eaveY + SLY}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1.2"
            />
            {/* Roof deck edge at the eave — the dark board the drip
                edge covers when it's added */}
            <polygon
              points={`${eaveAx},${eaveY} ${eaveBx},${eaveY} ${eaveBx},${eaveY + 5} ${eaveAx},${eaveY + 5}`}
              fill="#0f172a"
              opacity="0.8"
            />

            {/* Snow guards: two staggered rows of pads on the roof */}
            {acc?.iceGuard &&
              [0.32, 0.46].map((f, ri) =>
                Array.from({ length: 6 }, (_, i) => {
                  const p = roofPt(0.1 + i * 0.13 + ri * 0.06, f);
                  return (
                    <rect
                      key={`snow-${ri}-${i}`}
                      x={p.x - 4}
                      y={p.y - 2}
                      width="8"
                      height="4"
                      rx="1.2"
                      fill="#e2e8f0"
                      stroke="rgba(0,0,0,0.45)"
                      strokeWidth="0.5"
                    />
                  );
                }),
              )}

            {/* Heat cable: red zigzag along the eave courses */}
            {acc?.heatTape && (
              <polyline
                points={Array.from({ length: 11 }, (_, i) => {
                  const p = roofPt(0.08 + i * 0.062, i % 2 === 0 ? 0.02 : 0.13);
                  return `${p.x},${p.y}`;
                }).join(" ")}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.7"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.95"
              />
            )}

            {/* Drip edge — on-roof flange under the first course */}
            {acc?.dripEdge && (
              <polygon
                points={`${eaveAx},${eaveY} ${eaveBx},${eaveY} ${eaveBx + SLX * 0.09},${eaveY + SLY * 0.09} ${eaveAx + SLX * 0.09},${eaveY + SLY * 0.09}`}
                fill="url(#metal-strip)"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="0.6"
                opacity="0.95"
              />
            )}

            <text
              x={roofPt(0.78, 0.55).x}
              y={roofPt(0.78, 0.55).y}
              fontSize="8"
              fontWeight="700"
              letterSpacing="1.5"
              fill="rgba(255,255,255,0.45)"
              textAnchor="middle"
            >
              ROOF
            </text>
          </g>

          {/* ───── FASCIA + WALL + CORNER ───── */}
          <rect
            x={gutterLeft - 6}
            y={eaveY + 5}
            width={cornerX - gutterLeft + 6}
            height={fasciaBot - (eaveY + 5)}
            fill="url(#fascia)"
            stroke="rgba(0,0,0,0.25)"
            strokeWidth="0.8"
          />
          {/* House corner return — the wall turning away */}
          <polygon
            points={`${cornerX},${eaveY + 5} ${cornerX + 7},${eaveY + 0.2} ${cornerX + 7},${groundY - 4.8} ${cornerX},${groundY}`}
            fill="#78716c"
            stroke="rgba(0,0,0,0.3)"
            strokeWidth="0.6"
          />
          {/* Wall siding */}
          <rect
            x={gutterLeft - 6}
            y={fasciaBot}
            width={cornerX - gutterLeft + 6}
            height={groundY - fasciaBot}
            fill="url(#siding)"
          />
          {Array.from({ length: 9 }, (_, i) => (
            <line
              key={`siding-${i}`}
              x1={gutterLeft - 6}
              y1={fasciaBot + 10 + i * 14}
              x2={cornerX}
              y2={fasciaBot + 10 + i * 14}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth="0.7"
            />
          ))}
          {/* Soffit shadow under the fascia board */}
          <line
            x1={gutterLeft - 6}
            y1={fasciaBot}
            x2={cornerX}
            y2={fasciaBot}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="1.2"
          />
          <text
            x={gutterLeft + 20}
            y={gutterTop + H + 11}
            fontSize="6.5"
            fontWeight="700"
            letterSpacing="1.2"
            fill="rgba(0,0,0,0.35)"
          >
            FASCIA
          </text>

          {/* Ground / grass */}
          <rect x="0" y={groundY} width="500" height={360 - groundY} fill="#86efac" opacity="0.55" />
          <line x1="0" y1={groundY} x2="500" y2={groundY} stroke="rgba(0,0,0,0.2)" strokeWidth="0.6" />
          {Array.from({ length: 24 }, (_, i) => (
            <line
              key={`grass-${i}`}
              x1={i * 21 + 4}
              y1={groundY}
              x2={i * 21 + 6}
              y2={groundY - 4}
              stroke="rgba(22,101,52,0.5)"
              strokeWidth="0.7"
            />
          ))}

          {/* ───── GUTTER ASSEMBLY ───── */}
          <g filter="url(#soft-shadow)">
            {/* Top opening — the dark trough you look down into */}
            <polygon
              points={`${gutterLeft},${gutterTop} ${gutterRightX},${gutterTop} ${gutterRightX + perspX},${gutterTop + perspY} ${gutterLeft + perspX},${gutterTop + perspY}`}
              fill="url(#gutter-top)"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="1"
            />

            {/* Heat cable running the trough (visible open section) */}
            {acc?.heatTape && (
              <line
                x1={(guardOn ? coverX : gutterLeft) + 10 + perspX * 0.5}
                y1={gutterTop + perspY * 0.5 - 1}
                x2={outletCenterX + perspX * 0.4}
                y2={gutterTop + perspY * 0.5 - 1}
                stroke="#ef4444"
                strokeWidth="1.7"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}

            {/* Hangers: hidden-hanger straps across a K-style trough;
                external band + rod brackets on half-round */}
            {!halfRound &&
              [0.18, 0.44, 0.7].map((t, i) => {
                const hx = gutterLeft + gutterLen * (guardOn ? 0.66 + t * 0.28 : t);
                return (
                  <g key={`hanger-${i}`}>
                    <line
                      x1={hx}
                      y1={gutterTop + 2}
                      x2={hx + perspX}
                      y2={gutterTop + perspY + 2}
                      stroke="rgba(30,41,59,0.75)"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    />
                    <circle cx={hx + perspX} cy={gutterTop + perspY + 2} r="1.3" fill="#0f172a" />
                  </g>
                );
              })}

            {/* Leaf guard: covers the far section of the opening, the
                outlet end stays open so the trough is still readable */}
            {guardOn && (
              <g>
                <polygon
                  points={`${gutterLeft + 2},${gutterTop + 0.5} ${coverX},${gutterTop + 0.5} ${coverX + perspX},${gutterTop + perspY + 0.5} ${gutterLeft + 2 + perspX},${gutterTop + perspY + 0.5}`}
                  fill={hex}
                  opacity="0.55"
                />
                <polygon
                  points={`${gutterLeft + 2},${gutterTop + 0.5} ${coverX},${gutterTop + 0.5} ${coverX + perspX},${gutterTop + perspY + 0.5} ${gutterLeft + 2 + perspX},${gutterTop + perspY + 0.5}`}
                  fill={
                    guardTier === "screen"
                      ? "url(#guard-screen)"
                      : guardTier === "mesh"
                        ? "url(#guard-mesh)"
                        : "url(#guard-micro)"
                  }
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth="0.8"
                />
                {/* Cut edge of the guard panel */}
                <line
                  x1={coverX}
                  y1={gutterTop + 0.5}
                  x2={coverX + perspX}
                  y2={gutterTop + perspY + 0.5}
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth="1.4"
                />
              </g>
            )}

            {/* Drip edge — metal lip visible over the gutter's back rim */}
            {acc?.dripEdge && (
              <polygon
                points={`${gutterLeft + perspX - 3},${gutterTop + perspY - 4} ${gutterRightX + perspX + 3},${gutterTop + perspY - 4} ${gutterRightX + perspX + 3},${gutterTop + perspY + 1.5} ${gutterLeft + perspX - 3},${gutterTop + perspY + 1.5}`}
                fill="url(#metal-strip)"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.6"
              />
            )}

            {/* Left end cap — closed profile */}
            <path
              d={halfRound ? hrSection(mCap, D) : kSection(mCap, D, H)}
              fill={hex}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="0.9"
            />
            <path
              d={halfRound ? hrSection(mCap, D) : kSection(mCap, D, H)}
              fill="rgba(0,0,0,0.16)"
            />

            {/* Front face of the run */}
            <rect
              x={gutterLeft}
              y={gutterTop}
              width={gutterLen}
              height={H}
              fill={hex}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="1"
            />
            <rect
              x={gutterLeft}
              y={gutterTop}
              width={gutterLen}
              height={H}
              fill={halfRound ? "url(#hr-face)" : "url(#k-face)"}
              pointerEvents="none"
            />
            {halfRound ? (
              // Rolled bead along the top rim
              <>
                <rect
                  x={gutterLeft}
                  y={gutterTop}
                  width={gutterLen}
                  height="3.2"
                  fill="rgba(255,255,255,0.5)"
                />
                <line
                  x1={gutterLeft}
                  y1={gutterTop + 3.4}
                  x2={gutterRightX}
                  y2={gutterTop + 3.4}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="0.7"
                />
              </>
            ) : (
              // Ogee crease lines: cavetto shadow + belly highlight
              <>
                <line
                  x1={gutterLeft}
                  y1={gutterTop + H * 0.36}
                  x2={gutterRightX}
                  y2={gutterTop + H * 0.36}
                  stroke="rgba(0,0,0,0.2)"
                  strokeWidth="0.7"
                />
                <line
                  x1={gutterLeft}
                  y1={gutterTop + H * 0.68}
                  x2={gutterRightX}
                  y2={gutterTop + H * 0.68}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth="0.7"
                />
              </>
            )}
            {/* Front lip highlight */}
            <line
              x1={gutterLeft}
              y1={gutterTop + 1.2}
              x2={gutterRightX}
              y2={gutterTop + 1.2}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="1"
            />

            {/* Half-round external brackets: band on the face + rod up
                to the fascia (shank-and-circle hangers) */}
            {halfRound &&
              [0.18, 0.44, 0.7].map((t, i) => {
                const hx = gutterLeft + gutterLen * (guardOn ? 0.66 + t * 0.28 : t);
                return (
                  <g key={`hr-brk-${i}`}>
                    <rect
                      x={hx - 1.4}
                      y={gutterTop + 1}
                      width="2.8"
                      height={H - 2}
                      rx="1.2"
                      fill="rgba(30,41,59,0.55)"
                    />
                    <line
                      x1={hx + perspX}
                      y1={gutterTop + perspY + 1}
                      x2={hx + perspX}
                      y2={gutterTop + perspY - 6}
                      stroke="rgba(30,41,59,0.8)"
                      strokeWidth="1.6"
                    />
                  </g>
                );
              })}

            {/* Cut end (right): the TRUE cross-section, open, with the
                metal rim + dark cavity */}
            <path
              d={halfRound ? hrSection(mEnd, D) : kSection(mEnd, D, H)}
              fill={hex}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth="1.1"
            />
            <path
              d={
                halfRound
                  ? hrCavity(mEnd, D)
                  : kSection(inset(mEnd), D, H)
              }
              fill="rgba(15,23,42,0.75)"
            />
            {/* Rolled bead on the half-round's front rim */}
            {halfRound && (
              <circle
                cx={gutterRightX}
                cy={gutterTop + 1.5}
                r="2.6"
                fill={hex}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth="0.8"
              />
            )}
          </g>

          {/* ───── WATER-FLOW ARROWS (roof → gutter → down → out) ───── */}
          <g
            stroke="#0284c7"
            strokeWidth="2"
            fill="none"
            opacity="0.65"
            strokeLinecap="round"
            strokeDasharray="6 5"
          >
            <path
              className="gp-flow"
              d={`M ${roofPt(0.62, 0.5).x} ${roofPt(0.62, 0.5).y} L ${roofPt(0.62, 0.12).x} ${roofPt(0.62, 0.12).y}`}
              markerEnd="url(#gp-arrow)"
            />
            <path
              className="gp-flow"
              d={`M ${(guardOn ? coverX + 16 : gutterLeft + 36) + perspX * 0.5} ${gutterTop + perspY * 0.5 + 2} L ${outletCenterX + perspX * 0.5 - 10} ${gutterTop + perspY * 0.5 + 2}`}
              markerEnd="url(#gp-arrow)"
            />
            {useRainChain ? (
              <path
                className="gp-flow"
                d={`M ${outletCenterX + 12} ${outletY + 24} L ${outletCenterX + 12} ${kickBot - 8}`}
                markerEnd="url(#gp-arrow)"
              />
            ) : (
              <path
                className="gp-flow"
                d={`M ${mouthX + 4} ${kickBot - 4} Q ${mouthX + 16} ${kickBot + 2} ${mouthX + 19} ${groundY - 12}`}
                markerEnd="url(#gp-arrow)"
              />
            )}
          </g>

          {/* ───── DOWNSPOUT or RAIN CHAIN ───── */}
          {useRainChain ? (
            <g filter="url(#soft-shadow)">
              {Array.from({ length: 8 }, (_, i) => {
                const cy = outletY + 12 + i * 19;
                return (
                  <g key={`chain-${i}`}>
                    {/* Cup: small flared bell */}
                    <path
                      d={`M ${outletCenterX - 6} ${cy} L ${outletCenterX + 6} ${cy} L ${outletCenterX + 4} ${cy + 9} L ${outletCenterX - 4} ${cy + 9} Z`}
                      fill="#b87333"
                      stroke="rgba(0,0,0,0.4)"
                      strokeWidth="0.6"
                    />
                    <ellipse
                      cx={outletCenterX}
                      cy={cy}
                      rx="6"
                      ry="1.8"
                      fill="#d99a5b"
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth="0.5"
                    />
                    <line
                      x1={outletCenterX}
                      y1={cy + 9}
                      x2={outletCenterX}
                      y2={cy + 19}
                      stroke="#b87333"
                      strokeWidth="1.4"
                    />
                  </g>
                );
              })}
            </g>
          ) : (
            <g filter="url(#soft-shadow)">
              {/* Outlet notch punched in the gutter bottom edge */}
              <rect
                x={outletCenterX - dsW / 2 - 2}
                y={outletY - 2.5}
                width={dsW + 4}
                height="5"
                rx="1"
                fill="rgba(0,0,0,0.65)"
              />

              {/* 1. Drop tube out of the gutter floor */}
              {renderPipe(outletCenterX - dsW / 2, dropTop, dsW, dropBot - dropTop)}
              {crimp(outletCenterX - dsW / 2, dropBot - 3, dsW)}

              {/* 2. Offset elbow jogging to the wall line */}
              <polygon
                points={`${outletCenterX - dsW / 2},${dropBot} ${outletCenterX + dsW / 2},${dropBot} ${runLeft + dsW},${runTop} ${runLeft},${runTop}`}
                fill={hex}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth="1"
              />
              <polygon
                points={`${outletCenterX - dsW / 2},${dropBot} ${outletCenterX + dsW / 2},${dropBot} ${runLeft + dsW},${runTop} ${runLeft},${runTop}`}
                fill="rgba(0,0,0,0.12)"
              />
              {!dsRound && (
                <>
                  <polygon
                    points={`${outletCenterX + dsW / 2},${dropBot} ${outletCenterX + dsW / 2 + dpx},${dropBot + dpy} ${runLeft + dsW + dpx},${runTop + dpy} ${runLeft + dsW},${runTop}`}
                    fill={hex}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="0.7"
                  />
                  <polygon
                    points={`${outletCenterX + dsW / 2},${dropBot} ${outletCenterX + dsW / 2 + dpx},${dropBot + dpy} ${runLeft + dsW + dpx},${runTop + dpy} ${runLeft + dsW},${runTop}`}
                    fill="rgba(0,0,0,0.34)"
                  />
                </>
              )}
              {dsRound && (
                <ellipse
                  cx={(outletCenterX + runLeft + dsW / 2) / 2}
                  cy={(dropBot + runTop) / 2}
                  rx={dsW / 2 + 1}
                  ry="2.6"
                  fill="none"
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth="0.9"
                />
              )}
              {crimp(runLeft, runTop + 1, dsW)}

              {/* 3. Vertical run down the wall */}
              {renderPipe(runLeft, runTop, dsW, runBot - runTop)}

              {/* Top face: parallelogram (box) or ellipse (round) —
                  the direct "square vs round pipe" cue */}
              {dsRound ? (
                <ellipse
                  cx={runLeft + dsW / 2}
                  cy={runTop}
                  rx={dsW / 2 - 0.5}
                  ry="3.2"
                  fill="rgba(0,0,0,0.45)"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth="0.7"
                />
              ) : (
                <polygon
                  points={`${runLeft},${runTop} ${runLeft + dsW},${runTop} ${runLeft + dsW + dpx},${runTop + dpy} ${runLeft + dpx},${runTop + dpy}`}
                  fill="rgba(0,0,0,0.45)"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth="0.7"
                />
              )}

              {/* Round → seam rings. Box → wall straps with screws. */}
              {dsRound
                ? [0.2, 0.5, 0.8].map((t, i) => (
                    <ellipse
                      key={`ring-${i}`}
                      cx={runLeft + dsW / 2}
                      cy={runTop + (runBot - runTop) * t}
                      rx={dsW / 2 + 1.5}
                      ry="2.8"
                      fill="none"
                      stroke="rgba(0,0,0,0.5)"
                      strokeWidth="1"
                    />
                  ))
                : [0.26, 0.66].map((t, i) => {
                    const strapY = runTop + (runBot - runTop) * t - 1;
                    return (
                      <g key={`strap-${i}`}>
                        <rect
                          x={runLeft - 4}
                          y={strapY}
                          width={dsW + dpx + 8}
                          height="3.4"
                          rx="1"
                          fill="rgba(30,41,59,0.6)"
                        />
                        <circle cx={runLeft - 2} cy={strapY + 1.7} r="0.9" fill="#0f172a" />
                        <circle cx={runLeft + dsW + dpx + 2} cy={strapY + 1.7} r="0.9" fill="#0f172a" />
                      </g>
                    );
                  })}

              {/* Crimp seams on box pipe faces */}
              {!dsRound &&
                [0.44].map((t, i) => (
                  <line
                    key={`crimp-${i}`}
                    x1={runLeft + 1}
                    y1={runTop + (runBot - runTop) * t}
                    x2={runLeft + dsW - 1}
                    y2={runTop + (runBot - runTop) * t}
                    stroke="rgba(0,0,0,0.22)"
                    strokeWidth="0.5"
                  />
                ))}
              {crimp(runLeft, runBot - 3.5, dsW)}

              {/* 4. Kick-out elbow + open mouth showing the bore */}
              <polygon
                points={`${runLeft},${runBot} ${runLeft + dsW},${runBot} ${runLeft + dsW + 14},${kickBot} ${runLeft + 14},${kickBot}`}
                fill={hex}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth="1"
              />
              <polygon
                points={`${runLeft},${runBot} ${runLeft + dsW},${runBot} ${runLeft + dsW + 14},${kickBot} ${runLeft + 14},${kickBot}`}
                fill="rgba(0,0,0,0.1)"
              />
              {!dsRound && (
                <>
                  <polygon
                    points={`${runLeft + dsW},${runBot} ${runLeft + dsW + dpx},${runBot + dpy} ${runLeft + dsW + 14 + dpx},${kickBot + dpy} ${runLeft + dsW + 14},${kickBot}`}
                    fill={hex}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="0.7"
                  />
                  <polygon
                    points={`${runLeft + dsW},${runBot} ${runLeft + dsW + dpx},${runBot + dpy} ${runLeft + dsW + 14 + dpx},${kickBot + dpy} ${runLeft + dsW + 14},${kickBot}`}
                    fill="rgba(0,0,0,0.34)"
                  />
                </>
              )}
              {dsRound ? (
                <ellipse
                  cx={mouthX}
                  cy={kickBot}
                  rx={dsW / 2 - 1}
                  ry="3.2"
                  fill="rgba(15,23,42,0.8)"
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth="0.6"
                />
              ) : (
                <polygon
                  points={`${runLeft + 14},${kickBot} ${runLeft + 14 + dsW},${kickBot} ${runLeft + 14 + dsW + dpx * 0.7},${kickBot + dpy * 0.7} ${runLeft + 14 + dpx * 0.7},${kickBot + dpy * 0.7}`}
                  fill="rgba(15,23,42,0.8)"
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth="0.6"
                />
              )}
            </g>
          )}

          {/* Splash block on the grass under the water exit */}
          <g>
            <polygon
              points={`${splashX - 20},${groundY - 12} ${splashX + 26},${groundY - 12} ${splashX + 32},${groundY - 4} ${splashX - 26},${groundY - 4}`}
              fill="#cbd5e1"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="0.7"
            />
            <polygon
              points={`${splashX - 26},${groundY - 4} ${splashX + 32},${groundY - 4} ${splashX + 32},${groundY + 3} ${splashX - 26},${groundY + 3}`}
              fill="#94a3b8"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="0.7"
            />
            {[0, 1, 2].map((i) => (
              <line
                key={`sb-${i}`}
                x1={splashX - 14 + i * 16}
                y1={groundY - 11}
                x2={splashX - 10 + i * 16}
                y2={groundY - 5}
                stroke="rgba(0,0,0,0.2)"
                strokeWidth="0.7"
              />
            ))}
          </g>

          {/* ───── CROSS-SECTION BADGE: profile + downspout bore ───── */}
          <g transform="translate(449, 74)">
            <rect
              x="-36"
              y="-30"
              width="72"
              height={useRainChain ? 52 : 96}
              rx="8"
              fill="rgba(255,255,255,0.95)"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="1"
            />
            <text
              x="0"
              y="-19"
              textAnchor="middle"
              fontSize="6"
              fontWeight="700"
              fill="rgba(0,0,0,0.55)"
              letterSpacing="0.6"
            >
              CROSS-SECTION
            </text>
            {/* Gutter profile, flat (un-skewed) */}
            <path
              d={
                halfRound
                  ? hrSection(flatAt(0, -1, 30 / D), D)
                  : kSection(flatAt(0, -1, 30 / D), D, H)
              }
              fill={hex}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="1"
            />
            <text x="0" y="13" textAnchor="middle" fontSize="7" fontWeight="600" fill="#0f172a">
              {config.size}″ {halfRound ? "half-round" : "K-style"}
            </text>
            {!useRainChain && (
              <>
                <line x1="-26" y1="19" x2="26" y2="19" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                {dsRound ? (
                  <circle
                    cx="0"
                    cy="37"
                    r={ds === "round-3" ? 8 : 10.5}
                    fill={hex}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="1.2"
                  />
                ) : (
                  <rect
                    x={ds === "2x3" ? -5 : -6.5}
                    y={ds === "2x3" ? 29.5 : 27.5}
                    width={ds === "2x3" ? 10 : 13}
                    height={ds === "2x3" ? 15 : 19}
                    fill={hex}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="1.2"
                    rx="0.5"
                  />
                )}
                <text x="0" y="58" textAnchor="middle" fontSize="7" fontWeight="600" fill="#0f172a">
                  {dsLabel} downspout
                </text>
              </>
            )}
          </g>

          {/* ───── CALLOUTS ───── */}
          {/* Gutter: points at the visible cut-end profile */}
          <g>
            <line
              x1={gutterRightX + perspX * 0.6}
              y1={gutterTop + perspY * 0.3 + H * 0.4}
              x2={340}
              y2={116}
              stroke="rgba(0,0,0,0.45)"
              strokeWidth="0.7"
            />
            <rect
              x={294}
              y={96}
              width="112"
              height="21"
              rx="5"
              fill="rgba(255,255,255,0.95)"
              stroke="rgba(0,0,0,0.18)"
            />
            <text
              x={350}
              y={110}
              textAnchor="middle"
              fontSize="9.5"
              fontFamily="ui-sans-serif, system-ui"
              fill="#0f172a"
              fontWeight="700"
            >
              {config.size}″ {halfRound ? "Half-Round" : "K-Style"} gutter
            </text>
          </g>

          {/* Downspout */}
          {!useRainChain && (
            <g>
              <line
                x1={runLeft + dsW + dpx + 3}
                y1={(runTop + runBot) / 2}
                x2={runLeft + dsW + dpx + 42}
                y2={(runTop + runBot) / 2 - 14}
                stroke="rgba(0,0,0,0.45)"
                strokeWidth="0.7"
              />
              <rect
                x={runLeft + dsW + dpx + 40}
                y={(runTop + runBot) / 2 - 26}
                width="104"
                height="21"
                rx="5"
                fill="rgba(255,255,255,0.95)"
                stroke="rgba(0,0,0,0.18)"
              />
              <text
                x={runLeft + dsW + dpx + 92}
                y={(runTop + runBot) / 2 - 12}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily="ui-sans-serif, system-ui"
                fill="#0f172a"
                fontWeight="700"
              >
                {dsLabel} downspout
              </text>
            </g>
          )}

          {/* Rain chain */}
          {useRainChain && (
            <g>
              <line
                x1={outletCenterX + 8}
                y1={250}
                x2={outletCenterX + 64}
                y2={230}
                stroke="rgba(0,0,0,0.5)"
                strokeWidth="0.7"
              />
              <rect
                x={outletCenterX + 56}
                y={216}
                width="100"
                height="21"
                rx="5"
                fill="rgba(255,255,255,0.95)"
                stroke="rgba(0,0,0,0.18)"
              />
              <text
                x={outletCenterX + 106}
                y={230}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily="ui-sans-serif, system-ui"
                fill="#0f172a"
                fontWeight="700"
              >
                Copper rain chain
              </text>
            </g>
          )}

          {/* Accessory chips, stacked top-left with leader lines */}
          {chips.map((c, i) => {
            const cw = c.label.length * 4.4 + 12;
            const cy = 16 + i * 20;
            return (
              <g key={c.label}>
                <line
                  x1={10 + cw}
                  y1={cy + 7.5}
                  x2={c.tx}
                  y2={c.ty}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth="0.7"
                />
                <circle cx={c.tx} cy={c.ty} r="1.6" fill="rgba(0,0,0,0.55)" />
                <rect
                  x={10}
                  y={cy}
                  width={cw}
                  height="15"
                  rx="4"
                  fill="rgba(255,255,255,0.94)"
                  stroke="rgba(0,0,0,0.2)"
                  strokeWidth="0.7"
                />
                <text
                  x={10 + cw / 2}
                  y={cy + 10.5}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="600"
                  fill="#0f172a"
                >
                  {c.label}
                </text>
              </g>
            );
          })}
        </motion.svg>

        <div className="absolute bottom-2 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-200">
          <span
            className="h-2 w-2 rounded-full ring-1 ring-inset ring-white/50"
            style={{ background: hex }}
          />
          {color?.name ?? "Custom color"}
        </div>
        <div className="absolute bottom-2 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-200">
          3/4 perspective · approx scale
          {angle !== 0 && (
            <span className="text-zinc-500">
              · {Math.round(((angle % 360) + 540) % 360 - 180)}°
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
