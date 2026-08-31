import { getActiveApiKey } from "@/lib/api-keys";
import {
  lookupParcelByAddress,
  lookupParcelByPoint,
  lookupParcelsInBox,
  pickSubjectParcel,
} from "@/lib/parcels";
import type { RegridParcel } from "@/lib/regrid";
import {
  CANVAS_H,
  CANVAS_W,
  MAP_H,
  MAP_SCALE,
  MAP_W,
  canvasPxPerFt,
  centroid,
  canvasToLatLng,
  cleanDisplayRing,
  latLngToCanvas,
  zoomToFit,
  type LatLng,
  type Pt,
} from "@/lib/fence/geo";
import { resolveMarket, type MarketSnapshot } from "@/lib/fence/market";
import { simplify } from "@/lib/ai/geometry";

/**
 * scan-core.ts — the FenceScan measuring pipeline, shared between the
 * authed estimator scan (app/actions/fence-scan.ts adds auth + rate
 * limit + recents) and the anonymous landing teaser (app/api/teaser
 * adds its own fail-closed IP/global caps).
 *
 * address → geocode → satellite tile (Google Static Maps, 640×412@2x,
 * drawn into the 900×580 canvas) → Regrid parcel polygon projected into
 * canvas space → suggested fence runs along the property lines.
 */

export type FenceRunSeed = { id: string; points: Pt[] };

export type FenceScanResult = {
  ok: true;
  address: string;
  center: LatLng;
  zoom: number;
  canvasPxPerFt: number;
  aerial: { imageDataUrl: string; width: number; height: number; zoom: number };
  /** Parcel outer ring(s), canvas coordinates. Empty when Regrid had no hit. */
  parcelRings: Pt[][];
  /** One suggested run per parcel edge chain (the full ring, closed). */
  suggestedRuns: FenceRunSeed[];
  /** Building footprints (house, garage, big sheds) in canvas coords —
   *  from OpenStreetMap, best-effort. The estimator seeds its editable
   *  house layer from these so the diagram + 3D show the home the fence
   *  ties into. Empty when OSM has nothing here. */
  buildings: Pt[][];
  parcel: { acres: number | null; apn: string | null; address: string | null } | null;
  /** Neighbouring parcels' outer rings, canvas coords — drawn fainter
   *  than the subject so shared lines and double lots read at a glance.
   *  Empty when the provider had nothing (or no key). */
  neighborRings: Pt[][];
  /** One label per neighbour ring: street address when the county
   *  record carries one, else the parcel number, else null. */
  neighborLabels: (string | null)[];
  /** Per-ring metadata for the click-to-switch flow: the ring in
   *  lat/lng plus the county record, aligned with neighborRings. */
  neighborInfo: {
    ringLL: LatLng[];
    address: string | null;
    apn: string | null;
    acres: number | null;
  }[];
  /** The geocoded address point in canvas coords — the little pin that
   *  shows WHICH property the address resolved to. */
  pin: Pt;
  /** Lat/lng twins of pin + parcel rings — the client reprojects all
   *  overlay geometry from these when the map is panned to a new
   *  center (the imagery refetches; the county lines just re-plot). */
  pinLL: LatLng;
  parcelRingsLL: LatLng[][];
  /** Local pricing market resolved from the geocoded state + ZIP.
   *  Frozen here and carried through takeoff → proposal so a quote
   *  never reprices itself when the market table is revised. */
  market: MarketSnapshot;
};

export type FenceScanError = { ok: false; reason: string };

/** Candidate keys in priority order. The vault key may be a
 *  browser-restricted key (right for the Leads map, refused by Google
 *  for server calls) — every server call here must fall back to the
 *  environment key when a key is denied. */
async function googleMapsKeys(): Promise<string[]> {
  const vault = await getActiveApiKey("GOOGLE_MAPS");
  const env =
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null;
  return [...new Set([vault, env].filter(Boolean))] as string[];
}

