"use server";

import { revalidatePath } from "next/cache";
import type { AppointmentStatus, AppointmentType } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "./me";
import { appBaseUrl } from "@/lib/base-url";
import { sendEmailViaResend } from "@/lib/email/resend";
import { renderAppointmentAssignedEmail } from "@/lib/email/worker-templates";
import { APPOINTMENT_TYPE_LABEL } from "@/lib/worker-dto";

export type AppointmentDTO = {
  id: string;
  title: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: string; // ISO
  endsAt: string;
  address: string | null;
  notes: string | null;
  colorHex: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  leadId: string | null;
  proposalId: string | null;
  workerId: string | null;
  workerName: string | null;
};

const apptInclude = {
  worker: { select: { name: true, email: true } },
} as const;

function toDTO(row: {
  id: string;
  title: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  address: string | null;
  notes: string | null;
  colorHex: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  leadId: string | null;
  proposalId: string | null;
  workerId: string | null;
  worker: { name: string | null; email: string } | null;
}): AppointmentDTO {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    address: row.address,
    notes: row.notes,
    colorHex: row.colorHex,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    clientEmail: row.clientEmail,
    leadId: row.leadId,
    proposalId: row.proposalId,
    workerId: row.workerId,
    workerName: row.worker ? row.worker.name || row.worker.email : null,
  };
}

/** A workerId supplied by the client is only trusted after this check — the
 *  worker must belong to the signed-in owner and not be disabled. Carries the
 *  worker's email/name back so an assignment can notify them without a second
 *  lookup. */
async function resolveWorkerId(
  ownerId: string,
  workerId: string | null | undefined,
): Promise<
  | { ok: true; workerId: string | null; worker: { id: string; email: string; name: string | null } | null }
  | { ok: false; reason: string }
> {
  if (!workerId) return { ok: true, workerId: null, worker: null };
  const worker = await db.worker.findFirst({
    where: { id: workerId, ownerId },
    select: { id: true, status: true, email: true, name: true },
  });
  if (!worker) return { ok: false, reason: "Worker not found" };
  if (worker.status === "DISABLED")
    return { ok: false, reason: "That worker is disabled" };
  return {
    ok: true,
    workerId: worker.id,
    worker: { id: worker.id, email: worker.email, name: worker.name },
  };
}

/**
 * Best-effort "you're scheduled" email when an appointment is assigned to a
 * crew member (jobs already do this via assignJob — appointments were silent,
 * so a sales rep only discovered stops by opening the portal). Only fires for
 * appointments the portal will actually show (starts today or later — same
 * window as listMyAppointments), and never fails the write that triggered it.
 */
async function notifyWorkerOfAppointment(
  from: { company: string | null; replyTo: string },
  worker: { email: string },
  appt: { title: string; type: AppointmentType; startsAt: Date; address: string | null },
): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (appt.startsAt < todayStart) return;
  const when = appt.startsAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  try {
    await sendEmailViaResend({
      to: worker.email,
      fromName: from.company || "FenceTrace",
      replyTo: from.replyTo,
      ...renderAppointmentAssignedEmail({
        company: from.company || "Your contractor",
        title: appt.title,
        typeLabel: APPOINTMENT_TYPE_LABEL[appt.type],
        when,
        address: appt.address,
        portalUrl: `${appBaseUrl()}/worker/schedule`,
      }),
    });
  } catch (e) {
    console.error("[notifyWorkerOfAppointment] email failed", e);
  }
}

/**
 * Lists every appointment whose [startsAt, endsAt] overlaps the supplied
 * [rangeStart, rangeEnd] window. The calendar passes the visible week's
 * bounds so we don't ship history the user can't see.
 *
 * "Overlap" rather than "starts within" so a Monday-morning install
 * scheduled before midnight Sunday still shows on the Monday column.
 */
export async function listAppointments(
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<AppointmentDTO[]> {
  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe();
  } catch {
    return [];
  }
  if (!me) return [];

  const start = new Date(rangeStartIso);
  const end = new Date(rangeEndIso);
  const rows = await db.appointment.findMany({
    where: {
      userId: me.user.id,
      // overlap: row.startsAt < end AND row.endsAt > start
      startsAt: { lt: end },
      endsAt: { gt: start },
    },
    orderBy: { startsAt: "asc" },
    include: apptInclude,
  });
  return rows.map(toDTO);
}

