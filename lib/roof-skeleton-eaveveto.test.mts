/**
 * A full-length eave on a side vetoes a GABLE there (it's an eave side); a
 * partial porch eave on a gable end does NOT. Run via:
 *   npx tsx --test lib/roof-skeleton-eaveveto.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRoofSkeleton } from "./roof-skeleton.ts";

type P = { x: number; y: number };
const W = 300;
const H = 200;
const RECT: P[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const fullEave = (side: "top" | "bottom" | "left" | "right"): [P, P] =>
  side === "top" ? [{ x: 0, y: 0 }, { x: W, y: 0 }]
  : side === "bottom" ? [{ x: 0, y: H }, { x: W, y: H }]
  : side === "left" ? [{ x: 0, y: 0 }, { x: 0, y: H }]
  : [{ x: W, y: 0 }, { x: W, y: H }];

test("a side with a FULL eave AND a stray rake is NOT a gable (eave side wins)", () => {
  // The reported bug: left/right have full eaves (45 LF) but a stray rake made
  // them GABLE. With the veto, eaves on all four sides -> zero gables.
  const s = deriveRoofSkeleton(RECT, {
    eaveSegments: [fullEave("top"), fullEave("bottom"), fullEave("left"), fullEave("right")],
    rakeSegments: [fullEave("left"), fullEave("right")], // stray side rakes
  });
  assert.equal(s.gables.length, 0, "full-eave sides are not gables despite the rakes");
});

test("a genuine gable end (rake, NO eave on that side) is still a gable", () => {
  const s = deriveRoofSkeleton(RECT, {
    eaveSegments: [fullEave("top"), fullEave("bottom")], // only front/back eaves
    rakeSegments: [fullEave("left"), fullEave("right")], // left/right gable ends
  });
  assert.ok(s.gables.length >= 2, `expected the 2 side gable ends, got ${s.gables.length}`);
});

test("a gable end with only a PARTIAL (porch) eave still reads as a gable", () => {
  // Left side is a gable end with a short lower porch eave covering ~30% of it.
  const partialLeft: [P, P] = [{ x: 0, y: 130 }, { x: 0, y: 200 }]; // 70/200 = 35%
  const s = deriveRoofSkeleton(RECT, {
    eaveSegments: [fullEave("top"), fullEave("bottom"), fullEave("right"), partialLeft],
    rakeSegments: [fullEave("left")],
  });
  const hasLeftGable = s.gables.some(
    (g) => Math.abs(g.points[0].x) < 5 && Math.abs(g.points[1].x) < 5,
  );
  assert.ok(hasLeftGable, "partial porch eave must NOT veto the left gable end");
});
