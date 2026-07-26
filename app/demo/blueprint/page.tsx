"use client";

// Method B — Blueprint Upload Takeoff.
//
// The whole point of this flow: a scanned/exported architectural plan has NO
// intrinsic real-world scale, so before we can measure anything we must
// calibrate. The user clicks the two ends of a printed dimension line of known
// length (here a 16'-0" dim line drawn into the procedural sheet), we compute
// pixels-per-foot with calibrateScale(), and from then on every traced edge is
// measured against THAT scale. A wrong calibration would scale all footage.
//
// State ownership: this page owns ALL geometry (segments, downspouts, pxPerFt,
// calibration picks, mode). GutterCanvas is fully controlled — it renders our
// props and emits changes back through callbacks.

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  UploadCloud,
  Ruler,
  Spline,
  MousePointer2,
  Droplets,
  RotateCcw,
  Eraser,
  FileText,
  Layers,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calibrateScale,
  nextId,
  roundFt,
  totalEaveFeet,
  totalRunFeet,
  type DownspoutMark,
  type Point,
  type Segment,
  type SegmentKind,
} from "@/lib/canvas-utils";
import GutterCanvas, { type CanvasMode } from "@/components/demo/GutterCanvas";
import { GUTTER_UNIT_PRICES, DOWNSPOUT_UNIT_PRICES } from "@/lib/pricing";

// ─── Pricing constants (labelled as an estimate in the UI) ────────────────
const GUTTER_PRICE = GUTTER_UNIT_PRICES["6-k-style-aluminum"]; // $/LF, === 12
const DOWNSPOUT_PRICE = DOWNSPOUT_UNIT_PRICES["3x4"]; // $/LF, === 9
const DOWNSPOUT_LF_EACH = 20; // assume 2-story, 20 ft of pipe per downspout

// ─── Calibration target ───────────────────────────────────────────────────
// The 16'-0" dimension line drawn into the blueprint background lives at a
// clean, known location so the demo is trivial to calibrate. The user should
// click at roughly these two endpoints:
const DIM_A: Point = { x: 250, y: 500 }; // left tick of the 16'-0" dim line
const DIM_B: Point = { x: 650, y: 500 }; // right tick — 400px span == 16 ft
const DIM_KNOWN_FT = 16;

// ─── Sample roof outline ──────────────────────────────────────────────────
// A closed L-shaped footprint sitting inside ~[40..860] x [40..540]. Eaves are
// the long guttered runs (cyan); the two vertical-ish sides are marked "rake"
// (dashed slate) to show the eave/rake distinction in the legend + readout.
function makeSampleOutline(): Segment[] {
  // L-shaped plan, clockwise from top-left.
  const pts: { p: Point; kind: SegmentKind }[] = [
    { p: { x: 260, y: 120 }, kind: "eave" }, // top edge (eave) →
    { p: { x: 640, y: 120 }, kind: "rake" }, // right upper (rake) ↓
    { p: { x: 640, y: 300 }, kind: "eave" }, // step-out eave →
    { p: { x: 800, y: 300 }, kind: "rake" }, // far-right rake ↓
    { p: { x: 800, y: 440 }, kind: "eave" }, // bottom edge (eave) ←
    { p: { x: 260, y: 440 }, kind: "rake" }, // left rake ↑
  ];
  const segs: Segment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    // The KIND on a segment describes the edge leaving that vertex.
    segs.push({ id: nextId("sample"), a: cur.p, b: next.p, kind: cur.kind });
  }
  return segs;
}

