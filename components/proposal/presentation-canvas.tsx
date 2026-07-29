"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AerialImage,
  AerialBackground,
  BlueprintBackground,
  NeonDefs,
  VIEWBOX_W,
  VIEWBOX_H,
  pathFor,
  lineLengthFt,
  RoofStructureOverlay,
  orientationChipBoxes,
} from "@/components/estimate/aerial-shared";
import {
  layoutLabels,
  type LabelBox,
  type PlacedLabel,
} from "@/lib/diagram-labels";
import type { Downspout, EditableLine, RoofStructure } from "@/lib/types";
import { cornerFlags } from "@/lib/fence/geo";
import { FENCE_TYPES, fenceType, type FenceTypeId } from "@/lib/fence/catalog";

/**
 * Proposal-quality canvas. Same data shape as AerialCanvas but stripped
 * of the editor chrome:
 *   - No toolbar, no theme toggle, no layers panel.
 *   - Eaves render as a thin, even royal-blue stroke with a soft glow (no
 *     animated draw-in — clients see a finished drawing).
 *   - Rakes render as gray-dashed "no gutter" lines, also non-glowing.
 *   - Downspouts are small pinned dots — no pulsing halo. The pulse
 *     made sense in the editor as a "look here, AI placed this" cue;
 *     in the proposal it just creates visual chaos with 8+ markers.
 *   - LF labels show only on eaves ≥ 8 ft so short connector segments
 *     don't stack on top of each other; selected eaves always label.
 *   - Vertex handles fade in only when the eave is hovered or selected
 *     — so the drawing reads clean by default, but the contractor can
 *     still drag a corner to nudge it onto the real roof edge.
 */
/** Indices that bound corner-to-corner spans of a run: both endpoints
 *  plus every angle-aware corner vertex. Near-collinear vertices are
 *  NOT boundaries — a "segment" runs turn to turn, exactly as a crew
 *  would think of it. */
function spanBounds(points: { x: number; y: number }[]): number[] {
  const flags = cornerFlags(points);
  const out = [0];
  for (let i = 1; i < points.length - 1; i++) if (flags[i]) out.push(i);
  out.push(points.length - 1);
  return out;
}

function nearestSegIndex(
  points: { x: number; y: number }[],
  p: { x: number; y: number },
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Overlay color per catalog category — how a mixed stretch reads on
 *  the photo (matches the estimator canvas palette). */
const SECTION_COLORS: Record<string, string> = {
  wood: "#D97706",
  vinyl: "#F1F5F9",
  "chain-link": "#A1A1AA",
  aluminum: "#475569",
  steel: "#334155",
  "split-rail": "#B45309",
};

const FALLBACK_PX_PER_FT = 2.4;

type SectionIn = { a: { x: number; y: number }; b: { x: number; y: number }; type: string; lfFt?: number };

function cumArcs(points: { x: number; y: number }[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return out;
}

/** Arc distance of the closest point on the polyline + how far off it is. */
function projectArc(
  points: { x: number; y: number }[],
  p: { x: number; y: number },
): { arc: number; dist: number } {
  let bestArc = 0;
  let bestDist = Infinity;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const len2 = len * len;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < bestDist) {
      bestDist = d;
      bestArc = acc + len * t;
    }
    acc += len;
  }
  return { arc: bestArc, dist: bestDist };
}

/** Slice a polyline between two arc distances (vertices kept). */
function slicePolyline(
  points: { x: number; y: number }[],
  d0: number,
  d1: number,
): { x: number; y: number }[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const out: { x: number; y: number }[] = [];
  const at = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > 0 && acc + L > lo && acc < hi) {
      const t0 = Math.max(0, (lo - acc) / L);
      const t1 = Math.min(1, (hi - acc) / L);
      if (out.length === 0) out.push(at(a, b, t0));
      out.push(at(a, b, t1));
    }
    acc += L;
  }
  return out;
}

