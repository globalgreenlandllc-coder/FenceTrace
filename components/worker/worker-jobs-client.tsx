"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MapPin, Clock, User, ChevronRight, Briefcase, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fadeInUp, staggerContainer } from "@/lib/motion";
import { fmtMoney, fmtWhen, fmtTime, fmtShortDay, STATUS_META } from "./format";
import { APPOINTMENT_TYPE_LABEL, type WorkerJobDTO } from "@/lib/worker-dto";
import type { WorkerAppointmentDTO } from "@/app/actions/worker-jobs";

type Filter = "offers" | "upcoming" | "done";

/** How many upcoming appointments the home page previews before deferring to
 *  the full schedule tab. */
const NEXT_STOPS_PREVIEW = 4;

export function WorkerJobsClient({
  initialJobs,
  appointments,
}: {
  initialJobs: WorkerJobDTO[];
  appointments: WorkerAppointmentDTO[];
}) {
  const [filter, setFilter] = useState<Filter>(initialJobs.some((j) => j.status === "OFFERED") ? "offers" : "upcoming");
  const reduce = useReducedMotion();

  const groups = useMemo(() => {
    return {
      offers: initialJobs.filter((j) => j.status === "OFFERED"),
      upcoming: initialJobs.filter((j) => j.status === "ACCEPTED" || j.status === "IN_PROGRESS"),
      done: initialJobs.filter((j) => ["COMPLETED", "DECLINED", "CANCELLED"].includes(j.status)),
    };
  }, [initialJobs]);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "offers", label: "New offers", count: groups.offers.length },
    { key: "upcoming", label: "Upcoming", count: groups.upcoming.length },
    { key: "done", label: "History", count: groups.done.length },
  ];

  const jobs = groups[filter];

  // Precise today-cut in the browser's zone: the server floors the list
  // at now-24h (timezone margin), so yesterday's finished stops would
  // otherwise linger in "Next stops" until UTC catches up.
  const upcoming = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return appointments.filter((a) => new Date(a.endsAt) >= todayStart);
  }, [appointments]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">My jobs</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Jobs your contractor assigned you. Tap a job to see the fence layout and respond.</p>
      </div>

      {upcoming.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <CalendarDays className="h-4 w-4 text-accent-600" /> Next stops
            </h2>
            <Link
              href="/worker/schedule"
              className="transition-smooth ring-focus rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
            >
              Full schedule
              {upcoming.length > NEXT_STOPS_PREVIEW
                ? ` (+${upcoming.length - NEXT_STOPS_PREVIEW} more)`
                : ""}{" "}
              →
            </Link>
          </div>
          <div className="space-y-2">
            {upcoming.slice(0, NEXT_STOPS_PREVIEW).map((a) => (
              <Link
                key={a.id}
                href="/worker/schedule"
                className="group surface flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover-lift press-scale ring-focus"
              >
                <div className="w-20 shrink-0">
                  <div className="text-sm font-medium text-ink">{fmtTime(a.startsAt)}</div>
                  <div className="text-[11px] text-zinc-400">{fmtShortDay(a.startsAt)}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{a.title}</span>
                    <Badge tone="sky">
                      {(APPOINTMENT_TYPE_LABEL as Record<string, string>)[a.type] ?? "Appointment"}
                    </Badge>
                    {/* Nudge toward the schedule tab, where Confirm lives. */}
                    {a.workerResponse === "PENDING" && <Badge tone="amber">Confirm</Badge>}
                    {a.workerResponse === "DECLINED" && <Badge tone="rose">Declined</Badge>}
                  </div>
                  {(a.address || a.clientName) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      {a.address && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3 w-3" /> {a.address}
                        </span>
                      )}
                      {a.clientName && (
                        <span className="inline-flex items-center gap-1.5">
                          <User className="h-3 w-3" /> {a.clientName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition-smooth group-hover:translate-x-0.5 group-hover:text-zinc-500" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="inline-flex rounded-xl bg-zinc-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-smooth ring-focus press-scale",
              filter === t.key ? "bg-white text-ink shadow-sm" : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] transition-smooth", filter === t.key ? "bg-accent-50 text-accent-700" : "bg-zinc-200 text-zinc-500")}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {jobs.length === 0 ? (
        <div key={filter} className="anim-enter-fade flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">
            <Briefcase className="h-5 w-5" />
          </div>
          <p className="font-medium text-ink">Nothing here yet</p>
          <p className="text-sm text-zinc-500">
            {filter === "offers" ? "No new job offers right now." : filter === "upcoming" ? "No upcoming jobs." : "No past jobs."}
          </p>
        </div>
      ) : (
        <motion.div
          key={filter}
          className="grid gap-3 sm:grid-cols-2"
          initial={reduce ? false : "hidden"}
          animate="visible"
          variants={staggerContainer(0.05)}
        >
          {jobs.map((j) => (
            <motion.div key={j.id} variants={fadeInUp}>
              <Link
                href={`/worker/jobs/${j.id}`}
                className="group surface flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white hover-lift press-scale ring-focus"
              >
                <div className="flex items-start justify-between gap-2 px-4 pt-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_META[j.status].tone}>{STATUS_META[j.status].label}</Badge>
                      {/* A reopened offer after a move must not masquerade
                          as new work — same job, new time. */}
                      {j.status === "OFFERED" && j.rescheduledAt && (
                        <Badge tone="amber">Rescheduled</Badge>
                      )}
                      <span className="text-xs text-zinc-400">{j.kindLabel}</span>
                    </div>
                    <h3 className="mt-1.5 truncate font-semibold text-ink">{j.title}</h3>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-300 transition-smooth group-hover:translate-x-0.5 group-hover:text-zinc-500" />
                </div>
                <div className="space-y-1 px-4 py-3 text-xs text-zinc-500">
                  {j.clientName && (
                    <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {j.clientName}</div>
                  )}
                  <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {j.address}</div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {j.status === "OFFERED" && j.rescheduledAt && j.previousStartsAt && (
                      <s className="text-zinc-400">{fmtWhen(j.previousStartsAt)}</s>
                    )}{" "}
                    {fmtWhen(j.startsAt)}
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Your pay</span>
                  <span className="text-base font-semibold text-ink">{fmtMoney(j.workerPayCents)}</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
