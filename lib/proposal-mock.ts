import type {
  BrandLogo,
  Downspout,
  EditableLine,
  EstimateConfig,
  LineItem,
  Measurements,
  RoofStructure,
} from "./types";
import { buildLineItems, fenceTaxRate, fenceTaxableShare } from "./pricing";
import type { FenceViewSet } from "./fence/viewpoints";
import { sampleMeasurements } from "./mock-estimate";

export type PackageId = "good" | "better" | "best";

export type AddOn = {
  id: string;
  name: string;
  description?: string;
  price: number;
  included: boolean;
};

/**
 * Location-aware market price the AI suggested for one package — what a
 * job with this spec + footage typically sells for around the property's
 * address. Contractor-facing only (never rendered in the client portal).
 * Cached on the package so the builder doesn't re-ask the AI on every
 * open; `inputKey` fingerprints the inputs so a changed spec or address
 * surfaces a "refresh" nudge instead of a silently stale number.
 */
export type AiPriceQuote = {
  /** Suggested sticker price (tax-in, dollars) — what gets applied. */
  recommendedTotal: number;
  /** Realistic local low / high for the same job. */
  lowTotal: number;
  highTotal: number;
  /** Installed $/LF market rate the suggestion leans on (null if n/a). */
  perLfInstalled: number | null;
  /** Per-BOM-line AI SELLING price (line id → dollars), so the materials
   *  builder shows each line individually re-priced by the AI in AI mode
   *  (normalized to sum to recommendedTotal at display). Absent/empty on
   *  older quotes or when the AI skipped the breakdown → fall back to the
   *  uniform-markup line prices. */
  lineItems?: Record<string, number>;
  /** 2–4 short contractor-facing bullets on how it priced the job. */
  reasoning: string[];
  /** The location the AI actually priced against (e.g. "Austin, TX"). */
  location: string;
  fetchedAt: string;
  inputKey: string;
};

export type Package = {
  id: PackageId;
  name: string;
  tagline: string;
  config: EstimateConfig;
  highlights: string[];
  addOns: AddOn[];
  markupPct: number;
  recommended?: boolean;
  /** "ai" = the AI market price is applied (markupPct was back-solved to
   *  land the total on `aiQuote.recommendedTotal`); "manual"/absent = the
   *  contractor's own pricing. Editing markup or the typed total while in
   *  "ai" flips back to "manual" — the switch never traps the price. */
  pricingMode?: "manual" | "ai";
  /** markupPct stashed when switching to AI so flipping back to "Your
   *  price" restores exactly what the contractor had. */
  myMarkupPct?: number;
  aiQuote?: AiPriceQuote;
  /** Per-line BOM tweaks keyed by the auto line id from `buildLineItems`
   *  (e.g. "gutter", "labor"). Lets the contractor override a quantity or
   *  unit price WITHOUT detaching the bill of materials from the live
   *  config — change the material and the un-overridden lines still
   *  refresh. Absent = pure auto BOM (the common case). */
  lineItemOverrides?: Record<string, { quantity?: number; unitPrice?: number }>;
  /** Hand-added BOM lines beyond the auto-generated system (custom
   *  fabrication, a one-off charge, etc.). */
  customLineItems?: LineItem[];
  /** Bucket adjusters (percent, clamped ±50): scale every MATERIALS
   *  line (taxable) / every LABOR line (untaxed) before markup — the
   *  knob for "premium supplier" or "hard-access labor" jobs. Markup
   *  stays the profit knob on top. Absent = 0. */
  materialsAdjPct?: number;
  laborAdjPct?: number;
  /** Which smart job-condition chips are applied (JOB_FACTORS ids) —
   *  bookkeeping for the toggles; the money lives in the adjusters. */
  jobFactors?: string[];
};

/** Smart job conditions — things the takeoff engine CANNOT see (terrain,
 *  slope steps and wall mounts are already priced; suggesting those
 *  here would double-charge). One tap applies the bump, tap again
 *  removes it. Single-bucket by design so the reset buttons stay sane. */
