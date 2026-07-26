import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { execSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR + "out", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 2 });
await page.goto("file://" + DIR + "slides.html", { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 800));

for (let i = 1; i <= 5; i++) {
  const el = await page.$(`#s${i}`);
  await el.screenshot({ path: `${DIR}out/slide-${i}-2x.png` });
  execSync(
    `ffmpeg -y -loglevel error -i "${DIR}out/slide-${i}-2x.png" -vf scale=1080:1080:flags=lanczos "${DIR}out/slide-${i}.png"`,
  );
  console.log("slide", i, "done");
}
await browser.close();
