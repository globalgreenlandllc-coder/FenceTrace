"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Circle,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";
import { InteractionStatus, LeadStatus } from "@prisma/client";
import {
  Loader2,
  Search,
  Flame,
  Home,
  Building2,
  Hammer,
  Inbox,
  SlidersHorizontal,
  X,
  Trash2,
  Wrench,
  Sparkles,
  MapPin,
  Activity,
  Crosshair,
  Route,
  Ruler,
} from "lucide-react";
import {
  computeGutterScore,
  doorKnockRouteUrl,
  haversineMiles,
  type GutterScore,
} from "@/lib/leads/gutter-score";
import LeadDetailsPanel, { LeadWithInteraction } from "./LeadDetailsPanel";
import LeadsSidebar, {
  type LeadsSidebarHandle,
  type SortMode,
} from "./LeadsSidebar";

/* ------------------------------------------------------------------ */
/*   Grid-based marker clustering                                     */
/*                                                                    */
/*   Bin leads into a lat/lng grid whose cell size scales with the    */
/*   current map zoom. Cells holding >=3 leads render as a single     */
/*   cluster badge; cells with <3 render as individual markers.       */
/*                                                                    */
/*   Above zoom 14, clustering disengages entirely (the user has      */
/*   zoomed in far enough that overlap isn't an issue).               */
/* ------------------------------------------------------------------ */
type Cluster = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  /** Leads scoring in the "prime" gutter band (≥70). Drives the coral
   *  share of the cluster ring so a contractor can spot which clusters
   *  are worth zooming into before reading a single address. */
  primeCount: number;
};

