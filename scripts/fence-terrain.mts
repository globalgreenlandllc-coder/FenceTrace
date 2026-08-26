/**
 * fence-terrain.mts — the far-view check on a STEEP lot: a 5-acre-ish
 * pentagon with big relief, perimeter cedar draped on a topo lattice.
 * This is the frame contractors actually stare at (the whole-property
 * opening view), where the GROUND is most of the pixels — so this sheet
 * is where terrain rendering earns or loses the "real land" read.
 * Run: npx tsx scripts/fence-terrain.mts
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { writeFileSync } from "node:fs";
import { Fence3D } from "../components/fence/fence-3d.tsx";

(globalThis as unknown as { React: typeof React }).React = React;

// Analytic landform in ft over the 900×580 canvas: a strong SW-falling
// grade with a knoll and a gully — proportions echo the Snohomish lot
// (≈187' of rise) that exposed the faceted-quad look.
function elevFt(x: number, y: number): number {
  const base = 120 * (x / 900) * 0.45 + 120 * (1 - y / 580) * 0.55;
  const knoll = 26 * Math.exp(-(((x - 590) ** 2 + (y - 200) ** 2) / 150 ** 2));
  const gully = -16 * Math.exp(-(((x - 0.55 * y - 160) / 70) ** 2));
  const ripple = 3.5 * Math.sin(x / 55) * Math.cos(y / 47);
  return base + knoll + gully + ripple;
}

const ROWS = 30;
const COLS = 46;
const topoGridFt: number[][] = [];
for (let r = 0; r < ROWS; r++) {
  const row: number[] = [];
  for (let c = 0; c < COLS; c++) {
    row.push(elevFt((c / (COLS - 1)) * 900, (r / (ROWS - 1)) * 580));
  }
  topoGridFt.push(row);
}

const ring = [
  { x: 180, y: 120 },
  { x: 700, y: 95 },
  { x: 760, y: 420 },
  { x: 430, y: 520 },
  { x: 145, y: 430 },
];
const runs = [{ points: [...ring, ring[0]] }];

const views: { name: string; patch?: [number, number, number] }[] = [
  { name: "opening view" },
  { name: "zoom 2.6×", patch: [2.6, 450 - 2.6 * 430, 280 - 2.6 * 300] },
  // The frame the client complained about: walked in close on the hump
  // the fence crosses, where facets used to reappear.
  { name: "zoom 5× on the hump", patch: [5, 450 - 5 * 470, 280 - 5 * 330] },
];

const cards = views.map((v) => {
  let svg = renderToStaticMarkup(
    React.createElement(Fence3D, {
      runs,
      gates: [],
      heightFt: 6,
      typeId: "cedar-privacy",
      pxPerFt: 0.95,
      parcelRings: [ring],
      topoGridFt,
    }),
  );
  if (v.patch) {
    const [k, tx, ty] = v.patch;
    // The terrain blur is in WORLD units (a fraction of one quad), so the
    // zoom transform scales it along with the cells — nothing to patch.
    svg = svg.replace('transform="translate(0 0) scale(1)"', `transform="translate(${tx} ${ty}) scale(${k})"`);
  }
  return `<section><h2>steep 5-acre — ${v.name}</h2>${svg}</section>`;
}).join("\n");

writeFileSync(
  "scripts/fence-terrain.html",
  `<!doctype html><meta charset="utf-8"><title>terrain</title>
<style>body{margin:0;padding:16px;background:#f4f4f5;font:14px system-ui}
section{background:#fff;border-radius:12px;padding:10px;margin-bottom:14px;max-width:940px}
h2{margin:0 0 8px;font-size:14px} svg{width:100%;height:auto;display:block;border-radius:8px}</style>
${cards}`,
);
console.log("wrote scripts/fence-terrain.html");
