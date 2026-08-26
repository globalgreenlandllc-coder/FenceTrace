/**
 * viewpoints.ts — the 3D camera positions a contractor freezes onto a
 * proposal, and the rule for how much the client may move them.
 *
 * WHY
 * ---
 * The proposal's 3D preview used to carry ONE camera angle: whatever
 * the contractor happened to be looking at when they hit "Build the
 * proposal". That is fine for a thumbnail and useless as a pitch. A
 * real presentation is a small set of deliberate SHOTS — the street
 * approach, the back line, the gate — each named, in an order the
 * contractor chose, with the client free to spin between them (or held
 * to them, when the contractor would rather control the story).
 *
 * MODEL
 * -----
 * A `FenceViewSet` is what rides on the proposal:
 *   · `shots`      — ordered, named camera positions
 *   · `coverShotId`— the one the client's portal opens on
 *   · `interaction`— how much freedom the client gets:
 *        "free"   — open on the cover shot, spin/zoom/walk freely.
 *                   The default: letting a homeowner turn their own
 *                   fence around is the whole point of shipping 3D.
 *        "guided" — the saved shots only. Tapping a shot flies the
 *                   camera there; free-spin and walk mode are off, so
 *                   the client can never end up staring at the back of
 *                   a hill wondering what they're looking at.
 *        "locked" — one fixed image, no controls at all. For the
 *                   contractor who wants the proposal to look like a
 *                   rendering, not a toy.
 *
 * Camera geometry is `Fence3DView` — `yawDeg` (compass spin) and
 * `squash` (bird's-eye ↔ eye-level tilt) — plus an optional `zoom`, so
 * a framed close-up on a gate survives the round trip instead of
 * reopening as a wide shot.
 *
 * Everything here is pure and geometry-only: no React, no imports
 * beyond the canvas constants. The renderer (components/fence/fence-3d)
 * consumes it; the proposal stores it verbatim.
 */

import { CANVAS_H, CANVAS_W, type Pt } from "./geo";

/** Orbit camera: compass spin + bird's-eye↔eye-level tilt. */
export type Fence3DView = { yawDeg: number; squash: number };

/** Screen zoom over the orbit view: screen = world·k + t. */
export type Fence3DZoom = { k: number; tx: number; ty: number };

export type FenceShot = {
  id: string;
  /** Client-facing name — "North line", "At the gate", "Overview". */
  label: string;
  view: Fence3DView;
  /** Framing. Absent = the default fit (k=1). */
  zoom?: Fence3DZoom;
};

export type FenceInteraction = "free" | "guided" | "locked";

export type FenceViewSet = {
  shots: FenceShot[];
  /** Shot the client opens on. Falls back to the first shot. */
  coverShotId?: string;
  interaction: FenceInteraction;
};

/* The renderer's neutral 3/4 overview — kept in sync with fence-3d. */
export const DEFAULT_YAW_DEG = -28;
export const DEFAULT_SQUASH = 0.52;
export const DEFAULT_VIEW: Fence3DView = {
  yawDeg: DEFAULT_YAW_DEG,
  squash: DEFAULT_SQUASH,
};

export const SQUASH_MIN = 0.3;
export const SQUASH_MAX = 0.8;
export const ZOOM_MAX = 8;
/** Below 1 = pulled back past the framed fit — context view. */
export const ZOOM_MIN = 0.5;

export const INTERACTION_LABEL: Record<FenceInteraction, string> = {
  free: "Free spin",
  guided: "Saved angles only",
  locked: "Locked — single view",
};

export const INTERACTION_HINT: Record<FenceInteraction, string> = {
  free: "The client opens on your cover shot and can spin, zoom and walk the yard from there.",
  guided: "The client can only step between the angles you saved. No free spin, no walk mode.",
  locked: "The client sees one fixed image. Every control is hidden.",
};

/* ------------------------------------------------------------------ */
/*  Sanitizing                                                         */
/* ------------------------------------------------------------------ */

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Wrap a yaw into (−180, 180] so saved angles compare and tween sanely. */
export function normalizeYaw(deg: number): number {
  if (!Number.isFinite(deg)) return DEFAULT_YAW_DEG;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 10) / 10;
}

/** Shortest signed rotation from `a` to `b` — a camera flying from
 *  −170° to +170° must swing 20° through the wrap, not 340° the long
 *  way around. */
