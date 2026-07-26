/**
 * FenceTrace fence catalog — every fence family the estimator, designer,
 * takeoff, and pricing understand. Pure data + lookups, no imports.
 *
 * Geometry model used across the app:
 *  - a fence LAYOUT is a set of runs (polylines) with corners where a run
 *    bends, ends where it stops, and gates placed on runs;
 *  - POSTS: line posts every `postSpacingFt`, plus one at every corner,
 *    end, and both sides of every gate;
 *  - wood fences are stick-built (rails + pickets); vinyl/aluminum/steel
 *    come as prefab PANELS per section; chain-link is mesh + framework.
 */

export type FenceCategory =
  | "wood"
  | "vinyl"
  | "chain-link"
  | "aluminum"
  | "steel"
  | "split-rail";

export type FenceTypeId =
  | "cedar-privacy"
  | "pt-pine-privacy"
  | "board-on-board"
  | "shadowbox"
  | "wood-picket"
  | "horizontal-modern"
  | "vinyl-privacy"
  | "vinyl-picket"
  | "chain-link-galv"
  | "chain-link-black"
  | "aluminum-ornamental"
  | "steel-ornamental"
  | "split-rail-2"
  | "ranch-rail-3";

export type FenceType = {
  id: FenceTypeId;
  label: string;
  category: FenceCategory;
  /** Short sales blurb shown in pickers and proposals. */
  blurb: string;
  /** Offered heights in feet (gates follow the fence height). */
  heightsFt: number[];
  defaultHeightFt: number;
  /** Center-to-center line-post spacing. */
  postSpacingFt: number;
  /** Stick-built (rails+pickets) vs prefab panels vs chain-link mesh. */
  build: "stick" | "panel" | "mesh" | "rail";
  /** Horizontal rails per section by height (stick/rail builds). */
  railsPerSection: (heightFt: number) => number;
  /** Picket face width + gap, inches (stick builds; gap 0 = privacy). */
  picketWidthIn?: number;
  picketGapIn?: number;
  /** Material cost per linear foot at defaultHeightFt (posts, rails,
   *  pickets/panels/mesh, hardware averaged in). Height scales it. */
  materialPerLf: number;
  /** Install labor per linear foot on flat ground. */
  laborPerLf: number;
  /** Single walk gate (4 ft) installed price; double drive gate ≈ 2.4×. */
  gateSingle: number;
  /** Can it be stained/sealed? (wood only) */
  stainable: boolean;
};

const rails2Under5 = (h: number) => (h <= 4 ? 2 : h <= 6 ? 3 : 4);

