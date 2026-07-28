import type { EditableLine, Downspout, Measurements } from "./types";

export const SAMPLE_ADDRESS = "1247 Maple Ridge Drive, Austin, TX 78704";

export const sampleMeasurements: Measurements = {
  eaveLF: 262,
  rakeLF: 0,
  outsideCorners: 4,
  insideCorners: 0,
  endCaps: 2,
  downspoutCount: 2,
  stories: 1,
  wasteFactorPct: 10,
};

export const sampleEaves: EditableLine[] = [
  // Fence perimeter around the sample yard — the house masses render
  // inside it, so the demo reads as a FENCE layout, not gutter runs.
  {
    id: "fence-back",
    kind: "eave",
    points: [
      { x: 150, y: 150 },
      { x: 760, y: 150 },
    ],
  },
  {
    id: "fence-left",
    kind: "eave",
    points: [
      { x: 150, y: 150 },
      { x: 150, y: 470 },
    ],
  },
  {
    id: "fence-right",
    kind: "eave",
    points: [
      { x: 760, y: 150 },
      { x: 760, y: 470 },
    ],
  },
  {
    id: "fence-front-left",
    kind: "eave",
    points: [
      { x: 150, y: 470 },
      { x: 420, y: 470 },
    ],
  },
  {
    id: "fence-front-right",
    kind: "eave",
    points: [
      { x: 452, y: 470 },
      { x: 760, y: 470 },
    ],
  },
];

// Gates ride the downspout channel (semantics mapping): the front
// drive gate sits in the fence gap, plus a side walk gate.
export const sampleDownspouts: Downspout[] = [
  { id: "gate-front", x: 436, y: 470, heightFt: 6, gateKind: "double", gateWidthFt: 10 },
  { id: "gate-side", x: 150, y: 300, heightFt: 6, gateKind: "single", gateWidthFt: 4 },
];
