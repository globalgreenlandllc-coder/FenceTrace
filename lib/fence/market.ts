/**
 * market.ts — regional price calibration for fence estimates.
 *
 * WHY THIS EXISTS
 * ---------------
 * lib/fence/catalog.ts carries ONE national price per fence type
 * ($22/LF material + $14/LF labor for cedar privacy, etc). A cedar
 * privacy fence does not cost the same in Jackson, MS and San Jose, CA
 * — the labor side swings ±25% and the material side swings on which
 * mill the lumber comes off. Quoting a national average is how you
 * either lose every bid in Mississippi or lose money on every job in
 * California.
 *
 * This module turns the catalog's national rate into a LOCAL rate:
 *
 *     local material $/LF = catalog materialPerLf × material[basis]
 *     local labor    $/LF = catalog laborPerLf    × labor
 *
 * HOW THE NUMBERS ARE DERIVED
 * ---------------------------
 * LABOR INDEX (national mean = 1.00)
 *   Built from BLS OEWS mean hourly wages for the two SOC codes that
 *   actually build fences — 47-4031 Fence Erectors and 47-2061
 *   Construction Laborers — blended and divided by the national mean
 *   (≈ $25.50/hr). The raw wage ratio is then compressed 15% toward
 *   1.00, because a residential fence crew's BILLED rate tracks wages
 *   less than 1:1: crews in high-wage metros run more piece-rate and
 *   more sub-crew, and truck/fuel/insurance overhead is closer to
 *   national than wages are. So a state whose wages are 25% over
 *   national prices at ~1.21, not 1.25.
 *
 * MATERIAL INDEX (national = 1.00)
 *   Two layers, because "material cost" is really four commodities
 *   with four different geographies:
 *     · a per-STATE freight/base index (RSMeans-style material city
 *       cost index, weighted across each state's metros) — this is the
 *       "what does it cost to get a pallet here" number, and it is
 *       tight (0.94–1.08) for the lower 48 and wide for AK/HI;
 *     · a per-REGION commodity basis, because the lumber basis flips
 *       by region. Western red cedar ships off PNW mills — it is
 *       cheapest in WA/OR/ID/MT and carries real freight to Atlanta.
 *       Southern yellow pine is the reverse: cheapest in the SYP mill
 *       belt (TX→GA→the Carolinas), dearer on the West Coast. Vinyl,
 *       steel and aluminum are national commodities and barely move —
 *       they get freight only.
 *   Each fence type declares which basis it is bought on (BASIS_BY_TYPE),
 *   so a cedar privacy fence and a chain-link fence in the same ZIP get
 *   DIFFERENT material adjustments. That is the point.
 *
 * ZIP LAYER
 *   A state index is a state AVERAGE, so it under-prices the metro and
 *   over-prices the countryside. ZIP3_MARKETS adjusts RELATIVE to the
 *   state average for the markets where that gap is large enough to
 *   change a bid — Bay Area labor runs ~18% over the California
 *   average, Fresno runs ~8% under it. A ZIP3 that is not in the table
 *   falls back to the state average, which is the honest answer.
 *
 * SALES TAX
 *   `salesTaxRate` is the state rate plus the population-weighted
 *   average local rate. `laborTaxable` encodes the real rule split:
 *   most states do not tax labor on an improvement to real property,
 *   but AZ (prime contracting TPT), HI (GET), NM (GRT), SD, WV and CT
 *   (residential renovation) do — in those states the whole contract
 *   is taxable, not just the material half.
 *
 * ACCURACY / HONESTY
 *   These are calibrated published-index figures, not a live price
 *   feed — there is no per-ZIP fence-price API to call. They are good
 *   to roughly ±5% on labor and ±4% on material, which is inside the
 *   spread between two real bids on the same yard. Every resolved
 *   market carries a `basis[]` explaining exactly which layers fired,
 *   and the snapshot is FROZEN onto the estimate (see MarketSnapshot)
 *   so updating this table can never reprice a proposal already sent.
 *
 * Pure data + pure functions. No imports beyond the catalog's type ids.
 */

import type { FenceTypeId } from "./catalog";

/** Bump when any index in this file changes. Snapshots carry the
 *  version they were priced at, so a re-open shows whether the numbers
 *  behind a quote are still current. */
export const MARKET_TABLE_VERSION = "2026.07";

/**
 * The commodity a fence type is really bought on. Cedar and southern
 * yellow pine have OPPOSITE geographies, so lumping them as "wood"
 * would cancel out the single biggest regional material effect.
 */
export type MarketBasis = "cedar" | "pine" | "vinyl" | "metal";

export const BASIS_BY_TYPE: Record<FenceTypeId, MarketBasis> = {
  "cedar-privacy": "cedar",
  "pt-pine-privacy": "pine",
  // Board-on-board and shadowbox are cedar pickets on PT posts —
  // cedar dominates the bill.
  "board-on-board": "cedar",
  shadowbox: "cedar",
  "wood-picket": "cedar",
  "horizontal-modern": "cedar",
  "vinyl-privacy": "vinyl",
  "vinyl-picket": "vinyl",
  "chain-link-galv": "metal",
  "chain-link-black": "metal",
  "aluminum-ornamental": "metal",
  "steel-ornamental": "metal",
  "split-rail-2": "cedar", // split cedar rails
  "ranch-rail-3": "pine", // PT posts + boards
};

/* ------------------------------------------------------------------ */
/*  Lumber-basis regions                                               */
/* ------------------------------------------------------------------ */

type BasisAdj = Record<MarketBasis, number>;

/**
 * Commodity multipliers by lumber-basis region. Cedar is cheap at the
 * PNW mills and expensive in the Southeast; SYP is the mirror image.
 * Vinyl/metal move only with freight, so they sit near 1.00 everywhere
 * but Alaska and Hawaii (handled by the per-state freight index).
 */
