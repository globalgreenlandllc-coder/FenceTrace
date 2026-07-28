import type {
  DownspoutSize,
  EstimateConfig,
  FenceEstimateConfig,
  GutterMaterial,
  GutterSize,
  GutterStyle,
  LineItem,
  Measurements,
} from "./types";
import {
  fenceType,
  heightFactor,
  TERRAIN_FACTOR,
  type FenceTypeId,
  type Terrain,
} from "./fence/catalog";
import {
  blendedFactor,
  laborFactor,
  LINE_MATERIAL_SHARE,
  materialFactor,
  type MarketSnapshot,
} from "./fence/market";

type GutterKey = `${GutterSize}-${GutterStyle}-${GutterMaterial}`;

export const GUTTER_UNIT_PRICES: Record<GutterKey, number> = {
  "5-k-style-aluminum": 8.5,
  "6-k-style-aluminum": 12,
  "7-k-style-aluminum": 16.5,
  "5-half-round-aluminum": 11,
  "6-half-round-aluminum": 14,
  "7-half-round-aluminum": 19,
  "5-k-style-steel": 11.5,
  "6-k-style-steel": 14.75,
  "7-k-style-steel": 19,
  "5-half-round-steel": 14,
  "6-half-round-steel": 17.5,
  "7-half-round-steel": 22,
  "5-k-style-copper": 28,
  "6-k-style-copper": 32,
  "7-k-style-copper": 39,
  "5-half-round-copper": 30,
  "6-half-round-copper": 36,
  "7-half-round-copper": 44,
};

export const DOWNSPOUT_UNIT_PRICES: Record<DownspoutSize, number> = {
  "2x3": 7.5,
  "3x4": 9,
  "round-3": 12,
  "round-4": 14.5,
};

export function gutterUnitPrice(cfg: EstimateConfig) {
  const key: GutterKey = `${cfg.size}-${cfg.style}-${cfg.material}`;
  return GUTTER_UNIT_PRICES[key] ?? 12;
}

export function downspoutUnitPrice(cfg: EstimateConfig) {
  return DOWNSPOUT_UNIT_PRICES[cfg.downspoutSize] ?? 9;
}

export function downspoutLengthFt(stories: 1 | 2 | 3) {
  if (stories === 3) return 30;
  if (stories === 2) return 20;
  return 10;
}

/** Tear-off + disposal of the existing system, per eave LF. Also the
 *  basis of the "$X value" copy when the contractor gives it away free. */
export const REMOVAL_PRICE_PER_LF = 1.5;

/** What the old-gutter tear-off would cost at list — rounded to a clean
 *  $5 step so the "FREE ($240 value)" marketing line reads like a real
 *  offer, not a spreadsheet artifact. */
export function removalValueDollars(eaveLF: number): number {
  return Math.max(5, Math.round((eaveLF * REMOVAL_PRICE_PER_LF) / 5) * 5);
}

export const COLOR_OPTIONS = [
  { id: "white", name: "Classic White", hex: "#f4f4f5" },
  { id: "almond", name: "Almond", hex: "#ddd1bd" },
  { id: "musket", name: "Musket Brown", hex: "#5a3d2b" },
  { id: "graphite", name: "Graphite", hex: "#3a3d44" },
  { id: "black", name: "Onyx Black", hex: "#0c0e12" },
  { id: "copper", name: "Natural Copper", hex: "#b87333" },
];

export type LineItemPlan = {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxable: boolean;
};

/** Fence bill of materials — the FenceScan pricing path. measurements
 *  carries the drawn layout (eaveLF = fence LF, downspoutCount = gates);
 *  the fence config carries type/height/terrain/extras. Quantities and
 *  unit prices are chosen so the materials-builder table reads naturally
 *  and packageTotal (markup → discount → tax) works unchanged. */
