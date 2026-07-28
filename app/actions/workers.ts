"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getMe } from "@/app/actions/me";
import { appBaseUrl } from "@/lib/base-url";
import { sendEmailViaResend } from "@/lib/email/resend";
import { renderWorkerInviteEmail, renderJobOfferEmail } from "@/lib/email/worker-templates";
import { buildWorkerRoofSnapshot, JOB_KIND_LABEL } from "@/lib/worker-dto";
import { deriveTotalCentsFromData } from "@/lib/proposal-mock";
import {
  computePayCents,
  deriveEstimateSource,
  type EstimateSource,
} from "@/lib/worker-pay";
import { checkUserEmailBudget } from "@/lib/abuse/guards";
import type { JobKind, JobAssignmentStatus, WorkerStatus, WorkerKind } from "@prisma/client";

/**
 * workers.ts — OWNER-side crew management + job assignment. Every query is
 * scoped to the signed-in owner's user id (per-user tenancy, no orgs). Owner
 * pricing never enters a JobAssignment: the owner sets the WORKER's pay, and the
 * roof snapshot is built price-free via buildWorkerRoofSnapshot.
 */

export type OwnerWorkerDTO = {
  id: string;
  email: string;
  name: string | null;
  trade: string | null;
  kind: WorkerKind;
  status: WorkerStatus;
  /** True once the invited person signed up and linked their account. */
  linked: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  stats: { offered: number; active: number; completed: number };
};

export type AssignableProposalDTO = {
  id: string;
  address: string;
  clientName: string;
  jobType: string | null;
  hasRoof: boolean;
  /** The proposal's contract total in cents — the base a worker's pay %
   *  is applied to when the job comes from an in-app estimate. 0 if the
   *  proposal has no priced package yet. */
  estimateTotalCents: number;
  /** null when the proposal carries no priced estimate to base pay on. */
  estimateSource: EstimateSource | null;
};

export type OwnerJobDTO = {
  id: string;
  workerId: string;
  workerName: string;
  workerStatus: WorkerStatus;
  status: JobAssignmentStatus;
  title: string;
  address: string;
  clientName: string | null;
  kind: JobKind;
  kindLabel: string;
  scope: string | null;
  workerPayCents: number;
  /** Audit: the percent applied and what base it was applied to. Owner-only
   *  — never sent to the worker (would reveal the client price). */
  payPct: number | null;
  payBasis: string | null;
  startsAt: string;
  endsAt: string;
  declineReason: string | null;
  proposalId: string | null;
  createdAt: string;
};

type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };
type VoidResult = { ok: true } | { ok: false; reason: string };

function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

const ACTIVE_JOB_STATUSES: JobAssignmentStatus[] = ["OFFERED", "ACCEPTED", "IN_PROGRESS"];

// ── Workers ─────────────────────────────────────────────────────────────────

export async function listWorkers(): Promise<OwnerWorkerDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const workers = await db.worker.findMany({
    where: { ownerId: me.user.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      jobs: { select: { status: true } },
    },
  });
  return workers.map((w) => {
    const offered = w.jobs.filter((j) => j.status === "OFFERED").length;
    const active = w.jobs.filter((j) => j.status === "ACCEPTED" || j.status === "IN_PROGRESS").length;
    const completed = w.jobs.filter((j) => j.status === "COMPLETED").length;
    return {
      id: w.id,
      email: w.email,
      name: w.name,
      trade: w.trade,
      kind: w.kind,
      status: w.status,
      linked: w.userId != null,
      invitedAt: w.invitedAt.toISOString(),
      acceptedAt: w.acceptedAt ? w.acceptedAt.toISOString() : null,
      stats: { offered, active, completed },
    };
  });
}

