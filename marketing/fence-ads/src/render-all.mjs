/**
 * Render the whole set: 10 videos + 10 statics.
 * usage: node marketing/fence-ads/src/render-all.mjs [only-substring]
 */
import { execFileSync } from "child_process";

const DIR = new URL("./", import.meta.url).pathname;

const VIDEOS = [
  ["v01-measure-15-916.html", 1080, 1920, "vid-01-easy-measuring-15s-9x16"],
  ["v02-full-flow-30-916.html", 1080, 1920, "vid-02-address-to-signed-30s-9x16"],
  ["v03-fence3d-15-916.html", 1080, 1920, "vid-03-fence-3d-15s-9x16"],
  ["v04-fence3d-30-45.html", 1080, 1350, "vid-04-3d-and-materials-30s-4x5"],
  ["v05-schedule-15-916.html", 1080, 1920, "vid-05-schedule-install-15s-9x16"],
  ["v06-schedule-crew-30-45.html", 1080, 1350, "vid-06-calendar-crew-paid-30s-4x5"],
  ["v07-three-tiers-15-45.html", 1080, 1350, "vid-07-three-tier-bids-15s-4x5"],
  ["v08-esign-15-916.html", 1080, 1920, "vid-08-esign-on-phone-15s-9x16"],
  ["v09-materials-15-45.html", 1080, 1350, "vid-09-bill-of-materials-15s-4x5"],
  ["v10-old-vs-new-30-916.html", 1080, 1920, "vid-10-old-way-vs-fencescan-30s-9x16"],
  ["v11-draw-tool-30-916.html", 1080, 1920, "vid-11-draw-the-fence-30s-9x16"],
  ["v12-topo-slope-30-916.html", 1080, 1920, "vid-12-slope-and-topo-30s-9x16"],
  ["v13-draw-blueprint-30-916.html", 1080, 1920, "vid-13-draw-tool-blueprint-30s-9x16"],
  ["v14-topo-3d-steps-30-916.html", 1080, 1920, "vid-14-topo-to-3d-steps-30s-9x16"],
  ["v15-property-line-15-916.html", 1080, 1920, "vid-15-fence-draws-itself-15s-9x16"],
  ["v16-14-systems-30-45.html", 1080, 1350, "vid-16-14-systems-30s-4x5"],
  ["v17-price-book-30-45.html", 1080, 1350, "vid-17-set-prices-once-30s-4x5"],
  ["v18-what-to-charge-15-916.html", 1080, 1920, "vid-18-what-to-charge-15s-9x16"],
  ["v19-yours-vs-market-30-45.html", 1080, 1350, "vid-19-your-price-vs-market-30s-4x5"],
  ["v20-3d-steps-15-45.html", 1080, 1350, "vid-20-3d-steps-15s-4x5"],
  ["v21-draw-tool-15-45.html", 1080, 1350, "vid-21-draw-tool-15s-4x5"],
  ["v22-hype-reel-15-916.html", 1080, 1920, "vid-22-hype-reel-15s-9x16"],
  ["v23-snohomish-emerald-30-916.html", 1080, 1920, "vid-23-snohomish-real-emerald-30s-9x16"],
  ["v24-snohomish-blueprint-30-916.html", 1080, 1920, "vid-24-snohomish-real-blueprint-30s-9x16"],
  ["v25-snohomish-ridgeline-30-916.html", 1080, 1920, "vid-25-snohomish-real-ridgeline-30s-9x16"],
  ["v26-snohomish-daylight-30-916.html", 1080, 1920, "vid-26-snohomish-real-daylight-30s-9x16"],
  ["v27-snohomish-jobsite-30-916.html", 1080, 1920, "vid-27-snohomish-real-jobsite-30s-9x16"],
];

const only = process.argv[2];
const run = (args) =>
  execFileSync("node", args, { cwd: DIR, stdio: "inherit", timeout: 30 * 60_000 });

const t0 = Date.now();
for (const [file, w, h, name] of VIDEOS) {
  if (only && !file.includes(only) && !name.includes(only)) continue;
  run([DIR + "render-video.mjs", file, String(w), String(h), name]);
}
if (!only || "statics".includes(only)) run([DIR + "render-statics.mjs"]);
console.log(`\nall done in ${Math.round((Date.now() - t0) / 1000)}s`);
