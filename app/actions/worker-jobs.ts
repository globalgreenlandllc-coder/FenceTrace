"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "@/app/actions/me";
import { toWorkerJobDTO, type WorkerJobDTO } from "@/lib/worker-dto";
import { safeBlobUrl } from "@/lib/blob";
import { MAX_JOB_DAYS } from "@/lib/job-span";
import { computeTeamEarnings, type PayoutDTO } from "@/lib/team-balance";
import type { JobAssignmentStatus } from "@prisma/client";

/**
 * worker-jobs.ts — WORKER-side actions. Tenancy key is the signed-in user's id;
 * every job query joins through Worker.userId === me.id, so a worker can only
 * ever touch jobs assigned to them. All reads go through toWorkerJobDTO, which
 * carries no owner pricing.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };
type VoidResult = { ok: true } | { ok: false; reason: string };

const JOB_INCLUDE = {
  owner: { select: { name: true, contractorProfile: { select: { company: true } } } },
} as const;

/**
 * Link the signed-in account to the Worker row named by the invite token, and
 * promote the user to the WORKER role. The token is the proof of invitation
 * (like a proposal share link). Idempotent — re-accepting your own invite is a
 * no-op; a token already claimed by someone else is rejected.
 */
export async function acceptWorkerInvite(token: string): Promise<Result<{ alreadyLinked: boolean }>> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Please sign in to accept the invite" };
  const clean = (token ?? "").trim();
  if (!clean) return { ok: false, reason: "Missing invite token" };

  const worker = await db.worker.findUnique({ where: { inviteToken: clean } });
  if (!worker) return { ok: false, reason: "This invite link is invalid or was withdrawn" };
  if (worker.ownerId === me.user.id) return { ok: false, reason: "You can't be your own worker" };

  if (worker.userId && worker.userId !== me.user.id) {
    return { ok: false, reason: "This invite was already claimed by another account" };
  }
  if (worker.userId === me.user.id && worker.status === "ACTIVE") {
    return { ok: true, alreadyLinked: true };
  }

  await db.$transaction([
    db.worker.update({
      where: { id: worker.id },
      data: { userId: me.user.id, status: "ACTIVE", acceptedAt: new Date() },
    }),
    // Promote to WORKER unless they're an admin (admin is env-driven & wins).
    ...(me.user.role === "SUPER_ADMIN"
      ? []
      : [db.user.update({ where: { id: me.user.id }, data: { role: "WORKER" } })]),
  ]);

  revalidatePath("/worker");
  return { ok: true, alreadyLinked: false };
}

export async function listMyJobs(): Promise<WorkerJobDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const jobs = await db.jobAssignment.findMany({
    where: { worker: { userId: me.user.id } },
    orderBy: { startsAt: "desc" },
    take: 200,
    include: JOB_INCLUDE,
  });
  return jobs.map(toWorkerJobDTO);
}

/** Appointment assigned to the signed-in crew member (sales visit, meeting,
 *  install walkthrough). Carries no owner pricing — just where to be & when. */
export type WorkerAppointmentDTO = {
  id: string;
  title: string;
  type: string; // AppointmentType
  startsAt: string;
  endsAt: string;
  address: string | null;
  notes: string | null;
  clientName: string | null;
  clientPhone: string | null;
  /** This worker's answer to the stop — PENDING means the office is
   *  waiting on a confirm. Null on rows predating the feature. */
  workerResponse: "PENDING" | "CONFIRMED" | "DECLINED" | null;
};

/** The owner assigns appointments (visits/meetings) to crew — this is how a
 *  SALES rep's stops land on their portal calendar. Only today-and-upcoming,
 *  so past visits don't pile up and an `asc take` never truncates the next
 *  stops off the end. */
export async function listMyAppointments(): Promise<WorkerAppointmentDTO[]> {
  const me = await getMe();
  if (!me) return [];
  // Coarse floor with a 24h margin: "today" in the WORKER's timezone can
  // start up to a day before the server's (UTC) midnight. The schedule UI
  // does the precise today-cut in the browser's own zone.
  const floor = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.appointment.findMany({
    where: {
      worker: { userId: me.user.id },
      status: { not: "CANCELLED" },
      startsAt: { gte: floor },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
    select: {
      id: true,
      title: true,
      type: true,
      startsAt: true,
      endsAt: true,
      address: true,
      notes: true,
      clientName: true,
      clientPhone: true,
      workerResponse: true,
    },
  });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    address: a.address,
    notes: a.notes,
    clientName: a.clientName,
    clientPhone: a.clientPhone,
    workerResponse: a.workerResponse,
  }));
}