export async function inviteWorker(input: {
  email: string;
  name?: string;
  trade?: string;
  kind?: WorkerKind;
}): Promise<Result<{ worker: OwnerWorkerDTO; inviteUrl: string; emailSent: boolean }>> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const email = input.email.trim().toLowerCase();
  if (!isPlausibleEmail(email)) return { ok: false, reason: "Enter a valid email address" };
  if (email === me.user.email.toLowerCase()) return { ok: false, reason: "You can't invite yourself" };
  const emailBudget = await checkUserEmailBudget(me.user.id, "inviteWorker");
  if (!emailBudget.ok) return { ok: false, reason: emailBudget.reason };

  const token = randomBytes(16).toString("hex");
  const pending = await isPendingInvite(me.user.id, email);
  // Upsert on (owner, email): re-inviting the same person refreshes the token
  // and re-sends, but never duplicates or un-links an already-accepted worker.
  const worker = await db.worker.upsert({
    where: { ownerId_email: { ownerId: me.user.id, email } },
    update: {
      name: input.name?.trim() || undefined,
      trade: input.trade?.trim() || undefined,
      // Kind is only (re)set while the invite is still pending — the modal
      // always sends a default ("CREW"), so writing it to an ACTIVE worker
      // would silently demote a sales rep on an unrelated resend.
      ...(pending && input.kind ? { kind: input.kind } : {}),
      // Only reset an un-accepted invite; keep an active worker active.
      ...(pending
        ? { status: "INVITED", inviteToken: token, invitedAt: new Date() }
        : {}),
    },
    create: {
      ownerId: me.user.id,
      email,
      name: input.name?.trim() || null,
      trade: input.trade?.trim() || null,
      kind: input.kind ?? "CREW",
      status: "INVITED",
      inviteToken: token,
    },
    include: { jobs: { select: { status: true } } },
  });

  const inviteUrl = `${appBaseUrl()}/worker/join?token=${worker.inviteToken}`;
  const tmpl = renderWorkerInviteEmail({
    ownerName: me.user.name || me.profile.contractorName,
    company: me.profile.company,
    acceptUrl: inviteUrl,
    workerName: worker.name,
  });
  const sent = await sendEmailViaResend({
    to: email,
    fromName: me.profile.company || "FenceScan",
    replyTo: me.user.email,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
  });

  revalidatePath("/dashboard/workers");
  return {
    ok: true,
    inviteUrl,
    emailSent: sent.ok,
    worker: {
      id: worker.id,
      email: worker.email,
      name: worker.name,
      trade: worker.trade,
      kind: worker.kind,
      status: worker.status,
      linked: worker.userId != null,
      invitedAt: worker.invitedAt.toISOString(),
      acceptedAt: worker.acceptedAt ? worker.acceptedAt.toISOString() : null,
      stats: { offered: 0, active: 0, completed: 0 },
    },
  };
}

async function isPendingInvite(ownerId: string, email: string): Promise<boolean> {
  const existing = await db.worker.findUnique({
    where: { ownerId_email: { ownerId, email } },
    select: { status: true, userId: true },
  });
  return !existing || (existing.status === "INVITED" && existing.userId == null);
}

export async function setWorkerStatus(
  workerId: string,
  status: "ACTIVE" | "DISABLED",
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const res = await db.worker.updateMany({
    where: { id: workerId, ownerId: me.user.id },
    data: { status },
  });
  if (res.count === 0) return { ok: false, reason: "Worker not found" };
  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function resendWorkerInvite(workerId: string): Promise<Result<{ inviteUrl: string; emailSent: boolean }>> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const worker = await db.worker.findFirst({ where: { id: workerId, ownerId: me.user.id } });
  if (!worker) return { ok: false, reason: "Worker not found" };
  const emailBudget = await checkUserEmailBudget(me.user.id, "resendWorkerInvite");
  if (!emailBudget.ok) return { ok: false, reason: emailBudget.reason };
  const token = randomBytes(16).toString("hex");
  await db.worker.update({
    where: { id: worker.id },
    data: { inviteToken: token, invitedAt: new Date(), status: worker.userId ? worker.status : "INVITED" },
  });
  const inviteUrl = `${appBaseUrl()}/worker/join?token=${token}`;
  const tmpl = renderWorkerInviteEmail({
    ownerName: me.user.name || me.profile.contractorName,
    company: me.profile.company,
    acceptUrl: inviteUrl,
    workerName: worker.name,
  });
  const sent = await sendEmailViaResend({
    to: worker.email,
    fromName: me.profile.company || "FenceScan",
    replyTo: me.user.email,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
  });
  return { ok: true, inviteUrl, emailSent: sent.ok };
}

// ── Assignable proposals (job sources) ──────────────────────────────────────

/** One select shared by both assignable-proposal queries — adding a DTO field
 *  in one query but not the other would ship undefined exactly on the rare
 *  ensured-row path. */
const ASSIGNABLE_PROPOSAL_SELECT = {
  id: true,
  address: true,
  clientName: true,
  data: true,
  totalCents: true,
  selectedPackageId: true,
} as const;

