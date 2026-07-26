import "server-only";
import { LeadStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getActiveApiKey } from "@/lib/api-keys";
import { fetchSocrataPermits, RawPermitData } from "@/lib/leads/adapters/socrata";
import { fetchArcgisPermits } from "@/lib/leads/adapters/arcgis";
import { cityRegistry } from "@/lib/leads/adapters/cities";
import { analyzePermit } from "@/lib/leads/ai-normalizer";

/**
 * Shared multi-city permit sync routine. Lives outside the route file
 * so both the cron GET handler and the admin "Sync now" POST handler
 * can call it — Next.js route files can only export HTTP method
 * handlers and a small set of config keys, so anything reusable has
 * to live in lib/.
 */

export type SyncLeadsResult = {
  success: true;
  added: number;
  updated: number;
  cities: { city: string; added: number; updated: number; fetched: number }[];
};

// Deterministic, AI-free summary for permits where the adapter has already
// parsed a work-class + fixtures list. The LLM consistently echoes Bellevue-
// style templated descriptions back verbatim no matter how the prompt is
// framed — this is faster, free, and predictable.
function deterministicSummary(p: RawPermitData): string | null {
  if (!p.workClass || !p.fixtures) return null;
  const wc = p.workClass.toLowerCase();
  let verb: string;
  if (wc.includes("new structure")) verb = "New construction";
  else if (wc.includes("addition")) verb = "Addition";
  else if (wc.includes("alteration")) verb = "Alteration";
  else if (wc.includes("repair") || wc.includes("replacement")) verb = "Replace/repair";
  else if (wc.includes("demolition")) verb = "Demolition";
  else verb = p.workClass;

  const bt = (p.buildingType ?? "")
    .replace(/\/Duplex/i, "")
    .replace(/Multifamily/i, "multifamily")
    .replace(/^Commercial$/i, "commercial")
    .toLowerCase()
    .trim();

  const items = p.fixtures
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fx = items.slice(0, 3).join(", ").toLowerCase();
  const extra = items.length > 3 ? `, +${items.length - 3} more` : "";

  const head = bt ? `${verb} on ${bt}` : verb;
  return `${head}: ${fx}${extra}`.slice(0, 120);
}

const AI_CONCURRENCY = 5;

