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
import { DEMO_ADDRESS } from "./demo-property";
import { DEMO_NET_LF, DEMO_PER_LF, DEMO_TIERS, money } from "./demo-figures";

export type SceneTab = "Detection" | "Measurement" | "Pricing" | "Proposal";

const INK = "#0D1B12";
const ACCENT = "#1E7340";
const TRACE = "#3FA65B";
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
 * Animated hero scene: a house sits inside its yard, the county property
 * line glows around it, and a fence builds along the front with a gate —
 * the FenceScan story. The active pipeline tab layers its overlay on
 * top: Detection traces the property boundary, Measurement pops dimension
 * labels and the footage tag, Pricing drops per-run price chips,
 * Proposal slides a mini proposal card over the scene. Pointer parallax
 * shifts the layers by a few px (spring-damped, off for reduced motion).
 */
export function HouseScene({ tab = "Detection" }: { tab?: SceneTab }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 16 });
  const sy = useSpring(my, { stiffness: 120, damping: 16 });
  // Layer depths: the boundary drifts the most, the house barely.
  const lineX = useTransform(sx, (v) => v * 1.2);
  const lineY = useTransform(sy, (v) => v * 1.2);
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

  // Front fence geometry: posts every 40px with rails between; the run
  // leaves a gate opening between x=280 and x=320.
  const postXs = [100, 140, 180, 220, 260, 280, 320, 340, 380, 420, 460, 500];
  const GATE_L = 280;
  const GATE_R = 320;

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
        aria-label="Animated demo: the property line is detected around a stylized yard, a fence with a gate builds along it, and overlays measure and price the job"
      >
        {/* property boundary (drifts most with parallax) */}
        <motion.g style={{ x: lineX, y: lineY }}>
          <rect
            x="88"
            y="72"
            width="424"
            height="220"
            rx="10"
            fill={TRACE}
            fillOpacity="0.05"
            stroke={TRACE}
            strokeWidth="2"
            strokeDasharray="8 7"
          />
        </motion.g>

        <motion.g style={{ x: houseX, y: houseY }}>
          {/* house set back in the yard */}
          <rect
            x="228"
            y="128"
            width="150"
            height="72"
            fill="#ffffff"
            fillOpacity="0.92"
            stroke={INK}
            strokeWidth="2.5"
          />
          <path d="M214 128 L253 96 L353 96 L392 128 Z" fill="#0A2B19" />
          <rect
            x="288"
            y="158"
            width="26"
            height="42"
            fill="none"
            stroke={INK}
            strokeWidth="2"
          />
          <rect
            x="246"
            y="146"
            width="28"
            height="22"
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
          />
          <rect
            x="330"
            y="146"
            width="28"
            height="22"
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
          />

          {/* yard path to the gate */}
          <path
            d="M300 200 L300 258"
            stroke={INK}
            strokeWidth="1.6"
            strokeDasharray="3 5"
            opacity="0.5"
          />

          {/* ---- the fence: front run with a gate ---- */}
          {/* rails */}
          <path
            d={`M100 240 H${GATE_L} M${GATE_R} 240 H500`}
            stroke={INK}
            strokeWidth="2.5"
          />
          <path
            d={`M100 268 H${GATE_L} M${GATE_R} 268 H500`}
            stroke={INK}
            strokeWidth="2.5"
          />
          {/* pickets */}
          {postXs.slice(0, -1).map((x, i) => {
            const next = postXs[i + 1];
            if (x >= GATE_L && next <= GATE_R) return null; // gate opening
            const picks = [];
            for (let px = x + 10; px < next - 4; px += 11) {
              picks.push(
                <line
                  key={px}
                  x1={px}
                  y1={232}
                  x2={px}
                  y2={286}
                  stroke={INK}
                  strokeWidth="1.2"
                  opacity="0.35"
                />,
              );
            }
            return <g key={`p${x}`}>{picks}</g>;
          })}
          {/* posts */}
          {postXs.map((x) => (
            <rect
              key={x}
              x={x - 3.5}
              y={228}
              width={7}
              height={62}
              rx={2}
              fill="#ffffff"
              stroke={INK}
              strokeWidth="2.2"
            />
          ))}
          {/* gate: braced frame swinging slightly open */}
          <g>
            <rect
              x={GATE_L + 6}
              y={234}
              width={GATE_R - GATE_L - 12}
              height={50}
              rx={3}
              fill="#ffffff"
              stroke={INK}
              strokeWidth="2.2"
            />
            <path
              d={`M${GATE_L + 6} 282 L${GATE_R - 6} 236`}
              stroke={INK}
              strokeWidth="1.6"
            />
            <circle cx={GATE_R - 9} cy={258} r={2.2} fill={ACCENT} />
          </g>
          {/* ground */}
          <path
            d="M84 292 H516"
            stroke={INK}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* the AI trace running the fence line (always on — the product motif) */}
          <path
            d={`M100 228 H${GATE_L} M${GATE_R} 228 H500`}
            fill="none"
            stroke={TRACE}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="10 14"
            className="anim-flow"
          />

          {/* ------ tab overlays (inside the house layer so they track it) ------ */}
          {tab === "Detection" && (
            <g key="detection">
              {/* animated trace around the recorded property boundary */}
              <path
                d="M88 72 H512 V292 H88 Z"
                fill="none"
                stroke={ACCENT}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeDasharray="900"
                className="anim-trace"
              />
              {[
                [88, 72],
                [512, 72],
                [512, 292],
                [88, 292],
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
              <SvgChip
                x={218}
                y={36}
                w={164}
                label="Property line found"
                delay={0.25}
              />
            </g>
          )}

          {tab === "Measurement" && (
            <g key="measurement">
              {/* measuring trace along the fence run */}
              <path
                d="M100 214 H500"
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeDasharray="900"
                className="anim-trace"
              />
              <path
                d="M100 206v16M500 206v16"
                stroke={ACCENT}
                strokeWidth="2.5"
              />
              {/* width dimension under the yard */}
              <path d="M120 314 H480" stroke={ACCENT} strokeWidth="1.5" />
              <path
                d="M120 308v12M480 308v12"
                stroke={ACCENT}
                strokeWidth="1.5"
              />
              <g className="ls-pop" style={{ animationDelay: "0.2s" }}>
                <rect
                  x="266"
                  y="304"
                  width="68"
                  height="20"
                  rx="10"
                  fill="#ffffff"
                  stroke={ACCENT}
                  strokeWidth="1.5"
                />
                <text
                  x="300"
                  y="318"
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={ACCENT}
                  fontFamily={SANS}
                >
                  42 FT
                </text>
              </g>
              {/* floating LF tag */}
              <g className="anim-float">
                <g className="ls-pop" style={{ animationDelay: "0.1s" }}>
                  <rect
                    x="242"
                    y="34"
                    width="116"
                    height="30"
                    rx="15"
                    fill="#ffffff"
                    stroke={INK}
                    strokeWidth="2"
                  />
                  <circle cx="262" cy="49" r="4" fill={ACCENT} />
                  <text
                    x="274"
                    y="54"
                    fontSize="14"
                    fontWeight="700"
                    fill={INK}
                    fontFamily={SANS}
                  >
                    {DEMO_NET_LF} LF
                  </text>
                </g>
              </g>
            </g>
          )}

          {tab === "Pricing" && (
            <g key="pricing">
              <path
                d="M100 214 H500"
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeDasharray="6 8"
              />
              <SvgChip
                x={128}
                y={34}
                w={122}
                label={`${money(DEMO_PER_LF)} / LF`}
                delay={0.05}
              />
              <SvgChip
                x={268}
                y={34}
                w={158}
                label={`${DEMO_NET_LF} LF × ${money(DEMO_PER_LF)}`}
                delay={0.18}
              />
              <SvgChip
                x={392}
                y={118}
                w={104}
                label={money(DEMO_TIERS[1].price.total)}
                delay={0.32}
                filled
              />
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
            <div className="w-[min(300px,88%)] rounded-2xl border border-zinc-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-24px_rgba(13,27,18,0.35)] backdrop-blur">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Proposal ready
              </p>
              <p className="mt-1 text-[15px] font-semibold tracking-tight text-zinc-900">
                {DEMO_ADDRESS}
              </p>
              <div className="mt-3 space-y-1.5 border-t border-zinc-200/70 pt-3">
                {DEMO_TIERS.map(({ name: tier, price: p }) => (
                  <div
                    key={tier}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="text-zinc-500">{tier}</span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {money(p.total)}
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

/** Compact plot-plan with a looping fence trace — used in the Engine section. */
export function PlanTrace() {
  return (
    <svg viewBox="0 0 400 230" className="w-full">
      {/* parcel */}
      <path
        d="M70 50 H250 V95 H330 V190 H70 Z"
        fill="#ffffff"
        stroke="#d4d4d8"
        strokeWidth="2"
      />
      {/* house footprint inside the yard */}
      <rect
        x="120"
        y="85"
        width="90"
        height="60"
        fill="none"
        stroke="#d4d4d8"
        strokeWidth="1.4"
        strokeDasharray="4 5"
      />
      {/* animated fence trace around the property line */}
      <path
        d="M70 50 H250 V95 H330 V190 H70 Z"
        fill="none"
        stroke={TRACE}
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeDasharray="900"
        className="anim-trace"
      />
      {/* corner posts */}
      {[
        [70, 50],
        [250, 50],
        [250, 95],
        [330, 95],
        [330, 190],
        [70, 190],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x - 4}
          y={y - 4}
          width="8"
          height="8"
          fill="#ffffff"
          stroke={INK}
          strokeWidth="2"
        />
      ))}
      {/* gate marker on the front run */}
      <circle
        cx="160"
        cy="190"
        r="4.5"
        fill="#f472b6"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
