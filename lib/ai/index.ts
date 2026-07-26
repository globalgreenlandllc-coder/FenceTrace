// TODO(fence): the roof/satellite/blueprint measuring engine that lived here
// was removed in the FenceTrace demolition phase. This module now carries ONLY
// the data-shape types the surviving UI (results-view, estimate-job, the
// estimate actions) still compiles against. The fence measuring engine will
// re-introduce a pipeline entry point here.

import type {
  EditableLine,
  Downspout,
  Measurements,
  RoofStructure,
} from "@/lib/types";

/** Geocoded address echo carried on every estimate result. */
export type GeocodeResult = {
  formatted: string;
  lat: number;
  lng: number;
  source: "google" | "mock";
  /** When source is "mock", explains *why* we fell back. */
  fallbackReason?: string;
};

/** Trust signal for an auto-trace. Drives the "double-check this" banner. */
export type TraceQuality = {
  status: "ok" | "low" | "unusable";
  /** 0–1; higher = more trustworthy. */
  confidence: number;
  /** Plain-English reasons, shown in the banner. Empty when status is ok. */
  reasons: string[];
};

export type EstimateResult = {
  geocoded: GeocodeResult;
  measurements: Measurements;
  eaves: EditableLine[];
  /** Edges excluded from pricing (rendered gray-dashed on the canvas). */
  rakes: EditableLine[];
  downspouts: Downspout[];
  source: "ai" | "mock" | "partial";
  durationMs: number;
  notes: string[];
  aerial?: {
    imageDataUrl: string;
    width: number;
    height: number;
    zoom: number;
  };
  /** Canvas-pixels-per-foot for THIS estimate's trace. */
  canvasPxPerFt?: number;
  /** Plan-based estimates: PDF page reference for the canvas background. */
  planSource?: {
    pdfUrl: string;
    pageIndex: number;
    /** Total pages in the PDF — bounds the sheet selector. */
    pageCount?: number;
    sheets?: {
      pageIndex: number;
      label: string;
      sheetType?: string;
      elevationSide?: string;
    }[];
  };
  /** Optional perimeter + structure overlay for the visual annotation layer. */
  roofStructure?: RoofStructure;
  /** Trust signal for the auto-trace; absent for manual takeoffs. */
  traceQuality?: TraceQuality;
  /** Suggested UN-PRICED interior runs with a tap-to-add affordance. */
  suggestedEaves?: EditableLine[];
  /** Detailed snap-path polyline in canvas coords for the drawing tool. */
  magnetPath?: { x: number; y: number }[];
  /** Prefix of magnetPath that forms the closed outer ring. */
  magnetRingCount?: number;
};
