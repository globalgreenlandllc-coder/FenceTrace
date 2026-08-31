"use server";

import { getMe } from "@/app/actions/me";
import { getActiveApiKey } from "@/lib/api-keys";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import type { LatLng } from "@/lib/fence/geo";

/**
 * fence-topo.ts — terrain along the drawn fence.
 *
 * Source order matters: USGS 3DEP first (lidar bare-earth, free, no
 * key), Google Elevation as the fallback. Google's DEM is canopy-
 * contaminated over dense forest — a flat Florida lot backing onto a
 * wooded preserve read as a 40-foot hill, and the 3D dutifully stepped
 * the fence down a slope that doesn't exist. 3DEP reports the actual
 * ground under the trees. It only covers the US, and silently omits
 * points outside coverage, so any gap falls back to Google wholesale.
 *
 * One batched request per call: every post position across every run
 * (≤512 locations), so a layout edit costs a fraction of a cent. The
 * estimator debounces calls and the whole feature degrades gracefully —
 * no elevation ⇒ the terrain picker just stays manual.
 */

export type FenceTopoResult =
  | { ok: true; runElevationsFt: number[][] }
  | { ok: false; reason: string };

const MAX_POINTS = 500;
const METERS_TO_FT = 3.28084;

/**
 * Bare-earth elevations (ft) from the USGS 3DEP lidar DEM, one batched
 * getSamples call. Returns null — never throws — when any point lacks
 * coverage or the service misbehaves, so the caller can fall back to
 * Google for the whole batch. Results are matched back to inputs by
 * coordinate (the service omits uncovered points rather than marking
 * them), keyed at ~0.1 m so colocated jitter vertices share a sample.
 */
async function usgsElevationsFt(points: LatLng[]): Promise<number[] | null> {
  // Cheap gate: 3DEP is US-only (incl. Alaska across the antimeridian).
  const inUs = points.every(
    (p) =>
      p.lat > 17 &&
      p.lat < 72 &&
      ((p.lng > -180 && p.lng < -64) || p.lng > 170),
  );
  if (!inUs) return null;
  try {
    const key = (p: { x: number; y: number }) =>
      `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const body = new URLSearchParams({
      geometry: JSON.stringify({
        points: points.map((p) => [p.lng, p.lat]),
        spatialReference: { wkid: 4326 },
      }),
      geometryType: "esriGeometryMultipoint",
      returnFirstValueOnly: "true",
      f: "json",
    });
    const res = await fetch(
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const parsed = (await res.json()) as {
      samples?: Array<{ location?: { x: number; y: number }; value?: string }>;
    };
    if (!Array.isArray(parsed.samples)) return null;
    const byLoc = new Map<string, number>();
    for (const s of parsed.samples) {
      if (!s.location) continue;
      const m = parseFloat(s.value ?? "");
      if (Number.isFinite(m)) byLoc.set(key(s.location), m * METERS_TO_FT);
    }
    const out: number[] = [];
    for (const p of points) {
      const v = byLoc.get(key({ x: p.lng, y: p.lat }));
      if (v === undefined) return null; // gap in coverage — Google takes over
      out.push(v);
    }
    return out;
  } catch {
    return null;
  }
}

export async function sampleFenceElevations(
  runs: LatLng[][],
): Promise<FenceTopoResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };

  const counts = runs.map((r) => r.length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < 2) return { ok: true, runElevationsFt: runs.map(() => []) };
  if (total > MAX_POINTS)
    return { ok: false, reason: "Layout too large for one elevation pass" };

  // Elevation reads are cheap and fire on every layout edit — they get
  // their own generous bucket (riding the 10/hr scan budget used to
  // silently kill all terrain mid-session).
  const rl = await consumeLimit({
    policy: POLICIES.fenceTopo,
    key: `fence-topo:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-topo" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };

  const flat = runs.flat();

  // Lidar bare earth first — see the header comment for why.
  const usgs = await usgsElevationsFt(flat);
  if (usgs) {
    const out: number[][] = [];
    let i = 0;
    for (const c of counts) {
      out.push(usgs.slice(i, i + c));
      i += c;
    }
    return { ok: true, runElevationsFt: out };
  }

  // The vault key may be a browser-restricted key (added for the leads
  // map) that Google denies for server calls — try it first, then fall
  // back to the env key when they differ.
  const vaultKey = await getActiveApiKey("GOOGLE_MAPS");
  const envKey = process.env.GOOGLE_MAPS_API_KEY ?? null;
  const keys = [...new Set([vaultKey, envKey].filter(Boolean))] as string[];
  if (keys.length === 0) return { ok: false, reason: "Google Maps key missing" };

  let body: any = null;
  let lastStatus: string | null = null;
  for (const key of keys) {
    const u = new URL("https://maps.googleapis.com/maps/api/elevation/json");
    u.searchParams.set(
      "locations",
      flat.map((p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join("|"),
    );
    u.searchParams.set("key", key);
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) {
        lastStatus = `HTTP ${res.status}`;
        continue;
      }
      const parsed = (await res.json()) as any;
      if (parsed?.status === "OK" && Array.isArray(parsed.results)) {
        body = parsed;
        break;
      }
      lastStatus = parsed?.status ?? "no response";
      if (lastStatus !== "REQUEST_DENIED") break; // real error — don't spam keys
    } catch {
      lastStatus = "network";
    }
  }
  try {
    if (!body) {
      return {
        ok: false,
        reason:
          lastStatus === "REQUEST_DENIED"
            ? "Google denied the elevation call — enable the “Elevation API” service on your Maps key in the Google Cloud console (APIs & Services → Library), and make sure the key isn’t restricted to browser referrers."
            : `Elevation unavailable (${lastStatus ?? "no response"})`,
      };
    }
    const metersToFt = 3.28084;
    const elevations: number[] = body.results.map((r: any) =>
      typeof r?.elevation === "number" ? r.elevation * metersToFt : NaN,
    );
    // Slice the flat list back into per-run arrays.
    const out: number[][] = [];
    let i = 0;
    for (const c of counts) {
      const chunk = elevations.slice(i, i + c);
      out.push(chunk.some((e) => !Number.isFinite(e)) ? [] : chunk);
      i += c;
    }
    return { ok: true, runElevationsFt: out };
  } catch (e) {
    console.warn("[fence-topo] failed", e instanceof Error ? e.message : e);
    return { ok: false, reason: "Elevation lookup failed" };
  }
}
