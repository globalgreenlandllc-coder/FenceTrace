/* ------------------------------------------------------------------ *
 * FenceScan ad kit — the timeline.
 *
 * Every ad is a pure function of time: the renderer calls window.seek(ms)
 * for each frame and screenshots. Nothing animates on its own, so a
 * render is deterministic and re-runnable, and any frame can be pulled
 * as a still. Ads register updaters with the helpers below and set
 * window.TOTAL_MS at the end.
 * ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
/** progress through [a,b] as 0→1 */
const p = (ms, a, b) => clamp((ms - a) / (b - a));
const eo = (t) => 1 - Math.pow(1 - t, 3); // ease out cubic
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const back = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const lerp = (a, b, t) => a + (b - a) * t;

const U = [];
const up = (f) => U.push(f);
window.seek = (ms) => {
  for (const f of U) f(ms);
};

/* ---------------- scene gating ---------------- */
/** Show a scene between [a,b] with a short cross-fade at each edge. */
function scene(sel, a, b, fade = 320) {
  const el = $(sel);
  up((ms) => {
    const inn = p(ms, a, a + fade);
    const out = 1 - p(ms, b - fade, b);
    el.style.opacity = Math.min(inn, out);
  });
  return el;
}

/* ---------------- element animators ---------------- */
/** Fade + rise in. dy>0 comes from below. */
function rise(sel, a, b, dy = 44, all = false) {
  for (const el of all ? $$(sel) : [$(sel)].filter(Boolean)) {
    up((ms) => {
      const t = eo(p(ms, a, b));
      el.style.opacity = t;
      el.style.transform = `translateY(${(1 - t) * dy}px)`;
    });
  }
}

/** Stagger `rise` across every match of sel. */
function riseEach(sel, a, step, dur = 420, dy = 40) {
  $$(sel).forEach((el, i) => {
    const s = a + i * step;
    up((ms) => {
      const t = eo(p(ms, s, s + dur));
      el.style.opacity = t;
      el.style.transform = `translateY(${(1 - t) * dy}px)`;
    });
  });
}

function fade(sel, a, b, from = 0, to = 1) {
  const el = $(sel);
  up((ms) => (el.style.opacity = lerp(from, to, p(ms, a, b))));
}

/** Pop in with a little overshoot — for badges and stamps.
 *  Composes with whatever transform the stylesheet already set (a
 *  translateX(-50%) centring, say) instead of clobbering it. */
function pop(sel, a, b, s0 = 0.72) {
  const el = $(sel);
  const base = getComputedStyle(el).transform;
  const pre = base && base !== "none" ? base + " " : "";
  up((ms) => {
    const t = p(ms, a, b);
    el.style.opacity = clamp(t * 3);
    el.style.transform = `${pre}scale(${lerp(s0, 1, back(t))})`;
  });
}

/** Count a number up, formatted. */
function count(sel, a, b, from, to, fmt = (n) => Math.round(n).toLocaleString("en-US")) {
  const el = $(sel);
  up((ms) => (el.textContent = fmt(lerp(from, to, eo(p(ms, a, b))))));
}

/** Typewriter, with a caret that blinks only while typing. */
function type(sel, a, b, text, caretSel) {
  const el = $(sel);
  const caret = caretSel ? $(caretSel) : null;
  up((ms) => {
    const t = p(ms, a, b);
    el.textContent = text.slice(0, Math.round(t * text.length));
    if (caret) caret.style.opacity = ms < a ? 0 : ms > b + 700 ? 0 : Math.round(ms / 260) % 2 ? 0.25 : 1;
  });
}

/** Grow a bar 0→100% of its track. */
function bar(sel, a, b) {
  const el = $(sel);
  up((ms) => (el.style.width = eo(p(ms, a, b)) * 100 + "%"));
}

/** Draw an SVG path by its own length. */
function draw(sel, a, b) {
  const el = $(sel);
  const len = el.getTotalLength();
  el.style.strokeDasharray = len;
  up((ms) => (el.style.strokeDashoffset = (1 - eo(p(ms, a, b))) * len));
}

/** Slow push-in on a plate — stops a static screenshot reading as static. */
function kenBurns(sel, a, b, from = 1, to = 1.08, ox = "50%", oy = "50%") {
  const el = $(sel);
  el.style.transformOrigin = `${ox} ${oy}`;
  up((ms) => (el.style.transform = `scale(${lerp(from, to, clamp((ms - a) / (b - a)))})`));
}

/** Wipe a strike-through across an "old way" line. */
function strike(sel, a, b) {
  const el = $(sel);
  up((ms) => (el.style.width = eo(p(ms, a, b)) * 100 + "%"));
}

/** A scan line sweeping down a plate, like the app's own scan pass. */
function sweep(sel, a, b, h) {
  const el = $(sel);
  up((ms) => {
    const t = p(ms, a, b);
    el.style.opacity = t > 0 && t < 1 ? 1 : 0;
    el.style.transform = `translateY(${t * h}px)`;
  });
}

/** Cursor that travels a list of [t, x, y] waypoints. */
function cursor(sel, path) {
  const el = $(sel);
  up((ms) => {
    if (ms < path[0][0]) {
      el.style.opacity = 0;
      return;
    }
    el.style.opacity = 1;
    let i = 0;
    while (i < path.length - 1 && ms > path[i + 1][0]) i++;
    if (i === path.length - 1) {
      el.style.transform = `translate(${path[i][1]}px,${path[i][2]}px)`;
      return;
    }
    const [t0, x0, y0] = path[i];
    const [t1, x1, y1] = path[i + 1];
    const t = eio(p(ms, t0, t1));
    el.style.transform = `translate(${lerp(x0, x1, t)}px,${lerp(y0, y1, t)}px)`;
  });
}

/** Slide an element from (x0,y0) to (x1,y1), with optional lift + tilt —
 *  what a card being dragged across a calendar actually looks like. */
function move(sel, a, b, x0, y0, x1, y1, lift = 0) {
  const el = $(sel);
  up((ms) => {
    const t = eio(p(ms, a, b));
    const arc = Math.sin(t * Math.PI); // peaks mid-drag
    el.style.transform =
      `translate(${lerp(x0, x1, t)}px, ${lerp(y0, y1, t)}px) ` +
      `scale(${1 + arc * lift * 0.05}) rotate(${arc * lift * -1.6}deg)`;
    if (lift) el.style.filter = `drop-shadow(0 ${8 + arc * 26}px ${10 + arc * 34}px rgba(0,0,0,${0.25 + arc * 0.3}))`;
  });
}

/** Hold an element visible only inside [a,b] (no tween). */
function only(sel, a, b) {
  const el = $(sel);
  up((ms) => (el.style.opacity = ms >= a && ms < b ? 1 : 0));
}
