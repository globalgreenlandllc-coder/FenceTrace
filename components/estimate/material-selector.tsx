"use client";

import { useState } from "react";
import {
  Box,
  Check,
  Droplet,
  Eye,
  Flame,
  Gift,
  Mountain,
  Rotate3d,
  Shield,
  Waves,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EstimateConfig,
  GutterAccessories,
  GutterMaterial,
  GutterSize,
  GutterStyle,
  DownspoutSize,
  Measurements,
} from "@/lib/types";
import { COLOR_OPTIONS } from "@/lib/pricing";
import { formatDelta } from "@/lib/estimate-totals";
import { GutterPreview } from "./gutter-preview";
import { SystemDiagram } from "./system-diagram";

const DEFAULT_ACCESSORIES: GutterAccessories = {
  guard: "none",
  dripEdge: false,
  rainChain: false,
  iceGuard: false,
  heatTape: false,
};

const GUARD_OPTIONS: { id: GutterAccessories["guard"]; label: string; sub: string }[] = [
  { id: "none", label: "None", sub: "Open gutter" },
  { id: "screen", label: "Screen", sub: "Coarse mesh · keeps out leaves" },
  { id: "mesh", label: "Mesh", sub: "Fine mesh · keeps out pine needles" },
  {
    id: "micro-mesh",
    label: "Micro-mesh",
    sub: "Premium · keeps out grit + shingle granules",
  },
];

const SIZES: { id: GutterSize; label: string }[] = [
  { id: "5", label: '5"' },
  { id: "6", label: '6"' },
  { id: "7", label: '7"' },
];

const STYLES: { id: GutterStyle; label: string }[] = [
  { id: "k-style", label: "K-Style" },
  { id: "half-round", label: "Half-Round" },
];

const MATERIALS: { id: GutterMaterial; label: string }[] = [
  { id: "aluminum", label: "Aluminum" },
  { id: "steel", label: "Steel" },
  { id: "copper", label: "Copper" },
];

const DOWNSPOUTS: { id: DownspoutSize; label: string }[] = [
  { id: "2x3", label: '2"×3"' },
  { id: "3x4", label: '3"×4"' },
  { id: "round-3", label: '3" round' },
  { id: "round-4", label: '4" round' },
];