type GeocodeOutcome =
  | {
      ok: true;
      loc: LatLng;
      formatted: string;
      /** Two-letter state and 5-digit ZIP from the geocoder's structured
       *  components — the inputs the market resolver prices on. Null
       *  when Google didn't return them (rare, non-US, or a rooftop
       *  match with no postal code). */
      state: string | null;
      zip: string | null;
    }
  | { ok: false; kind: "not_found" | "service" };

/** Pull state + postal code out of a Geocoding API result. Structured
 *  components beat regex-ing the formatted string: they're already
 *  normalized and they don't confuse a street name for a state. */
function addressParts(hit: any): { state: string | null; zip: string | null } {
  const comps: any[] = Array.isArray(hit?.address_components)
    ? hit.address_components
    : [];
  const pick = (type: string, short = true) => {
    const c = comps.find((x) => Array.isArray(x?.types) && x.types.includes(type));
    if (!c) return null;
    const v = short ? c.short_name : c.long_name;
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const zipRaw = pick("postal_code");
  return {
    state: pick("administrative_area_level_1"),
    zip: zipRaw ? zipRaw.slice(0, 5) : null,
  };
}

async function geocode(address: string, keys: string[]): Promise<GeocodeOutcome> {
  let outcome: GeocodeOutcome = { ok: false, kind: "service" };
  for (const key of keys) {
    try {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", address);
      // US only — the autocomplete already filters to country:us, but a
      // hand-typed Toronto address geocoded fine and then priced at the
      // national-fallback market with a made-up tax rate.
      u.searchParams.set("components", "country:US");
      u.searchParams.set("key", key);
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        outcome = { ok: false, kind: "service" };
        continue;
      }
      const body = (await res.json()) as any;
      // ZERO_RESULTS = bad address. REQUEST_DENIED = this key can't do
      // server calls (browser-restricted) — try the next key. Anything
      // else non-OK is a service problem.
      if (body?.status && body.status !== "OK") {
        if (body.status === "ZERO_RESULTS") return { ok: false, kind: "not_found" };
        outcome = { ok: false, kind: "service" };
        if (body.status === "REQUEST_DENIED") continue;
        return outcome;
      }
      const hit = body?.results?.[0];
      const loc = hit?.geometry?.location;
      if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number")
        return { ok: false, kind: "not_found" };
      return {
        ok: true,
        loc: { lat: loc.lat, lng: loc.lng },
        formatted: hit.formatted_address ?? address,
        ...addressParts(hit),
      };
    } catch {
      outcome = { ok: false, kind: "service" };
    }
  }
  return outcome;
}

/**
 * Straighten a seeded fence run. County parcel polygons carry GPS
 * jitter — hundreds of sub-foot micro-kinks — and every kink becomes a
 * bent fence panel and a phantom corner post downstream. ~2 canvas px
 * (about a foot at scan zooms) removes the noise while keeping every
 * real corner; Douglas-Peucker only DELETES vertices, so what survives
 * still sits exactly on the county line. The displayed parcel boundary
 * stays dense — only the FENCE seed is cleaned.
 */
function straightenSeed(pts: Pt[], pxPerFt: number): Pt[] {
  if (pts.length < 4) return pts;
  // The tolerance must be PHYSICAL, not pixels: a big lot scans zoomed
  // out, where 2px is 4+ ft and a gently bowing county edge would get
  // chorded visibly inside the boundary (the "fence off its line" bug,
  // round two). ~1.1 ft eats GPS jitter everywhere without cutting bows.
  const eps = Math.min(2.5, Math.max(0.8, pxPerFt * 1.1));
  const out = simplify(pts, eps);
  return out.length >= 2 ? out : pts;
}

