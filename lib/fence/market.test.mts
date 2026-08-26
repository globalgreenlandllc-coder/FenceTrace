import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASIS_BY_TYPE,
  MARKET_TABLE_VERSION,
  NATIONAL_MARKET,
  STATE_MARKETS,
  ZIP3_MARKETS,
  blendedFactor,
  laborFactor,
  materialFactor,
  parseStateZip,
  resolveMarket,
} from "./market.ts";
import { FENCE_TYPES } from "./catalog.ts";
import { priceFence } from "./pricing.ts";
import { packageTotal, blankProposal } from "../proposal-mock.ts";
import { buildLineItems } from "../pricing.ts";

const CEDAR_100 = {
  type: "cedar-privacy" as const,
  heightFt: 6,
  totalLf: 104,
  corners: 2,
  ends: 2,
  gatesSingle: 1,
  gatesDouble: 0,
  terrain: "flat" as const,
  wastePct: 10,
};

/* ---------------- table integrity ---------------- */

test("state table covers 50 states + DC and every index is sane", () => {
  const keys = Object.keys(STATE_MARKETS);
  assert.equal(keys.length, 51);
  for (const [code, row] of Object.entries(STATE_MARKETS)) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.ok(row.mat >= 0.9 && row.mat <= 1.4, `${code} mat ${row.mat}`);
    assert.ok(row.lab >= 0.7 && row.lab <= 1.35, `${code} lab ${row.lab}`);
    assert.ok(row.tax >= 0 && row.tax < 0.12, `${code} tax ${row.tax}`);
  }
});

test("every ZIP3 row points at a real state and adjusts within ±25%", () => {
  for (const [prefix, row] of Object.entries(ZIP3_MARKETS)) {
    assert.match(prefix, /^\d{3}$/);
    assert.ok(STATE_MARKETS[row.state], `${prefix} → unknown state ${row.state}`);
    assert.ok(row.mat >= 0.85 && row.mat <= 1.25, `${prefix} mat ${row.mat}`);
    assert.ok(row.lab >= 0.8 && row.lab <= 1.25, `${prefix} lab ${row.lab}`);
    if (row.tax !== undefined)
      assert.ok(row.tax >= 0 && row.tax < 0.12, `${prefix} tax ${row.tax}`);
  }
});

test("every catalog fence type declares a commodity basis", () => {
  for (const t of FENCE_TYPES)
    assert.ok(BASIS_BY_TYPE[t.id], `${t.id} has no market basis`);
});

/* ---------------- resolution ---------------- */

test("ZIP beats state, and a bare ZIP supplies its own state", () => {
  const sf = resolveMarket({ zip: "94110" });
  assert.equal(sf.state, "CA");
  assert.equal(sf.resolution, "zip");
  assert.match(sf.label, /San Francisco/);

  const ca = resolveMarket({ state: "CA" });
  assert.equal(ca.resolution, "state");
  // Bay Area labor must land above the California average.
  assert.ok(sf.labor > ca.labor, `${sf.labor} vs ${ca.labor}`);
});

test("an uncalibrated ZIP falls back to its state average, not to national", () => {
  // 954xx (Santa Rosa) is not in ZIP3_MARKETS.
  const m = resolveMarket({ state: "CA", zip: "95401" });
  assert.equal(m.resolution, "state");
  assert.equal(m.zip, "95401");
  assert.equal(m.labor, STATE_MARKETS.CA.lab);
});

test("unknown / missing location falls back to national 1.00 rates", () => {
  const m = resolveMarket({});
  assert.deepEqual(m, NATIONAL_MARKET);
  assert.equal(m.labor, 1);
  assert.equal(materialFactor(m, "cedar-privacy"), 1);

  const foreign = resolveMarket({ state: "ZZ", address: "10 Downing St, London" });
  assert.equal(foreign.resolution, "national");
});

