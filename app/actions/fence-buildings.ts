"use server";

import { getMe } from "@/app/actions/me";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import { fetchBuildingFootprints } from "@/lib/fence/buildings-core";
import type { Pt } from "@/lib/fence/geo";

/**
 * fence-buildings.ts — signed-in wrapper around the Overpass footprint
 * fetch (lib/fence/buildings-core.ts).
 *
 * Deliberately its OWN action, called by the estimator AFTER the scan
 * renders: Overpass latency is 1–9 s (up to two mirrors) and used to sit
 * inside runFenceScan, making every scan feel slow. Now the satellite +
 * parcel land immediately and the house outline pops in a beat later.
 */

export type ScanBuildingsResult = { ok: true; buildings: Pt[][] };

export async function getScanBuildings(input: {
  center: { lat: number; lng: number };
  zoom: number;
}): Promise<ScanBuildingsResult> {
  const me = await getMe();
  if (!me) return { ok: true, buildings: [] };
  const rl = await consumeLimit({
    policy: POLICIES.fenceTopo,
    key: `osm-buildings:${me.user.id}`,
    context: { userId: me.user.id, route: "fence-buildings" },
  });
  if (!rl.ok) return { ok: true, buildings: [] };

  return { ok: true, buildings: await fetchBuildingFootprints(input) };
}
