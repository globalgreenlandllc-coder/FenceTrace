"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailViaResend } from "@/lib/email/resend";
import {
  renderDiscountToContractorEmail,
  renderDiscountToClientEmail,
} from "@/lib/email/discount-templates";
import {
  packageTotal,
  discountPctForTargetTotal,
  deriveTotalCentsFromData,
  type Package,
  type Proposal as ProposalBlob,
} from "@/lib/proposal-mock";
import { checkPortalWrite } from "@/lib/abuse/guards";
import { POLICIES } from "@/lib/abuse/policies";
import { getMe } from "./me";

/* ------------------------------------------------------------------ */
/*  DTOs (shared with the portal thread + contractor drawer)           */
/* ------------------------------------------------------------------ */

export type DiscountStatus =
  | "OPEN"
  | "COUNTERED"
  | "AGREED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED";
export type DiscountTurn = "CONTRACTOR" | "CLIENT" | "NONE";

export type DiscountOfferDto = {
  party: "CLIENT" | "CONTRACTOR";
  amountCents: number;
  message: string | null;
  createdAt: string;
};

export type DiscountRequestDto = {
  id: string;
  status: DiscountStatus;
  turn: DiscountTurn;
  packageId: string;
  packageName: string;
  listedCents: number;
  /** Lowest price the discount lever can honor (50% off base). Safe for
   *  the client — derived from list, not cost. */
  floorCents: number;
  /** Contractor cost basis (pre-markup) for the reference package. Powers
   *  the margin coach; sent to the contractor drawer only. */
  costCents: number;
  currentCents: number;
  resolvedCents: number | null;
  resolvedPct: number | null;
  declineReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  offers: DiscountOfferDto[];
};

/** Portal-side thread state (client). Never carries costCents. */
export type DiscountThreadDto = {
  /** Can the client START a fresh request right now? */
  eligible: boolean;
  /** Max discount the client can ask for, as a fraction (0.5 = 50% off). */
  maxOff: number;
  /** Packages the client can negotiate on, priced at the current discount,
   *  each with the lowest honorable price (50% off base). */
  packages: { id: string; name: string; listedCents: number; floorCents: number }[];
  defaultPackageId: string | null;
  request: (Omit<DiscountRequestDto, "costCents"> & { costCents?: never }) | null;
};

/** Contractor-side deal state (drawer). Carries costCents for the coach. */
export type DiscountDealDto = {
  proposalId: string;
  token: string;
  address: string;
  clientName: string;
  clientEmail: string;
  proposalStatus: string;
  request: DiscountRequestDto | null;
};

export type DiscountResult<T> =
  | { ok: true; state: T }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/*  Constants + small helpers                                          */
/* ------------------------------------------------------------------ */

/** The most a client can negotiate off the list price. Mirrors the
 *  hard [0,50]% clamp inside `packageTotal` — a discount below this
 *  floor can't be represented by the proposal-wide discountPct, so we
 *  refuse asks under it rather than silently clamp. */
const MAX_OFF = 0.5;

/** Friendly error thrown when a guarded transition matches 0 rows — the
 *  request was moved by the other party between our read and our write. */
const CONCURRENT = "This price request just changed — refresh and try again.";

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full || "there";
}

/**
 * Lowest price the discount lever can honor for a package = 50% off its
 * UNDISCOUNTED base (packageTotal clamps discountPct to [0,50]). Must be
 * derived from the base, NOT from the current (possibly promo-discounted)
 * listed price — otherwise a client on a discounted proposal could agree
 * to a price the lever silently clamps up, over-charging them.
 */
function floorCentsFor(
  pkg: Package,
  measurements: ProposalBlob["measurements"],
): number {
  try {
    return Math.max(
      0,
      Math.round(packageTotal(pkg, measurements, MAX_OFF * 100).total * 100),
    );
  } catch {
    return 0;
  }
}

