/**
 * Fence pricing — dollars from a layout. Pure math over the catalog +
 * takeoff, unit-tested. All amounts in DOLLARS here (the proposal layer
 * converts to cents at its boundary, matching the platform convention).
 *
 * total = (materials + labor + gates + removal + stain) × (1 + markup%)
 *         − discount% → + tax%
 */
import {
  fenceType,
  heightFactor,
  TERRAIN_FACTOR,
  type FenceTypeId,
  type Terrain,
} from "./catalog";
import { computeFenceTakeoff, type FenceLayoutInput } from "./takeoff";

export type FencePriceConfig = {
  /** Contractor's labor rate multiplier (1 = catalog default). */
  laborRate?: number;
  /** Old-fence removal $/LF. */
  removalPerLf?: number;
  /** Stain/seal $/sq ft (both faces already accounted). */
  stainPerSqFt?: number;
  markupPct?: number; // applied on cost subtotal
  discountPct?: number; // applied after markup
  taxPct?: number; // applied last
};

export const DEFAULT_PRICE_CONFIG: Required<FencePriceConfig> = {
  laborRate: 1,
  removalPerLf: 4,
  stainPerSqFt: 1.1,
  markupPct: 35,
  discountPct: 0,
  taxPct: 8.25,
};

export type FencePriceLine = {
  key: string;
  label: string;
  amount: number; // dollars, pre-markup cost basis
};

export type FencePriceBreakdown = {
  lines: FencePriceLine[];
  subtotal: number; // cost basis
  markup: number;
  discount: number;
  tax: number;
  total: number;
  pricePerLf: number; // total ÷ net fence LF (headline number)
};

export function priceFence(
  layout: FenceLayoutInput,
  config: FencePriceConfig = {},
): FencePriceBreakdown {
  const c = { ...DEFAULT_PRICE_CONFIG, ...config };
  const t = fenceType(layout.type);
  const take = computeFenceTakeoff(layout);
  const hf = heightFactor(t, layout.heightFt);
  const lf = take.netFenceLf;

  const lines: FencePriceLine[] = [];
  const add = (key: string, label: string, amount: number) => {
    if (amount > 0) lines.push({ key, label, amount: round2(amount) });
  };

  const waste = 1 + Math.min(30, Math.max(0, layout.wastePct ?? 10)) / 100;
  add(
    "materials",
    `${t.label} materials — ${lf} LF at ${layout.heightFt}'`,
    lf * t.materialPerLf * hf * waste,
  );
  add(
    "labor",
    `Installation labor (${layout.terrain} ground)`,
    lf * t.laborPerLf * hf * TERRAIN_FACTOR[layout.terrain] * c.laborRate,
  );
  add(
    "gates-single",
    `Walk gates (4') × ${layout.gatesSingle}`,
    layout.gatesSingle * t.gateSingle,
  );
  add(
    "gates-double",
    `Drive gates (10') × ${layout.gatesDouble}`,
    layout.gatesDouble * t.gateSingle * 2.4,
  );
  if ((layout.removalLf ?? 0) > 0)
    add(
      "removal",
      `Tear out & haul away ${layout.removalLf} LF of old fence`,
      layout.removalLf! * c.removalPerLf,
    );
  if (layout.stain && t.stainable)
    add(
      "stain",
      "Stain & seal (both faces)",
      lf * layout.heightFt * 2 * c.stainPerSqFt,
    );

  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const markup = round2(subtotal * (Math.max(0, c.markupPct) / 100));
  const afterMarkup = subtotal + markup;
  const discount = round2(
    afterMarkup * (Math.min(50, Math.max(0, c.discountPct)) / 100),
  );
  const tax = round2((afterMarkup - discount) * (Math.max(0, c.taxPct) / 100));
  const total = round2(afterMarkup - discount + tax);

  return {
    lines,
    subtotal,
    markup,
    discount,
    tax,
    total,
    pricePerLf: lf > 0 ? round2(total / lf) : 0,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/*  Good / Better / Best tiers                                         */
/* ------------------------------------------------------------------ */

export type FenceTier = {
  id: "good" | "better" | "best";
  name: string;
  tagline: string;
  /** Catalog type this tier quotes (may upgrade the material). */
  type: FenceTypeId;
  stain: boolean;
  markupPct: number;
  warrantyYears: number;
  recommended?: boolean;
};

/** Tier ladder for a chosen base type: Good = value build of the same
 *  category, Better = the chosen type as drawn, Best = chosen type plus
 *  stain/seal (wood) or the premium sibling, longer warranty. */
export function fenceTiers(base: FenceTypeId): FenceTier[] {
  const t = fenceType(base);
  const valueSibling: FenceTypeId =
    t.category === "wood"
      ? "pt-pine-privacy"
      : t.category === "vinyl"
        ? "vinyl-picket"
        : t.category === "chain-link"
          ? "chain-link-galv"
          : t.category === "aluminum" || t.category === "steel"
            ? "aluminum-ornamental"
            : "split-rail-2";
  const premiumSibling: FenceTypeId =
    t.category === "wood"
      ? "board-on-board"
      : t.category === "chain-link"
        ? "chain-link-black"
        : t.category === "aluminum" || t.category === "steel"
          ? "steel-ornamental"
          : base;

  return [
    {
      id: "good",
      name: "Good",
      tagline: "Solid build, best price",
      type: valueSibling === base ? base : valueSibling,
      stain: false,
      markupPct: 30,
      warrantyYears: 1,
    },
    {
      id: "better",
      name: "Better",
      tagline: "The fence as designed",
      type: base,
      stain: false,
      markupPct: 35,
      warrantyYears: 3,
      recommended: true,
    },
    {
      id: "best",
      name: "Best",
      tagline: t.stainable
        ? "Stained, sealed & extended warranty"
        : "Premium line & extended warranty",
      type: t.stainable ? base : premiumSibling,
      stain: t.stainable,
      markupPct: 38,
      warrantyYears: 5,
    },
  ];
}
