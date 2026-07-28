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
  type FenceTypeId,
  type Terrain,
} from "./catalog";

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
  /** Mixed-type sections (e.g. chain link across the back of a cedar
   *  job): total LF per secondary type. Carved out of the primary
   *  fabric and materialized as their own BOM block. */
  mixed?: { type: FenceTypeId; lf: number }[];
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

/** Concrete bags per set post — deeper holes for taller fences. */
function concreteBagsPerPost(heightFt: number): number {
  return heightFt >= 8 ? 3 : heightFt >= 6 ? 2 : 1.5;
}

export function computeFenceTakeoff(input: FenceLayoutInput): FenceTakeoff {
  const t = fenceType(input.type);
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
    (acc, r) => acc + Math.ceil((r * netRatio) / t.postSpacingFt),
    0,
  );
  // Posts: one per section boundary (sections+1 per open run), corners
  // already sit on boundaries but need the heavier set (counted as
  // upgrades, not extra posts), ends terminate runs, gates add a pair
  // each. A closed loop (ends=0) has no end posts — its boundary posts
  // are all line/corner posts.
  const linePosts = Math.max(0, sections - 1 - input.corners);
  const cornerPosts = Math.max(0, input.corners);
  const endPosts = Math.max(0, input.ends);
  const gatePosts = (input.gatesSingle + input.gatesDouble + customGates.length) * 2;
  const totalPosts = linePosts + cornerPosts + endPosts + gatePosts;

  // Posts standing on a retaining wall are core-drilled + anchored to
  // the wall cap — they get mount hardware, not holes and concrete.
  const wallTopLf = Math.max(0, Math.min(input.wallTopLf ?? 0, input.totalLf));
  const wallPosts =
    wallTopLf > 0
      ? Math.min(totalPosts, Math.floor(wallTopLf / t.postSpacingFt) + 1)
      : 0;

  const bom: BomLine[] = [];
  const add = (key: string, label: string, qty: number, unit: BomLine["unit"]) => {
    if (qty > 0) bom.push({ key, label, qty: Math.ceil(qty), unit });
  };

  add("post-line", `Line posts (${t.postSpacingFt}' o.c.)`, linePosts * waste, "ea");
  add("post-corner", "Corner posts", cornerPosts, "ea");
  add("post-end", "End posts", endPosts, "ea");
  add("post-gate", "Gate posts (heavy-set)", gatePosts, "ea");
  add(
    "concrete",
    "Concrete (60 lb bags)",
    (totalPosts - wallPosts) * concreteBagsPerPost(input.heightFt),
    "bag",
  );
  add(
    "wall-anchor",
    "Wall-top post anchors (core-drill + epoxy)",
    wallPosts,
    "ea",
  );

  if (t.build === "stick") {
    const rails = sections * t.railsPerSection(input.heightFt);
    add("rail", `Rails (${t.postSpacingFt}')`, rails * waste, "ea");
    const w = t.picketWidthIn ?? 5.5;
    const gap = t.picketGapIn ?? 0;
    const pitch = Math.max(1.5, w + gap); // board-on-board overlap floors at 1.5"
    let pickets = (netFenceLf * 12) / pitch;
    if (input.type === "shadowbox") pickets *= 2; // both faces
    // NOTE: picket COUNT doesn't grow with height — taller fences use
    // longer pickets (priced via heightFactor on the $/LF side), not more.
    add("picket", "Pickets", pickets * waste, "ea");
    add(
      "fasteners",
      "Fasteners (5 lb boxes)",
      (pickets * waste) / 350,
      "box",
    );
  } else if (t.build === "panel") {
    add("panel", `${t.label} panels (${t.postSpacingFt}')`, sections * waste, "ea");
    add("bracket", "Panel brackets (pairs)", sections * 2, "ea");
  } else if (t.build === "mesh") {
    add("mesh", "Chain-link fabric", netFenceLf * waste, "lf");
    add("top-rail", "Top rail", netFenceLf * waste, "lf");
    add("tension-bar", "Tension bars", input.ends + input.corners + gatePosts, "ea");
    // Bands only wrap TERMINAL posts (ends/corners/gate posts) — line
    // posts carry the fabric on the top rail and ties.
    add(
      "tension-band",
      "Tension bands",
      (input.ends + input.corners + gatePosts) * (input.heightFt / 1.2),
      "ea",
    );
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
  add("post-cap", "Post caps", totalPosts, "ea");
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
    // Two faces; a gallon covers ~150 sq ft on rough-sawn wood.
    add(
      "stain",
      "Stain / seal (gallons)",
      (netFenceLf * input.heightFt * 2) / 150,
      "ea",
    );
  }
  if ((input.removalLf ?? 0) > 0) {
    add("removal", "Existing fence tear-out & haul-away", input.removalLf!, "lf");
  }

  // Mixed sections: run the same engine on each secondary stretch (its
  // own type, its own default height, 2 terminal posts at the splices)
  // and fold the BOM in with prefixed keys + labels.
  let mixedLaborHours = 0;
  for (const m of mixed) {
    const sub = computeFenceTakeoff({
      type: m.type,
      heightFt: fenceType(m.type).defaultHeightFt,
      totalLf: Math.min(m.lf, mixedLf),
      corners: 0,
      ends: 2,
      gatesSingle: 0,
      gatesDouble: 0,
      terrain: input.terrain,
      wastePct: input.wastePct,
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

  // Crew-hours: base rate ≈ 2.5 LF/hour/person for stick builds on flat
  // ground, faster for mesh/panels; terrain multiplies dig time.
  const lfPerHour =
    t.build === "mesh" ? 4.5 : t.build === "panel" ? 3.5 : t.build === "rail" ? 5 : 2.5;
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
