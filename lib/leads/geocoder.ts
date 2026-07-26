// Lightweight Google Maps Geocoding wrapper for the few city feeds that
// publish addresses but no lat/lng (Kenmore Trakit, etc.). Uses the
// existing GOOGLE_MAPS key from the admin console so cost shows up in the
// same Google project that powers the map.
//
// Pricing reference: $5 per 1k addresses. Each address is geocoded ONCE
// per sourceCity+sourceId pair (the cron's dedup ensures we don't re-pay).

import { getActiveApiKey } from "@/lib/api-keys";

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// In-process memoization. Survives the lifetime of one cron run, not
// across runs. Persistent dedup is via the leads table's
// @@unique([sourceCity, sourceId]).
const cache = new Map<string, { lat: number; lng: number } | null>();

let cachedKey: string | null = null;
async function getKey(): Promise<string | null> {
  if (cachedKey != null) return cachedKey;
  cachedKey = (await getActiveApiKey("GOOGLE_MAPS")) ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  return cachedKey || null;
}

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const norm = address.trim();
  if (!norm) return null;
  if (cache.has(norm)) return cache.get(norm) ?? null;

  const key = await getKey();
  if (!key) {
    console.warn("[geocoder] no GOOGLE_MAPS key; skipping geocode for", norm);
    cache.set(norm, null);
    return null;
  }

  try {
    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set("address", norm);
    url.searchParams.set("key", key);
    const res = await fetch(url.toString());
    if (!res.ok) {
      cache.set(norm, null);
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    if (data.status !== "OK") {
      cache.set(norm, null);
      return null;
    }
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      cache.set(norm, null);
      return null;
    }
    const out = { lat: loc.lat, lng: loc.lng };
    cache.set(norm, out);
    return out;
  } catch (e) {
    console.error("[geocoder] error", e);
    cache.set(norm, null);
    return null;
  }
}

// Bounded-concurrency batch geocoder for a list of addresses. Returns
// results in the same order as inputs.
export async function geocodeBatch(
  addresses: string[],
  concurrency = 5,
): Promise<Array<{ lat: number; lng: number } | null>> {
  const out: Array<{ lat: number; lng: number } | null> = new Array(addresses.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, addresses.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= addresses.length) return;
      out[i] = await geocodeAddress(addresses[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
