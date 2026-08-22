"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  DoorOpen,
  Home,
  Layers,
  MousePointer2,
  PenLine,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FENCE_TYPES, fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import {
  CANVAS_H,
  CANVAS_W,
  canvasPolylineFt,
  type Pt,
} from "@/lib/fence/geo";
import type { FenceScanResult } from "@/app/actions/fence-scan";
import type { ContourLine } from "@/lib/fence/contours";

/** Keep the camera inside the aerial: zoom 1–5×, center clamped so the
 *  view never shows past the image edge. */
function clampCam(c: { cx: number; cy: number; k: number }) {
  const k = Math.min(5, Math.max(1, c.k));
  const vw = CANVAS_W / k;
  const vh = CANVAS_H / k;
  return {
    k,
    cx: Math.min(CANVAS_W - vw / 2, Math.max(vw / 2, c.cx)),
    cy: Math.min(CANVAS_H - vh / 2, Math.max(vh / 2, c.cy)),
  };
}

/**
 * FenceCanvas — draw fence runs over the satellite tile with the Regrid
 * parcel boundary as a guide. Controlled component: the page owns
 * runs/gates and feeds live LF into the takeoff + pricing panels.
 *
 * Tools: select (click a run, Delete removes) · draw (click vertices,
 * double-click or Enter finishes, Esc cancels, snaps to parcel corners
 * and run endpoints) · gate (click a run to drop a gate; button toggles
 * walk vs drive). "Use property line" seeds runs from the parcel ring.
 */

export type FenceRun = { id: string; points: Pt[] };
export type FenceGate = {
  id: string;
  x: number;
  y: number;
  kind: "single" | "double" | "custom";
  /** Opening width in feet (4 walk · 10 drive · custom = user-typed). */
  widthFt: number;
};

/** A "from here to here" stretch of one run built as a DIFFERENT fence
 *  type (chain link across the back of a cedar job). Endpoints sit ON
 *  the run; lfFt is measured at creation so pricing never re-projects. */
export type FenceSection = {
  id: string;
  runId: string;
  a: Pt;
  b: Pt;
  /** Arc distances of a/b along the run (canvas px) — lets render +
   *  overlap checks slice the polyline without re-projecting. */
  aArc: number;
  bArc: number;
  type: FenceTypeId;
  lfFt: number;
};

export type FenceLayout = {
  runs: FenceRun[];
  gates: FenceGate[];
  sections?: FenceSection[];
};

/** Overlay color per catalog category — how a marked section reads on
 *  the photo (wire gray, vinyl white, ornamental dark…). */
export const SECTION_COLORS: Record<string, string> = {
  wood: "#D97706",
  vinyl: "#F1F5F9",
  "chain-link": "#A1A1AA",
  aluminum: "#475569",
  steel: "#334155",
  "split-rail": "#B45309",
};

type Tool = "select" | "draw" | "gate" | "house" | "section";

