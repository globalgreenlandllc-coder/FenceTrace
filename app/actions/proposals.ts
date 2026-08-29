"use server";

import { fenceTierPatches, type FenceDraftInput } from "@/lib/fence/proposal";
import { normalizeViewSet, type FenceViewSet } from "@/lib/fence/viewpoints";
import { freezeFenceRatesForEstimate } from "./fence-rates";
import { loadProposalDefaults } from "@/lib/proposal-defaults";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import type { BrandLogo } from "@/lib/types";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sendEmailViaResend } from "@/lib/email/resend";
import { renderProposalEmail } from "@/lib/email/proposal-template";
import { warmProposalAudio } from "@/lib/proposal-audio";
import {
  blankProposal,
  deriveTotalCentsFromData,
  packageTotal,
  sanitizeProposalForClient,
  type Proposal,
} from "@/lib/proposal-mock";
import type { Downspout, EditableLine, Measurements } from "@/lib/types";
import { checkUserEmailBudget, checkPortalWrite } from "@/lib/abuse/guards";
import { POLICIES } from "@/lib/abuse/policies";
import { FREE_PROPOSALS_PER_MONTH } from "@/lib/stripe";
import { captureTakeoffCorrection } from "@/lib/ai/takeoff-corrections";
import { getMe } from "./me";
import { createDefaultSchedule } from "@/lib/payment-schedule";
import { sendInvoiceForInstallment } from "@/lib/payments/provider-invoices";

export type SendProposalResult =
  | {
      ok: true;
      token: string;
      portalUrl: string;
      messageId: string;
      /** The spoken summary was built and is ready to play. False when
       *  TTS is unconfigured or was too slow — the portal generates it on
       *  the client's first tap instead. */
      audioReady: boolean;
    }
  | {
      ok: false;
      reason: string;
      /** "limit_reached" lets the send modal show the one-click upgrade
       *  instead of a plain error — the cap moment IS the buy moment. */
      code?: "limit_reached";
    };

/**
 * Persists the in-memory proposal draft to the database and emails the
 * homeowner a magic link to /p/[token]. Idempotent on a stable token —
 * calling this twice with the same `proposal.token` updates the existing row
 * and sends a fresh email.
 */
