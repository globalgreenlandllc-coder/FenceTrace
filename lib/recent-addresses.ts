/**
 * recent-addresses.ts — one address history for every scan bar.
 *
 * The durable history is server-side (EstimateRun rows via
 * getRecentAddresses); localStorage is the instant mirror so the
 * dropdown works before the server answers (or offline). Both the
 * start page's combobox and the estimator's scan bar read and write
 * through here, so an address scanned in one place shows up in the
 * other.
 *
 * "Remove" never deletes server history (those rows are the scan
 * ledger) — it adds the address to a local hidden list that the merge
 * filters out, so the row stays gone on this device after reloads.
 */

const LOCAL_RECENTS_KEY = "fencescan.recentAddresses";
const HIDDEN_RECENTS_KEY = "fencescan.hiddenAddresses";
const LOCAL_RECENTS_MAX = 8;
const HIDDEN_MAX = 24;

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage may be unavailable (private mode, quota); silently drop.
  }
}

export function readLocalRecents(): string[] {
  const hidden = new Set(readList(HIDDEN_RECENTS_KEY));
  return readList(LOCAL_RECENTS_KEY).filter(
    (a) => !hidden.has(a.toLowerCase()),
  );
}

export function pushLocalRecent(addr: string) {
  if (typeof window === "undefined") return;
  const trimmed = addr.trim();
  if (!trimmed) return;
  const existing = readList(LOCAL_RECENTS_KEY).filter(
    (a) => a.toLowerCase() !== trimmed.toLowerCase(),
  );
  writeList(LOCAL_RECENTS_KEY, [trimmed, ...existing].slice(0, LOCAL_RECENTS_MAX));
  // Scanning an address again is an explicit "I want this one" — unhide it.
  const hidden = readList(HIDDEN_RECENTS_KEY).filter(
    (a) => a !== trimmed.toLowerCase(),
  );
  writeList(HIDDEN_RECENTS_KEY, hidden);
}

export function removeLocalRecent(addr: string) {
  if (typeof window === "undefined") return;
  const key = addr.trim().toLowerCase();
  if (!key) return;
  writeList(
    LOCAL_RECENTS_KEY,
    readList(LOCAL_RECENTS_KEY).filter((a) => a.toLowerCase() !== key),
  );
  const hidden = readList(HIDDEN_RECENTS_KEY).filter((a) => a !== key);
  writeList(HIDDEN_RECENTS_KEY, [key, ...hidden].slice(0, HIDDEN_MAX));
}

/** Server list + local mirror, deduped case-insensitively (server wins
 *  on display form), hidden addresses dropped, capped for the dropdown. */
export function mergeRecents(server: string[], local: string[]): string[] {
  const hidden = new Set(readList(HIDDEN_RECENTS_KEY));
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const a of [...server, ...local]) {
    const k = a.toLowerCase();
    if (seen.has(k) || hidden.has(k)) continue;
    seen.add(k);
    merged.push(a);
    if (merged.length >= LOCAL_RECENTS_MAX) break;
  }
  return merged;
}
