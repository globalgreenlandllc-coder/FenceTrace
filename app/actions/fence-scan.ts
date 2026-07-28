"use server";

import { getMe } from "@/app/actions/me";
import { db } from "@/lib/db";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import { getActiveApiKey } from "@/lib/api-keys";
import { parcelByAddress, parcelByPoint, type RegridParcel } from "@/lib/regrid";
import {
  CANVAS_H,
  CANVAS_W,
  MAP_H,
  MAP_SCALE,
  MAP_W,
  canvasPxPerFt,
  canvasToLatLng,
  centroid,
  latLngToCanvas,
  zoomToFit,
  type LatLng,
  type Pt,
} from "@/lib/fence/geo";

/**
 * fence-scan.ts — the FenceTrace measuring engine, v1.
 *
 * address → geocode → satellite tile (Google Static Maps, 640×412@2x,
 * drawn into the 900×580 canvas) → Regrid parcel polygon projected into
 * canvas space → suggested fence runs along the property lines. The
 * contractor verifies/edits on the canvas; nothing here is billed per
 * scan beyond the two API calls.
 */

export type FenceRunSeed = { id: string; points: Pt[] };

export type FenceScanResult = {
  ok: true;
  address: string;
  center: LatLng;
  zoom: number;
  canvasPxPerFt: number;
  aerial: { imageDataUrl: string; width: number; height: number; zoom: number };
  /** Parcel outer ring(s), canvas coordinates. Empty when Regrid had no hit. */
  parcelRings: Pt[][];
  /** One suggested run per parcel edge chain (the full ring, closed). */
  suggestedRuns: FenceRunSeed[];
  /** Building footprints (house, garage, big sheds) in canvas coords —
   *  from OpenStreetMap, best-effort. The estimator seeds its editable
   *  house layer from these so the diagram + 3D show the home the fence
   *  ties into. Empty when OSM has nothing here. */
  buildings: Pt[][];
  parcel: { acres: number | null; apn: string | null } | null;
};

export type FenceScanError = { ok: false; reason: string };

/** Candidate keys in priority order. The vault key may be a
 *  browser-restricted key (right for the Leads map, refused by Google
 *  for server calls) — every server call here must fall back to the
 *  environment key when a key is denied. */
async function googleMapsKeys(): Promise<string[]> {
  const vault = await getActiveApiKey("GOOGLE_MAPS");
  const env =
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null;
  return [...new Set([vault, env].filter(Boolean))] as string[];
}

type GeocodeOutcome =
  | { ok: true; loc: LatLng; formatted: string }
  | { ok: false; kind: "not_found" | "service" };

async function geocode(address: string, keys: string[]): Promise<GeocodeOutcome> {
  let outcome: GeocodeOutcome = { ok: false, kind: "service" };
  for (const key of keys) {
    try {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", address);
      u.searchParams.set("key", key);
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        outcome = { ok: false, kind: "service" };
        continue;
      }
      const body = (await res.json()) as any;
      // ZERO_RESULTS = bad address. REQUEST_DENIED = this key can't do
      // server calls (browser-restricted) — try the next key. Anything
      // else non-OK is a service problem.
      if (body?.status && body.status !== "OK") {
        if (body.status === "ZERO_RESULTS") return { ok: false, kind: "not_found" };
        outcome = { ok: false, kind: "service" };
        if (body.status === "REQUEST_DENIED") continue;
        return outcome;
      }
      const hit = body?.results?.[0];
      const loc = hit?.geometry?.location;
      if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number")
        return { ok: false, kind: "not_found" };
      return { ok: true, loc: { lat: loc.lat, lng: loc.lng }, formatted: hit.formatted_address ?? address };
    } catch {
      outcome = { ok: false, kind: "service" };
    }
  }
  return outcome;
}

