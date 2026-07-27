/**
 * Bridges the drawn fence layout into the proposal's Good/Better/Best
 * packages. Pure — used by the saveDraftFromEstimate server action.
 */
import { fenceType, type FenceTypeId, type Terrain } from "./catalog";
import { fenceTiers } from "./pricing";
import type { FenceEstimateConfig } from "@/lib/types";

export type FenceDraftInput = {
  type: FenceTypeId;
  heightFt: number;
  terrain: Terrain;
  stain: boolean;
  removalLf: number;
  gatesSingle: number;
  gatesDouble: number;
  gatesCustomWidthsFt?: number[];
  corners: number;
  ends: number;
  steppedSections?: number;
  wallTopLf?: number;
};

export type FenceTierPatch = {
  id: "good" | "better" | "best";
  name: string;
  tagline: string;
  fence: FenceEstimateConfig;
  highlights: string[];
  markupPct: number;
  recommended?: boolean;
};

/** Three tier patches for the drawn layout: same geometry facts on every
 *  tier, material/stain laddered by fenceTiers. */
export function fenceTierPatches(input: FenceDraftInput): FenceTierPatch[] {
  return fenceTiers(input.type).map((tier) => {
    const t = fenceType(tier.type);
    const heightFt = t.heightsFt.includes(input.heightFt)
      ? input.heightFt
      : t.defaultHeightFt;
    const gates =
      input.gatesSingle +
      input.gatesDouble +
      (input.gatesCustomWidthsFt?.length ?? 0);
    const highlights = [
      `${heightFt}' ${t.label.toLowerCase()} — ${t.blurb}`,
      "Posts set in concrete, " + t.postSpacingFt + "' on center",
      gates > 0
        ? `${gates} ${gates === 1 ? "gate" : "gates"} — hung, latched & adjusted`
        : "Layout staked & string-lined before digging",
      ...((tier.stain || input.stain) && t.stainable
        ? ["Penetrating stain & seal, both faces"]
        : []),
      ...((input.wallTopLf ?? 0) > 0
        ? [
            `Core-drilled & epoxy-anchored on the retaining wall — ${Math.round(input.wallTopLf!)} LF`,
          ]
        : []),
      ...(input.removalLf > 0
        ? [`Tear-out & haul-away of ${input.removalLf} LF of old fence`]
        : []),
      `${tier.warrantyYears}-year workmanship warranty`,
    ];
    return {
      id: tier.id,
      name: `${tier.name} — ${t.label}`,
      tagline: tier.tagline,
      fence: {
        type: tier.type,
        heightFt,
        terrain: input.terrain,
        stain: (tier.stain || input.stain) && t.stainable,
        removalLf: input.removalLf,
        gatesSingle: input.gatesSingle,
        gatesDouble: input.gatesDouble,
        gatesCustomWidthsFt: input.gatesCustomWidthsFt ?? [],
        corners: input.corners,
        ends: input.ends,
        steppedSections: input.steppedSections ?? 0,
        wallTopLf: input.wallTopLf ?? 0,
      },
      highlights,
      markupPct: tier.markupPct,
      recommended: tier.recommended,
    };
  });
}
