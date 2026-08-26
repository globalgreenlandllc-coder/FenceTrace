import { computeFenceTakeoff, type BomLine } from "@/lib/fence/takeoff";
import { fenceType, type FenceTypeId, type Terrain } from "@/lib/fence/catalog";
import type { FenceEstimateConfig, Measurements } from "@/lib/types";

/**
 * scope.ts — the client-facing SCOPE OF WORK for a fence package.
 *
 * Homeowners kept asking the fair question: "what am I actually
 * getting?" The proposal showed packages and a price, but the physical
 * job — how many posts, how much concrete, what sizes — lived only in
 * the contractor's takeoff. This derives that scope from the SAME
 * engine (computeFenceTakeoff) with the same input mapping the pricing
 * path uses, so the sheet the client reads and the price they pay can
 * never disagree.
 *
 * Client-safe by construction: QUANTITIES ONLY. BOM rows carry no unit
 * costs, so nothing here leaks the contractor's cost basis or margin —
 * prices stay where they already were (the breakdown lines, which honor
 * the proposal's priceDisplay mode).
 */

export type FenceScopeSpec = {
  /** e.g. "Cedar privacy" */
  typeLabel: string;
  heightFt: number;
  /** Drawn fence length incl. gate openings, ft. */
  totalLf: number;
  /** Fence fabric length (gates excluded), ft. */
  netLf: number;
  sections: number;
  postSpacingFt: number;
  corners: number;
  gates: { label: string; count: number }[];
  terrain: Terrain;
  /** Sections built stepped down a measured slope. */
  steppedSections: number;
  /** LF mounted on a retaining wall (core-drilled posts). */
  wallTopLf: number;
  removalLf: number;
  stain: boolean;
  postUpgrade?: "steel" | "6x6";
};

export type FenceScope = {
  spec: FenceScopeSpec;
  posts: { line: number; corner: number; end: number; gate: number; total: number };
  /** Bill of materials — labels + quantities, NO prices. */
  bom: BomLine[];
  laborHours: number;
};

/**
 * Map a saved package's fence config + the proposal measurements to the
 * takeoff engine's input — the same rules lib/pricing.ts prices with:
 * eaveLF carries fence LF, downspoutCount carries the LIVE gate count,
 * mixed-type footage is carved out of the primary run.
 */
export function fenceClientScope(
  fence: FenceEstimateConfig,
  measurements: Measurements,
): FenceScope | null {
  const t = fenceType(fence.type as FenceTypeId);

  const customWidths = (fence.gatesCustomWidthsFt ?? []).filter(
    (w) => Number.isFinite(w) && w > 0,
  );
  const liveGates = Math.max(
    0,
    Math.round(
      measurements.downspoutCount ??
        fence.gatesSingle + fence.gatesDouble + customWidths.length,
    ),
  );
  const gatesCustom = Math.min(customWidths.length, liveGates);
  const gatesDouble = Math.min(
    Math.max(0, fence.gatesDouble),
    liveGates - gatesCustom,
  );
  const gatesSingle = Math.max(0, liveGates - gatesDouble - gatesCustom);

  // measurements.eaveLF is the NET fence length — gate openings are
  // already out of it (that's the number pricing bills). The takeoff
  // subtracts openings itself, so hand it the DRAWN length back:
  // net + openings. Passing eaveLF straight through subtracted every
  // gate twice and the client sheet showed less fence than was priced.
  const gateOpenings =
    gatesSingle * 4 +
    gatesDouble * 10 +
    customWidths.slice(0, gatesCustom).reduce((a, w) => a + w, 0);
  const totalLf = Math.max(0, Math.round(measurements.eaveLF + gateOpenings));
  if (totalLf <= 0) return null;

  const takeoff = computeFenceTakeoff({
    type: fence.type as FenceTypeId,
    heightFt: fence.heightFt,
    totalLf,
    runLengths: fence.runLengths,
    corners: Math.max(0, fence.corners),
    ends: Math.max(0, fence.ends),
    gatesSingle,
    gatesDouble,
    gatesCustomWidthsFt: customWidths.slice(0, gatesCustom),
    terrain: fence.terrain as Terrain,
    wastePct: Math.max(0, measurements.wasteFactorPct),
    removalLf: Math.max(0, fence.removalLf),
    stain: fence.stain,
    steppedSections: fence.steppedSections,
    wallTopLf: fence.wallTopLf,
    postUpgrade: fence.postUpgrade,
    postSpacingFt: fence.postSpacingFt,
    mixed: fence.mixed as { type: FenceTypeId; lf: number }[] | undefined,
    // Frost-aware concrete depths come from the job's market snapshot.
    market: fence.market,
  });

  const gates: FenceScopeSpec["gates"] = [];
  if (gatesSingle > 0) gates.push({ label: "4′ walk gate", count: gatesSingle });
  if (gatesDouble > 0) gates.push({ label: "10′ double drive gate", count: gatesDouble });
  for (const w of customWidths.slice(0, gatesCustom))
    gates.push({ label: `${w}′ custom gate`, count: 1 });

  return {
    spec: {
      typeLabel: t.label,
      heightFt: fence.heightFt,
      totalLf,
      netLf: takeoff.netFenceLf,
      sections: takeoff.sections,
      // Same eligibility rule as the takeoff: stick ≤8', mesh ≤12',
      // panel and rail systems keep their fixed catalog spacing.
      postSpacingFt:
        (t.build === "stick" || t.build === "mesh") &&
        Number.isFinite(fence.postSpacingFt) &&
        (fence.postSpacingFt as number) >= 4 &&
        (fence.postSpacingFt as number) <= (t.build === "stick" ? 8 : 12)
          ? (fence.postSpacingFt as number)
          : t.postSpacingFt,
      corners: Math.max(0, fence.corners),
      gates,
      terrain: fence.terrain as Terrain,
      steppedSections: Math.max(0, fence.steppedSections ?? 0),
      wallTopLf: Math.max(0, fence.wallTopLf ?? 0),
      removalLf: Math.max(0, fence.removalLf),
      stain: fence.stain,
      postUpgrade: fence.postUpgrade,
    },
    posts: takeoff.posts,
    bom: takeoff.bom,
    laborHours: takeoff.laborHours,
  };
}
