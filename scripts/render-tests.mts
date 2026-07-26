/**
 * render-tests.mts — visualize the fixtures the node tests assert on, so the
 * green checkmarks become a picture. Every panel runs the REAL engine on the
 * REAL test geometry (copied from lib/roof-engine.test.mts + roof-mass-
 * decompose.test.mts). Run: npx tsx scripts/render-tests.mts
 */
import {
  runRoofEngine,
  buildGableByRule,
  polyArea,
  type Gable,
  type MassInput,
  type Edge,
} from "../lib/roof-engine.ts";
import { decomposeMasses } from "../lib/roof-mass-decompose.ts";
import { writeFileSync } from "node:fs";

type Pt = { x: number; y: number };
type Seg = { a: Pt; b: Pt; c: string; w: number; dash: boolean };
const COL: Record<string, string> = { eave: "#0284c7", rake: "#94a3b8", ridge: "#dc2626", hip: "#0891b2", valley: "#9333ea" };
const box = (w: number, h: number): Pt[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const gable = (cx: number, cy: number, span: number, pitch: number, projection: number, facing: Gable["facing"], name: string): Gable => ({ baseCenter: { x: cx, y: cy }, span, pitch, projection, facing, name });

// Collect drawable segments + downspout dots from an engine takeoff.
function takeoffSegs(masses: { edges: Edge[]; interior: Edge[] }[]): Seg[] {
  const segs: Seg[] = [];
  for (const m of masses) {
    for (const e of m.interior) segs.push({ a: e.p1, b: e.p2, c: COL[e.type] ?? "#000", w: e.type === "ridge" ? 2.4 : 1.7, dash: e.type === "valley" });
    for (const e of m.edges) segs.push({ a: e.p1, b: e.p2, c: e.gutter ? COL.eave : COL.rake, w: e.gutter ? 3 : 1.9, dash: !e.gutter });
  }
  return segs;
}

// ── Panel layout ─────────────────────────────────────────────────────────────
const PW = 400, PH = 340, COLS = 4, HEADER = 78, GAP = 14;
const panels: { title: string; sub: string; segs: Seg[]; dots?: Pt[]; fillPolys?: { poly: Pt[]; c: string }[] }[] = [];

// 1) Stage 1 — flush gable BEFORE (rakes collapse onto the eave → invisible).
{
  const g = gable(20, 0, 16, 6, 0, "N", "flush");
  const L = buildGableByRule(g);
  const segs: Seg[] = [];
  for (const e of box(40, 26)) void e;
  const bx = box(40, 26);
  for (let i = 0; i < 4; i++) segs.push({ a: bx[i], b: bx[(i + 1) % 4], c: COL.eave, w: 3, dash: false });
  for (const [a, b] of L.rakes) segs.push({ a, b, c: COL.rake, w: 2.4, dash: true }); // rakes lie ON the eave
  panels.push({ title: "Stage 1 · flush gable BEFORE", sub: "rakes collapse onto the eave — no ridge/valley → invisible in plan", segs, fillPolys: [{ poly: bx, c: "rgba(148,163,184,0.08)" }] });
}
// 2) Stage 1 — flush gable AFTER (ridge-back + 2 valleys).  test: valleys.length === 2
{
  const g = gable(20, 0, 16, 6, 0, "N", "flush");
  const L = buildGableByRule(g);
  const bx = box(40, 26);
  const segs: Seg[] = [];
  for (let i = 0; i < 4; i++) segs.push({ a: bx[i], b: bx[(i + 1) % 4], c: COL.eave, w: 3, dash: false });
  for (const [a, b] of L.ridgeBack) segs.push({ a, b, c: COL.ridge, w: 2.6, dash: false });
  for (const [a, b] of L.valleys) segs.push({ a, b, c: COL.valley, w: 2, dash: true });
  panels.push({ title: "Stage 1 · flush gable AFTER ✓", sub: "buildGableByRule → 1 ridge-back + 2 valleys, 0 gutter (test asserts valleys===2)", segs, fillPolys: [{ poly: bx, c: "rgba(59,130,246,0.07)" }] });
}
// 3) Stage 2 — L-shape decomposes into 2 tiers.  test: area 2100, LF 220 neutral
{
  const L: Pt[] = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }, { x: 0, y: 50 }];
  const masses = decomposeMasses(L, L.map((_, i) => i));
  const segs = takeoffSegs(runRoofEngine(masses).masses);
  const fillC = ["rgba(59,130,246,0.10)", "rgba(16,185,129,0.12)"];
  panels.push({ title: "Stage 2 · L-shape → 2 tiers ✓", sub: `area ${masses.reduce((s, m) => s + polyArea(m.outline), 0)} sf · LF-neutral 220`, segs, fillPolys: masses.map((m, i) => ({ poly: m.outline, c: fillC[i % 2] })) });
}
// 4) Stage 2 — garage-jog decomposes into main | garage.  test: LF-neutral 264
{
  const G: Pt[] = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 10 }, { x: 88, y: 10 }, { x: 88, y: 40 }, { x: 64, y: 40 }, { x: 64, y: 44 }, { x: 0, y: 44 }];
  const masses = decomposeMasses(G, G.map((_, i) => i));
  const t = runRoofEngine(masses);
  const fillC = ["rgba(59,130,246,0.10)", "rgba(16,185,129,0.12)"];
  panels.push({ title: "Stage 2 · garage jog → main | garage ✓", sub: `${masses.length} tiers · LF-neutral 264 · shared wall un-guttered`, segs: takeoffSegs(t.masses), dots: t.downspouts.map((d) => d.at), fillPolys: masses.map((m, i) => ({ poly: m.outline, c: fillC[i % 2] })) });
}
// 5) Oracle — demo_woodinville, the pinned 394-LF fixture (3 masses, all gables).
{
  const main: MassInput = { name: "main", outline: box(64, 44), statedArea: 2902, eaveEdges: [0, 1, 2, 3], gables: [gable(10, 44, 16, 6, 4, "S", "greatroom"), gable(30, 44, 12, 4, 3, "S", "center"), gable(30, 44, 8, 4, 6, "S", "porch"), gable(46, 44, 12, 4, 3, "S", "master")] };
  const garage: MassInput = { name: "garage", outline: [{ x: 64, y: 10 }, { x: 88, y: 10 }, { x: 88, y: 40 }, { x: 64, y: 40 }], eaveEdges: [0, 1, 2, 3], gables: [gable(76, 40, 14, 4, 3, "S", "garage")] };
  const patio: MassInput = { name: "patio", outline: [{ x: 24, y: -16 }, { x: 40, y: -16 }, { x: 40, y: 0 }, { x: 24, y: 0 }], statedArea: 228, eaveEdges: [1, 3], gables: [gable(32, -16, 16, 4, 0, "N", "patio")] };
  const t = runRoofEngine([main, garage, patio]);
  panels.push({ title: "Oracle · demo_woodinville ✓", sub: `eave LF ${t.totalEaveLf} (pinned) · ${t.downspouts.length} downspouts · 3 masses`, segs: takeoffSegs(t.masses), dots: t.downspouts.map((d) => d.at), fillPolys: [main, garage, patio].map((m, i) => ({ poly: m.outline, c: ["rgba(59,130,246,0.09)", "rgba(16,185,129,0.10)", "rgba(234,88,12,0.09)"][i] })) });
}
// 6) Case 1 — a MIDDLE-of-wall jog (invisible from the sides) still decomposes.
{
  const T: Pt[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 28 }, { x: 0, y: 28 }];
  const masses = decomposeMasses(T, T.map((_, i) => i));
  const fillC = ["rgba(59,130,246,0.10)", "rgba(16,185,129,0.12)"];
  panels.push({ title: "Case 1 · middle jog → tiers ✓", sub: `footprint authoritative · ${masses.length} tiers · LF-neutral`, segs: takeoffSegs(runRoofEngine(masses).masses), fillPolys: masses.map((m, i) => ({ poly: m.outline, c: fillC[i % 2] })) });
}
// 7) Case 2 — a SET-BACK dormer: gable sits behind a still-guttered eave.
{
  const bx = box(50, 34);
  const L = buildGableByRule({ baseCenter: { x: 25, y: 0 }, span: 16, pitch: 6, projection: 0, facing: "N", setbackFt: 7 });
  const segs: Seg[] = [];
  for (let i = 0; i < 4; i++) segs.push({ a: bx[i], b: bx[(i + 1) % 4], c: COL.eave, w: 3, dash: false });
  for (const [a, b] of L.ridgeBack) segs.push({ a, b, c: COL.ridge, w: 2.6, dash: false });
  for (const [a, b] of L.valleys) segs.push({ a, b, c: COL.valley, w: 2, dash: true });
  panels.push({ title: "Case 2 · set-back dormer ✓", sub: "gable 7 ft behind the eave — front eave keeps its gutter", segs, fillPolys: [{ poly: bx, c: "rgba(59,130,246,0.07)" }] });
}
// 8) Stage 3 — text card (asymmetry detection is a flag, not geometry).
panels.push({ title: "Stage 3 · asymmetric-jog flags ✓", sub: "TEXT-CARD", segs: [] });

