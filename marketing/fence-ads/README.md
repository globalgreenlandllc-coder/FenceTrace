# marketing/fence-ads

The FenceScan Meta ad set — 27 videos and 10 statics for Facebook and
Instagram, plus the pipeline that renders them.

Start with [AD-COPY-AND-LAUNCH-GUIDE.md](AD-COPY-AND-LAUNCH-GUIDE.md): it
lists every asset, the ad copy to paste next to it, and how to structure the
campaign. Finished files land in `out/`.

```
src/
  capture-plates.mjs   drives the running app and screenshots it → src/plates/
  render-aerial.mts    renders the app's own <DemoAerial> to a bare SVG plate
  render-topo.mts      builds contour lines with lib/fence/contours.ts itself
  kit.css              the ad design system (colors lifted from tailwind.config.ts)
  kit.js               the timeline — every ad is a pure function of window.seek(ms)
  v01…v27.html         one file per video
  fetch-real.mts       pulls a real address: aerial + elevation + market
  compute-real-job.mts prices the drawn enclosure with the real engine
  real-ad.css/js       the shared Snohomish choreography (v23–v27 set palettes)
  steps3d.js           the stepped-fence 3D scene shared by v14/v20
  statics.html         all ten images, one block each
  render-video.mjs     one HTML → MP4 (or --preview stills)
  render-statics.mjs   statics.html → ten PNGs at 2x, downsampled
  render-all.mjs       the whole set (optionally filtered: render-all.mjs v03)
```

Rebuild everything (needs Chrome, ffmpeg, `puppeteer-core`, and `npm run dev`
up for the capture step):

```bash
node src/capture-plates.mjs http://localhost:3001
npx tsx src/render-aerial.mts && npx tsx src/render-topo.mts
node src/render-all.mjs
```

The product shots are screenshots of the real app, so the ads track the
product: change the UI or the pricing engine, re-run `capture-plates.mjs`, and
every ad picks up the new look and the new numbers.

## What's in git and what isn't

Rendered video and stills (`out/`) and the app-UI plates
(`src/plates/{act,hero,section}*.png`) are gitignored — roughly 66 MB of
regenerable binary. **On a fresh clone, run `capture-plates.mjs` first**
(needs `npm run dev` up) or the video templates will render with missing
images.

Kept in git because they can't be rebuilt without a Google Maps key and one
specific address: `real-aerial-*.png`, plus the computed job data
`real-job.js` / `real-topo.js` / `real-meta.json` and the app-rendered
`aerial-clean.svg`. To re-pull them:

```bash
AD_ADDR="12103 202nd St SE, Snohomish, WA 98296" npx tsx src/fetch-real.mts 19
npx tsx src/compute-real-job.mts
```