function isOpenProposalStatus(status: string): boolean {
  return status === "SENT" || status === "VIEWED" || status === "DRAFT";
}

/**
 * Resolves the reference package + measurements from a proposal blob.
 * Falls back to the recommended tier when the stored packageId no longer
 * matches (e.g. the contractor renamed/reordered tiers mid-negotiation).
 */
function resolvePackage(
  blob: Partial<ProposalBlob> | null,
  packageId: string,
): { pkg: Package; measurements: ProposalBlob["measurements"] } | null {
  if (
    !blob ||
    !Array.isArray(blob.packages) ||
    blob.packages.length === 0 ||
    !blob.measurements
  ) {
    return null;
  }
  const pkg =
    blob.packages.find((p) => p.id === packageId) ??
    blob.packages.find((p) => p.recommended) ??
    blob.packages[1] ??
    blob.packages[0];
  if (!pkg) return null;
  return { pkg, measurements: blob.measurements };
}

function listedCentsFor(
  pkg: Package,
  measurements: ProposalBlob["measurements"],
  discountPct: number,
): number {
  try {
    return Math.max(0, Math.round(packageTotal(pkg, measurements, discountPct).total * 100));
  } catch {
    return 0;
  }
}

function costCentsFor(
  pkg: Package,
  measurements: ProposalBlob["measurements"],
): number {
  try {
    // subtotal is discount-independent and already includes bundled add-ons.
    return Math.max(0, Math.round(packageTotal(pkg, measurements, 0).subtotal * 100));
  } catch {
    return 0;
  }
}

type RequestWithOffers = Prisma.DiscountRequestGetPayload<{
  include: { offers: true };
}>;

function toRequestDto(r: RequestWithOffers): DiscountRequestDto {
  return {
    id: r.id,
    status: r.status as DiscountStatus,
    turn: r.turn as DiscountTurn,
    packageId: r.packageId,
    packageName: r.packageName,
    listedCents: r.listedCents,
    floorCents: r.floorCents,
    costCents: r.costCents,
    currentCents: r.currentCents,
    resolvedCents: r.resolvedCents,
    resolvedPct: r.resolvedPct,
    declineReason: r.declineReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    offers: [...r.offers]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((o) => ({
        party: o.party as "CLIENT" | "CONTRACTOR",
        amountCents: o.amountCents,
        message: o.message,
        createdAt: o.createdAt.toISOString(),
      })),
  };
}

/** Strip the cost basis before anything crosses to the public portal. */
function toClientRequestDto(
  r: RequestWithOffers,
): DiscountThreadDto["request"] {
  const { costCents: _drop, ...rest } = toRequestDto(r);
  void _drop;
  return rest;
}

/** Latest request for a proposal (any status), with its offer thread. */
async function latestRequest(
  proposalId: string,
): Promise<RequestWithOffers | null> {
  return db.discountRequest.findFirst({
    where: { proposalId },
    orderBy: { createdAt: "desc" },
    include: { offers: true },
  });
}

/**
 * Applies an agreed price to the proposal by converting it to a
 * proposal-wide discountPct written into the `data` blob — the lever the
 * pricing pipeline, acceptance flow and payment schedule already read.
 * Runs inside the caller's transaction. Returns the resolved pct so the
 * caller can stamp the request row.
 */