/**
 * The worker's answer to a stop the office scheduled — Confirm or "can't
 * make it". Only the assigned worker may answer, and only while the stop
 * is PENDING (a moved time resets to PENDING, so a confirm always refers
 * to the CURRENT slot). The caller echoes the slot it RENDERED so a
 * confirm from a stale tab can never bind to a time the worker didn't
 * see; the guarded updateMany makes answer + slot check one atomic write.
 */
export async function respondToAppointment(
  appointmentId: string,
  response: "confirm" | "decline",
  /** The startsAt ISO the worker's screen showed when they tapped. */
  expectedStartsAtIso: string,
  declineReason?: string,
): Promise<Result<{ response: "CONFIRMED" | "DECLINED" }>> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  // Server actions are public POST endpoints — the response value is
  // whitelisted, never coerced (junk must not count as a decline).
  if (response !== "confirm" && response !== "decline")
    return { ok: false, reason: "Invalid response" };
  const expectedStartsAt = new Date(expectedStartsAtIso);
  if (Number.isNaN(expectedStartsAt.getTime()))
    return { ok: false, reason: "Reload and try again" };
  const next = response === "confirm" ? ("CONFIRMED" as const) : ("DECLINED" as const);
  const res = await db.appointment.updateMany({
    where: {
      id: appointmentId,
      worker: { userId: me.user.id, status: { not: "DISABLED" } },
      status: { not: "CANCELLED" },
      workerResponse: "PENDING",
      startsAt: expectedStartsAt,
    },
    data: {
      workerResponse: next,
      workerRespondedAt: new Date(),
      workerDeclineReason:
        response === "decline" ? declineReason?.trim().slice(0, 300) || null : null,
    },
  });
  if (res.count === 0)
    return {
      ok: false,
      reason: "This stop changed or is no longer awaiting your answer — reload to see the latest time",
    };
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  // The owner's calendar polls and their bell reads workerRespondedAt —
  // both pick this up without a revalidate from the worker's session.
  return { ok: true, response: next };
}

/**
 * "How long will this take you?" — the crew's own day count for the job.
 * Moves endsAt by the whole-day DELTA: calendar days are timezone-
 * dependent, so the client sends both the target and the span as ITS
 * browser computed it, and the server never recomputes days in UTC.
 *
 * Two invariants the server DOES enforce (the delta inputs are
 * client-claimed and this is the lower-trust principal):
 *   - compare-and-set on endsAt — a stale tab's delta is rejected, not
 *     silently composed with someone else's edit;
 *   - the RESULTING span is bounded (~MAX_JOB_DAYS, with a day of slack
 *     so no legitimate timezone edit is ever rejected).
 */
