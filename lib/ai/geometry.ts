// TODO(fence): this module used to hold the full satellite-takeoff geometry
// toolkit (lat/lng↔pixel projection, eave classification, downspout
// placement, …) for the removed roof engine. Only the generic 2D helper the
// interactive canvas still uses survives. Fence-engine geometry will grow
// back here.

type Pt = { x: number; y: number };

/**
 * Douglas–Peucker line simplification. Collapses near-colinear vertices so a
 * noisy freehand polyline becomes a clean architectural outline.
 */
export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}
