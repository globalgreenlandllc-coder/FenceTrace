import type { LatLng } from "@/lib/fence/geo";
import {
  parcelByAddress as regridByAddress,
  parcelByPoint as regridByPoint,
  type RegridParcel,
} from "@/lib/regrid";
import {
  reportallByAddress,
  reportallByPoint,
  reportallConfigured,
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
