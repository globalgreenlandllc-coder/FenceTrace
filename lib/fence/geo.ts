/**
 * Geo math for the fence estimator — pure functions, no I/O.
 *
 * The estimate canvas is a 900×580 viewBox. We fetch a Google Static Map
 * at 640×412 (scale 2 for retina) — the same 1.5528 aspect — and draw it
 * full-bleed, so map-pixel → canvas-pixel is one uniform factor
 * (900 / 640 = 1.40625). All lat/lng → canvas math funnels through the
 * standard Web Mercator world-coordinate projection at the chosen zoom.
 */

export const CANVAS_W = 900;
export const CANVAS_H = 580;
export const MAP_W = 640;
export const MAP_H = 412;
export const MAP_SCALE = 2; // retina static map
const CANVAS_PER_MAP = CANVAS_W / MAP_W; // 1.40625, uniform both axes

export type LatLng = { lat: number; lng: number };
export type Pt = { x: number; y: number };

/** Web Mercator "world coordinates" (256×256 world at zoom 0). */
function worldCoord(p: LatLng): Pt {
  const siny = Math.min(
    0.9999,
    Math.max(-0.9999, Math.sin((p.lat * Math.PI) / 180)),
  );
  return {
    x: 256 * (0.5 + p.lng / 360),
    y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

/** Meters covered by one map pixel at this latitude/zoom (scale-adjusted). */
export function metersPerMapPx(lat: number, zoom: number): number {
  return (
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

/** Canvas px per FOOT for a map centered at `lat` rendered at `zoom`. */
export function canvasPxPerFt(lat: number, zoom: number): number {
  const metersPerCanvasPx = metersPerMapPx(lat, zoom) / CANVAS_PER_MAP;
  return 0.3048 / metersPerCanvasPx;
}

/** Project lat/lng into canvas coordinates for a map centered on `center`
 *  at `zoom` (map W×H at that zoom, drawn into the 900×580 canvas). */
export function latLngToCanvas(p: LatLng, center: LatLng, zoom: number): Pt {
  const scale = Math.pow(2, zoom);
  const w = worldCoord(p);
  const c = worldCoord(center);
  const mapPx = { x: (w.x - c.x) * scale + MAP_W / 2, y: (w.y - c.y) * scale + MAP_H / 2 };
  return {
    x: mapPx.x * CANVAS_PER_MAP,
    y: mapPx.y * CANVAS_PER_MAP,
  };
}

/** Pick the tightest integer zoom that fits the bbox in the map with ~12%
 *  margin. Clamped to residential-useful range. */
export function zoomToFit(points: LatLng[], fallback = 19): number {
  if (points.length < 2) return fallback;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    const w = worldCoord(p);
    minX = Math.min(minX, w.x);
    maxX = Math.max(maxX, w.x);
    minY = Math.min(minY, w.y);
    maxY = Math.max(maxY, w.y);
  }
  const margin = 1.24;
  const spanX = (maxX - minX) * margin;
  const spanY = (maxY - minY) * margin;
  for (let z = 21; z >= 15; z--) {
    const scale = Math.pow(2, z);
    if (spanX * scale <= MAP_W && spanY * scale <= MAP_H) return z;
  }
  return 15;
}

/** Centroid of a lat/lng ring (good enough for parcel centering). */
export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  let lat = 0,
    lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Inverse of latLngToCanvas — canvas point back to lat/lng for a map
 *  centered on `center` at `zoom` (used to sample real-world elevation
 *  along drawn fence runs). */
export function canvasToLatLng(p: Pt, center: LatLng, zoom: number): LatLng {
  const scale = Math.pow(2, zoom);
  const c = worldCoord(center);
  const mapPx = { x: p.x / CANVAS_PER_MAP, y: p.y / CANVAS_PER_MAP };
  const wx = (mapPx.x - MAP_W / 2) / scale + c.x;
  const wy = (mapPx.y - MAP_H / 2) / scale + c.y;
  const lng = (wx / 256 - 0.5) * 360;
  const n = Math.PI - (2 * Math.PI * wy) / 256;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Positions along a polyline every `spacingPx`, vertices included —
 *  the post positions of a run (used for elevation sampling + 3D). */
export function walkPostPositions(points: Pt[], spacingPx: number): Pt[] {
  if (points.length < 2 || spacingPx <= 0) return [...points];
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 0.5) continue;
    const chunks = Math.max(1, Math.ceil(segLen / spacingPx));
    for (let c = 1; c <= chunks; c++) {
      out.push({
        x: a.x + ((b.x - a.x) * c) / chunks,
        y: a.y + ((b.y - a.y) * c) / chunks,
      });
    }
  }
  return out;
}

/** Length of a canvas polyline in feet given the canvas scale. */
export function canvasPolylineFt(points: Pt[], pxPerFt: number): number {
  if (pxPerFt <= 0) return 0;
  let px = 0;
  for (let i = 1; i < points.length; i++) {
    px += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return px / pxPerFt;
}