export const JOB_FACTORS: {
  id: string;
  label: string;
  hint: string;
  materials: number;
  labor: number;
  /** Only offer when relevant to this package's fence config. */
  when?: (cfg: EstimateConfig) => boolean;
}[] = [
  {
    id: "tight-access",
    label: "Tight access",
    hint: "No vehicle to the line — posts, concrete and panels move by hand",
    materials: 0,
    labor: 10,
  },
  {
    id: "heavy-teardown",
    label: "Concrete in tear-out",
    hint: "Old posts set in concrete — demo runs heavier than a clean pull",
    materials: 0,
    labor: 15,
    when: (cfg) => (cfg.fence?.removalLf ?? 0) > 0,
  },
  {
    id: "rush",
    label: "Rush schedule",
    hint: "Client wants it now — weekend or reshuffled crew time",
    materials: 0,
    labor: 10,
  },
  {
    id: "lumber-up",
    label: "Material prices high",
    hint: "Supplier running hot this month — protect the materials side",
    materials: 5,
    labor: 0,
  },
  {
    id: "sharpen",
    label: "Sharpen the bid",
    hint: "Competitive job — trim labor 5% to win it",
    materials: 0,
    labor: -5,
  },
];

/**
 * Effective bill of materials for a package: the auto lines derived from
 * its config (with any per-line overrides applied) followed by the
 * contractor's custom lines. Single source of truth for both the
 * MaterialsBuilder BOM editor and `packageTotal` so the displayed lines
 * and the price can never disagree.
 */
const clampAdj = (pct: number | undefined) =>
  Math.max(-50, Math.min(50, Number.isFinite(pct) ? pct! : 0));

export function packageLineItems(
  p: Package,
  measurements: Measurements,
): LineItem[] {
  // Bucket adjusters scale unit prices by bucket (taxable ⇒ materials,
  // untaxed ⇒ labor/tear-out) so every consumer — BOM editor, totals,
  // tax share, client breakdown, job costing — moves together.
  const mAdj = 1 + clampAdj(p.materialsAdjPct) / 100;
  const lAdj = 1 + clampAdj(p.laborAdjPct) / 100;
  const scale = (it: LineItem): LineItem =>
    mAdj === 1 && lAdj === 1
      ? it
      : {
          ...it,
          unitPrice:
            Math.round(it.unitPrice * (it.taxable ? mAdj : lAdj) * 100) / 100,
        };
  const auto: LineItem[] = buildLineItems(measurements, p.config).map((it) => {
    const ov = p.lineItemOverrides?.[it.id];
    const base = !ov
      ? it
      : {
          ...it,
          quantity: ov.quantity ?? it.quantity,
          unitPrice: ov.unitPrice ?? it.unitPrice,
        };
    return scale(base);
  });
  return [...auto, ...(p.customLineItems ?? []).map(scale)];
}

export type Photo = {
  id: string;
  caption: string;
  tone: "front" | "side" | "back" | "detail";
};

export type TermsBlock = {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
};

/** Live takeoff snapshot carried over from /estimate. Optional —
 *  proposals created from scratch (without going through the estimate
 *  flow) don't have it, and the aerial section falls back to a sample
 *  cartoon roof in that case. */
export type ProposalTakeoff = {
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Downspout[];
  /** Suggested interior gutter runs (un-priced tier-break hints). Drawn
   *  dashed on the diagram with a tap-to-add affordance; never counted in
   *  the priced eave LF until the contractor accepts one. */
  suggestedEaves?: EditableLine[];
  /** Roof outline + ridge/hip/valley lines for the read-only overlay. */
  roofStructure?: RoofStructure;
  aerial?: {
    imageDataUrl: string;
    width: number;
    height: number;
    zoom: number;
  };
  /** Canvas-px-per-foot for the satellite trace, carried from the
   *  estimate so the proposal's eave LF + re-price use the same scale
   *  (not the plan-mode PX_PER_FT=2.4). Absent for plan/older takeoffs. */
  canvasPxPerFt?: number;
  /** FenceScan: ground elevation (ft) sampled at every post position
   *  along each run, same order as `eaves` — lets the proposal's 3D
   *  preview draw the fence stepping down the real slope. Absent (or
   *  misaligned after canvas edits) ⇒ the preview renders flat. */
  runElevationsFt?: number[][];
  /** Walk spacing (canvas px) the elevations were sampled at — tiers can
   *  quote a fence type with a different post spacing, so the sampling
   *  spacing must travel with the samples to re-pair them to the runs. */
  elevationSpacingPx?: number;
  /** FenceScan: the scan's topo lattice (rows × cols of ft spanning the
   *  full canvas) — the proposal 3D renders the yard as a shaded terrain
   *  surface from it. ~200 numbers; absent on older drafts. */
  topoGridFt?: number[][];
  /** FenceScan: the 3D camera the contractor froze when building the
   *  proposal — the client's portal opens on this exact angle (and they
   *  can spin it from there). Superseded by `views3d`; kept because
   *  proposals sent before saved angles existed carry only this, and
   *  normalizeViewSet promotes it to a one-shot set. */
  view3d?: { yawDeg: number; squash: number };
  /** FenceScan: the contractor's 3D PRESENTATION — the named camera
   *  angles the client can step through, which one the portal opens on,
   *  and how much the client is allowed to move the camera
   *  (free / guided / locked). See lib/fence/viewpoints. */
  views3d?: FenceViewSet;
  /** FenceScan: building footprints (canvas coords) — the house renders
   *  in the client's diagram + 3D so wall-connected fence reads right. */
  buildings?: { x: number; y: number }[][];
  /** FenceScan: mixed-type stretches of the drawn fence (from-here-to-
   *  here spans built as a different type) — the 3D renders each with
   *  its own material. */
  fenceSections?: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    type: string;
    /** Stretch footage (ft) — refreshed by the proposal canvas when the
     *  stretch is edited; feeds config.fence.mixed aggregation. */
    lfFt?: number;
  }[];
};

