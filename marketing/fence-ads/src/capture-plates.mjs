/**
 * Capture real FenceScan UI as ad plates.
 *
 * Every visual in the ad set comes from the SHIPPING app, not a mockup:
 * this drives the landing page's five-act walkthrough (the same one that
 * runs on the real engine) plus the hero showcase tabs, and screenshots
 * each stage at 2x into src/plates/. The ad templates then composite
 * those plates. If the product changes, re-run this and the ads follow.
 *
 * usage: node marketing/fence-ads/src/capture-plates.mjs [origin]
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const ORIGIN = process.argv[2] || "http://localhost:3001";
const OUT = new URL("./plates/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1150, deviceScaleFactor: 2 });

/** Element screenshots capture whatever overlaps them — including the
 *  sticky top nav. Drop anything fixed/sticky before shooting. */
async function hideChrome() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") el.style.display = "none";
    }
  });
}

async function load() {
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle0", timeout: 180000 });
  await page.evaluateHandle("document.fonts.ready");
  await wait(2500);
  await hideChrome();
}
await load();

/** Click a <button> whose text starts with `text`. */
async function clickButton(text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((el) =>
      (el.innerText || "").replace(/\s+/g, " ").trim().startsWith(t),
    );
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found: ${text}`);
}

async function shootSelector(sel, name, nth = 0) {
  const els = await page.$$(sel);
  const el = els[nth];
  if (!el) throw new Error(`no element for ${sel} [${nth}]`);
  await el.screenshot({ path: `${OUT}${name}.png` });
  console.log("  ✓", name);
}

/* ------------------------------------------------------------------ */
/*  1. the five-act walkthrough — the real engine, act by act          */
/* ------------------------------------------------------------------ */
const STAGE = '[class*="aspect-[900/580]"]';
const ACTS = [
  ["1 Scan the address", 5600, "act1-scan"],
  ["2 Drive the fence", 8600, "act2-trace"],
  ["3 See it built", 7600, "act3-3d"],
  ["4 Build the proposal", 7400, "act4-proposal"],
  ["5 Send to the client", 7000, "act5-signed"],
];

console.log("walkthrough acts:");
for (const [label, ms, name] of ACTS) {
  await clickButton(label);
  // let the act play out to ~92% — everything revealed, nothing yet reset
  await wait(Math.round(ms * 0.92));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((el) =>
      (el.innerText || "").trim().startsWith("Pause"),
    );
    b?.click();
  });
  await wait(400);
  await shootSelector(STAGE, name);
}

/* extra 3D beat: catch the model earlier in the act, before the labels */
await load();
await clickButton("3 See it built");
await wait(3800);
await shootSelector(STAGE, "act3-3d-early");

/* mid-trace: the fence half-drawn, which reads as "it's working" */
await load();
await clickButton("2 Drive the fence");
await wait(4200);
await shootSelector(STAGE, "act2-trace-mid");

/* ------------------------------------------------------------------ */
/*  2. hero showcase tabs                                              */
/* ------------------------------------------------------------------ */
console.log("hero tabs:");
for (const tab of ["DETECTION", "MEASUREMENT", "PRICING", "PROPOSAL"]) {
  await load();
  await clickButton(tab);
  await wait(3000);
  await hideChrome();
  const box = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll("button")].find((el) =>
      (el.innerText || "").trim().startsWith(t),
    );
    let n = btn;
    while (n && n !== document.body) {
      const r = n.getBoundingClientRect();
      if (r.width > 700 && r.height > 420)
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      n = n.parentElement;
    }
    return null;
  }, tab);
  if (box) {
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 40)), box.y);
    await wait(500);
    const clip = await page.evaluate((b) => {
      return { x: b.x, y: b.y - scrollY, width: b.w, height: b.h };
    }, box);
    await page.screenshot({ path: `${OUT}hero-${tab.toLowerCase()}.png`, clip });
    console.log("  ✓", `hero-${tab.toLowerCase()}`);
  } else console.log("  ✗", tab);
}

/* ------------------------------------------------------------------ */
/*  3. whole sections                                                  */
/* ------------------------------------------------------------------ */
console.log("sections:");
const ids = await page.evaluate(() =>
  [...document.querySelectorAll("section[id]")].map((s) => s.id),
);
console.log("  found sections:", ids.join(", "));
for (const id of ids) {
  try {
    await page.evaluate((i) => {
      document.getElementById(i)?.scrollIntoView({ block: "start" });
    }, id);
    await wait(1600);
    await hideChrome();
    await shootSelector(`section#${id}`, `section-${id}`);
  } catch (e) {
    console.log("  ✗", id, e.message);
  }
}

await browser.close();
console.log("plates ->", OUT);
