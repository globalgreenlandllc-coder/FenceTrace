"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  BadgePercent,
  CheckCircle2,
  Clock,
  Loader2,
  PartyPopper,
  Tag,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { DUR, EASE } from "@/lib/motion";
import {
  requestDiscount,
  respondToCounter,
  type DiscountThreadDto,
} from "@/app/actions/discounts";

function fmt(cents: number): string {
  return formatCurrency(cents / 100);
}

/** Parse a "$1,234.50" / "1234" style entry into whole cents. */
function toCents(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * Client-facing price negotiation, rendered on /p/[token] before the
 * proposal is accepted. Anchored at #price so notification emails can
 * deep-link straight here. Mirrors the change-order card's interaction
 * model: the whole flow lives in one card, every action returns fresh
 * thread state, and an agreed price triggers a soft refresh so the
 * accept bar picks up the new (lower) number.
 */
export function DiscountThread({
  token,
  initial,
  selectedPackageId,
  companyName,
}: {
  token: string;
  initial: DiscountThreadDto;
  selectedPackageId: string;
  companyName: string;
}) {
  const [thread, setThread] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const reduce = useReducedMotion();

  const req = thread.request;
  const active = req && (req.status === "OPEN" || req.status === "COUNTERED");
  const agreed = req?.status === "AGREED";

  function apply(result: Awaited<ReturnType<typeof requestDiscount>>, refresh = false) {
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setThread(result.state);
    // An agreed price changed the proposal's discount server-side — refresh
    // so the packages + accept bar re-render at the new number.
    if (refresh) router.refresh();
  }

  return (
    <section id="price" className="scroll-mt-20 space-y-3">
      <div className="flex items-center gap-2">
        <BadgePercent className="h-5 w-5 text-accent-600" />
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
          {agreed ? "Your price" : "Pricing & discounts"}
        </h2>
      </div>

      {agreed && req ? (
        <AgreedCard req={req} reduce={reduce} />
      ) : active && req ? (
        <ActiveCard
          req={req}
          token={token}
          companyName={companyName}
          pending={pending}
          error={error}
          onWithdraw={() =>
            startTransition(async () =>
              apply(
                await respondToCounter({
                  token,
                  requestId: req.id,
                  decision: "withdraw",
                }),
              ),
            )
          }
          onAccept={() =>
            startTransition(async () =>
              apply(
                await respondToCounter({
                  token,
                  requestId: req.id,
                  decision: "accept",
                }),
                true,
              ),
            )
          }
          onCounter={(amountCents, message) =>
            startTransition(async () =>
              apply(
                await respondToCounter({
                  token,
                  requestId: req.id,
                  decision: "counter",
                  amountCents,
                  message,
                }),
              ),
            )
          }
        />
      ) : thread.eligible ? (
        <>
          {req?.status === "DECLINED" && <ResolvedNote req={req} companyName={companyName} />}
          <AskCard
            thread={thread}
            selectedPackageId={selectedPackageId}
            pending={pending}
            error={error}
            onSubmit={(packageId, targetCents, message) =>
              startTransition(async () =>
                apply(
                  await requestDiscount({ token, packageId, targetCents, message }),
                ),
              )
            }
          />
        </>
      ) : req ? (
        <ResolvedNote req={req} companyName={companyName} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Agreed — deal struck, discount applied to the proposal             */
/* ------------------------------------------------------------------ */

function AgreedCard({
  req,
  reduce,
}: {
  req: NonNullable<DiscountThreadDto["request"]>;
  // Module-scoped (not defined during render) so an accept + router.refresh
  // updates the card in place instead of remounting and replaying the entrance.
  reduce: boolean | null;
}) {
  const saved = Math.max(0, req.listedCents - (req.resolvedCents ?? req.currentCents));
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE }}
      className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/70 px-5 py-3">
        <PartyPopper className="h-4 w-4 text-emerald-600" />
        <div className="font-label text-[11px] text-emerald-700">
          Price approved · {req.packageName}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 p-5">
        <div>
          <div className="text-sm text-zinc-500">Your negotiated price</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900">
              {fmt(req.resolvedCents ?? req.currentCents)}
            </span>
            {saved > 0 && (
              <span className="text-sm text-zinc-400 line-through tabular-nums">
                {fmt(req.listedCents)}
              </span>
            )}
          </div>
        </div>
        {saved > 0 && (
          <Badge tone="emerald">
            <CheckCircle2 className="h-3 w-3" />
            You saved {fmt(saved)}
          </Badge>
        )}
      </div>
      <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
        Your proposal below already reflects this price. Review and accept
        whenever you&apos;re ready.
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ask for a discount (no active request)                             */
/* ------------------------------------------------------------------ */

function AskCard({
  thread,
  selectedPackageId,
  pending,
  error,
  onSubmit,
}: {
  thread: DiscountThreadDto;
  selectedPackageId: string;
  pending: boolean;
  error: string | null;
  onSubmit: (packageId: string, targetCents: number, message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const defaultPkg =
    thread.packages.find((p) => p.id === selectedPackageId)?.id ??
    thread.defaultPackageId ??
    thread.packages[0]?.id ??
    "";
  const [packageId, setPackageId] = useState(defaultPkg);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  const pkg = thread.packages.find((p) => p.id === packageId) ?? thread.packages[0];
  const listed = pkg?.listedCents ?? 0;
  // Floor = 50% off the undiscounted base (server-computed), so a
  // promo-discounted proposal can't let the client ask below what the
  // discount lever can actually honor.
  const minCents = pkg?.floorCents ?? Math.ceil(listed * (1 - thread.maxOff));
  const typedCents = amount.trim() ? toCents(amount) : NaN;
  const valid =
    Number.isFinite(typedCents) && typedCents >= minCents && typedCents < listed;

  if (!open) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
              <Tag className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Over budget? Ask for a better price.
              </div>
              <div className="mt-0.5 text-sm text-zinc-500">
                Tell {shortCompany()} what works for you — they can approve it,
                counter, or explain. No obligation.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="transition-smooth press-scale ring-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700"
          >
            <BadgePercent className="h-4 w-4" />
            Request a discount
          </button>
        </div>
      </div>
    );

    function shortCompany() {
      return "your contractor";
    }
  }

  // Quick chips: 5 / 10 / 15% off the listed price.
  const chips = [5, 10, 15].map((pct) => ({
    pct,
    cents: Math.round(listed * (1 - pct / 100)),
  }));

  return (
    <div className="anim-enter rounded-2xl border border-accent-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="font-label text-[11px] text-accent-700">
          Request a better price
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="transition-smooth ring-focus rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {thread.packages.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {thread.packages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPackageId(p.id)}
              className={cn(
                "transition-smooth press-scale ring-focus rounded-lg border px-2.5 py-1.5 text-xs",
                p.id === packageId
                  ? "border-accent-300 bg-accent-50 font-medium text-accent-800"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-baseline justify-between text-sm">
        <span className="text-zinc-500">Listed price</span>
        <span className="font-semibold tabular-nums text-zinc-900">{fmt(listed)}</span>
      </div>

      <div className="mt-3">
        <label className="font-label text-[11px] text-zinc-500">
          Your ideal price
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.pct}
              type="button"
              onClick={() => setAmount((c.cents / 100).toFixed(2))}
              className="transition-smooth press-scale ring-focus rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-accent-300 hover:text-accent-700"
            >
              {c.pct}% off · {fmt(c.cents)}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={(minCents / 100).toFixed(2)}
            className="input num-input h-10 pl-7"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">
          Anywhere from {fmt(minCents)} up to just under {fmt(listed)}.
        </p>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        placeholder="Optional — anything that helps (competing quote, budget, timing)…"
        className="input mt-3 h-auto py-2 text-sm"
      />

      {error && <p className="anim-enter-fade mt-2 text-xs text-rose-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!valid || pending}
          onClick={() => onSubmit(packageId, typedCents, message)}
          className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-accent-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgePercent className="h-4 w-4" />}
          Send price request
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="transition-smooth ring-focus rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Active negotiation (OPEN = waiting on contractor / COUNTERED = you) */
/* ------------------------------------------------------------------ */

function ActiveCard({
  req,
  companyName,
  pending,
  error,
  onWithdraw,
  onAccept,
  onCounter,
}: {
  req: NonNullable<DiscountThreadDto["request"]>;
  token: string;
  companyName: string;
  pending: boolean;
  error: string | null;
  onWithdraw: () => void;
  onAccept: () => void;
  onCounter: (amountCents: number, message: string) => void;
}) {
  const waitingOnClient = req.status === "COUNTERED" && req.turn === "CLIENT";
  const [countering, setCountering] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  const minCents = req.floorCents;
  const typedCents = amount.trim() ? toCents(amount) : NaN;
  const counterValid =
    Number.isFinite(typedCents) && typedCents >= minCents && typedCents < req.currentCents;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-card",
        waitingOnClient ? "border-accent-200" : "border-zinc-200",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-5 py-3",
          waitingOnClient
            ? "border-accent-100 bg-accent-50/60"
            : "border-zinc-100 bg-zinc-50/60",
        )}
      >
        <div
          className={cn(
            "font-label text-[11px]",
            waitingOnClient ? "text-accent-700" : "text-zinc-500",
          )}
        >
          {waitingOnClient
            ? `${companyName} sent a counter-offer · your move`
            : `Price request sent · waiting on ${companyName}`}
        </div>
        {waitingOnClient ? (
          <Badge tone="accent">Your move</Badge>
        ) : (
          <Badge tone="neutral">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        )}
      </div>

      <div className="p-5">
        <OfferThread offers={req.offers} companyName={companyName} />

        <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
          <div className="text-sm text-zinc-500">
            {waitingOnClient ? `${companyName} can do` : "You asked for"}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums text-zinc-900">
              {fmt(req.currentCents)}
            </span>
            <span className="text-xs text-zinc-400 line-through tabular-nums">
              {fmt(req.listedCents)}
            </span>
          </div>
        </div>

        {error && <p className="anim-enter-fade mt-3 text-xs text-rose-600">{error}</p>}

        {waitingOnClient ? (
          <div className="mt-4">
            {!countering ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={onAccept}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Accept {fmt(req.currentCents)}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCountering(true)}
                  className="transition-smooth press-scale ring-focus inline-flex h-10 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:border-accent-300 hover:text-accent-700"
                >
                  Counter back
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onWithdraw}
                  className="transition-smooth ring-focus inline-flex h-10 items-center rounded-lg px-3 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  Keep original price
                </button>
              </div>
            ) : (
              <div className="anim-enter-fade space-y-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                    $
                  </span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder={`Below ${fmt(req.currentCents)}`}
                    className="input num-input h-10 pl-7"
                  />
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder="Optional note…"
                  className="input h-auto py-2 text-sm"
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
                    onClick={() => setCountering(false)}
                    className="transition-smooth ring-focus rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <button
              type="button"
              disabled={pending}
              onClick={onWithdraw}
              className="transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-3.5 w-3.5" />
              Withdraw request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OfferThread({
  offers,
  companyName,
}: {
  offers: NonNullable<DiscountThreadDto["request"]>["offers"];
  companyName: string;
}) {
  const rows = useMemo(() => offers, [offers]);
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-2">
      {rows.map((o, i) => {
        const mine = o.party === "CLIENT";
        return (
          <li
            key={i}
            className={cn("flex", mine ? "justify-end" : "justify-start")}
          >
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
                  {mine ? "You" : companyName}
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

function ResolvedNote({
  req,
  companyName,
}: {
  req: NonNullable<DiscountThreadDto["request"]>;
  companyName: string;
}) {
  if (req.status === "DECLINED") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
        <div className="text-sm font-medium text-zinc-900">
          {companyName} held the price at {fmt(req.listedCents)}.
        </div>
        {req.declineReason && (
          <div className="mt-1 whitespace-pre-line text-sm text-zinc-500">
            “{req.declineReason}”
          </div>
        )}
        <div className="mt-1 text-sm text-zinc-500">
          You can still accept the proposal below at the listed price.
        </div>
      </div>
    );
  }
  // WITHDRAWN / EXPIRED and not eligible to re-ask — keep it quiet.
  return null;
}
