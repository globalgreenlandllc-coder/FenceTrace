import type { MarketSnapshot } from "./fence/market";

export type GutterStyle = "k-style" | "half-round";
export type GutterSize = "5" | "6" | "7";
export type GutterMaterial = "aluminum" | "copper" | "steel";

export type DownspoutSize = "2x3" | "3x4" | "round-3" | "round-4";

export type LineEdgeKind = "eave" | "rake";

/** Which roof the eave sits on. "upper" = the main 2-story body roof
 *  (~20 ft drop); "lower" = a single-story projection — front porch,
 *  rear covered patio, or a 1-story garage (~10 ft drop). Drives the
 *  canvas tier color + label so the contractor can see at a glance which
 *  gutter is up high vs. down low. */
export type EaveTier = "lower" | "upper" | "unknown";
export type EaveSide = "front" | "back" | "left" | "right" | "interior";

export type EditableLine = {
  id: string;
  kind: LineEdgeKind;
  points: { x: number; y: number }[];
  /** Roof tier this run sits on (from the plan analysis). Optional —
   *  manually drawn lines and satellite-derived eaves don't carry it. */
  tier?: EaveTier;
  /** Building side this run faces (front/back/left/right). Used to mark
   *  the front of the house on the canvas. */
  side?: EaveSide;
  /** What structure this eave belongs to, read from the plans (porch /
   *  patio / deck / entry / garage / dormer / main). Lets the layout name
   *  covered projections instead of a generic "lower" line. Optional —
   *  manually drawn / satellite eaves and older analyses don't carry it. */
  feature?: EaveFeature;
};

/** Named structure an eave belongs to (from the plan analysis). */
export type EaveFeature =
  | "porch"
  | "patio"
  | "deck"
  | "entry"
  | "garage"
  | "dormer"
  | "main"
  | "unknown";

export type RoofStructureLineKind =
  | "ridge"
  | "valley"
  | "hip"
  | "gable"
  | "step";

export type RoofStructureLine = {
  id: string;
  kind: RoofStructureLineKind;
  /** Canvas-space (900×580 viewBox) endpoints. */
  points: { x: number; y: number }[];
  label?: string;
};

/**
 * Visual roof annotation — the white perimeter outline plus the dashed
 * ridge/valley lines that show where the roof's planes peak and where
 * they drain together. NOT used for measurements (eaves drive LF math)
 * — purely a recreational aid that helps the contractor read the roof.
 */
export type RoofStructure = {
  /** Closed perimeter polygon in canvas space. */
  perimeter: { x: number; y: number }[];
  ridges: RoofStructureLine[];
  valleys: RoofStructureLine[];
  /** Hip lines (sloped ridges at outside corners). Optional for
   *  back-compat with the satellite flow, which doesn't detect them. */
  hips?: RoofStructureLine[];
  /** Count of gable STRUCTURES (from the engine's per-face placement) so the
   *  legend reports "6 gables" instead of the rake-EDGE count. Absent on the
   *  satellite/AI-only path, where no structure count is available. */
  gableCount?: number;
  /** Gable-END base segments (kind "gable") from the v2 layout — the overlay
   *  uses them verbatim for GABLE labels and feeds them into the derived
   *  skeleton so faces flip hip→gable. label "verify" marks a frame-over
   *  gable recorded for review. Decorative, like every line here. */
  gables?: RoofStructureLine[];
  /** Roof PLANES (canvas space) tiling the perimeter — shaded by the
   *  overlay. `downhill` = unit direction the plane slopes down toward.
   *  Optional; absent on satellite/older stored takeoffs. */
  faces?: { polygon: { x: number; y: number }[]; downhill: { x: number; y: number } }[];
  /** Tier STEP edges (kind "step") — interior mass boundaries where one roof
   *  level drops to another (the engine's tier decomposition). Drawn as thin
   *  solid lines so multi-tier plans read as tiers, not bare outlines.
   *  `label` optionally names the mass/tier. Decorative, never priced.
   *  Optional; absent on satellite and pre-steps stored takeoffs. */
  steps?: RoofStructureLine[];
  /** 0–1, surfaces an "approximation only" warning when low. */
  confidence: number;
};

export type Downspout = {
  id: string;
  x: number;
  y: number;
  heightFt: number;
  /** FenceScan: downspouts carry gates. Kind + width let the proposal's
   *  3D preview draw the gate at its real size with a label; absent on
   *  gutter takeoffs and legacy fence drafts (treated as a 4' walk gate). */
  gateKind?: "single" | "double" | "custom";
  gateWidthFt?: number;
};

