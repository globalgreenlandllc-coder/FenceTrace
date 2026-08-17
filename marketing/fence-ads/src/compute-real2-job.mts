/**
 * compute-real2-job.mts — price the boundary-line fence for v28-v30.
 *
 * The fence FOLLOWS THE COUNTY LINE: the back and both side lines of
 * the recorded parcel, stopping short of the street frontage (the front
 * yard stays open — how these jobs are actually built). That's the whole
 * pitch of this ad set: the boundary comes from the county, not from a
 * tape measure.
 *
 * Everything downstream is computed by the shipping engine — footage
 * from the real ring at the real px/ft, slope from the real USGS
 * lattice sampled at post positions, terrain/steps/tier prices from
 * takeoff + pricing with the real Washington market.
 *
 * writes: src/plates/real2-job.js
 */
import { readFileSync, writeFileSync } from "fs";
import { canvasPolylineFt, countCornersAndEnds, walkPostPositions } from "@/lib/fence/geo";
import { summarizeSlopes } from "@/lib/fence/slope";
import { computeFenceTakeoff } from "@/lib/fence/takeoff";
import { fenceTiers, priceFence } from "@/lib/fence/pricing";
import { fenceType } from "@/lib/fence/catalog";
import { resolveMarket } from "@/lib/fence/market";

const DIR = new URL("./plates/", import.meta.url).pathname;
const meta = JSON.parse(readFileSync(DIR + "real2-meta.json", "utf8"));
const parcelSrc = readFileSync(DIR + "real2-parcel.js", "utf8");
const parcel = JSON.parse(parcelSrc.match(/= (\{[\s\S]*\});/)![1]);
const topoSrc = readFileSync(DIR + "real2-topo.js", "utf8");
const grid: number[][] = JSON.parse(topoSrc.match(/REAL2_GRID = (\[\[[\s\S]*?\]\]);/)![1]);

const PX_PER_FT = meta.pxPerFt as number;
const ring: [number, number][] = parcel.ring;

/**
 * The parcel ring closes at its start; the street is the SOUTH edge
 * (bottom of frame, where the driveway meets the road). Fence the other
 * three sides: east line → north/back line → west line, stopping at the
 * front setback on both ends. Vertices are the county's own, untouched.
 */
const closed = ring.slice(0, -1); // drop the duplicate closing vertex
// Resolve the four working corners by GEOMETRY, not ring index, so the
// run is deterministic regardless of which vertex the county's polygon
// happens to start at or which way it winds.
const byY = [...closed].sort((a, b) => a[1] - b[1]);
const north = byY.slice(0, 2).sort((a, b) => a[0] - b[0]); // two northmost
const south = byY.slice(-2).sort((a, b) => a[0] - b[0]); // two southmost
const NW = north[0], NE = north[1], SW = south[0], SE = south[1];
// Front setback: pull the two street-side ends 18 ft back off the road
// line so the fence returns to the house instead of crossing the drive.
const SETBACK_FT = 18;
const pull = (from: [number, number], toward: [number, number]): [number, number] => {
  const d = Math.hypot(toward[0] - from[0], toward[1] - from[1]);
  const t = (SETBACK_FT * PX_PER_FT) / d;
  return [
    Math.round((from[0] + (toward[0] - from[0]) * t) * 10) / 10,
    Math.round((from[1] + (toward[1] - from[1]) * t) * 10) / 10,
  ];
};
const RUN_PTS: [number, number][] = [pull(SE, NE), NE, NW, pull(SW, NW)];

const pts = RUN_PTS.map(([x, y]) => ({ x, y }));
const totalLf = Math.round(canvasPolylineFt(pts, PX_PER_FT) * 10) / 10;
const { corners, ends } = countCornersAndEnds([{ points: pts }]);