test("state + ZIP parse out of a formatted address string", () => {
  assert.deepEqual(parseStateZip("123 Oak St, Austin, TX 78701, USA"), {
    state: "TX",
    zip: "78701",
  });
  assert.deepEqual(parseStateZip("500 Main St, Miami, FL 33130-1234, USA"), {
    state: "FL",
    zip: "33130",
  });
  assert.deepEqual(parseStateZip(null), { state: null, zip: null });
  // A formatted address is enough on its own — the resolver reads it.
  assert.equal(resolveMarket({ address: "1 Congress Ave, Austin, TX 78701" }).label,
    "Austin, TX");
});

test("snapshots carry the table version and a readable basis", () => {
  const m = resolveMarket({ zip: "78701" });
  assert.equal(m.version, MARKET_TABLE_VERSION);
  assert.ok(m.basis.length >= 4);
  assert.ok(m.basis.some((b) => /labor/i.test(b)));
  assert.ok(m.basis.some((b) => /sales tax/i.test(b)));
});

/* ---------------- the commodity basis actually flips ---------------- */

test("cedar is cheaper in the PNW and dearer in the South; pine is the mirror", () => {
  const seattle = resolveMarket({ state: "WA" });
  const atlanta = resolveMarket({ state: "GA" });

  // Cedar comes off PNW mills.
  assert.ok(
    materialFactor(seattle, "cedar-privacy") <
      materialFactor(atlanta, "cedar-privacy"),
  );
  // Southern yellow pine is local to the Southeast.
  assert.ok(
    materialFactor(atlanta, "pt-pine-privacy") <
      materialFactor(seattle, "pt-pine-privacy"),
  );
  // Metal is a national commodity — it barely moves either way.
  const dm = Math.abs(
    materialFactor(seattle, "chain-link-galv") -
      materialFactor(atlanta, "chain-link-galv"),
  );
  assert.ok(dm < 0.08, `metal moved ${dm}`);
});

test("labor spread runs high-wage metro over low-wage rural, ~1.4x end to end", () => {
  const bay = laborFactor(resolveMarket({ zip: "94110" }));
  const ms = laborFactor(resolveMarket({ state: "MS" }));
  assert.ok(bay > 1.3, `bay ${bay}`);
  assert.ok(ms < 0.85, `ms ${ms}`);
  assert.ok(bay / ms > 1.5 && bay / ms < 2.0, `spread ${bay / ms}`);
});

test("blended factors sit between the material and labor factors", () => {
  const m = resolveMarket({ zip: "94110" });
  const mat = materialFactor(m, "cedar-privacy");
  const lab = laborFactor(m);
  const gate = blendedFactor(m, "cedar-privacy", 0.65);
  assert.ok(gate > Math.min(mat, lab) && gate < Math.max(mat, lab));
  assert.equal(blendedFactor(m, "cedar-privacy", 1), mat);
  assert.equal(blendedFactor(m, "cedar-privacy", 0), lab);
  // No market → everything is 1.
  assert.equal(blendedFactor(undefined, "cedar-privacy", 0.5), 1);
});

/* ---------------- it moves real money ---------------- */

test("the same fence prices materially higher in the Bay Area than in Mississippi", () => {
  const bay = priceFence({ ...CEDAR_100, market: resolveMarket({ zip: "94110" }) });
  const ms = priceFence({ ...CEDAR_100, market: resolveMarket({ state: "MS" }) });
  const national = priceFence(CEDAR_100);

  assert.ok(bay.total > national.total, `${bay.total} vs ${national.total}`);
  assert.ok(ms.total < national.total, `${ms.total} vs ${national.total}`);
  const ratio = bay.total / ms.total;
  assert.ok(ratio > 1.25 && ratio < 1.9, `ratio ${ratio}`);
  // Sanity on the headline number a contractor reads.
  assert.ok(bay.pricePerLf > ms.pricePerLf);
});

test("no market on the layout = the pre-market national price, unchanged", () => {
  const before = priceFence(CEDAR_100);
  assert.equal(before.market, undefined);
  assert.equal(before.taxRate, 0.0825);
  // Cedar 6' at $22 material + $14 labor, 10% waste, national.
  const mat = before.lines.find((l) => l.key === "fence-materials")!;
  assert.equal(mat.amount, Math.round(100 * 22 * 1.1 * 100) / 100);
  const lab = before.lines.find((l) => l.key === "fence-labor")!;
  assert.equal(lab.amount, 100 * 14);
});