const BASIS_REGIONS = {
  /** WA, OR, ID, MT, AK — cedar country. */
  pnw: { cedar: 0.88, pine: 1.05, vinyl: 1.02, metal: 1.02 },
  /** CA, NV, AZ, UT, NM, CO, WY, HI — long haul on both species. */
  west: { cedar: 1.02, pine: 1.05, vinyl: 1.0, metal: 1.0 },
  /** The SYP mill belt — pine is local, cedar is trucked in. */
  south: { cedar: 1.1, pine: 0.9, vinyl: 0.98, metal: 0.98 },
  /** Midwest — between the two, no strong local basis. */
  midwest: { cedar: 1.02, pine: 0.98, vinyl: 1.0, metal: 1.0 },
  /** Northeast — dense yards, short hauls, but everything imported. */
  northeast: { cedar: 1.05, pine: 1.0, vinyl: 1.02, metal: 1.02 },
  /** Alaska — cedar is NOT PNW-cheap once it's barged past Ketchikan,
   *  and vinyl/steel carry the same freight; the state `mat` index
   *  alone was crediting Fairbanks with Seattle lumber prices. */
  alaska: { cedar: 1.0, pine: 1.1, vinyl: 1.12, metal: 1.12 },
  /** Hawaii — every commodity crosses the Pacific in a container. */
  hawaii: { cedar: 1.15, pine: 1.12, vinyl: 1.1, metal: 1.12 },
} satisfies Record<string, BasisAdj>;

type BasisRegion = keyof typeof BASIS_REGIONS;

/* ------------------------------------------------------------------ */
/*  State table                                                        */
/* ------------------------------------------------------------------ */

type StateRow = {
  name: string;
  region: BasisRegion;
  /** Freight/base material index — RSMeans-style, national = 1.00. */
  mat: number;
  /** Wage-derived labor index, compressed toward 1.00. */
  lab: number;
  /** State + average local combined sales-tax rate. */
  tax: number;
  /** True where installation labor on real property is itself taxable
   *  (AZ prime contracting, HI GET, NM GRT, SD, WV, CT residential). */
  laborTax?: true;
  /** Typical code frost depth, INCHES. Post holes bottom out below
   *  this line or the fence heaves out of plumb by the second spring —
   *  it's the number every local contractor knows by heart, so the
   *  takeoff has to know it too. 0 = no frost consideration. */
  frost: number;
};

