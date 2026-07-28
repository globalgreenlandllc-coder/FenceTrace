/**
 * fence-gallery.mts — renders the REAL Fence3D component once per fence
 * type onto one sheet, next to the build spec it was drawn from. The
 * construction details (post stock, cap shape, mesh pitch, how proud the
 * post stands) are things you verify by LOOKING, so this makes them
 * lookable. Run: npx tsx scripts/fence-gallery.mts
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { writeFileSync } from "node:fs";
import { Fence3D } from "../components/fence/fence-3d.tsx";
import { FENCE_TYPES } from "../lib/fence/catalog.ts";

// The app compiles JSX with the automatic runtime; this script runs under
// tsx against a "jsx: preserve" tsconfig, which emits React.createElement.
(globalThis as unknown as { React: typeof React }).React = React;

// One L-shaped run with a corner and a walk gate, on flat ground — enough
// geometry to show line posts, a corner terminal, and gate posts.
const runs = [
  { points: [{ x: 180, y: 380 }, { x: 700, y: 380 }, { x: 700, y: 150 }] },
];
const gates = [{ x: 430, y: 380, kind: "single" as const, widthFt: 4 }];

const cards = FENCE_TYPES.map((t) => {
  const svg = renderToStaticMarkup(
    React.createElement(Fence3D, {
      runs,
      gates,
      heightFt: t.defaultHeightFt,
      typeId: t.id,
      pxPerFt: 3.75, // a typical zoom-20 residential scan
    }),
  );
  const s = t.spec;
  return `<section>
  <h2>${t.label} <small>${t.defaultHeightFt}′ · ${t.category} · ${t.build}</small></h2>
  <p class="spec">
    <b>Posts</b> ${s.postMaterial} — ${s.postWidthIn}″ line / ${s.terminalWidthIn}″ terminal,
    ${s.postProfile}, ${s.postCap} cap, ${s.postProudIn}″ proud,
    ${s.setInConcrete ? "set in concrete" : "tamped gravel"}<br>
    <b>Rails</b> ${s.railMaterial}<br>
    <b>Infill</b> ${s.infillMaterial}${s.infillPitchIn ? ` — ${s.infillPitchIn}″ on center` : ""}${s.meshDiamondIn ? ` — ${s.meshDiamondIn}″ diamond` : ""}
  </p>
  ${svg}
</section>`;
}).join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>FenceScan — 3D by fence type</title>
<style>
 body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;background:#f4f4f5;color:#18181b}
 h1{font-size:20px;margin:0 0 18px}
 section{background:#fff;border-radius:16px;padding:16px;margin-bottom:20px;max-width:1000px;
   box-shadow:0 1px 3px rgba(0,0,0,.08)}
 h2{margin:0 0 6px;font-size:17px}
 small{font-weight:400;color:#71717a}
 .spec{margin:0 0 12px;color:#3f3f46;font-size:12px}
 .spec b{color:#18181b}
 section>div{border-radius:12px;overflow:hidden}
 svg{width:100%;height:auto;display:block}
</style>
<h1>FenceScan — 3D preview, all ${FENCE_TYPES.length} fence types</h1>
${cards}`;

writeFileSync("scripts/fence-gallery.html", html);
console.log(`wrote scripts/fence-gallery.html — ${FENCE_TYPES.length} types`);
