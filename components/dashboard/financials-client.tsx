"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  CircleCheckBig,
  HardHat,
  Loader2,
  PencilLine,
  Plus,
  Receipt,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/dashboard/stat-tile";
import { cn } from "@/lib/utils";
import { profitPlan } from "@/lib/job-costing";
import {
  addJobExpense,
  decideJobExpense,
  deleteJobExpense,
  getFinancialsOverview,
  setJobManualCost,
  type FinancialJobRow,
  type FinancialsOverview,
} from "@/app/actions/financials";
import {
  FinancialsTabs,
  HIDE_MONEY_CLASS,
  HideMoneyToggle,
  useHideMoney,
  usd,
} from "./financials-shared";

function marginTone(marginPct: number, profitCents: number) {
  if (profitCents < 0) return "rose" as const;
  if (marginPct < 0.15) return "amber" as const;
  return "emerald" as const;
}

export function FinancialsClient() {
  const [ov, setOv] = useState<FinancialsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideMoney, toggleHideMoney] = useHideMoney();

  const refresh = useCallback(async () => {
    const next = await getFinancialsOverview();
    setOv(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFinancialsOverview().then((next) => {
      if (cancelled) return;
      setOv(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const netMtd = ov ? ov.profitMtdCents - ov.monthlyOverheadCents : 0;

  return (
    <div className={cn("space-y-6", hideMoney && HIDE_MONEY_CLASS)}>
      <div className="flex items-center justify-between gap-2">
        <FinancialsTabs active="overview" />
        <HideMoneyToggle hidden={hideMoney} onToggle={toggleHideMoney} />
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          loading={loading}
          label="Collected · MTD"
          value={ov ? usd(ov.collectedMtdCents) : "—"}
          footnote="Payments recorded this month"
        />
        <StatTile
          index={1}
          loading={loading}
          label="Job profit · MTD"
          value={ov ? usd(ov.profitMtdCents) : "—"}
          footnote="From jobs finished this month"
        />
        <StatTile
          index={2}
          loading={loading}
          label="Monthly overhead"
          value={ov ? usd(ov.monthlyOverheadCents) : "—"}
          footnote="Yearly costs counted at 1/12"
        />
        <StatTile
          index={3}
          loading={loading}
          label="Net · MTD"
          value={ov ? usd(netMtd) : "—"}
          delta={
            ov
              ? { text: netMtd >= 0 ? "in the black" : "below break-even", positive: netMtd >= 0 }
              : undefined
          }
          footnote="Job profit minus overhead"
        />
      </div>

      {ov && ov.pendingExpenses.length > 0 && (
        <PendingExpenses ov={ov} onDone={refresh} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <CoverageCard ov={ov} />
          <SetupSummaryCard ov={ov} loading={loading} />
        </div>
        <JobsCard ov={ov} loading={loading} onChanged={refresh} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pending worker expenses — the review strip                         */
/* ------------------------------------------------------------------ */

function PendingExpenses({
  ov,
  onDone,
}: {
  ov: FinancialsOverview;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(id: string, decision: "approve" | "decline") {
    setBusy(id + decision);
    await decideJobExpense(id, decision);
    await onDone();
    setBusy(null);
  }
  return (
    <div className="anim-enter rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <HardHat className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-semibold text-amber-900">
          Crew expenses waiting on you
        </span>
        <Badge tone="amber">{ov.pendingExpenses.length}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        {ov.pendingExpenses.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200/70 bg-white px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-zinc-900">{e.label}</span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {usd(e.amountCents)}
                </span>
                <span className="text-xs text-zinc-500">
                  {e.workerName ?? "Crew"} · {e.jobLabel}
                </span>
              </div>
              {e.note && (
                <p className="mt-0.5 truncate text-xs text-zinc-500">{e.note}</p>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide(e.id, "decline")}
                disabled={busy !== null}
              >
                {busy === e.id + "decline" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Decline
              </Button>
              <Button
                size="sm"
                onClick={() => decide(e.id, "approve")}
                disabled={busy !== null}
              >
                {busy === e.id + "approve" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Approve
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Coverage meter + link to the setup page                            */
/* ------------------------------------------------------------------ */

function CoverageCard({ ov }: { ov: FinancialsOverview | null }) {
  const cov = ov?.coverage;
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="microlabel">Overhead coverage · this month</div>
        {cov &&
          (cov.overheadCents === 0 ? (
            <Badge tone="neutral">No overhead set</Badge>
          ) : cov.covered ? (
            <Badge tone="emerald">
              <CircleCheckBig className="h-3.5 w-3.5" /> Overhead covered
            </Badge>
          ) : (
            <Badge tone="amber">{usd(cov.gapCents)} to go</Badge>
          ))}
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={cn(
            "anim-grow-x h-full rounded-full transition-smooth",
            cov?.covered ? "bg-emerald-500" : "bg-accent-600",
          )}
          style={{ width: `${Math.round((cov?.pct ?? 0) * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs text-zinc-500">
        <span>
          <span className="font-semibold tabular-nums text-zinc-900">
            {ov ? usd(ov.profitMtdCents) : "—"}
          </span>{" "}
          earned of{" "}
          <span className="tabular-nums">
            {ov ? usd(ov.monthlyOverheadCents) : "—"}
          </span>{" "}
          bills
        </span>
        {cov?.covered && cov.overheadCents > 0 && (
          <span className="font-medium text-emerald-700">
            +{usd(cov.surplusCents)} pure profit
          </span>
        )}
      </div>
      {ov && ov.pipelineProfitCents > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          {usd(ov.pipelineProfitCents)} more projected in jobs still running.
        </p>
      )}
    </div>
  );
}

/**
 * Compact read-only recap of what's configured on the setup page —
 * overhead total, crew/sales cut, break-even — with the link over. The
 * editing itself lives on /dashboard/financials/setup so the overview
 * stays about this month's numbers.
 */
function SetupSummaryCard({
  ov,
  loading,
}: {
  ov: FinancialsOverview | null;
  loading: boolean;
}) {
  if (loading || !ov) {
    return (
      <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
        <div className="skeleton h-3 w-28" />
        <div className="skeleton mt-3 h-16 w-full rounded-xl" />
      </div>
    );
  }

  const configured =
    ov.overhead.length > 0 ||
    ov.settings.crewPct > 0 ||
    ov.settings.salesPct > 0;
  const plan = profitPlan({
    revenueCents: ov.revenueMtdCents,
    monthlyOverheadCents: ov.monthlyOverheadCents,
    crewPct: ov.settings.crewPct,
    salesPct: ov.settings.salesPct,
  });

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="microlabel flex items-center gap-1.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-accent-600" />
        Overhead & profit setup
      </div>

      {configured ? (
        <>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-zinc-500">
                Overhead · {ov.overhead.length}{" "}
                {ov.overhead.length === 1 ? "cost" : "costs"}
              </span>
              <span className="font-medium tabular-nums text-zinc-900">
                {usd(ov.monthlyOverheadCents)}/mo
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-zinc-500">Crew pay</span>
              <span className="font-medium tabular-nums text-zinc-900">
                {Math.round(ov.settings.crewPct)}% of revenue
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-zinc-500">Sales commission</span>
              <span className="font-medium tabular-nums text-zinc-900">
                {Math.round(ov.settings.salesPct)}% of revenue
              </span>
            </div>
            {plan.breakEvenRevenueCents !== null &&
              plan.breakEvenRevenueCents > 0 && (
                <div className="flex items-baseline justify-between border-t border-zinc-100 pt-2">
                  <span className="text-zinc-500">Break-even revenue</span>
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {usd(plan.breakEvenRevenueCents)}/mo
                  </span>
                </div>
              )}
          </div>
          <Link
            href="/dashboard/financials/setup"
            className="ring-focus mt-3 inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 transition-smooth hover:text-accent-900"
          >
            Adjust overhead & percentages →
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-zinc-500">
            Add your recurring bills and set the crew / sales cut so the
            coverage meter and profit planner reflect your real business.
          </p>
          <Link
            href="/dashboard/financials/setup"
            className="ring-focus active:scale-[0.98] mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white shadow-card transition-smooth hover:bg-accent-500"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Set it up
          </Link>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Jobs profit table                                                  */
/* ------------------------------------------------------------------ */

function JobsCard({
  ov,
  loading,
  onChanged,
}: {
  ov: FinancialsOverview | null;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="microlabel">Profit per job</div>
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
          <Sparkles className="h-3 w-3 text-accent-500" />
          AI cost estimate — tap to correct it
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {loading && (
          <>
            <div className="skeleton h-20 w-full rounded-xl" />
            <div className="skeleton h-20 w-full rounded-xl" />
          </>
        )}
        {ov?.jobs.map((j) => (
          <JobRow key={j.proposalId} job={j} onChanged={onChanged} />
        ))}
        {ov && ov.jobs.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400">
            Accepted jobs land here with their live profit. Win one and watch
            the meter fill.
          </p>
        )}
      </div>
    </div>
  );
}

function JobRow({
  job,
  onChanged,
}: {
  job: FinancialJobRow;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const tone = marginTone(job.marginPct, job.profitCents);

  return (
    <div className="rounded-xl border border-zinc-200 transition-smooth hover:border-zinc-300">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ring-focus flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900">
              {job.clientName || job.address}
            </span>
            {job.stage === "done" ? (
              <Badge tone="emerald">Done</Badge>
            ) : (
              <Badge tone="sky">In progress</Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">
            {job.address}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Contract
          </div>
          <div className="text-sm font-medium tabular-nums text-zinc-900">
            {usd(job.contractCents)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Your profit
          </div>
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              tone === "rose"
                ? "text-rose-600"
                : tone === "amber"
                  ? "text-amber-700"
                  : "text-emerald-700",
            )}
          >
            {usd(job.profitCents)}
            <span className="ml-1 text-[11px] font-medium text-zinc-400">
              {Math.round(job.marginPct * 100)}%
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="anim-enter-fade space-y-3 border-t border-zinc-100 px-4 py-3">
          <CostBasisEditor job={job} onChanged={onChanged} />
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <CostCell label="Crew pay" value={usd(job.workerPayCents)} />
            <CostCell label="Extra expenses" value={usd(job.approvedExtraCents)} />
            <CostCell label="Collected so far" value={usd(job.paidCents)} />
          </div>
          <ExpensesList job={job} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function CostCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-zinc-900">
        {value}
      </div>
    </div>
  );
}

/** The AI-vs-manual switch for a job's materials+labor cost basis. */
function CostBasisEditor({
  job,
  onChanged,
}: {
  job: FinancialJobRow;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const usingManual = job.manualCostCents != null;

  async function commit() {
    const dollars = parseFloat(value);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    await setJobManualCost(job.proposalId, dollars);
    await onChanged();
    setBusy(false);
    setEditing(false);
  }
  async function resetToAi() {
    setBusy(true);
    await setJobManualCost(job.proposalId, null);
    await onChanged();
    setBusy(false);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
        usingManual
          ? "border-zinc-300 bg-white"
          : "border-accent-200 bg-accent-50/50",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600">
        {usingManual ? (
          <PencilLine className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-accent-600" />
        )}
        Materials + labor cost
        <Badge tone={usingManual ? "neutral" : "accent"}>
          {usingManual ? "your number" : "AI estimate"}
        </Badge>
      </span>
      <span className="flex-1" />
      {editing ? (
        <span className="flex items-center gap-1.5">
          <span className="text-sm text-zinc-400">$</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            inputMode="decimal"
            className="input h-8 w-24 text-right text-sm tabular-nums"
          />
          <Button size="sm" onClick={commit} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-zinc-900">
            {usd(job.manualCostCents ?? job.aiCostCents)}
          </span>
          {usingManual && (
            <span className="text-[11px] text-zinc-400 line-through tabular-nums">
              {usd(job.aiCostCents)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setValue(((job.manualCostCents ?? job.aiCostCents) / 100).toFixed(0));
              setEditing(true);
            }}
            className="ring-focus rounded-md p-1 text-zinc-400 transition-smooth hover:bg-zinc-100 hover:text-zinc-700"
            title="Correct this cost"
          >
            <PencilLine className="h-3.5 w-3.5" />
          </button>
          {usingManual && (
            <button
              type="button"
              onClick={resetToAi}
              disabled={busy}
              className="ring-focus rounded-md p-1 text-zinc-400 transition-smooth hover:bg-accent-50 hover:text-accent-700"
              title="Back to the AI estimate"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function ExpensesList({
  job,
  onChanged,
}: {
  job: FinancialJobRow;
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    setBusy("add");
    const r = await addJobExpense(
      job.proposalId,
      label,
      Math.round(parseFloat(amount) * 100),
    );
    if (!r.ok) {
      setErr(r.reason);
      setBusy(null);
      return;
    }
    setLabel("");
    setAmount("");
    await onChanged();
    setBusy(null);
  }
  async function remove(id: string) {
    setBusy(id);
    await deleteJobExpense(id);
    await onChanged();
    setBusy(null);
  }
  async function decide(id: string, decision: "approve" | "decline") {
    setBusy(id);
    await decideJobExpense(id, decision);
    await onChanged();
    setBusy(null);
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        <Receipt className="h-3 w-3" /> Job expenses
      </div>
      <div className="mt-1.5 space-y-1.5">
        {job.expenses.map((e) => (
          <div
            key={e.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              e.status === "PENDING"
                ? "border-amber-200 bg-amber-50/50"
                : e.status === "DECLINED"
                  ? "border-zinc-200 bg-zinc-50 opacity-60"
                  : "border-zinc-200 bg-white",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-zinc-800">
              {e.label}
              {e.source === "WORKER" && (
                <span className="ml-1.5 text-zinc-400">
                  · {e.workerName ?? "crew"}
                </span>
              )}
            </span>
            <span className="font-medium tabular-nums text-zinc-900">
              {usd(e.amountCents)}
            </span>
            {e.status === "PENDING" ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => decide(e.id, "decline")}
                  disabled={busy !== null}
                  className="ring-focus rounded-md p-1 text-zinc-400 transition-smooth hover:bg-rose-50 hover:text-rose-600"
                  title="Decline"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => decide(e.id, "approve")}
                  disabled={busy !== null}
                  className="ring-focus rounded-md p-1 text-emerald-600 transition-smooth hover:bg-emerald-50"
                  title="Approve"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : e.status === "DECLINED" ? (
              <Badge tone="neutral">declined</Badge>
            ) : (
              <button
                type="button"
                onClick={() => remove(e.id)}
                disabled={busy !== null}
                className="ring-focus rounded-md p-1 text-zinc-300 transition-smooth hover:bg-rose-50 hover:text-rose-600"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add expense — dump fee, extra materials…"
          className="input h-8 min-w-0 flex-1 text-xs"
        />
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="input h-8 w-20 pl-5 text-right text-xs tabular-nums"
          />
        </div>
        <Button size="sm" variant="outline" onClick={add} disabled={busy === "add"}>
          {busy === "add" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