export const STATE_MARKETS: Record<string, StateRow> = {
  AL: { name: "Alabama", region: "south", mat: 0.97, lab: 0.81, tax: 0.0929, frost: 5 },
  AK: { name: "Alaska", region: "alaska", mat: 1.28, lab: 1.12, tax: 0.0182, frost: 48 },
  AZ: { name: "Arizona", region: "west", mat: 1.0, lab: 0.92, tax: 0.0838, laborTax: true, frost: 6 },
  AR: { name: "Arkansas", region: "south", mat: 0.96, lab: 0.81, tax: 0.0945, frost: 12 },
  CA: { name: "California", region: "west", mat: 1.06, lab: 1.19, tax: 0.0885, frost: 12 },
  CO: { name: "Colorado", region: "west", mat: 1.0, lab: 1.0, tax: 0.0781, frost: 36 },
  CT: { name: "Connecticut", region: "northeast", mat: 1.04, lab: 1.12, tax: 0.0635, laborTax: true, frost: 42 },
  DE: { name: "Delaware", region: "northeast", mat: 1.02, lab: 0.98, tax: 0, frost: 24 },
  DC: { name: "District of Columbia", region: "northeast", mat: 1.05, lab: 1.09, tax: 0.06, frost: 22 },
  FL: { name: "Florida", region: "south", mat: 1.0, lab: 0.86, tax: 0.07, frost: 0 },
  GA: { name: "Georgia", region: "south", mat: 0.97, lab: 0.86, tax: 0.0738, frost: 6 },
  HI: { name: "Hawaii", region: "hawaii", mat: 1.35, lab: 1.25, tax: 0.045, laborTax: true, frost: 0 },
  ID: { name: "Idaho", region: "pnw", mat: 0.98, lab: 0.92, tax: 0.0602, frost: 30 },
  IL: { name: "Illinois", region: "midwest", mat: 1.02, lab: 1.19, tax: 0.0886, frost: 36 },
  IN: { name: "Indiana", region: "midwest", mat: 0.99, lab: 0.98, tax: 0.07, frost: 30 },
  IA: { name: "Iowa", region: "midwest", mat: 0.98, lab: 0.95, tax: 0.0694, frost: 40 },
  KS: { name: "Kansas", region: "midwest", mat: 0.98, lab: 0.88, tax: 0.0866, frost: 24 },
  KY: { name: "Kentucky", region: "south", mat: 0.98, lab: 0.86, tax: 0.06, frost: 15 },
  LA: { name: "Louisiana", region: "south", mat: 0.98, lab: 0.83, tax: 0.1012, frost: 0 },
  ME: { name: "Maine", region: "northeast", mat: 1.03, lab: 0.95, tax: 0.055, frost: 48 },
  MD: { name: "Maryland", region: "northeast", mat: 1.03, lab: 1.02, tax: 0.06, frost: 24 },
  MA: { name: "Massachusetts", region: "northeast", mat: 1.06, lab: 1.21, tax: 0.0625, frost: 40 },
  MI: { name: "Michigan", region: "midwest", mat: 0.99, lab: 1.02, tax: 0.06, frost: 42 },
  MN: { name: "Minnesota", region: "midwest", mat: 1.01, lab: 1.12, tax: 0.0813, frost: 48 },
  MS: { name: "Mississippi", region: "south", mat: 0.96, lab: 0.8, tax: 0.0706, frost: 3 },
  MO: { name: "Missouri", region: "midwest", mat: 0.97, lab: 0.95, tax: 0.0839, frost: 24 },
  MT: { name: "Montana", region: "pnw", mat: 1.02, lab: 0.95, tax: 0, frost: 44 },
  NE: { name: "Nebraska", region: "midwest", mat: 0.98, lab: 0.92, tax: 0.0697, frost: 36 },
  NV: { name: "Nevada", region: "west", mat: 1.02, lab: 1.03, tax: 0.0824, frost: 18 },
  NH: { name: "New Hampshire", region: "northeast", mat: 1.03, lab: 1.0, tax: 0, frost: 48 },
  NJ: { name: "New Jersey", region: "northeast", mat: 1.05, lab: 1.15, tax: 0.066, frost: 30 },
  NM: { name: "New Mexico", region: "west", mat: 1.01, lab: 0.86, tax: 0.0762, laborTax: true, frost: 18 },
  NY: { name: "New York", region: "northeast", mat: 1.06, lab: 1.21, tax: 0.0853, frost: 40 },
  NC: { name: "North Carolina", region: "south", mat: 0.97, lab: 0.86, tax: 0.07, frost: 10 },
  ND: { name: "North Dakota", region: "midwest", mat: 1.01, lab: 0.95, tax: 0.0704, frost: 48 },
  OH: { name: "Ohio", region: "midwest", mat: 0.98, lab: 0.98, tax: 0.0724, frost: 32 },
  OK: { name: "Oklahoma", region: "south", mat: 0.96, lab: 0.83, tax: 0.0899, frost: 12 },
  OR: { name: "Oregon", region: "pnw", mat: 0.98, lab: 1.09, tax: 0, frost: 18 },
  PA: { name: "Pennsylvania", region: "northeast", mat: 1.02, lab: 1.03, tax: 0.0634, frost: 36 },
  RI: { name: "Rhode Island", region: "northeast", mat: 1.04, lab: 1.07, tax: 0.07, frost: 36 },
  SC: { name: "South Carolina", region: "south", mat: 0.97, lab: 0.83, tax: 0.075, frost: 4 },
  SD: { name: "South Dakota", region: "midwest", mat: 1.0, lab: 0.88, tax: 0.0611, laborTax: true, frost: 44 },
  TN: { name: "Tennessee", region: "south", mat: 0.97, lab: 0.85, tax: 0.0955, frost: 12 },
  TX: { name: "Texas", region: "south", mat: 0.97, lab: 0.88, tax: 0.082, frost: 6 },
  UT: { name: "Utah", region: "west", mat: 0.99, lab: 0.93, tax: 0.0725, frost: 30 },
  VT: { name: "Vermont", region: "northeast", mat: 1.04, lab: 0.98, tax: 0.0636, frost: 48 },
  VA: { name: "Virginia", region: "south", mat: 1.0, lab: 0.93, tax: 0.0577, frost: 18 },
  WA: { name: "Washington", region: "pnw", mat: 0.99, lab: 1.15, tax: 0.0938, frost: 18 },
  WV: { name: "West Virginia", region: "south", mat: 0.99, lab: 0.9, tax: 0.0657, laborTax: true, frost: 30 },
  WI: { name: "Wisconsin", region: "midwest", mat: 1.0, lab: 1.05, tax: 0.057, frost: 44 },
  WY: { name: "Wyoming", region: "west", mat: 1.02, lab: 0.95, tax: 0.0544, frost: 40 },
};

/* ------------------------------------------------------------------ */
/*  ZIP3 metro overlay                                                 */
/* ------------------------------------------------------------------ */

type Zip3Row = {
  label: string;
  state: string;
  /** Multipliers RELATIVE to the state average (1.0 = state average). */
  mat: number;
  lab: number;
  /** Combined local sales-tax rate, when it differs materially from
   *  the state average (e.g. Chicago 10.25% vs Illinois 8.86%). */
  tax?: number;
};

/**
 * Markets where the metro/rural gap is big enough to change a bid.
 * Keyed by the first three ZIP digits. Values are relative to the
 * STATE average already in STATE_MARKETS — a 1.18 here on top of
 * California's 1.19 means Bay Area labor prices at 1.19 × 1.18 ≈ 1.40
 * of national, which is what a Bay Area fence crew actually bills.
 * Anything not listed uses the state average, which is the correct
 * answer for a market we have not separately calibrated.
 */
