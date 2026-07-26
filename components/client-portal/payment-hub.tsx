"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  PartyPopper,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { AerialSection } from "@/components/proposal/aerial-section";
import { PackagesSection } from "@/components/proposal/packages-section";
import { PhotosSection } from "@/components/proposal/photos-section";
import { TermsSection } from "@/components/proposal/terms-section";
import type { Proposal } from "@/lib/proposal-mock";
import { DUR, EASE, fadeIn, staggerContainer } from "@/lib/motion";
import {
  respondToChangeOrder,
  type PortalPaymentState,
} from "@/app/actions/payments";

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
    year: "numeric",
  });
}

/**
 * Count-up for the hero paid figure. The markup always renders the
 * final formatted value (SSR/hydration-safe); after mount an effect
 * animates the text node from the previous value — 0 on first reveal,
 * the prior total on live state updates — over the same 0.5s ease the
 * progress bar uses, so number and bar move together. Reduced motion
 * skips the animation entirely (static value, no tree change).
 */
function PaidAmount({ cents }: { cents: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) {
      // No animation will play; keep the baseline at the on-screen value
      // (render always shows the final figure). Idempotent, so safe under
      // StrictMode's double-invoked effects.
      fromRef.current = cents;
      return;
    }
    const from = fromRef.current;
    if (from === cents) return;
    const controls = animate(from, cents, {
      duration: 0.5,
      ease: EASE,
      // Track the displayed value here (not in setup) so the effect stays
      // idempotent and an interrupted animation resumes from what the
      // viewer actually sees instead of jumping to the previous target.
      onUpdate: (v) => {
        el.textContent = fmt(v);
        fromRef.current = v;
      },
      onComplete: () => {
        el.textContent = fmt(cents);
        fromRef.current = cents;
      },
    });
    return () => controls.stop();
  }, [cents, reduce]);

  return <span ref={ref}>{fmt(cents)}</span>;
}

/**
 * Post-acceptance homeowner view: payment schedule + progress, pay
 * buttons, change-order approvals, and a collapsible copy of the
 * signed proposal. Rendered by ClientPortalView once the proposal is
 * ACCEPTED.
 */
