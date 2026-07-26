"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, HardHat, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/workers/modal";
import { AssignJobModal } from "@/components/workers/assign-job-modal";
import {
  listWorkers,
  listAssignableProposals,
  type OwnerWorkerDTO,
  type AssignableProposalDTO,
} from "@/app/actions/workers";

/**
 * Opens the AssignJobModal for a specific proposal — the "Schedule crew"
 * action on a proposals-list row. Lazily loads the owner's crew + assignable
 * proposals (ensuring the clicked proposal is present) on mount, then hands
 * off to the shared modal preselected on that proposal so its estimate total
 * seeds the worker-pay percentage.
 */
export function ScheduleFromProposal({
  proposalId,
  onClose,
  onDone,
}: {
  proposalId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [workers, setWorkers] = useState<OwnerWorkerDTO[] | null>(null);
  const [proposals, setProposals] = useState<AssignableProposalDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    let cancelled = false;
    Promise.all([listWorkers(), listAssignableProposals(proposalId)])
      .then(([w, p]) => {
        if (cancelled) return;
        setWorkers(w);
        setProposals(p);
      })
      .catch(() => {
        // Server action failed (network drop, redeploy invalidating the
        // action id) — surface it instead of spinning forever.
        if (!cancelled) setLoadError("Couldn't load your crew. Check your connection and retry.");
      });
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <Modal title="Schedule to crew" onClose={onClose} maxWidth="max-w-md">
        <div className="flex flex-col items-center gap-3 px-1 py-4 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <p className="max-w-xs text-sm text-zinc-600">{loadError}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                setWorkers(null);
                load();
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Still loading crew/proposals.
  if (workers === null) {
    return (
      <Modal title="Schedule to crew" onClose={onClose} maxWidth="max-w-md">
        <div className="flex items-center justify-center gap-3 px-1 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-accent-600" />
          <span className="text-sm text-zinc-600">Loading your crew…</span>
        </div>
      </Modal>
    );
  }

  // No crew that can take a job (all disabled / only sales reps / none yet).
  const canTakeJob = workers.filter((w) => w.status !== "DISABLED" && w.kind !== "SALES");
  if (canTakeJob.length === 0) {
    return (
      <Modal title="Schedule to crew" onClose={onClose} maxWidth="max-w-md">
        <div className="flex flex-col items-center gap-3 px-1 py-4 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">
            <HardHat className="h-6 w-6" />
          </div>
          <div>
            <p className="font-medium text-ink">No crew to assign yet</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-zinc-500">
              Invite a crew member (installer / contractor) first — then you
              can schedule this job to them and set their pay.
            </p>
          </div>
          <Link href="/dashboard/workers">
            <Button onClick={onClose}>Invite a worker</Button>
          </Link>
        </div>
      </Modal>
    );
  }

  return (
    <AssignJobModal
      workers={workers}
      proposals={proposals}
      defaultProposalId={proposalId}
      onClose={onClose}
      onDone={() => {
        onDone?.();
        onClose();
      }}
    />
  );
}