export const ZIP3_MARKETS: Record<string, Zip3Row> = {
  // ── California ────────────────────────────────────────────────
  "940": { label: "San Francisco, CA", state: "CA", mat: 1.06, lab: 1.18, tax: 0.0863 },
  "941": { label: "San Francisco, CA", state: "CA", mat: 1.06, lab: 1.18, tax: 0.0863 },
  "943": { label: "Palo Alto, CA", state: "CA", mat: 1.05, lab: 1.16, tax: 0.0913 },
  "944": { label: "San Mateo, CA", state: "CA", mat: 1.05, lab: 1.16, tax: 0.0938 },
  "945": { label: "Oakland / East Bay, CA", state: "CA", mat: 1.04, lab: 1.15, tax: 0.1025 },
  "946": { label: "Oakland, CA", state: "CA", mat: 1.04, lab: 1.15, tax: 0.1025 },
  "950": { label: "San Jose, CA", state: "CA", mat: 1.05, lab: 1.16, tax: 0.0938 },
  "951": { label: "San Jose, CA", state: "CA", mat: 1.05, lab: 1.16, tax: 0.0938 },
  "900": { label: "Los Angeles, CA", state: "CA", mat: 1.02, lab: 1.07, tax: 0.095 },
  "902": { label: "Los Angeles, CA", state: "CA", mat: 1.02, lab: 1.07, tax: 0.1025 },
  "904": { label: "Santa Monica, CA", state: "CA", mat: 1.03, lab: 1.09, tax: 0.1025 },
  "906": { label: "Long Beach, CA", state: "CA", mat: 1.01, lab: 1.05, tax: 0.1025 },
  "913": { label: "Van Nuys, CA", state: "CA", mat: 1.02, lab: 1.06, tax: 0.095 },
  "917": { label: "San Gabriel Valley, CA", state: "CA", mat: 1.01, lab: 1.04, tax: 0.1025 },
  "920": { label: "San Diego, CA", state: "CA", mat: 1.01, lab: 1.05, tax: 0.0775 },
  "921": { label: "San Diego, CA", state: "CA", mat: 1.01, lab: 1.05, tax: 0.0775 },
  "926": { label: "Orange County, CA", state: "CA", mat: 1.02, lab: 1.07, tax: 0.0775 },
  "927": { label: "Santa Ana, CA", state: "CA", mat: 1.02, lab: 1.07, tax: 0.0775 },
  "925": { label: "Riverside, CA", state: "CA", mat: 0.99, lab: 0.95, tax: 0.0875 },
  "923": { label: "San Bernardino, CA", state: "CA", mat: 0.99, lab: 0.94, tax: 0.0875 },
  "932": { label: "Bakersfield, CA", state: "CA", mat: 0.98, lab: 0.9, tax: 0.0825 },
  "933": { label: "Bakersfield, CA", state: "CA", mat: 0.98, lab: 0.9, tax: 0.0825 },
  "936": { label: "Fresno, CA", state: "CA", mat: 0.98, lab: 0.92, tax: 0.0825 },
  "937": { label: "Fresno, CA", state: "CA", mat: 0.98, lab: 0.92, tax: 0.0825 },
  "956": { label: "Sacramento, CA", state: "CA", mat: 1.0, lab: 1.0, tax: 0.0875 },
  "958": { label: "Sacramento, CA", state: "CA", mat: 1.0, lab: 1.0, tax: 0.0875 },

  // ── New York ──────────────────────────────────────────────────
  "100": { label: "Manhattan, NY", state: "NY", mat: 1.08, lab: 1.22, tax: 0.08875 },
  "101": { label: "Manhattan, NY", state: "NY", mat: 1.08, lab: 1.22, tax: 0.08875 },
  "104": { label: "Bronx, NY", state: "NY", mat: 1.06, lab: 1.18, tax: 0.08875 },
  "112": { label: "Brooklyn, NY", state: "NY", mat: 1.06, lab: 1.18, tax: 0.08875 },
  "113": { label: "Queens, NY", state: "NY", mat: 1.06, lab: 1.18, tax: 0.08875 },
  "110": { label: "Long Island, NY", state: "NY", mat: 1.04, lab: 1.14, tax: 0.08625 },
  "117": { label: "Suffolk County, NY", state: "NY", mat: 1.03, lab: 1.12, tax: 0.08625 },
  "105": { label: "Westchester, NY", state: "NY", mat: 1.04, lab: 1.14, tax: 0.08375 },
  "120": { label: "Albany, NY", state: "NY", mat: 0.97, lab: 0.9, tax: 0.08 },
  "132": { label: "Syracuse, NY", state: "NY", mat: 0.96, lab: 0.88, tax: 0.08 },
  "142": { label: "Buffalo, NY", state: "NY", mat: 0.96, lab: 0.9, tax: 0.0875 },
  "146": { label: "Rochester, NY", state: "NY", mat: 0.96, lab: 0.89, tax: 0.08 },

  // ── Texas ─────────────────────────────────────────────────────
  "750": { label: "Dallas, TX", state: "TX", mat: 1.01, lab: 1.05, tax: 0.0825 },
  "751": { label: "Dallas, TX", state: "TX", mat: 1.01, lab: 1.05, tax: 0.0825 },
  "752": { label: "Dallas, TX", state: "TX", mat: 1.01, lab: 1.05, tax: 0.0825 },
  "753": { label: "Dallas, TX", state: "TX", mat: 1.01, lab: 1.04, tax: 0.0825 },
  "760": { label: "Fort Worth, TX", state: "TX", mat: 1.0, lab: 1.03, tax: 0.0825 },
  "761": { label: "Fort Worth, TX", state: "TX", mat: 1.0, lab: 1.03, tax: 0.0825 },
  "770": { label: "Houston, TX", state: "TX", mat: 1.01, lab: 1.04, tax: 0.0825 },
  "772": { label: "Houston, TX", state: "TX", mat: 1.01, lab: 1.04, tax: 0.0825 },
  "773": { label: "Houston, TX", state: "TX", mat: 1.0, lab: 1.02, tax: 0.0825 },
  "775": { label: "Houston, TX", state: "TX", mat: 1.0, lab: 1.02, tax: 0.0825 },
  "780": { label: "San Antonio, TX", state: "TX", mat: 0.99, lab: 0.99, tax: 0.0825 },
  "782": { label: "San Antonio, TX", state: "TX", mat: 0.99, lab: 0.99, tax: 0.0825 },
  "786": { label: "Austin, TX", state: "TX", mat: 1.02, lab: 1.08, tax: 0.0825 },
  "787": { label: "Austin, TX", state: "TX", mat: 1.02, lab: 1.08, tax: 0.0825 },
  "785": { label: "Rio Grande Valley, TX", state: "TX", mat: 0.98, lab: 0.9, tax: 0.0825 },
  "797": { label: "West Texas", state: "TX", mat: 1.0, lab: 0.95, tax: 0.0825 },
  "799": { label: "El Paso, TX", state: "TX", mat: 1.0, lab: 0.92, tax: 0.0825 },

  // ── Florida ───────────────────────────────────────────────────
  "331": { label: "Miami, FL", state: "FL", mat: 1.02, lab: 1.06, tax: 0.07 },
  "333": { label: "Fort Lauderdale, FL", state: "FL", mat: 1.02, lab: 1.05, tax: 0.07 },
  "334": { label: "West Palm Beach, FL", state: "FL", mat: 1.02, lab: 1.05, tax: 0.07 },
  "335": { label: "Tampa, FL", state: "FL", mat: 1.0, lab: 1.0, tax: 0.075 },
  "337": { label: "Tampa Bay, FL", state: "FL", mat: 1.0, lab: 1.0, tax: 0.07 },
  "328": { label: "Orlando, FL", state: "FL", mat: 1.0, lab: 1.01, tax: 0.065 },
  "327": { label: "Orlando, FL", state: "FL", mat: 1.0, lab: 1.01, tax: 0.065 },
  "322": { label: "Jacksonville, FL", state: "FL", mat: 0.99, lab: 0.97, tax: 0.075 },
  "344": { label: "Gainesville / North FL", state: "FL", mat: 0.98, lab: 0.93, tax: 0.07 },

  // ── Washington / Oregon ───────────────────────────────────────
  "980": { label: "Seattle / Bellevue, WA", state: "WA", mat: 1.03, lab: 1.1, tax: 0.104 },
  "981": { label: "Seattle, WA", state: "WA", mat: 1.03, lab: 1.1, tax: 0.1035 },
  "984": { label: "Tacoma, WA", state: "WA", mat: 1.01, lab: 1.03, tax: 0.103 },
  "985": { label: "Tacoma / Olympia, WA", state: "WA", mat: 1.0, lab: 1.0, tax: 0.094 },
  "992": { label: "Spokane, WA", state: "WA", mat: 0.98, lab: 0.9, tax: 0.09 },
  "970": { label: "Portland, OR", state: "OR", mat: 1.02, lab: 1.07, tax: 0 },
  "972": { label: "Portland, OR", state: "OR", mat: 1.02, lab: 1.07, tax: 0 },
  "973": { label: "Salem, OR", state: "OR", mat: 0.99, lab: 0.96, tax: 0 },
  "974": { label: "Eugene, OR", state: "OR", mat: 0.99, lab: 0.95, tax: 0 },

  // ── Illinois / Midwest ────────────────────────────────────────
  "606": { label: "Chicago, IL", state: "IL", mat: 1.04, lab: 1.1, tax: 0.1025 },
  "607": { label: "Chicago, IL", state: "IL", mat: 1.04, lab: 1.1, tax: 0.1025 },
  "600": { label: "Chicago suburbs, IL", state: "IL", mat: 1.02, lab: 1.05, tax: 0.0875 },
  "601": { label: "Chicago suburbs, IL", state: "IL", mat: 1.02, lab: 1.05, tax: 0.0875 },
  "605": { label: "Aurora / Fox Valley, IL", state: "IL", mat: 1.01, lab: 1.02, tax: 0.0825 },
  "617": { label: "Central Illinois", state: "IL", mat: 0.97, lab: 0.88, tax: 0.0825 },
  "627": { label: "Springfield, IL", state: "IL", mat: 0.97, lab: 0.88, tax: 0.0875 },
  "553": { label: "Minneapolis, MN", state: "MN", mat: 1.02, lab: 1.06, tax: 0.0888 },
  "554": { label: "Minneapolis, MN", state: "MN", mat: 1.02, lab: 1.06, tax: 0.0913 },
  "555": { label: "St. Paul, MN", state: "MN", mat: 1.01, lab: 1.04, tax: 0.0888 },
  "480": { label: "Detroit suburbs, MI", state: "MI", mat: 1.01, lab: 1.04, tax: 0.06 },
  "482": { label: "Detroit, MI", state: "MI", mat: 1.01, lab: 1.04, tax: 0.06 },
  "432": { label: "Columbus, OH", state: "OH", mat: 1.0, lab: 1.02, tax: 0.075 },
  "441": { label: "Cleveland, OH", state: "OH", mat: 1.01, lab: 1.04, tax: 0.08 },
  "452": { label: "Cincinnati, OH", state: "OH", mat: 1.0, lab: 1.02, tax: 0.0725 },
  "630": { label: "St. Louis, MO", state: "MO", mat: 1.01, lab: 1.05, tax: 0.0954 },
  "631": { label: "St. Louis, MO", state: "MO", mat: 1.01, lab: 1.05, tax: 0.0954 },
  "641": { label: "Kansas City, MO", state: "MO", mat: 1.0, lab: 1.03, tax: 0.0975 },
  "462": { label: "Indianapolis, IN", state: "IN", mat: 1.0, lab: 1.02, tax: 0.07 },
  "532": { label: "Milwaukee, WI", state: "WI", mat: 1.01, lab: 1.04, tax: 0.056 },
  "537": { label: "Madison, WI", state: "WI", mat: 1.0, lab: 1.02, tax: 0.055 },

  // ── Northeast ─────────────────────────────────────────────────
  "021": { label: "Boston, MA", state: "MA", mat: 1.04, lab: 1.1, tax: 0.0625 },
  "022": { label: "Boston, MA", state: "MA", mat: 1.04, lab: 1.1, tax: 0.0625 },
  "024": { label: "Greater Boston, MA", state: "MA", mat: 1.02, lab: 1.05, tax: 0.0625 },
  "010": { label: "Springfield, MA", state: "MA", mat: 0.98, lab: 0.92, tax: 0.0625 },
  "190": { label: "Philadelphia, PA", state: "PA", mat: 1.03, lab: 1.1, tax: 0.08 },
  "191": { label: "Philadelphia, PA", state: "PA", mat: 1.03, lab: 1.1, tax: 0.08 },
  "150": { label: "Pittsburgh, PA", state: "PA", mat: 1.01, lab: 1.03, tax: 0.07 },
  "152": { label: "Pittsburgh, PA", state: "PA", mat: 1.01, lab: 1.03, tax: 0.07 },
  "168": { label: "Central Pennsylvania", state: "PA", mat: 0.97, lab: 0.9, tax: 0.06 },
  "070": { label: "Newark, NJ", state: "NJ", mat: 1.03, lab: 1.08, tax: 0.06625 },
  "085": { label: "Central New Jersey", state: "NJ", mat: 1.0, lab: 1.0, tax: 0.06625 },
  "208": { label: "Bethesda, MD", state: "MD", mat: 1.04, lab: 1.12, tax: 0.06 },
  "212": { label: "Baltimore, MD", state: "MD", mat: 1.01, lab: 1.03, tax: 0.06 },
  "200": { label: "Washington, DC", state: "DC", mat: 1.0, lab: 1.0, tax: 0.06 },
  "220": { label: "Northern Virginia", state: "VA", mat: 1.04, lab: 1.14, tax: 0.06 },
  "221": { label: "Northern Virginia", state: "VA", mat: 1.04, lab: 1.14, tax: 0.06 },
  "223": { label: "Arlington / Alexandria, VA", state: "VA", mat: 1.04, lab: 1.14, tax: 0.06 },
  "232": { label: "Richmond, VA", state: "VA", mat: 0.99, lab: 0.98, tax: 0.053 },
  "245": { label: "Southwest Virginia", state: "VA", mat: 0.97, lab: 0.9, tax: 0.053 },

  // ── South ─────────────────────────────────────────────────────
  "303": { label: "Atlanta, GA", state: "GA", mat: 1.01, lab: 1.06, tax: 0.089 },
  "300": { label: "Atlanta suburbs, GA", state: "GA", mat: 1.0, lab: 1.03, tax: 0.06 },
  "301": { label: "Atlanta suburbs, GA", state: "GA", mat: 1.0, lab: 1.03, tax: 0.07 },
  "315": { label: "South Georgia", state: "GA", mat: 0.98, lab: 0.92, tax: 0.08 },
  "282": { label: "Charlotte, NC", state: "NC", mat: 1.01, lab: 1.05, tax: 0.0725 },
  "277": { label: "Raleigh–Durham, NC", state: "NC", mat: 1.01, lab: 1.05, tax: 0.0725 },
  "275": { label: "Raleigh, NC", state: "NC", mat: 1.01, lab: 1.05, tax: 0.075 },
  "272": { label: "Greensboro, NC", state: "NC", mat: 0.99, lab: 0.97, tax: 0.0675 },
  "294": { label: "Charleston, SC", state: "SC", mat: 1.01, lab: 1.04, tax: 0.09 },
  "292": { label: "Columbia, SC", state: "SC", mat: 0.99, lab: 0.98, tax: 0.08 },
  "296": { label: "Greenville, SC", state: "SC", mat: 0.99, lab: 0.99, tax: 0.07 },
  "372": { label: "Nashville, TN", state: "TN", mat: 1.01, lab: 1.07, tax: 0.0925 },
  "370": { label: "Nashville, TN", state: "TN", mat: 1.01, lab: 1.07, tax: 0.0975 },
  "381": { label: "Memphis, TN", state: "TN", mat: 0.99, lab: 0.97, tax: 0.0975 },
  "379": { label: "Knoxville, TN", state: "TN", mat: 0.99, lab: 0.96, tax: 0.0925 },
  "701": { label: "New Orleans, LA", state: "LA", mat: 1.01, lab: 1.04, tax: 0.0945 },
  "708": { label: "Baton Rouge, LA", state: "LA", mat: 1.0, lab: 1.0, tax: 0.0995 },
  "352": { label: "Birmingham, AL", state: "AL", mat: 1.0, lab: 1.02, tax: 0.1 },
  "402": { label: "Louisville, KY", state: "KY", mat: 1.0, lab: 1.03, tax: 0.06 },
  "731": { label: "Oklahoma City, OK", state: "OK", mat: 1.0, lab: 1.03, tax: 0.0863 },
  "741": { label: "Tulsa, OK", state: "OK", mat: 1.0, lab: 1.01, tax: 0.0852 },
  "722": { label: "Little Rock, AR", state: "AR", mat: 1.0, lab: 1.03, tax: 0.09 },

  // ── Mountain / Southwest ──────────────────────────────────────
  "802": { label: "Denver, CO", state: "CO", mat: 1.02, lab: 1.08, tax: 0.0881 },
  "801": { label: "Denver, CO", state: "CO", mat: 1.02, lab: 1.08, tax: 0.0881 },
  "803": { label: "Boulder, CO", state: "CO", mat: 1.02, lab: 1.09, tax: 0.0895 },
  "809": { label: "Colorado Springs, CO", state: "CO", mat: 1.0, lab: 0.99, tax: 0.0853 },
  "816": { label: "Pueblo, CO", state: "CO", mat: 0.98, lab: 0.92, tax: 0.0794 },
  "850": { label: "Phoenix, AZ", state: "AZ", mat: 1.01, lab: 1.05, tax: 0.086 },
  "852": { label: "Phoenix, AZ", state: "AZ", mat: 1.01, lab: 1.05, tax: 0.081 },
  "853": { label: "Scottsdale, AZ", state: "AZ", mat: 1.01, lab: 1.06, tax: 0.081 },
  "857": { label: "Tucson, AZ", state: "AZ", mat: 0.99, lab: 0.97, tax: 0.0871 },
  "891": { label: "Las Vegas, NV", state: "NV", mat: 1.01, lab: 1.03, tax: 0.0838 },
  "895": { label: "Reno, NV", state: "NV", mat: 1.0, lab: 1.0, tax: 0.0827 },
  "841": { label: "Salt Lake City, UT", state: "UT", mat: 1.01, lab: 1.05, tax: 0.0775 },
  "840": { label: "Salt Lake / Provo, UT", state: "UT", mat: 1.0, lab: 1.02, tax: 0.0725 },
  "871": { label: "Albuquerque, NM", state: "NM", mat: 1.0, lab: 1.03, tax: 0.0775 },
  "875": { label: "Santa Fe, NM", state: "NM", mat: 1.01, lab: 1.05, tax: 0.0819 },
  "837": { label: "Boise, ID", state: "ID", mat: 1.0, lab: 1.05, tax: 0.06 },
  "995": { label: "Anchorage, AK", state: "AK", mat: 1.0, lab: 1.02, tax: 0 },
  "968": { label: "Honolulu, HI", state: "HI", mat: 1.0, lab: 1.02, tax: 0.045 },
  // Largest metro in each state that previously had NO ZIP3 row at all
  // — without these, Des Moines priced as rural Iowa and Omaha as rural
  // Nebraska. Multipliers stay relative to the state average.
  "061": { label: "Hartford, CT", state: "CT", mat: 1.0, lab: 1.03, tax: 0.0635 },
  "198": { label: "Wilmington, DE", state: "DE", mat: 1.0, lab: 1.03, tax: 0 },
  "503": { label: "Des Moines, IA", state: "IA", mat: 1.0, lab: 1.06, tax: 0.0694 },
  "672": { label: "Wichita, KS", state: "KS", mat: 1.0, lab: 1.03, tax: 0.075 },
  "041": { label: "Portland, ME", state: "ME", mat: 1.0, lab: 1.07, tax: 0.055 },
  "392": { label: "Jackson, MS", state: "MS", mat: 1.0, lab: 1.05, tax: 0.08 },
  "591": { label: "Billings, MT", state: "MT", mat: 1.0, lab: 1.04, tax: 0 },
  "581": { label: "Fargo, ND", state: "ND", mat: 1.0, lab: 1.05, tax: 0.0755 },
  "681": { label: "Omaha, NE", state: "NE", mat: 1.0, lab: 1.06, tax: 0.07 },
  "031": { label: "Manchester, NH", state: "NH", mat: 1.0, lab: 1.05, tax: 0 },
  "029": { label: "Providence, RI", state: "RI", mat: 1.0, lab: 1.03, tax: 0.07 },
  "571": { label: "Sioux Falls, SD", state: "SD", mat: 1.0, lab: 1.05, tax: 0.062 },
  "054": { label: "Burlington, VT", state: "VT", mat: 1.0, lab: 1.05, tax: 0.0703 },
  "253": { label: "Charleston, WV", state: "WV", mat: 1.0, lab: 1.04, tax: 0.07 },
  "820": { label: "Cheyenne, WY", state: "WY", mat: 1.0, lab: 1.03, tax: 0.06 },
};