function mapStatusToEnum(rawStatus: string): LeadStatus {
  const s = rawStatus.toUpperCase();
  if (s.includes("APPL")) return LeadStatus.APPLIED;
  if (s.includes("REVIEW")) return LeadStatus.UNDER_REVIEW;
  if (s.includes("ISSUE")) return LeadStatus.ISSUED;
  if (s.includes("INSPECT")) return LeadStatus.INSPECTION;
  if (s.includes("FINAL") || s.includes("CLOSE")) return LeadStatus.FINALED;
  return LeadStatus.UNKNOWN;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function syncPermits(rawPermits: RawPermitData[]) {
  if (rawPermits.length === 0) return { added: 0, updated: 0 };

  const existing = await db.lead.findMany({
    where: {
      OR: rawPermits.map((p) => ({
        sourceCity: p.sourceCity,
        sourceId: p.sourceId,
      })),
    },
    select: {
      id: true,
      sourceId: true,
      sourceCity: true,
      status: true,
      originalDescription: true,
      buildingType: true,
      projectKind: true,
      workClass: true,
      fixtures: true,
      contractorName: true,
      ownerName: true,
      issuedDate: true,
      housingUnits: true,
      developmentType: true,
      aiSummary: true,
      aiRelevance: true,
    },
  });
  const existingMap = new Map(existing.map((e) => [`${e.sourceCity}:${e.sourceId}`, e]));

  const newPermits: RawPermitData[] = [];
  // Backfill payload for existing rows that are missing any of the smarter fields.
  const backfillTargets: Array<{
    permit: RawPermitData;
    existing: (typeof existing)[number];
    mappedStatus: LeadStatus;
  }> = [];

  for (const permit of rawPermits) {
    const key = `${permit.sourceCity}:${permit.sourceId}`;
    const exist = existingMap.get(key);
    const mappedStatus = mapStatusToEnum(permit.status);
    if (exist) {
      // "Stale" buildingType: earlier adapter versions stored either the
      // mapped bucket ("Residential"/"Non-Residential") or Tacoma's
      // permit-category text ("Building", "Right-of-Way", etc.) instead of
      // the real building class. Replace those when we have a fresh value.
      const STALE_BUILDING_TYPES = new Set([
        "Residential",
        "Non-Residential",
        "Building",
        "Right-of-Way",
        "ePermit",
        "Utility Connection",
        "Site",
        "Sign",
      ]);
      const buildingTypeIsStale =
        permit.buildingType != null &&
        permit.buildingType !== exist.buildingType &&
        (exist.buildingType == null || STALE_BUILDING_TYPES.has(exist.buildingType));

      // projectKind: now that our adapters are smarter, trust the latest
      // adapter output. This field isn't operator-editable in the UI so
      // overwriting is safe — and avoids leaving misclassifications stuck.
      const projectKindIsStale =
        permit.projectKind != null && permit.projectKind !== exist.projectKind;

      // Workclass/fixtures are pure source-derived too — always refresh.
      const workClassIsStale =
        permit.workClass != null && permit.workClass !== exist.workClass;
      const fixturesIsStale =
        permit.fixtures != null && permit.fixtures !== exist.fixtures;

      const needsBackfill =
        exist.status !== mappedStatus ||
        buildingTypeIsStale ||
        projectKindIsStale ||
        workClassIsStale ||
        fixturesIsStale ||
        (exist.contractorName == null && permit.contractorName != null) ||
        (exist.ownerName == null && permit.ownerName != null) ||
        (exist.issuedDate == null && permit.issuedDate != null) ||
        (exist.housingUnits == null && permit.housingUnits != null) ||
        (exist.developmentType == null && permit.developmentType != null) ||
        exist.aiSummary == null ||
        exist.aiRelevance == null;
      if (needsBackfill) {
        backfillTargets.push({ permit, existing: exist, mappedStatus });
      }
    } else {
      newPermits.push(permit);
    }
  }

  // For new permits AND existing-but-stale-AI ones, run analyzePermit once.
  // Stale = missing summary/relevance OR work class has changed (which
  // usually means our previous summary was based on a misclassification).
  const aiTargets = [
    ...newPermits.map((p) => ({ kind: "new" as const, permit: p })),
    ...backfillTargets
      .filter(
        (b) =>
          b.existing.aiSummary == null ||
          b.existing.aiRelevance == null ||
          (b.permit.workClass != null && b.permit.workClass !== b.existing.workClass),
      )
      .map((b) => ({ kind: "backfill" as const, permit: b.permit, existing: b.existing })),
  ];
  const aiResults = await mapWithConcurrency(aiTargets, AI_CONCURRENCY, async (t) => {
    const insight = await analyzePermit(
      t.permit.originalDescription,
      t.permit.buildingType,
    );
    // Override AI's verbose echo with a clean deterministic summary when we
    // have parsed work-class + fixtures from the adapter. Keep AI's trade +
    // relevance — those still benefit from the model.
    const local = deterministicSummary(t.permit);
    if (local) insight.summary = local;
    return { ...t, insight };
  });
  const insightByKey = new Map(
    aiResults.map((r) => [`${r.permit.sourceCity}:${r.permit.sourceId}`, r.insight]),
  );

  let addedCount = 0;
  const toCreate = newPermits.map((permit) => {
    const insight = insightByKey.get(`${permit.sourceCity}:${permit.sourceId}`)!;
    return {
      sourceId: permit.sourceId,
      sourceCity: permit.sourceCity,
      address: permit.address,
      originalDescription: permit.originalDescription,
      categorizedTrade: insight.trade,
      aiSummary: insight.summary,
      aiRelevance: insight.relevance,
      buildingType: permit.buildingType ?? null,
      projectKind: permit.projectKind ?? null,
      workClass: permit.workClass ?? null,
      fixtures: permit.fixtures ?? null,
      contractorName: permit.contractorName ?? null,
      ownerName: permit.ownerName ?? null,
      issuedDate: permit.issuedDate ?? null,
      housingUnits: permit.housingUnits ?? null,
      developmentType: permit.developmentType ?? null,
      status: mapStatusToEnum(permit.status),
      latitude: permit.latitude,
      longitude: permit.longitude,
      projectValue: permit.projectValue,
    };
  });
  if (toCreate.length > 0) {
    const created = await db.lead.createMany({ data: toCreate, skipDuplicates: true });
    addedCount = created.count;
  }

  // Apply backfills serially-batched so we don't fan out hundreds of writes.
  await Promise.all(
    backfillTargets.map(({ permit, existing: ex, mappedStatus }) => {
      const insightKey = `${permit.sourceCity}:${permit.sourceId}`;
      const insight = insightByKey.get(insightKey);
      // Overwrite buildingType if we now have a more specific value (e.g.
      // "Single Family/Duplex" replacing the old broad "Residential").
      const STALE_BUILDING_TYPES = new Set([
        "Residential",
        "Non-Residential",
        "Building",
        "Right-of-Way",
        "ePermit",
        "Utility Connection",
        "Site",
        "Sign",
      ]);
      const shouldUpdateBuildingType =
        permit.buildingType != null &&
        permit.buildingType !== ex.buildingType &&
        (ex.buildingType == null || STALE_BUILDING_TYPES.has(ex.buildingType));

      // Trust adapter output for source-derived fields; fill operator-
      // editable fields only when null.
      const shouldUpdateProjectKind =
        permit.projectKind != null && permit.projectKind !== ex.projectKind;
      const shouldUpdateWorkClass =
        permit.workClass != null && permit.workClass !== ex.workClass;
      const shouldUpdateFixtures =
        permit.fixtures != null && permit.fixtures !== ex.fixtures;

      return db.lead.update({
        where: { id: ex.id },
        data: {
          status: mappedStatus,
          ...(shouldUpdateBuildingType ? { buildingType: permit.buildingType } : {}),
          ...(shouldUpdateProjectKind ? { projectKind: permit.projectKind } : {}),
          ...(shouldUpdateWorkClass ? { workClass: permit.workClass } : {}),
          ...(shouldUpdateFixtures ? { fixtures: permit.fixtures } : {}),
          ...(ex.contractorName == null && permit.contractorName
            ? { contractorName: permit.contractorName }
            : {}),
          ...(ex.ownerName == null && permit.ownerName
            ? { ownerName: permit.ownerName }
            : {}),
          ...(ex.issuedDate == null && permit.issuedDate
            ? { issuedDate: permit.issuedDate }
            : {}),
          ...(ex.housingUnits == null && permit.housingUnits != null
            ? { housingUnits: permit.housingUnits }
            : {}),
          ...(ex.developmentType == null && permit.developmentType
            ? { developmentType: permit.developmentType }
            : {}),
          // Re-run AI when the work-class changed — old summary may be wrong.
          ...((ex.aiSummary == null || shouldUpdateWorkClass) && insight
            ? { aiSummary: insight.summary }
            : {}),
          ...((ex.aiRelevance == null || shouldUpdateWorkClass) && insight
            ? { aiRelevance: insight.relevance }
            : {}),
        },
      });
    }),
  );

  return { added: addedCount, updated: backfillTargets.length };
}

export async function runLeadsSync(): Promise<SyncLeadsResult> {
  console.log("[Sync Worker] Starting multi-city permit sync...");

  const enabled = cityRegistry.filter((c) => c.enabled);
  const perCity: SyncLeadsResult["cities"] = [];

  const socrataToken = await getActiveApiKey("SOCRATA");

  const fetched = await Promise.all(
    enabled.map(async (entry) => {
      let permits: RawPermitData[];
      if (entry.kind === "arcgis") {
        permits = await fetchArcgisPermits(entry.dataset, entry.limit);
      } else if (entry.kind === "socrata") {
        permits = await fetchSocrataPermits(entry.dataset, entry.limit, socrataToken);
      } else {
        permits = await entry.fetch(entry.limit);
      }
      return { entry, permits };
    }),
  );

  for (const { entry, permits } of fetched) {
    const cityLabel =
      entry.kind === "custom" ? entry.city : entry.dataset.city;
    const { added, updated } = await syncPermits(permits);
    perCity.push({
      city: cityLabel,
      fetched: permits.length,
      added,
      updated,
    });
    console.log(
      `[Sync Worker] ${cityLabel}: fetched=${permits.length}, added=${added}, updated=${updated}`,
    );
  }

  const totalAdded = perCity.reduce((a, c) => a + c.added, 0);
  const totalUpdated = perCity.reduce((a, c) => a + c.updated, 0);

  console.log(
    `[Sync Worker] Complete. Total added=${totalAdded}, updated=${totalUpdated}`,
  );

  return { success: true, added: totalAdded, updated: totalUpdated, cities: perCity };
}