export function shortestYawDelta(a: number, b: number): number {
  return normalizeYaw(normalizeYaw(b) - normalizeYaw(a));
}

export function clampView(v: Partial<Fence3DView> | undefined): Fence3DView {
  return {
    yawDeg: normalizeYaw(num(v?.yawDeg, DEFAULT_YAW_DEG)),
    squash: clamp(num(v?.squash, DEFAULT_SQUASH), SQUASH_MIN, SQUASH_MAX),
  };
}

export function clampZoom(
  z: Partial<Fence3DZoom> | undefined | null,
): Fence3DZoom | undefined {
  if (!z) return undefined;
  const k = clamp(num(z.k, 1), ZOOM_MIN, ZOOM_MAX);
  // k = 1 is the default fit; storing a pan with no zoom would just
  // push the scene off-centre for no reason.
  if (k === 1) return undefined;
  return {
    k: Math.round(k * 1000) / 1000,
    tx: Math.round(num(z.tx, 0) * 10) / 10,
    ty: Math.round(num(z.ty, 0) * 10) / 10,
  };
}

/** Interpolate between two cameras — the flight path when a client taps
 *  a shot. `t` is the eased 0→1 progress. */
export function lerpView(a: Fence3DView, b: Fence3DView, t: number): Fence3DView {
  return {
    yawDeg: a.yawDeg + shortestYawDelta(a.yawDeg, b.yawDeg) * t,
    squash: a.squash + (b.squash - a.squash) * t,
  };
}

export function lerpZoom(
  a: Fence3DZoom | undefined,
  b: Fence3DZoom | undefined,
  t: number,
): Fence3DZoom {
  const from = a ?? { k: 1, tx: 0, ty: 0 };
  const to = b ?? { k: 1, tx: 0, ty: 0 };
  return {
    k: from.k + (to.k - from.k) * t,
    tx: from.tx + (to.tx - from.tx) * t,
    ty: from.ty + (to.ty - from.ty) * t,
  };
}

/** Ease-in-out — a camera that starts and stops gently reads as a
 *  deliberate move rather than a jump cut. */
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const MAX_SHOTS = 8;

let seq = 0;
/** Stable-enough id for a newly captured shot. Not crypto — these only
 *  need to be unique within one proposal's shot list. */
export function shotId(existing: FenceShot[] = []): string {
  const taken = new Set(existing.map((s) => s.id));
  let id: string;
  do {
    id = `shot-${(seq = (seq + 1) % 100000)}-${existing.length}`;
  } while (taken.has(id));
  return id;
}

/**
 * Coerce whatever is in the proposal JSON into a usable view set.
 *
 * Handles all three vintages:
 *   · a full `views3d` set (current),
 *   · a lone legacy `view3d: {yawDeg, squash}` — becomes a one-shot
 *     "Overview" set in free mode, so proposals built before shots
 *     existed still open on the angle the contractor froze,
 *   · nothing at all — a single default overview.
 *
 * Defensive on every field: this parses untrusted JSON off a database
 * row that a client portal renders logged-out.
 */
export function normalizeViewSet(
  raw: unknown,
  legacyView?: Partial<Fence3DView> | null,
): FenceViewSet {
  const r = (raw ?? {}) as Partial<FenceViewSet>;
  const rawShots = Array.isArray(r.shots) ? r.shots : [];
  const shots: FenceShot[] = [];
  for (const s of rawShots.slice(0, MAX_SHOTS)) {
    if (!s || typeof s !== "object") continue;
    const id =
      typeof s.id === "string" && s.id.trim() ? s.id.trim().slice(0, 64) : null;
    if (!id || shots.some((x) => x.id === id)) continue;
    const zoom = clampZoom(s.zoom);
    shots.push({
      id,
      label:
        typeof s.label === "string" && s.label.trim()
          ? s.label.trim().slice(0, 40)
          : `View ${shots.length + 1}`,
      view: clampView(s.view),
      // Omit the key entirely rather than storing `zoom: undefined` —
      // this object is JSON-serialized onto the proposal, and an
      // explicit undefined only bloats the blob and breaks equality
      // checks against a freshly-loaded copy.
      ...(zoom ? { zoom } : {}),
    });
  }

  if (shots.length === 0) {
    shots.push({
      id: "overview",
      label: "Overview",
      view: clampView(legacyView ?? DEFAULT_VIEW),
    });
  }

  const interaction: FenceInteraction =
    r.interaction === "guided" || r.interaction === "locked"
      ? r.interaction
      : "free";
  const coverShotId =
    typeof r.coverShotId === "string" &&
    shots.some((s) => s.id === r.coverShotId)
      ? r.coverShotId
      : shots[0].id;

  return { shots, coverShotId, interaction };
}

