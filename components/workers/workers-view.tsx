"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HardHat,
  Mail,
  Plus,
  Check,
  Ban,
  Clock,
  MapPin,
  Percent,
  Send,
  Copy,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtWhen } from "@/components/worker/format";
import { Modal, Field } from "@/components/workers/modal";
import type { WorkerKind } from "@prisma/client";
import { AssignJobModal } from "@/components/workers/assign-job-modal";
import {
  listWorkers,
  listOwnerJobs,
  listAssignableProposals,
  inviteWorker,
  setWorkerStatus,
  resendWorkerInvite,
  cancelJob,
  type OwnerWorkerDTO,
  type OwnerJobDTO,
  type AssignableProposalDTO,
} from "@/app/actions/workers";

const STATUS_TONE: Record<string, "accent" | "emerald" | "amber" | "rose" | "neutral" | "sky"> = {
  OFFERED: "amber",
  ACCEPTED: "emerald",
  IN_PROGRESS: "sky",
  COMPLETED: "neutral",
  DECLINED: "rose",
  CANCELLED: "neutral",
};

// ── Invite modal ────────────────────────────────────────────────────────────

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [kind, setKind] = useState<WorkerKind>("CREW");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await inviteWorker({ email, name: name || undefined, trade: trade || undefined, kind });
    setBusy(false);
    if (!r.ok) return setErr(r.reason);
    setSent({ inviteUrl: r.inviteUrl, emailSent: r.emailSent });
    onDone();
  }

  return (
    <Modal title="Invite to your team" onClose={onClose}>
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <Check className="h-4 w-4 shrink-0" />
            {sent.emailSent ? "Invite emailed." : "Worker added — email couldn't send, share the link below."}
          </div>
          <Field label="Invite link">
            <div className="flex gap-2">
              <input readOnly value={sent.inviteUrl} className="input flex-1 text-xs" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(sent.inviteUrl)}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </Field>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Role *">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "CREW", label: "Crew / contractor", sub: "Installs — gets jobs + pay" },
                  { value: "SALES", label: "Sales / designer", sub: "Visits — gets appointments" },
                ] as { value: WorkerKind; label: string; sub: string }[]
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setKind(o.value)}
                  className={cn(
                    "transition-smooth ring-focus rounded-xl border px-3 py-2 text-left",
                    kind === o.value
                      ? "border-accent-500 bg-accent-50"
                      : "border-zinc-200 bg-white hover:bg-zinc-50",
                  )}
                >
                  <div className={cn("text-sm font-medium", kind === o.value ? "text-accent-900" : "text-ink")}>
                    {o.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">{o.sub}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Email *">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="crew@example.com"
              className="input w-full"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan" className="input w-full" />
            </Field>
            <Field label="Trade">
              <input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Fence installer" className="input w-full" />
            </Field>
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !email}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send invite
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}


// ── Main view ───────────────────────────────────────────────────────────────

