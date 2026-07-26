import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { execSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;
const PREVIEW = process.argv.includes("--preview");
const FPS = 30;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.goto("file://" + DIR + "reel.html", { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 500));

const total = await page.evaluate("window.TOTAL_MS");
console.log("timeline:", total, "ms");

if (PREVIEW) {
  mkdirSync(DIR + "preview", { recursive: true });
  const times = [1200, 4200, 7300, 11600, 12800, 16600, 20500, 22400];
  for (const t of times) {
    await page.evaluate((ms) => window.seek(ms), t);
    await page.screenshot({ path: `${DIR}preview/t${t}.png` });
    console.log("preview", t);
  }
} else {
  mkdirSync(DIR + "frames", { recursive: true });
  const nFrames = Math.round((total / 1000) * FPS);
  for (let f = 0; f < nFrames; f++) {
    await page.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    await page.screenshot({ path: `${DIR}frames/f${String(f).padStart(4, "0")}.png` });
    if (f % 60 === 0) console.log(`frame ${f}/${nFrames}`);
  }
  console.log("encoding…");
  execSync(
    `ffmpeg -y -loglevel error -framerate ${FPS} -i "${DIR}frames/f%04d.png" ` +
      `-c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart "${DIR}out/gutterscan-reel.mp4"`,
    { stdio: "inherit" },
  );
  console.log("done ->", DIR + "out/gutterscan-reel.mp4");
}
await browser.close();
