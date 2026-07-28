"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  DollarSign,
  FileText,
  Percent,
  Send,
  AlertTriangle,
  Loader2,
  Upload,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { JOB_KIND_OPTIONS } from "@/lib/worker-dto";
import { fmtMoney } from "@/components/worker/format";
import { Modal, Field } from "@/components/workers/modal";
import {
  resolvePayBase,
  computePayCents,
  type EstimateSource,
} from "@/lib/worker-pay";
import type { JobKind } from "@prisma/client";
import {
  assignJob,
  getPayDefaults,
  type OwnerWorkerDTO,
  type AssignableProposalDTO,
} from "@/app/actions/workers";

/**
 * AssignJobModal — owner assigns a priced crew job to a worker and sets their
 * pay. Shared by the Workers view and the "Schedule crew" action on the
 * proposals list.
 *
 * Smart pay base: worker pay = a percentage of a BASE amount, resolved in this
 * priority:
 *   1. An uploaded job file (invoice/design) → AI-read invoice total. An
 *      explicit upload always wins — "if it's just a file, read the file".
 *   2. The source proposal's in-app estimate total (satellite / manual /
 *      blueprint takeoff) → no upload needed.
 * The owner can override the percent or hand-type the pay at any point. The
 * worker only ever sees their pay amount — never the base or the percent
 * (either would reveal the client contract price).
 */

const SOURCE_LABEL: Record<EstimateSource, string> = {
  satellite: "satellite estimate",
  manual: "field-measured estimate",
  blueprint: "blueprint estimate",
  estimate: "estimate",
};

/** datetime-local value → ISO; interprets the input as local time. */
const localToIso = (v: string) => (v ? new Date(v).toISOString() : "");

/** Default start = next hour, local, as a datetime-local string. */
function defaultSlot(): { start: string; end: string } {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  const end = new Date(d.getTime() + 3 * 3600_000);
  return { start: fmt(d), end: fmt(end) };
}

/** The editable fields a chosen proposal prefills. Tracked so deselecting can
 *  clear exactly the untouched copies and never an owner-typed value. */
type Prefill = { title: string; address: string; clientName: string };

const prefillOf = (p: AssignableProposalDTO): Prefill => ({
  title: `Install — ${p.clientName || p.address}`,
  address: p.address,
  clientName: p.clientName,
});

const kindOf = (p: AssignableProposalDTO | undefined): JobKind =>
  p?.jobType === "new" ? "GUTTERS_NEW" : "GUTTERS_REPLACEMENT";

