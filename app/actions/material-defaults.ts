"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";

export type MaterialDefaultRow = {
  id: string;
  key: string;
  label: string;
  category: "fence" | "gate" | "hardware" | "labor";
  unit: "LF" | "ea" | "lot" | "sq ft";
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

// The platform's fence price book — kept in lockstep with
// lib/fence/catalog.ts (fence systems + walk-gate kits) and the
// pricing-engine extras (tear-out $4/LF, stain $1.10/sq ft, slope
// steps $28, wall anchors $72). Reference material for the admin —
// nothing prices from these rows directly.
const SEED: Omit<MaterialDefaultRow, "id" | "updatedAt" | "updatedBy">[] = [
  // ── Fence systems — installed material, per LF ────────────────
  { key: "fence-cedar-privacy",      label: "Cedar privacy",              category: "fence", unit: "LF", priceCents: 2200, description: "6' standard · + $14/LF install labor", sortOrder: 100 },
  { key: "fence-pt-pine-privacy",    label: "Pressure-treated privacy",   category: "fence", unit: "LF", priceCents: 1600, description: "6' standard · + $13/LF install labor", sortOrder: 110 },
  { key: "fence-board-on-board",     label: "Board-on-board",             category: "fence", unit: "LF", priceCents: 2800, description: "6' standard · + $16/LF install labor", sortOrder: 120 },
  { key: "fence-shadowbox",          label: "Shadowbox",                  category: "fence", unit: "LF", priceCents: 2600, description: "6' standard · + $15/LF install labor", sortOrder: 130 },
  { key: "fence-wood-picket",        label: "Classic wood picket",        category: "fence", unit: "LF", priceCents: 1400, description: "4' standard · + $11/LF install labor", sortOrder: 140 },
  { key: "fence-horizontal-modern",  label: "Horizontal modern",          category: "fence", unit: "LF", priceCents: 3400, description: "6' standard · + $19/LF install labor", sortOrder: 150 },
  { key: "fence-vinyl-privacy",      label: "Vinyl privacy",              category: "fence", unit: "LF", priceCents: 3000, description: "6' standard · + $13/LF install labor", sortOrder: 200 },
  { key: "fence-vinyl-picket",       label: "Vinyl picket",               category: "fence", unit: "LF", priceCents: 2400, description: "4' standard · + $11/LF install labor", sortOrder: 210 },
  { key: "fence-chain-link-galv",    label: "Chain link (galvanized)",    category: "fence", unit: "LF", priceCents:  900, description: "4' standard · + $8/LF install labor", sortOrder: 300 },
  { key: "fence-chain-link-black",   label: "Chain link (black vinyl)",   category: "fence", unit: "LF", priceCents: 1200, description: "4' standard · + $8.50/LF install labor", sortOrder: 310 },
  { key: "fence-aluminum-ornamental",label: "Aluminum ornamental",        category: "fence", unit: "LF", priceCents: 3200, description: "4' standard · + $12/LF install labor", sortOrder: 400 },
  { key: "fence-steel-ornamental",   label: "Steel ornamental",           category: "fence", unit: "LF", priceCents: 4200, description: "5' standard · + $15/LF install labor", sortOrder: 410 },
  { key: "fence-split-rail-2",       label: "Split rail (2-rail)",        category: "fence", unit: "LF", priceCents: 1100, description: "3' standard · + $7/LF install labor", sortOrder: 500 },
  { key: "fence-ranch-rail-3",       label: "Ranch rail (3-rail)",        category: "fence", unit: "LF", priceCents: 1500, description: "4' standard · + $9/LF install labor", sortOrder: 510 },

  // ── Gates — walk gate (4') kit, framed & hung ─────────────────
  { key: "gate-cedar-privacy",       label: "Walk gate — Cedar privacy",            category: "gate", unit: "ea", priceCents: 38500, description: null, sortOrder: 100 },
  { key: "gate-pt-pine-privacy",     label: "Walk gate — Pressure-treated",         category: "gate", unit: "ea", priceCents: 32500, description: null, sortOrder: 110 },
  { key: "gate-board-on-board",      label: "Walk gate — Board-on-board",           category: "gate", unit: "ea", priceCents: 44500, description: null, sortOrder: 120 },
  { key: "gate-shadowbox",           label: "Walk gate — Shadowbox",                category: "gate", unit: "ea", priceCents: 42500, description: null, sortOrder: 130 },
  { key: "gate-wood-picket",         label: "Walk gate — Wood picket",              category: "gate", unit: "ea", priceCents: 28500, description: null, sortOrder: 140 },
  { key: "gate-horizontal-modern",   label: "Walk gate — Horizontal modern",        category: "gate", unit: "ea", priceCents: 54500, description: null, sortOrder: 150 },
  { key: "gate-vinyl-privacy",       label: "Walk gate — Vinyl privacy",            category: "gate", unit: "ea", priceCents: 46500, description: null, sortOrder: 200 },
  { key: "gate-vinyl-picket",        label: "Walk gate — Vinyl picket",             category: "gate", unit: "ea", priceCents: 39500, description: null, sortOrder: 210 },
  { key: "gate-chain-link-galv",     label: "Walk gate — Chain link (galv)",        category: "gate", unit: "ea", priceCents: 26500, description: null, sortOrder: 300 },
  { key: "gate-chain-link-black",    label: "Walk gate — Chain link (black)",       category: "gate", unit: "ea", priceCents: 29500, description: null, sortOrder: 310 },
  { key: "gate-aluminum-ornamental", label: "Walk gate — Aluminum ornamental",      category: "gate", unit: "ea", priceCents: 49500, description: null, sortOrder: 400 },
  { key: "gate-steel-ornamental",    label: "Walk gate — Steel ornamental",         category: "gate", unit: "ea", priceCents: 64500, description: null, sortOrder: 410 },
  { key: "gate-split-rail-2",        label: "Walk gate — Split rail",               category: "gate", unit: "ea", priceCents: 31500, description: null, sortOrder: 500 },
  { key: "gate-ranch-rail-3",        label: "Walk gate — Ranch rail",               category: "gate", unit: "ea", priceCents: 36500, description: null, sortOrder: 510 },

  // ── Install hardware & components ─────────────────────────────
  { key: "hw-post-line",      label: "Line post (8', set-ready)",       category: "hardware", unit: "ea",    priceCents: 2800, description: null, sortOrder: 100 },
  { key: "hw-post-terminal",  label: "Corner / end post",               category: "hardware", unit: "ea",    priceCents: 3400, description: null, sortOrder: 110 },
  { key: "hw-post-gate",      label: "Gate post (heavy-set)",           category: "hardware", unit: "ea",    priceCents: 4200, description: null, sortOrder: 120 },
  { key: "hw-concrete-bag",   label: "Concrete (60 lb bag)",            category: "hardware", unit: "ea",    priceCents:  750, description: "1.5–3 bags per post by height", sortOrder: 130 },
  { key: "hw-post-cap",       label: "Post cap",                        category: "hardware", unit: "ea",    priceCents:  600, description: null, sortOrder: 140 },
  { key: "hw-rail-8",         label: "2×4 rail (8')",                   category: "hardware", unit: "ea",    priceCents:  900, description: null, sortOrder: 150 },
  { key: "hw-picket-cedar",   label: "Cedar picket",                    category: "hardware", unit: "ea",    priceCents:  425, description: null, sortOrder: 160 },
  { key: "hw-picket-pt",      label: "Pressure-treated picket",         category: "hardware", unit: "ea",    priceCents:  310, description: null, sortOrder: 170 },
  { key: "hw-panel-bracket",  label: "Panel brackets (pair)",           category: "hardware", unit: "ea",    priceCents:  550, description: "Prefab vinyl/aluminum panels", sortOrder: 180 },
  { key: "hw-cl-top-rail",    label: "Chain-link top rail",             category: "hardware", unit: "LF",    priceCents:  240, description: null, sortOrder: 200 },
  { key: "hw-tension-bar",    label: "Tension bar",                     category: "hardware", unit: "ea",    priceCents:  900, description: "Terminal posts only", sortOrder: 210 },
  { key: "hw-tension-band",   label: "Tension band",                    category: "hardware", unit: "ea",    priceCents:  160, description: null, sortOrder: 220 },
  { key: "hw-tie-wire",       label: "Aluminum ties (100 ct)",          category: "hardware", unit: "ea",    priceCents:  800, description: null, sortOrder: 230 },
  { key: "hw-fasteners",      label: "Fasteners (5 lb box)",            category: "hardware", unit: "ea",    priceCents: 4200, description: "Ring-shank / coated screws", sortOrder: 240 },
  { key: "hw-hinge-latch",    label: "Gate hinge + latch set",          category: "hardware", unit: "ea",    priceCents: 5800, description: null, sortOrder: 250 },
  { key: "hw-drop-rod",       label: "Drive-gate drop rod",             category: "hardware", unit: "ea",    priceCents: 2400, description: null, sortOrder: 260 },
  { key: "hw-anchor-kit",     label: "Core-drill anchor kit",           category: "hardware", unit: "ea",    priceCents: 2800, description: "Wall-top posts — hardware only", sortOrder: 270 },
  { key: "hw-stain-gallon",   label: "Stain / seal (gallon)",           category: "hardware", unit: "ea",    priceCents: 3800, description: "Covers ~150 sq ft on rough cedar", sortOrder: 280 },

  // ── Labor & job-level rates ───────────────────────────────────
  { key: "labor-job-minimum",  label: "Job minimum (mobilization)",              category: "labor", unit: "lot",   priceCents: 45000, description: null, sortOrder: 100 },
  { key: "labor-removal",      label: "Old fence tear-out & haul-away",          category: "labor", unit: "LF",    priceCents:   400, description: "Matches the proposal engine rate", sortOrder: 110 },
  { key: "labor-stain",        label: "Stain & seal (2 coats, both faces)",      category: "labor", unit: "sq ft", priceCents:   110, description: "Matches the proposal engine rate", sortOrder: 120 },
  { key: "labor-step-section", label: "Slope step — extended post & leveling",   category: "labor", unit: "ea",    priceCents:  2800, description: "Per stepped section on a grade", sortOrder: 130 },
  { key: "labor-wall-mount",   label: "Retaining-wall mount (drill + epoxy + set)", category: "labor", unit: "ea", priceCents:  7200, description: "Per post on the wall span", sortOrder: 140 },
];

export async function listMaterialDefaults(): Promise<MaterialDefaultRow[]> {
  const me = await requireAdmin();
  let rows = await db.materialDefault.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  // One-time migration: DBs seeded before the fence conversion hold the
  // GUTTER price book — meaningless in FenceScan. Replace it with the
  // fence seed on first load (audit-logged).
  const legacy = rows.some(
    (r) =>
      r.category === "gutter" ||
      r.category === "downspout" ||
      r.category === "accessory",
  );
  if (legacy) {
    await db.materialDefault.deleteMany();
    rows = [];
    await db.auditLog.create({
      data: {
        actorId: me.user.id,
        action: "MATERIAL_DEFAULTS_UPDATED",
        targetType: "MaterialDefault",
        targetId: null,
        payload: { migratedFromGutterSeed: true },
      },
    });
  }
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
