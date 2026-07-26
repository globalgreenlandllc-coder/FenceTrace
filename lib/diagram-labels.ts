/**
 * Diagram label layout — pure geometry, no React/DOM (unit-testable under
 * node/tsx, same pattern as lib/roof-skeleton.ts / lib/orientation-anchor.ts).
 *
 * Two jobs, both display-only (never touch LF / pricing):
 *
 * 1. `layoutLabels` — deterministic relaxation that spreads label pills apart
 *    and pushes them off obstacles (eave lines, downspout pins, orientation
 *    chips). The per-label "perpendicular offset from the midpoint" placement
 *    used by both canvases is a good START, but on a 20-run footprint the
 *    pills routinely land on each other, on a downspout pin sitting at the
 *    same midpoint, or across a hip line. The solver takes those preferred
 *    positions and relaxes collisions away; callers draw a thin leader back
 *    to the run when a label had to travel.
 *
 * 2. `dropDanglingLines` — filters interior roof skeleton lines (ridges /
 *    hips / valleys) that don't CONNECT to anything. A well-formed skeleton
 *    line touches the perimeter, a gable end, or another skeleton line at
 *    BOTH ends; a porch/patio ridge stub the engine emitted without its
 *    cover outline floats in space and reads as a random pen stroke on the
 *    client proposal. Removal iterates to a fixpoint so a chain hanging off
 *    nothing is fully removed.
 */

export type DPt = { x: number; y: number };

export type LabelBox = {
  id: string;
  /** Preferred center (the caller's ideal spot — outward off the run). */
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export type SegObstacle = { a: DPt; b: DPt; pad?: number };
export type DiscObstacle = { x: number; y: number; r: number };
export type RectObstacle = { cx: number; cy: number; w: number; h: number };
export type LayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type PlacedLabel = {
  cx: number;
  cy: number;
  /** Distance from the preferred center — callers draw a leader line back
   *  to the run when this exceeds their threshold. */
  moved: number;
};

/** Distance from point P to segment AB. */
export function distPointSeg(p: DPt, a: DPt, b: DPt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function closestOnSeg(p: DPt, a: DPt, b: DPt): DPt {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

type Live = { id: string; px: number; py: number; cx: number; cy: number; w: number; h: number };

/**
 * Relax labels apart from each other and away from obstacles. Deterministic
 * (fixed iteration order, no randomness). Obstacles never move; labels do.
 * Bounds clamp (when provided) wins over everything so a pill can't leave
 * the drawing frame.
 */
export function layoutLabels(
  items: readonly LabelBox[],
  obstacles: {
    segments?: readonly SegObstacle[];
    discs?: readonly DiscObstacle[];
    rects?: readonly RectObstacle[];
  } = {},
  opts: { bounds?: LayoutBounds; iterations?: number; gap?: number } = {},
): Map<string, PlacedLabel> {
  const gap = opts.gap ?? 3;
  const iterations = opts.iterations ?? 30;
  const live: Live[] = items.map((it) => ({
    id: it.id,
    px: it.cx,
    py: it.cy,
    cx: it.cx,
    cy: it.cy,
    w: it.w,
    h: it.h,
  }));
  const segs = obstacles.segments ?? [];
  const discs = obstacles.discs ?? [];
  const rects = obstacles.rects ?? [];

  const clamp = (l: Live) => {
    const b = opts.bounds;
    if (!b) return;
    const hw = l.w / 2;
    const hh = l.h / 2;
    l.cx = Math.min(b.maxX - hw, Math.max(b.minX + hw, l.cx));
    l.cy = Math.min(b.maxY - hh, Math.max(b.minY + hh, l.cy));
  };

  for (let it = 0; it < iterations; it++) {
    // Label ↔ label: split the penetration between the two.
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i];
        const B = live[j];
        const dx = B.cx - A.cx;
        const dy = B.cy - A.cy;
        const ox = (A.w + B.w) / 2 + gap - Math.abs(dx);
        const oy = (A.h + B.h) / 2 + gap - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const p = (ox / 2 + 0.25) * (dx >= 0 ? 1 : -1);
            A.cx -= p;
            B.cx += p;
          } else {
            const p = (oy / 2 + 0.25) * (dy >= 0 ? 1 : -1);
            A.cy -= p;
            B.cy += p;
          }
        }
      }
    }
    // Label ↔ fixed rect (orientation chips): label takes the whole push.
    for (const l of live) {
      for (const r of rects) {
        const dx = l.cx - r.cx;
        const dy = l.cy - r.cy;
        const ox = (l.w + r.w) / 2 + gap - Math.abs(dx);
        const oy = (l.h + r.h) / 2 + gap - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) l.cx += (ox + 0.25) * (dx >= 0 ? 1 : -1);
          else l.cy += (oy + 0.25) * (dy >= 0 ? 1 : -1);
        }
      }
    }
    // Label ↔ disc (downspout pins): push along the center→closest axis.
    for (const l of live) {
      for (const d of discs) {
        // Closest point of the label rect to the disc center.
        const qx = Math.min(l.cx + l.w / 2, Math.max(l.cx - l.w / 2, d.x));
        const qy = Math.min(l.cy + l.h / 2, Math.max(l.cy - l.h / 2, d.y));
        const ddx = qx - d.x;
        const ddy = qy - d.y;
        const dd = Math.hypot(ddx, ddy);
        const need = d.r + gap;
        if (dd >= need) continue;
        if (dd > 1e-6) {
          const push = (need - dd) / dd;
          l.cx += ddx * push;
          l.cy += ddy * push;
        } else {
          // Disc center inside the rect — push along the shorter exit axis.
          const exL = d.x - (l.cx - l.w / 2);
          const exR = l.cx + l.w / 2 - d.x;
          const exT = d.y - (l.cy - l.h / 2);
          const exB = l.cy + l.h / 2 - d.y;
          const m = Math.min(exL, exR, exT, exB);
          if (m === exL) l.cx += need + exL;
          else if (m === exR) l.cx -= need + exR;
          else if (m === exT) l.cy += need + exT;
          else l.cy -= need + exB;
        }
      }
    }
    // Label ↔ segment (eave/rake lines): push the pill off the line so a
    // label never sits across a run it isn't describing.
    for (const l of live) {
      for (const s of segs) {
        const q = closestOnSeg({ x: l.cx, y: l.cy }, s.a, s.b);
        let ux = l.cx - q.x;
        let uy = l.cy - q.y;
        let d = Math.hypot(ux, uy);
        if (d < 1e-6) {
          // Center exactly on the line: use the segment normal.
          const sx = s.b.x - s.a.x;
          const sy = s.b.y - s.a.y;
          const sl = Math.hypot(sx, sy) || 1;
          ux = -sy / sl;
          uy = sx / sl;
          d = 0;
        } else {
          ux /= d;
          uy /= d;
        }
        const need = (Math.abs(ux) * l.w) / 2 + (Math.abs(uy) * l.h) / 2 + (s.pad ?? 2) + gap;
        if (d < need) {
          const push = need - d;
          l.cx += ux * push;
          l.cy += uy * push;
        }
      }
    }
    for (const l of live) clamp(l);
  }

  const out = new Map<string, PlacedLabel>();
  for (const l of live) {
    out.set(l.id, {
      cx: l.cx,
      cy: l.cy,
      moved: Math.hypot(l.cx - l.px, l.cy - l.py),
    });
  }
  return out;
}

