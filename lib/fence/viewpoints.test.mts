import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIEW,
  addShot,
  clampView,
  clampZoom,
  coverShot,
  labelForView,
  lerpView,
  moveShot,
  normalizeViewSet,
  normalizeYaw,
  removeShot,
  renameShot,
  setCover,
  setInteraction,
  shortestYawDelta,
  suggestShots,
  yawFacing,
  type FenceViewSet,
} from "./viewpoints.ts";

/** A rectangular back yard: 4 sides, north/south longer than east/west. */
const RECT = [
  {
    points: [
      { x: 200, y: 150 },
      { x: 700, y: 150 },
      { x: 700, y: 430 },
      { x: 200, y: 430 },
      { x: 200, y: 150 },
    ],
  },
];

/* ---------------- yaw math ---------------- */

test("yaw normalizes into (−180, 180] and wraps the short way", () => {
  assert.equal(normalizeYaw(370), 10);
  assert.equal(normalizeYaw(-370), -10);
  assert.equal(normalizeYaw(180), 180);
  assert.equal(normalizeYaw(-180), 180);
  assert.equal(normalizeYaw(540), 180);

  // −170 → +170 is a 20° swing, not 340°.
  assert.equal(shortestYawDelta(-170, 170), -20);
  assert.equal(shortestYawDelta(170, -170), 20);
  assert.equal(shortestYawDelta(0, 90), 90);
});

test("a camera flight takes the short path across the wrap", () => {
  const a = { yawDeg: -170, squash: 0.5 };
  const b = { yawDeg: 170, squash: 0.4 };
  const mid = lerpView(a, b, 0.5);
  // Halfway is 180 (through the wrap), never 0 (the long way).
  assert.ok(Math.abs(Math.abs(mid.yawDeg) - 180) < 0.01, `got ${mid.yawDeg}`);
  assert.ok(Math.abs(mid.squash - 0.45) < 1e-9);
  assert.equal(lerpView(a, b, 0).yawDeg, a.yawDeg);
});

test("yawFacing puts the camera outside the wall it names", () => {
  // Canvas is north-up: −y is north.
  assert.equal(yawFacing({ x: 0, y: 1 }), 0); // south wall → camera south
  assert.equal(yawFacing({ x: 1, y: 0 }), 90); // east wall → camera east
  assert.equal(yawFacing({ x: -1, y: 0 }), -90); // west
  assert.equal(yawFacing({ x: 0, y: -1 }), 180); // north
});

/* ---------------- sanitizing ---------------- */

test("clamping keeps every camera inside the renderer's limits", () => {
  assert.deepEqual(clampView({ yawDeg: 400, squash: 9 }), {
    yawDeg: 40,
    squash: 0.8,
  });
  assert.deepEqual(clampView({ yawDeg: NaN, squash: -3 }), {
    yawDeg: DEFAULT_VIEW.yawDeg,
    squash: 0.3,
  });
  assert.deepEqual(clampView(undefined), DEFAULT_VIEW);

  // k = 1 is the default fit — a pan with no zoom is dropped.
  assert.equal(clampZoom({ k: 1, tx: 50, ty: 50 }), undefined);
  assert.equal(clampZoom(null), undefined);
  assert.deepEqual(clampZoom({ k: 99, tx: 10, ty: 20 }), {
    k: 8,
    tx: 10,
    ty: 20,
  });
});

test("normalizeViewSet survives junk from the database", () => {
  const set = normalizeViewSet({
    shots: [
      { id: "a", label: "Front", view: { yawDeg: 10, squash: 0.5 } },
      { id: "a", label: "Duplicate id", view: {} }, // dropped
      null,
      "nonsense",
      { label: "No id" }, // dropped
      { id: "b", view: { yawDeg: 999, squash: 99 } }, // clamped, auto-labelled
    ],
    coverShotId: "does-not-exist",
    interaction: "nonsense",
  });
  assert.deepEqual(
    set.shots.map((s) => s.id),
    ["a", "b"],
  );
  assert.equal(set.shots[1].view.squash, 0.8);
  assert.ok(set.shots[1].label.length > 0);
  // Bad cover falls back to the first shot; bad mode falls back to free.
  assert.equal(set.coverShotId, "a");
  assert.equal(set.interaction, "free");
});

test("a legacy single camera is promoted to a one-shot set", () => {
  const set = normalizeViewSet(undefined, { yawDeg: 42, squash: 0.44 });
  assert.equal(set.shots.length, 1);
  assert.equal(set.shots[0].view.yawDeg, 42);
  assert.equal(set.interaction, "free");
  assert.equal(coverShot(set).id, set.shots[0].id);

  // Nothing at all still yields a usable default.
  const bare = normalizeViewSet(null);
  assert.equal(bare.shots.length, 1);
  assert.deepEqual(bare.shots[0].view, DEFAULT_VIEW);
});

/* ---------------- suggested angles ---------------- */

test("a rectangular yard suggests an overview plus face-on side shots", () => {
  const shots = suggestShots(RECT);
  assert.equal(shots[0].label, "Overview");
  assert.ok(shots.length >= 3 && shots.length <= 4);
  // Every side shot is distinctly angled and named.
  const labels = shots.map((s) => s.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const s of shots.slice(1)) {
    assert.match(s.label, /line$/);
    assert.ok(s.view.squash < 0.5, "side shots tilt toward eye level");
  }
  // The two longest walls (north + south, 500px each) must be covered
  // before the 280px sides.
  assert.ok(labels.includes("North line"));
  assert.ok(labels.includes("South line"));
});

