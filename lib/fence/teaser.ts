import type { FenceScanResult } from "@/lib/fence/scan-core";
import type { Pt } from "@/lib/fence/geo";

/**
 * teaser.ts — shapes a real scan into the anonymous landing preview.
 *
 * Deliberately REDACTED: no canvasPxPerFt, no per-run footage — the
 * visitor sees their actual property with the actual parcel-line fence
 * runs drawn on it, and the measurements are what the free account
 * unlocks. Counts (sides/corners/acres) are safe social proof.
 */

export type TeaserRun = { id: string; points: Pt[] };

export type TeaserPayload = {
  address: string;
  image: { dataUrl: string; width: number; height: number };
  /** Closed parcel ring(s) in canvas coords — the actual suggested runs. */
  runs: TeaserRun[];
  /** Fence sides (segments) across all rings — "4 fence lines". */
  sides: number;
  /** Distinct corner posts across all rings (closing vertex not counted). */
  corners: number;
  acres: number | null;
  /** False when Regrid had no boundary here — the UI shows the photo and
   *  an honest "draw it in the app" nudge instead of fake lines. */
  parcelFound: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function teaserPayloadFromScan(scan: FenceScanResult): TeaserPayload {
  let sides = 0;
  let corners = 0;
  const runs: TeaserRun[] = scan.suggestedRuns
    .filter((r) => r.points.length >= 2)
    .map((r) => {
      const pts = r.points;
      const closed =
        pts.length >= 3 &&
        Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1;
      sides += pts.length - 1;
      corners += closed ? pts.length - 1 : pts.length;
      return {
        id: r.id,
        points: pts.map((p) => ({ x: round1(p.x), y: round1(p.y) })),
      };
    });

  return {
    address: scan.address,
    image: {
      dataUrl: scan.aerial.imageDataUrl,
      width: scan.aerial.width,
      height: scan.aerial.height,
    },
    runs,
    sides,
    corners,
    acres:
      typeof scan.parcel?.acres === "number" && Number.isFinite(scan.parcel.acres)
        ? Math.round(scan.parcel.acres * 100) / 100
        : null,
    parcelFound: runs.length > 0,
  };
}
