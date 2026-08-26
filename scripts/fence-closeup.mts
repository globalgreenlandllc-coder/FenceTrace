/**
 * fence-closeup.mts — the material check the gallery can't do: each key
 * wood look rendered at walk-up zoom, where board tones, reveals, caps
 * and grain either hold up or fall apart. Zoom is emulated by patching
 * the orbit group's transform in the emitted markup, exactly what the
 * live zoomCam applies. Run: npx tsx scripts/fence-closeup.mts
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { writeFileSync } from "node:fs";
import { Fence3D } from "../components/fence/fence-3d.tsx";

(globalThis as unknown as { React: typeof React }).React = React;

const runs = [
  { points: [{ x: 180, y: 380 }, { x: 700, y: 380 }, { x: 700, y: 150 }] },
];
const gates = [{ x: 430, y: 380, kind: "single" as const, widthFt: 4 }];

// Center of the close-up in view coords (near the gate on the long leg),
// pushed through the same zoom math the component uses.
const K = 3.2;
const CX = 430;
const CY = 330;
const tx = 450 - K * CX;
const ty = 280 - K * CY;

const TYPES = ["cedar-privacy", "horizontal-modern", "board-on-board", "wood-picket"];

const cards = TYPES.map((id) => {
  const svg = renderToStaticMarkup(
    React.createElement(Fence3D, { runs, gates, heightFt: 6, typeId: id, pxPerFt: 3.75 }),
  ).replace('transform="translate(0 0) scale(1)"', `transform="translate(${tx} ${ty}) scale(${K})"`);
  return `<section><h2>${id} @ ${K}×</h2>${svg}</section>`;
}).join("\n");

writeFileSync(
  "scripts/fence-closeup.html",
  `<!doctype html><meta charset="utf-8"><title>close-up</title>
<style>body{margin:0;padding:16px;background:#f4f4f5;font:14px system-ui}
section{background:#fff;border-radius:12px;padding:10px;margin-bottom:14px;max-width:940px}
h2{margin:0 0 8px;font-size:14px} svg{width:100%;height:auto;display:block;border-radius:8px}</style>
${cards}`,
);
console.log("wrote scripts/fence-closeup.html");