/** Rough meters between two points (equirectangular — fine at parcel scale). */
function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export async function runFenceScan(
  addressRaw: string,
): Promise<FenceScanResult | FenceScanError> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const address = addressRaw.trim().slice(0, 200);
  if (address.length < 8) return { ok: false, reason: "Enter a full street address" };

  // Every scan spends real Google + Regrid money — same hourly budget as
  // the old satellite pipeline.
  const rl = await consumeLimit({
    policy: POLICIES.estimateRun,
    key: `fence-scan:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-scan" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };

  const keys = await googleMapsKeys();
  if (keys.length === 0)
    return {
      ok: false,
      reason: "Google Maps key missing — add it in Admin → API keys.",
    };

  const geo = await geocode(address, keys);
  if (!geo.ok)
    return {
      ok: false,
      reason:
        geo.kind === "not_found"
          ? "Couldn't locate that address — check the spelling."
          : "The mapping service is temporarily unavailable — try again in a minute.",
    };

  // Property boundary (best-effort — the canvas works without it). The
  // geocoded rooftop point sits ON the right parcel, so the point lookup
  // goes first; the fuzzy address search is only a fallback, and either
  // result is discarded unless it actually contains/neighbors the
  // geocoded point (~250 m) — a wrong-county text match must never show
  // a convincing boundary around the wrong property.
  let parcel: RegridParcel | null =
    (await parcelByPoint(geo.loc)) ?? (await parcelByAddress(geo.formatted));
  if (parcel) {
    const ring0 = parcel.rings.flat();
    if (ring0.length < 3 || metersBetween(centroid(ring0), geo.loc) > 250) {
      parcel = null;
    }
  }

  const allPts: LatLng[] = parcel ? parcel.rings.flat() : [];
  // Center on the bbox midpoint (zoomToFit fits the bbox — centering on
  // the vertex centroid can push edges off the tile on L-shaped lots).
  let center: LatLng = geo.loc;
  if (allPts.length >= 3) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const pt of allPts) {
      minLat = Math.min(minLat, pt.lat); maxLat = Math.max(maxLat, pt.lat);
      minLng = Math.min(minLng, pt.lng); maxLng = Math.max(maxLng, pt.lng);
    }
    center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  }
  const zoom = allPts.length >= 3 ? zoomToFit(allPts) : 19;

  // Satellite tile → data URL (same shape the proposal aerial expects).
  let imageDataUrl: string | null = null;
  for (const key of keys) {
    const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    mapUrl.searchParams.set("center", `${center.lat},${center.lng}`);
    mapUrl.searchParams.set("zoom", String(zoom));
    mapUrl.searchParams.set("size", `${MAP_W}x${MAP_H}`);
    mapUrl.searchParams.set("scale", String(MAP_SCALE));
    mapUrl.searchParams.set("maptype", "satellite");
    mapUrl.searchParams.set("key", key);
    try {
      const img = await fetch(mapUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) continue; // denied/quota on this key — try the next
      const buf = Buffer.from(await img.arrayBuffer());
      imageDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      break;
    } catch (e) {
      console.error("[fence-scan] static map failed", e);
    }
  }
  if (!imageDataUrl) {
    return { ok: false, reason: "Couldn't fetch satellite imagery for that address." };
  }

  const rings: Pt[][] = (parcel?.rings ?? []).map((ring) =>
    ring.map((p) => latLngToCanvas(p, center, zoom)),
  );
  // Suggested fence = the parcel ring itself (closed), one run per ring.
  // GeoJSON rings usually arrive already closed (first == last) — only
  // append the closing vertex when it's genuinely missing, else the
  // duplicate point reads as a phantom corner.
  const suggestedRuns: FenceRunSeed[] = rings.map((ring, i) => {
    const closed =
      ring.length >= 2 &&
      Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 1;
    return {
      id: `parcel-${i}`,
      points: ring.length > 0 && !closed ? [...ring, ring[0]] : ring,
    };
  });

  // Building footprints from OpenStreetMap (free, no key) — the house
  // renders in the diagram and the 3D so wall-connected fences read
  // right. Best-effort with a hard timeout: an Overpass miss just
  // means no house overlay, never a failed scan.
  const buildings = await fetchBuildingFootprints(center, zoom);

  // Recents (best-effort; shares the platform's estimate_runs table).
  try {
    await db.estimateRun.create({
      data: {
        userId: me.user.id,
        address: geo.formatted,
        addressNormalized: geo.formatted.toLowerCase(),
        status: "SUCCEEDED",
        measurements: { fenceScan: true },
      },
    });
  } catch {
    // recents are cosmetic — never fail the scan over them
  }

  return {
    ok: true,
    address: geo.formatted,
    center,
    zoom,
    canvasPxPerFt: canvasPxPerFt(center.lat, zoom),
    aerial: { imageDataUrl, width: CANVAS_W, height: CANVAS_H, zoom },
    parcelRings: rings,
    suggestedRuns,
    buildings,
    parcel: parcel ? { acres: parcel.acres, apn: parcel.apn } : null,
  };
}

/** Building outlines near the scan from OpenStreetMap's Overpass API —
 *  most US residential footprints are present (the Microsoft footprint
 *  import). Two public mirrors, 9 s cap each, fail-soft to []. */
async function fetchBuildingFootprints(
  center: LatLng,
  zoom: number,
): Promise<Pt[][]> {
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
      return out;
    } catch {
      // try the next mirror
    }
  }
  return [];
}