// ── Compose ──────────────────────────────────────────────────────────────────
const rows = Math.ceil(panels.length / COLS);
const W = COLS * PW + (COLS + 1) * GAP;
const H = HEADER + rows * PH + (rows + 1) * GAP + 20;
const out: string[] = [`<rect width="${W}" height="${H}" fill="#f8fafc"/>`];
out.push(`<text x="${GAP}" y="34" font-family="ui-sans-serif,Arial" font-size="20" font-weight="700" fill="#0f172a">How the roof engine was tested — fixtures the 169 node tests assert on</text>`);
out.push(`<text x="${GAP}" y="58" font-family="ui-sans-serif,Arial" font-size="13" fill="#64748b">each panel runs the REAL engine (lib/roof-engine + roof-mass-decompose) on the exact geometry the tests check · npx tsx --test</text>`);
const legend: [string, string][] = [["eave", COL.eave], ["rake", COL.rake], ["ridge", COL.ridge], ["hip", COL.hip], ["valley", COL.valley]];
let lgx = W - 470;
for (const [lab, c] of legend) { out.push(`<line x1="${lgx}" y1="48" x2="${lgx + 22}" y2="48" stroke="${c}" stroke-width="3" stroke-linecap="round"/><text x="${lgx + 27}" y="52" font-family="ui-sans-serif,Arial" font-size="12" fill="#334155">${lab}</text>`); lgx += 27 + lab.length * 7 + 22; }