/**
 * Label anchor for a polyline run: the midpoint + unit normal of its
 * LONGEST segment. Using the first→last chord breaks on jogging runs (the
 * chord is a diagonal matching no wall) and on closed loops (first == last
 * → zero-length chord, label lands on a corner). The longest straight leg
 * is always a real drawn edge to hang the label off.
 */
export function polylineLabelAnchor(
  points: readonly DPt[],
): { mid: DPt; nx: number; ny: number } | null {
  let best = -1;
  let bi = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (d > best) {
      best = d;
      bi = i;
    }
  }
  if (bi < 0 || best <= 1e-6) return null;
  const a = points[bi - 1];
  const b = points[bi];
  return {
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    nx: -(b.y - a.y) / best,
    ny: (b.x - a.x) / best,
  };
}

/**
 * Drop interior skeleton lines that dangle in space. A line survives only
 * if BOTH endpoints sit within `tol` of an anchor segment (perimeter /
 * gable ends) or of another SURVIVING line. Removal loops to a fixpoint so
 * a chain that hangs off nothing is removed entirely — but a hip pair whose
 * only mutual support is each other at a shared apex (plus the perimeter at
 * their feet) is correctly kept.
 */
export function dropDanglingLines<T extends { points: DPt[] }>(
  lines: readonly T[],
  anchorSegments: readonly [DPt, DPt][],
  tol = 6,
): T[] {
  const alive = lines.filter((l) => l.points.length >= 2);
  const short = lines.filter((l) => l.points.length < 2);
  let survivors = [...alive];

  const nearAnchor = (p: DPt) =>
    anchorSegments.some(([a, b]) => distPointSeg(p, a, b) <= tol);
  const nearLine = (p: DPt, l: T) => {
    for (let i = 1; i < l.points.length; i++) {
      if (distPointSeg(p, l.points[i - 1], l.points[i]) <= tol) return true;
    }
    return false;
  };

  for (let pass = 0; pass < lines.length + 1; pass++) {
    const next = survivors.filter((l) => {
      const ends = [l.points[0], l.points[l.points.length - 1]];
      return ends.every(
        (e) =>
          nearAnchor(e) ||
          survivors.some((o) => o !== l && nearLine(e, o)),
      );
    });
    if (next.length === survivors.length) break;
    survivors = next;
  }
  // Preserve original order; degenerate (<2 pt) lines are dropped outright.
  void short;
  const keep = new Set(survivors);
  return alive.filter((l) => keep.has(l));
}
