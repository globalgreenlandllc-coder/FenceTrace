"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BadgePercent,
  CheckCircle2,
  Clock,
  Handshake,
  Loader2,
  Sparkles,
  TrendingDown,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  EFFECTIVE_TAX_RATE,
  marginForSaleTotalCents,
} from "@/lib/proposal-mock";
import {
  getDiscountDeal,
  respondToDiscountRequest,
  type DiscountDealDto,
} from "@/app/actions/discounts";
import { SPRING } from "@/lib/motion";

function fmt(cents: number): string {
  return formatCurrency(cents / 100);
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function toCents(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Sale total (post-tax) that leaves `marginPct` margin at a given cost. */
function priceForMargin(costCents: number, marginPct: number): number {
  if (marginPct >= 1) return costCents;
  const revenue = costCents / (1 - marginPct);
  return Math.round(revenue * (1 + EFFECTIVE_TAX_RATE));
}

/**
 * Contractor's price-negotiation drawer. Opens from the proposals table
 * (?deal=<proposalId>) for a SENT/VIEWED proposal that has a price
 * request. Shows the offer thread, a margin-aware coach, and the three
 * responses (agree / counter / decline). Every action returns fresh deal
 * state so the drawer never goes stale.
 */
export function DiscountDrawer({
  proposalId,
  onClose,
}: {
  proposalId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [deal, setDeal] = useState<DiscountDealDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getDiscountDeal(proposalId)
      .then((d) => {
        if (!alive) return;
        if (!d) setLoadError("Couldn't load this price request.");
        else setDeal(d);
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "Failed to load");
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
    router.refresh();
    onClose();
  }

  function respond(
    decision: "agree" | "counter" | "decline",
    opts?: { amountCents?: number; message?: string },
  ) {
    if (!deal?.request) return;
    setError(null);
    startTransition(async () => {
      const r = await respondToDiscountRequest({
        requestId: deal.request!.id,
        decision,
        amountCents: opts?.amountCents,
        message: opts?.message,
      });
      if (!r.ok) {
        setError(r.reason);
        return;
      }
      setDeal(r.state);
    });
  }

  const req = deal?.request ?? null;
  const contractorTurn = req?.status === "OPEN" && req.turn === "CONTRACTOR";

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
        aria-label="Price request"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="font-label flex items-center gap-1.5 text-[11px] text-zinc-400">
              <BadgePercent className="h-3.5 w-3.5" />
              Price request
            </div>
            <div className="mt-0.5 truncate text-[15px] font-semibold text-zinc-900">
              {deal?.address ?? "…"}
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-500">
              {deal?.clientName}
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

        <div className="flex-1 overflow-y-auto p-5">
          {loadError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {loadError}
            </div>
          )}
          {!deal && !loadError && (
            <div className="space-y-4">
              <div className="skeleton h-24" />
              <div className="skeleton h-32" />
            </div>
          )}

          {deal && !req && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
              No price request on this proposal yet.
            </div>
          )}

          {deal && req && (
            <div className="space-y-5">
              <OfferThread req={req} company="You" />

              {/* Current state banner */}
              <div
                className={cn(
                  "rounded-xl border px-4 py-3",
                  contractorTurn
                    ? "border-accent-200 bg-accent-50/60"
                    : "border-zinc-200 bg-zinc-50/60",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm text-zinc-600">
                    {statusLabel(req.status, req.turn)}
                  </div>
                  {statusBadge(req.status, req.turn)}
                </div>
                {(req.status === "OPEN" || req.status === "COUNTERED") && (
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-xs text-zinc-500">
                      {req.turn === "CONTRACTOR" ? "Client asks" : "Your counter"} ·{" "}
                      {req.packageName}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-lg font-semibold tabular-nums text-zinc-900">
                        {fmt(req.currentCents)}
                      </span>
                      <span className="text-xs text-zinc-400 line-through tabular-nums">
                        {fmt(req.listedCents)}
                      </span>
                    </span>
                  </div>
                )}
                {req.status === "AGREED" && (
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-xs text-emerald-700">Agreed price</span>
                    <span className="text-lg font-semibold tabular-nums text-emerald-700">
                      {fmt(req.resolvedCents ?? req.currentCents)}
                    </span>
                  </div>
                )}
                {req.status === "DECLINED" && req.declineReason && (
                  <div className="mt-2 text-xs text-zinc-500">
                    Your note: “{req.declineReason}”
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              {contractorTurn ? (
                <RespondPanel
                  req={req}
                  pending={pending}
                  onAgree={() => respond("agree")}
                  onCounter={(amountCents, message) =>
                    respond("counter", { amountCents, message })
                  }
                  onDecline={(message) => respond("decline", { message })}
                />
              ) : req.status === "COUNTERED" ? (
                <p className="text-center text-xs text-zinc-500">
                  Your counter of {fmt(req.currentCents)} is with the client.
                  You&apos;ll be notified when they respond.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Margin coach + respond actions                                     */
/* ------------------------------------------------------------------ */

function RespondPanel({
  req,
  pending,
  onAgree,
  onCounter,
  onDecline,
}: {
  req: NonNullable<DiscountDealDto["request"]>;
  pending: boolean;
  onAgree: () => void;
  onCounter: (amountCents: number, message: string) => void;
  onDecline: (message: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "counter" | "decline">("idle");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  // Margin at the client's standing ask.
  const askMargin = marginForSaleTotalCents(req.currentCents, req.costCents);

  // Suggested counters, clamped into the valid (ask, listed) band.
  const suggestions = useMemo(() => {
    const lo = req.currentCents;
    const hi = req.listedCents;
    const cands: { label: string; cents: number }[] = [
      { label: "Meet in the middle", cents: Math.round((lo + hi) / 2) },
      { label: "Hold 25% margin", cents: priceForMargin(req.costCents, 0.25) },
      { label: "Hold 30% margin", cents: priceForMargin(req.costCents, 0.3) },
    ];
    const seen = new Set<number>();
    return cands.filter((c) => {
      if (c.cents <= lo || c.cents >= hi) return false;
      if (seen.has(c.cents)) return false;
      seen.add(c.cents);
      return true;
    });
  }, [req.currentCents, req.listedCents, req.costCents]);

  const typedCents = amount.trim() ? toCents(amount) : NaN;
  const counterMargin = Number.isFinite(typedCents)
    ? marginForSaleTotalCents(typedCents, req.costCents)
    : null;
  const counterValid =
    Number.isFinite(typedCents) &&
    typedCents > req.currentCents &&
    typedCents < req.listedCents;

  return (
    <div className="space-y-4">
      {/* Margin coach for the ask */}
      <div
        className={cn(
          "rounded-xl border p-4",
          askMargin.belowCost
            ? "border-rose-200 bg-rose-50/60"
            : "border-zinc-200 bg-white",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent-600" />
          <span className="font-label text-[11px] text-zinc-500">
            Margin coach · at their {fmt(req.currentCents)} ask
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 divide-x divide-zinc-100 text-center">
          <div className="px-1">
            <div className="text-[11px] text-zinc-500">Your cost</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">
              {fmt(req.costCents)}
            </div>
          </div>
          <div className="px-1">
            <div className="text-[11px] text-zinc-500">You keep</div>
            <div
              className={cn(
                "mt-0.5 text-sm font-semibold tabular-nums",
                askMargin.belowCost ? "text-rose-600" : "text-zinc-900",
              )}
            >
              {fmt(askMargin.marginCents)}
            </div>
          </div>
          <div className="px-1">
            <div className="text-[11px] text-zinc-500">Margin</div>
            <div
              className={cn(
                "mt-0.5 text-sm font-semibold tabular-nums",
                askMargin.belowCost
                  ? "text-rose-600"
                  : askMargin.marginPct < 0.15
                    ? "text-amber-600"
                    : "text-emerald-600",
              )}
            >
              {pct(askMargin.marginPct)}
            </div>
          </div>
        </div>
        {askMargin.belowCost ? (
          <div className="mt-3 flex items-start gap-1.5 text-xs text-rose-700">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This is below your cost — you&apos;d lose {fmt(-askMargin.marginCents)} on
            the job. Counter or decline.
          </div>
        ) : askMargin.marginPct < 0.15 ? (
          <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-700">
            <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Thin margin. A small counter recovers most of it.
          </div>
        ) : null}
      </div>

      {mode === "idle" && (
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onAgree}
            className="transition-smooth press-scale ring-focus inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
            Agree to {fmt(req.currentCents)}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("counter")}
              className="transition-smooth press-scale ring-focus inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:border-accent-300 hover:text-accent-700"
            >
              <BadgePercent className="h-4 w-4" />
              Counter
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("decline")}
              className="transition-smooth press-scale ring-focus inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {mode === "counter" && (
        <div className="anim-enter-fade space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
          <div className="font-label text-[11px] text-zinc-500">
            Your counter (between {fmt(req.currentCents)} and {fmt(req.listedCents)})
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setAmount((s.cents / 100).toFixed(2))}
                  className="transition-smooth press-scale ring-focus rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-accent-300 hover:text-accent-700"
                >
                  {s.label} · {fmt(s.cents)}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Counter price"
              className="input num-input h-10 bg-white pl-7"
              autoFocus
            />
          </div>
          {counterMargin && (
            <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
              <span className="text-zinc-500">At this price you keep</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  counterMargin.belowCost
                    ? "text-rose-600"
                    : counterMargin.marginPct < 0.15
                      ? "text-amber-600"
                      : "text-emerald-600",
                )}
              >
                {fmt(counterMargin.marginCents)} · {pct(counterMargin.marginPct)} margin
              </span>
            </div>
          )}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Optional note to the client…"
            className="input h-auto bg-white py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!counterValid || pending}
              onClick={() => onCounter(typedCents, message)}
              className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-accent-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-accent-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send counter
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="transition-smooth ring-focus rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {mode === "decline" && (
        <div className="anim-enter-fade space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
          <div className="font-label text-[11px] text-zinc-500">
            Decline — the price holds at {fmt(req.listedCents)}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Optional — a friendly reason keeps the deal warm…"
            className="input h-auto bg-white py-2 text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecline(message)}
              className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm decline
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="transition-smooth ring-focus rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OfferThread({
  req,
  company,
}: {
  req: NonNullable<DiscountDealDto["request"]>;
  company: string;
}) {
  if (req.offers.length === 0) return null;
  return (
    <ul className="space-y-2">
      {req.offers.map((o, i) => {
        const mine = o.party === "CONTRACTOR";
        return (
          <li key={i} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2",
                mine
                  ? "rounded-br-sm bg-accent-600 text-white"
                  : "rounded-bl-sm border border-zinc-200 bg-white text-zinc-900",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {mine ? company : "Client"}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {fmt(o.amountCents)}
                </span>
              </div>
              {o.message && (
                <div
                  className={cn(
                    "mt-0.5 whitespace-pre-line text-xs leading-relaxed",
                    mine ? "text-white/90" : "text-zinc-600",
                  )}
                >
                  {o.message}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function statusLabel(status: string, turn: string): string {
  if (status === "OPEN" && turn === "CONTRACTOR") return "Waiting on you to respond";
  if (status === "COUNTERED") return "Your counter is with the client";
  if (status === "AGREED") return "Deal agreed — price applied to the proposal";
  if (status === "DECLINED") return "You declined — list price stands";
  if (status === "WITHDRAWN") return "Client withdrew the request";
  if (status === "EXPIRED") return "Request closed";
  return status;
}

function statusBadge(status: string, turn: string) {
  if (status === "OPEN" && turn === "CONTRACTOR")
    return <Badge tone="accent">Your move</Badge>;
  if (status === "COUNTERED")
    return (
      <Badge tone="sky">
        <Clock className="h-3 w-3" />
        Awaiting client
      </Badge>
    );
  if (status === "AGREED")
    return (
      <Badge tone="emerald">
        <CheckCircle2 className="h-3 w-3" />
        Agreed
      </Badge>
    );
  if (status === "DECLINED") return <Badge tone="rose">Declined</Badge>;
  return <Badge tone="neutral">Closed</Badge>;
}
