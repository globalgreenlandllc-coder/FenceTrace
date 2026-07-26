import { SocrataDataset } from "./socrata";
import { ArcgisDataset } from "./arcgis";
import { geocodeAddress } from "../geocoder";
import { RawPermitData } from "./socrata";

// Tiny helpers for the inevitable string-typed Socrata fields.
const num = (v: unknown): number => parseFloat(String(v));
const intOrUndef = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? undefined : n;
};
// Parses date from ISO string (Socrata calendar_date) or epoch milliseconds
// (ArcGIS attribute). Returns undefined on anything unparseable.
const toDate = (v: unknown): Date | undefined => {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
};

// Cross-city classifier for the kind of residential development a permit
// represents. Heuristics over the source description + structured fields.
export function classifyDevelopmentType(args: {
  description?: unknown;
  buildingType?: unknown;
  workClass?: unknown;
  units?: number;
}): string | undefined {
  const desc = typeof args.description === "string" ? args.description.toLowerCase() : "";
  const bt = typeof args.buildingType === "string" ? args.buildingType.toLowerCase() : "";
  const wc = typeof args.workClass === "string" ? args.workClass.toLowerCase() : "";
  const units = args.units;

  // ADU / DADU detection first — they overlap with SFR but are a distinct lead.
  if (
    /\bdadu\b/.test(desc) ||
    /\badu\b/.test(desc) ||
    /\baccessory\s+dwelling/.test(desc) ||
    /\b(detached|attached)\s+accessory\s+dwelling/.test(desc)
  ) {
    return "ADU";
  }

  // Plats / short plats (subdivision permits). Common in Seattle land-use.
  if (/\bshort\s*plat\b/.test(desc)) return "Short Plat";
  if (/\bsubdivid/.test(desc) && /\bparcel\b/.test(desc)) return /\bshort\b/.test(desc) ? "Short Plat" : "Plat";
  if (/\bplat\b/.test(desc) && !/replat/.test(desc)) return "Plat";

  // Townhouse / rowhouse
  if (/\btownhouse|townhome|row\s*house|rowhouse\b/.test(desc)) return "Townhouse";

  // Condo — Bellevue labels these explicitly in SUBTYPE.
  if (bt.includes("condo")) return "Condo";
  if (/\bcondominium|condo\b/.test(desc)) return "Condo";

  // Duplex
  if (bt.includes("duplex") || units === 2) return "Duplex";

  // Multifamily — explicit building class OR >2 units
  if (bt.includes("multifamily") || (units != null && units > 2)) return "Multifamily";

  // Single family — explicit building class OR 1 unit on residential
  if (bt.includes("single family") || (bt.startsWith("residential") && units === 1)) {
    return "Single Family";
  }

  // Commercial detection (so we don't mis-classify it as residential)
  if (bt.includes("commercial") || bt.includes("nonresidential")) return undefined;

  return undefined;
}

// Canonical project-kind vocabulary used across all cities so the map filter
// stays simple. Each adapter normalizes its city's permit-type text into one
// of these buckets.
export type ProjectKind =
  | "New Construction"
  | "Remodel/Addition"
  | "Tenant Improvement"
  | "Demolition"
  | "Other";

// Generic project-kind normalizer that handles the keyword variations seen
// across municipal permit feeds. City-specific helpers below delegate to it.
function normalizeGenericProjectKind(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toLowerCase().trim();
  if (
    v === "new" ||
    v === "nb" ||
    v === "bldg-new" ||
    v.includes("new construction") ||
    (v.includes("new") && (v.includes("building") || v.includes("structure")))
  ) {
    return "New Construction";
  }
  if (v.includes("tenant")) return "Tenant Improvement";
  if (
    v.includes("demoli") ||
    v === "dm" ||
    v.includes("wrecking") ||
    v.includes("deconstruction")
  ) {
    return "Demolition";
  }
  if (
    v.includes("addition") ||
    v.includes("alteration") ||
    v.includes("remodel") ||
    v.includes("renovation") ||
    v.includes("repair") ||
    /^a[123]$/i.test(raw)
  ) {
    return "Remodel/Addition";
  }
  return "Other";
}

// ─── Seattle ─────────────────────────────────────────────────────────────────
function normalizeSeattlePermitType(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toLowerCase();
  if (v === "new") return "New Construction";
  if (v.includes("addition") || v.includes("alteration")) return "Remodel/Addition";
  if (v.includes("tenant")) return "Tenant Improvement";
  if (v.includes("demoli") || v.includes("deconstruction")) return "Demolition";
  return "Other";
}

export const seattleDataset: SocrataDataset = {
  city: "Seattle",
  endpoint: "https://data.seattle.gov/resource/76t5-zqzr.json",
  where: "issueddate IS NOT NULL AND latitude IS NOT NULL",
  orderBy: "issueddate DESC",
  fields: {
    sourceId: (i) => i.permitnum,
    address: (i) => i.originaladdress1 ?? i.address ?? "Unknown Address",
    description: (i) => i.description ?? "No description provided",
    status: (i) => i.statuscurrent ?? "Issued",
    latitude: (i) => num(i.latitude),
    longitude: (i) => num(i.longitude),
    value: (i) => intOrUndef(i.estprojectcost),
    buildingType: (i) => i.permitclass ?? i.permitclassmapped,
    contractorName: (i) => i.contractorcompanyname,
    projectKind: (i) => normalizeSeattlePermitType(i.permittypedesc),
    issuedDate: (i) => toDate(i.issueddate),
    housingUnits: (i) => {
      const added = intOrUndef(i.housingunitsadded);
      if (added != null && added > 0) return added;
      return intOrUndef(i.housingunits);
    },
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.description,
        buildingType: i.permitclass ?? i.permitclassmapped,
        units: intOrUndef(i.housingunitsadded) ?? intOrUndef(i.housingunits),
      }),
  },
};

