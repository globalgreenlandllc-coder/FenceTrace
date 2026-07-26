/**
 * Local calendar-day key, "YYYY-MM-DD", from a Date's LOCAL components.
 *
 * This is the single source of truth for the availability day key on the
 * client. It must stay byte-compatible with the server's day strings in
 * app/actions/availability.ts (which derive the same "YYYY-MM-DD" from the
 * UTC-midnight DATE column): both name the same calendar day, so a lookup
 * `availabilityMap.get(dayKey(cellDate))` hits. Never "simplify" this to
 * `toISOString().slice(0,10)` — that switches to UTC and breaks the lookup for
 * every user not on UTC.
 */
export function dayKey(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`;
}
