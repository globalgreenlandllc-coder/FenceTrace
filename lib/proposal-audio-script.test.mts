/**
 * Pure node tests for the proposal audio-summary script builder. The
 * script feeds TTS on the client portal, so the invariants that matter:
 * every number spoken must equal what packageTotal renders on screen,
 * measurement notation must be speakable, and the hash must be a stable
 * cache key. Run with:
 *   npx tsx --test lib/proposal-audio-script.test.mts
 * No DB, no AI, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProposalAudioScript,
  audioScriptHash,
  spokenText,
  MAX_SCRIPT_CHARS,
} from "./proposal-audio-script.ts";
import {
  sampleProposal,
  packageTotal,
  type Proposal,
} from "./proposal-mock.ts";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

test("script greets the client's first name and names the company + address", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("Hi Sarah."), s.slice(0, 80));
  assert.ok(s.includes("Rivera Fenceworks"));
  assert.ok(s.includes(sampleProposal.address));
});

test("every package is spoken with the exact on-screen total", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("three options"));
  for (const p of sampleProposal.packages) {
    const { total } = packageTotal(
      p,
      sampleProposal.measurements,
      sampleProposal.discountPct ?? 0,
    );
    assert.ok(
      s.includes(`The ${p.name} package`),
      `missing package ${p.name}`,
    );
    assert.ok(s.includes(money(total)), `missing total ${money(total)} for ${p.name}`);
  }
});

test("the recommended tier is called out", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("which Rivera Fenceworks recommends"));
});

test("a discount changes the spoken prices and is announced", () => {
  const discounted: Proposal = {
    ...sampleProposal,
    discountPct: 10,
    discountLabel: "Spring promo",
  };
  const s = buildProposalAudioScript(discounted);
  assert.ok(s.includes("10 percent discount"));
  assert.ok(s.includes("Spring promo"));
  const rec = discounted.packages.find((p) => p.recommended)!;
  const discountedTotal = packageTotal(rec, discounted.measurements, 10).total;
  const listTotal = packageTotal(rec, discounted.measurements, 0).total;
  assert.ok(s.includes(money(discountedTotal)), "should speak the discounted price");
  assert.ok(!s.includes(money(listTotal)), "must not speak the undiscounted price");
});

test("deposit and validity are spoken", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("A 30 percent deposit"));
  assert.ok(s.includes("valid for 30 days"));
});

test('measurement notation is speakable: 5" → 5 inch, 2"×3" → 2 by 3 inch', () => {
  assert.equal(
    spokenText('5" K-style aluminum gutters'),
    "5 inch K-style aluminum gutters",
  );
  assert.equal(spokenText('2"×3" downspouts'), "2 by 3 inch downspouts");
  assert.equal(spokenText('Hidden hangers, 24" on center'), "Hidden hangers, 24 inch on center");
  // The first highlight of each sample package flows into the script —
  // no raw inch marks may survive.
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(!/\d"/.test(s), `raw inch mark leaked into script: ${s}`);
  assert.ok(!s.includes("×"), "raw × leaked into script");
});

test("empty packages / blank fields degrade gracefully, never throw", () => {
  const bare: Proposal = {
    ...sampleProposal,
    client: { name: "", email: "" },
    contractor: { ...sampleProposal.contractor, company: "", name: "", phone: "" },
    address: "",
    packages: [],
    measurements: { ...sampleProposal.measurements, eaveLF: 0, downspoutCount: 0 },
  };
  const s = buildProposalAudioScript(bare);
  assert.ok(s.includes("Hi there."));
  assert.ok(s.includes("your contractor"));
  assert.ok(s.length > 0);
});

test("script stays under the TTS input ceiling even with bloated highlights", () => {
  const bloated: Proposal = {
    ...sampleProposal,
    packages: sampleProposal.packages.map((p) => ({
      ...p,
      highlights: ["premium seamless gutter system ".repeat(80)],
    })),
  };
  const s = buildProposalAudioScript(bloated);
  assert.ok(s.length <= MAX_SCRIPT_CHARS, `script too long: ${s.length}`);
});

test("hash is stable for identical input and moves when the price moves", () => {
  const a = buildProposalAudioScript(sampleProposal);
  const b = buildProposalAudioScript({ ...sampleProposal });
  assert.equal(audioScriptHash(a), audioScriptHash(b));
  const repriced = buildProposalAudioScript({
    ...sampleProposal,
    discountPct: 5,
  });
  assert.notEqual(audioScriptHash(a), audioScriptHash(repriced));
  assert.match(audioScriptHash(a), /^[0-9a-f]{16}$/);
});
