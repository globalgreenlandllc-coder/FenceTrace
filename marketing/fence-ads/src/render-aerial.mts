/**
 * Render the app's own <DemoAerial> to a clean 900×580 SVG plate.
 *
 * The walkthrough plates already carry the landing demo's overlays
 * (parcel chips, act captions). The estimator-canvas ads need the bare
 * satellite tile so the ad can draw the REAL estimator UI on top of it —
 * toolbar, dashed parcel ring, draft line, topo contours.
 *
 * usage: npx tsx marketing/fence-ads/src/render-aerial.mts
 */
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement as h } from "react";
import { writeFileSync } from "fs";

// tsx compiles the app's JSX with the CLASSIC runtime, which expects a
// global `React`; the app's own files rely on Next's automatic runtime
// and never import it. Provide it before pulling the component in.
(globalThis as any).React = React;
const { DemoAerial } = await import("@/components/landing2/demo-aerial");

const svg = h(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 900 580",
    width: 900,
    height: 580,
  },
  h(DemoAerial as any, {}),
);

const out = new URL("./plates/aerial-clean.svg", import.meta.url).pathname;
writeFileSync(out, renderToStaticMarkup(svg));
console.log("wrote", out);
