import type { JobKind, JobAssignmentStatus, AppointmentType } from "@prisma/client";
import type { Measurements } from "@/lib/types";
import type { ProposalTakeoff } from "@/lib/proposal-mock";

/**
 * worker-dto.ts — the redaction boundary. A worker only ever sees data shaped
 * by the functions here. By construction they carry NO owner pricing: the job's
 * `workerPayCents` is the worker's OWN pay (owner-set), and `roofSnapshot` copies
 * only the takeoff GEOMETRY + measurements — never packages, markup, deposit, or
 * the client total. Pure (no server-only) so the worker UI can import the types.
 */

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  // Enum values are legacy (GUTTERS_*/ROOF) — labels are what everyone sees.
  GUTTERS_REPLACEMENT: "Fence — replacement",
  GUTTERS_NEW: "Fence — new install",
  ROOF: "Other trade work",
  REPAIR: "Repair",
  OTHER: "Other",
};

export const JOB_KIND_OPTIONS: { value: JobKind; label: string }[] = (
  Object.keys(JOB_KIND_LABEL) as JobKind[]
).map((value) => ({ value, label: JOB_KIND_LABEL[value] }));

/** Worker-facing appointment type labels — shared by the portal UI and the
 *  assignment email so a "LEAD_VISIT" reads as "Site visit" everywhere. */
export const APPOINTMENT_TYPE_LABEL: Record<AppointmentType, string> = {
  LEAD_VISIT: "Site visit",
  JOB_INSTALL: "Install",
  PROPOSAL_MEETING: "Proposal meeting",
  FOLLOW_UP: "Follow-up",
  OTHER: "Appointment",
};

/** Price-free fence-layout info a worker may see. */
export type WorkerRoofSnapshot = {
  jobType: string | null;
  measurements: Measurements | null;
  takeoff: ProposalTakeoff | null;
};

/**
 * Build the worker-safe snapshot from a Proposal.data blob, reading ONLY the
 * takeoff geometry + measurements. The pricing keys (packages, discountPct,
 * depositPct, totals, contractor payment URLs) are deliberately never touched.
 */
export function buildWorkerRoofSnapshot(proposalData: unknown): WorkerRoofSnapshot | null {
  if (!proposalData || typeof proposalData !== "object") return null;
  const d = proposalData as Record<string, unknown>;
  const measurements =
    d.measurements && typeof d.measurements === "object" ? (d.measurements as Measurements) : null;
  const takeoff = d.takeoff && typeof d.takeoff === "object" ? (d.takeoff as ProposalTakeoff) : null;
  const jobType = typeof d.jobType === "string" ? d.jobType : null;
  if (!measurements && !takeoff && !jobType) return null;
  return { jobType, measurements, takeoff };
}

/** Minimal row shape toWorkerJobDTO needs — a JobAssignment with owner + profile
 *  loaded. Loosely typed so it accepts the Prisma result without coupling. */
export type JobAssignmentRow = {
  id: string;
  status: JobAssignmentStatus;
  title: string;
  address: string;
  clientName: string | null;
  clientPhone: string | null;
  kind: JobKind;
  scope: string | null;
  workerPayCents: number;
  roofSnapshot: unknown;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  startsAt: Date;
  endsAt: Date;
  rescheduledAt: Date | null;
  previousStartsAt: Date | null;
  declineReason: string | null;
  respondedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  owner?: {
    name: string | null;
    contractorProfile?: { company: string | null } | null;
  } | null;
};

/** The complete job view a worker receives. Worker pay only — never owner price. */
export type WorkerJobDTO = {
  id: string;
  status: JobAssignmentStatus;
  title: string;
  address: string;
  clientName: string | null;
  clientPhone: string | null;
  kind: JobKind;
  kindLabel: string;
  scope: string | null;
  workerPayCents: number;
  /** Owner-attached job file (design/invoice). Sharing it is the owner's
   *  explicit choice at assign time. */
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  startsAt: string;
  endsAt: string;
  /** Set when the office moved a scheduled job — previousStartsAt is the
   *  slot it came from, so a reopened offer reads as "same job, new
   *  time" instead of masquerading as new work. */
  rescheduledAt: string | null;
  previousStartsAt: string | null;
  declineReason: string | null;
  respondedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  roof: WorkerRoofSnapshot | null;
  owner: { name: string | null; company: string | null };
};

/** The ONLY conversion the worker side uses. It can't leak owner pricing because
 *  the JobAssignment row itself carries none. */
export function toWorkerJobDTO(row: JobAssignmentRow): WorkerJobDTO {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    address: row.address,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    kind: row.kind,
    kindLabel: JOB_KIND_LABEL[row.kind],
    scope: row.scope,
    workerPayCents: row.workerPayCents,
    attachmentUrl: row.attachmentUrl ?? null,
    attachmentName: row.attachmentName ?? null,
    attachmentType: row.attachmentType ?? null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    rescheduledAt: row.rescheduledAt ? row.rescheduledAt.toISOString() : null,
    previousStartsAt: row.previousStartsAt ? row.previousStartsAt.toISOString() : null,
    declineReason: row.declineReason,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    roof: (row.roofSnapshot as WorkerRoofSnapshot | null) ?? null,
    owner: {
      name: row.owner?.name ?? null,
      company: row.owner?.contractorProfile?.company ?? null,
    },
  };
}