/** Ray-cast point-in-ring in lat/lng space (parcel scale — planar is fine). */
function pointInRingLL(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rough meters between two points (equirectangular — fine at parcel scale). */
function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export async function fenceScanCore(
  addressRaw: string,
): Promise<FenceScanResult | FenceScanError> {
  const address = addressRaw.trim().slice(0, 200);
  if (address.length < 8) return { ok: false, reason: "Enter a full street address" };

  const keys = await googleMapsKeys();
  if (keys.length === 0)
    return {
      ok: false,
      reason: "Google Maps key missing — add it in Admin → API keys.",
    };

  const geo = await geocode(address, keys);
  if (!geo.ok)
    return {
      ok: false,
      reason:
        geo.kind === "not_found"
          ? "Couldn't locate that address — check the spelling."
          : "The mapping service is temporarily unavailable — try again in a minute.",
    };

  // Property boundary (best-effort — the canvas works without it).
  //
  // A geocoded rooftop pin is only good to a few metres, so a bare
  // point-intersect regularly lands on the NEIGHBOUR's parcel on tight
  // lots — the "it scanned the house next door" bug. Instead: pull every
  // parcel in a ~120 m box around the pin (subject + neighbours in one
  // provider call) and pick the subject by geometry + address match.
  // The neighbours aren't waste — they ship in the result so the canvas
  // can draw the surrounding lines (shared fences, double lots).
  const BOX_M = 90;
  const dLat = BOX_M / 111_320;
  const dLng = BOX_M / (111_320 * Math.cos((geo.loc.lat * Math.PI) / 180));
  // Two candidate sources in parallel: parcels AROUND the pin, and the
  // provider's own situs-address match — the county's index knows that
  // "24 Mira Loma Ln" is THIS lot even when the rooftop pin drifts onto
  // the neighbour (or my string compare loses to a county formatting
  // quirk). The address hit goes first so ties break its way.
  const [boxHits, addrHit] = await Promise.all([
    lookupParcelsInBox(
      { lat: geo.loc.lat - dLat, lng: geo.loc.lng - dLng },
      { lat: geo.loc.lat + dLat, lng: geo.loc.lng + dLng },
      12,
    ),
    lookupParcelByAddress(geo.formatted),
  ]);
  const candidates: RegridParcel[] = [
    ...(addrHit ? [addrHit] : []),
    ...boxHits.filter(
      (b) =>
        !addrHit ||
        (b.apn && addrHit.apn
          ? b.apn !== addrHit.apn
          : metersBetween(centroid(b.rings.flat()), centroid(addrHit.rings.flat())) > 3),
    ),
  ];
  let parcel: RegridParcel | null = pickSubjectParcel(candidates, geo.loc, address);
  // Providers without box support (or a thin county) fall back to the
  // old single-parcel path — never lose a scan that used to work.
  if (!parcel) {
    parcel = await lookupParcelByPoint(geo.loc);
  }
  if (parcel) {
    const ring0 = parcel.rings.flat();
    if (ring0.length < 3 || metersBetween(centroid(ring0), geo.loc) > 250) {
      parcel = null;
    }
  }

  let pinLL: LatLng = geo.loc;
  if (parcel && !parcel.rings.some((ring) => pointInRingLL(geo.loc, ring))) {
    // Google's pin missed the lot. Prefer the county's OWN situs point
    // (ReportAll ships it per parcel) — a computed centroid is the
    // fallback, and it can land outside an L-shaped ring.
    pinLL =
      parcel.situs &&
      parcel.rings.some((ring) => pointInRingLL(parcel!.situs!, ring))
        ? parcel.situs
        : centroid(parcel.rings.flat());
  }

  const allPts: LatLng[] = parcel ? parcel.rings.flat() : [];
  // Center on the bbox midpoint (zoomToFit fits the bbox — centering on
  // the vertex centroid can push edges off the tile on L-shaped lots).
  let center: LatLng = geo.loc;
  if (allPts.length >= 3) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const pt of allPts) {
      minLat = Math.min(minLat, pt.lat); maxLat = Math.max(maxLat, pt.lat);
      minLng = Math.min(minLng, pt.lng); maxLng = Math.max(maxLng, pt.lng);
    }
    center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  }
  const zoom = allPts.length >= 3 ? zoomToFit(allPts, 19, 1.8) : 19;

  // Neighbour parcels for the VISIBLE frame. The canvas is 900x580 at
  // this center/zoom, so its own corners define the box — every lot the
  // contractor can see gets its line, including the ones flanking a
  // subject larger than any fixed radius. Junk county addresses
  // ("UNKNOWN") fall back to the APN.
  let neighbors: RegridParcel[] = [];
  if (parcel) {
    const nw = canvasToLatLng({ x: 0, y: 0 }, center, zoom);
    const se = canvasToLatLng({ x: CANVAS_W, y: CANVAS_H }, center, zoom);
    const inView = await lookupParcelsInBox(
      { lat: Math.min(nw.lat, se.lat), lng: Math.min(nw.lng, se.lng) },
      { lat: Math.max(nw.lat, se.lat), lng: Math.max(nw.lng, se.lng) },
      24,
    );
    const subjectRing = parcel.rings.flat();
    const subjectCtr = subjectRing.length >= 3 ? centroid(subjectRing) : geo.loc;
    neighbors = inView.filter((n) => {
      if (n.apn && parcel!.apn && n.apn === parcel!.apn) return false;
      const r = n.rings.flat();
      // APN-less rows: drop rings that are geometrically the subject.
      return !(r.length >= 3 && metersBetween(centroid(r), subjectCtr) < 3);
    });
  }

  // Satellite tile → data URL (same shape the proposal aerial expects).
  let imageDataUrl: string | null = null;
  for (const key of keys) {
    const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    mapUrl.searchParams.set("center", `${center.lat},${center.lng}`);
    mapUrl.searchParams.set("zoom", String(zoom));
    mapUrl.searchParams.set("size", `${MAP_W}x${MAP_H}`);
    mapUrl.searchParams.set("scale", String(MAP_SCALE));
    mapUrl.searchParams.set("maptype", "satellite");
    mapUrl.searchParams.set("key", key);
    try {
      const img = await fetch(mapUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) continue; // denied/quota on this key — try the next
      const buf = Buffer.from(await img.arrayBuffer());
      imageDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      break;
    } catch (e) {
      console.error("[fence-scan] static map failed", e);
    }
  }
  if (!imageDataUrl) {
    return { ok: false, reason: "Couldn't fetch satellite imagery for that address." };
  }

  const rings: Pt[][] = (parcel?.rings ?? []).map((ring) =>
    ring.map((p) => latLngToCanvas(p, center, zoom)),
  );
  // Suggested fence = the parcel ring itself (closed), one run per ring.
  // Seeded from the CLEANED ring: Douglas-Peucker alone keeps retrace
  // spikes (they're maximum-deviation points), so seeding from the raw
  // county vertices handed the fence a phantom leg. cleanDisplayRing
  // strips the closure dup too, so the ring is re-closed explicitly.
  const pxPerFt = canvasPxPerFt(center.lat, zoom);
  const cleanedRings = rings.map((r) => cleanDisplayRing(r, pxPerFt));
  const suggestedRuns: FenceRunSeed[] = cleanedRings.map((ring, i) => {
    const closed =
      ring.length >= 2 &&
      Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 1;
    const pts = ring.length > 0 && !closed ? [...ring, ring[0]] : ring;
    return { id: `parcel-${i}`, points: straightenSeed(pts, pxPerFt) };
  });

  return {
    ok: true,
    address: geo.formatted,
    center,
    zoom,
    canvasPxPerFt: canvasPxPerFt(center.lat, zoom),
    aerial: { imageDataUrl, width: CANVAS_W, height: CANVAS_H, zoom },
    // Display rings are cleaned (closure dup, jitter dots, retrace
    // spikes); the fence seed above starts from the same cleaned shape.
    parcelRings: cleanedRings,
    suggestedRuns,
    neighborRings: neighbors.flatMap((n) =>
      n.rings.map((ring) =>
        cleanDisplayRing(
          ring.map((pt) => latLngToCanvas(pt, center, zoom)),
          pxPerFt,
        ),
      ),
    ),
    neighborInfo: neighbors.flatMap((n) =>
      n.rings.map((ringLL) => ({
        ringLL,
        address: n.address,
        apn: n.apn,
        acres: n.acres,
      })),
    ),
    // The pin marks THE SUBJECT for the contractor. Google's rooftop
    // geocode drifts by tens of meters on some lots (verified live:
    // 26 Mira Loma Ln pinned a hillside two lots over while the county
    // situs record and the Census geocoder both agree on the parcel we
    // selected). When the pin misses the county-confirmed parcel, trust
    // the county — pin the parcel, not the guess.
    pin: latLngToCanvas(pinLL, center, zoom),
    pinLL,
    parcelRingsLL: parcel?.rings ?? [],
    neighborLabels: neighbors.flatMap((n) => {
      const cleaned = (n.address ?? "")
        .replace(/\bunknown\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const label =
        cleaned.length >= 4 ? cleaned : n.apn ? `APN ${n.apn}` : null;
      return n.rings.map(() => label);
    }),
    // Building footprints load ASYNC via getScanBuildings — Overpass
    // latency (1–9 s) used to sit here and made every scan feel slow.
    buildings: [],
    parcel: parcel
      ? { acres: parcel.acres, apn: parcel.apn, address: parcel.address }
      : null,
    // Structured components first; the formatted string is the fallback
    // for the odd result that carries no postal_code component.
    market: resolveMarket({
      state: geo.state,
      zip: geo.zip,
      address: geo.formatted,
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Reframe — switch the scan to a parcel the contractor clicked       */
/* ------------------------------------------------------------------ */

export type ReframeParcelArgs = {
  /** The chosen parcel's outer ring, lat/lng (from neighborInfo). */
  ringLL: LatLng[];
  address: string | null;
  apn: string | null;
  acres: number | null;
  /** Market rides through from the original scan — same state + ZIP. */
  market: MarketSnapshot;
  /** The address the contractor TYPED — the job keeps this name in the
   *  header and the proposal no matter which ring was clicked; the
   *  chosen parcel's own county record shows in the note instead. */
  displayAddress: string;
};

/**
 * Rebuild the scan AROUND a specific parcel — the recovery path when
 * the address resolved onto the wrong lot (or the job is the lot next
 * door). One aerial fetch + one neighbour box; no geocode, no parcel
 * re-match, because the caller is literally pointing at the ring.
 */
export async function reframeScanCore(
  args: ReframeParcelArgs,
): Promise<FenceScanResult | FenceScanError> {
  const ring = (args.ringLL ?? []).filter(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
  );
  if (ring.length < 3) return { ok: false, reason: "That parcel has no usable boundary" };

  const keys = await googleMapsKeys();
  if (keys.length === 0)
    return { ok: false, reason: "Google Maps key missing — add it in Admin → API keys." };

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const pt of ring) {
    minLat = Math.min(minLat, pt.lat); maxLat = Math.max(maxLat, pt.lat);
    minLng = Math.min(minLng, pt.lng); maxLng = Math.max(maxLng, pt.lng);
  }
  const center: LatLng = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const zoom = zoomToFit(ring, 19, 1.8);
  const ctr = centroid(ring);

  // Neighbours of the NEW frame, same viewport-box rule as the scan.
  const nw = canvasToLatLng({ x: 0, y: 0 }, center, zoom);
  const se = canvasToLatLng({ x: CANVAS_W, y: CANVAS_H }, center, zoom);
  const inView = await lookupParcelsInBox(
    { lat: Math.min(nw.lat, se.lat), lng: Math.min(nw.lng, se.lng) },
    { lat: Math.max(nw.lat, se.lat), lng: Math.max(nw.lng, se.lng) },
    24,
  );
  const neighbors = inView.filter((n) => {
    if (n.apn && args.apn && n.apn === args.apn) return false;
    const r = n.rings.flat();
    return !(r.length >= 3 && metersBetween(centroid(r), ctr) < 3);
  });

  let imageDataUrl: string | null = null;
  for (const key of keys) {
    const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    mapUrl.searchParams.set("center", `${center.lat},${center.lng}`);
    mapUrl.searchParams.set("zoom", String(zoom));
    mapUrl.searchParams.set("size", `${MAP_W}x${MAP_H}`);
    mapUrl.searchParams.set("scale", String(MAP_SCALE));
    mapUrl.searchParams.set("maptype", "satellite");
    mapUrl.searchParams.set("key", key);
    try {
      const img = await fetch(mapUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      imageDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      break;
    } catch (e) {
      console.error("[fence-scan] reframe static map failed", e);
    }
  }
  if (!imageDataUrl)
    return { ok: false, reason: "Couldn't fetch satellite imagery for that parcel." };

  const canvasRing = ring.map((p) => latLngToCanvas(p, center, zoom));
  const closed =
    canvasRing.length >= 2 &&
    Math.hypot(
      canvasRing[0].x - canvasRing[canvasRing.length - 1].x,
      canvasRing[0].y - canvasRing[canvasRing.length - 1].y,
    ) < 1;

  return {
    ok: true,
    address: args.displayAddress,
    center,
    zoom,
    canvasPxPerFt: canvasPxPerFt(center.lat, zoom),
    aerial: { imageDataUrl, width: CANVAS_W, height: CANVAS_H, zoom },
    parcelRings: [canvasRing],
    suggestedRuns: [
      { id: "parcel-0", points: straightenSeed(closed ? canvasRing : [...canvasRing, canvasRing[0]], canvasPxPerFt(center.lat, zoom)) },
    ],
    neighborRings: neighbors.flatMap((n) =>
      n.rings.map((r) => r.map((pt) => latLngToCanvas(pt, center, zoom))),
    ),
    neighborInfo: neighbors.flatMap((n) =>
      n.rings.map((ringLL) => ({
        ringLL,
        address: n.address,
        apn: n.apn,
        acres: n.acres,
      })),
    ),
    neighborLabels: neighbors.flatMap((n) => {
      const cleaned = (n.address ?? "")
        .replace(/\bunknown\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const label = cleaned.length >= 4 ? cleaned : n.apn ? `APN ${n.apn}` : null;
      return n.rings.map(() => label);
    }),
    pin: latLngToCanvas(ctr, center, zoom),
    pinLL: ctr,
    parcelRingsLL: [ring],
    buildings: [],
    parcel: { acres: args.acres, apn: args.apn, address: args.address },
    market: args.market,
  };
}

/**
 * Just the satellite tile for a center+zoom — the movable-map refetch.
 * No geocode, no parcel spend: panning re-plots the county lines the
 * scan already paid for and only buys fresh pixels (~a fifth of a
 * cent per pan).
 */
export async function fetchAerialTile(
  center: LatLng,
  zoom: number,
): Promise<{ ok: true; imageDataUrl: string } | FenceScanError> {
  const keys = await googleMapsKeys();
  if (keys.length === 0)
    return { ok: false, reason: "Google Maps key missing — add it in Admin → API keys." };
  const z = Math.max(15, Math.min(21, Math.round(zoom)));
  for (const key of keys) {
    const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    mapUrl.searchParams.set("center", `${center.lat},${center.lng}`);
    mapUrl.searchParams.set("zoom", String(z));
    mapUrl.searchParams.set("size", `${MAP_W}x${MAP_H}`);
    mapUrl.searchParams.set("scale", String(MAP_SCALE));
    mapUrl.searchParams.set("maptype", "satellite");
    mapUrl.searchParams.set("key", key);
    try {
      const img = await fetch(mapUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      return { ok: true, imageDataUrl: `data:image/png;base64,${buf.toString("base64")}` };
    } catch (e) {
      console.error("[fence-scan] tile refetch failed", e);
    }
  }
  return { ok: false, reason: "Couldn't fetch satellite imagery there." };
}
