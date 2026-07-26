/**
 * Gutter Score — deterministic, explainable lead scoring for gutter/roofing
 * contractors. Pure module (no "server-only", no Prisma imports) so it runs
 * on both server and client and under `npx tsx --test`.
 *
 * Two outputs per lead:
 *   score   0–100 — how much gutter/roof revenue this permit likely holds
 *   window  when to CALL — gutters are installed at a specific moment in a
 *           build (after roofing/fascia, before final), so the same permit
 *           is a hot lead at month 6 and a dead one at month 24.
 *
 * Every point is attached to a human-readable reason so the UI can answer
 * "why is this lead scored 82?" instead of showing a black-box number.
 */

export type ScoreInput = {
  categorizedTrade?: string | null;
  projectKind?: string | null;
  buildingType?: string | null;
  developmentType?: string | null;
  originalDescription?: string | null;
  fixtures?: string | null;
  contractorName?: string | null;
  projectValue?: number | null;
  housingUnits?: number | null;
  aiRelevance?: string | null;
  issuedDate?: string | Date | null;
};

export type WindowState = "now" | "soon" | "closing" | "passed" | "unknown";

export type GutterWindow = {
  state: WindowState;
  /** Short badge text, e.g. "Gutter window: now". */
  label: string;
  /** One-liner explaining the timing physics. */
  detail: string;
};

export type ScoreReason = { text: string; points: number };

export type GutterScoreBand = "prime" | "strong" | "fair" | "low";

export type GutterScore = {
  score: number;
  band: GutterScoreBand;
  reasons: ScoreReason[];
  window: GutterWindow;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(d: string | Date | null | undefined, now: number): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / DAY_MS);
  return days >= 0 ? days : 0;
}

/**
 * When should the contractor CALL? Gutter install timing by project type:
 *
 *  - Reroof: gutters come off for tear-off and often don't survive; the
 *    homeowner is making roofline decisions THE WEEK the permit lands.
 *    Window: immediate, fades in ~3 months.
 *  - New construction: gutters are one of the last exterior trades —
 *    after roof + fascia, before final inspection. A typical SFR runs
 *    ~6–14 months from permit; the sweet spot is months 4–14.
 *  - Remodel/addition: exterior work follows the permit fairly quickly;
 *    window ~6 months.
 */
export function gutterWindow(
  input: ScoreInput,
  now: number = Date.now(),
): GutterWindow {
  const age = daysSince(input.issuedDate, now);
  const kind = input.projectKind ?? "";
  const trade = input.categorizedTrade ?? "";

  if (kind === "Demolition") {
    return {
      state: "passed",
      label: "No fence window",
      detail: "Demolition permit — nothing standing to fence yet.",
    };
  }
  if (age == null) {
    return {
      state: "unknown",
      label: "Timing unknown",
      detail: "No permit issue date published by this city.",
    };
  }

  if (trade === "Roofing" && kind !== "New Construction") {
    if (age <= 90)
      return {
        state: "now",
        label: "Fence window: now",
        detail: "Re-roof in progress — this homeowner is hiring exterior trades right now.",
      };
    if (age <= 180)
      return {
        state: "closing",
        label: "Window closing",
        detail: "Re-roof likely finishing — the exterior budget may be spoken for.",
      };
    return {
      state: "passed",
      label: "Window passed",
      detail: "Re-roof permit is over 6 months old — work is probably done.",
    };
  }

  if (kind === "New Construction") {
    if (age < 120)
      return {
        state: "soon",
        label: "Fence window: soon",
        detail: "Early build — fencing lands last. Get on the GC's radar now.",
      };
    if (age <= 420)
      return {
        state: "now",
        label: "Fence window: now",
        detail: "Build should be at/near dry-in — fencing lands as the build wraps.",
      };
    if (age <= 720)
      return {
        state: "closing",
        label: "Window closing",
        detail: "Build likely near final — the fence may be contracted already.",
      };
    return {
      state: "passed",
      label: "Window passed",
      detail: "Permit is 2+ years old — construction is likely complete.",
    };
  }

  if (kind === "Remodel/Addition") {
    if (age <= 180)
      return {
        state: "now",
        label: "Fence window: now",
        detail: "Active remodel — yards get re-fenced as exterior work wraps.",
      };
    if (age <= 365)
      return {
        state: "closing",
        label: "Window closing",
        detail: "Remodel likely wrapping up.",
      };
    return {
      state: "passed",
      label: "Window passed",
      detail: "Remodel permit is over a year old.",
    };
  }

  // Other/unknown kinds — recency is the only signal.
  if (age <= 180)
    return {
      state: "soon",
      label: "Recent permit",
      detail: "Recent activity at this address — worth a drive-by.",
    };
  return {
    state: "passed",
    label: "Older permit",
    detail: "Permit is over 6 months old.",
  };
}