export type Proposal = {
  token: string;
  address: string;
  client: { name: string; email: string };
  contractor: {
    name: string;
    company: string;
    phone: string;
    email: string;
    license: string;
    stripePaymentUrl?: string | null;
    squarePaymentUrl?: string | null;
    /** Brand mark snapshotted at build time. The client portal is opened
     *  logged-out, so it cannot read the contractor's live profile —
     *  without this the homeowner sees the default monogram instead of
     *  the uploaded logo. Optional: proposals stored before this existed
     *  simply fall back to the monogram. */
    logo?: BrandLogo | null;
  };
  intro: string;
  measurements: Measurements;
  takeoff?: ProposalTakeoff;
  packages: Package[];
  photos: Photo[];
  terms: TermsBlock[];
  depositPct: number;
  validDays: number;
  /** How package pricing presents to the CLIENT:
   *  - "totals"  — everything included is listed, priced at the package
   *    level only (default — protects margin, reads confident)
   *  - "split"   — adds Materials & parts vs Labor & installation
   *    subtotals (transparency without per-line shopping)
   *  - "itemized"— every line priced (commercial/insurance work)
   *  Absent on legacy blobs ⇒ "totals". */
  priceDisplay?: "totals" | "split" | "itemized";
  /** Per-proposal discount applied to every package total. Stored as
   *  a percentage (0-50). 0 = no discount. Optional + defaulted to 0
   *  on load so older proposals without this field still render. */
  discountPct?: number;
  /** Free-form reason the contractor shows next to the discount so
   *  the homeowner sees WHY (e.g. 'Spring promo', 'Repeat customer'). */
  discountLabel?: string;
  /** Contractor's manual override of what this job costs THEM (dollars,
   *  materials + labor basis) — replaces the AI estimate everywhere the
   *  profit math runs (builder profit panel, /dashboard/financials).
   *  Never shown to the client. null/absent = trust the AI estimate. */
  jobCostManual?: number | null;
  /** How the measurements were produced. "manual" = the contractor
   *  walked the site with a tape measure and typed the numbers in
   *  (/dashboard/measure) — there is no takeoff geometry to draw, so
   *  the aerial section renders the field-measurement card instead of
   *  the sample cartoon. Absent = satellite/plan takeoff or a blank
   *  builder draft (legacy proposals never carry it). */
  source?: "manual";
};

