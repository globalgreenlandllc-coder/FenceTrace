"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EASE, viewportOnce } from "@/lib/motion";

/**
 * Client island for the Live Takeoffs panel: the three series lines draw
 * in on first scroll into view (framer pathLength — a one-shot stroke-dash
 * draw), with each area fill fading in behind its line. Series colors are
 * the sanctioned data-viz palette shared with the KPI dots in dashboard.tsx.
 *
 * Reduced motion follows the repo contract: vary ONLY `initial`
 * (initial={false} renders the chart fully drawn, no other branch).
 */
const SERIES = [
  {
    line: "M0 200 C 90 190, 140 160, 220 158 S 360 175, 450 150 S 610 90, 700 96 S 860 60, 1000 40",
    area: "M0 200 C 90 190, 140 160, 220 158 S 360 175, 450 150 S 610 90, 700 96 S 860 60, 1000 40 V 240 H 0 Z",
    stroke: "#1479B8",
    fill: "rgba(20,121,184,0.10)",
  },
  {
    line: "M0 215 C 110 208, 180 195, 260 190 S 420 196, 520 176 S 680 140, 780 138 S 920 112, 1000 100",
    area: "M0 215 C 110 208, 180 195, 260 190 S 420 196, 520 176 S 680 140, 780 138 S 920 112, 1000 100 V 240 H 0 Z",
    stroke: "#0E9CC3",
    fill: "rgba(14,156,195,0.10)",
  },
  {
    line: "M0 226 C 120 222, 200 216, 300 212 S 480 214, 580 202 S 740 182, 840 178 S 940 164, 1000 158",
    area: "M0 226 C 120 222, 200 216, 300 212 S 480 214, 580 202 S 740 182, 840 178 S 940 164, 1000 158 V 240 H 0 Z",
    stroke: "#E8A13B",
    fill: "rgba(232,161,59,0.10)",
  },
];

export function AreaChart() {
  const reduceMotion = useReducedMotion();
  return (
    <svg viewBox="0 0 1000 240" className="mt-8 w-full" preserveAspectRatio="none">
      {[0, 60, 120, 180].map((y) => (
        <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      ))}
      {SERIES.map((s, i) => (
        <g key={s.stroke}>
          <motion.path
            d={s.area}
            fill={s.fill}
            initial={reduceMotion ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={viewportOnce}
            transition={{ duration: 0.5, ease: EASE, delay: 0.45 + i * 0.15 }}
          />
          <motion.path
            d={s.line}
            fill="none"
            stroke={s.stroke}
            strokeWidth="2"
            initial={reduceMotion ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={viewportOnce}
            transition={{ duration: 1, ease: EASE, delay: i * 0.15 }}
          />
        </g>
      ))}
    </svg>
  );
}
