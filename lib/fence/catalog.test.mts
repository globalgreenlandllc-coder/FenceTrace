/**
 * Build-spec guards. The 3D view, the BOM and the proposal spec sheet all
 * read `FenceType.spec`, so a wrong value here shows up as a fence that
 * can't be built: vinyl panels hanging on wooden posts, chain-link fabric
 * stapled to a 4×4, ornamental pickets wide enough to fail pool code.
 * These tests pin the trade rules that make each system itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FENCE_TYPES, fenceType } from "./catalog.ts";

test("wire fence rides on metal: round steel pipe, fatter terminals, loop caps", () => {
  for (const t of FENCE_TYPES.filter((f) => f.category === "chain-link")) {
    const s = t.spec;
    assert.match(
      s.postMaterial,
      /steel/i,
      `${t.id}: chain link must be set on steel pipe, got "${s.postMaterial}"`,
    );
    assert.equal(s.postProfile, "round", `${t.id}: chain-link posts are pipe`);
    assert.equal(s.postCap, "loop", `${t.id}: the top rail threads the caps`);
    // A line post dies into the top rail; only terminals stand proud.
    assert.equal(s.postProudIn, 0, `${t.id}: line posts finish at the rail`);
    assert.ok(
      s.terminalWidthIn > s.postWidthIn,
      `${t.id}: terminals take the fabric tension and must be heavier`,
    );
    assert.ok(s.meshDiamondIn && s.meshDiamondIn > 0, `${t.id}: needs a mesh size`);
    assert.equal(s.infillPitchIn, undefined, `${t.id}: mesh has no picket pitch`);
    assert.match(s.railMaterial, /tension wire/i, `${t.id}: no bottom rail, a wire`);
  }
});

test("vinyl fence rides on vinyl posts, capped proud of the panel", () => {
  for (const t of FENCE_TYPES.filter((f) => f.category === "vinyl")) {
    const s = t.spec;
    assert.match(
      s.postMaterial,
      /vinyl/i,
      `${t.id}: vinyl panels go on vinyl posts, got "${s.postMaterial}"`,
    );
    assert.doesNotMatch(s.postMaterial, /\bwood\b|pressure-treated/i, t.id);
    assert.equal(s.postProfile, "square", `${t.id}`);
    assert.ok(s.postProudIn > 0, `${t.id}: the cap stands above the panel`);
    assert.match(s.railMaterial, /vinyl/i, `${t.id}: vinyl rails`);
  }
});

test("wood and split rail stand on wood; ornamental on its own metal", () => {
  for (const t of FENCE_TYPES) {
    const s = t.spec;
    if (t.category === "wood" || t.category === "split-rail") {
      assert.match(
        s.postMaterial,
        /pine|cedar|pressure-treated/i,
        `${t.id}: wood fences get wood posts, got "${s.postMaterial}"`,
      );
    }
    if (t.category === "aluminum") {
      assert.match(s.postMaterial, /aluminum/i, t.id);
      // Aluminum that rusts isn't aluminum.
      assert.doesNotMatch(s.postMaterial, /\bsteel\b/i, t.id);
    }
    if (t.category === "steel") assert.match(s.postMaterial, /steel/i, t.id);
  }
});

test("ornamental picket pitch stays under the 4″ pool-code gap", () => {
  for (const t of FENCE_TYPES.filter(
    (f) => f.category === "aluminum" || f.category === "steel",
  )) {
    const pitch = t.spec.infillPitchIn!;
    assert.ok(pitch > 0 && pitch <= 5, `${t.id}: pitch ${pitch}″ leaves too big a gap`);
  }
});

test("split rail is the only system tamped in gravel, and the only one uncapped", () => {
  const tamped = FENCE_TYPES.filter((t) => !t.spec.setInConcrete).map((t) => t.id);
  assert.deepEqual(tamped, ["split-rail-2"]);
  const uncapped = FENCE_TYPES.filter((t) => t.spec.postCap === "none").map((t) => t.id);
  assert.deepEqual(uncapped, ["split-rail-2"]);
  // A mortised post has to stand above its top rail to hold it.
  assert.ok(fenceType("split-rail-2").spec.postProudIn > 0);
});

test("every system has coherent post stock and infill pitch", () => {
  for (const t of FENCE_TYPES) {
    const s = t.spec;
    assert.ok(s.postWidthIn > 0, `${t.id}: needs a post width`);
    assert.ok(
      s.terminalWidthIn >= s.postWidthIn,
      `${t.id}: terminals are never lighter than line posts`,
    );
    assert.ok(s.postProudIn >= 0, `${t.id}`);
    assert.ok(s.postMaterial.length > 0 && s.infillMaterial.length > 0, `${t.id}`);
    // Anything with a solid face has to say how wide its boards are.
    if (t.build === "stick" || (t.build === "panel" && t.category !== "chain-link")) {
      assert.ok(s.infillPitchIn && s.infillPitchIn > 0, `${t.id}: needs an infill pitch`);
    }
    // Mesh is the only build that measures its infill as a diamond.
    assert.equal(
      !!s.meshDiamondIn,
      t.build === "mesh",
      `${t.id}: mesh size belongs to mesh builds only`,
    );
  }
});

test("picket pitch matches the catalog's own picket width + gap", () => {
  for (const t of FENCE_TYPES) {
    if (t.picketWidthIn == null || t.spec.infillPitchIn == null) continue;
    if (t.id === "shadowbox") continue; // interleaved faces: pitch is per face
    const expected = t.picketWidthIn + (t.picketGapIn ?? 0);
    assert.ok(
      Math.abs(expected - t.spec.infillPitchIn) < 0.51,
      `${t.id}: pitch ${t.spec.infillPitchIn}″ vs ${expected}″ from width+gap`,
    );
  }
});