export const sampleProposal: Proposal = {
  token: "demo-7f3a2",
  address: "1247 Maple Ridge Drive, Austin, TX 78704",
  client: { name: "Sarah & Mike Chen", email: "sarah.chen@example.com" },
  contractor: {
    name: "Alex Rivera",
    company: "Rivera Fenceworks",
    phone: "(512) 555-0184",
    email: "alex@riverafencing.com",
    license: "TX-RCC-48217",
    stripePaymentUrl: "https://buy.stripe.com/test_demo_link",
    squarePaymentUrl: null,
    logo: { initials: "RF", tone: "emerald", url: null },
  },
  intro:
    "Thanks for the opportunity to quote your new fence. Below are three package options for your property with detailed materials, labor, and a 1-click way to accept. Pricing is locked for 30 days.",
  measurements: sampleMeasurements,
  packages: [
    {
      id: "good",
      name: "Good — Treated Pine",
      tagline: "Solid privacy at the best price",
      config: {
        size: "5",
        style: "k-style",
        material: "aluminum",
        color: "white",
        downspoutSize: "2x3",
        fence: {
          type: "pt-pine-privacy",
          heightFt: 6,
          terrain: "flat",
          stain: false,
          removalLf: 0,
          gatesSingle: 1,
          gatesDouble: 0,
          corners: 2,
          ends: 2,
        },
      },
      highlights: [
        "6' pressure-treated pine privacy",
        "Posts set in concrete, 8' on center",
        "One 4' walk gate, hung & latched",
        "1-year workmanship warranty",
      ],
      addOns: [
        {
          id: "extra-gate",
          name: "Additional walk gate (4')",
          description: "Heavy-set posts, hinges & latch",
          price: 325,
          included: false,
        },
      ],
      markupPct: 30,
    },
    {
      id: "better",
      name: "Better — Western Cedar",
      tagline: "Most popular — the fence as designed",
      config: {
        size: "6",
        style: "k-style",
        material: "aluminum",
        color: "graphite",
        downspoutSize: "3x4",
        fence: {
          type: "cedar-privacy",
          heightFt: 6,
          terrain: "flat",
          stain: false,
          removalLf: 0,
          gatesSingle: 1,
          gatesDouble: 0,
          corners: 2,
          ends: 2,
        },
      },
      highlights: [
        "6' western red cedar privacy",
        "Galvanized ring-shank fasteners",
        "Posts set in concrete, 8' on center",
        "One 4' walk gate, hung & latched",
        "3-year workmanship warranty",
      ],
      addOns: [
        {
          id: "steel-posts",
          name: "Steel-core posts (never rot)",
          description: "Postmaster-style, hidden from the good side",
          price: 0,
          included: true,
        },
        {
          id: "extra-gate",
          name: "Additional walk gate (4')",
          price: 385,
          included: false,
        },
      ],
      markupPct: 35,
      recommended: true,
    },
    {
      id: "best",
      name: "Best — Cedar, Stained & Sealed",
      tagline: "Furniture-grade finish, longest life",
      config: {
        size: "6",
        style: "half-round",
        material: "copper",
        color: "copper",
        downspoutSize: "round-4",
        fence: {
          type: "cedar-privacy",
          heightFt: 6,
          terrain: "flat",
          stain: true,
          removalLf: 0,
          gatesSingle: 1,
          gatesDouble: 0,
          corners: 2,
          ends: 2,
        },
      },
      highlights: [
        "6' western red cedar privacy",
        "Penetrating stain & seal, both faces",
        "Steel-core posts + decorative caps",
        "One 4' walk gate, hung & latched",
        "5-year workmanship warranty",
      ],
      addOns: [
        {
          id: "caps",
          name: "Decorative post caps",
          price: 0,
          included: true,
        },
        {
          id: "double-gate",
          name: "Drive gate (10') upgrade",
          description: "Double swing with drop rod",
          price: 980,
          included: false,
        },
      ],
      markupPct: 38,
    },
  ],
  photos: [
    { id: "p1", caption: "Front facade — south exposure", tone: "front" },
    { id: "p2", caption: "Side yard — clear equipment access", tone: "side" },
    { id: "p3", caption: "Backyard tree overhang", tone: "back" },
    {
      id: "p4",
      caption: "Existing fence condition (NW corner)",
      tone: "detail",
    },
  ],
  terms: [
    {
      id: "scope",
      title: "Scope of work",
      body: "Layout and one-call utility locate, post holes dug and set in concrete, fence built per the package selected, gates hung and adjusted. Includes site cleanup and haul-away of construction debris.",
      enabled: true,
    },
    {
      id: "warranty",
      title: "Workmanship warranty",
      body: "Rivera Fenceworks warrants all installation labor for the period stated in the selected package. Material warranties pass through from manufacturer. Warranty is non-transferable except with prior written consent.",
      enabled: true,
    },
    {
      id: "payment",
      title: "Payment terms",
      body: "Deposit due at signing via secure Stripe link. Balance due upon substantial completion. Payments processed by Stripe; no card details are stored by Rivera Fenceworks.",
      enabled: true,
    },
    {
      id: "scheduling",
      title: "Scheduling & weather",
      body: "Install will be scheduled within 14 days of accepted proposal. Work is weather-dependent and may be rescheduled with 24-hour notice in the event of unsafe conditions.",
      enabled: true,
    },
    {
      id: "exclusions",
      title: "Exclusions",
      body: "Pricing excludes unmarked private utilities, rock or root obstructions requiring machine excavation, retaining or grading work, and any permits beyond standard residential.",
      enabled: false,
    },
  ],
  depositPct: 30,
  validDays: 30,
};

