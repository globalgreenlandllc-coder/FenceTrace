/**
 * The demo property's numbers, computed once, in one place.
 *
 * 1425 Maple Ave appears all over the landing page — the hero narrative,
 * the animated house scene, the engine spec table, and the five-act
 * walkthrough. They must all quote the SAME job, or the page contradicts
 * itself on the very claim it is making ("every number is computed, not
 * typed in"). So the figures live here, straight out of the real
 * takeoff and pricing engines, and every landing component reads them.
 *
 * Pure synchronous math over constants — safe to evaluate at module load
 * in a client bundle, and it re-derives itself if the catalog changes.
 */
import { fenceType } from "@/lib/fence/catalog";
import {
  computeFenceTakeoff,
  type FenceLayoutInput,
} from "@/lib/fence/takeoff";
import { fenceTiers, priceFence } from "@/lib/fence/pricing";
import {
  CORNERS,
  ENDS,
  FENCE_HEIGHT_FT,
  FENCE_TYPE_ID,
  GATES,
  TOTAL_LF,
} from "./demo-property";

export const DEMO_LAYOUT: FenceLayoutInput = {
  type: FENCE_TYPE_ID,
  heightFt: FENCE_HEIGHT_FT,
  totalLf: TOTAL_LF,
  runLengths: [TOTAL_LF],
  corners: CORNERS,
  ends: ENDS,
  gatesSingle: GATES.filter((g) => g.kind === "single").length,
  gatesDouble: GATES.filter((g) => g.kind === "double").length,
  terrain: "flat",
  wastePct: 10,
};

export const DEMO_TYPE = fenceType(FENCE_TYPE_ID);
export const DEMO_TAKEOFF = computeFenceTakeoff(DEMO_LAYOUT);

export const DEMO_TIERS = fenceTiers(FENCE_TYPE_ID).map((t) => ({
  ...t,
  spec: fenceType(t.type),
  price: priceFence(
    { ...DEMO_LAYOUT, type: t.type, stain: t.stain },
    { markupPct: t.markupPct },
  ),
}));

/** The package the demo's client signs — the headline price. */
export const DEMO_CHOSEN =
  DEMO_TIERS.find((t) => t.recommended) ?? DEMO_TIERS[1];

/** Fence fabric actually installed, gate openings removed. */
export const DEMO_NET_LF = DEMO_TAKEOFF.netFenceLf;
export const DEMO_TOTAL = DEMO_CHOSEN.price.total;
export const DEMO_PER_LF = DEMO_CHOSEN.price.pricePerLf;
export const DEMO_GATE_COUNT = GATES.length;

const bom = (re: RegExp) =>
  DEMO_TAKEOFF.bom.find((b) => re.test(b.label))?.qty ?? 0;
export const DEMO_PICKETS = bom(/picket|board/i);
export const DEMO_CONCRETE_BAGS = bom(/concrete/i);
export const DEMO_RAILS = bom(/^rails/i);

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