/** The shot the client's portal opens on. */
export function coverShot(set: FenceViewSet): FenceShot {
  return set.shots.find((s) => s.id === set.coverShotId) ?? set.shots[0];
}

/* ------------------------------------------------------------------ */
/*  Auto-suggested angles                                              */
/* ------------------------------------------------------------------ */

/**
 * Which side of the yard a fence run faces. Canvas space is the static
 * satellite tile, which is north-up — so −y is north and +y is south.
 */
export type YardSide = "north" | "east" | "south" | "west";

const SIDE_LABEL: Record<YardSide, string> = {
  north: "North line",
  east: "East line",
  south: "South line",
  west: "West line",
};

/**
 * How far off dead-on each face-on shot is angled. A camera square to a
 * fence renders it as a flat wall with no depth; swinging 22° off gives
 * the three-quarter view that reads as built work — the same instinct
 * behind not photographing a house head-on.
 */
const THREE_QUARTER_OFFSET_DEG = 22;

/** Face-on shots tilt closer to eye level than the bird's-eye overview
 *  — you're standing at the fence, not flying over it. */
const FACE_ON_SQUASH = 0.42;

/**
 * Camera yaw that puts the viewer OUTSIDE a wall looking in.
 *
 * The renderer projects a plan point as
 *     screen.y = (x·sinR + y·cosR)·squash − z
 * so points with a larger dot product against (sinR, cosR) sit lower on
 * screen, i.e. nearer the viewer. The camera therefore lies along the
 * wall's outward normal `n`, which means sinR = n.x, cosR = n.y — and
 * the yaw that achieves it is atan2(n.x, n.y).
 */
export function yawFacing(normal: Pt): number {
  return normalizeYaw((Math.atan2(normal.x, normal.y) * 180) / Math.PI);
}

function sideOf(n: Pt): YardSide {
  return Math.abs(n.x) > Math.abs(n.y)
    ? n.x > 0
      ? "east"
      : "west"
    : n.y > 0
      ? "south"
      : "north";
}

/**
 * Propose a professional shot list straight from the drawn geometry.
 *
 * Reads every fence segment, works out which way it FACES (its outward
 * normal, away from the layout's centre), and buckets the footage by
 * yard side. Sides carrying a meaningful share of the fence each earn
 * a face-on shot, ordered longest-run first, angled off square for
 * depth. An overview leads the set.
 *
 * The result is a set the contractor can ship as-is or trim — which is
 * the point: the common case should need zero camera work.
 */
export function suggestShots(
  runs: { points: Pt[] }[],
  opts: { max?: number; minShareOfTotal?: number } = {},
): FenceShot[] {
  const max = Math.max(1, Math.min(MAX_SHOTS, opts.max ?? 4));
  const minShare = opts.minShareOfTotal ?? 0.12;

  const overview: FenceShot = {
    id: "overview",
    label: "Overview",
    view: { ...DEFAULT_VIEW },
  };

  // Centroid of every drawn vertex — the "inside" the normals point
  // away from. Falls back to the canvas middle for a degenerate layout.
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const r of runs)
    for (const p of r.points ?? []) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      cx += p.x;
      cy += p.y;
      n++;
    }
  if (n === 0) return [overview];
  cx /= n;
  cy /= n;

  // Length-weighted outward normal per side.
  const acc = new Map<YardSide, { len: number; nx: number; ny: number }>();
  let total = 0;
  for (const r of runs) {
    const pts = r.points ?? [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      // Perpendicular, flipped to point away from the centroid.
      let nx = dy / len;
      let ny = -dx / len;
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const side = sideOf({ x: nx, y: ny });
      const cur = acc.get(side) ?? { len: 0, nx: 0, ny: 0 };
      cur.len += len;
      cur.nx += nx * len;
      cur.ny += ny * len;
      acc.set(side, cur);
      total += len;
    }
  }
  if (total === 0) return [overview];

  const sides = [...acc.entries()]
    .filter(([, v]) => v.len / total >= minShare)
    .sort((a, b) => b[1].len - a[1].len)
    .slice(0, max - 1);

  const shots: FenceShot[] = [overview];
  for (const [side, v] of sides) {
    const mag = Math.hypot(v.nx, v.ny) || 1;
    const yaw = yawFacing({ x: v.nx / mag, y: v.ny / mag });
    shots.push({
      id: `side-${side}`,
      label: SIDE_LABEL[side],
      view: {
        yawDeg: normalizeYaw(yaw + THREE_QUARTER_OFFSET_DEG),
        squash: FACE_ON_SQUASH,
      },
    });
  }
  return shots;
}

