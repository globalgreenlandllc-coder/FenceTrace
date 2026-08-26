/**
 * Fence material takeoff — layout in, bill of materials out. Pure math,
 * no imports beyond the catalog, fully unit-tested.
 *
 * Model (see catalog.ts): sections between posts every `postSpacingFt`;
 * a post at every section boundary plus corners/ends; gates hang between
 * two gate posts and consume their opening from the run length.
 */
import {
  fenceType,
  heightFactor,
  TERRAIN_FACTOR,
  type FenceType,
  type FenceTypeId,
  type Terrain,
} from "./catalog";
import type { MarketSnapshot } from "./market";
import type { RateBook } from "./rates";
import { burialFt } from "./slope";

export type FenceLayoutInput = {
  type: FenceTypeId;
  heightFt: number;
  /** Total drawn fence length, feet (gate openings included). */
  totalLf: number;
  /** Per-run lengths (feet). When present, sections/posts are computed
   *  per run — a 3-run layout needs more posts than one long run. */
  runLengths?: number[];
  /** Corner count (run direction changes) and open ends. */
  corners: number;
  ends: number;
  gatesSingle: number; // 4' walk gates
  gatesDouble: number; // ~10' drive gates
  /** Custom-width gates, feet each (e.g. [6, 12]). */
  gatesCustomWidthsFt?: number[];
  terrain: Terrain;
  /** Extra material percentage, default 10. */
  wastePct?: number;
  /** Tear-out of an existing fence, LF (0 = none). */
  removalLf?: number;
  /** Stain/seal both faces after install (wood only). */
  stain?: boolean;
  /** Sections that must STEP down a slope (from the terrain analysis) —
   *  each needs an extended post and extra set/trim time. */
  steppedSections?: number;
  /** LF of fence running on top of a retaining wall. Posts over that
   *  span are core-drilled + anchored to the wall cap — mount hardware
   *  and drilling labor instead of dug holes and concrete. */
  wallTopLf?: number;
  /** Post stock upgrade — steel or 6×6 pressure-treated. */
  postUpgrade?: "steel" | "6x6";
  /** Line-post spacing override, ft o.c. (4–12). Stick, mesh and rail
   *  builds only — prefab panel systems come in fixed sections, so
   *  panels always keep the catalog spacing. */
  postSpacingFt?: number;
  /** Mixed-type sections (e.g. chain link across the back of a cedar
   *  job): total LF per secondary type. Carved out of the primary
   *  fabric and materialized as their own BOM block. */
  mixed?: { type: FenceTypeId; lf: number }[];
  /** Local market calibration (state + ZIP) — see lib/fence/market.ts.
   *  Takeoff QUANTITIES don't care where the job is; this rides on the
   *  layout only so pricing can scale the catalog's national rates and
   *  the same object can hand off to the proposal. */
  market?: MarketSnapshot;
  /** The contractor's own price book (lib/fence/rates.ts). Like
   *  `market`, takeoff QUANTITIES ignore it — a fence needs the same
   *  posts whoever is billing for them — but it rides on the layout so
   *  pricing and the proposal quote at this contractor's rates. */
  rates?: RateBook;
};

export type BomLine = {
  key: string;
  label: string;
  qty: number;
  unit: "ea" | "lf" | "bag" | "lb" | "box" | "sqft";
};

export type FenceTakeoff = {
  netFenceLf: number; // fence fabric length (gates excluded)
  sections: number;
  posts: {
    line: number;
    corner: number;
    end: number;
    gate: number;
    total: number;
  };
  bom: BomLine[];
  /** Labor hours estimate (for the crew scheduler). */
  laborHours: number;
};

const GATE_SINGLE_OPENING_FT = 4;
const GATE_DOUBLE_OPENING_FT = 10;

const CAP_LABEL: Record<string, string> = {
  flat: "Flat",
  pyramid: "Pyramid",
  gothic: "Gothic",
  dome: "Dome",
};