function clusterLeads(
  leads: LeadWithInteraction[],
  zoom: number,
  scores: Map<string, GutterScore>,
): { clusters: Cluster[]; unclustered: LeadWithInteraction[] } {
  if (zoom >= 14) return { clusters: [], unclustered: leads };
  // Cell size halves with each zoom level — mirrors how a single
  // screen-pixel maps to fewer real-world degrees as you zoom in. The
  // 0.06 base was tuned empirically against Seattle-area density.
  const gridDeg = 0.06 / Math.pow(2, Math.max(0, zoom - 10));
  const buckets = new Map<string, LeadWithInteraction[]>();
  for (const lead of leads) {
    const bx = Math.floor(lead.longitude / gridDeg);
    const by = Math.floor(lead.latitude / gridDeg);
    const key = `${bx},${by}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(lead);
  }
  const clusters: Cluster[] = [];
  const unclustered: LeadWithInteraction[] = [];
  for (const [key, arr] of buckets.entries()) {
    if (arr.length >= 3) {
      let sumLat = 0;
      let sumLng = 0;
      let prime = 0;
      for (const l of arr) {
        sumLat += l.latitude;
        sumLng += l.longitude;
        if ((scores.get(l.id)?.band ?? "low") === "prime") prime++;
      }
      clusters.push({
        id: `c-${key}`,
        lat: sumLat / arr.length,
        lng: sumLng / arr.length,
        count: arr.length,
        primeCount: prime,
      });
    } else {
      for (const l of arr) unclustered.push(l);
    }
  }
  return { clusters, unclustered };
}

const BBOX_DEBOUNCE_MS = 400;

/** Marker diameter driven by GUTTER SCORE (not raw project value) — the
 *  score already folds in value, trade fit, and timing, so pin size
 *  reads as "how much should I care" rather than "how big is the loan". */
function markerSizePx(score: number): number {
  return Math.round(26 + (Math.max(0, Math.min(100, score)) / 100) * 20);
}

const PING_PERIOD_MS = 2400;

/** Stable per-lead phase offset for the prime-halo pulse. Without it every
 *  halo animates from the same timeline origin and the whole map strobes
 *  in unison; a hash of the id spreads the pulses evenly instead. */
function pingPhaseMs(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % PING_PERIOD_MS;
  return h;
}

// Filter state shape — single object makes preset application atomic and
// makes derivation of active chips a one-liner.
interface FilterState {
  trade: string;
  status: LeadStatus | "All";
  interactionStatus: InteractionStatus | "All";
  buildingType: string;
  projectKind: string;
  developmentType: string;
  relevance: string;
  stage: string;
}

const DEFAULT_FILTERS: FilterState = {
  trade: "All",
  status: "All",
  interactionStatus: "All",
  buildingType: "All",
  projectKind: "All",
  developmentType: "All",
  relevance: "All",
  // Default to "last 12 months" — old finished projects are rarely
  // actionable. User can pick "All time" or a narrower stage band.
  stage: "last-12-months",
};

// Friendly labels for stage values. Cumulative ranges — each one INCLUDES
// the narrower options below it so picking a longer window strictly shows
// more leads.
const STAGE_LABELS: Record<string, string> = {
  "all": "All time",
  "last-30-days": "Last 30 days",
  "last-90-days": "Last 3 months",
  "last-180-days": "Last 6 months",
  "last-12-months": "Last 12 months",
  "older-than-12-months": "Older than 12 months",
};

type PresetId =
  | "gutter-window"
  | "hot-builds"
  | "sfd-remodels"
  | "new-homes"
  | "commercial-builds"
  | "unread";

interface Preset {
  id: PresetId;
  label: string;
  Icon: typeof Flame;
  patch: Partial<FilterState>;
}

// The job-type presets that cover the vast majority of one-click triage.
// Everything else (Townhouses, Unread, permit stage, trade…) lives in the
// Filters panel so the toolbar stays quiet.
const PRESETS: Preset[] = [
  {
    id: "gutter-window",
    label: "Reroofs now",
    Icon: Ruler,
    // Fresh roofing permits — the single highest-conversion gutter moment:
    // gutters come off with the tear-off and the homeowner is deciding
    // rooflines THIS week.
    patch: { trade: "Roofing", stage: "last-90-days" },
  },
  {
    id: "hot-builds",
    label: "Hot builds",
    Icon: Flame,
    patch: { projectKind: "New Construction", relevance: "high" },
  },
  {
    id: "new-homes",
    label: "New homes",
    Icon: Home,
    patch: { buildingType: "Residential", projectKind: "New Construction" },
  },
  {
    id: "sfd-remodels",
    label: "SFD remodels",
    Icon: Hammer,
    patch: { buildingType: "Single Family/Duplex", projectKind: "Remodel/Addition" },
  },
  {
    id: "commercial-builds",
    label: "Commercial",
    Icon: Building2,
    patch: { buildingType: "Commercial", projectKind: "New Construction" },
  },
];

// Returns true when the current filter state EXACTLY matches a preset's patch
// (all preset keys equal the patch, all other keys at default).
function isPresetActive(preset: Preset, current: FilterState): boolean {
  for (const k of Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]) {
    const expected = (preset.patch[k] ?? DEFAULT_FILTERS[k]) as string;
    if (current[k] !== expected) return false;
  }
  return true;
}

// Build the list of human-readable active filter chips for display.
function buildActiveChips(
  current: FilterState,
  updaters: {
    setTrade: (v: string) => void;
    setStatus: (v: LeadStatus | "All") => void;
    setInteraction: (v: InteractionStatus | "All") => void;
    setBuilding: (v: string) => void;
    setProject: (v: string) => void;
    setDevelopment: (v: string) => void;
    setStage: (v: string) => void;
    setRelevance: (v: string) => void;
  },
) {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (current.relevance !== "All") {
    const labelMap: Record<string, string> = { high: "Hot", medium: "Warm", low: "Cold" };
    chips.push({
      key: "relevance",
      label: `${labelMap[current.relevance] ?? current.relevance} leads`,
      clear: () => updaters.setRelevance("All"),
    });
  }
  if (current.projectKind !== "All") {
    chips.push({
      key: "projectKind",
      label: current.projectKind,
      clear: () => updaters.setProject("All"),
    });
  }
  if (current.buildingType !== "All") {
    const labelMap: Record<string, string> = { Residential: "Residential (any)" };
    chips.push({
      key: "buildingType",
      label: labelMap[current.buildingType] ?? current.buildingType,
      clear: () => updaters.setBuilding("All"),
    });
  }
  if (current.developmentType !== "All") {
    chips.push({
      key: "developmentType",
      label: current.developmentType,
      clear: () => updaters.setDevelopment("All"),
    });
  }
  if (current.stage !== DEFAULT_FILTERS.stage) {
    chips.push({
      key: "stage",
      label: STAGE_LABELS[current.stage] ?? current.stage,
      clear: () => updaters.setStage(DEFAULT_FILTERS.stage),
    });
  }
  if (current.trade !== "All") {
    chips.push({
      key: "trade",
      label: current.trade,
      clear: () => updaters.setTrade("All"),
    });
  }
  if (current.interactionStatus !== "All") {
    chips.push({
      key: "interactionStatus",
      label: `My: ${String(current.interactionStatus).replace(/_/g, " ").toLowerCase()}`,
      clear: () => updaters.setInteraction("All"),
    });
  }
  if (current.status !== "All") {
    chips.push({
      key: "status",
      label: String(current.status).replace(/_/g, " ").toLowerCase(),
      clear: () => updaters.setStatus("All"),
    });
  }
  return chips;
}

interface MapControlsProps {
  /** True while the floating leads list is expanded — the toolbar slides
   *  right so the two never overlap. */
  sidebarOpen: boolean;
  filters: FilterState;
  setTradeFilter: (v: string) => void;
  setStatusFilter: (v: LeadStatus | "All") => void;
  setInteractionFilter: (v: InteractionStatus | "All") => void;
  setBuildingTypeFilter: (v: string) => void;
  setProjectKindFilter: (v: string) => void;
  setDevelopmentTypeFilter: (v: string) => void;
  setStageFilter: (v: string) => void;
  setRelevanceFilter: (v: string) => void;
  applyPreset: (preset: Preset) => void;
  clearAll: () => void;
  onSearch: (bbox: string | null) => void;
  isLoading: boolean;
}

function MapControls({
  sidebarOpen,
  filters,
  setTradeFilter,
  setStatusFilter,
  setInteractionFilter,
  setBuildingTypeFilter,
  setProjectKindFilter,
  setDevelopmentTypeFilter,
  setStageFilter,
  setRelevanceFilter,
  applyPreset,
  clearAll,
  onSearch,
  isLoading,
}: MapControlsProps) {
  const map = useMap();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleSearchClick = () => {
    if (!map) return onSearch(null);
    const bounds = map.getBounds();
    if (!bounds) return onSearch(null);
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    onSearch(`${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`);
  };

  const chips = buildActiveChips(filters, {
    setTrade: setTradeFilter,
    setStatus: setStatusFilter,
    setInteraction: setInteractionFilter,
    setBuilding: setBuildingTypeFilter,
    setProject: setProjectKindFilter,
    setDevelopment: setDevelopmentTypeFilter,
    setStage: setStageFilter,
    setRelevance: setRelevanceFilter,
  });
  const activeCount = chips.length;

  const selectBase =
    "bg-zinc-900 text-sm text-white rounded-lg px-3 py-2 border border-white/10 outline-none transition-smooth focus:border-accent-500 ring-focus-dark";

  return (
    <div
      className={`absolute top-4 left-4 right-4 sm:right-auto z-10 bg-ink/95 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl overflow-hidden transition-[left] duration-300 max-w-[min(900px,calc(100vw-2rem))] ${
        // On ≥sm the list floats over the map's left edge (360px + gutters)
        // while expanded; slide the toolbar right so they never stack. On
        // phones the list is a bottom sheet, so the toolbar keeps the top.
        sidebarOpen
          ? "sm:left-[384px] sm:max-w-[calc(100vw-384px-1rem)]"
          : ""
      }`}
    >
      {/* Row 1: Presets + Search button */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-white/10">
        {PRESETS.map((p) => {
          const active = isPresetActive(p, filters);
          return (
            <button
              key={p.id}
              onClick={() => (active ? clearAll() : applyPreset(p))}
              className={`ring-focus-dark press-scale inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-smooth ring-1 ${
                active
                  ? "bg-accent-500/15 text-accent-200 ring-accent-500/50"
                  : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 hover:text-white"
              }`}
            >
              <p.Icon size={12} />
              {p.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className={`ring-focus-dark press-scale inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-smooth ring-1 ${
            advancedOpen
              ? "bg-white/10 text-white ring-white/15"
              : "bg-white/5 text-zinc-300 ring-white/10 hover:text-white"
          }`}
        >
          <SlidersHorizontal size={12} />
          Filters{activeCount > 0 && ` (${activeCount})`}
        </button>
        <button
          onClick={handleSearchClick}
          disabled={isLoading}
          className="ring-focus-dark press-scale bg-accent-600 hover:bg-accent-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-smooth inline-flex items-center gap-1.5"
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search this area
        </button>
      </div>

      {/* Row 2: Advanced filters (collapsible) */}
      {advancedOpen && (
        <div className="anim-enter-fade flex flex-wrap gap-2 px-3 py-2.5 border-b border-white/10">
          <select
            className={selectBase}
            value={filters.projectKind}
            onChange={(e) => setProjectKindFilter(e.target.value)}
          >
            <option value="All">All project types</option>
            <option value="New Construction">New Construction</option>
            <option value="Remodel/Addition">Remodel / Addition</option>
            <option value="Tenant Improvement">Tenant Improvement</option>
            <option value="Demolition">Demolition</option>
            <option value="Other">Other</option>
          </select>
          <select
            className={selectBase}
            value={filters.buildingType}
            onChange={(e) => setBuildingTypeFilter(e.target.value)}
          >
            <option value="All">All building types</option>
            <option value="Residential">Residential (any)</option>
            <option value="Single Family/Duplex">Single Family / Duplex</option>
            <option value="Multifamily">Multifamily</option>
            <option value="Commercial">Commercial</option>
            <option value="Institutional">Institutional</option>
            <option value="Industrial">Industrial</option>
          </select>
          <select
            className={selectBase}
            value={filters.developmentType}
            onChange={(e) => setDevelopmentTypeFilter(e.target.value)}
          >
            <option value="All">All development types</option>
            <option value="Single Family">Single Family</option>
            <option value="Duplex">Duplex</option>
            <option value="Townhouse">Townhouse</option>
            <option value="Condo">Condo</option>
            <option value="Multifamily">Multifamily</option>
            <option value="ADU">ADU / DADU</option>
            <option value="Plat">Plat</option>
            <option value="Short Plat">Short Plat</option>
          </select>
          <select
            className={selectBase}
            value={filters.stage}
            onChange={(e) => setStageFilter(e.target.value)}
            title="Approximates how far along construction is, based on how long ago the permit was issued."
          >
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            className={selectBase}
            value={filters.relevance}
            onChange={(e) => setRelevanceFilter(e.target.value)}
          >
            <option value="All">Any relevance</option>
            <option value="high">Hot leads</option>
            <option value="medium">Warm leads</option>
            <option value="low">Cold leads</option>
          </select>
          <select
            className={selectBase}
            value={filters.trade}
            onChange={(e) => setTradeFilter(e.target.value)}
          >
            <option value="All">All trades</option>
            <option value="Roofing">Roofing</option>
            <option value="Gutters">Gutters</option>
            <option value="Framing">Framing</option>
            <option value="Siding">Siding</option>
            <option value="Windows">Windows</option>
            <option value="General">General</option>
          </select>
          <select
            className={selectBase}
            value={filters.interactionStatus}
            onChange={(e) =>
              setInteractionFilter(e.target.value as InteractionStatus | "All")
            }
          >
            <option value="All">All my statuses</option>
            <option value={InteractionStatus.UNREAD}>Unread</option>
            <option value={InteractionStatus.CONTACTED}>Contacted</option>
            <option value={InteractionStatus.VISITED}>Visited</option>
            <option value={InteractionStatus.BIDDING}>Bidding</option>
            <option value={InteractionStatus.NOT_INTERESTED}>Not interested</option>
          </select>
          <select
            className={selectBase}
            value={filters.status}
            onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "All")}
          >
            <option value="All">All permit statuses</option>
            <option value={LeadStatus.APPLIED}>Applied</option>
            <option value={LeadStatus.UNDER_REVIEW}>Under Review</option>
            <option value={LeadStatus.ISSUED}>Issued</option>
            <option value={LeadStatus.INSPECTION}>Inspection</option>
            <option value={LeadStatus.FINALED}>Finaled</option>
            <option value={LeadStatus.UNKNOWN}>Unknown</option>
          </select>
        </div>
      )}

      {/* Row 3: Active filter chips */}
      {activeCount > 0 && (
        <div className="anim-enter-fade flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white/[0.03]">
          <span className="font-label text-[10px] text-zinc-500 mr-1">
            Active
          </span>
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={c.clear}
              className="ring-focus-dark press-scale inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-accent-500/15 text-accent-200 ring-1 ring-accent-500/40 hover:bg-accent-500/25 transition-smooth"
            >
              {c.label}
              <X size={10} />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="ring-focus-dark ml-1 rounded text-[11px] text-zinc-400 transition-smooth hover:text-white underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*   Prospect mode — click-to-drop radius circle for door-knock runs   */
/* ------------------------------------------------------------------ */
type ProspectState = {
  center: { lat: number; lng: number };
  radiusMi: number;
};

const RADIUS_OPTIONS = [0.5, 1, 2];
const METERS_PER_MILE = 1609.344;

/** Radius overlay — @vis.gl v1.8 ships a controlled <Circle> component,
 *  so no imperative lifecycle management is needed. */
function ProspectCircle({ prospect }: { prospect: ProspectState }) {
  return (
    <Circle
      center={prospect.center}
      radius={prospect.radiusMi * METERS_PER_MILE}
      strokeColor="#1479B8"
      strokeOpacity={0.9}
      strokeWeight={2}
      fillColor="#1479B8"
      fillOpacity={0.08}
      clickable={false}
    />
  );
}

export default function LeadsMap({ apiKey }: { apiKey: string }) {
  const [leads, setLeads] = useState<LeadWithInteraction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadWithInteraction | null>(null);
  const [hoveredLead, setHoveredLead] = useState<LeadWithInteraction | null>(null);
  const [bbox, setBbox] = useState<string>("");
  const [tradeFilter, setTradeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "All">("All");
  const [interactionFilter, setInteractionFilter] = useState<InteractionStatus | "All">("All");
  const [buildingTypeFilter, setBuildingTypeFilter] = useState("All");
  const [projectKindFilter, setProjectKindFilter] = useState("All");
  const [developmentTypeFilter, setDevelopmentTypeFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState<string>(DEFAULT_FILTERS.stage);
  const [relevanceFilter, setRelevanceFilter] = useState("All");
  const [isLoading, setIsLoading] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(11);
  const [sort, setSort] = useState<SortMode>("score");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Smart auto-hide: opening a lead's details collapses the list so the
  // map + panel get the full width; closing the details restores it. If
  // the user re-expands the list WHILE details are open, they're telling
  // us they want both — stop auto-hiding for the rest of the session.
  const autoHideRef = useRef(true);
  const autoCollapsedRef = useRef(false);
  const [viewMode, setViewMode] = useState<"pins" | "heatmap">("pins");
  // Prospect mode: armed → next map click drops a radius circle; the
  // sidebar then narrows to leads inside it and the stats bar offers a
  // door-knock route through the best ones.
  const [prospectArmed, setProspectArmed] = useState(false);
  const [prospect, setProspect] = useState<ProspectState | null>(null);
  // Visible diagnostic when the fetch fails. Without this the map just
  // looks empty and the user has no way to tell whether (a) no leads
  // match the filter, (b) the API errored, or (c) the session expired
  // and the request got redirected to /sign-in.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const bboxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<LeadsSidebarHandle>(null);
  // Abort the in-flight request when a newer one starts. Without this, the
  // unbounded initial fetch (no bbox yet) races the first bbox-constrained
  // fetch ~400ms later — if the slow one resolves last, stale off-viewport
  // results clobber the fresh ones and stick until the next pan.
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Single source of truth for fetching. Caller can pass a bbox override so
  // the "Search this area" button can use the LIVE map bounds without waiting
  // for the debounced state propagation.
  const fetchLeads = useCallback(
    async (overrideBbox?: string) => {
      const effectiveBbox = overrideBbox ?? bbox;
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      setIsLoading(true);
      try {
        const url = new URL("/api/leads", window.location.origin);
        if (effectiveBbox) url.searchParams.set("bbox", effectiveBbox);
        if (tradeFilter !== "All") url.searchParams.set("trade", tradeFilter);
        if (statusFilter !== "All") url.searchParams.set("status", statusFilter);
        if (interactionFilter !== "All") {
          url.searchParams.set("interactionStatus", interactionFilter);
        }
        if (buildingTypeFilter !== "All") {
          url.searchParams.set("buildingType", buildingTypeFilter);
        }
        if (projectKindFilter !== "All") {
          url.searchParams.set("projectKind", projectKindFilter);
        }
        if (developmentTypeFilter !== "All") {
          url.searchParams.set("developmentType", developmentTypeFilter);
        }
        if (stageFilter && stageFilter !== DEFAULT_FILTERS.stage) {
          url.searchParams.set("stage", stageFilter);
        } else if (stageFilter === DEFAULT_FILTERS.stage) {
          // Send the default explicitly so the server's default and the
          // client's default stay in sync if either changes.
          url.searchParams.set("stage", stageFilter);
        }
        if (relevanceFilter !== "All") {
          url.searchParams.set("relevance", relevanceFilter);
        }

        const res = await fetch(url.toString(), {
          redirect: "manual",
          signal: controller.signal,
        });
        // Redirect-to-sign-in (Clerk middleware) lands here when the
        // session expires mid-session. fetch with redirect:"manual"
        // surfaces this as an opaque response with type "opaqueredirect"
        // rather than silently following to an HTML page.
        if (res.type === "opaqueredirect" || res.status === 0) {
          setFetchError(
            "Session expired — refresh the page to sign back in.",
          );
          setLeads([]);
          setResultCount(0);
          return;
        }
        if (!res.ok) {
          // Pull the server-side error message + Prisma metadata out of
          // the JSON body. P2022 (column missing) puts the column name
          // at meta.column; P2021 puts the table at meta.table. Render
          // whichever is present so the toast is actually actionable.
          let detail = "";
          try {
            const body = (await res.json()) as {
              error?: string;
              code?: string;
              meta?: { column?: string; table?: string };
            };
            if (body?.error) detail = ` — ${body.error}`;
            if (body?.code) detail += ` [${body.code}]`;
            if (body?.meta?.column) detail += ` (column: ${body.meta.column})`;
            if (body?.meta?.table) detail += ` (table: ${body.meta.table})`;
          } catch {
            // not JSON
          }
          setFetchError(
            `Lead fetch failed (HTTP ${res.status})${detail}`,
          );
          setLeads([]);
          setResultCount(0);
          return;
        }
        const data = await res.json();
        setFetchError(null);
        setLeads(data.leads ?? []);
        setHasMore(Boolean(data.hasMore));
        setResultCount(data.leads?.length ?? 0);
      } catch (e) {
        // Superseded by a newer request — its handlers own the UI now.
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("Failed to fetch leads", e);
        setFetchError(
          e instanceof Error
            ? `Network error: ${e.message}`
            : "Network error fetching leads.",
        );
      } finally {
        // Only the LATEST request may clear the spinner — an aborted
        // predecessor reaching finally must not end the newer one's
        // loading state early.
        if (fetchAbortRef.current === controller) setIsLoading(false);
      }
    },
    [bbox, tradeFilter, statusFilter, interactionFilter, buildingTypeFilter, projectKindFilter, developmentTypeFilter, stageFilter, relevanceFilter],
  );

  // Auto-fetch whenever any filter or the (debounced) bbox changes.
  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Phones: start with the list tucked away — the map is the product.
  useEffect(() => {
    if (window.innerWidth < 640) setSidebarCollapsed(true);
  }, []);

  // Auto-hide wiring (see autoHideRef above).
  useEffect(() => {
    if (selectedLead) {
      if (autoHideRef.current && !sidebarCollapsed) {
        autoCollapsedRef.current = true;
        setSidebarCollapsed(true);
      }
    } else if (autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setSidebarCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  useEffect(() => {
    return () => {
      if (bboxDebounceRef.current) clearTimeout(bboxDebounceRef.current);
    };
  }, []);

  const handleManualSearch = useCallback(
    (liveBbox: string | null) => {
      // Cancel any pending debounce so we don't double-fetch.
      if (bboxDebounceRef.current) {
        clearTimeout(bboxDebounceRef.current);
        bboxDebounceRef.current = null;
      }
      if (liveBbox && liveBbox !== bbox) {
        // Updating bbox triggers the auto-fetch via useEffect.
        setBbox(liveBbox);
      } else {
        // bbox unchanged (or no map ref) — force a refetch.
        fetchLeads(liveBbox ?? undefined);
      }
    },
    [bbox, fetchLeads],
  );

  const handleUpdateInteraction = async (
    leadId: string,
    status: InteractionStatus,
    notes: string,
  ) => {
    try {
      const res = await fetch("/api/leads/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, status, notes }),
      });

      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, interaction: { status, notes } } : l,
          ),
        );
        if (selectedLead?.id === leadId) {
          setSelectedLead({ ...selectedLead, interaction: { status, notes } });
        }
      }
    } catch (e) {
      console.error("Failed to update interaction", e);
    }
  };

  // Gutter Score for every lead in view — the one number the whole page
  // sorts, sizes, and colors by. Pure + cheap (regex over 500 strings).
  const scores = useMemo(() => {
    const m = new Map<string, GutterScore>();
    for (const l of leads) m.set(l.id, computeGutterScore(l));
    return m;
  }, [leads]);

  // Picks a marker glyph by priority: development / project kind first,
  // then relevance. The glyph + interaction color together communicate
  // type AND status at a glance.
  const pickMarkerIcon = (lead: LeadWithInteraction): typeof Home => {
    const pk = lead.projectKind ?? "";
    const dt = lead.developmentType ?? "";
    if (pk === "Demolition") return Trash2;
    if (pk === "New Construction") {
      if (dt === "Multifamily" || dt === "Condo" || dt === "Townhouse") return Building2;
      return Home;
    }
    if (dt === "Multifamily" || dt === "Condo") return Building2;
    if (lead.aiRelevance === "high") return Flame;
    if (pk === "Remodel/Addition") return Wrench;
    return Sparkles;
  };

  // Interaction status → pin color. Semantic, matches the sidebar pills:
  // coral = untouched (act!), emerald = contacted, sky = visited,
  // amber = bidding, zinc = passed on.
  const getPinColor = (interactionStatus?: InteractionStatus) => {
    switch (interactionStatus) {
      case InteractionStatus.CONTACTED:
        return "#10b981";
      case InteractionStatus.VISITED:
        return "#38bdf8";
      case InteractionStatus.NOT_INTERESTED:
        return "#71717a";
      case InteractionStatus.BIDDING:
        return "#f59e0b";
      default:
        return "#f8717e"; // stripe-coral — brand "untouched lead"
    }
  };

  // Prospect-radius filter — when a circle is down, the sidebar and the
  // stats bar narrow to leads inside it. The map keeps rendering all pins
  // so context isn't lost.
  const inRadius = useMemo(() => {
    if (!prospect) return null;
    return leads.filter(
      (l) =>
        haversineMiles(prospect.center, { lat: l.latitude, lng: l.longitude }) <=
        prospect.radiusMi,
    );
  }, [leads, prospect]);

  // Sorted view for the sidebar. The map always renders all leads; the
  // sidebar shows them in the contractor's chosen priority order.
  const sortedLeads = useMemo(() => {
    const arr = inRadius ? [...inRadius] : [...leads];
    const relRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    if (sort === "score") {
      arr.sort((a, b) => {
        const sa = scores.get(a.id)?.score ?? 0;
        const sb = scores.get(b.id)?.score ?? 0;
        if (sb !== sa) return sb - sa;
        const da = a.issuedDate ? new Date(a.issuedDate).getTime() : 0;
        const db = b.issuedDate ? new Date(b.issuedDate).getTime() : 0;
        return db - da;
      });
    } else if (sort === "relevance") {
      arr.sort((a, b) => {
        const ra = relRank[a.aiRelevance ?? ""] ?? 3;
        const rb = relRank[b.aiRelevance ?? ""] ?? 3;
        if (ra !== rb) return ra - rb;
        // Tiebreaker: newer issued date first.
        const da = a.issuedDate ? new Date(a.issuedDate).getTime() : 0;
        const db = b.issuedDate ? new Date(b.issuedDate).getTime() : 0;
        return db - da;
      });
    } else if (sort === "newest") {
      arr.sort((a, b) => {
        const da = a.issuedDate ? new Date(a.issuedDate).getTime() : 0;
        const db = b.issuedDate ? new Date(b.issuedDate).getTime() : 0;
        return db - da;
      });
    } else {
      // "value"
      arr.sort((a, b) => (b.projectValue ?? 0) - (a.projectValue ?? 0));
    }
    return arr;
  }, [leads, sort, scores, inRadius]);

  // Prospect stats + door-knock route through the best in-radius leads.
  const prospectStats = useMemo(() => {
    if (!inRadius) return null;
    let totalValue = 0;
    let prime = 0;
    for (const l of inRadius) {
      totalValue += l.projectValue ?? 0;
      if ((scores.get(l.id)?.band ?? "low") === "prime") prime++;
    }
    const top = [...inRadius]
      .sort((a, b) => (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0))
      .slice(0, 10)
      .map((l) => ({ lat: l.latitude, lng: l.longitude }));
    return {
      count: inRadius.length,
      prime,
      totalValue,
      routeUrl: doorKnockRouteUrl(top),
    };
  }, [inRadius, scores]);

  // Cluster at the current zoom. Memo so we only recompute when leads or
  // zoom actually change — onBoundsChanged fires constantly during pan.
  const { clusters, unclustered } = useMemo(
    () => clusterLeads(leads, zoom, scores),
    [leads, zoom, scores],
  );

  const hoveredScore = hoveredLead ? scores.get(hoveredLead.id) : undefined;

  return (
    // Desktop: shell header is h-16 (4rem). Mobile: sticky top bar (h-14 +
    // nav-chip row ≈ 6rem) + page-title row (≈ 3.25rem) sit above the map,
    // so subtract ~9.25rem there. min-h keeps the cockpit usable on short
    // landscape viewports.
    //
    // The map is FULL-BLEED; the leads list and detail panel float over it
    // as translucent glass overlays, so panels never steal map width.
    <div className="relative h-[calc(100dvh-9.25rem)] min-h-[420px] w-full overflow-hidden bg-ink lg:h-[calc(100vh-3.5rem)]">
      <APIProvider apiKey={apiKey} libraries={["visualization"]}>
        <div className="absolute inset-0">
          <MapControls
            sidebarOpen={!sidebarCollapsed}
            filters={{
              trade: tradeFilter,
              status: statusFilter,
              interactionStatus: interactionFilter,
              buildingType: buildingTypeFilter,
              projectKind: projectKindFilter,
              developmentType: developmentTypeFilter,
              stage: stageFilter,
              relevance: relevanceFilter,
            }}
            setTradeFilter={setTradeFilter}
            setStatusFilter={setStatusFilter}
            setInteractionFilter={setInteractionFilter}
            setBuildingTypeFilter={setBuildingTypeFilter}
            setProjectKindFilter={setProjectKindFilter}
            setDevelopmentTypeFilter={setDevelopmentTypeFilter}
            setStageFilter={setStageFilter}
            setRelevanceFilter={setRelevanceFilter}
            applyPreset={(p) => {
              setTradeFilter(p.patch.trade ?? "All");
              setStatusFilter(p.patch.status ?? "All");
              setInteractionFilter(p.patch.interactionStatus ?? "All");
              setBuildingTypeFilter(p.patch.buildingType ?? "All");
              setProjectKindFilter(p.patch.projectKind ?? "All");
              setDevelopmentTypeFilter(p.patch.developmentType ?? "All");
              setStageFilter(p.patch.stage ?? DEFAULT_FILTERS.stage);
              setRelevanceFilter(p.patch.relevance ?? "All");
            }}
            clearAll={() => {
              setTradeFilter("All");
              setStatusFilter("All");
              setInteractionFilter("All");
              setBuildingTypeFilter("All");
              setProjectKindFilter("All");
              setDevelopmentTypeFilter("All");
              setStageFilter(DEFAULT_FILTERS.stage);
              setRelevanceFilter("All");
            }}
            onSearch={handleManualSearch}
            isLoading={isLoading}
          />

          {/* Result indicator + view-mode toggle (top-right of map) */}
          <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
            <div className="pointer-events-auto inline-flex rounded-xl border border-white/10 bg-ink/90 p-1 shadow-xl backdrop-blur-md">
              <button
                onClick={() => setViewMode("pins")}
                title="Show individual leads"
                className={`ring-focus-dark press-scale inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-smooth ${
                  viewMode === "pins"
                    ? "bg-accent-500/15 text-accent-200 ring-1 ring-inset ring-accent-500/40"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <MapPin size={12} />
                Pins
              </button>
              <button
                onClick={() => setViewMode("heatmap")}
                title="Show opportunity heatmap (weighted by Fence Score)"
                className={`ring-focus-dark press-scale inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-smooth ${
                  viewMode === "heatmap"
                    ? "bg-stripe-coral/15 text-stripe-coral ring-1 ring-inset ring-stripe-coral/40"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Activity size={12} />
                Heatmap
              </button>
              <button
                onClick={() => {
                  if (prospect || prospectArmed) {
                    setProspect(null);
                    setProspectArmed(false);
                  } else {
                    setProspectArmed(true);
                  }
                }}
                title="Prospect a neighborhood: click the map to drop a radius, get a door-knock route"
                className={`ring-focus-dark press-scale inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-smooth ${
                  prospectArmed || prospect
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/40"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Crosshair size={12} />
                Prospect
              </button>
            </div>
            {prospectArmed && !prospect && (
              <div className="anim-enter-fade pointer-events-none rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 shadow-xl backdrop-blur-md">
                Click anywhere on the map to drop a prospecting radius
              </div>
            )}
            {resultCount !== null && isLoading && (
              <div className="anim-enter-fade pointer-events-none rounded-lg border border-white/10 bg-ink/90 px-3 py-2 text-xs text-zinc-300 shadow-xl backdrop-blur-md">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Searching…
                </span>
              </div>
            )}
            {fetchError && (
              <div className="anim-enter-fade pointer-events-none max-w-[320px] rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 backdrop-blur-md">
                {fetchError}
              </div>
            )}
          </div>

          {/* Prospect stats bar. Mobile: full-width wrap above the bottom
              edge; desktop: centered on the map, nudged left while the
              400px details panel overlays the map's right side. */}
          {prospect && prospectStats && (
            // anim-enter-fade (opacity only): the bar centers itself with
            // sm:-translate-x-1/2, so a transform-keyframe entrance would
            // override the centering mid-animation and cause a jump.
            <div
              className={`anim-enter-fade absolute bottom-5 left-3 right-3 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-ink/95 px-4 py-2.5 shadow-2xl backdrop-blur-md sm:right-auto sm:max-w-[min(92%,640px)] ${
                selectedLead
                  ? "sm:left-[calc(50%-200px)] sm:-translate-x-1/2"
                  : "sm:left-1/2 sm:-translate-x-1/2"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                <Crosshair size={12} className="text-emerald-300" />
                <span className="font-semibold text-white tabular-nums">
                  {prospectStats.count}
                </span>
                leads
                {hasMore && (
                  <span
                    className="text-[10px] text-zinc-500"
                    title="The map holds the top 500 leads for this view (ranked by relevance + recency) — widen filters or zoom in for full coverage."
                  >
                    of top 500
                  </span>
                )}
                {prospectStats.prime > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-stripe-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-stripe-coral ring-1 ring-stripe-coral/40">
                    {prospectStats.prime} prime
                  </span>
                )}
              </div>
              {prospectStats.totalValue >= 1000 && (
                <div className="text-xs text-zinc-400">
                  <span className="font-semibold text-accent-300 tabular-nums">
                    $
                    {prospectStats.totalValue >= 1_000_000
                      ? `${(prospectStats.totalValue / 1_000_000).toFixed(1)}M`
                      : `${Math.round(prospectStats.totalValue / 1000)}k`}
                  </span>{" "}
                  in permits
                </div>
              )}
              <div className="flex items-center gap-1">
                {RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setProspect((p) => (p ? { ...p, radiusMi: r } : p))}
                    className={`ring-focus-dark press-scale rounded-md px-2 py-1 text-[11px] font-medium transition-smooth ${
                      prospect.radiusMi === r
                        ? "bg-accent-500/20 text-accent-200 ring-1 ring-accent-500/40"
                        : "text-zinc-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {r} mi
                  </button>
                ))}
              </div>
              {prospectStats.routeUrl && prospectStats.count > 0 && (
                <a
                  href={prospectStats.routeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ring-focus-dark press-scale inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-smooth hover:bg-emerald-500"
                  title="Open a driving route through the top-scored leads in this radius"
                >
                  <Route size={12} />
                  Door-knock route
                </a>
              )}
              <button
                onClick={() => {
                  setProspect(null);
                  setProspectArmed(false);
                }}
                className="ring-focus-dark press-scale rounded-md p-1 text-zinc-400 transition-smooth hover:bg-white/10 hover:text-white"
                title="Clear prospecting radius"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Center overlay when the fetch succeeded but returned no leads
              — gives the user something to act on (pan the map / widen
              the filters) instead of staring at an empty satellite tile. */}
          {!isLoading &&
            !fetchError &&
            resultCount === 0 &&
            leads.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
                <div className="anim-enter pointer-events-auto max-w-sm rounded-xl border border-white/10 bg-ink/95 px-5 py-4 text-center shadow-2xl backdrop-blur">
                  <Inbox className="mx-auto h-7 w-7 text-zinc-500" />
                  <div className="mt-2 text-sm font-medium text-white">
                    No leads in this view
                  </div>
                  <p className="mt-1 text-xs leading-snug text-zinc-400">
                    Pan or zoom to a different area, or clear active
                    filters (e.g. preset chips, date range) to widen the
                    search.
                  </p>
                </div>
              </div>
            )}

          <GoogleMap
            defaultCenter={{ lat: 47.6062, lng: -122.3321 }}
            defaultZoom={11}
            mapId="DEMO_MAP_ID"
            colorScheme="DARK"
            disableDefaultUI={true}
            onClick={(e: MapMouseEvent) => {
              if (!prospectArmed) return;
              const ll = e.detail.latLng;
              if (!ll) return;
              setProspect({ center: { lat: ll.lat, lng: ll.lng }, radiusMi: 1 });
              setProspectArmed(false);
            }}
            onBoundsChanged={(e) => {
              const bounds = e.map.getBounds();
              if (!bounds) return;
              const z = e.map.getZoom();
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              const next = `${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`;
              if (bboxDebounceRef.current) clearTimeout(bboxDebounceRef.current);
              // Zoom settles WITH the bbox, once, after the gesture ends.
              // Vector maps report fractional zoom on every animation
              // frame; updating zoom state per frame re-binned the cluster
              // grid 60×/s, remounting badges mid-gesture (flash + jump).
              bboxDebounceRef.current = setTimeout(() => {
                if (typeof z === "number") setZoom(z);
                setBbox(next);
              }, BBOX_DEBOUNCE_MS);
            }}
          >
            {/* Pans to selected lead — only when selection ID changes */}
            <MapPanner target={selectedLead} />

            {prospect && <ProspectCircle prospect={prospect} />}

            {viewMode === "heatmap" && (
              <HeatmapLayer leads={leads} scores={scores} />
            )}

            {/* Cluster badges (zoom < 14) */}
            {viewMode === "pins" &&
              clusters.map((c) => (
                <ClusterMarker
                  key={c.id}
                  cluster={c}
                  onProspectAt={
                    prospectArmed
                      ? (center) => {
                          setProspect({ center, radiusMi: 1 });
                          setProspectArmed(false);
                        }
                      : undefined
                  }
                />
              ))}

            {/* Individual markers */}
            {viewMode === "pins" &&
              unclustered.map((lead) => {
              const color = getPinColor(lead.interaction?.status);
              const Icon = pickMarkerIcon(lead);
              const score = scores.get(lead.id);
              // "Act now" signals are suppressed once the user explicitly
              // passed on the lead — a coral pulse on a NOT_INTERESTED pin
              // nags about a decision already made.
              const passedOn =
                lead.interaction?.status === InteractionStatus.NOT_INTERESTED;
              const isPrime = (score?.band ?? "low") === "prime" && !passedOn;
              const isHovered = hoveredLead?.id === lead.id;
              const isSelected = selectedLead?.id === lead.id;
              // Score-driven base size; hover / select bump it slightly
              // for visual feedback without overriding the score cue.
              const baseSize = markerSizePx(score?.score ?? 0);
              const size = isSelected
                ? baseSize + 8
                : isHovered
                  ? baseSize + 4
                  : baseSize;
              const iconSize = Math.round(size * 0.45);
              return (
                <AdvancedMarker
                  key={lead.id}
                  position={{ lat: lead.latitude, lng: lead.longitude }}
                  onClick={() => {
                    // Markers sit above the map canvas and swallow its
                    // clicks — while prospect mode is armed, a click on a
                    // pin must drop the radius (centered on the pin, the
                    // natural target in a dense area), not open the panel.
                    if (prospectArmed) {
                      setProspect({
                        center: { lat: lead.latitude, lng: lead.longitude },
                        radiusMi: 1,
                      });
                      setProspectArmed(false);
                      return;
                    }
                    setSelectedLead(lead);
                  }}
                  zIndex={
                    isSelected
                      ? 1000
                      : isHovered
                        ? 500
                        : Math.round(score?.score ?? 0)
                  }
                >
                  <div
                    className="relative cursor-pointer"
                    onMouseEnter={() => setHoveredLead(lead)}
                    onMouseLeave={() =>
                      setHoveredLead((h) => (h?.id === lead.id ? null : h))
                    }
                  >
                    {/* Prime halo — a soft pulsing coral aura behind the
                        pin, the map equivalent of the sidebar's Hot chip */}
                    {isPrime && !isSelected && (
                      <span
                        className="absolute inset-0 -m-1.5 animate-ping rounded-full bg-stripe-coral/30 motion-reduce:animate-none"
                        style={{
                          animationDuration: `${PING_PERIOD_MS}ms`,
                          // Negative = start mid-cycle, so pulses are
                          // spread out from the first frame.
                          animationDelay: `-${pingPhaseMs(lead.id)}ms`,
                        }}
                        aria-hidden
                      />
                    )}
                    {/* transition-smooth (not -all): the hover/select size
                        bump changes width/height inline styles — layout
                        props must snap, only ring/color/shadow animate. */}
                    <div
                      className={`relative flex items-center justify-center rounded-full shadow-lg shadow-black/40 transition-smooth ${
                        isSelected
                          ? "ring-4 ring-accent-400/80"
                          : isHovered
                            ? "ring-4 ring-accent-500/50"
                            : isPrime
                              ? "ring-2 ring-stripe-coral/80"
                              : "ring-2 ring-ink/80"
                      }`}
                      style={{
                        backgroundColor: color,
                        width: size,
                        height: size,
                      }}
                    >
                      <Icon
                        size={iconSize}
                        className="text-ink"
                        strokeWidth={2.5}
                      />
                    </div>
                  </div>
                </AdvancedMarker>
              );
            })}

            {/* Hover preview — a brand-dark card floated above the pin.
                Rendered as an AdvancedMarker (not InfoWindow) so it can
                carry ink surfaces + score UI instead of Google's white
                bubble. pointer-events-none: it's read-only; click the pin
                for actions. Gated to pins mode — in heatmap mode there is
                no pin under it to anchor to. */}
            {viewMode === "pins" &&
              hoveredLead &&
              hoveredLead.id !== selectedLead?.id &&
              unclustered.some((l) => l.id === hoveredLead.id) && (
                <AdvancedMarker
                  position={{
                    lat: hoveredLead.latitude,
                    lng: hoveredLead.longitude,
                  }}
                  zIndex={2000}
                >
                  <div
                    className="anim-enter-fade pointer-events-none w-[300px] rounded-xl border border-white/10 bg-ink/95 p-3 shadow-2xl backdrop-blur-md"
                    style={{
                      // Base pin size + hover bump (4) + ring (4) + gap.
                      marginBottom:
                        markerSizePx(hoveredScore?.score ?? 0) + 22,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-tight text-white">
                          {hoveredLead.address}
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-500">
                          {hoveredLead.sourceCity}
                          {hoveredLead.issuedDate &&
                            ` · issued ${new Date(
                              hoveredLead.issuedDate,
                            ).toLocaleDateString()}`}
                          {hoveredLead.projectValue
                            ? ` · $${hoveredLead.projectValue.toLocaleString()}`
                            : ""}
                        </div>
                      </div>
                      {hoveredScore && (
                        <ScoreRing score={hoveredScore.score} size={34} />
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {hoveredScore &&
                        (hoveredScore.window.state === "now" ||
                          hoveredScore.window.state === "soon") && (
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                              hoveredScore.window.state === "now"
                                ? "bg-stripe-coral/15 text-stripe-coral ring-stripe-coral/40"
                                : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
                            }`}
                          >
                            {hoveredScore.window.label}
                          </span>
                        )}
                      {hoveredLead.developmentType && (
                        <span className="inline-block rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-white/10">
                          {hoveredLead.developmentType}
                          {hoveredLead.housingUnits != null &&
                            hoveredLead.housingUnits > 0 &&
                            ` · ${hoveredLead.housingUnits}u`}
                        </span>
                      )}
                      {hoveredLead.projectKind &&
                        hoveredLead.projectKind !== "Other" && (
                          <span className="inline-block rounded bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-200 ring-1 ring-accent-500/30">
                            {hoveredLead.projectKind}
                          </span>
                        )}
                    </div>
                    {hoveredLead.aiSummary && (
                      <div className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-zinc-300/80">
                        {hoveredLead.aiSummary}
                      </div>
                    )}
                    <div className="mt-1.5 text-[10px] text-zinc-500">
                      Click for details, roof scan &amp; contact paths
                    </div>
                  </div>
                </AdvancedMarker>
              )}
          </GoogleMap>
        </div>

        <LeadsSidebar
          ref={sidebarRef}
          leads={sortedLeads}
          scores={scores}
          hoveredLeadId={hoveredLead?.id ?? null}
          selectedLeadId={selectedLead?.id ?? null}
          onHover={setHoveredLead}
          onSelect={setSelectedLead}
          isLoading={isLoading}
          hasMore={hasMore}
          sort={sort}
          onSortChange={setSort}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() =>
            setSidebarCollapsed((c) => {
              const next = !c;
              // Re-expanding while a lead is open = "I want both panels".
              if (!next && selectedLead) autoHideRef.current = false;
              return next;
            })
          }
          radiusActive={prospect != null}
        />
      </APIProvider>

      {selectedLead && (
        <LeadDetailsPanel
          lead={selectedLead}
          score={scores.get(selectedLead.id) ?? null}
          mapsApiKey={apiKey}
          onClose={() => setSelectedLead(null)}
          onUpdateInteraction={handleUpdateInteraction}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*   ScoreRing — compact circular Gutter Score meter                   */
/*   Single-hue magnitude encoding (accent), coral only for prime.     */
/* ------------------------------------------------------------------ */
export function ScoreRing({ score, size = 32 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 100));
  const prime = score >= 70;
  const color = prime ? "#f8717e" : "#5AA6C6";
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={`Fence Score ${score}/100`}
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
      <span
        className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-white"
        style={{ fontSize: Math.max(9, Math.round(size * 0.32)) }}
      >
        {score}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*   MapPanner — pans the map to a target lead whenever its ID changes */
/* ------------------------------------------------------------------ */
function MapPanner({ target }: { target: LeadWithInteraction | null }) {
  const map = useMap();
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !target) {
      lastIdRef.current = target?.id ?? null;
      return;
    }
    if (lastIdRef.current === target.id) return;
    lastIdRef.current = target.id;
    map.panTo({ lat: target.latitude, lng: target.longitude });
  }, [map, target]);
  return null;
}

/* ------------------------------------------------------------------ */
/*   ClusterMarker — ink puck with a conic ring showing the PRIME      */
/*   share (coral) vs the rest (accent). Click zooms in + pans.        */
/* ------------------------------------------------------------------ */
function ClusterMarker({
  cluster,
  onProspectAt,
}: {
  cluster: Cluster;
  /** Set while prospect mode is armed — a cluster click drops the radius
   *  at the cluster center instead of zooming (markers swallow map
   *  clicks, so the map-level handler never sees this click). */
  onProspectAt?: (center: { lat: number; lng: number }) => void;
}) {
  const map = useMap();
  // Visual size scales mildly with count so a 50-lead cluster reads as
  // bigger than a 5-lead one without dominating the map.
  const size = Math.min(64, 38 + Math.log2(cluster.count) * 6);
  const fontSize = cluster.count >= 100 ? 13 : cluster.count >= 10 ? 14 : 15;
  const primeFrac = cluster.count > 0 ? cluster.primeCount / cluster.count : 0;
  const primeDeg = Math.round(primeFrac * 360);
  return (
    <AdvancedMarker
      position={{ lat: cluster.lat, lng: cluster.lng }}
      onClick={() => {
        if (onProspectAt) {
          onProspectAt({ lat: cluster.lat, lng: cluster.lng });
          return;
        }
        if (!map) return;
        const z = map.getZoom() ?? 11;
        map.panTo({ lat: cluster.lat, lng: cluster.lng });
        // Zoom in by 2 — usually breaks the cluster apart enough to see
        // its constituents but doesn't fly past street-level detail.
        map.setZoom(Math.min(z + 2, 18));
      }}
      zIndex={50}
    >
      <div
        className="relative cursor-pointer rounded-full p-[3px] shadow-xl shadow-black/50 transition-smooth hover:scale-110"
        style={{
          width: size,
          height: size,
          // Conic ring: coral arc = share of prime-scored leads inside.
          // A cluster that's 40% coral is a neighborhood worth zooming.
          background: `conic-gradient(#f8717e 0deg ${primeDeg}deg, #1479B8 ${primeDeg}deg 360deg)`,
        }}
        title={`${cluster.count} leads${cluster.primeCount > 0 ? ` — ${cluster.primeCount} prime` : ""} — click to zoom in`}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-ink font-bold text-white"
          style={{ fontSize }}
        >
          {cluster.count}
        </div>
        {cluster.primeCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-stripe-coral px-0.5 text-[8px] font-bold text-ink ring-2 ring-ink">
            {cluster.primeCount > 9 ? "9+" : cluster.primeCount}
          </span>
        )}
      </div>
    </AdvancedMarker>
  );
}

/* ------------------------------------------------------------------ */
/*   HeatmapLayer — opportunity view weighted by GUTTER SCORE          */
/*                                                                    */
/*   The Google Maps visualization library has no first-class React   */
/*   wrapper in @vis.gl/react-google-maps, so we drive it imperatively:*/
/*   construct google.maps.visualization.HeatmapLayer, attach it via  */
/*   setMap, and tear down on unmount or input change.                */
/* ------------------------------------------------------------------ */
function HeatmapLayer({
  leads,
  scores,
}: {
  leads: LeadWithInteraction[];
  scores: Map<string, GutterScore>;
}) {
  const map = useMap();
  // Suspends until the visualization library is actually loaded, then
  // re-renders — unlike probing window.google, which silently left the
  // heatmap blank if the library finished loading after first mount.
  const viz = useMapsLibrary("visualization");
  useEffect(() => {
    if (!map || !viz) return;

    // Weight each point by Gutter Score — the same number that sizes the
    // pins, so the two view modes tell one consistent story: bright =
    // "gutter work is likely here soon", not merely "expensive permit".
    const data = leads.map((lead) => ({
      location: new google.maps.LatLng(lead.latitude, lead.longitude),
      weight: Math.max(1, (scores.get(lead.id)?.score ?? 0) / 20),
    }));

    const layer = new viz.HeatmapLayer({
      data,
      map,
      // Empirically tuned: at default zoom the radius reads as
      // "neighborhood-sized" without bleeding into a single solid blob
      // over Bellevue.
      radius: 28,
      opacity: 0.75,
      // Single-hue coral ramp with lightness ASCENDING — on the dark
      // basemap "hot" must be the brightest thing on screen, so the ramp
      // runs transparent coral → saturated coral → pale rose. (A ramp
      // that darkens toward deep red inverts the magnitude encoding on a
      // dark map: the hottest zones would read dimmer than warm ones.)
      gradient: [
        "rgba(248, 113, 126, 0)",
        "rgba(244, 63, 94, 0.45)",
        "rgba(248, 113, 126, 0.7)",
        "rgba(253, 164, 175, 0.85)",
        "rgba(254, 205, 211, 0.95)",
        "rgba(255, 241, 242, 1)",
      ],
    });

    return () => {
      layer.setMap(null);
    };
  }, [map, viz, leads, scores]);
  return null;
}