/* real elevation at every post: bilinear over the USGS 18×12 lattice */
const COLS = 18, ROWS = 12;
const zAt = (x: number, y: number) => {
  const gx = Math.min(COLS - 1.001, Math.max(0, (x / 900) * (COLS - 1)));
  const gy = Math.min(ROWS - 1.001, Math.max(0, (y / 580) * (ROWS - 1)));
  const c0 = Math.floor(gx), r0 = Math.floor(gy);
  const fx = gx - c0, fy = gy - r0;
  return (
    grid[r0][c0] * (1 - fx) * (1 - fy) +
    grid[r0][c0 + 1] * fx * (1 - fy) +
    grid[r0 + 1][c0] * (1 - fx) * fy +
    grid[r0 + 1][c0 + 1] * fx * fy
  );
};
const spacingFt = fenceType("cedar-privacy").postSpacingFt;
const posts = walkPostPositions(pts, spacingFt * PX_PER_FT);
const elev = posts.map((p) => zAt(p.x, p.y));
const slope = summarizeSlopes([elev], spacingFt, 6, "stick");

const market = resolveMarket({ address: meta.address });
const layout = {
  type: "cedar-privacy" as const,
  heightFt: 6,
  totalLf,
  runLengths: [totalLf],
  corners,
  ends,
  gatesSingle: 1,
  gatesDouble: 0,
  terrain: slope.suggestedTerrain,
  steppedSections: slope.steppedSections,
  wastePct: 10,
  market,
};

const takeoff = computeFenceTakeoff(layout as never);
const tiers = fenceTiers("cedar-privacy").map((t) => {
  const p = priceFence({ ...layout, type: t.type, stain: t.stain } as never, { markupPct: t.markupPct });
  return {
    name: t.name,
    recommended: !!t.recommended,
    spec: fenceType(t.type).label,
    total: Math.round(p.total),
    perLf: Math.round(p.pricePerLf),
  };
});
const chosen = tiers.find((t) => t.recommended) ?? tiers[1];
const bomq = (re: RegExp) => takeoff.bom.find((b) => re.test(b.label))?.qty ?? 0;

/* one 4' walk gate on the west return, where the side yard opens */
const gateAt = 0.55; // fraction along the final (west) leg
const gx = RUN_PTS[2][0] + (RUN_PTS[3][0] - RUN_PTS[2][0]) * gateAt;
const gy = RUN_PTS[2][1] + (RUN_PTS[3][1] - RUN_PTS[2][1]) * gateAt;

const job = {
  address: meta.address,
  parcelRing: ring,
  acres: parcel.acres,
  sides: parcel.sides,
  parcelCorners: parcel.corners,
  run: RUN_PTS,
  gates: [{ x: Math.round(gx * 10) / 10, y: Math.round(gy * 10) / 10, kind: "single", widthFt: 4 }],
  pxPerFt: PX_PER_FT,
  totalLf,
  netLf: takeoff.netFenceLf,
  corners,
  ends,
  posts: takeoff.posts.total,
  bags: bomq(/concrete/i),
  pickets: bomq(/picket/i),
  rails: bomq(/^rails/i),
  laborHours: Math.round(takeoff.laborHours),
  slope: {
    avg: slope.avgGradePct,
    max: slope.maxGradePct,
    steps: slope.steppedSections,
    terrain: slope.suggestedTerrain,
    riseFt: Math.round((Math.max(...elev) - Math.min(...elev)) * 10) / 10,
  },
  market: { label: market.label, labor: market.labor },
  tiers,
  deposit: Math.round(chosen.total * 0.3),
  postElev: posts.map((p, i) => [
    Math.round(p.x * 10) / 10,
    Math.round(p.y * 10) / 10,
    Math.round((elev[i] - Math.min(...elev)) * 10) / 10,
  ]),
};

writeFileSync(DIR + "real2-job.js", `/* generated by compute-real2-job.mts */\nwindow.JOB2 = ${JSON.stringify(job)};\n`);
console.log(`parcel: ${parcel.acres} ac · ${parcel.sides} sides · ${parcel.corners} corners`);
console.log(`fence: ${totalLf} LF · net ${takeoff.netFenceLf} · ${corners} corners · ${takeoff.posts.total} posts · ${takeoff.laborHours.toFixed(0)} hrs`);
console.log(`slope: ${slope.avgGradePct}% avg · ${slope.maxGradePct}% max · ${slope.steppedSections} steps · terrain=${slope.suggestedTerrain} · rise ${job.slope.riseFt} ft`);
console.log("tiers:", tiers.map((t) => `${t.name}=$${t.total.toLocaleString()} ($${t.perLf}/LF)`).join(" · "));
console.log(`deposit ${job.deposit} · market ${market.label} ×${market.labor}`);
