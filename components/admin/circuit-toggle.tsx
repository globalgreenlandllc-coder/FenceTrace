"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAiCircuitAction } from "@/app/actions/abuse";

/**
 * Open/close control for the AI spend circuit breaker. Open = every AI
 * endpoint (satellite estimate, blueprint analyze, lead sync) refuses
 * with a friendly "paused" message until an admin closes it here.
 */
export function CircuitToggle({ open }: { open: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flip = () => {
    setError(null);
    startTransition(async () => {
      const res = await setAiCircuitAction({ open: !open });
      if (!res.ok) setError(res.reason);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        className={
          open
            ? "transition-smooth press-scale ring-focus rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            : "transition-smooth press-scale ring-focus rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        }
      >
        {pending ? "Working…" : open ? "Close circuit — resume AI" : "Open circuit — pause all AI"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
