"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";
import { useSession } from "@/lib/auth-mock";
import { endImpersonation } from "@/app/actions/admin";

const MAX_DURATION_MS = 60 * 60 * 1000;

export function ImpersonationBanner() {
  const { session } = useSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session?.impersonation) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.impersonation]);

  if (!session?.impersonation) return null;

  const startedAt = new Date(session.impersonation.startedAt).getTime();
  const elapsed = Math.max(0, now - startedAt);
  const remaining = Math.max(0, MAX_DURATION_MS - elapsed);

  function endNow() {
    startTransition(async () => {
      await endImpersonation();
      router.push("/admin/users");
      router.refresh();
    });
  }

  return (
    <>
      <div className="h-12" aria-hidden />
      <div
        role="alert"
        className="anim-enter-fade fixed inset-x-0 top-0 z-[60] flex h-12 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4"
      >
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
        <span className="font-label hidden rounded-md border border-amber-300 px-2 py-0.5 text-[10px] text-amber-800 md:inline">
          Impersonating
        </span>
        <div className="min-w-0 flex-1 text-xs sm:text-sm">
          <span className="font-semibold text-amber-900">
            <span className="md:hidden">Impersonating </span>
            {session.user.email}
          </span>
          <span className="ml-2 text-amber-800/80">
            as {session.impersonation.adminEmail}
          </span>
          {session.impersonation.reason && (
            <span className="ml-2 hidden text-amber-700 sm:inline">
              · {session.impersonation.reason}
            </span>
          )}
        </div>
        <div className="hidden items-center gap-3 text-xs text-amber-800 sm:flex">
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
          <span className="text-amber-600">/</span>
          <span className="tabular-nums">{formatRemaining(remaining)} left</span>
        </div>
        <button
          onClick={endNow}
          disabled={pending}
          className="press-scale ring-focus inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-900 px-3 text-xs font-semibold text-white transition-smooth hover:bg-amber-950 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          {pending ? "Ending…" : "End impersonation"}
        </button>
      </div>
    </>
  );
}

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatRemaining(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  return `${m}m`;
}
