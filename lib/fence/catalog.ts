/**
 * FenceScan fence catalog — every fence family the estimator, designer,
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

/**
 * Post / rail / infill stock as it is actually bought and set in the
 * field. This is what keeps the 3D view honest: chain link gets round
 * galvanized pipe with loop caps carrying a top rail, vinyl gets routed
 * 5×5 PVC posts with a cap standing proud of the panel, split rail gets
 * a mortised cedar post tamped into gravel — and none of them borrow
 * another system's hardware. Also drives BOM wording and the proposal
 * spec sheet, so the render and the material list can't drift apart.
 */
export type BuildSpec = {
  /** A LINE post, in the contractor's own words. */
  postMaterial: string;
  /** Line-post face width / outside diameter in INCHES, actual — a
   *  "4×4" is 3.5", a residential chain-link line post is 1.625" OD. */
  postWidthIn: number;
  /** Corner / end / gate posts: heavier stock on nearly every system. */
  terminalWidthIn: number;
  postProfile: "square" | "round";
  /** Loop caps carry a chain-link top rail; split rail is capped with
   *  nothing at all. */
  postCap: "flat" | "pyramid" | "gothic" | "dome" | "loop" | "none";
  /** How far the post top stands above the infill top, inches. 0 means
   *  the post dies into the top rail — chain-link line posts. */
  postProudIn: number;
  /** Concrete footing, or tamped earth + gravel (split rail)? */
  setInConcrete: boolean;
  railMaterial: string;
  infillMaterial: string;
  /** Center-to-center pitch of pickets / boards / bars, inches — the
   *  number the 3D view counts boards from. Omitted for mesh. */
  infillPitchIn?: number;
  /** Chain-link diamond size, inches. */
  meshDiamondIn?: number;
};

