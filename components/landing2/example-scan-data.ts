// TODO(fence): the baked landing-page example was a gutter house captured by
// the removed roof engine (scripts/export-landing-example.mts, also removed).
// EXAMPLE_SCAN is null until a fence example is baked — the landing components
// already null-guard and simply hide the "see a finished example" affordance.

import type { Downspout, EditableLine, RoofStructure } from "@/lib/types";

export type ExampleScan = {
  /** Display label, e.g. "6232 97th Dr NE, Lake Stevens, WA". */
  address: string;
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Downspout[];
  roofStructure?: RoofStructure;
  canvasPxPerFt?: number;
  /** Public asset path of the baked aerial photo (null = diagram only). */
  aerialUrl: string | null;
  stats: {
    eaveLF: number;
    downspoutCount: number;
    corners: number;
    stories: number;
  };
  /** Derived contract total of the source proposal, in cents. */
  estimateTotalCents: number;
};

export const EXAMPLE_SCAN: ExampleScan | null = null;
