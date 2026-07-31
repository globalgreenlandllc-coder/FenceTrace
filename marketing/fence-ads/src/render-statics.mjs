/**
 * Render the 10 static feed/story ads.
 *
 * Each block in statics.html is shot at 2x and downsampled with lanczos —
 * cheap supersampling, so type edges stay crisp after Meta re-encodes.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;
const OUT = DIR + "../out/";
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  ["st01", "img-01-hook-45", 1080, 1350],
  ["st02", "img-02-measure-45", 1080, 1350],
  ["st03", "img-03-fence3d-45", 1080, 1350],
  ["st04", "img-04-three-tiers-45", 1080, 1350],
  ["st05", "img-05-materials-45", 1080, 1350],
  ["st06", "img-06-schedule-45", 1080, 1350],
  ["st07", "img-07-esign-story-916", 1080, 1920],
  ["st08", "img-08-60-seconds-11", 1080, 1080],
  ["st09", "img-09-old-vs-new-45", 1080, 1350],
  ["st10", "img-10-cta-story-916", 1080, 1920],
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 2200, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("  ! page error:", e.message));
await page.goto("file://" + DIR + "statics.html", { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 900));

for (const [id, name, w, h] of TARGETS) {
  const el = await page.$("#" + id);
  if (!el) {
    console.log("  ✗", name, "— #" + id + " not found");
    continue;
  }
  const big = `${OUT}${name}-2x.png`;
  await el.screenshot({ path: big });
  execSync(
    `ffmpeg -y -loglevel error -i "${big}" -vf scale=${w}:${h}:flags=lanczos "${OUT}${name}.png"`,
  );
  unlinkSync(big);
  console.log("  ✓", name, `${w}×${h}`);
}
await browser.close();
console.log("statics →", OUT);
