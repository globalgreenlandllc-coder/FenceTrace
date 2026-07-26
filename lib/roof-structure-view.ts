/**
 * roof-structure-view — pure selection of the roof geometry a canvas overlay
 * should draw for a stored takeoff.
 *
 * The proposal preview historically re-derived a grid skeleton client-side
 * and mixed it with the engine's stored lines: two skeletons on one canvas,
 * and the GABLE labels (stored gable ends) could sit on wedges drawn by the
 * OTHER skeleton — a hip-shaped face labeled "GABLE". When the stored
 * structure carries engine-drawn geometry (v2 blueprint rows), the overlay
 * must render THAT geometry verbatim — one source of truth, nothing
 * re-invented — so clients only ever see evidenced lines.
 *
 * Pure and framework-free so node tests can pin the selection rules.
 */

export type ViewPt = { x: number; y: number };
export type ViewLine = { id?: string; points: ViewPt[] };
export type ViewFace = { polygon: ViewPt[]; downhill: ViewPt };

export type EngineViewGeometry = {
  ridges: { points: ViewPt[] }[];
  hips: { points: ViewPt[] }[];
  valleys: { points: ViewPt[] }[];
  /** gable-end BASES (two points) — the same channel the GABLE labels use */
  gables: { points: ViewPt[] }[];
  faces: ViewFace[];
  /** tier STEP edges (interior mass boundaries) — drawn thin solid, verbatim
   *  like the others; empty on rows stored before the steps channel existed */
  steps: { points: ViewPt[] }[];
};

const hasEngineId = (lines: readonly ViewLine[] | undefined): boolean =>
  (lines ?? []).some(
    (l) => typeof l.id === "string" && l.id.startsWith("engine-"),
  );

/**
 * Is a point ON (near) the roof perimeter, within a tolerance proportional
 * to the footprint span? Pure predicate for the canvas's gable-WING guard:
 * a rake whose midpoint fails this test is an interior artifact — drawing a
 * translucent wing quad there puts an unlabeled floating box mid-roof, so
 * the wing is skipped (the rake line itself still draws). With no usable
 * perimeter there is nothing to test against, so the answer is `true`
 * (never veto on missing data — legacy behavior unchanged).
 */
export function isNearPerimeter(
  p: ViewPt,
  perimeter: readonly ViewPt[] | undefined,
  tolFrac = 0.05,
): boolean {
  if (!perimeter || perimeter.length < 3) return true;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of perimeter) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) return true;
  const tol = Math.max(span * tolFrac, 4);
  let best = Infinity;
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i];
    const b = perimeter[(i + 1) % perimeter.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best <= tol;
}

/**
 * When the stored structure was drawn by the takeoff engine (any interior
 * line carries an `engine-*` id, or validated faces travel with it), return
 * it verbatim for the overlay. Returns null for legacy/satellite structures —
 * the caller keeps its existing client-side derivation for those.
 */
export function engineDrawnGeometry(structure: {
  ridges: ViewLine[];
  hips?: ViewLine[];
  valleys: ViewLine[];
  gables?: ViewLine[];
  faces?: ViewFace[];
  steps?: ViewLine[];
}): EngineViewGeometry | null {
  const engineDrawn =
    hasEngineId(structure.ridges) ||
    hasEngineId(structure.hips) ||
    hasEngineId(structure.valleys) ||
    hasEngineId(structure.gables) ||
    // Steps count too: an engine row whose interior was omitted (not enough
    // evidenced structure) may carry ONLY tier steps — the grid derivation
    // must still not re-invent lines for it.
    hasEngineId(structure.steps) ||
    (structure.faces?.length ?? 0) > 0;
  if (!engineDrawn) return null;
  const strip = (ls: readonly ViewLine[] | undefined) =>
    (ls ?? [])
      .filter((l) => l.points.length >= 2)
      .map((l) => ({ points: l.points }));
  return {
    ridges: strip(structure.ridges),
    hips: strip(structure.hips),
    valleys: strip(structure.valleys),
    // Gable label + drawn base come from the SAME entries — the label can
    // never sit on geometry another derivation invented.
    gables: (structure.gables ?? [])
      .filter((l) => l.points.length >= 2)
      .map((l) => ({ points: [l.points[0], l.points[l.points.length - 1]] })),
    faces: structure.faces ?? [],
    steps: strip(structure.steps),
  };
}
