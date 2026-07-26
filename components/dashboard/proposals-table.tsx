"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgePercent,
  Bell,
  ChevronRight,
  Eye,
  FileDiff,
  HardHat,
  Loader2,
  MoreHorizontal,
  Search,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  jobStage,
  timeAgo,
  type ProposalListItem,
  type ProposalStatus,
} from "@/lib/dashboard-mock";
import { SendModal } from "@/components/proposal/send-modal";
import { PaymentsDrawer } from "@/components/dashboard/payments-drawer";
import { DiscountDrawer } from "@/components/dashboard/discount-drawer";
import { ScheduleFromProposal } from "@/components/workers/schedule-from-proposal";
import { getMyProposal } from "@/app/actions/dashboard";
import { deleteProposal } from "@/app/actions/proposals";
import type { Proposal } from "@/lib/proposal-mock";

const STATUS_TONE: Record<
  ProposalStatus,
  { tone: Parameters<typeof Badge>[0]["tone"]; label: string }
> = {
  draft: { tone: "neutral", label: "Draft" },
  sent: { tone: "sky", label: "Sent" },
  viewed: { tone: "violet", label: "Viewed" },
  accepted: { tone: "emerald", label: "Accepted" },
  declined: { tone: "rose", label: "Declined" },
  expired: { tone: "amber", label: "Expired" },
};

type FilterId = "all" | ProposalStatus | "in_progress" | "done" | "overdue";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "sent", label: "Sent" },
  { id: "viewed", label: "Viewed" },
  { id: "in_progress", label: "In progress" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
  { id: "expired", label: "Expired" },
];

function matchesFilter(p: ProposalListItem, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "in_progress") return jobStage(p) === "in_progress";
  if (filter === "done") return jobStage(p) === "done";
  if (filter === "overdue") return (p.overdueInstallments ?? 0) > 0;
  return p.status === filter;
}

/* Shared grid templates — header row and body rows must stay in sync.
   Column order: Property·Client | Status | Total·collected | Views |
   Updated | Actions. Actions is wide enough for Remind + menu. */
const GRID_LG =
  "lg:grid-cols-[minmax(0,1fr)_132px_112px_104px_80px_104px] lg:items-center lg:gap-3";
const GRID_XL =
  "xl:grid-cols-[minmax(0,1fr)_170px_150px_140px_110px_116px] xl:gap-4";

