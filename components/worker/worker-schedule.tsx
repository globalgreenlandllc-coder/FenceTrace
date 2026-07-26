"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, MapPin, ChevronRight, Phone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fadeInUp, staggerContainer } from "@/lib/motion";
import { fmtDay, fmtTime, fmtMoney, STATUS_META } from "./format";
import { APPOINTMENT_TYPE_LABEL, type WorkerJobDTO } from "@/lib/worker-dto";
import type { WorkerAppointmentDTO } from "@/app/actions/worker-jobs";
import { WorkerAvailability } from "./worker-availability";

const APPT_TYPE_LABEL: Record<string, string> = APPOINTMENT_TYPE_LABEL;

type DayEntry =
  | { kind: "job"; startsAt: string; job: WorkerJobDTO }
  | { kind: "appt"; startsAt: string; appt: WorkerAppointmentDTO };

export function WorkerSchedule({
  jobs,
  appointments,
}: {
  jobs: WorkerJobDTO[];
  appointments: WorkerAppointmentDTO[];
}) {
  const reduce = useReducedMotion();
  const entries: DayEntry[] = [
    ...jobs
      .filter(
        (j) =>
          j.status === "ACCEPTED" || j.status === "IN_PROGRESS" || j.status === "OFFERED",
      )
      .map((j): DayEntry => ({ kind: "job", startsAt: j.startsAt, job: j })),
    ...appointments.map(
      (a): DayEntry => ({ kind: "appt", startsAt: a.startsAt, appt: a }),
    ),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // Group by calendar day.
  const byDay = new Map<string, DayEntry[]>();
  for (const e of entries) {
    const key = new Date(e.startsAt).toDateString();
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }
  const days = [...byDay.entries()];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Schedule</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Your jobs and appointments, by day — and the days you&apos;re available.
        </p>
      </div>

      <WorkerAvailability />

      {days.length === 0 ? (
        <div className="anim-enter-fade flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">
            <CalendarDays className="h-5 w-5" />
          </div>
          <p className="font-medium text-ink">Nothing scheduled</p>
          <p className="text-sm text-zinc-500">
            Jobs and appointments show up here on their day.
          </p>
        </div>
      ) : (
        <motion.div
          className="space-y-6"
          initial={reduce ? false : "hidden"}
          animate="visible"
          variants={staggerContainer(0.06)}
        >
          {days.map(([day, dayEntries]) => (
            <motion.div key={day} variants={fadeInUp}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">
                  {fmtDay(dayEntries[0].startsAt)}
                </h2>
                <span className="text-xs text-zinc-400">
                  {dayEntries.length} stop{dayEntries.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {dayEntries.map((e) =>
                  e.kind === "job" ? (
                    <Link
                      key={`j-${e.job.id}`}
                      href={`/worker/jobs/${e.job.id}`}
                      className="group surface flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover-lift press-scale ring-focus"
                    >
                      <div className="w-16 shrink-0 text-sm font-medium text-ink">
                        {fmtTime(e.job.startsAt)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink">
                            {e.job.title}
                          </span>
                          <Badge tone={STATUS_META[e.job.status].tone}>
                            {STATUS_META[e.job.status].label}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                          <MapPin className="h-3 w-3" /> {e.job.address}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-ink">
                        {fmtMoney(e.job.workerPayCents)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-300 transition-smooth group-hover:translate-x-0.5 group-hover:text-zinc-500" />
                    </Link>
                  ) : (
                    <div
                      key={`a-${e.appt.id}`}
                      className="surface flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3"
                    >
                      <div className="w-16 shrink-0 text-sm font-medium text-ink">
                        {fmtTime(e.appt.startsAt)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink">
                            {e.appt.title}
                          </span>
                          <Badge tone="sky">
                            {APPT_TYPE_LABEL[e.appt.type] ?? "Appointment"}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                          {e.appt.address && (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="h-3 w-3" /> {e.appt.address}
                            </span>
                          )}
                          {e.appt.clientName && (
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound className="h-3 w-3" /> {e.appt.clientName}
                            </span>
                          )}
                          {e.appt.clientPhone && (
                            <a
                              href={`tel:${e.appt.clientPhone}`}
                              className="inline-flex items-center gap-1.5 text-accent-700 hover:underline"
                            >
                              <Phone className="h-3 w-3" /> {e.appt.clientPhone}
                            </a>
                          )}
                        </div>
                        {e.appt.notes && (
                          <div className="mt-1 truncate text-xs text-zinc-400">
                            {e.appt.notes}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400">
                        until {fmtTime(e.appt.endsAt)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
