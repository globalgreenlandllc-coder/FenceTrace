import type { EditableLine, Downspout, Measurements } from "./types";

export const SAMPLE_ADDRESS = "1247 Maple Ridge Drive, Austin, TX 78704";

export const sampleMeasurements: Measurements = {
  eaveLF: 148,
  rakeLF: 96,
  outsideCorners: 6,
  insideCorners: 2,
  endCaps: 4,
  downspoutCount: 5,
  stories: 2,
  wasteFactorPct: 8,
};

export const sampleEaves: EditableLine[] = [
  {
    id: "eave-front",
    kind: "eave",
    points: [
      { x: 220, y: 240 },
      { x: 580, y: 240 },
    ],
  },
  {
    id: "eave-back",
    kind: "eave",
    points: [
      { x: 220, y: 380 },
      { x: 580, y: 380 },
    ],
  },
  {
    id: "eave-garage-front",
    kind: "eave",
    points: [
      { x: 580, y: 280 },
      { x: 720, y: 280 },
    ],
  },
  {
    id: "eave-garage-back",
    kind: "eave",
    points: [
      { x: 580, y: 360 },
      { x: 720, y: 360 },
    ],
  },
  {
    id: "eave-porch",
    kind: "eave",
    points: [
      { x: 320, y: 200 },
      { x: 480, y: 200 },
    ],
  },
];

export const sampleDownspouts: Downspout[] = [
  { id: "ds-1", x: 220, y: 240, heightFt: 20 },
  { id: "ds-2", x: 580, y: 240, heightFt: 20 },
  { id: "ds-3", x: 220, y: 380, heightFt: 20 },
  { id: "ds-4", x: 580, y: 380, heightFt: 20 },
  { id: "ds-5", x: 720, y: 360, heightFt: 12 },
];