export async function setMyJobDuration(
  jobId: string,
  days: number,
  currentDays: number,
  /** The endsAt ISO the client computed its day count from. */
  expectedEndsAtIso: string,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const d = Math.round(days);
  const cur = Math.round(currentDays);
  if (!Number.isFinite(d) || d < 1 || d > MAX_JOB_DAYS)
    return { ok: false, reason: `Days must be between 1 and ${MAX_JOB_DAYS}` };
  if (!Number.isFinite(cur) || cur < 1 || cur > MAX_JOB_DAYS)
    return { ok: false, reason: "Reload and try again" };
  const expectedEndsAt = new Date(expectedEndsAtIso);
  if (Number.isNaN(expectedEndsAt.getTime()))
    return { ok: false, reason: "Reload and try again" };
  const job = await db.jobAssignment.findFirst({
    where: {
      id: jobId,
      worker: { userId: me.user.id, status: { not: "DISABLED" } },
      status: { in: ["OFFERED", "ACCEPTED", "IN_PROGRESS"] },
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!job) return { ok: false, reason: "This job can no longer be changed" };
  if (job.endsAt.getTime() !== expectedEndsAt.getTime())
    return { ok: false, reason: "The schedule changed under you — reload and try again" };
  const endsAt = new Date(job.endsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + (d - cur)); // whole-day shift, tz-free
  if (endsAt <= job.startsAt)
    return { ok: false, reason: "That would end before the job starts" };
  if (endsAt.getTime() - job.startsAt.getTime() > (MAX_JOB_DAYS + 1) * 86_400_000)
    return { ok: false, reason: `Jobs can't run longer than ${MAX_JOB_DAYS} days` };
  // CAS write: only applies if endsAt is still what the client saw.
  const res = await db.jobAssignment.updateMany({
    where: { id: job.id, endsAt: expectedEndsAt },
    data: { endsAt },
  });
  if (res.count === 0)
    return { ok: false, reason: "The schedule changed under you — reload and try again" };
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  // Owner's calendar/workers views are client-fetched + polled — they pick
  // up the new span on their own.
  return { ok: true };
}

export type PayStubDTO = {
  workerId: string;
  /** Whose crew this stub is with (a person can be on several). */
  company: string;
  /** Finished work only. */
  earnedCents: number;
  /** Promised on not-yet-completed work. */
  pendingCents: number;
  /** Approved out-of-pocket expenses awaiting reimbursement. */
  expensesOwedCents: number;
  /** See lib/team-balance.ts pay policy: settled on completion. */
  paidCents: number;
  owedCents: number;
  payouts: PayoutDTO[];
};

/** One stub per contractor the signed-in worker is active with — the SAME
 *  math the owner's Workers page shows, so "when am I getting paid?" always
 *  agrees on both sides. Stubs with no money activity at all are dropped. */
export async function getMyPayStubs(): Promise<PayStubDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const links = await db.worker.findMany({
    where: { userId: me.user.id, status: "ACTIVE" },
    select: {
      id: true,
      ownerId: true,
      owner: {
        select: {
          name: true,
          email: true,
          contractorProfile: { select: { company: true } },
        },
      },
    },
  });
  const stubs: PayStubDTO[] = [];
  for (const link of links) {
    const members = await computeTeamEarnings(link.ownerId);
    const mine = members.find((m) => m.workerId === link.id);
    if (!mine) continue;
    if (
      mine.earnedCents === 0 &&
      mine.pendingCents === 0 &&
      mine.paidCents === 0 &&
      mine.expensesOwedCents === 0
    )
      continue;
    stubs.push({
      workerId: link.id,
      company:
        link.owner.contractorProfile?.company || link.owner.name || link.owner.email,
      earnedCents: mine.earnedCents,
      pendingCents: mine.pendingCents,
      expensesOwedCents: mine.expensesOwedCents,
      paidCents: mine.paidCents,
      owedCents: mine.owedCents,
      payouts: mine.payouts.slice(0, 6),
    });
  }
  return stubs;
}

export async function getMyJob(jobId: string): Promise<WorkerJobDTO | null> {
  const me = await getMe();
  if (!me) return null;
  const job = await db.jobAssignment.findFirst({
    where: { id: jobId, worker: { userId: me.user.id } },
    include: JOB_INCLUDE,
  });
  return job ? toWorkerJobDTO(job) : null;
}

export async function respondToJob(
  jobId: string,
  response: "accept" | "decline",
  declineReason?: string,
): Promise<Result<{ status: JobAssignmentStatus }>> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  // Only the assigned worker can respond, and only to an OFFERED job.
  const job = await db.jobAssignment.findFirst({
    where: { id: jobId, worker: { userId: me.user.id }, status: "OFFERED" },
    select: { id: true },
  });
  if (!job) return { ok: false, reason: "This job is no longer open to respond to" };

  const status: JobAssignmentStatus = response === "accept" ? "ACCEPTED" : "DECLINED";
  await db.jobAssignment.update({
    where: { id: job.id },
    data: {
      status,
      respondedAt: new Date(),
      declineReason:
        response === "decline" ? declineReason?.trim().slice(0, 300) || null : null,
    },
  });
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  // The owner's calendar + workers page are client-fetched (and the calendar
  // polls every minute), so they pick this up on their own — revalidating
  // those dynamic routes from the worker's session here would be dead work.
  return { ok: true, status };
}

/**
 * Worker taps "Start job" on the day of — ACCEPTED → IN_PROGRESS with a
 * timestamp. The owner's calendar tile flips to "in progress" and the
 * notification bell logs it, so nobody has to call to ask if the crew
 * showed up.
 */
