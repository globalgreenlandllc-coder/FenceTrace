// Generic Socrata adapter. Most US city open-data portals run on Socrata, so
// every city only needs to declare an endpoint + a tiny field-mapping config
// to plug in. Dataset field names vary city-to-city — see cities.ts.

export interface RawPermitData {
  sourceId: string;
  sourceCity: string;
  address: string;
  originalDescription: string;
  status: string;
  latitude: number;
  longitude: number;
  projectValue?: number;
  buildingType?: string;
  contractorName?: string;
  ownerName?: string;
  projectKind?: string;
  workClass?: string;     // Raw work-class text from source
  fixtures?: string;      // Parsed comma-separated work items
  issuedDate?: Date;      // When the municipality issued the permit
  housingUnits?: number;  // # dwelling units the permit creates/affects
  developmentType?: string; // Normalized: "Single Family" | "Duplex" | "Townhouse" | "Condo" | "Multifamily" | "Plat" | "Short Plat" | "ADU" | …
}

export interface SocrataDataset {
  city: string;
  endpoint: string;
  // Optional Socrata `$order` value, e.g. "issue_date DESC".
  orderBy?: string;
  // Optional Socrata `$where` SoQL filter. Used to scope ingestion to
  // issued permits so we only spend AI tokens on actionable leads.
  where?: string;
  fields: {
    sourceId: (item: any) => string | undefined;
    address: (item: any) => string;
    description: (item: any) => string;
    status: (item: any) => string;
    latitude: (item: any) => number;
    longitude: (item: any) => number;
    value?: (item: any) => number | undefined;
    buildingType?: (item: any) => string | undefined;
    contractorName?: (item: any) => string | undefined;
    ownerName?: (item: any) => string | undefined;
    projectKind?: (item: any) => string | undefined;
    workClass?: (item: any) => string | undefined;
    fixtures?: (item: any) => string | undefined;
    issuedDate?: (item: any) => Date | undefined;
    housingUnits?: (item: any) => number | undefined;
    developmentType?: (item: any) => string | undefined;
  };
}

export async function fetchSocrataPermits(
  dataset: SocrataDataset,
  limit: number = 50,
  // Single app token works across every Socrata-powered city. Pulled from
  // the admin console (provider SOCRATA) by the caller and passed in.
  appToken?: string | null,
): Promise<RawPermitData[]> {
  try {
    const url = new URL(dataset.endpoint);
    url.searchParams.set("$limit", String(limit));
    if (dataset.orderBy) url.searchParams.set("$order", dataset.orderBy);
    if (dataset.where) url.searchParams.set("$where", dataset.where);

    const headers: Record<string, string> = {};
    if (appToken) headers["X-App-Token"] = appToken;

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      console.error(
        `[Socrata:${dataset.city}] Fetch failed (${response.status})`,
      );
      return [];
    }

    const data = (await response.json()) as unknown[];
    if (!Array.isArray(data)) {
      console.error(`[Socrata:${dataset.city}] Unexpected response shape`);
      return [];
    }

    const permits: RawPermitData[] = [];
    for (const item of data) {
      const sourceId = dataset.fields.sourceId(item);
      const lat = dataset.fields.latitude(item);
      const lng = dataset.fields.longitude(item);

      if (!sourceId || isNaN(lat) || isNaN(lng)) continue;

      permits.push({
        sourceId,
        sourceCity: dataset.city,
        address: dataset.fields.address(item),
        originalDescription: dataset.fields.description(item),
        status: dataset.fields.status(item),
        latitude: lat,
        longitude: lng,
        projectValue: dataset.fields.value?.(item),
        buildingType: dataset.fields.buildingType?.(item),
        contractorName: dataset.fields.contractorName?.(item),
        ownerName: dataset.fields.ownerName?.(item),
        projectKind: dataset.fields.projectKind?.(item),
        workClass: dataset.fields.workClass?.(item),
        fixtures: dataset.fields.fixtures?.(item),
        issuedDate: dataset.fields.issuedDate?.(item),
        housingUnits: dataset.fields.housingUnits?.(item),
        developmentType: dataset.fields.developmentType?.(item),
      });
    }

    return permits;
  } catch (error) {
    console.error(`[Socrata:${dataset.city}] Adapter error:`, error);
    return [];
  }
}
