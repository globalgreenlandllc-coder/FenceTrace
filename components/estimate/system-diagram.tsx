"use client";

import {
  Anchor,
  ArrowDownToLine,
  CornerDownRight,
  Droplets,
  Frame,
  Link2,
  type LucideIcon,
  Ruler,
  Shield,
  Snowflake,
  Spline,
  Square,
  Waves,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_OPTIONS } from "@/lib/pricing";
import { STORY_HEIGHT_FT } from "@/lib/types";
import type { EstimateConfig, GutterAccessories, Measurements } from "@/lib/types";

const DEFAULT_ACCESSORIES: GutterAccessories = {
  guard: "none",
  dripEdge: false,
  rainChain: false,
  iceGuard: false,
  heatTape: false,
};

const GUARD_LABEL: Record<GutterAccessories["guard"], string> = {
  none: "None",
  screen: "Screen guard",
  mesh: "Mesh guard",
  "micro-mesh": "Micro-mesh guard",
};

type Part = {
  icon: LucideIcon;
  name: string;
  qty: string;
  detail: string;
};

type PartGroup = { title: string; parts: Part[] };

const nf = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const lf = (n: number) => `${nf(n)} LF`;

/**
 * Turn the live takeoff + spec into the real bill of materials a client
 * would receive — sections, hangers, miters, the full drainage train, and
 * any protection add-ons. Counts follow standard install rules (hidden
 * hangers ~24" o.c., one outlet + offset elbows + a kick-out per
 * downspout, straps scaled to the drop height) so the list reads like a
 * pro takeoff, not a guess.
 */
export function deriveSystemParts(
  config: EstimateConfig,
  m: Measurements,
): PartGroup[] {
  const acc = config.accessories ?? DEFAULT_ACCESSORIES;
  const halfRound = config.style === "half-round";
  const profile = halfRound ? "Half-round" : "K-style";
  const eave = Math.max(0, m.eaveLF);
  const drops = Math.max(0, m.downspoutCount);

  // Hidden hangers roughly every 24" of run.
  const hangers = eave > 0 ? Math.max(2, Math.round(eave / 2)) : 0;
  // Drop height drives the downspout run and strap count (~1 strap / 6 ft,
  // min 2 per drop). Elbows: two crimped offsets up top + a kick-out.
  const dropHeightFt = STORY_HEIGHT_FT[m.stories];
  const strapsPer = Math.max(2, Math.ceil(dropHeightFt / 6));
  const straps = drops * strapsPer;
  const elbows = drops * 3;
  const downspoutLF = Math.round(drops * dropHeightFt);

  const core: Part[] = [
    {
      icon: Ruler,
      name: `${config.size}″ ${profile} gutter`,
      qty: lf(eave),
      detail: `Seamless ${config.material} · continuous run`,
    },
    {
      icon: Anchor,
      name: halfRound ? "Ring brackets" : "Hidden hangers",
      qty: `${nf(hangers)}×`,
      detail: "Screw-mounted ~24 in. on center",
    },
  ];
  if (m.outsideCorners > 0)
    core.push({
      icon: CornerDownRight,
      name: "Outside corners",
      qty: `${nf(m.outsideCorners)}×`,
      detail: "Mitered & sealed",
    });
  if (m.insideCorners > 0)
    core.push({
      icon: CornerDownRight,
      name: "Inside corners",
      qty: `${nf(m.insideCorners)}×`,
      detail: "Mitered & sealed",
    });
  if (m.endCaps > 0)
    core.push({
      icon: Frame,
      name: "End caps",
      qty: `${nf(m.endCaps)}×`,
      detail: "Left & right closures",
    });

  const drainage: Part[] = [];
  if (drops > 0) {
    drainage.push(
      {
        icon: ArrowDownToLine,
        name: `${config.downspoutSize} downspouts`,
        qty: `${nf(drops)}×`,
        detail: `≈ ${lf(downspoutLF)} · ${dropHeightFt} ft drop`,
      },
      {
        icon: Square,
        name: "Drop outlets",
        qty: `${nf(drops)}×`,
        detail: "Gutter-to-downspout transition",
      },
      {
        icon: Spline,
        name: "Elbows",
        qty: `${nf(elbows)}×`,
        detail: "Two offsets + a kick-out per drop",
      },
      {
        icon: Anchor,
        name: "Downspout straps",
        qty: `${nf(straps)}×`,
        detail: "Secured to the wall",
      },
    );
    if (!acc.rainChain)
      drainage.push({
        icon: Waves,
        name: "Splash blocks",
        qty: `${nf(drops)}×`,
        detail: "Divert water from the foundation",
      });
  }

  const addons: Part[] = [];
  if (acc.guard !== "none")
    addons.push({
      icon: Shield,
      name: GUARD_LABEL[acc.guard],
      qty: lf(eave),
      detail: "Keeps leaves & debris out of the trough",
    });
  if (acc.dripEdge)
    addons.push({
      icon: Frame,
      name: "Drip-edge flashing",
      qty: lf(eave + m.rakeLF),
      detail: "Directs runoff into the gutter",
    });
  if (acc.iceGuard)
    addons.push({
      icon: Snowflake,
      name: "Snow / ice guards",
      qty: lf(eave),
      detail: "Along the eaves in cold climates",
    });
  if (acc.heatTape)
    addons.push({
      icon: Zap,
      name: "Heat cable",
      qty: lf(Math.round(eave * 2)),
      detail: "Self-regulating anti-ice tape",
    });
  if (acc.rainChain)
    addons.push({
      icon: Link2,
      name: "Rain chain",
      qty: "1×",
      detail: "Decorative downspout alternative",
    });

  const groups: PartGroup[] = [{ title: "Gutter line", parts: core }];
  if (drainage.length) groups.push({ title: "Drainage", parts: drainage });
  if (addons.length) groups.push({ title: "Protection & add-ons", parts: addons });
  return groups;
}

