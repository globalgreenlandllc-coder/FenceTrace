"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  DoorOpen,
  FileText,
  Mail,
  MapPin,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoAerial } from "./demo-aerial";
import {
  DEMO_CHOSEN,
  DEMO_CONCRETE_BAGS,
  DEMO_PICKETS,
  DEMO_RAILS,
  DEMO_TAKEOFF,
  DEMO_TIERS,
  DEMO_TYPE,
  money,
} from "./demo-figures";
import {
  CORNERS,
  DEMO_ADDRESS,
  DEMO_APN,
  DEMO_CITY,
  ENDS,
  FENCE_HEIGHT_FT,
  FENCE_RUN,
  FENCE_TYPE_ID,
  GATES,
  HOUSE,
  HOUSE_SQFT,
  LOT_ACRES,
  LOT_SQFT,
  PARCEL,
  PX_PER_FT,
  SEGMENT_FT,
  SEGMENT_LABELS,
  TOTAL_LF,
  type Pt,
} from "./demo-property";

/**
 * The prebuilt demo address — the landing page's five-act "watch it
 * work" reel: scan the property, drive the fence around the backyard and
 * tie it into the house with a gate, flip it into 3D, price it into a
 * proposal, send it to the client and watch it come back signed.
 *
 * The point is that almost none of it is theatre. The geometry in
 * demo-property.ts is canvas-space exactly like a real scan, the 3D act
 * is the SHIPPING <Fence3D> renderer with that geometry passed straight
 * in, and every number on screen — 341 net LF, 48 posts, 819 pickets,
 * the Good/Better/Best prices — comes out of computeFenceTakeoff and
 * priceFence at render time. Change the catalog and this demo changes
 * with it.
 *
 * Choreography runs off one requestAnimationFrame progress value per
 * act (`actT`, 0→1), so every overlay is a pure function of time and the
 * whole thing is scrubable, replayable, and static under reduced motion.
 */

const Fence3D = dynamic(
  () => import("@/components/fence/fence-3d").then((m) => m.Fence3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#0e1a12] text-[13px] font-medium text-white/40">
        Building the 3D model…
      </div>
    ),
  },
);

const TRACE = "#4ADE80";
const CASING = "#08130C";
const GATE_PINK = "#F472B6";

const ACTS = [
  {
    id: "scan",
    label: "Scan the address",
    sub: "Aerial + county parcel",
    ms: 5600,
    Icon: MapPin,
  },
  {
    id: "draw",
    label: "Drive the fence",
    sub: "Backyard, tie-ins, gates",
    ms: 8600,
    Icon: Ruler,
  },
  {
    id: "design",
    label: "See it built",
    sub: "True-to-spec 3D",
    ms: 7600,
    Icon: Boxes,
  },
  {
    id: "price",
    label: "Build the proposal",
    sub: "Good / Better / Best",
    ms: 7400,
    Icon: FileText,
  },
  {
    id: "send",
    label: "Send to the client",
    sub: "Opened. Signed. Paid.",
    ms: 8200,
    Icon: Send,
  },
] as const;

const STATUS = [
  "Scanning",
  "Measuring",
  "Designing",
  "Pricing",
  "Sent",
] as const;

/* ------------------------------------------------------------------ */
/*  timing + geometry helpers                                          */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Progress of a sub-beat that runs from `a` to `b` within an act. */
const beat = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

/** Cumulative pixel length along the fence run. */
const CUM: number[] = (() => {
  const c = [0];
  for (let i = 1; i < FENCE_RUN.length; i++) {
    c.push(
      c[i - 1] +
        Math.hypot(
          FENCE_RUN[i].x - FENCE_RUN[i - 1].x,
          FENCE_RUN[i].y - FENCE_RUN[i - 1].y,
        ),
    );
  }
  return c;
})();
const RUN_PX = CUM[CUM.length - 1];

