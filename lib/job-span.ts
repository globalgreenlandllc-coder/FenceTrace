/**
 * job-span.ts — a crew job's duration in whole working days.
 *
 * There is no separate "durationDays" column: the span IS startsAt→endsAt,
 * where endsAt sits on the job's last day. The count is CALENDAR days in
 * the caller's timezone — Mon 16:00 → Wed 12:00 is 3 days, because the crew
 * is on site Mon, Tue and Wed. An endsAt of exactly midnight belongs to the
 * previous day (Mon 9:00 → Wed 0:00 is 2 days, not 3).
 *
 * Because calendar days are timezone-dependent, the SERVER never recomputes
 * a span: duration edits send (targetDays, currentDays) computed in the
 * user's browser, and the server shifts endsAt by the whole-day delta —
 * see setMyJobDuration / setJobDurationDays.
 */

const DAY_MS = 86_400_000;

/** Hard cap — a "days" input past this is a typo, not a fence job. */
export const MAX_JOB_DAYS = 30;

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days the job touches in the local timezone, ≥ 1.
 *  9:00→13:00 same day = 1; Mon 16:00 → Wed 12:00 = 3; an exact-midnight
 *  endsAt closes the previous day. round() eats DST hour drift. */
export function jobSpanDays(startsAt: string | Date, endsAt: string | Date): number {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (e <= s) return 1;
  const eMid = localMidnight(e);
  let days = Math.round((eMid - localMidnight(s)) / DAY_MS) + 1;
  if (e.getTime() === eMid && days > 1) days -= 1; // exclusive midnight end
  return Math.max(1, Math.min(MAX_JOB_DAYS, days));
}

/** New endsAt for a target day count, keeping the end's clock time: the
 *  end DATE moves by whole days. Runs in the caller's timezone — use on
 *  the client; server-side edits apply the day delta instead. */
export function endsAtForSpan(
  startsAt: string | Date,
  endsAt: string | Date,
  days: number,
): Date {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const target = Math.max(1, Math.min(MAX_JOB_DAYS, Math.round(days)));
  const out = new Date(e);
  out.setDate(out.getDate() + (target - jobSpanDays(s, e)));
  // Degenerate windows (end clock earlier than start clock, target 1) can
  // land the end before the start — keep a sane half-day window instead.
  if (out <= s) return new Date(s.getTime() + 4 * 3_600_000);
  return out;
}

/** 1-based index of `day` (any time within it, local) inside the job's
 *  span — "Day 2 of 3". Clamped to [1, spanDays]. */
export function jobDayIndex(
  day: Date,
  startsAt: string | Date,
  spanDays?: number,
): number {
  const idx =
    Math.round((localMidnight(day) - localMidnight(new Date(startsAt))) / DAY_MS) + 1;
  const hi = Math.max(1, spanDays ?? MAX_JOB_DAYS);
  return Math.max(1, Math.min(hi, idx));
}
