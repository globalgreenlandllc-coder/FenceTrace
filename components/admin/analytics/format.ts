// Pure formatting helpers for the admin analytics dashboard (client-safe).

export function compact(v: number): string {
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (v >= 1000) {
    const k = v / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(v);
}

export function duration(totalSecs: number): string {
  const s = Math.max(0, Math.round(totalSecs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "just now" · "45s" · "3m" · "2h" — for the live table's Active column. */
export function timeAgo(iso: string, nowMs: number): string {
  const secs = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

/** ISO-3166 alpha-2 → flag emoji ("US" → 🇺🇸). Empty for junk codes. */
export function countryFlag(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const countryNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function countryName(code: string): string {
  try {
    return countryNames?.of(code.trim().toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
