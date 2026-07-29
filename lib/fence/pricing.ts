/**
 * Fence pricing — dollars from a layout. THIN WRAPPER over the same
 * pipeline the proposal uses (lib/pricing buildLineItems + the fence
 * branch of lib/proposal-mock packageTotal math), so the estimator rail
 * and the saved proposal can never disagree. Parity is asserted by
 * lib/fence/takeoff.test.mts.
 *
 * total = lines(materials+labor+gates+removal+stain) × (1 + markup%)
 *         − discount% → + sales tax on the TAXABLE share only
 *           (materials/gates/stain; labor and tear-out untaxed —
 *           unless the job's market taxes installation labor too).
 *
 * Every per-LF and per-each rate underneath is the CATALOG's national
 * rate scaled by the job's market snapshot (lib/fence/market.ts) —
 * state + ZIP, resolved once at scan time and frozen onto the layout.
 * No snapshot → national rates, which is what every estimate priced at
 * before market pricing existed.
 */
import {
  fenceType,
  type FenceTypeId,
} from "./catalog";
import { computeFenceTakeoff, type FenceLayoutInput } from "./takeoff";
import type { MarketSnapshot } from "./market";
import { buildLineItems, fenceTaxRate, fenceTaxableShare } from "@/lib/pricing";
import { FENCE_TAX_RATE } from "@/lib/proposal-mock";
import type { EstimateConfig, Measurements } from "@/lib/types";

export type FencePriceConfig = {
  markupPct?: number; // applied on cost subtotal
  discountPct?: number; // applied after markup
};

export const DEFAULT_PRICE_CONFIG: Required<FencePriceConfig> = {
  markupPct: 35,
  discountPct: 0,
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
  /** The market these numbers were priced in — undefined when the
   *  layout carried none (national catalog rates). */
  market?: MarketSnapshot;
  /** Effective sales-tax rate applied. */
  taxRate: number;
};

/** The Measurements + EstimateConfig a layout maps to — exported so the
 *  estimator hands the proposal EXACTLY what it priced. */
export function layoutToPricingInputs(layout: FenceLayoutInput): {
  measurements: Measurements;
  config: EstimateConfig;
  netFenceLf: number;
} {
  const take = computeFenceTakeoff(layout);
  const measurements: Measurements = {
    eaveLF: take.netFenceLf,
    rakeLF: 0,
    outsideCorners: Math.max(0, layout.corners),
    insideCorners: 0,
    endCaps: Math.max(0, layout.ends),
    downspoutCount: Math.max(
      0,
      layout.gatesSingle +
        layout.gatesDouble +
        (layout.gatesCustomWidthsFt?.length ?? 0),
    ),
    stories: 1,
    wasteFactorPct: Math.min(30, Math.max(0, layout.wastePct ?? 10)),
  };
  const config: EstimateConfig = {
    // Legacy gutter fields are dead weight for fence packages but the
    // type requires them; the fence block below is what prices.
    size: "5",
    style: "k-style",
    material: "aluminum",
    color: "white",
    downspoutSize: "2x3",
    fence: {
      type: layout.type,
      heightFt: layout.heightFt,
      terrain: layout.terrain,
      stain: !!layout.stain,
      removalLf: Math.max(0, layout.removalLf ?? 0),
      gatesSingle: Math.max(0, layout.gatesSingle),
      gatesDouble: Math.max(0, layout.gatesDouble),
      gatesCustomWidthsFt: layout.gatesCustomWidthsFt ?? [],
      corners: Math.max(0, layout.corners),
      ends: Math.max(0, layout.ends),
      steppedSections: Math.max(0, layout.steppedSections ?? 0),
      wallTopLf: Math.max(0, layout.wallTopLf ?? 0),
      postUpgrade: layout.postUpgrade,
      mixed: layout.mixed,
      // Local market rides along so the proposal prices at the same
      // state/ZIP rates the estimator quoted.
      market: layout.market,
      // …and so does the contractor's price book, for the same reason:
      // the saved proposal must reprice to the number they showed.
      rates: layout.rates,
    },
  };
  return { measurements, config, netFenceLf: take.netFenceLf };
}

export function priceFence(
  layout: FenceLayoutInput,
  priceConfig: FencePriceConfig = {},
): FencePriceBreakdown {
  const c = { ...DEFAULT_PRICE_CONFIG, ...priceConfig };
  const { measurements, config, netFenceLf } = layoutToPricingInputs(layout);
  const items = buildLineItems(measurements, config);

  const subtotal = round2(
    items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0),
  );
  const markup = round2(subtotal * (Math.max(0, c.markupPct) / 100));
  const afterMarkup = subtotal + markup;
  const discount = round2(
    afterMarkup * (Math.min(50, Math.max(0, c.discountPct)) / 100),
  );
  const share = fenceTaxableShare(items, layout.market);
  const tax = round2(
    (afterMarkup - discount) * share * fenceTaxRate(layout.market, FENCE_TAX_RATE),
  );
  const total = round2(afterMarkup - discount + tax);

  return {
    lines: items.map((i) => ({
      key: i.id,
      label: i.name,
      amount: round2(i.quantity * i.unitPrice),
    })),
    subtotal,
    markup,
    discount,
    tax,
    total,
    pricePerLf: netFenceLf > 0 ? round2(total / netFenceLf) : 0,
    market: layout.market,
    taxRate: fenceTaxRate(layout.market, FENCE_TAX_RATE),
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
