"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { respondToAppointment } from "@/app/actions/worker-jobs";
import { cn } from "@/lib/utils";

/**
 * The worker's answer to a stop the office scheduled: Confirm / Can't make
 * it, then a settled badge. The office's calendar shows the same state
 * from the other side ("awaiting confirm" until this is tapped).
 */
export function AppointmentResponse({
  appointmentId,
  response,
  startsAt,
  className,
}: {
  appointmentId: string;
  response: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  /** The slot this component RENDERED — echoed to the server so a tap
   *  from a stale tab can never confirm a time the worker didn't see. */
  startsAt: string;
  className?: string;
}) {
  const [state, setState] = useState(response);
  const [busy, setBusy] = useState<false | "confirm" | "decline">(false);
  const [error, setError] = useState<string | null>(null);
  // Two-tap decline replaces window.confirm — the OS dialog is unstyled
  // and misbehaves in the in-app browsers workers arrive from (email links).
  const [armed, setArmed] = useState(false);

  if (state === "CONFIRMED")
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800",
          className,
        )}
      >
        <Check className="h-3 w-3" /> Confirmed
      </span>
    );
  if (state === "DECLINED")
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700",
          className,
        )}
      >
        <X className="h-3 w-3" /> Can&apos;t make it
      </span>
    );
  if (state !== "PENDING") return null; // legacy rows carry no response

  const act = async (kind: "confirm" | "decline") => {
    if (busy) return;
    if (kind === "decline" && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(kind);
    setError(null);
    const res = await respondToAppointment(appointmentId, kind, startsAt);
    setBusy(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setState(res.response);
  };

  return (
    <span className={cn("inline-flex flex-col items-end gap-1", className)}>
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void act("confirm")}
          disabled={!!busy}
          className="ring-focus press-scale transition-smooth inline-flex h-9 items-center gap-1 rounded-lg bg-accent-600 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
        >
          {busy === "confirm" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Confirm
        </button>
        <button
          type="button"
          onClick={() => void act("decline")}
          disabled={!!busy}
          className={cn(
            "ring-focus press-scale transition-smooth inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-60",
            armed
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-zinc-200 bg-white text-zinc-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700",
          )}
        >
          {busy === "decline" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          {armed ? "Sure?" : "Can't"}
        </button>
      </span>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