export type CreateAppointmentInput = {
  title: string;
  type?: AppointmentType;
  startsAt: string;
  endsAt: string;
  address?: string | null;
  notes?: string | null;
  colorHex?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  leadId?: string | null;
  proposalId?: string | null;
  workerId?: string | null;
};

export type AppointmentResult =
  | { ok: true; appointment: AppointmentDTO }
  | { ok: false; reason: string };

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<AppointmentResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };

    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { ok: false, reason: "Invalid start/end time" };
    }
    if (end.getTime() <= start.getTime()) {
      return { ok: false, reason: "End time must be after start" };
    }
    if (!input.title.trim()) {
      return { ok: false, reason: "Title is required" };
    }

    const workerCheck = await resolveWorkerId(me.user.id, input.workerId);
    if (!workerCheck.ok) return { ok: false, reason: workerCheck.reason };

    const row = await db.appointment.create({
      data: {
        userId: me.user.id,
        title: input.title.trim(),
        type: input.type ?? "OTHER",
        startsAt: start,
        endsAt: end,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        colorHex: input.colorHex || null,
        clientName: input.clientName?.trim() || null,
        clientPhone: input.clientPhone?.trim() || null,
        clientEmail: input.clientEmail?.trim() || null,
        leadId: input.leadId || null,
        proposalId: input.proposalId || null,
        workerId: workerCheck.workerId,
      },
      include: apptInclude,
    });
    if (workerCheck.worker) {
      await notifyWorkerOfAppointment(
        { company: me.profile.company ?? null, replyTo: me.user.email },
        workerCheck.worker,
        row,
      );
      revalidatePath("/worker");
      revalidatePath("/worker/schedule");
    }
    revalidatePath("/dashboard/calendar");
    return { ok: true, appointment: toDTO(row) };
  } catch (e) {
    console.error("[createAppointment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Failed to create appointment",
    };
  }
}

export type UpdateAppointmentInput = Partial<{
  title: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  address: string | null;
  notes: string | null;
  colorHex: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  workerId: string | null;
}>;

/**
 * Drag-to-move and resize hit this with a small diff (just startsAt+endsAt
 * usually). All fields are optional; only present ones are written.
 */
export async function updateAppointment(
  id: string,
  patch: UpdateAppointmentInput,
): Promise<AppointmentResult> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };

    const existing = await db.appointment.findFirst({
      where: { id, userId: me.user.id },
      select: { id: true, workerId: true },
    });
    if (!existing) return { ok: false, reason: "Appointment not found" };

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title.trim();
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.startsAt !== undefined) data.startsAt = new Date(patch.startsAt);
    if (patch.endsAt !== undefined) data.endsAt = new Date(patch.endsAt);
    if (patch.address !== undefined) data.address = patch.address;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.colorHex !== undefined) data.colorHex = patch.colorHex;
    if (patch.clientName !== undefined) data.clientName = patch.clientName;
    if (patch.clientPhone !== undefined) data.clientPhone = patch.clientPhone;
    if (patch.clientEmail !== undefined) data.clientEmail = patch.clientEmail;
    // A worker newly put on this appointment (fresh assign or handoff) gets
    // the "you're scheduled" email; time-only drags never re-notify.
    let newlyAssigned: { id: string; email: string; name: string | null } | null = null;
    if (patch.workerId !== undefined) {
      const workerCheck = await resolveWorkerId(me.user.id, patch.workerId);
      if (!workerCheck.ok) return { ok: false, reason: workerCheck.reason };
      data.workerId = workerCheck.workerId;
      if (workerCheck.worker && workerCheck.worker.id !== existing.workerId)
        newlyAssigned = workerCheck.worker;
    }

    if (
      data.startsAt instanceof Date &&
      data.endsAt instanceof Date &&
      (data.endsAt as Date).getTime() <= (data.startsAt as Date).getTime()
    ) {
      return { ok: false, reason: "End time must be after start" };
    }

    // Scope the write itself to the owner (defense-in-depth — don't rely
    // only on the findFirst check above surviving future refactors).
    const row = await db.appointment.update({
      where: { id, userId: me.user.id },
      data,
      include: apptInclude,
    });
    if (newlyAssigned) {
      await notifyWorkerOfAppointment(
        { company: me.profile.company ?? null, replyTo: me.user.email },
        newlyAssigned,
        row,
      );
    }
    // Any change touching an assigned worker (time move, reassign, unassign)
    // must reach their portal pages too.
    if (existing.workerId || row.workerId) {
      revalidatePath("/worker");
      revalidatePath("/worker/schedule");
    }
    revalidatePath("/dashboard/calendar");
    return { ok: true, appointment: toDTO(row) };
  } catch (e) {
    console.error("[updateAppointment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Failed to update appointment",
    };
  }
}

