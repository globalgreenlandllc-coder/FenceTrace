"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Fence,
  Loader2,
  MapPin,
  ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete";
import { getRecentAddresses } from "@/app/actions/estimate";
import {
  mergeRecents,
  pushLocalRecent,
  readLocalRecents,
  removeLocalRecent,
} from "@/lib/recent-addresses";
import { cn } from "@/lib/utils";
import { refetchAerialTile, reframeFenceScan, runFenceScan, type FenceScanResult } from "@/app/actions/fence-scan";
import { saveDraftFromEstimate } from "@/app/actions/proposals";
import {
  FenceCanvas,
  type FenceLayout,
} from "@/components/fence/fence-canvas";
import dynamic from "next/dynamic";
// 3D loads on first toggle — the scan canvas paints faster without it.
const Fence3D = dynamic(
  () => import("@/components/fence/fence-3d").then((m) => m.Fence3D),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-[16/10] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
    ),
  },
);
import {
  FENCE_TYPES,
  fenceType,
  TERRAIN_LABEL,
  type FenceTypeId,
  type Terrain,
} from "@/lib/fence/catalog";
import { computeFenceTakeoff } from "@/lib/fence/takeoff";
import { addShot, suggestShots } from "@/lib/fence/viewpoints";
import { fenceTiers, priceFence } from "@/lib/fence/pricing";
import { CANVAS_H, CANVAS_W, canvasPolylineFt, canvasToLatLng, countCornersAndEnds, latLngToCanvas, walkPostPositions } from "@/lib/fence/geo";
import { contoursFromGrid } from "@/lib/fence/contours";
import { sampleFenceElevations } from "@/app/actions/fence-topo";
import { getMyFenceRates } from "@/app/actions/fence-rates";
import type { RateBook } from "@/lib/fence/rates";
import { summarizeSlopes, type SlopeSummary } from "@/lib/fence/slope";
import { marketFrostIn } from "@/lib/fence/market";
import { nearestHeight } from "@/lib/fence/takeoff";
import { Mountain } from "lucide-react";
import type { Downspout, EditableLine, Measurements } from "@/lib/types";

/**
 * FenceEstimator — the /estimate experience. Address → satellite tile +
 * Regrid property line → draw/verify the fence → live takeoff, BOM and
 * Good/Better/Best pricing → one click into a proposal draft.
 */

// Topo lattice density: 18×12 = 216 sample points, one Elevation call.
const TOPO_COLS = 18;
const TOPO_ROWS = 12;

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Corner/end counts from the drawn runs — angle-aware: a vertex is a
 *  corner only when the fence actually turns there (≥ CORNER_MIN_DEG,
 *  any direction), so near-collinear parcel vertices stop inflating the
 *  corner-post count. Closed rings contribute no ends. */