// ─── San Francisco ───────────────────────────────────────────────────────────
// Dataset: data.sfgov.org/resource/i98e-djp9 (Building Permits)
// Lat/lng come back as GeoJSON Point: location.coordinates = [lng, lat]
export const sanFranciscoDataset: SocrataDataset = {
  city: "San Francisco",
  endpoint: "https://data.sfgov.org/resource/i98e-djp9.json",
  where: "issued_date IS NOT NULL AND location IS NOT NULL",
  orderBy: "issued_date DESC",
  fields: {
    sourceId: (i) => i.permit_number,
    address: (i) =>
      [i.street_number, i.street_name, i.street_suffix].filter(Boolean).join(" ") ||
      "Unknown Address",
    description: (i) => i.description ?? "No description provided",
    status: (i) => i.status ?? "Issued",
    // GeoJSON Point: coordinates = [longitude, latitude]
    latitude: (i) => num(i.location?.coordinates?.[1] ?? i.latitude),
    longitude: (i) => num(i.location?.coordinates?.[0] ?? i.longitude),
    value: (i) => intOrUndef(i.estimated_cost ?? i.revised_cost),
    // Existing/proposed use is the closest signal for building type
    buildingType: (i) => i.proposed_use ?? i.existing_use,
    projectKind: (i) => normalizeGenericProjectKind(i.permit_type_definition),
    issuedDate: (i) => toDate(i.issued_date),
    housingUnits: (i) => intOrUndef(i.proposed_units) ?? intOrUndef(i.existing_units),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.description,
        buildingType: i.proposed_use ?? i.existing_use,
        units: intOrUndef(i.proposed_units),
      }),
  },
};

// ─── New York City ───────────────────────────────────────────────────────────
// Dataset: data.cityofnewyork.us/resource/ipu4-2q9a (DOB Permit Issuance via filings)
// Description is reconstructed from coded fields because the dataset has no
// free-text description field — but the upside is that it exposes permittee
// business name + phone, which is excellent contact data.
function normalizeNycJobType(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toUpperCase().trim();
  if (v === "NB") return "New Construction";
  if (v === "DM") return "Demolition";
  if (v === "A1" || v === "A2" || v === "A3") return "Remodel/Addition";
  return "Other";
}
export const newYorkDataset: SocrataDataset = {
  city: "New York",
  endpoint: "https://data.cityofnewyork.us/resource/ipu4-2q9a.json",
  where: "permit_status='ISSUED' AND gis_latitude IS NOT NULL",
  orderBy: "issuance_date DESC",
  fields: {
    sourceId: (i) =>
      i.permit_si_no ?? (i.job__ ? `${i.job__}-${i.permit_sequence__ ?? "01"}` : undefined),
    address: (i) =>
      [i.house__, i.street_name, i.borough].filter(Boolean).join(" ") || "Unknown Address",
    description: (i) => {
      const parts = [i.job_type, i.permit_type, i.permit_subtype, i.work_type]
        .filter(Boolean)
        .filter((v: string, idx: number, arr: string[]) => arr.indexOf(v) === idx);
      return parts.length ? `Job ${parts.join(" / ")}` : "No description provided";
    },
    status: (i) => i.permit_status ?? "ISSUED",
    latitude: (i) => num(i.gis_latitude),
    longitude: (i) => num(i.gis_longitude),
    buildingType: (i) =>
      i.residential === "YES" ? "Residential" : i.residential === "NO" ? "Non-Residential" : undefined,
    // Permittee business name is the contractor doing the work; license type
    // "GC" means general contractor — most valuable contact for gutter sub-bids.
    contractorName: (i) => i.permittee_s_business_name,
    projectKind: (i) => normalizeNycJobType(i.job_type),
    issuedDate: (i) => toDate(i.issuance_date),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: `${i.job_type ?? ""} ${i.permit_type ?? ""} ${i.work_type ?? ""}`,
        buildingType: i.residential === "YES" ? "Residential" : "Non-Residential",
      }),
  },
};

// ─── Chicago ─────────────────────────────────────────────────────────────────
// Dataset: data.cityofchicago.org/resource/ydr8-5enu (Building Permits)
function normalizeChicagoPermitType(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toUpperCase();
  if (v.includes("NEW CONSTRUCTION")) return "New Construction";
  if (v.includes("WRECKING") || v.includes("DEMOLI")) return "Demolition";
  if (v.includes("RENOVATION") || v.includes("ALTERATION") || v.includes("REPAIR")) {
    return "Remodel/Addition";
  }
  return "Other";
}
export const chicagoDataset: SocrataDataset = {
  city: "Chicago",
  endpoint: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
  where: "issue_date IS NOT NULL AND latitude IS NOT NULL",
  orderBy: "issue_date DESC",
  fields: {
    sourceId: (i) => i.permit_,
    address: (i) =>
      [i.street_number, i.street_direction, i.street_name].filter(Boolean).join(" ") ||
      "Unknown Address",
    description: (i) => i.work_description ?? i.permit_type ?? "No description provided",
    status: (i) => i.permit_status ?? "Issued",
    latitude: (i) => num(i.latitude),
    longitude: (i) => num(i.longitude),
    value: (i) => intOrUndef(i.reported_cost),
    // permit_type is like "PERMIT - NEW CONSTRUCTION" / "PERMIT - SIGNS" — coarse
    // but the only building-class signal in this dataset.
    buildingType: (i) =>
      typeof i.permit_type === "string" ? i.permit_type.replace(/^PERMIT - /, "") : undefined,
    contractorName: (i) =>
      i.contact_1_name && i.contact_1_type && /CONTRACTOR/i.test(i.contact_1_type)
        ? i.contact_1_name
        : undefined,
    projectKind: (i) => normalizeChicagoPermitType(i.permit_type),
    issuedDate: (i) => toDate(i.issue_date),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.work_description,
        buildingType: typeof i.permit_type === "string" ? i.permit_type.replace(/^PERMIT - /, "") : undefined,
      }),
  },
};

