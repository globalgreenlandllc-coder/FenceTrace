"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  MapPin,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { runFenceScan, type FenceScanResult } from "@/app/actions/fence-scan";
import { saveDraftFromEstimate } from "@/app/actions/proposals";
import {
  FenceCanvas,
  type FenceLayout,
} from "@/components/fence/fence-canvas";
import { Fence3D } from "@/components/fence/fence-3d";
import {
  FENCE_TYPES,
  fenceType,
  TERRAIN_LABEL,
  type FenceTypeId,
  type Terrain,
} from "@/lib/fence/catalog";
import { computeFenceTakeoff } from "@/lib/fence/takeoff";
import { fenceTiers, priceFence } from "@/lib/fence/pricing";
import { canvasPolylineFt } from "@/lib/fence/geo";
import type { Downspout, EditableLine, Measurements } from "@/lib/types";

/**
 * FenceEstimator — the /estimate experience. Address → satellite tile +
 * Regrid property line → draw/verify the fence → live takeoff, BOM and
 * Good/Better/Best pricing → one click into a proposal draft.
 */

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Corner/end counts from the drawn runs: interior bends are corners; a
 *  closed ring (property loop) contributes its closing vertex and no
 *  ends; an open run contributes two ends. */
function cornersAndEnds(layout: FenceLayout): { corners: number; ends: number } {
  let corners = 0;
  let ends = 0;
  for (const run of layout.runs) {
    const pts = run.points;
    if (pts.length < 2) continue;
    const closed =
      Math.hypot(
        pts[0].x - pts[pts.length - 1].x,
        pts[0].y - pts[pts.length - 1].y,
      ) < 1.5;
    corners += Math.max(0, pts.length - 2) + (closed ? 1 : 0);
    ends += closed ? 0 : 2;
  }
  return { corners, ends };
}

