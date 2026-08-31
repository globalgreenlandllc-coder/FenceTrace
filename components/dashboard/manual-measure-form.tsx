"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Hammer,
  Home,
  Loader2,
  Mail,
  Wrench,
  MapPin,
  Minus,
  PenLine,
  Plus,
  Ruler,
  Save,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blankProposal,
  packageTotal,
  type Package,
  type Proposal,
} from "@/lib/proposal-mock";
import type { LineItem, Measurements, Stories } from "@/lib/types";
import { saveProposalDraft } from "@/app/actions/proposals";
import { getMyProposalDefaults } from "@/app/actions/proposal-defaults";
import { MaterialsBuilder } from "@/components/proposal/materials-builder";
import { PackagesSection } from "@/components/proposal/packages-section";
import { SendModal } from "@/components/proposal/send-modal";
import { useProfile } from "@/lib/auth-mock";

type JobType = "replacement" | "new";

/** The parts a fence job actually grows — picking one fills the row
 *  (name, unit, labor/material) so typing is only for the odd case.
 *  No platform prices exist per part (pricing is per-LF composite), so
 *  the price is the contractor's — remembered per part after first use. */
const EXTRA_PARTS: {
  id: string;
  name: string;
  unit: string;
  kind: "material" | "labor";
}[] = [
  { id: "post-wood", name: "Posts — 4×4 pressure-treated", unit: "post", kind: "material" },
  { id: "post-steel", name: "Posts — galvanized steel", unit: "post", kind: "material" },
  { id: "concrete", name: "Concrete — 60 lb bags", unit: "bag", kind: "material" },
  { id: "pickets", name: "Pickets", unit: "ea", kind: "material" },
  { id: "rails", name: "Rails — 2×4", unit: "ea", kind: "material" },
  { id: "caps", name: "Post caps", unit: "ea", kind: "material" },
  { id: "gate-kit", name: "Gate kit", unit: "ea", kind: "material" },
  { id: "hardware", name: "Hinges & latch set", unit: "set", kind: "material" },
  { id: "stain", name: "Stain & seal", unit: "LF", kind: "material" },
  { id: "tearout", name: "Tear-out & haul away", unit: "LF", kind: "labor" },
  { id: "dump", name: "Dump fee", unit: "load", kind: "labor" },
  { id: "rocky", name: "Digging — rocky ground", unit: "post", kind: "labor" },
  { id: "labor-hr", name: "Extra labor", unit: "hr", kind: "labor" },
  { id: "permit", name: "Permit & inspection", unit: "ea", kind: "labor" },
];