// ─── Los Angeles (DISABLED) ──────────────────────────────────────────────────
// Dataset: data.lacity.org/resource/xnhu-aczu (LA Build Permits)
// This dataset has detailed permit data — including contractor name, license,
// applicant — but does NOT publish lat/lng. To map LA leads we'd need to
// geocode addresses via Google Maps API (~$5/1k). Left disabled until that
// pipeline is built. Keep config so it's a one-line flip when ready.
export const losAngelesDataset: SocrataDataset = {
  city: "Los Angeles",
  endpoint: "https://data.lacity.org/resource/xnhu-aczu.json",
  where: "issue_date IS NOT NULL",
  orderBy: "issue_date DESC",
  fields: {
    sourceId: (i) => i.pcis_permit,
    address: (i) =>
      [i.address_start, i.street_direction, i.street_name, i.street_suffix]
        .filter(Boolean)
        .join(" ") || "Unknown Address",
    description: (i) => i.work_description ?? "No description provided",
    status: (i) => i.latest_status ?? "Issued",
    // No native geo — would need geocoding pipeline.
    latitude: () => NaN,
    longitude: () => NaN,
    value: (i) => intOrUndef(i.valuation),
    buildingType: (i) => i.permit_sub_type,
    contractorName: (i) => i.contractors_business_name,
    projectKind: (i) => normalizeGenericProjectKind(i.permit_type),
    issuedDate: (i) => toDate(i.issue_date),
  },
};

// ─── Pierce County, WA (Tacoma area) ────────────────────────────────────────
// Dataset: open.piercecountywa.gov/resource/rcj9-mkn4 (Pierce County permits)
// Lat/lng come back as GeoJSON Point on `the_geom` field.
// Filter to construction-only — the raw feed includes plumbing, mechanical,
// signs, driveway, alarms etc. that aren't gutter opportunities.
function normalizePiercePermitType(rawType: unknown): string | undefined {
  if (typeof rawType !== "string") return undefined;
  if (rawType.includes("Residential")) return "Residential";
  if (rawType.includes("Commercial")) return "Commercial";
  return rawType;
}
export const pierceCountyDataset: SocrataDataset = {
  city: "Pierce County",
  endpoint: "https://open.piercecountywa.gov/resource/rcj9-mkn4.json",
  where:
    "applicationtype IN ('Construction Residential', 'Construction Commercial') AND issueddate IS NOT NULL AND the_geom IS NOT NULL",
  orderBy: "issueddate DESC",
  fields: {
    sourceId: (i) => i.applicationnumber,
    address: (i) => i.siteaddress ?? "Unknown Address",
    description: (i) => i.workdescription ?? "No description provided",
    status: (i) => i.applicationstatus ?? "Issued",
    latitude: (i) => num(i.the_geom?.coordinates?.[1]),
    longitude: (i) => num(i.the_geom?.coordinates?.[0]),
    value: (i) => intOrUndef(i.buildingvaluation),
    buildingType: (i) => normalizePiercePermitType(i.applicationtype),
    projectKind: (i) => normalizeGenericProjectKind(i.worktype),
    issuedDate: (i) => toDate(i.issueddate),
    housingUnits: (i) => intOrUndef(i.dwellingunits),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.workdescription,
        buildingType: normalizePiercePermitType(i.applicationtype),
        units: intOrUndef(i.dwellingunits),
      }),
  },
};

// ─── Austin ──────────────────────────────────────────────────────────────────
// Dataset: data.austintexas.gov/resource/3syk-w9eu (Issued Construction Permits)
function normalizeAustinWorkClass(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toLowerCase();
  if (v === "new") return "New Construction";
  if (v === "remodel" || v === "addition" || v === "addition and remodel" || v.includes("repair")) {
    return "Remodel/Addition";
  }
  if (v.includes("tenant")) return "Tenant Improvement";
  if (v.includes("demoli")) return "Demolition";
  return "Other";
}
export const austinDataset: SocrataDataset = {
  city: "Austin",
  endpoint: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  where: "issue_date IS NOT NULL AND latitude IS NOT NULL",
  orderBy: "issue_date DESC",
  fields: {
    sourceId: (i) => i.permit_number,
    address: (i) => i.original_address1 ?? i.permit_location ?? "Unknown Address",
    description: (i) => i.description ?? "No description provided",
    status: (i) => i.status_current ?? "Active",
    latitude: (i) => num(i.latitude),
    longitude: (i) => num(i.longitude),
    value: (i) => intOrUndef(i.total_job_valuation),
    buildingType: (i) => i.permit_class_mapped ?? i.permit_class,
    contractorName: (i) => i.contractor_company_name ?? i.applicant_org,
    projectKind: (i) => normalizeAustinWorkClass(i.work_class),
    issuedDate: (i) => toDate(i.issue_date),
    housingUnits: (i) => intOrUndef(i.housing_units),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.description,
        buildingType: i.permit_class_mapped ?? i.permit_class,
        units: intOrUndef(i.housing_units),
      }),
  },
};

