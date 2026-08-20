import { test } from "node:test";
import assert from "node:assert/strict";
import { jobSpanDays, endsAtForSpan, jobDayIndex, MAX_JOB_DAYS } from "./job-span.ts";

// Local-time constructors — the module counts calendar days in the
// caller's zone, so tests build dates the same way.
const d = (y: number, m: number, day: number, h = 0, min = 0) =>
  new Date(y, m - 1, day, h, min);

test("same-day window is 1 day", () => {
  assert.equal(jobSpanDays(d(2026, 8, 17, 9), d(2026, 8, 17, 13)), 1);
});

test("Mon 16:00 → Wed 12:00 touches 3 calendar days", () => {
  assert.equal(jobSpanDays(d(2026, 8, 17, 16), d(2026, 8, 19, 12)), 3);
});

test("exact-midnight end closes the previous day", () => {
  assert.equal(jobSpanDays(d(2026, 8, 17, 9), d(2026, 8, 19, 0)), 2);
});

test("inverted window clamps to 1", () => {
  assert.equal(jobSpanDays(d(2026, 8, 19), d(2026, 8, 17)), 1);
});

test("span is capped at MAX_JOB_DAYS", () => {
  assert.equal(jobSpanDays(d(2026, 1, 1, 8), d(2026, 12, 31, 17)), MAX_JOB_DAYS);
});

test("endsAtForSpan grows a 1-day job to 3 days keeping the clock", () => {
  const s = d(2026, 8, 17, 8);
  const e = d(2026, 8, 17, 16);
  const out = endsAtForSpan(s, e, 3);
  assert.equal(jobSpanDays(s, out), 3);
  assert.equal(out.getHours(), 16);
});

test("endsAtForSpan shrinks back to 1 day", () => {
  const s = d(2026, 8, 17, 8);
  const e = d(2026, 8, 19, 16);
  const out = endsAtForSpan(s, e, 1);
  assert.equal(jobSpanDays(s, out), 1);
});

test("endsAtForSpan never lands the end before the start", () => {
  // End clock earlier than start clock + target 1 → degenerate; falls
  // back to a half-day window.
  const s = d(2026, 8, 17, 14);
  const e = d(2026, 8, 19, 9);
  const out = endsAtForSpan(s, e, 1);
  assert.ok(out > s);
  assert.equal(jobSpanDays(s, out), 1);
});

test("jobDayIndex labels Day 1..N and clamps outside the span", () => {
  const s = d(2026, 8, 17, 8);
  assert.equal(jobDayIndex(d(2026, 8, 17, 23), s, 3), 1);
  assert.equal(jobDayIndex(d(2026, 8, 18, 0, 30), s, 3), 2);
  assert.equal(jobDayIndex(d(2026, 8, 19, 12), s, 3), 3);
  assert.equal(jobDayIndex(d(2026, 8, 25), s, 3), 3); // clamped high
  assert.equal(jobDayIndex(d(2026, 8, 10), s, 3), 1); // clamped low
});