export function PaymentHub({
  proposal,
  initialState,
  token,
}: {
  proposal: Proposal;
  initialState: PortalPaymentState;
  token: string;
}) {
  const [state, setState] = useState(initialState);
  const [showProposal, setShowProposal] = useState(false);
  const reduce = useReducedMotion();

  const firstNamePart =
    (state.clientName || proposal.client.name).trim().split(/\s+/)[0] ||
    "there";
  const complete = !!state.completedAt;
  // Server-resolved links (snapshot → live-profile fallback), with the
  // proposal blob as a last resort for older cached states.
  const stripeUrl =
    state.payLinks?.stripeUrl ?? proposal.contractor.stripePaymentUrl ?? null;
  const squareUrl =
    state.payLinks?.squareUrl ?? proposal.contractor.squarePaymentUrl ?? null;

  const nextDue = useMemo(
    () => state.installments.find((i) => i.status === "PENDING") ?? null,
    [state.installments],
  );
  const pendingCOs = state.changeOrders.filter((c) => c.status === "SENT");
  const decidedCOs = state.changeOrders.filter(
    (c) => c.status === "APPROVED" || c.status === "DECLINED",
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.entrance, ease: EASE }}
        className="space-y-6"
      >
        {/* Hero: status + progress */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] text-zinc-500">
                {proposal.contractor.company} · Project hub
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
                {complete ? (
                  <>All done, {firstNamePart} — paid in full.</>
                ) : (
                  <>Hi {firstNamePart}, here&apos;s your project.</>
                )}
              </h1>
              <p className="mt-1 text-sm text-zinc-500">{proposal.address}</p>
            </div>
            {complete ? (
              <Badge tone="emerald">
                <PartyPopper className="h-3 w-3" />
                Complete
              </Badge>
            ) : (
              <Badge tone="accent">
                <Wrench className="h-3 w-3" />
                In progress
              </Badge>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[26px] font-semibold tabular-nums leading-none text-zinc-900">
                  <PaidAmount cents={state.paidCents} />
                  <span className="ml-1.5 text-sm font-normal text-zinc-400">
                    of {fmt(state.contractCents)} paid
                  </span>
                </div>
              </div>
              <div className="text-sm tabular-nums text-zinc-500">
                {state.progressPct}%
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
              {/* GPU-safe: full-width bar scaled to the paid fraction, so
                  live progress updates (mark-paid) animate, not just the
                  mount reveal. */}
              <motion.div
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: state.progressPct / 100 }}
                transition={{ duration: 0.5, ease: EASE }}
                style={{ width: "100%", originX: 0 }}
                className={cn(
                  "h-full rounded-full",
                  complete ? "bg-emerald-500" : "bg-accent-600",
                )}
              />
            </div>
            {!complete && state.remainingCents > 0 && (
              <div className="mt-2 text-xs text-zinc-500">
                {fmt(state.remainingCents)} remaining
              </div>
            )}
          </div>
        </div>

        {/* Change orders needing approval — surfaced FIRST */}
        {pendingCOs.length > 0 && (
          <section id="change-orders" className="space-y-3">
            {pendingCOs.map((co) => (
              <ChangeOrderCard
                key={co.id}
                co={co}
                token={token}
                company={proposal.contractor.company}
                onDecided={setState}
              />
            ))}
          </section>
        )}

        {/* Payment schedule */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
          <div className="border-b border-zinc-100 px-5 py-4">
            <div className="font-label text-[11px] text-zinc-500">
              Payment schedule
            </div>
          </div>
          <motion.ul
            initial={reduce ? false : "hidden"}
            animate="visible"
            variants={staggerContainer(0.04)}
          >
            {state.installments.map((i) => {
              const isNext = nextDue?.id === i.id;
              return (
                <motion.li
                  key={i.id}
                  variants={fadeIn}
                  className={cn(
                    "border-b border-zinc-100 px-5 py-4 last:border-b-0",
                    isNext && !complete && "bg-accent-50/40",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {i.status === "PAID" ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      ) : i.overdue ? (
                        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
                      ) : (
                        <Clock className="h-5 w-5 shrink-0 text-zinc-300" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900">
                          {i.label}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {i.status === "PAID" && i.paidAt ? (
                            <>
                              Paid {dateLabel(i.paidAt)}
                              {i.method
                                ? ` · ${METHOD_LABEL[i.method] ?? i.method}`
                                : ""}
                            </>
                          ) : i.dueAt ? (
                            i.overdue ? (
                              <span className="font-medium text-rose-600">
                                Was due {dateLabel(i.dueAt)}
                              </span>
                            ) : (
                              <>Due {dateLabel(i.dueAt)}</>
                            )
                          ) : (
                            <>Due on completion</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold tabular-nums text-zinc-900">
                        {fmt(i.amountCents)}
                      </div>
                      {i.status === "PAID" ? (
                        <Badge tone="emerald">Paid</Badge>
                      ) : i.overdue ? (
                        <Badge tone="rose">Overdue</Badge>
                      ) : (
                        <Badge tone="neutral">Upcoming</Badge>
                      )}
                    </div>
                  </div>

                  {isNext && !complete && (
                    <div className="mt-3 flex flex-col gap-2 pl-8">
                      {(stripeUrl || squareUrl) && (
                        <div className="flex flex-wrap gap-2">
                          {stripeUrl && (
                            <PayLink
                              href={stripeUrl}
                              label={`Pay ${fmt(i.amountCents)} online`}
                              primary
                            />
                          )}
                          {squareUrl && (
                            <PayLink
                              href={squareUrl}
                              label="Pay with Square"
                              primary={!stripeUrl}
                            />
                          )}
                        </div>
                      )}
                      <p className="text-xs text-zinc-500">
                        Paying by cash or check? Hand it to{" "}
                        {proposal.contractor.company} — they&apos;ll mark it
                        received and you&apos;ll get an emailed receipt
                        automatically.
                      </p>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        </div>

        {/* Decided change orders (muted history) */}
        {decidedCOs.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="font-label text-[11px] text-zinc-500">
                Change orders
              </div>
            </div>
            <ul>
              {decidedCOs.map((co) => (
                <li
                  key={co.id}
                  className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-900">
                      #{co.number} · {co.title}
                    </div>
                    {co.decidedAt && (
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {co.status === "APPROVED" ? "Approved" : "Declined"}{" "}
                        {dateLabel(co.decidedAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-zinc-900">
                      {fmt(co.amountCents)}
                    </span>
                    <Badge tone={co.status === "APPROVED" ? "emerald" : "rose"}>
                      {co.status === "APPROVED" ? "Approved" : "Declined"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Collapsible signed proposal */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
          <button
            type="button"
            onClick={() => setShowProposal((v) => !v)}
            className="transition-smooth flex w-full items-center justify-between px-5 py-4 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-900">
              <FileText className="h-4 w-4 text-zinc-400" />
              Your signed proposal
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-zinc-400 transition-transform motion-reduce:transition-none",
                showProposal && "rotate-180",
              )}
            />
          </button>
          {showProposal && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.base, ease: EASE }}
              className="space-y-8 border-t border-zinc-100 p-5"
            >
              <AerialSection proposal={proposal} />
              <PackagesSection
                proposal={proposal}
                onChange={() => undefined}
                readOnly
                selectedPackageId={
                  proposal.packages.find((p) => p.recommended)?.id ??
                  proposal.packages[0]?.id
                }
                onSelectPackage={() => undefined}
              />
              <PhotosSection
                proposal={proposal}
                onChange={() => undefined}
                readOnly
              />
              <TermsSection
                proposal={proposal}
                onChange={() => undefined}
                readOnly
              />
            </motion.div>
          )}
        </div>

        <p className="pb-8 text-center text-xs text-zinc-400">
          Questions about a payment? Reply to any receipt email or call{" "}
          {proposal.contractor.name} at {proposal.contractor.phone}.
        </p>
      </motion.div>
    </main>
  );
}

function PayLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "transition-smooth press-scale ring-focus inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm",
        primary
          ? "bg-accent-600 text-white hover:bg-accent-700"
          : "border border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300",
      )}
    >
      <CreditCard className="h-4 w-4" />
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
    </a>
  );
}

function ChangeOrderCard({
  co,
  token,
  company,
  onDecided,
}: {
  co: PortalPaymentState["changeOrders"][number];
  token: string;
  company: string;
  onDecided: (state: PortalPaymentState) => void;
}) {
  const [name, setName] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(decision: "approve" | "decline") {
    setError(null);
    startTransition(async () => {
      const result = await respondToChangeOrder({
        token,
        changeOrderId: co.id,
        decision,
        name,
        declineReason: declineReason || undefined,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onDecided(result.state);
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-accent-200 bg-white shadow-card">
      <div className="border-b border-accent-100 bg-accent-50/60 px-5 py-3">
        <div className="font-label text-[11px] text-accent-700">
          Change order #{co.number} · needs your approval
        </div>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-zinc-900">
              {co.title}
            </div>
            {co.description && (
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-600">
                {co.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold tabular-nums text-zinc-900">
              +{fmt(co.amountCents)}
            </div>
            <div className="text-[11px] text-zinc-500">
              added to your contract
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          {company} found extra work outside the original scope. Nothing is
          charged unless you approve — approving adds this amount to your
          project invoice.
        </p>

        <div className="mt-4 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full name to approve"
            className="input"
          />
          {declining && (
            <input
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason (optional)"
              className="input anim-enter-fade"
            />
          )}
          {error && (
            <p className="anim-enter-fade text-xs text-rose-600">{error}</p>
          )}
          {/* Keyed so the approve <-> decline row swap re-mounts with a
              short fade instead of an instant tree cut. */}
          <div
            key={declining ? "decline" : "approve"}
            className="anim-enter-fade flex flex-wrap items-center gap-2"
          >
            {!declining ? (
              <>
                <button
                  type="button"
                  disabled={pending || name.trim().length < 2}
                  onClick={() => submit("approve")}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-accent-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Approve · {fmt(co.amountCents)}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setDeclining(true)}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  Decline
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit("decline")}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm decline
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setDeclining(false)}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