/** Points added per window state — timing is worth as much as trade fit. */
const WINDOW_POINTS: Record<WindowState, number> = {
  now: 14,
  soon: 6,
  closing: 4,
  passed: -10,
  unknown: 0,
};

// Word boundaries matter: bare /eave/ matches "leave"/"weave" and bare
// /addition/ matches "additional conditions" — both common in permit
// boilerplate — silently inflating unrelated permits.
const KEYWORD_RULES: Array<{ re: RegExp; points: number; text: string }> = [
  { re: /gutter|downspout/, points: 12, text: "Gutters/downspouts named on the permit" },
  { re: /re-?roof|tear\s*off|shingle|roof\s+replace/, points: 10, text: "Roof replacement language" },
  { re: /fascia|soffit|\beaves?\b/, points: 8, text: "Fascia/soffit/eave work — gutter tie-in" },
  { re: /\badu\b|\bdadu\b|\badditions?\b/, points: 5, text: "Addition/ADU — new roofline" },
  { re: /detached garage|carport|new garage/, points: 4, text: "New outbuilding roof" },
];
const KEYWORD_CAP = 18;

export function computeGutterScore(
  input: ScoreInput,
  now: number = Date.now(),
): GutterScore {
  const reasons: ScoreReason[] = [];
  const add = (points: number, text: string) => {
    const rounded = Math.round(points);
    // Round FIRST — fractional points in (0, 0.5) would otherwise render
    // as a useless "+0" row in the breakdown.
    if (rounded === 0) return;
    reasons.push({ text, points: rounded });
  };

  // 1. Trade fit — how directly the permitted work touches the roofline.
  const trade = input.categorizedTrade ?? "";
  const tradePoints: Record<string, [number, string]> = {
    Gutters: [32, "Exterior water/drainage work on the permit"],
    Roofing: [28, "Roofing job — exterior crews already on site"],
    Framing: [18, "New framing — a brand-new yard to fence"],
    Siding: [14, "Siding job — exterior refresh underway"],
    General: [6, "General construction"],
    Windows: [2, "Window work — minor roofline relevance"],
  };
  if (tradePoints[trade]) add(tradePoints[trade][0], tradePoints[trade][1]);

  // 2. Project kind.
  const kind = input.projectKind ?? "";
  if (kind === "New Construction")
    add(16, "New construction — every new home needs its first fence");
  else if (kind === "Remodel/Addition") add(10, "Remodel/addition");
  else if (kind === "Tenant Improvement")
    add(-8, "Tenant improvement — usually interior-only");

  // 3. Keyword evidence from the raw description + fixture list.
  const text = `${input.originalDescription ?? ""} ${input.fixtures ?? ""}`.toLowerCase();
  let kw = 0;
  for (const rule of KEYWORD_RULES) {
    if (kw >= KEYWORD_CAP) break;
    if (rule.re.test(text)) {
      const pts = Math.min(rule.points, KEYWORD_CAP - kw);
      kw += pts;
      add(pts, rule.text);
    }
  }

  // 4. Building type — residential rooflines are the core market.
  const bt = (input.buildingType ?? "").toLowerCase();
  const dt = (input.developmentType ?? "").toLowerCase();
  if (bt.includes("single family") || bt.includes("duplex") || dt.includes("single family"))
    add(10, "Single-family/duplex");
  else if (dt.includes("townhouse")) add(9, "Townhouse development");
  else if (bt.includes("multifamily")) add(7, "Multifamily building");
  else if (bt.includes("residential")) add(8, "Residential building");
  else if (bt.includes("commercial")) add(3, "Commercial building");
  else if (bt.includes("institutional") || bt.includes("industrial"))
    add(2, "Institutional/industrial");

  // 5. Multiple units — plats and townhome rows multiply the job.
  const units = input.housingUnits ?? 0;
  if (units > 1) add(Math.min(units, 16) * 0.75, `${units} units — repeat work on one site`);

  // 6. Project value (log scale, mirrors marker sizing).
  const v = input.projectValue ?? 0;
  if (v >= 5_000) {
    const pts = Math.min(10, ((Math.log10(v) - 3.7) / 3) * 10);
    const valueLabel =
      v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(1)}M project value`
        : `$${Math.round(v / 1000)}k project value`;
    if (pts > 0) add(pts, valueLabel);
  }

  // 7. AI relevance from the permit normalizer.
  if (input.aiRelevance === "high") add(8, "AI flagged as high-relevance");
  else if (input.aiRelevance === "medium") add(4, "AI flagged as medium-relevance");

  // 8. Owner-managed: no contractor on the permit means the homeowner is
  //    picking subs themselves — a direct-sale opening, no GC gatekeeper.
  //    Requires a KNOWN trade fit — an unclassified (empty-trade) permit
  //    shouldn't collect a stronger owner signal than an explicit "Other".
  if (!input.contractorName && kind !== "Demolition" && trade && trade !== "Other")
    add(6, "No contractor on permit — owner is picking subs");

  // 9. Timing window.
  const window = gutterWindow(input, now);
  add(WINDOW_POINTS[window.state], window.label);

  let score = reasons.reduce((s, r) => s + r.points, 0);
  // Demolition can't be a gutter job no matter what other signals fire.
  if (kind === "Demolition") score = Math.min(score, 5);
  // A passed window is a GATE, not just a -10 addend: a 400-day-old reroof
  // stacks enough trade/keyword/value signal to reach "prime" otherwise,
  // and a coral-pulsing pin on a job that's already re-hung its gutters
  // destroys trust in the score. Cap below the "strong" band; the window
  // card in the details panel explains why.
  if (window.state === "passed") score = Math.min(score, 49);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Sort reasons by |impact| so the UI shows the biggest drivers first.
  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return { score, band: scoreBand(score), reasons, window };
}

export function scoreBand(score: number): GutterScoreBand {
  if (score >= 70) return "prime";
  if (score >= 50) return "strong";
  if (score >= 30) return "fair";
  return "low";
}

/* ------------------------------------------------------------------ */
/*   Geo helpers for the radius-prospecting tool                       */
/* ------------------------------------------------------------------ */

export type LatLng = { lat: number; lng: number };

/** Great-circle distance in miles (haversine). */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.7613; // Earth radius, miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Order stops into a sane driving loop via nearest-neighbor from the
 * first point. Not optimal TSP — but for ≤10 door-knock stops the
 * difference is minutes, and this is O(n²) with zero dependencies.
 */
export function orderByNearestNeighbor<T extends LatLng>(points: T[]): T[] {
  if (points.length <= 2) return [...points];
  const remaining = [...points];
  const route: T[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMiles(last, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    route.push(remaining.splice(bestIdx, 1)[0]);
  }
  return route;
}

/**
 * Build a Google Maps directions deep-link for a door-knock run. Origin is
 * left to the device ("current location"); stops are nearest-neighbor
 * ordered. Google caps URL waypoints at 9 + destination = 10 stops.
 *
 * Slice BEFORE ordering: the caller passes stops in priority order (top
 * scores first), so the cap must drop the lowest-priority stops — not
 * whichever ones the geographic chain happens to visit last.
 */
export function doorKnockRouteUrl(stops: LatLng[]): string | null {
  if (stops.length === 0) return null;
  const ordered = orderByNearestNeighbor(stops.slice(0, 10));
  const dest = ordered[ordered.length - 1];
  const waypoints = ordered
    .slice(0, -1)
    .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
    .join("|");
  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`,
    travelmode: "driving",
  });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