function cornersAndEnds(layout: FenceLayout): { corners: number; ends: number } {
  return countCornersAndEnds(layout.runs);
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

  // The contractor's own price book (Settings → Your fence prices).
  // Undefined until it loads, and undefined when they've overridden
  // nothing — both mean "quote at the platform's standard rates".
  const [rateBook, setRateBook] = useState<RateBook | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getMyFenceRates()
      .then((b) => {
        if (alive && Object.keys(b).length > 0) setRateBook(b);
      })
      .catch(() => undefined); // no book ⇒ standard rates, never a blocker
    return () => {
      alive = false;
    };
  }, []);

  const [typeId, setTypeId] = useState<FenceTypeId>("cedar-privacy");
  const t = fenceType(typeId);
  const [heightFt, setHeightFt] = useState<number>(t.defaultHeightFt);
  const [terrain, setTerrain] = useState<Terrain>("flat");
  // Terrain follows the measured grade until the contractor overrides it.
  const [terrainAuto, setTerrainAuto] = useState(true);
  // The debounced elevation callback reads this REF, not the state —
  // closing over the state meant a manual Ground pick made inside the
  // 1.2 s debounce window got snapped back to the auto suggestion by
  // the stale timer.
  const terrainAutoRef = useRef(terrainAuto);
  terrainAutoRef.current = terrainAuto;
  const [slope, setSlope] = useState<SlopeSummary | null>(null);
  // Whether the current slope analysis measured the DRAWN runs (prices
  // steps) or just the yard preview (informational only).
  const [slopeFromRuns, setSlopeFromRuns] = useState(false);
  const [slopeError, setSlopeError] = useState<string | null>(null);
  // Raw per-run elevation samples for the DRAWN runs — feeds the 3D
  // preview's terrain and rides along to the proposal blob. Carries the
  // walk spacing used at sample time (the fence type can change before
  // the resample lands). Null when the last sample covered the yard
  // preview, not the drawn layout.
  const [runElevRaw, setRunElevRaw] = useState<{
    elevations: number[][];
    spacingPx: number;
  } | null>(null);
  const [stain, setStain] = useState(false);
  const [removalLf, setRemovalLf] = useState(jobType === "replacement" ? -1 : 0);
  // Retaining wall: fence mounts on top of a wall — posts over that span
  // are core-drilled + anchored (priced per post), never dug. Off by
  // default; the topo read only SUGGESTS it when it sees a sheer drop.
  const [wallTop, setWallTop] = useState(false);
  const [wallLfInput, setWallLfInput] = useState<number | null>(null);
  // Post stock: standard, galvanized steel, or heavy 6×6 PT.
  const [postUpgrade, setPostUpgrade] = useState<"none" | "steel" | "6x6">("none");
  // Line-post spacing, ft o.c. — null = the fence type's standard.
  // Prefab panel systems ignore it (fixed section widths).
  const [postSpacing, setPostSpacing] = useState<number | null>(null);
  const effSpacingFt =
    t.build === "panel" ? t.postSpacingFt : postSpacing ?? t.postSpacingFt;
  // Topo overlay: a coarse elevation lattice over the visible yard →
  // contour lines with ft labels on the layout canvas. One batched
  // Elevation call per scan; toggleable, on by default.
  // Building footprints (house/garage) — seeded from the scan's OSM
  // lookup, hand-traceable via the canvas House tool. They render in
  // the layout, the 3D and the client's proposal.
  const [buildings, setBuildings] = useState<{ x: number; y: number }[][]>([]);
  const [topoGrid, setTopoGrid] = useState<number[][] | null>(null);
  const [showTopo, setShowTopo] = useState(true);
  const [topoError, setTopoError] = useState<string | null>(null);
  const [topoNonce, setTopoNonce] = useState(0);
  const [view3d, setView3d] = useState(false);
  // The 3D camera the contractor last set — frozen into the proposal as
  // the client's opening view.
  const [cam3d, setCam3d] = useState<{ yawDeg: number; squash: number }>({
    yawDeg: -28,
    squash: 0.52,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ranFor = useRef<string | null>(null);


  /** The map was panned off-center — buy a fresh tile there and
   *  re-plot every overlay around the new center. County lines, pin
   *  and neighbours re-project from their lat/lng twins; the drawn
   *  fence/houses re-project through old-frame -> lat/lng -> new-frame
   *  so nothing the contractor drew moves an inch on the ground. */
  async function recenterMap(canvasCenter: { x: number; y: number }) {
    if (!scan) return;
    const old = scan;
    const centerLL = canvasToLatLng(canvasCenter, old.center, old.zoom);
    const res = await refetchAerialTile({ center: centerLL, zoom: old.zoom });
    if (!res.ok) return; // stay on the current tile — panning is best-effort
    const re = (p: { x: number; y: number }) =>
      latLngToCanvas(canvasToLatLng(p, old.center, old.zoom), centerLL, old.zoom);
    const reLL = (ll: { lat: number; lng: number }) => latLngToCanvas(ll, centerLL, old.zoom);
    setScan({
      ...old,
      center: centerLL,
      aerial: { ...old.aerial, imageDataUrl: res.imageDataUrl },
      parcelRings: (old.parcelRingsLL ?? []).map((ring) => ring.map(reLL)),
      suggestedRuns: old.suggestedRuns.map((r) => ({ ...r, points: r.points.map(re) })),
      neighborRings: (old.neighborInfo ?? []).map((n) => n.ringLL.map(reLL)),
      pin: old.pinLL ? reLL(old.pinLL) : re(old.pin),
    });
    setLayout((l) => ({
      runs: l.runs.map((r) => ({ ...r, points: r.points.map(re) })),
      gates: l.gates.map((g) => ({ ...g, ...re(g) })),
      sections: (l.sections ?? []).map((sec) => ({ ...sec, a: re(sec.a), b: re(sec.b) })),
    }));
    setBuildings((b) => b.map((ring) => ring.map(re)));
    // Terrain was sampled for the old frame — clear it; the topo effect
    // resamples for the new center automatically.
    setTopoGrid(null);
    setRunElevRaw(null);
  }

  /** A neighbour ring was clicked — rebuild the scan around THAT
   *  parcel. Same reset discipline as a fresh scan: stale topo or
   *  drawn runs must never survive a frame change. */
  async function pickNeighbor(index: number) {
    if (!scan) return;
    const info = scan.neighborInfo?.[index];
    if (!info) return;
    setScanState("loading");
    setScanError(null);
    const res = await reframeFenceScan({
      ringLL: info.ringLL,
      address: info.address,
      apn: info.apn,
      acres: info.acres,
      market: scan.market,
      displayAddress: scan.address,
    });
    if (!res.ok) {
      setScanState("error");
      setScanError(res.reason);
      return;
    }
    setScan(res);
    setLayout({ runs: [], gates: [] });
    setBuildings(res.buildings ?? []);
    setSlope(null);
    setSlopeError(null);
    setRunElevRaw(null);
    setTerrainAuto(true);
    setWallTop(false);
    setWallLfInput(null);
    // The PREVIOUS property's contours must never paint over the new
    // photo while the fresh lattice loads.
    setTopoGrid(null);
    setTopoError(null);
    setScanState("idle");
  }

  async function scanAddress(addr: string) {
    setScanState("loading");
    setScanError(null);
    const res = await runFenceScan(addr);
    if (!res.ok) {
      setScanState("error");
      setScanError(res.reason);
      return;
    }
    // Remember the scan under its geocoded display form so the history
    // reads clean even when the user typed a rough version.
    const remembered = res.address?.trim() || addr;
    pushLocalRecent(remembered);
    setRecents((prev) => mergeRecents([remembered, ...prev], readLocalRecents()));
    setScan(res);
    setLayout({ runs: [], gates: [] });
    setBuildings(res.buildings ?? []);
    setSlope(null);
    setSlopeError(null);
    setRunElevRaw(null);
    setTerrainAuto(true);
    setWallTop(false);
    setWallLfInput(null);
    // The PREVIOUS property's contours must never paint over the new
    // photo while the fresh lattice loads.
    setTopoGrid(null);
    setTopoError(null);
    setScanState("idle");
  }

  useEffect(() => {
    if (addressParam && ranFor.current !== addressParam) {
      ranFor.current = addressParam;
      void scanAddress(addressParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressParam]);

  // Address history for the scan bar: localStorage instantly, then the
  // server copy (every past successful scan, any device) merged in.
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(readLocalRecents());
    let cancelled = false;
    getRecentAddresses()
      .then((server) => {
        if (!cancelled) setRecents(mergeRecents(server, readLocalRecents()));
      })
      .catch(() => {
        // offline / cold DB — the local list is already showing
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the options honest when the type changes: height snaps to one
  // the new type comes in, stain only survives onto stainable wood, the
  // spacing override resets (8' o.c. cedar spacing means nothing to a
  // 10' o.c. chain-link run), and a post upgrade the new build can't
  // take (steel on already-steel, 6×6 on a type that ships 6×6) drops
  // to standard instead of riding invisibly into the proposal.
  useEffect(() => {
    if (!t.heightsFt.includes(heightFt)) setHeightFt(t.defaultHeightFt);
    setStain((s) => s && t.stainable);
    setPostSpacing(null);
    setPostUpgrade((u) => {
      if (u === "none") return u;
      if (t.category !== "wood") return "none";
      if (u === "6x6" && t.spec.postWidthIn >= 5.5) return "none";
      return u;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  // Building footprints are DRAWN, never guessed: the OSM auto-detect
  // that used to seed them misread sheds/neighbours often enough that it
  // hurt trust, and every wrong footprint became 3D noise. The canvas
  // House tool traces the real home in seconds when it's wanted.

  // Topo lattice: one 18×12 elevation grid per scan (216 points, one
  // batched call) → contour lines drawn over the satellite canvas.
  useEffect(() => {
    if (!scan) {
      setTopoGrid(null);
      return;
    }
    const rows: { lat: number; lng: number }[][] = [];
    for (let r = 0; r < TOPO_ROWS; r++) {
      const row: { lat: number; lng: number }[] = [];
      for (let c = 0; c < TOPO_COLS; c++) {
        row.push(
          canvasToLatLng(
            {
              x: (c * CANVAS_W) / (TOPO_COLS - 1),
              y: (r * CANVAS_H) / (TOPO_ROWS - 1),
            },
            scan.center,
            scan.zoom,
          ),
        );
      }
      rows.push(row);
    }
    let cancelled = false;
    let retryTimer: number | null = null;
    const attempt = (n: number) => {
      void sampleFenceElevations(rows).then((res) => {
        if (cancelled) return;
        if (res.ok && res.runElevationsFt.every((r) => r.length === TOPO_COLS)) {
          setTopoGrid(res.runElevationsFt);
          setTopoError(null);
        } else if (n < 2) {
          // transient failure — one quiet retry before surfacing it
          retryTimer = window.setTimeout(() => attempt(n + 1), 5000);
        } else {
          setTopoGrid(null);
          setTopoError(res.ok ? "incomplete terrain data" : res.reason);
        }
      });
    };
    attempt(1);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [scan, topoNonce]);

  // Terrain from the sky: sample elevation at every post position along
  // the drawn runs (debounced — one batched request per layout change).
  // BEFORE anything is drawn we still read the YARD: along the county
  // property line when we have it, else a cross-section of the visible
  // lot — so the ground story shows right after the scan. Fail-safe: no
  // elevation ⇒ the Ground picker simply stays manual.
  useEffect(() => {
    if (!scan) {
      setSlope(null);
      return;
    }
    const spacingPx = effSpacingFt * scan.canvasPxPerFt;
    const sources: { points: { x: number; y: number }[] }[] =
      layout.runs.length > 0
        ? layout.runs
        : scan.parcelRings.length > 0
          ? scan.parcelRings.map((ring) => ({ points: ring }))
          : [
              // no parcel: sample a horizontal + vertical slice of the yard
              { points: [{ x: 150, y: 290 }, { x: 750, y: 290 }] },
              { points: [{ x: 450, y: 120 }, { x: 450, y: 460 }] },
            ];
    const runsLatLng = sources.map((r) =>
      walkPostPositions(r.points, spacingPx).map((p) =>
        canvasToLatLng(p, scan.center, scan.zoom),
      ),
    );
    const timer = window.setTimeout(async () => {
      const res = await sampleFenceElevations(runsLatLng);
      if (!res.ok) {
        // Say WHY there's no terrain readout — a silent blank reads as
        // broken (and hides a fixable key/setup problem).
        setSlopeError(res.reason);
        setRunElevRaw(null);
        return;
      }
      setSlopeError(null);
      setSlopeFromRuns(layout.runs.length > 0);
      setRunElevRaw(
        layout.runs.length > 0
          ? { elevations: res.runElevationsFt, spacingPx }
          : null,
      );
      const summary = summarizeSlopes(
        res.runElevationsFt,
        effSpacingFt,
        heightFt,
        t.build,
        marketFrostIn(scan.market),
      );
      setSlope(summary);
      // Auto-apply the measured grade to the PRICE only once there is a
      // drawn fence to measure. The pre-draw yard read is information —
      // committing a 1.4× labor multiplier off two hardcoded canvas
      // cross-sections priced ground the fence may never touch.
      if (terrainAutoRef.current && layout.runs.length > 0)
        setTerrain(summary.suggestedTerrain);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.runs, scan, typeId, heightFt, effSpacingFt]);

  // Contours from the lattice, relative to the lot's low point (labels
  // read "+8′"). Null when the yard is too flat to contour.
  // Same pipeline the client's proposal canvas uses — one helper so the
  // working drawing and the deliverable can't disagree about the ground.
  const topoContours = useMemo(
    () =>
      contoursFromGrid(topoGrid, {
        cols: TOPO_COLS,
        rows: TOPO_ROWS,
        canvasW: CANVAS_W,
        canvasH: CANVAS_H,
      }),
    [topoGrid],
  );

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
  const gatesCustomWidthsFt = useMemo(
    () =>
      layout.gates
        .filter((g) => g.kind === "custom")
        .map((g) => g.widthFt ?? 6),
    [layout.gates],
  );
  // Mixed-type sections grouped by type — each stretch prices at its
  // own catalog rate and its LF comes out of the primary fence.
  const mixedByType = useMemo(() => {
    const byType = new Map<string, number>();
    for (const s of layout.sections ?? []) {
      if (!layout.runs.some((r) => r.id === s.runId)) continue;
      // A section marked as the fence's own type is a no-op, not a
      // carve-out — pricing it separately dropped its height factor and
      // duplicated its BOM block.
      if (s.type === typeId) continue;
      if (s.lfFt > 0) byType.set(s.type, (byType.get(s.type) ?? 0) + s.lfFt);
    }
    return [...byType].map(([type, lf]) => ({
      type: type as FenceTypeId,
      lf: Math.round(lf),
    }));
  }, [layout.sections, layout.runs, typeId]);
  const effRemoval = removalLf < 0 ? totalLf : removalLf; // -1 = "same as drawn"

  // Wall-top LF: manual entry wins; else the topo's sheer-drop estimate;
  // else NOTHING — the old fallback was the whole drawn fence, so one
  // checkbox click on a 300 LF job silently billed every post as a
  // core-drilled anchor. No measurement + no number = no charge until
  // the contractor types the span.
  const suggestedWallLf =
    slopeFromRuns && slope ? Math.round(slope.wallLikeLf) : 0;
  const effWallLf = wallTop
    ? Math.max(0, Math.min(totalLf || 9999, wallLfInput ?? suggestedWallLf))
    : 0;
  // Wall sections are mounts, not slope steps — don't double-charge.
  // Subtract the SPLIT step count those sections contributed, PRORATED
  // by how much of the wall-like span the contractor actually confirmed
  // (10 LF of wall on a 3-wall-section run must not erase all three
  // sections' steps).
  const wallStepShare =
    slope && slope.wallLikeLf > 0
      ? Math.min(1, effWallLf / slope.wallLikeLf)
      : 0;
  const effSteppedSections = slopeFromRuns
    ? Math.max(
        0,
        Math.round(
          (slope?.steppedSections ?? 0) -
            (wallTop ? (slope?.wallSteppedSections ?? 0) * wallStepShare : 0),
        ),
      )
    : 0;

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
      gatesCustomWidthsFt,
      terrain,
      wastePct: 10,
      removalLf: jobType === "replacement" ? effRemoval : 0,
      stain,
      steppedSections: effSteppedSections,
      wallTopLf: effWallLf,
      postUpgrade: postUpgrade === "none" ? undefined : postUpgrade,
      postSpacingFt: postSpacing ?? undefined,
      mixed: mixedByType.length > 0 ? mixedByType : undefined,
      // Local market resolved from the scanned address's state + ZIP —
      // scales every catalog rate and carries the local tax rule.
      market: scan?.market,
      // …and the contractor's own rates, which the market then scales.
      rates: rateBook,
    }),
    [typeId, heightFt, totalLf, runLengths, corners, ends, gatesSingle, gatesDouble, gatesCustomWidthsFt, terrain, effRemoval, stain, jobType, effSteppedSections, effWallLf, postUpgrade, postSpacing, mixedByType, scan?.market, rateBook],
  );

  const takeoff = useMemo(
    () => (totalLf > 0 ? computeFenceTakeoff(layoutInput) : null),
    [layoutInput, totalLf],
  );

  const tierPrices = useMemo(() => {
    if (totalLf === 0) return [];
    // Height rides along: siblings that don't come in this height fall
    // back to the base type inside fenceTiers, and the card label says
    // which height each tier actually quotes.
    return fenceTiers(typeId, heightFt).map((tier) => {
      const tierT = fenceType(tier.type);
      const tierH = nearestHeight(tierT, heightFt);
      return {
        tier,
        label: tierH === heightFt ? tierT.label : `${tierT.label} · ${tierH}'`,
        price: priceFence(
          // The user's stain choice applies to every stainable tier; Best
          // adds it regardless.
          { ...layoutInput, type: tier.type, stain: tier.stain || stain },
          { markupPct: tier.markupPct },
        ),
      };
    });
  }, [layoutInput, typeId, heightFt, totalLf]);

  // The tier the rail marks "recommended" — mirrored into the mobile
  // action bar so the number the contractor quotes is always on screen.
  const recommendedPrice = useMemo(() => {
    const pick =
      tierPrices.find((p) => p.tier.recommended) ?? tierPrices[0] ?? null;
    return pick
      ? { name: pick.tier.name, total: pick.price.total }
      : null;
  }, [tierPrices]);

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
      downspoutCount: gatesSingle + gatesDouble + gatesCustomWidthsFt.length,
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
      gateKind: g.kind,
      gateWidthFt: g.widthFt,
    }));
    const res = await saveDraftFromEstimate({
      address: scan.address,
      measurements,
      eaves,
      rakes: [],
      downspouts,
      aerial: scan.aerial,
      canvasPxPerFt: scan.canvasPxPerFt,
      runElevationsFt: runElevRaw?.elevations,
      elevationSpacingPx: runElevRaw?.spacingPx,
      topoGridFt: topoGrid ?? undefined,
      buildings: buildings.length > 0 ? buildings : undefined,
      view3d: cam3d,
      // Seed the proposal's 3D presentation from the drawn geometry:
      // an overview plus a face-on shot of each side the fence actually
      // covers, with whatever the contractor was looking at added as
      // the cover. They can re-cut the list in the proposal builder,
      // but the common case ships professional angles with no work.
      views3d: (() => {
        const seeded = addShot(
          {
            shots: suggestShots(layout.runs),
            interaction: "free" as const,
          },
          cam3d,
          null,
        );
        return { ...seeded, coverShotId: seeded.shots[seeded.shots.length - 1].id };
      })(),
      jobType,
      fence: {
        type: typeId,
        heightFt,
        terrain,
        stain,
        removalLf: layoutInput.removalLf,
        gatesSingle,
        gatesDouble,
        gatesCustomWidthsFt,
        corners,
        ends,
        steppedSections: effSteppedSections,
        wallTopLf: effWallLf,
        postUpgrade: postUpgrade === "none" ? undefined : postUpgrade,
        postSpacingFt: postSpacing ?? undefined,
        mixed: mixedByType.length > 0 ? mixedByType : undefined,
        market: scan.market,
        rates: rateBook,
      },
      fenceSections: layout.sections,
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

      {/* Bottom padding on small screens clears the sticky action bar. */}
      <main className="mx-auto max-w-[1500px] px-4 py-5 pb-28 sm:px-6 lg:pb-5">
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
              <AddressAutocompleteInput
                value={address}
                onChange={setAddress}
                onPick={(addr) => {
                  setAddress(addr);
                  void scanAddress(addr);
                }}
                recents={recents}
                onRemoveRecent={(addr) => {
                  removeLocalRecent(addr);
                  setRecents((prev) =>
                    prev.filter((a) => a.toLowerCase() !== addr.toLowerCase()),
                  );
                }}
                placeholder="123 Property Ln, Austin, TX"
                autoFocus
                className="flex-1"
              />
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
              <div className="mb-2 flex items-center gap-2">
                <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
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
                {!view3d && topoContours && (
                  <button
                    type="button"
                    onClick={() => setShowTopo((s) => !s)}
                    className={cn(
                      "transition-smooth ring-focus rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset",
                      showTopo
                        ? "bg-amber-50 text-amber-800 ring-amber-200"
                        : "bg-white text-zinc-500 ring-zinc-200 hover:text-zinc-800",
                    )}
                  >
                    Topo {showTopo ? "on" : "off"}
                  </button>
                )}
                {!topoGrid && topoError && (
                  <button
                    type="button"
                    title={topoError}
                    onClick={() => setTopoNonce((n) => n + 1)}
                    className="transition-smooth ring-focus rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
                  >
                    Terrain read failed — retry
                  </button>
                )}
                {view3d && (
                  <span className="hidden text-[11px] font-medium text-zinc-400 sm:inline">
                    Drag to spin — the angle you leave it at becomes the
                    client&apos;s opening view.
                  </span>
                )}
              </div>
              {view3d ? (
                <Fence3D
                  runs={layout.runs}
                  gates={layout.gates}
                  heightFt={heightFt}
                  typeId={typeId}
                  pxPerFt={scan.canvasPxPerFt}
                  parcelRings={scan.parcelRings}
                  runElevationsFt={runElevRaw?.elevations}
                  elevationSpacingPx={runElevRaw?.spacingPx}
                  topoGridFt={topoGrid}
                  buildings={buildings}
                  sections={layout.sections}
                  retainingWall={effWallLf > 0}
                  postUpgrade={postUpgrade === "none" ? undefined : postUpgrade}
                  postSpacingFt={effSpacingFt}
                  initialView={cam3d}
                  onViewChange={setCam3d}
                  className="aspect-[16/10]"
                />
              ) : (
                <FenceCanvas
                  scan={scan}
                  layout={layout}
                  onChange={setLayout}
                  topo={showTopo ? topoContours : null}
                  buildings={buildings}
                  onBuildingsChange={setBuildings}
                  onPickNeighbor={pickNeighbor}
                  onRecenter={recenterMap}
                />
              )}
              {scan.parcel && (
                <p className="mt-2 text-xs text-zinc-400">
                  County record:{" "}
                  <span className="font-medium text-zinc-600">
                    {scan.parcel.address ?? "address not on file"}
                  </span>
                  {scan.parcel.apn && (
                    <>
                      {" · APN "}
                      <span className="font-mono font-medium text-zinc-600">
                        {scan.parcel.apn}
                      </span>
                    </>
                  )}
                  {scan.parcel.acres ? ` · ${scan.parcel.acres.toFixed(2)} acres` : ""}
                  {" — recently split or merged lots can lag the county map. Verify on site before digging."}
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
                  <span className="font-label text-zinc-500">Posts</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "none", label: "Standard" },
                        { id: "steel", label: "Steel (+$/post)" },
                        { id: "6x6", label: "6×6 PT (+$/post)" },
                      ] as const
                    )
                      // Upgrades exist only where the base build can
                      // take them: wood fences on standard 4×4 stock.
                      // Chain link and ornamental are already steel,
                      // vinyl rails route through vinyl posts, and
                      // horizontal-modern ships on 6×6 as standard —
                      // offering "+6×6" there charged for the base spec.
                      .filter(
                        (o) =>
                          o.id === "none" ||
                          (t.category === "wood" &&
                            !(o.id === "6x6" && t.spec.postWidthIn >= 5.5)),
                      )
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setPostUpgrade(o.id)}
                          className={cn(
                            "transition-smooth ring-focus rounded-full border px-2.5 py-1.5 text-xs font-medium",
                            postUpgrade === o.id
                              ? "border-accent-500 bg-accent-50 text-accent-900"
                              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                  </div>
                  {t.category !== "wood" && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      {t.category === "vinyl"
                        ? "Vinyl systems use routed vinyl posts — the rails lock through them."
                        : t.category === "chain-link"
                          ? "Chain link already stands on galvanized steel posts."
                          : t.category === "split-rail"
                            ? "Split rail posts are mortised for the rails — the stock is the system."
                            : "Ornamental fences already ship on steel posts."}
                    </p>
                  )}
                  {postUpgrade === "steel" && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      Galvanized steel posts never rot, warp or lean — the
                      panels stay wood. Priced per post in the estimate.
                    </p>
                  )}
                </div>

                <div className="mt-3">
                  <span className="font-label text-zinc-500">Post spacing</span>
                  {t.build === "panel" ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      {t.label} installs as prefab {t.postSpacingFt}&apos;
                      panels — spacing is fixed by the section width.
                    </p>
                  ) : t.build === "rail" ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      {t.label} spacing is set by the rail stock itself —
                      the {t.postSpacingFt}&apos; rails span post to post.
                    </p>
                  ) : (
                    <>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {/* Stick builds cap at 8' — that's what a 2×4
                            rail spans; mesh runs out to 10'. */}
                        {(t.build === "stick"
                          ? ([null, 4, 6, 8] as const)
                          : ([null, 4, 6, 8, 10] as const)
                        ).map((o) => (
                          <button
                            key={String(o)}
                            type="button"
                            onClick={() => setPostSpacing(o)}
                            className={cn(
                              "transition-smooth ring-focus rounded-full border px-2.5 py-1.5 text-xs font-medium",
                              postSpacing === o
                                ? "border-accent-500 bg-accent-50 text-accent-900"
                                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                            )}
                          >
                            {o === null ? `Standard (${t.postSpacingFt}′)` : `${o}′`}
                          </button>
                        ))}
                      </div>
                      {postSpacing !== null && postSpacing !== t.postSpacingFt && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                          {postSpacing < t.postSpacingFt
                            ? `Tighter than the ${t.postSpacingFt}′ standard — more posts and a stiffer fence; the price, takeoff and 3D all update to match.`
                            : `Wider than the ${t.postSpacingFt}′ standard — fewer posts; check your rail stock spans ${postSpacing}′.`}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-3">
                  <span className="flex items-center gap-1.5 font-label text-zinc-500">
                    Ground
                    {terrainAuto && slope && (
                      <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-700 ring-1 ring-inset ring-accent-200">
                        auto
                      </span>
                    )}
                    {!terrainAuto && slope && (
                      /* Once a manual pick is made there was no road
                         back to the measured suggestion — re-arm auto
                         and apply the measured grade right away. */
                      <button
                        type="button"
                        onClick={() => {
                          setTerrainAuto(true);
                          if (layout.runs.length > 0)
                            setTerrain(slope.suggestedTerrain);
                        }}
                        className="transition-smooth rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-200 hover:bg-accent-50 hover:text-accent-700"
                      >
                        back to auto
                      </button>
                    )}
                  </span>
                  <select
                    value={terrain}
                    onChange={(e) => {
                      setTerrain(e.target.value as Terrain);
                      setTerrainAuto(false);
                    }}
                    className="input mt-1.5 w-full"
                  >
                    {(Object.keys(TERRAIN_LABEL) as Terrain[]).map((k) => (
                      <option key={k} value={k}>
                        {TERRAIN_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {slopeError && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200">
                      Terrain reading unavailable: {slopeError}
                    </p>
                  )}
                  {slope && slope.runs.length > 0 && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-zinc-50 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600 ring-1 ring-inset ring-zinc-200">
                      <Mountain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" />
                      <span>
                        {layout.runs.length === 0 ? "Yard grade" : "Grade"}{" "}
                        {slope.avgGradePct}% avg · {slope.maxGradePct}% max.{" "}
                        {layout.runs.length > 0 && slope.steppedSections > 0 ? (
                          <>
                            <strong>{slope.steppedSections}</strong>{" "}
                            {slope.steppedSections === 1 ? "step" : "steps"} down
                            the slope (each ≤ 1&apos; so the top line stays at
                            code height) — {slope.stepPostLengthFt}&apos; posts
                            there, {slope.basePostLengthFt}&apos; elsewhere.
                          </>
                        ) : (
                          <>Racks with the grade — {slope.basePostLengthFt}&apos; posts throughout.</>
                        )}
                        {layout.runs.length > 0 && slope.rackedExtraLf >= 1 && (
                          <>
                            {" "}Racked bays follow the ground, so the true
                            fabric length runs ≈{" "}
                            <strong>+{Math.round(slope.rackedExtraLf)} LF</strong>{" "}
                            over the map length — inside your waste factor.
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  {jobType === "replacement" && (
                    <>
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
                      {effRemoval > 0 && (
                        <div className="flex items-center gap-2 pl-6">
                          <input
                            type="number"
                            min={0}
                            max={9999}
                            value={Math.round(effRemoval)}
                            onChange={(e) =>
                              setRemovalLf(
                                Math.max(0, Math.min(9999, Number(e.target.value) || 0)),
                              )
                            }
                            className="input w-24 py-1"
                          />
                          <span className="text-xs text-zinc-500">
                            LF of old fence coming out — often only part of
                            the new run
                          </span>
                        </div>
                      )}
                    </>
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
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wallTop}
                      onChange={(e) => setWallTop(e.target.checked)}
                      className="h-4 w-4 accent-[#1E7340]"
                    />
                    <span className="text-zinc-700">
                      Fence sits on a retaining wall
                    </span>
                  </label>
                  {wallTop && (
                    <div className="pl-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={totalLf || 9999}
                          value={Math.round(effWallLf)}
                          onChange={(e) =>
                            // Clamp on WRITE — an un-clamped value kept in
                            // state used to jump the charge up later when
                            // the fence got longer.
                            setWallLfInput(
                              Math.max(
                                0,
                                Math.min(totalLf || 9999, Number(e.target.value) || 0),
                              ),
                            )
                          }
                          className="input w-24 py-1"
                        />
                        <span className="text-xs text-zinc-500">
                          LF of fence on the wall
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                        Posts on the wall are core-drilled & epoxy-anchored to
                        the cap — no digging, priced per post.
                        {effWallLf === 0 &&
                          " Enter the span — nothing is charged until a length is set."}
                      </p>
                    </div>
                  )}
                  {!wallTop && suggestedWallLf > 0 && layout.runs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setWallTop(true);
                        setWallLfInput(suggestedWallLf);
                      }}
                      className="transition-smooth w-full rounded-lg bg-amber-50 px-2.5 py-2 text-left text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
                    >
                      Sharp drop measured on ~{suggestedWallLf} LF — retaining
                      wall? Tap to price wall-top mounting (core-drilled
                      anchors).
                    </button>
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
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-label text-zinc-500">Price options</h3>
                    {scan?.market && scan.market.resolution !== "national" && (
                      <span className="text-[11px] font-medium text-zinc-500">
                        {scan.market.label} rates
                      </span>
                    )}
                  </div>
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
                  {/* Where these numbers come from. Contractors get asked
                      "why is this more than the guy down the road" — this
                      is the answer, in the contractor's own hands. */}
                  {scan?.market && (
                    <details className="group mt-1">
                      <summary className="cursor-pointer list-none text-[11px] font-medium text-zinc-500 hover:text-zinc-800">
                        How this market is priced
                        <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                          ›
                        </span>
                      </summary>
                      <ul className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3 text-[11px] leading-relaxed text-zinc-500">
                        {scan.market.basis.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </details>
                  )}
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
                  <Fence className="h-4 w-4" />
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

      {/* Phone/tablet action bar. On a small screen the pricing rail sits
          a long scroll below the aerial, so the live total and the way
          forward follow the contractor down the page instead of making
          them hunt for the button after every edit. */}
      {scan && totalLf > 0 && (
        <div className="anim-enter-fade fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold tabular-nums text-zinc-900">
                {totalLf} LF
                <span className="font-medium text-zinc-400">
                  {" · "}
                  {layout.gates.length}{" "}
                  {layout.gates.length === 1 ? "gate" : "gates"}
                </span>
              </div>
              <div className="truncate text-[11px] text-zinc-500">
                {recommendedPrice
                  ? `${recommendedPrice.name} — ${fmt(recommendedPrice.total)}`
                  : `${t.label} · ${heightFt}′`}
              </div>
            </div>
            <Button
              onClick={buildProposal}
              disabled={!takeoff || saving}
              className="h-11 shrink-0 px-4"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fence className="h-4 w-4" />
              )}
              Build proposal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
