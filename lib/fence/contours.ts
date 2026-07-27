/**
 * Elevation contours for the estimate canvas — pure math, unit-tested.
 *
 * A coarse elevation grid sampled over the visible yard (one batched
 * Elevation call at scan time) becomes topo lines via marching squares:
 * for each level, every grid cell contributes 0–2 segments interpolated
 * along its edges, and segments are chained end-to-end into polylines
 * the canvas can draw and label ("+8′ above the low point").
 */

export type Pt = { x: number; y: number };

export type ContourLine = {
  /** Elevation of this line, ft (relative to whatever datum the grid uses). */
  levelFt: number;
  /** Chained polylines in canvas px. */
  chains: Pt[][];
};

/** Pick a "nice" contour step so a yard shows ~≤9 lines. 0 ⇒ too flat
 *  to contour (span under a foot). */
export function pickContourInterval(minFt: number, maxFt: number): number {
  const span = maxFt - minFt;
  if (!Number.isFinite(span) || span < 1) return 0;
  for (const step of [1, 2, 5, 10, 20]) {
    if (span / step <= 9) return step;
  }
  return 50;
}

type Edge = "T" | "R" | "B" | "L";

/** Segments per marching-squares case (bit set = corner >= level;
 *  tl=8, tr=4, br=2, bl=1). Saddles (5, 10) resolve on the cell center. */
function caseSegments(mask: number, centerHigh: boolean): [Edge, Edge][] {
  switch (mask) {
    case 1: return [["L", "B"]];
    case 2: return [["B", "R"]];
    case 3: return [["L", "R"]];
    case 4: return [["T", "R"]];
    case 5: return centerHigh ? [["T", "L"], ["B", "R"]] : [["T", "R"], ["B", "L"]];
    case 6: return [["T", "B"]];
    case 7: return [["T", "L"]];
    case 8: return [["T", "L"]];
    case 9: return [["T", "B"]];
    case 10: return centerHigh ? [["T", "R"], ["B", "L"]] : [["T", "L"], ["B", "R"]];
    case 11: return [["T", "R"]];
    case 12: return [["L", "R"]];
    case 13: return [["B", "R"]];
    case 14: return [["L", "B"]];
    default: return [];
  }
}

const key = (p: Pt) => `${Math.round(p.x * 10)}_${Math.round(p.y * 10)}`;

/** Join loose segments into polylines by matching endpoints. */
function chainSegments(segs: [Pt, Pt][]): Pt[][] {
  const bucket = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const arr = bucket.get(k);
      if (arr) arr.push(i);
      else bucket.set(k, [i]);
    }
  });
  const used = new Array(segs.length).fill(false);
  const chains: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Pt[] = [segs[i][0], segs[i][1]];
    // extend forward then backward
    for (const dir of [1, -1] as const) {
      for (;;) {
        const tip = dir === 1 ? chain[chain.length - 1] : chain[0];
        const candidates = bucket.get(key(tip)) ?? [];
        const nextIdx = candidates.find((c) => !used[c]);
        if (nextIdx === undefined) break;
        used[nextIdx] = true;
        const [a, b] = segs[nextIdx];
        const next = key(a) === key(tip) ? b : a;
        if (dir === 1) chain.push(next);
        else chain.unshift(next);
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * grid[row][col] elevations (ft) → contour polylines in canvas px, where
 * point (col, row) sits at (col*cellW, row*cellH). Rows may be ragged or
 * short — anything under 2×2 contributes nothing.
 */
export function buildContours(
  grid: number[][],
  cellW: number,
  cellH: number,
  intervalFt: number,
): ContourLine[] {
  if (intervalFt <= 0 || grid.length < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (!Number.isFinite(v)) return []; // corrupt sample — no contours
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min) || max - min <= 0) return [];

  const out: ContourLine[] = [];
  const firstLevel = Math.ceil(min / intervalFt) * intervalFt;
  for (let level = firstLevel; level <= max; level += intervalFt) {
    if (level <= min) continue; // a line ON the minimum is just the border
    const segs: [Pt, Pt][] = [];
    for (let r = 0; r + 1 < grid.length; r++) {
      const rowA = grid[r];
      const rowB = grid[r + 1];
      const cols = Math.min(rowA.length, rowB.length);
      for (let c = 0; c + 1 < cols; c++) {
        const tl = rowA[c], tr = rowA[c + 1], br = rowB[c + 1], bl = rowB[c];
        const mask =
          (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
        if (mask === 0 || mask === 15) continue;
        const x0 = c * cellW, y0 = r * cellH;
        const lerp = (v0: number, v1: number) =>
          v1 === v0 ? 0.5 : Math.max(0, Math.min(1, (level - v0) / (v1 - v0)));
        const onEdge = (e: Edge): Pt =>
          e === "T"
            ? { x: x0 + lerp(tl, tr) * cellW, y: y0 }
            : e === "B"
              ? { x: x0 + lerp(bl, br) * cellW, y: y0 + cellH }
              : e === "L"
                ? { x: x0, y: y0 + lerp(tl, bl) * cellH }
                : { x: x0 + cellW, y: y0 + lerp(tr, br) * cellH };
        const centerHigh = (tl + tr + br + bl) / 4 >= level;
        for (const [e1, e2] of caseSegments(mask, centerHigh)) {
          segs.push([onEdge(e1), onEdge(e2)]);
        }
      }
    }
    if (segs.length > 0) {
      out.push({ levelFt: level, chains: chainSegments(segs) });
    }
  }
  return out;
}
