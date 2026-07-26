"use client";

import type {
  Downspout,
  EditableLine,
  Measurements,
  RoofStructure,
} from "./types";

/**
 * Estimate → Proposal handoff via localStorage.
 *
 * The proposal flow lives at /proposal and was originally always seeded
 * with sampleMeasurements regardless of what the contractor actually
 * estimated. This module gives the estimate flow a way to hand its live
 * takeoff data to the proposal flow without threading a server-side
 * draft-proposal record through the router (which is the right long-term
 * answer but a bigger change). The localStorage payload is consumed
 * once on /proposal mount and cleared immediately so a manual refresh
 * doesn't re-apply stale data.
 *
 * Payload includes the full takeoff (eaves + rakes + downspouts + the
 * satellite image data URL) so the proposal can render the *actual*
 * traced roof instead of a cartoon, and so the contractor can keep
 * editing eaves/downspouts from inside the proposal view.
 */

const STORAGE_KEY = "fencetrace:estimate-handoff";

export interface EstimateHandoffAerial {
  imageDataUrl: string;
  width: number;
  height: number;
  zoom: number;
}

export interface EstimateHandoff {
  address: string;
  measurements: Measurements;
  /** Editable lines the contractor will see (cyan in the canvas). */
  eaves: EditableLine[];
  /** AI-classified rakes (gray-dashed). Empty when the classifier
   *  fell back to "all polygon edges as eaves". */
  rakes: EditableLine[];
  /** Downspout pins to render on the canvas. */
  downspouts: Downspout[];
  /** Suggested interior gutter runs (un-priced tier-break hints). Carried
   *  so the proposal diagram can draw them dashed + tap-to-add. NEVER
   *  counted in measurements.eaveLF. */
  suggestedEaves?: EditableLine[];
  /** Roof outline + ridge/hip/valley lines for the read-only overlay.
   *  Optional — older payloads and satellite estimates may omit it. */
  roofStructure?: RoofStructure;
  /** Background satellite image. Optional because mock/partial estimate
   *  runs don't always produce one — fall back to the cartoon scene. */
  aerial?: EstimateHandoffAerial;
  /** Canvas-px-per-foot for the satellite trace, so the proposal's LF +
   *  re-price use the same scale the estimate did (not the plan-mode
   *  2.4). Absent for plan takeoffs / older payloads → defaults to
   *  PX_PER_FT downstream. */
  canvasPxPerFt?: number;
  /** ms epoch — used to ignore handoffs older than a few minutes so a
   *  stale tab doesn't hijack a fresh proposal session. */
  capturedAt: number;
}

const MAX_AGE_MS = 10 * 60 * 1000; // 10 min

export function writeEstimateHandoff(
  payload: Omit<EstimateHandoff, "capturedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const stored: EstimateHandoff = { ...payload, capturedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage can throw in private-browsing / quota-exceeded
    // scenarios. Silently no-op — the proposal page will just fall back
    // to its blank template, which is the same behavior we had before
    // the handoff existed.
  }
}

export function readEstimateHandoff(): EstimateHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EstimateHandoff>;
    if (
      !parsed ||
      typeof parsed.address !== "string" ||
      !parsed.measurements ||
      typeof parsed.capturedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.capturedAt > MAX_AGE_MS) return null;
    // Lenient defaults for the new fields — a payload written by an
    // older deploy may not have eaves/rakes/downspouts/aerial. We can
    // still ship a useful proposal off just address + measurements.
    return {
      address: parsed.address,
      measurements: parsed.measurements,
      eaves: Array.isArray(parsed.eaves) ? parsed.eaves : [],
      rakes: Array.isArray(parsed.rakes) ? parsed.rakes : [],
      downspouts: Array.isArray(parsed.downspouts) ? parsed.downspouts : [],
      suggestedEaves: Array.isArray(parsed.suggestedEaves)
        ? parsed.suggestedEaves
        : [],
      roofStructure: parsed.roofStructure,
      aerial: parsed.aerial,
      canvasPxPerFt:
        typeof parsed.canvasPxPerFt === "number"
          ? parsed.canvasPxPerFt
          : undefined,
      capturedAt: parsed.capturedAt,
    };
  } catch {
    return null;
  }
}

export function clearEstimateHandoff(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see writeEstimateHandoff comment
  }
}
