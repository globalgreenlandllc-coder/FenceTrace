"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Flame,
  Home,
  Building2,
  Hammer,
  Wrench,
  Trash2,
  Sparkles,
  Inbox,
  Calendar,
  DollarSign,
  Crosshair,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { InteractionStatus } from "@prisma/client";
import type { GutterScore } from "@/lib/leads/gutter-score";
import type { LeadWithInteraction } from "./LeadDetailsPanel";

export type SortMode = "score" | "relevance" | "newest" | "value";

const RELEVANCE_META: Record<
  string,
  { label: string; dot: string; text: string; ring: string }
> = {
  high: {
    label: "Hot",
    dot: "bg-stripe-coral",
    text: "text-stripe-coral",
    ring: "ring-stripe-coral/40",
  },
  medium: {
    label: "Warm",
    dot: "bg-amber-400",
    text: "text-amber-300",
    ring: "ring-amber-500/40",
  },
  low: {
    label: "Cold",
    dot: "bg-sky-400",
    text: "text-sky-300",
    ring: "ring-sky-500/40",
  },
};

const INTERACTION_PILL: Record<
  InteractionStatus,
  { label: string; cls: string }
> = {
  UNREAD: {
    // "Unread" (not "New") — the fresh-ingest "Just in" chip owns the
    // new-arrival vocabulary; this pill is about YOUR interaction state.
    label: "Unread",
    cls: "bg-stripe-coral/15 text-stripe-coral ring-stripe-coral/40",
  },
  CONTACTED: {
    label: "Contacted",
    cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  },
  VISITED: {
    label: "Visited",
    cls: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  },
  BIDDING: {
    label: "Bidding",
    cls: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  },
  NOT_INTERESTED: {
    label: "Skip",
    cls: "bg-white/5 text-zinc-400 ring-white/10",
  },
};

function pickIcon(lead: LeadWithInteraction) {
  const pk = lead.projectKind ?? "";
  const dt = lead.developmentType ?? "";
  if (pk === "Demolition") return Trash2;
  if (pk === "New Construction") {
    if (dt === "Multifamily" || dt === "Condo" || dt === "Townhouse")
      return Building2;
    return Home;
  }
  if (dt === "Multifamily" || dt === "Condo") return Building2;
  if (lead.aiRelevance === "high") return Flame;
  if (pk === "Remodel/Addition") return Wrench;
  return Sparkles;
}

function daysSince(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / (24 * 3600 * 1000));
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatMoney(v: number | null): string | null {
  if (v == null || v <= 0) return null;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
}

/** .skeleton's base gray is tuned for light surfaces — override it with
 *  the dark chrome's white/alpha vocabulary on ink-glass panels. */
const SKELETON_DARK = { backgroundColor: "rgba(255,255,255,0.07)" } as const;

/** Shimmer placeholder mirroring a LeadCard's shape (score ring + chip
 *  row + address + subline) so results landing doesn't reflow the rail. */
function LeadCardSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div
        className="skeleton mt-0.5 h-9 w-9 shrink-0 rounded-full"
        style={SKELETON_DARK}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-3 w-2/5 rounded" style={SKELETON_DARK} />
        <div className="skeleton h-3.5 w-4/5 rounded" style={SKELETON_DARK} />
        <div className="skeleton h-3 w-3/5 rounded" style={SKELETON_DARK} />
      </div>
    </div>
  );
}

export interface LeadsSidebarHandle {
  scrollLeadIntoView: (leadId: string) => void;
}

interface LeadsSidebarProps {
  leads: LeadWithInteraction[];
  /** Gutter Score per lead id — computed once in LeadsMap so the pins,
   *  heatmap, and list all read the same number. */
  scores: Map<string, GutterScore>;
  hoveredLeadId: string | null;
  selectedLeadId: string | null;
  onHover: (lead: LeadWithInteraction | null) => void;
  onSelect: (lead: LeadWithInteraction) => void;
  isLoading: boolean;
  hasMore: boolean;
  sort: SortMode;
  onSortChange: (s: SortMode) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** True when a prospect radius is narrowing this list. */
  radiusActive?: boolean;
}

