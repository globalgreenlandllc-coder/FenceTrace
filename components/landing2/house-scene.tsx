"use client";

import { useCallback, useRef } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

export type SceneTab = "Detection" | "Measurement" | "Pricing" | "Proposal";

const INK = "#0C1B24";
const INK_SOFT = "#10475E";
const WATER = "#1479B8";
const ACCENT = "#14688C";
const SANS = "var(--font-inter), sans-serif";

/** White rounded chip rendered inside the SVG scene. */
function SvgChip({
  x,
  y,
  w,
  label,
  delay = 0,
  filled = false,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  delay?: number;
  filled?: boolean;
}) {
  return (
    <g className="ls-pop" style={{ animationDelay: `${delay}s` }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={28}
        rx={14}
        fill={filled ? ACCENT : "#ffffff"}
        stroke={filled ? ACCENT : INK}
        strokeWidth="2"
      />
      <text
        x={x + w / 2}
        y={y + 18.5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill={filled ? "#ffffff" : INK}
        fontFamily={SANS}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Animated hero scene v2: rain falls on a hip roof, water runs along the
 * gutter into the downspout with a splash — always. The active pipeline tab
 * layers its own overlay on top: Detection traces the roof perimeter,
 * Measurement pops dimension labels and the "186 LF" tag, Pricing drops
 * per-run price chips, Proposal slides a mini proposal card over the scene.
 * Pointer parallax shifts the layers by a few px (spring-damped, disabled
 * for reduced motion).
 */
export function HouseScene({ tab = "Detection" }: { tab?: SceneTab }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 16 });
  const sy = useSpring(my, { stiffness: 120, damping: 16 });
  // Layer depths: rain drifts the most, the house barely, tags in between.
  const rainX = useTransform(sx, (v) => v * 1.2);
  const rainY = useTransform(sy, (v) => v * 1.2);
  const houseX = useTransform(sx, (v) => v * 0.45);
  const houseY = useTransform(sy, (v) => v * 0.45);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduceMotion) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      mx.set(((e.clientX - rect.left) / rect.width - 0.5) * 12); // ±6px
      my.set(((e.clientY - rect.top) / rect.height - 0.5) * 12);
    },
    [mx, my, reduceMotion],
  );
  const onPointerLeave = useCallback(() => {
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  const drops = [
    { x: 150, d: "0s" },
    { x: 195, d: "0.5s" },
    { x: 240, d: "0.9s" },
    { x: 285, d: "0.2s" },
    { x: 330, d: "0.7s" },
    { x: 375, d: "1.1s" },
    { x: 420, d: "0.35s" },
    { x: 462, d: "0.85s" },
  ];

  return (
    <div
      ref={wrapRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="relative w-full max-w-2xl"
    >
      <svg
        viewBox="0 0 600 340"
        className="w-full"
        role="img"
        aria-label="Animated demo: rain runs off a stylized house while overlays trace, measure, and price the property"
      >
        {/* rain */}
        <motion.g style={{ x: rainX, y: rainY }}>
          <g stroke={WATER} strokeWidth="2.5" strokeLinecap="round" opacity="0.75">
            {drops.map((r) => (
              <line
                key={r.x}
                x1={r.x}
                y1="18"
                x2={r.x - 5}
                y2="34"
                className="anim-rain"
                style={{ animationDelay: r.d }}
              />
            ))}
          </g>
        </motion.g>

        <motion.g style={{ x: houseX, y: houseY }}>
          {/* house body */}
          <rect x="160" y="160" width="280" height="120" fill="#ffffff" fillOpacity="0.92" stroke={INK} strokeWidth="2.5" />
          {/* door + windows */}
          <rect x="282" y="212" width="36" height="68" fill="none" stroke={INK} strokeWidth="2" />
          <circle cx="311" cy="248" r="2" fill={INK} />
          <rect x="192" y="192" width="44" height="36" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M192 210h44M214 192v36" stroke={INK} strokeWidth="1.4" />
          <rect x="364" y="192" width="44" height="36" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M364 210h44M386 192v36" stroke={INK} strokeWidth="1.4" />

          {/* hip roof */}
          <path d="M138 158 L212 92 L388 92 L462 158 Z" fill="#082733" />
          <path d="M212 92 L388 92" stroke={INK_SOFT} strokeWidth="2" />

          {/* gutter run along the eave */}
          <rect x="132" y="156" width="336" height="10" rx="5" fill="#ffffff" stroke={INK} strokeWidth="2.5" />
          {/* downspout */}
          <rect x="450" y="166" width="10" height="116" rx="4" fill="#ffffff" stroke={INK} strokeWidth="2.5" />

          {/* water flowing: gutter -> corner -> downspout (all tabs) */}
          <path
            d="M140 161 H452 M455 170 V276"
            fill="none"
            stroke={WATER}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="10 14"
            className="anim-flow"
          />
          {/* splash at the outlet */}
          <g className="anim-splash">
            <circle cx="455" cy="288" r="7" fill="none" stroke={WATER} strokeWidth="2.5" />
          </g>
          <path d="M100 292 H520" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />

          {/* ------ tab overlays (inside the house layer so they track it) ------ */}
          {tab === "Detection" && (
            <g key="detection">
              {/* animated perimeter trace around the detected roof */}
              <path
                d="M138 158 L212 92 L388 92 L462 158 Z"
                fill="none"
                stroke={ACCENT}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeDasharray="900"
                className="anim-trace"
              />
              {[
                [138, 158],
                [212, 92],
                [388, 92],
                [462, 158],
              ].map(([x, y], i) => (
                <circle
                  key={`${x}-${y}`}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#ffffff"
                  stroke={ACCENT}
                  strokeWidth="2.5"
                  className="ls-pop"
                  style={{ animationDelay: `${0.1 + i * 0.08}s` }}
                />
              ))}
              <SvgChip x={230} y={116} w={140} label="Home detected" delay={0.25} />
            </g>
          )}

          {tab === "Measurement" && (
            <g key="measurement">
              {/* measuring trace along the eave */}
              <path
                d="M140 186 H460"
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeDasharray="900"
                className="anim-trace"
              />
              <path d="M140 178v16M460 178v16" stroke={ACCENT} strokeWidth="2.5" />
              {/* width dimension under the footprint */}
              <path d="M160 314 H440" stroke={ACCENT} strokeWidth="1.5" />
              <path d="M160 308v12M440 308v12" stroke={ACCENT} strokeWidth="1.5" />
              <g className="ls-pop" style={{ animationDelay: "0.2s" }}>
                <rect x="266" y="304" width="68" height="20" rx="10" fill="#ffffff" stroke={ACCENT} strokeWidth="1.5" />
                <text x="300" y="318" textAnchor="middle" fontSize="11" fontWeight="600" fill={ACCENT} fontFamily={SANS}>
                  42 FT
                </text>
              </g>
              {/* floating LF tag */}
              <g className="anim-float">
                <g className="ls-pop" style={{ animationDelay: "0.1s" }}>
                  <rect x="242" y="118" width="116" height="30" rx="15" fill="#ffffff" stroke={INK} strokeWidth="2" />
                  <circle cx="262" cy="133" r="4" fill={ACCENT} />
                  <text x="274" y="138" fontSize="14" fontWeight="700" fill={INK} fontFamily={SANS}>
                    186 LF
                  </text>
                </g>
              </g>
            </g>
          )}

          {tab === "Pricing" && (
            <g key="pricing">
              <path
                d="M140 186 H460"
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeDasharray="6 8"
              />
              <SvgChip x={160} y={112} w={122} label="$28.50 / LF" delay={0.05} />
              <SvgChip x={300} y={112} w={150} label="186 LF × $28.50" delay={0.18} />
              <SvgChip x={382} y={232} w={104} label="$5,301" delay={0.32} filled />
            </g>
          )}
        </motion.g>
      </svg>

      {/* Proposal tab: mini proposal card slides over the scene */}
      <AnimatePresence>
        {tab === "Proposal" && (
          <motion.div
            key="proposal-card"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-[min(300px,88%)] rounded-2xl border border-zinc-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-24px_rgba(12,27,36,0.35)] backdrop-blur">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Proposal ready
              </p>
              <p className="mt-1 text-[15px] font-semibold tracking-tight text-zinc-900">
                1425 Maple Ave
              </p>
              <div className="mt-3 space-y-1.5 border-t border-zinc-200/70 pt-3">
                {[
                  ["Good", "$5,301"],
                  ["Better", "$6,480"],
                  ["Best", "$7,850"],
                ].map(([tier, price]) => (
                  <div
                    key={tier}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="text-zinc-500">{tier}</span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {price}
                    </span>
                  </div>
                ))}
              </div>
              <span
                aria-hidden
                className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-accent-600 text-[13px] font-semibold text-white"
              >
                Accept proposal
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact plan-view roof with a looping trace — used in the Engine section. */
export function PlanTrace() {
  return (
    <svg viewBox="0 0 400 230" className="w-full">
      {/* footprint */}
      <path
        d="M70 50 H250 V95 H330 V190 H70 Z"
        fill="#ffffff"
        stroke="#d4d4d8"
        strokeWidth="2"
      />
      {/* derived skeleton: hips + ridge */}
      <path
        d="M70 50 L110 90 L210 90 L250 50 M110 90 L110 150 L70 190 M110 150 L250 150 M250 150 L290 135 L330 95 M250 150 L250 190 M210 90 L250 150"
        stroke="#d4d4d8"
        strokeWidth="1.4"
        strokeDasharray="4 5"
        fill="none"
      />
      {/* animated eave trace around the perimeter */}
      <path
        d="M70 50 H250 V95 H330 V190 H70 Z"
        fill="none"
        stroke="#1479B8"
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeDasharray="900"
        className="anim-trace"
      />
      {/* corner nodes */}
      {[
        [70, 50],
        [250, 50],
        [250, 95],
        [330, 95],
        [330, 190],
        [70, 190],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#ffffff" stroke="#0C1B24" strokeWidth="2" />
      ))}
      {/* downspout drops */}
      {[
        [70, 50],
        [330, 95],
        [70, 190],
        [250, 190],
      ].map(([x, y]) => (
        <circle key={`d${x}-${y}`} cx={x} cy={y} r="2.5" fill="#14688C" />
      ))}
    </svg>
  );
}