/**
 * Returns a clean starting state for a new proposal: contractor + client
 * fields blank, photos empty, but the package and terms libraries
 * pre-populated as starting templates the user can edit.
 *
 * Use this from /proposal when starting a fresh draft. The full
 * `sampleProposal` above is for the public /p/[token] demo and tests.
 */
export function blankProposal(): Proposal {
  return {
    token: `draft-${Math.random().toString(36).slice(2, 9)}`,
    address: "",
    client: { name: "", email: "" },
    contractor: {
      name: "",
      company: "",
      phone: "",
      email: "",
      license: "",
      stripePaymentUrl: null,
      squarePaymentUrl: null,
      logo: null,
    },
    intro:
      "Thanks for the opportunity to quote your fence project. Below you'll find package options sized to your property, with detailed materials, labor, and a 1-click way to accept.",
    measurements: sampleMeasurements,
    packages: sampleProposal.packages.map((p) => ({
      ...p,
      addOns: p.addOns.map((a) => ({ ...a })),
    })),
    photos: [],
    terms: sampleProposal.terms.map((t) => ({ ...t })),
    depositPct: 30,
    validDays: 30,
  };
}

/**
 * Strips contractor-private pricing internals from a proposal before it
 * crosses the public portal boundary (/p/[token] serializes the whole
 * object into the page payload, so "not rendered" is not "not visible" —
 * dev tools would show it). The homeowner gets exactly ONE price per
 * tier: whatever pricing mode was active when the proposal was saved.
 * They must never see the AI quote (market low/high anchors their
 * negotiation), the stashed manual markup (reveals the other price), or
 * even that AI pricing was used at all.
 *
 * `markupPct` stays — the portal needs it to compute the very totals
 * being quoted, and it's the same single knob both modes write to.
 */
export function sanitizeProposalForClient(p: Proposal): Proposal {
  return {
    ...p,
    packages: p.packages.map((pkg) => {
      const { aiQuote, myMarkupPct, pricingMode, ...pub } = pkg;
      void aiQuote;
      void myMarkupPct;
      void pricingMode;
      return pub;
    }),
  };
}

/** Effective sales-tax factor applied to the post-discount total. The
 *  0.85 fudge reflects the share of the job that's taxable material vs
 *  non-taxable labor. Exported so the inverse (`markupPctForTarget`)
 *  can't drift from the forward calc below. */
export const EFFECTIVE_TAX_RATE = 0.0825 * 0.85;
/** Plain sales-tax rate applied to the TAXABLE share of fence packages
 *  (materials/gates/stain — labor and removal are untaxed). */
export const FENCE_TAX_RATE = 0.0825;

/** One client-facing breakdown row (marked-up, discount-applied). */
export type ClientBreakdownLine = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  /** SELLING price for this line (markup + discount allocated
   *  proportionally), pre-tax dollars. */
  clientPrice: number;
  taxable: boolean;
};

export type ClientBreakdown = {
  lines: ClientBreakdownLine[];
  /** Σ taxable lines (materials, gates, stain, hardware) — pre-tax. */
  materials: number;
  /** Σ untaxed lines (installation labor, tear-out) — pre-tax. */
  labor: number;
  tax: number;
  total: number;
};

/**
 * The breakdown a CLIENT may see, in selling prices: every line scaled
 * by the package's markup and the proposal discount so the rows sum to
 * exactly the quoted pre-tax price (largest line absorbs the rounding
 * remainder). The materials/labor buckets ride the taxable flag — the
 * same split the tax math already uses.
 */