// ─── Tacoma, WA (ArcGIS) ─────────────────────────────────────────────────────
// City of Tacoma publishes Accela permit data through ArcGIS Hub.
// Tacoma's schema is unusual: permit_subtype carries the building class
// ("Residential", "Commercial", "Utility", …) and permit_type is the permit
// category ("Building", "Right-of-Way", …). The project kind (new vs
// remodel) is only in the free-text description, so we keyword-extract it.
function inferProjectKindFromDescription(desc: unknown): string | undefined {
  if (typeof desc !== "string" || !desc) return undefined;
  const v = desc.toLowerCase();
  if (/\b(demoli|wreck|deconstruct)/i.test(desc)) return "Demolition";
  if (/\b(tenant\s+impr|t\.?i\.?\b)/i.test(desc)) return "Tenant Improvement";
  if (
    /\b(new\s+(single|sfr|residential|construction|building|structure|dwell|home|house))/i.test(desc) ||
    /\bconstruct(ion)?\s+(of\s+)?(a\s+)?new\b/i.test(desc) ||
    /\bbuild\s+new\b/i.test(desc)
  ) {
    return "New Construction";
  }
  if (
    v.includes("remodel") ||
    v.includes("addition") ||
    v.includes("alteration") ||
    v.includes("renovation") ||
    v.includes("repair") ||
    v.includes("reroof") ||
    v.includes("re-roof")
  ) {
    return "Remodel/Addition";
  }
  return undefined;
}
export const tacomaDataset: ArcgisDataset = {
  city: "Tacoma",
  layerUrl:
    "https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/accela_permit_data/FeatureServer/0",
  where: "issued_date IS NOT NULL",
  orderBy: "issued_date DESC",
  fields: {
    sourceId: (i) => i.permit_number,
    address: (i) =>
      [i.address_line_1, i.address_line_2].filter(Boolean).join(", ") || "Unknown Address",
    description: (i) => i.description ?? "No description provided",
    status: (i) => i.current_status ?? "Issued",
    latitude: (i) => num(i.latitude),
    longitude: (i) => num(i.longitude),
    value: (i) => intOrUndef(i.valuation),
    // permit_subtype carries the building class — Residential / Commercial /
    // Utility / Wastewater / etc.
    buildingType: (i) =>
      typeof i.permit_subtype === "string" && i.permit_subtype !== "NA"
        ? i.permit_subtype
        : undefined,
    contractorName: (i) =>
      i.applicant_name && i.applicant_name !== "No Primary Applicant Available"
        ? i.applicant_name
        : undefined,
    projectKind: (i) => inferProjectKindFromDescription(i.description),
    issuedDate: (i) => toDate(i.issued_date),
    housingUnits: (i) => intOrUndef(i.housing_units),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.description,
        buildingType: i.permit_subtype,
        units: intOrUndef(i.housing_units),
      }),
  },
};

// ─── Bellevue, WA (ArcGIS) ───────────────────────────────────────────────────
// City of Bellevue publishes building permits via ArcGIS Online with rich
// fields including OWNER, CONTRACTOR, APPLICANT, NEIGHBORHOODAREA.
//
// CRITICAL: Bellevue's PROJECTDESCRIPTION follows a template:
//   "A {BUILDING_CLASS} {WORK_CLASS} {MODIFIER} Project Involving ({FIXTURES})"
// The PERMITTYPE codes (BN, BF, BK, …) are sub-trade categories (plumbing,
// electrical, fireplace) — NOT new-vs-remodel signals. The real project-kind
// signal is the WORK_CLASS phrase inside the description.
const BELLEVUE_WORK_CLASSES = [
  "New Structure",
  "Addition to Existing Structure",
  "Alteration to Existing Structure",
  "Repair or Replacement",
  "Demolition",
];
function parseBellevueDescription(desc: unknown): {
  buildingClass?: string;
  workClass?: string;
  modifier?: string;
  fixtures?: string;
} | null {
  if (typeof desc !== "string" || !desc) return null;
  // Build alternation pattern once and capture the work class verbatim.
  const workPattern = BELLEVUE_WORK_CLASSES.map((w) => w.replace(/\s/g, "\\s")).join("|");
  const re = new RegExp(
    `^A\\s+(.+?)\\s+(${workPattern})(?:\\s+(None|Electrical|Mechanical|Low\\s*Voltage\\s*Only|Plumbing))?(?:\\s+Project\\s+Involving\\s*\\(([^)]+)\\))?`,
    "i",
  );
  const m = desc.match(re);
  if (!m) return null;
  return {
    buildingClass: m[1]?.trim(),
    workClass: m[2]?.trim(),
    modifier: m[3]?.trim() || "None",
    fixtures: m[4]?.trim(),
  };
}
function bellevueProjectKindFromWorkClass(workClass: string | undefined): string | undefined {
  if (!workClass) return undefined;
  if (/^new structure$/i.test(workClass)) return "New Construction";
  if (/^addition/i.test(workClass)) return "Remodel/Addition";
  if (/^alteration/i.test(workClass)) return "Remodel/Addition";
  if (/^demolition$/i.test(workClass)) return "Demolition";
  if (/^repair or replacement$/i.test(workClass)) return "Other";
  return undefined;
}
function classifyBellevueSubtype(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw || raw === "None") return undefined;
  if (/single\s*family/i.test(raw)) return "Single Family/Duplex";
  if (/multifamily/i.test(raw)) return "Multifamily";
  if (/commercial|office|hotel/i.test(raw)) return "Commercial";
  if (/nonresidential/i.test(raw)) return "Commercial";
  return raw;
}
export const bellevueDataset: ArcgisDataset = {
  city: "Bellevue",
  layerUrl:
    "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Bellevue_Permits/FeatureServer/0",
  where: "FOLDERGROUP='Building' AND ISSUEDDATE IS NOT NULL",
  orderBy: "ISSUEDDATE DESC",
  fields: {
    sourceId: (i) => i.PERMITNUMBER,
    address: (i) =>
      [i.SITEADDRESS, i.CITY, i.STATE, i.ZIPCODE].filter(Boolean).join(", ") ||
      "Unknown Address",
    description: (i) =>
      i.PROJECTDESCRIPTION ?? i.PROJECTNAME ?? "No description provided",
    status: (i) => i.PERMITSTATUS ?? "Issued",
    // Lat/lng come from geometry — centroid handled by the generic adapter.
    buildingType: (i) => classifyBellevueSubtype(i.SUBTYPE),
    contractorName: (i) =>
      i.CONTRACTOR && i.CONTRACTOR !== "NONE" ? i.CONTRACTOR : undefined,
    ownerName: (i) =>
      i.OWNER && i.OWNER !== "NONE" && i.OWNER !== "None" ? i.OWNER : undefined,
    projectKind: (i) => {
      const parsed = parseBellevueDescription(i.PROJECTDESCRIPTION);
      return bellevueProjectKindFromWorkClass(parsed?.workClass);
    },
    workClass: (i) => parseBellevueDescription(i.PROJECTDESCRIPTION)?.workClass,
    fixtures: (i) => parseBellevueDescription(i.PROJECTDESCRIPTION)?.fixtures,
    issuedDate: (i) => toDate(i.ISSUEDDATE),
    housingUnits: (i) => intOrUndef(i.DWELLINGUNITSCREATED) ?? intOrUndef(i.HOTELMOTELUNITSCREATED),
    developmentType: (i) => {
      // Bellevue is unique: SUBTYPE explicitly tags condo units, and
      // NUMBEROFLOTS > 1 indicates a plat / subdivision project.
      const sub = typeof i.SUBTYPE === "string" ? i.SUBTYPE.toLowerCase() : "";
      const lots = intOrUndef(i.NUMBEROFLOTS);
      if (lots != null && lots > 1) return "Plat";
      if (sub.includes("condo")) return "Condo";
      const units = intOrUndef(i.DWELLINGUNITSCREATED);
      return classifyDevelopmentType({
        description: i.PROJECTDESCRIPTION,
        buildingType: classifyBellevueSubtype(i.SUBTYPE),
        units,
      });
    },
  },
};

