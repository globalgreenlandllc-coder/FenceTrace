"use server";

import { revalidatePath } from "next/cache";
import type { AvailabilityStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "./me";

/**
 * availability.ts — worker-set day availability, read by the owner's calendar.
 *
 * Worker side: a person may be crew for several owners (one Worker row per
 * owner), but they're one human — setting a day writes every Worker row linked
 * to their account, so all their contractors see the same answer.
 *
 * Owner side: read-only, scoped to the owner's own workers.
 *
 * Days are exchanged as "YYYY-MM-DD" strings; the column is a DATE, stored and
 * compared at UTC midnight so timezones never split a day in two.
 */

export type AvailabilityDayStatus = AvailabilityStatus; // "AVAILABLE" | "UNAVAILABLE"

export type CrewAvailabilityEntry = {
  workerId: string;
  /** "YYYY-MM-DD" */
  date: string;
  status: AvailabilityDayStatus;
};

function dayToDate(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The `date` column is a UTC-midnight DATE, but the calendar passes local-time
 * range instants — for a user west of UTC, local Monday 00:00 is Monday 07:00Z,
 * so a naive `gte: rangeStart` drops the row stored at Monday 00:00Z. Widen the
 * window by a day on each side so no boundary day is ever lost; the extra rows
 * are keyed by day string on the client and simply never looked up.
 */
function widenBounds(startIso: string, endIso: string): { start: Date; end: Date } | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// ── Owner side ──────────────────────────────────────────────────────────────

/** Every availability entry for ALL of the owner's workers in the range, so
 *  the calendar can paint any selected crew member without a refetch. */
export async function listCrewAvailability(
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<CrewAvailabilityEntry[]> {
  const me = await getMe();
  if (!me) return [];
  const bounds = widenBounds(rangeStartIso, rangeEndIso);
  if (!bounds) return [];

  const rows = await db.workerAvailability.findMany({
    where: {
      worker: { ownerId: me.user.id },
      date: { gte: bounds.start, lt: bounds.end },
    },
    select: { workerId: true, date: true, status: true },
  });
  return rows.map((r) => ({
    workerId: r.workerId,
    date: dateToDay(r.date),
    status: r.status,
  }));
}

// ── Worker side ─────────────────────────────────────────────────────────────

export type MyAvailabilityDay = {
  /** "YYYY-MM-DD" */
  date: string;
  status: AvailabilityDayStatus;
};

/** The signed-in crew member's own entries in the range (merged across the
 *  Worker rows their account is linked to — they're kept in sync on write). */
export async function listMyAvailability(
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<MyAvailabilityDay[]> {
  const me = await getMe();
  if (!me) return [];
  const bounds = widenBounds(rangeStartIso, rangeEndIso);
  if (!bounds) return [];

  const rows = await db.workerAvailability.findMany({
    where: {
      worker: { userId: me.user.id },
      date: { gte: bounds.start, lt: bounds.end },
    },
    select: { date: true, status: true },
    orderBy: { date: "asc" },
  });
  const byDay = new Map<string, AvailabilityDayStatus>();
  // UNAVAILABLE wins if linked rows ever disagree — never advertise a day the
  // worker blocked somewhere.
  for (const r of rows) {
    const key = dateToDay(r.date);
    if (byDay.get(key) !== "UNAVAILABLE") byDay.set(key, r.status);
  }
  return [...byDay.entries()].map(([date, status]) => ({ date, status }));
}

/**
 * Sets (or clears, with status null) one day for the signed-in crew member,
 * across every Worker row linked to their account.
 */
export async function setMyAvailability(
  day: string,
  status: AvailabilityDayStatus | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const date = dayToDate(day);
    if (!date) return { ok: false, reason: "Invalid date" };

    const workers = await db.worker.findMany({
      where: { userId: me.user.id, status: { not: "DISABLED" } },
      select: { id: true },
    });
    if (workers.length === 0)
      return { ok: false, reason: "No linked crew account" };

    if (status === null) {
      await db.workerAvailability.deleteMany({
        where: { workerId: { in: workers.map((w) => w.id) }, date },
      });
    } else {
      await Promise.all(
        workers.map((w) =>
          db.workerAvailability.upsert({
            where: { workerId_date: { workerId: w.id, date } },
            update: { status },
            create: { workerId: w.id, date, status },
          }),
        ),
      );
    }
    // Only the worker's own portal reads from the RSC cache; the owner's
    // calendar is client-fetched and picks this up on its next poll, so
    // revalidating a cross-session dashboard path here would be dead work.
    revalidatePath("/worker/schedule");
    return { ok: true };
  } catch (e) {
    console.error("[setMyAvailability] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Failed to save availability",
    };
  }
}