/** A floating spec label placed over the schematic. */
function Tag({
  x,
  y,
  children,
  anchor = "start",
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  anchor?: "start" | "end" | "middle";
}) {
  return (
    <foreignObject x={x} y={y} width={130} height={26} overflow="visible">
      <div
        className={cn(
          "flex",
          anchor === "end" && "justify-end",
          anchor === "middle" && "justify-center",
        )}
      >
        <span className="whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-200 backdrop-blur">
          {children}
        </span>
      </div>
    </foreignObject>
  );
}

/**
 * Client-facing "here's the complete system you're getting" view: a clean
 * annotated schematic of the run + downspout train, plus the itemized
 * bill of materials derived from the live takeoff. No pricing — safe to
 * show a homeowner as-is.
 */
export function SystemDiagram({
  config,
  measurements,
}: {
  config: EstimateConfig;
  measurements: Measurements;
}) {
  const color = COLOR_OPTIONS.find((c) => c.id === config.color);
  const hex = color?.hex ?? "#e4e4e7";
  const halfRound = config.style === "half-round";
  const acc = config.accessories ?? DEFAULT_ACCESSORIES;
  const groups = deriveSystemParts(config, measurements);
  const partCount = groups.reduce((n, g) => n + g.parts.length, 0);

  // A slightly darker edge for the colored metal so light fills still read.
  const edge = "#00000022";

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-white/70 px-3 py-2 backdrop-blur">
        <div className="font-label text-[10px] text-zinc-500">
          Complete system
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium text-accent-800 ring-1 ring-inset ring-accent-200">
          {partCount} components
        </div>
      </div>

      {/* ── Annotated schematic ── */}
      <div className="relative border-b border-zinc-100 bg-gradient-to-b from-sky-50 to-white">
        <svg
          viewBox="0 0 420 250"
          className="block h-auto w-full"
          role="img"
          aria-label="Gutter system diagram"
        >
          <defs>
            <linearGradient id="sysSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#eff6fb" />
              <stop offset="1" stopColor="#ffffff" />
            </linearGradient>
            <linearGradient id="sysRoof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#334155" />
              <stop offset="1" stopColor="#1e293b" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="420" height="250" fill="url(#sysSky)" />
          {/* grass */}
          <rect x="0" y="228" width="420" height="22" fill="#dcece0" />

          {/* house wall */}
          <rect x="60" y="96" width="300" height="132" fill="#f1f0ec" />
          <rect x="60" y="96" width="300" height="132" fill="none" stroke="#e4e3de" />

          {/* roof */}
          <polygon points="40,100 210,34 380,100" fill="url(#sysRoof)" />
          <polygon points="40,100 210,34 380,100" fill="none" stroke="#0f172a" strokeOpacity="0.25" />
          {/* fascia band */}
          <rect x="52" y="100" width="316" height="9" fill="#e2e1dc" />

          {/* leaf guard hatch on top of the gutter */}
          {acc.guard !== "none" && (
            <rect
              x="66"
              y="109"
              width="288"
              height="4"
              fill="#64748b"
              fillOpacity="0.5"
            />
          )}

          {/* gutter run (config color) */}
          <g>
            <rect
              x="60"
              y="112"
              width="300"
              height="14"
              rx={halfRound ? 7 : 2.5}
              fill={hex}
              stroke={edge}
            />
            {/* subtle top highlight */}
            <rect
              x="60"
              y="112"
              width="300"
              height="4"
              rx={halfRound ? 7 : 2.5}
              fill="#ffffff"
              fillOpacity="0.25"
            />
          </g>

          {/* hanger ticks */}
          {[100, 150, 200, 250, 300].map((x) => (
            <rect key={x} x={x} y="110" width="2" height="6" fill="#94a3b8" />
          ))}

          {/* downspout train: outlet → offset elbows → run → kick-out */}
          <g stroke={edge} fill={hex}>
            {/* outlet */}
            <rect x="322" y="126" width="16" height="10" />
            {/* upper elbow offset toward wall */}
            <rect x="326" y="136" width="12" height="12" />
            {/* vertical run down the wall */}
            <rect x="336" y="148" width="12" height="70" rx="1.5" />
            {/* kick-out at the bottom */}
            <rect x="336" y="212" width="20" height="11" />
          </g>
          {/* straps */}
          {[168, 196].map((y) => (
            <rect key={y} x="333" y={y} width="18" height="3" rx="1.5" fill="#94a3b8" />
          ))}
          {/* splash block or rain chain */}
          {acc.rainChain ? (
            [188, 200, 212].map((y) => (
              <circle key={y} cx="342" cy={y} r="4" fill="none" stroke="#a1a1aa" strokeWidth="1.5" />
            ))
          ) : (
            <polygon points="348,225 380,225 374,234 354,234" fill="#e5e7eb" stroke="#cbd5e1" />
          )}

          {/* water-flow accent arrow along the roof */}
          <path
            d="M150 70 L188 92"
            stroke="#0ea5e9"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="2 5"
          />

          {/* floating labels */}
          <Tag x={70} y={78}>
            {config.size}″ {halfRound ? "half-round" : "K-style"}
          </Tag>
          <Tag x={250} y={150} anchor="end">
            {config.downspoutSize} downspout
          </Tag>
          {acc.guard !== "none" && (
            <Tag x={150} y={94} anchor="middle">
              {GUARD_LABEL[acc.guard]}
            </Tag>
          )}
        </svg>

        <div className="absolute bottom-2 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-200">
          <span
            className="h-2 w-2 rounded-full ring-1 ring-inset ring-white/50"
            style={{ background: hex }}
          />
          {color?.name ?? "Custom color"}
        </div>
      </div>

      {/* ── Bill of materials ── */}
      <div className="space-y-4 p-4">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="font-label mb-2 text-[10px] text-zinc-400">
              {g.title}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {g.parts.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.name}
                    className="flex items-start gap-2.5 rounded-xl border border-zinc-100 bg-zinc-50/60 px-2.5 py-2"
                  >
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-accent-600 ring-1 ring-inset ring-zinc-200">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium text-zinc-800">
                          {p.name}
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-accent-700">
                          {p.qty}
                        </span>
                      </div>
                      <div className="truncate text-[10px] text-zinc-500">
                        {p.detail}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <p className="flex items-center gap-1.5 pt-1 text-[10px] leading-relaxed text-zinc-400">
          <Droplets className="h-3 w-3 shrink-0" />
          Component counts are derived from your measured takeoff and standard
          installation practice.
        </p>
      </div>
    </div>
  );
}