export const FENCE_TYPES: FenceType[] = [
  {
    id: "cedar-privacy",
    label: "Cedar privacy",
    category: "wood",
    blurb: "Western red cedar, solid 6' privacy — the neighborhood standard.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 0,
    materialPerLf: 22,
    laborPerLf: 14,
    gateSingle: 385,
    stainable: true,
  },
  {
    id: "pt-pine-privacy",
    label: "Pressure-treated privacy",
    category: "wood",
    blurb: "Budget-friendly treated pine privacy, paint or stain ready.",
    heightsFt: [4, 6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 0,
    materialPerLf: 16,
    laborPerLf: 13,
    gateSingle: 325,
    stainable: true,
  },
  {
    id: "board-on-board",
    label: "Board-on-board",
    category: "wood",
    blurb: "Overlapped pickets — full privacy with no gaps as wood dries.",
    heightsFt: [6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: -1.25, // overlap
    materialPerLf: 28,
    laborPerLf: 16,
    gateSingle: 445,
    stainable: true,
  },
  {
    id: "shadowbox",
    label: "Shadowbox",
    category: "wood",
    blurb: "Alternating pickets both sides — good-neighbor, airflow friendly.",
    heightsFt: [6, 8],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: rails2Under5,
    picketWidthIn: 5.5,
    picketGapIn: 2.5, // per face; both faces interleave
    materialPerLf: 26,
    laborPerLf: 15,
    gateSingle: 425,
    stainable: true,
  },
  {
    id: "wood-picket",
    label: "Classic wood picket",
    category: "wood",
    blurb: "3–4' spaced pickets for curb appeal and pets.",
    heightsFt: [3, 4],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "stick",
    railsPerSection: () => 2,
    picketWidthIn: 3.5,
    picketGapIn: 2.5,
    materialPerLf: 14,
    laborPerLf: 11,
    gateSingle: 285,
    stainable: true,
  },
  {
    id: "horizontal-modern",
    label: "Horizontal modern",
    category: "wood",
    blurb: "Clean horizontal cedar slats — the modern architectural look.",
    heightsFt: [4, 6],
    defaultHeightFt: 6,
    postSpacingFt: 6, // tighter to keep long boards straight
    build: "stick",
    railsPerSection: () => 0, // boards ARE the horizontal members
    picketWidthIn: 5.5,
    picketGapIn: 0.75,
    materialPerLf: 34,
    laborPerLf: 19,
    gateSingle: 545,
    stainable: true,
  },
  {
    id: "vinyl-privacy",
    label: "Vinyl privacy",
    category: "vinyl",
    blurb: "Zero-maintenance PVC panels — never paint again.",
    heightsFt: [4, 6],
    defaultHeightFt: 6,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 30,
    laborPerLf: 13,
    gateSingle: 465,
    stainable: false,
  },
  {
    id: "vinyl-picket",
    label: "Vinyl picket",
    category: "vinyl",
    blurb: "The white-picket look in maintenance-free PVC.",
    heightsFt: [3, 4],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 24,
    laborPerLf: 11,
    gateSingle: 395,
    stainable: false,
  },
  {
    id: "chain-link-galv",
    label: "Chain link (galvanized)",
    category: "chain-link",
    blurb: "The workhorse — decades of service at the lowest cost per foot.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 4,
    postSpacingFt: 10,
    build: "mesh",
    railsPerSection: () => 1, // top rail
    materialPerLf: 9,
    laborPerLf: 8,
    gateSingle: 265,
    stainable: false,
  },
  {
    id: "chain-link-black",
    label: "Chain link (black vinyl)",
    category: "chain-link",
    blurb: "Black vinyl-coated mesh that disappears into the landscape.",
    heightsFt: [4, 5, 6],
    defaultHeightFt: 4,
    postSpacingFt: 10,
    build: "mesh",
    railsPerSection: () => 1,
    materialPerLf: 12,
    laborPerLf: 8.5,
    gateSingle: 295,
    stainable: false,
  },
  {
    id: "aluminum-ornamental",
    label: "Aluminum ornamental",
    category: "aluminum",
    blurb: "Wrought-iron look, no rust — pools, front yards, HOAs.",
    heightsFt: [4, 5, 6],
    defaultHeightFt: 4.5,
    postSpacingFt: 6,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 32,
    laborPerLf: 12,
    gateSingle: 495,
    stainable: false,
  },
  {
    id: "steel-ornamental",
    label: "Steel ornamental",
    category: "steel",
    blurb: "Heavy-gauge security and estate fencing.",
    heightsFt: [4, 5, 6, 8],
    defaultHeightFt: 5,
    postSpacingFt: 8,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 42,
    laborPerLf: 15,
    gateSingle: 645,
    stainable: false,
  },
  {
    id: "split-rail-2",
    label: "Split rail (2-rail)",
    category: "split-rail",
    blurb: "Rustic property-line marking for acreage.",
    heightsFt: [3],
    defaultHeightFt: 3,
    postSpacingFt: 10,
    build: "rail",
    railsPerSection: () => 2,
    materialPerLf: 11,
    laborPerLf: 7,
    gateSingle: 315,
    stainable: true,
  },
  {
    id: "ranch-rail-3",
    label: "Ranch rail (3-rail)",
    category: "split-rail",
    blurb: "Board ranch fencing for horses and farms.",
    heightsFt: [4, 5],
    defaultHeightFt: 4.5,
    postSpacingFt: 8,
    build: "rail",
    railsPerSection: () => 3,
    materialPerLf: 15,
    laborPerLf: 9,
    gateSingle: 365,
    stainable: true,
  },
];

export const FENCE_TYPE_BY_ID: Record<FenceTypeId, FenceType> =
  Object.fromEntries(FENCE_TYPES.map((t) => [t.id, t])) as Record<
    FenceTypeId,
    FenceType
  >;

export function fenceType(id: FenceTypeId): FenceType {
  return FENCE_TYPE_BY_ID[id] ?? FENCE_TYPES[0];
}

/** Height multiplier on per-LF material/labor: catalog prices are at the
 *  default height; taller sections use more board-feet roughly linearly. */
export function heightFactor(t: FenceType, heightFt: number): number {
  const h = t.heightsFt.includes(heightFt) ? heightFt : t.defaultHeightFt;
  return Math.max(0.6, h / t.defaultHeightFt);
}

export type Terrain = "flat" | "sloped" | "steep" | "rocky";

/** Labor multiplier by ground difficulty (digging + racking sections). */
export const TERRAIN_FACTOR: Record<Terrain, number> = {
  flat: 1,
  sloped: 1.18,
  steep: 1.4,
  rocky: 1.55,
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  flat: "Flat yard",
  sloped: "Gentle slope",
  steep: "Steep slope",
  rocky: "Rocky / hard dig",
};