export function MaterialSelector({
  config,
  onChange,
  deltaFor,
  measurements,
}: {
  config: EstimateConfig;
  onChange: (next: EstimateConfig) => void;
  /** Client-total impact of a hypothetical config patch — rendered as
   *  a price pill on each option so the cost of a choice is visible
   *  before it's made. */
  deltaFor?: (patch: Partial<EstimateConfig>) => number;
  /** Live takeoff. When present, unlocks the client-facing "System"
   *  view — the complete bill of materials the homeowner receives. */
  measurements?: Measurements;
}) {
  const accessories = config.accessories ?? DEFAULT_ACCESSORIES;
  const [view, setView] = useState<"interactive" | "system">("interactive");
  const showSystem = view === "system" && !!measurements;
  const setAcc = (patch: Partial<GutterAccessories>) =>
    onChange({ ...config, accessories: { ...accessories, ...patch } });
  const accDelta = (patch: Partial<GutterAccessories>) =>
    deltaFor
      ? formatDelta(deltaFor({ accessories: { ...accessories, ...patch } }))
      : null;
  const accRemovalDelta = (mode: EstimateConfig["oldGutterRemoval"]) =>
    deltaFor ? formatDelta(deltaFor({ oldGutterRemoval: mode })) : null;

  return (
    <div className="space-y-5">
      {measurements ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                type="button"
                onClick={() => setView("interactive")}
                className={cn(
                  "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                  view === "interactive"
                    ? "bg-white text-accent-700 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700",
                )}
              >
                <Rotate3d className="h-3.5 w-3.5" />
                Interactive
              </button>
              <button
                type="button"
                onClick={() => setView("system")}
                className={cn(
                  "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                  view === "system"
                    ? "bg-white text-accent-700 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700",
                )}
              >
                <Box className="h-3.5 w-3.5" />
                System
              </button>
            </div>
            {showSystem && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                <Eye className="h-3 w-3" />
                Client-facing view
              </span>
            )}
          </div>
          {showSystem ? (
            <SystemDiagram config={config} measurements={measurements} />
          ) : (
            <GutterPreview config={config} />
          )}
        </div>
      ) : (
        <GutterPreview config={config} />
      )}

      <Group label="Size">
        <Pills
          options={SIZES}
          value={config.size}
          onChange={(v) => onChange({ ...config, size: v })}
          subFor={deltaFor && ((v) => formatDelta(deltaFor({ size: v })))}
        />
      </Group>
      <Group label="Profile">
        <Pills
          options={STYLES}
          value={config.style}
          onChange={(v) => onChange({ ...config, style: v })}
          subFor={deltaFor && ((v) => formatDelta(deltaFor({ style: v })))}
        />
      </Group>
      <Group label="Material">
        <Pills
          options={MATERIALS}
          value={config.material}
          onChange={(v) => onChange({ ...config, material: v })}
          subFor={deltaFor && ((v) => formatDelta(deltaFor({ material: v })))}
        />
      </Group>
      <Group label="Downspout">
        <Pills
          options={DOWNSPOUTS}
          value={config.downspoutSize}
          onChange={(v) => onChange({ ...config, downspoutSize: v })}
          subFor={
            deltaFor && ((v) => formatDelta(deltaFor({ downspoutSize: v })))
          }
        />
      </Group>
      <Group label="Color">
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map((c) => {
            const selected = config.color === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange({ ...config, color: c.id })}
                title={c.name}
                className={cn(
                  "ring-focus flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-smooth active:scale-[0.98]",
                  selected
                    ? "border-accent-500 bg-accent-50 text-accent-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
                )}
              >
                <span
                  className="h-4 w-4 rounded-full border border-zinc-300 shadow-inner"
                  style={{ background: c.hex }}
                />
                <span className="text-xs">{c.name}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Leaf protection">
        <div className="grid grid-cols-2 gap-1.5">
          {GUARD_OPTIONS.map((g) => {
            const selected = accessories.guard === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setAcc({ guard: g.id })}
                className={cn(
                  "group ring-focus flex items-start gap-2 rounded-lg border p-2.5 text-left transition-smooth active:scale-[0.98]",
                  selected
                    ? "border-accent-500 bg-accent-50 ring-1 ring-accent-200"
                    : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-smooth",
                    selected
                      ? "border-accent-600 bg-accent-600 text-white"
                      : "border-zinc-300 group-hover:border-zinc-400",
                  )}
                >
                  {/* Always mounted so the check can scale in on select */}
                  <Check
                    className={cn(
                      "h-2.5 w-2.5 transition-transform duration-150 ease-out motion-reduce:transition-none",
                      selected ? "scale-100" : "scale-0",
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-900">
                      {g.label}
                    </span>
                    {!selected && accDelta({ guard: g.id }) && (
                      <span className="anim-enter-fade shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400">
                        {accDelta({ guard: g.id })}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500">{g.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Old fence removal">
        {/* Stacks on phones — three ~105px columns squeeze the subtitles
            into 3-4 wrapped lines. */}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {(
            [
              {
                id: "free",
                label: "FREE",
                sub: "Included — shown as a $0 value line",
              },
              {
                id: "priced",
                label: "Charge",
                sub: "Billed per LF of tear-off",
              },
              { id: "none", label: "Off", sub: "No removal line" },
            ] as const
          ).map((opt) => {
            const selected = (config.oldGutterRemoval ?? "none") === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() =>
                  onChange({ ...config, oldGutterRemoval: opt.id })
                }
                className={cn(
                  "ring-focus rounded-lg border p-2.5 text-left transition-smooth active:scale-[0.98]",
                  selected
                    ? "border-accent-500 bg-accent-50 ring-1 ring-accent-200"
                    : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-zinc-900">
                    {opt.label}
                  </span>
                  {opt.id === "free" && (
                    <Gift className="h-3.5 w-3.5 text-accent-600" />
                  )}
                  {!selected &&
                    opt.id !== "free" &&
                    accRemovalDelta(opt.id) && (
                      <span className="text-[10px] font-semibold tabular-nums text-zinc-400">
                        {accRemovalDelta(opt.id)}
                      </span>
                    )}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                  {opt.sub}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
          Free removal shows the client a real dollar value at no charge —
          an easy yes on replacement jobs.
        </p>
      </Group>

      <Group label="Accessories">
        <div className="grid grid-cols-1 gap-1.5">
          <AccessoryRow
            Icon={Mountain}
            label="Drip edge flashing"
            sub="Aluminum, sealed at fascia"
            checked={accessories.dripEdge}
            onChange={(v) => setAcc({ dripEdge: v })}
            delta={accessories.dripEdge ? null : accDelta({ dripEdge: true })}
          />
          <AccessoryRow
            Icon={Droplet}
            label="Decorative rain chain"
            sub="Replaces one downspout with copper chain"
            checked={accessories.rainChain}
            onChange={(v) => setAcc({ rainChain: v })}
            delta={accessories.rainChain ? null : accDelta({ rainChain: true })}
          />
          <AccessoryRow
            Icon={Shield}
            label="Snow / ice guards"
            sub="Roof-edge ice dam protection"
            checked={accessories.iceGuard}
            onChange={(v) => setAcc({ iceGuard: v })}
            delta={accessories.iceGuard ? null : accDelta({ iceGuard: true })}
          />
          <AccessoryRow
            Icon={Flame}
            label="Heat tape kit"
            sub="Self-regulating cable + thermostat"
            checked={accessories.heatTape}
            onChange={(v) => setAcc({ heatTape: v })}
            delta={accessories.heatTape ? null : accDelta({ heatTape: true })}
          />
        </div>
      </Group>
    </div>
  );
}

function AccessoryRow({
  Icon,
  label,
  sub,
  checked,
  onChange,
  delta,
}: {
  Icon: typeof Waves;
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Price impact of turning this on (null when on or unknown). */
  delta?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "ring-focus flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-smooth active:scale-[0.98]",
        checked
          ? "border-accent-500 bg-accent-50 ring-1 ring-accent-200"
          : "border-zinc-200 bg-white hover:border-zinc-300",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset transition-smooth",
          checked
            ? "bg-accent-100 text-accent-700 ring-accent-200"
            : "bg-zinc-50 text-zinc-500 ring-zinc-200",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <div className="text-xs font-medium text-zinc-900">{label}</div>
        <div className="text-[10px] text-zinc-500">{sub}</div>
      </span>
      {delta && (
        <span className="anim-enter-fade shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400">
          {delta}
        </span>
      )}
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border transition-smooth",
          checked
            ? "border-accent-600 bg-accent-600 text-white"
            : "border-zinc-300",
        )}
      >
        {/* Always mounted so the check can scale in on toggle */}
        <Check
          className={cn(
            "h-2.5 w-2.5 transition-transform duration-150 ease-out motion-reduce:transition-none",
            checked ? "scale-100" : "scale-0",
          )}
        />
      </span>
    </button>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="microlabel mb-2">{label}</div>
      {children}
    </div>
  );
}

function Pills<T extends string>({
  options,
  value,
  onChange,
  subFor,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Price pill under each unselected option (e.g. "+$1.2k"). */
  subFor?: (id: T) => string | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const selected = o.id === value;
        const sub = !selected && subFor ? subFor(o.id) : null;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "ring-focus flex flex-col items-center rounded-lg border px-3 py-1.5 transition-smooth active:scale-[0.98]",
              selected
                ? "border-accent-500 bg-accent-50 text-accent-800"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
            )}
          >
            <span className="text-sm leading-5">{o.label}</span>
            {sub && (
              <span className="anim-enter-fade text-[10px] font-semibold leading-3 tabular-nums text-zinc-400">
                {sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
