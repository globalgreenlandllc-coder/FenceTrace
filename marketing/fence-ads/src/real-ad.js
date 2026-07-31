/* ------------------------------------------------------------------ *
 * real-ad.js — the Snohomish real-property ad (v23–v27).
 *
 * One 30s choreography over real data, five palettes. Everything on
 * screen is computed: the aerial and elevation are Google data for
 * 12103 202nd St SE (fetch-real.mts), the contours are the app's own
 * marching squares, and every number comes from real-job.js — the
 * shipping takeoff/pricing engine run on the drawn enclosure with the
 * real Washington market (compute-real-job.mts).
 *
 * Beats: address → satellite → topo → draw → diagram → 3D → proposal → CTA.
 * Loads after: plates/real-topo.js, plates/real-job.js, kit.js.
 * The page defines window.AD = { hook: [l1, l2], cta, ctaLine, flourish }.
 * ------------------------------------------------------------------ */
(function () {
  const AD = window.AD, JOB = window.JOB, TOPO = window.REAL_TOPO, GRID = window.REAL_GRID;
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const chosen = JOB.tiers.find((t) => t.recommended) ?? JOB.tiers[1];

  /* ---------------- DOM ---------------- */
  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <div class="grid-bg"></div>
  <div class="rail"></div>
  <div class="brand">FENCESCAN <span class="sq"></span></div>

  <section class="scene" id="s1">
    <p class="eyebrow">One real property, start to finish</p>
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
      <img src="plates/real-aerial-z19.png" alt="" id="aer">
      <svg id="ov" viewBox="0 0 900 580">
        <g id="topo" style="opacity:0"></g>
        <text class="legend" x="890" y="24" text-anchor="end" id="tleg" style="opacity:0">
          Topo lines every ${TOPO.intervalFt}′ — feet above the low point</text>
        <polyline id="committed" fill="none" stroke="#22d3ee" stroke-width="3.5"
          stroke-linecap="round" stroke-linejoin="round" points=""
          style="filter:drop-shadow(0 0 4px rgba(34,211,238,0.7));opacity:0"/>
        <g id="cverts"></g>
        <g id="runchip" style="opacity:0">
          <rect width="52" height="18" rx="5" fill="rgba(9,20,12,0.85)"/>
          <text x="26" y="13" text-anchor="middle" font-size="11" font-weight="700"
            fill="#a7f3d0" font-family="Inter, sans-serif">${Math.round(JOB.totalLf)} ft</text>
        </g>
        <g id="gates"></g>
        <polyline id="draft" fill="none" stroke="#fbbf24" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" points=""/>
        <line id="rubber" stroke="#fbbf24" stroke-width="3" stroke-dasharray="7 5"
          stroke-linecap="round" style="opacity:0"/>
        <g id="dverts"></g>
        <g id="chip" style="opacity:0">
          <rect width="10" height="20" rx="6" fill="rgba(9,20,12,0.9)"/>
          <text x="8" y="14" font-size="11" font-weight="700" fill="#fde68a"
            font-family="Inter, sans-serif"></text>
        </g>
      </svg>
      <svg id="diag" viewBox="0 0 900 580" style="opacity:0;background:#F7F6F2"></svg>
      <svg id="threed" viewBox="0 0 900 580" style="opacity:0;background:#cfe4f2"></svg>
      <div class="scanline" id="scan"></div>
      <div class="chips3d" id="chips3d">
        <span>6&#8242; Cedar privacy — to scale</span>
        <span class="steps">⛰ ${JOB.slope.steps} sections step down the slope</span>
      </div>
      <div class="cur" id="cur">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff" stroke="#0D1B12" stroke-width="1.4">
          <path d="M4 2 L20 12 L13 13.5 L16.5 20.5 L13.5 22 L10 15 L4 19 Z"/>
        </svg>
      </div>
    </div>
  </div>

  <h2 class="head display" id="bighead" style="opacity:0"></h2>

  <div id="under">
    <div class="row" id="chiprow"></div>
  </div>
  <p id="callout"></p>

  <div id="prop">
    <div class="ph">
      <p class="a">${JOB.address}<small>Fence proposal · prepared from a FenceScan takeoff</small></p>
      <p class="s"><b>${JOB.netLf} LF</b><small>6′ cedar · 2 gates · ${JOB.slope.steps} slope steps</small></p>
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
    <p class="fine">Real address, real Google aerial &amp; elevation, real engine output.
      Satellite terrain isn't a survey — verify on site before digging.</p>
  </section>
  <div id="flash"></div>
  `,
  );

  /* per-design flourish */
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
  if (AD.flourish === "hazard") {
    document.body.insertAdjacentHTML("beforeend",
      `<div class="hazard" style="top:0"></div><div class="hazard" style="bottom:0"></div>`);
  }

  /* ---------------- shared geometry ---------------- */
  const RUN = JOB.run, GATES = JOB.gates, PXFT = JOB.pxPerFt;
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ptsAttr = (a) => a.map((p) => p[0] + "," + p[1]).join(" ");
  const zAt = (x, y) => {
    const C = 18, R = 12;
    const gx = Math.min(C - 1.001, Math.max(0, (x / 900) * (C - 1)));
    const gy = Math.min(R - 1.001, Math.max(0, (y / 580) * (R - 1)));
    const c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0;
    return GRID[r0][c0] * (1 - fx) * (1 - fy) + GRID[r0][c0 + 1] * fx * (1 - fy) +
      GRID[r0 + 1][c0] * (1 - fx) * fy + GRID[r0 + 1][c0 + 1] * fx * fy;
  };

  /* ---------------- the 3D scene (Fence3D's own camera model) ------- */
  (function build3d() {
    const svg = $("#threed");
    const NS = "http://www.w3.org/2000/svg";
    const YAW = (-28 * Math.PI) / 180, SQ = 0.52, S = 1.55;
    const ESC = PXFT * 1.3 * S; // ft → screen px, HEIGHT_EXAGGERATION 1.3
    const cx = 452, cy = 300;
    let zmin = Infinity;
    for (const [, , z] of JOB.postElev) zmin = Math.min(zmin, z);
    const zBase = zAt(452, 300);
    const proj = (x, y, eft) => {
      const dx = x - cx, dy = y - cy;
      const xr = dx * Math.cos(YAW) - dy * Math.sin(YAW);
      const yr = dx * Math.sin(YAW) + dy * Math.cos(YAW);
      return { X: 450 + xr * S, Y: 330 + yr * SQ * S - eft * ESC, d: yr };
    };
    const zRel = (x, y) => zAt(x, y) - zBase;

    const items = [];
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };

    /* terrain: 8×6 shaded quads over the scene extent */
    const X0 = 130, X1 = 790, Y0 = 60, Y1 = 560, NXC = 8, NYC = 6;
    for (let r = 0; r < NYC; r++)
      for (let c = 0; c < NXC; c++) {
        const xa = X0 + ((X1 - X0) * c) / NXC, xb = X0 + ((X1 - X0) * (c + 1)) / NXC;
        const ya = Y0 + ((Y1 - Y0) * r) / NYC, yb = Y0 + ((Y1 - Y0) * (r + 1)) / NYC;
        const q = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]].map(([x, y]) => proj(x, y, zRel(x, y)));
        const slopeShade = Math.max(-14, Math.min(14, (zRel(xa, ya) - zRel(xb, yb)) * 1.6));
        const g = 176 + slopeShade, gr = 148 + slopeShade;
        items.push({
          d: Math.min(q[0].d, q[1].d) - 900,
          n: el("polygon", { points: q.map((p) => `${p.X},${p.Y}`).join(" "),
            fill: `rgb(${g - 34},${g + 18},${gr - 14})`, stroke: "rgba(70,100,60,.25)", "stroke-width": .6 }),
          cls: "ground",
        });
      }

    /* trees along the real tree lines */
    [[210, 120], [228, 300], [285, 92], [700, 155], [716, 300], [652, 88], [246, 452], [712, 430]]
      .forEach(([x, y]) => {
        const b = proj(x, y, zRel(x, y));
        const r = 26;
        const g = document.createElementNS(NS, "g");
        g.appendChild(el("ellipse", { cx: b.X + 8, cy: b.Y + 6, rx: r, ry: r * 0.32, fill: "rgba(40,70,40,.25)" }));
        g.appendChild(el("rect", { x: b.X - 3, y: b.Y - 26, width: 6, height: 26, fill: "#7a5c3f" }));
        g.appendChild(el("circle", { cx: b.X, cy: b.Y - 40, r, fill: "#4C7A45" }));
        g.appendChild(el("circle", { cx: b.X - r * 0.4, cy: b.Y - 34, r: r * 0.6, fill: "#3B6136" }));
        g.appendChild(el("circle", { cx: b.X + r * 0.4, cy: b.Y - 46, r: r * 0.55, fill: "#557F42" }));
        items.push({ d: b.d, n: g, cls: "tree" });
      });

    /* the fence: real per-post elevations, rack-vs-step per section */
    const PE = JOB.postElev, H = 6 * ESC;
    const panels = [], posts = [];
    for (let i = 0; i < PE.length - 1; i++) {
      const [x1, y1, z1] = PE[i], [x2, y2, z2] = PE[i + 1];
      const rise = Math.abs(z2 - z1), level = rise > 1.0;
      const zb1 = level ? Math.max(z1, z2) : z1, zb2 = level ? Math.max(z1, z2) : z2;
      const p1 = proj(x1, y1, zb1), p2 = proj(x2, y2, zb2);
      const g = document.createElementNS(NS, "g");
      g.appendChild(el("polygon", {
        points: `${p1.X},${p1.Y} ${p2.X},${p2.Y} ${p2.X},${p2.Y - H} ${p1.X},${p1.Y - H}`,
        fill: i % 2 ? "#b28a60" : "#a87f56", stroke: "#7c5c40", "stroke-width": .9 }));
      for (let s = 1; s < 4; s++) {
        const t = s / 4;
        g.appendChild(el("line", { x1: p1.X + (p2.X - p1.X) * t, y1: p1.Y + (p2.Y - p1.Y) * t - 2,
          x2: p1.X + (p2.X - p1.X) * t, y2: p1.Y + (p2.Y - p1.Y) * t - H + 2,
          stroke: "#8f6c4a", "stroke-width": .8, opacity: .75 }));
      }
      const item = { d: (p1.d + p2.d) / 2, n: g, cls: "panel" };
      items.push(item); panels.push(g);
    }
    for (let i = 0; i < PE.length; i++) {
      const [x, y, z] = PE[i];
      const zTop = Math.max(z, i > 0 ? (Math.abs(PE[i - 1][2] - z) > 1 ? Math.max(PE[i - 1][2], z) : z) : z,
        i < PE.length - 1 ? (Math.abs(PE[i + 1][2] - z) > 1 ? Math.max(PE[i + 1][2], z) : z) : z);
      const pb = proj(x, y, z), pt = proj(x, y, zTop);
      const g = document.createElementNS(NS, "g");
      g.appendChild(el("rect", { x: pb.X - 2.6, y: pt.Y - H - 5, width: 5.2, height: pb.Y - (pt.Y - H - 5),
        fill: "#7a5a3f", stroke: "#5f4630", "stroke-width": .7 }));
      const item = { d: pb.d + 0.5, n: g, cls: "post" };
      items.push(item); posts.push(g);
    }

    /* the house: a muted prism the fence ties into */
    (function () {
      const fp = [[352, 400], [592, 400], [592, 558], [352, 558]];
      const zh = zRel(472, 480), HH = 20 * ESC / (6 * ESC) * H * 1.15;
      const base = fp.map(([x, y]) => proj(x, y, zh));
      const top = base.map((p) => ({ ...p, Y: p.Y - HH }));
      const g = document.createElementNS(NS, "g");
      g.appendChild(el("polygon", { points: `${base[0].X},${base[0].Y} ${base[1].X},${base[1].Y} ${top[1].X},${top[1].Y} ${top[0].X},${top[0].Y}`, fill: "#c9c4bb", stroke: "#a49e92", "stroke-width": 1 }));
      g.appendChild(el("polygon", { points: `${base[1].X},${base[1].Y} ${base[2].X},${base[2].Y} ${top[2].X},${top[2].Y} ${top[1].X},${top[1].Y}`, fill: "#b7b1a6", stroke: "#a49e92", "stroke-width": 1 }));
      g.appendChild(el("polygon", { points: top.map((p) => `${p.X},${p.Y}`).join(" "), fill: "#8a8f96", stroke: "#6e737a", "stroke-width": 1.2 }));
      items.push({ d: proj(472, 558, 0).d, n: g, cls: "house" });
    })();

    items.sort((a, b) => a.d - b.d).forEach((it) => svg.appendChild(it.n));
    window.__3d = { panels, posts };
  })();

  /* ---------------- the diagram ---------------- */
  (function () {
    const svg = $("#diag");
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    };
    el("rect", { x: 0, y: 0, width: 900, height: 580, fill: "#F7F6F2" });
    el("polygon", { points: "352,415 592,398 592,560 352,560",
      fill: "#E4E0D6", stroke: "#B9B2A3", "stroke-width": 3 });
    const path = el("path", {
      d: "M " + RUN.map((p) => p[0] + " " + p[1]).join(" L "),
      fill: "none", stroke: "#1E7340", "stroke-width": 8,
      "stroke-linejoin": "round", "stroke-linecap": "round", id: "diagrun" });
    RUN.slice(1, -1).forEach(([x, y]) =>
      el("rect", { x: x - 7, y: y - 7, width: 14, height: 14, fill: "#fff", stroke: "#0D1B12", "stroke-width": 3.5 }));
    GATES.forEach((g) => {
      const half = (g.widthFt * PXFT) / 2;
      const horiz = Math.abs(g.y - 121) > 40;
      const dx = horiz ? half : half, dy = 0;
      el("line", { x1: g.x - dx, y1: g.y, x2: g.x + dx, y2: g.y,
        stroke: "#F472B6", "stroke-width": 11, "stroke-linecap": "round" });
    });
    el("text", { x: 450, y: 548, "text-anchor": "middle", "font-size": 20, "font-weight": 700,
      fill: "#52525B", "font-family": "Inter, sans-serif" }).textContent =
      `Meadow enclosure · ${Math.round(JOB.totalLf)} LF · ${JOB.corners} corners · 2 gates · ties into the house`;
  })();

  /* ---------------- contours ---------------- */
  (function () {
    const g = $("#topo");
    g.innerHTML = TOPO.lines
      .map((l) =>
        l.chains.map((ch) =>
          `<polyline fill="none" stroke="#FCD34D" stroke-width="1.4" opacity="0.9" ` +
          `stroke-linejoin="round" stroke-linecap="round" points="${ch.map((p) => p[0] + "," + p[1]).join(" ")}"/>`).join("") +
        l.labels.map(([x, y]) =>
          `<text class="legend" x="${x}" y="${y}" text-anchor="middle">+${l.levelFt}′</text>`).join(""))
      .join("");
  })();

  /* ================= choreography ================= */
  const T = {
    s1: [0, 3000], sat: [2800, 7400], topo: [7200, 11600], draw: [11400, 17400],
    diag: [17200, 20400], td: [20200, 25200], prop: [25000, 27800], cta: [27600, 30000],
  };

  scene("#s1", T.s1[0], T.s1[1], 280);
  rise("#s1 .eyebrow", 120, 560, 24);
  rise("#s1 h1", 250, 1000, 56);
  rise("#s1 .addr", 900, 1500, 40);
  type("#typed", 1200, 2600, JOB.address, "#caret");

  /* the frame lives across sat→prop; headline + LF badge follow the beat */
  (function () {
    const fr = $("#frame"), bh = $("#bighead");
    up((ms) => {
      const on = ms >= T.sat[0] && ms < T.prop[0];
      fr.style.opacity = on ? Math.min(1, eo(p(ms, T.sat[0], T.sat[0] + 500))) : 0;
      const heads = [
        [T.sat, `${AD.satHead[0]}<br><span class="hl">${AD.satHead[1]}</span>`],
        [T.topo, `Real terrain.<br><span class="hl">+${Math.round(TOPO.riseFt)}′ of relief.</span>`],
        [T.draw, `Fence the meadow —<br><span class="hl">not the whole 5 acres.</span>`],
        [T.diag, `The plan,<br><span class="hl">squared away.</span>`],
        [T.td, `${JOB.slope.steps} steps down<br><span class="hl">the real hill.</span>`],
        [T.prop, `Priced for<br><span class="hl">${JOB.market.label}.</span>`],
      ];
      let h = null;
      for (const [t, html] of heads) if (ms >= t[0] && ms < t[1]) h = html;
      if (h) bh.innerHTML = h;
      bh.style.opacity = h && ms > T.sat[0] + 150 ? 1 : 0;
    });
  })();

  /* satellite reveal */
  kenBurns("#aer", T.sat[0], T.topo[1], 1.06, 1.0);
  sweep("#scan", T.sat[0] + 600, T.sat[0] + 2200, 632);

  /* chips under the frame, per beat */
  (function () {
    const row = $("#chiprow");
    const sets = [
      [T.sat, [`<span class="tick">✓</span> Real aerial — Google`, `<span class="tick">✓</span> 5-acre lot`, `<span class="tick">✓</span> ${JOB.market.label} rates`]],
      [T.topo, [`<span class="tick">✓</span> ${TOPO.intervalFt}′ contours`, `<span class="tick">✓</span> 216 elevation samples`, `<span class="tick">✓</span> Grade ${JOB.slope.avg}% avg · ${JOB.slope.max}% max`]],
      [T.draw, [`<span class="tick">✓</span> Snap-to-draw`, `<span class="tick">✓</span> 4′ walk + 10′ drive gate`, `<span class="tick">✓</span> ${Math.round(JOB.totalLf)} LF`]],
      [T.diag, [`<span class="tick">✓</span> ${JOB.posts} posts`, `<span class="tick">✓</span> ${JOB.bags} bags concrete`, `<span class="tick">✓</span> ${JOB.pickets.toLocaleString()} pickets`]],
      [T.td, [`<span class="tick">✓</span> Panels rack ≤ 1′`, `<span class="tick">✓</span> ${JOB.slope.stepPost}′ posts at the steps`, `<span class="tick">✓</span> ${JOB.laborHours} crew hrs`]],
      [T.prop, [`<span class="tick">✓</span> Three tiers`, `<span class="tick">✓</span> ${money(JOB.deposit)} deposit`, `<span class="tick">✓</span> E-sign ready`]],
    ];
    up((ms) => {
      let cur = null, t0 = 0;
      for (const [t, chips] of sets) if (ms >= t[0] && ms < t[1]) { cur = chips; t0 = t[0]; }
      if (!cur) { row.innerHTML = ""; return; }
      if (row.dataset.t0 !== String(t0)) {
        row.dataset.t0 = String(t0);
        row.innerHTML = cur.map((c) => `<span class="chip">${c}</span>`).join("");
      }
      [...row.children].forEach((el, i) => {
        const tt = eo(p(ms, t0 + 500 + i * 200, t0 + 830 + i * 200));
        el.style.opacity = tt;
        el.style.transform = `translateY(${(1 - tt) * 22}px)`;
      });
    });
  })();

  /* callout line, per beat */
  (function () {
    const c = $("#callout");
    const msgs = [
      [T.topo[0] + 900, T.topo[1], `Every number after this knows <b>the hill is there.</b>`],
      [T.draw[0] + 3600, T.draw[1], `Around the yard you'll actually fence — <b>tap by tap.</b>`],
      [T.td[0] + 2400, T.td[1], `Level panels. Real elevations. <b>Counted into the price.</b>`],
      [T.prop[0] + 900, T.prop[1], `<b>${money(chosen.total)}</b> — measured, stepped and priced without a site visit.`],
    ];
    up((ms) => {
      let m = null;
      for (const [a, b, html] of msgs) if (ms >= a && ms < b) m = html;
      if (m) c.innerHTML = m;
      c.style.opacity = m ? 1 : 0;
    });
  })();

  /* topo toggle */
  (function () {
    const pill = $("#topopill"), g = $("#topo"), leg = $("#tleg");
    up((ms) => {
      const on = ms >= T.topo[0] + 300 && ms < T.draw[0] + 2400;
      pill.classList.toggle("on", on);
      pill.textContent = "Topo " + (on ? "on" : "off");
      const lines = g.children;
      const t = p(ms, T.topo[0] + 300, T.topo[0] + 1600);
      g.style.opacity = on ? 1 : 0;
      for (let i = 0; i < lines.length; i++)
        lines[i].style.opacity = on ? eo(clamp(t * lines.length - i * 0.5)) : 0;
      leg.style.opacity = on ? eo(p(ms, T.topo[0] + 1100, T.topo[0] + 1500)) : 0;
    });
  })();

  /* the draw */
  (function () {
    const PLACE = [12600, 13400, 14200, 15000, 15700, 16300], FINISH = 16700;
    const draft = $("#draft"), rubber = $("#rubber"), dverts = $("#dverts");
    const committed = $("#committed"), cverts = $("#cverts"), runchip = $("#runchip");
    const chip = $("#chip"), chipRect = $("#chip rect"), chipText = $("#chip text");
    const cur = $("#cur"), lf = $("#lfbadge");
    up((ms) => {
      let n = 0;
      for (const t of PLACE) if (ms >= t) n++;
      const placed = RUN.slice(0, n);
      let cursor = null;
      if (ms >= T.draw[0] + 400 && ms < FINISH) {
        if (n === 0) {
          const t = eio(p(ms, T.draw[0] + 500, PLACE[0]));
          cursor = [lerp(500, RUN[0][0], t), lerp(300, RUN[0][1], t)];
        } else if (n < RUN.length) {
          const t = eio(p(ms, PLACE[n - 1], PLACE[n]));
          cursor = [lerp(RUN[n - 1][0], RUN[n][0], t), lerp(RUN[n - 1][1], RUN[n][1], t)];
        } else cursor = RUN[RUN.length - 1].slice();
      }
      draft.setAttribute("points", n > 1 ? ptsAttr(placed) : "");
      dverts.innerHTML = ms < FINISH
        ? placed.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fbbf24"/>`).join("")
        : "";
      if (cursor && n > 0 && ms < FINISH) {
        rubber.setAttribute("x1", placed[n - 1][0]); rubber.setAttribute("y1", placed[n - 1][1]);
        rubber.setAttribute("x2", cursor[0]); rubber.setAttribute("y2", cursor[1]);
        rubber.style.opacity = 1;
        const segFt = Math.round(dist(placed[n - 1], cursor) / PXFT);
        let tot = 0;
        for (let i = 1; i < placed.length; i++) tot += dist(placed[i - 1], placed[i]);
        tot = Math.round((tot + dist(placed[n - 1], cursor)) / PXFT);
        const label = placed.length > 1 ? `+${segFt} ft · ${tot} ft total` : `${segFt} ft`;
        chipText.textContent = label;
        chipRect.setAttribute("width", label.length * 6.2 + 14);
        chip.setAttribute("transform", `translate(${cursor[0] + 14},${cursor[1] - 16})`);
        chip.style.opacity = 1;
      } else { rubber.style.opacity = 0; chip.style.opacity = 0; }
      if (cursor && ms < FINISH) {
        cur.style.opacity = 1;
        cur.style.left = (cursor[0] / 900) * 980 + "px";
        cur.style.top = (cursor[1] / 580) * 632 + "px";
      } else cur.style.opacity = 0;
      const done = ms >= FINISH && ms < T.diag[0] + 600;
      committed.style.opacity = ms >= FINISH ? (done ? 1 : 0) : 0;
      committed.setAttribute("points", ms >= FINISH ? ptsAttr(RUN) : "");
      cverts.innerHTML = done
        ? RUN.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3" fill="#fff" stroke="#0891b2" stroke-width="1.4"/>`).join("")
        : "";
      if (done) {
        runchip.setAttribute("transform", `translate(${RUN[2][0] + 120},${RUN[2][1] - 44})`);
        runchip.style.opacity = 1;
        draft.setAttribute("points", "");
      } else runchip.style.opacity = 0;
      const gs = [];
      if (ms > FINISH + 200 && ms < T.diag[0] + 600) gs.push(GATES[0]);
      if (ms > FINISH + 450 && ms < T.diag[0] + 600) gs.push(GATES[1]);
      $("#gates").innerHTML = gs
        .map((g) => {
          const half = (g.widthFt * PXFT) / 2;
          return (
            `<line x1="${g.x - half}" y1="${g.y}" x2="${g.x + half}" y2="${g.y}" stroke="#0b1210" stroke-width="7" opacity="0.55"/>` +
            `<line x1="${g.x - half}" y1="${g.y}" x2="${g.x + half}" y2="${g.y}" stroke="#f472b6" stroke-width="4" stroke-dasharray="6 4"/>` +
            `<rect x="${g.x - 17}" y="${g.y - 27}" width="34" height="16" rx="8" fill="#f472b6"/>` +
            `<text x="${g.x}" y="${g.y - 16}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff" font-family="Inter, sans-serif">${g.widthFt}'</text>`
          );
        }).join("");
      lf.textContent = ms >= FINISH
        ? `${Math.round(JOB.totalLf)} LF · ${ms > FINISH + 450 ? 2 : ms > FINISH + 200 ? 1 : 0} gates`
        : "0 LF · 0 gates";
    });
  })();

  /* diagram + 3D + proposal visibility */
  (function () {
    const diag = $("#diag"), td = $("#threed"), aer = $("#aer"), ov = $("#ov");
    const sl = $("#segLay"), s3 = $("#seg3d");
    up((ms) => {
      const inDiag = ms >= T.diag[0] + 300 && ms < T.td[0] + 300;
      const in3d = ms >= T.td[0] + 300 && ms < T.prop[0] + 400;
      diag.style.opacity = inDiag ? eo(p(ms, T.diag[0] + 300, T.diag[0] + 700)) : 0;
      td.style.opacity = in3d ? eo(p(ms, T.td[0] + 300, T.td[0] + 700)) : 0;
      sl.classList.toggle("on", !in3d);
      s3.classList.toggle("on", in3d);
      const dim = inDiag || in3d;
      aer.style.opacity = dim ? 0 : 1;
      ov.style.opacity = dim ? 0 : 1;
    });
    draw("#diagrun", T.diag[0] + 500, T.diag[0] + 1500);
    /* 3D build: posts then panels, quick stagger */
    const { panels, posts } = window.__3d;
    posts.forEach((g) => (g.style.opacity = 0));
    panels.forEach((g) => (g.style.opacity = 0));
    up((ms) => {
      posts.forEach((g, i) => (g.style.opacity = eo(p(ms, T.td[0] + 500 + i * 18, T.td[0] + 760 + i * 18))));
      panels.forEach((g, i) => (g.style.opacity = eo(p(ms, T.td[0] + 900 + i * 26, T.td[0] + 1200 + i * 26))));
      $("#chips3d").style.opacity = ms >= T.td[0] + 300 && ms < T.prop[0] + 300
        ? eo(p(ms, T.td[0] + 2600, T.td[0] + 3100)) : 0;
    });
  })();

  /* proposal card */
  (function () {
    const pr = $("#prop");
    up((ms) => {
      const on = ms >= T.prop[0] + 200 && ms < T.cta[0] + 500;
      const t = eo(p(ms, T.prop[0] + 200, T.prop[0] + 800));
      pr.style.opacity = on ? t : 0;
      pr.style.transform = `translateY(${(1 - t) * 40}px)`;
    });
  })();

  /* CTA + flashes */
  scene("#s8", T.cta[0], 30000, 320);
  rise("#s8 h2", T.cta[0] + 150, T.cta[0] + 850, 52);
  pop("#s8 .btn", T.cta[0] + 900, T.cta[0] + 1400);
  rise("#s8 .site", T.cta[0] + 1300, T.cta[0] + 1700, 20);
  rise("#s8 .fine", T.cta[0] + 1500, T.cta[0] + 1900, 18);

  if (AD.flourish === "flash") {
    const f = $("#flash");
    const cuts = [T.sat[0], T.topo[0], T.draw[0], T.diag[0], T.td[0], T.prop[0], T.cta[0]];
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
