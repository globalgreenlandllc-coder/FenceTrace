"use server";

/**
 * The contractor's proposal boilerplate — scope of work, warranty,
 * payment, scheduling, exclusions — plus the default client price
 * display. Written ONCE in Settings; every new estimate stamps these
 * on automatically, so the terms a contractor spent an evening getting
 * right go out with every proposal instead of the platform samples.
 *
 * These actions never take a userId — the signed-in session is the
 * only identity they act on. The data layer lives in
 * lib/proposal-defaults.ts.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import {
  loadProposalDefaults,
  sanitizePriceDisplay,
  sanitizeTerms,
  stockProposalDefaults,
  type PriceDisplay,
  type ProposalDefaults,
  type TermBlock,
} from "@/lib/proposal-defaults";

/** Read the signed-in contractor's defaults (platform samples when
 *  nothing is saved). Never throws for a signed-out caller. */
export async function getMyProposalDefaults(): Promise<ProposalDefaults> {
  const me = await getMe();
  if (!me) return stockProposalDefaults();
  return loadProposalDefaults(me.user.id);
}

/** Save the full desired state (terms + price display). */
export async function saveMyProposalDefaults(input: {
  terms: TermBlock[];
  priceDisplay: PriceDisplay;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Sign in to save your terms." };
  const terms = sanitizeTerms(input.terms);
  if (!terms)
    return {
      ok: false,
      reason: "At least one term with a title and body is required.",
    };
  const priceDisplay = sanitizePriceDisplay(input.priceDisplay);
  await db.contractorProposalDefaults.upsert({
    where: { userId: me.user.id },
    create: { userId: me.user.id, terms, priceDisplay },
    update: { terms, priceDisplay },
  });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Back to the platform samples. */
export async function resetMyProposalDefaults(): Promise<{ ok: boolean }> {
  const me = await getMe();
  if (!me) return { ok: false };
  await db.contractorProposalDefaults
    .delete({ where: { userId: me.user.id } })
    .catch(() => null); // nothing saved = already reset
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