export async function sendProposal(args: {
  proposal: Proposal;
  subject: string;
  message: string;
  /** Which rail to bill this job on once the client accepts — "square" |
   *  "stripe" | "stax", or null to invoice by hand later. Chosen at send
   *  time because that is when the contractor is thinking about this
   *  client. */
  payWith?: "square" | "stripe" | "stax" | null;
}): Promise<SendProposalResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };

  const { proposal, subject, message } = args;

  // The rail the client will be billed on. Validated here rather than
  // trusted: this drives a real charge later.
  const payWith =
    args.payWith === "square" || args.payWith === "stripe" || args.payWith === "stax"
      ? args.payWith
      : null;

  if (!proposal.client.email || !isPlausibleEmail(proposal.client.email)) {
    return { ok: false, reason: "Client email is missing or invalid" };
  }
  if (!proposal.client.name.trim()) {
    return { ok: false, reason: "Client name is required before sending" };
  }
  if (!proposal.address.trim()) {
    return { ok: false, reason: "Property address is required before sending" };
  }

  // Per-sender email budget (20/hr, 100/day) — a compromised account
  // can't turn the proposal sender into a spam cannon.
  const emailBudget = await checkUserEmailBudget(me.user.id, "sendProposal");
  if (!emailBudget.ok) {
    return { ok: false, reason: emailBudget.reason };
  }

  // Persist (or update) the proposal so /p/[token] resolves to real data.
  const data = proposal as unknown as Prisma.InputJsonValue;
  const contractorSnap =
    proposal.contractor as unknown as Prisma.InputJsonValue;

  // Scope the lookup to the current user. publicToken travels in the
  // emailed portal link, so it's semi-public — without the userId filter a
  // logged-in contractor could pass someone else's token and overwrite
  // their proposal (cross-tenant write / IDOR).
  const existing = proposal.token
    ? await db.proposal.findFirst({
        where: { publicToken: proposal.token, userId: me.user.id },
      })
    : null;

  // Free-plan cap: N distinct proposals sent per calendar month.
  // Re-sending an already-sent proposal is free (its row already counted
  // — that's why `existing` is excluded), drafts are unlimited, and Pro
  // (renewing sub) or admin never hits this. The nudge lands exactly at
  // the money moment: a contractor sending real quotes has real jobs.
  const isPro = me.credits.renews || me.user.role === "SUPER_ADMIN";
  if (!isPro) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const sentThisMonth = await db.proposal.count({
      where: {
        userId: me.user.id,
        sentAt: { gte: monthStart },
        ...(existing ? { id: { not: existing.id } } : {}),
      },
    });
    if (sentThisMonth >= FREE_PROPOSALS_PER_MONTH) {
      return {
        ok: false,
        code: "limit_reached",
        reason: `You've sent all ${FREE_PROPOSALS_PER_MONTH} free proposals this month.`,
      };
    }
  }

  // The portal token IS the auth for the client page, so a first-create
  // never trusts a weak client-minted one — and a collision with another
  // tenant's token must regenerate, not 500 on the unique constraint.
  const clientToken = (proposal.token ?? "").trim();
  const strongToken = /^[A-Za-z0-9_-]{16,64}$/.test(clientToken)
    ? clientToken
    : randomBytes(12).toString("hex");
  const createData = {
    userId: me.user.id,
    address: proposal.address,
    clientName: proposal.client.name,
    clientEmail: proposal.client.email,
    status: "SENT" as const,
    payWith,
    data,
    contractorSnap,
    sentAt: new Date(),
    expiresAt: addDays(new Date(), proposal.validDays || 30),
  };
  let row;
  if (existing) {
    row = await db.proposal.update({
      where: { id: existing.id },
      data: {
        address: proposal.address,
        clientName: proposal.client.name,
        clientEmail: proposal.client.email,
        data,
        contractorSnap,
        status: "SENT",
        payWith,
        sentAt: new Date(),
        expiresAt: addDays(new Date(), proposal.validDays || 30),
      },
    });
  } else {
    try {
      row = await db.proposal.create({
        data: { ...createData, publicToken: strongToken },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      row = await db.proposal.create({
        data: { ...createData, publicToken: randomBytes(12).toString("hex") },
      });
    }
  }

  const portalUrl = `${appBaseUrl()}/p/${row.publicToken}`;

  // Build + send the email
  const { html, text } = renderProposalEmail({
    clientFirstName:
      proposal.client.name.trim().split(/\s+/)[0] || proposal.client.name,
    contractorName: proposal.contractor.name || me.user.name,
    contractorCompany: proposal.contractor.company || me.profile.company,
    contractorPhone: proposal.contractor.phone || me.profile.phone,
    contractorEmail: proposal.contractor.email || me.user.email,
    address: proposal.address,
    validDays: proposal.validDays || 30,
    portalUrl,
    message,
    listenUrl: `${portalUrl}?listen=1`,
  });

  const result = await sendEmailViaResend({
    to: proposal.client.email,
    fromName: proposal.contractor.company || me.profile.company || "FenceScan",
    replyTo: proposal.contractor.email || me.user.email,
    subject: subject.trim() || `Your fence proposal — `,
    html,
    text,
  });

  if (!result.ok) {
    // Roll the status back to DRAFT so the contractor can retry; a SENT row
    // without a delivered email would mislead the dashboard.
    await db.proposal.update({
      where: { id: row.id },
      data: { status: "DRAFT", sentAt: null },
    });
    return { ok: false, reason: result.reason };
  }

  await db.proposalEvent.create({
    data: {
      proposalId: row.id,
      kind: "SENT",
      payload: {
        to: proposal.client.email,
        messageId: result.id,
      } as Prisma.InputJsonValue,
    },
  });

  // Build the spoken summary now, so it ships WITH the proposal. The
  // email invites the client to listen on the road; making them wait out
  // a TTS round trip at the wheel is exactly the wrong moment for it.
  // Best-effort and time-boxed — a slow or unconfigured provider must
  // never fail a send that already went out, and the portal route still
  // generates on demand for anything that doesn't finish here.
  const audioReady = await warmProposalAudio(row.id);

  revalidatePath("/dashboard/proposals");
  revalidatePath("/admin");

  return {
    ok: true,
    token: row.publicToken,
    portalUrl,
    messageId: result.id,
    audioReady,
  };
}

/**
 * Resolves the public proposal page. Returns the persisted proposal data
 * if the token matches a real row, otherwise null. Caller decides whether
 * to fall back to sample data.
 */
export async function getProposalByToken(
  token: string,
): Promise<Proposal | null> {
  if (!token) return null;
  const row = await db.proposal.findUnique({
    where: { publicToken: token },
  });
  if (!row) return null;

  // Best-effort viewed event — never throw for analytics.
  try {
    const h = await headers();
    await db.proposalEvent.create({
      data: {
        proposalId: row.id,
        kind: "VIEWED",
        ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent") ?? null,
      },
    });
    if (row.status === "SENT") {
      await db.proposal.update({
        where: { id: row.id },
        data: { status: "VIEWED" },
      });
    }
  } catch {
    // ignore
  }

  // Public boundary: the portal page serializes this object wholesale,
  // so contractor-private pricing internals (AI quote, stashed manual
  // markup, pricing mode) are stripped here — the client sees one
  // price, with no trace of how it was set.
  const proposal = sanitizeProposalForClient(row.data as unknown as Proposal);
  return withContractorBrand(proposal, row.userId);
}

/**
 * Fill in the brand mark for proposals whose snapshot predates it.
 *
 * The client opens this page logged-out, so the portal can only show a
 * logo that travels with the proposal. New proposals snapshot it at
 * build time; anything already sent has no logo in its JSON and would
 * keep rendering the monogram forever. One lookup against the owner's
 * current profile fixes every one of them. Display-only — the stored
 * snapshot is left alone, so a proposal's saved contractor details stay
 * exactly as they were when it was sent.
 */
async function withContractorBrand(
  proposal: Proposal,
  userId: string,
): Promise<Proposal> {
  if (proposal.contractor.logo?.url) return proposal;
  try {
    const profile = await db.contractorProfile.findUnique({
      where: { userId },
      select: { logoInitials: true, logoTone: true, logoUrl: true },
    });
    if (!profile) return proposal;
    return {
      ...proposal,
      contractor: {
        ...proposal.contractor,
        logo: {
          initials: proposal.contractor.logo?.initials || profile.logoInitials,
          tone: (proposal.contractor.logo?.tone ??
            profile.logoTone) as BrandLogo["tone"],
          url: profile.logoUrl,
        },
      },
    };
  } catch {
    // Branding is cosmetic — never fail the client's proposal over it.
    return proposal;
  }
}

function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/* ------------------------------------------------------------------ */
/*  Draft-save from the estimate view                                  */
/*                                                                     */
/*  The estimate page used to only have "Send proposal", which forced  */
/*  contractors to push to /proposal AND fill in client info before    */
/*  anything got persisted. Save-as-draft persists the takeoff so the  */
/*  job shows up in /dashboard/proposals (status: DRAFT) without       */
/*  needing client email yet — the contractor can come back later to   */
/*  finalize and send.                                                 */
/* ------------------------------------------------------------------ */

export type SaveDraftResult =
  | { ok: true; id: string; token: string; status: "DRAFT" }
  | { ok: false; reason: string };

export async function saveDraftFromEstimate(args: {
  address: string;
  measurements: Measurements;
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Downspout[];
  aerial?: {
    imageDataUrl: string;
    width: number;
    height: number;
    zoom: number;
  };
  /** Optional total in cents. When the user hasn't picked a package yet
   *  the estimate view doesn't have a committed total; pass 0 in that
   *  case — the proposals list will show "Pending" instead of "$0.00". */
  totalCents?: number;
  /** When supplied, updates the existing draft instead of creating a new
   *  row. The estimate top-bar tracks the returned id locally so repeat
   *  clicks update the same proposal. */
  existingId?: string;
  /** Whether this is a new-construction job or a replacement. Stored on
   *  the proposal JSON blob so the scope-of-work language can branch. */
  jobType?: "new" | "replacement";
  /** PlanAnalysis row id when this estimate came from a plan upload. Links
   *  the saved (possibly contractor-edited) takeoff back to the AI output
   *  that produced it — the ground-truth pair the learning loop trains on. */
  planId?: string;
  /** Canvas px-per-foot of the takeoff geometry — REQUIRED for correct
   *  re-measuring when the proposal canvas edits fence runs (missing =
   *  legacy plan scale fallback, which mis-prices satellite scans). */
  canvasPxPerFt?: number;
  /** FenceScan: the drawn fence layout — when present the draft's
   *  Good/Better/Best packages are rebuilt around it (type ladder,
   *  gates/corners/terrain/removal baked into every tier's config). */
  fence?: FenceDraftInput;
  /** FenceScan: measured ground elevations per run (same order as
   *  `eaves`) — stored on the takeoff blob so the client-facing 3D
   *  preview shows the fence stepping down the real slope. */
  runElevationsFt?: number[][];
  /** Walk spacing (canvas px) the elevations were sampled at. */
  elevationSpacingPx?: number;
  /** FenceScan: the scan's topo lattice for the proposal 3D's terrain. */
  topoGridFt?: number[][];
  /** FenceScan: the frozen 3D camera — the client's opening view. */
  view3d?: { yawDeg: number; squash: number };
  /** FenceScan: the 3D presentation — named angles the client can step
   *  through plus how much they may move the camera. */
  views3d?: FenceViewSet;
  /** FenceScan: building footprints for the client diagram + 3D. */
  buildings?: { x: number; y: number }[][];
  /** FenceScan: mixed-type stretches for the client 3D. */
  fenceSections?: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    type: string;
  }[];
}): Promise<SaveDraftResult> {
  try {
    return await saveDraftFromEstimateImpl(args);
  } catch (e) {
    // Any throw past this point — DB connection, JSON column overflow,
    // Clerk session lookup — used to bubble to the page boundary as a
    // generic "Server Components render" 500. Now it shows up as the
    // top-bar's red status text.
    console.error("[saveDraftFromEstimate] threw", e);
    const msg = e instanceof Error ? e.message : "Save failed";
    return { ok: false, reason: msg };
  }
}

