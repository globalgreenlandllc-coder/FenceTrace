import {
  CANVAS_H,
  CANVAS_W,
  canvasPxPerFt,
  canvasToLatLng,
  latLngToCanvas,
  type LatLng,
  type Pt,
} from "@/lib/fence/geo";

/**
 * buildings-core.ts — building footprints from OpenStreetMap's Overpass
 * API (free, no key; most US residential footprints exist via the
 * Microsoft import). Pure fetch + geometry, no auth: the estimator's
 * server action (app/actions/fence-buildings.ts) wraps it with session +
 * rate-limit checks, and the anonymous teaser route calls it directly on
 * a tight time budget (the teaser endpoint carries its own IP + global
 * limits).
 */

// Overpass throttles datacenter IPs hard, and Vercel's egress IPs are
// shared — the main instance 429ing while a laptop sails through is
// NORMAL. Four mirrors, a UA (some mirrors 403 without one), and a
// warn per miss so a silent "no house" is diagnosable from the logs.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
] as const;

export type FootprintFetchOpts = {
  /** Per-mirror abort budget. Default 9s (the estimator can wait). */
  timeoutMs?: number;
  /** How many mirrors to try before giving up. Default: all. */
  maxMirrors?: number;
};

/** House/garage/large-shed rings in canvas coords, closest-to-center
 *  first, capped at 6. Never throws — a total miss is `[]`. */
export async function fetchBuildingFootprints(
  input: { center: LatLng; zoom: number },
  opts: FootprintFetchOpts = {},
): Promise<Pt[][]> {
  const { center, zoom } = input;
  if (
    !center ||
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng) ||
    !Number.isFinite(zoom)
  ) {
    return [];
  }
  const timeoutMs = opts.timeoutMs ?? 9_000;
  const mirrors = MIRRORS.slice(0, Math.max(1, opts.maxMirrors ?? MIRRORS.length));

  const nw = canvasToLatLng({ x: 0, y: 0 }, center, zoom);
  const se = canvasToLatLng({ x: CANVAS_W, y: CANVAS_H }, center, zoom);
  const s = Math.min(nw.lat, se.lat);
  const n = Math.max(nw.lat, se.lat);
  const w = Math.min(nw.lng, se.lng);
  const e = Math.max(nw.lng, se.lng);
  const serverTimeout = Math.min(25, Math.max(4, Math.round(timeoutMs / 1000) - 1));
  const query = `[out:json][timeout:${serverTimeout}];way["building"](${s},${w},${n},${e});out geom 40;`;
  const pxPerFt = canvasPxPerFt(center.lat, zoom);

  for (const endpoint of mirrors) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "FenceScan/1.0 (building footprints; fencescan.com)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.warn(`[fence-buildings] ${endpoint} HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        elements?: { type: string; geometry?: { lat: number; lon: number }[] }[];
      };
      const out: Pt[][] = [];
      for (const el of body.elements ?? []) {
        if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 4)
          continue;
        let ring = el.geometry.map((g) =>
          latLngToCanvas({ lat: g.lat, lng: g.lon }, center, zoom),
        );
        if (
          ring.length >= 2 &&
          Math.hypot(
            ring[0].x - ring[ring.length - 1].x,
            ring[0].y - ring[ring.length - 1].y,
          ) < 1
        ) {
          ring = ring.slice(0, -1); // drop GeoJSON's closing duplicate
        }
        if (ring.length < 3) continue;
        const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
        const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length;
        if (cx < -60 || cx > CANVAS_W + 60 || cy < -60 || cy > CANVAS_H + 60)
          continue;
        let area2 = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          area2 += a.x * b.y - b.x * a.y;
        }
        const sqft = Math.abs(area2 / 2) / (pxPerFt * pxPerFt);
        if (sqft < 120) continue; // ignore tiny sheds/noise
        out.push(ring);
      }
      // Closest-to-center first BEFORE capping: the subject house must
      // never lose its slot to a row of neighbors at the frame edge.
      out.sort((a, b) => distToCenter(a) - distToCenter(b));
      return out.slice(0, 6);
    } catch (e) {
      console.warn(
        `[fence-buildings] ${endpoint} failed`,
        e instanceof Error ? e.message : e,
      );
      // try the next mirror
    }
  }
  return [];
}

function distToCenter(ring: Pt[]): number {
  const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length;
  return Math.hypot(cx - CANVAS_W / 2, cy - CANVAS_H / 2);
}
