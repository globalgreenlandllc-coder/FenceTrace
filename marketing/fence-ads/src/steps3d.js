/* ------------------------------------------------------------------ *
 * steps3d.js — the stepped-fence 3D scene shared by v14 and v20.
 *
 * A stylized axonometric of what Fence3D actually renders on a grade:
 * every panel stays LEVEL, each one past the racking limit steps down
 * (≤ 1' a step, per lib/fence/slope MAX_STEP_DROP_FT), and the post at
 * a step runs longer to carry the taller side. 8 panels, 6 of them
 * stepping — matching the real UI chip "⛰ 6 sections step down the
 * slope". Amber contour lines on the lawn tie the picture back to the
 * Layout view's topo overlay.
 *
 * buildSteps3D(svg) constructs the scene into a 900×580 SVG and
 * returns { posts, panels, deco } element arrays for the page to
 * animate. Pure DOM construction — no timeline of its own.
 * ------------------------------------------------------------------ */
function buildSteps3D(svg) {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(n);
    return n;
  };

  /* run geometry: 9 posts, 8 panels; panels 2..7 step down 26px each */
  const U = { x: 86, y: 17 }; // plan direction per 8' panel
  const H = 96;               // 6' fence height, screen px
  const X0 = 92, Y0 = 232;
  const PANEL_DROP = [0, 0, 26, 26, 26, 26, 26, 26];
  const cum = [0];
  for (const d of PANEL_DROP) cum.push(cum[cum.length - 1] + d);
  const B = cum.map((c, i) => ({ x: X0 + i * U.x, y: Y0 + i * U.y + c }));

  /* ---------- defs ---------- */
  const defs = el("defs", {});
  const sky = el("linearGradient", { id: "st-sky", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: "0%", "stop-color": "#cfe4f2" }, sky);
  el("stop", { offset: "100%", "stop-color": "#e9f2e6" }, sky);
  const lawn = el("linearGradient", { id: "st-lawn", x1: 0, y1: 0, x2: 0.55, y2: 1 }, defs);
  el("stop", { offset: "0%", "stop-color": "#b3d2a0" }, lawn);
  el("stop", { offset: "100%", "stop-color": "#94bb84" }, lawn);

  /* ---------- backdrop ---------- */
  el("rect", { x: 0, y: 0, width: 900, height: 580, fill: "url(#st-sky)" });
  el("polygon", {
    points: "0,258 900,148 900,580 0,580",
    fill: "url(#st-lawn)",
  });

  const deco = [];
  /* contour lines on the lawn — the topo story carried into 3D */
  [
    ["M -20 320 C 200 292, 420 316, 640 268 S 900 232, 920 226", 22],
    ["M -20 400 C 220 368, 430 400, 660 344 S 900 302, 920 296", 17],
    ["M -20 480 C 240 446, 450 484, 680 422 S 900 374, 920 368", 12],
  ].forEach(([d, lvl]) => {
    deco.push(
      el("path", {
        d,
        fill: "none",
        stroke: "#FCD34D",
        "stroke-width": 1.6,
        "stroke-dasharray": "8 6",
        opacity: 0.5,
      }),
    );
  });

  /* trees, like the app's 3D lawn */
  [[130, 190, 34], [806, 148, 30], [836, 452, 40], [70, 480, 34]].forEach(([x, y, r]) => {
    const g = el("g", {});
    el("ellipse", { cx: x + r * 0.5, cy: y + r * 1.32, rx: r * 0.9, ry: r * 0.3, fill: "rgba(40,70,40,0.22)" }, g);
    el("rect", { x: x - 3, y: y + r * 0.5, width: 6, height: r * 0.85, fill: "#7a5c3f" }, g);
    el("circle", { cx: x, cy: y, r, fill: "#4C7A45" }, g);
    el("circle", { cx: x - r * 0.45, cy: y + r * 0.2, r: r * 0.62, fill: "#3B6136" }, g);
    el("circle", { cx: x + r * 0.42, cy: y - r * 0.15, r: r * 0.58, fill: "#557F42" }, g);
    deco.push(g);
  });

  /* the recorded boundary, dashed green, behind the fence */
  deco.push(
    el("path", {
      d: `M ${B[0].x - 46} ${B[0].y - 20} L ${B[8].x + 40} ${B[8].y - 24}`,
      fill: "none",
      stroke: "#4ade80",
      "stroke-width": 2,
      "stroke-dasharray": "7 6",
      opacity: 0.55,
    }),
  );

  /* ---------- terrain profile under the fence ---------- */
  const groundLine = B.map((b) => `${b.x},${b.y + 4}`).join(" ");
  deco.push(
    el("polygon", {
      points: `${groundLine} ${B[8].x},580 ${B[0].x - 60},580`,
      fill: "rgba(60,96,52,0.18)",
    }),
  );

  /* ---------- panels ---------- */
  const panels = [];
  for (let k = 0; k < 8; k++) {
    const b1 = B[k];
    const b2 = { x: b1.x + U.x, y: b1.y + U.y }; // level along the run
    const g = el("g", {});
    /* the face */
    el("polygon", {
      points: `${b1.x},${b1.y} ${b2.x},${b2.y} ${b2.x},${b2.y - H} ${b1.x},${b1.y - H}`,
      fill: k % 2 ? "#b28a60" : "#a87f56",
      stroke: "#8a6844",
      "stroke-width": 1,
    }, g);
    /* pickets */
    for (let s = 1; s < 12; s++) {
      const t = s / 12;
      const x = b1.x + (b2.x - b1.x) * t;
      const y = b1.y + (b2.y - b1.y) * t;
      el("line", { x1: x, y1: y - 2, x2: x, y2: y - H + 3, stroke: "#8f6c4a", "stroke-width": 1, opacity: 0.7 }, g);
    }
    /* level top + bottom rails */
    el("line", { x1: b1.x, y1: b1.y - H + 7, x2: b2.x, y2: b2.y - H + 7, stroke: "#7c5c40", "stroke-width": 3 }, g);
    el("line", { x1: b1.x, y1: b1.y - 12, x2: b2.x, y2: b2.y - 12, stroke: "#7c5c40", "stroke-width": 3 }, g);
    /* the daylight gap a step leaves at the downhill end */
    if (PANEL_DROP[k] > 0)
      el("polygon", {
        points: `${b1.x},${b1.y + 1} ${b2.x},${b2.y + 1} ${b2.x},${b2.y + PANEL_DROP[k]} `,
        fill: "rgba(40,60,36,0.35)",
      }, g);
    panels.push(g);
  }

  /* ---------- posts ---------- */
  const posts = [];
  for (let i = 0; i <= 8; i++) {
    const leftTop = i > 0 ? B[i - 1].y + U.y - H : Infinity;  // panel i-1 top at this post
    const rightTop = i < 8 ? B[i].y - H : Infinity;           // panel i top at this post
    const top = Math.min(leftTop, rightTop) - 7;              // cap proud of the taller panel
    const base = B[i].y + 6;
    const g = el("g", {});
    el("rect", { x: B[i].x - 4.5, y: top, width: 9, height: base - top, fill: "#7a5a3f", stroke: "#5f4630", "stroke-width": 1 }, g);
    el("rect", { x: B[i].x - 6, y: top - 4, width: 12, height: 5, rx: 1.5, fill: "#6b4e36" }, g);
    posts.push(g);
  }

  /* ---------- dimensions ---------- */
  const dims = [];
  /* fence height at the first panel, like the real 3D's "6'" tick */
  {
    const g = el("g", { opacity: 0 });
    const x = B[0].x - 26, y1 = B[0].y - H, y2 = B[0].y;
    el("line", { x1: x, y1, x2: x, y2, stroke: "#3f3f46", "stroke-width": 1.6 }, g);
    el("line", { x1: x - 6, y1, x2: x + 6, y2: y1, stroke: "#3f3f46", "stroke-width": 1.6 }, g);
    el("line", { x1: x - 6, y1: y2, x2: x + 6, y2, stroke: "#3f3f46", "stroke-width": 1.6 }, g);
    el("text", { x: x - 12, y: (y1 + y2) / 2 + 5, "text-anchor": "end", "font-size": 15, "font-weight": 700, fill: "#3f3f46", "font-family": "Inter, sans-serif" }, g).textContent = "6′";
    dims.push(g);
  }
  /* one step called out between panel 2 and 3 tops */
  {
    const k = 3;
    const x = B[k].x + 14;
    const yHi = B[k - 1].y + U.y - H; // downhill top of panel k-1
    const yLo = B[k].y - H;           // top of panel k
    const g = el("g", { opacity: 0 });
    el("line", { x1: x, y1: yHi, x2: x, y2: yLo, stroke: "#b45309", "stroke-width": 2 }, g);
    el("line", { x1: x - 5, y1: yHi, x2: x + 5, y2: yHi, stroke: "#b45309", "stroke-width": 2 }, g);
    el("line", { x1: x - 5, y1: yLo, x2: x + 5, y2: yLo, stroke: "#b45309", "stroke-width": 2 }, g);
    const t = el("text", { x: x + 10, y: (yHi + yLo) / 2 + 5, "font-size": 14.5, "font-weight": 700, fill: "#92400e", "font-family": "Inter, sans-serif" }, g);
    t.textContent = "≤ 1′ step";
    dims.push(g);
  }
  return { posts, panels, deco, dims };
}
