import type { LatLng } from "@/lib/fence/geo";
import {
  parcelByAddress as regridByAddress,
  parcelByPoint as regridByPoint,
  parcelsInBox as regridParcelsInBox,
  type RegridParcel,
} from "@/lib/regrid";
import {
  reportallByAddress,
  reportallByPoint,
  reportallConfigured,
  reportallParcelsInBox,
} from "@/lib/reportall";

/**
 * Parcel lookup with provider selection. ReportAll is preferred when a
 * key is configured (cheaper per parcel); Regrid is the fallback — both
 * for "no ReportAll key" and for "ReportAll found nothing", so adding
 * the cheaper provider can only ever gain coverage, never lose a scan
 * that used to work.
 */

export type Parcel = RegridParcel;

export async function lookupParcelByPoint(p: LatLng): Promise<Parcel | null> {
  if (await reportallConfigured()) {
    const hit = await reportallByPoint(p);
    if (hit) return hit;
  }
  return regridByPoint(p);
}

export async function lookupParcelByAddress(
  address: string,
): Promise<Parcel | null> {
  if (await reportallConfigured()) {
    const hit = await reportallByAddress(address);
    if (hit) return hit;
  }
  return regridByAddress(address);
}

/**
 * Parcels meeting a lat/lng box — subject lot plus neighbours. Providers
 * bill per parcel returned, so `max` is a real cost knob, not a hint.
 */
export async function lookupParcelsInBox(
  sw: LatLng,
  ne: LatLng,
  max = 24,
): Promise<Parcel[]> {
  if (await reportallConfigured()) {
    const hits = await reportallParcelsInBox(sw, ne, max);
    if (hits.length > 0) return hits;
  }
  return regridParcelsInBox(sw, ne, max);
}

/** True when `p` falls inside the ring (ray casting, lat/lng plane —
 *  exact enough at parcel scale). */
export function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng;
    const yj = ring[j].lat, xj = ring[j].lng;
    const hit =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** True when the point falls inside ANY of the parcel's outer rings. */
export function parcelContains(parcel: Parcel, p: LatLng): boolean {
  return parcel.rings.some((r) => r.length >= 3 && pointInRing(p, r));
}

/** Street number + street name, lowercased, for comparing a parcel's
 *  recorded address against what the contractor typed. */
function addressKey(a: string | null | undefined): string {
  return (a ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl|boulevard|blvd|way|terrace|ter|circle|cir)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choose the parcel the contractor actually typed.
 *
 * A geocoded rooftop pin is only accurate to a few metres, so on tight
 * in-town lots it regularly lands over the line on the NEIGHBOUR's
 * parcel — which is how a scan came back showing the house next door.
 * Ranking, strongest signal first:
 *
 *   1. contains the geocoded point AND its recorded address matches
 *   2. recorded address matches what was typed (pin drifted next door)
 *   3. contains the point (no usable address on the record)
 *   4. nearest centroid, as a last resort
 */
export function pickSubjectParcel(
  candidates: Parcel[],
  point: LatLng,
  typedAddress: string,
): Parcel | null {
  if (candidates.length === 0) return null;
  const want = addressKey(typedAddress);
  const wantNum = want.split(" ")[0];
  const scored = candidates.map((c) => {
    const contains = parcelContains(c, point);
    const key = addressKey(c.address);
    // Same street number AND some street-name overlap — a bare number
    // match alone repeats on every street in town.
    const num = key.split(" ")[0];
    const nameHit =
      key.length > 0 &&
      want.length > 0 &&
      key.split(" ").slice(1).some((w) => w.length > 2 && want.includes(w));
    const addrMatch = !!wantNum && num === wantNum && nameHit;
    const ring = c.rings.flat();
    const dist = ring.length >= 3 ? metersBetween(centroidOf(ring), point) : Infinity;
    const rank = contains && addrMatch ? 0 : addrMatch ? 1 : contains ? 2 : 3;
    return { c, rank, dist };
  });
  scored.sort((a, b) => a.rank - b.rank || a.dist - b.dist);
  return scored[0].c;
}

function centroidOf(ring: LatLng[]): LatLng {
  let lat = 0, lng = 0;
  for (const p of ring) { lat += p.lat; lng += p.lng; }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