export function ProposalsTable({
  items,
  compact = false,
  showFilters = true,
  loading = false,
}: {
  items: ProposalListItem[];
  compact?: boolean;
  showFilters?: boolean;
  /** Pulse-skeleton rows while the list is in flight. */
  loading?: boolean;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotion();
  // Payments drawer for accepted jobs (schedule, mark-paid, reminders,
  // change orders). Auto-opens when the URL carries ?pay=<proposalId> —
  // the Overview needs-attention feed links here.
  const [payFor, setPayFor] = useState<string | null>(null);
  // Contractor's price-negotiation drawer for a SENT/VIEWED proposal with
  // a live discount request. Auto-opens on ?deal=<proposalId> — the
  // needs-attention feed + notification emails link here.
  const [dealFor, setDealFor] = useState<string | null>(null);
  // "Schedule crew" — opens the assign-to-worker flow preloaded with this
  // proposal, so its estimate total seeds the worker-pay percentage.
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  // Reactive to soft navigations too — the sidebar "Done jobs" link
  // lands on this same route with ?filter=done, without a remount.
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = searchParams.get("pay");
    if (id) setPayFor(id);
    const deal = searchParams.get("deal");
    if (deal) setDealFor(deal);
    const f = searchParams.get("filter");
    if (f && FILTERS.some((x) => x.id === f)) setFilter(f as FilterId);
  }, [searchParams]);
  // Send-from-list: when the row's Send button is clicked, we load the
  // full Proposal blob from the DB and pop the same SendModal the
  // /proposal editor uses. Loading state is per-row so multiple rows
  // can be Send-clicked in quick succession without spinning the wrong one.
  const [loadingSendId, setLoadingSendId] = useState<string | null>(null);
  const [sendProposal, setSendProposal] = useState<Proposal | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Optimistic hide of deleted rows so the list updates instantly while
  // the server action revalidates the route in the background.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function openSendFor(id: string) {
    setLoadingSendId(id);
    setSendError(null);
    try {
      const loaded = await getMyProposal(id);
      if (!loaded) {
        setSendError("Proposal not found.");
        return;
      }
      setSendProposal(loaded);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to load proposal");
    } finally {
      setLoadingSendId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    const result = await deleteProposal(id);
    if (result.ok) {
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    } else {
      setDeleteError(result.reason);
    }
    setDeletingId(null);
  }

  const filtered = items.filter((p) => {
    if (deletedIds.has(p.id)) return false;
    if (!matchesFilter(p, filter)) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      p.address.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q)
    );
  });

  const overdueTotal = items.filter(
    (p) => !deletedIds.has(p.id) && (p.overdueInstallments ?? 0) > 0,
  ).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-card">
      {showFilters && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const count = items.filter(
                (p) => !deletedIds.has(p.id) && matchesFilter(p, f.id),
              ).length;
              // The Overdue chip only earns a slot when something is
              // actually late — and then it demands attention in rose.
              if (f.id === "overdue" && count === 0) return null;
              const active = filter === f.id;
              const isAlert = f.id === "overdue";
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm",
                    active
                      ? isAlert
                        ? "border-rose-200 bg-rose-50 font-medium text-rose-700"
                        : "border-zinc-200 bg-zinc-100 font-medium text-zinc-900"
                      : isAlert
                        ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                        : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900",
                  )}
                >
                  {isAlert && <AlertTriangle className="h-3.5 w-3.5" />}
                  {f.label}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                      isAlert
                        ? "bg-rose-100 text-rose-700"
                        : active
                          ? "bg-white text-zinc-600"
                          : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search address or client…"
              className="input h-9 w-64 pl-9"
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "hidden gap-3 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 lg:grid",
          GRID_LG,
          GRID_XL,
        )}
      >
        <div className="truncate">Property · Client</div>
        <div>Status</div>
        <div className="text-right">Total · Collected</div>
        <div className="text-center">Client views</div>
        <div className="text-right">Updated</div>
        <div className="text-right">Actions</div>
      </div>

      <ul>
        {loading &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="border-t border-zinc-100 px-4 py-4">
              <div className="space-y-2">
                <div className="skeleton h-4 w-2/5" />
                <div className="skeleton h-3 w-1/4" />
              </div>
            </li>
          ))}
        {!loading && filtered.length === 0 && (
          <li className="px-4 py-12 text-center text-sm text-zinc-500">
            No proposals match these filters.
          </li>
        )}
        {sendError && (
          <li className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
            {sendError}
          </li>
        )}
        {deleteError && (
          <li className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
            Couldn&apos;t delete: {deleteError}
          </li>
        )}
        {!loading &&
          filtered.map((p, i) => {
            const tone = STATUS_TONE[p.status];
            const stage = jobStage(p);
            const overdue = (p.overdueInstallments ?? 0) > 0;
            const pendingCOs = p.pendingChangeOrders ?? 0;
            const paid = p.paidTotal ?? 0;
            const pct =
              p.total > 0
                ? Math.min(100, Math.round((paid / p.total) * 100))
                : 0;
            // Send is meaningful for drafts and re-sends; suppress only
            // for accepted / declined / expired where it'd be misleading.
            const canSend =
              p.status === "draft" ||
              p.status === "sent" ||
              p.status === "viewed";
            const viewCount = p.viewCount ?? 0;
            const lastViewed = p.lastViewedAt;
            return (
              <motion.li
                key={p.id}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 8) * 0.02 }}
                className="relative border-t border-zinc-100"
              >
                {/* Overdue rows get a rose spine so late money is
                    scannable even with the row collapsed on mobile. */}
                {overdue && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-rose-400"
                  />
                )}
                <div
                  className={cn(
                    "transition-smooth group grid grid-cols-1 gap-1 px-4 py-3.5 hover:bg-zinc-50/60",
                    GRID_LG,
                    GRID_XL,
                  )}
                >
                  <Link href={`/proposal?id=${p.id}`} className="min-w-0">
                    <div className="truncate font-medium text-zinc-900">
                      {p.address || (
                        <span className="text-zinc-400">(no address)</span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {p.client || (
                        <span className="text-zinc-400">(no client)</span>
                      )}
                      {p.selectedPackage && (
                        <span className="ml-1 text-zinc-400">
                          · {p.selectedPackage}
                        </span>
                      )}
                    </div>
                  </Link>

                  {/* STATUS — badge plus the payment alarm chips, always
                      visible (they were xl-only before, i.e. invisible). */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stage === "done" ? (
                      <Badge tone="emerald">Done · paid</Badge>
                    ) : stage === "in_progress" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPayFor(p.id);
                        }}
                        title="Open payments — schedule, receipts, reminders"
                      >
                        <Badge tone="accent">In progress</Badge>
                      </button>
                    ) : (
                      <Link href={`/proposal?id=${p.id}`}>
                        <Badge tone={tone.tone}>{tone.label}</Badge>
                      </Link>
                    )}
                    {overdue && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPayFor(p.id);
                        }}
                        className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-200"
                        title={`${p.overdueInstallments} overdue payment${(p.overdueInstallments ?? 0) === 1 ? "" : "s"} — open payments`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {p.overdueInstallments} late
                      </button>
                    )}
                    {pendingCOs > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPayFor(p.id);
                        }}
                        className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-600 ring-1 ring-inset ring-sky-200"
                        title="Change order awaiting the client — open payments"
                      >
                        <FileDiff className="h-3 w-3" />
                        {pendingCOs} CO
                      </button>
                    )}
                    {(p.openDiscountRequests ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDealFor(p.id);
                        }}
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          p.discountNeedsResponse
                            ? "bg-accent-50 text-accent-700 ring-accent-200"
                            : "bg-sky-50 text-sky-600 ring-sky-200",
                        )}
                        title={
                          p.discountNeedsResponse
                            ? "Price request — respond to the client"
                            : "Your counter is with the client"
                        }
                      >
                        <BadgePercent className="h-3 w-3" />
                        {p.discountNeedsResponse ? "Price ask" : "Countered"}
                      </button>
                    )}
                  </div>

                  {/* TOTAL · COLLECTED — accepted jobs show the money
                      state right in the money column. */}
                  {stage ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPayFor(p.id);
                      }}
                      className="text-left lg:text-right"
                      title={`${formatCurrency(paid)} of ${formatCurrency(p.total)} collected — open payments`}
                    >
                      <div className="text-sm font-medium tabular-nums text-zinc-900">
                        {formatCurrency(p.total)}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 lg:justify-end">
                        <span className="h-1 w-12 overflow-hidden rounded-full bg-zinc-100">
                          {/* Static width; entrance draws via scaleX. */}
                          <span
                            className={cn(
                              "anim-grow-x block h-full rounded-full",
                              pct >= 100 ? "bg-emerald-500" : "bg-accent-600",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-medium tabular-nums",
                            pct >= 100 ? "text-emerald-700" : "text-zinc-500",
                          )}
                        >
                          {pct}%
                        </span>
                      </div>
                    </button>
                  ) : (
                    <Link
                      href={`/proposal?id=${p.id}`}
                      className="text-sm font-medium tabular-nums text-zinc-900 lg:text-right"
                    >
                      {formatCurrency(p.total)}
                    </Link>
                  )}

                  <Link
                    href={`/proposal?id=${p.id}`}
                    className="flex items-center gap-1.5 lg:justify-center"
                    title={
                      lastViewed
                        ? `First viewed ${timeAgo(p.firstViewedAt ?? lastViewed)}, last ${timeAgo(lastViewed)}`
                        : viewCount === 0
                          ? "Not opened yet"
                          : undefined
                    }
                  >
                    {viewCount === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                        <Eye className="h-3 w-3" />
                        Not opened
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                        <Eye className="h-3 w-3" />
                        <span className="tabular-nums">{viewCount}×</span>
                        {lastViewed && (
                          <span className="text-violet-500/80">
                            · {timeAgo(lastViewed)}
                          </span>
                        )}
                      </span>
                    )}
                  </Link>
                  <Link
                    href={`/proposal?id=${p.id}`}
                    className="text-xs text-zinc-500 lg:text-right"
                  >
                    {timeAgo(p.updatedAt)}
                  </Link>
                  <div className="flex items-center gap-1 lg:justify-end">
                    {overdue ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPayFor(p.id);
                        }}
                        className="transition-smooth ring-focus press-scale inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-700"
                        title="Payment overdue — open the schedule and send a reminder"
                      >
                        <Bell className="h-3 w-3" />
                        Remind
                      </button>
                    ) : (
                      stage && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPayFor(p.id);
                          }}
                          className="transition-smooth ring-focus press-scale inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700"
                          title="Payment schedule, receipts & change orders"
                        >
                          <Wallet className="h-3 w-3" />
                          Payments
                        </button>
                      )
                    )}
                    {canSend && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openSendFor(p.id);
                        }}
                        disabled={loadingSendId === p.id}
                        className="transition-smooth ring-focus press-scale inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 disabled:opacity-60"
                        title={
                          p.status === "draft"
                            ? "Send proposal to client"
                            : "Re-send proposal"
                        }
                      >
                        {loadingSendId === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        {p.status === "draft" ? "Send" : "Re-send"}
                      </button>
                    )}
                    <RowMenu
                      onDelete={() => handleDelete(p.id)}
                      deleting={deletingId === p.id}
                      address={p.address}
                      onPayments={stage ? () => setPayFor(p.id) : undefined}
                      onSchedule={() => setScheduleFor(p.id)}
                    />
                    <ChevronRight className="hidden h-4 w-4 text-zinc-300 xl:block" />
                  </div>
                </div>
              </motion.li>
            );
          })}
      </ul>

      {compact && (
        <div className="border-t border-zinc-100 p-3 text-center">
          <Link
            href="/dashboard/proposals"
            className="transition-smooth ring-focus group inline-flex items-center gap-1 rounded-md text-sm font-medium text-accent-700 hover:text-accent-800"
          >
            View all proposals
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>
      )}
      {sendProposal && (
        <SendModal
          open
          onClose={() => setSendProposal(null)}
          proposal={sendProposal}
        />
      )}
      {payFor && (
        <PaymentsDrawer proposalId={payFor} onClose={() => setPayFor(null)} />
      )}
      {dealFor && (
        <DiscountDrawer proposalId={dealFor} onClose={() => setDealFor(null)} />
      )}
      {scheduleFor && (
        <ScheduleFromProposal
          proposalId={scheduleFor}
          onClose={() => setScheduleFor(null)}
        />
      )}
    </div>
  );
}

