/**
 * rates.ts — the contractor's own price book.
 *
 * WHY THIS EXISTS
 * ---------------
 * lib/fence/catalog.ts carries ONE national rate per fence type ($22/LF
 * material + $14/LF labor for cedar privacy, etc). Two contractors
 * quoting the same cedar fence on the same street do not charge the
 * same number: their crew, their lumber yard and their overhead differ.
 * The catalog rate is a sensible STARTING point, not a fact about
 * anyone's business.
 *
 * This module lets a contractor override the catalog's material, labor
 * and walk-gate rates per fence type, and resolves the effective rate
 * the pricing engine actually charges.
 *
 * Two design choices worth keeping:
 *
 * SPARSE STORAGE. Only types the contractor actually changed are
 * stored, and a value equal to the catalog's is dropped rather than
 * saved. A type they never touched keeps tracking the catalog, so a
 * platform-wide price refresh still reaches everyone who has not
 * deliberately opted out of it. "Reset to standard" is a delete, not a
 * write-back of today's number.
 *
 * FROZEN ONTO THE ESTIMATE. Exactly like the market snapshot, the
 * resolved book rides on FenceEstimateConfig.rates and is carried into
 * the saved proposal. Editing the price book therefore never reprices a
 * quote that was already sent — the proposal keeps the numbers the
 * client was shown. Absent book ⇒ catalog rates, which is what every
 * estimate priced at before the price book existed.
 *
 * ORDER OF OPERATIONS. The contractor's rate is the BASE; the market
 * snapshot still scales it (lib/fence/market.ts). A contractor who sets
 * $26/LF has said "this is my national-equivalent rate", and a job in an
 * expensive metro still lands above it.
 */
import { fenceType, FENCE_TYPES, type FenceType, type FenceTypeId } from "./catalog";

/** A per-fence-type override. Any field may be absent — absent means
 *  "use the catalog's number for this one". */
export type FenceRate = {
  /** Material $/LF at the type's default height. */
  materialPerLf?: number;
  /** Install labor $/LF on flat ground. */
  laborPerLf?: number;
  /** Installed price of a single 4' walk gate. Drive gates and custom
   *  widths derive from this, so overriding it moves them too. */
  gateSingle?: number;
};

/** Sparse map of overrides. Missing key ⇒ that type prices at catalog. */
export type RateBook = Partial<Record<FenceTypeId, FenceRate>>;

export type RateField = keyof FenceRate;

export const RATE_FIELDS: RateField[] = [
  "materialPerLf",
  "laborPerLf",
  "gateSingle",
];

/** Sanity rails. A fat-fingered $2,200/LF (cents pasted as dollars) is
 *  the failure mode that turns a $4k quote into a $400k one, so the
 *  ceiling is deliberately far below "technically possible". */
export const RATE_LIMITS: Record<RateField, { min: number; max: number }> = {
  materialPerLf: { min: 0.5, max: 400 },
  laborPerLf: { min: 0.5, max: 400 },
  gateSingle: { min: 25, max: 20000 },
};

export const RATE_LABEL: Record<RateField, string> = {
  materialPerLf: "Material / LF",
  laborPerLf: "Labor / LF",
  gateSingle: "Walk gate",
};

/** The catalog's national rate for a type — what the price book seeds
 *  from and what "Reset to standard" falls back to. */
export function standardRate(id: FenceTypeId): Required<FenceRate> {
  const t = fenceType(id);
  return {
    materialPerLf: t.materialPerLf,
    laborPerLf: t.laborPerLf,
    gateSingle: t.gateSingle,
  };
}

/** The rate actually charged: the contractor's number where they set
 *  one, the catalog's everywhere else. */
export function effectiveRate(
  id: FenceTypeId,
  book?: RateBook,
): Required<FenceRate> {
  const std = standardRate(id);
  const r = book?.[id];
  if (!r) return std;
  return {
    materialPerLf: r.materialPerLf ?? std.materialPerLf,
    laborPerLf: r.laborPerLf ?? std.laborPerLf,
    gateSingle: r.gateSingle ?? std.gateSingle,
  };
}

/**
 * A catalog type with the contractor's rates applied — the single seam
 * the pricing engine reads through. Everything else about the type
 * (spec, spacing, build, labels) is platform truth and untouched: a
 * contractor sets what they CHARGE, not how a fence is built.
 */
export function ratedType(id: FenceTypeId, book?: RateBook): FenceType {
  const t = fenceType(id);
  if (!book?.[id]) return t;
  return { ...t, ...effectiveRate(id, book) };
}

/** Has this type been moved off the catalog at all? */
export function isCustomized(id: FenceTypeId, book?: RateBook): boolean {
  const r = book?.[id];
  return !!r && RATE_FIELDS.some((f) => r[f] !== undefined);
}

/** How far off standard, as a signed fraction (+0.18 = 18% over). Used
 *  to flag a rate that has drifted far enough to be worth a second look
 *  before it goes out on a quote. */
export function driftFromStandard(
  id: FenceTypeId,
  field: RateField,
  book?: RateBook,
): number {
  const std = standardRate(id)[field];
  const eff = effectiveRate(id, book)[field];
  return std > 0 ? eff / std - 1 : 0;
}

/**
 * Normalize anything claiming to be a rate book: drop unknown fence
 * types, non-finite and out-of-range numbers, and any value that just
 * restates the catalog. Returns a fresh sparse book — a type left with
 * no surviving overrides is dropped entirely, which is what keeps
 * "sparse" true over time instead of only at first save.
 */
export function sanitizeRateBook(raw: unknown): RateBook {
  const out: RateBook = {};
  if (!raw || typeof raw !== "object") return out;
  const valid = new Set(FENCE_TYPES.map((t) => t.id as string));
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!valid.has(key) || !val || typeof val !== "object") continue;
    const id = key as FenceTypeId;
    const std = standardRate(id);
    const src = val as Record<string, unknown>;
    const kept: FenceRate = {};
    for (const f of RATE_FIELDS) {
      const n = Number(src[f]);
      if (!Number.isFinite(n)) continue;
      const { min, max } = RATE_LIMITS[f];
      if (n < min || n > max) continue;
      const rounded = Math.round(n * 100) / 100;
      // A value equal to the catalog is not an override — storing it
      // would silently pin this type against future platform updates.
      if (Math.abs(rounded - std[f]) < 0.005) continue;
      kept[f] = rounded;
    }
    if (RATE_FIELDS.some((f) => kept[f] !== undefined)) out[id] = kept;
  }
  return out;
}

/** Everything the settings editor needs to render one row. */
export type RateRow = {
  id: FenceTypeId;
  label: string;
  category: string;
  defaultHeightFt: number;
  standard: Required<FenceRate>;
  effective: Required<FenceRate>;
  customized: boolean;
};

/** The full price book as rows, catalog order — every type present,
 *  customized or not, so the contractor sees their whole book. */
export function rateRows(book?: RateBook): RateRow[] {
  return FENCE_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
    category: t.category,
    defaultHeightFt: t.defaultHeightFt,
    standard: standardRate(t.id),
    effective: effectiveRate(t.id, book),
    customized: isCustomized(t.id, book),
  }));
}