export function PresentationCanvas({
  eaves,
  rakes = [],
  downspouts,
  roofStructure,
  onEavesChange,
  onDownspoutsChange,
  aerialImageUrl,
  planMode,
  pxPerFt,
  buildings,
  onBuildingsChange,
  fenceSections,
  onFenceSectionsChange,
}: {
  eaves: EditableLine[];
  rakes?: EditableLine[];
  downspouts: Downspout[];
  /** Roof outline + ridge/hip/valley lines, drawn under the trace so the
   *  full roof shape reads on the proposal. Plan takeoffs only. */
  roofStructure?: RoofStructure;
  /** Optional — when omitted, the canvas renders strictly read-only
   *  (no drag handles ever). Provide to allow vertex/downspout nudges. */
  onEavesChange?: (next: EditableLine[]) => void;
  onDownspoutsChange?: (next: Downspout[]) => void;
  aerialImageUrl?: string;
  /** Plan-based takeoffs use a drafting-paper background instead of
   *  the cartoon yard scene. The cartoon makes sense on satellite-
   *  derived estimates (it's a fallback when imagery didn't load) but
   *  is visually wrong on plan-based proposals — the gutter trace was
   *  extracted from architectural plans, not from a satellite tile, so
   *  drawing it on a cartoon roof looks fake. */
  planMode?: boolean;
  /** Satellite trace's canvas-px-per-foot (from the takeoff). Omit for
   *  plan takeoffs — lineLengthFt falls back to PX_PER_FT. */
  pxPerFt?: number;
  /** FenceScan: building footprints (canvas coords). With
   *  onBuildingsChange, the contractor can trace the house right here —
   *  it then shows in the client's diagram + 3D. */
  buildings?: { x: number; y: number }[][];
  onBuildingsChange?: (next: { x: number; y: number }[][]) => void;
  /** FenceScan: mixed-type stretches (a different fence from here to
   *  here). Rendered as colored overlays; with onFenceSectionsChange,
   *  selecting a span shows a type picker to build that stretch as
   *  another fence — priced + drawn everywhere. */
  fenceSections?: SectionIn[] | null;
  onFenceSectionsChange?: (next: SectionIn[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // viewBox units per CSS pixel — 1 on a full-width desktop canvas, ~2.6
  // when the same 900-unit drawing is rendered on a phone. Feeds `vs` so
  // strokes, handles and dimension labels keep a constant on-screen size.
  const [deviceScale, setDeviceScale] = useState(1);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setDeviceScale(VIEWBOX_W / w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Segment-level selection: clicking a run activates only the span
  // between two turns; clicking a corner activates BOTH adjacent spans
  // and makes that corner draggable. a/b are raw vertex indices.
  const [segSel, setSegSel] = useState<
    { id: string; a: number; b: number; corner?: number } | null
  >(null);
  const [houseMode, setHouseMode] = useState(false);
  const [houseDraft, setHouseDraft] = useState<{ x: number; y: number }[]>([]);
  const editable = !!(onEavesChange || onDownspoutsChange);
  const [drag, setDrag] = useState<
    | { kind: "vertex"; lineId: string; index: number }
    | { kind: "downspout"; id: string }
    | null
  >(null);

  const totalEaveLF = useMemo(
    () => Math.round(eaves.reduce((acc, l) => acc + lineLengthFt(l, pxPerFt), 0)),
    [eaves, pxPerFt],
  );

  // Enlarge a small trace to fill the canvas in plan mode. A correctly-
  // sized house is only ~150 px wide at the fixed 2.4 px/ft layout scale,
  // so it otherwise renders as a tiny dot in the 900×580 frame. Unlike the
  // editor (which zooms the camera), the proposal canvas keeps the viewBox
  // full so the drafting-paper FRAME, registration marks and title block —
  // all anchored to the frame edges — stay intact; we scale only the
  // geometry group about its centroid. Satellite proposals are left alone:
  // their trace is calibrated to the imagery.
  const frame = useMemo(() => {
    if (!planMode) return null;
    const pts = [
      ...eaves.flatMap((l) => l.points),
      ...rakes.flatMap((l) => l.points),
      ...downspouts.map((d) => ({ x: d.x, y: d.y })),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let n = 0;
    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      n++;
    }
    if (n < 2) return null;
    const cw = maxX - minX;
    const ch = maxY - minY;
    if (cw <= 1 && ch <= 1) return null;
    // Fit into the frame interior (inset so the trace sits inside the
    // drafting border), with a little breathing room around the content.
    const pad = 1.16;
    const targetW = VIEWBOX_W * 0.86;
    const targetH = VIEWBOX_H * 0.86;
    const k0 = Math.min(
      targetW / (Math.max(cw, 1) * pad),
      targetH / (Math.max(ch, 1) * pad),
    );
    // Only ever enlarge, and cap magnification so a tiny trace doesn't
    // blow up into fat strokes. Already-large traces (k≈1) are skipped.
    const k = Math.max(1, Math.min(k0, 3));
    if (k <= 1.02) return null;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { k, tx: VIEWBOX_W / 2 - k * cx, ty: VIEWBOX_H / 2 - k * cy };
  }, [planMode, eaves, rakes, downspouts]);
  // Geometry is rendered inside a group scaled by `frame.k`. Stroke
  // widths, handles, dots and labels are sized in viewBox units, so divide
  // them by k (multiply by `vs`) to keep them visually constant on screen
  // instead of fattening with the magnification.
  // …and multiply by how much the 900-unit viewBox is being squeezed to
  // fit the screen. On a phone this canvas renders ~340 CSS px wide, so a
  // "40 ft" label sized 9 viewBox units comes out under 4 CSS px — the
  // measurements the whole proposal rests on, unreadable on the device
  // most clients open it with. Capped so labels can't swamp the trace.
  const vs = (frame ? 1 / frame.k : 1) * Math.min(2.2, Math.max(1, deviceScale));
  const geomTransform = frame
    ? `translate(${frame.tx} ${frame.ty}) scale(${frame.k})`
    : undefined;

  // Center of the traced footprint — LF labels kick AWAY from this so they
  // land outside the outline (never across the roof interior, where they
  // crossed the derived hip/ridge lines).
  const eavesCentroid = useMemo(() => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const l of eaves) {
      for (const p of l.points) {
        sx += p.x;
        sy += p.y;
        n++;
      }
    }
    if (n === 0) return { x: VIEWBOX_W / 2, y: VIEWBOX_H / 2 };
    return { x: sx / n, y: sy / n };
  }, [eaves]);

  // Client-readable downspout numbering: 1..N walking clockwise around the
  // house from the top-left, so the pins read as an ordered walk-around
  // (and match a count, "12 downspouts") instead of random dots.
  const dropNumber = useMemo(() => {
    if (downspouts.length === 0) return new Map<string, number>();
    let cx = 0;
    let cy = 0;
    for (const d of downspouts) {
      cx += d.x;
      cy += d.y;
    }
    cx /= downspouts.length;
    cy /= downspouts.length;
    const start = (-Math.PI * 3) / 4; // top-left
    const key = (d: Downspout) =>
      (Math.atan2(d.y - cy, d.x - cx) - start + Math.PI * 2) % (Math.PI * 2);
    const sorted = [...downspouts].sort((a, b) => key(a) - key(b));
    return new Map(sorted.map((d, i) => [d.id, i + 1]));
  }, [downspouts]);

  // Drop-height policy: on most houses every downspout drops the same
  // height, and 12 identical "10′" pills are pure noise. Show the common
  // height ONCE (in the totals pill) and badge only the OUTLIERS — the
  // porch drop at 10′ on a 20′ house is exactly what deserves a callout.
  const heightInfo = useMemo(() => {
    const hs = downspouts
      .map((d) => Math.round(d.heightFt))
      .filter((h) => h > 0);
    if (hs.length === 0) return { mode: 0, uniform: false };
    const counts = new Map<number, number>();
    for (const h of hs) counts.set(h, (counts.get(h) ?? 0) + 1);
    let mode = hs[0];
    let best = 0;
    for (const [h, c] of counts) {
      if (c > best) {
        mode = h;
        best = c;
      }
    }
    return { mode, uniform: counts.size === 1 && hs.length === downspouts.length };
  }, [downspouts]);

  /* ----- Mixed-type stretches (a different fence from here to here) ----- */
  const effPxPerFt = pxPerFt ?? FALLBACK_PX_PER_FT;
  const sectionViews = useMemo(() => {
    if (!fenceSections || fenceSections.length === 0) return [];
    return fenceSections
      .map((sec, i) => {
        // match the stretch to the eave line its endpoints sit on
        let best: { line: EditableLine; a: number; b: number; score: number } | null = null;
        for (const l of eaves) {
          if (l.points.length < 2) continue;
          const pa = projectArc(l.points, sec.a);
          const pb = projectArc(l.points, sec.b);
          const score = pa.dist + pb.dist;
          if (!best || score < best.score) best = { line: l, a: pa.arc, b: pb.arc, score };
        }
        if (!best || best.score > 90) return null;
        const aArc = Math.min(best.a, best.b);
        const bArc = Math.max(best.a, best.b);
        const pts = slicePolyline(best.line.points, aArc, bArc);
        if (pts.length < 2) return null;
        const t = fenceType(sec.type as FenceTypeId);
        const lfFt = Math.max(1, Math.round((bArc - aArc) / effPxPerFt));
        return {
          key: `sec-${i}`,
          sec,
          lineId: best.line.id,
          aArc,
          bArc,
          pts,
          lfFt,
          color: SECTION_COLORS[t.category] ?? "#94A3B8",
          label: `${t.label} · ${lfFt}′`,
          mid: pts[Math.floor(pts.length / 2)],
        };
      })
      .filter(Boolean) as {
      key: string;
      sec: SectionIn;
      lineId: string;
      aArc: number;
      bArc: number;
      pts: { x: number; y: number }[];
      lfFt: number;
      color: string;
      label: string;
      mid: { x: number; y: number };
    }[];
  }, [fenceSections, eaves, effPxPerFt]);

  // The picker that appears over a selected span: what this stretch is
  // built as. "Main fence" clears it; any other type marks the stretch.
  const spanPicker = useMemo(() => {
    if (!segSel || !onFenceSectionsChange || !editable) return null;
    const line = eaves.find((l) => l.id === segSel.id);
    if (!line || line.points.length < 2) return null;
    const cums = cumArcs(line.points);
    const aArc = cums[Math.min(segSel.a, cums.length - 1)];
    const bArc = cums[Math.min(segSel.b, cums.length - 1)];
    if (bArc - aArc < 6) return null;
    const midSlice = slicePolyline(line.points, (aArc + bArc) / 2 - 1, (aArc + bArc) / 2 + 1);
    const mid = midSlice[0] ?? line.points[segSel.a];
    const cur = sectionViews.find(
      (sv) => sv.lineId === line.id && sv.aArc < bArc - 2 && sv.bArc > aArc + 2,
    );
    return { line, aArc, bArc, mid, current: cur ? cur.sec.type : "" };
  }, [segSel, eaves, sectionViews, editable, onFenceSectionsChange]);

  const applySpanType = (typeId: string) => {
    if (!spanPicker || !onFenceSectionsChange) return;
    const { line, aArc, bArc } = spanPicker;
    const overlapped = new Set(
      sectionViews
        .filter((sv) => sv.lineId === line.id && sv.aArc < bArc - 2 && sv.bArc > aArc + 2)
        .map((sv) => sv.sec),
    );
    // keep everything that isn't being replaced, refreshing lfFt from
    // the matched geometry so pricing always sums real footage
    const next: SectionIn[] = (fenceSections ?? [])
      .filter((sec) => !overlapped.has(sec))
      .map((sec) => {
        const sv = sectionViews.find((v) => v.sec === sec);
        return sv ? { ...sec, lfFt: sv.lfFt } : sec;
      });
    if (typeId) {
      const slice = slicePolyline(line.points, aArc, bArc);
      if (slice.length >= 2) {
        next.push({
          a: slice[0],
          b: slice[slice.length - 1],
          type: typeId,
          lfFt: Math.max(1, Math.round((bArc - aArc) / effPxPerFt)),
        });
      }
    }
    onFenceSectionsChange(next);
  };


  // Miter markers — tiny drafting diamonds where two runs meet, tying the
  // "N gutter miters" stat to visible corners on the drawing. Interior
  // vertices of a jogging run count, and so do coincident endpoints of two
  // separate runs. Skipped near a downspout pin (the pin covers them).
  const miterPts = useMemo(() => {
    if (!planMode) return [] as { x: number; y: number }[];
    const pts: { x: number; y: number }[] = [];
    for (const l of eaves) {
      for (let i = 1; i < l.points.length - 1; i++) pts.push(l.points[i]);
    }
    const ends = eaves
      .filter((l) => l.points.length >= 2)
      .flatMap((l) => [l.points[0], l.points[l.points.length - 1]]);
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) <= 3) {
          pts.push({
            x: (ends[i].x + ends[j].x) / 2,
            y: (ends[i].y + ends[j].y) / 2,
          });
        }
      }
    }
    const out: { x: number; y: number }[] = [];
    for (const p of pts) {
      if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 3)) continue;
      if (downspouts.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 7 * vs))
        continue;
      out.push(p);
    }
    return out;
  }, [planMode, eaves, downspouts, vs]);

  // Global label layout (plan mode): start every LF pill outward off its
  // run, then relax collisions away — pills can't cover each other, a
  // downspout pin, an orientation chip, or cross another run. Labels that
  // had to travel get a thin leader back to their run.
  const labelLayout = useMemo(() => {
    if (!planMode) return null;
    const items: LabelBox[] = [];
    const anchors = new Map<string, { x: number; y: number }>();
    for (const line of eaves) {
      if (line.points.length < 2) continue;
      const len = Math.round(lineLengthFt(line, pxPerFt));
      if (len < 8) continue; // mirrors LABEL_MIN_FT below
      const a = line.points[0];
      const b = line.points[line.points.length - 1];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const nl = Math.hypot(dx, dy) || 1;
      let nx = -dy / nl;
      let ny = dx / nl;
      if ((mx - eavesCentroid.x) * nx + (my - eavesCentroid.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      const off = 15 * vs;
      items.push({
        id: line.id,
        cx: mx + nx * off,
        cy: my + ny * off,
        w: 42 * vs,
        h: 15 * vs,
      });
      anchors.set(line.id, { x: mx, y: my });
    }
    // Outlier drop-height badges ride through the same solver.
    for (const d of downspouts) {
      if (!(d.heightFt > 0)) continue;
      if (Math.round(d.heightFt) === heightInfo.mode) continue;
      items.push({
        id: `dsh-${d.id}`,
        cx: d.x + 26 * vs,
        cy: d.y - 11 * vs,
        w: 44 * vs,
        h: 13 * vs,
      });
      anchors.set(`dsh-${d.id}`, { x: d.x, y: d.y });
    }
    const segments = [...eaves, ...rakes].flatMap((l) =>
      l.points.slice(1).map((p, i) => ({ a: l.points[i], b: p, pad: 2.5 * vs })),
    );
    const discs = downspouts.map((d) => ({ x: d.x, y: d.y, r: 10 * vs }));
    const rects = (
      roofStructure
        ? orientationChipBoxes(eaves, roofStructure.perimeter, vs)
        : []
    ).map((c) => ({ cx: c.at.x, cy: c.at.y, w: c.w, h: c.h }));
    // Frame interior, mapped into geometry coords when the trace is
    // magnified (the pills render inside the scaled group).
    const pad = 18;
    const bounds = frame
      ? {
          minX: (pad - frame.tx) / frame.k,
          minY: (pad - frame.ty) / frame.k,
          maxX: (VIEWBOX_W - pad - frame.tx) / frame.k,
          maxY: (VIEWBOX_H - pad - frame.ty) / frame.k,
        }
      : { minX: pad, minY: pad, maxX: VIEWBOX_W - pad, maxY: VIEWBOX_H - pad };
    return {
      placed: layoutLabels(
        items,
        { segments, discs, rects },
        { bounds, gap: 3 * vs },
      ),
      anchors,
    };
  }, [
    planMode,
    eaves,
    rakes,
    downspouts,
    roofStructure,
    vs,
    frame,
    pxPerFt,
    eavesCentroid,
    heightInfo,
  ]);

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    // svgPoint gives full-viewBox coords; the geometry lives inside a
    // group scaled by `frame.k`, so map the pointer back into that local
    // space before writing it as a data coordinate (otherwise the dragged
    // corner jumps by the magnification factor).
    const raw = svgPoint(e);
    const p = frame
      ? { x: (raw.x - frame.tx) / frame.k, y: (raw.y - frame.ty) / frame.k }
      : raw;
    if (drag.kind === "vertex" && onEavesChange) {
      onEavesChange(
        eaves.map((l) =>
          l.id === drag.lineId
            ? {
                ...l,
                points: l.points.map((pt, i) => (i === drag.index ? p : pt)),
              }
            : l,
        ),
      );
    } else if (drag.kind === "downspout" && onDownspoutsChange) {
      onDownspoutsChange(
        downspouts.map((d) => (d.id === drag.id ? { ...d, x: p.x, y: p.y } : d)),
      );
    }
  }

  function handlePointerUp() {
    setDrag(null);
  }

  const finishHouse = () => {
    setHouseDraft((d) => {
      if (d.length >= 3 && onBuildingsChange) {
        onBuildingsChange([...(buildings ?? []), d]);
      }
      return [];
    });
    setHouseMode(false);
  };

  function handleBackgroundClick(e: React.PointerEvent) {
    if (houseMode && onBuildingsChange) {
      const raw = svgPoint(e);
      const p = frame
        ? { x: (raw.x - frame.tx) / frame.k, y: (raw.y - frame.ty) / frame.k }
        : raw;
      // clicking back on the first corner closes the outline
      if (
        houseDraft.length >= 3 &&
        Math.hypot(p.x - houseDraft[0].x, p.y - houseDraft[0].y) < 14
      ) {
        finishHouse();
        return;
      }
      setHouseDraft((d) => [...d, p]);
      return;
    }
    setSelectedId(null);
    setSegSel(null);
  }

  // Keyboard while tracing: Enter closes, Esc cancels, Backspace steps.
  useEffect(() => {
    if (!houseMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHouseDraft([]);
        setHouseMode(false);
      } else if (e.key === "Enter" && houseDraft.length >= 3) {
        finishHouse();
      } else if (e.key === "Backspace" && houseDraft.length > 0) {
        e.preventDefault();
        setHouseDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseMode, houseDraft.length, buildings]);

  // Smart label gate: skip eaves shorter than 8 ft unless hovered or
  // selected. Keeps a clean look on roofs with many short connector
  // jogs (the existing canvas showed labels at 6 ft and they stacked).
  const LABEL_MIN_FT = 8;

  return (
    <div
      className={
        "relative h-full w-full overflow-hidden rounded-2xl ring-1 " +
        (planMode
          ? "bg-[#f7f4ee] ring-indigo-200/40"
          : "bg-slate-950 ring-slate-900/50")
      }
    >
      {/* Floating total — replaces the editor's busy Legend strip */}
      <div
        className={
          "pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-card " +
          (planMode
            ? "border-accent-700/30 bg-[#f7f4ee]/95 text-accent-900"
            : "border-accent-500/30 bg-slate-950/90 text-accent-300")
        }
      >
        <span
          className={
            planMode
              ? "inline-block h-1.5 w-3 rounded-full bg-accent-700"
              : "inline-block h-1.5 w-3 rounded-full bg-[#1479B8] shadow-[0_0_6px_rgba(20,121,184,0.9)]"
          }
        />
        <span className="tabular-nums">
          <span
            className={planMode ? "font-semibold text-slate-900" : "font-semibold text-white"}
          >
            {totalEaveLF}
          </span>{" "}
          LF
        </span>
        <span
          className={
            planMode ? "h-3 w-px bg-accent-800/30" : "h-3 w-px bg-accent-500/30"
          }
        />
        <span
          className={
            planMode
              ? "inline-block h-1.5 w-1.5 rounded-full bg-slate-900"
              : "inline-block h-1.5 w-1.5 rounded-full bg-stripe-coral shadow-[0_0_6px_rgba(248,113,126,0.9)]"
          }
        />
        <span className="tabular-nums">
          <span
            className={planMode ? "font-semibold text-slate-900" : "font-semibold text-white"}
          >
            {downspouts.length}
          </span>{" "}
          drops
          {/* One shared height note instead of 12 identical per-pin
              badges — per-pin badges only appear for outliers. */}
          {planMode && heightInfo.uniform && heightInfo.mode > 0 && (
            <span className="text-slate-500"> @ {heightInfo.mode}′</span>
          )}
        </span>
      </div>

      {/* Trace-house control — builder mode only. The traced outline
          feeds the client diagram + 3D (the home the fence ties into). */}
      {editable && onBuildingsChange && (
        <div className="absolute left-3 top-12 z-10 flex items-center gap-1.5">
          {houseMode ? (
            <>
              <button
                type="button"
                onClick={finishHouse}
                disabled={houseDraft.length < 3}
                className="transition-smooth ring-focus rounded-full bg-accent-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20 hover:bg-accent-700 disabled:opacity-50"
              >
                ✓ Finish house
              </button>
              <button
                type="button"
                onClick={() => {
                  setHouseDraft([]);
                  setHouseMode(false);
                }}
                className="transition-smooth ring-focus rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 hover:bg-slate-950"
              >
                ✕ Cancel
              </button>
              <span className="pointer-events-none rounded-full bg-slate-950/70 px-2.5 py-1 text-[10px] font-medium text-white/80 ring-1 ring-inset ring-white/10">
                Click the house corners — green dot (or Enter) closes
              </span>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setHouseMode(true)}
              className="transition-smooth ring-focus rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 hover:bg-slate-950"
            >
              🏠 {(buildings ?? []).length > 0 ? "Edit house outline" : "Trace the house"}
            </button>
          )}
        </div>
      )}

      {/* Client legend — explains the ink colors + numbered pins in one
          glance (and prints cleanly on the PDF). Only when there's
          something to explain. */}
      {planMode && (downspouts.length > 0 || eaves.some((l) => l.tier === "lower")) && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-accent-700/20 bg-[#f7f4ee]/95 px-3 py-1.5 shadow-card">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#10475e]">
            <span className="inline-block h-[3px] w-4 rounded-full bg-[#115673]" />
            Fence
          </span>
          {eaves.some((l) => l.tier === "lower") && (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold"
              style={{ color: "#7c5320" }}
            >
              <span
                className="inline-block h-[3px] w-4 rounded-full"
                style={{ background: "#a8712c" }}
              />
              Secondary run
            </span>
          )}
          {downspouts.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#10475e]">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#115673] text-[8px] font-bold text-[#f7f4ee]">
                1
              </span>
              Gate
            </span>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid slice"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerDown={handleBackgroundClick}
        className={
          "h-full w-full touch-none select-none" +
          (houseMode ? " cursor-crosshair" : "")
        }
        style={{ minHeight: 360 }}
      >
        <NeonDefs />
        {aerialImageUrl ? (
          <AerialImage imageDataUrl={aerialImageUrl} />
        ) : planMode ? (
          <BlueprintBackground />
        ) : (
          <AerialBackground />
        )}
        {/* Subtle scrim so blue + coral pop against bright satellite
            imagery. Skipped in plan mode — the drafting-paper
            background is already light and a dark scrim on top would
            wash out the architectural feel. */}
        {!planMode && (
          <rect
            x={0}
            y={0}
            width={VIEWBOX_W}
            height={VIEWBOX_H}
            fill="rgba(2,6,23,0.32)"
            pointerEvents="none"
          />
        )}

        {/* Geometry group — scaled about its centroid in plan mode so a
            small trace fills the frame while the drafting border stays at
            full size. `geomTransform` is undefined (identity) otherwise. */}
        <g transform={geomTransform}>
        {/* House footprint(s) — traced outlines of the home the fence
            ties into. Editable via the Trace-house chip. */}
        {(buildings ?? []).map((ring, i) => {
          const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
          const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length;
          return (
            <g key={`bldg-${i}`}>
              <polygon
                points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                fill={planMode ? "rgba(20,58,74,0.10)" : "rgba(15,23,42,0.35)"}
                stroke={planMode ? "rgba(20,58,74,0.5)" : "rgba(241,245,249,0.85)"}
                strokeWidth={1.6 * vs}
                strokeLinejoin="round"
                pointerEvents="none"
              />
              {houseMode && onBuildingsChange && (
                <g
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onBuildingsChange(
                      (buildings ?? []).filter((_, j) => j !== i),
                    );
                  }}
                >
                  <circle cx={cx} cy={cy} r={10 * vs} fill="rgba(244,63,94,0.92)" stroke="#fff" strokeWidth={1.5 * vs} />
                  <line x1={cx - 4 * vs} y1={cy - 4 * vs} x2={cx + 4 * vs} y2={cy + 4 * vs} stroke="#fff" strokeWidth={1.8 * vs} />
                  <line x1={cx - 4 * vs} y1={cy + 4 * vs} x2={cx + 4 * vs} y2={cy - 4 * vs} stroke="#fff" strokeWidth={1.8 * vs} />
                </g>
              )}
            </g>
          );
        })}
        {houseDraft.length > 0 && (
          <g pointerEvents="none">
            <polyline
              points={houseDraft.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(241,245,249,0.12)"
              stroke={planMode ? "#143A4A" : "#F1F5F9"}
              strokeWidth={2 * vs}
              strokeDasharray={`${6 * vs} ${5 * vs}`}
              strokeLinejoin="round"
            />
            {houseDraft.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={(i === 0 && houseDraft.length >= 3 ? 6.5 : 3.5) * vs}
                fill={i === 0 && houseDraft.length >= 3 ? "#22C55E" : "#F1F5F9"}
                stroke="#0F172A"
                strokeWidth={1.2 * vs}
              />
            ))}
          </g>
        )}
        {/* GUTTER PERIMETER (owner doctrine): the client review diagram is a
            gutter takeoff, not a reconstructed roof. Draw ONLY the roof
            outline — no ridges, hips, valleys, tier lines, plane shading or
            gable wings (those rendered the fanned tangle + dashed diagonals
            the owner flagged). The solid gutters (teal / amber low-roof) and
            dashed gables are drawn by this canvas on top; downspouts + LF
            pills complete it. Matches the estimate canvas's perimeterOnly. */}
        {planMode && roofStructure && (
          <RoofStructureOverlay
            structure={roofStructure}
            tone="onLight"
            scale={vs}
            perimeterOnly
            eaves={eaves}
            rakes={rakes}
          />
        )}
        {/* Rakes — gray-dashed "GABLE (no gutter)" edges, non-interactive.
            Drawn in BOTH modes now: the perimeter-only overlay no longer
            derives connected gable wings, so this is the sole source of the
            dashed gable edges on the plan diagram. A diagonal rake (>15° off
            both axes on a rectilinear plan) is an artifact — skip it, same
            guard as the estimate takeoff. */}
        {rakes
          .filter((line) => {
            if (!planMode) return true;
            const a = line.points[0];
            const b = line.points[line.points.length - 1];
            if (!a || !b) return false;
            const dx = Math.abs(b.x - a.x);
            const dy = Math.abs(b.y - a.y);
            const len = Math.hypot(dx, dy);
            return !(len > 0 && dx / len > 0.26 && dy / len > 0.26);
          })
          .map((line) => (
          <motion.path
            key={line.id}
            d={pathFor(line)}
            stroke={planMode ? "#64748b" : "#94a3b8"}
            strokeWidth={1.75 * vs}
            strokeDasharray={`${5 * vs} ${4 * vs}`}
            strokeLinecap="round"
            fill="none"
            opacity={planMode ? 0.7 : 0.55}
            pointerEvents="none"
            initial={{ opacity: 0 }}
            animate={{ opacity: planMode ? 0.7 : 0.55 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          />
        ))}

        {/* Eaves — clean stroke, soft glow, no draw-in animation. Lower-
            roof runs (garage/porch tier) render amber-brown in plan mode
            so the client reads two gutter systems at a glance — same
            palette as the satellite diagram's low-roof color. */}
        {eaves.map((line) => {
          const isSelected = segSel?.id === line.id;
          const isHover = hoverId === line.id;
          const active = isSelected || isHover;
          const lower = line.tier === "lower";
          const bIdxs = spanBounds(line.points);
          // Handles: corner vertices + span ends — never the noise
          // vertices in between. With a selection, only the selected
          // span's corners show (its two turns, plus the clicked corner).
          const handleIdxs = isSelected
            ? [...new Set([segSel!.a, segSel!.corner ?? -1, segSel!.b])].filter(
                (i) => i >= 0,
              )
            : bIdxs;
          const spanPts = isSelected
            ? line.points.slice(segSel!.a, segSel!.b + 1)
            : null;
          return (
            // Hover lives on the GROUP: moving from the line onto one of
            // its corner handles must not count as leaving (it unmounted
            // the handle mid-press and corner clicks fell through to the
            // line underneath).
            <g
              key={line.id}
              onPointerEnter={() => setHoverId(line.id)}
              onPointerLeave={() =>
                setHoverId((h) => (h === line.id ? null : h))
              }
            >
              {/* Wider invisible hit area so hover/select is forgiving */}
              <path
                d={pathFor(line)}
                stroke="transparent"
                strokeWidth={18 * vs}
                fill="none"
                style={{ cursor: editable ? "pointer" : "default" }}
                onPointerDown={(e) => {
                  if (!editable) return;
                  e.stopPropagation();
                  // Activate ONLY the clicked turn-to-turn span.
                  const raw = svgPoint(e);
                  const p = frame
                    ? { x: (raw.x - frame.tx) / frame.k, y: (raw.y - frame.ty) / frame.k }
                    : raw;
                  const seg = nearestSegIndex(line.points, p);
                  let a = 0;
                  let b = line.points.length - 1;
                  for (const bi of bIdxs) if (bi <= seg) a = bi;
                  for (let j = bIdxs.length - 1; j >= 0; j--)
                    if (bIdxs[j] >= seg + 1) b = bIdxs[j];
                  setSegSel({ id: line.id, a, b });
                  setSelectedId(null);
                }}
              />
              <motion.path
                d={pathFor(line)}
                stroke={
                  planMode
                    ? // Plan mode: architectural-ink palette. Saturated
                      // blue still reads as "gutter" but no glow —
                      // glows clip on print and look fake on paper.
                      lower
                      ? active && !spanPts
                        ? "#7c5320"
                        : "#a8712c"
                      : active && !spanPts
                        ? "#14688C"
                        : "#115673"
                    : active && !spanPts
                      ? "#93C6DC"
                      : "#1479B8"
                }
                strokeWidth={((active && !spanPts ? 3.5 : 2.5)) * vs}
                strokeLinecap="round"
                fill="none"
                pointerEvents="none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.35 }}
                style={{
                  filter: planMode
                    ? undefined
                    : active
                      ? "drop-shadow(0 0 6px rgba(20,121,184,0.85))"
                      : "drop-shadow(0 0 3px rgba(20,121,184,0.55))",
                }}
              />

              {/* Selected turn-to-turn span — the only emphasized part */}
              {spanPts && spanPts.length >= 2 && (
                <path
                  d={`M ${spanPts.map((q) => `${q.x} ${q.y}`).join(" L ")}`}
                  stroke={planMode ? (lower ? "#7c5320" : "#14688C") : "#FBBF24"}
                  strokeWidth={4 * vs}
                  strokeLinecap="round"
                  fill="none"
                  pointerEvents="none"
                  style={{
                    filter: planMode
                      ? undefined
                      : "drop-shadow(0 0 6px rgba(251,191,36,0.7))",
                  }}
                />
              )}

              {/* Corner handles — the turns only. Clicking one activates
                  BOTH adjacent spans and drags that corner. */}
              {editable &&
                active &&
                handleIdxs.map((idx) => {
                  const pt = line.points[idx];
                  if (!pt) return null;
                  return (
                    <motion.circle
                      key={idx}
                      cx={pt.x}
                      cy={pt.y}
                      r={5 * vs}
                      fill="#0b1220"
                      stroke={segSel?.corner === idx ? "#FBBF24" : "#93C6DC"}
                      strokeWidth={2 * vs}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.15 }}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        // Corner click: activate the spans on BOTH sides
                        // of this turn, then drag moves the corner.
                        let a = 0;
                        let b = line.points.length - 1;
                        for (const bi of bIdxs) if (bi < idx) a = bi;
                        for (let j = bIdxs.length - 1; j >= 0; j--)
                          if (bIdxs[j] > idx) b = bIdxs[j];
                        if (idx === 0) a = 0;
                        if (idx === line.points.length - 1) b = idx;
                        setSegSel({ id: line.id, a, b, corner: idx });
                        setSelectedId(null);
                        setDrag({ kind: "vertex", lineId: line.id, index: idx });
                      }}
                    />
                  );
                })}

              <SegmentLabel
                line={line}
                emphasized={active}
                minFt={active ? 0 : LABEL_MIN_FT}
                planMode={planMode}
                scale={vs}
                pxPerFt={pxPerFt}
                at={labelLayout?.placed.get(line.id)}
                outsideAnchor={eavesCentroid}
                lower={lower}
              />
            </g>
          );
        })}

        {/* Mixed-type stretches — a different fence from here to here,
            drawn over the run in its material color with a label chip */}
        {sectionViews.map((sv) => (
          <g key={sv.key} pointerEvents="none">
            <polyline
              points={sv.pts.map((q) => `${q.x},${q.y}`).join(" ")}
              fill="none"
              stroke="#0b1210"
              strokeOpacity={0.55}
              strokeWidth={6.5 * vs}
              strokeLinecap="round"
            />
            <polyline
              points={sv.pts.map((q) => `${q.x},${q.y}`).join(" ")}
              fill="none"
              stroke={sv.color}
              strokeWidth={4 * vs}
              strokeLinecap="round"
            />
            <g transform={`translate(${sv.mid.x}, ${sv.mid.y}) scale(${vs}) translate(0, -14)`}>
              <rect
                x={-sv.label.length * 2.9 - 7}
                y={-10}
                width={sv.label.length * 5.8 + 14}
                height={17}
                rx={8.5}
                fill="rgba(9,20,12,0.88)"
                stroke={sv.color}
                strokeWidth={1}
              />
              <text x={0} y={2.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
                {sv.label}
              </text>
            </g>
          </g>
        ))}

        {/* Miter markers — small drafting diamonds at run-to-run corners,
            so the "N gutter miters" stat has a visible counterpart. */}
        {miterPts.map((p, i) => (
          <rect
            key={`mt-${i}`}
            x={p.x - 1.7 * vs}
            y={p.y - 1.7 * vs}
            width={3.4 * vs}
            height={3.4 * vs}
            transform={`rotate(45 ${p.x} ${p.y})`}
            fill="#f7f4ee"
            stroke="#115673"
            strokeWidth={0.9 * vs}
            pointerEvents="none"
          />
        ))}

        {/* Downspouts — numbered pins (clockwise walk-around order), so the
            markers read as an ordered system a client can count, not a
            scatter of dots. Drop height is NOT repeated on every pin: the
            common height lives in the totals pill; only outliers (a porch
            drop shorter than the house drop) get their own badge. */}
        {downspouts.map((d) => {
          const isSelected = selectedId === d.id;
          const num = dropNumber.get(d.id);
          const hRound = Math.round(d.heightFt);
          const placedBadge = labelLayout?.placed.get(`dsh-${d.id}`);
          // Outlier badge (solver-placed), or the selected pin while the
          // contractor is nudging it (so the height stays inspectable).
          const badge =
            d.heightFt > 0 && (placedBadge || isSelected)
              ? {
                  cx: placedBadge?.cx ?? d.x + 26 * vs,
                  cy: placedBadge?.cy ?? d.y - 11 * vs,
                  moved: placedBadge?.moved ?? 0,
                }
              : null;
          const pinR = (isSelected ? 8 : 6.5) * vs;
          return (
            <g
              key={d.id}
              onPointerDown={(e) => {
                if (!editable) return;
                e.stopPropagation();
                setSelectedId(d.id);
                if (onDownspoutsChange) {
                  setDrag({ kind: "downspout", id: d.id });
                }
              }}
              style={{ cursor: editable ? "grab" : "default" }}
            >
              <motion.circle
                cx={d.x}
                cy={d.y}
                r={pinR}
                fill={planMode ? (isSelected ? "#14688C" : "#115673") : "#f8717e"}
                stroke={planMode ? "#f7f4ee" : "white"}
                strokeWidth={(planMode ? 1.6 : 1.8) * vs}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                style={{
                  filter: planMode
                    ? undefined
                    : "drop-shadow(0 0 4px rgba(248,113,126,0.7))",
                }}
              />
              {num != null ? (
                <text
                  x={d.x}
                  y={d.y + 2.6 * vs}
                  textAnchor="middle"
                  fontSize={(num >= 10 ? 6.6 : 7.5) * vs}
                  fontWeight={700}
                  fontFamily="ui-sans-serif, system-ui"
                  fill={planMode ? "#f7f4ee" : "#fff1f2"}
                  pointerEvents="none"
                >
                  {num}
                </text>
              ) : (
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={1.8 * vs}
                  fill={planMode ? "#f7f4ee" : "#fff1f2"}
                />
              )}
              {planMode && badge && (
                <g pointerEvents="none">
                  {badge.moved > 14 * vs && (
                    <line
                      x1={d.x}
                      y1={d.y}
                      x2={badge.cx}
                      y2={badge.cy}
                      stroke="rgba(17,86,115,0.38)"
                      strokeWidth={0.8 * vs}
                    />
                  )}
                  <rect
                    x={badge.cx - 22 * vs}
                    y={badge.cy - 6.5 * vs}
                    width={44 * vs}
                    height={13 * vs}
                    rx={3 * vs}
                    fill="#f7f4ee"
                    stroke="#115673"
                    strokeWidth={0.7 * vs}
                  />
                  <text
                    x={badge.cx}
                    y={badge.cy + 2.6 * vs}
                    fontSize={7.5 * vs}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="#115673"
                    textAnchor="middle"
                  >
                    {hRound}′ drop
                  </text>
                </g>
              )}
            </g>
          );
        })}
        </g>
      </svg>

      {/* Span type picker — the selected stretch can be built as a
          different fence (or back to the main one). Prices + 3D follow. */}
      {spanPicker && (
        <div
          className="absolute z-20"
          style={{
            left: `${((frame ? spanPicker.mid.x * frame.k + frame.tx : spanPicker.mid.x) / VIEWBOX_W) * 100}%`,
            top: `${((frame ? spanPicker.mid.y * frame.k + frame.ty : spanPicker.mid.y) / VIEWBOX_H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 14px))",
          }}
        >
          <div className="flex items-center gap-1.5 rounded-full bg-slate-950/92 px-2.5 py-1.5 shadow-lg ring-1 ring-inset ring-white/15 backdrop-blur">
            <span className="whitespace-nowrap text-[10px] font-semibold text-white/70">
              This stretch:
            </span>
            <select
              aria-label="Fence type for this stretch"
              value={spanPicker.current}
              onChange={(e) => applySpanType(e.target.value)}
              className="ring-focus max-w-[150px] rounded-md border-0 bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-white outline-none"
            >
              <option value="">Main fence</option>
              {FENCE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact LF label. Always renders perpendicular to the eave so it
 * floats off the line rather than crossing it. Selected eaves get a
 * larger pill; unselected short eaves are skipped entirely.
 */
function SegmentLabel({
  line,
  emphasized,
  minFt,
  planMode,
  scale = 1,
  pxPerFt,
  at,
  outsideAnchor,
  lower = false,
}: {
  line: EditableLine;
  emphasized: boolean;
  minFt: number;
  planMode?: boolean;
  pxPerFt?: number;
  /** Visual scale of the zoomed viewBox window (<1 when the camera is
   *  zoomed in to frame a small trace). Keeps the pill a constant size
   *  on screen instead of ballooning with the zoom. */
  scale?: number;
  /** Solver-resolved pill center (plan mode) — the global layout pass has
   *  already pushed it clear of other pills / pins / chips / runs. When it
   *  had to travel, a thin leader ties it back to its run. */
  at?: PlacedLabel;
  /** Footprint center: the fallback placement kicks the pill AWAY from
   *  this so it lands outside the outline. */
  outsideAnchor?: { x: number; y: number };
  /** Lower-roof tier run — pill borders/text follow the amber-brown
   *  low-roof color so label and line read as one system. */
  lower?: boolean;
}) {
  if (line.points.length < 2) return null;
  const a = line.points[0];
  const b = line.points[line.points.length - 1];
  const len = Math.round(lineLengthFt(line, pxPerFt));
  if (len < minFt) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const norm = Math.hypot(dx, dy) || 1;
  const offset = (emphasized ? 14 : 10) * scale;
  const nx = (-dy / norm) * offset;
  const ny = (dx / norm) * offset;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  // Kick the pill away from the footprint center so it lands OUTSIDE the
  // outline (labels inside the roof crossed the hip/ridge skeleton).
  // Falls back to the viewBox center when no anchor is available.
  const anchor = outsideAnchor ?? { x: VIEWBOX_W / 2, y: VIEWBOX_H / 2 };
  const sign = (cx - anchor.x) * nx + (cy - anchor.y) * ny >= 0 ? 1 : -1;
  const labelCx = at ? at.cx : cx + nx * sign;
  const labelCy = at ? at.cy : cy + ny * sign;
  const showLeader = planMode && !!at && at.moved > 18 * scale;

  const w = (emphasized ? 52 : 38) * scale;
  const h = (emphasized ? 18 : 14) * scale;
  const fontSize = (emphasized ? 10 : 9) * scale;

  return (
    <motion.g
      pointerEvents="none"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay: 0.15 }}
    >
      {showLeader && (
        <line
          x1={cx}
          y1={cy}
          x2={labelCx}
          y2={labelCy}
          stroke={lower ? "rgba(168,113,44,0.45)" : "rgba(17,86,115,0.38)"}
          strokeWidth={0.8 * scale}
        />
      )}
      <rect
        x={labelCx - w / 2}
        y={labelCy - h / 2}
        width={w}
        height={h}
        rx={(emphasized ? 5 : 3.5) * scale}
        fill={planMode ? "#f7f4ee" : "rgba(2,6,23,0.85)"}
        stroke={
          planMode
            ? lower
              ? emphasized
                ? "#7c5320"
                : "rgba(168,113,44,0.7)"
              : emphasized
                ? "#115673"
                : "rgba(17, 86, 115, 0.55)"
            : emphasized
              ? "#93C6DC"
              : "rgba(147,198,220,0.45)"
        }
        strokeWidth={(emphasized ? 1.2 : 0.8) * scale}
      />
      <text
        x={labelCx}
        y={labelCy + (emphasized ? 3.5 : 3) * scale}
        textAnchor="middle"
        fill={
          planMode
            ? lower
              ? "#7c5320"
              : emphasized
                ? "#10475E"
                : "#115673"
            : emphasized
              ? "#BFDEEA"
              : "#93C6DC"
        }
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {len} ft
      </text>
    </motion.g>
  );
}