async function applyAgreedPrice(
  tx: Prisma.TransactionClient,
  proposalId: string,
  packageId: string,
  agreedCents: number,
): Promise<{ resolvedPct: number }> {
  const row = await tx.proposal.findUnique({
    where: { id: proposalId },
    select: { data: true, selectedPackageId: true },
  });
  // Throw (not return null) so the caller's transaction rolls back — a
  // request must never land in AGREED without the price actually applied.
  if (!row) throw new Error("Proposal vanished mid-agreement");
  const blob = row.data as Partial<ProposalBlob> | null;
  const resolved = resolvePackage(blob, packageId);
  if (!resolved) {
    throw new Error("Couldn't re-price the proposal to apply the agreed price");
  }

  const resolvedPct = discountPctForTargetTotal(
    resolved.pkg,
    resolved.measurements,
    agreedCents / 100,
  );

  const nextData = {
    ...(blob as object),
    discountPct: resolvedPct,
    discountLabel: "Negotiated price",
  } as unknown as Prisma.InputJsonValue;

  await tx.proposal.update({
    where: { id: proposalId },
    data: {
      data: nextData,
      // Recompute the headline total from packages + the new discount.
      totalCents: deriveTotalCentsFromData(nextData, 0, row.selectedPackageId),
    },
  });

  return { resolvedPct };
}

function revalidatePortal(token?: string) {
  revalidatePath("/dashboard/proposals");
  revalidatePath("/dashboard");
  if (token) revalidatePath(`/p/${token}`);
}

/* ------------------------------------------------------------------ */
/*  Notification emails (best-effort — never block the write)          */
/* ------------------------------------------------------------------ */

type ContractorContact = {
  email: string | null;
  name: string;
  company: string;
};

function contractorContactFromRow(row: {
  clientName: string;
  contractorSnap: unknown;
  user?: {
    name?: string | null;
    email?: string | null;
    contractorProfile?: {
      email?: string | null;
      contractorName?: string | null;
      company?: string | null;
    } | null;
  } | null;
}): ContractorContact {
  const snap = (row.contractorSnap ?? {}) as { company?: string; name?: string };
  const prof = row.user?.contractorProfile;
  return {
    email: prof?.email ?? row.user?.email ?? null,
    name: prof?.contractorName ?? row.user?.name ?? "there",
    company: snap.company ?? prof?.company ?? "Your contractor",
  };
}

