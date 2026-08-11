"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Download,
  FileText,
  User,
  Phone,
  Check,
  X,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  Receipt,
  Ruler,
  Camera,
  CreditCard,
  Wallet,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WorkerRoof } from "./worker-roof";
import { fmtMoney, fmtWhen, STATUS_META } from "./format";
import {
  respondToJob,
  markJobStarted,
  markJobComplete,
  submitJobExpense,
  listMyJobExpenses,
  type WorkerExpenseDTO,
} from "@/app/actions/worker-jobs";
import type { WorkerJobDTO } from "@/lib/worker-dto";

export function WorkerJobDetail({ job }: { job: WorkerJobDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "accept" | "decline" | "start" | "complete">(null);
  const [err, setErr] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const m = job.roof?.measurements;

  async function accept() {
    setBusy("accept");
    setErr(null);
    const r = await respondToJob(job.id, "accept");
    setBusy(null);
    if (!r.ok) return setErr(r.reason);
    router.refresh();
  }
  async function decline() {
    setBusy("decline");
    setErr(null);
    const r = await respondToJob(job.id, "decline", reason);
    setBusy(null);
    if (!r.ok) return setErr(r.reason);
    setDeclining(false);
    router.refresh();
  }
  async function start() {
    setBusy("start");
    setErr(null);
    const r = await markJobStarted(job.id);
    setBusy(null);
    if (!r.ok) return setErr(r.reason);
    router.refresh();
  }
  async function complete() {
    setBusy("complete");
    setErr(null);
    const r = await markJobComplete(job.id);
    setBusy(null);
    if (!r.ok) return setErr(r.reason);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link
        href="/worker"
        className="group inline-flex items-center gap-1.5 rounded-md text-sm text-zinc-500 transition-smooth ring-focus hover:text-zinc-800"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" /> All jobs
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_META[job.status].tone}>{STATUS_META[job.status].label}</Badge>
            <span className="text-xs text-zinc-400">{job.kindLabel}</span>
            {job.owner.company && <span className="text-xs text-zinc-400">· from {job.owner.company}</span>}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold text-ink">{job.title}</h1>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Your pay</div>
          <div className="text-2xl font-semibold text-ink">{fmtMoney(job.workerPayCents)}</div>
        </div>
      </div>

      {/* Owner-attached job file (design / invoice) */}
      {job.attachmentUrl && (
        <a
          href={job.attachmentUrl}
          target="_blank"
          rel="noreferrer"
          className="surface group flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 hover-lift press-scale ring-focus"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent-50 text-accent-700">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">
              {job.attachmentName || "Job file"}
            </div>
            <div className="text-xs text-zinc-500">
              The job file from {job.owner.company || "your contractor"} — design &
              details. Tap to open.
            </div>
          </div>
          <Download className="h-4 w-4 text-zinc-300 transition-smooth group-hover:text-zinc-500" />
        </a>
      )}

      {/* Fence layout */}
      <WorkerRoof roof={job.roof} className="aspect-[16/9] w-full" />

      {m && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat className="anim-enter-fade stagger-1" icon={<Ruler className="h-3.5 w-3.5" />} label="Fence LF" value={`${m.eaveLF}`} />
          <Stat className="anim-enter-fade stagger-2" label="Unfenced LF" value={`${m.rakeLF}`} />
          <Stat className="anim-enter-fade stagger-3" label="Gates" value={`${m.downspoutCount}`} />
          <Stat className="anim-enter-fade stagger-4" label="Stories" value={`${m.stories}`} />
        </div>
      )}

      {/* Details */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="surface space-y-2.5 rounded-2xl border border-zinc-200 bg-white p-4">
          <h3 className="font-label text-zinc-500">Job site</h3>
          {job.clientName && <Row icon={<User className="h-4 w-4" />}>{job.clientName}</Row>}
          <Row icon={<MapPin className="h-4 w-4" />}>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm text-accent-700 ring-focus hover:underline"
            >
              {job.address}
            </a>
          </Row>
          {job.clientPhone && (
            <Row icon={<Phone className="h-4 w-4" />}>
              <a href={`tel:${job.clientPhone}`} className="rounded-sm text-accent-700 ring-focus hover:underline">{job.clientPhone}</a>
            </Row>
          )}
          <Row icon={<Clock className="h-4 w-4" />}>
            {fmtWhen(job.startsAt)} – {fmtWhen(job.endsAt)}
          </Row>
        </div>

        <div className="surface rounded-2xl border border-zinc-200 bg-white p-4">
          <h3 className="font-label mb-2 text-zinc-500">What needs to be done</h3>
          {job.scope ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{job.scope}</p>
          ) : (
            <p className="text-sm text-zinc-400">No extra notes — {job.kindLabel.toLowerCase()}.</p>
          )}
        </div>
      </div>

      {(job.status === "ACCEPTED" ||
        job.status === "IN_PROGRESS" ||
        job.status === "COMPLETED") && <ExpensesCard jobId={job.id} />}

      {job.status === "DECLINED" && job.declineReason && (
        <p className="anim-enter rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">You declined: {job.declineReason}</p>
      )}

      {err && <p className="anim-enter-fade text-sm text-rose-600">{err}</p>}

      {/* Actions — sticky outer stays untransformed; the keyed inner wrapper
          carries the entrance so it replays when the panel swaps. */}
      {job.status === "OFFERED" && (
        <div className="sticky bottom-4 z-10">
          <div key={declining ? "decline" : "respond"} className="anim-enter">
            {declining ? (
              <div
                className={cn(
                  "surface space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-elevated transition-smooth",
                  busy === "decline" && "opacity-70",
                )}
              >
                <label className="block space-y-1.5">
                  <span className="font-label text-zinc-500">Reason (optional)</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Booked that day, too far, etc."
                    className="input w-full resize-none"
                    autoFocus
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDeclining(false)}>Back</Button>
                  <Button variant="danger" onClick={decline} disabled={busy === "decline"}>
                    {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    Decline job
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-elevated">
                <Button variant="outline" className="flex-1" onClick={() => setDeclining(true)}>
                  <X className="h-4 w-4" /> Decline
                </Button>
                <Button className="flex-1" onClick={accept} disabled={busy === "accept"}>
                  {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Accept job
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {job.status === "ACCEPTED" && (
        <div className="sticky bottom-4 z-10">
          <div className="anim-enter flex gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-elevated">
            <Button className="flex-1" onClick={start} disabled={busy === "start"}>
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start job
            </Button>
            <Button variant="outline" className="flex-1" onClick={complete} disabled={busy === "complete"}>
              {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark complete
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-zinc-400">
            Tapping Start shows &quot;in progress&quot; on your contractor&apos;s calendar — no call needed.
          </p>
        </div>
      )}

      {job.status === "IN_PROGRESS" && (
        <div className="sticky bottom-4 z-10">
          <div className="anim-enter space-y-2 rounded-2xl border border-sky-200 bg-white p-3 shadow-elevated">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-sky-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
              </span>
              Job in progress
              {job.startedAt && (
                <span className="text-xs font-normal text-zinc-400">
                  · started {fmtWhen(job.startedAt)}
                </span>
              )}
            </div>
            <Button className="w-full" onClick={complete} disabled={busy === "complete"}>
              {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark job complete
            </Button>
          </div>
        </div>
      )}

      {job.status === "COMPLETED" && (
        <div className="anim-enter flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-3 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Job completed — your contractor has been notified
        </div>
      )}
    </div>
  );
}

const EXPENSE_STATUS_META: Record<
  WorkerExpenseDTO["status"],
  { label: string; tone: "amber" | "emerald" | "neutral" }
> = {
  PENDING: { label: "Waiting on approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "emerald" },
  DECLINED: { label: "Declined", tone: "neutral" },
};

/**
 * Worker-logged extra costs (materials run, dump fee…). Each submission
 * goes to the owner's Financials page for approval; the status chips
 * here close the loop so the crew knows what got covered.
 */
type ReceiptFile = { url: string; name: string; mimeType: string };

function ExpensesCard({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<WorkerExpenseDTO[] | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Who fronted the money. Defaults to out-of-pocket because that's the
  // reason a worker opens this form; the company card is the exception.
  const [paidBy, setPaidBy] = useState<"OUT_OF_POCKET" | "COMPANY_CARD">(
    "OUT_OF_POCKET",
  );
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyJobExpenses(jobId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  /** Snap the receipt first: the upload route reads the total off it, so
   *  the amount fills itself and the crew doesn't type numbers on a
   *  phone with gloves on. */
  async function uploadReceipt(file: File) {
    setErr(null);
    setUploading(true);
    setAutoFilled(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/job-files", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Upload failed");
      setReceipt({ url: data.url, name: data.name, mimeType: data.mimeType });
      // Only ever FILL a blank amount — never overwrite what they typed.
      if (typeof data.totalCents === "number" && data.totalCents > 0 && !amount.trim()) {
        setAmount((data.totalCents / 100).toFixed(2));
        setAutoFilled(true);
      }
      if (!label.trim() && typeof data.note === "string" && data.note.trim()) {
        setLabel(data.note.trim().slice(0, 80));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't upload that receipt");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setErr(null);
    setBusy(true);
    const cents = Math.round(parseFloat(amount) * 100);
    const r = await submitJobExpense(jobId, label, cents, note, {
      paidBy,
      receiptUrl: receipt?.url,
      receiptName: receipt?.name,
      receiptType: receipt?.mimeType,
    });
    if (!r.ok) {
      setErr(r.reason);
      setBusy(false);
      return;
    }
    setLabel("");
    setAmount("");
    setNote("");
    setReceipt(null);
    setAutoFilled(false);
    setPaidBy("OUT_OF_POCKET");
    setRows(await listMyJobExpenses(jobId));
    setBusy(false);
  }

  return (
    <div className="surface rounded-2xl border border-zinc-200 bg-white p-4">
      <h3 className="font-label mb-1 flex items-center gap-1.5 text-zinc-500">
        <Receipt className="h-3.5 w-3.5" /> Your expenses on this job
      </h3>
      <p className="text-xs text-zinc-400">
        Bought something for this job? Snap the receipt — we&apos;ll read the
        total off it. Say whether you paid or the company card did, and the
        contractor approves it from their side.
      </p>

      <div className="mt-3 space-y-1.5">
        {rows === null && <div className="skeleton h-9 w-full rounded-lg" />}
        {rows?.map((e) => {
          const meta = EXPENSE_STATUS_META[e.status];
          return (
            <div
              key={e.id}
              className={cn(
                "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm",
                e.status === "DECLINED" && "opacity-60",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-zinc-800">
                {e.label}
                {e.receiptUrl && (
                  <a
                    href={e.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ring-focus ml-1.5 inline-flex items-center gap-0.5 rounded text-[11px] text-accent-700 hover:underline"
                  >
                    <FileText className="h-3 w-3" />
                    receipt
                  </a>
                )}
              </span>
              <span className="font-medium tabular-nums text-ink">
                {fmtMoney(e.amountCents)}
              </span>
              {/* The money question, answered at a glance: is the company
                  still holding this worker's cash? */}
              {e.paidBy === "OUT_OF_POCKET" ? (
                e.reimbursedAt ? (
                  <Badge tone="emerald">Paid back</Badge>
                ) : (
                  <Badge tone="amber">You&apos;re owed</Badge>
                )
              ) : (
                <Badge tone="neutral">Company card</Badge>
              )}
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
          );
        })}
        {rows?.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-center text-xs text-zinc-400">
            Nothing logged yet.
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {/* Receipt first — it fills the amount in for them. */}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={cn(
              "ring-focus inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-smooth",
              receipt
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-accent-400 hover:text-accent-700",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : receipt ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {uploading
              ? "Reading receipt…"
              : receipt
                ? "Receipt attached"
                : "Add receipt"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              capture="environment"
              className="sr-only"
              disabled={uploading || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // let them re-pick the same file
                if (f) void uploadReceipt(f);
              }}
            />
          </label>
          {receipt && (
            <>
              <a
                href={receipt.url}
                target="_blank"
                rel="noreferrer"
                className="ring-focus min-w-0 max-w-[40%] truncate rounded text-xs text-accent-700 hover:underline"
              >
                {receipt.name}
              </a>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null);
                  setAutoFilled(false);
                }}
                className="ring-focus rounded text-xs text-zinc-400 hover:text-rose-600"
              >
                remove
              </button>
            </>
          )}
        </div>

        {/* Who is out the money — the only thing that decides whether the
            business owes this worker cash. */}
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              {
                id: "OUT_OF_POCKET" as const,
                Icon: Wallet,
                title: "I paid",
                sub: "Pay me back",
              },
              {
                id: "COMPANY_CARD" as const,
                Icon: CreditCard,
                title: "Company card",
                sub: "Nothing owed",
              },
            ]
          ).map(({ id, Icon, title, sub }) => (
            <button
              key={id}
              type="button"
              aria-pressed={paidBy === id}
              onClick={() => setPaidBy(id)}
              className={cn(
                "ring-focus flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-smooth",
                paidBy === id
                  ? "border-accent-400 bg-accent-50 text-accent-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">
                  {title}
                </span>
                <span className="block text-[11px] leading-tight opacity-70">
                  {sub}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What was it? e.g. Sealant + hangers"
            className="input h-9 min-w-0 flex-1 text-sm"
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
              $
            </span>
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAutoFilled(false);
              }}
              inputMode="decimal"
              placeholder="0"
              className={cn(
                "input h-9 w-24 pl-6 text-right text-sm tabular-nums",
                autoFilled && "border-accent-300 bg-accent-50/50",
              )}
            />
          </div>
        </div>
        {autoFilled && (
          <p className="flex items-center gap-1 text-[11px] text-accent-700">
            <Sparkles className="h-3 w-3" />
            Read off your receipt — correct it if it&apos;s wrong.
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the contractor (optional)"
            className="input h-9 min-w-0 flex-1 text-sm"
          />
          <Button size="sm" className="h-9" onClick={submit} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Log it
          </Button>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </div>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-700">
      <span className="text-zinc-400">{icon}</span>
      {children}
    </div>
  );
}

function Stat({ icon, label, value, className }: { icon?: React.ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className={cn("surface rounded-xl border border-zinc-200 bg-white px-3 py-2.5", className)}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        {icon} {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
