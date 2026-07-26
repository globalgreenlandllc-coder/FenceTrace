"use server";

import { getMe } from "@/app/actions/me";
import { db } from "@/lib/db";
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

async function geocode(address: string, key: string): Promise<{ loc: LatLng; formatted: string } | null> {
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    u.searchParams.set("address", address);
    u.searchParams.set("key", key);
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const hit = body?.results?.[0];
    const loc = hit?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    return { loc: { lat: loc.lat, lng: loc.lng }, formatted: hit.formatted_address ?? address };
  } catch {
    return null;
  }
}

export async function runFenceScan(
  addressRaw: string,
): Promise<FenceScanResult | FenceScanError> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const address = addressRaw.trim();
  if (address.length < 8) return { ok: false, reason: "Enter a full street address" };

  const key = await googleMapsKey();
  if (!key)
    return {
      ok: false,
      reason: "Google Maps key missing — add it in Admin → API keys.",
    };

  const geo = await geocode(address, key);
  if (!geo) return { ok: false, reason: "Couldn't locate that address — check the spelling." };

  // Property boundary (best-effort — the canvas works without it).
  const parcel: RegridParcel | null =
    (await parcelByAddress(geo.formatted)) ?? (await parcelByPoint(geo.loc));

  const allPts: LatLng[] = parcel ? parcel.rings.flat() : [];
  const center = allPts.length >= 3 ? centroid(allPts) : geo.loc;
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
  // The contractor trims edges they don't want fenced (street side etc.).
  const suggestedRuns: FenceRunSeed[] = rings.map((ring, i) => ({
    id: `parcel-${i}`,
    points: ring.length > 0 ? [...ring, ring[0]] : ring,
  }));

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