export async function listAssignableProposals(
  /** Guarantee this proposal is in the result even if it's older than the
   *  40 most-recent (e.g. scheduling straight off an old row). */
  ensureId?: string,
): Promise<AssignableProposalDTO[]> {
  const me = await getMe();
  if (!me) return [];
  // The ensured-row lookup is a cheap indexed hit — run it alongside the list
  // instead of serializing a second round trip after it.
  const [rows, ensured] = await Promise.all([
    db.proposal.findMany({
      where: { userId: me.user.id },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: ASSIGNABLE_PROPOSAL_SELECT,
    }),
    ensureId
      ? db.proposal.findFirst({
          where: { id: ensureId, userId: me.user.id },
          select: ASSIGNABLE_PROPOSAL_SELECT,
        })
      : Promise.resolve(null),
  ]);
  if (ensured && !rows.some((r) => r.id === ensured.id)) rows.unshift(ensured);
  return rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const jobType = typeof data.jobType === "string" ? data.jobType : null;
    const takeoff = data.takeoff as Record<string, unknown> | undefined;
    const hasRoof = !!takeoff && (Array.isArray(takeoff.eaves) || !!takeoff.roofStructure);
    // The base a worker's pay % is applied to for an in-app estimate: the
    // proposal's derived contract total (selected/recommended tier).
    const estimateTotalCents = deriveTotalCentsFromData(
      r.data,
      r.totalCents,
      r.selectedPackageId,
    );
    const estimateSource: EstimateSource | null = deriveEstimateSource(
      r.data,
      estimateTotalCents,
    );
    return {
      id: r.id,
      address: r.address,
      clientName: r.clientName,
      jobType,
      hasRoof,
      estimateTotalCents,
      estimateSource,
    };
  });
}

/** The owner's default pay percentages (from /dashboard/financials). Used to
 *  prefill "worker gets X% of the invoice" in the assign flow. */