const PARCEL_PERIM = (() => {
  let p = 0;
  for (let i = 0; i < PARCEL.length; i++) {
    const a = PARCEL[i];
    const b = PARCEL[(i + 1) % PARCEL.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
})();

/** A dead-flat elevation lattice over the whole canvas. <Fence3D> only
 *  paints its shaded lawn (and the decorative trees) when it has a topo
 *  grid to ground on, and this lot really is flat — the takeoff prices
 *  it as `terrain: "flat"`. */
const FLAT_TOPO: number[][] = Array.from({ length: 9 }, () =>
  Array.from({ length: 13 }, () => 0),
);

const CENTROID: Pt = {
  x: PARCEL.reduce((a, p) => a + p.x, 0) / PARCEL.length,
  y: PARCEL.reduce((a, p) => a + p.y, 0) / PARCEL.length,
};

/** The path drawn so far, as an SVG `d`, plus the pen head position. */
function drawnPath(px: number): { d: string; head: Pt } {
  const stop = Math.min(px, RUN_PX);
  let d = `M ${FENCE_RUN[0].x} ${FENCE_RUN[0].y}`;
  let head = FENCE_RUN[0];
  for (let i = 1; i < FENCE_RUN.length; i++) {
    if (CUM[i] <= stop) {
      d += ` L ${FENCE_RUN[i].x} ${FENCE_RUN[i].y}`;
      head = FENCE_RUN[i];
      continue;
    }
    const segLen = CUM[i] - CUM[i - 1];
    const f = segLen > 0 ? (stop - CUM[i - 1]) / segLen : 0;
    if (f <= 0) break;
    head = {
      x: FENCE_RUN[i - 1].x + (FENCE_RUN[i].x - FENCE_RUN[i - 1].x) * f,
      y: FENCE_RUN[i - 1].y + (FENCE_RUN[i].y - FENCE_RUN[i - 1].y) * f,
    };
    d += ` L ${head.x.toFixed(1)} ${head.y.toFixed(1)}`;
    break;
  }
  return { d, head };
}

/** Each gate's opening direction, taken from the run segment it sits on —
 *  so the pink opening is drawn along the fence, not across it. */
const GATE_DIR: Pt[] = GATES.map((g) => {
  let best = { d: Infinity, dir: { x: 1, y: 0 } };
  for (let i = 1; i < FENCE_RUN.length; i++) {
    const a = FENCE_RUN[i - 1];
    const b = FENCE_RUN[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const f = clamp01(((g.x - a.x) * vx + (g.y - a.y) * vy) / len2);
    const d = Math.hypot(g.x - (a.x + vx * f), g.y - (a.y + vy * f));
    if (d < best.d) {
      const len = Math.sqrt(len2);
      best = { d, dir: { x: vx / len, y: vy / len } };
    }
  }
  return best.dir;
});

/** Where a segment's dimension label sits: off the midpoint, pushed away
 *  from the middle of the lot so callouts never land on the fence. */
const SEG_LABEL_POS: Pt[] = FENCE_RUN.slice(1).map((b, i) => {
  const a = FENCE_RUN[i];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if (nx * (mid.x - CENTROID.x) + ny * (mid.y - CENTROID.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * 27, y: mid.y + ny * 27 };
});

/* ------------------------------------------------------------------ */
/*  small presentational atoms                                         */
/* ------------------------------------------------------------------ */

/** A white callout chip rendered inside the SVG scene. */
function Callout({
  x,
  y,
  text,
  show,
  tone = "light",
}: {
  x: number;
  y: number;
  text: string;
  show: number;
  tone?: "light" | "accent" | "pink" | "dark";
}) {
  if (show <= 0) return null;
  const w = text.length * 7.1 + 22;
  const fill =
    tone === "accent"
      ? "#16A34A"
      : tone === "pink"
        ? GATE_PINK
        : tone === "dark"
          ? "#0B1410"
          : "#FFFFFF";
  const ink = tone === "light" ? "#0D1B12" : "#FFFFFF";
  return (
    <g
      opacity={show}
      transform={`translate(${x} ${y}) scale(${0.88 + 0.12 * show}) translate(${-w / 2} -11)`}
    >
      <rect
        width={w}
        height={22}
        rx={11}
        fill={fill}
        opacity={tone === "light" ? 0.96 : 0.94}
      />
      <text
        x={w / 2}
        y={15}
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="600"
        fill={ink}
        fontFamily="var(--font-inter), sans-serif"
      >
        {text}
      </text>
    </g>
  );
}

function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[7px]">
      <span className="text-[12.5px] text-white/45">{k}</span>
      <span className="text-right text-[13px] font-semibold tabular-nums text-white">
        {v}
        {hint ? (
          <span className="ml-1.5 font-normal text-white/35">{hint}</span>
        ) : null}
      </span>
    </div>
  );
}

function PanelHead({
  icon: Icon,
  title,
}: {
  icon: typeof MapPin;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 pb-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/20 text-accent-300">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
        {title}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  the walkthrough                                                    */
/* ------------------------------------------------------------------ */

export function DemoWalkthrough() {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [act, setAct] = useState(0);
  const [rawT, setRawT] = useState(0);
  const [inView, setInView] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [seen3d, setSeen3d] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  // Reduced motion pins every act to its settled end state: nothing
  // moves on its own and the step rail becomes the only control. (The
  // hook is null during SSR, so this has to be derived, not initial
  // state — otherwise the server and client renders disagree.)
  const actT = reduceMotion ? 1 : rawT;
  const finished = reduceMotion ? act === ACTS.length - 1 : reachedEnd;
  const playing = !reduceMotion && inView && !userPaused && !reachedEnd;

  /* ---------- the real engine output behind every number ---------- */
  const engine = useMemo(() => {
    // The client-facing scope list — quantities straight off the BOM, so
    // the proposal can't promise something the takeoff didn't count.
    const scope = [
      `${DEMO_TAKEOFF.netFenceLf} LF of ${FENCE_HEIGHT_FT}\u2032 ${DEMO_TYPE.label.toLowerCase()} fence`,
      `${DEMO_TAKEOFF.posts.total} posts (${DEMO_TAKEOFF.posts.corner} corner, ${DEMO_TAKEOFF.posts.gate} gate) set in ${DEMO_CONCRETE_BAGS} bags of concrete`,
      `${DEMO_PICKETS.toLocaleString("en-US")} ${DEMO_TYPE.spec.infillMaterial} on ${DEMO_RAILS} ${DEMO_TYPE.spec.railMaterial}`,
      GATES.map((g) => g.label).join(" + ") + ", framed and hung with hardware",
      `${CORNERS} real-turn corners and ${ENDS} tie-ins built square to the house`,
      "Post-hole digging, spoil haul-off, and full site cleanup",
    ];
    return {
      takeoff: DEMO_TAKEOFF,
      tiers: DEMO_TIERS,
      chosen: DEMO_CHOSEN,
      type: DEMO_TYPE,
      pickets: DEMO_PICKETS,
      concrete: DEMO_CONCRETE_BAGS,
      rails: DEMO_RAILS,
      scope,
    };
  }, []);

  const deposit = Math.round(engine.chosen.price.total * 0.3);

  /* ---------- autoplay: only while on screen ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ---------- one rAF clock drives every overlay ---------- */
  // The act's elapsed progress lives in a ref as well as state so a
  // pause/resume picks up mid-act instead of restarting it.
  const tRef = useRef(0);
  tRef.current = rawT;
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    const dur = ACTS[act].ms;
    const offset = tRef.current * dur;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now - offset;
      const t = (now - start) / dur;
      if (t >= 1) {
        if (act < ACTS.length - 1) {
          setAct(act + 1);
          setRawT(0);
        } else {
          setRawT(1);
          setReachedEnd(true);
        }
        return;
      }
      setRawT(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, act]);

  // The 3D chunk (and its world model) warms up an act early so the
  // hand-off from the plan view is instant instead of a loading card.
  useEffect(() => {
    if (act >= 1) setSeen3d(true);
  }, [act]);

  const jump = useCallback((i: number) => {
    setAct(i);
    setRawT(0);
    setReachedEnd(false);
    setUserPaused(false);
  }, []);

  const replay = useCallback(() => jump(0), [jump]);

  /* ---------- act 1: the pen ---------- */
  const drawT = easeInOut(beat(actT, 0.05, 0.62));
  const penPx = act === 1 ? RUN_PX * drawT : act > 1 ? RUN_PX : 0;
  const { d: fenceD, head } = useMemo(() => drawnPath(penPx), [penPx]);
  const lfNow = (penPx / RUN_PX) * TOTAL_LF;

  /* ---------- heavy children, memoised so the 60fps clock can't touch them ---------- */
  const aerial = useMemo(() => <DemoAerial />, []);
  const fence3d = useMemo(
    () =>
      seen3d ? (
        <Fence3D
          runs={[{ points: FENCE_RUN }]}
          gates={GATES.map((g) => ({
            x: g.x,
            y: g.y,
            kind: g.kind,
            widthFt: g.widthFt,
          }))}
          heightFt={FENCE_HEIGHT_FT}
          typeId={FENCE_TYPE_ID}
          pxPerFt={PX_PER_FT}
          parcelRings={[PARCEL]}
          buildings={[HOUSE]}
          topoGridFt={FLAT_TOPO}
          initialView={{ yawDeg: -34, squash: 0.5 }}
          className="h-full w-full border-0"
        />
      ) : null,
    [seen3d],
  );

  const planVisible = act <= 1;
  const showPaper = act >= 3;

  return (
    <div ref={wrapRef} className="mt-12">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_306px]">
        {/* ================= stage ================= */}
        <div className="relative overflow-hidden rounded-[22px] bg-[#0B1410] shadow-[0_40px_90px_-40px_rgba(10,43,25,0.6)] ring-1 ring-black/5">
          {/* address bar */}
          <div className="flex items-center gap-2.5 border-b border-white/10 bg-[#0d1a12] px-3.5 py-2.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-accent-400" />
            <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white">
              {DEMO_ADDRESS}
              <span className="ml-1.5 font-normal text-white/40">
                {DEMO_CITY}
              </span>
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
                act === 4
                  ? "bg-accent-500/25 text-accent-300"
                  : "bg-white/10 text-white/60",
              )}
            >
              {STATUS[act]}
              {act < 4 && !reduceMotion ? (
                <span className="anim-ellipsis">…</span>
              ) : null}
            </span>
          </div>

          <div className="relative aspect-[900/580] w-full">
            {/* ---------- plan view: aerial + overlays ---------- */}
            <div
              className="absolute inset-0 transition-[opacity,transform] duration-700 ease-out"
              style={{
                opacity: planVisible ? 1 : 0,
                transform: planVisible ? "scale(1)" : "scale(1.06)",
                pointerEvents: planVisible ? undefined : "none",
              }}
            >
              <svg
                viewBox="0 0 900 580"
                className="block h-full w-full"
                role="img"
                aria-label="Demo property scan: aerial view with the county parcel boundary and the backyard fence line traced"
              >
                {aerial}

                {/* --- act 0: scan sweep --- */}
                {act === 0 && actT < 0.42 && !reduceMotion && (
                  <g opacity={1 - beat(actT, 0.3, 0.42)}>
                    <defs>
                      <linearGradient id="dw-sweep" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TRACE} stopOpacity="0" />
                        <stop
                          offset="72%"
                          stopColor={TRACE}
                          stopOpacity="0.28"
                        />
                        <stop
                          offset="100%"
                          stopColor={TRACE}
                          stopOpacity="0.95"
                        />
                      </linearGradient>
                    </defs>
                    <rect
                      x={0}
                      y={-140 + beat(actT, 0, 0.34) * 720}
                      width={900}
                      height={140}
                      fill="url(#dw-sweep)"
                    />
                  </g>
                )}

                {/* --- parcel boundary --- */}
                {(() => {
                  const p = act === 0 ? easeOut(beat(actT, 0.22, 0.6)) : 1;
                  if (p <= 0) return null;
                  const settled = act > 0;
                  return (
                    <g>
                      <polygon
                        points={ptsAttr(PARCEL)}
                        fill={TRACE}
                        fillOpacity={settled ? 0.05 : 0.09 * p}
                      />
                      <polygon
                        points={ptsAttr(PARCEL)}
                        fill="none"
                        stroke="#0B1410"
                        strokeOpacity={0.5}
                        strokeWidth={settled ? 3 : 5}
                        strokeLinejoin="round"
                        strokeDasharray={PARCEL_PERIM}
                        strokeDashoffset={PARCEL_PERIM * (1 - p)}
                      />
                      <polygon
                        points={ptsAttr(PARCEL)}
                        fill="none"
                        stroke={settled ? "#BFDEC7" : TRACE}
                        strokeOpacity={settled ? 0.75 : 1}
                        strokeWidth={settled ? 1.6 : 2.6}
                        strokeLinejoin="round"
                        strokeDasharray={settled ? "9 8" : `${PARCEL_PERIM}`}
                        strokeDashoffset={settled ? 0 : PARCEL_PERIM * (1 - p)}
                      />
                      {PARCEL.map((pt, i) => {
                        const s =
                          act === 0
                            ? beat(actT, 0.5 + i * 0.045, 0.6 + i * 0.045)
                            : 1;
                        return s <= 0 ? null : (
                          <circle
                            key={i}
                            cx={pt.x}
                            cy={pt.y}
                            r={5 * (0.5 + 0.5 * s)}
                            fill="#fff"
                            stroke="#16A34A"
                            strokeWidth={2.4}
                            opacity={s * (act > 0 ? 0.75 : 1)}
                          />
                        );
                      })}
                    </g>
                  );
                })()}

                {/* --- house detection --- */}
                {(() => {
                  const s = act === 0 ? beat(actT, 0.58, 0.74) : 1;
                  if (s <= 0) return null;
                  return (
                    <g opacity={act > 0 ? 0.9 : s}>
                      <polygon
                        points={ptsAttr(HOUSE)}
                        fill="none"
                        stroke="#fff"
                        strokeOpacity={0.9}
                        strokeWidth={2}
                        strokeDasharray="7 6"
                      />
                      {act === 0 && (
                        <Callout
                          x={451}
                          y={370}
                          text={`House · ${HOUSE_SQFT.toLocaleString("en-US")} sq ft`}
                          show={beat(actT, 0.66, 0.78)}
                          tone="dark"
                        />
                      )}
                    </g>
                  );
                })()}

                {/* --- act 0 callouts --- */}
                {act === 0 && (
                  <>
                    <Callout
                      x={450}
                      y={62}
                      text={`Parcel ${DEMO_APN}`}
                      show={beat(actT, 0.6, 0.72)}
                    />
                    <Callout
                      x={200}
                      y={534}
                      text={`${LOT_ACRES} acres · ${LOT_SQFT.toLocaleString("en-US")} sq ft`}
                      show={beat(actT, 0.72, 0.84)}
                      tone="accent"
                    />
                    <Callout
                      x={690}
                      y={534}
                      text="Boundary matched — county records"
                      show={beat(actT, 0.82, 0.94)}
                    />
                  </>
                )}

                {/* --- act 1: the fence --- */}
                {act === 1 && (
                  <g>
                    {/* the run drawn so far */}
                    <path
                      d={fenceD}
                      fill="none"
                      stroke={CASING}
                      strokeOpacity={0.6}
                      strokeWidth={9}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <path
                      d={fenceD}
                      fill="none"
                      stroke={TRACE}
                      strokeWidth={3.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />

                    {/* pen head */}
                    {drawT > 0 && drawT < 1 && (
                      <g>
                        <circle
                          cx={head.x}
                          cy={head.y}
                          r={13}
                          fill={TRACE}
                          opacity={0.22}
                        />
                        <circle
                          cx={head.x}
                          cy={head.y}
                          r={5.5}
                          fill="#fff"
                          stroke="#16A34A"
                          strokeWidth={2.5}
                        />
                      </g>
                    )}

                    {/* corner posts, as the pen rounds each one */}
                    {FENCE_RUN.slice(1, -1).map((p, i) => {
                      const s = clamp01((penPx - CUM[i + 1]) / 26);
                      return s <= 0 ? null : (
                        <rect
                          key={i}
                          x={p.x - 5}
                          y={p.y - 5}
                          width={10}
                          height={10}
                          rx={2}
                          fill="#fff"
                          stroke="#0B1410"
                          strokeWidth={2.2}
                          opacity={s}
                          transform={`rotate(45 ${p.x} ${p.y}) scale(1)`}
                        />
                      );
                    })}

                    {/* house tie-ins */}
                    {[FENCE_RUN[0], FENCE_RUN[FENCE_RUN.length - 1]].map(
                      (p, i) => {
                        const s =
                          i === 0
                            ? clamp01(penPx / 14)
                            : clamp01((penPx - RUN_PX + 14) / 14);
                        return s <= 0 ? null : (
                          <g key={i} opacity={s}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={9}
                              fill="none"
                              stroke={TRACE}
                              strokeWidth={2}
                              opacity={0.5}
                            />
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={4.5}
                              fill={TRACE}
                              stroke="#0B1410"
                              strokeWidth={1.6}
                            />
                          </g>
                        );
                      },
                    )}

                    {/* per-segment dimensions, popping as each finishes */}
                    {SEGMENT_FT.map((ft, i) => {
                      const s = clamp01((penPx - CUM[i + 1]) / 30);
                      return (
                        <Callout
                          key={i}
                          x={SEG_LABEL_POS[i].x}
                          y={SEG_LABEL_POS[i].y}
                          text={`${ft.toFixed(1)}′ ${SEGMENT_LABELS[i]}`}
                          show={s}
                        />
                      );
                    })}

                    {/* gates, dropped in once the line is complete */}
                    {GATES.map((g, i) => {
                      const s = beat(actT, 0.66 + i * 0.09, 0.78 + i * 0.09);
                      if (s <= 0) return null;
                      const halfPx = (g.widthFt * PX_PER_FT) / 2;
                      const dir = GATE_DIR[i];
                      return (
                        <g key={i} opacity={s}>
                          {/* the opening the gate takes out of the fabric */}
                          <line
                            x1={g.x - dir.x * halfPx}
                            y1={g.y - dir.y * halfPx}
                            x2={g.x + dir.x * halfPx}
                            y2={g.y + dir.y * halfPx}
                            stroke={GATE_PINK}
                            strokeWidth={7}
                            strokeLinecap="round"
                          />
                          <circle
                            cx={g.x}
                            cy={g.y}
                            r={16 - 6 * s}
                            fill="none"
                            stroke={GATE_PINK}
                            strokeWidth={2}
                            opacity={(1 - s) * 0.9}
                          />
                          <Callout
                            x={g.x}
                            y={g.y - 26}
                            text={g.label}
                            show={s}
                            tone="pink"
                          />
                        </g>
                      );
                    })}

                    {/* running total */}
                    <Callout
                      x={450}
                      y={534}
                      text={`${lfNow.toFixed(1)} LF traced · ${CORNERS} corners · ${GATES.length} gates`}
                      show={beat(actT, 0.08, 0.16)}
                      tone="dark"
                    />
                    <Callout
                      x={451}
                      y={370}
                      text="Ties into the house — no fence across the drive"
                      show={beat(actT, 0.84, 0.94)}
                      tone="dark"
                    />
                  </g>
                )}
              </svg>
            </div>

            {/* ---------- 3D act ---------- */}
            <div
              className="absolute inset-0 transition-[opacity,transform] duration-700 ease-out"
              style={{
                opacity: act === 2 ? 1 : 0,
                transform: act === 2 ? "scale(1)" : "scale(0.965)",
                pointerEvents: act === 2 ? undefined : "none",
              }}
            >
              {fence3d}
              {act === 2 && (
                <AnimatePresence>
                  {actT > 0.34 && actT < 0.95 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#0B1410]/85 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-lg backdrop-blur"
                    >
                      <MousePointer2 className="h-3.5 w-3.5 text-accent-300" />
                      Drag to orbit — it&apos;s the real model, not a picture
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>

            {/* ---------- proposal + send acts ---------- */}
            <div
              className="absolute inset-0 bg-[#0B1410] transition-opacity duration-500"
              style={{
                opacity: showPaper ? 1 : 0,
                pointerEvents: showPaper ? undefined : "none",
              }}
            >
              {showPaper && (
                <ProposalStage
                  act={act}
                  t={actT}
                  reduceMotion={!!reduceMotion}
                  tiers={engine.tiers}
                  chosen={engine.chosen}
                  netLf={engine.takeoff.netFenceLf}
                  deposit={deposit}
                  scope={engine.scope}
                />
              )}
            </div>

            {/* ---------- replay veil ---------- */}
            <AnimatePresence>
              {finished && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-[#0B1410] via-[#0B1410]/90 to-transparent px-4 pb-4 pt-14"
                >
                  <button
                    type="button"
                    onClick={replay}
                    className="press-scale ring-focus-dark inline-flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur transition hover:bg-white/20"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Watch it again
                  </button>
                  <Link
                    href="/sign-up?utm_source=demo-walkthrough"
                    className="press-scale ring-focus-dark inline-flex h-10 items-center gap-2 rounded-lg bg-accent-500 px-4 text-[13px] font-semibold text-white transition hover:bg-accent-400"
                  >
                    Run this on your next address
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ================= live readout ================= */}
        <div className="flex flex-col rounded-[22px] bg-[#0B1410] p-4 ring-1 ring-black/5">
          {/* A keyed CSS fade, not AnimatePresence: an exit-then-enter
              queue can strand the panel blank when two acts land close
              together (which they do while the reel is warming up). */}
          <div key={act} className="anim-enter-fade flex-1">
            {act === 0 && (
              <>
                <PanelHead icon={MapPin} title="Property record" />
                <div className="divide-y divide-white/[0.07]">
                  <Stat k="Address" v={DEMO_ADDRESS} />
                  <Stat k="Parcel" v={DEMO_APN} />
                  <Stat
                    k="Lot"
                    v={`${LOT_ACRES} ac`}
                    hint={`${LOT_SQFT.toLocaleString("en-US")} sq ft`}
                  />
                  <Stat
                    k="House footprint"
                    v={`${HOUSE_SQFT.toLocaleString("en-US")} sq ft`}
                  />
                  <Stat k="Imagery" v="Aerial · 3.6 px/ft" />
                </div>
                <p className="mt-4 rounded-lg bg-accent-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-accent-200">
                  No truck roll, no wheel, no tape. The boundary is the
                  county&apos;s, not a guess.
                </p>
              </>
            )}

            {act === 1 && (
              <>
                <PanelHead icon={Ruler} title="Takeoff" />
                <div className="divide-y divide-white/[0.07]">
                  <Stat k="Fence line" v={`${lfNow.toFixed(1)} LF`} />
                  <Stat
                    k="Net fabric"
                    v={`${engine.takeoff.netFenceLf} LF`}
                    hint="gates out"
                  />
                  <Stat k="Corners" v={String(CORNERS)} />
                  <Stat k="House tie-ins" v={String(ENDS)} />
                  <Stat
                    k="Gates"
                    v={`${GATES.length}`}
                    hint="4′ walk + 10′ drive"
                  />
                </div>
                <div className="mt-3 space-y-1">
                  {SEGMENT_LABELS.map((l, i) => {
                    const done = penPx >= CUM[i + 1];
                    return (
                      <div
                        key={l}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] transition-colors",
                          done ? "bg-white/[0.06] text-white" : "text-white/25",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {done ? (
                            <Check className="h-3 w-3 text-accent-400" />
                          ) : (
                            <span className="h-3 w-3" />
                          )}
                          {l}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {done ? `${SEGMENT_FT[i].toFixed(1)}′` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {act === 2 && (
              <>
                <PanelHead icon={Boxes} title="Bill of materials" />
                <div className="divide-y divide-white/[0.07]">
                  <Stat
                    k="Fence"
                    v={engine.type.label}
                    hint={`${FENCE_HEIGHT_FT}′`}
                  />
                  <Stat
                    k="Sections"
                    v={String(engine.takeoff.sections)}
                    hint={`${engine.type.postSpacingFt}′ o.c.`}
                  />
                  <Stat
                    k="Posts"
                    v={String(engine.takeoff.posts.total)}
                    hint={`${engine.takeoff.posts.corner} corner`}
                  />
                  <Stat k="Rails" v={String(engine.rails)} />
                  <Stat
                    k="Pickets"
                    v={engine.pickets.toLocaleString("en-US")}
                  />
                  <Stat k="Concrete" v={`${engine.concrete} bags`} />
                  <Stat k="Crew hours" v={String(engine.takeoff.laborHours)} />
                </div>
                <p className="mt-4 rounded-lg bg-accent-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-accent-200">
                  {engine.type.spec.infillMaterial} on{" "}
                  {engine.type.spec.railMaterial}, set on{" "}
                  {engine.type.spec.postMaterial}.
                </p>
              </>
            )}

            {act === 3 && (
              <>
                <PanelHead icon={FileText} title="Packages" />
                <div className="mt-3 space-y-2">
                  {engine.tiers.map((t, i) => {
                    const on = actT > 0.2 + i * 0.13;
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 transition-all duration-500",
                          t.recommended
                            ? "border-accent-400/50 bg-accent-500/15"
                            : "border-white/10 bg-white/[0.04]",
                          on
                            ? "translate-y-0 opacity-100"
                            : "translate-y-2 opacity-0",
                        )}
                      >
                        <div className="flex items-baseline justify-between">
                          <p className="text-[13px] font-semibold text-white">
                            {t.name}
                          </p>
                          <p className="text-[15px] font-bold tabular-nums text-white">
                            {money(t.price.total)}
                          </p>
                        </div>
                        <div className="mt-0.5 flex items-baseline justify-between">
                          <p className="text-[11.5px] text-white/45">
                            {t.spec.label}
                          </p>
                          <p className="text-[11px] tabular-nums text-white/45">
                            {money(t.price.pricePerLf)}/LF
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 rounded-lg bg-white/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-white/55">
                  Materials, labor, gates, tax and your markup — priced off the
                  same {engine.takeoff.netFenceLf} LF the 3D model was built
                  from.
                </p>
              </>
            )}

            {act === 4 && (
              <>
                <PanelHead icon={Send} title="Delivery" />
                <div className="mt-3 space-y-3">
                  {[
                    {
                      t: "9:41 AM",
                      l: "Proposal sent",
                      s: "whitakers@example.com",
                      at: 0.16,
                      Icon: Mail,
                    },
                    {
                      t: "9:53 AM",
                      l: "Opened on mobile",
                      s: "Viewed the 3D model twice",
                      at: 0.4,
                      Icon: Sparkles,
                    },
                    {
                      t: "10:06 AM",
                      l: "Signed",
                      s: `Better · ${money(engine.chosen.price.total)}`,
                      at: 0.62,
                      Icon: CheckCircle2,
                    },
                    {
                      t: "10:07 AM",
                      l: "Deposit paid",
                      s: `${money(deposit)} · 30%`,
                      at: 0.8,
                      Icon: Check,
                    },
                  ].map((r, i, arr) => {
                    const on = actT > r.at;
                    return (
                      <div key={r.l} className="relative flex gap-3">
                        {i < arr.length - 1 && (
                          <span
                            className={cn(
                              "absolute left-[11px] top-6 h-[calc(100%+0.15rem)] w-px transition-colors duration-500",
                              on ? "bg-accent-500/50" : "bg-white/10",
                            )}
                          />
                        )}
                        <span
                          className={cn(
                            "relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-all duration-500",
                            on
                              ? "bg-accent-500 text-white"
                              : "bg-white/10 text-white/30",
                          )}
                        >
                          <r.Icon className="h-3 w-3" />
                        </span>
                        <div
                          className={cn(
                            "min-w-0 transition-all duration-500",
                            on
                              ? "translate-x-0 opacity-100"
                              : "-translate-x-1 opacity-30",
                          )}
                        >
                          <p className="text-[12.5px] font-semibold text-white">
                            {r.l}
                            <span className="ml-1.5 font-mono text-[10px] font-normal text-white/35">
                              {r.t}
                            </span>
                          </p>
                          <p className="truncate text-[11.5px] text-white/45">
                            {r.s}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={cn(
                    "mt-4 rounded-xl bg-accent-500/15 px-3 py-3 text-center transition-all duration-500",
                    actT > 0.86
                      ? "scale-100 opacity-100"
                      : "scale-95 opacity-0",
                  )}
                >
                  <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-accent-300">
                    Address to signed
                  </p>
                  <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-white">
                    26 min
                  </p>
                  <p className="mt-1 text-[11.5px] text-white/45">
                    No site visit. No CAD. No re-keying.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ================= step rail ================= */}
      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {ACTS.map((a, i) => {
          const active = i === act;
          const done = i < act || (finished && i === act);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => jump(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "ring-focus group relative overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-accent-300 bg-white shadow-card"
                  : "border-zinc-200 bg-white/60 hover:border-zinc-300 hover:bg-white",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors",
                    active || done
                      ? "bg-accent-600 text-white"
                      : "bg-zinc-100 text-zinc-400",
                  )}
                >
                  {done && !active ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <p
                  className={cn(
                    "truncate text-[12.5px] font-semibold",
                    active ? "text-zinc-900" : "text-zinc-500",
                  )}
                >
                  {a.label}
                </p>
              </div>
              <p className="mt-1 truncate pl-7 text-[11.5px] text-zinc-400">
                {a.sub}
              </p>
              <span className="absolute inset-x-0 bottom-0 h-[3px] bg-zinc-100">
                <span
                  className="block h-full bg-accent-500"
                  style={{
                    width: `${(done && !active ? 1 : active ? actT : 0) * 100}%`,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* ================= transport ================= */}
      {!reduceMotion && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => (finished ? replay() : setUserPaused((p) => !p))}
            className="ring-focus inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-[12px] font-semibold text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
          >
            {finished ? (
              <>
                <RotateCcw className="h-3 w-3" /> Replay
              </>
            ) : playing ? (
              <>
                <Pause className="h-3 w-3" /> Pause
              </>
            ) : (
              <>
                <Play className="h-3 w-3" /> Play
              </>
            )}
          </button>
          <p className="text-[11.5px] text-zinc-400">
            Prebuilt demo property — every figure computed live by the FenceScan
            engine.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  acts 4 + 5: the proposal document, then the send                   */
/* ------------------------------------------------------------------ */

type Tier = {
  id: string;
  name: string;
  tagline: string;
  recommended?: boolean;
  warrantyYears: number;
  spec: { label: string; blurb: string };
  price: { total: number; pricePerLf: number };
};

/**
 * The proposal is laid out at a fixed 900×580 and then scaled to fit,
 * exactly like the SVG acts before it. That keeps a three-column
 * document readable on a phone (where a fluid layout would collapse to
 * unreadable slivers) and means the paper never reflows between the
 * "built" act and the "sent" act — it only shrinks.
 */
function ProposalStage({
  act,
  t,
  reduceMotion,
  tiers,
  chosen,
  netLf,
  deposit,
  scope,
}: {
  act: number;
  t: number;
  reduceMotion: boolean;
  tiers: Tier[];
  chosen: Tier;
  netLf: number;
  deposit: number;
  scope: string[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = width / 900;
  // Below ~620px the scaled document's 10px type lands under 7px, which
  // is decoration, not a proposal. Phones get a stacked summary instead.
  const compact = width > 0 && width < 620;
  const sending = act === 4;
  // The send act doesn't shrink the paper — it dims it and floats the
  // send sheet on top, the way the real builder's send modal does.
  const scrim = sending ? (reduceMotion ? 1 : easeOut(beat(t, 0, 0.2))) : 0;
  const pageScale = 1 - scrim * 0.035;
  const enter = (at: number, to: number) =>
    reduceMotion || act === 4 ? 1 : easeOut(beat(t, at, to));

  // NOTE: boxRef lives on the outer shell in BOTH branches — if the ref
  // moved with the branch, the ResizeObserver would be left watching a
  // detached node and the layout could never switch back.
  const compactBody = (
    <div className="relative h-full w-full p-2.5">
      <div className="flex h-full flex-col overflow-hidden rounded-lg bg-white">
        <div className="flex items-center justify-between bg-accent-950 px-2.5 py-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold leading-tight text-white">
              {DEMO_ADDRESS}
            </p>
            <p className="truncate text-[8.5px] leading-tight text-white/45">
              Fence proposal
            </p>
          </div>
          <p className="shrink-0 pl-2 text-[11px] font-semibold tabular-nums text-white">
            {netLf} LF
          </p>
        </div>
        <div className="flex-1 divide-y divide-zinc-100">
          {tiers.map((tier, i) => {
            const on = enter(0.12 + i * 0.12, 0.32 + i * 0.12);
            return (
              <div
                key={tier.id}
                className={cn(
                  "flex items-center justify-between gap-2 px-2.5 py-[7px]",
                  tier.recommended && "bg-accent-50",
                )}
                style={{ opacity: on }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[10.5px] font-semibold text-zinc-900">
                    {tier.name}
                    {sending && tier.recommended ? (
                      <span className="ml-1.5 rounded-full bg-accent-600 px-1.5 py-[1px] text-[7.5px] font-bold uppercase text-white">
                        Signed
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[9px] leading-tight text-zinc-500">
                    {tier.spec.label}
                  </p>
                </div>
                <p className="shrink-0 text-[12px] font-bold tabular-nums text-zinc-900">
                  {money(tier.price.total)}
                </p>
              </div>
            );
          })}
        </div>
        <p
          className="truncate border-t border-zinc-100 px-2.5 py-[6px] text-[8.5px] text-zinc-400"
          style={{ opacity: enter(0.5, 0.66) }}
        >
          {scope[0]} · {GATES.length} gates · deposit {money(deposit)}
        </p>
      </div>
      {sending && (
        <div
          className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg bg-accent-600 px-3 py-2.5 text-white shadow-[0_16px_40px_-10px_rgba(0,0,0,0.8)]"
          style={{ opacity: enterSend(t, reduceMotion) }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-tight">
                {t > 0.6 || reduceMotion
                  ? `Signed — ${chosen.name} package`
                  : "Sent to whitakers@example.com"}
              </p>
              <p className="text-[9.5px] leading-tight text-white/75">
                {money(chosen.price.total)} · {money(deposit)} deposit
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div ref={boxRef} className="h-full w-full overflow-hidden bg-[#0e1a12]">
      {compact ? (
        compactBody
      ) : (
        <div
          className="relative origin-top-left"
          style={{
            width: 900,
            height: 580,
            transform: `scale(${scale})`,
            opacity: scale ? 1 : 0,
          }}
        >
          {/* ---------------- the paper ---------------- */}
          <div
            className="absolute transition-transform duration-500 ease-out"
            style={{
              left: 26,
              top: 18,
              width: 848,
              height: 544,
              transformOrigin: "0px 272px",
              transform: `scale(${pageScale})`,
            }}
          >
            <div className="h-full w-full overflow-hidden rounded-[14px] bg-white shadow-[0_30px_70px_-20px_rgba(0,0,0,0.75)]">
              {/* cover band */}
              <div className="flex h-[74px] items-center justify-between bg-accent-950 px-5">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">
                    Fence proposal
                  </p>
                  <p className="mt-1 truncate text-[19px] font-semibold leading-none tracking-tight text-white">
                    {DEMO_ADDRESS}
                  </p>
                  <p className="mt-1 truncate text-[11px] leading-none text-white/45">
                    {DEMO_CITY}
                  </p>
                </div>
                <div className="shrink-0 pl-4 text-right">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">
                    Scope
                  </p>
                  <p className="mt-1 text-[19px] font-semibold leading-none tabular-nums text-white">
                    {netLf} LF
                  </p>
                  <p className="mt-1 text-[11px] leading-none text-white/45">
                    {FENCE_HEIGHT_FT}′ cedar privacy · {GATES.length} gates
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* everything below is positioned in the same design space and
            rides the same shrink transform */}
          <div
            className="absolute transition-transform duration-500 ease-out"
            style={{
              left: 26,
              top: 18,
              width: 848,
              height: 544,
              transformOrigin: "0px 272px",
              transform: `scale(${pageScale})`,
            }}
          >
            {/* ---- package cards ---- */}
            <div
              className="absolute flex"
              style={{ left: 18, top: 90, width: 812, gap: 14 }}
            >
              {tiers.map((tier, i) => {
                const on = enter(0.12 + i * 0.12, 0.32 + i * 0.12);
                const picked = sending && tier.recommended;
                return (
                  <div
                    key={tier.id}
                    className={cn(
                      "relative flex flex-col rounded-xl border p-3",
                      tier.recommended
                        ? "border-accent-500 bg-accent-50 shadow-[0_0_0_3px_rgba(30,115,64,0.10)]"
                        : "border-zinc-200 bg-white",
                    )}
                    style={{
                      width: 261.3,
                      height: 172,
                      opacity: on,
                      transform: `translateY(${(1 - on) * 14}px)`,
                    }}
                  >
                    {tier.recommended && (
                      <span className="absolute -top-[8px] left-3 rounded-full bg-accent-600 px-2 py-[3px] text-[8px] font-bold uppercase tracking-[0.08em] text-white">
                        Recommended
                      </span>
                    )}
                    <p className="text-[13px] font-semibold leading-none text-zinc-900">
                      {tier.name}
                    </p>
                    <p className="mt-1.5 text-[10.5px] leading-none text-zinc-500">
                      {tier.spec.label}
                    </p>
                    <p className="mt-3 text-[25px] font-bold leading-none tracking-tight text-zinc-900">
                      {money(tier.price.total)}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-none tabular-nums text-zinc-400">
                      {money(tier.price.pricePerLf)}/LF · {tier.warrantyYears}
                      -yr warranty
                    </p>
                    <p className="mt-2.5 line-clamp-2 text-[10px] leading-[1.45] text-zinc-500">
                      {tier.tagline} — {tier.spec.blurb}
                    </p>
                    <span
                      className={cn(
                        "mt-auto flex h-[26px] items-center justify-center gap-1 rounded-md text-[10.5px] font-semibold transition-colors duration-500",
                        picked
                          ? "bg-accent-600 text-white"
                          : tier.recommended
                            ? "bg-accent-600 text-white"
                            : "bg-zinc-100 text-zinc-500",
                      )}
                    >
                      {picked ? (
                        <>
                          <Check className="h-3 w-3" /> Signed &amp; deposited
                        </>
                      ) : (
                        "Choose this package"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ---- what's included ---- */}
            <div
              className="absolute"
              style={{
                left: 18,
                top: 278,
                width: 486,
                opacity: enter(0.5, 0.66),
                transform: `translateY(${(1 - enter(0.5, 0.66)) * 10}px)`,
              }}
            >
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                Included in every package
              </p>
              <div className="mt-2.5 grid grid-cols-1 gap-y-[7px]">
                {scope.map((line) => (
                  <div key={line} className="flex items-start gap-2">
                    <Check className="mt-[2px] h-3 w-3 shrink-0 text-accent-600" />
                    <p className="text-[11px] leading-[1.35] text-zinc-600">
                      {line}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ---- the plan, so the paper and the yard agree ---- */}
            <div
              className="absolute overflow-hidden rounded-xl border border-zinc-200 bg-accent-50"
              style={{
                left: 522,
                top: 278,
                width: 308,
                height: 196,
                opacity: enter(0.58, 0.74),
                transform: `translateY(${(1 - enter(0.58, 0.74)) * 10}px)`,
              }}
            >
              <svg viewBox="170 58 576 470" className="block h-full w-full">
                <polygon
                  points={ptsAttr(PARCEL)}
                  fill="#fff"
                  stroke="#BFDEC7"
                  strokeWidth={4}
                  strokeDasharray="14 11"
                />
                <polygon
                  points={ptsAttr(HOUSE)}
                  fill="#E4E0D6"
                  stroke="#B9B2A3"
                  strokeWidth={4}
                />
                <path
                  d={`M ${FENCE_RUN.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
                  fill="none"
                  stroke="#1E7340"
                  strokeWidth={9}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {FENCE_RUN.slice(1, -1).map((p, i) => (
                  <rect
                    key={i}
                    x={p.x - 7}
                    y={p.y - 7}
                    width={14}
                    height={14}
                    fill="#fff"
                    stroke="#0D1B12"
                    strokeWidth={4}
                  />
                ))}
                {GATES.map((g, i) => {
                  const half = (g.widthFt * PX_PER_FT) / 2;
                  const d = GATE_DIR[i];
                  return (
                    <line
                      key={i}
                      x1={g.x - d.x * half}
                      y1={g.y - d.y * half}
                      x2={g.x + d.x * half}
                      y2={g.y + d.y * half}
                      stroke={GATE_PINK}
                      strokeWidth={13}
                      strokeLinecap="round"
                    />
                  );
                })}
              </svg>
              <p className="absolute bottom-1.5 left-2.5 rounded-full bg-white/90 px-2 py-[3px] text-[9px] font-semibold text-zinc-600 shadow-sm">
                Backyard enclosure · {SEGMENT_FT.length} runs · {GATES.length}{" "}
                gates
              </p>
            </div>

            {/* ---- footer ---- */}
            <div
              className="absolute flex items-center justify-between border-t border-zinc-100 pt-2.5"
              style={{
                left: 18,
                top: 488,
                width: 812,
                opacity: enter(0.7, 0.86),
              }}
            >
              <p className="text-[10px] text-zinc-400">
                Prepared from a FenceScan takeoff · pricing valid 30 days ·
                permit fees billed at cost
              </p>
              <p className="text-[10px] font-semibold text-zinc-500">
                Deposit {money(deposit)} · balance on completion
              </p>
            </div>
          </div>

          {/* ---------------- the send sheet ---------------- */}
          {sending && (
            <div
              className="absolute inset-0 bg-[#08120C]"
              style={{ opacity: scrim * 0.62 }}
            />
          )}
          {sending && (
            <div
              className="absolute"
              style={{
                left: 270,
                top: 290,
                width: 360,
                transform: `translateY(-50%) scale(${0.94 + 0.06 * enterSend(t, reduceMotion)})`,
                opacity: enterSend(t, reduceMotion),
              }}
            >
              <div className="overflow-hidden rounded-xl bg-white shadow-[0_30px_70px_-18px_rgba(0,0,0,0.8)]">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-3.5 py-2.5">
                  <Mail className="h-3.5 w-3.5 text-accent-600" />
                  <p className="text-[12px] font-semibold text-zinc-900">
                    Send proposal
                  </p>
                </div>
                <div className="space-y-2 px-3.5 py-3 text-[11px]">
                  {[
                    ["To", "whitakers@example.com"],
                    ["Subject", `Your fence at ${DEMO_ADDRESS}`],
                    ["Includes", "3D model · e-signature · deposit link"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2.5">
                      <span className="w-[52px] shrink-0 text-zinc-400">
                        {k}
                      </span>
                      <span className="truncate font-medium text-zinc-800">
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-3.5 pb-3.5">
                  <span
                    className={cn(
                      "flex h-[34px] items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold text-white transition-all duration-300",
                      t > 0.3
                        ? "scale-[0.97] bg-accent-700"
                        : "scale-100 bg-accent-600",
                    )}
                  >
                    {t > 0.38 || reduceMotion ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Sent to the client
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" /> Send to client
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div
                className="mt-3 rounded-xl bg-accent-600 px-3.5 py-3 text-white shadow-[0_20px_40px_-14px_rgba(30,115,64,0.9)] transition-all duration-500"
                style={{
                  opacity: reduceMotion ? 1 : easeOut(beat(t, 0.6, 0.78)),
                  transform: `scale(${0.92 + 0.08 * easeOut(beat(t, 0.6, 0.78))})`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold leading-tight">
                      Signed — {chosen.name} package
                    </p>
                    <p className="text-[11px] leading-tight text-white/75">
                      {money(chosen.price.total)} · {money(deposit)} deposit
                      paid
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* the caption that keeps the story anchored on the yard */}
          {act === 3 && (
            <div
              className="absolute bottom-[2px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-[11.5px] font-semibold text-zinc-700 shadow-lg transition-opacity duration-500"
              style={{ opacity: reduceMotion || t > 0.8 ? 1 : 0 }}
            >
              <DoorOpen className="h-3.5 w-3.5 text-accent-600" />
              Same geometry, same gates — priced three ways
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const enterSend = (t: number, reduceMotion: boolean) =>
  reduceMotion ? 1 : easeOut(beat(t, 0.06, 0.28));