/* ------------------------------------------------------------------ */
/*  Resolved market snapshot                                           */
/* ------------------------------------------------------------------ */

/**
 * A market resolved for one job, FROZEN at estimate time.
 *
 * This is what rides along on the estimate config and into the saved
 * proposal JSON. It is fully self-contained — no lookups at render
 * time — so a proposal sent in July still prices exactly the same in
 * December after this table has been revised. That is deliberate: a
 * quote the homeowner already saw must never move on its own.
 */
export type MarketSnapshot = {
  version: string;
  /** Two-letter state, "" when it could not be determined. */
  state: string;
  zip: string | null;
  /** Human label for the market: "Austin, TX" / "Texas" / "U.S. average". */
  label: string;
  /** Material multiplier per commodity basis (all four carried so a
   *  mixed-type job re-prices every section correctly). */
  material: Record<MarketBasis, number>;
  /** Labor multiplier. */
  labor: number;
  salesTaxRate: number;
  /** True where install labor is itself taxable (AZ/CT/HI/NM/SD/WV). */
  laborTaxable: boolean;
  /** Code frost depth for this market, inches — drives post burial and
   *  concrete volume in the takeoff. Absent on snapshots frozen before
   *  this field existed; treat as the national default then. */
  frostIn?: number;
  /** Which layers actually fired. */
  resolution: "zip" | "state" | "national";
  /** Plain-English provenance, shown under the price in the UI. */
  basis: string[];
};