const LeadsSidebar = forwardRef<LeadsSidebarHandle, LeadsSidebarProps>(
  function LeadsSidebar(
    {
      leads,
      scores,
      hoveredLeadId,
      selectedLeadId,
      onHover,
      onSelect,
      isLoading,
      hasMore,
      sort,
      onSortChange,
      collapsed,
      onToggleCollapse,
      radiusActive,
    },
    ref,
  ) {
    const listRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    useImperativeHandle(
      ref,
      (): LeadsSidebarHandle => ({
        scrollLeadIntoView(leadId) {
          const el = cardRefs.current.get(leadId);
          if (!el || !listRef.current) return;
          // Use the nearest-scroll behavior so the list doesn't jump if
          // the card is already partially visible.
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        },
      }),
    );

    // When the SELECTED lead changes via marker click, auto-scroll it
    // into view in the sidebar so the user can confirm what they picked.
    useEffect(() => {
      if (!selectedLeadId) return;
      const el = cardRefs.current.get(selectedLeadId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [selectedLeadId]);

    // Prime-band count for the collapsed pill — "how much am I missing
    // while the list is tucked away".
    const hotCount = leads.reduce(
      (n, l) => n + ((scores.get(l.id)?.score ?? 0) >= 70 ? 1 : 0),
      0,
    );

    if (collapsed) {
      return (
        <button
          onClick={onToggleCollapse}
          title="Show leads list"
          className="anim-enter-fade ring-focus-dark press-scale absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-ink/90 px-3.5 py-2 shadow-2xl backdrop-blur-xl transition-smooth hover:bg-zinc-900"
        >
          <PanelLeftOpen size={14} className="text-zinc-300" />
          <span className="text-xs font-semibold tabular-nums text-white">
            {isLoading ? "…" : leads.length}
          </span>
          <span className="text-xs text-zinc-400">
            leads{radiusActive ? " in radius" : ""}
          </span>
          {hotCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-stripe-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-stripe-coral ring-1 ring-stripe-coral/40">
              <Flame size={9} />
              {hotCount}
            </span>
          )}
        </button>
      );
    }

    return (
      // Floating glass overlay: left rail on ≥sm, bottom sheet on phones.
      // The map runs full-bleed underneath either way.
      <aside className="absolute inset-x-3 bottom-3 z-20 flex h-[42dvh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink/85 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-3 sm:left-3 sm:top-3 sm:h-auto sm:w-[360px]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-white tabular-nums">
              {isLoading ? "…" : leads.length}
            </span>
            <span className="text-xs text-zinc-400">
              {leads.length === 1 ? "lead" : "leads"}{" "}
              {radiusActive ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <Crosshair size={10} />
                  in radius
                </span>
              ) : (
                "in view"
              )}
              {/* Truncation disclosure must SURVIVE radius mode — the
                  radius stats are computed over the same top-500 subset,
                  so hiding the cap exactly when prospect mode makes
                  quantitative claims would misrepresent the data. */}
              {hasMore && " (of top 500)"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortMode)}
              className="ring-focus-dark rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none transition-smooth focus:border-accent-500"
              title="Sort leads"
            >
              <option value="score">Fence Score</option>
              <option value="relevance">Hot first</option>
              <option value="newest">Newest</option>
              <option value="value">Highest value</option>
            </select>
            <button
              onClick={onToggleCollapse}
              title="Hide list — see the whole map"
              className="ring-focus-dark press-scale rounded-md p-1 text-zinc-400 transition-smooth hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        {/* Body — scrollable list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain"
        >
          {isLoading && leads.length === 0 ? (
            <div className="divide-y divide-white/5">
              {Array.from({ length: 6 }).map((_, i) => (
                <LeadCardSkeleton key={i} />
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="anim-enter-fade flex h-full flex-col items-center justify-center px-6 text-center">
              <Inbox size={32} className="text-zinc-700" />
              <p className="mt-2 text-sm font-medium text-zinc-300">
                No leads here
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Pan or zoom the map, or loosen the filters.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {leads.map((lead, i) => (
                <li
                  key={lead.id}
                  className="anim-enter-fade"
                  style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                >
                  <LeadCard
                    lead={lead}
                    score={scores.get(lead.id) ?? null}
                    isHovered={hoveredLeadId === lead.id}
                    isSelected={selectedLeadId === lead.id}
                    onHover={onHover}
                    onSelect={onSelect}
                    registerRef={(el) => {
                      if (el) cardRefs.current.set(lead.id, el);
                      else cardRefs.current.delete(lead.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    );
  },
);

export default LeadsSidebar;

interface LeadCardProps {
  lead: LeadWithInteraction;
  score: GutterScore | null;
  isHovered: boolean;
  isSelected: boolean;
  onHover: (lead: LeadWithInteraction | null) => void;
  onSelect: (lead: LeadWithInteraction) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

/** True for leads ingested in the last 48h — "new since your last look". */
function isFreshLead(createdAt?: string | null): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && Date.now() - t < 48 * 3600 * 1000;
}

function LeadCard({
  lead,
  score,
  isHovered,
  isSelected,
  onHover,
  onSelect,
  registerRef,
}: LeadCardProps) {
  const Icon = pickIcon(lead);
  const rel = lead.aiRelevance ? RELEVANCE_META[lead.aiRelevance] : null;
  const interactionMeta = lead.interaction
    ? INTERACTION_PILL[lead.interaction.status]
    : null;
  const value = formatMoney(lead.projectValue);
  const age = daysSince(lead.issuedDate);
  const windowNow = score?.window.state === "now";
  const windowSoon = score?.window.state === "soon";
  const fresh = isFreshLead(lead.createdAt);

  return (
    <button
      ref={registerRef}
      onMouseEnter={() => onHover(lead)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(lead)}
      className={`ring-focus-dark group block w-full px-4 py-3.5 text-left transition-smooth ${
        isSelected
          ? "bg-accent-500/10 ring-1 ring-inset ring-accent-500/40"
          : isHovered
            ? "bg-white/[0.06]"
            : "hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Gutter Score meter — the sidebar's primary "should I care"
            signal, same number that sizes the map pin. */}
        {score ? (
          <div className="mt-0.5 shrink-0">
            <MiniScoreRing score={score.score} />
          </div>
        ) : (
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${
              rel ? `${rel.ring} bg-zinc-950` : "bg-zinc-900 ring-white/10"
            }`}
          >
            <Icon
              size={16}
              className={rel ? rel.text : "text-zinc-300"}
              strokeWidth={2.5}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Top row: timing window / relevance + value */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {fresh && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300 ring-1 ring-accent-500/40"
                  title="Ingested in the last 48 hours"
                >
                  JUST IN
                </span>
              )}
              {(windowNow || windowSoon) && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                    windowNow
                      ? "bg-stripe-coral/15 text-stripe-coral ring-stripe-coral/40"
                      : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
                  }`}
                  title={score?.window.detail}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      windowNow ? "bg-stripe-coral" : "bg-amber-400"
                    }`}
                  />
                  {windowNow ? "Call now" : "Call soon"}
                </span>
              )}
              {!windowNow && !windowSoon && rel && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${rel.ring} ${rel.text} bg-zinc-950`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${rel.dot}`} />
                  {rel.label}
                </span>
              )}
              {interactionMeta && (
                <span
                  className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${interactionMeta.cls}`}
                >
                  {interactionMeta.label}
                </span>
              )}
            </div>
            {value && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-accent-300">
                <DollarSign size={10} className="opacity-70" />
                {value.replace("$", "")}
              </span>
            )}
          </div>

          {/* Address */}
          <div className="mt-1 truncate text-sm font-medium text-white">
            {lead.address}
          </div>

          {/* Subline: kind • dev • city */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
            {lead.projectKind && lead.projectKind !== "Other" && (
              <>
                <span className="truncate">{lead.projectKind}</span>
                {(lead.developmentType ||
                  lead.sourceCity ||
                  age) && <span className="text-zinc-600">·</span>}
              </>
            )}
            {lead.developmentType && (
              <>
                <span className="truncate">
                  {lead.developmentType}
                  {lead.housingUnits && lead.housingUnits > 1
                    ? ` (${lead.housingUnits}u)`
                    : ""}
                </span>
                {(lead.sourceCity || age) && (
                  <span className="text-zinc-600">·</span>
                )}
              </>
            )}
            <span className="truncate text-zinc-500">{lead.sourceCity}</span>
            {age && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <Calendar size={9} className="opacity-60" />
                  {age}
                </span>
              </>
            )}
          </div>

          {/* AI summary preview — one line here; full text on click. */}
          {lead.aiSummary && (
            <p className="mt-1.5 line-clamp-1 text-[11px] leading-snug text-zinc-300/70">
              {lead.aiSummary}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

/** Compact circular Gutter Score meter for the list cards. Single-hue
 *  magnitude encoding (accent); coral reserved for the prime band, matching
 *  the map pins. Local copy — LeadsMap imports this file, so importing its
 *  ScoreRing back would be circular. */
function MiniScoreRing({ score }: { score: number }) {
  const size = 36;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 100));
  const prime = score >= 70;
  const color = prime ? "#f8717e" : "#5AA6C6";
  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      title={`Fence Score ${score}/100 — trade fit, timing window, building type, value`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-white">
        {score}
      </span>
    </div>
  );
}