export type Stories = 1 | 2 | 3;

export const STORY_HEIGHT_FT: Record<Stories, number> = {
  1: 10,
  2: 20,
  3: 30,
};

export function storiesFromHeightFt(heightFt: number): Stories {
  if (heightFt <= 14) return 1;
  if (heightFt <= 24) return 2;
  return 3;
}

export type Measurements = {
  eaveLF: number;
  rakeLF: number;
  outsideCorners: number;
  insideCorners: number;
  endCaps: number;
  downspoutCount: number;
  stories: Stories;
  wasteFactorPct: number;
};

export type LineItem = {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxable: boolean;
};

/**
 * Optional add-on products / upgrades the contractor can tack on to
 * a base gutter system. Drive both the visual preview (the preview
 * component renders mesh on top of the gutter when guard.kind isn't
 * "none") and the line items (each enabled accessory adds a row to
 * buildLineItems).
 */
export type GutterAccessories = {
  /** Top-of-gutter leaf protection. */
  guard: "none" | "mesh" | "micro-mesh" | "screen";
  /** Aluminum drip-edge flashing — common upsell on new installs. */
  dripEdge: boolean;
  /** Decorative copper rain chain in place of a downspout (kept as
   *  separate flag; doesn't replace a downspout count, just adds it). */
  rainChain: boolean;
  /** Snow / ice guards along eaves in cold climates. */
  iceGuard: boolean;
  /** Heat tape kit to prevent ice damming. */
  heatTape: boolean;
};

/** FenceScan fence package config. `type` is a FenceTypeId from
 *  lib/fence/catalog (kept as string here so types.ts stays leaf-level).
 *  When a package carries `fence`, buildLineItems prices a FENCE and the
 *  legacy gutter fields above it are ignored; measurements.eaveLF carries
 *  the fence LF and downspoutCount the gate count. */
export type FenceEstimateConfig = {
  type: string;
  heightFt: number;
  terrain: "flat" | "sloped" | "steep" | "rocky";
  stain: boolean;
  removalLf: number;
  gatesSingle: number;
  gatesDouble: number;
  /** Custom-width gates (feet each) beyond the walk/drive presets. */
  gatesCustomWidthsFt?: number[];
  corners: number;
  ends: number;
  /** Sections stepping down a measured slope (terrain analysis). */
  steppedSections?: number;
  /** LF of fence mounted on top of a retaining wall — those posts are
   *  core-drilled + anchored to the wall cap instead of dug and set in
   *  concrete (mount hardware + drilling labor priced per post). */
  wallTopLf?: number;
  /** Post stock upgrade: galvanized-steel posts (rot-proof, wood fences)
   *  or heavy 6×6 pressure-treated posts. Absent = standard posts. */
  postUpgrade?: "steel" | "6x6";
  /** Mixed-type sections: stretches of the SAME layout built as a
   *  different fence (e.g. chain link across the back of a cedar job),
   *  grouped by type with the total LF per type. Their footage is
   *  carved OUT of the primary type's lines and priced at their own
   *  catalog rates. */
  mixed?: { type: string; lf: number }[];
  /** Local market calibration resolved from the property's state + ZIP
   *  (lib/fence/market.ts), FROZEN at estimate time. Catalog rates are
   *  national; this scales material and labor to what the job actually
   *  costs in that market and carries the local sales-tax rule.
   *  Absent = priced at national rates — every proposal saved before
   *  market pricing existed keeps the total it was sent with. */
  market?: MarketSnapshot;
};

export type EstimateConfig = {
  size: GutterSize;
  style: GutterStyle;
  material: GutterMaterial;
  color: string;
  downspoutSize: DownspoutSize;
  accessories?: GutterAccessories;
  /** Old-gutter tear-off on replacement jobs. "free" renders a $0 line
   *  with the real value shown ("$240 value — included free", the
   *  attract-the-client move); "priced" bills it per LF; "none" hides
   *  the line (new construction). undefined = legacy configs saved
   *  before this existed — treated as "none" so no already-sent
   *  proposal ever reprices itself. */
  oldGutterRemoval?: "free" | "priced" | "none";
  /** Present ⇒ this package prices a fence (FenceScan). */
  fence?: FenceEstimateConfig;
};
