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
  // Overpass throttles datacenter IPs hard, and Vercel's egress IPs are
  // shared — the main instance 429ing while a laptop sails through is
  // NORMAL. Four mirrors, a UA (some mirrors 403 without one), and a
  // warn per miss so a silent "no house" is diagnosable from the logs.
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
  ]) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "FenceScan/1.0 (building footprints; fencescan.com)",
        },
        signal: AbortSignal.timeout(9_000),
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
      out.sort((a, b) => {
        const da = distToCenter(a);
        const db = distToCenter(b);
        return da - db;
      });
      return { ok: true, buildings: out.slice(0, 6) };
    } catch (e) {
      console.warn(
        `[fence-buildings] ${endpoint} failed`,
        e instanceof Error ? e.message : e,
      );
      // try the next mirror
    }
  }
  return { ok: true, buildings: [] };
}

function distToCenter(ring: Pt[]): number {
  const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length;
  return Math.hypot(cx - CANVAS_W / 2, cy - CANVAS_H / 2);
}

export type MainBuildingResult = { ok: true; ring: Pt[] | null };

/**
 * AI-vision fallback for the SUBJECT house: OSM regularly knows the
 * neighbor's roof but not the one being fenced (rural parcels, new
 * builds). When the estimator finds no footprint on the parcel, it
 * sends the scan aerial here and Claude traces the main house off the
 * image itself. Seeds the House layer — always hand-editable.
 */
export async function extractMainBuilding(input: {
  imageDataUrl: string;
  /** Parcel ring in canvas px — masks the neighbors out of the frame
   *  and anchors the on-parcel validation. */
  parcelRing?: Pt[];
}): Promise<MainBuildingResult> {
  const me = await getMe();
  if (!me) return { ok: true, ring: null };
  const rl = await consumeLimit({
    policy: POLICIES.fenceTopo,
    key: `ai-building:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-buildings-ai" },
  });
  if (!rl.ok) return { ok: true, ring: null };

  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(
    input.imageDataUrl ?? "",
  );
  if (!m) return { ok: true, ring: null };
  const { extractBuildingFootprint } = await import(
    "@/lib/ai/building-footprint"
  );
  const parcelRing = (input.parcelRing ?? [])
    .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .slice(0, 200);
  const res = await extractBuildingFootprint({
    base64: m[2],
    mimeType: m[1] as "image/png" | "image/jpeg",
    width: CANVAS_W,
    height: CANVAS_H,
    parcelRing: parcelRing.length >= 3 ? parcelRing : undefined,
  });
  return { ok: true, ring: res.ring };
}
