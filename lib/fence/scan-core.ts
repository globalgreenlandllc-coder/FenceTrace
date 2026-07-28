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
 * scan-core.ts — the FenceTrace measuring pipeline, shared between the
 * authed estimator scan (app/actions/fence-scan.ts adds auth + rate
 * limit + recents) and the anonymous landing teaser (app/api/teaser
 * adds its own fail-closed IP/global caps).
 *
 * address → geocode → satellite tile (Google Static Maps, 640×412@2x,
 * drawn into the 900×580 canvas) → Regrid parcel polygon projected into
 * canvas space → suggested fence runs along the property lines.
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

export async function fenceScanCore(
  addressRaw: string,
): Promise<FenceScanResult | FenceScanError> {
  const address = addressRaw.trim().slice(0, 200);
  if (address.length < 8) return { ok: false, reason: "Enter a full street address" };

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

  return {
    ok: true,
    address: geo.formatted,
    center,
    zoom,
    canvasPxPerFt: canvasPxPerFt(center.lat, zoom),
    aerial: { imageDataUrl, width: CANVAS_W, height: CANVAS_H, zoom },
    parcelRings: rings,
    suggestedRuns,
    // Building footprints load ASYNC via getScanBuildings — Overpass
    // latency (1–9 s) used to sit here and made every scan feel slow.
    buildings: [],
    parcel: parcel ? { acres: parcel.acres, apn: parcel.apn } : null,
  };
}