export function FenceEstimator() {
  const router = useRouter();
  const params = useSearchParams();
  const addressParam = params.get("address") ?? "";
  const jobType = (params.get("jobType") === "new" ? "new" : "replacement") as
    | "new"
    | "replacement";

  const [address, setAddress] = useState(addressParam);
  const [scan, setScan] = useState<FenceScanResult | null>(null);
  const [scanState, setScanState] = useState<"idle" | "loading" | "error">(
    addressParam ? "loading" : "idle",
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [layout, setLayout] = useState<FenceLayout>({ runs: [], gates: [] });

  const [typeId, setTypeId] = useState<FenceTypeId>("cedar-privacy");
  const t = fenceType(typeId);
  const [heightFt, setHeightFt] = useState<number>(t.defaultHeightFt);
  const [terrain, setTerrain] = useState<Terrain>("flat");
  const [stain, setStain] = useState(false);
  const [removalLf, setRemovalLf] = useState(jobType === "replacement" ? -1 : 0);
  const [view3d, setView3d] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ranFor = useRef<string | null>(null);

  async function scanAddress(addr: string) {
    setScanState("loading");
    setScanError(null);
    const res = await runFenceScan(addr);
    if (!res.ok) {
      setScanState("error");
      setScanError(res.reason);
      return;
    }
    setScan(res);
    setLayout({ runs: [], gates: [] });
    setScanState("idle");
  }

  useEffect(() => {
    if (addressParam && ranFor.current !== addressParam) {
      ranFor.current = addressParam;
      void scanAddress(addressParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressParam]);

  // Keep height valid when the type changes.
  useEffect(() => {
    if (!t.heightsFt.includes(heightFt)) setHeightFt(t.defaultHeightFt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  /* ---- live math ---- */
  const totalLf = useMemo(
    () =>
      scan
        ? Math.round(
            layout.runs.reduce(
              (a, r) => a + canvasPolylineFt(r.points, scan.canvasPxPerFt),
              0,
            ),
          )
        : 0,
    [layout.runs, scan],
  );
  const { corners, ends } = useMemo(() => cornersAndEnds(layout), [layout]);
  const gatesSingle = layout.gates.filter((g) => g.kind === "single").length;
  const gatesDouble = layout.gates.filter((g) => g.kind === "double").length;
  const effRemoval = removalLf < 0 ? totalLf : removalLf; // -1 = "same as drawn"

  const runLengths = useMemo(
    () =>
      scan
        ? layout.runs.map((r) => canvasPolylineFt(r.points, scan.canvasPxPerFt))
        : [],
    [layout.runs, scan],
  );
  const layoutInput = useMemo(
    () => ({
      type: typeId,
      heightFt,
      totalLf,
      runLengths,
      corners,
      ends,
      gatesSingle,
      gatesDouble,
      terrain,
      wastePct: 10,
      removalLf: jobType === "replacement" ? effRemoval : 0,
      stain,
    }),
    [typeId, heightFt, totalLf, runLengths, corners, ends, gatesSingle, gatesDouble, terrain, effRemoval, stain, jobType],
  );

  const takeoff = useMemo(
    () => (totalLf > 0 ? computeFenceTakeoff(layoutInput) : null),
    [layoutInput, totalLf],
  );

  const tierPrices = useMemo(() => {
    if (totalLf === 0) return [];
    return fenceTiers(typeId).map((tier) => ({
      tier,
      label: fenceType(tier.type).label,
      price: priceFence(
        // The user's stain choice applies to every stainable tier; Best
        // adds it regardless.
        { ...layoutInput, type: tier.type, stain: tier.stain || stain },
        { markupPct: tier.markupPct },
      ),
    }));
  }, [layoutInput, typeId, totalLf]);

  /* ---- proposal handoff ---- */
  async function buildProposal() {
    if (!scan || !takeoff || totalLf === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    const measurements: Measurements = {
      eaveLF: takeoff.netFenceLf,
      rakeLF: 0,
      outsideCorners: corners,
      insideCorners: 0,
      endCaps: ends,
      downspoutCount: gatesSingle + gatesDouble,
      stories: 1,
      wasteFactorPct: 10,
    };
    const eaves: EditableLine[] = layout.runs.map((r) => ({
      id: r.id,
      kind: "eave",
      points: r.points,
    }));
    const downspouts: Downspout[] = layout.gates.map((g) => ({
      id: g.id,
      x: g.x,
      y: g.y,
      heightFt,
    }));
    const res = await saveDraftFromEstimate({
      address: scan.address,
      measurements,
      eaves,
      rakes: [],
      downspouts,
      aerial: scan.aerial,
      canvasPxPerFt: scan.canvasPxPerFt,
      jobType,
      fence: {
        type: typeId,
        heightFt,
        terrain,
        stain,
        removalLf: layoutInput.removalLf,
        gatesSingle,
        gatesDouble,
        corners,
        ends,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.reason);
      return;
    }
    router.push(`/proposal?id=${res.id}`);
  }

  /* ---- render ---- */
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo showSubtitle={false} />
            <span className="hidden text-sm text-zinc-400 sm:inline">/ Fence estimator</span>
            {scan && (
              <span className="hidden min-w-0 items-center gap-1 truncate text-sm text-zinc-600 md:flex">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-accent-600" />
                <span className="truncate">{scan.address}</span>
              </span>
            )}
          </div>
          <Link
            href="/dashboard/proposals/new"
            className="transition-smooth ring-focus inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Start over
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        {/* Address bar (shown until a scan succeeds, and for re-scans) */}
        {!scan && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim().length >= 8) void scanAddress(address.trim());
            }}
            className="mx-auto mt-10 max-w-xl"
          >
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Where&apos;s the fence going?
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              We&apos;ll pull the satellite view and the recorded property lines
              — then you draw or confirm the fence in seconds.
            </p>
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Property Ln, Austin, TX"
                  autoFocus
                  className="ring-focus h-12 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-accent-400"
                />
              </div>
              <Button type="submit" disabled={scanState === "loading" || address.trim().length < 8} className="h-12 px-5">
                {scanState === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
                {scanState === "loading" ? "Scanning…" : "Scan property"}
              </Button>
            </div>
            {scanState === "error" && scanError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
                {scanError}
              </p>
            )}
          </form>
        )}

        {scanState === "loading" && addressParam && !scan && (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
            <p className="text-sm text-zinc-500">
              Pulling satellite imagery and property lines…
            </p>
          </div>
        )}

        {scan && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Canvas column */}
            <div>
              <div className="mb-2 inline-flex rounded-full bg-zinc-100 p-0.5">
                {([
                  { id: false, label: "Layout" },
                  { id: true, label: "3D preview" },
                ] as { id: boolean; label: string }[]).map((v) => (
                  <button
                    key={String(v.id)}
                    type="button"
                    onClick={() => setView3d(v.id)}
                    className={cn(
                      "transition-smooth ring-focus rounded-full px-3 py-1.5 text-xs font-semibold",
                      view3d === v.id
                        ? "bg-white text-zinc-900 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-800",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {view3d ? (
                <Fence3D
                  runs={layout.runs}
                  gates={layout.gates}
                  heightFt={heightFt}
                  typeId={typeId}
                  pxPerFt={scan.canvasPxPerFt}
                  parcelRings={scan.parcelRings}
                  className="aspect-[16/10]"
                />
              ) : (
                <FenceCanvas scan={scan} layout={layout} onChange={setLayout} />
              )}
              {scan.parcel && (
                <p className="mt-2 text-xs text-zinc-400">
                  Property boundary from county records
                  {scan.parcel.acres ? ` · ${scan.parcel.acres.toFixed(2)} acres` : ""}
                  {scan.parcel.apn ? ` · parcel ${scan.parcel.apn}` : ""} — verify
                  on site before digging.
                </p>
              )}
            </div>

            {/* Config + pricing rail */}
            <div className="space-y-4">
              {/* Fence type */}
              <section className="surface p-4">
                <h3 className="font-label text-zinc-500">Fence type</h3>
                <select
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value as FenceTypeId)}
                  className="input mt-2 w-full"
                >
                  {FENCE_TYPES.map((ft) => (
                    <option key={ft.id} value={ft.id}>
                      {ft.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-zinc-500">{t.blurb}</p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="font-label text-zinc-500">Height</span>
                  {t.heightsFt.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHeightFt(h)}
                      className={cn(
                        "transition-smooth ring-focus rounded-full border px-2.5 py-1 text-xs font-semibold",
                        heightFt === h
                          ? "border-accent-500 bg-accent-50 text-accent-900"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {h}&apos;
                    </button>
                  ))}
                </div>

                <div className="mt-3">
                  <span className="font-label text-zinc-500">Ground</span>
                  <select
                    value={terrain}
                    onChange={(e) => setTerrain(e.target.value as Terrain)}
                    className="input mt-1.5 w-full"
                  >
                    {(Object.keys(TERRAIN_LABEL) as Terrain[]).map((k) => (
                      <option key={k} value={k}>
                        {TERRAIN_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  {jobType === "replacement" && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={effRemoval > 0}
                        onChange={(e) => setRemovalLf(e.target.checked ? -1 : 0)}
                        className="h-4 w-4 accent-[#1E7340]"
                      />
                      <span className="text-zinc-700">
                        Tear out old fence{effRemoval > 0 ? ` (${effRemoval} LF)` : ""}
                      </span>
                    </label>
                  )}
                  {t.stainable && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={stain}
                        onChange={(e) => setStain(e.target.checked)}
                        className="h-4 w-4 accent-[#1E7340]"
                      />
                      <span className="text-zinc-700">Stain & seal after install</span>
                    </label>
                  )}
                </div>
              </section>

              {/* Live takeoff */}
              <section className="surface p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-label text-zinc-500">Material takeoff</h3>
                  <span className="text-xs text-zinc-400">
                    {totalLf} LF drawn · {corners} corners
                  </span>
                </div>
                {takeoff ? (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-[13px]">
                    {takeoff.bom.map((b) => (
                      <li key={b.key} className="flex justify-between gap-2">
                        <span className="text-zinc-600">{b.label}</span>
                        <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                          {b.qty} {b.unit}
                        </span>
                      </li>
                    ))}
                    <li className="mt-1 flex justify-between border-t border-zinc-100 pt-1.5 text-zinc-500">
                      <span>Crew time</span>
                      <span className="tabular-nums">{takeoff.laborHours} hrs</span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-zinc-400">
                    Draw the fence (or tap “Use property line”) and the material
                    list builds itself.
                  </p>
                )}
              </section>

              {/* Tier pricing */}
              {tierPrices.length > 0 && (
                <section className="surface space-y-2 p-4">
                  <h3 className="font-label text-zinc-500">Price options</h3>
                  {tierPrices.map(({ tier, label, price }) => (
                    <div
                      key={tier.id}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-3 py-2",
                        tier.recommended
                          ? "border-accent-300 bg-accent-50"
                          : "border-zinc-200 bg-white",
                      )}
                    >
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">
                          {tier.name} — {label}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {tier.tagline} · {fmt(price.pricePerLf)}/LF
                        </div>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-zinc-900">
                        {fmt(price.total)}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <Button
                onClick={buildProposal}
                disabled={!takeoff || totalLf === 0 || saving}
                className="h-12 w-full"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Build the proposal
                <ArrowRight className="h-4 w-4" />
              </Button>
              {saveError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
                  {saveError}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setScan(null);
                  setScanState("idle");
                }}
                className="transition-smooth ring-focus w-full text-center text-xs text-zinc-400 hover:text-zinc-600"
              >
                Scan a different address
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