export function AssignJobModal({
  workers,
  proposals,
  defaultProposalId,
  onClose,
  onDone,
}: {
  workers: OwnerWorkerDTO[];
  proposals: AssignableProposalDTO[];
  /** Preselect + prefill from this proposal (the "Schedule crew" entry).
   *  Both entry flows load `proposals` before mounting the modal, so the
   *  initial render can seed from it directly — no effect needed. */
  defaultProposalId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const slot = useMemo(defaultSlot, []);
  // Jobs go to CREW; sales reps get appointments (assign those on the calendar).
  const assignable = workers.filter(
    (w) => w.status !== "DISABLED" && w.kind !== "SALES",
  );
  const initial = defaultProposalId
    ? proposals.find((p) => p.id === defaultProposalId)
    : undefined;

  const [workerId, setWorkerId] = useState(assignable[0]?.id ?? "");
  const [proposalId, setProposalId] = useState(initial?.id ?? "");
  const [title, setTitle] = useState(initial ? prefillOf(initial).title : "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState("");
  const [kind, setKind] = useState<JobKind>(kindOf(initial));
  const [scope, setScope] = useState("");
  const [pay, setPay] = useState("");
  const [payTouched, setPayTouched] = useState(false);
  const [start, setStart] = useState(slot.start);
  const [end, setEnd] = useState(slot.end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const prefillRef = useRef<Prefill | null>(initial ? prefillOf(initial) : null);

  // Job-file attachment + AI-read invoice total (an uploaded file overrides
  // the proposal estimate as the pay base).
  const [attachment, setAttachment] = useState<{
    url: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [invoiceTotalCents, setInvoiceTotalCents] = useState<number | null>(
    null,
  );
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [pct, setPct] = useState("10");
  const pctEdited = useRef(false);

  // The selected proposal and its estimate base are DERIVED from proposalId —
  // one source of truth, so the banner/base can never show a stale proposal.
  const selected = proposalId
    ? proposals.find((p) => p.id === proposalId)
    : undefined;
  const proposalBaseCents =
    selected && selected.estimateTotalCents > 0
      ? selected.estimateTotalCents
      : null;
  const proposalSource = selected?.estimateSource ?? null;

  // The base the pay % applies to: an uploaded invoice wins over the proposal
  // estimate (an explicit upload is a deliberate override).
  const { baseCents, baseSource } = resolvePayBase({
    invoiceTotalCents,
    proposalBaseCents,
  });

  // Prefill from a chosen proposal; on deselect ("Manual job"), clear only the
  // fields still holding the old proposal's prefill — a job must never keep a
  // different client's address by accident, but owner-typed edits survive.
  function pickProposal(id: string) {
    const p = id ? proposals.find((x) => x.id === id) : undefined;
    setProposalId(p ? id : "");
    if (!p) {
      const prev = prefillRef.current;
      if (prev) {
        setTitle((t) => (t === prev.title ? "" : t));
        setAddress((a) => (a === prev.address ? "" : a));
        setClientName((c) => (c === prev.clientName ? "" : c));
      }
      prefillRef.current = null;
      return;
    }
    const next = prefillOf(p);
    setTitle(next.title);
    setAddress(next.address);
    setClientName(next.clientName);
    setKind(kindOf(p));
    prefillRef.current = next;
  }

  // Default percentage comes from the owner's financial settings (crew %) —
  // but a late-resolving fetch must not clobber a percent already typed.
  useEffect(() => {
    getPayDefaults().then(({ crewPct }) => {
      if (crewPct > 0 && !pctEdited.current) setPct(String(crewPct));
    });
  }, []);

  // Auto-fill pay = pct × base, unless the owner typed a pay by hand. When
  // the base disappears (switched to a manual job / unpriced proposal /
  // removed the invoice), the derived pay is cleared with it — a $ amount
  // computed from another job's contract must not silently survive.
  const hadBase = useRef(baseCents != null);
  useEffect(() => {
    const basePresent = baseCents != null;
    const baseVanished = hadBase.current && !basePresent;
    hadBase.current = basePresent;
    if (payTouched) return;
    const cents = computePayCents(baseCents, parseFloat(pct));
    if (cents != null) setPay((cents / 100).toFixed(2));
    else if (baseVanished) setPay("");
  }, [baseCents, pct, payTouched]);

  async function uploadJobFile(file: File) {
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/job-files", { method: "POST", body: fd });
      const body = (await res.json()) as {
        url?: string;
        name?: string;
        mimeType?: string;
        totalCents?: number | null;
        note?: string | null;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setUploadErr(body.error || "Upload failed");
        return;
      }
      setAttachment({
        url: body.url,
        name: body.name || file.name,
        mimeType: body.mimeType || file.type,
      });
      setInvoiceTotalCents(body.totalCents ?? null);
      setExtractNote(body.note ?? null);
    } catch {
      setUploadErr("Upload failed — check your connection and try again");
    } finally {
      setUploading(false);
    }
  }

  async function submit(ignoreConflict: boolean) {
    setBusy(true);
    setErr(null);
    const payCents = Math.round(parseFloat(pay || "0") * 100);
    const pctNum = parseFloat(pct);
    // payPct is the audit claim "pay = pct% of the base" — only sent when the
    // pay actually came from that math. The base itself is always recorded
    // when known (e.g. an invoice was read but the owner hand-typed the pay),
    // so the reading isn't lost. The server re-verifies the claim.
    const percentDrove =
      !payTouched && computePayCents(baseCents, pctNum) != null;
    const r = await assignJob({
      workerId,
      proposalId: proposalId || null,
      title,
      address,
      clientName: clientName || null,
      clientPhone: clientPhone || null,
      kind,
      scope: scope || null,
      workerPayCents: payCents,
      startsAtIso: localToIso(start),
      endsAtIso: localToIso(end),
      attachmentUrl: attachment?.url ?? null,
      attachmentName: attachment?.name ?? null,
      attachmentType: attachment?.mimeType ?? null,
      payBaseCents: baseCents,
      payBasis: baseSource,
      payPct: percentDrove ? Math.min(pctNum, 100) : null,
      ignoreConflict,
    });
    setBusy(false);
    if (r.ok) {
      onDone();
      onClose();
      return;
    }
    if ("conflict" in r && r.conflict) {
      setConflict(r.reason);
      return;
    }
    setErr(r.reason);
  }

  const worker = assignable.find((w) => w.id === workerId);

  return (
    <Modal title="Assign a job to a worker" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Worker *">
          <select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            className="input w-full"
          >
            {assignable.length === 0 && (
              <option value="">No workers — invite one first</option>
            )}
            {assignable.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name || w.email} {w.status === "INVITED" ? "(pending)" : ""}
              </option>
            ))}
          </select>
        </Field>

        {worker?.status === "INVITED" && (
          <p className="-mt-2 text-xs text-amber-600">
            This worker hasn&apos;t accepted their invite yet — they&apos;ll see
            the job when they join.
          </p>
        )}

        <Field label="From a proposal (carries the fence layout + estimate)">
          <select
            value={proposalId}
            onChange={(e) => pickProposal(e.target.value)}
            className="input w-full"
          >
            <option value="">— Manual job (no proposal) —</option>
            {proposals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName || "—"} · {p.address}
                {p.estimateTotalCents > 0
                  ? ` · ${fmtMoney(p.estimateTotalCents)}`
                  : p.hasRoof
                    ? " · roof layout"
                    : ""}
              </option>
            ))}
          </select>
        </Field>

        {/* Smart base banner — the estimate we'll base pay on, when the
            proposal has one and no invoice file has overridden it. */}
        {baseSource === "estimate" && proposalBaseCents != null && (
          <div className="flex items-start gap-2 rounded-xl bg-accent-50 px-3 py-2.5 text-xs text-accent-900 ring-1 ring-accent-200">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" />
            <span>
              Basing pay on this proposal&apos;s{" "}
              <strong>{SOURCE_LABEL[proposalSource ?? "estimate"]}</strong> of{" "}
              <strong>{fmtMoney(proposalBaseCents)}</strong>. Worker pay below
              is your % of it — adjust either, or attach an invoice to use that
              total instead.
            </span>
          </div>
        )}

        <Field label="Job title *">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Install cedar privacy fence"
            className="input w-full"
          />
        </Field>

        <Field label="Job type">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as JobKind)}
            className="input w-full"
          >
            {JOB_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Job file → AI reads the invoice total → pay = your % of it. An
            uploaded file overrides the proposal estimate as the base. */}
        <Field label="Job file (design / invoice — the worker will see it)">
          <div className="space-y-2">
            {attachment ? (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-accent-600" />
                <span className="min-w-0 flex-1 truncate text-zinc-700">
                  {attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachment(null);
                    setInvoiceTotalCents(null);
                    setExtractNote(null);
                  }}
                  className="ring-focus transition-smooth rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                  title="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label
                className={cn(
                  "transition-smooth flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500 hover:border-accent-300 hover:text-accent-700",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading &
                    reading the total…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Attach PDF or photo
                  </>
                )}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadJobFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {uploadErr && <p className="text-xs text-rose-600">{uploadErr}</p>}
            {attachment && (
              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-xs",
                  invoiceTotalCents != null
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                    : "bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200",
                )}
              >
                {invoiceTotalCents != null ? (
                  <>
                    Invoice total read:{" "}
                    <strong>{fmtMoney(invoiceTotalCents)}</strong>
                    {extractNote ? ` — ${extractNote}` : ""}. Worker pay below
                    is your % of it — adjust either.
                  </>
                ) : (
                  "Couldn't find a clear total in this file — type the pay yourself."
                )}
              </p>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Worker %">
            <div className="relative">
              <Percent className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={pct}
                onChange={(e) => {
                  setPct(e.target.value);
                  pctEdited.current = true;
                  setPayTouched(false); // changing % re-drives the auto pay
                }}
                className="input w-full pl-8"
              />
            </div>
          </Field>
          <Field label="Worker pay *">
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="number"
                min="0"
                step="1"
                value={pay}
                onChange={(e) => {
                  setPay(e.target.value);
                  setPayTouched(true);
                }}
                placeholder="0.00"
                className="input w-full pl-8"
              />
            </div>
          </Field>
        </div>
        {baseCents != null && !payTouched && (
          <p className="-mt-1.5 text-[11px] text-zinc-400">
            {pct || 0}% of {fmtMoney(baseCents)} (
            {baseSource === "invoice" ? "invoice" : "estimate"})
          </p>
        )}

        <Field label="Job-site address *">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St"
            className="input w-full"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Client name">
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="input w-full"
            />
          </Field>
          <Field label="Client phone (optional)">
            <input
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="input w-full"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts *">
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input w-full"
            />
          </Field>
          <Field label="Ends *">
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input w-full"
            />
          </Field>
        </div>

        <Field label="What needs to be done">
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={3}
            placeholder="Tear out old fence, set posts in concrete, install 6&quot; cedar privacy, hang two gates…"
            className="input w-full resize-none"
          />
        </Field>

        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          The worker sees the client, address, roof layout, and{" "}
          <strong>their pay only</strong> — never your price or the percent.
        </p>

        {conflict ? (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{conflict}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConflict(null)}>
                Change time
              </Button>
              <Button size="sm" onClick={() => submit(true)} disabled={busy}>
                Assign anyway
              </Button>
            </div>
          </div>
        ) : (
          <>
            {err && <p className="text-sm text-rose-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => submit(false)}
                disabled={busy || !workerId || !title || !address}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Assign job
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