export async function getPayDefaults(): Promise<{ crewPct: number; salesPct: number }> {
  const me = await getMe();
  if (!me) return { crewPct: 0, salesPct: 0 };
  const row = await db.financialSettings.findUnique({
    where: { userId: me.user.id },
    select: { crewPct: true, salesPct: true },
  });
  return { crewPct: row?.crewPct ?? 0, salesPct: row?.salesPct ?? 0 };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export async function assignJob(input: {
  workerId: string;
  proposalId?: string | null;
  title: string;
  address: string;
  clientName?: string | null;
  clientPhone?: string | null;
  kind: JobKind;
  scope?: string | null;
  workerPayCents: number;
  startsAtIso: string;
  endsAtIso: string;
  /** Owner-attached job file (design/invoice) already uploaded to Blob. */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  /** Pay-audit trio (all optional): the base amount the pay was priced
   *  against, which source it came from, and the percent applied. Validated
   *  server-side — an unknown basis, a non-positive base, or a percent that
   *  doesn't actually reproduce workerPayCents is nulled, never stored. */
  payBaseCents?: number | null;
  payPct?: number | null;
  payBasis?: "estimate" | "invoice" | null;
  /** When true, create despite a scheduling overlap warning. */
  ignoreConflict?: boolean;
}): Promise<Result<{ job: OwnerJobDTO; emailSent: boolean }> | { ok: false; reason: string; conflict: true }> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };

  const title = input.title.trim();
  const address = input.address.trim();
  if (!title) return { ok: false, reason: "Job title is required" };
  if (!address) return { ok: false, reason: "Job address is required" };
  const startsAt = new Date(input.startsAtIso);
  const endsAt = new Date(input.endsAtIso);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    return { ok: false, reason: "Invalid schedule dates" };
  if (endsAt <= startsAt) return { ok: false, reason: "End time must be after the start time" };
  if (!Number.isFinite(input.workerPayCents) || input.workerPayCents < 0)
    return { ok: false, reason: "Enter a valid worker pay" };

  // Ownership: the worker must belong to this owner and not be disabled.
  const worker = await db.worker.findFirst({
    where: { id: input.workerId, ownerId: me.user.id },
  });
  if (!worker) return { ok: false, reason: "Worker not found" };
  if (worker.status === "DISABLED") return { ok: false, reason: "That worker is disabled" };
  // Jobs (pay + roof file) go to CREW only; SALES reps run appointments. The
  // assign modal already filters them out — this enforces the split at the
  // authorization layer so no stale tab or crafted call can hand a sales rep a
  // priced job.
  if (worker.kind === "SALES")
    return { ok: false, reason: "That teammate is a sales rep — assign them a calendar appointment, not a job" };

  // Ownership + redacted snapshot from the proposal (if any).
  let roofSnapshot: ReturnType<typeof buildWorkerRoofSnapshot> = null;
  let proposalId: string | null = null;
  if (input.proposalId) {
    const proposal = await db.proposal.findFirst({
      where: { id: input.proposalId, userId: me.user.id },
      select: { id: true, data: true },
    });
    if (!proposal) return { ok: false, reason: "Proposal not found" };
    proposalId = proposal.id;
    roofSnapshot = buildWorkerRoofSnapshot(proposal.data);
  }

  // Smart conflict check: warn (don't block) if this worker already has an
  // overlapping OFFERED/ACCEPTED/IN_PROGRESS job.
  if (!input.ignoreConflict) {
    const clash = await db.jobAssignment.findFirst({
      where: {
        workerId: worker.id,
        status: { in: ACTIVE_JOB_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { title: true, startsAt: true },
    });
    if (clash) {
      return {
        ok: false,
        conflict: true,
        reason: `${worker.name || worker.email} already has "${clash.title}" that overlaps this time. Assign anyway?`,
      };
    }
  }

  // Normalize the pay-audit trio — server actions are public POST endpoints,
  // so the "estimate"|"invoice" contract and the percent claim are enforced
  // here, not trusted from the wire. A record the server never verified would
  // be decoration, and this trio exists to be a true record.
  const workerPayCents = Math.round(input.workerPayCents);
  let payBasis: string | null =
    input.payBasis === "estimate" || input.payBasis === "invoice" ? input.payBasis : null;
  let payBaseCents =
    payBasis != null && input.payBaseCents != null && input.payBaseCents > 0
      ? Math.round(input.payBaseCents)
      : null;
  if (payBaseCents == null) payBasis = null;
  let payPct =
    input.payPct != null && Number.isFinite(input.payPct) && input.payPct > 0
      ? input.payPct
      : null;
  if (payPct != null) {
    // The claim "pay = payPct% of payBaseCents" must reproduce the actual pay
    // (±1¢ rounding) or the percent is dropped; the base stays for reference.
    const expected = computePayCents(payBaseCents, payPct);
    if (expected == null || Math.abs(expected - workerPayCents) > 1) payPct = null;
  }

  const job = await db.jobAssignment.create({
    data: {
      ownerId: me.user.id,
      workerId: worker.id,
      proposalId,
      title,
      address,
      clientName: input.clientName?.trim() || null,
      clientPhone: input.clientPhone?.trim() || null,
      kind: input.kind,
      scope: input.scope?.trim() || null,
      workerPayCents,
      roofSnapshot: roofSnapshot ? (roofSnapshot as object) : undefined,
      attachmentUrl: input.attachmentUrl || null,
      attachmentName: input.attachmentName || null,
      attachmentType: input.attachmentType || null,
      payBaseCents,
      payPct,
      payBasis,
      startsAt,
      endsAt,
      status: "OFFERED",
    },
  });

  // Best-effort notify the worker (the job exists regardless of email).
  let emailSent = false;
  const when = startsAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const sent = await sendEmailViaResend({
    to: worker.email,
    fromName: me.profile.company || "FenceScan",
    replyTo: me.user.email,
    ...renderJobOfferEmail({
      company: me.profile.company || "Your contractor",
      jobTitle: title,
      address,
      when,
      portalUrl: `${appBaseUrl()}/worker/jobs/${job.id}`,
    }),
  });
  emailSent = sent.ok;

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard/calendar");
  return {
    ok: true,
    emailSent,
    job: {
      id: job.id,
      workerId: worker.id,
      workerName: worker.name || worker.email,
      workerStatus: worker.status,
      status: job.status,
      title: job.title,
      address: job.address,
      clientName: job.clientName,
      kind: job.kind,
      kindLabel: JOB_KIND_LABEL[job.kind],
      scope: job.scope,
      workerPayCents: job.workerPayCents,
      payPct: job.payPct,
      payBasis: job.payBasis,
      startsAt: job.startsAt.toISOString(),
      endsAt: job.endsAt.toISOString(),
      declineReason: job.declineReason,
      proposalId: job.proposalId,
      createdAt: job.createdAt.toISOString(),
    },
  };
}

export async function listOwnerJobs(): Promise<OwnerJobDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const jobs = await db.jobAssignment.findMany({
    where: { ownerId: me.user.id },
    orderBy: { startsAt: "desc" },
    take: 200,
    include: { worker: { select: { name: true, email: true, status: true } } },
  });
  return jobs.map((j) => ({
    id: j.id,
    workerId: j.workerId,
    workerName: j.worker.name || j.worker.email,
    workerStatus: j.worker.status,
    status: j.status,
    title: j.title,
    address: j.address,
    clientName: j.clientName,
    kind: j.kind,
    kindLabel: JOB_KIND_LABEL[j.kind],
    scope: j.scope,
    workerPayCents: j.workerPayCents,
    payPct: j.payPct,
    payBasis: j.payBasis,
    startsAt: j.startsAt.toISOString(),
    endsAt: j.endsAt.toISOString(),
    declineReason: j.declineReason,
    proposalId: j.proposalId,
    createdAt: j.createdAt.toISOString(),
  }));
}