export function packageClientBreakdown(
  p: Package,
  measurements: Measurements,
  discountPct: number = 0,
): ClientBreakdown {
  const items = packageLineItems(p, measurements);
  const totals = packageTotal(p, measurements, discountPct);
  const preTax = totals.total - totals.tax;
  const base = totals.subtotal; // items + included add-ons, pre-markup
  const factor = base > 0 ? preTax / base : 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const lines: ClientBreakdownLine[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    quantity: it.quantity,
    unit: it.unit,
    clientPrice: r2(it.quantity * it.unitPrice * factor),
    taxable: it.taxable,
  }));
  for (const a of p.addOns) {
    if (!a.included) continue;
    lines.push({
      id: `addon-${a.id}`,
      name: a.name,
      quantity: 1,
      unit: "ea",
      clientPrice: r2(a.price * factor),
      taxable: true,
    });
  }
  // Cent-exact: park the rounding drift on the largest line so the
  // itemization always reconciles to the quoted price.
  const drift = r2(preTax - lines.reduce((acc, l) => acc + l.clientPrice, 0));
  if (drift !== 0 && lines.length > 0) {
    const biggest = lines.reduce((m, l) =>
      l.clientPrice > m.clientPrice ? l : m,
    );
    biggest.clientPrice = r2(biggest.clientPrice + drift);
  }
  return {
    lines,
    materials: r2(
      lines.filter((l) => l.taxable).reduce((a, l) => a + l.clientPrice, 0),
    ),
    labor: r2(
      lines.filter((l) => !l.taxable).reduce((a, l) => a + l.clientPrice, 0),
    ),
    tax: r2(totals.tax),
    total: r2(totals.total),
  };
}

export function packageTotal(
  p: Package,
  measurements: Measurements,
  /** Per-proposal discount percentage (0-50). Applied AFTER markup,
   *  BEFORE tax — same order the estimate Summary already uses, so
   *  the dashboard / proposal / client portal all show the same
   *  number for a given package + discount combination. */
  discountPct: number = 0,
): {
  subtotal: number;
  total: number;
  addOns: number;
  discount: number;
  /** Tax embedded in `total` — job costing derives the job's real
   *  effective rate from this. */
  tax: number;
} {
  const items = packageLineItems(p, measurements);
  const baseSubtotal = items.reduce(
    (acc, i) => acc + i.quantity * i.unitPrice,
    0,
  );
  const addOns = p.addOns.reduce(
    (acc, a) => acc + (a.included ? a.price : 0),
    0,
  );
  const subtotal = baseSubtotal + addOns;
  const markup = subtotal * (p.markupPct / 100);
  const afterMarkup = subtotal + markup;
  const safePct = Math.max(0, Math.min(50, discountPct));
  const discount = afterMarkup * (safePct / 100);
  // Fence packages tax honestly: only the taxable share of the bill
  // (materials/gates/stain — labor and tear-out are flagged
  // taxable:false) at the plain sales-tax rate, pro-rated across
  // markup/discount. Legacy gutter packages keep the historical
  // effective rate so no already-sent proposal ever reprices itself.
  // priceFence (the estimator rail) mirrors this exactly — parity is
  // asserted in lib/fence/takeoff.test.mts.
  let tax: number;
  if (p.config.fence) {
    // Rate and taxable share both come from the job's frozen market
    // snapshot when it has one (local rate; whole contract taxable in
    // the states that tax installation labor). No snapshot → the
    // legacy national rate, materials only.
    const market = p.config.fence.market;
    const share = fenceTaxableShare(items, market, addOns);
    tax =
      (afterMarkup - discount) * share * fenceTaxRate(market, FENCE_TAX_RATE);
  } else {
    tax = (afterMarkup - discount) * EFFECTIVE_TAX_RATE;
  }
  return {
    subtotal,
    addOns,
    discount,
    /** The tax embedded in `total` — job costing derives each job's
     *  REAL effective rate from this (fence jobs tax only the taxable
     *  share, so a flat rate would misstate profit). */
    tax,
    total: afterMarkup - discount + tax,
  };
}

/**
 * Derives a proposal's contract total (in cents) from its JSON data
 * blob. Single source of truth shared by the dashboard list, KPIs,
 * acceptance flow and payment schedule so every surface prices a
 * proposal the same way.
 *
 * Priority: explicit `preferPackageId` (what the homeowner picked) →
 * the recommended tier → index 1 ("Pro Shield") → first package.
 * Returns `fallbackCents` untouched when it's already a real number.
 */