/** Slice a polyline between two arc distances (vertices kept). */
function slicePolyline(points: Pt[], d0: number, d1: number): Pt[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const out: Pt[] = [];
  const at = (a: Pt, b: Pt, t: number): Pt => ({
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

/** Ray-cast point-in-polygon (house selection). */
function pointInPoly(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Snap radius in SCREEN pixels — converted to canvas units against the
 *  live rendered size, so snapping feels identical on a 1400px desktop
 *  canvas, a 375px phone canvas, and at any zoom. */
const SNAP_SCREEN_PX = 24;
/** How close a finger/cursor has to land on a run to drop a gate or pin
 *  a section end — also SCREEN px, so a fingertip is enough on a phone.
 *  Sized to match the forgiveness the old fixed 34-canvas-px radius gave
 *  a desktop-width canvas. */
const RUN_HIT_SCREEN_PX = 38;
/** Movement past this many screen px turns a press into a pan (and
 *  swallows the click that would otherwise place a post). */
const PAN_SLOP_PX = 6;

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${idSeq++}`;

/** Unit direction of the nearest run segment at a point (for drawing a
 *  gate's opening along the fence). */
function runDirectionAt(p: Pt, runs: FenceRun[]): Pt {
  let best = { x: 1, y: 0 };
  let bestD = Infinity;
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len = Math.hypot(abx, aby) || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (len * len)));
      const d = Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x: abx / len, y: aby / len };
      }
    }
  }
  return best;
}

/** Distance from a point to the nearest spot on a run's segments. */
function distToRun(p: Pt, run: FenceRun): number {
  let best = Infinity;
  for (let i = 1; i < run.points.length; i++) {
    const a = run.points[i - 1];
    const b = run.points[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    best = Math.min(best, Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y));
  }
  return best;
}

export function FenceCanvas({
  scan,
  layout,
  onChange,
  topo = null,
  buildings = [],
  onBuildingsChange,
  className,
}: {
  scan: FenceScanResult;
  layout: FenceLayout;
  onChange: (next: FenceLayout) => void;
  /** Measured elevation contours to overlay (levels are ft above the
   *  lot's low point). Null hides the layer. */
  topo?: { lines: ContourLine[]; intervalFt: number } | null;
  /** Building footprints (house/garage) — rendered as traced outlines
   *  and editable via the House tool when onBuildingsChange is given. */
  buildings?: Pt[][];
  onBuildingsChange?: (next: Pt[][]) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>(
    scan.suggestedRuns.length > 0 ? "select" : "draw",
  );
  const [gateKind, setGateKind] = useState<"single" | "double" | "custom">("single");
  const [customGateFt, setCustomGateFt] = useState(6);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  // One BAY of a run — points[index] → points[index+1] — picked by the
  // click that selected the run. Delete removes just this piece (the
  // "end of the driveway" case); the Delete-run button still clears all.
  const [selectedSeg, setSelectedSeg] = useState<{
    runId: string;
    index: number;
  } | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [houseDraft, setHouseDraft] = useState<Pt[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<number | null>(null);
  // True while the draw cursor is magnetically locked onto a corner,
  // an existing run or a house wall — rendered as a green lock ring.
  const [snapLocked, setSnapLocked] = useState(false);
  const didPanRef = useRef(false);
  // Section tool: mark a from-here-to-here stretch as a different type.
  const [secType, setSecType] = useState<FenceTypeId>("chain-link-galv");
  const [sectionStart, setSectionStart] = useState<{ runId: string; q: Pt; arc: number } | null>(null);
  const [secGhost, setSecGhost] = useState<{ runId: string; q: Pt; arc: number } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  // Ghost gate under the cursor in gate mode; transient helper notices.
  const [gateGhost, setGateGhost] = useState<Pt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const say = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400);
  };

  const pxPerFt = scan.canvasPxPerFt;

  /* ---- camera: pan + zoom over the aerial ---- */
  const [cam, setCam] = useState({ cx: CANVAS_W / 2, cy: CANVAS_H / 2, k: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  // Live pointers on the canvas — one is a pan, two are a pinch.
  const ptrsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    d: number;
    mx: number;
    my: number;
    cam: { cx: number; cy: number; k: number };
  } | null>(null);

  /* ---- rendered size: canvas units per CSS pixel ----
   * The 900×580 viewBox is drawn at whatever width the layout gives it —
   * ~900 on a desktop rail, ~360 on a phone. Everything sized in world
   * units (dot radii, label chips, text) has to be multiplied by this or
   * it renders 2.5× too small to read on a phone. Strokes already opt
   * out via vector-effect. */
  const [pxRatio, setPxRatio] = useState(1);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setPxRatio(CANVAS_W / w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const pxRatioRef = useRef(pxRatio);
  pxRatioRef.current = pxRatio;

  // A press that starts on the canvas and releases OFF it never delivers
  // pointerup here (capture is only taken once a drag is real), which
  // would leave a phantom pointer behind — and the next press would then
  // read as a two-finger pinch. Clean up at the window instead.
  useEffect(() => {
    const forget = (e: PointerEvent) => {
      ptrsRef.current.delete(e.pointerId);
      if (ptrsRef.current.size < 2) pinchRef.current = null;
      if (ptrsRef.current.size === 0) panRef.current = null;
    };
    window.addEventListener("pointerup", forget);
    window.addEventListener("pointercancel", forget);
    return () => {
      window.removeEventListener("pointerup", forget);
      window.removeEventListener("pointercancel", forget);
    };
  }, []);

  // Coarse pointer → the instructions say "tap" and talk about pinching
  // instead of naming keyboard shortcuts the device doesn't have.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const verb = touch ? "tap" : "click";

  /** Canvas units spanned by one CSS pixel right now (zoom included). */
  const perScreenPx = useCallback(
    () => pxRatioRef.current / camRef.current.k,
    [],
  );

  // On a phone the aerial lands about 340×220 CSS px, and most of that is
  // the neighbours' roofs. Open zoomed to the county parcel instead, so
  // the yard being fenced fills the working area from the first tap.
  // Desktop (where the tile is already ~900px wide) opens unchanged.
  const framedFor = useRef<string | null>(null);
  useEffect(() => {
    if (pxRatio < 1.6 || scan.parcelRings.length === 0) return;
    const key = scan.address;
    if (framedFor.current === key) return;
    framedFor.current = key;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of scan.parcelRings) {
      for (const p of ring) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (!(w > 1 && h > 1)) return;
    // 12% breathing room — the fence usually sits just inside the line,
    // and the corner snap targets have to stay reachable.
    const k = Math.min(3, Math.max(1, Math.min(CANVAS_W / (w * 1.24), CANVAS_H / (h * 1.24))));
    if (k <= 1.05) return;
    setCam(clampCam({ k, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }));
  }, [pxRatio, scan.parcelRings, scan.address]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setCam((c0) => {
      const k = Math.min(5, Math.max(1, c0.k * factor));
      if (k === c0.k) return c0;
      const vw0 = CANVAS_W / c0.k;
      const vh0 = CANVAS_H / c0.k;
      // world point under the cursor stays fixed while zooming
      const wx = c0.cx - vw0 / 2 + ((clientX - r.left) / r.width) * vw0;
      const wy = c0.cy - vh0 / 2 + ((clientY - r.top) / r.height) * vh0;
      return clampCam({
        k,
        cx: wx - (wx - c0.cx) * (c0.k / k),
        cy: wy - (wy - c0.cy) * (c0.k / k),
      });
    });
  }, []);

  // Wheel must be a NATIVE non-passive listener (React root wheel
  // handlers are passive, so preventDefault would be ignored and the
  // page would scroll). Pinch/ctrl+wheel zooms; plain wheel pans.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
      } else {
        const r = svg.getBoundingClientRect();
        setCam((c0) => {
          const s = CANVAS_W / c0.k / r.width;
          return clampCam({
            k: c0.k,
            cx: c0.cx + e.deltaX * s,
            cy: c0.cy + e.deltaY * s,
          });
        });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ---- coordinate + snapping helpers ---- */

  const toCanvas = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const c = camRef.current;
    const vw = CANVAS_W / c.k;
    const vh = CANVAS_H / c.k;
    return {
      x: c.cx - vw / 2 + ((e.clientX - r.left) / r.width) * vw,
      y: c.cy - vh / 2 + ((e.clientY - r.top) / r.height) * vh,
    };
  }, []);

  const snapTargets = useMemo(() => {
    const pts: Pt[] = [];
    for (const ring of scan.parcelRings) pts.push(...ring);
    for (const run of layout.runs) {
      if (run.points.length > 0) {
        pts.push(run.points[0], run.points[run.points.length - 1]);
      }
    }
    // house corners — a wing that ends at the corner of the garage
    for (const ring of buildings) pts.push(...ring);
    return pts;
  }, [scan.parcelRings, layout.runs, buildings]);

  const snap = useCallback(
    (p: Pt): Pt => {
      // Tolerance is a constant ~22 SCREEN px: generous at 100%, still
      // precise when zoomed in (the canvas-px radius shrinks with zoom),
      // and finger-sized on a phone (where one CSS px ≈ 2.4 canvas px).
      const tol = Math.max(8, SNAP_SCREEN_PX * perScreenPx());
      // Corners win (parcel corners, run endpoints, house corners)…
      let best: Pt | null = null;
      let bestD = tol;
      for (const t of snapTargets) {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return best;
      // …then anywhere ALONG an existing fence run or a house wall — a
      // connector from the main line to the side of the house lands
      // exactly on both, no gap, no overlap.
      let bestEdge: Pt | null = null;
      let bestED = tol;
      const consider = (a: Pt, b: Pt) => {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1) return;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const q = { x: a.x + t * abx, y: a.y + t * aby };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestED) {
          bestED = d;
          bestEdge = q;
        }
      };
      for (const run of layout.runs) {
        for (let i = 1; i < run.points.length; i++) {
          consider(run.points[i - 1], run.points[i]);
        }
      }
      for (const ring of buildings) {
        for (let i = 0; i < ring.length; i++) {
          consider(ring[i], ring[(i + 1) % ring.length]);
        }
      }
      return bestEdge ?? p;
    },
    [snapTargets, layout.runs, buildings, perScreenPx],
  );

  /* ---- draw tool ---- */

  const finishDraft = useCallback(() => {
    setDraft((d) => {
      // Double-click fires click twice before dblclick — collapse any
      // consecutive duplicate vertices so they can't inflate the corner
      // count or leave zero-length segments.
      const pts = d.filter(
        (p, i) => i === 0 || Math.hypot(p.x - d[i - 1].x, p.y - d[i - 1].y) > 1,
      );
      if (pts.length >= 2) {
        onChange({
          ...layout,
          runs: [...layout.runs, { id: nextId("run"), points: pts }],
        });
      }
      return [];
    });
  }, [layout, onChange]);

  const finishHouse = useCallback(() => {
    setHouseDraft((d) => {
      const pts = d.filter(
        (p, i) => i === 0 || Math.hypot(p.x - d[i - 1].x, p.y - d[i - 1].y) > 1,
      );
      if (pts.length >= 3 && onBuildingsChange) {
        onBuildingsChange([...buildings, pts]);
      }
      return [];
    });
  }, [buildings, onBuildingsChange]);

  // Deleting a run takes its gates with it — an orphan gate would keep
  // billing a gate AND keep shrinking the net fence footage.
  const removeRun = useCallback(
    (runId: string) => {
      const run = layout.runs.find((r) => r.id === runId);
      onChange({
        runs: layout.runs.filter((r) => r.id !== runId),
        gates: run
          ? layout.gates.filter((g) => distToRun(g, run) > 14)
          : layout.gates,
        sections: (layout.sections ?? []).filter((s) => s.runId !== runId),
      });
      setSelectedRun(null);
      setSelectedSeg(null);
    },
    [layout, onChange],
  );

  /** Arc distance + gap of the nearest point on a run to `p`. */
  const projectOnRun = (pt: Pt, run: FenceRun): { dist: number; arc: number } => {
    let best = { dist: Infinity, arc: 0 };
    let walked = 0;
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const abx = b.x - a.x, aby = b.y - a.y;
      const len = Math.hypot(abx, aby);
      const len2 = len * len || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2));
      const d = Math.hypot(a.x + t * abx - pt.x, a.y + t * aby - pt.y);
      if (d < best.dist) best = { dist: d, arc: walked + t * len };
      walked += len;
    }
    return best;
  };

  /**
   * Remove ONE bay of a run. End bays trim the line; a middle bay splits
   * it into two runs. Gates riding the removed bay go with it; marked
   * sections re-anchor onto whichever surviving piece still holds both
   * their endpoints, and drop when the deleted bay cut through them.
   */
  const removeSegment = useCallback(
    (runId: string, index: number) => {
      const run = layout.runs.find((r) => r.id === runId);
      if (!run || index < 0 || index >= run.points.length - 1) return;
      if (run.points.length <= 2) {
        removeRun(runId);
        return;
      }
      const segA = run.points[index];
      const segB = run.points[index + 1];
      const removed: FenceRun = { ...run, id: `${runId}-removed`, points: [segA, segB] };

      const pieces: FenceRun[] = [];
      if (index === 0) {
        pieces.push({ ...run, points: run.points.slice(1) });
      } else if (index === run.points.length - 2) {
        pieces.push({ ...run, points: run.points.slice(0, -1) });
      } else {
        pieces.push({ ...run, id: `${run.id}~a`, points: run.points.slice(0, index + 1) });
        pieces.push({ ...run, id: `${run.id}~b`, points: run.points.slice(index + 1) });
      }

      const newRuns = layout.runs.flatMap((r) => (r.id === runId ? pieces : [r]));
      // Gates: only the ones sitting ON the removed bay disappear.
      const newGates = layout.gates.filter((g) => distToRun(g, removed) > 14);
      // Sections: keep where both endpoints still land on one piece.
      const newSections = (layout.sections ?? []).flatMap((sec) => {
        if (sec.runId !== runId) return [sec];
        for (const piece of pieces) {
          const pa = projectOnRun(sec.a, piece);
          const pb = projectOnRun(sec.b, piece);
          if (pa.dist <= 14 && pb.dist <= 14) {
            const lo = Math.min(pa.arc, pb.arc);
            const hi = Math.max(pa.arc, pb.arc);
            if (hi - lo < 4) return [];
            return [{ ...sec, runId: piece.id, aArc: lo, bArc: hi }];
          }
        }
        return [];
      });

      onChange({ runs: newRuns, gates: newGates, sections: newSections });
      setSelectedSeg(null);
      setSelectedRun(null);
    },
    [layout, onChange, removeRun],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setDraft([]);
        setHouseDraft([]);
        setSectionStart(null);
        setSelectedSeg(null);
      }
      if (e.key === "Enter") {
        if (draft.length >= 2) finishDraft();
        else if (houseDraft.length >= 3) finishHouse();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // While drawing, Backspace steps back one post; only with no
        // draft does it delete the selected run/house.
        if (draft.length > 0) {
          e.preventDefault();
          setDraft((d) => d.slice(0, -1));
        } else if (houseDraft.length > 0) {
          e.preventDefault();
          setHouseDraft((d) => d.slice(0, -1));
        } else if (selectedSeg) {
          removeSegment(selectedSeg.runId, selectedSeg.index);
        } else if (selectedRun) {
          removeRun(selectedRun);
        } else if (selectedHouse !== null && onBuildingsChange) {
          onBuildingsChange(buildings.filter((_, i) => i !== selectedHouse));
          setSelectedHouse(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.length, houseDraft.length, finishDraft, finishHouse, selectedRun, removeRun, selectedSeg, removeSegment, selectedHouse, buildings, onBuildingsChange]);

  /* ---- gate tool: nearest point on any run segment ---- */

  /** Like nearestOnRuns, but keeps WHICH run and the arc distance —
   *  the section tool needs both ends pinned to the same line. */
  function nearestOnRunsInfo(
    p: Pt,
    tolerance = Math.max(20, RUN_HIT_SCREEN_PX * perScreenPx()),
  ): { runId: string; q: Pt; arc: number } | null {
    let best: { runId: string; q: Pt; arc: number } | null = null;
    let bestD = tolerance;
    for (const run of layout.runs) {
      let acc = 0;
      for (let i = 1; i < run.points.length; i++) {
        const a = run.points[i - 1];
        const b = run.points[i];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const segLen = Math.hypot(abx, aby);
        const len2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const q = { x: a.x + t * abx, y: a.y + t * aby };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { runId: run.id, q, arc: acc + segLen * t };
        }
        acc += segLen;
      }
    }
    return best;
  }

  function nearestOnRuns(
    p: Pt,
    tolerance = Math.max(20, RUN_HIT_SCREEN_PX * perScreenPx()),
  ): Pt | null {
    let best: Pt | null = null;
    let bestD = tolerance;
    for (const run of layout.runs) {
      for (let i = 1; i < run.points.length; i++) {
        const a = run.points[i - 1];
        const b = run.points[i];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        const q = { x: a.x + t * abx, y: a.y + t * aby };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    return best;
  }

  /** Aiming feedback for the active tool at a screen position — the
   *  snap ring while drawing, the ghost gate, the section preview. Fed
   *  by mouse hover AND by a finger resting on the canvas before it
   *  lifts, so touch isn't drawing blind. */
  function updateGhosts(e: { clientX: number; clientY: number }) {
    if (tool === "draw") {
      const raw = toCanvas(e);
      const s = snap(raw);
      setHover(s);
      setSnapLocked(Math.hypot(s.x - raw.x, s.y - raw.y) > 0.75);
    } else if (tool === "house") {
      setHover(toCanvas(e));
    } else if (tool === "gate") {
      setGateGhost(nearestOnRuns(toCanvas(e)));
    } else if (tool === "section") {
      setSecGhost(nearestOnRunsInfo(toCanvas(e)));
    }
  }

  /** True when the gesture that just ended was a pan/pinch, not a tap —
   *  and clears the flag. Every click handler on the canvas (and on the
   *  runs, gates and sections drawn over it) has to consult this, or
   *  dragging the map from on top of a gate deletes the gate. */
  function consumePan(): boolean {
    if (!didPanRef.current) return false;
    didPanRef.current = false;
    return true;
  }

  function onCanvasClick(e: React.MouseEvent) {
    // A drag-pan releases as a click — swallow it so panning never
    // deselects or places anything.
    if (consumePan()) return;
    const raw = toCanvas(e);
    if (tool === "draw") {
      if (e.detail > 1) return; // second click of a dbl-click — finish handles it
      const p = snap(raw);
      setDraft((d) => [...d, p]);
      return;
    }
    if (tool === "house") {
      if (e.detail > 1) return;
      // tapping back on the first corner closes the outline (finger-sized
      // target — 12 canvas px is 5 CSS px on a phone)
      if (
        houseDraft.length >= 3 &&
        Math.hypot(raw.x - houseDraft[0].x, raw.y - houseDraft[0].y) <
          Math.max(12, 22 * perScreenPx())
      ) {
        finishHouse();
        return;
      }
      setHouseDraft((d) => [...d, raw]);
      return;
    }
    if (tool === "section") {
      if (layout.runs.length === 0) {
        say("Draw a fence line first — sections live on the fence.");
        return;
      }
      const hit = nearestOnRunsInfo(raw);
      if (!hit) {
        say("Tap on (or near) a fence line to mark the section.");
        return;
      }
      if (!sectionStart) {
        setSectionStart(hit);
        return;
      }
      if (hit.runId !== sectionStart.runId) {
        say("Both ends must sit on the same fence line — tap the other end of the stretch.");
        return;
      }
      const lo = Math.min(hit.arc, sectionStart.arc);
      const hi = Math.max(hit.arc, sectionStart.arc);
      const lfFt = (hi - lo) / pxPerFt;
      if (lfFt < 2) {
        say("Too short — tap further along the line for the other end.");
        return;
      }
      const overlaps = (layout.sections ?? []).some(
        (s) =>
          s.runId === hit.runId &&
          Math.min(s.aArc, s.bArc) < hi &&
          Math.max(s.aArc, s.bArc) > lo,
      );
      if (overlaps) {
        say("That stretch already has a marked section — remove it first (click it).");
        return;
      }
      onChange({
        ...layout,
        sections: [
          ...(layout.sections ?? []),
          {
            id: nextId("sec"),
            runId: hit.runId,
            a: sectionStart.q,
            b: hit.q,
            aArc: sectionStart.arc,
            bArc: hit.arc,
            type: secType,
            lfFt: Math.round(lfFt),
          },
        ],
      });
      setSectionStart(null);
      return;
    }
    if (tool === "gate") {
      if (layout.runs.length === 0) {
        say("Draw a fence line first — gates hang on the fence.");
        return;
      }
      const q = nearestOnRuns(raw);
      if (q) {
        const widthFt =
          gateKind === "single" ? 4 : gateKind === "double" ? 10 : Math.min(24, Math.max(3, customGateFt));
        onChange({
          ...layout,
          gates: [...layout.gates, { id: nextId("gate"), ...q, kind: gateKind, widthFt }],
        });
      } else {
        say("Tap on (or near) a fence line to place the gate.");
      }
      return;
    }
    // select tool: houses are selectable at the svg level (their layer
    // never intercepts clicks); runs handle their own clicks and stop
    // propagation before we get here.
    const hitHouse = buildings.findIndex((ring) => pointInPoly(raw, ring));
    setSelectedHouse(hitHouse >= 0 ? hitHouse : null);
    setSelectedRun(null);
  }

  /* ---- derived ---- */

  const totalLf = useMemo(
    () =>
      Math.round(
        layout.runs.reduce((a, r) => a + canvasPolylineFt(r.points, pxPerFt), 0),
      ),
    [layout.runs, pxPerFt],
  );

  const usePropertyLine = () => {
    onChange({
      ...layout,
      runs: [
        ...layout.runs,
        ...scan.suggestedRuns.map((s) => ({ id: nextId("run"), points: s.points })),
      ],
    });
    setTool("select");
  };

  // The contour layer is static per (topo, zoom) — memoized so the
  // per-mousemove hover re-renders don't rebuild 100+ SVG nodes.
  // Clamped at 1 on the low side: a canvas WIDER than 900 px would
  // otherwise shrink every label below what desktop renders today. This
  // only ever scales annotations UP, when the sheet is being squeezed.
  const uiScale = Math.min(3.2, Math.max(1, pxRatio)) / cam.k;
  const topoLayer = useMemo(() => {
    const ui = uiScale;
    return (
      <>
        {/* Topo overlay — measured elevation contours with ft labels.
              Purely informational: never intercepts pointer events. */}
          {topo && topo.lines.length > 0 && (
            <g pointerEvents="none">
              {topo.lines.map((line) =>
                line.chains.map((ch, i) => (
                  <polyline
                    key={`c-${line.levelFt}-${i}`}
                    points={ch.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                    fill="none"
                    stroke="#FCD34D"
                    strokeWidth={1.3}
                    vectorEffect="non-scaling-stroke"
                    strokeOpacity={0.85}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )),
              )}
              {topo.lines.map((line) =>
                line.chains.slice(0, 3).map((ch, i) => {
                  let len = 0;
                  for (let k = 1; k < ch.length; k++) {
                    len += Math.hypot(ch[k].x - ch[k - 1].x, ch[k].y - ch[k - 1].y);
                  }
                  if (len < 70) return null;
                  const mid = ch[Math.floor(ch.length / 2)];
                  // keep labels clear of the canvas border so they never clip
                  if (
                    mid.x < 26 ||
                    mid.x > CANVAS_W - 26 ||
                    mid.y < 16 ||
                    mid.y > CANVAS_H - 16
                  )
                    return null;
                  return (
                    <g
                      key={`cl-${line.levelFt}-${i}`}
                      transform={`translate(${mid.x}, ${mid.y}) scale(${ui})`}
                    >
                      <text
                        y={-3}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={700}
                        fill="#FDE68A"
                        stroke="#1C1917"
                        strokeWidth={2.6}
                        style={{ paintOrder: "stroke" }}
                      >
                        +{line.levelFt}′
                      </text>
                    </g>
                  );
                }),
              )}
              <g transform={`translate(${CANVAS_W - 10}, 20) scale(${ui})`}>
                <text
                  textAnchor="end"
                  fontSize={10.5}
                  fontWeight={600}
                  fill="#FDE68A"
                  stroke="#1C1917"
                  strokeWidth={2.6}
                  style={{ paintOrder: "stroke" }}
                >
                  Topo lines every {topo.intervalFt}′ — feet above the low point
                </text>
              </g>
            </g>
          )}
      </>
    );
  }, [topo, uiScale]);

  // Counter-scale for zoom AND for the rendered canvas size: strokes use
  // vector-effect, but dot radii, label chips and text live in world
  // units — multiply by `ui` so they stay the same CSS size at any zoom
  // and on any screen. Without the pxRatio term a "40 ft" chip is 4 CSS
  // px tall on a phone; capped so a very narrow canvas can't blow the
  // labels up past the fence they annotate.
  const ui = uiScale;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar. The tool picker scrolls sideways on a phone rather than
          wrapping to three rows and eating the aerial; every control is
          a 40px-tall touch target down there. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5">
            {(
              [
                { id: "select", label: "Select", Icon: MousePointer2 },
                { id: "draw", label: "Draw fence", Icon: PenLine },
                { id: "gate", label: "Add gate", Icon: DoorOpen },
                { id: "section" as Tool, label: "Section", Icon: Layers },
                ...(onBuildingsChange
                  ? [{ id: "house" as Tool, label: "House", Icon: Home }]
                  : []),
              ] as { id: Tool; label: string; Icon: typeof PenLine }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                aria-pressed={tool === t.id}
                className={cn(
                  "transition-smooth ring-focus inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold sm:h-7 sm:px-3",
                  tool === t.id
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                <t.Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {tool === "section" && (
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-100 py-0.5 pl-3 pr-1">
            <span className="hidden shrink-0 text-[11px] font-semibold text-zinc-500 sm:inline">
              Build this stretch as
            </span>
            <select
              value={secType}
              onChange={(e) => setSecType(e.target.value as FenceTypeId)}
              aria-label="Fence type for this section"
              className="h-8 min-w-0 rounded-full border-0 bg-white px-2 text-[11px] font-semibold text-zinc-800 shadow-sm outline-none sm:h-6"
            >
              {FENCE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {tool === "gate" && (
          <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 p-0.5">
            {(["single", "double", "custom"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setGateKind(k)}
                aria-pressed={gateKind === k}
                className={cn(
                  "transition-smooth ring-focus inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-[11px] font-semibold sm:h-6 sm:px-2.5",
                  gateKind === k
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {k === "single" ? "Walk 4'" : k === "double" ? "Drive 10'" : "Custom"}
              </button>
            ))}
            {gateKind === "custom" && (
              <span className="flex items-center gap-1 pr-1.5 text-[11px] font-semibold text-zinc-600">
                <input
                  type="number"
                  inputMode="numeric"
                  min={3}
                  max={24}
                  step={1}
                  value={customGateFt}
                  aria-label="Custom gate width in feet"
                  onChange={(e) => setCustomGateFt(Number(e.target.value) || 6)}
                  className="h-8 w-14 rounded-md border border-zinc-200 bg-white px-1.5 text-center text-[11px] tabular-nums outline-none focus:border-accent-400 sm:h-6 sm:w-12"
                />
                ft
              </span>
            )}
          </div>
        )}
        {scan.suggestedRuns.length > 0 && draft.length === 0 && (
          <button
            type="button"
            onClick={usePropertyLine}
            className="transition-smooth ring-focus press-scale inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent-300 bg-accent-50 px-3.5 text-xs font-semibold text-accent-800 hover:bg-accent-100 sm:h-7 sm:px-3"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Use property line
          </button>
        )}
        {selectedSeg && (() => {
          const run = layout.runs.find((r) => r.id === selectedSeg.runId);
          const a = run?.points[selectedSeg.index];
          const b = run?.points[selectedSeg.index + 1];
          const ft = a && b ? Math.round(Math.hypot(b.x - a.x, b.y - a.y) / pxPerFt) : 0;
          return (
            <button
              type="button"
              onClick={() => removeSegment(selectedSeg.runId, selectedSeg.index)}
              className="transition-smooth ring-focus press-scale inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-3.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 sm:h-7 sm:px-3"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete section{ft > 0 ? ` (${ft} ft)` : ""}
            </button>
          );
        })()}
        {selectedRun && (
          <button
            type="button"
            onClick={() => removeRun(selectedRun)}
            className="transition-smooth ring-focus press-scale inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-3.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 sm:h-7 sm:px-3"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete run
          </button>
        )}
        {selectedHouse !== null && onBuildingsChange && (
          <button
            type="button"
            onClick={() => {
              onBuildingsChange(buildings.filter((_, i) => i !== selectedHouse));
              setSelectedHouse(null);
            }}
            className="transition-smooth ring-focus press-scale inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-3.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 sm:h-7 sm:px-3"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete house
          </button>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-accent-600 px-3 py-1 text-xs font-bold text-white">
          {totalLf} LF · {layout.gates.length}{" "}
          {layout.gates.length === 1 ? "gate" : "gates"}
        </span>
      </div>

      {/* Canvas */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950">
        <svg
          ref={svgRef}
          viewBox={`${cam.cx - CANVAS_W / 2 / cam.k} ${cam.cy - CANVAS_H / 2 / cam.k} ${CANVAS_W / cam.k} ${CANVAS_H / cam.k}`}
          // Touch owns this surface: without touch-action:none a drag
          // scrolls the page instead of panning the yard, and a pinch
          // zooms the whole document instead of the aerial.
          style={{ touchAction: "none" }}
          className={cn(
            "block h-auto w-full touch-none select-none",
            tool === "draw" || tool === "gate" || tool === "house" || tool === "section"
              ? "cursor-crosshair"
              : "cursor-grab active:cursor-grabbing",
          )}
          onClick={onCanvasClick}
          onDoubleClick={(e) => {
            e.preventDefault();
            if (tool === "draw") finishDraft();
            else if (tool === "house") finishHouse();
            else zoomAt(e.clientX, e.clientY, 1.6);
          }}
          onPointerDown={(e) => {
            ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            // Two fingers down = pinch. Park the pan and remember the
            // starting spread/midpoint so zoom tracks the gesture.
            if (ptrsRef.current.size === 2) {
              const [a, b] = [...ptrsRef.current.values()];
              pinchRef.current = {
                d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
                mx: (a.x + b.x) / 2,
                my: (a.y + b.y) / 2,
                cam: camRef.current,
              };
              panRef.current = null;
              didPanRef.current = true; // never let a pinch place a post
              return;
            }
            if (ptrsRef.current.size > 2) return;
            // Drag-to-pan works in EVERY tool — on a phone there is no
            // middle button, and you have to be able to move the yard
            // around while drawing. A press that never travels past the
            // slop threshold still lands as a tap. Capture is deliberately
            // NOT taken here: while a pointer is captured the follow-up
            // click retargets to the <svg>, and the runs/gates/sections
            // would stop receiving their own clicks. It's taken below,
            // the moment the press turns into a real drag.
            if (e.button === 1) e.preventDefault();
            panRef.current = { sx: e.clientX, sy: e.clientY, cx: cam.cx, cy: cam.cy };
            didPanRef.current = false;
          }}
          onPointerMove={(e) => {
            if (ptrsRef.current.has(e.pointerId)) {
              ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }
            const pinch = pinchRef.current;
            if (pinch && ptrsRef.current.size >= 2) {
              const [a, b] = [...ptrsRef.current.values()];
              const r = svgRef.current!.getBoundingClientRect();
              const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const c0 = pinch.cam;
              const k = Math.min(5, Math.max(1, c0.k * (d / pinch.d)));
              // World point that sat under the pinch's starting midpoint…
              const vw0 = CANVAS_W / c0.k;
              const vh0 = CANVAS_H / c0.k;
              const wx = c0.cx - vw0 / 2 + ((pinch.mx - r.left) / r.width) * vw0;
              const wy = c0.cy - vh0 / 2 + ((pinch.my - r.top) / r.height) * vh0;
              // …stays under the fingers as they spread and slide.
              const vw = CANVAS_W / k;
              const vh = CANVAS_H / k;
              setCam(
                clampCam({
                  k,
                  cx: wx - ((mx - r.left) / r.width - 0.5) * vw,
                  cy: wy - ((my - r.top) / r.height - 0.5) * vh,
                }),
              );
              return;
            }
            const pan = panRef.current;
            if (!pan) {
              updateGhosts(e);
              return;
            }
            const moved = Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy);
            if (!didPanRef.current && moved < PAN_SLOP_PX) {
              // Still a tap — show what it would do (snap ring, ghost
              // gate, section preview) so touch users get the same
              // aiming feedback a mouse gets from hovering.
              updateGhosts(e);
              return;
            }
            if (!didPanRef.current) {
              // Real drag now — take the pointer so it keeps panning even
              // if the finger leaves the canvas.
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* pointer already gone — panning still works unaptured */
              }
            }
            didPanRef.current = true;
            const r = svgRef.current!.getBoundingClientRect();
            const s = CANVAS_W / camRef.current.k / r.width;
            setCam(
              clampCam({
                k: camRef.current.k,
                cx: pan.cx - (e.clientX - pan.sx) * s,
                cy: pan.cy - (e.clientY - pan.sy) * s,
              }),
            );
          }}
          onPointerUp={(e) => {
            ptrsRef.current.delete(e.pointerId);
            if (ptrsRef.current.size < 2) pinchRef.current = null;
            if (ptrsRef.current.size === 0) panRef.current = null;
          }}
          onPointerCancel={(e) => {
            ptrsRef.current.delete(e.pointerId);
            if (ptrsRef.current.size < 2) pinchRef.current = null;
            if (ptrsRef.current.size === 0) panRef.current = null;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            setHover(null);
            setGateGhost(null);
            setSecGhost(null);
            setSnapLocked(false);
          }}
          onContextMenu={(e) => {
            // Right-click = finish (or cancel an empty draft) — the "let
            // go of the line" gesture.
            if (tool === "draw") {
              e.preventDefault();
              if (draft.length >= 2) finishDraft();
              else setDraft([]);
            } else if (tool === "house") {
              e.preventDefault();
              if (houseDraft.length >= 3) finishHouse();
              else setHouseDraft([]);
            }
          }}
        >
          <image
            href={scan.aerial.imageDataUrl}
            x={0}
            y={0}
            width={CANVAS_W}
            height={CANVAS_H}
            preserveAspectRatio="xMidYMid slice"
          />

          {topoLayer}

          {/* Building footprints — the house the fence ties into */}
          {buildings.map((ring, i) => (
            <polygon
              key={`bldg-${i}`}
              pointerEvents="none"
              points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill={
                i === selectedHouse
                  ? "rgba(228,228,231,0.35)"
                  : "rgba(24,24,27,0.26)"
              }
              stroke={i === selectedHouse ? "#FDA4AF" : "rgba(244,244,245,0.9)"}
              strokeWidth={i === selectedHouse ? 2.2 : 1.4}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ))}

          {/* House outline being traced */}
          {houseDraft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={[...houseDraft, ...(hover && tool === "house" ? [hover] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="rgba(244,244,245,0.12)"
                stroke="#F4F4F5"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="6 5"
                strokeLinejoin="round"
              />
              {houseDraft.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={(i === 0 && houseDraft.length >= 3 ? 6 : 3.5) * ui}
                  fill={i === 0 && houseDraft.length >= 3 ? "#22C55E" : "#F4F4F5"}
                  stroke="#18181B"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}

          {/* Neighbouring parcels — context lines only, deliberately
              quieter than the subject. No labels: the chips read as
              clutter on the photo (the county record for the SUBJECT
              lot is spelled out under the canvas instead). */}
          {(scan.neighborRings ?? []).map((ring, i) => {
            if (ring.length < 3) return null;
            const pts = ring.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <g key={`nbr-${i}`} className="pointer-events-none">
                <polygon
                  points={pts}
                  fill="none"
                  stroke="rgba(15,23,20,0.4)"
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="4 5"
                />
                <polygon
                  points={pts}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={1.1}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="4 5"
                />
              </g>
            );
          })}

          {/* Parcel boundary — the Regrid property line */}
          {scan.parcelRings.map((ring, i) => {
            const pts = ring.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              // White reads on any imagery because it rides a soft dark
              // casing — crisp over bright driveways AND dark tree cover.
              <g key={`parcel-${i}`}>
                <polygon
                  points={pts}
                  fill="rgba(255,255,255,0.05)"
                  stroke="rgba(15,23,20,0.55)"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6 4"
                />
                <polygon
                  points={pts}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6 4"
                />
              </g>
            );
          })}

          {/* Fence runs */}
          {layout.runs.map((run) => {
            const ft = Math.round(canvasPolylineFt(run.points, pxPerFt));
            const mid = run.points[Math.floor(run.points.length / 2)];
            const selected = run.id === selectedRun;
            return (
              <g key={run.id}>
                <polyline
                  points={run.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={selected ? "#fbbf24" : "#22d3ee"}
                  strokeWidth={selected ? 5 : 3.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer", filter: "drop-shadow(0 0 4px rgba(34,211,238,0.6))" }}
                  onClick={(e) => {
                    // Gate + section tools CLICK ON the run to place
                    // things — the run must not steal those clicks.
                    if (tool !== "gate" && tool !== "section") {
                      e.stopPropagation();
                      if (consumePan()) return;
                      setSelectedRun(run.id);
                      // Remember WHICH bay was clicked — Delete removes
                      // just that piece, not the whole line.
                      const pt = toCanvas(e);
                      let bestI = 0, bestD = Infinity;
                      for (let i = 1; i < run.points.length; i++) {
                        const a = run.points[i - 1], b = run.points[i];
                        const abx = b.x - a.x, aby = b.y - a.y;
                        const len2 = abx * abx + aby * aby || 1;
                        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2));
                        const d = Math.hypot(a.x + t * abx - pt.x, a.y + t * aby - pt.y);
                        if (d < bestD) { bestD = d; bestI = i - 1; }
                      }
                      setSelectedSeg({ runId: run.id, index: bestI });
                      setTool("select");
                    }
                  }}
                />
                {selected &&
                  selectedSeg?.runId === run.id &&
                  run.points[selectedSeg.index + 1] && (
                    <polyline
                      points={`${run.points[selectedSeg.index].x},${run.points[selectedSeg.index].y} ${run.points[selectedSeg.index + 1].x},${run.points[selectedSeg.index + 1].y}`}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={6}
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                      pointerEvents="none"
                      style={{ filter: "drop-shadow(0 0 5px rgba(245,158,11,0.8))" }}
                    />
                  )}
                {run.points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3 * ui} fill="#fff" stroke="#0891b2" vectorEffect="non-scaling-stroke" />
                ))}
                {mid && ft > 4 && (
                  <g transform={`translate(${mid.x}, ${mid.y}) scale(${ui}) translate(0, -12)`} pointerEvents="none">
                    <rect x={-24} y={-11} width={48} height={18} rx={5} fill="rgba(9,20,12,0.85)" />
                    <text x={0} y={3} textAnchor="middle" fontSize={11} fontWeight={700} fill="#a7f3d0">
                      {ft} ft
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Mixed-type sections — a stretch of the run built as a
              different fence, drawn over the run in its own color */}
          {(layout.sections ?? []).map((s) => {
            const run = layout.runs.find((r) => r.id === s.runId);
            if (!run) return null;
            const pts = slicePolyline(run.points, s.aArc, s.bArc);
            if (pts.length < 2) return null;
            const t = fenceType(s.type);
            const color = SECTION_COLORS[t.category] ?? "#94A3B8";
            const mid = pts[Math.floor(pts.length / 2)];
            const label = `${t.label} · ${s.lfFt}′`;
            const w = label.length * 5.6 + 14;
            return (
              <g
                key={s.id}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (consumePan()) return;
                  onChange({
                    ...layout,
                    sections: (layout.sections ?? []).filter((x) => x.id !== s.id),
                  });
                  say("Section removed — that stretch is back to the main fence type.");
                }}
              >
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#0b1210"
                  strokeWidth={7}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  opacity={0.45}
                />
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={4.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeDasharray="10 4"
                />
                <g transform={`translate(${mid.x}, ${mid.y}) scale(${ui}) translate(0, -14)`} pointerEvents="none">
                  <rect x={-w / 2} y={-10} width={w} height={17} rx={8} fill="rgba(9,20,12,0.9)" />
                  <text y={2.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={color}>
                    {label}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Section tool: first-end marker + live preview to the ghost */}
          {tool === "section" && sectionStart && secGhost && secGhost.runId === sectionStart.runId && (() => {
            const run = layout.runs.find((r) => r.id === sectionStart.runId);
            if (!run) return null;
            const pts = slicePolyline(run.points, sectionStart.arc, secGhost.arc);
            const lf = Math.round(Math.abs(secGhost.arc - sectionStart.arc) / pxPerFt);
            const color = SECTION_COLORS[fenceType(secType).category] ?? "#94A3B8";
            return (
              <g pointerEvents="none">
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={4.5}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                  opacity={0.9}
                />
                <g transform={`translate(${secGhost.q.x}, ${secGhost.q.y}) scale(${ui}) translate(14, -14)`}>
                  <rect x={0} y={-11} width={52} height={18} rx={6} fill="rgba(9,20,12,0.9)" />
                  <text x={26} y={2} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={color}>
                    {lf} ft
                  </text>
                </g>
              </g>
            );
          })()}
          {tool === "section" && sectionStart && (
            <circle cx={sectionStart.q.x} cy={sectionStart.q.y} r={5.5 * ui} fill={SECTION_COLORS[fenceType(secType).category] ?? "#94A3B8"} stroke="#0b1210" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}
          {tool === "section" && secGhost && !sectionStart && (
            <circle cx={secGhost.q.x} cy={secGhost.q.y} r={7 * ui} fill="none" stroke={SECTION_COLORS[fenceType(secType).category] ?? "#94A3B8"} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />
          )}

          {/* Draft run being drawn — live numbers at the cursor */}
          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={[...draft, ...(hover ? [hover] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="7 5"
                strokeLinecap="round"
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5 * ui} fill="#fbbf24" />
              ))}
              {hover && (() => {
                const last = draft[draft.length - 1];
                const segFt = Math.round(
                  Math.hypot(hover.x - last.x, hover.y - last.y) / pxPerFt,
                );
                const totalFt = Math.round(
                  canvasPolylineFt([...draft, hover], pxPerFt),
                );
                const label =
                  draft.length > 1 ? `+${segFt} ft · ${totalFt} ft total` : `${segFt} ft`;
                const w = label.length * 6.6 + 16;
                return (
                  <g transform={`translate(${hover.x}, ${hover.y}) scale(${ui}) translate(14, -16)`}>
                    <rect x={0} y={-12} width={w} height={20} rx={6} fill="rgba(9,20,12,0.9)" />
                    <text x={w / 2} y={2} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fde68a">
                      {label}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          {/* Snap lock — the cursor is magnetically attached to a
              corner, another run or the house wall */}
          {tool === "draw" && hover && snapLocked && (
            <g pointerEvents="none">
              <circle cx={hover.x} cy={hover.y} r={8 * ui} fill="none" stroke="#22C55E" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              <circle cx={hover.x} cy={hover.y} r={2.2 * ui} fill="#22C55E" />
            </g>
          )}

          {/* Ghost gate preview in gate mode */}
          {tool === "gate" && gateGhost && (
            <circle
              cx={gateGhost.x}
              cy={gateGhost.y}
              r={9 * ui}
              fill="rgba(244,114,182,0.35)"
              stroke="#f472b6"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}

          {/* Gates — drawn at their real width along the run */}
          {layout.gates.map((g) => {
            const widthFt = g.widthFt ?? (g.kind === "double" ? 10 : 4);
            const dir = runDirectionAt(g, layout.runs);
            const half = (widthFt * pxPerFt) / 2;
            const a = { x: g.x - dir.x * half, y: g.y - dir.y * half };
            const b = { x: g.x + dir.x * half, y: g.y + dir.y * half };
            return (
              <g
                key={g.id}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (consumePan()) return;
                  onChange({
                    ...layout,
                    gates: layout.gates.filter((x) => x.id !== g.id),
                  });
                }}
              >
                {/* the opening: interrupt the run visually */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0b1210" strokeWidth={7} vectorEffect="non-scaling-stroke" strokeLinecap="round" opacity={0.55} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f472b6" strokeWidth={4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeDasharray="6 4" />
                <circle cx={a.x} cy={a.y} r={3.5 * ui} fill="#fff" stroke="#f472b6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <circle cx={b.x} cy={b.y} r={3.5 * ui} fill="#fff" stroke="#f472b6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <g transform={`translate(${g.x}, ${g.y}) scale(${ui}) translate(0, -14)`} pointerEvents="none">
                  <rect x={-17} y={-10} width={34} height={16} rx={8} fill="#f472b6" />
                  <text y={2.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff">
                    {widthFt}&apos;
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Draft controls, floating over the aerial where the hand
            already is. On a phone the toolbar is off at the top of the
            screen and there is no Backspace — Undo has to live here. */}
        {(draft.length > 0 || houseDraft.length > 0) && (
          <div className="anim-enter-fade absolute bottom-3 left-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                draft.length > 0
                  ? setDraft((d) => d.slice(0, -1))
                  : setHouseDraft((d) => d.slice(0, -1))
              }
              aria-label="Undo last post"
              className="transition-smooth ring-focus press-scale inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white sm:h-8 sm:w-8"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={draft.length > 0 ? finishDraft : finishHouse}
              disabled={draft.length > 0 ? draft.length < 2 : houseDraft.length < 3}
              className="transition-smooth ring-focus press-scale inline-flex h-10 items-center gap-1.5 rounded-full bg-accent-600 px-4 text-xs font-bold text-white shadow-elevated hover:bg-accent-700 disabled:opacity-50 sm:h-8 sm:px-3.5"
            >
              <Check className="h-4 w-4" />
              {draft.length > 0 ? "Finish run" : "Close outline"}
            </button>
            <button
              type="button"
              onClick={() => (draft.length > 0 ? setDraft([]) : setHouseDraft([]))}
              aria-label="Cancel"
              className="transition-smooth ring-focus press-scale inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-zinc-600 shadow-sm ring-1 ring-zinc-200 hover:bg-white sm:h-8 sm:w-8"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* zoom controls — pinch / ctrl+scroll zooms, scroll pans,
            drag pans in any tool, double-click (select tool) zooms in */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              const r = svgRef.current?.getBoundingClientRect();
              if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.45);
            }}
            className="transition-smooth ring-focus press-scale h-9 w-9 rounded-full bg-white/90 text-base font-bold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white sm:h-7 sm:w-7 sm:text-sm"
          >
            −
          </button>
          <button
            type="button"
            title="Reset view"
            onClick={() => setCam({ cx: CANVAS_W / 2, cy: CANVAS_H / 2, k: 1 })}
            className="transition-smooth ring-focus press-scale h-9 rounded-full bg-white/90 px-2.5 text-[11px] font-bold tabular-nums text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white sm:h-7 sm:px-2"
          >
            {cam.k === 1 ? "100%" : `${Math.round(cam.k * 100)}% ⤺`}
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              const r = svgRef.current?.getBoundingClientRect();
              if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.45);
            }}
            className="transition-smooth ring-focus press-scale h-9 w-9 rounded-full bg-white/90 text-base font-bold text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white sm:h-7 sm:w-7 sm:text-sm"
          >
            +
          </button>
        </div>
      </div>

      {notice && (
        <p className="anim-enter-fade rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          {notice}
        </p>
      )}
      <p className="text-xs leading-relaxed text-zinc-400">
        {tool === "draw"
          ? draft.length > 0
            ? touch
              ? "Keep tapping posts — ✓ Finish ends the run, ↩ steps back one post. Drag to move the photo, pinch to zoom."
              : "Click to keep adding posts — ✓ Finish (or double-click / right-click / Enter) ends the run · Backspace steps back · Esc cancels."
            : touch
              ? "Tap to start a fence line — points snap to the property corners and to your other runs. Drag to move the photo, pinch to zoom."
              : "Click to start a fence line. Points snap to the property corners and to your other runs. Drag to pan, pinch or ctrl+scroll to zoom."
          : tool === "section"
            ? sectionStart
              ? `Now ${verb} the OTHER end of the stretch on the same line — it becomes the picked type.`
              : `Pick the type above, then ${verb} where the different fence STARTS on a line. ${touch ? "Tap" : "Click"} a marked section to remove it.`
            : tool === "house"
              ? houseDraft.length > 0
                ? `${touch ? "Tap" : "Click"} corner to corner around the house — ${touch ? "tap" : "click"} the green first dot to close the outline.`
                : `Trace the house: ${verb} its corners on the photo. The outline shows in the client's diagram and 3D.`
              : tool === "gate"
                ? `${touch ? "Tap" : "Click"} anywhere on a fence line to place the gate. ${touch ? "Tap" : "Click"} a gate to remove it.`
                : touch
                  ? "Drag the photo to move around, pinch to zoom. Tap a fence run or the house outline to select it."
                  : "Drag the photo to move around, scroll or pinch to zoom. Click a fence line to pick the piece under your cursor — Delete removes that piece; the Delete run button clears the whole line."}
      </p>
    </div>
  );
}
