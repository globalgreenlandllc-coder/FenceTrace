"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";

export type MaterialDefaultRow = {
  id: string;
  key: string;
  label: string;
  category: "gutter" | "downspout" | "accessory" | "labor";
  unit: "LF" | "ea" | "lot";
  priceCents: number;
  description: string | null;
  sortOrder: number;
  updatedAt: string;
  updatedBy: string | null;
};

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }
  return me;
}

const SEED: Omit<MaterialDefaultRow, "id" | "updatedAt" | "updatedBy">[] = [
  // ── Gutters (per LF) ──────────────────────────────────────────
  { key: "gutter-5-kstyle-aluminum",    label: '5" K-style Aluminum',    category: "gutter",   unit: "LF",  priceCents:  850, description: null, sortOrder: 100 },
  { key: "gutter-6-kstyle-aluminum",    label: '6" K-style Aluminum',    category: "gutter",   unit: "LF",  priceCents: 1200, description: null, sortOrder: 110 },
  { key: "gutter-7-kstyle-aluminum",    label: '7" K-style Aluminum',    category: "gutter",   unit: "LF",  priceCents: 1650, description: null, sortOrder: 120 },
  { key: "gutter-5-halfround-aluminum", label: '5" Half-round Aluminum', category: "gutter",   unit: "LF",  priceCents: 1100, description: null, sortOrder: 130 },
  { key: "gutter-6-halfround-aluminum", label: '6" Half-round Aluminum', category: "gutter",   unit: "LF",  priceCents: 1400, description: null, sortOrder: 140 },
  { key: "gutter-7-halfround-aluminum", label: '7" Half-round Aluminum', category: "gutter",   unit: "LF",  priceCents: 1900, description: null, sortOrder: 150 },
  { key: "gutter-5-kstyle-steel",       label: '5" K-style Steel',       category: "gutter",   unit: "LF",  priceCents: 1150, description: null, sortOrder: 200 },
  { key: "gutter-6-kstyle-steel",       label: '6" K-style Steel',       category: "gutter",   unit: "LF",  priceCents: 1475, description: null, sortOrder: 210 },
  { key: "gutter-7-kstyle-steel",       label: '7" K-style Steel',       category: "gutter",   unit: "LF",  priceCents: 1900, description: null, sortOrder: 220 },
  { key: "gutter-5-halfround-steel",    label: '5" Half-round Steel',    category: "gutter",   unit: "LF",  priceCents: 1400, description: null, sortOrder: 230 },
  { key: "gutter-6-halfround-steel",    label: '6" Half-round Steel',    category: "gutter",   unit: "LF",  priceCents: 1750, description: null, sortOrder: 240 },
  { key: "gutter-7-halfround-steel",    label: '7" Half-round Steel',    category: "gutter",   unit: "LF",  priceCents: 2200, description: null, sortOrder: 250 },
  { key: "gutter-5-kstyle-copper",      label: '5" K-style Copper',      category: "gutter",   unit: "LF",  priceCents: 2800, description: null, sortOrder: 300 },
  { key: "gutter-6-kstyle-copper",      label: '6" K-style Copper',      category: "gutter",   unit: "LF",  priceCents: 3200, description: null, sortOrder: 310 },
  { key: "gutter-7-kstyle-copper",      label: '7" K-style Copper',      category: "gutter",   unit: "LF",  priceCents: 3900, description: null, sortOrder: 320 },
  { key: "gutter-5-halfround-copper",   label: '5" Half-round Copper',   category: "gutter",   unit: "LF",  priceCents: 3000, description: null, sortOrder: 330 },
  { key: "gutter-6-halfround-copper",   label: '6" Half-round Copper',   category: "gutter",   unit: "LF",  priceCents: 3600, description: null, sortOrder: 340 },
  { key: "gutter-7-halfround-copper",   label: '7" Half-round Copper',   category: "gutter",   unit: "LF",  priceCents: 4400, description: null, sortOrder: 350 },

  // ── Downspouts (per LF) ───────────────────────────────────────
  { key: "downspout-2x3",      label: '2"×3" Rectangular',  category: "downspout", unit: "LF", priceCents:  750, description: null, sortOrder: 100 },
  { key: "downspout-3x4",      label: '3"×4" Rectangular',  category: "downspout", unit: "LF", priceCents:  900, description: null, sortOrder: 110 },
  { key: "downspout-round-3",  label: '3" Round',           category: "downspout", unit: "LF", priceCents: 1200, description: null, sortOrder: 120 },
  { key: "downspout-round-4",  label: '4" Round',           category: "downspout", unit: "LF", priceCents: 1450, description: null, sortOrder: 130 },

  // ── Accessories (per ea / per LF) ─────────────────────────────
  { key: "accessory-outside-corner", label: "Outside Mitered Corner",   category: "accessory", unit: "ea", priceCents: 2200, description: null, sortOrder: 100 },
  { key: "accessory-inside-corner",  label: "Inside Mitered Corner",    category: "accessory", unit: "ea", priceCents: 2400, description: null, sortOrder: 110 },
  { key: "accessory-end-cap",        label: "End Cap",                  category: "accessory", unit: "ea", priceCents:  600, description: null, sortOrder: 120 },
  { key: "accessory-hidden-hanger",  label: "Hidden Hanger",            category: "accessory", unit: "ea", priceCents:  325, description: "1 per 24 inches", sortOrder: 130 },
  { key: "accessory-downspout-elbow",label: "Downspout Elbow",          category: "accessory", unit: "ea", priceCents:  450, description: null, sortOrder: 140 },
  { key: "accessory-gutter-guard",   label: "Micro-mesh Gutter Guard",  category: "accessory", unit: "LF", priceCents:  900, description: null, sortOrder: 200 },

  // ── Labor ─────────────────────────────────────────────────────
  { key: "labor-base-fee",          label: "Job minimum (mobilization)", category: "labor", unit: "lot", priceCents: 25000, description: null, sortOrder: 100 },
  { key: "labor-removal-per-lf",    label: "Existing gutter removal",    category: "labor", unit: "LF",  priceCents:   200, description: null, sortOrder: 110 },
];