export function deriveTotalCentsFromData(
  data: unknown,
  fallbackCents: number = 0,
  preferPackageId?: string | null,
): number {
  if (fallbackCents > 0 && !preferPackageId) return fallbackCents;
  const proposal = data as Partial<Proposal> | null;
  if (
    !proposal ||
    !Array.isArray(proposal.packages) ||
    proposal.packages.length === 0 ||
    !proposal.measurements
  ) {
    return Math.max(0, fallbackCents);
  }
  const packages = proposal.packages;
  const selectedId =
    preferPackageId ??
    (proposal as { selectedPackageId?: string }).selectedPackageId;
  const pick =
    (selectedId ? packages.find((p) => p.id === selectedId) : null) ??
    packages.find((p) => p.recommended) ??
    packages[1] ??
    packages[0];
  if (!pick) return Math.max(0, fallbackCents);
  try {
    const { total } = packageTotal(
      pick,
      proposal.measurements,
      proposal.discountPct ?? 0,
    );
    const cents = Math.max(0, Math.round(total * 100));
    return cents > 0 ? cents : Math.max(0, fallbackCents);
  } catch {
    return Math.max(0, fallbackCents);
  }
}

/**
 * Inverse of `packageTotal`'s `total`. Given a sticker price the
 * contractor types in, return the `markupPct` that produces it at the
 * current subtotal + discount, so the editor can offer a "type any
 * price" field while markup stays the single stored knob. Derived from
 *   total = subtotal · (1 + m) · (1 − d) · (1 + EFFECTIVE_TAX_RATE)
 * solved for m. `subtotal` here is the package subtotal *including*
 * add-ons (the `subtotal` field `packageTotal` returns). Returns a
 * full-precision percentage so the typed total round-trips exactly;
 * round only for display. May go negative (selling below cost) — that's
 * the contractor's call, not ours to clamp.
 */
export function markupPctForTarget(
  targetTotal: number,
  subtotal: number,
  discountPct: number = 0,
): number {
  if (subtotal <= 0) return 0;
  const d = Math.max(0, Math.min(50, discountPct)) / 100;
  const ratio = targetTotal / (subtotal * (1 - d) * (1 + EFFECTIVE_TAX_RATE));
  return (ratio - 1) * 100;
}

/* ------------------------------------------------------------------ */
/*  Price-negotiation helpers (discount requests)                      */
/* ------------------------------------------------------------------ */

/**
 * The proposal-wide `discountPct` that makes a reference package's total
 * land on `targetTotal`. Inverse of `packageTotal`'s discount lever:
 *   total(d) = total(0) · (1 − d)   ⇒   d = 1 − target / total(0)
 * `total(0)` is the package priced at zero discount (markup + tax only).
 * Clamped to [0, 50] to match `packageTotal`'s own clamp — a client can't
 * negotiate below 50% off through this path even if they ask to. Returns
 * 0 for a non-positive base (malformed measurements).
 */
export function discountPctForTargetTotal(
  p: Package,
  measurements: Measurements,
  targetTotal: number,
): number {
  const base = packageTotal(p, measurements, 0).total;
  if (base <= 0) return 0;
  const pct = (1 - targetTotal / base) * 100;
  return Math.max(0, Math.min(50, pct));
}

export type MarginBreakdown = {
  /** Sale price ex-tax (what actually lands in the contractor's pocket). */
  revenueCents: number;
  /** Contractor cost basis (pre-markup subtotal incl. add-ons). */
  costCents: number;
  /** revenue − cost. Negative = selling below cost. */
  marginCents: number;
  /** margin / revenue, 0..1 (0 when revenue is non-positive). */
  marginPct: number;
  belowCost: boolean;
};

/**
 * Margin left at a given sale total, for the contractor's counter coach.
 * The sale total is post-tax (the number both sides negotiate over), so
 * we strip the effective tax back out before comparing to cost. All
 * inputs/outputs in cents so the UI never re-rounds.
 */
export function marginForSaleTotalCents(
  saleTotalCents: number,
  costCents: number,
): MarginBreakdown {
  const revenueCents = Math.round(saleTotalCents / (1 + EFFECTIVE_TAX_RATE));
  const marginCents = revenueCents - costCents;
  return {
    revenueCents,
    costCents,
    marginCents,
    marginPct: revenueCents > 0 ? marginCents / revenueCents : 0,
    belowCost: marginCents < 0,
  };
}
