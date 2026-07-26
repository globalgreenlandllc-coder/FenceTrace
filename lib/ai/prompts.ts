import "server-only";
import { db } from "@/lib/db";

/**
 * Admin-editable AI prompts.
 *
 * Each estimation pipeline is driven by a large system prompt that lives
 * as a hardcoded constant in code (the canonical DEFAULT). An admin can
 * override any of these from /admin/prompts; the override is stored in
 * the `prompt_templates` table keyed by `PromptKey`. `getPrompt(key,
 * fallback)` returns the DB override when present, else the code default
 * — so the pipeline always works, even with an empty table or a DB
 * hiccup, and edits take effect live without a redeploy.
 *
 * Only the STATIC system prompts are exposed (no runtime `{placeholder}`
 * interpolation lives in them), so an edit can't break the per-run data
 * the pipelines still inject as separate user/constraint messages.
 */
// TODO(fence): the address.* / blueprint.* prompt keys drove the removed
// roof/blueprint measuring engine and were deleted with it. The fence engine
// will register its own keys here. Stale rows for old keys may linger in the
// prompt_templates table — listPromptTemplates only surfaces PROMPT_KEYS, so
// they are ignored.
export type PromptKey = "proposal.pricing.system";

export const PROMPT_KEYS: PromptKey[] = ["proposal.pricing.system"];

export type PromptCategory = "address" | "blueprint" | "proposal";

export const PROMPT_META: Record<
  PromptKey,
  { label: string; category: PromptCategory; model: string; description: string }
> = {
  "proposal.pricing.system": {
    label: "AI market price (by location)",
    category: "proposal",
    model: "Claude Sonnet 5",
    description:
      "Drives the 'AI recommended price' switch in the proposal builder: given the job's address, measurements, and EVERY package's fence spec, one call prices all tiers (good/better/best) for the local market with a low–high range per tier and short reasoning. Contractor-facing only — never shown to the client. ⚠ An override saved here SHADOWS the code default — reset after engine updates.",
  },
};

/**
 * Resolve a prompt: DB override → code default. Never throws — a DB error
 * falls back to the hardcoded default so an estimate can't fail just
 * because the prompt store is unreachable.
 *
 * `requiredMarkers`: substrings the engine DEPENDS on the prompt teaching
 * (field names like "eave_passes_in_front", block tags like "<stories>").
 * An override saved before those blocks existed silently degrades every
 * read it drives — the Woodinville run lost all eave-in-front + stories
 * data to a stale elevation override. When any marker is missing, the
 * override is treated as STALE: the code default is used and the caller
 * gets `stale: true` to surface it ("reset the override at /admin/prompts").
 */
export async function getPrompt(
  key: PromptKey,
  fallback: string,
  opts?: { requiredMarkers?: string[] },
): Promise<string> {
  return (await getPromptWithMeta(key, fallback, opts)).content;
}

export async function getPromptWithMeta(
  key: PromptKey,
  fallback: string,
  opts?: { requiredMarkers?: string[] },
): Promise<{ content: string; source: "override" | "default"; stale: boolean }> {
  try {
    const row = await db.promptTemplate.findUnique({ where: { key } });
    if (row && row.content.trim().length > 0) {
      const missing = (opts?.requiredMarkers ?? []).filter(
        (m) => !row.content.includes(m),
      );
      if (missing.length === 0) {
        return { content: row.content, source: "override", stale: false };
      }
      console.warn(
        `[prompts] ${key} override is STALE (missing: ${missing.join(", ")}) — using the code default. Re-save or reset it at /admin/prompts.`,
      );
      return { content: fallback, source: "default", stale: true };
    }
  } catch (e) {
    console.warn(`[prompts] getPrompt(${key}) — using code default:`, e);
  }
  return { content: fallback, source: "default", stale: false };
}
