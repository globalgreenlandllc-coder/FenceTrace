/**
 * Contractor proposal boilerplate — the data layer. Server-only (used
 * by server actions and the proposal-creation path); the "use server"
 * wrappers in app/actions/proposal-defaults.ts are the only doors the
 * browser gets, and they never take a userId from the caller.
 */
import { db } from "@/lib/db";
import { sampleProposal, type Proposal } from "@/lib/proposal-mock";

export type TermBlock = Proposal["terms"][number];
export type PriceDisplay = "totals" | "split" | "itemized";

export type ProposalDefaults = {
  terms: TermBlock[];
  priceDisplay: PriceDisplay;
  /** True when the contractor has SAVED something — false means the
   *  platform samples are what's showing. */
  customized: boolean;
};

const PRICE_DISPLAYS = new Set<string>(["totals", "split", "itemized"]);

/** Platform samples — the starting point and the signed-out fallback. */
export function stockProposalDefaults(): ProposalDefaults {
  return {
    terms: sampleProposal.terms.map((t) => ({ ...t })),
    priceDisplay: "totals",
    customized: false,
  };
}

/** A term block off the wire, held to shape. Bodies are plain text the
 *  client reads — cap the sizes so a paste-bomb can't balloon the row. */
export function sanitizeTerms(raw: unknown): TermBlock[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TermBlock[] = [];
  for (const t of raw.slice(0, 20)) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
    const body = typeof o.body === "string" ? o.body.trim().slice(0, 4000) : "";
    if (!title || !body) continue;
    out.push({
      id:
        typeof o.id === "string" && o.id
          ? o.id.slice(0, 40)
          : `term-${out.length + 1}`,
      title,
      body,
      enabled: o.enabled !== false,
    });
  }
  return out.length > 0 ? out : null;
}

export function sanitizePriceDisplay(raw: unknown): PriceDisplay {
  return typeof raw === "string" && PRICE_DISPLAYS.has(raw)
    ? (raw as PriceDisplay)
    : "totals";
}

/** The saved defaults for one contractor (samples when nothing saved). */
export async function loadProposalDefaults(
  userId: string,
): Promise<ProposalDefaults> {
  const row = await db.contractorProposalDefaults
    .findUnique({ where: { userId } })
    .catch(() => null);
  if (!row) return stockProposalDefaults();
  const terms = sanitizeTerms(row.terms);
  return {
    terms: terms ?? stockProposalDefaults().terms,
    priceDisplay: sanitizePriceDisplay(row.priceDisplay),
    customized: terms !== null,
  };
}