const PART_PRICES_KEY = "fencescan.extraPartPrices";
function readPartPrices(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(PART_PRICES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function rememberPartPrice(partId: string, price: number) {
  try {
    const all = readPartPrices();
    all[partId] = price;
    window.localStorage.setItem(PART_PRICES_KEY, JSON.stringify(all));
  } catch {
    // private mode — the convenience just doesn't stick
  }
}
type EntryMode = "runs" | "total";
type Step = "measure" | "review";

const MICROLABEL =
  "font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

/** Gates aren't a per-footage rule like gutter drops were — nearly every
 *  yard wants exactly one walk gate until told otherwise. */
function suggestDownspouts(mode: EntryMode, runs: number[], eaveLF: number) {
  void mode;
  void runs;
  return eaveLF > 0 ? 1 : 0;
}

/** Every run has 2 open ends; each mitered corner joins 2 run ends, so
 *  caps = 2×runs − 2×corners (floored — over-entered corners just mean
 *  a fully wrapped system with no caps). Total-only mode can't know the
 *  run count, so default to one straight run = 2 caps. */
function suggestEndCaps(
  mode: EntryMode,
  runs: number[],
  eaveLF: number,
  corners: number,
) {
  if (eaveLF <= 0) return 0;
  if (mode === "runs" && runs.length > 0) {
    return Math.max(0, runs.length * 2 - corners * 2);
  }
  return Math.max(0, 2 - corners * 2);
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/* ------------------------------------------------------------------ */
/*  ManualMeasureForm — /dashboard/measure                             */
/*                                                                     */
/*  A fully self-contained manual proposal flow, deliberately separate */
/*  from the AI-takeoff /proposal builder. For jobs with no plans and  */
/*  no scannable address: the contractor walked the site with a tape   */
/*  measure.                                                           */
/*                                                                     */
/*  Step 1 (Measure): type each fence run (or one total); gates and    */
/*  end posts suggest themselves from field rules of thumb; all three  */
/*  packages price live in the sticky summary.                         */
/*                                                                     */
/*  Step 2 (Review & send): the REAL package editor — the same         */
/*  PackagesSection + MaterialsBuilder the proposal builder uses, so   */
/*  every tier is fully buildable here: rename it, tap the price to    */
/*  set a target, toggle add-ons, and open Edit materials & spec for   */
/*  the material/style/color, accessories, highlight bullets, BOM      */
/*  overrides and custom lines. Then client info and                   */
/*  Save draft (saveProposalDraft) or Send (SendModal → sendProposal)  */
/*  — right here, without visiting /proposal. Both are keyed on the    */
/*  same proposal token so save-then-send updates one row instead of   */
/*  creating two.                                                      */
/* ------------------------------------------------------------------ */
export function ManualMeasureForm() {
  const reduce = useReducedMotion();
  const profile = useProfile();

  const [step, setStep] = useState<Step>("measure");

  const [address, setAddress] = useState("");
  const [jobType, setJobType] = useState<JobType>("replacement");

  const [mode, setMode] = useState<EntryMode>("runs");
  const [runs, setRuns] = useState<number[]>([]);
  const [runInput, setRunInput] = useState("");
  const [totalInput, setTotalInput] = useState("");
  const runInputRef = useRef<HTMLInputElement>(null);

  const [stories, setStories] = useState<Stories>(1);
  const [outsideCorners, setOutsideCorners] = useState(0);
  const [insideCorners, setInsideCorners] = useState(0);
  // null = follow the live suggestion; a number = contractor override.
  const [downspoutOverride, setDownspoutOverride] = useState<number | null>(
    null,
  );
  const [endCapOverride, setEndCapOverride] = useState<number | null>(null);
  const [wasteFactorPct, setWasteFactorPct] = useState(10);

  // Review step
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  // Stable template: token, terms, intro. Created once so the proposal
  // token never changes across renders — save + send both key the DB
  // row off it.
  const [base] = useState<Proposal>(() => blankProposal());
  // What the client sees on the portal: one total vs materials+labor
  // split — set from the BOM drawer, saved on the proposal blob.
  const [priceDisplay, setPriceDisplay] = useState<
    "totals" | "split" | "itemized"
  >(base.priceDisplay ?? "totals");
  // The contractor's saved boilerplate (Settings → Proposal terms):
  // their terms replace the platform samples on this draft, and their
  // display default seeds the toggle above — both before first edit.
  const [defaultTerms, setDefaultTerms] = useState<Proposal["terms"] | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    getMyProposalDefaults()
      .then((d) => {
        if (!alive) return;
        if (d.customized) setDefaultTerms(d.terms);
        setPriceDisplay(d.priceDisplay);
      })
      .catch(() => undefined); // platform samples, never a blocker
    return () => {
      alive = false;
    };
  }, []);
  // The three tiers, fully owned by this flow as live state so the
  // PackagesSection + MaterialsBuilder editors can rebuild each one
  // (name, price/markup, config, highlights, add-ons, BOM overrides).
  // Seeded from the template with the replacement tear-off default
  // (matches the initial jobType).
  const [pkgs, setPkgs] = useState<Package[]>(() =>
    base.packages.map((p) => ({
      ...p,
      config: { ...p.config, oldGutterRemoval: "free" as const },
    })),
  );
  // Extra work — free-form labor & material lines entered in the
  // measure step. They fan into every tier's customLineItems, so the
  // totals, tax split, client breakdown and scope sheet all price them
  // through the same pipe as everything else. Ids are prefixed so the
  // per-tier materials builder can still add ITS own custom lines
  // without this card stomping them.
  const [extras, setExtras] = useState<LineItem[]>([]);
  const [xPart, setXPart] = useState("custom");
  const [xName, setXName] = useState("");
  const [xKind, setXKind] = useState<"material" | "labor">("labor");
  const [xQty, setXQty] = useState("");
  const [xUnit, setXUnit] = useState("LF");
  const [xPrice, setXPrice] = useState("");
  const xSeq = useRef(0);
  useEffect(() => {
    setPkgs((prev) =>
      prev.map((p) => ({
        ...p,
        customLineItems: [
          ...(p.customLineItems ?? []).filter((i) => !i.id.startsWith("xtra-")),
          ...extras,
        ],
      })),
    );
  }, [extras]);

  function addExtra(preset?: Partial<LineItem> & { kind?: "material" | "labor" }) {
    const name = (preset?.name ?? xName).trim();
    const qty = preset?.quantity ?? Math.max(0, Number(xQty) || 0);
    const unitPrice = preset?.unitPrice ?? Math.max(0, Number(xPrice) || 0);
    const unit = preset?.unit ?? xUnit;
    const taxable = preset ? preset.kind === "material" : xKind === "material";
    if (!name || qty <= 0 || unitPrice <= 0) return;
    xSeq.current += 1;
    setExtras((prev) => [
      ...prev,
      { id: `xtra-${xSeq.current}-${name.slice(0, 12)}`, name, quantity: qty, unit, unitPrice, taxable },
    ]);
    if (!preset) {
      if (xPart !== "custom") rememberPartPrice(xPart, unitPrice);
      setXPart("custom");
      setXName("");
      setXQty("");
      setXPrice("");
    }
  }

  /** Part picked → the row fills itself; price comes from memory when
   *  this part was ever priced before (still editable). */
  function pickPart(id: string) {
    setXPart(id);
    if (id === "custom") {
      setXName("");
      return;
    }
    const part = EXTRA_PARTS.find((x) => x.id === id);
    if (!part) return;
    setXName(part.name);
    setXUnit(part.unit);
    setXKind(part.kind);
    const remembered = readPartPrices()[id];
    if (remembered > 0) setXPrice(String(remembered));
  }
  const extrasTotal = extras.reduce((a, i) => a + i.quantity * i.unitPrice, 0);

  // Package whose MaterialsBuilder drawer is open (null = closed).
  const [materialsEditId, setMaterialsEditId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eaveLF =
    mode === "runs"
      ? Math.round(runs.reduce((a, b) => a + b, 0))
      : Math.max(0, Math.round(Number(totalInput) || 0));

  const corners = outsideCorners + insideCorners;
  const suggestedDownspouts = suggestDownspouts(mode, runs, eaveLF);
  const suggestedEndCaps = suggestEndCaps(mode, runs, eaveLF, corners);
  const downspoutCount = downspoutOverride ?? suggestedDownspouts;
  const endCaps = endCapOverride ?? suggestedEndCaps;

  const measurements: Measurements = {
    eaveLF,
    rakeLF: 0,
    outsideCorners,
    insideCorners,
    endCaps,
    downspoutCount,
    stories,
    wasteFactorPct,
  };

  // Job type owns the tear-off default (same rule the AI flows apply
  // server-side): replacement = FREE removal line, new build = none.
  // Applied across all tiers; per-tier fine-tuning stays available in
  // the materials builder afterwards.
  function changeJobType(next: JobType) {
    setJobType(next);
    setPkgs((prev) =>
      prev.map((p) => ({
        ...p,
        config: {
          ...p.config,
          oldGutterRemoval: next === "new" ? "none" : "free",
        },
      })),
    );
  }

  // The full proposal blob this flow owns. Rebuilt per render (cheap) —
  // PackagesSection edits flow back via setPkgs, saveProposalDraft
  // persists it verbatim and SendModal/sendProposal consume it directly.
  // `jobType` rides along as the same ad-hoc data key the estimate flow
  // stores.
  // The measured facts must land INSIDE each fence package config — that
  // is what buildFenceLineItems prices. Without this overlay every manual
  // proposal would bill the sample config's 1 gate / 2 corners forever.
  const pkgsWithFence = pkgs.map((p) =>
    p.config.fence
      ? {
          ...p,
          config: {
            ...p.config,
            fence: {
              ...p.config.fence,
              gatesSingle: downspoutCount,
              gatesDouble: 0,
              corners: outsideCorners + insideCorners,
              ends: endCaps,
              removalLf: jobType === "replacement" ? eaveLF : 0,
            },
          },
        }
      : p,
  );

  const proposal: Proposal & { jobType: JobType } = {
    ...base,
    ...(defaultTerms ? { terms: defaultTerms } : {}),
    address: address.trim(),
    client: { name: clientName.trim(), email: clientEmail.trim() },
    contractor: {
      name: profile.contractorName,
      company: profile.company,
      phone: profile.phone,
      email: profile.email,
      license: profile.license,
      stripePaymentUrl: profile.payments.stripeUrl ?? null,
      squarePaymentUrl: profile.payments.squareUrl ?? null,
      logo: { ...profile.logo },
    },
    measurements,
    priceDisplay,
    packages: pkgsWithFence,
    source: "manual",
    jobType,
  };

  const tiers = useMemo(() => {
    if (eaveLF <= 0) return [];
    return pkgsWithFence.map((p) => ({
      id: p.id,
      name: p.name,
      recommended: !!p.recommended,
      total: packageTotal(p, measurements, 0).total,
    }));
    // measurements is rebuilt every render; list its scalars instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pkgs,
    jobType,
    eaveLF,
    downspoutCount,
    outsideCorners,
    insideCorners,
    endCaps,
    stories,
    wasteFactorPct,
  ]);

  function addRun() {
    const v = Number(runInput);
    if (!Number.isFinite(v) || v <= 0) return;
    setRuns((r) => [...r, Math.min(1000, Math.round(v * 10) / 10)]);
    setRunInput("");
    runInputRef.current?.focus();
  }

  function removeRun(i: number) {
    setRuns((r) => r.filter((_, idx) => idx !== i));
  }

  function switchMode(next: EntryMode) {
    if (next === mode) return;
    // Carry the current total across so switching never loses the number.
    if (next === "total" && eaveLF > 0) setTotalInput(String(eaveLF));
    setMode(next);
  }

  const canReview = address.trim().length > 0 && eaveLF > 0;

  async function saveDraft() {
    if (savingDraft) return;
    setSavingDraft(true);
    setError(null);
    const res = await saveProposalDraft({ proposal, proposalId: savedId });
    if (res.ok) {
      setSavedId(res.id);
      setSavedAt(Date.now());
    } else {
      setError(res.reason);
    }
    setSavingDraft(false);
  }

  const enter = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay },
  });

  const materialsPkg = materialsEditId
    ? (pkgs.find((p) => p.id === materialsEditId) ?? null)
    : null;

  return (
    <div className="mt-4 space-y-4">
      <div className={cn(MICROLABEL, "anim-enter-fade text-zinc-400")}>
        {step === "measure"
          ? "Step 1 of 2 — Measurements"
          : "Step 2 of 2 — Build packages & send"}
      </div>

      {/* -------- Packages (review step, full width) --------
          The exact same editor surface the /proposal builder uses:
          inline name/tagline edits, tap-the-price targeting, add-on
          checkboxes, Mark popular, and Edit materials & spec → the
          MaterialsBuilder drawer (material/style/color, accessories,
          highlights, BOM overrides, custom lines). */}
      {step === "review" && (
        <motion.div {...enter(0)}>
          <PackagesSection
            proposal={proposal}
            onChange={(p) => setPkgs(p.packages)}
            onEditMaterials={setMaterialsEditId}
          />
        </motion.div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          {step === "measure" ? (
            <>
              {/* -------- Property -------- */}
              <motion.div
                {...enter(0)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                    Property
                  </h2>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div>
                <label
                  htmlFor="manual-address"
                  className={cn(MICROLABEL, "block text-zinc-400")}
                >
                  Property address
                </label>
                <input
                  id="manual-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1247 Maple Ridge Drive, Austin, TX 78704"
                  autoComplete="street-address"
                  className="transition-smooth mt-1.5 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                />
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <span className={cn(MICROLABEL, "text-zinc-400")}>Job</span>
                  <div className="inline-flex rounded-lg border border-zinc-200 p-0.5">
                    {(
                      [
                        {
                          value: "replacement",
                          label: "Replacement",
                          Icon: Hammer,
                        },
                        { value: "new", label: "New construction", Icon: Home },
                      ] as const
                    ).map((opt) => {
                      const active = opt.value === jobType;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => changeJobType(opt.value)}
                          className={cn(
                            "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                            active
                              ? "bg-zinc-100 text-zinc-900"
                              : "text-zinc-500 hover:text-zinc-900",
                          )}
                        >
                          <opt.Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                </div>
              </motion.div>

              {/* -------- Fence runs -------- */}
              <motion.div
                {...enter(0.05)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <Ruler className="h-4 w-4" />
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                    Fence runs
                  </h2>
                  <div className="ml-auto inline-flex rounded-lg border border-zinc-200 p-0.5">
                    {(
                      [
                        { value: "runs", label: "Run by run" },
                        { value: "total", label: "One total" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => switchMode(opt.value)}
                        className={cn(
                          "transition-smooth ring-focus rounded-md px-2.5 py-1 text-xs font-medium",
                          mode === opt.value
                            ? "bg-zinc-100 text-zinc-900"
                            : "text-zinc-500 hover:text-zinc-900",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === "runs" ? (
                  <>
                    <p className="mt-3 text-sm text-zinc-500">
                      Enter each straight fence section as you measured it —
                      Enter adds the run and keeps the cursor ready for the next
                      one. Gates and end posts suggest themselves from the runs.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <div className="relative flex-1">
                        <input
                          ref={runInputRef}
                          value={runInput}
                          onChange={(e) => setRunInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addRun();
                            }
                          }}
                          type="number"
                          min={1}
                          step="0.5"
                          inputMode="decimal"
                          placeholder="Run length"
                          className="transition-smooth h-11 w-full rounded-lg border border-zinc-200 bg-white px-3.5 pr-9 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
                          ft
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={addRun}
                        disabled={!runInput.trim()}
                        className="transition-smooth ring-focus press-scale inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent-600 px-4 text-[13px] font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add run
                      </button>
                    </div>
                    {runs.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {runs.map((r, i) => (
                          <span
                            key={`${r}-${i}`}
                            className="anim-pop inline-flex items-center gap-1 rounded-full bg-accent-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-accent-800 ring-1 ring-accent-200"
                          >
                            {r} ft
                            <button
                              type="button"
                              onClick={() => removeRun(i)}
                              aria-label={`Remove ${r} ft run`}
                              className="transition-smooth rounded-full p-0.5 text-accent-500 hover:bg-accent-100 hover:text-accent-800"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex items-baseline gap-2 border-t border-zinc-100 pt-3">
                      <span className={cn(MICROLABEL, "text-zinc-400")}>
                        Total fence
                      </span>
                      <span className="text-lg font-semibold tabular-nums tracking-tight text-zinc-900">
                        {eaveLF} LF
                      </span>
                      {runs.length > 0 && (
                        <span className="text-xs text-zinc-400">
                          across {runs.length}{" "}
                          {runs.length === 1 ? "run" : "runs"}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-zinc-500">
                      Already summed it up on paper? Enter the total fence
                      footage — you can still fine-tune corners and posts below.
                    </p>
                    <label
                      htmlFor="manual-total-lf"
                      className={cn(MICROLABEL, "mt-4 block text-zinc-400")}
                    >
                      Total fence length
                    </label>
                    <div className="relative mt-1.5 max-w-[220px]">
                      <input
                        id="manual-total-lf"
                        value={totalInput}
                        onChange={(e) => setTotalInput(e.target.value)}
                        type="number"
                        min={1}
                        step="1"
                        inputMode="decimal"
                        placeholder="148"
                        className="transition-smooth h-11 w-full rounded-lg border border-zinc-200 bg-white px-3.5 pr-9 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                      />
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
                        LF
                      </span>
                    </div>
                  </>
                )}
              </motion.div>

              {/* -------- Extra work: labor & materials -------- */}
              <motion.div
                {...enter(0.175)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <Wrench className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                      Extra work — labor &amp; materials
                    </h2>
                    <p className="text-xs text-zinc-500">
                      Anything beyond the fence itself, priced by the unit.
                      Lands on every tier and on the client&apos;s itemized
                      breakdown.
                    </p>
                  </div>
                </div>

                {/* part picker — the row fills itself from the catalog */}
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[240px_minmax(0,1fr)]">
                  <select
                    value={xPart}
                    onChange={(e) => pickPart(e.target.value)}
                    className="input"
                  >
                    <option value="custom">Custom line…</option>
                    <optgroup label="Parts & materials">
                      {EXTRA_PARTS.filter((x) => x.kind === "material").map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Labor & fees">
                      {EXTRA_PARTS.filter((x) => x.kind === "labor").map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="self-center text-[11px] leading-snug text-zinc-400">
                    Pick a part and the name, unit and labor/material type
                    fill in — your price is remembered per part after the
                    first use. Custom stays free-form.
                  </p>
                </div>

                {/* entry row */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_78px_90px_100px_auto]">
                  <input
                    value={xName}
                    onChange={(e) => setXName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addExtra()}
                    placeholder="What's the work? (e.g. Remove old concrete footing)"
                    className="input col-span-2 sm:col-span-1"
                  />
                  <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                    {(["labor", "material"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setXKind(k)}
                        className={cn(
                          "rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize transition-smooth",
                          xKind === k
                            ? "bg-white text-zinc-900 shadow-sm"
                            : "text-zinc-500 hover:text-zinc-800",
                        )}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  <input
                    value={xQty}
                    onChange={(e) => setXQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addExtra()}
                    inputMode="decimal"
                    placeholder="Qty"
                    className="input num-input"
                  />
                  <select
                    value={xUnit}
                    onChange={(e) => setXUnit(e.target.value)}
                    className="input"
                  >
                    {["LF", "sqft", "ea", "set", "hr", "day", "bag", "post", "panel", "load"].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                      $
                    </span>
                    <input
                      value={xPrice}
                      onChange={(e) => setXPrice(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addExtra()}
                      inputMode="decimal"
                      placeholder="/unit"
                      className="input num-input w-full pl-6"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => addExtra()}
                    disabled={!xName.trim() || !(Number(xQty) > 0) || !(Number(xPrice) > 0)}
                    className="transition-smooth ring-focus press-scale inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-accent-600 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>

                {extras.length > 0 && (
                  <ul className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                    {extras.map((it) => (
                      <li
                        key={it.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">
                          {it.name}
                        </span>
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            it.taxable
                              ? "bg-sky-50 text-sky-700"
                              : "bg-amber-50 text-amber-700",
                          )}
                        >
                          {it.taxable ? "material" : "labor"}
                        </span>
                        <span className="tabular-nums text-zinc-500">
                          {it.quantity} {it.unit} × {fmtMoney(it.unitPrice)}
                        </span>
                        <span className="w-24 text-right font-semibold tabular-nums text-zinc-900">
                          {fmtMoney(it.quantity * it.unitPrice)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExtras((prev) => prev.filter((x) => x.id !== it.id))
                          }
                          aria-label={`Remove ${it.name}`}
                          className="ring-focus rounded-md p-1.5 text-zinc-400 transition-smooth hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                    <li className="flex items-center justify-between bg-zinc-50/60 px-3.5 py-2 text-sm">
                      <span className="font-medium text-zinc-600">
                        Extra work total
                      </span>
                      <span className="font-semibold tabular-nums text-zinc-900">
                        {fmtMoney(extrasTotal)}
                      </span>
                    </li>
                  </ul>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                  Labor stays untaxed, materials join the taxable share —
                  same split the client&apos;s breakdown shows. Each tier
                  prices these through its own markup.
                </p>
              </motion.div>

              {/* -------- Corners, posts & waste -------- */}
              <motion.div
                {...enter(0.15)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <PenLine className="h-4 w-4" />
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                    Gates, corners &amp; details
                  </h2>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Stepper
                    label="Gates"
                    value={downspoutCount}
                    onChange={(v) => setDownspoutOverride(v)}
                    auto={downspoutOverride === null}
                    suggestion={suggestedDownspouts}
                    onUseSuggestion={() => setDownspoutOverride(null)}
                    hint="Auto-suggested from your runs — set the real gate count."
                  />
                  <div>
                    <span className={cn(MICROLABEL, "text-zinc-400")}>
                      Stories
                    </span>
                    <div className="mt-1.5 inline-flex rounded-lg border border-zinc-200 p-0.5">
                      {([1, 2, 3] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStories(s)}
                          className={cn(
                            "transition-smooth ring-focus rounded-md px-3 py-1.5 text-xs font-medium",
                            stories === s
                              ? "bg-zinc-100 text-zinc-900"
                              : "text-zinc-500 hover:text-zinc-900",
                          )}
                        >
                          {s}-story
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                      Sets the drop length (
                      {stories === 1 ? 10 : stories === 2 ? 20 : 30} ft each)
                      and hardware counts used in pricing.
                    </p>
                  </div>
                  <Stepper
                    label="Outside corners"
                    value={outsideCorners}
                    onChange={setOutsideCorners}
                    hint="Fence turns an outside corner of the property."
                  />
                  <Stepper
                    label="Inside corners"
                    value={insideCorners}
                    onChange={setInsideCorners}
                    hint="Fence turns an inside (re-entrant) corner."
                  />
                  <Stepper
                    label="End posts"
                    value={endCaps}
                    onChange={(v) => setEndCapOverride(v)}
                    auto={endCapOverride === null}
                    suggestion={suggestedEndCaps}
                    onUseSuggestion={() => setEndCapOverride(null)}
                    hint="Every open run end gets a post — corners join two ends."
                  />
                  <Stepper
                    label="Waste factor"
                    value={wasteFactorPct}
                    onChange={(v) => setWasteFactorPct(Math.min(25, v))}
                    unit="%"
                    hint="Extra material for cuts and grade. 8–12% is typical."
                  />
                </div>
              </motion.div>
            </>
          ) : (
            <>
              {/* -------- Client -------- */}
              <motion.div
                {...enter(0.05)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                    Client
                  </h2>
                  <span className="ml-auto truncate text-xs text-zinc-400">
                    {address}
                  </span>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="manual-client-name"
                      className={cn(MICROLABEL, "block text-zinc-400")}
                    >
                      Client name
                    </label>
                    <input
                      id="manual-client-name"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Sarah Chen"
                      className="transition-smooth mt-1.5 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="manual-client-email"
                      className={cn(MICROLABEL, "block text-zinc-400")}
                    >
                      Client email
                    </label>
                    <input
                      id="manual-client-email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      type="email"
                      placeholder="name@domain.com"
                      className="transition-smooth mt-1.5 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  Optional for a draft — required before sending.
                </p>
              </motion.div>

              {/* -------- Measurements recap -------- */}
              <motion.div
                {...enter(0.1)}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <Ruler className="h-4 w-4" />
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
                    Field measurements
                  </h2>
                  <button
                    type="button"
                    onClick={() => setStep("measure")}
                    className="transition-smooth ring-focus ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent-700 underline-offset-2 hover:underline"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Edit measurements
                  </button>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <RecapItem label="Fence" value={`${eaveLF} LF`} />
                  <RecapItem label="Gates" value={`${downspoutCount}`} />
                  <RecapItem label="Stories" value={`${stories}`} />
                  <RecapItem
                    label="Corners"
                    value={`${outsideCorners} out · ${insideCorners} in`}
                  />
                  <RecapItem label="End posts" value={`${endCaps}`} />
                  <RecapItem label="Waste" value={`${wasteFactorPct}%`} />
                  {extras.length > 0 && (
                    <RecapItem
                      label="Extra work"
                      value={`${extras.length} · ${fmtMoney(extrasTotal)}`}
                    />
                  )}
                </dl>
              </motion.div>
            </>
          )}
        </div>

        {/* -------- Live summary (sticky) -------- */}
        <motion.aside
          {...enter(0.1)}
          className="lg:sticky lg:top-[80px] lg:self-start"
        >
          <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-card sm:p-5">
            <div className={cn(MICROLABEL, "text-zinc-400")}>Live takeoff</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-zinc-900">
                {eaveLF}
              </span>
              <span className="text-sm font-medium text-zinc-500">
                LF of fence
              </span>
            </div>
            <dl className="mt-4 space-y-2 border-t border-zinc-100 pt-4 text-sm">
              <SummaryRow label="Gates" value={`${downspoutCount}`} />
              <SummaryRow label="Stories" value={`${stories}`} />
              <SummaryRow
                label="Corners"
                value={`${outsideCorners} out · ${insideCorners} in`}
              />
              <SummaryRow label="End posts" value={`${endCaps}`} />
              <SummaryRow label="Waste factor" value={`${wasteFactorPct}%`} />
            </dl>

            <div className="mt-4 border-t border-zinc-100 pt-4">
              <div className={cn(MICROLABEL, "text-zinc-400")}>
                Package pricing
              </div>
              {tiers.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {tiers.map((t) => (
                    <li
                      key={t.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm",
                        t.recommended
                          ? "bg-accent-50 font-semibold text-accent-900 ring-1 ring-accent-200"
                          : "text-zinc-600",
                      )}
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {fmtMoney(t.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-zinc-400">
                  Add your first run to see live package pricing.
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                {step === "measure"
                  ? `Priced with your standard package templates and a ${
                      jobType === "new"
                        ? "new-install scope (nothing to remove)"
                        : "free old-fence removal included"
                    }.`
                  : "Rebuild any tier above — rename it, tap its price, or open Edit materials & spec for shapes, colors, add-ons and the full bill of materials."}
              </p>
            </div>

            {error && (
              <p className="anim-enter-fade mt-3 text-xs text-rose-600">
                Couldn&apos;t save: {error}
              </p>
            )}

            {step === "measure" ? (
              <button
                type="button"
                onClick={() => canReview && setStep("review")}
                disabled={!canReview}
                className="transition-smooth ring-focus press-scale mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Build packages &amp; send
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSendOpen(true)}
                  className="transition-smooth ring-focus press-scale mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700"
                >
                  <Mail className="h-4 w-4" />
                  Send proposal
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={savingDraft}
                  className="transition-smooth ring-focus press-scale mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDraft ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : savedAt ? (
                    <Check className="h-4 w-4 text-accent-700" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savingDraft
                    ? "Saving…"
                    : savedAt
                      ? "Saved — update draft"
                      : "Save as draft"}
                </button>
                {savedAt && (
                  <p className="anim-enter-fade mt-2 text-center text-xs text-zinc-500">
                    Draft saved to{" "}
                    <Link
                      href="/dashboard/proposals"
                      className="ring-focus rounded-sm font-medium text-accent-700 underline-offset-2 hover:underline"
                    >
                      Proposals
                    </Link>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setStep("measure")}
                  className="transition-smooth ring-focus mt-2 block w-full text-center text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                >
                  ← Back to measurements
                </button>
              </>
            )}
            {step === "measure" && (
              <p className="mt-2 text-center text-xs text-zinc-400">
                Nothing saves until you say so — review first, no credits used.
              </p>
            )}
          </div>
        </motion.aside>
      </div>

      {/* Full package builder drawer — same component the /proposal
          builder uses. Edits flow back into pkgs so the section cards,
          summary panel and the saved/sent blob all stay in sync. */}
      {materialsPkg && (
        <MaterialsBuilder
          pkg={materialsPkg}
          allPackages={pkgs}
          measurements={measurements}
          discountPct={0}
          address={address}
          onChange={(next) =>
            setPkgs((prev) => prev.map((p) => (p.id === next.id ? next : p)))
          }
          onChangeAll={(next) => setPkgs(next)}
          priceDisplay={priceDisplay}
          onPriceDisplayChange={setPriceDisplay}
          onClose={() => setMaterialsEditId(null)}
        />
      )}

      {/* Mounted only while open so the modal seeds its client fields
          from the latest proposal state at the moment it opens. */}
      {sendOpen && (
        <SendModal
          open
          onClose={() => setSendOpen(false)}
          proposal={proposal}
        />
      )}
    </div>
  );
}

function RecapItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={cn(MICROLABEL, "text-zinc-400")}>{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-zinc-900">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums text-zinc-900">{value}</dd>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  unit,
  hint,
  auto,
  suggestion,
  onUseSuggestion,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
  /** True while the value tracks the live suggestion (no override). */
  auto?: boolean;
  suggestion?: number;
  onUseSuggestion?: () => void;
}) {
  const showSuggestion =
    auto === false && suggestion !== undefined && suggestion !== value;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={cn(MICROLABEL, "text-zinc-400")}>{label}</span>
        {auto && (
          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
            AUTO
          </span>
        )}
      </div>
      <div className="mt-1.5 inline-flex items-center rounded-lg border border-zinc-200">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
          className="transition-smooth ring-focus flex h-9 w-9 items-center justify-center rounded-l-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-12 text-center text-sm font-semibold tabular-nums text-zinc-900">
          {value}
          {unit}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
          className="transition-smooth ring-focus flex h-9 w-9 items-center justify-center rounded-r-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {showSuggestion && onUseSuggestion && (
        <button
          type="button"
          onClick={onUseSuggestion}
          className="transition-smooth ring-focus ml-2 rounded-md text-xs font-medium text-accent-700 underline-offset-2 hover:underline"
        >
          Suggested: {suggestion}
        </button>
      )}
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