function buildFenceLineItems(
  measurements: Measurements,
  fence: FenceEstimateConfig,
): LineItemPlan[] {
  const t = fenceType(fence.type as FenceTypeId);
  const hf = heightFactor(t, fence.heightFt);
  const waste = 1 + Math.max(0, measurements.wasteFactorPct) / 100;
  // Local market calibration (state + ZIP). Undefined → every factor is
  // 1 and this prices at the catalog's national rates, exactly as it did
  // before market pricing existed.
  const mk = fence.market;
  const matF = materialFactor(mk, t.id);
  const labF = laborFactor(mk);
  const totalLfAll = Math.max(0, measurements.eaveLF);
  // Mixed-type sections price at their OWN catalog rates; their footage
  // comes out of the primary type's lines so nothing double-bills.
  const mixed = (fence.mixed ?? []).filter(
    (m) => Number.isFinite(m.lf) && m.lf > 0,
  );
  const mixedLf = Math.min(
    totalLfAll,
    mixed.reduce((a, m) => a + m.lf, 0),
  );
  const lf = Math.max(0, totalLfAll - mixedLf);
  // Gates re-price from the LIVE drawn count (measurements.downspoutCount
  // carries gates) — the config split only decides how many of them are
  // doubles. Editing gate markers on the proposal canvas must move money.
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
  // Custom + double counts come from the estimator config; the live drawn
  // count adjusts the WALK-gate remainder so canvas edits still re-price.
  const gatesCustom = Math.min(customWidths.length, liveGates);
  const gatesDouble = Math.min(
    Math.max(0, fence.gatesDouble),
    liveGates - gatesCustom,
  );
  const gatesSingle = Math.max(0, liveGates - gatesDouble - gatesCustom);
  const lines: LineItemPlan[] = [
    {
      id: "fence-materials",
      name: `${t.label} — ${fence.heightFt}' fence package`,
      description: "Posts, rails/panels, fabric, concrete, hardware & caps",
      quantity: lf,
      unit: "LF",
      unitPrice: round2(t.materialPerLf * hf * waste * matF),
      taxable: true,
    },
    {
      id: "fence-labor",
      name: "Professional installation",
      description:
        fence.terrain === "flat"
          ? "Layout, post setting, build & cleanup"
          : `Layout, post setting, build & cleanup — ${fence.terrain} ground`,
      quantity: lf,
      unit: "LF",
      unitPrice: round2(
        t.laborPerLf * hf * TERRAIN_FACTOR[fence.terrain as Terrain] * labF,
      ),
      taxable: false,
    },
  ];
  for (const m of mixed) {
    const mt = fenceType(m.type as FenceTypeId);
    const mLf = Math.round(m.lf);
    // A mixed section is a DIFFERENT commodity — chain link across the
    // back of a cedar job is steel, not lumber — so it takes its own
    // material factor, not the primary type's.
    const mMatF = materialFactor(mk, mt.id);
    lines.push({
      id: `fence-mixed-${mt.id}`,
      name: `${mt.label} section — ${mt.defaultHeightFt}' (${mLf} LF)`,
      description: "Built at its own rate along the marked stretch",
      quantity: mLf,
      unit: "LF",
      unitPrice: round2(mt.materialPerLf * waste * mMatF),
      taxable: true,
    });
    lines.push({
      id: `fence-mixed-${mt.id}-labor`,
      name: `${mt.label} section — installation`,
      quantity: mLf,
      unit: "LF",
      unitPrice: round2(
        mt.laborPerLf * TERRAIN_FACTOR[fence.terrain as Terrain] * labF,
      ),
      taxable: false,
    });
  }
  // Gates, steps, wall anchors, stain and tear-out are part bought /
  // part worked — each takes a blend of the market's material and labor
  // factors at the split documented in LINE_MATERIAL_SHARE.
  const gateF = blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.gate);
  if (gatesSingle > 0)
    lines.push({
      id: "gate-single",
      name: "Walk gate (4') — framed & hung",
      description: "Heavy-set posts, hinges & latch included",
      quantity: gatesSingle,
      unit: "ea",
      unitPrice: round2(t.gateSingle * gateF),
      taxable: true,
    });
  if (gatesDouble > 0)
    lines.push({
      id: "gate-double",
      name: "Drive gate (10') — framed & hung",
      description: "Double swing, drop rod & latch included",
      quantity: gatesDouble,
      unit: "ea",
      unitPrice: round2(t.gateSingle * 2.4 * gateF),
      taxable: true,
    });
  customWidths.slice(0, gatesCustom).forEach((w, i) => {
    // Anchor pricing on the presets: ≤5' ≈ a walk gate; wider scales
    // linearly through the 10' drive-gate price (2.4× walk).
    const price = round2(
      (w <= 5 ? t.gateSingle : t.gateSingle * 2.4 * (w / 10)) * gateF,
    );
    lines.push({
      id: `gate-custom-${i}`,
      name: `Custom gate (${w}') — framed & hung`,
      description: "Heavy-set posts, hinges & latch included",
      quantity: 1,
      unit: "ea",
      unitPrice: price,
      taxable: true,
    });
  });
  if ((fence.steppedSections ?? 0) > 0)
    lines.push({
      id: "fence-steps",
      name: "Slope steps — extended posts & leveling",
      description: `${fence.steppedSections} stepped ${fence.steppedSections === 1 ? "section" : "sections"} on the grade`,
      quantity: fence.steppedSections!,
      unit: "ea",
      unitPrice: round2(28 * blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.step)),
      taxable: true,
    });
  if (fence.postUpgrade) {
    // Mirror the takeoff's post count from the same inputs: sections at
    // the type's spacing; line posts = sections − 1 − corners; plus
    // corner/end posts and a pair per gate.
    const corners = measurements.outsideCorners + measurements.insideCorners;
    const sections = Math.max(1, Math.ceil(lf / t.postSpacingFt));
    const posts =
      Math.max(0, sections - 1 - corners) +
      corners +
      measurements.endCaps +
      liveGates * 2;
    lines.push({
      id: "fence-post-upgrade",
      name:
        fence.postUpgrade === "steel"
          ? "Galvanized steel posts — upgrade"
          : "6×6 pressure-treated posts — upgrade",
      description:
        fence.postUpgrade === "steel"
          ? `${posts} posts — steel never rots, warps or leans`
          : `${posts} posts — heavy 6×6 stock at every post`,
      quantity: posts,
      unit: "ea",
      // A post upgrade is a pure material swap — the hole gets dug
      // either way — so it moves with the market's material factor for
      // the stock being swapped in (steel posts are a metal buy).
      unitPrice: round2(
        (fence.postUpgrade === "steel" ? 24 : 14) *
          materialFactor(
            mk,
            fence.postUpgrade === "steel" ? "steel-ornamental" : "pt-pine-privacy",
          ),
      ),
      taxable: true,
    });
  }
  if ((fence.wallTopLf ?? 0) > 0) {
    // Posts on the wall span are core-drilled + epoxy-anchored to the
    // wall cap instead of dug and set in concrete: anchor kit + drilling
    // time per post (posts every spacing across the span, +1 to close).
    const wallPosts =
      Math.floor(Math.max(0, fence.wallTopLf!) / t.postSpacingFt) + 1;
    lines.push({
      id: "fence-wall-mount",
      name: "Retaining-wall mounting — core-drilled anchors",
      description: `${wallPosts} posts anchored on ${Math.round(fence.wallTopLf!)} LF of wall top (no digging on the wall)`,
      quantity: wallPosts,
      unit: "ea",
      unitPrice: round2(
        72 * blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.wallMount),
      ),
      taxable: true,
    });
  }
  if (fence.removalLf > 0)
    lines.push({
      id: "fence-removal",
      name: "Tear out & haul away existing fence",
      quantity: fence.removalLf,
      unit: "LF",
      // Tear-out is crew time plus the dump fee — pure labor.
      unitPrice: round2(4 * labF),
      taxable: false,
    });
  if (fence.stain && t.stainable)
    lines.push({
      id: "fence-stain",
      name: "Stain & seal (both faces)",
      description: "Premium penetrating stain, 2 coats",
      quantity: Math.ceil(lf * fence.heightFt * 2),
      unit: "sq ft",
      unitPrice: round2(
        1.1 * blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.stain),
      ),
      taxable: true,
    });
  return lines;
}

