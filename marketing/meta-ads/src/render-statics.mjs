import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { execSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR + "out", { recursive: true });

const TARGETS = [
  ["a45", "static-feed45-hook", 1080, 1350],
  ["notes", "static-ugc-notes", 1080, 1350],
  ["story", "static-story-916", 1080, 1920],
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 2000, deviceScaleFactor: 2 });
await page.goto("file://" + DIR + "statics.html", { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 800));

for (const [id, name, w, h] of TARGETS) {
  const el = await page.$(`#${id}`);
  await el.screenshot({ path: `${DIR}out/${name}-2x.png` });
  execSync(
    `ffmpeg -y -loglevel error -i "${DIR}out/${name}-2x.png" -vf scale=${w}:${h}:flags=lanczos "${DIR}out/${name}.png"`,
  );
  console.log(name, "done");
}
await browser.close();