test("labor-taxing states tax the whole contract, not just materials", () => {
  const az = resolveMarket({ state: "AZ" });
  assert.equal(az.laborTaxable, true);
  const priced = priceFence({ ...CEDAR_100, market: az });
  // Whole-contract tax → tax ≈ rate × (afterMarkup − discount).
  const expected = (priced.subtotal + priced.markup) * az.salesTaxRate;
  assert.ok(Math.abs(priced.tax - expected) < 0.05, `${priced.tax} vs ${expected}`);

  // Texas doesn't tax residential install labor — the share is < 1.
  const tx = resolveMarket({ zip: "78701" });
  assert.equal(tx.laborTaxable, false);
  const txPriced = priceFence({ ...CEDAR_100, market: tx });
  assert.ok(txPriced.tax < (txPriced.subtotal + txPriced.markup) * tx.salesTaxRate);
});

test("no-sales-tax states charge no tax", () => {
  for (const state of ["OR", "MT", "NH", "DE"]) {
    const p = priceFence({ ...CEDAR_100, market: resolveMarket({ state }) });
    assert.equal(p.tax, 0, `${state} charged ${p.tax}`);
  }
});

test("a mixed section prices on ITS OWN commodity, not the primary type's", () => {
  // Chain link across the back of a cedar job in Atlanta: cedar carries
  // a freight penalty there, steel does not.
  const atl = resolveMarket({ state: "GA" });
  const priced = priceFence({
    ...CEDAR_100,
    totalLf: 154,
    market: atl,
    mixed: [{ type: "chain-link-galv", lf: 50 }],
  });
  const mixedLine = priced.lines.find((l) => l.key === "fence-mixed-chain-link-galv")!;
  // The section builds at the PRIMARY fence's height (6' on chain link,
  // default 4' → 1.5× height factor), at its own commodity's factor.
  const expected =
    Math.round(9 * 1.5 * 1.1 * materialFactor(atl, "chain-link-galv") * 100) /
    100;
  assert.equal(Math.round((mixedLine.amount / 50) * 100) / 100, expected);
});

/* ---------------- estimator ↔ proposal parity ---------------- */

test("market pricing keeps the estimator rail and the saved proposal in lockstep", () => {
  const market = resolveMarket({ zip: "94110" });
  const layout = { ...CEDAR_100, market };
  const rail = priceFence(layout, { markupPct: 35 });

  const base = blankProposal();
  const pkg = {
    ...base.packages[0],
    markupPct: 35,
    addOns: [],
    config: {
      ...base.packages[0].config,
      fence: {
        type: "cedar-privacy",
        heightFt: 6,
        terrain: "flat" as const,
        stain: false,
        removalLf: 0,
        gatesSingle: 1,
        gatesDouble: 0,
        gatesCustomWidthsFt: [],
        corners: 2,
        ends: 2,
        market,
      },
    },
  };
  const measurements = {
    eaveLF: 100,
    rakeLF: 0,
    outsideCorners: 2,
    insideCorners: 0,
    endCaps: 2,
    downspoutCount: 1,
    stories: 1 as const,
    wasteFactorPct: 10,
  };
  const total = packageTotal(pkg as any, measurements as any, 0);
  assert.ok(
    Math.abs(total.total - rail.total) < 0.05,
    `rail ${rail.total} vs proposal ${total.total}`,
  );
  assert.ok(Math.abs(total.tax - rail.tax) < 0.05);

  // And the BOM the materials builder renders carries the same rates.
  const bom = buildLineItems(measurements as any, pkg.config as any);
  const bomMat = bom.find((l) => l.id === "fence-materials")!;
  const railMat = rail.lines.find((l) => l.key === "fence-materials")!;
  assert.equal(
    Math.round(bomMat.quantity * bomMat.unitPrice * 100) / 100,
    railMat.amount,
  );
});
