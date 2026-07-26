"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  DEFAULT_PLAN_PRICING,
  PRICING_SETTING_KEY,
  getPlanPricing,
  validatePricingInput,
  type PlanPricing,
} from "@/lib/plan-pricing";
import { getMe } from "./me";

// Admin actions for /admin/pricing. The layout guard does not cover
// server actions, so every mutation re-checks the role itself (same
// contract as app/actions/prompts.ts).

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }
  return me;
}

export type PlanPricingAdmin = {
  current: PlanPricing;
  defaults: PlanPricing;
  /** True when a DB override row exists (even if identical to defaults). */
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getPlanPricingAdmin(): Promise<PlanPricingAdmin> {
  await requireAdmin();
  const [current, row] = await Promise.all([
    getPlanPricing(),
    db.platformSetting.findUnique({ where: { key: PRICING_SETTING_KEY } }),
  ]);
  return {
    current,
    defaults: DEFAULT_PLAN_PRICING,
    overridden: !!row,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export type SavePricingResult =
  | { ok: true; saved: PlanPricing }
  | { ok: false; errors: string[] };

export async function savePlanPricing(input: unknown): Promise<SavePricingResult> {
  const me = await requireAdmin();

  const { config, errors } = validatePricingInput(input);
  if (!config) return { ok: false, errors };

  await db.platformSetting.upsert({
    where: { key: PRICING_SETTING_KEY },
    create: { key: PRICING_SETTING_KEY, value: config, updatedBy: me.user.id },
    update: { value: config, updatedBy: me.user.id },
  });

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "PRICING_UPDATED",
      targetType: "PlatformSetting",
      targetId: PRICING_SETTING_KEY,
      payload: {
        priceCents: config.pro.priceCents,
        includedCredits: config.pro.includedCredits,
        freeBlueprintCredits: config.free.blueprintCredits,
        packs: config.packs.map((p) => `${p.credits}/${p.amountCents}`),
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/sign-up");
  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/pricing");
  return { ok: true, saved: config };
}

export async function resetPlanPricing(): Promise<{ ok: true; defaults: PlanPricing }> {
  const me = await requireAdmin();

  await db.platformSetting.deleteMany({ where: { key: PRICING_SETTING_KEY } });
  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "PRICING_UPDATED",
      targetType: "PlatformSetting",
      targetId: PRICING_SETTING_KEY,
      payload: { reset: true },
    },
  });

  revalidatePath("/");
  revalidatePath("/sign-up");
  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/pricing");
  return { ok: true, defaults: DEFAULT_PLAN_PRICING };
}