async function saveDraftFromEstimateImpl(args: {
  fence?: FenceDraftInput;
  canvasPxPerFt?: number;
  runElevationsFt?: number[][];
  elevationSpacingPx?: number;
  topoGridFt?: number[][];
  view3d?: { yawDeg: number; squash: number };
  views3d?: FenceViewSet;
  buildings?: { x: number; y: number }[][];
  fenceSections?: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    type: string;
  }[];
  address: string;
  measurements: Measurements;
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Downspout[];
  aerial?: {
    imageDataUrl: string;
    width: number;
    height: number;
    zoom: number;
  };
  totalCents?: number;
  existingId?: string;
  jobType?: "new" | "replacement";
  planId?: string;
  /** How pricing presents to the client — the estimator's choice wins;
   *  absent, the contractor's saved default applies. */
  priceDisplay?: "totals" | "split" | "itemized";
}): Promise<SaveDraftResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  if (!args.address.trim()) {
    return { ok: false, reason: "Address is required" };
  }

  // The contractor's price book is resolved HERE rather than trusted
  // from the browser: a saved proposal has to quote at the rates that
  // are actually in their settings, not whatever a long-open tab had
  // cached. Frozen onto every tier from this point on.
  const fenceInput = args.fence
    ? { ...args.fence, rates: await freezeFenceRatesForEstimate() }
    : undefined;

  // The contractor's saved boilerplate: terms written once in Settings
  // ride onto every new draft in place of the platform samples, and
  // their price-display default applies unless the estimator chose one.
  const defaults = await loadProposalDefaults(me.user.id);

  // Compose a Proposal-shaped JSON blob so /proposal can re-hydrate the
  // draft later. We start from the blank template and overlay the live
  // estimate data + the contractor's profile.
  // jobType is stored as an extra key on the proposal JSON blob — not in
  // the typed Proposal shape (which would require a schema migration), but
  // accessible via `data.jobType` in any downstream code that wants to
  // branch scope-of-work text on it.
  const blank = blankProposal();
  const draft: Proposal & {
    jobType?: "new" | "replacement";
    planId?: string;
  } = {
    ...blank,
    // Old-gutter removal line per job type: replacement defaults to the
    // FREE ($X value) marketing line; a new build has nothing to remove.
    packages: blank.packages.map((p) => {
      const base = {
        ...p,
        config: {
          ...p.config,
          oldGutterRemoval:
            args.jobType === "new" ? ("none" as const) : ("free" as const),
        },
      };
      if (!fenceInput) return base;
      // FenceScan: rebuild each tier around the drawn layout.
      const patch = fenceTierPatches(fenceInput).find((t) => t.id === p.id);
      if (!patch) return base;
      return {
        ...base,
        name: patch.name,
        tagline: patch.tagline,
        highlights: patch.highlights,
        markupPct: patch.markupPct,
        recommended: patch.recommended,
        config: { ...base.config, fence: patch.fence },
      };
    }),
    token: randomBytes(12).toString("hex"),
    jobType: args.jobType ?? "replacement",
    // Source-plan link (extra JSON key, same pattern as jobType) so a
    // proposal's corrected takeoff can be traced back to its PlanAnalysis.
    planId: args.planId,
    address: args.address,
    measurements: args.measurements,
    // The contractor's own boilerplate (Settings → Proposal terms) —
    // scope, warranty, payment, exclusions go out with EVERY estimate
    // without being retyped. Editable per proposal afterwards as ever.
    terms: defaults.terms,
    priceDisplay: args.priceDisplay ?? defaults.priceDisplay,
    takeoff: {
      eaves: args.eaves,
      rakes: args.rakes,
      downspouts: args.downspouts,
      aerial: args.aerial,
      canvasPxPerFt: args.canvasPxPerFt,
      runElevationsFt: args.runElevationsFt,
      elevationSpacingPx: args.elevationSpacingPx,
      topoGridFt: args.topoGridFt,
      view3d: args.view3d,
      // Normalized on the way in so a malformed shot list can never
      // reach the logged-out client portal.
      views3d: args.views3d
        ? normalizeViewSet(args.views3d, args.view3d)
        : undefined,
      buildings: args.buildings,
      fenceSections: args.fenceSections,
    },
    contractor: {
      name: me.profile.contractorName || me.user.name,
      company: me.profile.company,
      phone: me.profile.phone,
      email: me.profile.email,
      license: me.profile.license,
      stripePaymentUrl: me.profile.payments.stripeUrl ?? null,
      squarePaymentUrl: me.profile.payments.squareUrl ?? null,
      logo: { ...me.profile.logo },
    },
  };

  const dataJson = draft as unknown as Prisma.InputJsonValue;
  const contractorSnap = draft.contractor as unknown as Prisma.InputJsonValue;

  // Derive a sensible totalCents from the package pricing instead of
  // always falling back to 0. The estimate top-bar currently passes 0
  // because no package has been selected — pick the canonical 'Pro
  // Shield' (middle tier) so the proposals list + dashboard pipeline
  // both reflect a real number instead of $0 everywhere.
  let totalCents = Math.max(0, Math.round(args.totalCents ?? 0));
  if (totalCents === 0 && draft.packages.length > 0) {
    const pick = draft.packages[1] ?? draft.packages[0];
    try {
      const { total } = packageTotal(pick, args.measurements);
      totalCents = Math.max(0, Math.round(total * 100));
    } catch {
      // packageTotal can throw on malformed measurements — fall back to 0.
    }
  }

  // Update path: contractor has clicked Save more than once on this estimate.
  const existing = args.existingId
    ? await db.proposal.findFirst({
        where: { id: args.existingId, userId: me.user.id },
        select: { id: true, publicToken: true, status: true },
      })
    : null;

  // Never downgrade an already-sent proposal back to DRAFT via this path —
  // the dedicated send action owns the SENT→DRAFT rollback on email failure.
  if (existing && existing.status !== "DRAFT") {
    return {
      ok: false,
      reason: `Proposal is already ${existing.status.toLowerCase()}; create a new one instead.`,
    };
  }

  const row = existing
    ? await db.proposal.update({
        where: { id: existing.id },
        data: {
          address: args.address,
          // Don't clobber clientName/clientEmail if the contractor already
          // typed them into /proposal — those live in the proposal `data`
          // blob too, but the columns are what the dashboard table reads.
          totalCents,
          data: dataJson,
          contractorSnap,
        },
        select: { id: true, publicToken: true },
      })
    : await db.proposal.create({
        data: {
          userId: me.user.id,
          publicToken: draft.token,
          address: args.address,
          // Empty client info on first save — filled in when the contractor
          // navigates to /proposal to finalize and send.
          clientName: "",
          clientEmail: "",
          status: "DRAFT",
          totalCents,
          data: dataJson,
          contractorSnap,
        },
        select: { id: true, publicToken: true },
      });

  revalidatePath("/dashboard/proposals");

  // Learning loop: snapshot the saved takeoff onto the source PlanAnalysis
  // row (editedJson) as the contractor-verified counterpart to the AI's
  // analysisJson. Fire-and-forget semantics — capture failure never fails
  // the save (captureTakeoffCorrection swallows its own errors).
  if (args.planId) {
    await captureTakeoffCorrection({
      userId: me.user.id,
      planId: args.planId,
      takeoff: {
        eaves: args.eaves,
        rakes: args.rakes,
        downspouts: args.downspouts,
        measurements: args.measurements,
      },
      source: "estimate-draft-save",
    });
  }

  return { ok: true, id: row.id, token: row.publicToken, status: "DRAFT" };
}