// ─── Renton, WA (ArcGIS MapServer) ───────────────────────────────────────────
// City of Renton publishes permits as a single MapServer layer that includes
// many categories. Filter out non-construction inspections.
function classifyRentonKind(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("single family")) return "Single Family/Duplex";
  if (v.includes("duplex")) return "Single Family/Duplex";
  if (v.includes("multifamily")) return "Multifamily";
  if (v.includes("commercial")) return "Commercial";
  if (v.includes("mixed use")) return "Commercial";
  if (v.includes("adu") || v.includes("accessory dwelling")) return "Single Family/Duplex";
  return raw;
}
function classifyRentonProjectKind(kind: unknown, workClass: unknown): string | undefined {
  const k = (typeof kind === "string" ? kind : "").toLowerCase();
  if (k.includes("demolition")) return "Demolition";
  // KIND values like "Single Family", "Multifamily", "Commercial" without
  // "demolition" are typically new construction permits in Renton.
  if (k === "single family" || k.includes("multifamily") || k.includes("commercial") || k.includes("duplex") || k.includes("adu")) {
    return "New Construction";
  }
  return inferProjectKindFromDescription(workClass);
}
export const rentonDataset: ArcgisDataset = {
  city: "Renton",
  layerUrl:
    "https://gismaps.rentonwa.gov/as03/rest/services/Operational/PermitsAndConstruction/MapServer/41",
  where:
    "STATUS = 'Issued' AND KIND NOT IN ('Adult Family Home', 'Mobile Home (in a park)')",
  orderBy: "ISSUEDATE DESC",
  fields: {
    sourceId: (i) => i.PERMITNUMBER,
    address: (i) =>
      i.LOCATION || (i.PID ? `Parcel ${i.PID}` : "Unknown Address"),
    description: (i) =>
      i.DESCRIPTION || i.PROJECT_NAME || i.WORKCLASS || "No description provided",
    status: (i) => i.STATUS ?? "Issued",
    value: (i) => intOrUndef(i.VALUE),
    buildingType: (i) => classifyRentonKind(i.KIND),
    projectKind: (i) => classifyRentonProjectKind(i.KIND, i.WORKCLASS),
  },
};

// ─── Redmond, WA (ArcGIS) ────────────────────────────────────────────────────
// City of Redmond publishes CIP permits via gis.redmond.gov. Rich schema
// with Address + WorkClass + ProjectStatus + ProjectDesc fields.
function classifyRedmondWorkClass(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("single") || v.includes("residential")) return "Single Family/Duplex";
  if (v.includes("multi") || v.includes("multifamily")) return "Multifamily";
  if (v.includes("commercial") || v.includes("mixed")) return "Commercial";
  return undefined;
}
export const redmondDataset: ArcgisDataset = {
  city: "Redmond",
  layerUrl: "https://gis.redmond.gov/arcgis/rest/services/Projects/CIPProjects/MapServer/4",
  where: "1=1", // Redmond's feed already filters to active CIP permits
  // STARTDATE is the closest field to a permit issue date Redmond publishes.
  orderBy: "STARTDATE DESC",
  fields: {
    sourceId: (i) => i.PERMITNUMBER ?? i.PermitID,
    address: (i) =>
      [i.Address, i.CITY, i.STATE, i.ZIPCODE].filter(Boolean).join(", ") || "Unknown Address",
    description: (i) =>
      [i.ProjectName, i.ProjectDesc].filter(Boolean).join(" — ") || "No description provided",
    status: (i) => i.ProjectStatus ?? "Under Review",
    // Polygon geometry — centroid handled by the generic adapter.
    buildingType: (i) => classifyRedmondWorkClass(i.WorkClass),
    projectKind: (i) => {
      const p = (typeof i.PermitType === "string" ? i.PermitType : "").toLowerCase();
      if (p.includes("new") || p.includes("construction")) return "New Construction";
      if (p.includes("addition") || p.includes("alteration") || p.includes("remodel")) {
        return "Remodel/Addition";
      }
      if (p.includes("tenant")) return "Tenant Improvement";
      if (p.includes("demoli")) return "Demolition";
      return inferProjectKindFromDescription(`${i.ProjectName ?? ""} ${i.ProjectDesc ?? ""}`);
    },
    developmentType: (i) =>
      classifyDevelopmentType({
        description: `${i.ProjectName ?? ""} ${i.ProjectDesc ?? ""}`,
        buildingType: classifyRedmondWorkClass(i.WorkClass),
      }),
    issuedDate: (i) => toDate(i.STARTDATE),
  },
};

