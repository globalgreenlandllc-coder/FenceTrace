"use server";

import { getMe } from "@/app/actions/me";
import { getActiveApiKey } from "@/lib/api-keys";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import type { LatLng } from "@/lib/fence/geo";

/**
 * fence-topo.ts — terrain along the drawn fence, via the Google
 * Elevation API (same key that powers geocoding + the satellite tile;
 * enable "Elevation API" on the key's Cloud project if calls 403).
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

  // The vault key may be a browser-restricted key (added for the leads
  // map) that Google denies for server calls — try it first, then fall
  // back to the env key when they differ.
  const vaultKey = await getActiveApiKey("GOOGLE_MAPS");
  const envKey = process.env.GOOGLE_MAPS_API_KEY ?? null;
  const keys = [...new Set([vaultKey, envKey].filter(Boolean))] as string[];
  if (keys.length === 0) return { ok: false, reason: "Google Maps key missing" };

  const flat = runs.flat();
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