/**
 * The fraction of a fence bill that sales tax actually lands on.
 *
 * Most states tax the materials on an improvement to real property and
 * leave the installation labor alone — that's the `taxable` flag each
 * BOM line already carries. A handful (AZ, CT, HI, NM, SD, WV) tax the
 * contract as a whole, and there the share is 1. Shared by the
 * estimator rail (priceFence) and the saved proposal (packageTotal) so
 * the two can never disagree about tax.
 */
export function fenceTaxableShare(
  items: { quantity: number; unitPrice: number; taxable: boolean }[],
  market: MarketSnapshot | undefined,
  extraTaxable = 0,
): number {
  const subtotal =
    items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0) + extraTaxable;
  if (subtotal <= 0) return 0;
  if (market?.laborTaxable) return 1;
  const taxable =
    items.reduce(
      (acc, i) => acc + (i.taxable ? i.quantity * i.unitPrice : 0),
      0,
    ) + extraTaxable;
  return taxable / subtotal;
}

/** Sales-tax rate for a fence job — the resolved local rate when the
 *  estimate carries a market, else the legacy national default. */
export function fenceTaxRate(
  market: MarketSnapshot | undefined,
  fallback: number,
): number {
  return market ? market.salesTaxRate : fallback;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildLineItems(
  measurements: Measurements,
  config: EstimateConfig,
): LineItemPlan[] {
  if (config.fence) return buildFenceLineItems(measurements, config.fence);
  const totalLF = Math.ceil(
    measurements.eaveLF * (1 + measurements.wasteFactorPct / 100),
  );
  const dsUnit = downspoutLengthFt(measurements.stories);
  const dsLF = measurements.downspoutCount * dsUnit;

  const gutter = gutterUnitPrice(config);
  const downspout = downspoutUnitPrice(config);

  return [
    {
      id: "gutter",
      name: `${config.size}" ${labelStyle(config.style)} Gutter — ${labelMaterial(
        config.material,
      )}`,
      description: `Includes ${measurements.wasteFactorPct}% waste factor`,
      quantity: totalLF,
      unit: "LF",
      unitPrice: gutter,
      taxable: true,
    },
    {
      id: "downspouts",
      name: `${labelDownspout(config.downspoutSize)} Downspouts`,
      description: `${measurements.downspoutCount} runs × ${dsUnit} ft (${
        measurements.stories
      }-story)`,
      quantity: dsLF,
      unit: "LF",
      unitPrice: downspout,
      taxable: true,
    },
    {
      id: "outside-corners",
      name: "Outside Mitered Corners",
      quantity: measurements.outsideCorners,
      unit: "ea",
      unitPrice: 22,
      taxable: true,
    },
    {
      id: "inside-corners",
      name: "Inside Mitered Corners",
      quantity: measurements.insideCorners,
      unit: "ea",
      unitPrice: 24,
      taxable: true,
    },
    {
      id: "end-caps",
      name: "End Caps",
      quantity: measurements.endCaps,
      unit: "ea",
      unitPrice: 6,
      taxable: true,
    },
    {
      id: "hangers",
      name: "Hidden Hangers",
      description: "1 hanger per 24 inches",
      quantity: Math.ceil(totalLF / 2),
      unit: "ea",
      unitPrice: 3.25,
      taxable: true,
    },
    {
      id: "elbows",
      name: "Downspout Elbows",
      quantity: measurements.downspoutCount * 2,
      unit: "ea",
      unitPrice: 4.5,
      taxable: true,
    },
    ...modernBomLineItems(measurements, config),
    ...removalLineItems(measurements, config),
    {
      id: "labor",
      name: "Installation Labor",
      description: hasRemovalLine(config)
        ? "Install, sealants, cleanup"
        : "Removal of existing, install, sealants, cleanup",
      quantity: 1,
      unit: "lot",
      unitPrice: Math.round(totalLF * 4 + dsLF * 2 + 250),
      taxable: false,
    },
    ...accessoryLineItems(measurements, config, totalLF),
  ];
}

function hasRemovalLine(config: EstimateConfig): boolean {
  return (
    config.oldGutterRemoval === "free" || config.oldGutterRemoval === "priced"
  );
}

/**
 * Standard downspout hardware every real install carries but the BOM
 * used to omit: outlets, straps, splash blocks. Gated on the config
 * carrying `oldGutterRemoval` (i.e. created/edited after 2026-07) —
 * proposals SENT before then recompute their totals live on every
 * portal view, and silently adding ~$100 of parts to a quote the
 * client already saw is not acceptable. New estimates always have the
 * field, so they always get the full BOM.
 */
function modernBomLineItems(
  measurements: Measurements,
  config: EstimateConfig,
): LineItem[] {
  if (config.oldGutterRemoval === undefined) return [];
  const spouts = Math.max(0, measurements.downspoutCount);
  if (spouts === 0) return [];
  return [
    {
      id: "outlets",
      name: "Downspout Outlets",
      description: "Machine-cut drop, sealed into the gutter run",
      quantity: spouts,
      unit: "ea",
      unitPrice: 5.5,
      taxable: true,
    },
    {
      id: "straps",
      name: "Downspout Straps & Fasteners",
      description: "Color-matched, one per story plus the base",
      quantity: spouts * (measurements.stories + 1),
      unit: "ea",
      unitPrice: 2.75,
      taxable: true,
    },
    {
      id: "splash-blocks",
      name: "Splash Blocks",
      description: "Disperses discharge away from the foundation",
      quantity: spouts,
      unit: "ea",
      unitPrice: 14,
      taxable: true,
    },
  ];
}

/**
 * Old-gutter tear-off, visible on the quote instead of buried in the
 * labor lot. "free" is the sales move: a $0 line that names the real
 * value ("$240 value — included at no charge") so the client sees a
 * concrete win. "priced" bills it per eave LF (no waste factor — you
 * only tear off what exists). undefined/"none" renders nothing, which
 * keeps every proposal saved before this feature priced exactly as it
 * was sent.
 */
function removalLineItems(
  measurements: Measurements,
  config: EstimateConfig,
): LineItem[] {
  if (!hasRemovalLine(config)) return [];
  const lf = Math.max(0, Math.round(measurements.eaveLF));
  if (lf === 0) return [];
  if (config.oldGutterRemoval === "free") {
    return [
      {
        id: "removal",
        name: "Old Gutter Removal & Haul-Away — FREE",
        description: `$${removalValueDollars(lf)} value — tear-off, disposal and dump fees included at no charge`,
        quantity: 1,
        unit: "lot",
        unitPrice: 0,
        taxable: false,
      },
    ];
  }
  return [
    {
      id: "removal",
      name: "Old Gutter Removal & Haul-Away",
      description: "Tear-off, disposal and dump fees",
      quantity: lf,
      unit: "LF",
      unitPrice: REMOVAL_PRICE_PER_LF,
      taxable: false,
    },
  ];
}

/**
 * Optional add-on line items derived from config.accessories. Empty
 * accessories yield an empty array so the base BOM stays clean.
 *
 * Pricing assumptions (industry rough numbers, tunable in admin
 * MaterialDefaults later):
 *   - Screen guard       $2.50/LF
 *   - Mesh guard         $4.00/LF
 *   - Micro-mesh guard   $7.50/LF  (premium tier)
 *   - Drip edge          $2.20/LF
 *   - Rain chain         $185 each (single chain replaces one downspout)
 *   - Ice/snow guards    $6.00/LF (running eaves only)
 *   - Heat tape          $14/LF eaves + $120 controller
 */
function accessoryLineItems(
  measurements: Measurements,
  config: EstimateConfig,
  totalLF: number,
): LineItem[] {
  const acc = config.accessories;
  if (!acc) return [];
  const out: LineItem[] = [];
  const eaveLF = measurements.eaveLF;

  if (acc.guard !== "none") {
    const unit =
      acc.guard === "screen" ? 2.5 : acc.guard === "mesh" ? 4 : 7.5;
    const guardLabel =
      acc.guard === "screen"
        ? "Screen leaf guards"
        : acc.guard === "mesh"
          ? "Mesh leaf guards"
          : "Micro-mesh leaf guards";
    out.push({
      id: "guards",
      name: guardLabel,
      description: "Snap-on, fits selected gutter profile",
      quantity: eaveLF,
      unit: "LF",
      unitPrice: unit,
      taxable: true,
    });
  }
  if (acc.dripEdge) {
    out.push({
      id: "drip-edge",
      name: "Aluminum drip edge",
      description: "Color-matched, sealed at fascia",
      quantity: eaveLF,
      unit: "LF",
      unitPrice: 2.2,
      taxable: true,
    });
  }
  if (acc.rainChain) {
    out.push({
      id: "rain-chain",
      name: "Decorative copper rain chain",
      description: "Replaces one downspout outlet",
      quantity: 1,
      unit: "ea",
      unitPrice: 185,
      taxable: true,
    });
  }
  if (acc.iceGuard) {
    out.push({
      id: "ice-guards",
      name: "Snow / ice guards",
      description: "Roof-edge ice dam protection",
      quantity: eaveLF,
      unit: "LF",
      unitPrice: 6,
      taxable: true,
    });
  }
  if (acc.heatTape) {
    out.push({
      id: "heat-tape",
      name: "Heat tape kit",
      description: "Self-regulating cable + thermostat controller",
      quantity: eaveLF,
      unit: "LF",
      unitPrice: 14,
      taxable: true,
    });
    out.push({
      id: "heat-tape-controller",
      name: "Heat tape controller",
      quantity: 1,
      unit: "ea",
      unitPrice: 120,
      taxable: true,
    });
  }
  return out;
}

function labelStyle(s: GutterStyle) {
  return s === "k-style" ? "K-Style" : "Half-Round";
}
function labelMaterial(m: GutterMaterial) {
  return m === "aluminum" ? "Aluminum" : m === "copper" ? "Copper" : "Steel";
}
function labelDownspout(d: DownspoutSize) {
  return {
    "2x3": '2"×3" Rectangular',
    "3x4": '3"×4" Rectangular',
    "round-3": '3" Round',
    "round-4": '4" Round',
  }[d];
}