// ─── Mercer Island, WA (ArcGIS) ──────────────────────────────────────────────
// City of Mercer Island runs its own CPD permit-activity MapServer.
// Schema: ADDRESSLABEL, APPLIED (epoch ms), PERMITDESCRIPTION, PERMITNOTES,
// PERMITSTATUS, PERMITSUBTYPE, PERMITTYPE, PERMIT_NO + Point geometry.
// No explicit ISSUED date — use APPLIED as the closest signal.
function classifyMercerSubtype(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const v = raw.toUpperCase();
  if (v.startsWith("SF") || v.startsWith("SFR")) return "Single Family/Duplex";
  if (v.startsWith("MULTI")) return "Multifamily";
  if (v.startsWith("COMM")) return "Commercial";
  return undefined;
}
function classifyMercerProjectKind(subtype: unknown, desc: unknown): string | undefined {
  const s = typeof subtype === "string" ? subtype.toUpperCase() : "";
  if (s.includes("NEW")) return "New Construction";
  if (s.includes("ALT") || s.includes("ADD") || s.includes("R&M") || s.includes("REMODEL")) {
    return "Remodel/Addition";
  }
  if (s.includes("DEM") || s.includes("DEMO")) return "Demolition";
  return inferProjectKindFromDescription(desc);
}
export const mercerIslandDataset: ArcgisDataset = {
  city: "Mercer Island",
  layerUrl:
    "https://chgis1.mercergov.org/arcgis/rest/services/AGSOnlineMapsApps/cpdPermitActivity/MapServer/0",
  // Filter out pre-issued permits: leaves ACTIVE, READY TO ISSUE,
  // COMPLETE, APPROVED. Excludes IN REVIEW / INTAKE / COMPLETENESS CHECK.
  where: "PERMITSTATUS NOT IN ('IN REVIEW', 'INTAKE SCREENING', 'COMPLETENESS CHECK')",
  orderBy: "APPLIED DESC",
  fields: {
    sourceId: (i) => i.PERMIT_NO,
    address: (i) => i.ADDRESSLABEL ? `${i.ADDRESSLABEL}, Mercer Island, WA` : "Unknown Address",
    description: (i) =>
      [i.PERMITDESCRIPTION, i.PERMITNOTES].filter(Boolean).join(" — ") ||
      "No description provided",
    status: (i) => i.PERMITSTATUS ?? "Active",
    // Lat/lng come from geometry — centroid handled by the generic adapter.
    buildingType: (i) => classifyMercerSubtype(i.PERMITSUBTYPE),
    projectKind: (i) => classifyMercerProjectKind(i.PERMITSUBTYPE, i.PERMITDESCRIPTION),
    issuedDate: (i) => toDate(i.APPLIED),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: `${i.PERMITDESCRIPTION ?? ""} ${i.PERMITNOTES ?? ""}`,
        buildingType: classifyMercerSubtype(i.PERMITSUBTYPE),
      }),
  },
};

// ─── Spokane County, WA (ArcGIS) ─────────────────────────────────────────────
// County-wide feed; covers Spokane City + outlying areas.
function classifySpokanePermitType(rawType: unknown): string | undefined {
  if (typeof rawType !== "string" || !rawType) return undefined;
  if (/^residential/i.test(rawType)) return "Residential";
  if (/^commercial/i.test(rawType)) return "Commercial";
  return rawType;
}
function classifySpokaneProjectKind(rawType: unknown): string | undefined {
  if (typeof rawType !== "string") return undefined;
  const v = rawType.toLowerCase();
  if (v.includes("new")) return "New Construction";
  if (v.includes("accessory") || v.includes("addition") || v.includes("alteration")) {
    return "Remodel/Addition";
  }
  if (v.includes("demoli")) return "Demolition";
  if (v.includes("tenant")) return "Tenant Improvement";
  return "Other";
}
export const spokaneCountyDataset: ArcgisDataset = {
  city: "Spokane County",
  layerUrl:
    "https://services3.arcgis.com/WlYQgAChrqj0tuQi/arcgis/rest/services/Spokane_County_Building_and_Planning_Permits/FeatureServer/0",
  where: "Issued_Date IS NOT NULL",
  orderBy: "Issued_Date DESC",
  fields: {
    sourceId: (i) => i.Permit_Number,
    address: (i) => i.Site_Address ?? "Unknown Address",
    description: (i) => i.Project_Description ?? "No description provided",
    status: (i) => i.Status_Description ?? i.Status ?? "Issued",
    // Lat/lng only available via geometry — adapter falls back automatically.
    buildingType: (i) => classifySpokanePermitType(i.Permit_Type),
    projectKind: (i) => classifySpokaneProjectKind(i.Permit_Type),
    issuedDate: (i) => toDate(i.Issued_Date),
    developmentType: (i) =>
      classifyDevelopmentType({
        description: i.Project_Description,
        buildingType: classifySpokanePermitType(i.Permit_Type),
      }),
  },
};

// ─── Kenmore, WA (ArcGIS + geocoding) ────────────────────────────────────────
// Kenmore's Trakit_Permits MapServer publishes rich permit data but stores
// addresses as text only — geometry is null on every record. This custom
// fetcher geocodes each address via Google Maps so pins can plot.
const KENMORE_PERMITS_URL =
  "https://gwa.kenmorewa.gov/arcgis/rest/services/Trakit_Permits/MapServer/12";
