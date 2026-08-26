/**
 * Bridges the drawn fence layout into the proposal's Good/Better/Best
 * packages. Pure — used by the saveDraftFromEstimate server action.
 */
import { fenceType, type FenceTypeId, type Terrain } from "./catalog";
import { fenceTiers } from "./pricing";
import type { MarketSnapshot } from "./market";
import type { RateBook } from "./rates";
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
  postUpgrade?: "steel" | "6x6";
  postSpacingFt?: number;
  mixed?: { type: FenceTypeId; lf: number }[];
  /** The market the estimator quoted in, frozen at scan time. Copied
   *  onto every tier so the saved proposal reprices at the same
   *  state/ZIP rates the contractor saw on the rail. */
  market?: MarketSnapshot;
  /** The contractor's own price book, frozen the same way and for the
   *  same reason — every tier quotes at the rates in their settings at
   *  the moment the proposal was built, not whatever they are later. */
  rates?: RateBook;
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
  return fenceTiers(input.type, input.heightFt).map((tier) => {
    const t = fenceType(tier.type);
    const heightFt = t.heightsFt.includes(input.heightFt)
      ? input.heightFt
      : t.defaultHeightFt;
    const gates =
      input.gatesSingle +
      input.gatesDouble +
      (input.gatesCustomWidthsFt?.length ?? 0);
    // The spec sheet states what will actually be built: the EFFECTIVE
    // spacing (a 6' o.c. quote must not ship an 8' o.c. proposal), and
    // gravel-tamped systems don't claim concrete.
    const effSpacing =
      (t.build === "stick" || t.build === "mesh") &&
      Number.isFinite(input.postSpacingFt) &&
      (input.postSpacingFt as number) >= 4 &&
      (input.postSpacingFt as number) <= (t.build === "stick" ? 8 : 12)
        ? (input.postSpacingFt as number)
        : t.postSpacingFt;
    // A post upgrade only applies where the build can take it — a
    // chain-link Good tier must not advertise 6×6 timber posts.
    const tierUpgrade =
      input.postUpgrade &&
      t.category === "wood" &&
      !(input.postUpgrade === "6x6" && t.spec.postWidthIn >= 5.5)
        ? input.postUpgrade
        : undefined;
    const highlights = [
      `${heightFt}' ${t.label.toLowerCase()} — ${t.blurb}`,
      (t.spec.setInConcrete
        ? "Posts set in concrete, "
        : "Posts tamped in gravel, ") +
        effSpacing +
        "' on center",
      gates > 0
        ? `${gates} ${gates === 1 ? "gate" : "gates"} — hung, latched & adjusted`
        : "Layout staked & string-lined before digging",
      ...((tier.stain || input.stain) && t.stainable
        ? ["Penetrating stain & seal, both faces"]
        : []),
      ...(tierUpgrade === "steel"
        ? ["Galvanized steel posts — never rot, warp or lean"]
        : tierUpgrade === "6x6"
          ? ["Heavy 6×6 pressure-treated posts throughout"]
          : []),
      ...(input.mixed ?? [])
        .filter((m) => m.lf > 0)
        .map(
          (m) =>
            `${Math.round(m.lf)} LF of ${fenceType(m.type).label.toLowerCase()} along the marked stretch`,
        ),
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
        postUpgrade: input.postUpgrade,
        postSpacingFt: input.postSpacingFt,
        mixed: input.mixed,
        market: input.market,
        // Every tier quotes off the same price book — including the
        // upgraded material a higher tier steps up to, which is why the
        // whole book rides along rather than just this tier's type.
        rates: input.rates,
      },
      highlights,
      markupPct: tier.markupPct,
      recommended: tier.recommended,
    };
  });
}