test("suggested shots actually look at different sides", () => {
  const shots = suggestShots(RECT, { max: 5 });
  const north = shots.find((s) => s.label === "North line")!;
  const south = shots.find((s) => s.label === "South line")!;
  // Opposite walls ⇒ cameras roughly 180° apart.
  assert.ok(
    Math.abs(Math.abs(shortestYawDelta(north.view.yawDeg, south.view.yawDeg)) - 180) < 1,
  );
  // Angled off dead-on so the fence renders with depth, not as a flat wall.
  assert.notEqual(Math.round(south.view.yawDeg), 0);
});

test("degenerate geometry falls back to a lone overview", () => {
  assert.deepEqual(suggestShots([]).map((s) => s.label), ["Overview"]);
  assert.deepEqual(
    suggestShots([{ points: [{ x: 1, y: 1 }] }]).map((s) => s.label),
    ["Overview"],
  );
  assert.deepEqual(
    suggestShots([{ points: [{ x: NaN, y: 2 }, { x: 3, y: 4 }] }]).map(
      (s) => s.label,
    ),
    ["Overview"],
  );
});

test("max caps the shot count", () => {
  assert.equal(suggestShots(RECT, { max: 2 }).length, 2);
});

/* ---------------- editing the set ---------------- */

const base: FenceViewSet = {
  shots: [{ id: "a", label: "Overview", view: { yawDeg: -28, squash: 0.52 } }],
  coverShotId: "a",
  interaction: "free",
};

test("capturing an angle adds it; a near-identical angle does not", () => {
  const one = addShot(base, { yawDeg: 90, squash: 0.42 });
  assert.equal(one.shots.length, 2);
  assert.equal(one.shots[1].label, "East line");

  // 2° away and same tilt is the same shot — hammering the button must
  // not produce eight copies.
  const dupe = addShot(one, { yawDeg: 91, squash: 0.425 });
  assert.equal(dupe.shots.length, 2);

  // A real change goes in.
  const three = addShot(one, { yawDeg: -90, squash: 0.42 });
  assert.equal(three.shots.length, 3);
  assert.equal(three.shots[2].label, "West line");
});

test("captured zoom rides along, and only when it's a real zoom", () => {
  const z = addShot(base, { yawDeg: 90, squash: 0.42 }, { k: 2.5, tx: 10, ty: 4 });
  assert.deepEqual(z.shots[1].zoom, { k: 2.5, tx: 10, ty: 4 });
  const noZoom = addShot(base, { yawDeg: 90, squash: 0.42 }, { k: 1, tx: 9, ty: 9 });
  assert.equal(noZoom.shots[1].zoom, undefined);
});

test("auto labels disambiguate instead of colliding", () => {
  const v = { yawDeg: 90, squash: 0.42 };
  const one = addShot(base, v);
  assert.equal(labelForView(v, one.shots), "East line 2");
  // A top-down camera is named for what it is.
  assert.match(labelForView({ yawDeg: 90, squash: 0.7 }, []), /top-down/);
});

test("the shot list can never be emptied, and the cover reseats", () => {
  const two = addShot(base, { yawDeg: 90, squash: 0.42 });
  const covered = setCover(two, two.shots[1].id);
  assert.equal(coverShot(covered).id, two.shots[1].id);

  // Cutting the cover promotes another shot rather than leaving a
  // proposal pointing at a camera that no longer exists.
  const cut = removeShot(covered, two.shots[1].id);
  assert.equal(cut.shots.length, 1);
  assert.equal(cut.coverShotId, "a");

  // The last shot is not removable.
  assert.equal(removeShot(cut, "a").shots.length, 1);
});

test("reordering moves a shot and clamps at the ends", () => {
  const two = addShot(base, { yawDeg: 90, squash: 0.42 });
  const swapped = moveShot(two, two.shots[1].id, -1);
  assert.deepEqual(swapped.shots.map((s) => s.label), ["East line", "Overview"]);
  // Already first — no move, no crash.
  assert.deepEqual(
    moveShot(swapped, swapped.shots[0].id, -5).shots.map((s) => s.label),
    ["East line", "Overview"],
  );
});

test("renaming trims and ignores an empty name", () => {
  assert.equal(renameShot(base, "a", "  Street view  ").shots[0].label, "Street view");
  assert.equal(renameShot(base, "a", "   ").shots[0].label, "Overview");
});

test("interaction mode round-trips through storage", () => {
  for (const mode of ["free", "guided", "locked"] as const) {
    const set = setInteraction(base, mode);
    assert.equal(normalizeViewSet(set).interaction, mode);
  }
});

test("a full presentation survives a save/load round trip intact", () => {
  let set = base;
  set = addShot(set, { yawDeg: 90, squash: 0.42 }, { k: 3, tx: 12, ty: -4 }, "At the gate");
  set = addShot(set, { yawDeg: 180, squash: 0.45 });
  set = setCover(set, set.shots[1].id);
  set = setInteraction(set, "guided");

  const loaded = normalizeViewSet(JSON.parse(JSON.stringify(set)));
  assert.deepEqual(loaded, set);
  assert.equal(coverShot(loaded).label, "At the gate");
  assert.equal(loaded.interaction, "guided");
});
