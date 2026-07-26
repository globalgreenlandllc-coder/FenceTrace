# GutterScan — Meta (Facebook + Instagram) Ad Kit

Target: gutter & exterior contractors in the US. Goal: sign-ups at gutters.app.

## Assets in this folder

| File | Format | Placement |
|---|---|---|
| `gutterscan-reel.mp4` | 9:16 video, 23s | Reels, Stories (brand explainer) |
| `gutterscan-feed45.mp4` | 4:5 video, 15s | **Feed video — the max-conversion workhorse.** Tight cut: hook → demo → price → CTA |
| `gutterscan-ugc-chat.mp4` | 9:16 video, 18.5s | **UGC-style** text-message thread. Runs as a "not-an-ad" — best for cold audiences in Reels/Stories |
| `slide-1.png` … `slide-5.png` | 1:1 carousel | Feed carousel, in order |
| `static-feed45-hook.png` | 4:5 image | Single-image feed ad ("The first quote usually wins.") |
| `static-ugc-notes.png` | 4:5 image | **UGC-style** notes-app screenshot — native look, run with a lowercase casual primary text |
| `static-story-916.png` | 9:16 image | Stories/Reels static |

All videos are silent by design — add a licensed music track inside Ads Manager.

### UGC-specific primary text (pair with `gutterscan-ugc-chat.mp4` / `static-ugc-notes.png`)
Keep it lowercase and casual — the ad works because it doesn't read like an ad:
> found out my gutter guy quotes jobs from a satellite photo now… no wonder he answers in 3 minutes 💀 (it's called GutterScan — gutters.app)

or:
> gutter contractors: how many hours a week do you spend driving to houses you never hear from again? there's an app that does the measuring from satellite. gutters.app

### Max-conversion structure (recommended)
- **1 campaign (Sales/Website)** → 1 ad set (broad contractor targeting) → **4–6 ads**: feed45 video, UGC chat video, carousel, notes static, hook static. Advantage+ creative ON; Meta's auction finds the winner far cheaper than manual A/B.
- The UGC pair usually wins cold traffic; the branded pair usually wins retargeting. After the first ~$200 of spend, split winners into their own ad set and add a retargeting ad set (site visitors + video viewers 75%).

---

## Ad copy (paste into Ads Manager)

### Primary text — variant A (pain-first, recommended)
> Still burning half a day driving out to measure a roof, just to lose the bid to whoever quoted first?
>
> GutterScan traces the roofline from satellite imagery, measures the eaves, places downspouts, and prices the job from YOUR rates — while the homeowner is still on the phone.
>
> Takeoff → three-tier proposal → e-signature → payment. One app.
>
> 📍 Type an address. Get the takeoff. → gutters.app

### Primary text — variant B (speed-first, short)
> Type an address. Get the gutter takeoff.
>
> Auto-traced eaves, live linear footage, downspouts, and a materials price from your own rates — in about a minute. Then send a three-tier proposal the client can e-sign and pay from one link.
>
> Built for gutter contractors. → gutters.app

### Primary text — variant C (math/ROI angle)
> A site visit for a quote costs you 2 hours + gas. GutterScan does the measuring from a satellite photo in about a minute — 362.5 LF, 4 downspouts, priced and ready to send.
>
> Quote 10x more jobs. Drive only to the ones you've already won. → gutters.app

### Headlines (40 chars max — rotate 2–3)
- Type an address. Get the takeoff.
- Measure roofs without leaving your desk
- Where addresses become estimates
- Quote gutter jobs in minutes, not days
- The OS for gutter contractors

### Descriptions (link description field)
- AI takeoffs, proposals, e-sign & payments.
- Satellite + blueprint takeoffs for gutter pros.

### Call-to-action button
`Sign Up` (best for SaaS) — or `Learn More` for a colder audience test.

---

## Campaign setup (15-minute checklist)

1. **business.facebook.com** → create/verify a Business Portfolio; connect your Facebook Page + Instagram account (create a GutterScan page if you don't have one — ads need a Page).
2. **Ads Manager → Create campaign** → Objective: **Leads** or **Sales** (choose "Website"). For a first run, **Traffic** is cheaper but lower quality; if you have sign-up conversion tracking, use Sales.
3. **Pixel / Conversions API**: install the Meta Pixel on gutters.app (base snippet in `app/layout.tsx`, fire a `CompleteRegistration` event after Clerk sign-up). Without it Meta can't optimize — worth doing before spending real money. I can wire this up when you're ready.
4. **Budget**: start $20–30/day, one campaign, Advantage+ budget ON. Give it 5–7 days before judging (learning phase).
5. **Audience** (one ad set to start):
   - Location: United States (or your launch states)
   - Age 24–60
   - Detailed targeting: "Gutter (Rain gutter)" ∪ "Roofer" ∪ "General contractor" ∪ "Construction" + interest "Small business owners"; Advantage detailed targeting ON.
   - Language: English. Don't over-narrow — Meta's algorithm needs room.
6. **Placements**: Advantage+ placements ON. The reel serves 9:16 slots; the carousel serves feeds automatically.
7. **Ads** (run BOTH, let Meta pick the winner):
   - Ad 1 — Carousel: slides 1→5 in order, Primary text A, headline per card (card 1: "Stop driving out to measure", card 5: "Get started"), destination `https://gutters.app` (all cards).
   - Ad 2 — Reel video: `gutterscan-reel.mp4`, Primary text B. In the ad editor, add auto-captions OFF (text is baked in) and pick a library music track (upbeat, ~120bpm).
8. **URL parameters** (so your `/admin/analytics` first-touch attribution sees it):
   `utm_source=meta&utm_medium=paid&utm_campaign=contractor-launch&utm_content={{ad.name}}`
9. After ~$150 spend: kill whichever ad has CPC > 2× the other; duplicate the winner with Primary text C to keep testing.

### Watch-outs
- **Special Ad Categories don't apply** — this targets contractors (B2B), not housing consumers. If Meta mis-flags it as "Housing," appeal: you're selling software to businesses.
- Meta compresses images >30% text — these slides are text-heavy but that old "20% rule" is retired; expect slightly higher CPM, monitor delivery.
- The reel is silent by design; always add music in-platform (licensed library) rather than baking it in.

---

## Regenerating / editing these assets
Source lives in the repo session scratchpad (`ad/slides.html`, `ad/reel.html` + render scripts, using live app screenshots from `/demo/satellite`). Ask Claude to tweak copy/colors/timing and re-render.