async function emailContractor(
  contact: ContractorContact,
  kind: "requested" | "countered" | "withdrew",
  args: {
    proposalId: string;
    clientName: string;
    address: string;
    packageName: string;
    listedCents: number;
    askCents: number;
    message: string | null;
  },
): Promise<void> {
  if (!contact.email) return;
  try {
    const mail = renderDiscountToContractorEmail({
      kind,
      contractorName: contact.name,
      clientName: args.clientName || "Your client",
      address: args.address,
      packageName: args.packageName,
      listedCents: args.listedCents,
      askCents: args.askCents,
      message: args.message,
      // Deep-link straight to the respond drawer (?deal=<proposalId>).
      dashUrl: `${appBaseUrl()}/dashboard/proposals?deal=${args.proposalId}`,
    });
    await sendEmailViaResend({
      to: contact.email,
      fromName: "FenceScan",
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch (e) {
    console.warn("[discounts] contractor email threw", e);
  }
}

async function emailClient(
  to: string,
  company: string,
  contractorEmail: string | null,
  kind: "countered" | "agreed" | "declined",
  args: {
    clientName: string;
    address: string;
    packageName: string;
    listedCents: number;
    offerCents: number;
    message: string | null;
    token: string;
  },
): Promise<void> {
  if (!to) return;
  try {
    const mail = renderDiscountToClientEmail({
      kind,
      clientFirstName: firstName(args.clientName || "there"),
      companyName: company,
      address: args.address,
      packageName: args.packageName,
      listedCents: args.listedCents,
      offerCents: args.offerCents,
      message: args.message,
      portalUrl: `${appBaseUrl()}/p/${args.token}#price`,
    });
    await sendEmailViaResend({
      to,
      fromName: company || "FenceScan",
      replyTo: contractorEmail ?? undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch (e) {
    console.warn("[discounts] client email threw", e);
  }
}

/* ================================================================== */
/*  PORTAL READS (token-gated)                                         */
/* ================================================================== */

export async function getDiscountThreadByToken(
  token: string,
): Promise<DiscountThreadDto | null> {
  if (!token) return null;
  const row = await db.proposal.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, data: true },
  });
  if (!row) return null;

  const blob = row.data as Partial<ProposalBlob> | null;
  const discountPct = blob?.discountPct ?? 0;
  const packages =
    Array.isArray(blob?.packages) && blob?.measurements
      ? blob.packages.map((p) => ({
          id: p.id,
          name: p.name,
          listedCents: listedCentsFor(p, blob.measurements!, discountPct),
          floorCents: floorCentsFor(p, blob.measurements!),
        }))
      : [];
  const defaultPackageId =
    blob?.packages?.find((p) => p.recommended)?.id ??
    blob?.packages?.[1]?.id ??
    blob?.packages?.[0]?.id ??
    null;

  const req = await latestRequest(row.id);
  const open = isOpenProposalStatus(row.status);
  // Eligible to start a NEW ask only when the proposal is still open and
  // there's no live/agreed negotiation (a resolved decline/withdrawal may
  // be re-opened with a fresh ask).
  const eligible =
    open &&
    (!req ||
      req.status === "DECLINED" ||
      req.status === "WITHDRAWN" ||
      req.status === "EXPIRED");

  return {
    eligible,
    maxOff: MAX_OFF,
    packages,
    defaultPackageId,
    request: req ? toClientRequestDto(req) : null,
  };
}

/* ================================================================== */
/*  PORTAL WRITES (token-gated, unauthenticated)                       */
/* ================================================================== */

/** Client opens a new price request on a reference package. */
export async function requestDiscount(args: {
  token: string;
  packageId: string;
  /** The price the client wants to pay for the reference package, cents. */
  targetCents: number;
  message?: string;
}): Promise<DiscountResult<DiscountThreadDto>> {
  try {
    const guard = await checkPortalWrite(
      POLICIES.portalDiscount,
      args.token,
      "requestDiscount",
    );
    if (!guard.ok) return { ok: false, reason: guard.reason };

    const row = await db.proposal.findUnique({
      where: { publicToken: args.token },
      select: {
        id: true,
        status: true,
        address: true,
        clientName: true,
        data: true,
        contractorSnap: true,
        user: {
          select: {
            name: true,
            email: true,
            contractorProfile: {
              select: { email: true, contractorName: true, company: true },
            },
          },
        },
      },
    });
    if (!row) return { ok: false, reason: "Proposal not found" };
    if (!isOpenProposalStatus(row.status)) {
      return {
        ok: false,
        reason: `This proposal is ${row.status.toLowerCase()} — price requests are closed.`,
      };
    }

    // One live negotiation at a time, and no re-opening a struck deal.
    // AGREED is terminal: its discount is already applied to the proposal,
    // so a fresh request (which the UI hides but a direct action call
    // could still reach) must not overwrite it. DECLINED/WITHDRAWN stay
    // re-askable.
    const blocking = await db.discountRequest.findFirst({
      where: { proposalId: row.id, status: { in: ["OPEN", "COUNTERED", "AGREED"] } },
      select: { status: true },
    });
    if (blocking) {
      return {
        ok: false,
        reason:
          blocking.status === "AGREED"
            ? "A price has already been agreed on this proposal."
            : "There's already a price request in progress on this proposal.",
      };
    }

    const blob = row.data as Partial<ProposalBlob> | null;
    const resolved = resolvePackage(blob, args.packageId);
    if (!resolved) {
      return { ok: false, reason: "Couldn't price this package — contact your contractor." };
    }
    const discountPct = blob?.discountPct ?? 0;
    const listedCents = listedCentsFor(resolved.pkg, resolved.measurements, discountPct);
    const costCents = costCentsFor(resolved.pkg, resolved.measurements);
    const floor = floorCentsFor(resolved.pkg, resolved.measurements);
    if (listedCents <= 0) {
      return { ok: false, reason: "Couldn't price this package — contact your contractor." };
    }

    const target = Math.round(args.targetCents);
    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, reason: "Enter the price you'd like to pay." };
    }
    if (target >= listedCents) {
      return {
        ok: false,
        reason: "That's the listed price or higher — enter a lower number to request a discount.",
      };
    }
    if (target < floor) {
      return {
        ok: false,
        reason: `The most you can request is ${Math.round(MAX_OFF * 100)}% off list (down to ${dollars(floor)}).`,
      };
    }

    const message = args.message?.trim() || null;

    const created = await db.$transaction(async (tx) => {
      const request = await tx.discountRequest.create({
        data: {
          proposalId: row.id,
          packageId: resolved.pkg.id,
          packageName: resolved.pkg.name,
          listedCents,
          costCents,
          floorCents: floor,
          currentCents: target,
          status: "OPEN",
          turn: "CONTRACTOR",
          offers: {
            create: { party: "CLIENT", amountCents: target, message },
          },
        },
        include: { offers: true },
      });
      await tx.proposalEvent.create({
        data: {
          proposalId: row.id,
          kind: "DISCOUNT_REQUESTED",
          payload: {
            requestId: request.id,
            packageId: resolved.pkg.id,
            listedCents,
            askCents: target,
          } as Prisma.InputJsonValue,
        },
      });
      return request;
    });

    await emailContractor(contractorContactFromRow(row), "requested", {
      proposalId: row.id,
      clientName: row.clientName,
      address: row.address,
      packageName: resolved.pkg.name,
      listedCents,
      askCents: target,
      message,
    });

    revalidatePortal(args.token);
    const state = await getDiscountThreadByToken(args.token);
    if (!state) return { ok: false, reason: "Couldn't reload the proposal" };
    void created;
    return { ok: true, state };
  } catch (e) {
    console.error("[requestDiscount] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't send your price request",
    };
  }
}

/** Client responds to the contractor's counter: accept, counter back, or withdraw. */
export async function respondToCounter(args: {
  token: string;
  requestId: string;
  decision: "accept" | "counter" | "withdraw";
  /** Required for `counter` — the client's new asking price, cents. */
  amountCents?: number;
  message?: string;
}): Promise<DiscountResult<DiscountThreadDto>> {
  try {
    const guard = await checkPortalWrite(
      POLICIES.portalDiscount,
      args.token,
      "respondToCounter",
    );
    if (!guard.ok) return { ok: false, reason: guard.reason };

    const req = await db.discountRequest.findFirst({
      where: { id: args.requestId, proposal: { publicToken: args.token } },
      include: {
        offers: true,
        proposal: {
          select: {
            id: true,
            status: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
            user: {
              select: {
                name: true,
                email: true,
                contractorProfile: {
                  select: { email: true, contractorName: true, company: true },
                },
              },
            },
          },
        },
      },
    });
    if (!req) return { ok: false, reason: "Price request not found" };

    // Idempotent: acting on a resolved request just returns fresh state.
    if (req.status === "AGREED" || req.status === "DECLINED" || req.status === "WITHDRAWN" || req.status === "EXPIRED") {
      const state = await getDiscountThreadByToken(args.token);
      if (state) return { ok: true, state };
      return { ok: false, reason: `This request is already ${req.status.toLowerCase()}.` };
    }
    if (!isOpenProposalStatus(req.proposal.status)) {
      return {
        ok: false,
        reason: `This proposal is ${req.proposal.status.toLowerCase()} — the negotiation is closed.`,
      };
    }

    const contact = contractorContactFromRow(req.proposal);
    const now = new Date();

    if (args.decision === "withdraw") {
      await db.$transaction(async (tx) => {
        // Conditional transition: a concurrent contractor move (agree /
        // counter / decline) that already advanced the row leaves 0 rows
        // matching, so we roll back instead of corrupting state.
        const moved = await tx.discountRequest.updateMany({
          where: { id: req.id, status: { in: ["OPEN", "COUNTERED"] } },
          data: { status: "WITHDRAWN", turn: "NONE", decidedAt: now },
        });
        if (moved.count !== 1) throw new Error(CONCURRENT);
        await tx.proposalEvent.create({
          data: {
            proposalId: req.proposalId,
            kind: "DISCOUNT_WITHDRAWN",
            payload: { requestId: req.id } as Prisma.InputJsonValue,
          },
        });
      });
      await emailContractor(contact, "withdrew", {
        proposalId: req.proposalId,
        clientName: req.proposal.clientName,
        address: req.proposal.address,
        packageName: req.packageName,
        listedCents: req.listedCents,
        askCents: req.currentCents,
        message: null,
      });
      revalidatePortal(args.token);
      const state = await getDiscountThreadByToken(args.token);
      return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
    }

    // accept / counter both require the contractor's move to be on the table.
    if (req.status !== "COUNTERED" || req.turn !== "CLIENT") {
      return {
        ok: false,
        reason: "There's nothing to respond to yet — waiting on your contractor.",
      };
    }

    if (args.decision === "accept") {
      const agreedCents = req.currentCents; // the contractor's standing counter
      await db.$transaction(async (tx) => {
        // Gate the transition first (locks the row); a concurrent
        // contractor move that already moved it leaves 0 rows → rollback,
        // so we never apply the discount against a stale offer.
        const moved = await tx.discountRequest.updateMany({
          where: { id: req.id, status: "COUNTERED", turn: "CLIENT" },
          data: { status: "AGREED", turn: "NONE", resolvedCents: agreedCents, decidedAt: now },
        });
        if (moved.count !== 1) throw new Error(CONCURRENT);
        const res = await applyAgreedPrice(tx, req.proposalId, req.packageId, agreedCents);
        await tx.discountRequest.update({
          where: { id: req.id },
          data: { resolvedPct: res.resolvedPct },
        });
        await tx.proposalEvent.create({
          data: {
            proposalId: req.proposalId,
            kind: "DISCOUNT_AGREED",
            payload: {
              requestId: req.id,
              agreedCents,
              resolvedPct: res.resolvedPct,
              acceptedBy: "client",
            } as Prisma.InputJsonValue,
          },
        });
      });
      // No client email here — the client is the actor and sees the result live.
      revalidatePortal(args.token);
      const state = await getDiscountThreadByToken(args.token);
      return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
    }

    // decision === "counter" — client counters back below the contractor's offer.
    const amount = Math.round(args.amountCents ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: "Enter your counter price." };
    }
    if (amount >= req.currentCents) {
      return {
        ok: false,
        reason: `Your counter should be below their ${dollars(req.currentCents)} offer.`,
      };
    }
    if (amount < req.floorCents) {
      return {
        ok: false,
        reason: `The most you can request is ${Math.round(MAX_OFF * 100)}% off list (down to ${dollars(req.floorCents)}).`,
      };
    }
    const message = args.message?.trim() || null;
    await db.$transaction(async (tx) => {
      const moved = await tx.discountRequest.updateMany({
        where: { id: req.id, status: "COUNTERED", turn: "CLIENT" },
        data: { status: "OPEN", turn: "CONTRACTOR", currentCents: amount },
      });
      if (moved.count !== 1) throw new Error(CONCURRENT);
      await tx.discountOffer.create({
        data: { requestId: req.id, party: "CLIENT", amountCents: amount, message },
      });
      await tx.proposalEvent.create({
        data: {
          proposalId: req.proposalId,
          kind: "DISCOUNT_COUNTERED",
          payload: {
            requestId: req.id,
            askCents: amount,
            by: "client",
          } as Prisma.InputJsonValue,
        },
      });
    });
    await emailContractor(contact, "countered", {
      proposalId: req.proposalId,
      clientName: req.proposal.clientName,
      address: req.proposal.address,
      packageName: req.packageName,
      listedCents: req.listedCents,
      askCents: amount,
      message,
    });
    revalidatePortal(args.token);
    const state = await getDiscountThreadByToken(args.token);
    return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
  } catch (e) {
    console.error("[respondToCounter] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't record your response",
    };
  }
}