export type FenceType = {
  id: FenceTypeId;
  label: string;
  category: FenceCategory;
  /** How this fence is actually built — see BuildSpec. */
  spec: BuildSpec;
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
    spec: {
      // Even on a cedar fence the POSTS are pressure-treated pine: cedar
      // in ground contact is the first thing to rot out.
      postMaterial: "4×4 pressure-treated pine post (cedar on request)",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5, // 4×6 at gates and corners
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 western red cedar pickets",
      infillPitchIn: 5.5,
    },
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
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 pressure-treated rails",
      infillMaterial: "1×6 pressure-treated pine pickets",
      infillPitchIn: 5.5,
    },
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
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 cedar pickets, 1¼″ lapped over the under-course",
      infillPitchIn: 4.25, // 5.5" board less the 1.25" lap
    },
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
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×6 cedar pickets, alternating faces",
      infillPitchIn: 8, // per face: 5.5" board + 2.5" gap
    },
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
    spec: {
      postMaterial: "4×4 pressure-treated pine post",
      postWidthIn: 3.5,
      terminalWidthIn: 3.5,
      postProfile: "square",
      postCap: "pyramid",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "2×4 cedar rails",
      infillMaterial: "1×4 cedar pickets, dog-eared",
      infillPitchIn: 6, // 3.5" picket + 2.5" gap
    },
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
    spec: {
      // Horizontal boards load the posts harder and show every bow, so
      // this build steps up to 6×6 and tightens the bays to 6'.
      postMaterial: "6×6 pressure-treated post",
      postWidthIn: 5.5,
      terminalWidthIn: 5.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 0, // slats run flush to the post top — the modern look
      setInConcrete: true,
      railMaterial: "none — the slats span post to post",
      infillMaterial: "1×6 cedar slats, ¾″ reveal",
      infillPitchIn: 6.25, // 5.5" board + 0.75" gap, stacked vertically
    },
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
    spec: {
      // Vinyl runs on VINYL posts — 5×5 hollow PVC, routed so the rails
      // slide through the post rather than hanging off brackets. Gate and
      // corner posts get an aluminum stiffener inside.
      postMaterial: "5×5 vinyl post, routed, aluminum-stiffened at gates",
      postWidthIn: 5,
      terminalWidthIn: 5,
      postProfile: "square",
      postCap: "pyramid", // New England cap
      postProudIn: 3, // cap stands proud of the panel — the vinyl tell
      setInConcrete: true,
      railMaterial: "vinyl rails, aluminum-reinforced bottom rail",
      infillMaterial: "tongue-and-groove vinyl privacy boards",
      infillPitchIn: 6,
    },
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
    spec: {
      postMaterial: "4×4 vinyl post, routed",
      postWidthIn: 4,
      terminalWidthIn: 4,
      postProfile: "square",
      postCap: "gothic",
      postProudIn: 3,
      setInConcrete: true,
      railMaterial: "routed vinyl rails",
      infillMaterial: "vinyl pickets, gothic top",
      infillPitchIn: 6, // 3" picket + 3" gap
    },
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
    spec: {
      // Wire fence rides on METAL: round galvanized steel pipe, never
      // wood or vinyl. Line posts are visibly thinner than the terminals
      // that take the fabric tension.
      postMaterial: "1⅝″ OD galvanized steel pipe (2⅜″ terminals)",
      postWidthIn: 1.625,
      terminalWidthIn: 2.375,
      postProfile: "round",
      postCap: "loop", // the top rail threads through the line-post caps
      postProudIn: 0, // line posts die into the top rail
      setInConcrete: true,
      railMaterial: "1⅜″ OD galvanized top rail + 7-ga bottom tension wire",
      infillMaterial: "11-ga galvanized steel fabric, 2″ diamond mesh",
      meshDiamondIn: 2,
    },
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
    spec: {
      postMaterial: "1⅝″ OD black polymer-coated steel pipe (2⅜″ terminals)",
      postWidthIn: 1.625,
      terminalWidthIn: 2.375,
      postProfile: "round",
      postCap: "loop",
      postProudIn: 0,
      setInConcrete: true,
      railMaterial: "1⅜″ OD black top rail + bottom tension wire",
      infillMaterial: "9-ga black polymer-coated fabric, 2″ diamond mesh",
      meshDiamondIn: 2,
    },
  },
  {
    id: "aluminum-ornamental",
    label: "Aluminum ornamental",
    category: "aluminum",
    blurb: "Wrought-iron look, no rust — pools, front yards, HOAs.",
    heightsFt: [4, 5, 6],
    defaultHeightFt: 4,
    postSpacingFt: 6,
    build: "panel",
    railsPerSection: () => 2,
    materialPerLf: 32,
    laborPerLf: 12,
    gateSingle: 495,
    stainable: false,
    spec: {
      postMaterial: "2″ powder-coated aluminum post",
      postWidthIn: 2,
      terminalWidthIn: 2.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "1″ aluminum channel rails",
      infillMaterial: "¾″ square aluminum pickets",
      // Pool code wants under 4" clear between pickets — 3⅞" clear on a
      // ¾" picket lands at 4.6" on center.
      infillPitchIn: 4.6,
    },
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
    spec: {
      postMaterial: "2½″ galvanized + powder-coated steel post",
      postWidthIn: 2.5,
      terminalWidthIn: 3,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 2,
      setInConcrete: true,
      railMaterial: "1¼″ steel channel rails",
      infillMaterial: "1″ square steel pickets",
      infillPitchIn: 4.75,
    },
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
    spec: {
      // Split rail is the one system that does NOT get concrete: the
      // posts are mortised, dropped in and tamped with gravel so the
      // rails can be re-seated as the ground moves.
      postMaterial: "mortised cedar post, tamped gravel backfill",
      postWidthIn: 5,
      terminalWidthIn: 5,
      postProfile: "round",
      postCap: "none",
      postProudIn: 8, // the post stands well above the top rail
      setInConcrete: false,
      railMaterial: "split cedar rails, tapered into the post mortises",
      infillMaterial: "open — 2 rails, no infill",
    },
  },
  {
    id: "ranch-rail-3",
    label: "Ranch rail (3-rail)",
    category: "split-rail",
    blurb: "Board ranch fencing for horses and farms.",
    heightsFt: [4, 5],
    defaultHeightFt: 4,
    postSpacingFt: 8,
    build: "rail",
    railsPerSection: () => 3,
    materialPerLf: 15,
    laborPerLf: 9,
    gateSingle: 365,
    stainable: true,
    spec: {
      postMaterial: "4×4 pressure-treated post",
      postWidthIn: 3.5,
      terminalWidthIn: 3.5,
      postProfile: "square",
      postCap: "flat",
      postProudIn: 6,
      setInConcrete: true,
      // Ranch rail is face-nailed board, not mortised split rail.
      railMaterial: "1×6 ranch boards, face-nailed to the posts",
      infillMaterial: "open — 3 boards, no infill",
    },
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
