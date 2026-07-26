/**
 * Pure node tests for the learned-calibration math (the learning loop's
 * summarizer). Run with: npx tsx --test lib/ai/takeoff-calibration.test.mts
 * No DB / AI / network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correctionPairFromRow,
  summarizeCorrections,
  MIN_CALIBRATION_SAMPLES,
  type CorrectionPair,
} from "./takeoff-calibration.ts";

const pair = (ai: number, edited: number, aiDs = 8, edDs = 8): CorrectionPair => ({
  aiEaveLf: ai,
  editedEaveLf: edited,
  aiDownspouts: aiDs,
  editedDownspouts: edDs,
});

test("too few samples → null (no prior from thin history)", () => {
  const pairs = Array.from({ length: MIN_CALIBRATION_SAMPLES - 1 }, () => pair(200, 240));
  assert.equal(summarizeCorrections(pairs), null);
});

test("consistent over-read → HIGH bias block with the right magnitude", () => {
  // AI read 250/260/280; contractor corrected all to ~220 → AI ran ~15% high.
  const cal = summarizeCorrections([pair(250, 218), pair(260, 225), pair(280, 240)]);
  assert.ok(cal, "3 plausible samples is enough");
  assert.ok(cal!.medianLfDeltaPct < -10, `median should be clearly negative, got ${cal!.medianLfDeltaPct}`);
  assert.ok(cal!.promptBlock, "actionable bias produces a prompt block");
  assert.match(cal!.promptBlock!, /HIGH/);
  assert.match(cal!.promptBlock!, /printed dimensions/i);
});

test("consistent under-read → LOW bias block that points at missed eaves", () => {
  const cal = summarizeCorrections([pair(200, 240), pair(180, 210), pair(220, 260)]);
  assert.ok(cal?.promptBlock);
  assert.match(cal!.promptBlock!, /LOW/);
  assert.match(cal!.promptBlock!, /missed eaves/);
});

test("unbiased history → no prompt block (nothing worth telling the model)", () => {
  const cal = summarizeCorrections([pair(250, 252), pair(240, 238), pair(260, 261)]);
  assert.ok(cal, "summary still returned");
  assert.equal(cal!.promptBlock, null, "±1% noise must not generate guidance");
});

test("a full redraw (60%+ delta) is dropped, not averaged in", () => {
  // Two honest corrections + one redraw that doubled the LF. The redraw must
  // not drag the median — with it excluded only 2 samples remain → null.
  const cal = summarizeCorrections([pair(250, 245), pair(240, 236), pair(150, 320)]);
  assert.equal(cal, null, "redraw excluded → below the sample floor");
});

test("downspout bias surfaces even when LF is accurate", () => {
  const cal = summarizeCorrections([
    pair(250, 251, 8, 11),
    pair(240, 242, 9, 12),
    pair(260, 258, 10, 12),
  ]);
  assert.ok(cal?.promptBlock);
  assert.match(cal!.promptBlock!, /Downspout counts/);
  assert.match(cal!.promptBlock!, /low/);
});

test("correctionPairFromRow reads the stored row shapes and rejects junk", () => {
  const good = correctionPairFromRow({
    analysisJson: {
      gutter_runs: [{ length_ft: 100 }, { length_ft: 79 }, { length_ft: null }],
      downspouts: [{}, {}, {}],
    },
    editedJson: { measurements: { eaveLF: 165, downspoutCount: 5 } },
  });
  assert.deepEqual(good, {
    aiEaveLf: 179,
    editedEaveLf: 165,
    aiDownspouts: 3,
    editedDownspouts: 5,
  });
  assert.equal(correctionPairFromRow({ analysisJson: null, editedJson: {} }), null);
  assert.equal(
    correctionPairFromRow({
      analysisJson: { gutter_runs: [] },
      editedJson: { measurements: { eaveLF: 100 } },
    }),
    null,
    "zero AI LF is not a comparable pair",
  );
});