/**
 * Per-row overflow menu — payments shortcut (accepted jobs) + delete.
 * Confirm step is inline (no separate modal) so it's a single click +
 * a single confirm and the row vanishes.
 */
function RowMenu({
  onDelete,
  deleting,
  address,
  onPayments,
  onSchedule,
}: {
  onDelete: () => void;
  deleting: boolean;
  address: string;
  onPayments?: () => void;
  onSchedule?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More actions"
        className="transition-smooth ring-focus inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-500 hover:border-zinc-200 hover:bg-white hover:text-zinc-900"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="anim-pop origin-top-right absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-elevated"
          onClick={(e) => e.stopPropagation()}
        >
          {!confirming ? (
            <>
              {onSchedule && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    onSchedule();
                  }}
                  className="transition-smooth ring-focus flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <HardHat className="h-4 w-4 text-zinc-400" />
                  Schedule crew &amp; set pay
                </button>
              )}
              {onPayments && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    onPayments();
                  }}
                  className="transition-smooth ring-focus flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <Wallet className="h-4 w-4 text-zinc-400" />
                  Payments, receipts & reminders
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirming(true);
                }}
                className="transition-smooth ring-focus flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete proposal
              </button>
            </>
          ) : (
            <div className="anim-enter-fade p-3">
              <div className="text-sm font-medium text-zinc-900">
                Delete this proposal?
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {address ? (
                  <>
                    Permanently removes <strong>{address}</strong> and its
                    history.
                  </>
                ) : (
                  "This permanently removes the draft and its history."
                )}{" "}
                Can&apos;t be undone.
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirming(false);
                    setOpen(false);
                  }}
                  className="transition-smooth ring-focus press-scale rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
