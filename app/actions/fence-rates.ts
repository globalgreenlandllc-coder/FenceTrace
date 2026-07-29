"use server";

/**
 * The contractor's own fence price book.
 *
 * The platform baseline lives in lib/fence/catalog.ts (and is mirrored
 * for admins under /admin/material-defaults). This is the per-contractor
 * layer on top of it: what THIS business charges per fence type.
 *
 * Storage is sparse — see lib/fence/rates.ts for why a value equal to
 * the catalog is deleted rather than saved.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import { FENCE_TYPES } from "@/lib/fence/catalog";
import {
  rateRows,
  sanitizeRateBook,
  type RateBook,
  type RateRow,
} from "@/lib/fence/rates";

const VALID_TYPE = new Set<string>(FENCE_TYPES.map((t) => t.id));

/** Read the signed-in contractor's overrides. Never throws for a signed
 *  -out caller — an empty book prices at catalog, which is correct. */
export async function getMyFenceRates(): Promise<RateBook> {
  const me = await getMe();
  if (!me) return {};
  return loadBook(me.user.id);
}

async function loadBook(userId: string): Promise<RateBook> {
  const rows = await db.contractorFenceRate.findMany({ where: { userId } });
  const raw: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!VALID_TYPE.has(r.fenceTypeId)) continue; // a type retired from the catalog
    const one: Record<string, number> = {};
    if (r.materialPerLf != null) one.materialPerLf = r.materialPerLf;
    if (r.laborPerLf != null) one.laborPerLf = r.laborPerLf;
    if (r.gateSingle != null) one.gateSingle = r.gateSingle;
    if (Object.keys(one).length > 0) raw[r.fenceTypeId] = one;
  }
  // Sanitize on the way OUT too: a catalog price change can turn a
  // stored override into a no-op, and it should stop counting as one.
  return sanitizeRateBook(raw);
}

/** The whole book as editor rows — every type, customized or not. */
export async function getMyFenceRateRows(): Promise<RateRow[]> {
  return rateRows(await getMyFenceRates());
}

/**
 * Replace the contractor's book with `book`. The payload is the FULL
 * desired state, so a type the caller omits is reset to catalog — which
 * is what makes "reset" a delete and keeps the table sparse.
 */
export async function saveMyFenceRates(
  book: RateBook,
): Promise<{ ok: boolean; rows: RateRow[]; error?: string }> {
  const me = await getMe();
  if (!me) return { ok: false, rows: rateRows({}), error: "Not signed in" };
  const userId = me.user.id;

  // sanitizeRateBook is the only validation gate: it drops unknown
  // types, non-finite and out-of-range numbers, and anything that just
  // restates the catalog. Whatever survives is safe to persist.
  const clean = sanitizeRateBook(book);
  const wanted = new Set(Object.keys(clean));

  const existing = await db.contractorFenceRate.findMany({
    where: { userId },
    select: { fenceTypeId: true },
  });

  const stale = existing
    .map((r) => r.fenceTypeId)
    .filter((id) => !wanted.has(id));

  await db.$transaction([
    ...(stale.length > 0
      ? [
          db.contractorFenceRate.deleteMany({
            where: { userId, fenceTypeId: { in: stale } },
          }),
        ]
      : []),
    ...Object.entries(clean).map(([fenceTypeId, rate]) => {
      // Null, not undefined: a field the contractor cleared has to go
      // back to NULL in the row so it tracks the catalog again.
      const data = {
        materialPerLf: rate?.materialPerLf ?? null,
        laborPerLf: rate?.laborPerLf ?? null,
        gateSingle: rate?.gateSingle ?? null,
      };
      return db.contractorFenceRate.upsert({
        where: { userId_fenceTypeId: { userId, fenceTypeId } },
        create: { userId, fenceTypeId, ...data },
        update: data,
      });
    }),
  ]);

  revalidatePath("/dashboard/settings");
  return { ok: true, rows: rateRows(clean) };
}

/** Put one fence type back on the catalog's national rate. */
export async function resetFenceRate(
  fenceTypeId: string,
): Promise<{ ok: boolean; rows: RateRow[] }> {
  const me = await getMe();
  if (!me) return { ok: false, rows: rateRows({}) };
  if (VALID_TYPE.has(fenceTypeId)) {
    await db.contractorFenceRate.deleteMany({
      where: { userId: me.user.id, fenceTypeId },
    });
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, rows: rateRows(await loadBook(me.user.id)) };
}

/** Put the entire book back on catalog rates. */
export async function resetAllFenceRates(): Promise<{
  ok: boolean;
  rows: RateRow[];
}> {
  const me = await getMe();
  if (!me) return { ok: false, rows: rateRows({}) };
  await db.contractorFenceRate.deleteMany({ where: { userId: me.user.id } });
  revalidatePath("/dashboard/settings");
  return { ok: true, rows: rateRows({}) };
}

/**
 * The book to FREEZE onto an estimate. Separate from getMyFenceRates so
 * the intent is legible at the call site: quotes carry a snapshot, they
 * do not read live rates at render time.
 */
export async function freezeFenceRatesForEstimate(): Promise<
  RateBook | undefined
> {
  const book = await getMyFenceRates();
  return Object.keys(book).length > 0 ? book : undefined;
}
