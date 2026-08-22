import { getActiveApiKey } from "@/lib/api-keys";
import type { LatLng } from "@/lib/fence/geo";

/**
 * Regrid parcel lookup — the property-boundary source for the fence
 * estimator. One call per scan: address (or point) → parcel polygon(s)
 * in lat/lng, plus a few display fields. Fail-safe: any error → null,
 * the estimator falls back to drawing without a boundary overlay.
 *
 * API: https://app.regrid.com/api/v2 — token via the admin key vault
 * (provider REGRID) or the REGRID_API_KEY env var.
 */

export type RegridParcel = {
  /** Outer ring(s) of the parcel, lat/lng. Multi-polygon parcels give
   *  several rings; holes are ignored (fences follow outer lines). */
  rings: LatLng[][];
  address: string | null;
  /** Parcel area in acres when Regrid provides it. */
  acres: number | null;
  apn: string | null;
};

async function regridToken(): Promise<string | null> {
  return (await getActiveApiKey("REGRID")) ?? process.env.REGRID_API_KEY ?? null;
}

function ringsFromGeometry(geom: any): LatLng[][] {
  // GeoJSON positions are [lng, lat]. Polygon → [ring…]; MultiPolygon →
  // [[ring…]…]. Only outer rings (index 0) are kept.
  const rings: LatLng[][] = [];
  const toRing = (coords: any[]): LatLng[] =>
    coords
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (geom?.type === "Polygon" && Array.isArray(geom.coordinates?.[0])) {
    const r = toRing(geom.coordinates[0]);
    if (r.length >= 3) rings.push(r);
  } else if (geom?.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates) {
      if (!Array.isArray(poly?.[0])) continue;
      const r = toRing(poly[0]);
      if (r.length >= 3) rings.push(r);
    }
  }
  return rings;
}

function parcelFromFeature(f: any): RegridParcel | null {
  const rings = ringsFromGeometry(f?.geometry);
  if (rings.length === 0) return null;
  const props = f?.properties?.fields ?? f?.properties ?? {};
  return {
    rings,
    address: props.address ?? props.mailadd ?? null,
    acres: typeof props.ll_gisacre === "number" ? props.ll_gisacre : null,
    apn: props.parcelnumb ?? null,
  };
}

async function fetchParcelList(url: string): Promise<RegridParcel[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[regrid] HTTP ${res.status}`);
      return [];
    }
    const body = (await res.json()) as any;
    const features: any[] = body?.parcels?.features ?? body?.features ?? [];
    if (!Array.isArray(features)) return [];
    return features
      .map(parcelFromFeature)
      .filter((x): x is RegridParcel => x !== null);
  } catch (e) {
    console.warn("[regrid] fetch failed", e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchParcels(url: string): Promise<RegridParcel | null> {
  return (await fetchParcelList(url))[0] ?? null;
}

/** Look a parcel up by street address. */
export async function parcelByAddress(address: string): Promise<RegridParcel | null> {
  const token = await regridToken();
  if (!token) return null;
  const u = new URL("https://app.regrid.com/api/v2/parcels/address");
  u.searchParams.set("query", address);
  u.searchParams.set("limit", "1");
  u.searchParams.set("token", token);
  return fetchParcels(u.toString());
}

/** Look a parcel up by coordinate (fallback when address matching misses). */
export async function parcelByPoint(p: LatLng): Promise<RegridParcel | null> {
  const token = await regridToken();
  if (!token) return null;
  const u = new URL("https://app.regrid.com/api/v2/parcels/point");
  u.searchParams.set("lat", String(p.lat));
  u.searchParams.set("lon", String(p.lng));
  u.searchParams.set("limit", "1");
  u.searchParams.set("token", token);
  return fetchParcels(u.toString());
}

/** Parcels intersecting a lat/lng box — the subject lot and neighbours. */
export async function parcelsInBox(
  sw: LatLng,
  ne: LatLng,
  max = 24,
): Promise<RegridParcel[]> {
  const token = await regridToken();
  if (!token) return [];
  const u = new URL("https://app.regrid.com/api/v2/parcels/query");
  // Regrid takes a GeoJSON polygon for spatial queries.
  u.searchParams.set(
    "geojson",
    JSON.stringify({
      type: "Polygon",
      coordinates: [[
        [sw.lng, sw.lat],
        [ne.lng, sw.lat],
        [ne.lng, ne.lat],
        [sw.lng, ne.lat],
        [sw.lng, sw.lat],
      ]],
    }),
  );
  u.searchParams.set("limit", String(Math.max(1, Math.min(50, max))));
  u.searchParams.set("token", token);
  return fetchParcelList(u.toString());
}