export default function Page() {
  // ─── Upload / reveal state ──────────────────────────────────────────────
  const [uploaded, setUploaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ─── Geometry state (page owns everything the canvas renders) ───────────
  const [segments, setSegments] = useState<Segment[]>([]);
  const [downspouts, setDownspouts] = useState<DownspoutMark[]>([]);
  const [mode, setMode] = useState<CanvasMode>("calibrate");
  const [traceKind, setTraceKind] = useState<SegmentKind>("eave");

  // ─── Calibration state ──────────────────────────────────────────────────
  // pxPerFt undefined => canvas hides all length labels (raw, un-scaled plan).
  const [pxPerFt, setPxPerFt] = useState<number | undefined>(undefined);
  const [cal, setCal] = useState<{ a: Point | null; b: Point | null }>({
    a: null,
    b: null,
  });
  const [knownFeet, setKnownFeet] = useState("16");

  const calibrated = typeof pxPerFt === "number" && pxPerFt > 0;

  // ─── Upload handlers (mock — any file reveals the same sample sheet) ─────
  const revealSheet = useCallback((name: string | null) => {
    setLoading(true);
    setFileName(name);
    // Simulate a parse/render round-trip so the loading state is visible.
    window.setTimeout(() => {
      setUploaded(true);
      setLoading(false);
      // Fresh sheet → start the calibration flow from scratch.
      setSegments([]);
      setDownspouts([]);
      setPxPerFt(undefined);
      setCal({ a: null, b: null });
      setMode("calibrate");
    }, 650);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      revealSheet(file ? file.name : null);
    },
    [revealSheet],
  );

  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      revealSheet(file ? file.name : null);
      // Allow re-picking the same file later.
      e.target.value = "";
    },
    [revealSheet],
  );

  // ─── Calibration picks ──────────────────────────────────────────────────
  const onCalibrationPick = useCallback((p: Point) => {
    setCal((prev) => {
      if (!prev.a) return { a: p, b: null };
      if (!prev.b) return { a: prev.a, b: p };
      return prev; // both set — ignore further clicks until reset
    });
  }, []);

  const setScale = useCallback(() => {
    if (!cal.a || !cal.b) return;
    const feet = parseFloat(knownFeet);
    if (!Number.isFinite(feet) || feet <= 0) return;
    const scale = calibrateScale(cal.a, cal.b, feet);
    if (!Number.isFinite(scale) || scale <= 0) return; // guard NaN / 0
    setPxPerFt(scale);
    setMode("trace"); // straight into tracing once scaled
  }, [cal, knownFeet]);

  const recalibrate = useCallback(() => {
    setCal({ a: null, b: null });
    setPxPerFt(undefined);
    setKnownFeet("16");
    setMode("calibrate");
  }, []);

  const clearTrace = useCallback(() => {
    setSegments([]);
    setDownspouts([]);
  }, []);

  const loadSampleOutline = useCallback(() => {
    setSegments(makeSampleOutline());
    // If they've already calibrated, drop them into select so they can adjust.
    setMode((m) => (m === "calibrate" ? m : "select"));
  }, []);

  // ─── Live measurements (all derived from the CALIBRATED scale) ──────────
  const eaveLF = useMemo(
    () => (calibrated ? roundFt(totalEaveFeet(segments, pxPerFt!)) : 0),
    [segments, pxPerFt, calibrated],
  );
  const totalLF = useMemo(
    () => (calibrated ? roundFt(totalRunFeet(segments, pxPerFt!)) : 0),
    [segments, pxPerFt, calibrated],
  );
  const rakeLF = useMemo(() => roundFt(totalLF - eaveLF), [totalLF, eaveLF]);

  const estCost = useMemo(() => {
    if (!calibrated) return 0;
    const gutter = eaveLF * GUTTER_PRICE;
    const spouts = downspouts.length * DOWNSPOUT_LF_EACH * DOWNSPOUT_PRICE;
    return gutter + spouts;
  }, [calibrated, eaveLF, downspouts.length]);

  // ─── Blueprint background (procedural SVG, no assets) ────────────────────
  const blueprint = useMemo(() => <BlueprintSheet />, []);

  return (
    <main className="min-h-screen bg-ink text-white">
      {/* Top bar */}
      <div className="border-b border-white/10 bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/demo"
            className="group ring-focus-dark inline-flex items-center gap-2 rounded-md text-sm text-white/60 transition-smooth hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />{" "}
            Takeoff demos
          </Link>
          <div className="flex items-center gap-3 text-right">
            {fileName && (
              <span className="hidden max-w-[220px] truncate text-xs text-white/50 sm:inline">
                <FileText className="mr-1 inline h-3.5 w-3.5" />
                {fileName}
              </span>
            )}
            <span className="font-label rounded-md border border-white/25 px-2.5 py-1 text-white">
              Method B · Plan
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="anim-enter mb-6">
          <h1 className="display-hero text-3xl text-white sm:text-4xl">
            Plan Upload Takeoff
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Upload a plan sheet, calibrate the scale against a known dimension,
            then trace the fence line for exact, plan-accurate linear footage.
          </p>
        </header>

        {!uploaded ? (
          // ─── UPLOAD ZONE ────────────────────────────────────────────────
          <UploadZone
            dragOver={dragOver}
            loading={loading}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onBrowse={() => inputRef.current?.click()}
            onSample={() => revealSheet(null)}
            inputRef={inputRef}
            onFilePick={onFilePick}
          />
        ) : (
          // ─── CANVAS + SIDEBAR ───────────────────────────────────────────
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Canvas column */}
            <div className="anim-enter lg:col-span-2">
              {/* Instruction / mode banner sits above the canvas. */}
              {!calibrated ? (
                <div className="anim-enter-fade mb-3 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  <Ruler className="h-4 w-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">Calibrate:</strong> click
                    the two ends of the{" "}
                    <span className="font-mono">16&#8242;-0&#8243;</span>{" "}
                    dimension line to set the scale.
                  </span>
                </div>
              ) : (
                <ModeToolbar
                  mode={mode}
                  setMode={setMode}
                  traceKind={traceKind}
                  setTraceKind={setTraceKind}
                />
              )}

              <GutterCanvas
                background={blueprint}
                segments={segments}
                downspouts={downspouts}
                pxPerFt={pxPerFt}
                mode={mode}
                onSegmentsChange={setSegments}
                onDownspoutsChange={setDownspouts}
                calibration={cal}
                onCalibrationPick={onCalibrationPick}
                traceKind={traceKind}
              />

              {/* Calibration confirm form appears once both ends are picked. */}
              {!calibrated && cal.a && cal.b && (
                <CalibrateForm
                  knownFeet={knownFeet}
                  setKnownFeet={setKnownFeet}
                  onSet={setScale}
                  onReset={() => setCal({ a: null, b: null })}
                />
              )}

              {calibrated && (
                <p className="anim-enter-fade stagger-2 mt-3 text-xs text-white/50">
                  Tip: try a wrong number in “Recalibrate” — every measurement
                  rescales, because all footage is derived from this one scale.
                </p>
              )}
            </div>

            {/* Sidebar */}
            <aside className="anim-enter-fade stagger-2 space-y-4 lg:sticky lg:top-6 lg:self-start">
              {/* Scale status */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">
                    Scale
                  </h2>
                  <span
                    className={cn(
                      "inline-flex h-2 w-2 rounded-full",
                      calibrated ? "bg-stripe-blue" : "bg-amber-400",
                    )}
                  />
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm",
                    calibrated ? "text-white/80" : "text-amber-300/90",
                  )}
                >
                  {calibrated
                    ? `Scale set: 1 ft = ${pxPerFt!.toFixed(1)} px`
                    : "Not calibrated — set the scale first"}
                </p>
                <button
                  type="button"
                  onClick={recalibrate}
                  className="press-scale ring-focus-dark mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition-smooth hover:border-stripe-blue/60 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Recalibrate
                </button>
              </div>

              {/* Live readout */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-sm font-semibold text-white">
                  Measurements
                </h2>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <Readout
                    label="Fenced run"
                    value={calibrated ? `${eaveLF.toFixed(1)} LF` : "—"}
                    accent
                  />
                  <Readout
                    label="Unfenced / other"
                    value={calibrated ? `${rakeLF.toFixed(1)} LF` : "—"}
                  />
                  <Readout
                    label="Total traced run"
                    value={calibrated ? `${totalLF.toFixed(1)} LF` : "—"}
                  />
                  <div className="my-2 h-px bg-white/10" />
                  <Readout label="Segments" value={String(segments.length)} />
                  <Readout
                    label="Gates"
                    value={String(downspouts.length)}
                  />
                </dl>
              </div>

              {/* Estimated cost — only once calibrated */}
              {calibrated && (
                <div className="anim-enter-fade rounded-xl border border-stripe-blue/40 bg-stripe-blue/10 p-5">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-white">
                      Estimated cost
                    </h2>
                    <span className="font-label text-[10px] text-white/50">
                      Estimate
                    </span>
                  </div>
                  <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-white">
                    {formatCurrency(estCost)}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-white/60">
                    {eaveLF.toFixed(1)} LF fence ×{" "}
                    {formatCurrency(GUTTER_PRICE)} +{" "}
                    {downspouts.length} gate
                    {downspouts.length === 1 ? "" : "s"} ×{" "}
                    {DOWNSPOUT_LF_EACH} ft × {formatCurrency(DOWNSPOUT_PRICE)}.
                    Demo rates — materials only.
                  </p>
                </div>
              )}

              {/* Legend */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-sm font-semibold text-white">Legend</h2>
                <ul className="mt-3 space-y-2.5 text-sm text-white/80">
                  <li className="flex items-center gap-3">
                    <span className="h-1 w-6 rounded-full bg-stripe-blue shadow-[0_0_8px_rgba(67,83,255,0.7)]" />
                    Fence run
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-0.5 w-6 rounded-full border-t-2 border-dashed border-white/40" />
                    Unfenced edge
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full bg-stripe-blue ring-2 ring-stripe-blue/30" />
                    Gate
                  </li>
                </ul>
              </div>

              {/* Trace actions */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-sm font-semibold text-white">Trace</h2>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={loadSampleOutline}
                    className="press-scale ring-focus-dark inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-500"
                  >
                    <Layers className="h-4 w-4" /> Load sample outline
                  </button>
                  <button
                    type="button"
                    onClick={clearTrace}
                    className="press-scale ring-focus-dark inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white/70 transition-smooth hover:border-stripe-coral/60 hover:text-stripe-coral"
                  >
                    <Eraser className="h-4 w-4" /> Clear trace
                  </button>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-white/50">
                  Trace: click to drop points, double-click or Esc to end a run.
                  Adjust: drag corners. Downspout: click a run to place, click a
                  dot to remove.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Upload drop zone ──────────────────────────────────────────────────────
function UploadZone({
  dragOver,
  loading,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowse,
  onSample,
  inputRef,
  onFilePick,
}: {
  dragOver: boolean;
  loading: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onBrowse: () => void;
  onSample: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    // anim-enter lives on the wrapper: its fill-mode pins `transform` on the
    // animated element, which would silently cancel the drag-over scale below.
    <div className="anim-enter">
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={cn(
        "flex min-h-[420px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-smooth",
        dragOver
          ? "scale-[1.01] border-stripe-blue bg-stripe-blue/10"
          : "border-white/15 bg-white/5",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf"
        className="hidden"
        onChange={onFilePick}
      />
      <span
        className={cn(
          "inline-flex h-16 w-16 items-center justify-center rounded-xl ring-1 transition-smooth",
          dragOver
            ? "scale-110 bg-stripe-blue/20 text-white ring-stripe-blue/50"
            : "bg-white/10 text-stripe-blue ring-white/15",
        )}
      >
        <UploadCloud className="h-8 w-8" />
      </span>
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-white">
        {loading ? "Rendering sheet…" : "Drop an architectural plan (PDF/PNG)"}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-white/60">
        {loading
          ? "Parsing the plan and preparing the calibration canvas."
          : "Drag a file here, or use the sample plan to try the flow instantly."}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBrowse}
          disabled={loading}
          className="press-scale ring-focus-dark inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/80 transition-smooth hover:border-stripe-blue/60 hover:text-white disabled:opacity-50"
        >
          <FileText className="h-4 w-4" /> Choose file
        </button>
        <button
          type="button"
          onClick={onSample}
          disabled={loading}
          className="press-scale ring-focus-dark inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-500 disabled:opacity-50"
        >
          <Layers className="h-4 w-4" /> Use sample plan
        </button>
      </div>
      <p className="mt-4 text-xs text-white/40">
        Demo only — any file reveals the same procedural sample sheet. No upload
        leaves your browser.
      </p>
    </div>
    </div>
  );
}

// ─── Mode toolbar (post-calibration) ───────────────────────────────────────
function ModeToolbar({
  mode,
  setMode,
  traceKind,
  setTraceKind,
}: {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  traceKind: SegmentKind;
  setTraceKind: (k: SegmentKind) => void;
}) {
  const tools: { id: CanvasMode; label: string; icon: typeof Spline }[] = [
    { id: "trace", label: "Trace edge", icon: Spline },
    { id: "select", label: "Adjust", icon: MousePointer2 },
    { id: "downspout", label: "Gates", icon: Droplets },
  ];
  return (
    <div className="anim-enter-fade mb-3 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
        {tools.map((t) => {
          const Icon = t.icon;
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={cn(
                "press-scale ring-focus-dark inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-smooth",
                active
                  ? "bg-accent-600 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Eave / rake toggle — what gets drawn in trace mode. */}
      {mode === "trace" && (
        <div className="anim-enter-fade flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          {(["eave", "rake"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTraceKind(k)}
              className={cn(
                "press-scale ring-focus-dark rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-smooth",
                traceKind === k
                  ? k === "eave"
                    ? "bg-accent-600 text-white"
                    : "bg-white/20 text-white"
                  : "text-white/50 hover:text-white",
              )}
            >
              {k === "eave" ? "fence" : "unfenced"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calibration confirm form ──────────────────────────────────────────────
function CalibrateForm({
  knownFeet,
  setKnownFeet,
  onSet,
  onReset,
}: {
  knownFeet: string;
  setKnownFeet: (v: string) => void;
  onSet: () => void;
  onReset: () => void;
}) {
  const feet = parseFloat(knownFeet);
  const valid = Number.isFinite(feet) && feet > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSet();
      }}
      className="anim-enter mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-stripe-blue/40 bg-stripe-blue/10 px-4 py-3"
    >
      <div>
        <label className="block text-xs font-medium text-white/60">
          Known length of that dimension line
        </label>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            min="0.1"
            step="any"
            value={knownFeet}
            onChange={(e) => setKnownFeet(e.target.value)}
            className="w-24 rounded-lg border border-white/15 bg-ink px-3 py-1.5 text-sm text-white outline-none transition-smooth focus:border-stripe-blue focus:ring-1 focus:ring-stripe-blue"
          />
          <span className="text-sm text-white/60">feet</span>
        </div>
      </div>
      <button
        type="submit"
        disabled={!valid}
        className="press-scale ring-focus-dark inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Ruler className="h-4 w-4" /> Set scale
      </button>
      <button
        type="button"
        onClick={onReset}
        className="press-scale ring-focus-dark rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white/70 transition-smooth hover:border-white/30 hover:text-white"
      >
        Re-pick points
      </button>
    </form>
  );
}

// ─── Sidebar readout row ───────────────────────────────────────────────────
function Readout({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-white/60">{label}</dt>
      <dd
        className={cn(
          "font-mono font-semibold tabular-nums",
          accent ? "text-stripe-blue" : "text-white/90",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Procedural blueprint sheet ────────────────────────────────────────────
// Rendered BEHIND the canvas overlay inside the same 900×580 viewBox. Dark navy
// paper + light-blue line-art: a roof-plan rectangle, a couple interior wall
// lines, a title block, and a 16'-0" horizontal DIMENSION LINE at y=500 whose
// ticks sit at x=250 and x=650 (== DIM_A / DIM_B, a 400px == 16 ft span).
function BlueprintSheet() {
  const LINE = "#7d8bfc"; // light blue line-art
  const LINE_BRIGHT = "#a3b1ff";
  return (
    <g pointerEvents="none">
      <defs>
        <linearGradient id="bp-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d0d18" />
          <stop offset="1" stopColor="#12142e" />
        </linearGradient>
        <pattern
          id="bp-grid"
          width="30"
          height="30"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 30 0 L 0 0 0 30"
            fill="none"
            stroke="rgba(125,139,252,0.07)"
            strokeWidth="1"
          />
        </pattern>
      </defs>

      {/* Navy paper + faint drafting grid */}
      <rect x={0} y={0} width={900} height={580} fill="url(#bp-paper)" />
      <rect x={0} y={0} width={900} height={580} fill="url(#bp-grid)" />

      {/* Sheet border (inner drafting frame) */}
      <rect
        x={20}
        y={20}
        width={860}
        height={540}
        fill="none"
        stroke={LINE}
        strokeWidth={1.5}
        opacity={0.5}
      />

      {/* ── Roof-plan outline (the thing the user will trace over) ── */}
      <polygon
        points="260,120 640,120 640,300 800,300 800,440 260,440"
        fill="rgba(125,139,252,0.06)"
        stroke={LINE}
        strokeWidth={2}
      />
      {/* Interior wall lines */}
      <line x1={260} y1={280} x2={640} y2={280} stroke={LINE} strokeWidth={1} opacity={0.5} />
      <line x1={450} y1={120} x2={450} y2={440} stroke={LINE} strokeWidth={1} opacity={0.5} />
      <line x1={640} y1={300} x2={640} y2={440} stroke={LINE} strokeWidth={1} opacity={0.35} strokeDasharray="5 4" />
      {/* Ridge hint down the roof spine */}
      <line x1={260} y1={280} x2={800} y2={280} stroke={LINE_BRIGHT} strokeWidth={1} opacity={0.3} strokeDasharray="10 6" />

      {/* ── 16'-0" DIMENSION LINE (calibration target) ── */}
      {/* Horizontal dim line from (250,500) to (650,500). */}
      <line x1={250} y1={500} x2={650} y2={500} stroke={LINE_BRIGHT} strokeWidth={1.5} />
      {/* End ticks (short verticals) */}
      <line x1={250} y1={490} x2={250} y2={510} stroke={LINE_BRIGHT} strokeWidth={1.5} />
      <line x1={650} y1={490} x2={650} y2={510} stroke={LINE_BRIGHT} strokeWidth={1.5} />
      {/* Extension lines up to the plan */}
      <line x1={250} y1={470} x2={250} y2={496} stroke={LINE} strokeWidth={0.75} opacity={0.5} />
      <line x1={650} y1={470} x2={650} y2={496} stroke={LINE} strokeWidth={0.75} opacity={0.5} />
      {/* Printed dimension label */}
      <text
        x={450}
        y={494}
        textAnchor="middle"
        fontSize={15}
        fontWeight={700}
        fill={LINE_BRIGHT}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        16&#8242;-0&#8243;
      </text>

      {/* ── Title block (bottom-right corner) ── */}
      <g>
        <rect x={690} y={470} width={170} height={80} fill="rgba(13,13,18,0.85)" stroke={LINE} strokeWidth={1} />
        <line x1={690} y1={498} x2={860} y2={498} stroke={LINE} strokeWidth={0.75} opacity={0.6} />
        <line x1={690} y1={524} x2={860} y2={524} stroke={LINE} strokeWidth={0.75} opacity={0.6} />
        <text x={700} y={489} fontSize={12} fontWeight={700} fill={LINE} fontFamily="ui-monospace, monospace">
          SITE PLAN
        </text>
        <text x={700} y={515} fontSize={10} fill={LINE} opacity={0.85} fontFamily="ui-monospace, monospace">
          SCALE 1/4&#8243; = 1&#8242;-0&#8243;
        </text>
        <text x={700} y={541} fontSize={10} fill={LINE} opacity={0.85} fontFamily="ui-monospace, monospace">
          SHEET A-2
        </text>
      </g>

      {/* Sheet callout (top-left) */}
      <text x={40} y={52} fontSize={13} fontWeight={700} fill={LINE} opacity={0.7} fontFamily="ui-monospace, monospace">
        RESIDENCE — SITE LAYOUT
      </text>
    </g>
  );
}