panels.forEach((p, idx) => {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const px = GAP + col * (PW + GAP);
  const py = HEADER + GAP + row * (PH + GAP);
  out.push(`<rect x="${px}" y="${py}" width="${PW}" height="${PH}" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>`);
  out.push(`<text x="${px + 16}" y="${py + 26}" font-family="ui-sans-serif,Arial" font-size="14.5" font-weight="700" fill="#1e293b">${p.title}</text>`);
  out.push(`<text x="${px + 16}" y="${py + 45}" font-family="ui-sans-serif,Arial" font-size="11.5" fill="#64748b">${p.sub === "TEXT-CARD" ? "" : p.sub}</text>`);

  if (p.sub === "TEXT-CARD") {
    const lines = ["mergeFaceReadings compares opposite", "faces (E/W, N/S). A garage/porch/patio", "seen on ONE side but not the other →", "“ASYMMETRIC (left↔right): offset jog”.", "", "6 tests: one-sided jog flags, matching", "jogs don’t, entry≡porch, need both sides."];
    lines.forEach((ln, i) => out.push(`<text x="${px + 16}" y="${py + 78 + i * 24}" font-family="ui-sans-serif,Arial" font-size="13" fill="${i === 3 ? "#9333ea" : "#334155"}">${ln}</text>`));
    return;
  }

  // Fit the panel geometry.
  const allPts: Pt[] = [];
  for (const s of p.segs) allPts.push(s.a, s.b);
  for (const d of p.dots ?? []) allPts.push(d);
  if (!allPts.length) return;
  const minX = Math.min(...allPts.map((q) => q.x)), maxX = Math.max(...allPts.map((q) => q.x));
  const minY = Math.min(...allPts.map((q) => q.y)), maxY = Math.max(...allPts.map((q) => q.y));
  const padL = 20, padTop = 58, padB = 18;
  const sc = Math.min((PW - 2 * padL) / Math.max(1, maxX - minX), (PH - padTop - padB) / Math.max(1, maxY - minY));
  const offX = px + padL + (PW - 2 * padL - (maxX - minX) * sc) / 2;
  const offY = py + padTop + (PH - padTop - padB - (maxY - minY) * sc) / 2;
  const T = (q: Pt) => ({ x: offX + (q.x - minX) * sc, y: offY + (q.y - minY) * sc });
  for (const fp of p.fillPolys ?? []) {
    const d = fp.poly.map((q, j) => { const t = T(q); return `${j ? "L" : "M"}${t.x.toFixed(1)},${t.y.toFixed(1)}`; }).join(" ") + " Z";
    out.push(`<path d="${d}" fill="${fp.c}" stroke="none"/>`);
  }
  for (const s of p.segs) { const a = T(s.a), b = T(s.b); out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${s.c}" stroke-width="${s.w}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linecap="round"/>`); }
  for (const d of p.dots ?? []) { const t = T(d); out.push(`<circle cx="${t.x.toFixed(1)}" cy="${t.y.toFixed(1)}" r="3.6" fill="#0f172a"/>`); }
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
writeFileSync("scripts/test-gallery.svg", svg);
writeFileSync("scripts/test-gallery.html", `<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}</body>`);
console.log(`wrote scripts/test-gallery.svg (${W}×${H})`);
