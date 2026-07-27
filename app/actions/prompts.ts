"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import {
  PROMPT_KEYS,
  PROMPT_META,
  type PromptCategory,
  type PromptKey,
} from "@/lib/ai/prompts";
// Code defaults — the canonical prompt each pipeline ships with. Imported
// from the pipeline files (side-effect-free; clients are built per-call,
// not at module load) so "reset to default" + seeding stay in lockstep
// with what the pipeline actually falls back to.
// TODO(fence): the address.* / blueprint.* engine prompts were removed with
// the roof measuring engine; the fence engine will add its defaults here.
import {
  PRICING_SYSTEM as PROPOSAL_PRICING_DEFAULT,
  FENCE_PRICING_SYSTEM as FENCE_PRICING_DEFAULT,
} from "@/lib/ai/price-suggestion";

const DEFAULTS: Record<PromptKey, string> = {
  "proposal.pricing.system": PROPOSAL_PRICING_DEFAULT,
  "proposal.pricing.fence.system": FENCE_PRICING_DEFAULT,
};

export type PromptRow = {
  key: PromptKey;
  label: string;
  category: PromptCategory;
  model: string;
  description: string;
  content: string;
  /** True when the live content differs from the shipped code default. */
  isModified: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }
  return me;
}

/**
 * List all editable prompts. Seeds any missing rows from the code default
 * (robust to adding new prompt keys later), then returns them enriched
 * with the code-side metadata so label/category/model stay authoritative.
 */
export async function listPromptTemplates(): Promise<PromptRow[]> {
  await requireAdmin();
  const existing = await db.promptTemplate.findMany();
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const missing = PROMPT_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    await db.promptTemplate.createMany({
      data: missing.map((k) => ({
        key: k,
        label: PROMPT_META[k].label,
        category: PROMPT_META[k].category,
        content: DEFAULTS[k],
      })),
      skipDuplicates: true,
    });
    const seeded = await db.promptTemplate.findMany({
      where: { key: { in: missing } },
    });
    for (const r of seeded) byKey.set(r.key, r);
  }

  return PROMPT_KEYS.map((key) => {
    const row = byKey.get(key)!;
    const meta = PROMPT_META[key];
    return {
      key,
      label: meta.label,
      category: meta.category,
      model: meta.model,
      description: meta.description,
      content: row.content,
      isModified: row.content.trim() !== DEFAULTS[key].trim(),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  });
}

export async function upsertPromptTemplate(args: {
  key: PromptKey;
  content: string;
}): Promise<{ ok: true }> {
  const me = await requireAdmin();
  if (!PROMPT_KEYS.includes(args.key)) throw new Error("Unknown prompt key");
  if (!args.content.trim()) throw new Error("Prompt content cannot be empty");

  const meta = PROMPT_META[args.key];
  await db.promptTemplate.upsert({
    where: { key: args.key },
    update: {
      content: args.content,
      label: meta.label,
      category: meta.category,
      updatedBy: me.user.id,
    },
    create: {
      key: args.key,
      label: meta.label,
      category: meta.category,
      content: args.content,
      updatedBy: me.user.id,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "PROMPT_TEMPLATE_UPDATED",
      targetType: "PromptTemplate",
      targetId: args.key,
      payload: { key: args.key, length: args.content.length },
    },
  });

  revalidatePath("/admin/prompts");
  return { ok: true };
}

/** Revert a prompt to the code default that ships with the app. Returns
 *  the default content so the editor can update the textarea in place. */
export async function resetPromptTemplate(
  key: PromptKey,
): Promise<{ ok: true; content: string }> {
  const me = await requireAdmin();
  if (!PROMPT_KEYS.includes(key)) throw new Error("Unknown prompt key");

  const meta = PROMPT_META[key];
  await db.promptTemplate.upsert({
    where: { key },
    update: {
      content: DEFAULTS[key],
      label: meta.label,
      category: meta.category,
      updatedBy: me.user.id,
    },
    create: {
      key,
      label: meta.label,
      category: meta.category,
      content: DEFAULTS[key],
      updatedBy: me.user.id,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "PROMPT_TEMPLATE_UPDATED",
      targetType: "PromptTemplate",
      targetId: key,
      payload: { key, reset: true },
    },
  });

  revalidatePath("/admin/prompts");
  return { ok: true, content: DEFAULTS[key] };
}
