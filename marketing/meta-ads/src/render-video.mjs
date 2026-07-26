// usage: node render-video.mjs <file.html> <width> <height> <outName> [--preview t1,t2,...]
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
await page.goto("file://" + DIR + htmlFile, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 500));
const total = await page.evaluate("window.TOTAL_MS");
console.log(htmlFile, "timeline:", total, "ms");

mkdirSync(DIR + "out", { recursive: true });
if (previewArg) {
  mkdirSync(DIR + "preview", { recursive: true });
  const times = previewArg.split("=")[1].split(",").map(Number);
  for (const t of times) {
    await page.evaluate((ms) => window.seek(ms), t);
    await page.screenshot({ path: `${DIR}preview/${outName}-t${t}.png` });
    console.log("preview", t);
  }
} else {
  const fdir = `${DIR}frames-${outName}/`;
  rmSync(fdir, { recursive: true, force: true });
  mkdirSync(fdir, { recursive: true });
  const n = Math.round((total / 1000) * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    await page.screenshot({ path: `${fdir}f${String(f).padStart(4, "0")}.png` });
    if (f % 90 === 0) console.log(`frame ${f}/${n}`);
  }
  console.log("encoding…");
  execSync(
    `ffmpeg -y -loglevel error -framerate ${FPS} -i "${fdir}f%04d.png" ` +
      `-c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart "${DIR}out/${outName}.mp4"`,
    { stdio: "inherit" },
  );
  rmSync(fdir, { recursive: true, force: true });
  console.log("done ->", DIR + "out/" + outName + ".mp4");
}
await browser.close();