export async function deleteAppointment(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const me = await getMe();
    if (!me) return { ok: false, reason: "Not signed in" };
    const r = await db.appointment.deleteMany({
      where: { id, userId: me.user.id },
    });
    if (r.count === 0) return { ok: false, reason: "Appointment not found" };
    revalidatePath("/dashboard/calendar");
    // The row is gone before we could read its workerId — refresh the worker
    // pages unconditionally so an assigned stop never lingers on a portal.
    revalidatePath("/worker");
    revalidatePath("/worker/schedule");
    return { ok: true };
  } catch (e) {
    console.error("[deleteAppointment] threw", e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Failed to delete",
    };
  }
}

export type SchedulableItem = {
  kind: "lead" | "proposal";
  id: string;
  title: string;
  address: string | null;
  subtitle: string | null;
  clientName: string | null;
  clientEmail: string | null;
};

/**
 * Items the contractor might want to drag onto the calendar:
 *   - Recent leads they've interacted with that don't have an
 *     appointment yet (lead site visits)
 *   - Draft + sent proposals that don't have a JOB_INSTALL appointment
 *     yet (gutter install scheduling)
 *
 * Capped at 12 each so the sidebar stays readable.
 */
export async function listSchedulableItems(): Promise<SchedulableItem[]> {
  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe();
  } catch {
    return [];
  }
  if (!me) return [];

  const [interactions, proposals, existingApptLeads, existingApptProposals] =
    await Promise.all([
      db.userLeadInteraction.findMany({
        where: { userId: me.user.id },
        orderBy: { updatedAt: "desc" },
        take: 25,
        include: { lead: true },
      }),
      db.proposal.findMany({
        where: { userId: me.user.id, status: { in: ["DRAFT", "SENT", "ACCEPTED"] } },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: {
          id: true,
          address: true,
          clientName: true,
          clientEmail: true,
          status: true,
        },
      }),
      db.appointment.findMany({
        where: { userId: me.user.id, leadId: { not: null } },
        select: { leadId: true },
      }),
      db.appointment.findMany({
        where: { userId: me.user.id, proposalId: { not: null } },
        select: { proposalId: true },
      }),
    ]);

  const scheduledLeadIds = new Set(
    existingApptLeads.map((a) => a.leadId).filter(Boolean) as string[],
  );
  const scheduledProposalIds = new Set(
    existingApptProposals.map((a) => a.proposalId).filter(Boolean) as string[],
  );

  const out: SchedulableItem[] = [];
  for (const i of interactions) {
    if (out.filter((x) => x.kind === "lead").length >= 12) break;
    if (scheduledLeadIds.has(i.leadId)) continue;
    out.push({
      kind: "lead",
      id: i.leadId,
      title:
        i.lead.contractorName ||
        i.lead.ownerName ||
        i.lead.aiSummary?.split(".")[0] ||
        i.lead.address,
      address: i.lead.address,
      subtitle: i.lead.categorizedTrade || i.lead.developmentType || null,
      clientName: i.lead.ownerName,
      clientEmail: null,
    });
  }
  for (const p of proposals) {
    if (out.filter((x) => x.kind === "proposal").length >= 12) break;
    if (scheduledProposalIds.has(p.id)) continue;
    out.push({
      kind: "proposal",
      id: p.id,
      title: p.clientName || p.address,
      address: p.address,
      subtitle: p.status,
      clientName: p.clientName,
      clientEmail: p.clientEmail,
    });
  }
  return out;
}