/**
 * Name a freshly captured angle by where the camera is standing, so a
 * contractor who just spins and clicks still gets a labelled shot list
 * instead of "View 3". Inverts `yawFacing`: the camera sits along
 * (sin yaw, cos yaw) from the scene.
 */
export function labelForView(view: Fence3DView, existing: FenceShot[]): string {
  const r = (view.yawDeg * Math.PI) / 180;
  const side = sideOf({ x: Math.sin(r), y: Math.cos(r) });
  const base = view.squash >= 0.62 ? `${SIDE_LABEL[side]} (top-down)` : SIDE_LABEL[side];
  if (!existing.some((s) => s.label === base)) return base;
  for (let i = 2; i < 20; i++) {
    const candidate = `${base} ${i}`;
    if (!existing.some((s) => s.label === candidate)) return candidate;
  }
  return base;
}

/** Add a captured camera to a set (capped, deduped by near-identical
 *  angle so hammering the button can't produce eight of the same shot). */
export function addShot(
  set: FenceViewSet,
  view: Fence3DView,
  zoom?: Fence3DZoom | null,
  label?: string,
): FenceViewSet {
  const v = clampView(view);
  const z = clampZoom(zoom);
  const dupe = set.shots.find(
    (s) =>
      Math.abs(shortestYawDelta(s.view.yawDeg, v.yawDeg)) < 3 &&
      Math.abs(s.view.squash - v.squash) < 0.02 &&
      Math.abs((s.zoom?.k ?? 1) - (z?.k ?? 1)) < 0.05,
  );
  if (dupe) return set;
  if (set.shots.length >= MAX_SHOTS) return set;
  const shot: FenceShot = {
    id: shotId(set.shots),
    label: label?.trim().slice(0, 40) || labelForView(v, set.shots),
    view: v,
    ...(z ? { zoom: z } : {}),
  };
  return { ...set, shots: [...set.shots, shot] };
}

/** Remove a shot. Never empties the set — a proposal always has at
 *  least one camera, and the cover reseats when it was the one cut. */
export function removeShot(set: FenceViewSet, id: string): FenceViewSet {
  if (set.shots.length <= 1) return set;
  const shots = set.shots.filter((s) => s.id !== id);
  if (shots.length === set.shots.length) return set;
  return {
    ...set,
    shots,
    coverShotId: shots.some((s) => s.id === set.coverShotId)
      ? set.coverShotId
      : shots[0].id,
  };
}

export function renameShot(
  set: FenceViewSet,
  id: string,
  label: string,
): FenceViewSet {
  const clean = label.trim().slice(0, 40);
  if (!clean) return set;
  return {
    ...set,
    shots: set.shots.map((s) => (s.id === id ? { ...s, label: clean } : s)),
  };
}

/** Reorder by moving one shot `delta` places — the order the client
 *  steps through them in. */
export function moveShot(
  set: FenceViewSet,
  id: string,
  delta: number,
): FenceViewSet {
  const i = set.shots.findIndex((s) => s.id === id);
  if (i < 0) return set;
  const j = clamp(i + delta, 0, set.shots.length - 1);
  if (i === j) return set;
  const shots = [...set.shots];
  const [moved] = shots.splice(i, 1);
  shots.splice(j, 0, moved);
  return { ...set, shots };
}

export function setCover(set: FenceViewSet, id: string): FenceViewSet {
  return set.shots.some((s) => s.id === id) ? { ...set, coverShotId: id } : set;
}

export function setInteraction(
  set: FenceViewSet,
  interaction: FenceInteraction,
): FenceViewSet {
  return { ...set, interaction };
}

/** Canvas centre, for callers that need a framing reference. */
export const CANVAS_CENTER: Pt = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
