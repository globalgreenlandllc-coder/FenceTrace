"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { Logo } from "@/components/ui/logo";

/**
 * ?view=standalone renders the SAME board chrome-free and full-screen (no
 * dashboard sidebar) — what the crew-bar "Pop out" opens, so each crew
 * member's calendar can live in its own tab/window. ?worker=<id> (read by
 * the board itself) preselects that person.
 */
function CalendarPageInner() {
  const params = useSearchParams();
  const standalone = params.get("view") === "standalone";
  const worker = params.get("worker");

  if (standalone) {
    return (
      <AuthGate>
        <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
          <div className="mx-auto max-w-[1800px] space-y-4 px-4 py-4 sm:px-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Logo showSubtitle={false} />
                <span className="hidden text-sm text-zinc-400 sm:inline">
                  / Crew calendar
                </span>
              </div>
              <Link
                href={`/dashboard/calendar${worker ? `?worker=${encodeURIComponent(worker)}` : ""}`}
                className="transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to dashboard
              </Link>
            </header>
            <CalendarBoard standalone />
          </div>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <DashboardShell title="Calendar" contentClassName="max-w-[1600px]">
        <CalendarBoard />
      </DashboardShell>
    </AuthGate>
  );
}

export default function CalendarPage() {
  // Suspense: useSearchParams in a client page needs a boundary for prerender.
  return (
    <Suspense fallback={null}>
      <CalendarPageInner />
    </Suspense>
  );
}
