"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Mail,
  PartyPopper,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  addInstallment,
  createChangeOrder,
  deleteChangeOrder,
  deleteInstallment,
  getPaymentOverview,
  recordInstallmentPayment,
  resendReceipt,
  sendChangeOrder,
  sendInstallmentReminder,
  undoInstallmentPayment,
  type ActionResult,
  type PaymentMethodId,
  type PaymentOverview,
} from "@/app/actions/payments";
import { timeAgo } from "@/lib/dashboard-mock";
import { SPRING } from "@/lib/motion";

const METHODS: { id: PaymentMethodId; label: string }[] = [
  { id: "CASH", label: "Cash" },
  { id: "CHECK", label: "Check" },
  { id: "CARD", label: "Card" },
  { id: "BANK_TRANSFER", label: "Bank transfer" },
  { id: "OTHER", label: "Other" },
];

const METHOD_LABEL: Record<string, string> = {
  CARD: "card",
  CASH: "cash",
  CHECK: "check",
  BANK_TRANSFER: "bank transfer",
  OTHER: "other",
};

function fmt(cents: number): string {
  return formatCurrency(cents / 100);
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Right-hand payments drawer for an accepted job: schedule + progress,
 * mark-paid (cash/check/card), reminders, receipts, and change orders.
 * Opens from the proposals table; all mutations return a fresh
 * PaymentOverview so the drawer never goes stale.
 */
export function PaymentsDrawer({
  proposalId,
  onClose,
}: {
  proposalId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPaymentOverview(proposalId)
      .then((o) => {
        if (!alive) return;
        if (!o) setLoadError("Couldn't load payments for this proposal.");
        else setOverview(o);
      })
      .catch((e) => {
        if (alive)
          setLoadError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      alive = false;
    };
  }, [proposalId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    // Row chips (paid progress, done stage) come from the server list —
    // refresh so the table reflects whatever happened in the drawer.
    router.refresh();
    onClose();
  }

  async function run(
    id: string,
    fn: () => Promise<ActionResult<unknown>>,
    successFlash?: string,
  ) {
    setBusyId(id);
    setError(null);
    setFlash(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setOverview(result.overview);
      if (successFlash) {
        setFlash(successFlash);
        setTimeout(() => setFlash(null), 4000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      // A tab left open across a deploy POSTs to server-action ids that
      // no longer exist — surface that as "refresh", not a dead button.
      setError(
        /server action|failed to fetch|unexpected response|connection closed/i.test(msg)
          ? "This page is from an older version of the app — refresh the page and try again."
          : msg,
      );
    } finally {
      setBusyId(null);
    }
  }

  const complete = !!overview?.completedAt;

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-zinc-900/30 backdrop-blur-sm"
        onClick={handleClose}
      />
      <motion.aside
        key="panel"
        initial={reduceMotion ? false : { x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={SPRING}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-zinc-200 bg-white shadow-elevated"
        role="dialog"
        aria-label="Payments"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="font-label text-[11px] text-zinc-400">
              Payments
            </div>
            <div className="mt-0.5 truncate text-[15px] font-semibold text-zinc-900">
              {overview?.address ?? "…"}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
              <span className="truncate">{overview?.clientName}</span>
              {overview &&
                (complete ? (
                  <Badge tone="emerald">
                    <PartyPopper className="h-3 w-3" />
                    Done
                  </Badge>
                ) : (
                  <Badge tone="accent">In progress</Badge>
                ))}
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="transition-smooth ring-focus rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadError && (
            <div className="m-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {loadError}
            </div>
          )}
          {!overview && !loadError && (
            <div className="space-y-4 p-5">
              <div className="skeleton h-28" />
              <div className="skeleton h-10 w-2/3" />
              <div className="skeleton h-40" />
            </div>
          )}

          {overview && (
            <div className="space-y-6 p-5">
              {/* Money summary */}
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
                <div className="grid grid-cols-3 divide-x divide-zinc-100">
                  <div className="pr-3">
                    <div className="text-xs text-zinc-500">Contract</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">
                      {fmt(overview.contractCents)}
                    </div>
                  </div>
                  <div className="px-3">
                    <div className="text-xs text-zinc-500">Paid</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600">
                      {fmt(overview.paidCents)}
                    </div>
                  </div>
                  <div className="pl-3">
                    <div className="text-xs text-zinc-500">Left</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">
                      {fmt(overview.remainingCents)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  {/* Static width; the draw-in animates scaleX only. */}
                  <div
                    className={cn(
                      "anim-grow-x h-full rounded-full",
                      complete ? "bg-emerald-500" : "bg-accent-600",
                    )}
                    style={{ width: `${overview.progressPct}%` }}
                  />
                </div>
                {complete && overview.completedAt && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    <PartyPopper className="h-3.5 w-3.5" />
                    Paid in full {dateLabel(overview.completedAt)} — moved to
                    Done jobs
                  </div>
                )}
              </div>

              {(error || flash) && (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    error
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}
                >
                  {error ?? flash}
                </div>
              )}

              {/* Schedule */}
              <section>
                <div className="font-label mb-2 text-[11px] text-zinc-400">
                  Payment schedule
                </div>
                {/* No overflow-hidden: it would clip the "Mark paid" method
                    menu on the LAST row (the final payment), which opens below
                    the button and past the list's bottom edge — the exact
                    reason the final payment couldn't be marked paid. Rounded
                    corners still read fine without it (rows have no fill). */}
                <ul className="rounded-xl border border-zinc-200">
                  {overview.installments.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-zinc-500">
                      No payments scheduled yet — add one below.
                    </li>
                  )}
                  {overview.installments.map((inst, i) => (
                    <InstallmentRow
                      key={inst.id}
                      inst={inst}
                      isLast={i === overview.installments.length - 1}
                      busy={busyId === inst.id}
                      onMarkPaid={(method) =>
                        run(
                          inst.id,
                          () =>
                            recordInstallmentPayment({
                              installmentId: inst.id,
                              method,
                            }),
                          "Payment recorded — receipt emailed to the client.",
                        )
                      }
                      onRemind={() =>
                        run(
                          inst.id,
                          () =>
                            sendInstallmentReminder({ installmentId: inst.id }),
                          "Reminder emailed to the client.",
                        )
                      }
                      onResendReceipt={() =>
                        run(
                          inst.id,
                          () => resendReceipt({ installmentId: inst.id }),
                          "Receipt re-sent.",
                        )
                      }
                      onUndo={() =>
                        run(inst.id, () =>
                          undoInstallmentPayment({ installmentId: inst.id }),
                        )
                      }
                      onDelete={() =>
                        run(inst.id, () =>
                          deleteInstallment({ installmentId: inst.id }),
                        )
                      }
                    />
                  ))}
                </ul>
                <AddInstallmentForm
                  proposalId={overview.proposalId}
                  onResult={(r) => {
                    if (r.ok) setOverview(r.overview);
                    else setError(r.reason);
                  }}
                />
              </section>

              {/* Change orders */}
              <section>
                <div className="font-label mb-2 text-[11px] text-zinc-400">
                  Change orders
                </div>
                <ul className="space-y-2">
                  {overview.changeOrders.map((co) => (
                    <li
                      key={co.id}
                      className="rounded-xl border border-zinc-200 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900">
                            #{co.number} · {co.title}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {co.status === "DRAFT" && "Draft — not sent yet"}
                            {co.status === "SENT" &&
                              `Waiting for client${co.sentAt ? ` · sent ${timeAgo(co.sentAt)}` : ""}`}
                            {co.status === "APPROVED" &&
                              `Approved${co.approvedName ? ` by ${co.approvedName}` : ""}${co.decidedAt ? ` · ${timeAgo(co.decidedAt)}` : ""}`}
                            {co.status === "DECLINED" &&
                              `Declined${co.decidedAt ? ` · ${timeAgo(co.decidedAt)}` : ""}${co.declineReason ? ` — “${co.declineReason}”` : ""}`}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-semibold tabular-nums text-zinc-900">
                            +{fmt(co.amountCents)}
                          </span>
                          <Badge
                            tone={
                              co.status === "APPROVED"
                                ? "emerald"
                                : co.status === "DECLINED"
                                  ? "rose"
                                  : co.status === "SENT"
                                    ? "sky"
                                    : "neutral"
                            }
                          >
                            {co.status === "DRAFT"
                              ? "Draft"
                              : co.status === "SENT"
                                ? "Awaiting client"
                                : co.status === "APPROVED"
                                  ? "Approved"
                                  : "Declined"}
                          </Badge>
                        </div>
                      </div>
                      {(co.status === "DRAFT" || co.status === "SENT") && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === co.id}
                            onClick={() =>
                              run(
                                co.id,
                                () =>
                                  sendChangeOrder({ changeOrderId: co.id }),
                                co.status === "DRAFT"
                                  ? "Change order emailed for approval."
                                  : "Change order re-sent.",
                              )
                            }
                            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-60"
                          >
                            {busyId === co.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            {co.status === "DRAFT"
                              ? "Send for approval"
                              : "Re-send"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === co.id}
                            onClick={() =>
                              run(co.id, () =>
                                deleteChangeOrder({ changeOrderId: co.id }),
                              )
                            }
                            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <NewChangeOrderForm
                  proposalId={overview.proposalId}
                  onResult={(r, thenSendId) => {
                    if (!r.ok) {
                      setError(r.reason);
                      return;
                    }
                    setOverview(r.overview);
                    if (thenSendId) {
                      const created = r.overview.changeOrders.find(
                        (c) => c.status === "DRAFT",
                      );
                      if (created) {
                        run(
                          created.id,
                          () => sendChangeOrder({ changeOrderId: created.id }),
                          "Change order emailed for approval.",
                        );
                      }
                    }
                  }}
                />
              </section>
            </div>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */

function InstallmentRow({
  inst,
  isLast,
  busy,
  onMarkPaid,
  onRemind,
  onResendReceipt,
  onUndo,
  onDelete,
}: {
  inst: PaymentOverview["installments"][number];
  /** Last row in the schedule — its method menu flips UP so it isn't cut off
   *  at the bottom of the list / the scrolled drawer (the final-payment bug). */
  isLast: boolean;
  busy: boolean;
  onMarkPaid: (method: PaymentMethodId) => void;
  onRemind: () => void;
  onResendReceipt: () => void;
  onUndo: () => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const paid = inst.status === "PAID";

  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {paid ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : inst.overdue ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
          ) : (
            <Clock className="h-4 w-4 shrink-0 text-zinc-300" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-900">
              {inst.label}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {paid && inst.paidAt ? (
                <>
                  Paid {dateLabel(inst.paidAt)}
                  {inst.method
                    ? ` · ${METHOD_LABEL[inst.method] ?? inst.method}`
                    : ""}
                  {inst.receiptSentAt ? " · receipt sent" : " · receipt not sent"}
                </>
              ) : inst.dueAt ? (
                inst.overdue ? (
                  <span className="font-medium text-rose-600">
                    Was due {dateLabel(inst.dueAt)}
                    {inst.reminderCount > 0 &&
                      ` · reminded ${inst.reminderCount}×`}
                  </span>
                ) : (
                  <>
                    Due {dateLabel(inst.dueAt)}
                    {inst.reminderCount > 0 &&
                      ` · reminded ${inst.reminderCount}×`}
                  </>
                )
              ) : (
                <>Due on completion</>
              )}
            </div>
          </div>
        </div>
        <div className="text-sm font-semibold tabular-nums text-zinc-900">
          {fmt(inst.amountCents)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6.5">
        {!paid ? (
          <>
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPickerOpen((v) => !v)}
                className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Banknote className="h-3 w-3" />
                )}
                Mark paid
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
              {pickerOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setPickerOpen(false)}
                  />
                  <div
                    className={cn(
                      "anim-pop absolute left-0 z-20 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-elevated",
                      isLast
                        ? "origin-bottom-left bottom-full mb-1"
                        : "origin-top-left top-full mt-1",
                    )}
                  >
                    {METHODS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setPickerOpen(false);
                          onMarkPaid(m.id);
                        }}
                        className="transition-smooth ring-focus flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onRemind}
              title="Email a payment reminder"
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-accent-300 hover:text-accent-700 disabled:opacity-60"
            >
              <Bell className="h-3 w-3" />
              Remind
            </button>
            {!inst.changeOrderId && (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                title="Remove this scheduled payment"
                className="transition-smooth ring-focus press-scale inline-flex items-center rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onResendReceipt}
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-accent-300 hover:text-accent-700 disabled:opacity-60"
            >
              <Mail className="h-3 w-3" />
              {inst.receiptSentAt ? "Re-send receipt" : "Send receipt"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onUndo}
              title="Undo — mark as unpaid"
              className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <RotateCcw className="h-3 w-3" />
              Undo
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function AddInstallmentForm({
  proposalId,
  onResult,
}: {
  proposalId: string;
  onResult: (r: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="transition-smooth ring-focus mt-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a payment
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. Progress payment)"
        className="input h-9 bg-white"
      />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="input num-input h-9 bg-white pl-7"
          />
        </div>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="input h-9 flex-1 bg-white"
          title="Due date (optional — empty means due on completion)"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !label.trim() || !amount}
          onClick={() =>
            startTransition(async () => {
              const cents = Math.round(parseFloat(amount || "0") * 100);
              const r = await addInstallment({
                proposalId,
                label,
                amountCents: Number.isFinite(cents) ? cents : 0,
                dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null,
              });
              onResult(r);
              if (r.ok) {
                setLabel("");
                setAmount("");
                setDue("");
                setOpen(false);
              }
            })
          }
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="transition-smooth ring-focus rounded-md text-xs text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NewChangeOrderForm({
  proposalId,
  onResult,
}: {
  proposalId: string;
  onResult: (r: ActionResult, thenSend: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="transition-smooth ring-focus mt-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-accent-700 hover:text-accent-800"
      >
        <Plus className="h-3.5 w-3.5" />
        New change order
      </button>
    );
  }

  function submit(thenSend: boolean) {
    startTransition(async () => {
      const cents = Math.round(parseFloat(amount || "0") * 100);
      const r = await createChangeOrder({
        proposalId,
        title,
        description: description || undefined,
        amountCents: Number.isFinite(cents) ? cents : 0,
      });
      onResult(r, thenSend);
      if (r.ok) {
        setTitle("");
        setAmount("");
        setDescription("");
        setOpen(false);
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's the extra work? (e.g. Rotted fascia — 18 LF)"
        className="input h-9 bg-white"
      />
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
          $
        </span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="Additional charge"
          className="input num-input h-9 bg-white pl-7"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details the client will see (optional)"
        rows={2}
        className="input h-auto bg-white py-2"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !title.trim() || !amount}
          onClick={() => submit(true)}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Save &amp; send for approval
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !title.trim() || !amount}
          onClick={() => submit(false)}
        >
          Save draft
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="transition-smooth ring-focus rounded-md text-xs text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
