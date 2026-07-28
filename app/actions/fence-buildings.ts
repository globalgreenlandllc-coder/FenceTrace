"use server";

import { getMe } from "@/app/actions/me";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
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
 * fence-buildings.ts — building footprints from OpenStreetMap's
 * Overpass API (free, no key; most US residential footprints exist via
 * the Microsoft import).
 *
 * Deliberately its OWN action, called by the estimator AFTER the scan
 * renders: Overpass latency is 1–9 s (up to two mirrors) and used to sit
 * inside runFenceScan, making every scan feel slow. Now the satellite +
 * parcel land immediately and the house outline pops in a beat later.
 */

export type ScanBuildingsResult = { ok: true; buildings: Pt[][] };

export async function getScanBuildings(input: {
  center: LatLng;
  zoom: number;
}): Promise<ScanBuildingsResult> {
  const me = await getMe();
  if (!me) return { ok: true, buildings: [] };
  const rl = await consumeLimit({
    policy: POLICIES.fenceTopo,
    key: `osm-buildings:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-buildings" },
  });
  if (!rl.ok) return { ok: true, buildings: [] };

  const { center, zoom } = input;
  if (
    !center ||
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng) ||
    !Number.isFinite(zoom)
  ) {
    return { ok: true, buildings: [] };
  }

  const nw = canvasToLatLng({ x: 0, y: 0 }, center, zoom);
  const se = canvasToLatLng({ x: CANVAS_W, y: CANVAS_H }, center, zoom);
  const s = Math.min(nw.lat, se.lat);
  const n = Math.max(nw.lat, se.lat);
  const w = Math.min(nw.lng, se.lng);
  const e = Math.max(nw.lng, se.lng);
  const query = `[out:json][timeout:8];way["building"](${s},${w},${n},${e});out geom 40;`;
  const pxPerFt = canvasPxPerFt(center.lat, zoom);
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) continue;
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
        if (out.length >= 6) break;
      }
      return { ok: true, buildings: out };
    } catch {
      // try the next mirror
    }
  }
  return { ok: true, buildings: [] };
}
