"use client";

/**
 * One shared fetch for the shell chrome (notifications bell +
 * announcement banner), cached at module scope.
 *
 * The shell remounts on every page switch, and each mount used to fire
 * its own actions — serialized by Next ahead of the page's real data.
 * With this cache, a switch within the freshness window paints the bell
 * instantly from memory and fires nothing; both components share a
 * single in-flight request otherwise.
 */
import { getShellData } from "@/app/actions/notifications";

export type ShellData = Awaited<ReturnType<typeof getShellData>>;

let cache: { at: number; data: ShellData } | null = null;
let inflight: Promise<ShellData> | null = null;

export function shellDataCached(maxAgeMs = 30_000): Promise<ShellData> {
  if (cache && Date.now() - cache.at < maxAgeMs) {
    return Promise.resolve(cache.data);
  }
  if (!inflight) {
    inflight = getShellData()
      .then((data) => {
        cache = { at: Date.now(), data };
        inflight = null;
        return data;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

/** Optimistic dismiss: keep a dismissed announcement from resurrecting
 *  out of the cache on the next shell mount. */
export function dropAnnouncementFromCache(id: string): void {
  if (!cache) return;
  cache = {
    ...cache,
    data: {
      ...cache.data,
      announcements: cache.data.announcements.filter((a) => a.id !== id),
    },
  };
}