export async function markJobStarted(jobId: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const res = await db.jobAssignment.updateMany({
    where: { id: jobId, worker: { userId: me.user.id }, status: "ACCEPTED" },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, reason: "Accept the job before starting it" };
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  return { ok: true };
}

export type WorkerExpenseDTO = {
  id: string;
  label: string;
  amountCents: number;
  note: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: string;
  /** Who fronted the money — drives whether this is owed back. */
  paidBy: "COMPANY_CARD" | "OUT_OF_POCKET";
  /** Set once the owner has actually paid the worker back. */
  reimbursedAt: string | null;
  receiptUrl: string | null;
  receiptName: string | null;
};

export type SubmitExpenseInput = {
  /** OUT_OF_POCKET ⇒ the worker wants paying back. COMPANY_CARD ⇒ the
   *  business already paid; this is a cost record with a receipt. */
  paidBy?: "COMPANY_CARD" | "OUT_OF_POCKET";
  receiptUrl?: string;
  receiptName?: string;
  receiptType?: string;
};

/**
 * A worker logs an extra cost on a job (materials run, dump fee, extra
 * sealant). The row lands PENDING on the owner's financials page; it
 * only counts toward job cost — and toward reimbursing the worker —
 * once the owner approves. Workers can only file against jobs they hold
 * that are accepted or further along.
 *
 * `paidBy` is the money question: an OUT_OF_POCKET expense leaves the
 * business owing the worker, a COMPANY_CARD one doesn't. Both cost the
 * job identically.
 */
export async function submitJobExpense(
  jobId: string,
  label: string,
  amountCents: number,
  note?: string,
  extra?: SubmitExpenseInput,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const clean = (label ?? "").trim();
  const cents = Math.round(amountCents);
  if (!clean) return { ok: false, reason: "Give the expense a name" };
  if (!Number.isFinite(cents) || cents <= 0)
    return { ok: false, reason: "Enter an amount above zero" };
  // A receipt URL is only ever accepted if it came from our own blob
  // store — a worker-supplied link is otherwise an open redirect and a
  // way to render arbitrary remote content on the owner's screen.
  const receiptUrl = safeBlobUrl(extra?.receiptUrl);
  const job = await db.jobAssignment.findFirst({
    where: {
      id: jobId,
      worker: { userId: me.user.id },
      status: { in: ["ACCEPTED", "IN_PROGRESS", "COMPLETED"] },
    },
    select: { id: true, ownerId: true, workerId: true, proposalId: true },
  });
  if (!job) return { ok: false, reason: "You can only log expenses on jobs you've accepted" };
  await db.jobExpense.create({
    data: {
      ownerId: job.ownerId,
      workerId: job.workerId,
      assignmentId: job.id,
      proposalId: job.proposalId,
      source: "WORKER",
      status: "PENDING",
      label: clean.slice(0, 80),
      amountCents: cents,
      note: note?.trim().slice(0, 500) || null,
      paidBy: extra?.paidBy === "OUT_OF_POCKET" ? "OUT_OF_POCKET" : "COMPANY_CARD",
      receiptUrl,
      receiptName: receiptUrl ? extra?.receiptName?.slice(0, 120) || null : null,
      receiptType: receiptUrl ? extra?.receiptType?.slice(0, 80) || null : null,
    },
  });
  revalidatePath(`/worker/jobs/${jobId}`);
  revalidatePath("/dashboard/financials");
  return { ok: true };
}

/** The worker's own submissions on one job, newest first — status included
 *  so they can see what the owner approved. Never any owner pricing. */
export async function listMyJobExpenses(jobId: string): Promise<WorkerExpenseDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const rows = await db.jobExpense.findMany({
    where: {
      assignmentId: jobId,
      worker: { userId: me.user.id },
      source: "WORKER",
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((e) => ({
    id: e.id,
    label: e.label,
    amountCents: e.amountCents,
    note: e.note,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    paidBy: e.paidBy,
    reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
    receiptUrl: e.receiptUrl,
    receiptName: e.receiptName,
  }));
}

export async function markJobComplete(jobId: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const res = await db.jobAssignment.updateMany({
    where: { id: jobId, worker: { userId: me.user.id }, status: { in: ["ACCEPTED", "IN_PROGRESS"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, reason: "This job can't be marked complete" };
  revalidatePath("/worker");
  revalidatePath("/worker/schedule");
  revalidatePath(`/worker/jobs/${jobId}`);
  return { ok: true };
}