/* ------------------------------------------------------------------ */
/*  Save the in-editor proposal WITHOUT sending                        */
/*                                                                     */
/*  The /proposal page only had "Send", so package / materials / spec  */
/*  edits made there were lost on reload unless the contractor sent.   */
/*  This persists the full Proposal blob (packages, BOM overrides,     */
/*  custom lines, highlights, discount — everything) into the `data`   */
/*  column, keeping status as-is. getMyProposal re-hydrates straight   */
/*  from `data`, so a reload restores exactly what was saved.          */
/* ------------------------------------------------------------------ */

export type SaveProposalDraftResult =
  { ok: true; id: string; token: string } | { ok: false; reason: string };

export async function saveProposalDraft(args: {
  proposal: Proposal;
  /** Row id when editing an existing draft (from ?id=). Omit for a
   *  proposal that hasn't been persisted yet — a new DRAFT row is
   *  created and its id returned so the caller can adopt it. */
  proposalId?: string | null;
}): Promise<SaveProposalDraftResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };

    const { proposal } = args;
    if (!proposal.address.trim()) {
      return { ok: false, reason: "Add a property address first" };
    }

    const data = proposal as unknown as Prisma.InputJsonValue;
    const contractorSnap =
      proposal.contractor as unknown as Prisma.InputJsonValue;

    // Headline total = the recommended (or middle) tier, so the
    // dashboard list + pipeline reflect a real number.
    let totalCents = 0;
    try {
      const rec =
        proposal.packages.find((p) => p.recommended) ??
        proposal.packages[1] ??
        proposal.packages[0];
      if (rec) {
        const { total } = packageTotal(
          rec,
          proposal.measurements,
          proposal.discountPct ?? 0,
        );
        totalCents = Math.max(0, Math.round(total * 100));
      }
    } catch {
      // malformed measurements — leave at 0
    }

    // Resolve the row to update: prefer the explicit id, fall back to the
    // proposal's public token. Both are scoped to the signed-in user so a
    // contractor can never overwrite someone else's proposal.
    const existing = args.proposalId
      ? await db.proposal.findFirst({
          where: { id: args.proposalId, userId: me.user.id },
          select: { id: true, publicToken: true },
        })
      : proposal.token
        ? await db.proposal.findFirst({
            where: { publicToken: proposal.token, userId: me.user.id },
            select: { id: true, publicToken: true },
          })
        : null;

    if (existing) {
      const row = await db.proposal.update({
        where: { id: existing.id },
        data: {
          address: proposal.address,
          clientName: proposal.client.name,
          clientEmail: proposal.client.email,
          totalCents,
          data,
          contractorSnap,
          // status left untouched — saving never sends, and never
          // downgrades an already-SENT/ACCEPTED proposal.
        },
        select: { id: true, publicToken: true },
      });
      revalidatePath("/dashboard/proposals");
      return { ok: true, id: row.id, token: row.publicToken };
    }

    const row = await db.proposal.create({
      data: {
        userId: me.user.id,
        publicToken: proposal.token || randomBytes(12).toString("hex"),
        address: proposal.address,
        clientName: proposal.client.name,
        clientEmail: proposal.client.email,
        status: "DRAFT",
        totalCents,
        data,
        contractorSnap,
      },
      select: { id: true, publicToken: true },
    });
    revalidatePath("/dashboard/proposals");
    return { ok: true, id: row.id, token: row.publicToken };
  } catch (e) {
    console.error("[saveProposalDraft] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Save failed",
    };
  }
}

