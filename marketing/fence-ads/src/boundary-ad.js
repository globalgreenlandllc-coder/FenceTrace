/* ------------------------------------------------------------------ *
 * boundary-ad.js — the county-boundary ad (v28–v30).
 *
 * One 30s choreography, three palettes. The star act is the BOUNDARY
 * REVEAL: the recorded parcel line arriving from the county record and
 * snapping onto the photo, because that's the thing contractors don't
 * believe until they see it.
 *
 * Nothing here is drawn by hand:
 *   aerial   — the Google tile the live app returned for this address
 *   ring     — the county parcel polygon (ReportAll) via a real scan
 *   topo     — USGS 3DEP elevation on the estimator's 18×12 lattice
 *   numbers  — the shipping takeoff + pricing engine, Washington market
 *
 * Beats: address → satellite → BOUNDARY → fence on the line → slope →
 *        3D → proposal → CTA.
 * Loads after: plates/real2-topo.js, real2-parcel.js, real2-job.js, kit.js.
 * The page defines window.AD2 = { hook, satHead, cta, ctaBtn, flourish }.
 * ------------------------------------------------------------------ */
(function () {
  const AD = window.AD2, JOB = window.JOB2;
  const TOPO = window.REAL2_TOPO, GRID = window.REAL2_GRID;
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const chosen = JOB.tiers.find((t) => t.recommended) ?? JOB.tiers[1];
  const RING = JOB.parcelRing; // closed: last point repeats the first
  const RUN = JOB.run, GATES = JOB.gates, PXFT = JOB.pxPerFt;

  /* ---------------- DOM ---------------- */
  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <div class="grid-bg"></div>
  <div class="rail"></div>
  <div class="brand">FENCESCAN <span class="sq"></span></div>

  <section class="scene" id="s1">
    <p class="eyebrow">One address · county lines · a priced fence</p>
    <h1 class="display">${AD.hook[0]}<br><span class="hl">${AD.hook[1]}</span></h1>
    <div class="addr">
      <p class="lbl">New takeoff</p>
      <div class="inp"><span id="typed"></span><span class="caret" id="caret"></span></div>
    </div>
  </section>

  <div id="frame">
    <div class="bar">
      <div class="seg"><span class="on" id="segLay">Layout</span><span id="seg3d">3D preview</span></div>
      <span class="topopill" id="topopill">Topo off</span>
      <span class="lf" id="lfbadge">0 LF · 0 gates</span>
    </div>
    <div class="canvas">
      <img src="plates/real2-aerial.png" alt="" id="aer">
      <svg id="ov" viewBox="0 0 900 580">
        <defs>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g id="topo" style="opacity:0"></g>
        <text class="legend" x="890" y="24" text-anchor="end" id="tleg" style="opacity:0">
          Topo lines every ${TOPO.intervalFt}′ — feet above the low point</text>

        <!-- the radar sweep that "reads" the record -->
        <circle id="radar" cx="450" cy="290" r="0" fill="none"
          stroke="#4ADE80" stroke-width="2" opacity="0"/>

        <!-- the county boundary itself -->
        <polygon id="ringfill" points="" fill="#4ADE80" opacity="0"/>
        <polyline id="ring" fill="none" stroke="#4ADE80" stroke-width="3.4"
          stroke-dasharray="11 7" stroke-linecap="round" stroke-linejoin="round"
          points="" style="opacity:0;filter:url(#glow)"/>
        <g id="rverts"></g>

        <!-- the fence, snapped onto three of those lines -->
        <polyline id="committed" fill="none" stroke="#22d3ee" stroke-width="4.5"
          stroke-linecap="round" stroke-linejoin="round" points=""
          style="filter:drop-shadow(0 0 5px rgba(34,211,238,.75));opacity:0"/>
        <g id="cverts"></g>
        <g id="gates"></g>
        <g id="runchip" style="opacity:0">
          <rect width="86" height="20" rx="6" fill="rgba(9,20,12,.88)"/>
          <text x="43" y="14.5" text-anchor="middle" font-size="12" font-weight="700"
            fill="#a5f3fc" font-family="Inter, sans-serif">${Math.round(JOB.totalLf)} LF</text>
        </g>
      </svg>
      <svg id="threed" viewBox="0 0 900 580" style="opacity:0;background:#cfe4f2"></svg>
      <div class="scanline" id="scan"></div>
      <div class="rec-pill" id="recpill"><span class="dot"></span><span id="rectext">Reading county parcel record…</span></div>
      <div class="apn" id="apnplate">
        <b>${JOB.acres} acres</b><span>${JOB.parcelCorners} corners · ${JOB.sides} recorded sides</span>
      </div>
      <div class="src-stamp" id="stamp">
        <p class="t">Property line found</p>
        <p class="u">County parcel record</p>
      </div>
      <div class="chips3d" id="chips3d">
        <span>6&#8242; Cedar privacy — to scale</span>
        <span class="steps">⛰ ${JOB.slope.steps} sections step down the grade</span>
      </div>
    </div>
  </div>

  <h2 class="head display" id="bighead" style="opacity:0"></h2>

  <div id="under"><div class="row" id="chiprow"></div></div>
  <p id="callout"></p>

  <div id="prop">
    <div class="ph">
      <p class="a">${JOB.address}<small>Fence proposal · prepared from a FenceScan takeoff</small></p>
      <p class="s"><b>${JOB.netLf} LF</b><small>6′ cedar · 1 gate · ${JOB.slope.steps} slope steps</small></p>
    </div>
    <div class="tiers">
      ${JOB.tiers
        .map(
          (t) => `
      <div class="tier ${t.recommended ? "rec" : ""}">
        ${t.recommended ? '<span class="tag">Recommended</span>' : ""}
        <p class="k">${t.name}</p>
        <p class="sp">${t.spec}</p>
        <p class="v">${money(t.total)}</p>
        <p class="lf2">$${t.perLf}/LF</p>
      </div>`,
        )
        .join("")}
    </div>
    <div class="pf"><span>Deposit <b>${money(JOB.deposit)}</b> · balance on completion</span>
      <span>${JOB.market.label} rates · labor ×${JOB.market.labor}</span></div>
  </div>

  <section class="scene" id="s8">
    <h2 class="display">${AD.cta[0]}<br><span class="hl">${AD.cta[1]}</span></h2>
    <span class="btn">${AD.ctaBtn} →</span>
    <p class="site">fencescan.com</p>
    <p class="fine">Real address, real county parcel line, real USGS elevation, real engine output.
      Recorded lines aren&apos;t a survey — confirm before you dig.</p>
  </section>
  <div id="flash"></div>
  `,
  );

  /* per-design flourish (same vocabulary as the v23–v27 set) */
  if (AD.flourish === "hud") {
    [["left:36px;top:546px", "border-right:0;border-bottom:0"],
     ["right:36px;top:546px", "border-left:0;border-bottom:0"],
     ["left:36px;top:1258px", "border-right:0;border-top:0"],
     ["right:36px;top:1258px", "border-left:0;border-top:0"]].forEach(([pos, b]) =>
      document.body.insertAdjacentHTML("beforeend", `<div class="hud-corner" style="${pos};${b}"></div>`));
  }
  if (AD.flourish === "topo") {
    document.body.insertAdjacentHTML("afterbegin",
      `<svg class="topo-flourish" viewBox="0 0 1080 1920" preserveAspectRatio="none">
        <path d="M -40 420 C 260 340, 560 470, 860 350 S 1140 300, 1140 300"/>
        <path d="M -40 760 C 280 650, 580 800, 880 650 S 1140 590, 1140 590"/>
        <path d="M -40 1120 C 300 990, 600 1150, 900 980 S 1140 900, 1140 900"/>
        <path d="M -40 1500 C 320 1350, 620 1530, 920 1330 S 1140 1240, 1140 1240"/>
      </svg>`);
  }

  /* ---------------- geometry helpers ---------------- */
  const ptsAttr = (a) => a.map((q) => q[0] + "," + q[1]).join(" ");
  const zAt = (x, y) => {
    const C = 18, R = 12;
    const gx = Math.min(C - 1.001, Math.max(0, (x / 900) * (C - 1)));
    const gy = Math.min(R - 1.001, Math.max(0, (y / 580) * (R - 1)));
    const c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0;
    return GRID[r0][c0] * (1 - fx) * (1 - fy) + GRID[r0][c0 + 1] * fx * (1 - fy) +
      GRID[r0 + 1][c0] * (1 - fx) * fy + GRID[r0 + 1][c0 + 1] * fx * fy;
  };
  /** Point a fraction `t` along the closed ring, plus cumulative lengths. */
  const RCUM = [0];
  for (let i = 1; i < RING.length; i++)
    RCUM.push(RCUM[i - 1] + Math.hypot(RING[i][0] - RING[i - 1][0], RING[i][1] - RING[i - 1][1]));
  const RTOT = RCUM[RCUM.length - 1];
  const ringUpTo = (t) => {
    const d = t * RTOT;
    const out = [RING[0]];
    for (let i = 1; i < RING.length; i++) {
      if (RCUM[i] <= d) { out.push(RING[i]); continue; }
      const seg = RCUM[i] - RCUM[i - 1];
      const f = seg > 0 ? (d - RCUM[i - 1]) / seg : 0;
      out.push([RING[i - 1][0] + (RING[i][0] - RING[i - 1][0]) * f,
                RING[i - 1][1] + (RING[i][1] - RING[i - 1][1]) * f]);
      break;
    }
    return out;
  };

  /* ---------------- the 3D scene (Fence3D's camera model) ---------- */
  (function build3d() {
    const svg = $("#threed");
    const NS = "http://www.w3.org/2000/svg";
    const YAW = (-28 * Math.PI) / 180, SQ = 0.52, S = 1.05;
    const ESC = PXFT * 1.3 * S; // ft → px, HEIGHT_EXAGGERATION 1.3
    const cx = 450, cy = 290;
    const zBase = zAt(450, 290);
    const proj = (x, y, eft) => {
      const dx = x - cx, dy = y - cy;
      const xr = dx * Math.cos(YAW) - dy * Math.sin(YAW);
      const yr = dx * Math.sin(YAW) + dy * Math.cos(YAW);
      return { X: 450 + xr * S, Y: 330 + yr * SQ * S - eft * ESC, d: yr };
    };
    const zRel = (x, y) => zAt(x, y) - zBase;
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    const items = [];

    /* terrain quads over the parcel extent */
    const X0 = 120, X1 = 780, Y0 = 40, Y1 = 540, NXC = 9, NYC = 7;
    for (let r = 0; r < NYC; r++)
      for (let c = 0; c < NXC; c++) {
        const xa = X0 + ((X1 - X0) * c) / NXC, xb = X0 + ((X1 - X0) * (c + 1)) / NXC;
        const ya = Y0 + ((Y1 - Y0) * r) / NYC, yb = Y0 + ((Y1 - Y0) * (r + 1)) / NYC;
        const q = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]].map(([x, y]) => proj(x, y, zRel(x, y)));
        const sh = Math.max(-14, Math.min(14, (zRel(xa, ya) - zRel(xb, yb)) * 2.2));
        const g = 178 + sh, gr = 150 + sh;
        items.push({ d: Math.min(q[0].d, q[1].d) - 900, cls: "ground",
          n: el("polygon", { points: q.map((p) => `${p.X},${p.Y}`).join(" "),
            fill: `rgb(${g - 34},${g + 18},${gr - 14})`, stroke: "rgba(70,100,60,.22)", "stroke-width": .6 }) });
      }

    /* THE COUNTY LINE, draped on the 3D ground — the ad's whole point:
       you can see the fence standing on three of the four recorded lines. */
    (function () {
      const d = RING.map(([x, y], i) => {
        const q = proj(x, y, zRel(x, y) + 0.12);
        return (i ? "L" : "M") + q.X.toFixed(1) + " " + q.Y.toFixed(1);
      }).join(" ");
      items.push({ d: -400, cls: "ringline",
        n: el("path", { d, fill: "none", stroke: "#4ADE80", "stroke-width": 2.6,
          "stroke-dasharray": "9 6", "stroke-linejoin": "round", opacity: .95 }) });
    })();

    /* the fence: real per-post elevations, rack vs step per section.
       The bay nearest the gate becomes the gate leaf — the walk gate is
       in the takeoff and the price, so it belongs in the picture. */
    const PE = JOB.postElev, H = 6 * ESC;
    const G0 = GATES[0];
    let gateBay = -1, gateBest = Infinity;
    for (let i = 0; i < PE.length - 1; i++) {
      const mx = (PE[i][0] + PE[i + 1][0]) / 2, my = (PE[i][1] + PE[i + 1][1]) / 2;
      const dd = Math.hypot(mx - G0.x, my - G0.y);
      if (dd < gateBest) { gateBest = dd; gateBay = i; }
    }
    const panels = [], posts = [];
    for (let i = 0; i < PE.length - 1; i++) {
      const [x1, y1, z1] = PE[i], [x2, y2, z2] = PE[i + 1];
      const level = Math.abs(z2 - z1) > 1.0;
      const zb1 = level ? Math.max(z1, z2) : z1, zb2 = level ? Math.max(z1, z2) : z2;
      const p1 = proj(x1, y1, zb1), p2 = proj(x2, y2, zb2);
      const isGate = i === gateBay;
      const g = document.createElementNS(NS, "g");
      g.appendChild(el("polygon", {
        points: `${p1.X},${p1.Y} ${p2.X},${p2.Y} ${p2.X},${p2.Y - H} ${p1.X},${p1.Y - H}`,
        fill: isGate ? "#d9b489" : i % 2 ? "#b28a60" : "#a87f56",
        stroke: isGate ? "#8a6743" : "#7c5c40", "stroke-width": isGate ? 1.3 : .8 }));
      if (isGate) {
        // hinge-side X brace, the way a built gate reads at a glance
        g.appendChild(el("line", { x1: p1.X, y1: p1.Y, x2: p2.X, y2: p2.Y - H,
          stroke: "rgba(90,62,36,.55)", "stroke-width": 1.4 }));
        g.appendChild(el("line", { x1: p2.X, y1: p2.Y, x2: p1.X, y2: p1.Y - H,
          stroke: "rgba(90,62,36,.55)", "stroke-width": 1.4 }));
      } else {
        for (let s = 1; s < 4; s++) {
          const t = s / 4;
          g.appendChild(el("line", { x1: p1.X + (p2.X - p1.X) * t, y1: p1.Y + (p2.Y - p1.Y) * t - 2,
            x2: p1.X + (p2.X - p1.X) * t, y2: p1.Y + (p2.Y - p1.Y) * t - H + 2,
            stroke: "#8f6c4a", "stroke-width": .7, opacity: .7 }));
        }
      }
      items.push({ d: (p1.d + p2.d) / 2, n: g, cls: "panel" });
      panels.push(g);
    }
    for (let i = 0; i < PE.length; i++) {
      const [x, y, z] = PE[i];
      const nb = (j) => (j >= 0 && j < PE.length && Math.abs(PE[j][2] - z) > 1 ? Math.max(PE[j][2], z) : z);
      const zTop = Math.max(z, nb(i - 1), nb(i + 1));
      const pb = proj(x, y, z), pt = proj(x, y, zTop);
      const g = document.createElementNS(NS, "g");
      g.appendChild(el("rect", { x: pb.X - 2.4, y: pt.Y - H - 5, width: 4.8,
        height: pb.Y - (pt.Y - H - 5), fill: "#7a5a3f", stroke: "#5f4630", "stroke-width": .6 }));
      items.push({ d: pb.d + 0.5, n: g, cls: "post" });
      posts.push(g);
    }

    items.sort((a, b) => a.d - b.d).forEach((it) => svg.appendChild(it.n));
    window.__3d = { panels, posts };
  })();

  /* ---------------- contours ---------------- */
  $("#topo").innerHTML = TOPO.lines
    .map((l) =>
      l.chains
        .map((ch) =>
          `<polyline fill="none" stroke="#FCD34D" stroke-width="1.4" opacity=".9" ` +
          `stroke-linejoin="round" stroke-linecap="round" points="${ch.map((q) => q[0] + "," + q[1]).join(" ")}"/>`)
        .join(""))
    .join("");

  /* ================= choreography ================= */
  const T = {
    s1: [0, 2900], sat: [2700, 6000], bound: [5800, 12600], draw: [12400, 17600],
    topo: [17400, 20600], td: [20400, 24800], prop: [24600, 27600], cta: [27400, 30000],
  };

  scene("#s1", T.s1[0], T.s1[1], 260);
  rise("#s1 .eyebrow", 100, 520, 24);
  rise("#s1 h1", 220, 940, 56);
  rise("#s1 .addr", 820, 1400, 40);
  type("#typed", 1100, 2500, JOB.address, "#caret");

  /* frame + headline per beat */
  (function () {
    const fr = $("#frame"), bh = $("#bighead");
    up((ms) => {
      const on = ms >= T.sat[0] && ms < T.prop[0];
      fr.style.opacity = on ? Math.min(1, eo(p(ms, T.sat[0], T.sat[0] + 450))) : 0;
      const heads = [
        [T.sat, `${AD.satHead[0]}<br><span class="hl">${AD.satHead[1]}</span>`],
        [T.bound, `The property line<br><span class="hl">comes to you.</span>`],
        [T.draw, `Fence rides<br><span class="hl">the recorded line.</span>`],
        [T.topo, `Real ground.<br><span class="hl">${TOPO.riseFt}′ of fall.</span>`],
        [T.td, `${JOB.slope.steps} steps,<br><span class="hl">already priced.</span>`],
        [T.prop, `Quoted for<br><span class="hl">${JOB.market.label}.</span>`],
      ];
      let h = null;
      for (const [t, html] of heads) if (ms >= t[0] && ms < t[1]) h = html;
      if (h) bh.innerHTML = h;
      bh.style.opacity = h && ms > T.sat[0] + 120 ? 1 : 0;
    });
  })();

  kenBurns("#aer", T.sat[0], T.draw[1], 1.07, 1.0);
  sweep("#scan", T.sat[0] + 500, T.sat[0] + 1900, 632);

  /* ---------- THE BOUNDARY ACT ---------- */
  (function () {
    const pill = $("#recpill"), ptxt = $("#rectext"), apn = $("#apnplate");
    const radar = $("#radar"), ring = $("#ring"), fill = $("#ringfill");
    const verts = $("#rverts"), stamp = $("#stamp");
    const B0 = T.bound[0];
    const DRAW0 = B0 + 1250, DRAW1 = B0 + 4100, LOCK = DRAW1 + 120;
    up((ms) => {
      /* status pill: request → found */
      const pOn = ms >= B0 + 150 && ms < T.draw[0] + 400;
      pill.style.opacity = pOn ? eo(p(ms, B0 + 150, B0 + 520)) : 0;
      const found = ms >= DRAW0;
      pill.classList.toggle("done", found);
      ptxt.textContent = found
        ? `County parcel · ${JOB.acres} acres`
        : "Reading county parcel record…";

      /* radar sweep out of the parcel centre while the record loads */
      const rt = p(ms, B0 + 400, DRAW0 + 200);
      radar.setAttribute("r", String(20 + rt * 430));
      radar.setAttribute("opacity", String(rt > 0 && rt < 1 ? 0.55 * (1 - rt) : 0));

      /* the ring draws vertex by vertex */
      const dt = eo(p(ms, DRAW0, DRAW1));
      if (dt > 0 && ms < T.prop[0]) {
        ring.style.opacity = 1;
        ring.setAttribute("points", ptsAttr(ringUpTo(dt)));
      } else ring.style.opacity = 0;

      /* corner pins pop as the line reaches them */
      if (ms >= DRAW0 && ms < T.prop[0]) {
        const reached = ringUpTo(dt).length;
        verts.innerHTML = RING.slice(0, Math.max(0, reached - 1))
          .map(([x, y], i) => {
            const t = eo(p(ms, DRAW0 + (i * (DRAW1 - DRAW0)) / RING.length,
              DRAW0 + 300 + (i * (DRAW1 - DRAW0)) / RING.length));
            const r = 4.6 * (1 + 0.9 * (1 - t));
            return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#0D1B12" stroke="#4ADE80" stroke-width="2.4"/>`;
          })
          .join("");
      } else verts.innerHTML = "";

      /* the enclosed area flashes once when the ring closes */
      const ft = ms >= LOCK && ms < LOCK + 900 ? 1 - p(ms, LOCK, LOCK + 900) : 0;
      fill.setAttribute("points", ptsAttr(RING));
      fill.setAttribute("opacity", String(ft * 0.24));

      /* acreage plate + the stamp */
      apn.style.opacity = ms >= LOCK - 250 && ms < T.draw[0] + 400
        ? eo(p(ms, LOCK - 250, LOCK + 150)) : 0;
      const st = ms >= LOCK && ms < LOCK + 1500;
      stamp.style.opacity = st ? eo(p(ms, LOCK, LOCK + 320)) * (1 - p(ms, LOCK + 1050, LOCK + 1500)) : 0;
      stamp.style.transform =
        `translate(-50%,-50%) scale(${st ? lerp(0.86, 1, eo(p(ms, LOCK, LOCK + 420))) : 1})`;
    });
  })();

  /* ---------- the fence snaps onto the line ---------- */
  (function () {
    const committed = $("#committed"), cverts = $("#cverts"), runchip = $("#runchip");
    const lf = $("#lfbadge"), gates = $("#gates");
    const D0 = T.draw[0] + 500, D1 = T.draw[0] + 3000, GATE = T.draw[0] + 3500;
    /* cumulative lengths along the fence run */
    const cum = [0];
    for (let i = 1; i < RUN.length; i++)
      cum.push(cum[i - 1] + Math.hypot(RUN[i][0] - RUN[i - 1][0], RUN[i][1] - RUN[i - 1][1]));
    const tot = cum[cum.length - 1];
    up((ms) => {
      const on = ms >= D0 && ms < T.prop[0];
      if (!on) {
        committed.style.opacity = 0; cverts.innerHTML = "";
        runchip.style.opacity = 0; gates.innerHTML = "";
        lf.textContent = "0 LF · 0 gates";
        return;
      }
      const t = eio(p(ms, D0, D1));
      const d = t * tot;
      const out = [RUN[0]];
      for (let i = 1; i < RUN.length; i++) {
        if (cum[i] <= d) { out.push(RUN[i]); continue; }
        const seg = cum[i] - cum[i - 1];
        const f = seg > 0 ? (d - cum[i - 1]) / seg : 0;
        out.push([RUN[i - 1][0] + (RUN[i][0] - RUN[i - 1][0]) * f,
                  RUN[i - 1][1] + (RUN[i][1] - RUN[i - 1][1]) * f]);
        break;
      }
      committed.style.opacity = 1;
      committed.setAttribute("points", ptsAttr(out));
      cverts.innerHTML = out
        .map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.2" fill="#fff" stroke="#0891b2" stroke-width="1.6"/>`)
        .join("");
      const gateOn = ms >= GATE;
      gates.innerHTML = gateOn
        ? GATES.map((g) => {
            const half = (g.widthFt * PXFT) / 2;
            return (
              `<line x1="${g.x}" y1="${g.y - half}" x2="${g.x}" y2="${g.y + half}" stroke="#0b1210" stroke-width="8" opacity=".55"/>` +
              `<line x1="${g.x}" y1="${g.y - half}" x2="${g.x}" y2="${g.y + half}" stroke="#f472b6" stroke-width="4.5" stroke-dasharray="6 4"/>` +
              `<rect x="${g.x + 8}" y="${g.y - 10}" width="52" height="19" rx="9" fill="#f472b6"/>` +
              `<text x="${g.x + 34}" y="${g.y + 3.5}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="Inter, sans-serif">${g.widthFt}′ gate</text>`
            );
          }).join("")
        : "";
      const shownLf = Math.round(JOB.totalLf * t);
      lf.textContent = `${shownLf} LF · ${gateOn ? "1 gate" : "0 gates"}`;
      if (t >= 1) {
        runchip.setAttribute("transform", `translate(${RUN[1][0] - 190},${RUN[1][1] + 40})`);
        runchip.style.opacity = 1;
      } else runchip.style.opacity = 0;
    });
  })();

  /* ---------- chips under the frame ---------- */
  (function () {
    const row = $("#chiprow");
    const sets = [
      [T.sat, [`<span class="tick">✓</span> Real aerial — Google`, `<span class="tick">✓</span> ${JOB.market.label}`, `<span class="tick">✓</span> No site visit`]],
      [T.bound, [`<span class="tick">✓</span> County parcel record`, `<span class="tick">✓</span> ${JOB.acres} acres`, `<span class="tick">✓</span> ${JOB.parcelCorners} corners · ${JOB.sides} sides`]],
      [T.draw, [`<span class="tick">✓</span> Snapped to the line`, `<span class="tick">✓</span> ${Math.round(JOB.totalLf)} LF`, `<span class="tick">✓</span> Front left open`]],
      [T.topo, [`<span class="tick">✓</span> USGS elevation`, `<span class="tick">✓</span> ${TOPO.intervalFt}′ contours`, `<span class="tick">✓</span> Grade ${JOB.slope.avg}% avg · ${JOB.slope.max}% max`]],
      [T.td, [`<span class="tick">✓</span> ${JOB.posts} posts`, `<span class="tick">✓</span> ${JOB.bags} bags concrete`, `<span class="tick">✓</span> ${JOB.laborHours} crew hrs`]],
      [T.prop, [`<span class="tick">✓</span> Three tiers`, `<span class="tick">✓</span> ${money(JOB.deposit)} deposit`, `<span class="tick">✓</span> E-sign ready`]],
    ];
    up((ms) => {
      let cur = null, t0 = 0;
      for (const [t, chips] of sets) if (ms >= t[0] && ms < t[1]) { cur = chips; t0 = t[0]; }
      if (!cur) { row.innerHTML = ""; row.dataset.t0 = ""; return; }
      if (row.dataset.t0 !== String(t0)) {
        row.dataset.t0 = String(t0);
        row.innerHTML = cur.map((c) => `<span class="chip">${c}</span>`).join("");
      }
      [...row.children].forEach((el, i) => {
        const tt = eo(p(ms, t0 + 450 + i * 190, t0 + 780 + i * 190));
        el.style.opacity = tt;
        el.style.transform = `translateY(${(1 - tt) * 22}px)`;
      });
    });
  })();

  /* ---------- callouts ---------- */
  (function () {
    const c = $("#callout");
    const msgs = [
      [T.bound[0] + 4400, T.bound[1], `Recorded lines, pulled live — <b>no tape, no guessing.</b>`],
      [T.draw[0] + 3200, T.draw[1], `Three sides on the line. <b>Front yard stays open.</b>`],
      [T.topo[0] + 900, T.topo[1], `Every number after this <b>knows the grade.</b>`],
      [T.td[0] + 2200, T.td[1], `Level panels, stepped posts — <b>counted into the price.</b>`],
      [T.prop[0] + 800, T.prop[1], `<b>${money(chosen.total)}</b> — measured, stepped and priced from one address.`],
    ];
    up((ms) => {
      let m = null;
      for (const [a, b, html] of msgs) if (ms >= a && ms < b) m = html;
      if (m) c.innerHTML = m;
      c.style.opacity = m ? 1 : 0;
    });
  })();

  /* ---------- topo toggle ---------- */
  (function () {
    const pill = $("#topopill"), g = $("#topo"), leg = $("#tleg");
    up((ms) => {
      const on = ms >= T.topo[0] + 200 && ms < T.td[0] + 300;
      pill.classList.toggle("on", on);
      pill.textContent = "Topo " + (on ? "on" : "off");
      const t = p(ms, T.topo[0] + 200, T.topo[0] + 1500);
      g.style.opacity = on ? 1 : 0;
      const lines = g.children;
      for (let i = 0; i < lines.length; i++)
        lines[i].style.opacity = on ? eo(clamp(t * lines.length - i * 0.5)) : 0;
      leg.style.opacity = on ? eo(p(ms, T.topo[0] + 900, T.topo[0] + 1300)) : 0;
    });
  })();

  /* ---------- 3D swap + build ---------- */
  (function () {
    const td = $("#threed"), aer = $("#aer"), ov = $("#ov");
    const sl = $("#segLay"), s3 = $("#seg3d");
    const { panels, posts } = window.__3d;
    posts.forEach((g) => (g.style.opacity = 0));
    panels.forEach((g) => (g.style.opacity = 0));
    up((ms) => {
      const in3d = ms >= T.td[0] + 200 && ms < T.prop[0] + 400;
      td.style.opacity = in3d ? eo(p(ms, T.td[0] + 200, T.td[0] + 650)) : 0;
      sl.classList.toggle("on", !in3d);
      s3.classList.toggle("on", in3d);
      aer.style.opacity = in3d ? 0 : 1;
      ov.style.opacity = in3d ? 0 : 1;
      posts.forEach((g, i) => (g.style.opacity = eo(p(ms, T.td[0] + 450 + i * 16, T.td[0] + 700 + i * 16))));
      panels.forEach((g, i) => (g.style.opacity = eo(p(ms, T.td[0] + 800 + i * 22, T.td[0] + 1080 + i * 22))));
      $("#chips3d").style.opacity = in3d ? eo(p(ms, T.td[0] + 2300, T.td[0] + 2800)) : 0;
    });
  })();

  /* ---------- proposal card ---------- */
  (function () {
    const pr = $("#prop");
    up((ms) => {
      const on = ms >= T.prop[0] + 150 && ms < T.cta[0] + 500;
      const t = eo(p(ms, T.prop[0] + 150, T.prop[0] + 750));
      pr.style.opacity = on ? t : 0;
      pr.style.transform = `translateY(${(1 - t) * 40}px)`;
    });
  })();

  /* ---------- CTA + cut flashes ---------- */
  scene("#s8", T.cta[0], 30000, 300);
  rise("#s8 h2", T.cta[0] + 130, T.cta[0] + 820, 52);
  pop("#s8 .btn", T.cta[0] + 850, T.cta[0] + 1350);
  rise("#s8 .site", T.cta[0] + 1250, T.cta[0] + 1650, 20);
  rise("#s8 .fine", T.cta[0] + 1450, T.cta[0] + 1850, 18);

  if (AD.flourish === "flash") {
    const f = $("#flash");
    const cuts = [T.sat[0], T.bound[0], T.draw[0], T.topo[0], T.td[0], T.prop[0], T.cta[0]];
    up((ms) => {
      let o = 0;
      for (const c of cuts) if (ms >= c - 20 && ms < c + 70) o = 0.7 * (1 - Math.abs(ms - c) / 90);
      f.style.opacity = o;
    });
  }
  if (AD.flourish === "hud") {
    up((ms) => $$(".hud-corner").forEach((el) =>
      (el.style.opacity = ms >= T.sat[0] && ms < T.prop[0] ? 1 : 0)));
  }

  window.TOTAL_MS = 30000;
  window.seek(0);
})();