/** The no-information fallback: the catalog's own national rates. */
export const NATIONAL_MARKET: MarketSnapshot = {
  version: MARKET_TABLE_VERSION,
  state: "",
  zip: null,
  label: "U.S. average",
  material: { cedar: 1, pine: 1, vinyl: 1, metal: 1 },
  labor: 1,
  salesTaxRate: 0.0825,
  laborTaxable: false,
  frostIn: 24,
  resolution: "national",
  basis: ["No state or ZIP resolved — national average rates."],
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${n >= 1 ? "+" : "−"}${Math.abs(Math.round((n - 1) * 1000) / 10)}%`;

/**
 * Pull a state + ZIP out of a formatted address string. Used when the
 * geocoder's structured components are unavailable (a saved proposal
 * carries only the formatted address). Matches the tail of a US
 * address: "… Austin, TX 78701, USA".
 */
export function parseStateZip(address: string | null | undefined): {
  state: string | null;
  zip: string | null;
} {
  if (!address) return { state: null, zip: null };
  // Case-insensitive: "austin, tx 78701" from a hand-typed address is
  // the same market as the geocoder's "Austin, TX 78701".
  const addr = address.toUpperCase();
  const m = addr.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  if (m && STATE_MARKETS[m[1]]) return { state: m[1], zip: m[2] };
  // ZIP with no usable state (or a two-letter token that isn't a state).
  const zipOnly = addr.match(/\b(\d{5})(?:-\d{4})?\b/);
  const stateOnly = addr.match(/,\s*([A-Z]{2})\b/);
  return {
    state: stateOnly && STATE_MARKETS[stateOnly[1]] ? stateOnly[1] : null,
    zip: zipOnly ? zipOnly[1] : null,
  };
}

/**
 * Resolve a market from a state and/or ZIP.
 *
 * Precedence: ZIP3 metro → state average → national. A ZIP whose first
 * three digits are in ZIP3_MARKETS also SUPPLIES the state when none
 * was passed, so a bare ZIP still lands in the right market.
 */
export function resolveMarket(input: {
  state?: string | null;
  zip?: string | null;
  /** Free-text address to parse when state/zip weren't supplied. */
  address?: string | null;
}): MarketSnapshot {
  let state = (input.state ?? "").trim().toUpperCase();
  let zip = (input.zip ?? "").trim().slice(0, 5) || null;
  if (!state || !zip) {
    const parsed = parseStateZip(input.address);
    state = state || (parsed.state ?? "");
    zip = zip || parsed.zip;
  }

  const zip3 = zip && /^\d{3}/.test(zip) ? zip.slice(0, 3) : null;
  const metro = zip3 ? ZIP3_MARKETS[zip3] : undefined;
  // A metro row knows its own state — trust it over a missing or
  // conflicting state (the ZIP is the more specific signal).
  if (metro) state = metro.state;

  const row = STATE_MARKETS[state];
  if (!row) {
    return zip
      ? {
          ...NATIONAL_MARKET,
          zip,
          basis: [
            `ZIP ${zip} didn't resolve to a known state — national average rates.`,
          ],
        }
      : NATIONAL_MARKET;
  }

  const region = BASIS_REGIONS[row.region];
  const matAdj = metro?.mat ?? 1;
  const labAdj = metro?.lab ?? 1;

  const material: Record<MarketBasis, number> = {
    cedar: round3(row.mat * region.cedar * matAdj),
    pine: round3(row.mat * region.pine * matAdj),
    vinyl: round3(row.mat * region.vinyl * matAdj),
    metal: round3(row.mat * region.metal * matAdj),
  };
  const labor = round3(row.lab * labAdj);
  const salesTaxRate = metro?.tax ?? row.tax;

  const basis: string[] = [];
  basis.push(
    metro
      ? `${metro.label} — metro rates, ${pct(labAdj)} labor vs the ${row.name} average.`
      : `${row.name} state average${zip ? ` (ZIP ${zip} has no separate metro calibration)` : ""}.`,
  );
  basis.push(
    `Labor ${pct(labor)} vs national — BLS construction/fence-erector wages for ${row.name}.`,
  );
  basis.push(
    `Material: cedar ${pct(material.cedar)}, treated pine ${pct(material.pine)}, vinyl ${pct(material.vinyl)}, metal ${pct(material.metal)} — freight index × ${row.region} lumber basis.`,
  );
  basis.push(
    row.laborTax
      ? `Sales tax ${(salesTaxRate * 100).toFixed(2)}% on the FULL contract — ${row.name} taxes installation labor.`
      : `Sales tax ${(salesTaxRate * 100).toFixed(2)}% on materials only — ${row.name} doesn't tax labor on real-property improvements.`,
  );

  return {
    version: MARKET_TABLE_VERSION,
    state,
    zip,
    label: metro?.label ?? row.name,
    material,
    labor,
    salesTaxRate,
    laborTaxable: row.laborTax === true,
    frostIn: row.frost,
    resolution: metro ? "zip" : "state",
    basis,
  };
}