/* ================================================================== */
/*  CONTRACTOR READS + WRITES (authenticated)                          */
/* ================================================================== */

async function ownedProposal(proposalId: string): Promise<{
  id: string;
  publicToken: string;
  status: string;
  address: string;
  clientName: string;
  clientEmail: string;
} | null> {
  const me = await getMe();
  if (!me) return null;
  const row = await db.proposal.findFirst({
    where: { id: proposalId, userId: me.user.id },
    select: {
      id: true,
      publicToken: true,
      status: true,
      address: true,
      clientName: true,
      clientEmail: true,
    },
  });
  return row ?? null;
}

export async function getDiscountDeal(
  proposalId: string,
): Promise<DiscountDealDto | null> {
  const row = await ownedProposal(proposalId);
  if (!row) return null;
  const req = await latestRequest(row.id);
  return {
    proposalId: row.id,
    token: row.publicToken,
    address: row.address,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    proposalStatus: row.status,
    request: req ? toRequestDto(req) : null,
  };
}

/** Contractor responds to the client's ask: agree, counter, or decline. */
export async function respondToDiscountRequest(args: {
  requestId: string;
  decision: "agree" | "counter" | "decline";
  /** Required for `counter` — the contractor's offer price, cents. */
  amountCents?: number;
  message?: string;
}): Promise<DiscountResult<DiscountDealDto>> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };

    const req = await db.discountRequest.findFirst({
      where: { id: args.requestId, proposal: { userId: me.user.id } },
      include: {
        offers: true,
        proposal: {
          select: {
            id: true,
            status: true,
            publicToken: true,
            address: true,
            clientName: true,
            clientEmail: true,
            contractorSnap: true,
            user: {
              select: {
                name: true,
                email: true,
                contractorProfile: {
                  select: { email: true, contractorName: true, company: true },
                },
              },
            },
          },
        },
      },
    });
    if (!req) return { ok: false, reason: "Price request not found" };

    if (req.status === "AGREED" || req.status === "DECLINED" || req.status === "WITHDRAWN" || req.status === "EXPIRED") {
      return { ok: false, reason: `This request is already ${req.status.toLowerCase()}.` };
    }
    if (req.status !== "OPEN" || req.turn !== "CONTRACTOR") {
      return { ok: false, reason: "This request is waiting on the client, not you." };
    }
    if (req.proposal.status === "ACCEPTED") {
      return { ok: false, reason: "This proposal was already accepted — the price is locked." };
    }
    if (!isOpenProposalStatus(req.proposal.status)) {
      return {
        ok: false,
        reason: `This proposal is ${req.proposal.status.toLowerCase()} — the negotiation is closed.`,
      };
    }

    const snap = (req.proposal.contractorSnap ?? {}) as { company?: string };
    const company =
      snap.company ||
      req.proposal.user?.contractorProfile?.company ||
      me.profile.company ||
      "Your contractor";
    const contractorEmail =
      req.proposal.user?.contractorProfile?.email ?? req.proposal.user?.email ?? null;
    const now = new Date();

    if (args.decision === "decline") {
      const reason = args.message?.trim() || null;
      await db.$transaction(async (tx) => {
        const moved = await tx.discountRequest.updateMany({
          where: { id: req.id, status: "OPEN", turn: "CONTRACTOR" },
          data: { status: "DECLINED", turn: "NONE", decidedAt: now, declineReason: reason },
        });
        if (moved.count !== 1) throw new Error(CONCURRENT);
        await tx.proposalEvent.create({
          data: {
            proposalId: req.proposalId,
            kind: "DISCOUNT_DECLINED",
            payload: { requestId: req.id, reason } as Prisma.InputJsonValue,
          },
        });
      });
      await emailClient(req.proposal.clientEmail, company, contractorEmail, "declined", {
        clientName: req.proposal.clientName,
        address: req.proposal.address,
        packageName: req.packageName,
        listedCents: req.listedCents,
        offerCents: req.listedCents,
        message: reason,
        token: req.proposal.publicToken,
      });
      revalidatePortal(req.proposal.publicToken);
      const state = await getDiscountDeal(req.proposalId);
      return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
    }

    if (args.decision === "agree") {
      const agreedCents = req.currentCents; // the client's standing ask
      await db.$transaction(async (tx) => {
        const moved = await tx.discountRequest.updateMany({
          where: { id: req.id, status: "OPEN", turn: "CONTRACTOR" },
          data: { status: "AGREED", turn: "NONE", resolvedCents: agreedCents, decidedAt: now },
        });
        if (moved.count !== 1) throw new Error(CONCURRENT);
        const res = await applyAgreedPrice(tx, req.proposalId, req.packageId, agreedCents);
        await tx.discountRequest.update({
          where: { id: req.id },
          data: { resolvedPct: res.resolvedPct },
        });
        await tx.proposalEvent.create({
          data: {
            proposalId: req.proposalId,
            kind: "DISCOUNT_AGREED",
            payload: {
              requestId: req.id,
              agreedCents,
              resolvedPct: res.resolvedPct,
              acceptedBy: "contractor",
            } as Prisma.InputJsonValue,
          },
        });
      });
      await emailClient(req.proposal.clientEmail, company, contractorEmail, "agreed", {
        clientName: req.proposal.clientName,
        address: req.proposal.address,
        packageName: req.packageName,
        listedCents: req.listedCents,
        offerCents: agreedCents,
        message: null,
        token: req.proposal.publicToken,
      });
      revalidatePortal(req.proposal.publicToken);
      const state = await getDiscountDeal(req.proposalId);
      return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
    }

    // decision === "counter" — contractor offers a price above the client's ask.
    const amount = Math.round(args.amountCents ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: "Enter your counter price." };
    }
    if (amount <= req.currentCents) {
      return {
        ok: false,
        reason: `Your counter should be above their ${dollars(req.currentCents)} ask (or just Agree to it).`,
      };
    }
    if (amount >= req.listedCents) {
      return {
        ok: false,
        reason: `Your counter should be below the ${dollars(req.listedCents)} list price (or Decline).`,
      };
    }
    const message = args.message?.trim() || null;
    await db.$transaction(async (tx) => {
      const moved = await tx.discountRequest.updateMany({
        where: { id: req.id, status: "OPEN", turn: "CONTRACTOR" },
        data: { status: "COUNTERED", turn: "CLIENT", currentCents: amount },
      });
      if (moved.count !== 1) throw new Error(CONCURRENT);
      await tx.discountOffer.create({
        data: { requestId: req.id, party: "CONTRACTOR", amountCents: amount, message },
      });
      await tx.proposalEvent.create({
        data: {
          proposalId: req.proposalId,
          kind: "DISCOUNT_COUNTERED",
          payload: { requestId: req.id, offerCents: amount, by: "contractor" } as Prisma.InputJsonValue,
        },
      });
    });
    await emailClient(req.proposal.clientEmail, company, contractorEmail, "countered", {
      clientName: req.proposal.clientName,
      address: req.proposal.address,
      packageName: req.packageName,
      listedCents: req.listedCents,
      offerCents: amount,
      message,
      token: req.proposal.publicToken,
    });
    revalidatePortal(req.proposal.publicToken);
    const state = await getDiscountDeal(req.proposalId);
    return state ? { ok: true, state } : { ok: false, reason: "Reload failed" };
  } catch (e) {
    console.error("[respondToDiscountRequest] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Couldn't record your response",
    };
  }
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