function classifyKenmorePermitType(t: unknown): string | undefined {
  if (typeof t !== "string") return undefined;
  const v = t.toUpperCase();
  if (v.includes("SINGLE FAMILY") || v.startsWith("SF")) return "Single Family/Duplex";
  if (v.includes("MULTI")) return "Multifamily";
  if (v.includes("COMMERCIAL") || v.includes("COM")) return "Commercial";
  return undefined;
}
function classifyKenmoreProjectKind(t: unknown, desc: unknown): string | undefined {
  const v = typeof t === "string" ? t.toUpperCase() : "";
  if (v.includes("NEW") || v.includes("SFR-N") || v.includes("ADDITION")) {
    return v.includes("ADDITION") ? "Remodel/Addition" : "New Construction";
  }
  if (v.includes("REMODEL") || v.includes("ALTER") || v.includes("R&M")) return "Remodel/Addition";
  if (v.includes("DEMOLITION") || v.includes("DEMO")) return "Demolition";
  return inferProjectKindFromDescription(desc);
}
export async function fetchKenmorePermits(limit: number): Promise<RawPermitData[]> {
  const url = new URL(`${KENMORE_PERMITS_URL}/query`);
  url.searchParams.set("where", "STATUS = 'ISSUED' OR STATUS = 'FINALED'");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("resultRecordCount", String(limit));
  url.searchParams.set("orderByFields", "ISSUED DESC");
  url.searchParams.set("f", "json");

  let raw: any;
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`[Kenmore] fetch failed (${res.status})`);
      return [];
    }
    raw = await res.json();
  } catch (e) {
    console.error("[Kenmore] fetch error", e);
    return [];
  }
  const features: any[] = Array.isArray(raw?.features) ? raw.features : [];

  // Geocode in parallel (bounded), then map to RawPermitData.
  const out: RawPermitData[] = [];
  const geo = await Promise.all(
    features.map(async (f) => {
      const a = f?.attributes ?? {};
      const addr = a.SITE_ADDR
        ? `${a.SITE_ADDR}${a.SITE_UNIT_NO ? ` ${a.SITE_UNIT_NO}` : ""}, Kenmore, WA`
        : null;
      if (!addr) return null;
      const loc = await geocodeAddress(addr);
      return loc ? { a, addr, loc } : null;
    }),
  );

  for (const g of geo) {
    if (!g) continue;
    const { a, addr, loc } = g;
    out.push({
      sourceId: a.PERMIT_NO ?? a.RECORDID,
      sourceCity: "Kenmore",
      address: addr,
      originalDescription: a.DESCRIPTION ?? a.TYPE ?? "No description provided",
      status: a.STATUS ?? "Issued",
      latitude: loc.lat,
      longitude: loc.lng,
      projectValue: typeof a.JOBVALUE === "number" ? Math.round(a.JOBVALUE) : undefined,
      buildingType: classifyKenmorePermitType(a.PermitType),
      contractorName: a.CONTRACTOR_NAME && a.CONTRACTOR_NAME !== "NONE" ? a.CONTRACTOR_NAME : undefined,
      ownerName: a.OWNER_NAME && a.OWNER_NAME !== "NONE" ? a.OWNER_NAME : undefined,
      projectKind: classifyKenmoreProjectKind(a.PermitType, a.DESCRIPTION),
      issuedDate: typeof a.ISSUED === "number" ? new Date(a.ISSUED) : undefined,
      developmentType: classifyDevelopmentType({
        description: a.DESCRIPTION,
        buildingType: classifyKenmorePermitType(a.PermitType),
      }),
    });
  }
  return out;
}

// ─── Renton, WA (ArcGIS + parcel-address join) ───────────────────────────────
// Renton's permit layer 41 has PID but no street address; the address sits
// on a separate Addresses layer 6 keyed by PID. This custom fetcher does a
// targeted IN-clause lookup against Addresses for just the permit-PID set,
// then enriches each permit with its address.
const RENTON_PERMITS_URL =
  "https://gismaps.rentonwa.gov/as03/rest/services/Operational/PermitsAndConstruction/MapServer/41";
const RENTON_ADDRESSES_URL =
  "https://gismaps.rentonwa.gov/as03/rest/services/Operational/Property/MapServer/6";

