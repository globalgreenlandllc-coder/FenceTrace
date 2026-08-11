import { getActiveApiKey } from "@/lib/api-keys";
import type { LatLng } from "@/lib/fence/geo";
import type { RegridParcel } from "@/lib/regrid";

/**
 * ReportAll USA parcel lookup — the cheaper property-boundary source.
 * Returns the SAME shape as the Regrid client (RegridParcel), so the
 * scan pipeline can use either provider without knowing which answered.
 *
 * API: https://reportallusa.com/api/parcels?client=<key>&v=9
 *  - by address: &region=<city/county/zip>&address=<street>  (or &q=)
 *  - by point:   &spatial_intersect=POINT(lng lat)&si_srid=4326
 * Geometry comes back as `geom_as_wkt` (MULTIPOLYGON, SRID 4326).
 * Verified live against the docs example + a point lookup, 2026-08-11.
 *
 * Fail-safe like the Regrid client: any error → null, the estimator
 * draws without a boundary overlay.
 */

const BASE = "https://reportallusa.com/api/parcels";

async function reportallKey(): Promise<string | null> {
  return (
    (await getActiveApiKey("REPORTALL")) ??
    process.env.REPORTALL_CLIENT_KEY ??
    null
  );
}

/** True when a ReportAll key is configured at all (vault or env). */
export async function reportallConfigured(): Promise<boolean> {
  return (await reportallKey()) !== null;
}

/**
 * Parse WKT POLYGON/MULTIPOLYGON into outer rings (lat/lng). Holes are
 * dropped — fences follow outer lines, same rule as the Regrid client.
 * Exported for tests.
 */
export function ringsFromWkt(wkt: string | null | undefined): LatLng[][] {
  if (typeof wkt !== "string") return [];
  const s = wkt.trim();
  const isMulti = s.toUpperCase().startsWith("MULTIPOLYGON");
  const isPoly = s.toUpperCase().startsWith("POLYGON");
  if (!isMulti && !isPoly) return [];
  const body = s.slice(s.indexOf("(")).replace(/^\(+|\)+$/g, "");
  // Polygons are separated by ")),((" — inside each, rings by "),(".
  const polys = isMulti ? body.split(/\)\s*\)\s*,\s*\(\s*\(/) : [body];
  const rings: LatLng[][] = [];
  for (const poly of polys) {
    const outer = poly.split(/\)\s*,\s*\(/)[0]; // outer ring only
    const ring: LatLng[] = [];
    for (const pair of outer.split(",")) {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) ring.push({ lat, lng });
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function toParcel(body: any): RegridParcel | null {
  if (body?.status !== "OK") return null;
  const r = body?.results?.[0];
  if (!r) return null;
  const rings = ringsFromWkt(r.geom_as_wkt);
  if (rings.length === 0) return null;
  const acres = Number(r.acreage_calc ?? r.acreage);
  return {
    rings,
    address: typeof r.address === "string" && r.address ? r.address : null,
    acres: Number.isFinite(acres) && acres > 0 ? acres : null,
    apn: typeof r.parcel_id === "string" && r.parcel_id ? r.parcel_id : null,
  };
}

async function query(params: Record<string, string>): Promise<RegridParcel | null> {
  const key = await reportallKey();
  if (!key) return null;
  const u = new URL(BASE);
  u.searchParams.set("client", key);
  u.searchParams.set("v", "9");
  u.searchParams.set("returnGeometry", "true");
  u.searchParams.set("rpp", "1");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn(`[reportall] HTTP ${res.status}`);
      return null;
    }
    return toParcel(await res.json());
  } catch (e) {
    console.warn("[reportall] fetch failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Look a parcel up by free-form street address. */
export async function reportallByAddress(address: string): Promise<RegridParcel | null> {
  const q = address.trim();
  if (!q) return null;
  return query({ q });
}

/** Look a parcel up by coordinate (the scan's preferred mode). */
export async function reportallByPoint(p: LatLng): Promise<RegridParcel | null> {
  return query({
    spatial_intersect: `POINT(${p.lng} ${p.lat})`,
    si_srid: "4326",
  });
}