/** Frost depth for a snapshot, inches — old snapshots predate the
 *  field and fall back to the national default. */
export function marketFrostIn(market: MarketSnapshot | undefined): number {
  return market?.frostIn ?? NATIONAL_MARKET.frostIn ?? 24;
}

/* ------------------------------------------------------------------ */
/*  Applying a snapshot to prices                                      */
/* ------------------------------------------------------------------ */

/** Material multiplier for one fence type in this market. */
export function materialFactor(
  market: MarketSnapshot | undefined,
  type: FenceTypeId | string,
): number {
  if (!market) return 1;
  const basis = BASIS_BY_TYPE[type as FenceTypeId] ?? "pine";
  return market.material[basis] ?? 1;
}

/** Labor multiplier in this market. */
export function laborFactor(market: MarketSnapshot | undefined): number {
  return market?.labor ?? 1;
}

/**
 * Blended multiplier for a line that is part material, part labor —
 * a hung gate is roughly 65% hardware and 35% hanging time, a stain
 * job is the reverse. `matShare` is the material fraction of that
 * line's cost.
 */
export function blendedFactor(
  market: MarketSnapshot | undefined,
  type: FenceTypeId | string,
  matShare: number,
): number {
  if (!market) return 1;
  const s = Math.min(1, Math.max(0, matShare));
  return materialFactor(market, type) * s + laborFactor(market) * (1 - s);
}

/**
 * Cost split assumed for each blended BOM line — how much of that
 * line is bought vs. how much is worked. Documented here rather than
 * scattered through the pricing code so the assumptions are auditable.
 */
export const LINE_MATERIAL_SHARE = {
  /** Gate kit + heavy posts vs. hanging, squaring and latching. */
  gate: 0.65,
  /** Slope steps are almost all trim/set time. */
  step: 0.3,
  /** Core-drill anchors: hardware is cheap, drilling time isn't. */
  wallMount: 0.35,
  /** Stain: two coats of product vs. the day it takes to brush it. */
  stain: 0.35,
  /** Tear-out is labor and dump fees — no material at all. */
  removal: 0,
  /** Post upgrade is a pure material swap; the hole is dug either way. */
  postUpgrade: 1,
} as const;