export async function fetchRentonPermits(limit: number): Promise<RawPermitData[]> {
  // 1. Fetch permits.
  const permitsUrl = new URL(`${RENTON_PERMITS_URL}/query`);
  permitsUrl.searchParams.set(
    "where",
    "STATUS = 'Issued' AND KIND NOT IN ('Adult Family Home', 'Mobile Home (in a park)')",
  );
  permitsUrl.searchParams.set("outFields", "*");
  permitsUrl.searchParams.set("resultRecordCount", String(limit));
  permitsUrl.searchParams.set("orderByFields", "ISSUEDATE DESC");
  permitsUrl.searchParams.set("f", "geojson");
  permitsUrl.searchParams.set("outSR", "4326");
  permitsUrl.searchParams.set("returnGeometry", "true");

  let permitsData: any;
  try {
    const res = await fetch(permitsUrl.toString());
    if (!res.ok) {
      console.error(`[Renton] permits fetch failed (${res.status})`);
      return [];
    }
    permitsData = await res.json();
  } catch (e) {
    console.error("[Renton] permits fetch error", e);
    return [];
  }
  const features: any[] = Array.isArray(permitsData?.features) ? permitsData.features : [];

  // 2. Collect distinct PIDs.
  const pidSet = new Set<string>();
  for (const f of features) {
    const pid = f?.properties?.PID;
    if (pid != null) pidSet.add(String(pid));
  }
  if (pidSet.size === 0) return [];

  // 3. Bulk fetch addresses for those PIDs only.
  const pidList = Array.from(pidSet)
    .map((p) => `'${p.replace(/'/g, "''")}'`)
    .join(",");
  const addrUrl = new URL(`${RENTON_ADDRESSES_URL}/query`);
  addrUrl.searchParams.set("where", `PID IN (${pidList})`);
  addrUrl.searchParams.set("outFields", "PID,FULLADDR,PSTLCITY,PSTLSTATE,PSTLZIP5");
  addrUrl.searchParams.set("returnGeometry", "false");
  addrUrl.searchParams.set("f", "json");

  const addrByPid = new Map<string, { fullAddr: string; city?: string; zip?: string }>();
  try {
    const r = await fetch(addrUrl.toString());
    if (r.ok) {
      const data = await r.json();
      for (const f of data?.features ?? []) {
        const a = f.attributes ?? {};
        if (!a.PID) continue;
        const existing = addrByPid.get(String(a.PID));
        // Prefer entries where FULLADDR is populated.
        if (!existing || (!existing.fullAddr && a.FULLADDR)) {
          addrByPid.set(String(a.PID), {
            fullAddr: a.FULLADDR ?? "",
            city: a.PSTLCITY,
            zip: a.PSTLZIP5,
          });
        }
      }
    }
  } catch (e) {
    console.error("[Renton] addresses fetch error", e);
  }

  // Helpers for centroid (mirrors what's in arcgis.ts).
  const centroidOf = (geom: any): [number, number] => {
    if (!geom || !geom.type) return [NaN, NaN];
    if (geom.type === "Point") return [Number(geom.coordinates?.[0]), Number(geom.coordinates?.[1])];
    let coords: number[][] = [];
    if (geom.type === "Polygon") coords = geom.coordinates?.[0] ?? [];
    else if (geom.type === "MultiPolygon") coords = geom.coordinates?.[0]?.[0] ?? [];
    if (!coords.length) return [NaN, NaN];
    let sx = 0, sy = 0;
    for (const [x, y] of coords) { sx += x; sy += y; }
    return [sx / coords.length, sy / coords.length];
  };

  // 4. Merge permits with addresses.
  const out: RawPermitData[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const pid = p.PID != null ? String(p.PID) : "";
    const addrEntry = addrByPid.get(pid);
    const fullAddr = addrEntry?.fullAddr?.trim() || "";
    if (!fullAddr) continue; // skip parcel-only records

    const [lng, lat] = centroidOf(f.geometry);
    if (!isFinite(lat) || !isFinite(lng)) continue;

    const kind = (typeof p.KIND === "string" ? p.KIND : "").toLowerCase();
    const buildingType = kind.includes("single family")
      ? "Single Family/Duplex"
      : kind.includes("multifamily")
      ? "Multifamily"
      : kind.includes("duplex")
      ? "Single Family/Duplex"
      : kind.includes("commercial")
      ? "Commercial"
      : undefined;

    const workClass = typeof p.WORKCLASS === "string" ? p.WORKCLASS : "";
    const projectKind =
      /^new$/i.test(workClass) || /single family residence|commercial building|garage/i.test(workClass)
        ? "New Construction"
        : /alteration|addition|remodel/i.test(workClass)
        ? "Remodel/Addition"
        : /demolition/i.test(workClass)
        ? "Demolition"
        : inferProjectKindFromDescription(`${p.DESCRIPTION ?? ""} ${workClass}`);

    out.push({
      sourceId: p.PERMITNUMBER ?? p.IVRNUMBER,
      sourceCity: "Renton",
      address: `${fullAddr}${addrEntry?.city ? `, ${addrEntry.city}` : ", Renton"}, WA${addrEntry?.zip ? ` ${addrEntry.zip}` : ""}`,
      originalDescription: p.DESCRIPTION || workClass || p.PROJECT_NAME || "No description provided",
      status: p.STATUS ?? "Issued",
      latitude: lat,
      longitude: lng,
      projectValue: typeof p.VALUE === "number" && p.VALUE > 0 ? Math.round(p.VALUE) : undefined,
      buildingType,
      projectKind,
      issuedDate: typeof p.ISSUEDATE === "number" ? new Date(p.ISSUEDATE) : undefined,
      developmentType: classifyDevelopmentType({
        description: `${p.DESCRIPTION ?? ""} ${workClass}`,
        buildingType,
      }),
    });
  }
  return out;
}

// Registry — flip the `enabled` flag on each city to turn it on. Disabled
// ones don't get fetched by the cron, but the config stays here for easy
// re-enabling once you've verified its field names against the live API.
export interface SocrataRegistryEntry {
  kind: "socrata";
  dataset: SocrataDataset;
  enabled: boolean;
  limit: number;
}
export interface ArcgisRegistryEntry {
  kind: "arcgis";
  dataset: ArcgisDataset;
  enabled: boolean;
  limit: number;
}
// Bespoke async fetcher — used by cities that need custom enrichment
// (geocoding, parcel joins) before they fit the RawPermitData shape.
export interface CustomRegistryEntry {
  kind: "custom";
  city: string;
  fetch: (limit: number) => Promise<RawPermitData[]>;
  enabled: boolean;
  limit: number;
}
export type RegistryEntry = SocrataRegistryEntry | ArcgisRegistryEntry | CustomRegistryEntry;

export const cityRegistry: RegistryEntry[] = [
  // ─── Washington State ─────────────────────────────────────────────────
  { kind: "socrata", dataset: seattleDataset, enabled: true, limit: 200 },
  { kind: "socrata", dataset: pierceCountyDataset, enabled: true, limit: 200 },
  { kind: "arcgis", dataset: tacomaDataset, enabled: true, limit: 200 },
  { kind: "arcgis", dataset: bellevueDataset, enabled: true, limit: 200 },
  { kind: "arcgis", dataset: mercerIslandDataset, enabled: true, limit: 200 },
  { kind: "arcgis", dataset: redmondDataset, enabled: true, limit: 200 },
  { kind: "custom", city: "Kenmore", fetch: fetchKenmorePermits, enabled: true, limit: 100 },
  { kind: "custom", city: "Renton", fetch: fetchRentonPermits, enabled: true, limit: 200 },
  // Old generic-adapter Renton config retired in favor of the parcel-join
  // custom fetcher above.
  { kind: "arcgis", dataset: spokaneCountyDataset, enabled: true, limit: 200 },
  //
  // ─── Other US metros ─────────────────────────────────────────────────
  { kind: "socrata", dataset: sanFranciscoDataset, enabled: true, limit: 200 },
  { kind: "socrata", dataset: newYorkDataset, enabled: true, limit: 200 },
  { kind: "socrata", dataset: chicagoDataset, enabled: true, limit: 200 },
  { kind: "socrata", dataset: austinDataset, enabled: true, limit: 200 },
  // LA needs a geocoding pipeline before it can plot pins — see comment above.
  { kind: "socrata", dataset: losAngelesDataset, enabled: false, limit: 50 },
];