export type AcceptProposalResult =
  | {
      ok: true;
      acceptedAt: string;
      proposalAddress: string;
      contractorNotified: boolean;
      /** Hosted Square/Stripe/Stax pay page for the first payment due —
       *  the accepted screen puts a real "Pay now" button behind it.
       *  Null when no rail is connected (the contractor collects by
       *  hand or via a pasted payment link). */
      payUrl?: string | null;
    }
  | { ok: false; reason: string };

/**
 * Homeowner-side accept. Called from /p/[token] when the homeowner
 * signs + agrees + clicks Accept.
 *
 *   1. Looks up the proposal by public token (no auth required —
 *      that's the whole point of a token-gated portal).
 *   2. Bumps status DRAFT/SENT/VIEWED → ACCEPTED and sets acceptedAt.
 *      Idempotent: re-accept of an already-accepted proposal is a no-op
 *      success, not a 500.
 *   3. Records a ProposalEvent of kind ACCEPTED so the activity feed
 *      + dashboard KPIs pick it up.
 *   4. Fires an email to the contractor letting them know the proposal
 *      was just accepted. Best-effort: an email failure here doesn't
 *      reverse the acceptance — the homeowner shouldn't be punished
 *      for the contractor's email config being off.
 */
export async function acceptProposalByToken(args: {
  token: string;
  signerName: string;
  signatureDataUrl: string;
  selectedPackageId?: string | null;
  paymentChoice: "deposit" | "full";
}): Promise<AcceptProposalResult> {
  try {
    // Unauthenticated write that mutates contract state and emails the
    // contractor — per-token + per-IP limited. Legit re-accepts are
    // already idempotent no-ops, so 5/day/token never blocks a human.
    const guard = await checkPortalWrite(
      POLICIES.portalAccept,
      args.token,
      "acceptProposalByToken",
    );
    if (!guard.ok) {
      return { ok: false, reason: guard.reason };
    }

    const row = await db.proposal.findUnique({
      where: { publicToken: args.token },
      include: { user: { include: { contractorProfile: true } } },
    });
    if (!row) return { ok: false, reason: "Proposal not found" };

    if (row.status === "ACCEPTED") {
      // Re-accept is a no-op, but the client still deserves their pay
      // button back — hand over the invoice link if one is already live.
      const existing = await db.paymentInstallment.findFirst({
        where: { proposalId: row.id, status: "PENDING", invoiceUrl: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { invoiceUrl: true },
      });
      return {
        ok: true,
        acceptedAt: (row.acceptedAt ?? row.updatedAt).toISOString(),
        proposalAddress: row.address,
        contractorNotified: false,
        payUrl: existing?.invoiceUrl ?? null,
      };
    }

    if (row.status === "DECLINED" || row.status === "EXPIRED") {
      return {
        ok: false,
        reason: `Proposal can't be accepted because it's ${row.status.toLowerCase()}.`,
      };
    }

    const now = new Date();
    const accepted = await db.proposal.update({
      where: { id: row.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        selectedPackageId: args.selectedPackageId ?? row.selectedPackageId,
        // Lock the contract total to the package the homeowner actually
        // picked — the stored column may still reflect the recommended
        // tier from draft time.
        totalCents: deriveTotalCentsFromData(
          row.data,
          row.totalCents,
          args.selectedPackageId ?? row.selectedPackageId,
        ),
      },
    });

    // Build the payment schedule from the homeowner's choice (deposit +
    // final, or one full payment). Best-effort: acceptance must never
    // fail because of schedule bookkeeping — getPaymentOverview lazily
    // repairs missing schedules later.
    try {
      await createDefaultSchedule({
        row: {
          id: accepted.id,
          status: "ACCEPTED",
          totalCents: accepted.totalCents,
          paidCents: accepted.paidCents,
          selectedPackageId: accepted.selectedPackageId,
          acceptedAt: accepted.acceptedAt,
          updatedAt: accepted.updatedAt,
          data: accepted.data,
        },
        paymentChoice: args.paymentChoice,
      });
    } catch (e) {
      console.warn("[acceptProposalByToken] schedule creation failed", e);
    }

    // The moment they sign is the moment they're readiest to pay — so
    // the first payment due goes straight out as a real Square/Stripe/
    // Stax invoice (provider's own email, card or bank), and its hosted
    // pay page comes back to the accepted screen as a "Pay now" button.
    // Best-effort: no rail connected or a provider hiccup just means
    // the contractor collects the old way; acceptance never fails on it.
    let payUrl: string | null = null;
    try {
      const firstDue = await db.paymentInstallment.findFirst({
        where: { proposalId: row.id, status: "PENDING" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (firstDue) {
        const invoiced = await sendInvoiceForInstallment({
          ownerId: row.userId,
          installmentId: firstDue.id,
        });
        if (invoiced.ok) payUrl = invoiced.url;
        else console.warn("[acceptProposalByToken] auto-invoice skipped:", invoiced.reason);
      }
    } catch (e) {
      console.warn("[acceptProposalByToken] auto-invoice failed", e);
    }

    await db.proposalEvent.create({
      data: {
        proposalId: row.id,
        kind: "ACCEPTED",
        payload: {
          signerName: args.signerName,
          paymentChoice: args.paymentChoice,
          selectedPackageId: args.selectedPackageId ?? null,
          // Don't store the full signature dataURL here — it can be
          // several hundred KB and goes into the proposal data blob
          // anyway. Just note it was provided.
          hasSignature: Boolean(args.signatureDataUrl),
        } as Prisma.InputJsonValue,
      },
    });

    // Close out any live price negotiation — the price is locked now, so a
    // still-OPEN/COUNTERED request would linger in the contractor's queue.
    // Best-effort: acceptance must never fail on this bookkeeping.
    try {
      await db.discountRequest.updateMany({
        where: { proposalId: row.id, status: { in: ["OPEN", "COUNTERED"] } },
        data: { status: "EXPIRED", turn: "NONE", decidedAt: now },
      });
    } catch (e) {
      console.warn("[acceptProposalByToken] discount cleanup failed", e);
    }

    // Best-effort contractor notification.
    let contractorNotified = false;
    const contractorEmail =
      row.user?.contractorProfile?.email ?? row.user?.email;
    if (contractorEmail) {
      try {
        const portalUrl = `${appBaseUrl()}/p/${row.publicToken}`;
        const dashUrl = `${appBaseUrl()}/dashboard/proposals`;
        const totalCents = accepted.totalCents > 0 ? accepted.totalCents : 0;
        const totalDollars = (totalCents / 100).toFixed(2);
        const html =
          `<div style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5;max-width:560px">` +
          `<h2 style="margin:0 0 8px;color:#14688C">Proposal accepted ✓</h2>` +
          `<p>${escapeHtml(args.signerName || row.clientName || "Your client")} just accepted the proposal for <strong>${escapeHtml(row.address)}</strong>.</p>` +
          (totalCents > 0
            ? `<p>Total: <strong>$${totalDollars}</strong></p>`
            : "") +
          `<p>Payment choice: <strong>${args.paymentChoice === "deposit" ? "Deposit only" : "Full upfront"}</strong></p>` +
          `<p style="margin-top:20px"><a href="${dashUrl}" style="background:#14688C;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open dashboard</a>` +
          ` &nbsp; <a href="${portalUrl}" style="color:#14688C">View signed proposal</a></p>` +
          `<p style="color:#64748b;font-size:13px;margin-top:24px">Accepted at ${now.toISOString()}.</p>` +
          `</div>`;
        const text =
          `Proposal accepted ✓\n\n` +
          `${args.signerName || row.clientName || "Your client"} just accepted the proposal for ${row.address}.\n` +
          (totalCents > 0 ? `Total: $${totalDollars}\n` : "") +
          `Payment choice: ${args.paymentChoice === "deposit" ? "Deposit only" : "Full upfront"}\n\n` +
          `Dashboard: ${dashUrl}\nSigned proposal: ${portalUrl}\n\n` +
          `Accepted at ${now.toISOString()}.`;
        const res = await sendEmailViaResend({
          to: contractorEmail,
          fromName: "FenceScan",
          subject: `✓ Proposal accepted — ${row.address}`,
          html,
          text,
        });
        contractorNotified = res.ok;
        if (!res.ok) {
          console.warn(
            "[acceptProposalByToken] contractor notification failed",
            res.reason,
          );
        }
      } catch (e) {
        console.warn("[acceptProposalByToken] contractor email threw", e);
      }
    }

    revalidatePath("/dashboard/proposals");
    revalidatePath("/dashboard");

    return {
      ok: true,
      acceptedAt: now.toISOString(),
      proposalAddress: row.address,
      contractorNotified,
      payUrl,
    };
  } catch (e) {
    console.error("[acceptProposalByToken] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Accept failed",
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/*  Delete proposal                                                    */
/* ------------------------------------------------------------------ */

export type DeleteProposalResult = { ok: true } | { ok: false; reason: string };

/**
 * Permanently deletes a proposal owned by the signed-in contractor.
 * Refuses to delete proposals that don't belong to the caller so a
 * leaked id can't be used to wipe someone else's row.
 *
 * Cascades through ProposalEvent rows via the `onDelete: Cascade`
 * relation in the Prisma schema, so we don't need to clean those up
 * manually here.
 */
export async function deleteProposal(
  id: string,
): Promise<DeleteProposalResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    if (!id) return { ok: false, reason: "Missing proposal id" };

    const row = await db.proposal.findUnique({
      where: { id },
      select: { id: true, userId: true, paidCents: true },
    });
    if (!row) return { ok: false, reason: "Proposal not found" };
    if (row.userId !== me.user.id) {
      return { ok: false, reason: "Not your proposal" };
    }
    // Jobs with recorded payments are financial history — receipts,
    // installments and profit rollups all hang off this row, and
    // deleting it would silently erase revenue. Payments must be
    // un-recorded first (payments drawer), which is deliberate friction.
    if (row.paidCents > 0) {
      return {
        ok: false,
        reason:
          "This job has recorded payments. Un-record them in Payments before deleting.",
      };
    }

    await db.proposal.delete({ where: { id } });

    revalidatePath("/dashboard/proposals");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error("[deleteProposal] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Delete failed",
    };
  }
}