export async function listMaterialDefaults(): Promise<MaterialDefaultRow[]> {
  await requireAdmin();
  let rows = await db.materialDefault.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  if (rows.length === 0) {
    await db.materialDefault.createMany({ data: SEED });
    rows = await db.materialDefault.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    });
  }
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    category: r.category as MaterialDefaultRow["category"],
    unit: r.unit as MaterialDefaultRow["unit"],
    priceCents: r.priceCents,
    description: r.description,
    sortOrder: r.sortOrder,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  }));
}

export async function upsertMaterialDefaults(
  rows: Array<{
    id?: string;
    key: string;
    label: string;
    category: MaterialDefaultRow["category"];
    unit: MaterialDefaultRow["unit"];
    priceCents: number;
    description: string | null;
    sortOrder: number;
  }>,
): Promise<{ ok: true; count: number }> {
  const me = await requireAdmin();

  for (const r of rows) {
    if (!r.label.trim()) throw new Error(`Label required for ${r.key}`);
    if (!Number.isInteger(r.priceCents) || r.priceCents < 0) {
      throw new Error(`Bad price for ${r.key}`);
    }
  }

  await db.$transaction(
    rows.map((r) =>
      db.materialDefault.upsert({
        where: { key: r.key },
        update: {
          label: r.label,
          category: r.category,
          unit: r.unit,
          priceCents: r.priceCents,
          description: r.description,
          sortOrder: r.sortOrder,
          updatedBy: me.user.id,
        },
        create: {
          key: r.key,
          label: r.label,
          category: r.category,
          unit: r.unit,
          priceCents: r.priceCents,
          description: r.description,
          sortOrder: r.sortOrder,
          updatedBy: me.user.id,
        },
      }),
    ),
  );

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "MATERIAL_DEFAULTS_UPDATED",
      targetType: "MaterialDefault",
      targetId: null,
      payload: { count: rows.length, keys: rows.map((r) => r.key) },
    },
  });

  revalidatePath("/admin/material-defaults");
  return { ok: true, count: rows.length };
}

export async function deleteMaterialDefault(
  id: string,
): Promise<{ ok: true }> {
  const me = await requireAdmin();
  const existing = await db.materialDefault.findUnique({ where: { id } });
  if (!existing) throw new Error("Not found");

  await db.materialDefault.delete({ where: { id } });
  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "MATERIAL_DEFAULTS_UPDATED",
      targetType: "MaterialDefault",
      targetId: id,
      payload: { deleted: true, key: existing.key, label: existing.label },
    },
  });
  revalidatePath("/admin/material-defaults");
  return { ok: true };
}

export async function resetMaterialDefaultsToCanonical(): Promise<{
  ok: true;
  count: number;
}> {
  const me = await requireAdmin();
  await db.materialDefault.deleteMany();
  await db.materialDefault.createMany({ data: SEED });
  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "MATERIAL_DEFAULTS_UPDATED",
      targetType: "MaterialDefault",
      targetId: null,
      payload: { reset: true, count: SEED.length },
    },
  });
  revalidatePath("/admin/material-defaults");
  return { ok: true, count: SEED.length };
}
