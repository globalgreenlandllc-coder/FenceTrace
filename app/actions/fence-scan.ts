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
  parcel: { acres: number | null; apn: string | null } | null;
};

export type FenceScanError = { ok: false; reason: string };

async function googleMapsKey(): Promise<string | null> {
  return (
    (await getActiveApiKey("GOOGLE_MAPS")) ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null
  );
}

type GeocodeOutcome =
  | { ok: true; loc: LatLng; formatted: string }
  | { ok: false; kind: "not_found" | "service" };

async function geocode(address: string, key: string): Promise<GeocodeOutcome> {
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    u.searchParams.set("address", address);
    u.searchParams.set("key", key);
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, kind: "service" };
    const body = (await res.json()) as any;
    // ZERO_RESULTS = bad address; anything else non-OK (OVER_QUERY_LIMIT,
    // REQUEST_DENIED…) is OUR problem and must not read as a typo.
    if (body?.status && body.status !== "OK") {
      return { ok: false, kind: body.status === "ZERO_RESULTS" ? "not_found" : "service" };
    }
    const hit = body?.results?.[0];
    const loc = hit?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number")
      return { ok: false, kind: "not_found" };
    return { ok: true, loc: { lat: loc.lat, lng: loc.lng }, formatted: hit.formatted_address ?? address };
  } catch {
    return { ok: false, kind: "service" };
  }
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

  const key = await googleMapsKey();
  if (!key)
    return {
      ok: false,
      reason: "Google Maps key missing — add it in Admin → API keys.",
    };

  const geo = await geocode(address, key);
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
  const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
  mapUrl.searchParams.set("center", `${center.lat},${center.lng}`);
  mapUrl.searchParams.set("zoom", String(zoom));
  mapUrl.searchParams.set("size", `${MAP_W}x${MAP_H}`);
  mapUrl.searchParams.set("scale", String(MAP_SCALE));
  mapUrl.searchParams.set("maptype", "satellite");
  mapUrl.searchParams.set("key", key);
  let imageDataUrl: string;
  try {
    const img = await fetch(mapUrl, { signal: AbortSignal.timeout(15_000) });
    if (!img.ok) throw new Error(`static map HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    imageDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error("[fence-scan] static map failed", e);
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
    parcel: parcel ? { acres: parcel.acres, apn: parcel.apn } : null,
  };
}