export function WorkersView() {
  const [workers, setWorkers] = useState<OwnerWorkerDTO[]>([]);
  const [jobs, setJobs] = useState<OwnerJobDTO[]>([]);
  const [proposals, setProposals] = useState<AssignableProposalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"invite" | "assign" | null>(null);
  const [tab, setTab] = useState<"jobs" | "crew">("jobs");

  const refresh = useCallback(async () => {
    const [w, j, p] = await Promise.all([listWorkers(), listOwnerJobs(), listAssignableProposals()]);
    setWorkers(w);
    setJobs(j);
    setProposals(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-zinc-100 p-1">
          {(["jobs", "crew"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "transition-smooth ring-focus press-scale rounded-lg px-4 py-1.5 text-sm font-medium capitalize",
                tab === t ? "bg-white text-ink shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t === "jobs" ? "Jobs" : "Crew"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModal("invite")}>
            <Mail className="h-4 w-4" /> Invite worker
          </Button>
          <Button onClick={() => setModal("assign")} disabled={workers.filter((w) => w.status !== "DISABLED").length === 0}>
            <Plus className="h-4 w-4" /> Assign job
          </Button>
        </div>
      </div>

      {loading ? (
        // Skeleton rows shaped like the job/crew cards they stand in for.
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="surface flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <div className="skeleton h-9 w-9" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton h-4 w-48 max-w-full" />
                <div className="skeleton h-3 w-72 max-w-full" />
              </div>
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      ) : tab === "jobs" ? (
        <JobsList jobs={jobs} onChanged={refresh} onAssign={() => setModal("assign")} />
      ) : (
        <CrewList workers={workers} onChanged={refresh} onInvite={() => setModal("invite")} />
      )}

      {modal === "invite" && <InviteModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "assign" && (
        <AssignJobModal workers={workers} proposals={proposals} onClose={() => setModal(null)} onDone={refresh} />
      )}
    </div>
  );
}

function JobsList({ jobs, onChanged, onAssign }: { jobs: OwnerJobDTO[]; onChanged: () => void; onAssign: () => void }) {
  if (jobs.length === 0)
    return (
      <EmptyState
        icon={<HardHat className="h-6 w-6" />}
        title="No jobs assigned yet"
        sub="Assign a proposal or a manual job to a worker — set their pay and schedule."
        action={<Button onClick={onAssign}><Plus className="h-4 w-4" /> Assign job</Button>}
      />
    );
  return (
    <div className="space-y-2.5">
      {jobs.map((j, i) => (
        <div
          key={j.id}
          className="surface anim-enter-fade flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white px-4 py-3"
          style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-ink">{j.title}</span>
              <Badge tone={STATUS_TONE[j.status]}>{j.status.replace("_", " ").toLowerCase()}</Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1"><HardHat className="h-3 w-3" /> {j.workerName}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {j.address}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtWhen(j.startsAt)}</span>
              <span>{j.kindLabel}</span>
            </div>
            {j.status === "DECLINED" && j.declineReason && (
              <p className="mt-1 text-xs text-rose-600">Declined: {j.declineReason}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-sm font-semibold text-ink">{fmtMoney(j.workerPayCents)}</span>
              {/* Render the basis only when it's actually recorded — guessing
                  a label for legacy rows would rewrite their audit trail. */}
              {j.payPct != null && j.payBasis != null && (
                <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[11px] text-zinc-400">
                  <Percent className="h-2.5 w-2.5" />
                  {j.payPct}% of {j.payBasis}
                </span>
              )}
            </div>
            {!["COMPLETED", "CANCELLED", "DECLINED"].includes(j.status) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await cancelJob(j.id);
                  onChanged();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CrewList({ workers, onChanged, onInvite }: { workers: OwnerWorkerDTO[]; onChanged: () => void; onInvite: () => void }) {
  if (workers.length === 0)
    return (
      <EmptyState
        icon={<HardHat className="h-6 w-6" />}
        title="No crew yet"
        sub="Invite a worker by email. They create their own account and see only the jobs you assign them."
        action={<Button onClick={onInvite}><Mail className="h-4 w-4" /> Invite worker</Button>}
      />
    );
  return (
    <div className="space-y-2.5">
      {workers.map((w, i) => (
        <div
          key={w.id}
          className="surface anim-enter-fade flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white px-4 py-3"
          style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
        >
          <div className="grid h-9 w-9 place-items-center rounded-full bg-accent-50 text-accent-700">
            <HardHat className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-ink">{w.name || w.email}</span>
              <Badge tone={w.kind === "SALES" ? "violet" : "sky"}>
                {w.kind === "SALES" ? "sales" : "crew"}
              </Badge>
              {w.status === "ACTIVE" && <Badge tone="emerald">active</Badge>}
              {w.status === "INVITED" && <Badge tone="amber">invited</Badge>}
              {w.status === "DISABLED" && <Badge tone="neutral">disabled</Badge>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
              <span>{w.email}</span>
              {w.trade && <span>· {w.trade}</span>}
              <span>· {w.stats.active} active · {w.stats.completed} done</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {w.status === "INVITED" && (
              <Button variant="ghost" size="sm" onClick={async () => { await resendWorkerInvite(w.id); }}>
                <Send className="h-3.5 w-3.5" /> Resend
              </Button>
            )}
            {w.status !== "DISABLED" ? (
              <Button variant="ghost" size="sm" onClick={async () => { await setWorkerStatus(w.id, "DISABLED"); onChanged(); }}>
                <Ban className="h-3.5 w-3.5" /> Disable
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={async () => { await setWorkerStatus(w.id, "ACTIVE"); onChanged(); }}>
                <Check className="h-3.5 w-3.5" /> Enable
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub: string; action: React.ReactNode }) {
  return (
    <div className="surface anim-enter flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">{icon}</div>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">{sub}</p>
      </div>
      {action}
    </div>
  );
}
