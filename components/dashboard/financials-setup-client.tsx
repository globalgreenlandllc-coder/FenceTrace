"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, PieChart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { profitPlan } from "@/lib/job-costing";
import {
  addOverheadItem,
  deleteOverheadItem,
  getFinancialsOverview,
  saveFinancialSettings,
  type FinancialsOverview,
} from "@/app/actions/financials";
import {
  FinancialsTabs,
  HIDE_MONEY_CLASS,
  HideMoneyToggle,
  useHideMoney,
  usd,
} from "./financials-shared";

/**
 * /dashboard/financials/setup — the configuration side of the money OS,
 * split out of the overview so day-to-day numbers and one-time setup
 * don't crowd each other: the recurring-overhead list on the left, the
 * crew % / sales % profit planner on the right. The overview page reads
 * the same data and links here.
 */
export function FinancialsSetupClient() {
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

  return (
    <div className={cn("space-y-6", hideMoney && HIDE_MONEY_CLASS)}>
      <div className="flex items-center justify-between gap-2">
        <FinancialsTabs active="setup" />
        <HideMoneyToggle hidden={hideMoney} onToggle={toggleHideMoney} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OverheadCard ov={ov} loading={loading} onChanged={refresh} />
        <ProfitPlannerCard ov={ov} loading={loading} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Overhead editor                                                    */
/* ------------------------------------------------------------------ */

/** One-tap starters for the usual business bills — tap fills the label,
 *  the contractor types the amount. Already-added labels drop out. */
const OVERHEAD_PRESETS = [
  "Office / shop rent",
  "Insurance",
  "Software & billing",
  "Truck & fuel",
  "Marketing / ads",
  "Savings fund",
  "Phone & internet",
];

function OverheadCard({
  ov,
  loading,
  onChanged,
}: {
  ov: FinancialsOverview | null;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const dollars = parseFloat(amount);
    setErr(null);
    setBusy(true);
    const r = await addOverheadItem(label, Math.round(dollars * 100), cadence);
    if (!r.ok) {
      setErr(r.reason);
      setBusy(false);
      return;
    }
    setLabel("");
    setAmount("");
    await onChanged();
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="microlabel">Monthly overhead</div>
        {ov && ov.overhead.length > 0 && (
          <span className="text-xs text-zinc-500">
            <span className="font-semibold tabular-nums text-zinc-900">
              {usd(ov.monthlyOverheadCents)}
            </span>
            /mo total
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Truck, insurance, software, shop rent — the bills your jobs have to
        pay before anything is profit. This total drives the coverage meter
        on the overview and the planner beside it.
      </p>
      <div className="mt-3 space-y-2">
        {loading && (
          <>
            <div className="skeleton h-9 w-full rounded-lg" />
            <div className="skeleton h-9 w-full rounded-lg" />
          </>
        )}
        {ov?.overhead.map((o) => (
          <OverheadRow key={o.id} item={o} onChanged={onChanged} />
        ))}
        {ov && ov.overhead.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">
            No overhead yet — add your first recurring cost below.
          </p>
        )}
      </div>

      {/* Add row */}
      <div className="mt-3 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/40 p-3">
        <div className="flex flex-wrap gap-1.5">
          {OVERHEAD_PRESETS.filter(
            (p) => !ov?.overhead.some((o) => o.label === p),
          ).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setLabel(p)}
              className="ring-focus active:scale-[0.98] rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 transition-smooth hover:border-accent-400 hover:text-accent-700"
            >
              + {p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Truck lease"
            className="input h-9 min-w-0 flex-1 text-sm"
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="input h-9 w-24 pl-6 text-right text-sm tabular-nums"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {(["MONTHLY", "YEARLY"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCadence(c)}
                className={cn(
                  "ring-focus rounded-full px-2.5 py-1 text-[11px] font-medium transition-smooth",
                  cadence === c
                    ? "bg-accent-600 text-white shadow-sm"
                    : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50",
                )}
              >
                {c === "MONTHLY" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={add} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </div>
    </div>
  );
}

function OverheadRow({
  item,
  onChanged,
}: {
  item: {
    id: string;
    label: string;
    amountCents: number;
    cadence: "MONTHLY" | "YEARLY";
  };
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    await deleteOverheadItem(item.id);
    await onChanged();
  }
  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-smooth",
        busy && "opacity-50",
      )}
    >
      <span className="min-w-0 truncate text-zinc-800">{item.label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-medium tabular-nums text-zinc-900">
          {usd(item.amountCents)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          /{item.cadence === "MONTHLY" ? "mo" : "yr"}
        </span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="Remove"
          className="ring-focus rounded-md p-1 text-zinc-300 transition-smooth hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profit planner — crew % + sales % + overhead → what's left is you  */
/* ------------------------------------------------------------------ */

function ProfitPlannerCard({
  ov,
  loading,
}: {
  ov: FinancialsOverview | null;
  loading: boolean;
}) {
  const [crewPct, setCrewPct] = useState(0);
  const [salesPct, setSalesPct] = useState(0);
  /** What-if monthly revenue, in dollars (string so the field can be
   *  cleared while typing). Prefilled from this month's finished jobs. */
  const [revenue, setRevenue] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const hydrated = useRef(false);
  const lastSaved = useRef<{ crew: number; sales: number } | null>(null);

  useEffect(() => {
    if (!ov || hydrated.current) return;
    hydrated.current = true;
    setCrewPct(ov.settings.crewPct);
    setSalesPct(ov.settings.salesPct);
    lastSaved.current = {
      crew: ov.settings.crewPct,
      sales: ov.settings.salesPct,
    };
    if (ov.revenueMtdCents > 0)
      setRevenue(String(Math.round(ov.revenueMtdCents / 100)));
  }, [ov]);

  // Debounced autosave — the sliders feel live, the DB writes settle.
  useEffect(() => {
    if (!hydrated.current || !lastSaved.current) return;
    if (
      lastSaved.current.crew === crewPct &&
      lastSaved.current.sales === salesPct
    )
      return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await saveFinancialSettings({ crewPct, salesPct });
      if (r.ok) {
        lastSaved.current = { crew: crewPct, sales: salesPct };
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [crewPct, salesPct]);

  if (loading || !ov) {
    return (
      <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-3 h-32 w-full rounded-xl" />
      </div>
    );
  }

  const revenueCents = Math.max(
    0,
    Math.round((parseFloat(revenue) || 0) * 100),
  );
  const plan = profitPlan({
    revenueCents,
    monthlyOverheadCents: ov.monthlyOverheadCents,
    crewPct,
    salesPct,
  });

  // Bar segments as fractions of revenue. When costs outrun revenue the
  // segments are normalized so the bar stays full instead of overflowing.
  const costs = plan.crewCents + plan.salesCents + plan.overheadCents;
  const scale =
    revenueCents > 0 && costs > revenueCents ? revenueCents / costs : 1;
  const frac = (cents: number) =>
    revenueCents > 0 ? (cents * scale) / revenueCents : 0;
  const segments = [
    { key: "crew", cents: plan.crewCents, className: "bg-accent-600" },
    { key: "sales", cents: plan.salesCents, className: "bg-violet-500" },
    { key: "overhead", cents: plan.overheadCents, className: "bg-amber-500" },
    {
      key: "profit",
      cents: Math.max(0, plan.profitCents),
      className: "bg-emerald-500",
    },
  ];

  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="microlabel flex items-center gap-1.5">
          <PieChart className="h-3.5 w-3.5 text-accent-600" />
          Profit planner
        </div>
        <span className="text-[11px] text-zinc-400">
          {saveState === "saving" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : saveState === "saved" ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-3 w-3" /> Saved
            </span>
          ) : null}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Split every revenue dollar — the crew and your salesperson get their
        cut, the bills get paid, the rest is yours. Slide to adjust; it all
        recalculates live.
      </p>

      {/* What-if monthly revenue */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-700">
          Monthly revenue
        </span>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
            $
          </span>
          <input
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            inputMode="decimal"
            placeholder="20000"
            className="input h-9 w-28 pl-6 text-right text-sm tabular-nums"
          />
        </div>
      </div>
      {ov.revenueMtdCents > 0 && (
        <p className="mt-1 text-right text-[11px] text-zinc-400">
          Prefilled from jobs finished this month — type any number to plan.
        </p>
      )}

      {/* Split bar */}
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        {revenueCents > 0 &&
          segments.map(
            (s) =>
              s.cents > 0 && (
                <div
                  key={s.key}
                  className={cn("h-full transition-smooth", s.className)}
                  style={{ width: `${frac(s.cents) * 100}%` }}
                />
              ),
          )}
      </div>

      {/* Sliders + legend */}
      <div className="mt-4 space-y-4">
        <PctSliderRow
          label="Crew pay"
          dotClass="bg-accent-600"
          pct={crewPct}
          onPct={setCrewPct}
          amountCents={plan.crewCents}
          hint="Typical install crews run 25–35% of the job."
        />
        <PctSliderRow
          label="Sales commission"
          dotClass="bg-violet-500"
          pct={salesPct}
          onPct={setSalesPct}
          amountCents={plan.salesCents}
          hint="Selling it yourself? Leave this at 0."
        />
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Overhead (from your list)
          </span>
          <span className="font-medium tabular-nums text-zinc-900">
            {usd(plan.overheadCents)}
          </span>
        </div>
      </div>

      {/* The bottom line */}
      <div
        className={cn(
          "mt-4 flex items-baseline justify-between rounded-xl border px-3 py-2.5",
          plan.profitCents >= 0
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-rose-200 bg-rose-50/60",
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              plan.profitCents >= 0 ? "bg-emerald-500" : "bg-rose-500",
            )}
          />
          Your profit
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            plan.profitCents >= 0 ? "text-emerald-700" : "text-rose-600",
          )}
        >
          {usd(plan.profitCents)}
          {revenueCents > 0 && (
            <span className="ml-1.5 text-[11px] font-medium text-zinc-400">
              {Math.round(plan.profitPct * 100)}% of revenue
            </span>
          )}
        </span>
      </div>

      {plan.breakEvenRevenueCents === null ? (
        <p className="mt-2 text-[11px] font-medium text-rose-600">
          Crew + sales take every dollar — nothing is left for overhead or
          profit at these percentages.
        </p>
      ) : plan.breakEvenRevenueCents > 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">
          Break-even:{" "}
          <span className="font-medium tabular-nums text-zinc-600">
            {usd(plan.breakEvenRevenueCents)}
          </span>{" "}
          of revenue a month covers crew, sales, and every bill.
        </p>
      ) : null}
    </div>
  );
}

function PctSliderRow({
  label,
  dotClass,
  pct,
  onPct,
  amountCents,
  hint,
}: {
  label: string;
  dotClass: string;
  pct: number;
  onPct: (next: number) => void;
  amountCents: number;
  hint?: string;
}) {
  const clamp = (v: number) =>
    Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
          <span className={cn("h-2 w-2 rounded-full", dotClass)} />
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(pct * 10) / 10}
            onChange={(e) => onPct(clamp(parseFloat(e.target.value)))}
            aria-label={`${label} percentage`}
            className="input h-7 w-14 text-right text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-zinc-400">%</span>
          <span className="w-16 text-right font-medium tabular-nums text-zinc-900">
            {usd(amountCents)}
          </span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onPct(clamp(parseFloat(e.target.value)))}
        aria-label={`${label} percentage slider`}
        className="mt-1.5 w-full accent-accent-600"
      />
      {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}
