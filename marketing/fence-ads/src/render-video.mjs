/**
 * Render one ad HTML to MP4 by stepping window.seek(ms) frame by frame.
 *
 * usage: node render-video.mjs <file.html> <w> <h> <outName> [--preview=t1,t2]
 *        --preview writes stills instead of a video, for eyeballing layout.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;
const [, , htmlFile, w, h, outName] = process.argv;
const previewArg = process.argv.find((a) => a.startsWith("--preview"));
const FPS = 30;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("  ! page error:", e.message));
await page.goto("file://" + DIR + htmlFile, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 600));
const total = await page.evaluate("window.TOTAL_MS");
if (!total) throw new Error(`${htmlFile}: window.TOTAL_MS never got set`);
console.log(htmlFile, "→", total, "ms");

mkdirSync(DIR + "../out", { recursive: true });
if (previewArg) {
  mkdirSync(DIR + "../preview", { recursive: true });
  for (const t of previewArg.split("=")[1].split(",").map(Number)) {
    await page.evaluate((ms) => window.seek(ms), t);
    await new Promise((r) => setTimeout(r, 60));
    await page.screenshot({ path: `${DIR}../preview/${outName}-t${t}.png` });
    console.log("  preview", t);
  }
} else {
  const fdir = `${DIR}../frames-${outName}/`;
  rmSync(fdir, { recursive: true, force: true });
  mkdirSync(fdir, { recursive: true });
  const n = Math.round((total / 1000) * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    await page.screenshot({ path: `${fdir}f${String(f).padStart(4, "0")}.png` });
    if (f % 120 === 0) console.log(`  frame ${f}/${n}`);
  }
  console.log("  encoding…");
  execSync(
    `ffmpeg -y -loglevel error -framerate ${FPS} -i "${fdir}f%04d.png" ` +
      `-c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart ` +
      `"${DIR}../out/${outName}.mp4"`,
    { stdio: "inherit" },
  );
  rmSync(fdir, { recursive: true, force: true });
  console.log("  done →", `out/${outName}.mp4`);
}
await browser.close();
