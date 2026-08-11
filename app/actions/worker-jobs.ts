"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "@/app/actions/me";
import { toWorkerJobDTO, type WorkerJobDTO } from "@/lib/worker-dto";
import { safeBlobUrl } from "@/lib/blob";
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
};

/** The owner assigns appointments (visits/meetings) to crew — this is how a
 *  SALES rep's stops land on their portal calendar. Only today-and-upcoming,
 *  so past visits don't pile up and an `asc take` never truncates the next
 *  stops off the end. */
export async function listMyAppointments(): Promise<WorkerAppointmentDTO[]> {
  const me = await getMe();
  if (!me) return [];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db.appointment.findMany({
    where: {
      worker: { userId: me.user.id },
      status: { not: "CANCELLED" },
      startsAt: { gte: todayStart },
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
  }));
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
      declineReason: response === "decline" ? (declineReason?.trim() || null) : null,
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
