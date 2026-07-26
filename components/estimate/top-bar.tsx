"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  Loader2,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  writeEstimateHandoff,
  type EstimateHandoff,
} from "@/lib/estimate-handoff";
import { saveDraftFromEstimate } from "@/app/actions/proposals";
import { useEstimateJob } from "@/components/estimate/estimate-job";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; draftId: string; at: number }
  | { kind: "error"; message: string };

export function TopBar({
  address,
  handoff,
  jobType = "replacement",
  planId,
}: {
  address: string;
  /** Full takeoff snapshot. Optional because some call sites don't have
   *  it (the proposal page just gets the address) — when absent the
   *  navigation still works, the proposal flow falls back to its blank
   *  template. */
  handoff?: Omit<EstimateHandoff, "capturedAt">;
  /** "new" → new-construction job (no tear-off line item, different
   *  scope-of-work language). "replacement" → existing house, existing
   *  gutters being removed. Default is "replacement" — the common case. */
  jobType?: "new" | "replacement";
  /** PlanAnalysis row id when this estimate came from a plan upload.
   *  Surfaces the "Re-analyze" button so the contractor can refresh
   *  an old upload against the latest prompts without re-uploading
   *  the PDF. Omit for the aerial flow. */
  planId?: string;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const [reanalyzing, setReanalyzing] = useState(false);
  const { startJob } = useEstimateJob();

  const onReanalyze = async () => {
    if (!planId || reanalyzing) return;
    if (
      !confirm(
        "Re-analyze this plan against the latest AI prompts? Takes ~60-90s. " +
          "Your current edits will be replaced with a fresh trace.",
      )
    ) {
      return;
    }
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/blueprints/${planId}/reanalyze`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Force-restart the global job — the provider caches a "ready"
      // result per planId, and without the force it would short-circuit
      // straight back to the stale takeoff instead of polling the
      // QUEUED re-analysis.
      startJob({ planId, jobType }, { force: true });
      // Bounce back through the estimate route so the contractor sees
      // the loading screen while the provider polls the QUEUED row.
      router.push(`/estimate?planId=${planId}&jobType=${jobType}`);
      router.refresh();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Re-analyze request failed";
      alert(`Re-analyze failed: ${message}`);
      setReanalyzing(false);
    }
  };

  const handoffAndGo = () => {
    if (handoff) writeEstimateHandoff(handoff);
    router.push("/proposal");
  };

  const onSaveDraft = () => {
    if (!handoff || save.kind === "saving") return;
    setSave({ kind: "saving" });
    startTransition(async () => {
      const existingId =
        save.kind === "saved" ? save.draftId : undefined;
      const result = await saveDraftFromEstimate({
        address: handoff.address,
        measurements: handoff.measurements,
        eaves: handoff.eaves,
        rakes: handoff.rakes,
        downspouts: handoff.downspouts,
        aerial: handoff.aerial,
        // Total isn't committed at the estimate stage — leave at 0; the
        // proposal list renders "Pending" for zero-totalled drafts. The
        // contractor finalizes pricing in /proposal before sending.
        totalCents: 0,
        existingId,
        jobType,
        // Plan-flow estimates carry the PlanAnalysis id so the save also
        // snapshots the (possibly edited) takeoff onto the plan row as
        // learning ground truth. Absent for the aerial flow.
        planId,
      });
      if (result.ok) {
        setSave({ kind: "saved", draftId: result.id, at: Date.now() });
      } else {
        setSave({ kind: "error", message: result.reason });
      }
    });
  };

  // Status badge on the address line. Reflects what the contractor sees
  // when they navigate to /dashboard/proposals: nothing → Draft → Saved.
  // Keyed by state so the swap crossfades (Draft → Saving… → Saved)
  // instead of snapping — this is the confirmation of the user's most
  // anxious action, so the transition should feel deliberate.
  const statusKey =
    save.kind === "saved" ? "saved" : save.kind === "saving" ? "saving" : "draft";
  const statusBadge = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={statusKey}
        initial={reduce ? false : { opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: DUR.fast, ease: EASE }}
        className="hidden sm:inline-flex"
      >
        {save.kind === "saved" ? (
          <Badge tone="accent">
            <Check className="h-3 w-3" />
            Saved · Draft
          </Badge>
        ) : save.kind === "saving" ? (
          <Badge tone="neutral">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </Badge>
        ) : (
          <Badge tone="neutral">Draft</Badge>
        )}
      </motion.span>
    </AnimatePresence>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <Link
          href="/dashboard"
          className="group ring-focus flex items-center gap-1 rounded-md text-sm text-zinc-500 transition-smooth hover:text-zinc-900"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <div className="hidden h-6 w-px bg-zinc-200 md:block" />
        <div className="hidden md:block">
          <Logo showSubtitle={false} />
        </div>
        <div className="hidden h-6 w-px bg-zinc-200 md:block" />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-900">
            {address}
          </span>
          <span
            title={
              jobType === "new"
                ? "New construction — no tear-off line items by default"
                : "Replacement — includes tear-off + disposal"
            }
          >
            <Badge
              tone={jobType === "new" ? "accent" : "neutral"}
              className="hidden sm:inline-flex"
            >
              {jobType === "new" ? "New construction" : "Replacement"}
            </Badge>
          </span>
          {statusBadge}
          {save.kind === "saved" && (
            <span className="anim-enter-fade hidden whitespace-nowrap text-xs text-zinc-500 lg:inline">
              Saved to{" "}
              <Link
                href="/dashboard/proposals"
                className="ring-focus rounded-sm text-accent-700 underline-offset-2 transition-smooth hover:underline"
              >
                Proposals
              </Link>
              {" · "}
              {timeAgo(save.at)}
            </span>
          )}
          {save.kind === "error" && (
            <span className="anim-enter-fade hidden truncate text-xs text-rose-600 lg:inline">
              {save.message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {planId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReanalyze}
              disabled={reanalyzing}
              title="Re-run the two-stage AI pipeline against the latest prompts"
            >
              {reanalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {/* Icon-only below sm — three text buttons don't fit a phone. */}
              <span className="hidden sm:inline">
                {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDraft}
            disabled={!handoff || save.kind === "saving"}
            title={
              save.kind === "saved"
                ? "Update the saved draft"
                : "Save a draft to your Proposals list"
            }
          >
            {save.kind === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : save.kind === "saved" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {save.kind === "saving"
                ? "Saving…"
                : save.kind === "saved"
                  ? "Saved"
                  : "Save draft"}
            </span>
          </Button>
          <Button size="sm" onClick={handoffAndGo}>
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Send proposal</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