/** The height the mixed-section engine builds a sibling type at: the
 *  primary fence's height when the sibling offers it, else the nearest
 *  height it DOES come in (ties break low). A 6' cedar job's chain-link
 *  stretch is a 6' stretch, not the catalog default. */
export function nearestHeight(t: FenceType, heightFt: number): number {
  let best = t.defaultHeightFt;
  let bestD = Infinity;
  for (const h of t.heightsFt) {
    const d = Math.abs(h - heightFt);
    if (d < bestD || (d === bestD && h < best)) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * Concrete per set post, from the hole that actually gets dug: diameter
 * 3× the post width (the auger rule), depth to the burial line — which
 * is frost-aware — minus the post's own displacement. A 60 lb bag
 * yields ~0.45 ft³; 10% covers spillage and over-dig. The old flat
 * 1.5/2/3-bags-by-height schedule ran a crew out of mix mid-job in the
 * South and didn't begin to cover a northern frost hole.
 */
function concreteBagsPerPost(
  heightFt: number,
  postWidthIn: number,
  frostIn: number,
): number {
  const depthFt = burialFt(heightFt, frostIn);
  // Auger rule: 3× the post width, floored at 8" and capped at 12" —
  // nobody bores a 16" hole for a 6×6, they size up the auger one step.
  const holeDiaFt = Math.min(12, Math.max(8, postWidthIn * 3)) / 12;
  const holeFt3 = Math.PI * (holeDiaFt / 2) ** 2 * depthFt;
  const postFt3 = (postWidthIn / 12) ** 2 * depthFt;
  return (Math.max(0, holeFt3 - postFt3) / 0.45) * 1.1;
}

export function computeFenceTakeoff(input: FenceLayoutInput): FenceTakeoff {
  const t = fenceType(input.type);
  // Spacing override: stick builds cap at 8' — that's what a 2×4 rail
  // spans — and mesh runs to 12'. Panel systems come in fixed sections,
  // and rail builds (split/ranch) are fixed by the rail stock itself: a
  // 10' mortised split rail cannot be built at 4' o.c.
  const spacingCap = t.build === "stick" ? 8 : 12;
  const spacingFt =
    (t.build === "stick" || t.build === "mesh") &&
    Number.isFinite(input.postSpacingFt) &&
    (input.postSpacingFt as number) >= 4 &&
    (input.postSpacingFt as number) <= spacingCap
      ? (input.postSpacingFt as number)
      : t.postSpacingFt;
  const waste = 1 + Math.min(30, Math.max(0, input.wastePct ?? 10)) / 100;
  const hf = heightFactor(t, input.heightFt);

  const customGates = (input.gatesCustomWidthsFt ?? []).filter(
    (w) => Number.isFinite(w) && w > 0,
  );
  const gateOpenings =
    input.gatesSingle * GATE_SINGLE_OPENING_FT +
    input.gatesDouble * GATE_DOUBLE_OPENING_FT +
    customGates.reduce((a, w) => a + w, 0);
  // Mixed-type sections take their footage OUT of the primary fabric.
  const mixed = (input.mixed ?? []).filter(
    (m) => Number.isFinite(m.lf) && m.lf > 0,
  );
  const mixedLf = Math.min(
    Math.max(0, input.totalLf - gateOpenings),
    mixed.reduce((a, m) => a + m.lf, 0),
  );
  const netFenceLf = Math.max(0, input.totalLf - gateOpenings - mixedLf);

  // Sections are counted PER RUN when the layout provides run lengths —
  // three 40' runs need ceil(40/8)=5 sections each (15 total), not
  // ceil(120/8)=15 by luck; 3×34' runs need 15, not 13. Gate openings are
  // subtracted proportionally.
  const runLfs =
    input.runLengths && input.runLengths.length > 0
      ? input.runLengths.filter((r) => r > 0)
      : [input.totalLf];
  const runTotal = runLfs.reduce((a, b) => a + b, 0) || 1;
  const netRatio = netFenceLf / runTotal;
  const sections = runLfs.reduce(
    (acc, r) => acc + Math.ceil((r * netRatio) / spacingFt),
    0,
  );
  // Posts: one per section boundary. An OPEN run with S sections has
  // S+1 boundary posts and contributes 2 ends; a CLOSED ring has
  // exactly S and no ends. So boundaries = sections + ends/2, and the
  // line posts are what's left after corners and ends claim theirs.
  // (The old `sections − 1 − corners` was the single-open-run special
  // case — it undercounted a ring by one and overcounted three separate
  // runs by two.)
  const linePosts = Math.max(
    0,
    Math.round(sections - input.corners - input.ends / 2),
  );
  const cornerPosts = Math.max(0, input.corners);
  const endPosts = Math.max(0, input.ends);
  const gatePosts = (input.gatesSingle + input.gatesDouble + customGates.length) * 2;
  const totalPosts = linePosts + cornerPosts + endPosts + gatePosts;

  // Posts standing on a retaining wall are core-drilled + anchored to
  // the wall cap — they get mount hardware, not holes and concrete.
  const wallTopLf = Math.max(0, Math.min(input.wallTopLf ?? 0, input.totalLf));
  const wallPosts =
    wallTopLf > 0
      ? Math.min(totalPosts, Math.floor(wallTopLf / spacingFt) + 1)
      : 0;

  const bom: BomLine[] = [];
  const add = (key: string, label: string, qty: number, unit: BomLine["unit"]) => {
    if (qty > 0) bom.push({ key, label, qty: Math.ceil(qty), unit });
  };

  // Posts are DISCRETE units — a crew orders a spare or two, not 10%.
  // Waste stays on cut goods (pickets, rails, fabric, wire), where
  // offcuts are real.
  add("post-line", `Line posts (${spacingFt}' o.c.)`, linePosts, "ea");
  add("post-corner", "Corner posts", cornerPosts, "ea");
  add("post-end", "End posts", endPosts, "ea");
  add("post-gate", "Gate posts (heavy-set)", gatePosts, "ea");
  // Frost line from the job's market: a Minneapolis hole is twice a
  // Dallas hole, and the concrete goes with it.
  const frostIn = input.market?.frostIn ?? 0;
  if (t.spec.setInConcrete) {
    const bagsLine = concreteBagsPerPost(input.heightFt, t.spec.postWidthIn, frostIn);
    const bagsTerm = concreteBagsPerPost(input.heightFt, t.spec.terminalWidthIn, frostIn);
    add(
      "concrete",
      "Concrete (60 lb bags)",
      Math.max(0, linePosts - wallPosts) * bagsLine +
        (cornerPosts + endPosts + gatePosts) * bagsTerm,
      "bag",
    );
  } else {
    // Split rail is dropped in and tamped so the rails can be re-seated
    // as the ground heaves — gravel backfill, never concrete.
    add(
      "gravel",
      "Gravel backfill (50 lb bags)",
      (totalPosts - wallPosts) * 2,
      "bag",
    );
  }
  add(
    "wall-anchor",
    "Wall-top post anchors (core-drill + epoxy)",
    wallPosts,
    "ea",
  );

  if (t.build === "stick") {
    const railsPer = t.railsPerSection(input.heightFt);
    const rails = sections * railsPer;
    add("rail", `Rails (${spacingFt}' bays)`, rails * waste, "ea");
    const w = t.picketWidthIn ?? 5.5;
    const gap = t.picketGapIn ?? 0;
    const pitch = Math.max(1.5, w + gap); // board-on-board overlap floors at 1.5"
    if (railsPer === 0) {
      // Horizontal build — the boards ARE the horizontal members,
      // stacked UP the fence: courses = height / board pitch, one board
      // per bay per course. Height is what grows the count here; the
      // old vertical-picket formula gave a 4' and a 6' fence identical
      // boards.
      const courses = Math.ceil((input.heightFt * 12) / pitch);
      const slats = courses * sections;
      add("picket", `1×6 slats (${spacingFt}' bays, ${courses} courses)`, slats * waste, "ea");
      // 4 screws per slat end ×2 ends, 500 per box.
      add("fasteners", "Screws (5 lb boxes)", (slats * 8) / 500, "box");
    } else {
      let pickets = (netFenceLf * 12) / pitch;
      if (input.type === "shadowbox") pickets *= 2; // both faces
      // NOTE: picket COUNT doesn't grow with height — taller fences use
      // longer pickets (priced via heightFactor on the $/LF side), not more.
      add("picket", "Pickets", pickets * waste, "ea");
      // Two nails per picket per rail (plus 10% bend/misfire); a 5 lb
      // box of ring-shank runs ~500. The old pickets/350 was a third of
      // what the gun actually shoots.
      add(
        "fasteners",
        "Fasteners (5 lb boxes)",
        (pickets * Math.max(1, railsPer) * 2 * 1.1) / 500,
        "box",
      );
    }
  } else if (t.build === "panel") {
    // Panels are discrete units — nobody buys 10% spare prefab panels;
    // ceil() on the waste factor was silently adding a whole one.
    add("panel", `${t.label} panels (${t.postSpacingFt}')`, sections, "ea");
    if (t.category === "vinyl") {
      // Vinyl rails slide THROUGH routed posts — no brackets at all. A
      // privacy panel's bottom rail carries an aluminum stiffener so it
      // can't sag between posts.
      if (t.id === "vinyl-privacy") {
        add("rail-stiffener", "Bottom-rail aluminum stiffeners", sections, "ea");
      }
    } else {
      add("bracket", "Panel brackets (pairs)", sections * 2, "ea");
    }
  } else if (t.build === "mesh") {
    add("mesh", "Chain-link fabric", netFenceLf * waste, "lf");
    add("top-rail", "Top rail", netFenceLf * waste, "lf");
    // Residential chain link has no bottom rail — a 7-ga tension wire
    // runs the base to stop the fabric being pushed up.
    add("tension-wire", "Bottom tension wire (7-ga)", netFenceLf * waste, "lf");
    // A corner terminates fabric on BOTH faces — two bars where an end
    // or gate post takes one.
    const terminals = input.ends + input.corners + gatePosts;
    add("tension-bar", "Tension bars", input.ends + input.corners * 2 + gatePosts, "ea");
    // Bands only wrap TERMINAL posts (ends/corners/gate posts) — line
    // posts carry the fabric on the top rail and ties.
    add(
      "tension-band",
      "Tension bands",
      terminals * (input.heightFt / 1.2),
      "ea",
    );
    // The top rail dead-ends into a cup at every terminal, clamped by a
    // brace band — the parts a crew can't tension the run without.
    add("rail-end", "Rail end cups", terminals, "ea");
    add("brace-band", "Brace bands", terminals, "ea");
    add("tie-wire", "Aluminum ties (100 ct bags)", netFenceLf / 60, "box");
  } else if (t.build === "rail") {
    const rails = sections * t.railsPerSection(input.heightFt);
    add("rail", "Rails", rails * waste, "ea");
  }

  if ((input.steppedSections ?? 0) > 0) {
    add(
      "step-posts",
      "Extended posts for stepped sections (slope)",
      input.steppedSections!,
      "ea",
    );
  }
  if (input.postUpgrade) {
    add(
      "post-upgrade",
      input.postUpgrade === "steel"
        ? "Post upgrade — galvanized steel (every post)"
        : "Post upgrade — 6×6 pressure-treated (every post)",
      totalPosts,
      "ea",
    );
  }
  // Caps are per-system hardware, not a generic line: chain-link line
  // posts take loop caps that the top rail threads through while their
  // terminals take solid domes, and split rail is capped with nothing.
  if (t.spec.postCap === "loop") {
    add("cap-loop", "Loop caps (line posts)", linePosts, "ea");
    add("cap-dome", "Dome caps (terminal posts)", cornerPosts + endPosts + gatePosts, "ea");
  } else if (t.spec.postCap !== "none") {
    add("post-cap", `${CAP_LABEL[t.spec.postCap]} post caps`, totalPosts, "ea");
  }
  add("gate-single", "Walk gate kit (4')", input.gatesSingle, "ea");
  add("gate-double", "Drive gate kit (10')", input.gatesDouble, "ea");
  customGates.forEach((w, i) => {
    add(`gate-custom-${i}`, `Custom gate kit (${w}')`, 1, "ea");
  });
  add(
    "gate-hardware",
    "Gate hinge + latch sets",
    input.gatesSingle + input.gatesDouble + customGates.length,
    "ea",
  );
  if (input.stain && t.stainable) {
    // Two faces × TWO COATS; a gallon covers ~150 sq ft per coat on
    // rough-sawn wood. The proposal sells "2 coats" — buying one left
    // the crew half a job short of product.
    add(
      "stain",
      "Stain / seal (gallons, 2 coats)",
      (netFenceLf * input.heightFt * 2 * 2) / 150,
      "ea",
    );
  }
  if ((input.removalLf ?? 0) > 0) {
    add("removal", "Existing fence tear-out & haul-away", input.removalLf!, "lf");
  }

  // Mixed sections: run the same engine on each secondary stretch (its
  // own type, at the PRIMARY fence's height when the sibling offers it,
  // 2 terminal posts at the splices) and fold the BOM in with prefixed
  // keys + labels. When the drawn sections exceed the fence they sit
  // on, the clamp distributes proportionally — clamping each section
  // against the whole-job cap let two sections each pass and together
  // exceed it.
  let mixedLaborHours = 0;
  const rawMixedLf = mixed.reduce((a, m) => a + m.lf, 0);
  const mixScale = rawMixedLf > 0 ? mixedLf / rawMixedLf : 0;
  for (const m of mixed) {
    const mt = fenceType(m.type);
    const sub = computeFenceTakeoff({
      type: m.type,
      heightFt: nearestHeight(mt, input.heightFt),
      totalLf: m.lf * mixScale,
      corners: 0,
      ends: 2,
      gatesSingle: 0,
      gatesDouble: 0,
      terrain: input.terrain,
      wastePct: input.wastePct,
      postSpacingFt: input.postSpacingFt,
      market: input.market,
    });
    const label = fenceType(m.type).label;
    for (const line of sub.bom) {
      bom.push({
        ...line,
        key: `mix-${m.type}-${line.key}`,
        label: `${label}: ${line.label}`,
      });
    }
    mixedLaborHours += sub.laborHours;
  }

  // Crew-hours: ≈4.5 LF/person-hour for stick builds on flat ground —
  // a 3-man crew doing 100–110 LF/day, which is real residential
  // production. (The old 2.5 predicted 60 LF/day and made every
  // schedule read two days long; cross-checked against laborPerLf it
  // implied a $33/hr all-in crew cost, below the wage the market table
  // itself cites.) Mesh and panels hang faster; rail is fastest.
  const lfPerHour =
    t.build === "mesh" ? 7 : t.build === "panel" ? 6 : t.build === "rail" ? 8 : 4.5;
  const laborHours =
    (netFenceLf / lfPerHour) * TERRAIN_FACTOR[input.terrain] * hf +
    (input.gatesSingle + input.gatesDouble + customGates.length) * 1.5 +
    (input.steppedSections ?? 0) * 0.4 +
    wallPosts * 0.6 + // core-drill + epoxy set beats digging, but not by much
    mixedLaborHours +
    (input.removalLf ?? 0) / 12;

  return {
    netFenceLf: Math.round(netFenceLf + mixedLf),
    sections,
    posts: {
      line: linePosts,
      corner: cornerPosts,
      end: endPosts,
      gate: gatePosts,
      total: totalPosts,
    },
    bom,
    laborHours: Math.round(laborHours * 10) / 10,
  };
}