/** Slim event for the owner's week calendar — assigned jobs overlay. */
export type JobCalendarEventDTO = {
  id: string;
  title: string;
  address: string;
  workerId: string;
  workerName: string;
  status: JobAssignmentStatus;
  kindLabel: string;
  workerPayCents: number;
  startsAt: string;
  endsAt: string;
};

export async function listJobCalendarEvents(
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<JobCalendarEventDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const rangeStart = new Date(rangeStartIso);
  const rangeEnd = new Date(rangeEndIso);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return [];
  const jobs = await db.jobAssignment.findMany({
    where: {
      ownerId: me.user.id,
      status: { not: "CANCELLED" },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    },
    orderBy: { startsAt: "asc" },
    include: { worker: { select: { name: true, email: true } } },
  });
  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    address: j.address,
    workerId: j.workerId,
    workerName: j.worker.name || j.worker.email,
    status: j.status,
    kindLabel: JOB_KIND_LABEL[j.kind],
    workerPayCents: j.workerPayCents,
    startsAt: j.startsAt.toISOString(),
    endsAt: j.endsAt.toISOString(),
  }));
}

/** Recent worker job events (accepted / declined / started / completed) for
 *  the owner's notification bell. Newest first. */
export type WorkerActivityDTO = {
  id: string;
  jobId: string;
  jobTitle: string;
  workerName: string;
  event: "ACCEPTED" | "DECLINED" | "STARTED" | "COMPLETED";
  declineReason: string | null;
  at: string;
};

export async function listWorkerActivity(): Promise<WorkerActivityDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const since = new Date(Date.now() - 14 * 24 * 3600_000);
  const jobs = await db.jobAssignment.findMany({
    where: {
      ownerId: me.user.id,
      OR: [
        { respondedAt: { gte: since }, status: { in: ["ACCEPTED", "DECLINED", "IN_PROGRESS"] } },
        { startedAt: { gte: since }, status: "IN_PROGRESS" },
        { completedAt: { gte: since }, status: "COMPLETED" },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: { worker: { select: { name: true, email: true } } },
  });
  return jobs.map((j) => {
    const completed = j.status === "COMPLETED";
    const started = j.status === "IN_PROGRESS" && j.startedAt != null;
    const at =
      (completed ? j.completedAt : started ? j.startedAt : j.respondedAt) ?? j.updatedAt;
    return {
      id: `${j.id}:${j.status}`,
      jobId: j.id,
      jobTitle: j.title,
      workerName: j.worker.name || j.worker.email,
      event: completed
        ? "COMPLETED"
        : started
          ? "STARTED"
          : j.status === "DECLINED"
            ? "DECLINED"
            : "ACCEPTED",
      declineReason: j.status === "DECLINED" ? j.declineReason : null,
      at: at.toISOString(),
    };
  });
}

/** Drag-to-move on the owner's calendar. Moves the whole window; the worker
 *  sees the new time in their portal (no re-offer — same job, new slot). */
export async function rescheduleJob(
  jobId: string,
  startsAtIso: string,
  endsAtIso: string,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(endsAtIso);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    return { ok: false, reason: "Invalid schedule dates" };
  if (endsAt <= startsAt) return { ok: false, reason: "End time must be after the start time" };
  const res = await db.jobAssignment.updateMany({
    where: { id: jobId, ownerId: me.user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { startsAt, endsAt },
  });
  if (res.count === 0) return { ok: false, reason: "Job can't be rescheduled" };
  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard/calendar");
  // The worker sees the new time in their portal — bust their cache too.
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  return { ok: true };
}

export async function cancelJob(jobId: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const res = await db.jobAssignment.updateMany({
    where: { id: jobId, ownerId: me.user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) return { ok: false, reason: "Job can't be cancelled" };
  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard/calendar");
  // Withdraw it from the worker's portal too.
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  return { ok: true };
}
